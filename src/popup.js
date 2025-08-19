const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const STORAGE_KEYS = {
  SETTINGS: 'ts.settings',
  SESSIONS_INDEX: 'ts.sessions.index',
  CURRENT_SESSION: 'ts.current.session',
};

// Elements
const llmToggle = $('#llmToggle');
const llmStatus = $('#llmStatus');
const progressSection = $('.ts-progress');
const progressPct = $('#llmProgressPct');
const progressBar = $('#llmProgressBar');

const btnStart = $('#btnStart');
const btnPause = $('#btnPause');
const btnResume = $('#btnResume');
const btnStop = $('#btnStop');
const btnScreenshot = $('#btnScreenshot');
const btnExportCurrent = $('#btnExportCurrent');
const runMeta = $('#runMeta');

const sessionsList = $('#sessionsList');
const tplSessionItem = $('#tplSessionItem');
const btnRefresh = $('#btnRefresh');

const statsEl = $('#stats');

// Enhanced State Management
let curSessionId = null;
let recording = false;
let paused = false;
let llmReady = false;
let llmMode = 'unknown';
let settings = { llmEnabled: true };
let statusPollingInterval = null;
let lastStatusUpdate = 0;

// Configuration
const CONFIG = {
  statusPollInterval: 2000, // Poll every 2 seconds
  maxStatusAge: 10000, // Consider status stale after 10 seconds
  llmInitTimeout: 30000, // 30 second timeout for LLM init
  retryAttempts: 3
};

// Helpers
function uuid() {
  return (crypto?.randomUUID ? crypto.randomUUID() :
    `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`);
}

async function getSettings() {
  const s = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  return s[STORAGE_KEYS.SETTINGS] || { llmEnabled: true };
}

async function setSettings(newSettings) {
  settings = { ...(settings || {}), ...(newSettings || {}) };
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
}

function setStatusChip(stateText, style = 'idle') {
  llmStatus.textContent = stateText;
  llmStatus.className = `ts-chip ts-chip--${style}`;
  llmStatus.setAttribute('aria-live', 'polite');
}

function setProgress(val) {
  const pct = Math.max(0, Math.min(100, Math.round(val)));
  progressPct.textContent = `${pct}%`;
  progressBar.style.width = `${pct}%`;
  
  // Show/hide progress section based on completion
  const isComplete = pct >= 100;
  progressSection.setAttribute('aria-hidden', isComplete ? 'true' : 'false');
  progressSection.style.display = isComplete ? 'none' : 'block';
  
  // Auto-hide after completion with delay
  if (isComplete) {
    setTimeout(() => {
      if (progressBar.style.width === '100%') {
        progressSection.style.display = 'none';
      }
    }, 2000);
  }
}

function setButtons() {
  btnStart.disabled = recording;
  btnPause.disabled = !recording || paused;
  btnResume.disabled = !recording || !paused;
  btnStop.disabled = !recording;
  btnScreenshot.disabled = !recording;
  btnExportCurrent.disabled = !curSessionId;
  
  // Update button text for better UX
  if (recording) {
    btnStart.textContent = 'Recording...';
    btnStart.classList.add('ts-btn--recording');
  } else {
    btnStart.textContent = 'Start';
    btnStart.classList.remove('ts-btn--recording');
  }
}

function updateRunMeta() {
  if (!curSessionId) {
    runMeta.textContent = 'No active session.';
  } else {
    const statusText = recording ? 
      (paused ? 'Paused' : 'Recording') : 
      'Stopped';
    runMeta.textContent = `Session: ${curSessionId.slice(0, 8)}... • ${statusText}`;
  }
}

// Enhanced Status Management with GET_STATUS reliance
async function refreshStatus() {
  try {
    const startTime = performance.now();
    const resp = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    const duration = performance.now() - startTime;
    
    if (!resp?.ok) {
      console.warn('[TestSnapper Popup] GET_STATUS failed:', resp?.error);
      return false;
    }

    // Update LLM state from background truth
    llmReady = !!resp.llm?.ready;
    llmMode = resp.llm?.mode || 'unknown';

    // Sync recording state from background - this is crucial
    const wasRecording = recording;
    const wasPaused = paused;
    const wasSessionId = curSessionId;
    
    recording = !!resp.recording;
    paused = !!resp.paused;
    
    // Update session ID from background state
    if (resp.recording && resp.sessionId) {
      curSessionId = resp.sessionId;
      // Store current session for persistence
      await chrome.storage.local.set({ [STORAGE_KEYS.CURRENT_SESSION]: resp.sessionId });
    } else if (!resp.recording) {
      // Clear stored session if not recording
      if (curSessionId) {
        await chrome.storage.local.remove(STORAGE_KEYS.CURRENT_SESSION);
      }
      curSessionId = null;
    }

    // Log state changes for debugging
    if (wasRecording !== recording || wasPaused !== paused || wasSessionId !== curSessionId) {
      console.log('[TestSnapper Popup] State sync from background:', {
        recording: { was: wasRecording, now: recording },
        paused: { was: wasPaused, now: paused },
        session: { was: wasSessionId, now: curSessionId }
      });
    }

    // Update telemetry display
    const tel = resp.telemetry || {};
    statsEl.textContent = `Steps: ${tel.stepsTotal || 0} • Enriched: ${tel.stepsEnriched || 0} • Queue: ${tel.queueLen || 0} • Mode: ${llmMode}`;

    // Update LLM status chip based on current state
    updateLLMStatusDisplay();

    lastStatusUpdate = Date.now();
    return true;
    
  } catch (error) {
    console.error('[TestSnapper Popup] refreshStatus error:', error);
    
    // Show connection error in status
    if (error.message && error.message.includes('Receiving end does not exist')) {
      setStatusChip('Disconnected', 'error');
      statsEl.textContent = 'Extension disconnected - please refresh';
    }
    
    return false;
  }
}

function updateLLMStatusDisplay() {
  if (!settings.llmEnabled) {
    setStatusChip('Disabled', 'idle');
    setProgress(100);
    return;
  }

  // Priority: degraded mode overrides everything
  if (llmMode === 'unavailable' || llmMode === 'degraded') {
    setStatusChip('Degraded', 'degraded');
    setProgress(100);
    return;
  }

  // Normal operation modes
  if (llmReady) {
    const modeText = llmMode === 'webgpu' ? 'Ready (GPU)' : 
                     llmMode === 'wasm' ? 'Ready (WASM)' : 
                     'Ready';
    setStatusChip(modeText, 'ready');
    setProgress(100);
  } else if (settings.llmEnabled) {
    setStatusChip('Loading...', 'loading');
    // Don't reset progress here - let it be driven by LLM_PROGRESS messages
  } else {
    setStatusChip('Idle', 'idle');
    setProgress(100);
  }
}

async function refreshSessions() {
  try {
    const s = await chrome.storage.local.get(STORAGE_KEYS.SESSIONS_INDEX);
    const idx = Array.isArray(s[STORAGE_KEYS.SESSIONS_INDEX]) ? s[STORAGE_KEYS.SESSIONS_INDEX] : [];
    
    sessionsList.innerHTML = '';
    
    // Sort sessions by update time (most recent first)
    const sortedSessions = idx.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    
    sortedSessions.forEach(meta => {
      const li = tplSessionItem.content.firstElementChild.cloneNode(true);
      li.dataset.id = meta.id;
      
      $('.ts-session__name', li).textContent = meta.name || `Session ${meta.id.slice(0, 8)}`;
      
      const when = meta.updated ? new Date(meta.updated).toLocaleString() : 'Unknown';
      const stepCount = meta.stepCount ?? 0;
      const errorCount = meta.errorCount ?? 0;
      
      $('.ts-session__meta', li).textContent = `${when} • Steps: ${stepCount} • Errors: ${errorCount}`;

      // Highlight active session
      if (meta.id === curSessionId) {
        li.classList.add('ts-session--active');
      }

      li.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        
        const action = btn.getAttribute('data-action');
        const id = li.dataset.id;
        
        handleSessionAction(action, id);
      });

      sessionsList.appendChild(li);
    });
    
  } catch (error) {
    console.error('[TestSnapper Popup] refreshSessions error:', error);
  }
}

async function handleSessionAction(action, sessionId) {
  try {
    switch (action) {
      case 'open':
      case 'export':
        await chrome.runtime.sendMessage({ type: 'EXPORT_OPEN', sessionId });
        break;
        
      case 'delete':
        if (confirm('Delete this session? This cannot be undone.')) {
          await deleteSession(sessionId);
        }
        break;
        
      default:
        console.warn('[TestSnapper Popup] Unknown session action:', action);
    }
  } catch (error) {
    console.error('[TestSnapper Popup] Session action error:', error);
  }
}

async function deleteSession(id) {
  try {
    // Remove from index
    const s = await chrome.storage.local.get(STORAGE_KEYS.SESSIONS_INDEX);
    const idx = Array.isArray(s[STORAGE_KEYS.SESSIONS_INDEX]) ? s[STORAGE_KEYS.SESSIONS_INDEX] : [];
    const filtered = idx.filter(x => x.id !== id);
    
    await chrome.storage.local.set({ [STORAGE_KEYS.SESSIONS_INDEX]: filtered });
    await chrome.storage.local.remove(`ts.session.${id}`);
    
    // Clear current session if it's the one being deleted
    if (curSessionId === id) {
      curSessionId = null;
      await chrome.storage.local.remove(STORAGE_KEYS.CURRENT_SESSION);
    }
    
    await refreshSessions();
    setButtons();
    updateRunMeta();
    
  } catch (error) {
    console.error('[TestSnapper Popup] Delete session error:', error);
  }
}

// Enhanced LLM Toggle with proper host initialization
async function onToggleLLM() {
  try {
    const wasEnabled = settings.llmEnabled;
    const nowEnabled = llmToggle.checked;
    
    console.log('[TestSnapper Popup] LLM toggle:', { wasEnabled, nowEnabled });
    
    // Update settings first
    await setSettings({ llmEnabled: nowEnabled });
    
    if (nowEnabled && !wasEnabled) {
      // Enabling LLM: ensure host exists first, then initialize
      setStatusChip('Initializing...', 'loading');
      setProgress(0);
      
      try {
        // Background will ensure host creation when settings change
        const settingsResp = await chrome.runtime.sendMessage({ 
          type: 'SET_SETTINGS', 
          settings: { llmEnabled: true }
        });
        
        if (!settingsResp?.ok) {
          throw new Error('Failed to update settings');
        }
        
        console.log('[TestSnapper Popup] Settings updated, initializing LLM...');
        
        // Now initialize LLM (background should have ensured host exists)
        const initResp = await Promise.race([
          chrome.runtime.sendMessage({ type: 'LLM_INIT' }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('LLM_INIT timeout')), CONFIG.llmInitTimeout)
          )
        ]);
        
        if (!initResp?.ok) {
          throw new Error(initResp?.error || 'LLM_INIT failed');
        }
        
        console.log('[TestSnapper Popup] LLM initialization started successfully');
        
      } catch (error) {
        console.error('[TestSnapper Popup] LLM enable error:', error);
        
        // Reset toggle and show error
        llmToggle.checked = false;
        await setSettings({ llmEnabled: false });
        setStatusChip('Failed', 'error');
        
        // Show user-friendly error
        setTimeout(() => {
          if (!llmReady) {
            setStatusChip('Disabled', 'idle');
          }
        }, 3000);
        
        return;
      }
      
    } else if (!nowEnabled && wasEnabled) {
      // Disabling LLM
      await chrome.runtime.sendMessage({ 
        type: 'SET_SETTINGS', 
        settings: { llmEnabled: false }
      });
      
      llmReady = false;
      llmMode = 'disabled';
      setStatusChip('Disabled', 'idle');
      setProgress(100);
      
      console.log('[TestSnapper Popup] LLM disabled');
    }
    
    // Refresh status to sync with background
    await refreshStatus();
    
  } catch (error) {
    console.error('[TestSnapper Popup] LLM toggle error:', error);
    
    // Reset toggle on error
    llmToggle.checked = settings.llmEnabled;
    setStatusChip('Error', 'error');
  }
}

// Enhanced Recording Controls
async function onStart() {
  if (recording) {
    console.warn('[TestSnapper Popup] Already recording, ignoring start');
    return;
  }

  const newSessionId = uuid();
  console.log('[TestSnapper Popup] Starting recording:', newSessionId);

  try {
    // Disable start button immediately for better UX
    btnStart.disabled = true;
    btnStart.textContent = 'Starting...';
    
    const response = await chrome.runtime.sendMessage({
      type: 'REC_START',
      sessionId: newSessionId,
      llm: llmToggle.checked
    });

    console.log('[TestSnapper Popup] Start response:', response);

    if (response?.ok) {
      // Don't set local state - let refreshStatus() sync from background
      console.log('[TestSnapper Popup] Recording start successful, syncing state...');
      
      // Immediate status refresh to sync state
      await refreshStatus();
      await refreshSessions();
      
    } else {
      throw new Error(response?.error || 'Start request failed');
    }
    
  } catch (error) {
    console.error('[TestSnapper Popup] Start error:', error);
    
    // Reset button state on error
    btnStart.disabled = false;
    btnStart.textContent = 'Start';
    
    // Show error to user
    runMeta.textContent = `Start failed: ${error.message}`;
    
    if (error.message?.includes('Receiving end does not exist')) {
      runMeta.textContent = 'Extension disconnected - please refresh the page';
    }
  }
}

async function onPause() {
  if (!recording || paused) return;
  
  try {
    await chrome.runtime.sendMessage({ type: 'REC_PAUSE', sessionId: curSessionId });
    // Let refreshStatus sync the state
    await refreshStatus();
  } catch (error) {
    console.error('[TestSnapper Popup] Pause error:', error);
  }
}

async function onResume() {
  if (!recording || !paused) return;
  
  try {
    await chrome.runtime.sendMessage({ type: 'REC_RESUME', sessionId: curSessionId });
    // Let refreshStatus sync the state
    await refreshStatus();
  } catch (error) {
    console.error('[TestSnapper Popup] Resume error:', error);
  }
}

async function onStop() {
  if (!recording) return;
  
  try {
    btnStop.disabled = true;
    btnStop.textContent = 'Stopping...';
    
    await chrome.runtime.sendMessage({ type: 'REC_STOP', sessionId: curSessionId });
    
    // Let refreshStatus sync the state
    await refreshStatus();
    await refreshSessions();
    
  } catch (error) {
    console.error('[TestSnapper Popup] Stop error:', error);
  } finally {
    // Reset button text
    setTimeout(() => {
      btnStop.textContent = 'Stop';
    }, 1000);
  }
}

async function onScreenshot() {
  if (!recording) return;
  
  try {
    btnScreenshot.disabled = true;
    btnScreenshot.textContent = 'Capturing...';
    
    await chrome.runtime.sendMessage({ 
      type: 'CAPTURE_SCREENSHOT', 
      sessionId: curSessionId 
    });
    
    console.log('[TestSnapper Popup] Screenshot captured');
    
    setTimeout(() => {
      btnScreenshot.textContent = 'Screenshot';
      btnScreenshot.disabled = !recording;
    }, 1000);
    
  } catch (error) {
    console.error('[TestSnapper Popup] Screenshot error:', error);
    btnScreenshot.textContent = 'Screenshot';
    btnScreenshot.disabled = !recording;
  }
}

async function onExportCurrent() {
  if (!curSessionId) return;
  
  try {
    await chrome.runtime.sendMessage({ type: 'EXPORT_OPEN', sessionId: curSessionId });
  } catch (error) {
    console.error('[TestSnapper Popup] Export error:', error);
  }
}

// Enhanced Message Handling
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log('[TestSnapper Popup] Received message:', msg?.type);
  
  try {
    switch (msg?.type) {
      case 'LLM_PROGRESS':
        if (typeof msg.pct === 'number') {
          setProgress(msg.pct);
          
          // Update status during loading
          if (msg.pct < 100 && settings.llmEnabled) {
            setStatusChip('Loading...', 'loading');
          }
          
          console.log(`[TestSnapper Popup] LLM progress: ${msg.pct}%`);
        }
        break;
        
      case 'LLM_READY':
        llmReady = true;
        llmMode = msg.mode || 'unknown';
        
        console.log('[TestSnapper Popup] LLM ready:', llmMode);
        
        // Update display based on mode
        updateLLMStatusDisplay();
        
        // Refresh overall status
        refreshStatus();
        break;
        
      case 'ERROR':
        console.error('[TestSnapper Popup] Background error:', msg);
        
        if (msg.code === 'LLM_ERROR' || msg.detail?.includes('LLM')) {
          setStatusChip('Error', 'error');
          setTimeout(() => {
            if (settings.llmEnabled) {
              setStatusChip('Degraded', 'degraded');
            } else {
              setStatusChip('Idle', 'idle');
            }
          }, 3000);
        }
        break;
        
      default:
        // Handle other message types if needed
        break;
    }
  } catch (error) {
    console.error('[TestSnapper Popup] Message handler error:', error);
  }
  
  // Don't send response unless specifically needed
  return false;
});

// Enhanced Status Polling
function startStatusPolling() {
  // Clear existing interval
  if (statusPollingInterval) {
    clearInterval(statusPollingInterval);
  }
  
  // Start polling
  statusPollingInterval = setInterval(async () => {
    try {
      const now = Date.now();
      
      // Skip if we just updated recently (avoid spam)
      if (now - lastStatusUpdate < CONFIG.statusPollInterval / 2) {
        return;
      }
      
      const success = await refreshStatus();
      
      if (success) {
        // Update UI elements that depend on status
        setButtons();
        updateRunMeta();
      } else {
        // Handle polling failure
        const statusAge = now - lastStatusUpdate;
        if (statusAge > CONFIG.maxStatusAge) {
          console.warn('[TestSnapper Popup] Status polling has been failing, showing disconnected state');
          setStatusChip('Disconnected', 'error');
          statsEl.textContent = 'Connection lost - please refresh';
        }
      }
      
    } catch (error) {
      console.error('[TestSnapper Popup] Status polling error:', error);
    }
  }, CONFIG.statusPollInterval);
  
  console.log('[TestSnapper Popup] Started status polling');
}

function stopStatusPolling() {
  if (statusPollingInterval) {
    clearInterval(statusPollingInterval);
    statusPollingInterval = null;
    console.log('[TestSnapper Popup] Stopped status polling');
  }
}

// Enhanced Initialization
async function initializeRecordingState() {
  try {
    // Primary: get status from background (source of truth)
    const resp = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    
    if (resp?.ok) {
      if (resp.recording && resp.sessionId) {
        recording = true;
        paused = resp.paused || false;
        curSessionId = resp.sessionId;
        
        console.log('[TestSnapper Popup] Synced recording state from background:', {
          recording, paused, sessionId: curSessionId
        });
      } else {
        // No active recording in background
        recording = false;
        paused = false;
        curSessionId = null;
        
        // Clear any stale session in storage
        const stored = await chrome.storage.local.get(STORAGE_KEYS.CURRENT_SESSION);
        if (stored[STORAGE_KEYS.CURRENT_SESSION]) {
          await chrome.storage.local.remove(STORAGE_KEYS.CURRENT_SESSION);
          console.log('[TestSnapper Popup] Cleared stale session from storage');
        }
      }
    } else {
      console.warn('[TestSnapper Popup] Failed to get status from background:', resp?.error);
      
      // Fallback: check stored session (secondary source)
      const stored = await chrome.storage.local.get(STORAGE_KEYS.CURRENT_SESSION);
      if (stored[STORAGE_KEYS.CURRENT_SESSION]) {
        curSessionId = stored[STORAGE_KEYS.CURRENT_SESSION];
        console.log('[TestSnapper Popup] Found stored session (fallback):', curSessionId);
      }
    }
    
  } catch (error) {
    console.error('[TestSnapper Popup] Failed to initialize recording state:', error);
    
    // Final fallback: assume clean state
    recording = false;
    paused = false;
    curSessionId = null;
  }
}

// Enhanced Initialization
async function init() {
  console.log('[TestSnapper Popup] Initializing...');
  
  try {
    // Load settings
    settings = await getSettings();
    llmToggle.checked = !!settings.llmEnabled;
    
    console.log('[TestSnapper Popup] Settings loaded:', settings);
    
    // Initialize recording state from background (source of truth)
    await initializeRecordingState();
    
    // Start status polling for continuous sync
    startStatusPolling();
    
    // Initial status refresh and UI update
    await refreshStatus();
    
    // Initialize LLM if enabled
    if (settings.llmEnabled) {
      setStatusChip('Loading...', 'loading');
      setProgress(0);
      
      // Background should auto-initialize, but trigger explicitly
      chrome.runtime.sendMessage({ type: 'LLM_INIT' })
        .then(response => {
          if (!response?.ok) {
            console.warn('[TestSnapper Popup] LLM_INIT warning:', response?.error);
          }
        })
        .catch(error => {
          console.error('[TestSnapper Popup] LLM_INIT failed:', error);
          setStatusChip('Failed', 'error');
        });
    } else {
      setStatusChip('Disabled', 'idle');
      setProgress(100);
    }
    
    // Wire up UI events
    llmToggle.addEventListener('change', onToggleLLM);
    btnStart.addEventListener('click', onStart);
    btnPause.addEventListener('click', onPause);
    btnResume.addEventListener('click', onResume);
    btnStop.addEventListener('click', onStop);
    btnScreenshot.addEventListener('click', onScreenshot);
    btnExportCurrent.addEventListener('click', onExportCurrent);
    
    btnRefresh.addEventListener('click', async () => {
      await refreshSessions();
      await refreshStatus();
    });
    
    // Initial UI state update
    setButtons();
    updateRunMeta();
    
    // Load sessions
    await refreshSessions();
    
    console.log('[TestSnapper Popup] Initialization complete');
    
  } catch (error) {
    console.error('[TestSnapper Popup] Initialization error:', error);
    
    // Show error state
    setStatusChip('Error', 'error');
    statsEl.textContent = 'Initialization failed';
  }
}

// Cleanup on unload
window.addEventListener('beforeunload', () => {
  stopStatusPolling();
});

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Debug helpers
window.TestSnapperPopup = {
  refreshStatus,
  refreshSessions,
  getState: () => ({
    recording,
    paused,
    curSessionId,
    llmReady,
    llmMode,
    settings
  })
};