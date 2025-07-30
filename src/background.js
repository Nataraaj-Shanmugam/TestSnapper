// Enhanced Background service worker for TestSnapper with settings awareness and API failure integration
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
      screenshotQuality: 'medium',
      redactionPatterns: 'password,secret,token,api_key',
      darkMode: false,
      defaultExportFormat: 'txt'
    };

    this.init();
  }

  async init() {
    console.log('TestSnapper Background Service Worker initialized');

    chrome.runtime.onInstalled.addListener(() => {
      console.log('TestSnapper extension installed');
      this.initializeStorage();
    });

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      console.log('Background received message:', message.type, sender);
      this.handleMessage(message, sender, sendResponse);
      return true;
    });

    // Load settings on startup
    await this.loadSettings();

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

  async handleMessage(message, sender, sendResponse) {
    try {
      console.log('Handling message:', message.type);

      switch (message.type) {
        case 'START_RECORDING':
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          const activeTab = tabs[0];
          if (!activeTab) throw new Error('No active tab found');
          const sessionId = await this.startRecording(activeTab);
          console.log('Recording started with session ID:', sessionId);
          sendResponse({ success: true, sessionId });
          break;

        case 'PAUSE_RECORDING':
          const pausedSessionId = await this.pauseRecording();
          console.log('Recording paused, session ID:', pausedSessionId);
          sendResponse({ success: true, sessionId: pausedSessionId });
          break;

        case 'RESUME_RECORDING':
          const resumedSessionId = await this.resumeRecording();
          console.log('Recording resumed, session ID:', resumedSessionId);
          sendResponse({ success: true, sessionId: resumedSessionId });
          break;

        case 'STOP_RECORDING':
          const stoppedSessionId = await this.stopRecording();
          console.log('Recording stopped, session ID:', stoppedSessionId);
          sendResponse({ success: true, sessionId: stoppedSessionId });
          break;

        case 'GET_RECORDING_STATUS':
          const status = {
            isRecording: this.isRecording,
            isPaused: this.isPaused,
            currentSession: this.currentSession?.id || null,
            startTime: this.currentSession?.startTime,
            totalPausedTime: this.totalPausedTime
          };
          console.log('Returning recording status:', status);
          sendResponse(status);
          break;

        case 'RECORD_INTERACTION':
          if (this.isRecording && !this.isPaused) {
            const tab = sender.tab || { id: this.currentTabId, url: this.currentSession?.url || '' };
            await this.recordInteraction(message.data, tab);
          }
          sendResponse({ success: true });
          break;

        case 'CAPTURE_SCREENSHOT':
          if (this.isRecording && !this.isPaused) {
            const isManualCapture = message.data?.manual === true;
            if (isManualCapture || this.settings.autoScreenshot) {
              await this.captureScreenshot(message.data);
              sendResponse({ success: true });
            } else {
              console.log('Screenshot skipped - auto-screenshot disabled and not manual');
              sendResponse({ success: false, reason: 'Auto-screenshot disabled' });
            }
          } else {
            console.log('Screenshot skipped - not recording or paused');
            sendResponse({ success: false, reason: 'Not recording or recording is paused' });
          }
          break;

        case 'GET_SESSIONS':
          const sessions = await this.getSessions();
          console.log('Retrieved sessions count:', sessions.length);
          sendResponse({ sessions });
          break;

        case 'GET_SETTINGS':
          sendResponse({ settings: this.settings });
          break;

        case 'UPDATE_SETTINGS':
          await this.updateSettings(message.settings);
          sendResponse({ success: true });
          break;

        case 'GET_LAST_MEANINGFUL_INTERACTION':
          const lastInteraction = this.getLastMeaningfulInteraction();
          sendResponse({ interaction: lastInteraction });
          break;

        case 'EXPORT_SESSION':
          const exportData = await this.exportSession(message.sessionId, message.format || 'txt');
          if (exportData) {
            sendResponse({ exportData });
          } else {
            sendResponse({ success: false, error: 'Session not found' });
          }
          break;

        default:
          console.warn('Unknown message type:', message.type);
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }

  async updateSettings(newSettings) {
    try {
      this.settings = { ...this.settings, ...newSettings };
      await chrome.storage.local.set({ settings: this.settings });

      // Notify content scripts about settings update
      if (this.currentTabId) {
        try {
          await chrome.tabs.sendMessage(this.currentTabId, {
            type: 'UPDATE_SETTINGS',
            settings: this.settings
          });
        } catch (error) {
          console.log('Could not update content script settings:', error.message);
        }
      }

      console.log('Settings updated:', this.settings);
    } catch (error) {
      console.error('Failed to update settings:', error);
      throw error;
    }
  }

  getLastMeaningfulInteraction() {
    if (!this.currentSession || !this.currentSession.interactions) {
      return null;
    }

    // Get the last non-system interaction
    const meaningfulTypes = ['click', 'input', 'form_submit', 'url_change'];
    const interactions = this.currentSession.interactions;

    for (let i = interactions.length - 1; i >= 0; i--) {
      const interaction = interactions[i];
      if (meaningfulTypes.includes(interaction.type)) {
        return {
          step: i + 1,
          type: interaction.type,
          selector: interaction.selector,
          timestamp: interaction.timestamp,
          relativeTime: interaction.relativeTime
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
        apiFailures: [], // New: Track API failures separately
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
          files: ['src/content.js']
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
    console.log('Pausing recording, current state:', {
      isRecording: this.isRecording,
      isPaused: this.isPaused,
      sessionId: this.currentSession?.id
    });

    if (!this.isRecording || !this.currentSession) {
      console.log('No recording to pause');
      return null;
    }

    if (this.isPaused) {
      console.log('Recording already paused');
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
        console.log('Sent pause recording message to content script');
      } catch (error) {
        console.log('Could not send pause message to content script:', error.message);
      }
    }

    console.log('Recording paused successfully');
    return this.currentSession.id;
  }

  async resumeRecording() {
    console.log('Resuming recording, current state:', {
      isRecording: this.isRecording,
      isPaused: this.isPaused,
      sessionId: this.currentSession?.id
    });

    if (!this.isRecording || !this.currentSession) {
      console.log('No recording to resume');
      return null;
    }

    if (!this.isPaused) {
      console.log('Recording not paused');
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
        console.log('Sent resume recording message to content script');
      } catch (error) {
        console.log('Could not send resume message to content script:', error.message);
      }
    }

    console.log('Recording resumed successfully');
    return this.currentSession.id;
  }

  async stopRecording() {
    console.log('Stopping recording, current state:', {
      isRecording: this.isRecording,
      isPaused: this.isPaused,
      sessionId: this.currentSession?.id,
      tabId: this.currentTabId
    });

    if (!this.isRecording || !this.currentSession) {
      console.log('No recording to stop');
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
        console.log('Sent stop recording message to content script');
      } catch (error) {
        console.log('Could not send stop message to content script:', error.message);
      }
    }

    this.isRecording = false;
    this.isPaused = false;
    this.currentSession.endTime = Date.now();
    this.currentSession.duration = this.currentSession.endTime - this.currentSession.startTime;
    this.currentSession.activeDuration = this.currentSession.duration - this.totalPausedTime;

    console.log('Session completed:', {
      id: this.currentSession.id,
      totalDuration: `${Math.round(this.currentSession.duration / 1000)}s`,
      activeDuration: `${Math.round(this.currentSession.activeDuration / 1000)}s`,
      pausedTime: `${Math.round(this.totalPausedTime / 1000)}s`,
      interactions: this.currentSession.interactions.length,
      networkCalls: this.currentSession.networkCalls.length,
      apiFailures: this.currentSession.apiFailures.length,
      screenshots: this.currentSession.screenshots.length,
      pauseEvents: this.currentSession.pauseEvents.length
    });

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

async captureScreenshot(context = {}) {
  if (!this.isRecording || !this.currentTabId) return;

  // Allow manual screenshots even if auto-screenshot is disabled
  const isManualCapture = context.manual === true;
  if (!isManualCapture && !this.settings.autoScreenshot) {
    console.log('Auto-screenshot disabled, skipping automatic screenshot');
    return null;
  }

  try {
    const screenshot = await chrome.tabs.captureVisibleTab(null, {
      format: 'png',
      quality: this.settings.screenshotQuality === 'high' ? 100 :
        this.settings.screenshotQuality === 'low' ? 50 : 90
    });

    const screenshotData = {
      id: `screenshot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      relativeTime: Date.now() - this.currentSession.startTime,
      dataUrl: screenshot,
      context: context,
      url: this.currentSession?.url || '',
      manual: isManualCapture // Track if this was a manual capture
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
      console.log('Not recording or paused, ignoring interaction');
      return;
    }

    const recordedInteraction = {
      ...interaction,
      timestamp: Date.now(),
      relativeTime: Date.now() - this.currentSession.startTime,
      url: tab.url
    };

    this.currentSession.interactions.push(recordedInteraction);

    console.log('Recorded interaction:', interaction.type, recordedInteraction.selector);
  }

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

  trackNetworkResponse(details) {
    if (!this.isRecording || this.isPaused || details.tabId !== this.currentTabId) return;
    const tabData = this.tabNetworkData.get(details.tabId);
    if (!tabData) return;
    const request = tabData.requests.get(details.requestId);
    if (!request) return;

    if (details.statusCode >= 400) {
      const failedCall = {
        ...request,
        statusCode: details.statusCode,
        statusLine: details.statusLine,
        responseHeaders: details.responseHeaders,
        completedTime: details.timeStamp,
        relatedInteractionId: this.getLastInteractionId(),
        afterStep: this.getLastMeaningfulInteraction()
      };

      tabData.failures.push(failedCall);

      if (this.currentSession) {
        this.currentSession.networkCalls.push(failedCall);
        // Also add to API failures array for better organization
        this.currentSession.apiFailures.push({
          ...failedCall,
          type: 'api_failure',
          relativeTime: Date.now() - this.currentSession.startTime
        });
        console.log('Recorded API failure after step:', failedCall.afterStep?.step, details.statusCode, details.url);
      }
    }
  }

  trackNetworkError(details) {
    if (!this.isRecording || this.isPaused || details.tabId !== this.currentTabId) return;
    const tabData = this.tabNetworkData.get(details.tabId);
    if (!tabData) return;
    const request = tabData.requests.get(details.requestId);
    if (!request) return;

    const errorCall = {
      ...request,
      error: details.error,
      completedTime: details.timeStamp,
      relatedInteractionId: this.getLastInteractionId(),
      afterStep: this.getLastMeaningfulInteraction()
    };

    tabData.failures.push(errorCall);

    if (this.currentSession) {
      this.currentSession.networkCalls.push(errorCall);
      // Also add to API failures array for better organization
      this.currentSession.apiFailures.push({
        ...errorCall,
        type: 'network_error',
        relativeTime: Date.now() - this.currentSession.startTime
      });
      console.log('Recorded network error after step:', errorCall.afterStep?.step, details.error, details.url);
    }
  }

  getLastInteractionId() {
    if (!this.currentSession || !this.currentSession.interactions || this.currentSession.interactions.length === 0) {
      return null;
    }
    return this.currentSession.interactions[this.currentSession.interactions.length - 1].id;
  }

  async saveSession(session) {
    try {
      console.log('Saving session:', session.id);
      const result = await chrome.storage.local.get(['sessions']);
      const sessions = result.sessions || [];
      sessions.push(session);
      await chrome.storage.local.set({ sessions });
      console.log('Session saved successfully. Total sessions:', sessions.length);
    } catch (error) {
      console.error('Error saving session:', error);
      throw error;
    }
  }

  async getSessions() {
    try {
      const result = await chrome.storage.local.get(['sessions']);
      const sessions = result.sessions || [];
      console.log('Retrieved sessions from storage:', sessions.length);
      return sessions;
    } catch (error) {
      console.error('Error getting sessions:', error);
      return [];
    }
  }

  async exportSession(sessionId, format = 'txt') {
    try {
      const sessions = await this.getSessions();
      const session = sessions.find(s => s.id === sessionId);
      if (!session) {
        console.error('Session not found for export:', sessionId);
        return null;
      }

      console.log('Exporting session:', sessionId, 'as', format);

      switch (format.toLowerCase()) {
        case 'txt':
          return this.exportAsTxt(session);
        case 'csv':
          return this.exportAsCsv(session);
        case 'docx':
          return this.exportAsDocx(session);
        case 'pdf':
          return this.exportAsPdf(session);
        default:
          throw new Error('Unsupported export format: ' + format);
      }
    } catch (error) {
      console.error('Error exporting session:', error);
      return null;
    }
  }

  // Fixed exportAsTxt function and other export functions in background.js

  exportAsTxt(session) {
    let txtContent = `TestSnapper Session Export\n`;
    txtContent += `==================\n`;
    txtContent += `Session: ${session.name}\n`;
    txtContent += `URL: ${session.url}\n`;
    txtContent += `Date: ${new Date(session.startTime).toLocaleString()}\n`;
    txtContent += `Total Duration: ${Math.round((session.duration || 0) / 1000)}s\n`;
    txtContent += `Active Duration: ${Math.round((session.activeDuration || session.duration || 0) / 1000)}s\n`;
    txtContent += `Input Time Frame: ${(session.metadata?.settings?.inputTimeFrame || 2000) / 1000}s\n`;

    if (session.pauseEvents && session.pauseEvents.length > 0) {
      const pauseCount = session.pauseEvents.filter(e => e.type === 'pause').length;
      txtContent += `Pauses: ${pauseCount}\n`;
    }

    txtContent += `Screenshots: ${session.screenshots?.length || 0} ${session.metadata?.settings?.autoScreenshot ? '(auto-capture enabled)' : '(auto-capture disabled)'}\n`;
    txtContent += `API Failures: ${session.apiFailures?.length || 0}\n\n`;

    txtContent += `Metadata:\n`;
    txtContent += `Browser: ${session.metadata?.browser || 'Unknown'}\n`;
    txtContent += `OS: ${session.metadata?.os || 'Unknown'}\n`;
    txtContent += `Tab ID: ${session.metadata?.tabId || 'Unknown'}\n\n`;

    // Add interactions
    if (session.interactions && session.interactions.length > 0) {
      txtContent += `Interactions (${session.interactions.length}):\n`;
      txtContent += `==================\n`;
      session.interactions.forEach((interaction, index) => {
        txtContent += `${index + 1}. [${Math.round(interaction.relativeTime / 1000)}s] `;
        txtContent += `${interaction.type.toUpperCase()}`;
        if (interaction.timeFrame) txtContent += ` (${interaction.timeFrame})`;
        if (interaction.selector) txtContent += ` "${interaction.selector}"`;
        if (interaction.value) txtContent += ` value: "${interaction.value}"`;
        if (interaction.text && !interaction.value) txtContent += ` text: "${interaction.text.substring(0, 50)}${interaction.text.length > 50 ? '...' : ''}"`;
        txtContent += `\n   at ${interaction.url || session.url}\n`;
      });
      txtContent += `\n`;
    }

    if (session.pauseEvents && session.pauseEvents.length > 0) {
      txtContent += `Pause/Resume Events:\n`;
      txtContent += `==================\n`;
      session.pauseEvents.forEach((event, index) => {
        txtContent += `${index + 1}. [${Math.round(event.relativeTime / 1000)}s] `;
        txtContent += `${event.type.toUpperCase()}`;
        if (event.pausedDuration) {
          txtContent += ` (Total paused time: ${Math.round(event.pausedDuration / 1000)}s)`;
        }
        txtContent += `\n   at ${session.url}\n`; // Fixed: use session.url instead of interaction.url
      });
      txtContent += `\n`;
    }

    if (session.apiFailures && session.apiFailures.length > 0) {
      txtContent += `API Failures (${session.apiFailures.length}):\n`;
      txtContent += `==================\n`;
      session.apiFailures.forEach((failure, index) => {
        txtContent += `${index + 1}. [${Math.round(failure.relativeTime / 1000)}s] `;
        txtContent += `${failure.method} ${failure.url}\n`;
        txtContent += `   Status: ${failure.statusCode || 'Network Error'}`;
        if (failure.error) txtContent += ` (${failure.error})`;
        txtContent += `\n   Time: ${new Date(failure.timestamp).toLocaleTimeString()}`;
        if (failure.afterStep) {
          txtContent += `\n   After Step: ${failure.afterStep.step} - ${failure.afterStep.type.toUpperCase()}`;
          if (failure.afterStep.selector) {
            txtContent += ` "${failure.afterStep.selector}"`;
          }
        }
        txtContent += `\n`;
      });
      txtContent += `\n`;
    }

    if (session.networkCalls && session.networkCalls.length > 0) {
      txtContent += `All Failed Network Calls (${session.networkCalls.length}):\n`;
      txtContent += `==================\n`;
      session.networkCalls.forEach((call, index) => {
        txtContent += `${index + 1}. ${call.method} ${call.url}\n`;
        txtContent += `   Status: ${call.statusCode || 'Error'}`;
        if (call.error) txtContent += ` (${call.error})`;
        txtContent += `\n   Time: ${new Date(call.timestamp).toLocaleTimeString()}\n`;
      });
      txtContent += `\n`;
    }

    if (session.screenshots && session.screenshots.length > 0) {
      txtContent += `Screenshots (${session.screenshots.length}):\n`;
      txtContent += `==================\n`;
      session.screenshots.forEach((screenshot, index) => {
        txtContent += `${index + 1}. [${Math.round(screenshot.relativeTime / 1000)}s] `;
        txtContent += `${screenshot.context?.type || 'manual'}`;
        if (screenshot.context?.interactionType) {
          txtContent += ` (after ${screenshot.context.interactionType})`;
        }
        txtContent += `\n`;
      });
      txtContent += `\n`;
    }

    return {
      txtContent,
      session,
      filename: `${session.name.replace(/[^a-z0-9]/gi, '_')}.txt`,
      mimeType: 'text/plain'
    };
  }

  // Enhanced CSV export function
  exportAsCsv(session) {
    const csvRows = [];

    // Header
    csvRows.push([
      'Timestamp',
      'Relative Time (s)',
      'Type',
      'Element',
      'Action',
      'Value',
      'URL',
      'Screenshot Available',
      'Time Frame',
      'API Failure After'
    ]);

    // Add interactions
    if (session.interactions) {
      session.interactions.forEach(interaction => {
        const relatedScreenshot = session.screenshots?.find(s =>
          s.context?.interactionId === interaction.id
        );

        const relatedApiFailure = session.apiFailures?.find(f =>
          f.relatedInteractionId === interaction.id
        );

        csvRows.push([
          new Date(interaction.timestamp).toISOString(),
          Math.round(interaction.relativeTime / 1000),
          interaction.type,
          interaction.selector || '',
          interaction.type,
          interaction.value || interaction.text || '',
          interaction.url || session.url,
          relatedScreenshot ? 'Yes' : 'No',
          interaction.timeFrame || '',
          relatedApiFailure ? `${relatedApiFailure.method} ${relatedApiFailure.url} (${relatedApiFailure.statusCode || relatedApiFailure.error})` : ''
        ]);
      });
    }

    // Add pause/resume events
    if (session.pauseEvents) {
      session.pauseEvents.forEach(event => {
        csvRows.push([
          new Date(event.timestamp).toISOString(),
          Math.round(event.relativeTime / 1000),
          'session_event',
          '',
          event.type,
          event.pausedDuration ? `Paused for ${Math.round(event.pausedDuration / 1000)}s` : '',
          session.url,
          'No',
          '',
          ''
        ]);
      });
    }

    // Add API failures as separate rows
    if (session.apiFailures) {
      session.apiFailures.forEach(failure => {
        csvRows.push([
          new Date(failure.timestamp).toISOString(),
          Math.round(failure.relativeTime / 1000),
          'api_failure',
          '',
          `${failure.method} ${failure.url}`,
          `${failure.statusCode || failure.error}`,
          failure.url,
          'No',
          '',
          failure.afterStep ? `Step ${failure.afterStep.step}` : ''
        ]);
      });
    }

    const csvContent = csvRows.map(row =>
      row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    return {
      csvContent,
      session,
      filename: `${session.name.replace(/[^a-z0-9]/gi, '_')}.csv`,
      mimeType: 'text/csv'
    };
  }

  // Enhanced PDF export function
  exportAsPdf(session) {
    const pdfData = {
      title: `TestSnapper Session: ${session.name}`,
      metadata: {
        url: session.url,
        date: new Date(session.startTime).toLocaleString(),
        duration: `${Math.round((session.duration || 0) / 1000)}s`,
        activeDuration: `${Math.round((session.activeDuration || session.duration || 0) / 1000)}s`,
        inputTimeFrame: `${(session.metadata?.settings?.inputTimeFrame || 2000) / 1000}s`,
        interactions: session.interactions?.length || 0,
        screenshots: session.screenshots?.length || 0,
        autoScreenshot: session.metadata?.settings?.autoScreenshot ? 'Enabled' : 'Disabled',
        apiFailures: session.apiFailures?.length || 0
      },
      pages: [
        {
          title: 'Session Overview',
          content: [
            `Session: ${session.name}`,
            `URL: ${session.url}`,
            `Date: ${new Date(session.startTime).toLocaleString()}`,
            `Duration: ${Math.round((session.duration || 0) / 1000)}s`,
            `Active Duration: ${Math.round((session.activeDuration || session.duration || 0) / 1000)}s`,
            `Input Time Frame: ${(session.metadata?.settings?.inputTimeFrame || 2000) / 1000}s`,
            `Interactions: ${session.interactions?.length || 0}`,
            `Screenshots: ${session.screenshots?.length || 0}`,
            `Auto-Screenshot: ${session.metadata?.settings?.autoScreenshot ? 'Enabled' : 'Disabled'}`,
            `API Failures: ${session.apiFailures?.length || 0}`
          ]
        },
        {
          title: 'Interaction Timeline',
          interactions: session.interactions?.map(interaction => ({
            time: Math.round(interaction.relativeTime / 1000),
            type: interaction.type,
            description: `${interaction.type.toUpperCase()} on ${interaction.selector || 'unknown element'}`,
            value: interaction.value || interaction.text || '',
            timeFrame: interaction.timeFrame || '',
            screenshot: session.screenshots?.find(s => s.context?.interactionId === interaction.id),
            relatedApiFailure: session.apiFailures?.find(f => f.relatedInteractionId === interaction.id)
          })) || []
        },
        {
          title: 'API Failures',
          apiFailures: session.apiFailures?.map(failure => ({
            time: Math.round(failure.relativeTime / 1000),
            method: failure.method,
            url: failure.url,
            status: failure.statusCode || failure.error,
            afterStep: failure.afterStep
          })) || []
        }
      ],
      screenshots: session.screenshots || []
    };

    return {
      pdfData,
      session,
      filename: `${session.name.replace(/[^a-z0-9]/gi, '_')}.pdf`,
      mimeType: 'application/pdf'
    };
  }

  exportAsDocx(session) {
    // Enhanced DOCX data structure with API failures
    const docxData = {
      title: `TestSnapper Session: ${session.name}`,
      metadata: {
        url: session.url,
        date: new Date(session.startTime).toLocaleString(),
        duration: `${Math.round((session.duration || 0) / 1000)}s`,
        activeDuration: `${Math.round((session.activeDuration || session.duration || 0) / 1000)}s`,
        inputTimeFrame: `${(session.metadata.settings?.inputTimeFrame || 2000) / 1000}s`,
        interactions: session.interactions.length,
        screenshots: session.screenshots?.length || 0,
        autoScreenshot: session.metadata.settings?.autoScreenshot ? 'Enabled' : 'Disabled',
        apiFailures: session.apiFailures?.length || 0
      },
      sections: [
        {
          title: 'Session Overview',
          content: `This session was recorded on ${new Date(session.startTime).toLocaleString()} at ${session.url}. The total duration was ${Math.round((session.duration || 0) / 1000)} seconds with ${session.interactions.length} interactions captured. Input time frame was set to ${(session.metadata.settings?.inputTimeFrame || 2000) / 1000} seconds. Auto-screenshot was ${session.metadata.settings?.autoScreenshot ? 'enabled' : 'disabled'}.`
        },
        {
          title: 'Interactions',
          interactions: session.interactions.map(interaction => ({
            time: Math.round(interaction.relativeTime / 1000),
            type: interaction.type,
            description: `${interaction.type.toUpperCase()} on ${interaction.selector || 'unknown element'}`,
            value: interaction.value || interaction.text || '',
            timeFrame: interaction.timeFrame || '',
            screenshot: session.screenshots?.find(s => s.context.interactionId === interaction.id),
            relatedApiFailure: session.apiFailures?.find(f => f.relatedInteractionId === interaction.id)
          }))
        },
        {
          title: 'API Failures',
          apiFailures: session.apiFailures?.map(failure => ({
            time: Math.round(failure.relativeTime / 1000),
            method: failure.method,
            url: failure.url,
            status: failure.statusCode || failure.error,
            afterStep: failure.afterStep
          })) || []
        }
      ],
      screenshots: session.screenshots || []
    };

    return {
      docxData,
      session,
      filename: `${session.name.replace(/[^a-z0-9]/gi, '_')}.docx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    };
  }
}

console.log('Initializing TestSnapper background service...');
new TestSnapperBackground();