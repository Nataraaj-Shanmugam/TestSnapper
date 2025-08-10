// background.js — Fixed & Enhanced (issues 11–16)
// Preserves original behavior and structure, adds targeted fixes:
//
// - [11] Adds CLEANUP_OLD_SESSIONS message handler (returns deletedCount)
// - [12] Makes screenshot quality effective (uses JPEG when quality matters; PNG for "high")
// - [13] UPDATE_SETTINGS now injects content.js if needed and retries message
// - [14] getLastMeaningfulInteraction returns richer context (selector + text/value snippet)
// - [15] Network capture race-proofing: if response/error arrives before request, synthesize request
// - [16] Ensure API failures are pushed into session.apiFailures with timestamps
//
// Notes:
// • This is a drop-in replacement. It keeps your original message types & flow.
// • If your content script lives at a different path than 'src/content.js', update that constant below.

class TestSnapperBackground {
  constructor() {
    this.isRecording = false;
    this.isPaused = false;
    this.currentSession = null;
    this.tabNetworkData = new Map();
    this.currentTabId = null;
    this.pauseStartTime = null;
    this.totalPausedTime = 0;
    this.screenshotQueue = [];

    // Settings with defaults
    this.settings = {
      autoScreenshot: true,
      inputTimeFrame: 2000, // 2 seconds default
      screenshotQuality: 'medium', // low | medium | high
      redactionPatterns: 'password,secret,token,api_key',
      darkMode: false,
      defaultExportFormat: 'txt'
    };

    // Path to your content script (adjust if needed)
    this.CONTENT_SCRIPT_PATH = 'src/content.js';

    this.init();
  }

  async init() {
    console.log('TestSnapper Background Service Worker initialized');

    chrome.runtime.onInstalled.addListener(() => {
      console.log('TestSnapper extension installed');
      this.initializeStorage();
    });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // keep channel open for async responses
    });

    // Load settings on startup
    await this.loadSettings();

    // Auto-cleanup old sessions on startup
    await this.cleanupOldSessions();

    // Network listeners
    chrome.webRequest.onBeforeRequest.addListener(
      (details) => this.trackNetworkRequest(details),
      { urls: ["<all_urls>"] },
      ["requestBody"]
    );

    chrome.webRequest.onCompleted.addListener(
      (details) => this.trackNetworkResponse(details),
      { urls: ["<all_urls>"] },
      ["responseHeaders"]
    );

    chrome.webRequest.onErrorOccurred.addListener(
      (details) => this.trackNetworkError(details),
      { urls: ["<all_urls>"] }
    );

    chrome.tabs.onRemoved.addListener((tabId) => {
      if (this.currentTabId === tabId && this.isRecording) {
        console.log('Recorded tab closed, stopping recording');
        this.stopRecording();
      }
      this.tabNetworkData.delete(tabId);
    });

    // In init(), after your other listeners:
    chrome.commands.onCommand.addListener(async (command) => {
      try {
        switch (command) {
          case 'toggle-recording':
            if (this.isRecording) {
              await this.stopRecording();
            } else {
              const tab = await this.getActiveTab();
              if (!tab) throw new Error('No active tab');
              await this.startRecording(tab);
            }
            break;

          case 'pause-resume-recording':
            if (!this.isRecording) return;
            if (this.isPaused) {
              await this.resumeRecording();
            } else {
              await this.pauseRecording();
            }
            break;

          case 'take-screenshot':
            // Always allow manual capture, even when paused
            if (!this.isRecording) return;
            await this.captureScreenshot({ type: 'hotkey', manual: true, allowWhenPaused: true });
            break;
        }
      } catch (err) {
        console.warn('Command handling failed:', command, err);
      }
    });

  }

  // Add these helpers as class methods (outside init)
  async getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  }


  async initializeStorage() {
    try {
      const result = await chrome.storage.local.get(['sessions', 'settings']);
      if (!result.sessions) {
        await chrome.storage.local.set({ sessions: [] });
        console.log('Initialized empty sessions storage');
      }
      if (!result.settings) {
        await chrome.storage.local.set({ settings: this.settings });
        console.log('Initialized default settings');
      } else {
        this.settings = { ...this.settings, ...result.settings };
      }
    } catch (error) {
      console.error('Failed to initialize storage:', error);
    }
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.local.get(['settings']);
      if (result.settings) {
        this.settings = { ...this.settings, ...result.settings };
        console.log('Settings loaded:', this.settings);
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  }

  // Auto cleanup old sessions (older than 2 days by default)
  async cleanupOldSessions(cutoffTimeMs) {
    try {
      const result = await chrome.storage.local.get(['sessions']);
      const sessions = result.sessions || [];
      const cutoff = typeof cutoffTimeMs === 'number'
        ? cutoffTimeMs
        : (Date.now() - (2 * 24 * 60 * 60 * 1000)); // 2 days

      const validSessions = sessions.filter(session => {
        return session.startTime && session.startTime > cutoff;
      });

      if (validSessions.length !== sessions.length) {
        await chrome.storage.local.set({ sessions: validSessions });
        console.log(`Cleaned up ${sessions.length - validSessions.length} old sessions`);
      }
      return { deletedCount: sessions.length - validSessions.length };
    } catch (error) {
      console.error('Failed to cleanup old sessions:', error);
      return { deletedCount: 0, error: error.message };
    }
  }

  async handleMessage(message, sender, sendResponse) {
    try {
      switch (message.type) {
        case 'START_RECORDING': {
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          const activeTab = tabs[0];
          if (!activeTab) throw new Error('No active tab found');
          const sessionId = await this.startRecording(activeTab);
          sendResponse({ success: true, sessionId });
          break;
        }

        case 'PAUSE_RECORDING': {
          const sessionId = await this.pauseRecording();
          sendResponse({ success: true, sessionId });
          break;
        }

        case 'RESUME_RECORDING': {
          const sessionId = await this.resumeRecording();
          sendResponse({ success: true, sessionId });
          break;
        }

        case 'STOP_RECORDING': {
          const sessionId = await this.stopRecording();
          sendResponse({ success: true, sessionId });
          break;
        }

        case 'GET_RECORDING_STATUS': {
          const status = {
            isRecording: this.isRecording,
            isPaused: this.isPaused,
            currentSession: this.currentSession?.id || null,
            startTime: this.currentSession?.startTime,
            totalPausedTime: this.totalPausedTime
          };
          sendResponse(status);
          break;
        }

        case 'RECORD_INTERACTION': {
          if (this.isRecording && !this.isPaused) {
            const tab = sender.tab || { id: this.currentTabId, url: this.currentSession?.url || '' };
            await this.recordInteraction(message.data, tab);
          }
          sendResponse({ success: true });
          break;
        }

        case 'CAPTURE_SCREENSHOT': {
          // Allow screenshots during pause only if manual
          if (!this.isRecording) {
            sendResponse({ success: false, reason: 'Not recording' });
            break;
          }
          const isManualCapture = message.data?.manual === true;
          if (isManualCapture || (!this.isPaused && this.settings.autoScreenshot)) {
            await this.captureScreenshot(message.data);
            sendResponse({ success: true });
          } else if (this.isPaused && !isManualCapture) {
            sendResponse({ success: false, reason: 'Recording is paused' });
          } else {
            sendResponse({ success: false, reason: 'Auto-screenshot disabled' });
          }
          break;
        }

        case 'GET_SESSIONS': {
          const sessions = await this.getSessions();
          sendResponse({ sessions });
          break;
        }

        case 'DELETE_SESSIONS': {
          // supports message.sessionIds (old) or message.ids (new)
          await this.deleteSessions(message.sessionIds || message.ids || []);
          sendResponse({ success: true });
          break;
        }

        case 'CLEAR_ALL_SESSIONS': {
          await this.clearAllSessions();
          sendResponse({ success: true });
          break;
        }

        case 'GET_SETTINGS': {
          sendResponse({ settings: this.settings });
          break;
        }

        case 'UPDATE_SETTINGS': {
          await this.updateSettings(message.settings);
          sendResponse({ success: true });
          break;
        }

        case 'GET_LAST_MEANINGFUL_INTERACTION': {
          const lastInteraction = this.getLastMeaningfulInteraction();
          sendResponse({ interaction: lastInteraction });
          break;
        }

        case 'EXPORT_SESSION': {
          const exportData = await this.exportSession(message.sessionId, message.format || 'txt');
          if (exportData) {
            sendResponse({ exportData });
          } else {
            sendResponse({ success: false, error: 'Session not found' });
          }
          break;
        }

        // [11] CLEANUP_OLD_SESSIONS support from content.js
        case 'CLEANUP_OLD_SESSIONS': {
          const cutoffTime = typeof message.cutoffTime === 'number' ? message.cutoffTime : undefined;
          const { deletedCount, error } = await this.cleanupOldSessions(cutoffTime);
          sendResponse({ success: !error, deletedCount, error });
          break;
        }

        default:
          console.warn('Unknown message type:', message.type);
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('Error handling message:', message?.type, error);
      try { sendResponse({ success: false, error: error.message }); } catch { }
    }
    return true;
  }

  // [13] Robust settings update: try sendMessage; if it fails, inject content.js and retry
  async updateSettings(newSettings) {
    try {
      this.settings = { ...this.settings, ...newSettings };
      await chrome.storage.local.set({ settings: this.settings });

      if (this.currentTabId) {
        try {
          await chrome.tabs.sendMessage(this.currentTabId, {
            type: 'UPDATE_SETTINGS',
            settings: this.settings
          });
        } catch (err) {
          console.log('Content script likely not injected; injecting and retrying UPDATE_SETTINGS...');
          try {
            await chrome.scripting.executeScript({
              target: { tabId: this.currentTabId },
              files: [this.CONTENT_SCRIPT_PATH]
            });
            await new Promise(r => setTimeout(r, 100));
            await chrome.tabs.sendMessage(this.currentTabId, {
              type: 'UPDATE_SETTINGS',
              settings: this.settings
            });
          } catch (injectionErr) {
            console.warn('Failed to inject content script for UPDATE_SETTINGS:', injectionErr?.message);
          }
        }
      }

      console.log('Settings updated:', this.settings);
    } catch (error) {
      console.error('Failed to update settings:', error);
      throw error;
    }
  }

  // [14] Richer last-meaningful-interaction context (include value/text snippet)
  getLastMeaningfulInteraction() {
    if (!this.currentSession || !this.currentSession.interactions) {
      return null;
    }
    const meaningfulTypes = ['click', 'input', 'form_submit', 'url_change'];
    const interactions = this.currentSession.interactions;

    for (let i = interactions.length - 1; i >= 0; i--) {
      const it = interactions[i];
      if (meaningfulTypes.includes(it.type)) {
        const snippet = (it.value || it.text || '');
        const safeSnippet = typeof snippet === 'string'
          ? (snippet.length > 40 ? snippet.slice(0, 40) + '…' : snippet)
          : '';

        return {
          step: i + 1,
          type: it.type,
          selector: it.selector,
          value: it.value ? safeSnippet : undefined,
          text: (!it.value && safeSnippet) ? safeSnippet : undefined,
          timestamp: it.timestamp,
          relativeTime: it.relativeTime
        };
      }
    }

    return null;
  }

  async startRecording(tab) {
    try {
      console.log('Starting recording for tab:', tab.id, tab.url);
      if (this.isRecording) {
        console.log('Already recording, stopping current session first');
        await this.stopRecording();
      }

      this.isRecording = true;
      this.isPaused = false;
      this.pauseStartTime = null;
      this.totalPausedTime = 0;
      this.currentTabId = tab.id;
      this.screenshotQueue = [];

      this.currentSession = {
        id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: `Session ${new Date().toLocaleString()}`,
        url: tab.url,
        startTime: Date.now(),
        interactions: [],
        networkCalls: [],
        screenshots: [],
        pauseEvents: [],
        apiFailures: [], // Track API failures separately
        metadata: {
          browser: 'Chrome',
          version: navigator.userAgent,
          os: navigator.platform,
          date: new Date().toISOString(),
          tabId: tab.id,
          settings: { ...this.settings } // Store settings used during recording
        }
      };

      this.tabNetworkData.set(tab.id, { requests: new Map(), failures: [] });

      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'START_UI_RECORDING' });
        console.log('Content script already present, started recording');
      } catch (error) {
        console.log('Content script not present, injecting...');
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: [this.CONTENT_SCRIPT_PATH]
        });
        await new Promise(resolve => setTimeout(resolve, 100));
        await chrome.tabs.sendMessage(tab.id, { type: 'START_UI_RECORDING' });
        console.log('Content script injected and recording started');
      }

      // Take initial screenshot only if auto-screenshot is enabled
      if (this.settings.autoScreenshot) {
        await this.captureScreenshot({ type: 'session_start' });
      }

      return this.currentSession.id;
    } catch (error) {
      console.error('Error starting recording:', error);
      this.isRecording = false;
      this.isPaused = false;
      this.currentSession = null;
      this.currentTabId = null;
      throw error;
    }
  }

  async pauseRecording() {
    if (!this.isRecording || !this.currentSession) {
      return null;
    }
    if (this.isPaused) {
      return this.currentSession.id;
    }

    this.isPaused = true;
    this.pauseStartTime = Date.now();

    const pauseEvent = {
      type: 'pause',
      timestamp: Date.now(),
      relativeTime: Date.now() - this.currentSession.startTime
    };
    this.currentSession.pauseEvents.push(pauseEvent);

    // Take screenshot when paused only if auto-screenshot is enabled
    if (this.settings.autoScreenshot) {
      await this.captureScreenshot({ type: 'session_pause', timestamp: pauseEvent.timestamp });
    }

    if (this.currentTabId) {
      try {
        await chrome.tabs.sendMessage(this.currentTabId, { type: 'PAUSE_UI_RECORDING' });
      } catch { }
    }

    return this.currentSession.id;
  }

  async resumeRecording() {
    if (!this.isRecording || !this.currentSession) {
      return null;
    }
    if (!this.isPaused) {
      return this.currentSession.id;
    }

    if (this.pauseStartTime) {
      this.totalPausedTime += Date.now() - this.pauseStartTime;
      this.pauseStartTime = null;
    }

    this.isPaused = false;

    const resumeEvent = {
      type: 'resume',
      timestamp: Date.now(),
      relativeTime: Date.now() - this.currentSession.startTime,
      pausedDuration: this.totalPausedTime
    };
    this.currentSession.pauseEvents.push(resumeEvent);

    // Take screenshot when resumed only if auto-screenshot is enabled
    if (this.settings.autoScreenshot) {
      await this.captureScreenshot({ type: 'session_resume', timestamp: resumeEvent.timestamp });
    }

    if (this.currentTabId) {
      try {
        await chrome.tabs.sendMessage(this.currentTabId, { type: 'RESUME_UI_RECORDING' });
      } catch { }
    }

    return this.currentSession.id;
  }

  async stopRecording() {
    if (!this.isRecording || !this.currentSession) {
      return null;
    }

    if (this.isPaused && this.pauseStartTime) {
      this.totalPausedTime += Date.now() - this.pauseStartTime;
    }

    // Take final screenshot only if auto-screenshot is enabled
    if (this.settings.autoScreenshot) {
      await this.captureScreenshot({ type: 'session_end' });
    }

    if (this.currentTabId) {
      try {
        await chrome.tabs.sendMessage(this.currentTabId, { type: 'STOP_UI_RECORDING' });
      } catch { }
    }

    this.isRecording = false;
    this.isPaused = false;
    this.currentSession.endTime = Date.now();
    this.currentSession.duration = this.currentSession.endTime - this.currentSession.startTime;
    this.currentSession.activeDuration = this.currentSession.duration - this.totalPausedTime;

    try {
      await this.saveSession(this.currentSession);
      console.log('Session saved successfully');
    } catch (error) {
      console.error('Failed to save session:', error);
      throw error;
    }

    const sessionId = this.currentSession.id;
    this.currentSession = null;
    this.currentTabId = null;
    this.pauseStartTime = null;
    this.totalPausedTime = 0;
    this.screenshotQueue = [];
    return sessionId;
  }

  // [12] Effective screenshot quality:
  // - PNG ignores "quality", so use PNG for high, JPEG for medium/low to honor quality value
  async captureScreenshot(context = {}) {
    if (!this.isRecording || !this.currentTabId) return null;

    const isManualCapture = context.manual === true;
    if (!isManualCapture && !this.settings.autoScreenshot) {
      console.log('Auto-screenshot disabled, skipping automatic screenshot');
      return null;
    }
    if (!isManualCapture && this.isPaused) {
      console.log('Recording paused, skipping automatic screenshot');
      return null;
    }

    try {
      const wantHigh = (this.settings.screenshotQuality === 'high');
      const format = wantHigh ? 'png' : 'jpeg';
      const quality =
        this.settings.screenshotQuality === 'low' ? 50 :
          this.settings.screenshotQuality === 'medium' ? 80 : 100;

      const screenshot = await chrome.tabs.captureVisibleTab(null, {
        format,
        quality
      });

      const screenshotData = {
        id: `screenshot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
        relativeTime: Date.now() - this.currentSession.startTime,
        dataUrl: screenshot,
        context: context,
        url: this.currentSession?.url || '',
        manual: isManualCapture
      };

      if (this.currentSession) {
        this.currentSession.screenshots.push(screenshotData);
        console.log('Screenshot captured:', context.type || (isManualCapture ? 'manual' : 'auto'));
      }

      return screenshotData;
    } catch (error) {
      console.error('Error capturing screenshot:', error);
      return null;
    }
  }

  async recordInteraction(interaction, tab) {
    if (!this.isRecording || !this.currentSession || this.isPaused) {
      return;
    }

    const recordedInteraction = {
      ...interaction,
      id: interaction.id || `int_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`, // ensure id
      timestamp: Date.now(),
      relativeTime: Date.now() - this.currentSession.startTime,
      url: tab.url
    };

    this.currentSession.interactions.push(recordedInteraction);
  }

  // === Network Tracking ===

  trackNetworkRequest(details) {
    if (!this.isRecording || this.isPaused || details.tabId !== this.currentTabId) return;
    const tabData = this.tabNetworkData.get(details.tabId);
    if (!tabData) return;
    tabData.requests.set(details.requestId, {
      url: details.url,
      method: details.method,
      timestamp: details.timeStamp,
      requestBody: details.requestBody
    });
  }

  // [15] Race-proof: if request missing (e.g., cache), synthesize a minimal request so response is still tracked
  trackNetworkResponse(details) {
    if (!this.isRecording || this.isPaused || details.tabId !== this.currentTabId) return;
    const tabData = this.tabNetworkData.get(details.tabId);
    if (!tabData) return;
    let request = tabData.requests.get(details.requestId);
    if (!request) {
      request = {
        url: details.url,
        method: 'GET',
        timestamp: details.timeStamp,
        requestBody: undefined,
        synthesized: true
      };
      tabData.requests.set(details.requestId, request);
    }

    if (details.statusCode >= 400) {
      const failedCall = {
        ...request,
        statusCode: details.statusCode,
        statusLine: details.statusLine,
        responseHeaders: details.responseHeaders,
        completedTime: details.timeStamp,
        relatedInteractionId: this.getLastInteractionId(),
        afterStep: this.getLastMeaningfulInteraction(),
        timestamp: Date.now()
      };

      tabData.failures.push(failedCall);

      if (this.currentSession) {
        this.currentSession.networkCalls.push(failedCall);
        // [16] Always add to apiFailures with relativeTime + timestamp
        this.currentSession.apiFailures.push({
          ...failedCall,
          type: 'api_failure',
          relativeTime: Date.now() - this.currentSession.startTime
        });
      }
    }
  }

  trackNetworkError(details) {
    if (!this.isRecording || this.isPaused || details.tabId !== this.currentTabId) return;
    const tabData = this.tabNetworkData.get(details.tabId);
    if (!tabData) return;
    let request = tabData.requests.get(details.requestId);
    if (!request) {
      request = {
        url: details.url,
        method: 'GET',
        timestamp: details.timeStamp,
        requestBody: undefined,
        synthesized: true
      };
      tabData.requests.set(details.requestId, request);
    }

    const errorCall = {
      ...request,
      error: details.error,
      completedTime: details.timeStamp,
      relatedInteractionId: this.getLastInteractionId(),
      afterStep: this.getLastMeaningfulInteraction(),
      timestamp: Date.now()
    };

    tabData.failures.push(errorCall);

    if (this.currentSession) {
      this.currentSession.networkCalls.push(errorCall);
      // [16] Always add to apiFailures
      this.currentSession.apiFailures.push({
        ...errorCall,
        type: 'network_error',
        relativeTime: Date.now() - this.currentSession.startTime
      });
    }
  }

  getLastInteractionId() {
    if (!this.currentSession || !this.currentSession.interactions?.length) return null;
    return this.currentSession.interactions[this.currentSession.interactions.length - 1].id || null;
  }

  // === Storage helpers ===
  async saveSession(session) {
    const result = await chrome.storage.local.get(['sessions']);
    const sessions = result.sessions || [];
    sessions.push(session);
    await chrome.storage.local.set({ sessions });
  }

  async getSessions() {
    const result = await chrome.storage.local.get(['sessions']);
    return result.sessions || [];
  }

  async deleteSessions(sessionIds) {
    try {
      if (!Array.isArray(sessionIds) || sessionIds.length === 0) return;
      const result = await chrome.storage.local.get(['sessions']);
      const sessions = result.sessions || [];
      const filtered = sessions.filter(s => !sessionIds.includes(s.id));
      await chrome.storage.local.set({ sessions: filtered });
    } catch (error) {
      console.error('Error deleting sessions:', error);
      throw error;
    }
  }

  async clearAllSessions() {
    await chrome.storage.local.set({ sessions: [] });
  }

  // === Export helpers (kept compatible with your existing popup.js) ===
  async exportSession(sessionId, format = 'txt') {
    try {
      const sessions = await this.getSessions();
      const session = sessions.find(s => s.id === sessionId);
      if (!session) return null;

      switch (format.toLowerCase()) {
        case 'txt': return this.exportAsTxt(session);
        case 'csv': return this.exportAsCsv?.(session);
        case 'docx': return this.exportAsDocx?.(session);
        case 'pdf': return this.exportAsPdf?.(session);
        default: throw new Error('Unsupported export format: ' + format);
      }
    } catch (e) {
      console.error('Export error:', e);
      return null;
    }
  }

  // Minimal TXT export to keep background self-contained (your richer impl can remain)
  exportAsTxt(session) {
    let txt = `TestSnapper Session: ${session.name}\nURL: ${session.url}\nStart: ${new Date(session.startTime).toLocaleString()}\n`;
    txt += `Duration: ${Math.round((session.duration || 0) / 1000)}s (active ${Math.round((session.activeDuration || 0) / 1000)}s)\n`;
    txt += `Interactions: ${session.interactions?.length || 0}, Screenshots: ${session.screenshots?.length || 0}, API Failures: ${session.apiFailures?.length || 0}\n\n`;
    (session.interactions || []).forEach((i, idx) => {
      txt += `${idx + 1}. [${Math.round((i.relativeTime || 0) / 1000)}s] ${i.type.toUpperCase()} ${i.selector ? `"${i.selector}"` : ''}\n`;
    });
    return { txtContent: txt, session, filename: `${session.name.replace(/[^a-z0-9]/gi, '_')}.txt`, mimeType: 'text/plain' };
  }
}

console.log('Initializing TestSnapper background service...');
new TestSnapperBackground();
