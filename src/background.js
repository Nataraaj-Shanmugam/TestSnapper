///////////////////////////////
// Constants & Configuration //
///////////////////////////////

const LLM_MODEL_ID = 'Llama-3.2-1B-Instruct-q4f32_1-MLC';
const LLM_ASSETS_BASE = 'assets/webllm/';

const BATCH_SIZE = 25;
const BATCH_DEBOUNCE_MS = 200;
const BATCH_TIMEOUT_MS = 10000;
const SNAPSHOT_EVERY_N_STEPS = 200;
const MAX_QUEUE_LEN = 500;
const LRU_CACHE_SIZE = 5000;

const STORAGE_KEYS = {
  SESSIONS_INDEX: 'ts.sessions.index',
  SESSION_PREFIX: 'ts.session.',
  SETTINGS: 'ts.settings',
  TELEMETRY: 'ts.telemetry',
};

//////////////////////
// In-Memory State  //
//////////////////////

const sessionState = new Map(); // id -> { meta, steps[], network[], shots[] }
const pendingQueue = new Map(); // id -> [rawStep,...]
const batchTimers = new Map();  // id -> timeoutId
const pendingReqs = new Map();  // reqId -> { sessionId, startedAt, size }

let llmReady = false;
let llmMode = 'unknown';
let llmEnabledDefault = true;
const recordingState = new Map(); // sessionId -> { recording: boolean, paused: boolean }

// Host info for running WebLLM when Offscreen API is missing
let llmHost = { mode: null, windowId: null, tabId: null };

// Simple LRU for enrichment cache
class LRU {
  constructor(limit) { this.limit = limit; this.map = new Map(); }
  get(k) { if (!this.map.has(k)) return undefined; const v = this.map.get(k); this.map.delete(k); this.map.set(k, v); return v; }
  set(k, v) { if (this.map.has(k)) this.map.delete(k); this.map.set(k, v); if (this.map.size > this.limit) this.map.delete(this.map.keys().next().value); }
}
const enrichCache = new LRU(LRU_CACHE_SIZE);

//////////////////////
// Utility Helpers  //
//////////////////////

const delay = (ms) => new Promise(r => setTimeout(r, ms));
const nowIso = () => new Date().toISOString();

function uuid() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function coalesceSessionId(msg) {
  return msg?.sessionId || msg?.sid || msg?.session || 'default';
}

async function getSettings() {
  const { [STORAGE_KEYS.SETTINGS]: s } = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return s || { llmEnabled: llmEnabledDefault, redactionPatterns: [] };
}

async function setSettings(obj) {
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: obj });
}

async function getSessionsIndex() {
  const { [STORAGE_KEYS.SESSIONS_INDEX]: idx } = await chrome.storage.local.get(STORAGE_KEYS.SESSIONS_INDEX);
  return Array.isArray(idx) ? idx : [];
}

async function upsertSessionsIndex(meta) {
  const idx = await getSessionsIndex();
  const i = idx.findIndex(x => x.id === meta.id);
  if (i >= 0) idx[i] = { ...idx[i], ...meta };
  else idx.unshift(meta);
  await chrome.storage.local.set({ [STORAGE_KEYS.SESSIONS_INDEX]: idx });
}

async function loadSession(id) {
  const key = STORAGE_KEYS.SESSION_PREFIX + id;
  const { [key]: data } = await chrome.storage.local.get(key);
  return data || null;
}

async function saveSession(id, data) {
  const key = STORAGE_KEYS.SESSION_PREFIX + id;
  await chrome.storage.local.set({ [key]: data });
}

async function setTelemetry(t) {
  await chrome.storage.local.set({ [STORAGE_KEYS.TELEMETRY]: t });
}

function minimalizeStep(s) {
  const action = s?.action || s?.name || 'Action';
  const loc = s?.locatorNorm || s?.locatorRaw || s?.locator || '';
  return `${action} ${loc}`.trim();
}

function hashKey(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24); }
  return (h >>> 0).toString(16);
}

// Active tab + screenshot helpers
async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0] ? tabs[0] : null;
}

async function getActiveTabId() {
  const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return t?.id || null;
}

async function captureAndStoreScreenshot(sessionId) {
  const s = sessionState.get(sessionId);
  if (!s) return { ok: false, error: 'SESSION_NOT_FOUND' };

  const tab = await getActiveTab();
  const windowId = tab?.windowId ?? undefined;
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });

  const shot = {
    id: uuid(),
    ts: Date.now(),
    dataUrl,
    tabId: tab?.id ?? null,
    url: tab?.url || '',
    title: tab?.title || '',
    stepId: (s.steps && s.steps.length) ? s.steps[s.steps.length - 1].id : null,
  };

  s.shots.push(shot);
  s.updated = Date.now();
  await saveSession(sessionId, s);

  await upsertSessionsIndex({
    id: s.id, name: s.name, updated: s.updated,
    stepCount: s.steps.length,
    errorCount: (s.network || []).filter(n => n.status >= 400).length
  });

  return { ok: true, shotId: shot.id };
}

//////////////////////////////
// WebLLM Host Functions
//////////////////////////////

async function hasOffscreenAPI() {
  try { return !!chrome.offscreen && typeof chrome.offscreen.createDocument === 'function'; }
  catch { return false; }
}

async function hasOffscreen() {
  if (!(await hasOffscreenAPI())) return false;
  if (chrome.offscreen?.hasDocument) {
    try { return await chrome.offscreen.hasDocument(); } catch { return false; }
  }
  return false;
}

async function ensureOffscreen() {
  if (!(await hasOffscreenAPI())) throw new Error('OFFSCREEN_API_UNAVAILABLE');
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: 'assets/html/webllm-host.html',
    reasons: ['IFRAME_SCRIPTING'],
    justification: 'Run WebLLM in an offscreen document for local enrichment',
  });
}

async function ensureLLMHost() {
  console.log('[TestSnapper Background] Ensuring LLM host...');
  if (llmHost.mode) {
    console.log('[TestSnapper Background] LLM host already exists:', llmHost.mode);
    return;
  }

  if (await hasOffscreenAPI()) {
    try {
      await ensureOffscreen();
      llmHost.mode = 'offscreen';
      console.log('[TestSnapper Background] Created offscreen LLM host');
      return;
    } catch (e) {
      console.warn('[TestSnapper Background] Offscreen not available, falling back to minimized window', e);
    }
  }

  const url = chrome.runtime.getURL('assets/html/webllm-host.html');
  try {
    const allTabs = await chrome.tabs.query({});
    const existing = allTabs.find(t => t.url === url);
    if (existing) {
      llmHost = { mode: 'tab', windowId: existing.windowId, tabId: existing.id };
      console.log('[TestSnapper Background] Found existing LLM host tab:', existing.id);
      return;
    }
  } catch { }
  
  const win = await chrome.windows.create({
    url, type: 'popup', focused: false, state: 'minimized', width: 420, height: 320
  });
  llmHost = { mode: 'tab', windowId: win.id, tabId: win.tabs?.[0]?.id || null };
  console.log('[TestSnapper Background] Created minimized window LLM host:', llmHost);
}

async function llmAvailable() {
  if (llmHost.mode) return true;
  if (await hasOffscreen()) return true;
  return false;
}

/////////////////////////////////
// Content Script Injection    //
/////////////////////////////////

async function pingContentScript(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    return response?.ok === true;
  } catch (e) {
    console.warn('[TestSnapper Background] PING failed:', e);
    return false;
  }
}

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['src/content.js']
    });
    console.log('[TestSnapper Background] Injected content script into tab:', tabId);
    return true;
  } catch (e) {
    console.error('[TestSnapper Background] Failed to inject content script:', e);
    return false;
  }
}

async function ensureContentScript(tabId) {
  const isPresent = await pingContentScript(tabId);
  if (isPresent) {
    console.log('[TestSnapper Background] Content script already present');
    return true;
  }
  
  console.log('[TestSnapper Background] Content script not present, injecting...');
  return await injectContentScript(tabId);
}

/////////////////////////
// Recording Lifecycle //
/////////////////////////

async function startRecording({ sessionId, llm }) {
  console.log('[TestSnapper Background] Starting recording:', sessionId);
  const settings = await getSettings();
  const llmEnabled = typeof llm === 'boolean' ? llm : settings.llmEnabled;

  const session = {
    id: sessionId,
    name: `Session ${new Date().toLocaleString()}`,
    created: Date.now(),
    updated: Date.now(),
    meta: { browser: 'Chrome', os: (navigator?.userAgentData?.platform || 'unknown') },
    steps: [],
    network: [],
    shots: [],
  };

  sessionState.set(sessionId, session);
  recordingState.set(sessionId, { recording: true, paused: false });

  await saveSession(sessionId, session);
  await upsertSessionsIndex({
    id: session.id,
    name: session.name,
    created: session.created,
    updated: session.updated,
    stepCount: 0,
    errorCount: 0
  });

  // Ensure content script is present before starting recording
  const tabId = await getActiveTabId();
  if (tabId) {
    const scriptReady = await ensureContentScript(tabId);
    if (scriptReady) {
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'REC_START', sessionId });
        console.log('[TestSnapper Background] Sent REC_START to content script');
      } catch (e) {
        console.warn('[TestSnapper Background] Failed to notify content script of recording start:', e);
      }
    }
  }

  console.log('[TestSnapper Background] Session state created and saved:', session);
}

async function stopRecording({ sessionId }) {
  await flushAllBatches(sessionId);
  const s = sessionState.get(sessionId);
  if (s) {
    s.updated = Date.now();
    await saveSession(sessionId, s);
    await upsertSessionsIndex({
      id: s.id,
      name: s.name,
      updated: s.updated,
      stepCount: s.steps.length,
      errorCount: (s.network || []).filter(n => (n.status >= 400)).length,
    });
  }
  clearDebounce(sessionId);
  pendingQueue.delete(sessionId);
  recordingState.delete(sessionId);

  // Notify content script
  const tabId = await getActiveTabId();
  if (tabId) {
    try {
      await chrome.tabs.sendMessage(tabId, { type: 'REC_STOP' });
    } catch (e) {
      console.warn('[TestSnapper Background] Failed to notify content script of recording stop:', e);
    }
  }
}

function pauseRecording(sessionId) {
  const state = recordingState.get(sessionId);
  if (state) state.paused = true;
}

function resumeRecording(sessionId) {
  const state = recordingState.get(sessionId);
  if (state) state.paused = false;
}

/////////////////////////
// Step Ingestion Flow //
/////////////////////////

function enqueueStep(sessionId, step) {
  const q = pendingQueue.get(sessionId) || [];
  if (q.length >= MAX_QUEUE_LEN) return;
  q.push({ ...step, id: step.id || uuid(), ts: step.ts || Date.now() });
  pendingQueue.set(sessionId, q);
  debounceFlush(sessionId);
}

function debounceFlush(sessionId) {
  clearDebounce(sessionId);
  const t = setTimeout(() => flushBatches(sessionId), BATCH_DEBOUNCE_MS);
  batchTimers.set(sessionId, t);
}

function clearDebounce(sessionId) {
  const t = batchTimers.get(sessionId);
  if (t) clearTimeout(t);
  batchTimers.delete(sessionId);
}

async function flushBatches(sessionId) {
  const q = pendingQueue.get(sessionId);
  if (!q || q.length === 0) return;

  const batch = q.splice(0, BATCH_SIZE);
  pendingQueue.set(sessionId, q);

  const s = sessionState.get(sessionId);
  if (!s) return;
  const beforeLen = s.steps.length;
  s.steps.push(...batch.map(b => ({ ...b, enriched: null })));
  s.updated = Date.now();

  if (s.steps.length - beforeLen >= SNAPSHOT_EVERY_N_STEPS || s.steps.length % SNAPSHOT_EVERY_N_STEPS === 0) {
    await saveSession(sessionId, s);
  }

  // Enrichment logic
  const toEnrich = [];
  const cachedResults = [];
  for (const step of batch) {
    const key = hashKey(`${step.action || step.name}|${step.locatorNorm || step.locatorRaw}|${step.valueKind || ''}|${step.meta?.url || ''}`);
    const hit = enrichCache.get(key);
    if (hit) cachedResults.push({ id: step.id, enriched: hit });
    else toEnrich.push({ ...step, _cacheKey: key });
  }

  if (cachedResults.length) {
    applyEnriched(sessionId, cachedResults, true);
  }

  const settings = await getSettings();
  if (settings.llmEnabled && (await llmAvailable())) {
    if (toEnrich.length) {
      const reqId = uuid();
      pendingReqs.set(reqId, { sessionId, startedAt: performance.now(), steps: toEnrich });
      chrome.runtime.sendMessage({ type: 'LLM_ENRICH_BATCH', reqId, steps: toEnrich })
        .then(() => startBatchTimeout(reqId))
        .catch(() => {
          const fallback = toEnrich.map(t => ({ id: t.id, enriched: minimalizeStep(t) }));
          applyEnriched(sessionId, fallback, false);
          pendingReqs.delete(reqId);
        });
    }
  } else {
    if (toEnrich.length) {
      const fallback = toEnrich.map(t => ({ id: t.id, enriched: minimalizeStep(t) }));
      applyEnriched(sessionId, fallback, false);
    }
  }

  await updateTelemetry();
}

function startBatchTimeout(reqId) {
  setTimeout(() => {
    const rec = pendingReqs.get(reqId);
    if (!rec) return;
    const { sessionId, steps = [] } = rec;
    const fallback = steps.map(t => ({ id: t.id, enriched: minimalizeStep(t) }));
    applyEnriched(sessionId, fallback, false);
    pendingReqs.delete(reqId);
  }, BATCH_TIMEOUT_MS);
}

function applyEnriched(sessionId, results, fromCache) {
  const s = sessionState.get(sessionId);
  if (!s) return;
  const byId = new Map(results.map(r => [r.id, r.enriched]));
  for (const step of s.steps) {
    if (byId.has(step.id)) {
      step.enriched = sanitizeEnriched(byId.get(step.id));
    }
  }
  if (!fromCache) {
    for (const r of results) {
      const orig = s.steps.find(x => x.id === r.id);
      if (!orig) continue;
      const key = hashKey(`${orig.action || orig.name}|${orig.locatorNorm || orig.locatorRaw}|${orig.valueKind || ''}|${orig.meta?.url || ''}`);
      enrichCache.set(key, stepToSentence(orig));
    }
  }
}

function sanitizeEnriched(txt) {
  if (!txt || typeof txt !== 'string') return '';
  let s = txt.replace(/\s+/g, ' ').trim();
  if (s.length > 160) s = s.slice(0, 157) + '...';
  return s;
}

function stepToSentence(step) {
  return step.enriched || minimalizeStep(step);
}

/////////////////////////////
// Network & HAR Functions //
/////////////////////////////

function addNetworkEvent(sessionId, net) {
  const s = sessionState.get(sessionId);
  if (!s) return;
  s.network.push({
    ...net,
    id: net.id || uuid(),
    ts: net.ts || Date.now(),
  });
}

function buildHar(session) {
  return {
    log: {
      version: '1.2',
      creator: { name: 'TestSnapper', version: '1.1' },
      entries: (session.network || []).map(n => ({
        startedDateTime: new Date(n.ts || Date.now()).toISOString(),
        time: n.time || 0,
        request: {
          method: n.method || 'GET',
          url: n.url || '',
          httpVersion: 'HTTP/1.1',
          headers: redactHeaders(n.requestHeaders || []),
          queryString: [],
          headersSize: -1,
          bodySize: (n.requestBody || '').length || -1,
        },
        response: {
          status: n.status || 0,
          statusText: n.statusText || '',
          httpVersion: 'HTTP/1.1',
          headers: redactHeaders(n.responseHeaders || []),
          content: { size: (n.responseBody || '').length || 0, mimeType: n.mimeType || '' },
          redirectURL: '',
          headersSize: -1,
          bodySize: (n.responseBody || '').length || -1,
        },
        cache: {},
        timings: { send: 0, wait: n.wait || 0, receive: n.receive || 0 },
        pageref: session.name || `Session ${session.id}`,
      })),
    },
  };
}

function redactHeaders(arr) {
  const SENSITIVE = /(authorization|token|secret|api[-_]?key|cookie|set-cookie)/i;
  return (arr || []).map(h => ({
    name: h.name,
    value: SENSITIVE.test(h.name) ? '***redacted***' : ('' + h.value).slice(0, 200),
  }));
}

async function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({ url, filename, saveAs: true });
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function downloadTxt(filename, text) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  await chrome.downloads.download({ url, filename, saveAs: true });
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/////////////////////////
// Export View Support //
/////////////////////////

function toTxt(session) {
  const lines = [
    `Test Case: ${session.name}`,
    `Date: ${nowIso()}`,
    `Browser: ${session.meta?.browser || 'Chrome'}, OS: ${session.meta?.os || 'Unknown'}`,
    `Steps:`,
    ...session.steps.map((s, i) => `${i + 1}. ${stepToSentence(s)}`),
    ``,
    `Failed Network Calls:`,
    ...(session.network || [])
      .filter(n => (n.status >= 400))
      .map(n => `- ${n.method || 'GET'} ${n.url} [${n.status} ${n.statusText || ''}]`),
  ];
  return lines.join('\n');
}

//////////////////////
// Telemetry Update //
//////////////////////

async function updateTelemetry() {
  let stepsTotal = 0;
  let stepsEnriched = 0;
  let queueLen = 0;
  for (const s of sessionState.values()) {
    stepsTotal += s.steps.length;
    stepsEnriched += s.steps.filter(x => !!x.enriched).length;
  }
  for (const q of pendingQueue.values()) queueLen += q.length;

  const avgLatencyMs = computeAvgLatency();
  await setTelemetry({ stepsTotal, stepsEnriched, avgLatencyMs, queueLen });
}

function computeAvgLatency() {
  let total = 0, count = 0;
  for (const r of pendingReqs.values()) { total += (performance.now() - r.startedAt); count++; }
  return count ? Math.round(total / count) : 0;
}

function sendSafe(sendResponse, payload) {
  try { sendResponse?.(payload); } catch { }
}

async function flushAllBatches(sessionId) {
  // Drain the queue completely
  while (true) {
    const q = pendingQueue.get(sessionId);
    if (!q || q.length === 0) break;
    await flushBatches(sessionId); // existing function
  }
}

/////////////////////////////////////////
// Runtime Messages (Fixed Router)     //
/////////////////////////////////////////

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // console.log('[TestSnapper Background] Received message:', msg?.type, msg);
  
  (async () => {
    try {
      const type = msg?.type;
      // console.log('[TestSnapper Background] Processing message:', type, msg);

      switch (type) {
        case 'REC_START': {
          const sid = coalesceSessionId(msg);
          console.log('[TestSnapper Background] Starting recording for session:', sid);
          
          await startRecording({ sessionId: sid, llm: msg.llm });
          
          console.log('[TestSnapper Background] Sending success response for REC_START');
          sendSafe(sendResponse, { ok: true });
          break;
        }

        case 'REC_STOP': {
          const sid = coalesceSessionId(msg);
          console.log('[TestSnapper Background] Stopping recording for session:', sid);
          
          await stopRecording({ sessionId: sid });
          sendSafe(sendResponse, { ok: true });
          break;
        }

        case 'REC_PAUSE': {
          const sid = coalesceSessionId(msg);
          console.log('[TestSnapper Background] Pausing recording for session:', sid);
          
          try { 
            const tabId = await getActiveTabId(); 
            if (tabId) await chrome.tabs.sendMessage(tabId, { type: 'REC_PAUSE' }); 
          } catch (e) {
            console.warn('[TestSnapper Background] Failed to notify content script:', e);
          }
          
          pauseRecording(sid);
          sendSafe(sendResponse, { ok: true });
          break;
        }

        case 'REC_RESUME': {
          const sid = coalesceSessionId(msg);
          console.log('[TestSnapper Background] Resuming recording for session:', sid);
          
          try { 
            const tabId = await getActiveTabId(); 
            if (tabId) await chrome.tabs.sendMessage(tabId, { type: 'REC_RESUME' }); 
          } catch (e) {
            console.warn('[TestSnapper Background] Failed to notify content script:', e);
          }
          
          resumeRecording(sid);
          sendSafe(sendResponse, { ok: true });
          break;
        }

        case 'REC_EVENT': {
          const sid = coalesceSessionId(msg);
          console.log('[TestSnapper Background] Received step:', sid, msg.step);

          if (!sessionState.has(sid)) {
            console.error('[TestSnapper Background] Session not found:', sid);
            sendSafe(sendResponse, { ok: false, error: 'SESSION_NOT_FOUND' });
          } else {
            enqueueStep(sid, msg.step);
            sendSafe(sendResponse, { ok: true });
          }
          break;
        }

        case 'CAPTURE_SCREENSHOT': {
          const sid = coalesceSessionId(msg);
          const res = await captureAndStoreScreenshot(sid).catch((e) => ({ ok: false, error: String(e?.message || e) }));
          sendSafe(sendResponse, res);
          break;
        }

        case 'NETWORK_EVENT': {
          addNetworkEvent(coalesceSessionId(msg), msg.net); 
          sendSafe(sendResponse, { ok: true });
          break;
        }

        case 'LLM_INIT': {
          await ensureLLMHost();
          sendSafe(sendResponse, { ok: true });
          break;
        }

        case 'GET_STATUS': {
          await updateTelemetry();
          const { [STORAGE_KEYS.TELEMETRY]: tel } = await chrome.storage.local.get(STORAGE_KEYS.TELEMETRY);
          
          let activeSessionId = null;
          let isRecording = false;
          let isPaused = false;
          
          for (const [sid, state] of recordingState.entries()) {
            if (state.recording) {
              activeSessionId = sid;
              isRecording = true;
              isPaused = state.paused || false;
              break;
            }
          }

          sendSafe(sendResponse, {
            ok: true,
            llm: { ready: llmReady, mode: llmMode },
            telemetry: tel || {},
            recording: isRecording,
            paused: isPaused,
            sessionId: activeSessionId,
          });
          break;
        }

        case 'EXPORT_OPEN': {
          const sid = coalesceSessionId(msg);
          await chrome.tabs.create({ url: `assets/html/export_view.html?session=${encodeURIComponent(sid)}` });
          sendSafe(sendResponse, { ok: true });
          break;
        }

        case 'EXPORT_LOAD': {
          const sid = coalesceSessionId(msg);
          const session = await loadSession(sid);
          if (!session) {
            sendSafe(sendResponse, { ok: false, error: 'SESSION_NOT_FOUND' });
          } else {
            sendSafe(sendResponse, { ok: true, session });
          }
          break;
        }

        case 'EXPORT_SAVE': {
          const sid = coalesceSessionId(msg);
          const session = sessionState.get(sid) || await loadSession(sid);
          if (!session) {
            sendSafe(sendResponse, { ok: false, error: 'SESSION_NOT_FOUND' });
          } else {
            if (msg.steps && Array.isArray(msg.steps)) {
              const updates = new Map(msg.steps.map(s => [s.id, s.enriched]));
              session.steps.forEach(step => {
                if (updates.has(step.id)) {
                  step.enriched = updates.get(step.id);
                }
              });
            }
            
            session.updated = Date.now();
            await saveSession(sid, session);
            if (sessionState.has(sid)) {
              sessionState.set(sid, session);
            }
            
            // Update sessions index
            await upsertSessionsIndex({
              id: session.id,
              name: session.name,
              updated: session.updated,
              stepCount: session.steps.length,
              errorCount: (session.network || []).filter(n => n.status >= 400).length
            });
            
            sendSafe(sendResponse, { ok: true });
          }
          break;
        }

        case 'EXPORT_TXT': {
          const sid = coalesceSessionId(msg);
          const session = sessionState.get(sid) || await loadSession(sid);
          if (!session) {
            sendSafe(sendResponse, { ok: false, error: 'SESSION_NOT_FOUND' });
          } else {
            const txt = toTxt(session);
            const filename = `testsnapper_${session.name.replace(/[^a-zA-Z0-9]/g, '_')}.txt`;
            await downloadTxt(filename, txt);
            sendSafe(sendResponse, { ok: true });
          }
          break;
        }

        case 'EXPORT_HAR': {
          const sid = coalesceSessionId(msg);
          const session = sessionState.get(sid) || await loadSession(sid);
          if (!session) {
            sendSafe(sendResponse, { ok: false, error: 'SESSION_NOT_FOUND' });
          } else {
            const har = buildHar(session);
            const filename = `testsnapper_${session.name.replace(/[^a-zA-Z0-9]/g, '_')}.har`;
            await downloadJson(filename, har);
            sendSafe(sendResponse, { ok: true });
          }
          break;
        }

        case 'SET_SETTINGS': {
          const cur = await getSettings();
          const newSettings = { ...cur, ...(msg.settings || {}) };
          await setSettings(newSettings);
          
          // If LLM was just enabled, ensure host is ready
          if (newSettings.llmEnabled && !cur.llmEnabled) {
            try {
              await ensureLLMHost();
            } catch (e) {
              console.warn('[TestSnapper Background] Failed to ensure LLM host:', e);
            }
          }
          
          sendSafe(sendResponse, { ok: true });
          break;
        }

        case 'GET_SETTINGS': {
          const settings = await getSettings();
          sendSafe(sendResponse, { ok: true, settings });
          break;
        }

        case 'LLM_READY': {
          llmReady = true;
          llmMode = msg.mode || 'unknown';
          console.log('[TestSnapper Background] LLM ready:', llmMode);
          
          // Forward to popup/extension pages
          try {
            chrome.runtime.sendMessage(msg).catch(() => {});
          } catch (e) {
            console.warn('[TestSnapper Background] Failed to forward LLM_READY:', e);
          }
          
          sendSafe(sendResponse, { ok: true });
          break;
        }

        case 'LLM_PROGRESS': {
          console.log('[TestSnapper Background] LLM progress:', msg.pct);
          
          // Forward to popup/extension pages  
          try {
            chrome.runtime.sendMessage(msg).catch(() => {});
          } catch (e) {
            console.warn('[TestSnapper Background] Failed to forward LLM_PROGRESS:', e);
          }
          
          sendSafe(sendResponse, { ok: true });
          break;
        }

        case 'LLM_ENRICH_RESULT': {
          const { reqId, results } = msg;
          const req = pendingReqs.get(reqId);
          if (!req) {
            console.warn('[TestSnapper Background] Unknown reqId:', reqId);
            sendSafe(sendResponse, { ok: false, error: 'UNKNOWN_REQ_ID' });
          } else {
            console.log('[TestSnapper Background] Applying enriched results:', results.length);
            pendingReqs.delete(reqId);
            applyEnriched(req.sessionId, results, false);
            await updateTelemetry();
            sendSafe(sendResponse, { ok: true });
          }
          break;
        }

        default: {
          console.error('[TestSnapper Background] Unknown message type:', msg?.type);
          sendSafe(sendResponse, { ok: false, error: 'UNKNOWN_MESSAGE', type: msg?.type });
          break;
        }
      }
      
    } catch (err) {
      console.error('[TestSnapper Background] Message handler error:', err);
      chrome.runtime.sendMessage({ type: 'ERROR', code: 'BG_ERROR', detail: String(err?.message || err) }).catch(() => { });
      sendSafe(sendResponse, { ok: false, error: 'EXCEPTION', detail: String(err?.message || err) });
    }
  })();
  return true; // keep message channel open for async responses
});

/////////////////////////////
// Install/Startup Hooks   //
/////////////////////////////

chrome.runtime.onInstalled.addListener(() => {
  console.log('TestSnapper Background Service Worker initialized');
  chrome.storage.local.get([STORAGE_KEYS.SETTINGS]).then(res => {
    if (!res[STORAGE_KEYS.SETTINGS]) {
      setSettings({ llmEnabled: true, redactionPatterns: [] });
    }
  });
});

// Tidy up tab host on suspend (offscreen is auto-managed by Chrome)
chrome.runtime.onSuspend?.addListener(async () => {
  for (const t of batchTimers.values()) clearTimeout(t);
  batchTimers.clear();
  
  // Clear pending requests to avoid memory leaks
  pendingReqs.clear();
  
  console.log('[TestSnapper Background] Service worker suspending, cleaned up timers');
});