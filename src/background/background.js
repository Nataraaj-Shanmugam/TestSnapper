/**
 * Background Service Worker - REFACTORED
 * Clean architecture with shared modules
 */

import { StorageManager } from '../storage.js';
import { ExportService } from '../core/export-service.js';
import { Utils } from '../core/utils.js';

// ==================== State Management ====================

class RecordingStateManager {
  constructor() {
    this.state = 'idle'; // idle | recording | paused | exporting
    this.session = null;
    this.stepSequence = 0;
  }

  startRecording(session) {
    this.state = 'recording';
    this.session = session;
    this.stepSequence = 0;
  }

  pauseRecording() {
    if (this.state === 'recording') {
      this.state = 'paused';
    }
  }

  resumeRecording() {
    if (this.state === 'paused') {
      this.state = 'recording';
    }
  }

  stopRecording() {
    this.state = 'idle';
    const sessionId = this.session?.sessionId;
    this.session = null;
    this.stepSequence = 0;
    return sessionId;
  }

  getState() {
    return {
      state: this.state,
      session: this.session,
      stepCount: this.session?.stepCount || 0
    };
  }

  incrementStepCount() {
    this.stepSequence++;
    if (this.session) {
      this.session.stepCount++;
    }
    return this.stepSequence;
  }

  isRecording() {
    return this.state === 'recording';
  }

  setExporting() {
    this.state = 'exporting';
  }

  isIdle() {
    return this.state === 'idle';
  }
}

// ==================== Settings Management ====================

class SettingsManager {
  constructor() {
    this.cache = null;
    this.defaults = {
      includeTimestamp: true,
      autoSave: true,
      maxSessions: 25,
      screenshotSeconds: 5,
      captureApiCalls: false,
      captureFailedCalls: false,
      captureAllCalls: false,
      autoScreenshot: false
    };
  }

  async get() {
    if (this.cache) return this.cache;

    const result = await chrome.storage.local.get('settings');
    this.cache = { ...this.defaults, ...result.settings };
    return this.cache;
  }

  async save(settings) {
    await chrome.storage.local.set({ settings });
    this.cache = settings;
  }

  clearCache() {
    this.cache = null;
  }
}

// ==================== Initialize Services ====================

const storage = new StorageManager();
const exportService = new ExportService(storage);
const stateManager = new RecordingStateManager();
const settingsManager = new SettingsManager();

storage.init().catch(console.error);

// ==================== Badge Management ====================

class BadgeManager {
  static async setRecording(tabId) {
    await chrome.action.setBadgeText({ text: 'REC', tabId });
    await chrome.action.setBadgeBackgroundColor({ color: '#FF0000', tabId });
  }

  static async setPaused(tabId) {
    await chrome.action.setBadgeText({ text: 'PAUSE', tabId });
    await chrome.action.setBadgeBackgroundColor({ color: '#FFA500', tabId });
  }

  static async clear(tabId) {
    await chrome.action.setBadgeText({ text: '', tabId });
  }
}

// ==================== Session Management ====================

async function createSession(tabInfo) {
  const sessionId = Utils.generateUUID();
  const session = {
    sessionId,
    createdAt: new Date().toISOString(),
    env: {
      url: tabInfo.url,
      title: tabInfo.title,
      ua: navigator.userAgent,
      viewport: {
        width: tabInfo.width,
        height: tabInfo.height
      }
    },
    stepCount: 0
  };

  await storage.createSession(session);
  return session;
}

// ==================== Screenshot Management ====================

async function captureScreenshot(tabId, isManual = true) {
  console.log('📸 Screenshot capture requested for tab:', tabId, 'manual:', isManual);

  if (!stateManager.isRecording()) {
    console.error('❌ Not recording, cannot capture screenshot');
    return { success: false, error: 'Not recording' };
  }

  if (!stateManager.session) {
    console.error('❌ No active session');
    return { success: false, error: 'No active session' };
  }

  try {
    const tab = await chrome.tabs.get(tabId);

    if (!tab || !tab.windowId) {
      throw new Error('Invalid tab or window ID');
    }

    // Focus tab and window
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    await new Promise(resolve => setTimeout(resolve, 100));

    // Capture screenshot
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: 80
    });

    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
      throw new Error('Screenshot capture returned invalid data');
    }

    const blob = Utils.dataURLtoBlob(dataUrl);
    const sequence = stateManager.incrementStepCount();

    const step = {
      id: Utils.generateUUID(),
      sessionId: stateManager.session.sessionId,
      sequence: sequence,
      action: 'screenshot',
      fieldName: 'Screenshot',
      targetLabel: isManual ? 'Manual Screenshot' : 'Auto Screenshot',
      url: tab.url,
      value: null,
      isSensitive: false,
      isManual: isManual,
      hasScreenshot: true
    };

    const settings = await settingsManager.get();
    if (settings.includeTimestamp !== false) {
      step.timestamp = new Date().toISOString();
    }

    await storage.addStep(step);

    await storage.addAsset({
      id: Utils.generateUUID(),
      sessionId: stateManager.session.sessionId,
      stepId: step.id,
      type: 'screenshot',
      blob: blob,
      createdAt: new Date().toISOString()
    });

    await storage.updateSession(stateManager.session);

    return { success: true, stepId: step.id };
  } catch (error) {
    console.error('❌ Screenshot capture failed:', error);
    return { success: false, error: error.message };
  }
}

// ==================== Recording Actions ====================

async function startRecording(tabId, tabInfo) {
  if (!stateManager.isIdle()) {
    return { success: false, error: 'Already recording' };
  }

  try {
    const session = await createSession(tabInfo);
    stateManager.startRecording(session);

    await BadgeManager.setRecording(tabId);

    // Inject content scripts
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['src/content/selector.js', 'src/content/redactor.js', 'src/content/content.js']
      });
    } catch (injectErr) {
      if (!injectErr.message?.includes('already')) {
        throw injectErr;
      }
    }

    await new Promise(resolve => setTimeout(resolve, 100));

    await chrome.tabs.sendMessage(tabId, {
      action: 'startRecording',
      sessionId: session.sessionId
    });

    console.log('✅ Recording started:', session.sessionId);
    return { success: true, sessionId: session.sessionId };

  } catch (error) {
    console.error('Failed to start recording:', error);
    stateManager.stopRecording();
    return { success: false, error: error.message };
  }
}

async function pauseRecording(tabId) {
  if (!stateManager.isRecording()) {
    return { success: false, error: 'Not recording' };
  }

  stateManager.pauseRecording();
  await BadgeManager.setPaused(tabId);
  await chrome.tabs.sendMessage(tabId, { action: 'pauseRecording' });
  return { success: true };
}

async function resumeRecording(tabId) {
  if (stateManager.state !== 'paused') {
    return { success: false, error: 'Not paused' };
  }

  stateManager.resumeRecording();
  await BadgeManager.setRecording(tabId);
  await chrome.tabs.sendMessage(tabId, { action: 'resumeRecording' });
  return { success: true };
}

async function stopRecording(tabId) {
  if (stateManager.isIdle()) {
    return { success: false, error: 'Not recording' };
  }

  try {
    const sessionId = stateManager.stopRecording();
    await BadgeManager.clear(tabId);

    await chrome.tabs.sendMessage(tabId, { action: 'stopRecording' }).catch(() => {
      console.log('Content script not responding, continuing...');
    });

    console.log('✅ Recording stopped:', sessionId);

    // Open standalone review page
    if (sessionId) {
      const reviewUrl = chrome.runtime.getURL(
        `src/ui/review/review-standalone.html?sessionId=${sessionId}`
      );
      await chrome.tabs.create({ url: reviewUrl });
    }

    return { success: true, sessionId };
  } catch (error) {
    console.error('Failed to stop recording:', error);
    stateManager.stopRecording();
    return { success: false, error: error.message };
  }
}

// ==================== Step Management ====================

async function addStep(stepData) {
  if (!stateManager.session) {
    return { success: false, error: 'No active session' };
  }

  try {
    const settings = await settingsManager.get();
    const sequence = stateManager.incrementStepCount();

    const step = {
      id: Utils.generateUUID(),
      sessionId: stateManager.session.sessionId,
      sequence: sequence,
      ...stepData
    };

    if (settings.includeTimestamp !== false) {
      step.timestamp = new Date().toISOString();
    }

    await storage.addStep(step);
    await storage.updateSession(stateManager.session);

    return { success: true, step };
  } catch (error) {
    console.error('Failed to add step:', error);
    return { success: false, error: error.message };
  }
}

// ==================== Export Management ====================

async function exportSession(sessionId, format = 'json') {
  try {
    stateManager.setExporting();

    const result = await exportService.exportSession(sessionId, format);

    // ✅ Convert content to base64 data URL with proper Unicode handling
    const encoder = new TextEncoder();
    const uint8Array = encoder.encode(result.content);
    
    // Convert Uint8Array to binary string
    let binaryString = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binaryString += String.fromCharCode(uint8Array[i]);
    }
    
    const base64Content = btoa(binaryString);
    const dataUrl = `data:${result.mimeType};base64,${base64Content}`;

    await chrome.downloads.download({
      url: dataUrl,
      filename: result.filename,
      saveAs: false,  // Auto-download without dialog
      conflictAction: 'uniquify'  // Auto-rename if file exists
    });

    stateManager.state = 'idle';
    return { success: true, filename: result.filename };
  } catch (error) {
    console.error('Export failed:', error);
    stateManager.state = 'idle';
    return { success: false, error: error.message };
  }
}

// ==================== Message Handler ====================

async function getSenderTabId(sender) {
  if (sender?.tab?.id) return sender.tab.id;
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return activeTab?.id;
}

async function getScreenshot(stepId) {
  try {
    const assets = await storage.getAssetsByStepId(stepId);
    const screenshot = assets.find(a => a.type === 'screenshot');
    if (screenshot && screenshot.blob) {
      const dataUrl = await Utils.blobToDataURL(screenshot.blob);
      return { success: true, dataUrl };
    }
    return { success: false, error: 'Screenshot not found' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      let response;
      const tabId = await getSenderTabId(sender);

      switch (message.action) {
        case 'startRecording':
          response = await startRecording(tabId, message.tabInfo);
          break;

        case 'pauseRecording':
          response = await pauseRecording(tabId);
          break;

        case 'resumeRecording':
          response = await resumeRecording(tabId);
          break;

        case 'stopRecording':
          response = await stopRecording(tabId);
          break;

        case 'addStep':
          response = await addStep(message.stepData);
          break;

        case 'getState':
          response = stateManager.getState();
          break;

        case 'captureScreenshot':
          if (!tabId) throw new Error('No tab context for screenshot');
          response = await captureScreenshot(tabId, true);
          break;

        case 'exportSession':
          response = await exportSession(message.sessionId, message.format);
          break;

        case 'getAllSessions':
          let sessions = await storage.getAllSessions();
          sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          response = { success: true, sessions };
          break;

        case 'getSession':
          const session = await storage.getSession(message.sessionId);
          response = { success: true, session };
          break;

        case 'getSessionSteps':
          let steps = await storage.getSteps(message.sessionId);
          steps.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
          response = { success: true, steps };
          break;

        case 'getScreenshot':
          response = await getScreenshot(message.stepId);
          break;

        case 'deleteSession':
          await storage.clearSession(message.sessionId);
          response = { success: true };
          break;

        case 'clearAllSessions':
          const allSessions = await storage.getAllSessions();
          for (const session of allSessions) {
            await storage.clearSession(session.sessionId);
          }
          response = { success: true };
          break;

        case 'updateSessionName':
          await storage.updateSessionName(message.sessionId, message.sessionName);
          chrome.runtime.sendMessage({
            action: 'sessionNameUpdated',
            sessionId: message.sessionId,
            sessionName: message.sessionName
          }).catch(() => { });
          response = { success: true };
          break;

        case 'updateAllSteps':
          await storage.updateAllSteps(message.sessionId, message.steps);
          response = { success: true };
          break;

        case 'getSettings':
          const settings = await settingsManager.get();
          response = { success: true, settings };
          break;

        case 'saveSettings':
          await settingsManager.save(message.settings);
          response = { success: true };
          break;

        default:
          response = { success: false, error: 'Unknown action' };
      }

      sendResponse(response);
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true;
});

console.log('✅ TestSnapper background service worker initialized');