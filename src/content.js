// Content script for UI interaction recording with pause/resume functionality
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
    this.init();
  }

  init() {
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
          // Still add listeners but mark as paused
          this.addEventListeners();
        }
      }
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

      case 'GET_PAUSE_STATUS':
        sendResponse({ 
          isPaused: this.isPaused,
          isRecording: this.isRecording,
          totalPausedTime: this.totalPausedTime
        });
        break;
    }
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
    
    // Record session start event
    this.recordInteraction({
      type: 'session_start',
      url: window.location.href,
      timestamp: Date.now(),
      userAgent: navigator.userAgent,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight
      }
    });

    console.log('TestSnapper: UI recording started successfully');
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
    
    // Record pause event
    this.recordInteraction({
      type: 'session_pause',
      timestamp: this.pauseStartTime,
      activeTime: this.getActiveRecordingTime()
    });

    // Don't remove listeners, just stop recording interactions
    // This way we can resume quickly without re-adding all listeners
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
    this.recordInteraction({
      type: 'session_resume',
      timestamp: resumeTime,
      pausedDuration: pausedDuration,
      totalPausedTime: this.totalPausedTime,
      activeTime: this.getActiveRecordingTime()
    });

    // Listeners should still be active, just update the pause state
    // If for some reason listeners were removed, re-add them
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

    // If we're paused, calculate final paused time
    if (this.isPaused && this.pauseStartTime) {
      this.totalPausedTime += Date.now() - this.pauseStartTime;
    }

    // Record session end event
    const endTime = Date.now();
    this.recordInteraction({
      type: 'session_end',
      timestamp: endTime,
      totalDuration: endTime - this.recordingStartTime,
      activeDuration: this.getActiveRecordingTime(),
      totalPausedTime: this.totalPausedTime
    });

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

    // Reset timing variables
    this.pauseStartTime = null;
    this.totalPausedTime = 0;
    this.recordingStartTime = null;

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
    this.addHoverListener();
    this.addKeyboardListener();
  }

  // ========== Event Listeners ==========

  addClickListener() {
    const handler = (event) => {
      if (!this.isRecording || this.isPaused) return;
      
      const element = event.target;
      const selector = this.generateSelector(element);

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
      
      console.log('Captured interaction:', interaction);
      this.recordInteraction(interaction);
    };
    
    document.addEventListener('click', handler, true);
    this._storeListener(document, 'click', handler);
  }

  addInputListener() {
    const inputHandler = (event) => {
      if (!this.isRecording || this.isPaused) return;
      
      const element = event.target;
      if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) return;
      
      const selector = this.generateSelector(element);
      let value = element.value;
      
      // Always redact password fields!
      if (element.type && element.type.toLowerCase() === 'password') {
        value = '[REDACTED]';
      } else {
        value = this.sanitizeValue(value);
      }
      
      const interaction = {
        type: 'input',
        selector,
        tagName: element.tagName.toLowerCase(),
        inputType: element.type || 'text',
        value,
        attributes: this.getElementAttributes(element),
        timestamp: Date.now(),
        relativeTime: this.getRelativeTime()
      };
      
      console.log('Captured interaction:', interaction);
      this.recordInteraction(interaction);
    };

    const changeHandler = (event) => {
      if (!this.isRecording || this.isPaused) return;
      
      const element = event.target;
      if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) return;
      
      const selector = this.generateSelector(element);
      let value = element.value;
      
      if (element.type && element.type.toLowerCase() === 'password') {
        value = '[REDACTED]';
      } else {
        value = this.sanitizeValue(value);
      }
      
      const interaction = {
        type: 'change',
        selector,
        tagName: element.tagName.toLowerCase(),
        inputType: element.type || 'text',
        value,
        attributes: this.getElementAttributes(element),
        timestamp: Date.now(),
        relativeTime: this.getRelativeTime()
      };
      
      console.log('Captured interaction:', interaction);
      this.recordInteraction(interaction);
    };

    document.addEventListener('input', inputHandler, true);
    document.addEventListener('change', changeHandler, true);
    this._storeListener(document, 'input', inputHandler);
    this._storeListener(document, 'change', changeHandler);
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
      
      console.log('Captured interaction:', interaction);
      this.recordInteraction(interaction);
    };
    
    window.addEventListener('beforeunload', beforeUnloadHandler);
    this._storeListener(window, 'beforeunload', beforeUnloadHandler);

    // SPA navigation (pushState, replaceState, popstate)
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
        
        console.log('Captured interaction:', interaction);
        this.recordInteraction(interaction);
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
    const scrollHandler = () => {
      if (!this.isRecording || this.isPaused) return;
      
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        const interaction = {
          type: 'scroll',
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          documentHeight: document.documentElement.scrollHeight,
          viewportHeight: window.innerHeight,
          timestamp: Date.now(),
          relativeTime: this.getRelativeTime()
        };
        
        console.log('Captured interaction:', interaction);
        this.recordInteraction(interaction);
      }, 100);
    };
    
    window.addEventListener('scroll', scrollHandler);
    this._storeListener(window, 'scroll', scrollHandler);
  }

  addHoverListener() {
    let hoverTimeout;
    const hoverHandler = (event) => {
      if (!this.isRecording || this.isPaused) return;
      
      clearTimeout(hoverTimeout);
      hoverTimeout = setTimeout(() => {
        const element = event.target;
        const selector = this.generateSelector(element);
        
        const interaction = {
          type: 'hover',
          selector,
          tagName: element.tagName.toLowerCase(),
          text: element.textContent?.trim().substring(0, 50) || '',
          coordinates: { x: event.clientX, y: event.clientY },
          timestamp: Date.now(),
          relativeTime: this.getRelativeTime()
        };
        
        console.log('Captured interaction:', interaction);
        this.recordInteraction(interaction);
      }, 500);
    };
    
    document.addEventListener('mouseover', hoverHandler, true);
    this._storeListener(document, 'mouseover', hoverHandler);
  }

  addKeyboardListener() {
    const keyHandler = (event) => {
      if (!this.isRecording || this.isPaused) return;
      
      // Only record significant key events (not every character)
      const significantKeys = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete'];
      const isModifier = event.ctrlKey || event.altKey || event.metaKey || event.shiftKey;
      
      if (significantKeys.includes(event.key) || isModifier) {
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
        
        console.log('Captured interaction:', interaction);
        this.recordInteraction(interaction);
      }
    };
    
    document.addEventListener('keydown', keyHandler, true);
    this._storeListener(document, 'keydown', keyHandler);
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
    chrome.runtime.sendMessage({
      type: 'RECORD_INTERACTION',
      data: interaction
    });
  }
}

// Initialize recorder
new TestSnapperRecorder();