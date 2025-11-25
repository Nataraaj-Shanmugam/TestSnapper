/**
 * Background Service Worker - FIXED: Unicode export, race conditions, session recovery
 */

import { StorageManager } from '../storage.js';
import { ExportService } from '../core/export-service.js';
import { Utils } from '../core/utils.js';

// ==================== State Management ====================

class RecordingStateManager {
  constructor() {
    this.state = 'idle';
    this.session = null;
    this.stepSequence = 0;
    // 🔧 FIX #3: Add lock for sequence generation
    this.sequenceLock = Promise.resolve();
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

  /**
   * 🔧 FIX #3: Thread-safe sequence increment with locking
   */
  async incrementStepCount() {
    // Acquire lock
    await this.sequenceLock;

    // Create new lock for next caller
    let releaseLock;
    this.sequenceLock = new Promise(resolve => {
      releaseLock = resolve;
    });

    try {
      this.stepSequence++;
      if (this.session) {
        this.session.stepCount++;
      }
      return this.stepSequence;
    } finally {
      // Release lock
      releaseLock();
    }
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

// 🔧 FIX #7: Persist session state to survive service worker restarts
chrome.storage.local.get('activeRecording', (result) => {
  if (result.activeRecording) {
    console.log('🔄 Recovering active recording:', result.activeRecording.sessionId);
    stateManager.state = result.activeRecording.state;
    stateManager.session = result.activeRecording.session;
    stateManager.stepSequence = result.activeRecording.stepSequence;
  }
});

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

// 🔧 FIX #7: Persist state helper
async function persistActiveRecording() {
  if (stateManager.state !== 'idle' && stateManager.session) {
    await chrome.storage.local.set({
      activeRecording: {
        state: stateManager.state,
        session: stateManager.session,
        stepSequence: stateManager.stepSequence
      }
    });
  } else {
    await chrome.storage.local.remove('activeRecording');
  }
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

    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    await new Promise(resolve => setTimeout(resolve, 100));

    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'jpeg',
      quality: 80
    });

    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
      throw new Error('Screenshot capture returned invalid data');
    }

    const blob = Utils.dataURLtoBlob(dataUrl);
    const sequence = await stateManager.incrementStepCount();

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
    await persistActiveRecording(); // 🔧 FIX #7

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
    await persistActiveRecording(); // 🔧 FIX #7

    await BadgeManager.setRecording(tabId);

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

    // 🔧 FIX #7: Send session info to content script
    await chrome.tabs.sendMessage(tabId, {
      action: 'startRecording',
      sessionId: session.sessionId
    });

    console.log('✅ Recording started:', session.sessionId);
    return { success: true, sessionId: session.sessionId };

  } catch (error) {
    console.error('Failed to start recording:', error);
    stateManager.stopRecording();
    await persistActiveRecording(); // 🔧 FIX #7
    return { success: false, error: error.message };
  }
}

async function pauseRecording(tabId) {
  if (!stateManager.isRecording()) {
    return { success: false, error: 'Not recording' };
  }

  stateManager.pauseRecording();
  await persistActiveRecording(); // 🔧 FIX #7
  await BadgeManager.setPaused(tabId);
  await chrome.tabs.sendMessage(tabId, { action: 'pauseRecording' });
  return { success: true };
}

async function resumeRecording(tabId) {
  if (stateManager.state !== 'paused') {
    return { success: false, error: 'Not paused' };
  }

  stateManager.resumeRecording();
  await persistActiveRecording(); // 🔧 FIX #7
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
    await persistActiveRecording(); // 🔧 FIX #7: Clear persisted state
    await BadgeManager.clear(tabId);

    await chrome.tabs.sendMessage(tabId, { action: 'stopRecording' }).catch(() => {
      console.log('Content script not responding, continuing...');
    });

    console.log('✅ Recording stopped:', sessionId);

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
    await persistActiveRecording(); // 🔧 FIX #7
    return { success: false, error: error.message };
  }
}

// ==================== Step Management ====================

async function addStep(stepData) {
  // 🔧 FIX #7: Validate session exists
  if (!stateManager.session) {
    console.error('❌ No active session - rejecting step');
    return { success: false, error: 'No active session' };
  }

  try {
    const settings = await settingsManager.get();
    const sequence = await stateManager.incrementStepCount(); // 🔧 FIX #3: Thread-safe

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
    await persistActiveRecording(); // 🔧 FIX #7

    return { success: true, step };
  } catch (error) {
    console.error('Failed to add step:', error);
    return { success: false, error: error.message };
  }
}

// ==================== Export Management ====================

async function exportSession(sessionId, format = 'json') {
  try {
    // Mark state as exporting
    stateManager.setExporting();

    // Progress callback → forward to review UI
    const progressCallback = (update = {}) => {
      try {
        chrome.runtime.sendMessage({
          action: 'exportProgress',
          sessionId,
          ...update
        });
      } catch (err) {
        console.warn('Failed to send export progress message', err);
      }
    };

    // Initial "starting" progress
    progressCallback({
      percent: 0,
      status: 'Preparing export...'
    });

    // Optional: send total steps info
    try {
      const steps = await storage.getSteps(sessionId);
      progressCallback({
        status: 'Preparing export...',
        totalSteps: steps.length
      });
    } catch (e) {
      console.warn('Unable to load steps for progress metadata', e);
    }

    // Call ExportService with progress callback
    const result = await exportService.exportSession(sessionId, format, progressCallback);

    // TextEncoder for proper UTF-8 → base64 conversion
    const utf8Bytes = new TextEncoder().encode(result.content);

    let binaryString = '';
    const chunkSize = 0x8000; // avoid stack overflow for large files
    for (let i = 0; i < utf8Bytes.length; i += chunkSize) {
      const chunk = utf8Bytes.subarray(i, i + chunkSize);
      binaryString += String.fromCharCode.apply(null, chunk);
    }

    const base64Content = btoa(binaryString);
    const dataUrl = `data:${result.mimeType};charset=utf-8;base64,${base64Content}`;

    // Progress near completion
    progressCallback({
      percent: 95,
      status: 'Preparing download...'
    });

    await chrome.downloads.download({
      url: dataUrl,
      filename: result.filename,
      saveAs: false,
      conflictAction: 'uniquify'
    });

    // Reset state
    stateManager.state = 'idle';

    // Final "done" update so UI can close the modal
    progressCallback({
      percent: 100,
      status: 'Download started',
      done: true
    });

    return { success: true, filename: result.filename };
  } catch (error) {
    console.error('Export failed:', error);
    stateManager.state = 'idle';

    // Notify UI about the error and signal completion
    try {
      chrome.runtime.sendMessage({
        action: 'exportProgress',
        sessionId,
        error: error.message,
        done: true
      });
    } catch (err) {
      console.warn('Failed to send export error progress', err);
    }

    return { success: false, error: error.message };
  }
}

// ==================== Message Handler Helpers ====================

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

// ==================== Runtime Message Handler ====================

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

        // ⭐ NEW: optional cancel support from UI
        case 'cancelExport':
          if (typeof exportService.cancelExport === 'function') {
            await exportService.cancelExport(message.sessionId);
          }
          stateManager.state = 'idle';
          try {
            chrome.runtime.sendMessage({
              action: 'exportProgress',
              status: 'Export cancelled',
              done: true,
              canceled: true,
              sessionId: message.sessionId
            });
          } catch (err) {
            console.warn('Failed to send cancel progress', err);
          }
          response = { success: true };
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
          for (const sessionItem of allSessions) {
            await storage.clearSession(sessionItem.sessionId);
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

// ==================== Keyboard Shortcut Handler ====================

// ⭐ NEW: Cross-platform keyboard shortcut for screenshot via commands
chrome.commands?.onCommand.addListener(async (command) => {
  // Match the command name you define in manifest.json:
  // "capture_screenshot" or use "_execute_action" if you bind the shortcut there.
  if (command === 'capture_screenshot' || command === '_execute_action') {
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab?.id) {
        console.warn('No active tab for screenshot command');
        return;
      }

      const result = await captureScreenshot(activeTab.id, true);
      if (!result.success) {
        console.warn('Screenshot command failed:', result.error);
      }
    } catch (err) {
      console.error('Error handling screenshot command:', err);
    }
  }
});

chrome.runtime.onSuspend.addListener(() => {
  console.log('⚠️ Service worker suspending - persisting state');
  persistActiveRecording();
});

console.log('✅ TestSnapper background service worker initialized');
