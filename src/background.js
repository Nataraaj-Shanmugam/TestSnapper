// Background service worker for TestSnapper
class TestSnapperBackground {
  constructor() {
    this.isRecording = false;
    this.currentSession = null;
    this.tabNetworkData = new Map();
    this.currentTabId = null;
    this.init();
  }

  init() {
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
      const result = await chrome.storage.local.get(['sessions']);
      if (!result.sessions) {
        await chrome.storage.local.set({ sessions: [] });
        console.log('Initialized empty sessions storage');
      }
    } catch (error) {
      console.error('Failed to initialize storage:', error);
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
        case 'STOP_RECORDING':
          const stoppedSessionId = await this.stopRecording();
          console.log('Recording stopped, session ID:', stoppedSessionId);
          sendResponse({ success: true, sessionId: stoppedSessionId });
          break;
        case 'GET_RECORDING_STATUS':
          const status = { 
            isRecording: this.isRecording,
            currentSession: this.currentSession?.id || null
          };
          console.log('Returning recording status:', status);
          sendResponse(status);
          break;
        case 'RECORD_INTERACTION':
          // Fallback to currentTabId/session if sender.tab is missing
          const tab = sender.tab || { id: this.currentTabId, url: this.currentSession?.url || '' };
          await this.recordInteraction(message.data, tab);
          sendResponse({ success: true });
          break;
        case 'GET_SESSIONS':
          const sessions = await this.getSessions();
          console.log('Retrieved sessions count:', sessions.length);
          sendResponse({ sessions });
          break;
        case 'EXPORT_SESSION':
          const exportData = await this.exportSession(message.sessionId);
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
  }

  async startRecording(tab) {
    try {
      console.log('Starting recording for tab:', tab.id, tab.url);
      if (this.isRecording) {
        console.log('Already recording, stopping current session first');
        await this.stopRecording();
      }
      this.isRecording = true;
      this.currentTabId = tab.id;
      this.currentSession = {
        id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        name: `Session ${new Date().toLocaleString()}`,
        url: tab.url,
        startTime: Date.now(),
        interactions: [],
        networkCalls: [],
        screenshots: [],
        metadata: {
          browser: 'Chrome',
          version: navigator.userAgent,
          os: navigator.platform,
          date: new Date().toISOString(),
          tabId: tab.id
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

      return this.currentSession.id;
    } catch (error) {
      console.error('Error starting recording:', error);
      this.isRecording = false;
      this.currentSession = null;
      this.currentTabId = null;
      throw error;
    }
  }

  async stopRecording() {
    console.log('Stopping recording, current state:', {
      isRecording: this.isRecording,
      sessionId: this.currentSession?.id,
      tabId: this.currentTabId
    });
    if (!this.isRecording || !this.currentSession) {
      console.log('No recording to stop');
      return null;
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
    this.currentSession.endTime = Date.now();
    this.currentSession.duration = this.currentSession.endTime - this.currentSession.startTime;

    console.log('Session completed:', {
      id: this.currentSession.id,
      duration: `${Math.round(this.currentSession.duration / 1000)}s`,
      interactions: this.currentSession.interactions.length,
      networkCalls: this.currentSession.networkCalls.length
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
    return sessionId;
  }

  async recordInteraction(interaction, tab) {
    if (!this.isRecording || !this.currentSession) {
      console.log('Not recording, ignoring interaction');
      return;
    }
    const recordedInteraction = {
      id: `interaction_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      relativeTime: Date.now() - this.currentSession.startTime,
      url: tab.url,
      ...interaction
    };
    this.currentSession.interactions.push(recordedInteraction);
    console.log('Recorded interaction:', interaction.type, recordedInteraction.selector);
  }

  trackNetworkRequest(details) {
    if (!this.isRecording || details.tabId !== this.currentTabId) return;
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
    if (!this.isRecording || details.tabId !== this.currentTabId) return;
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
        completedTime: details.timeStamp
      };
      tabData.failures.push(failedCall);
      if (this.currentSession) {
        this.currentSession.networkCalls.push(failedCall);
        console.log('Recorded network error:', details.statusCode, details.url);
      }
    }
  }

  trackNetworkError(details) {
    if (!this.isRecording || details.tabId !== this.currentTabId) return;
    const tabData = this.tabNetworkData.get(details.tabId);
    if (!tabData) return;
    const request = tabData.requests.get(details.requestId);
    if (!request) return;
    const errorCall = {
      ...request,
      error: details.error,
      completedTime: details.timeStamp
    };
    tabData.failures.push(errorCall);
    if (this.currentSession) {
      this.currentSession.networkCalls.push(errorCall);
      console.log('Recorded network error:', details.error, details.url);
    }
  }

  async saveSession(session) {
    try {
      console.log('Saving session:', session.id);
      const result = await chrome.storage.local.get(['sessions']);
      const sessions = result.sessions || [];
      sessions.push(session);
      await chrome.storage.local.set({ sessions });
      console.log('Session saved successfully. Total sessions:', sessions.length);
      const verification = await chrome.storage.local.get(['sessions']);
      console.log('Storage verification - sessions count:', verification.sessions?.length);
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

  async exportSession(sessionId) {
    try {
      const sessions = await this.getSessions();
      const session = sessions.find(s => s.id === sessionId);
      if (!session) {
        console.error('Session not found for export:', sessionId);
        return null;
      }
      console.log('Exporting session:', sessionId);
      let txtContent = `TestSnapper Session Export\n`;
      txtContent += `==================\n`;
      txtContent += `Session: ${session.name}\n`;
      txtContent += `URL: ${session.url}\n`;
      txtContent += `Date: ${new Date(session.startTime).toLocaleString()}\n`;
      txtContent += `Duration: ${Math.round((session.duration || 0) / 1000)}s\n\n`;
      txtContent += `Metadata:\n`;
      txtContent += `Browser: ${session.metadata.browser}\n`;
      txtContent += `OS: ${session.metadata.os}\n`;
      txtContent += `Tab ID: ${session.metadata.tabId}\n\n`;
      txtContent += `Recorded Interactions (${session.interactions.length}):\n`;
      txtContent += `==================\n`;
      session.interactions.forEach((interaction, index) => {
        txtContent += `${index + 1}. [${Math.round(interaction.relativeTime / 1000)}s] `;
        txtContent += `${interaction.type.toUpperCase()} `;
        if (interaction.selector) txtContent += `"${interaction.selector}" `;
        if (interaction.value) txtContent += `value: "${interaction.value}" `;
        if (interaction.text) txtContent += `text: "${interaction.text.substring(0, 50)}" `;
        txtContent += `\n   at ${interaction.url}\n`;
      });
      if (session.networkCalls && session.networkCalls.length > 0) {
        txtContent += `\nFailed Network Calls (${session.networkCalls.length}):\n`;
        txtContent += `==================\n`;
        session.networkCalls.forEach((call, index) => {
          txtContent += `${index + 1}. ${call.method} ${call.url}\n`;
          txtContent += `   Status: ${call.statusCode || 'Error'}`;
          if (call.error) txtContent += ` (${call.error})`;
          txtContent += `\n   Time: ${new Date(call.timestamp).toLocaleTimeString()}\n`;
        });
      }
      return { txtContent, session };
    } catch (error) {
      console.error('Error exporting session:', error);
      return null;
    }
  }
}

console.log('Initializing TestSnapper background service...');
new TestSnapperBackground();