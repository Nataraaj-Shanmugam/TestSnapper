/**
 * Background Service Worker
 * 
 * CRITICAL FIXES APPLIED:
 * - BUG-005: Complete session recovery with tab validation and content script re-injection
 * - BUG-006: Screenshot serialization validated (using dataUrl throughout)
 * - BG-002: Rate limiting on screenshots (1 second debounce)
 * - BG-003: Cleanup of orphaned data on startup and session end
 * - BG-004: Export progress error handling improved
 * - BG-005: Export cancellation implemented
 * - BG-006: Settings validation added
 * - Added storage quota monitoring and notifications
 */

import { StorageManager } from '../core/storage.js';
import { ExportService } from '../core/export-service.js';
import { Utils } from '../core/utils.js';
import { addPendingFlush, removePendingFlush } from '../core/flush-utils.js';

// ==================== Broadcast Helpers ====================

/**
 * Notify popup / review page that session data changed,
 * so they can sync to the file system.
 */
function broadcastSessionChange(sessionId, changeType) {
  chrome.runtime.sendMessage({
    action: 'sessionDataChanged',
    sessionId,
    changeType  // 'created' | 'updated' | 'deleted' | 'steps_changed'
  }).catch(() => { }); // Ignore if no listeners
}

// ==================== State Management ====================

class RecordingStateManager {
  constructor() {
    this.state = 'idle';
    this.session = null;
    this.stepSequence = 0;
    this.sequenceLock = Promise.resolve();
    this.lastScreenshotTime = 0; // BUG FIX: BG-002
    this.screenshotDebounceMs = 1000; // 1 second minimum between screenshots
  }

  startRecording(session) {
    this.state = 'recording';
    this.session = session;
    this.stepSequence = 0;
    this.lastScreenshotTime = 0;
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
    this.lastScreenshotTime = 0;
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
   * BUG FIX: Fixed missing releaseLock variable declaration
   */
  async incrementStepCount() {
    await this.sequenceLock;

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

  /**
   * BUG FIX: BG-002 - Check if enough time has passed since last screenshot
   */
  canTakeScreenshot() {
    const now = Date.now();
    return (now - this.lastScreenshotTime) >= this.screenshotDebounceMs;
  }

  /**
   * BUG FIX: BG-002 - Mark screenshot taken
   */
  markScreenshotTaken() {
    this.lastScreenshotTime = Date.now();
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
      autoScreenshot: false,
      imageQuality: 0.92,
      screenshotFormat: 'png',
      exportImageQuality: 'auto'
    };
  }

  async get() {
    if (this.cache) return this.cache;

    const result = await chrome.storage.local.get('settings');
    const loadedSettings = result.settings || {};

    // BG-MED-003: Validate settings on load
    const validated = {};

    // Validate screenshotSeconds
    if (loadedSettings.screenshotSeconds !== undefined) {
      const val = parseInt(loadedSettings.screenshotSeconds);
      validated.screenshotSeconds = isNaN(val) ? this.defaults.screenshotSeconds : Math.max(1, Math.min(60, val));
    }

    // Validate maxSessions
    if (loadedSettings.maxSessions !== undefined) {
      const val = parseInt(loadedSettings.maxSessions);
      validated.maxSessions = isNaN(val) ? this.defaults.maxSessions : Math.max(1, Math.min(100, val));
    }

    // Validate imageQuality
    if (loadedSettings.imageQuality !== undefined) {
      const val = parseFloat(loadedSettings.imageQuality);
      validated.imageQuality = isNaN(val) ? this.defaults.imageQuality : Math.max(0.1, Math.min(1.0, val));
    }

    // Validate boolean fields
    if (loadedSettings.autoScreenshot !== undefined) {
      validated.autoScreenshot = Boolean(loadedSettings.autoScreenshot);
    }

    // Validate screenshotFormat
    if (loadedSettings.screenshotFormat !== undefined) {
      const validFormats = ['png', 'jpeg-high'];
      validated.screenshotFormat = validFormats.includes(loadedSettings.screenshotFormat)
        ? loadedSettings.screenshotFormat : this.defaults.screenshotFormat;
    }

    // Validate exportImageQuality
    if (loadedSettings.exportImageQuality !== undefined) {
      const validExportQualities = ['auto', 'png', 'jpeg-high', 'jpeg-standard'];
      validated.exportImageQuality = validExportQualities.includes(loadedSettings.exportImageQuality)
        ? loadedSettings.exportImageQuality : this.defaults.exportImageQuality;
    }

    this.cache = { ...this.defaults, ...validated };
    return this.cache;
  }

  /**
   * BUG FIX: BG-006 - Settings validation
   */
  async save(settings) {
    // Validate settings
    const validated = { ...settings };

    if (validated.screenshotSeconds) {
      validated.screenshotSeconds = Math.max(1, Math.min(60, parseInt(validated.screenshotSeconds)));
    }

    if (validated.maxSessions) {
      validated.maxSessions = Math.max(1, Math.min(100, parseInt(validated.maxSessions)));
    }

    if (validated.imageQuality) {
      validated.imageQuality = Math.max(0.1, Math.min(1.0, parseFloat(validated.imageQuality)));
    }

    await chrome.storage.local.set({ settings: validated });
    this.cache = validated;
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

// SEC-012: Set uninstall URL and handle install/update events
chrome.runtime.onInstalled.addListener((details) => {
  // Set feedback URL for when users uninstall the extension
  chrome.runtime.setUninstallURL('https://forms.gle/testsnapper-feedback');

  if (details.reason === 'install') {
    console.log('✅ TestSnapper installed successfully');
  } else if (details.reason === 'update') {
    console.log(`✅ TestSnapper updated from ${details.previousVersion} to ${chrome.runtime.getManifest().version}`);
  }
});

// BUG FIX: BG-003 - Cleanup orphaned data on startup
storage.init().then(async () => {
  try {
    const orphanCount = await storage.cleanupOrphans();
    if (orphanCount > 0) {
      console.log(`🧹 Startup cleanup: removed ${orphanCount} orphaned assets`);
    }
  } catch (err) {
    console.error('Startup cleanup failed:', err);
  }
});

// Setup storage quota monitoring
storage.onQuotaWarning((usage) => {
  // Notify all extension pages about quota warning
  chrome.runtime.sendMessage({
    action: 'storageQuotaWarning',
    usage: usage
  }).catch(() => {
    // No listeners, that's okay
  });
});

/**
 * BUG FIX: BUG-005 - Complete Session Recovery
 * Fixed to properly validate tab existence and re-inject content scripts
 */
(async () => {
  try {
    const { activeRecording } = await chrome.storage.local.get('activeRecording');
    if (activeRecording) {
      console.log('🔄 Recovering active recording:', activeRecording.sessionId);

      // Validate that the recording data is complete
      if (!activeRecording.session || !activeRecording.session.sessionId) {
        console.warn('⚠️ Invalid active recording data, clearing...');
        await chrome.storage.local.remove('activeRecording');
        return;
      }

      // Try to find the tab that was being recorded
      const session = activeRecording.session;
      let recordingTab = null;

      try {
        // Check if we stored the tab ID
        if (session.tabId) {
          const tab = await chrome.tabs.get(session.tabId);
          if (tab && tab.url === session.env?.url) {
            recordingTab = tab;
          }
        }

        // If tab not found by ID, try to find by URL
        if (!recordingTab && session.env?.url) {
          const tabs = await chrome.tabs.query({ url: session.env.url });
          if (tabs.length > 0) {
            recordingTab = tabs[0];
          }
        }
      } catch (err) {
        console.warn('Tab from recording session no longer exists');
      }

      if (recordingTab) {
        // Tab still exists - restore full recording state
        console.log('✅ Found recording tab, re-injecting content scripts...');

        try {
          // Re-inject content scripts
          await chrome.scripting.executeScript({
            target: { tabId: recordingTab.id },
            files: ['src/content/selector.js', 'src/content/redactor.js', 'src/content/content.js']
          });

          // Wait a moment for scripts to initialize
          await new Promise(resolve => setTimeout(resolve, 200));

          // Restore recording state in content script
          await chrome.tabs.sendMessage(recordingTab.id, {
            action: 'restoreRecording',
            sessionId: session.sessionId,
            session: session,
            state: activeRecording.state
          });

          // Restore state manager
          stateManager.state = activeRecording.state;
          stateManager.session = activeRecording.session;
          stateManager.session.tabId = recordingTab.id; // Update tab ID
          stateManager.stepSequence = activeRecording.stepSequence;

          // Restore badge
          if (activeRecording.state === 'recording') {
            await BadgeManager.setRecording(recordingTab.id);
          } else if (activeRecording.state === 'paused') {
            await BadgeManager.setPaused(recordingTab.id);
          }

          console.log('✅ Recording session fully recovered');
        } catch (err) {
          console.error('Failed to restore recording state:', err);
          // Mark session as incomplete and clear active recording
          await markSessionIncomplete(session.sessionId);
          await chrome.storage.local.remove('activeRecording');
        }
      } else {
        // Tab is gone - mark session as incomplete
        console.warn('⚠️ Recording tab no longer exists, marking session incomplete');
        await markSessionIncomplete(session.sessionId);
        await chrome.storage.local.remove('activeRecording');

        // BG-HIGH-001: Notify user that recovery failed
        try {
          await chrome.notifications.create('session-recovery-failed', {
            type: 'basic',
            iconUrl: 'src/assets/icons/icon128.png',
            title: 'TestSnapper - Recording Recovery Failed',
            message: `Your previous recording session could not be recovered because the tab was closed. The session has been saved as incomplete.`,
            priority: 1
          });
        } catch (notifErr) {
          console.warn('Could not show notification:', notifErr);
        }
      }
    }
  } catch (err) {
    console.error('Failed to recover active recording:', err);
    // Clear corrupt active recording data
    await chrome.storage.local.remove('activeRecording');
  }
})();

/**
 * BUG FIX: BUG-005 - Mark session as incomplete when recovery fails
 */
async function markSessionIncomplete(sessionId) {
  try {
    const session = await storage.getSession(sessionId);
    if (session) {
      session.sessionName = `[INCOMPLETE] ${session.sessionName || 'Session'}`;
      session.incomplete = true;
      await storage.updateSession(session);
    }
  } catch (err) {
    console.error('Failed to mark session incomplete:', err);
  }
}

// ==================== Badge Management ====================

class BadgeManager {
  static async setRecording(tabId) {
    await chrome.action.setBadgeText({ text: '●', tabId });
    await chrome.action.setBadgeBackgroundColor({ color: '#dc2626', tabId });
    await chrome.action.setTitle({ title: 'TestSnapper - Recording', tabId });
  }

  static async setPaused(tabId) {
    await chrome.action.setBadgeText({ text: '❚❚', tabId });
    await chrome.action.setBadgeBackgroundColor({ color: '#d97706', tabId });
    await chrome.action.setTitle({ title: 'TestSnapper - Paused', tabId });
  }

  static async clear(tabId) {
    await chrome.action.setBadgeText({ text: '', tabId });
    await chrome.action.setTitle({ title: 'TestSnapper - Record UI Tests', tabId });
  }
}

// ==================== Pending Flush Management ====================
// addPendingFlush / removePendingFlush imported from ../core/flush-utils.js

async function clearBufferForSession(sessionId) {
  await storage.clearSession(sessionId);
  await removePendingFlush(sessionId);
  console.log(`[Background] Cleared buffer for session ${sessionId}`);
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
    stepCount: 0,
    tabId: tabInfo.tabId // BUG FIX: Store tab ID for recovery
  };

  await storage.createSession(session);
  return session;
}

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

/**
 * BUG FIX: BG-002 - Added rate limiting
 * BUG FIX: BUG-006 - Validated screenshot serialization (using dataUrl)
 */
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

  // BUG FIX: BG-002 - Rate limiting check (only for auto-screenshots)
  // Manual screenshots always bypass rate limiting
  if (!isManual && !stateManager.canTakeScreenshot()) {
    console.log('⏸️ Auto-screenshot rate limited');
    // CNT-MED-003: Notify content script to show visual feedback
    chrome.tabs.sendMessage(tabId, { action: 'screenshotRateLimited' }).catch(() => {});
    return { success: false, error: 'Rate limited' };
  }

  try {
    const tab = await chrome.tabs.get(tabId);

    if (!tab || !tab.windowId) {
      throw new Error('Invalid tab or window ID');
    }

    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });

    await chrome.tabs.sendMessage(tabId, { action: 'beforeScreenshot' }).catch(() => { });
    await new Promise(resolve => setTimeout(resolve, 150));

    const settings = await settingsManager.get();

    // Smart capture: PNG (lossless) by default, JPEG-high as user option
    let captureOptions;
    if (settings.screenshotFormat === 'jpeg-high') {
      const quality = Math.round((settings.imageQuality || 0.92) * 100);
      captureOptions = { format: 'jpeg', quality: quality };
    } else {
      captureOptions = { format: 'png' };
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, captureOptions);

    chrome.tabs.sendMessage(tabId, { action: 'afterScreenshot' }).catch(() => { });

    // BUG FIX: BG-MED-001 - Validate screenshot data URL format
    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
      throw new Error('Screenshot capture returned invalid data URL format');
    }

    // Additional validation
    const base64Match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
    if (!base64Match) {
      throw new Error('Screenshot data URL has invalid format');
    }

    // BUG FIX: BG-002 - Mark screenshot taken for rate limiting
    stateManager.markScreenshotTaken();

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

    if (settings.includeTimestamp !== false) {
      step.timestamp = new Date().toISOString();
    }

    await storage.addStep(step);

    // BUG FIX: BUG-006 - Store dataUrl directly (validated working in storage.js)
    await storage.addAsset({
      id: Utils.generateUUID(),
      sessionId: stateManager.session.sessionId,
      stepId: step.id,
      type: 'screenshot',
      dataUrl: dataUrl,
      createdAt: new Date().toISOString()
    });

    await storage.updateSession(stateManager.session);
    await persistActiveRecording();

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

  // Reset duplicate tracker for new session
  _lastAddedStep = null;

  try {
    // Add tabId to tabInfo
    tabInfo.tabId = tabId;

    const session = await createSession(tabInfo);
    stateManager.startRecording(session);
    await persistActiveRecording();

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

    await chrome.tabs.sendMessage(tabId, {
      action: 'startRecording',
      sessionId: session.sessionId,
      session: session
    });

    console.log('✅ Recording started:', session.sessionId);
    return { success: true, sessionId: session.sessionId };

  } catch (error) {
    console.error('Failed to start recording:', error);
    stateManager.stopRecording();
    await persistActiveRecording();
    return { success: false, error: error.message };
  }
}

async function pauseRecording(tabId) {
  if (!stateManager.isRecording()) {
    return { success: false, error: 'Not recording' };
  }

  stateManager.pauseRecording();
  await persistActiveRecording();
  await BadgeManager.setPaused(tabId);

  try {
    await chrome.tabs.sendMessage(tabId, { action: 'pauseRecording' });
  } catch (err) {
    console.warn('Could not notify content script of pause:', err);
  }

  return { success: true };
}

async function resumeRecording(tabId) {
  if (stateManager.state !== 'paused') {
    return { success: false, error: 'Not paused' };
  }

  stateManager.resumeRecording();
  await persistActiveRecording();
  await BadgeManager.setRecording(tabId);

  try {
    await chrome.tabs.sendMessage(tabId, { action: 'resumeRecording' });
  } catch (err) {
    console.warn('Could not notify content script of resume:', err);
  }

  return { success: true };
}

async function stopRecording(tabId) {
  if (stateManager.isIdle()) {
    return { success: false, error: 'Not recording' };
  }

  try {
    const sessionId = stateManager.stopRecording();
    await persistActiveRecording();
    await BadgeManager.clear(tabId);

    try {
      await chrome.tabs.sendMessage(tabId, { action: 'stopRecording' });
    } catch (err) {
      console.log('Content script not responding, continuing...');
    }

    // BUG FIX: BG-003 - Cleanup orphaned data after recording stops
    try {
      await storage.cleanupOrphans();
    } catch (err) {
      console.warn('Post-recording cleanup failed:', err);
    }

    // Add to pending flush list so window contexts know to flush to disk
    if (sessionId) {
      await addPendingFlush(sessionId);
      // Broadcast flush request to any open popup/review pages
      chrome.runtime.sendMessage({
        action: 'flushRecordingBuffer',
        sessionId
      }).catch(() => { }); // No listeners is fine — safety net on next popup open
    }

    console.log('✅ Recording stopped:', sessionId);
    broadcastSessionChange(sessionId, 'created');

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
    await persistActiveRecording();
    return { success: false, error: error.message };
  }
}

// ==================== Step Management ====================

// Track the last step to detect consecutive duplicates at the background level
let _lastAddedStep = null;

function _isConsecutiveDuplicate(stepData) {
  if (!_lastAddedStep) return false;

  // Same action + same fieldName + same selector CSS + same URL = duplicate
  if (_lastAddedStep.action !== stepData.action) return false;
  if (_lastAddedStep.fieldName !== stepData.fieldName) return false;
  if (_lastAddedStep.url !== stepData.url) return false;

  // For type/select actions, allow if value changed
  if ((stepData.action === 'type' || stepData.action === 'select') &&
      stepData.value !== _lastAddedStep.value) {
    return false;
  }

  // Compare selector CSS if both have one
  const prevCss = _lastAddedStep.selector?.css || '';
  const currCss = stepData.selector?.css || '';
  if (prevCss && currCss && prevCss !== currCss) return false;

  // If target labels match too, it's definitely a duplicate
  if (_lastAddedStep.targetLabel === stepData.targetLabel) return true;

  // Even without matching targetLabel, same action+field+url+selector is enough
  return true;
}

async function addStep(stepData) {
  if (!stateManager.session) {
    console.error('❌ No active session - rejecting step');
    return { success: false, error: 'No active session' };
  }

  try {
    // Server-side consecutive duplicate detection
    if (_isConsecutiveDuplicate(stepData)) {
      console.log('⏭️ Skipping consecutive duplicate step:', stepData.action, stepData.fieldName);
      return { success: true, skipped: true };
    }

    const settings = await settingsManager.get();
    const sequence = await stateManager.incrementStepCount();

    const step = {
      id: Utils.generateUUID(),
      sessionId: stateManager.session.sessionId,
      sequence: sequence,
      ...stepData
    };

    if (settings.includeTimestamp !== false) {
      step.timestamp = new Date().toISOString();
    }

    _lastAddedStep = stepData;

    await storage.addStep(step);
    await storage.updateSession(stateManager.session);
    await persistActiveRecording();

    return { success: true, step };
  } catch (error) {
    console.error('Failed to add step:', error);
    return { success: false, error: error.message };
  }
}

// ==================== Export Management ====================

/**
 * BUG FIX: BG-004 - Improved error handling
 * BUG FIX: BG-005 - Export cancellation support
 */
async function exportSession(sessionId, format = 'json') {
  try {
    stateManager.setExporting();

    // BG-HIGH-003: Persist export state for crash recovery
    await chrome.storage.local.set({
      activeExport: { sessionId, format, startedAt: Date.now() }
    });

    const progressCallback = (update = {}) => {
      // BUG FIX: BG-004 - Only send if there are listeners
      chrome.runtime.sendMessage({
        action: 'exportProgress',
        sessionId,
        ...update
      }).catch(() => {
        // No listeners, that's okay
      });
    };

    progressCallback({
      percent: 0,
      status: 'Preparing export...'
    });

    try {
      const steps = await storage.getSteps(sessionId);
      progressCallback({
        status: 'Preparing export...',
        totalSteps: steps.length
      });
    } catch (e) {
      console.warn('Unable to load steps for progress metadata', e);
    }

    const result = await exportService.exportSession(sessionId, format, progressCallback);

    let downloadUrl;
    // BUG FIX: BG-MED-004 - Sanitize filename to remove invalid characters
    let filename = result.filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');

    if (result.blob) {
      // Binary format (docx) – convert Blob → dataUrl for the Downloads API
      downloadUrl = await Utils.blobToDataURL(result.blob);
    } else {
      // Text format (json / csv / markdown) – encode as before
      const utf8Bytes = new TextEncoder().encode(result.content);

      let binaryString = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < utf8Bytes.length; i += chunkSize) {
        const chunk = utf8Bytes.subarray(i, i + chunkSize);
        binaryString += String.fromCharCode.apply(null, chunk);
      }

      const base64Content = btoa(binaryString);
      downloadUrl = `data:${result.mimeType};charset=utf-8;base64,${base64Content}`;
    }

    progressCallback({
      percent: 95,
      status: 'Preparing download...'
    });

    await chrome.downloads.download({
      url: downloadUrl,
      filename: filename,
      saveAs: false,
      conflictAction: 'uniquify'
    });

    stateManager.state = 'idle';

    // BG-HIGH-003: Clear export state on success
    await chrome.storage.local.remove('activeExport');

    progressCallback({
      percent: 100,
      status: 'Download started',
      done: true
    });

    return { success: true, filename };
  } catch (error) {
    console.error('Export failed:', error);
    stateManager.state = 'idle';

    // BG-HIGH-003: Clear export state on failure
    await chrome.storage.local.remove('activeExport').catch(() => {});

    // BUG FIX: BG-004 - Safe error notification
    chrome.runtime.sendMessage({
      action: 'exportProgress',
      sessionId,
      error: error.message,
      done: true
    }).catch(() => {
      // No listeners
    });

    return { success: false, error: error.message };
  }
}

// ==================== Message Handler Helpers ====================

async function getSenderTabId(sender, message) {
  // Explicit tabId in message takes priority (used by tests and programmatic callers)
  if (message?.tabId) return message.tabId;
  if (sender?.tab?.id) return sender.tab.id;
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return activeTab?.id;
}

/**
 * BUG FIX: BUG-006 - Validated screenshot retrieval (using dataUrl)
 */
async function getScreenshot(stepId) {
  try {
    const assets = await storage.getAssetsByStepId(stepId);
    const screenshot = assets.find(a => a.type === 'screenshot');

    if (screenshot && screenshot.dataUrl) {
      return { success: true, dataUrl: screenshot.dataUrl };
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
      const tabId = await getSenderTabId(sender, message);

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

        // BUG FIX: BG-005 - Export cancellation
        case 'cancelExport':
          if (typeof exportService.cancelExport === 'function') {
            await exportService.cancelExport(message.sessionId);
          }
          stateManager.state = 'idle';
          chrome.runtime.sendMessage({
            action: 'exportProgress',
            status: 'Export cancelled',
            done: true,
            canceled: true,
            sessionId: message.sessionId
          }).catch(() => { });
          response = { success: true };
          break;

        case 'getAllSessions':
          let sessions = await storage.getAllSessions();
          sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          response = { success: true, sessions };
          break;

        case 'getSession':
          const session = await storage.getSession(message.sessionId);
          if (stateManager.session && stateManager.session.sessionId === message.sessionId) {
            session.startTime = stateManager.session.createdAt;
          }
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
          broadcastSessionChange(message.sessionId, 'deleted');
          response = { success: true };
          break;

        case 'clearAllSessions':
          const allSessions = await storage.getAllSessions();
          for (const sessionItem of allSessions) {
            await storage.clearSession(sessionItem.sessionId);
            broadcastSessionChange(sessionItem.sessionId, 'deleted');
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
          broadcastSessionChange(message.sessionId, 'updated');
          response = { success: true };
          break;

        case 'updateAllSteps':
          await storage.updateAllSteps(message.sessionId, message.steps);
          broadcastSessionChange(message.sessionId, 'steps_changed');
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

        // New action for storage usage monitoring
        case 'getStorageUsage':
          const usage = await storage.getStorageUsage();
          response = { success: true, usage };
          break;

        // STR-MED-003: Backup/Restore functionality
        case 'exportAllData':
          const exportData = await storage.exportAllData();
          response = { success: true, data: exportData };
          break;

        case 'importAllData':
          await storage.importAllData(message.data);
          response = { success: true };
          break;

        // Filesystem storage: clear buffer after successful flush to disk
        case 'clearBuffer':
          await clearBufferForSession(message.sessionId);
          response = { success: true };
          break;

        // Filesystem storage: get buffered session data for flushing
        case 'getBufferedSession':
          const bufferedSession = await storage.getSession(message.sessionId);
          if (bufferedSession) {
            const bufferedSteps = bufferedSession.steps || await storage.getSteps(message.sessionId);
            const bufferedAssets = bufferedSession.assets || await storage.getAllAssets(message.sessionId);
            response = { success: true, session: bufferedSession, steps: bufferedSteps, assets: bufferedAssets };
          } else {
            response = { success: false, error: 'Session not found in buffer' };
          }
          break;

        // Filesystem storage: get pending flush list
        case 'getPendingFlush': {
          const flushResult = await chrome.storage.local.get(PENDING_FLUSH_KEY);
          response = { success: true, pending: flushResult[PENDING_FLUSH_KEY] || [] };
          break;
        }

        // Cross-frame label resolution: relay request to main frame
        case 'getFrameLabel':
          try {
            const frameTab = sender.tab;
            if (frameTab && frameTab.id) {
              const frameResult = await chrome.tabs.sendMessage(frameTab.id, {
                action: 'getIframeLabel',
                frameUrl: message.frameUrl
              }, { frameId: 0 });
              response = frameResult || { label: null };
            } else {
              response = { label: null };
            }
          } catch (frameErr) {
            response = { label: null };
          }
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

chrome.commands?.onCommand.addListener(async (command) => {
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

  if (command === 'toggle_recording') {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) return;

    if (stateManager.state === 'recording') {
      await pauseRecording(activeTab.id);
    } else if (stateManager.state === 'paused') {
      await resumeRecording(activeTab.id);
    }
  }

  if (command === 'stop_recording') {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) return;
    await stopRecording(activeTab.id);
  }
});

chrome.runtime.onSuspend.addListener(() => {
  console.log('⚠️ Service worker suspending - persisting state');
  persistActiveRecording();
});

console.log('✅ TestSnapper background service worker initialized');