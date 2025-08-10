// content.js — Full, Fixed & Enhanced (addresses issues #17–#21)
// - [17] Properly awaits getLastMeaningfulInteraction via Promise wrapper
// - [18] Debounce delay always synced with settings updates (and pending timers reconciled)
// - [19] API failure handling includes statusCode=0 for true network errors (fetch/xhr)
// - [20] Prevents memory leaks in inputDebounceTimers (clears on pause/stop/visibility/unload)
// - [21] Adds temporary redaction overlays for sensitive elements before screenshots
//
// Drop-in replacement. Keeps your original features (click/input/scroll/SPA/url/form, errors, network,
// pause/resume semantics, auto/ manual screenshots). Works with the updated background.js.

// ==============================
// Utilities
// ==============================
const now = () => Date.now();

const REDACTION_DEFAULT_PATTERN = /password|secret|token|api[_-]?key/i;

function toSelector(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';
  if (el.id) return `#${el.id}`;
  if (typeof el.className === 'string' && el.className.trim()) {
    const classes = el.className.trim().split(/\s+/).filter(Boolean);
    if (classes.length) {
      const sel = `${el.tagName.toLowerCase()}.${classes.join('.')}`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }
  }
  for (const a of el.attributes || []) {
    if (a.name.startsWith('data-') && a.value) {
      const sel = `${el.tagName.toLowerCase()}[${a.name}="${CSS.escape(a.value)}"]`;
      if (document.querySelectorAll(sel).length === 1) return sel;
    }
  }
  const path = [];
  let cur = el;
  while (cur && cur.nodeType === 1 && cur !== document.body) {
    let seg = cur.tagName.toLowerCase();
    if (cur.id) {
      seg += `#${cur.id}`;
      path.unshift(seg);
      break;
    }
    const siblings = Array.from(cur.parentNode?.children || []);
    const same = siblings.filter(s => s.tagName === cur.tagName);
    if (same.length > 1) seg += `:nth-of-type(${same.indexOf(cur) + 1})`;
    path.unshift(seg);
    cur = cur.parentElement;
  }
  return path.join(' > ');
}

function elementAttrs(el) {
  const out = {};
  const keys = ['id', 'class', 'name', 'type', 'value', 'href', 'src', 'alt', 'title', 'placeholder'];
  keys.forEach(k => {
    if (el.hasAttribute?.(k)) out[k] = el.getAttribute(k);
  });
  return out;
}

function sanitizeValue(v) {
  if (!v) return '';
  if (typeof v !== 'string') return v;
  if (REDACTION_DEFAULT_PATTERN.test(v)) return '[REDACTED]';
  return v.length > 500 ? v.slice(0, 500) + '...' : v;
}

function promiseSendMessage(payload) {
  return new Promise(resolve => chrome.runtime.sendMessage(payload, resolve));
}

// ==============================
// Recorder
// ==============================
class TestSnapperRecorder {
  constructor() {
    this.isRecording = false;
    this.isPaused = false;

    this.recordingStartTime = null;
    this.pauseStartTime = null;
    this.totalPausedTime = 0;

    // listeners registry: Set<{el,type,handler,opts}>
    this._listeners = new Set();

    // Debounce map for inputs
    this.inputDebounceTimers = new Map();
    this.inputDebounceDelay = 2000;

    // Track last values per elementKey
    this.lastInputValues = new Map();

    // Settings cache
    this.settings = {
      autoScreenshot: true,
      inputTimeFrame: 2000,
      screenshotQuality: 'medium',
      redactionPatterns: 'password,secret,token,api_key',
      darkMode: false,
      sessionRetentionDays: 2
    };

    // State for “last meaningful step”
    this.lastInteractionId = null;

    // For periodic cleanup
    this.cleanupIntervalMs = 6 * 60 * 60 * 1000;
    this.cleanupTimer = null;

    // Redaction overlay bookkeeping
    this._redactionOverlays = [];

    // Original history funcs
    this._origPush = null;
    this._origReplace = null;

    this.init();
  }

  // Add near top-level (inside class)
  injectAdvancedRecorder() {
    try {
      // Avoid double-inject
      if (document.documentElement.hasAttribute('data-testsnapper-injected')) return;
      document.documentElement.setAttribute('data-testsnapper-injected', '1');

      const url = chrome.runtime.getURL('src/injected.js');
      const s = document.createElement('script');
      s.src = url;
      s.async = false;
      // Ensure it runs early enough and then remove
      s.onload = () => s.remove();
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {
      console.warn('Failed to inject advanced recorder:', e);
    }
  }


  // ==========================
  // Init & Settings
  // ==========================
  async init() {
    await this._loadSettings();

    // Add listeners *before* injecting advanced recorder
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      this._handleMessage(msg, sendResponse);
      return true; // keep channel open for async
    });

    window.addEventListener('message', (e) => {
      if (e.source !== window) return;
      const data = e.data;
      if (!data || data.source !== 'testsnapper-injected') return;
      this._handleInjected(data);
    });

    // Now inject the advanced recorder
    this.injectAdvancedRecorder();

    // Optionally, push a status snapshot...
    window.postMessage({

      source: 'testsnapper-content',
      type: 'RECORDING_STATUS_SNAPSHOT',
      data: {
        isRecording: this.isRecording,
        isPaused: this.isPaused,
        startTime: this.recordingStartTime,
        totalPausedTime: this.totalPausedTime
      }
    }, '*');


    // Initial cleanup ping
    this._autoCleanupSessions();

    // Periodic cleanup
    this.cleanupTimer = setInterval(() => this._autoCleanupSessions(), this.cleanupIntervalMs);

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      this._handleMessage(msg, sendResponse);
      return true;
    });

    // Adopt current status
    chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATUS' }, (res) => {
      if (!res) return;
      this.isRecording = !!res.isRecording;
      this.isPaused = !!res.isPaused;
      this.recordingStartTime = res.startTime || now();
      this.totalPausedTime = res.totalPausedTime || 0;

      // Always attach listeners so manual features work even while paused
      this._addEventListeners();

      if (this.isRecording && !this.isPaused) {
        this._recordSessionStart();
        this._injectNetworkInterceptor();
      }
    });

    // Bridge from injected script
    window.addEventListener('message', (e) => {
      if (e.source !== window) return;
      const data = e.data;
      if (!data || data.source !== 'testsnapper-injected') return;
      this._handleInjected(data);
    });

    // Memory leak guards
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this._clearAllDebounceTimers();
      }
    });
    window.addEventListener('beforeunload', () => {
      this._clearAllDebounceTimers();
      if (this.cleanupTimer) {
        clearInterval(this.cleanupTimer);
        this.cleanupTimer = null;
      }
    });

  }

  async _loadSettings() {
    try {
      const res = await promiseSendMessage({ type: 'GET_SETTINGS' });
      if (res && res.settings) this.settings = { ...this.settings, ...res.settings };
    } catch { }
    this._syncDebounceFromSettings(); // [18]
  }

  _syncDebounceFromSettings() {
    const delay = Number(this.settings.inputTimeFrame);
    this.inputDebounceDelay = Number.isFinite(delay) ? Math.max(0, delay) : 2000;
  }

  _autoCleanupSessions() {
    const days = this.settings.sessionRetentionDays || 2;
    const cutoff = now() - days * 24 * 60 * 60 * 1000;
    chrome.runtime.sendMessage({ type: 'CLEANUP_OLD_SESSIONS', cutoffTime: cutoff }, () => { });
  }

  // ==========================
  // Message Handling
  // ==========================
  _handleMessage(message, sendResponse) {
    const type = message?.type;
    switch (type) {
      case 'START_UI_RECORDING':
        this.start();
        sendResponse?.({ success: true });
        break;
      case 'PAUSE_UI_RECORDING':
        this.pause();
        sendResponse?.({ success: true });
        break;
      case 'RESUME_UI_RECORDING':
        this.resume();
        sendResponse?.({ success: true });
        break;
      case 'STOP_UI_RECORDING':
        this.stop();
        sendResponse?.({ success: true });
        break;
      case 'UPDATE_SETTINGS':
        this.settings = { ...this.settings, ...(message.settings || {}) };
        this._syncDebounceFromSettings();       // [18] keep in sync
        this._reconcileDebounceTimers();        // [18][20] make timers aware of new delay
        sendResponse?.({ success: true });
        break;
      case 'GET_PAUSE_STATUS':
        sendResponse?.({
          isPaused: this.isPaused,
          isRecording: this.isRecording,
          totalPausedTime: this.totalPausedTime
        });
        break;
      case 'FORCE_SCREENSHOT':
        this._manualScreenshotWithRedaction();  // [21]
        sendResponse?.({ success: true });
        break;
      case 'CLEANUP_SESSIONS':
        this._autoCleanupSessions();
        sendResponse?.({ success: true });
        break;
      default:
        break;
    }
  }

  // ==========================
  // Injected Bridge
  // ==========================
  _handleInjected(msg) {
    if (!this.isRecording) return;

    switch (msg.type) {
      case 'NETWORK_CALL':
        // Successful call — we don’t push as failure
        // (Optionally store if you need a full network timeline)
        break;

      case 'NETWORK_ERROR': {
        // [19] Ensure we preserve a status code (0 = real network error)
        const data = msg.data || {};
        const failure = {
          type: 'api_failure',
          url: String(data.url || ''),
          method: data.method || 'GET',
          status: typeof data.status === 'number' ? data.status : 0,
          statusText: data.statusText || '',
          error: data.error || 'Network Error',
          startTime: data.startTime,
          endTime: data.endTime,
          timestamp: now(),
          relativeTime: this._activeTime(),
          relatedInteractionId: this.lastInteractionId
        };
        this._recordInteraction(failure, /*suppressAutoShot=*/true);
        break;
      }

      case 'JAVASCRIPT_ERROR': {
        const d = msg.data || {};
        const jsErr = {
          type: 'javascript_error',
          message: d.message,
          source: d.source,
          line: d.line,
          column: d.column,
          stack: d.stack,
          timestamp: now(),
          relativeTime: this._activeTime(),
          relatedInteractionId: this.lastInteractionId
        };
        this._recordInteraction(jsErr, /*suppressAutoShot=*/true);
        break;
      }
    }
  }

  // ==========================
  // Lifecycle
  // ==========================
  start() {
    if (this.isRecording && !this.isPaused) return;
    this.isRecording = true;
    this.isPaused = false;
    if (!this.recordingStartTime) this.recordingStartTime = now();

    this._addEventListeners();
    this._injectNetworkInterceptor();
    this._recordSessionStart();
  }

  pause() {
    if (!this.isRecording || this.isPaused) return;
    this.isPaused = true;
    this.pauseStartTime = now();

    this._clearAllDebounceTimers();             // [20]

    const ev = {
      type: 'session_pause',
      timestamp: this.pauseStartTime,
      activeTime: this._activeTime()
    };
    this._recordInteraction(ev, /*suppressAutoShot=*/true);
  }

  resume() {
    if (!this.isRecording || !this.isPaused) return;
    const resumedAt = now();
    this.totalPausedTime += resumedAt - (this.pauseStartTime || resumedAt);
    this.pauseStartTime = null;
    this.isPaused = false;

    const ev = {
      type: 'session_resume',
      timestamp: resumedAt,
      pausedDuration: this.totalPausedTime,
      totalPausedTime: this.totalPausedTime,
      activeTime: this._activeTime()
    };
    this._recordInteraction(ev, /*suppressAutoShot=*/true);
  }

  stop() {
    if (!this.isRecording && this._listeners.size === 0) return;

    this._clearAllDebounceTimers();            // [20]

    if (this.isPaused && this.pauseStartTime) {
      this.totalPausedTime += now() - this.pauseStartTime;
    }

    const endAt = now();
    const ev = {
      type: 'session_end',
      timestamp: endAt,
      totalDuration: endAt - (this.recordingStartTime || endAt),
      activeDuration: this._activeTime(),
      totalPausedTime: this.totalPausedTime
    };
    this._recordInteraction(ev, /*suppressAutoShot=*/true);

    // Remove listeners
    for (const item of this._listeners) {
      item.el.removeEventListener(item.type, item.handler, item.opts || true);
    }
    this._listeners.clear();

    // Restore history
    if (this._origPush) history.pushState = this._origPush;
    if (this._origReplace) history.replaceState = this._origReplace;
    this._origPush = this._origReplace = null;

    // Reset state
    this.isRecording = false;
    this.isPaused = false;
    this.recordingStartTime = null;
    this.pauseStartTime = null;
    this.totalPausedTime = 0;
    this.lastInputValues.clear();
    this.lastInteractionId = null;
  }

  // ==========================
  // Listeners
  // ==========================
  _addEventListeners() {
    // Click
    const clickHandler = (e) => {
      if (!this.isRecording || this.isPaused) return;
      const el = e.target;
      const selector = toSelector(el);

      // Skip clicks on text/email/password inputs while typing
      if (['INPUT', 'TEXTAREA'].includes(el.tagName) &&
        ['text', 'email', 'password', 'search', 'url'].includes(el.type)) {
        return;
      }

      const interaction = {
        type: 'click',
        selector,
        tagName: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().slice(0, 100),
        coordinates: { x: e.clientX, y: e.clientY },
        attributes: elementAttrs(el),
        timestamp: now(),
        relativeTime: this._activeTime()
      };

      this._recordInteraction(interaction);
    };
    document.addEventListener('click', clickHandler, true);
    this._storeListener(document, 'click', clickHandler);

    // Inputs (input/change/blur) with debounce
    const inputHandler = (e) => {
      if (!this.isRecording || this.isPaused) return;
      const el = e.target;
      if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;

      const selector = toSelector(el);
      const key = `${selector}_${el.tagName}`;
      const prevTimer = this.inputDebounceTimers.get(key);
      if (prevTimer) clearTimeout(prevTimer);

      const timer = setTimeout(() => {
        this._recordInput(el, 'input');
        this.inputDebounceTimers.delete(key);
      }, this.inputDebounceDelay);
      this.inputDebounceTimers.set(key, timer);
    };
    const changeHandler = (e) => {
      if (!this.isRecording || this.isPaused) return;
      const el = e.target;
      if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      const selector = toSelector(el);
      const key = `${selector}_${el.tagName}`;
      const t = this.inputDebounceTimers.get(key);
      if (t) { clearTimeout(t); this.inputDebounceTimers.delete(key); }
      this._recordInput(el, 'change');
    };
    const blurHandler = (e) => {
      if (!this.isRecording || this.isPaused) return;
      const el = e.target;
      if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return;
      const selector = toSelector(el);
      const key = `${selector}_${el.tagName}`;
      const t = this.inputDebounceTimers.get(key);
      if (t) { clearTimeout(t); this.inputDebounceTimers.delete(key); }
      this._recordInput(el, 'blur');
    };

    document.addEventListener('input', inputHandler, true);
    document.addEventListener('change', changeHandler, true);
    document.addEventListener('blur', blurHandler, true);
    this._storeListener(document, 'input', inputHandler);
    this._storeListener(document, 'change', changeHandler);
    this._storeListener(document, 'blur', blurHandler);

    // Form submit
    const submitHandler = (e) => {
      if (!this.isRecording || this.isPaused) return;
      const form = e.target;
      if (form.tagName !== 'FORM') return;

      const selector = toSelector(form);
      const fd = new FormData(form);
      const values = {};
      for (const [k, v] of fd.entries()) {
        values[k] = REDACTION_DEFAULT_PATTERN.test(k) ? '[REDACTED]' : sanitizeValue(v);
      }

      const interaction = {
        type: 'form_submit',
        selector,
        action: form.action || location.href,
        method: form.method || 'GET',
        formData: values,
        timestamp: now(),
        relativeTime: this._activeTime()
      };
      this._recordInteraction(interaction);
    };
    document.addEventListener('submit', submitHandler, true);
    this._storeListener(document, 'submit', submitHandler);

    // SPA + navigation
    let currentUrl = location.href;
    const urlChange = () => {
      if (!this.isRecording || this.isPaused) return;
      const newUrl = location.href;
      if (newUrl === currentUrl) return;

      const ev = {
        type: 'url_change',
        from: currentUrl,
        to: newUrl,
        timestamp: now(),
        relativeTime: this._activeTime()
      };
      this._recordInteraction(ev, /*auto*/ true, /*delayMs*/ 500);
      currentUrl = newUrl;
    };
    this._origPush = history.pushState;
    this._origReplace = history.replaceState;
    const self = this;
    history.pushState = function (...args) {
      self._origPush.apply(history, args);
      setTimeout(urlChange, 0);
    };
    history.replaceState = function (...args) {
      self._origReplace.apply(history, args);
      setTimeout(urlChange, 0);
    };
    const beforeUnload = () => {
      if (!this.isRecording || this.isPaused) return;
      const ev = {
        type: 'navigation',
        from: location.href,
        timestamp: now(),
        relativeTime: this._activeTime()
      };
      this._recordInteraction(ev, /*suppressAutoShot=*/true);
    };
    window.addEventListener('popstate', urlChange);
    window.addEventListener('beforeunload', beforeUnload);
    this._storeListener(window, 'popstate', urlChange);
    this._storeListener(window, 'beforeunload', beforeUnload);

    // Scroll (throttled via timeout)
    let scrollT = null;
    let lastY = window.scrollY;
    const scrollHandler = () => {
      if (!this.isRecording || this.isPaused) return;
      clearTimeout(scrollT);
      scrollT = setTimeout(() => {
        const y = window.scrollY;
        const delta = Math.abs(y - lastY);
        if (delta > 100) {
          const ev = {
            type: 'scroll',
            scrollX: window.scrollX,
            scrollY: y,
            scrollDelta: delta,
            documentHeight: document.documentElement.scrollHeight,
            viewportHeight: window.innerHeight,
            timestamp: now(),
            relativeTime: this._activeTime()
          };
          this._recordInteraction(ev, /*suppressAutoShot=*/true);
          lastY = y;
        }
      }, 500);
    };
    window.addEventListener('scroll', scrollHandler);
    this._storeListener(window, 'scroll', scrollHandler);

    // Keypress (important keys or modifiers)
    const keyHandler = (e) => {
      if (!this.isRecording || this.isPaused) return;
      const important = [
        'Enter', 'Tab', 'Escape', 'Backspace', 'Delete',
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
        'Home', 'End', 'PageUp', 'PageDown'
      ];
      const modCombo = (e.ctrlKey || e.altKey || e.metaKey) && !['Control', 'Alt', 'Meta'].includes(e.key);
      if (!important.includes(e.key) && !modCombo) return;

      const ev = {
        type: 'keypress',
        key: e.key,
        code: e.code,
        ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, metaKey: e.metaKey,
        target: toSelector(e.target),
        timestamp: now(),
        relativeTime: this._activeTime()
      };
      this._recordInteraction(ev, /*suppressAutoShot=*/true);
    };
    document.addEventListener('keydown', keyHandler, true);
    this._storeListener(document, 'keydown', keyHandler);
  }

  _storeListener(el, type, handler, opts) {
    this._listeners.add({ el, type, handler, opts });
  }

  // ==========================
  // Recording helpers
  // ==========================
  _activeTime() {
    if (!this.recordingStartTime) return 0;
    const t = now();
    let paused = this.totalPausedTime;
    if (this.isPaused && this.pauseStartTime) paused += (t - this.pauseStartTime);
    return Math.max(0, t - this.recordingStartTime - paused);
  }

  async _lastMeaningful() { // [17] promise-based
    const res = await promiseSendMessage({ type: 'GET_LAST_MEANINGFUL_INTERACTION' });
    return res?.interaction || null;
  }

  async _recordInteraction(interaction, suppressAutoShot = false, autoShotDelayMs = 100) {
    interaction.id = interaction.id || `interaction_${now()}_${Math.random().toString(36).slice(2, 9)}`;
    interaction.timestamp = interaction.timestamp || now();
    interaction.relativeTime = typeof interaction.relativeTime === 'number' ? interaction.relativeTime : this._activeTime();

    // Attach afterStep context asynchronously where it matters
    if (interaction.type === 'api_failure' || interaction.type === 'javascript_error') {
      try {
        interaction.afterStep = await this._lastMeaningful(); // [17]
      } catch { }
    }

    chrome.runtime.sendMessage({ type: 'RECORD_INTERACTION', data: interaction });
    this.lastInteractionId = interaction.id;

    if (!suppressAutoShot && this.settings.autoScreenshot) {
      setTimeout(() => {
        this._triggerScreenshot({
          type: 'interaction',
          interactionType: interaction.type,
          interactionId: interaction.id
        });
      }, autoShotDelayMs);
    }
  }

  _recordSessionStart() {
    const start = {
      type: 'session_start',
      url: location.href,
      timestamp: now(),
      userAgent: navigator.userAgent,
      viewport: { width: innerWidth, height: innerHeight }
    };
    this._recordInteraction(start, /*suppressAutoShot=*/false, /*delay*/ 0);
  }

  _recordInput(el, triggerType) {
    const selector = toSelector(el);
    const key = `${selector}_${el.tagName}`;
    let value = el.value;

    if (el.type?.toLowerCase() === 'password') value = '[REDACTED]';
    else value = sanitizeValue(value);

    const last = this.lastInputValues.get(key);
    if (last === value && value !== '[REDACTED]') return; // unchanged

    this.lastInputValues.set(key, value);

    const interaction = {
      type: 'input',
      selector,
      tagName: el.tagName.toLowerCase(),
      inputType: el.type || 'text',
      value,
      attributes: elementAttrs(el),
      timestamp: now(),
      relativeTime: this._activeTime(),
      triggerType,
      timeFrame: `${this.inputDebounceDelay / 1000}s`
    };
    this._recordInteraction(interaction);
  }

  // ==========================
  // Screenshots + Redaction
  // ==========================
  _triggerScreenshot(ctx) {
    // If auto (not forced) and autoScreenshot disabled, skip
    const forced = !!ctx?.forced;
    if (!forced && !this.settings.autoScreenshot) return;

    chrome.runtime.sendMessage({
      type: 'CAPTURE_SCREENSHOT',
      data: {
        type: forced ? 'manual_capture' : 'auto_capture',
        manual: forced,
        timestamp: now(),
        context: ctx
      }
    }, (res) => {
      if (!res || !res.success) {
        console.warn('Screenshot failed:', res?.reason || 'Unknown');
      }
    });
  }

  async _manualScreenshotWithRedaction() { // [21]
    try {
      // 1) Add overlays
      this._applyRedactionOverlays();

      // 2) Give the browser a frame to paint overlays
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 50)));

      // 3) Trigger screenshot (forced => works while paused)
      this._triggerScreenshot({ type: 'manual', forced: true });

    } finally {
      // 4) Clean up overlays after a short delay (ensure capture finished)
      setTimeout(() => this._removeRedactionOverlays(), 150);
    }
  }

  _applyRedactionOverlays() {
    this._removeRedactionOverlays(); // idempotent
    const patterns = (String(this.settings.redactionPatterns || '').split(',').map(s => s.trim()).filter(Boolean));
    const regex = patterns.length ? new RegExp(patterns.join('|'), 'i') : REDACTION_DEFAULT_PATTERN;

    const candidates = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"], [type="password"], [data-secret], [data-sensitive]'));

    for (const el of candidates) {
      const name = (el.getAttribute('name') || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || '');
      const isPw = (el.getAttribute('type') || '').toLowerCase() === 'password';
      if (!isPw && !regex.test(name)) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;

      const overlay = document.createElement('div');
      overlay.style.position = 'fixed';
      overlay.style.left = `${Math.max(0, rect.left)}px`;
      overlay.style.top = `${Math.max(0, rect.top)}px`;
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
      overlay.style.zIndex = '2147483647';
      overlay.style.pointerEvents = 'none';
      overlay.style.background = '#000';
      overlay.style.opacity = '0.35';
      overlay.style.backdropFilter = 'blur(6px)';
      overlay.style.borderRadius = getComputedStyle(el).borderRadius || '4px';
      document.body.appendChild(overlay);
      this._redactionOverlays.push(overlay);
    }
  }

  _removeRedactionOverlays() {
    for (const o of this._redactionOverlays) {
      o.remove();
    }
    this._redactionOverlays = [];
  }

  // ==========================
  // Debounce housekeeping
  // ==========================
  _clearAllDebounceTimers() { // [20]
    for (const [, t] of this.inputDebounceTimers) clearTimeout(t);
    this.inputDebounceTimers.clear();
  }

  _reconcileDebounceTimers() { // [18][20] when delay changes, reset all pending timers
    if (this.inputDebounceTimers.size === 0) return;
    const keys = Array.from(this.inputDebounceTimers.keys());
    this._clearAllDebounceTimers();
    // We do not reschedule because we no longer have the original elements here.
    // New events will use the new delay. (Safer than guessing targets)
  }

  // ==========================
  // Network interception
  // ==========================
  _injectNetworkInterceptor() {
    const script = document.createElement('script');
    script.textContent = `(${this._networkInterceptorScript.toString()})();`;
    document.documentElement.appendChild(script);
    script.remove();
  }

  _networkInterceptorScript() {
    const originalFetch = window.fetch;
    const OriginalXHR = window.XMLHttpRequest;

    // fetch
    window.fetch = function (...args) {
      const startTime = Date.now();
      const url = args[0];
      const options = args[1] || {};
      const method = options.method || 'GET';

      return originalFetch.apply(this, args)
        .then(response => {
          const data = {
            type: 'fetch',
            url: String(url),
            method,
            status: response.status,
            statusText: response.statusText,
            startTime,
            endTime: Date.now(),
            success: response.ok
          };
          if (!response.ok) {
            window.postMessage({
              source: 'testsnapper-injected',
              type: 'NETWORK_ERROR',
              data: { ...data, error: 'HTTP ' + response.status }
            }, '*');
          } else {
            window.postMessage({ source: 'testsnapper-injected', type: 'NETWORK_CALL', data }, '*');
          }
          return response;
        })
        .catch(error => {
          // [19] Ensure status=0 for network failures
          window.postMessage({
            source: 'testsnapper-injected',
            type: 'NETWORK_ERROR',
            data: {
              type: 'fetch',
              url: String(url),
              method,
              status: 0,
              statusText: '',
              error: error?.message || 'Network Error',
              startTime,
              endTime: Date.now()
            }
          }, '*');
          throw error;
        });
    };

    // XHR
    window.XMLHttpRequest = function () {
      const xhr = new OriginalXHR();
      const origOpen = xhr.open;
      const origSend = xhr.send;

      let meta = { method: 'GET', url: '', startTime: 0 };

      xhr.open = function (m, u, ...rest) {
        meta.method = m || 'GET';
        meta.url = u || '';
        return origOpen.apply(this, [m, u, ...rest]);
      };

      xhr.send = function (...rest) {
        meta.startTime = Date.now();

        const origReady = this.onreadystatechange;
        this.onreadystatechange = function () {
          if (origReady) try { origReady.apply(this, arguments); } catch { }

          if (this.readyState === 4) {
            const data = {
              type: 'xhr',
              url: meta.url,
              method: meta.method,
              status: this.status,
              statusText: this.statusText,
              startTime: meta.startTime,
              endTime: Date.now(),
              success: this.status >= 200 && this.status < 300
            };
            if (this.status === 0 || this.status >= 400) {
              window.postMessage({
                source: 'testsnapper-injected',
                type: 'NETWORK_ERROR',
                data: { ...data, error: (this.status === 0 ? 'Network Error' : 'HTTP ' + this.status) }
              }, '*');
            } else {
              window.postMessage({ source: 'testsnapper-injected', type: 'NETWORK_CALL', data }, '*');
            }
          }
        };

        return origSend.apply(this, rest);
      };

      return xhr;
    };

    // JS errors
    window.addEventListener('error', (event) => {
      window.postMessage({
        source: 'testsnapper-injected',
        type: 'JAVASCRIPT_ERROR',
        data: {
          message: event.message,
          source: event.filename,
          line: event.lineno,
          column: event.colno,
          stack: event.error?.stack
        }
      }, '*');
    });
  }
}

// ==============================
// Bootstrap
// ==============================
new TestSnapperRecorder();
