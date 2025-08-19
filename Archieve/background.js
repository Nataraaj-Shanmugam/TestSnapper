// base-classes.js - Base classes that v1.1 extends from

// Base Background Service Worker Class
class TestSnapperBackground {
  constructor() {
    this.currentSession = null;
    this.currentTabId = null;
    this.sessions = [];
    this.settings = this.getDefaultSettings();
    
    this.init();
  }

  async init() {
    // Initialize chrome message listeners
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // Keep message channel open for async responses
    });

    // Load stored data
    await this.loadSessions();
    await this.loadSettings();
    
    console.log('TestSnapper background service initialized');
  }

  async handleMessage(message, sender, sendResponse) {
    const { type } = message;
    
    try {
      switch (type) {
        case 'GET_RECORDING_STATUS':
          sendResponse({
            isRecording: !!this.currentSession,
            isPaused: this.currentSession?.isPaused || false,
            startTime: this.currentSession?.startTime,
            sessionId: this.currentSession?.id
          });
          break;

        case 'START_RECORDING':
          const sessionId = await this.startRecording(sender.tab);
          sendResponse({ success: true, sessionId });
          break;

        case 'PAUSE_RECORDING':
          await this.pauseRecording();
          sendResponse({ success: true });
          break;

        case 'RESUME_RECORDING':
          await this.resumeRecording();
          sendResponse({ success: true });
          break;

        case 'STOP_RECORDING':
          await this.stopRecording();
          sendResponse({ success: true });
          break;

        case 'RECORD_INTERACTION':
          await this.recordInteraction(message.data);
          sendResponse({ success: true });
          break;

        case 'CAPTURE_SCREENSHOT':
          const screenshot = await this.captureScreenshot(message.data);
          sendResponse(screenshot);
          break;

        case 'GET_SESSIONS':
          sendResponse({ sessions: this.sessions });
          break;

        case 'DELETE_SESSIONS':
          await this.deleteSessions(message.ids);
          sendResponse({ success: true });
          break;

        case 'CLEAR_ALL_SESSIONS':
          await this.clearAllSessions();
          sendResponse({ success: true });
          break;

        case 'EXPORT_SESSION':
          const exportData = await this.exportSession(message.sessionId, message.format);
          sendResponse({ exportData });
          break;

        case 'GET_SETTINGS':
          sendResponse({ settings: this.settings });
          break;

        case 'UPDATE_SETTINGS':
          await this.updateSettings(message.settings);
          sendResponse({ success: true });
          break;

        default:
          console.warn('Unknown message type:', type);
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  async startRecording(tab) {
    if (this.currentSession) {
      await this.stopRecording();
    }

    const sessionId = this.generateSessionId();
    this.currentSession = {
      id: sessionId,
      name: `Session ${new Date().toLocaleString()}`,
      url: tab.url,
      startTime: Date.now(),
      endTime: null,
      duration: 0,
      activeDuration: 0,
      isPaused: false,
      pauseStartTime: null,
      totalPausedTime: 0,
      interactions: [],
      screenshots: [],
      consoleMessages: [],
      networkCalls: [],
      errors: [],
      apiFailures: []
    };

    this.currentTabId = tab.id;

    // Inject content scripts
    await this.injectContentScripts(tab.id);

    // Add session start interaction
    await this.recordInteraction({
      type: 'session_start',
      timestamp: Date.now(),
      url: tab.url,
      title: tab.title
    });

    return sessionId;
  }

  async pauseRecording() {
    if (!this.currentSession || this.currentSession.isPaused) return;

    this.currentSession.isPaused = true;
    this.currentSession.pauseStartTime = Date.now();

    await this.recordInteraction({
      type: 'session_pause',
      timestamp: Date.now()
    });
  }

  async resumeRecording() {
    if (!this.currentSession || !this.currentSession.isPaused) return;

    const pauseDuration = Date.now() - this.currentSession.pauseStartTime;
    this.currentSession.totalPausedTime += pauseDuration;
    this.currentSession.isPaused = false;
    this.currentSession.pauseStartTime = null;

    await this.recordInteraction({
      type: 'session_resume',
      timestamp: Date.now(),
      pauseDuration
    });
  }

  async stopRecording() {
    if (!this.currentSession) return;

    // Calculate final duration
    const endTime = Date.now();
    this.currentSession.endTime = endTime;
    this.currentSession.duration = endTime - this.currentSession.startTime;
    
    if (this.currentSession.isPaused) {
      this.currentSession.totalPausedTime += endTime - this.currentSession.pauseStartTime;
    }
    
    this.currentSession.activeDuration = this.currentSession.duration - this.currentSession.totalPausedTime;

    // Add session end interaction
    await this.recordInteraction({
      type: 'session_end',
      timestamp: endTime,
      duration: this.currentSession.duration,
      activeDuration: this.currentSession.activeDuration
    });

    // Save session
    await this.saveSession(this.currentSession);

    // Reset current session
    this.currentSession = null;
    this.currentTabId = null;
  }

  async recordInteraction(data) {
    if (!this.currentSession) return;

    const interaction = {
      id: this.generateInteractionId(),
      sessionId: this.currentSession.id,
      timestamp: data.timestamp || Date.now(),
      relativeTime: Date.now() - this.currentSession.startTime,
      ...data
    };

    this.currentSession.interactions.push(interaction);
  }

  async captureScreenshot(data = {}) {
    if (!this.currentTabId) {
      return { success: false, reason: 'No active tab' };
    }

    try {
      const screenshot = await chrome.tabs.captureVisibleTab(null, {
        format: 'png',
        quality: this.settings.screenshotQuality * 100
      });

      const screenshotData = {
        id: this.generateScreenshotId(),
        timestamp: Date.now(),
        dataUrl: screenshot,
        type: data.type || 'manual',
        ...data
      };

      if (this.currentSession) {
        this.currentSession.screenshots.push(screenshotData);
      }

      return { success: true, screenshot: screenshotData };
    } catch (error) {
      console.error('Screenshot capture failed:', error);
      return { success: false, reason: error.message };
    }
  }

  async injectContentScripts(tabId) {
    try {
      // Inject main content script if not already injected
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content.js']
      });

      // Inject page script
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/injected.js']
      });

    } catch (error) {
      console.warn('Failed to inject content scripts:', error);
    }
  }

  async saveSession(session) {
    // Add to sessions array
    this.sessions.unshift(session);

    // Keep only recent sessions (limit to prevent storage bloat)
    if (this.sessions.length > 100) {
      this.sessions = this.sessions.slice(0, 100);
    }

    // Save to storage
    await chrome.storage.local.set({
      testSnapperSessions: this.sessions
    });
  }

  async loadSessions() {
    try {
      const result = await chrome.storage.local.get('testSnapperSessions');
      if (result.testSnapperSessions) {
        this.sessions = result.testSnapperSessions;
      }
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  }

  async getSessions() {
    return this.sessions;
  }

  async deleteSessions(sessionIds) {
    this.sessions = this.sessions.filter(s => !sessionIds.includes(s.id));
    await chrome.storage.local.set({
      testSnapperSessions: this.sessions
    });
  }

  async clearAllSessions() {
    this.sessions = [];
    await chrome.storage.local.set({
      testSnapperSessions: []
    });
  }

  async exportSession(sessionId, format = 'txt') {
    const session = this.sessions.find(s => s.id === sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    switch (format.toLowerCase()) {
      case 'txt':
        return this.exportAsTxt(session);
      case 'csv':
        return this.exportAsCsv(session);
      case 'json':
        return this.exportAsJson(session);
      case 'docx':
        return this.exportAsDocx(session);
      default:
        throw new Error('Unsupported export format');
    }
  }

  exportAsTxt(session) {
    let content = `TestSnapper Session Report\n`;
    content += `${'='.repeat(40)}\n\n`;
    content += `Session: ${session.name}\n`;
    content += `URL: ${session.url}\n`;
    content += `Date: ${new Date(session.startTime).toLocaleString()}\n`;
    content += `Duration: ${Math.round(session.duration / 1000)}s\n`;
    content += `Steps: ${session.interactions.length}\n\n`;

    session.interactions.forEach((interaction, index) => {
      const stepNum = index + 1;
      const timeStamp = Math.round(interaction.relativeTime / 1000);
      content += `${stepNum}. [${timeStamp}s] ${this.getInteractionDescription(interaction)}\n`;
    });

    const filename = `${session.name.replace(/[^a-z0-9]/gi, '_')}.txt`;
    return {
      content,
      filename,
      mimeType: 'text/plain'
    };
  }

  exportAsCsv(session) {
    let csv = 'Step,Time,Description,Type,Selector,Value\n';
    
    session.interactions.forEach((interaction, index) => {
      const stepNum = index + 1;
      const timeStamp = Math.round(interaction.relativeTime / 1000);
      const description = this.getInteractionDescription(interaction).replace(/"/g, '""');
      const type = interaction.type || '';
      const selector = (interaction.selector || '').replace(/"/g, '""');
      const value = (interaction.value || '').replace(/"/g, '""');
      
      csv += `${stepNum},${timeStamp},"${description}","${type}","${selector}","${value}"\n`;
    });

    const filename = `${session.name.replace(/[^a-z0-9]/gi, '_')}.csv`;
    return {
      content: csv,
      filename,
      mimeType: 'text/csv'
    };
  }

  exportAsJson(session) {
    const exportData = {
      meta: {
        sessionName: session.name,
        url: session.url,
        startTime: session.startTime,
        duration: session.duration,
        exportedAt: new Date().toISOString()
      },
      interactions: session.interactions,
      screenshots: session.screenshots,
      errors: session.errors,
      apiFailures: session.apiFailures
    };

    const filename = `${session.name.replace(/[^a-z0-9]/gi, '_')}.json`;
    return {
      content: JSON.stringify(exportData, null, 2),
      filename,
      mimeType: 'application/json'
    };
  }

  exportAsDocx(session) {
    // Simple HTML export (would need docx library for real DOCX)
    let html = `
      <html>
        <head>
          <title>${session.name}</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 40px; }
            h1 { color: #333; }
            .step { margin-bottom: 10px; }
          </style>
        </head>
        <body>
          <h1>${session.name}</h1>
          <p><strong>URL:</strong> ${session.url}</p>
          <p><strong>Date:</strong> ${new Date(session.startTime).toLocaleString()}</p>
          <h2>Steps:</h2>
    `;

    session.interactions.forEach((interaction, index) => {
      const stepNum = index + 1;
      const timeStamp = Math.round(interaction.relativeTime / 1000);
      html += `<div class="step">${stepNum}. [${timeStamp}s] ${this.getInteractionDescription(interaction)}</div>`;
    });

    html += `
        </body>
      </html>
    `;

    const filename = `${session.name.replace(/[^a-z0-9]/gi, '_')}.html`;
    return {
      content: html,
      filename,
      mimeType: 'text/html'
    };
  }

  getInteractionDescription(interaction) {
    switch (interaction.type) {
      case 'click':
        return `Click ${interaction.text || interaction.selector || 'element'}`;
      case 'input':
        return `Enter text in ${interaction.selector || 'input field'}`;
      case 'form_submit':
        return 'Submit form';
      case 'url_change':
        return `Navigate to ${interaction.url || 'new page'}`;
      case 'scroll':
        return 'Scroll page';
      case 'session_start':
        return 'Start recording session';
      case 'session_end':
        return 'End recording session';
      case 'session_pause':
        return 'Pause recording';
      case 'session_resume':
        return 'Resume recording';
      default:
        return `Perform ${interaction.type} action`;
    }
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.local.get('testSnapperSettings');
      if (result.testSnapperSettings) {
        this.settings = { ...this.settings, ...result.testSnapperSettings };
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  async updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    await chrome.storage.local.set({
      testSnapperSettings: this.settings
    });
  }

  getDefaultSettings() {
    return {
      autoScreenshot: true,
      screenshotQuality: 0.8,
      redactionPatterns: 'password,ssn,credit,email',
      inputTimeFrame: 1500,
      darkMode: false,
      defaultExportFormat: 'txt',
      autoClearDays: 30
    };
  }

  generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  generateInteractionId() {
    return `interaction_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  generateScreenshotId() {
    return `screenshot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

// Base Content Script Recorder Class
class TestSnapperRecorder {
  constructor() {
    this.isRecording = false;
    this.isPaused = false;
    this.sessionId = null;
    this.startTime = null;
    this.lastInteractionTime = 0;
    this.inputTimeFrame = 1500;
    this.pendingInputs = new Map();
    
    this.init();
  }

  init() {
    this.setupMessageHandler();
    this.setupEventListeners();
    this.requestStatus();
  }

  setupMessageHandler() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this._handleMessage(message, sendResponse);
      return true;
    });
  }

  _handleMessage(message, sendResponse) {
    const { type } = message;

    switch (type) {
      case 'START_RECORDING':
        this.start();
        sendResponse({ success: true });
        break;

      case 'PAUSE_RECORDING':
        this.pause();
        sendResponse({ success: true });
        break;

      case 'RESUME_RECORDING':
        this.resume();
        sendResponse({ success: true });
        break;

      case 'STOP_RECORDING':
        this.stop();
        sendResponse({ success: true });
        break;

      case 'GET_RECORDING_STATUS':
        sendResponse({
          isRecording: this.isRecording,
          isPaused: this.isPaused,
          sessionId: this.sessionId,
          startTime: this.startTime
        });
        break;

      case 'CAPTURE_SCREENSHOT':
        this._recordInteraction({
          type: 'screenshot',
          manual: true,
          ...message.data
        });
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ success: false, error: 'Unknown message type' });
    }
  }

  setupEventListeners() {
    // Click events
    document.addEventListener('click', (e) => {
      if (!this.shouldRecord()) return;
      
      this._recordInteraction({
        type: 'click',
        target: this.getElementInfo(e.target),
        selector: this.getSelector(e.target),
        text: this.getElementText(e.target),
        coordinates: { x: e.clientX, y: e.clientY }
      });
    }, true);

    // Input events
    document.addEventListener('input', (e) => {
      if (!this.shouldRecord()) return;
      this.handleInputEvent(e);
    }, true);

    // Form submit events
    document.addEventListener('submit', (e) => {
      if (!this.shouldRecord()) return;
      
      this._recordInteraction({
        type: 'form_submit',
        target: this.getElementInfo(e.target),
        selector: this.getSelector(e.target),
        action: e.target.action || window.location.href,
        method: e.target.method || 'GET'
      });
    }, true);

    // Page navigation
    let currentUrl = window.location.href;
    const checkUrlChange = () => {
      if (currentUrl !== window.location.href) {
        if (this.shouldRecord()) {
          this._recordInteraction({
            type: 'url_change',
            fromUrl: currentUrl,
            toUrl: window.location.href,
            title: document.title
          });
        }
        currentUrl = window.location.href;
      }
    };

    // Check for URL changes (for SPA navigation)
    setInterval(checkUrlChange, 1000);

    // Scroll events (throttled)
    let scrollTimeout;
    document.addEventListener('scroll', () => {
      if (!this.shouldRecord()) return;
      
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        this._recordInteraction({
          type: 'scroll',
          scrollTop: document.documentElement.scrollTop,
          scrollLeft: document.documentElement.scrollLeft
        });
      }, 250);
    }, { passive: true });
  }

  handleInputEvent(e) {
    const target = e.target;
    if (!target || target.nodeType !== Node.ELEMENT_NODE) return;

    const selector = this.getSelector(target);
    const value = this.redactSensitiveData(target.value || '');
    
    // Clear existing timeout for this element
    if (this.pendingInputs.has(selector)) {
      clearTimeout(this.pendingInputs.get(selector).timeout);
    }

    // Set new timeout to group rapid inputs
    const timeout = setTimeout(() => {
      this._recordInteraction({
        type: 'input',
        target: this.getElementInfo(target),
        selector: selector,
        value: value,
        inputType: target.type || 'text'
      });
      this.pendingInputs.delete(selector);
    }, this.inputTimeFrame);

    this.pendingInputs.set(selector, { timeout, value });
  }

  shouldRecord() {
    return this.isRecording && !this.isPaused;
  }

  async _recordInteraction(interaction, suppressAutoShot = false, autoShotDelayMs = 100) {
    if (!this.shouldRecord()) return;

    const interactionData = {
      ...interaction,
      timestamp: Date.now(),
      url: window.location.href,
      title: document.title
    };

    // Send to background script
    chrome.runtime.sendMessage({
      type: 'RECORD_INTERACTION',
      data: interactionData
    });

    this.lastInteractionTime = Date.now();
  }

  getElementInfo(element) {
    if (!element) return null;

    return {
      tagName: element.tagName?.toLowerCase(),
      id: element.id || null,
      className: element.className || null,
      name: element.name || null,
      type: element.type || null,
      placeholder: element.placeholder || null,
      value: this.redactSensitiveData(element.value || ''),
      text: this.getElementText(element),
      attributes: this.getRelevantAttributes(element)
    };
  }

  getElementText(element) {
    if (!element) return '';
    
    // For buttons, links, labels
    if (element.textContent) {
      return element.textContent.trim().slice(0, 100);
    }
    
    // For inputs with labels
    const label = element.labels?.[0] || 
                  document.querySelector(`label[for="${element.id}"]`);
    if (label) {
      return label.textContent.trim().slice(0, 100);
    }

    return '';
  }

  getSelector(element) {
    if (!element) return '';

    // Try ID first
    if (element.id) {
      return `#${element.id}`;
    }

    // Try data attributes
    for (const attr of element.attributes) {
      if (attr.name.startsWith('data-testid') || 
          attr.name.startsWith('data-test') ||
          attr.name.startsWith('data-cy')) {
        return `[${attr.name}="${attr.value}"]`;
      }
    }

    // Try name attribute
    if (element.name) {
      return `[name="${element.name}"]`;
    }

    // Generate CSS selector
    const path = [];
    let current = element;

    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let selector = current.tagName.toLowerCase();
      
      if (current.className) {
        const classes = current.className.split(/\s+/).filter(c => c.length > 0);
        if (classes.length > 0) {
          selector += '.' + classes.slice(0, 2).join('.');
        }
      }

      path.unshift(selector);
      current = current.parentElement;

      // Stop at reasonable depth
      if (path.length >= 5) break;
    }

    return path.join(' > ');
  }

  getRelevantAttributes(element) {
    const relevant = ['id', 'name', 'type', 'placeholder', 'aria-label', 'title'];
    const attributes = {};

    relevant.forEach(attr => {
      if (element.hasAttribute(attr)) {
        attributes[attr] = element.getAttribute(attr);
      }
    });

    return attributes;
  }

  redactSensitiveData(value) {
    if (typeof value !== 'string') return value;

    const patterns = ['password', 'ssn', 'credit', 'email'];
    const shouldRedact = patterns.some(pattern => 
      value.toLowerCase().includes(pattern) ||
      document.activeElement?.name?.toLowerCase().includes(pattern) ||
      document.activeElement?.placeholder?.toLowerCase().includes(pattern)
    );

    return shouldRedact ? '[REDACTED]' : value;
  }

  requestStatus() {
    chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATUS' }, (response) => {
      if (response) {
        this.isRecording = response.isRecording || false;
        this.isPaused = response.isPaused || false;
        this.sessionId = response.sessionId;
        this.startTime = response.startTime;
      }
    });
  }

  start() {
    this.isRecording = true;
    this.isPaused = false;
    this.startTime = Date.now();
    console.log('TestSnapper recording started');
  }

  pause() {
    this.isPaused = true;
    console.log('TestSnapper recording paused');
  }

  resume() {
    this.isPaused = false;
    console.log('TestSnapper recording resumed');
  }

  stop() {
    this.isRecording = false;
    this.isPaused = false;
    this.sessionId = null;
    this.startTime = null;
    
    // Clear pending inputs
    this.pendingInputs.forEach(input => clearTimeout(input.timeout));
    this.pendingInputs.clear();
    
    console.log('TestSnapper recording stopped');
  }
}

// Initialize if not already done
if (typeof window !== 'undefined' && !window.testSnapperRecorder) {
  window.testSnapperRecorder = new TestSnapperRecorder();
}