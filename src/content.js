// Content script for UI interaction recording with pause/resume functionality
// Enhanced with time frames, API failure tracking, and settings-aware screenshots
class TestSnapperRecorder {
  constructor() {
    this.isRecording = false;
    this.isPaused = false;
    // listeners: Map<Element, Map<EventType, Handler>>
    this.listeners = new Map();
    this.originalPushState = null;
    this.originalReplaceState = null;
    this.pauseStartTime = null;
    this.totalPausedTime = 0;
    this.recordingStartTime = null;

    // Debouncing for input events - configurable time frame
    this.inputDebounceTimers = new Map();
    this.inputDebounceDelay = 2000; // 2 seconds default (configurable)

    // Track input states to avoid duplicate recordings
    this.lastInputValues = new Map();

    // Settings cache
    this.settings = {
      autoScreenshot: true,
      inputTimeFrame: 2000, // 2 seconds default
      screenshotQuality: 'medium',
      redactionPatterns: 'password,secret,token,api_key',
      darkMode: false,
      sessionRetentionDays: 2 // Add session retention setting
    };

    // API failure tracking
    this.lastInteractionId = null;
    this.pendingApiCalls = new Map(); // Track ongoing API calls

    this.init();
  }

  async init() {
    // Load settings first
    await this.loadSettings();

    // Auto-cleanup old sessions on initialization
    this.autoCleanupSessions();

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true;
    });

    // Check initial recording status
    chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATUS' }, (response) => {
      if (response?.isRecording) {
        this.isRecording = true;
        this.isPaused = response.isPaused || false;
        this.recordingStartTime = response.startTime || Date.now();
        this.totalPausedTime = response.totalPausedTime || 0;

        if (!this.isPaused) {
          this.startUIRecording();
        } else {
          console.log('TestSnapper: Recording is paused, not starting UI recording');
          this.addEventListeners();
        }
      }
    });

    // Listen for API failures from injected script
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (event.data.source !== 'testsnapper-injected') return;
      this.handleInjectedMessage(event.data);
    });

    // Set up periodic cleanup (run every 6 hours)
    setInterval(() => {
      this.autoCleanupSessions();
    }, 6 * 60 * 60 * 1000);
  }

  async loadSettings() {
    try {
      const result = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, resolve);
      });

      if (result && result.settings) {
        this.settings = { ...this.settings, ...result.settings };
        // Update debounce delay based on settings
        this.inputDebounceDelay = this.settings.inputTimeFrame || 2000;
        console.log('Settings loaded:', this.settings);
      }
    } catch (error) {
      console.log('Could not load settings, using defaults:', error);
    }
  }

  // Auto-cleanup sessions older than retention period
  autoCleanupSessions() {
    const retentionDays = this.settings.sessionRetentionDays || 2;
    const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);

    chrome.runtime.sendMessage({
      type: 'CLEANUP_OLD_SESSIONS',
      cutoffTime: cutoffTime
    }, (response) => {
      if (response && response.deletedCount > 0) {
        console.log(`TestSnapper: Auto-cleaned ${response.deletedCount} old sessions`);
      }
    });
  }

  handleInjectedMessage(message) {
    if (!this.isRecording || this.isPaused) return;

    switch (message.type) {
      case 'NETWORK_CALL':
        this.handleNetworkCall(message.data);
        break;
      case 'NETWORK_ERROR':
        this.handleNetworkError(message.data);
        break;
      case 'JAVASCRIPT_ERROR':
        this.handleJavaScriptError(message.data);
        break;
    }
  }

  handleNetworkCall(data) {
    // Track successful API calls
    const callId = `${data.method}_${data.url}_${data.startTime}`;
    this.pendingApiCalls.set(callId, {
      ...data,
      relatedInteractionId: this.lastInteractionId
    });

    // Clean up after 30 seconds
    setTimeout(() => {
      this.pendingApiCalls.delete(callId);
    }, 30000);
  }

  handleNetworkError(data) {
    // Record API failure as an interaction
    const interaction = {
      type: 'api_failure',
      url: data.url,
      method: data.method,
      status: data.status || 'Network Error',
      error: data.error,
      timestamp: Date.now(),
      relativeTime: this.getRelativeTime(),
      relatedInteractionId: this.lastInteractionId,
      afterStep: this.getLastMeaningfulInteraction()
    };

    console.log('Captured API failure:', interaction);
    this.recordInteraction(interaction);
  }

  handleJavaScriptError(data) {
    // Record JavaScript errors that might be related to user interactions
    const interaction = {
      type: 'javascript_error',
      message: data.message,
      source: data.source,
      line: data.line,
      timestamp: Date.now(),
      relativeTime: this.getRelativeTime(),
      relatedInteractionId: this.lastInteractionId,
      afterStep: this.getLastMeaningfulInteraction()
    };

    console.log('Captured JavaScript error:', interaction);
    this.recordInteraction(interaction);
  }

  getLastMeaningfulInteraction() {
    // This will be called by background script to get context
    return chrome.runtime.sendMessage({
      type: 'GET_LAST_MEANINGFUL_INTERACTION'
    });
  }

  handleMessage(message, sender, sendResponse) {
    console.log('Content script received message:', message.type);

    switch (message.type) {
      case 'START_UI_RECORDING':
        this.startUIRecording();
        sendResponse({ success: true });
        break;

      case 'PAUSE_UI_RECORDING':
        this.pauseUIRecording();
        sendResponse({ success: true });
        break;

      case 'RESUME_UI_RECORDING':
        this.resumeUIRecording();
        sendResponse({ success: true });
        break;

      case 'STOP_UI_RECORDING':
        this.stopUIRecording();
        sendResponse({ success: true });
        break;

      case 'UPDATE_SETTINGS':
        this.updateSettings(message.settings);
        sendResponse({ success: true });
        break;

      case 'GET_PAUSE_STATUS':
        sendResponse({
          isPaused: this.isPaused,
          isRecording: this.isRecording,
          totalPausedTime: this.totalPausedTime
        });
        break;

      case 'FORCE_SCREENSHOT':
        // Allow screenshots even when paused
        this.triggerScreenshot({
          type: 'manual',
          forced: true,
          timestamp: Date.now()
        });
        sendResponse({ success: true });
        break;

      case 'CLEANUP_SESSIONS':
        this.handleSessionCleanup(message.data);
        sendResponse({ success: true });
        break;
    }
  }

  handleSessionCleanup(data) {
    if (data.type === 'all') {
      // Clear all sessions
      chrome.runtime.sendMessage({
        type: 'CLEAR_ALL_SESSIONS'
      }, (response) => {
        console.log('All sessions cleared:', response);
      });
    } else if (data.type === 'selected' && data.sessionIds) {
      // Clear selected sessions
      chrome.runtime.sendMessage({
        type: 'CLEAR_SELECTED_SESSIONS',
        sessionIds: data.sessionIds
      }, (response) => {
        console.log('Selected sessions cleared:', response);
      });
    } else if (data.type === 'old') {
      // Manual cleanup of old sessions
      this.autoCleanupSessions();
    }
  }

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    this.inputDebounceDelay = this.settings.inputTimeFrame || 2000;
    console.log('Settings updated:', this.settings);
  }

  startUIRecording() {
    if (this.isRecording && !this.isPaused) {
      console.log('TestSnapper: Already recording and not paused');
      return;
    }

    this.isRecording = true;
    this.isPaused = false;
    this.recordingStartTime = this.recordingStartTime || Date.now();

    console.log('TestSnapper: Starting UI recording on', window.location.href);

    this.addEventListeners();
    this.injectNetworkInterceptor(); // Inject network monitoring

    // Record session start event
    const startInteraction = {
      type: 'session_start',
      url: window.location.href,
      timestamp: Date.now(),
      userAgent: navigator.userAgent,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      }
    };

    this.recordInteraction(startInteraction);
    this.lastInteractionId = startInteraction.id;

    console.log('TestSnapper: UI recording started successfully');
  }

  injectNetworkInterceptor() {
    // Inject script for network monitoring
    const script = document.createElement('script');
    script.textContent = `
      (${this.networkInterceptorScript.toString()})();
    `;
    document.documentElement.appendChild(script);
    script.remove();
  }

  networkInterceptorScript() {
    // This function will be injected into the page
    const originalFetch = window.fetch;
    const originalXHR = window.XMLHttpRequest;

    // Intercept fetch
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
            method: method,
            status: response.status,
            statusText: response.statusText,
            startTime: startTime,
            endTime: Date.now(),
            success: response.ok
          };

          if (!response.ok) {
            window.postMessage({
              source: 'testsnapper-injected',
              type: 'NETWORK_ERROR',
              data: { ...data, error: `HTTP ${response.status}` }
            }, '*');
          } else {
            window.postMessage({
              source: 'testsnapper-injected',
              type: 'NETWORK_CALL',
              data: data
            }, '*');
          }

          return response;
        })
        .catch(error => {
          window.postMessage({
            source: 'testsnapper-injected',
            type: 'NETWORK_ERROR',
            data: {
              type: 'fetch',
              url: String(url),
              method: method,
              error: error.message,
              startTime: startTime,
              endTime: Date.now()
            }
          }, '*');
          throw error;
        });
    };

    // Intercept XMLHttpRequest
    window.XMLHttpRequest = function () {
      const xhr = new originalXHR();
      const originalOpen = xhr.open;
      const originalSend = xhr.send;

      let requestData = { method: '', url: '', startTime: 0 };

      xhr.open = function (method, url, ...args) {
        requestData.method = method;
        requestData.url = url;
        return originalOpen.apply(this, [method, url, ...args]);
      };

      xhr.send = function (data) {
        requestData.startTime = Date.now();

        const originalOnReadyStateChange = this.onreadystatechange;
        this.onreadystatechange = function () {
          if (originalOnReadyStateChange) {
            originalOnReadyStateChange.apply(this, arguments);
          }

          if (this.readyState === 4) {
            const networkData = {
              type: 'xhr',
              url: requestData.url,
              method: requestData.method,
              status: this.status,
              statusText: this.statusText,
              startTime: requestData.startTime,
              endTime: Date.now(),
              success: this.status >= 200 && this.status < 300
            };

            if (this.status === 0 || this.status >= 400) {
              window.postMessage({
                source: 'testsnapper-injected',
                type: 'NETWORK_ERROR',
                data: { ...networkData, error: `HTTP ${this.status}` }
              }, '*');
            } else {
              window.postMessage({
                source: 'testsnapper-injected',
                type: 'NETWORK_CALL',
                data: networkData
              }, '*');
            }
          }
        };

        return originalSend.apply(this, arguments);
      };

      return xhr;
    };

    // Intercept JavaScript errors
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

  pauseUIRecording() {
    if (!this.isRecording) {
      console.log('TestSnapper: Not recording, cannot pause');
      return;
    }

    if (this.isPaused) {
      console.log('TestSnapper: Already paused');
      return;
    }

    this.isPaused = true;
    this.pauseStartTime = Date.now();
    console.log('TestSnapper: UI recording paused at', this.pauseStartTime);

    // Clear any pending debounced inputs
    this.inputDebounceTimers.forEach(timer => clearTimeout(timer));
    this.inputDebounceTimers.clear();

    // Record pause event
    const pauseInteraction = {
      type: 'session_pause',
      timestamp: this.pauseStartTime,
      activeTime: this.getActiveRecordingTime()
    };

    this.recordInteraction(pauseInteraction);
    this.lastInteractionId = pauseInteraction.id;

    // Note: We DON'T remove event listeners during pause anymore
    // This allows us to continue monitoring for manual actions like screenshots
  }

  resumeUIRecording() {
    if (!this.isRecording) {
      console.log('TestSnapper: Not recording, cannot resume');
      return;
    }

    if (!this.isPaused) {
      console.log('TestSnapper: Not paused, nothing to resume');
      return;
    }

    const resumeTime = Date.now();
    const pausedDuration = resumeTime - this.pauseStartTime;
    this.totalPausedTime += pausedDuration;
    this.isPaused = false;

    console.log('TestSnapper: UI recording resumed after', pausedDuration, 'ms pause');

    // Record resume event
    const resumeInteraction = {
      type: 'session_resume',
      timestamp: resumeTime,
      pausedDuration: pausedDuration,
      totalPausedTime: this.totalPausedTime,
      activeTime: this.getActiveRecordingTime()
    };

    this.recordInteraction(resumeInteraction);
    this.lastInteractionId = resumeInteraction.id;

    if (this.listeners.size === 0) {
      console.log('TestSnapper: No listeners found, re-adding...');
      this.addEventListeners();
    }

    this.pauseStartTime = null;
  }

  stopUIRecording() {
    if (!this.isRecording && this.listeners.size === 0) {
      console.log('TestSnapper: Not recording, ignoring stop request');
      return;
    }

    // Clear any pending debounced inputs before stopping
    this.inputDebounceTimers.forEach(timer => clearTimeout(timer));
    this.inputDebounceTimers.clear();

    // If we're paused, calculate final paused time
    if (this.isPaused && this.pauseStartTime) {
      this.totalPausedTime += Date.now() - this.pauseStartTime;
    }

    // Record session end event
    const endTime = Date.now();
    const endInteraction = {
      type: 'session_end',
      timestamp: endTime,
      totalDuration: endTime - this.recordingStartTime,
      activeDuration: this.getActiveRecordingTime(),
      totalPausedTime: this.totalPausedTime
    };

    this.recordInteraction(endInteraction);

    this.isRecording = false;
    this.isPaused = false;
    console.log('TestSnapper: Stopping UI recording');

    // Remove all event listeners
    this.listeners.forEach((typeMap, element) => {
      Object.entries(typeMap).forEach(([type, handler]) => {
        element.removeEventListener(type, handler, true);
        console.log('TestSnapper: Removed listener', type);
      });
    });
    this.listeners.clear();

    // Restore SPA navigation methods
    if (this.originalPushState) history.pushState = this.originalPushState;
    if (this.originalReplaceState) history.replaceState = this.originalReplaceState;

    this.originalPushState = null;
    this.originalReplaceState = null;

    // Reset timing variables and state tracking
    this.pauseStartTime = null;
    this.totalPausedTime = 0;
    this.recordingStartTime = null;
    this.lastInputValues.clear();
    this.lastInteractionId = null;
    this.pendingApiCalls.clear();

    console.log('TestSnapper: UI recording stopped successfully');
  }

  getActiveRecordingTime() {
    if (!this.recordingStartTime) return 0;

    const currentTime = Date.now();
    const totalTime = currentTime - this.recordingStartTime;
    let pausedTime = this.totalPausedTime;

    // If currently paused, add current pause duration
    if (this.isPaused && this.pauseStartTime) {
      pausedTime += currentTime - this.pauseStartTime;
    }

    return Math.max(0, totalTime - pausedTime);
  }

  getRelativeTime() {
    return this.getActiveRecordingTime();
  }

  addEventListeners() {
    this.addClickListener();
    this.addInputListener();
    this.addNavigationListener();
    this.addScrollListener();
    this.addFormSubmissionListener();
    this.addKeyboardListener();
  }

  // ========== Event Listeners ==========

  addClickListener() {
    const handler = (event) => {
      if (!this.isRecording || this.isPaused) return;

      const element = event.target;
      const selector = this.generateSelector(element);

      // Skip click recording if it's on an input field that's being typed in
      if (['INPUT', 'TEXTAREA'].includes(element.tagName) &&
        ['text', 'email', 'password', 'search', 'url'].includes(element.type)) {
        return;
      }

      const interaction = {
        type: 'click',
        selector,
        tagName: element.tagName.toLowerCase(),
        text: element.textContent?.trim().substring(0, 100) || '',
        coordinates: { x: event.clientX, y: event.clientY },
        attributes: this.getElementAttributes(element),
        timestamp: Date.now(),
        relativeTime: this.getRelativeTime()
      };

      this.recordInteraction(interaction);
      this.lastInteractionId = interaction.id;

      // Trigger screenshot only if settings allow
      if (this.settings.autoScreenshot) {
        setTimeout(() => {
          this.triggerScreenshot({
            type: 'interaction',
            interactionType: 'click',
            interactionId: interaction.id
          });
        }, 100);
      }

      console.log('Captured click interaction:', interaction);
    };

    document.addEventListener('click', handler, true);
    this._storeListener(document, 'click', handler);
  }

  addInputListener() {
    // Use configurable time frame for debouncing
    const inputHandler = (event) => {
      if (!this.isRecording || this.isPaused) return;

      const element = event.target;
      if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) return;

      const selector = this.generateSelector(element);
      const elementKey = `${selector}_${element.tagName}`;

      // Clear existing timer for this element
      if (this.inputDebounceTimers.has(elementKey)) {
        clearTimeout(this.inputDebounceTimers.get(elementKey));
      }

      // Set new debounced timer with configurable delay
      const timer = setTimeout(() => {
        this.recordInputInteraction(element, 'input');
        this.inputDebounceTimers.delete(elementKey);
      }, this.inputDebounceDelay); // Use configurable time frame

      this.inputDebounceTimers.set(elementKey, timer);
    };

    const changeHandler = (event) => {
      if (!this.isRecording || this.isPaused) return;

      const element = event.target;
      if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) return;

      const selector = this.generateSelector(element);
      const elementKey = `${selector}_${element.tagName}`;

      // Clear any pending debounced input for this element
      if (this.inputDebounceTimers.has(elementKey)) {
        clearTimeout(this.inputDebounceTimers.get(elementKey));
        this.inputDebounceTimers.delete(elementKey);
      }

      // Record immediately on change
      this.recordInputInteraction(element, 'change');
    };

    const blurHandler = (event) => {
      if (!this.isRecording || this.isPaused) return;

      const element = event.target;
      if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) return;

      const selector = this.generateSelector(element);
      const elementKey = `${selector}_${element.tagName}`;

      // Clear any pending debounced input for this element
      if (this.inputDebounceTimers.has(elementKey)) {
        clearTimeout(this.inputDebounceTimers.get(elementKey));
        this.inputDebounceTimers.delete(elementKey);
      }

      // Record the final value on blur
      this.recordInputInteraction(element, 'blur');
    };

    document.addEventListener('input', inputHandler, true);
    document.addEventListener('change', changeHandler, true);
    document.addEventListener('blur', blurHandler, true);

    this._storeListener(document, 'input', inputHandler);
    this._storeListener(document, 'change', changeHandler);
    this._storeListener(document, 'blur', blurHandler);
  }

  recordInputInteraction(element, triggerType) {
    const selector = this.generateSelector(element);
    const elementKey = `${selector}_${element.tagName}`;

    let value = element.value;

    // Always redact password fields
    if (element.type && element.type.toLowerCase() === 'password') {
      value = '[REDACTED]';
    } else {
      value = this.sanitizeValue(value);
    }

    // Check if value has changed since last recording
    const lastValue = this.lastInputValues.get(elementKey);
    if (lastValue === value && value !== '[REDACTED]') {
      console.log('Input value unchanged, skipping recording:', selector);
      return;
    }

    // Update last recorded value
    this.lastInputValues.set(elementKey, value);

    const interaction = {
      type: 'input',
      selector,
      tagName: element.tagName.toLowerCase(),
      inputType: element.type || 'text',
      value,
      attributes: this.getElementAttributes(element),
      timestamp: Date.now(),
      relativeTime: this.getRelativeTime(),
      triggerType: triggerType,
      timeFrame: `${this.inputDebounceDelay / 1000}s` // Show time frame used
    };

    this.recordInteraction(interaction);
    this.lastInteractionId = interaction.id;

    // Trigger screenshot only if settings allow
    if (this.settings.autoScreenshot) {
      setTimeout(() => {
        this.triggerScreenshot({
          type: 'interaction',
          interactionType: 'input',
          interactionId: interaction.id
        });
      }, 100);
    }

    console.log('Captured input interaction:', interaction);
  }

  addFormSubmissionListener() {
    const submitHandler = (event) => {
      if (!this.isRecording || this.isPaused) return;

      const form = event.target;
      if (form.tagName !== 'FORM') return;

      const selector = this.generateSelector(form);

      // Capture form data (sanitized)
      const formData = new FormData(form);
      const formValues = {};

      for (let [key, value] of formData.entries()) {
        // Redact sensitive field names
        if (/password|secret|token|api[_-]?key/i.test(key)) {
          formValues[key] = '[REDACTED]';
        } else {
          formValues[key] = this.sanitizeValue(value);
        }
      }

      const interaction = {
        type: 'form_submit',
        selector,
        action: form.action || window.location.href,
        method: form.method || 'GET',
        formData: formValues,
        timestamp: Date.now(),
        relativeTime: this.getRelativeTime()
      };

      this.recordInteraction(interaction);
      this.lastInteractionId = interaction.id;

      // Trigger screenshot only if settings allow
      if (this.settings.autoScreenshot) {
        setTimeout(() => {
          this.triggerScreenshot({
            type: 'interaction',
            interactionType: 'form_submit',
            interactionId: interaction.id
          });
        }, 100);
      }

      console.log('Captured form submission:', interaction);
    };

    document.addEventListener('submit', submitHandler, true);
    this._storeListener(document, 'submit', submitHandler);
  }

  addNavigationListener() {
    const beforeUnloadHandler = () => {
      if (!this.isRecording || this.isPaused) return;

      const interaction = {
        type: 'navigation',
        from: window.location.href,
        timestamp: Date.now(),
        relativeTime: this.getRelativeTime()
      };

      this.recordInteraction(interaction);
      this.lastInteractionId = interaction.id;
      console.log('Captured navigation:', interaction);
    };

    window.addEventListener('beforeunload', beforeUnloadHandler);
    this._storeListener(window, 'beforeunload', beforeUnloadHandler);

    // SPA navigation
    let currentUrl = window.location.href;
    const urlChangeHandler = () => {
      if (!this.isRecording || this.isPaused) return;

      const newUrl = window.location.href;
      if (newUrl !== currentUrl) {
        const interaction = {
          type: 'url_change',
          from: currentUrl,
          to: newUrl,
          timestamp: Date.now(),
          relativeTime: this.getRelativeTime()
        };

        this.recordInteraction(interaction);
        this.lastInteractionId = interaction.id;

        // Trigger screenshot only if settings allow
        if (this.settings.autoScreenshot) {
          setTimeout(() => {
            this.triggerScreenshot({
              type: 'interaction',
              interactionType: 'url_change',
              interactionId: interaction.id
            });
          }, 500); // Longer delay for page load
        }

        console.log('Captured URL change:', interaction);
        currentUrl = newUrl;
      }
    };

    // Save originals and override
    this.originalPushState = history.pushState;
    this.originalReplaceState = history.replaceState;
    const self = this;

    history.pushState = function (...args) {
      self.originalPushState.apply(history, args);
      setTimeout(urlChangeHandler, 0);
    };

    history.replaceState = function (...args) {
      self.originalReplaceState.apply(history, args);
      setTimeout(urlChangeHandler, 0);
    };

    window.addEventListener('popstate', urlChangeHandler);
    this._storeListener(window, 'popstate', urlChangeHandler);
  }

  addScrollListener() {
    let scrollTimeout;
    let lastScrollY = window.scrollY;

    const scrollHandler = () => {
      if (!this.isRecording || this.isPaused) return;

      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        const currentScrollY = window.scrollY;
        const scrollDelta = Math.abs(currentScrollY - lastScrollY);

        // Only record significant scroll movements (more than 100px)
        if (scrollDelta > 100) {
          const interaction = {
            type: 'scroll',
            scrollX: window.scrollX,
            scrollY: currentScrollY,
            scrollDelta: scrollDelta,
            documentHeight: document.documentElement.scrollHeight,
            viewportHeight: window.innerHeight,
            timestamp: Date.now(),
            relativeTime: this.getRelativeTime()
          };

          this.recordInteraction(interaction);
          this.lastInteractionId = interaction.id;
          console.log('Captured scroll interaction:', interaction);
          lastScrollY = currentScrollY;
        }
      }, 500);
    };

    window.addEventListener('scroll', scrollHandler);
    this._storeListener(window, 'scroll', scrollHandler);
  }

  addKeyboardListener() {
    const keyHandler = (event) => {
      if (!this.isRecording || this.isPaused) return;

      // Only record important navigation and function keys
      const importantKeys = [
        'Enter', 'Tab', 'Escape', 'Backspace', 'Delete',
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
        'Home', 'End', 'PageUp', 'PageDown'
      ];

      const isModifierCombo = (event.ctrlKey || event.altKey || event.metaKey) &&
        event.key !== 'Control' && event.key !== 'Alt' && event.key !== 'Meta';

      if (importantKeys.includes(event.key) || isModifierCombo) {
        const interaction = {
          type: 'keypress',
          key: event.key,
          code: event.code,
          ctrlKey: event.ctrlKey,
          altKey: event.altKey,
          shiftKey: event.shiftKey,
          metaKey: event.metaKey,
          target: this.generateSelector(event.target),
          timestamp: Date.now(),
          relativeTime: this.getRelativeTime()
        };

        this.recordInteraction(interaction);
        this.lastInteractionId = interaction.id;
        console.log('Captured key interaction:', interaction);
      }
    };

    document.addEventListener('keydown', keyHandler, true);
    this._storeListener(document, 'keydown', keyHandler);
  }

  // ========== Screenshot Handling ==========

  triggerScreenshot(context) {
    // Allow screenshots even when paused if forced
    if (!this.isRecording && !context.forced) {
      console.log('Not recording and not forced, skipping screenshot');
      return;
    }

    // Check auto-screenshot setting only for automatic screenshots
    if (!context.forced && !this.settings.autoScreenshot) {
      console.log('Auto-screenshot disabled, skipping automatic screenshot');
      return;
    }

    chrome.runtime.sendMessage({
      type: 'CAPTURE_SCREENSHOT',
      data: {
        type: context.forced ? 'manual_capture' : 'auto_capture',
        manual: context.forced || false,
        timestamp: Date.now(),
        context: context
      }
    }, (response) => {
      if (response && response.success) {
        console.log('Screenshot captured successfully:', context.forced ? 'manual' : 'auto');
      } else {
        console.error('Screenshot failed:', response?.reason || 'Unknown error');
      }
    });
  }

  // ========== Listener Map Helpers ==========

  _storeListener(element, type, handler) {
    if (!this.listeners.has(element)) {
      this.listeners.set(element, {});
    }
    this.listeners.get(element)[type] = handler;
  }

  // ========== Helpers ==========

  generateSelector(element) {
    if (element.id) return `#${element.id}`;

    if (element.className && typeof element.className === 'string') {
      const classes = element.className.trim().split(/\s+/).filter(c => c);
      if (classes.length > 0) {
        const selector = `${element.tagName.toLowerCase()}.${classes.join('.')}`;
        if (document.querySelectorAll(selector).length === 1) return selector;
      }
    }

    // Try data attributes
    for (const attr of element.attributes) {
      if (attr.name.startsWith('data-') && attr.value) {
        const selector = `${element.tagName.toLowerCase()}[${attr.name}="${attr.value}"]`;
        if (document.querySelectorAll(selector).length === 1) return selector;
      }
    }

    // Generate path-based selector
    const path = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body) {
      let selector = current.tagName.toLowerCase();

      if (current.id) {
        selector += `#${current.id}`;
        path.unshift(selector);
        break;
      }

      const siblings = Array.from(current.parentNode?.children || []);
      const sameTagSiblings = siblings.filter(s => s.tagName === current.tagName);

      if (sameTagSiblings.length > 1) {
        const index = sameTagSiblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }

      path.unshift(selector);
      current = current.parentElement;
    }

    return path.join(' > ');
  }

  getElementAttributes(element) {
    const attrs = {};
    const importantAttrs = ['id', 'class', 'name', 'type', 'value', 'href', 'src', 'alt', 'title', 'placeholder'];

    for (const attr of importantAttrs) {
      if (element.hasAttribute(attr)) {
        attrs[attr] = element.getAttribute(attr);
      }
    }

    return attrs;
  }

  sanitizeValue(value) {
    if (!value) return '';

    if (typeof value === 'string') {
      // Don't record secrets in values
      if (value.length > 0 && /password|secret|token|api[_-]?key/i.test(value)) {
        return '[REDACTED]';
      }
      return value.length > 500 ? value.substring(0, 500) + '...' : value;
    }

    return value;
  }

  recordInteraction(interaction) {
    // Add unique ID to interaction
    interaction.id = `interaction_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    chrome.runtime.sendMessage({
      type: 'RECORD_INTERACTION',
      data: interaction
    });
  }
}

// Initialize recorder
new TestSnapperRecorder();