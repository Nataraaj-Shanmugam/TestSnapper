// injected.js — Full, Fixed & Enhanced
// Addresses D. Injected.js issues:
// 22) Console interception: safe, idempotent wrappers + do not clobber prior shims
// 23) Fetch/XHR interception: guaranteed restore on navigation (beforeunload) and stop
// 24) State sync race: initial + short-window polling fallback; late updates handled
// 25) Screenshot hotkey: configurable (default Ctrl/Cmd+Shift+S), avoids input conflicts, can be disabled
//
// Drop-in replacement. Plays nice with other scripts and your updated content.js/background.js.

(function () {
  'use strict';

  // ==============================
  // Symbols / Flags to avoid double-wrapping
  // ==============================
  const WRAPPED = Symbol.for('testsnapper.wrapped');
  const ORIGINAL = Symbol.for('testsnapper.original');
  const NS = 'TestSnapperInjected';

  // ==============================
  // Helpers
  // ==============================
  const now = () => Date.now();

  function safeStringify(val) {
    try {
      if (typeof val === 'string') return val;
      return JSON.stringify(val, function replacer(_, v) {
        if (v && typeof v === 'object') {
          if (seen.has(v)) return '[Circular]';
          seen.add(v);
        }
        return v;
      }, 2);
    } catch {
      try { return String(val); } catch { return '[Unserializable]'; }
    }
  }
  const seen = new WeakSet();

  function postToContent(payload) {
    window.postMessage({ source: 'testsnapper-injected', ...payload }, '*');
  }

  function isEditableTarget(evTarget) {
    if (!evTarget) return false;
    const el = evTarget.closest
      ? evTarget.closest('input, textarea, [contenteditable="true"]')
      : null;
    return !!el;
  }

  // Default hotkey: Ctrl/Cmd + Shift + S
  function matchHotkey(event, binding) {
    const { key = 'S', ctrl = true, shift = true, meta = 'either' } = binding || {};
    const wantMeta = meta === 'mac' ? event.metaKey
                    : meta === 'win' ? event.ctrlKey
                    : meta === 'either' ? (event.metaKey || event.ctrlKey)
                    : false;
    const wantCtrl = ctrl ? event.ctrlKey : true;
    const wantShift = shift ? event.shiftKey : true;
    const wantKey = event.key?.toUpperCase() === String(key).toUpperCase();
    // If meta==='either' we already considered it. If meta===false, ignore meta.
    const metaOk = meta === false ? true : wantMeta;
    return wantKey && wantCtrl && wantShift && metaOk;
  }

  class TestSnapperInjected {
    constructor() {
      // Recording state
      this.isRecording = false;
      this.isPaused = false;
      this.recordingStartTime = null;
      this.pauseStartTime = null;
      this.totalPausedTime = 0;

      // Console
      this.originalConsole = null;
      this.recentLogs = [];
      this.maxLogs = 100;

      // Network
      this.originalFetch = null;
      this.originalXHR = null;

      // Errors
      this.originalErrorHandler = null;
      this.originalUnhandledRejectionHandler = null;

      // Performance
      this.performanceObserver = null;

      // Hotkey
      this.screenshotKeyHandler = null;
      this.hotkeyBinding = { key: 'S', ctrl: true, shift: true, meta: 'either' }; // configurable

      // State sync safety
      this._statusPollTimer = null;
      this._earlySyncDeadline = now() + 5000; // 5s early sync window

      this.init();
    }

    // ==============================
    // Init / Messaging
    // ==============================
    init() {
      window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== 'testsnapper-content') return;
        this.handleMessage(data);
      });

      // Initial + early polling to avoid race (24)
      this.requestStatus();
      this.startEarlyStatusPolling();

      // Ensure restoration on navigation unload (23)
      window.addEventListener('beforeunload', () => {
        try { this.restoreConsoleLogs(); } catch {}
        try { this.restoreNetworkCalls(); } catch {}
        try { this.restoreErrorHandling(); } catch {}
        try { this.removeScreenshotHotkey(); } catch {}
      }, { capture: true });

      // Safety: if the page was already recording before inject, content will push a status
    }

    requestStatus() {
      postToContent({ type: 'GET_RECORDING_STATUS' });
    }

    startEarlyStatusPolling() {
      if (this._statusPollTimer) return;
      this._statusPollTimer = setInterval(() => {
        if (now() > this._earlySyncDeadline) {
          clearInterval(this._statusPollTimer);
          this._statusPollTimer = null;
          return;
        }
        this.requestStatus();
      }, 750);
    }

    // ==============================
    // Messaging handler
    // ==============================
    handleMessage(message) {
      const { type, data } = message;

      switch (type) {
        case 'RECORDING_STATUS_UPDATE': // content pushes periodically or on change
        case 'RECORDING_STATUS_SNAPSHOT': { // optional alternative name
          this.updateRecordingStatus(data || {});
          break;
        }

        case 'START_ADVANCED_RECORDING':
          this.startAdvancedRecording(data);
          break;
        case 'PAUSE_ADVANCED_RECORDING':
          this.pauseAdvancedRecording();
          break;
        case 'RESUME_ADVANCED_RECORDING':
          this.resumeAdvancedRecording();
          break;
        case 'STOP_ADVANCED_RECORDING':
          this.stopAdvancedRecording();
          break;

        case 'INJECT_SCREENSHOT_HOTKEY':
          this.setupScreenshotHotkey(data?.binding);
          break;
        case 'SET_HOTKEY':
          this.updateHotkey(data?.binding);
          break;

        case 'CAPTURE_CONSOLE_LOGS':
          this.captureConsoleLogs();
          break;

        case 'CAPTURE_PERFORMANCE_DATA':
          this.capturePerformanceData();
          break;

        case 'FORCE_SCREENSHOT':
          this.handleForceScreenshot();
          break;

        case 'FORCE_STOP':
          this.handleForceStop();
          break;

        default:
          break;
      }
    }

    // ==============================
    // State transitions
    // ==============================
    updateRecordingStatus(status) {
      const wasRecording = this.isRecording;
      const wasPaused = this.isPaused;

      this.isRecording       = !!status.isRecording;
      this.isPaused          = !!status.isPaused;
      this.recordingStartTime = status.startTime ?? this.recordingStartTime;
      this.totalPausedTime    = status.totalPausedTime ?? this.totalPausedTime;

      // Handle transitions deterministically
      if (!wasRecording && this.isRecording) {
        this.startAdvancedRecording();
      } else if (wasRecording && !this.isRecording) {
        this.stopAdvancedRecording();
      } else if (this.isRecording && !wasPaused && this.isPaused) {
        this.pauseAdvancedRecording();
      } else if (this.isRecording && wasPaused && !this.isPaused) {
        this.resumeAdvancedRecording();
      }
    }

    startAdvancedRecording(options = {}) {
      if (this.isRecording && !this.isPaused && this.recordingStartTime) {
        // already active — still make sure hooks installed
      }

      this.isRecording = true;
      this.isPaused = false;
      if (!this.recordingStartTime) this.recordingStartTime = now();
      this.recentLogs = [];

      this.interceptConsoleLogs();   // (22) safe wrappers
      this.interceptNetworkCalls();  // (23) safe wrappers
      this.interceptErrors();
      this.monitorPerformance();

      if (options.enableScreenshotHotkey !== false) {
        this.setupScreenshotHotkey(options.binding);
      }

      postToContent({
        type: 'ADVANCED_RECORDING_STARTED',
        data: { timestamp: now(), userAgent: navigator.userAgent, url: location.href }
      });
    }

    pauseAdvancedRecording() {
      if (!this.isRecording || this.isPaused) return;

      this.isPaused = true;
      this.pauseStartTime = now();

      postToContent({
        type: 'ADVANCED_RECORDING_PAUSED',
        data: { timestamp: now(), activeTime: this.getActiveRecordingTime() }
      });
    }

    resumeAdvancedRecording() {
      if (!this.isRecording || !this.isPaused) return;

      const t = now();
      const pausedDuration = t - (this.pauseStartTime || t);
      this.totalPausedTime += pausedDuration;
      this.pauseStartTime = null;
      this.isPaused = false;

      postToContent({
        type: 'ADVANCED_RECORDING_RESUMED',
        data: {
          timestamp: t,
          pausedDuration,
          totalPausedTime: this.totalPausedTime,
          activeTime: this.getActiveRecordingTime()
        }
      });
    }

    stopAdvancedRecording() {
      // compute final pause time
      if (this.isPaused && this.pauseStartTime) {
        this.totalPausedTime += now() - this.pauseStartTime;
      }

      this.isRecording = false;
      this.isPaused = false;

      // Restore everything (22, 23)
      this.restoreConsoleLogs();
      this.restoreNetworkCalls();
      this.restoreErrorHandling();
      this.removeScreenshotHotkey();
      this.stopPerformanceObserver();

      postToContent({
        type: 'ADVANCED_RECORDING_STOPPED',
        data: {
          timestamp: now(),
          totalDuration: this.recordingStartTime ? (now() - this.recordingStartTime) : 0,
          activeDuration: this.getActiveRecordingTime(),
          totalPausedTime: this.totalPausedTime,
          finalLogs: this.recentLogs.slice(-10)
        }
      });

      // Reset timers/state
      this.recordingStartTime = null;
      this.pauseStartTime = null;
      this.totalPausedTime = 0;
      this.recentLogs = [];
    }

    getActiveRecordingTime() {
      if (!this.recordingStartTime) return 0;
      const t = now();
      let paused = this.totalPausedTime;
      if (this.isPaused && this.pauseStartTime) paused += (t - this.pauseStartTime);
      return Math.max(0, t - this.recordingStartTime - paused);
    }

    // ==============================
    // Console interception (22)
    // ==============================
    interceptConsoleLogs() {
      if (this.originalConsole) return; // already wrapped by us

      // If another tool already wrapped console, keep *their* wrapper as "original"
      const original = {
        log: console.log,
        error: console.error,
        warn: console.warn,
        info: console.info,
        debug: console.debug
      };
      // Mark originals if not marked
      Object.keys(original).forEach(k => {
        if (!original[k][ORIGINAL]) original[k][ORIGINAL] = original[k];
      });

      this.originalConsole = original;

      const self = this;
      ['log', 'error', 'warn', 'info', 'debug'].forEach(method => {
        const base = console[method] && console[method][ORIGINAL] ? console[method][ORIGINAL] : console[method];
        if (base && base[WRAPPED] === true) return; // already wrapped by us

        function wrappedConsole(...args) {
          try {
            base.apply(console, args);
          } finally {
            if (self.isRecording && !self.isPaused) {
              const msg = args.map(a => safeStringify(a)).join(' ');
              const entry = {
                level: method,
                message: msg,
                timestamp: now(),
                relativeTime: self.getActiveRecordingTime(),
                stack: (method === 'error') ? new Error().stack : null
              };
              self.recentLogs.push(entry);
              if (self.recentLogs.length > self.maxLogs) self.recentLogs.shift();

              postToContent({ type: 'CONSOLE_LOG', data: entry });
            }
          }
        }
        wrappedConsole[WRAPPED] = true;
        wrappedConsole[ORIGINAL] = base;
        console[method] = wrappedConsole;
      });
    }

    restoreConsoleLogs() {
      if (!this.originalConsole) return;
      Object.keys(this.originalConsole).forEach(method => {
        const orig = this.originalConsole[method];
        if (console[method] && console[method][ORIGINAL]) {
          console[method] = console[method][ORIGINAL]; // in case wrapper chain exists
        } else {
          console[method] = orig;
        }
      });
      this.originalConsole = null;
    }

    // ==============================
    // Network interception (23)
    // ==============================
    interceptNetworkCalls() {
      this.interceptFetch();
      this.interceptXHR();
    }

    interceptFetch() {
      if (this.originalFetch) return; // already wrapped

      const baseFetch = window.fetch;
      const base = baseFetch && baseFetch[ORIGINAL] ? baseFetch[ORIGINAL] : baseFetch;
      if (!base) return;

      const self = this;
      function wrappedFetch(...args) {
        const startTime = now();
        const url = args[0];
        const options = args[1] || {};
        const method = options.method || 'GET';

        const shouldRecord = self.isRecording && !self.isPaused;

        return base.apply(this, args)
          .then(response => {
            if (shouldRecord) {
              const endTime = now();
              postToContent({
                type: 'NETWORK_CALL',
                data: {
                  type: 'fetch',
                  url: String(url),
                  method,
                  status: response.status,
                  statusText: response.statusText,
                  startTime,
                  endTime,
                  duration: endTime - startTime,
                  relativeTime: self.getActiveRecordingTime(),
                  headers: (() => {
                    try { return Object.fromEntries(response.headers.entries()); }
                    catch { return {}; }
                  })(),
                  success: response.ok
                }
              });
            }
            return response;
          })
          .catch(error => {
            if (shouldRecord) {
              const endTime = now();
              postToContent({
                type: 'NETWORK_ERROR',
                data: {
                  type: 'fetch',
                  url: String(url),
                  method,
                  error: error?.message || 'Network Error',
                  startTime,
                  endTime,
                  duration: endTime - startTime,
                  relativeTime: self.getActiveRecordingTime(),
                  status: 0,
                  statusText: ''
                }
              });
            }
            throw error;
          });
      }
      wrappedFetch[WRAPPED] = true;
      wrappedFetch[ORIGINAL] = base;
      this.originalFetch = base;
      window.fetch = wrappedFetch;
    }

    interceptXHR() {
      if (this.originalXHR) return; // already wrapped

      const BaseXHR = window.XMLHttpRequest && window.XMLHttpRequest[ORIGINAL]
        ? window.XMLHttpRequest[ORIGINAL]
        : window.XMLHttpRequest;
      if (!BaseXHR) return;

      const self = this;
      function WrappedXHR() {
        const xhr = new BaseXHR();
        const origOpen = xhr.open;
        const origSend = xhr.send;

        let meta = { method: 'GET', url: '', startTime: 0 };

        xhr.open = function (m, u, ...rest) {
          meta.method = m || 'GET';
          meta.url = u || '';
          return origOpen.apply(this, [m, u, ...rest]);
        };

        xhr.send = function (...rest) {
          meta.startTime = now();

          const origReady = this.onreadystatechange;
          this.onreadystatechange = function () {
            if (origReady) {
              try { origReady.apply(this, arguments); } catch {}
            }
            if (this.readyState === 4 && self.isRecording && !self.isPaused) {
              const endTime = now();
              const data = {
                type: 'xhr',
                url: meta.url,
                method: meta.method,
                status: this.status,
                statusText: this.statusText,
                startTime: meta.startTime,
                endTime: endTime,
                duration: endTime - meta.startTime,
                relativeTime: self.getActiveRecordingTime(),
                success: this.status >= 200 && this.status < 300
              };
              if (this.status === 0 || this.status >= 400) {
                postToContent({ type: 'NETWORK_ERROR', data: { ...data, error: (this.status === 0 ? 'Network Error' : `HTTP ${this.status}`) } });
              } else {
                postToContent({ type: 'NETWORK_CALL', data });
              }
            }
          };

          return origSend.apply(this, rest);
        };

        return xhr;
      }

      WrappedXHR[WRAPPED] = true;
      WrappedXHR[ORIGINAL] = BaseXHR;
      this.originalXHR = BaseXHR;
      window.XMLHttpRequest = WrappedXHR;
    }

    restoreNetworkCalls() {
      try {
        if (window.fetch && window.fetch[ORIGINAL]) {
          window.fetch = window.fetch[ORIGINAL];
        } else if (this.originalFetch) {
          window.fetch = this.originalFetch;
        }
      } catch {}
      this.originalFetch = null;

      try {
        if (window.XMLHttpRequest && window.XMLHttpRequest[ORIGINAL]) {
          window.XMLHttpRequest = window.XMLHttpRequest[ORIGINAL];
        } else if (this.originalXHR) {
          window.XMLHttpRequest = this.originalXHR;
        }
      } catch {}
      this.originalXHR = null;
    }

    // ==============================
    // Error interception
    // ==============================
    interceptErrors() {
      if (!this.originalErrorHandler) this.originalErrorHandler = window.onerror;
      if (!this.originalUnhandledRejectionHandler) this.originalUnhandledRejectionHandler = window.onunhandledrejection;

      const self = this;

      window.onerror = function (message, source, lineno, colno, error) {
        if (self.isRecording && !self.isPaused) {
          postToContent({
            type: 'JAVASCRIPT_ERROR',
            data: {
              message,
              source,
              line: lineno,
              column: colno,
              stack: error?.stack,
              timestamp: now(),
              relativeTime: self.getActiveRecordingTime()
            }
          });
        }
        if (typeof self.originalErrorHandler === 'function') {
          return self.originalErrorHandler.apply(this, arguments);
        }
      };

      window.onunhandledrejection = function (event) {
        if (self.isRecording && !self.isPaused) {
          postToContent({
            type: 'UNHANDLED_PROMISE_REJECTION',
            data: {
              reason: String(event.reason),
              stack: event.reason?.stack,
              timestamp: now(),
              relativeTime: self.getActiveRecordingTime()
            }
          });
        }
        if (typeof self.originalUnhandledRejectionHandler === 'function') {
          return self.originalUnhandledRejectionHandler.apply(this, arguments);
        }
      };
    }

    restoreErrorHandling() {
      if (typeof this.originalErrorHandler !== 'undefined') {
        window.onerror = this.originalErrorHandler;
      }
      if (typeof this.originalUnhandledRejectionHandler !== 'undefined') {
        window.onunhandledrejection = this.originalUnhandledRejectionHandler;
      }
      this.originalErrorHandler = null;
      this.originalUnhandledRejectionHandler = null;
    }

    // ==============================
    // Performance
    // ==============================
    monitorPerformance() {
      if (!window.PerformanceObserver) return;
      try {
        this.performanceObserver = new PerformanceObserver((list) => {
          if (!this.isRecording || this.isPaused) return;
          for (const entry of list.getEntries()) {
            postToContent({
              type: 'PERFORMANCE_ENTRY',
              data: {
                name: entry.name,
                entryType: entry.entryType,
                startTime: entry.startTime,
                duration: entry.duration,
                timestamp: now(),
                relativeTime: this.getActiveRecordingTime()
              }
            });
          }
        });
        this.performanceObserver.observe({ entryTypes: ['navigation', 'resource', 'measure', 'mark'] });
      } catch (err) {
        // ignore
      }
    }

    stopPerformanceObserver() {
      try { this.performanceObserver?.disconnect(); } catch {}
      this.performanceObserver = null;
    }

    capturePerformanceData() {
      if (!window.performance) return;
      const perfData = {
        timing: performance.timing,
        navigation: performance.navigation,
        memory: performance.memory ? {
          usedJSHeapSize: performance.memory.usedJSHeapSize,
          totalJSHeapSize: performance.memory.totalJSHeapSize,
          jsHeapSizeLimit: performance.memory.jsHeapSizeLimit
        } : null,
        timestamp: now(),
        relativeTime: this.getActiveRecordingTime()
      };
      postToContent({ type: 'PERFORMANCE_DATA', data: perfData });
    }

    // ==============================
    // Hotkey (25)
    // ==============================
    setupScreenshotHotkey(binding) {
      if (binding) this.hotkeyBinding = { ...this.hotkeyBinding, ...binding }; // partial overrides
      if (this.screenshotKeyHandler) return;

      this.screenshotKeyHandler = (event) => {
        // Don’t conflict with site inputs
        if (isEditableTarget(event.target)) return;

        if (matchHotkey(event, this.hotkeyBinding)) {
          // Best-effort: do not hijack unless recording (avoid site clashes)
          if (this.isRecording) {
            event.preventDefault();
            postToContent({
              type: 'HOTKEY_SCREENSHOT',
              data: {
                timestamp: now(),
                relativeTime: this.getActiveRecordingTime(),
                url: location.href,
                paused: this.isPaused
              }
            });
          }
        }
      };

      document.addEventListener('keydown', this.screenshotKeyHandler, true);
    }

    updateHotkey(binding) {
      if (!binding) return;
      this.removeScreenshotHotkey();
      this.setupScreenshotHotkey(binding);
    }

    removeScreenshotHotkey() {
      if (!this.screenshotKeyHandler) return;
      document.removeEventListener('keydown', this.screenshotKeyHandler, true);
      this.screenshotKeyHandler = null;
    }

    // ==============================
    // Manual actions
    // ==============================
    handleForceScreenshot() {
      postToContent({
        type: 'FORCE_SCREENSHOT_REQUEST',
        data: {
          timestamp: now(),
          relativeTime: this.getActiveRecordingTime(),
          url: location.href,
          paused: this.isPaused
        }
      });
    }

    handleForceStop() {
      postToContent({
        type: 'FORCE_STOP_REQUEST',
        data: {
          timestamp: now(),
          relativeTime: this.getActiveRecordingTime(),
          url: location.href,
          paused: this.isPaused
        }
      });
    }

    // ==============================
    // Console log dump
    // ==============================
    captureConsoleLogs() {
      postToContent({
        type: 'CONSOLE_LOGS_DUMP',
        data: {
          logs: this.recentLogs,
          timestamp: now(),
          relativeTime: this.getActiveRecordingTime()
        }
      });
    }
  }

  // Initialize
  new TestSnapperInjected();
})();
