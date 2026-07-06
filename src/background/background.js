/**
 * Background Service Worker
 *
 * Manages extension lifecycle, recording state, message routing, screenshots,
 * API capture, and session export with crash recovery.
 */

import { StorageManager } from '../core/storage.js';
import { ExportService } from '../core/export-service.js';
import { Utils } from '../core/utils.js';
import { addPendingFlush, removePendingFlush, getPendingFlush } from '../core/flush-utils.js';
import { Logger } from '../core/logger.js';
import { _isConsecutiveDuplicate, shouldRecordRequest } from '../core/recorder-utils.js';
import { sanitizeUrl, maskGenericPII } from '../core/privacy-utils.js';

/**
 * SEC-1/SEC-2: server-side privacy pass applied to every step before it is
 * persisted. Strips sensitive query params from URLs at capture time (so tokens
 * never reach storage/backups) and runs a generic PII backstop over free-text
 * fields. Mutates and returns the step.
 */
function sanitizeStepForStorage(step) {
  if (!step || typeof step !== 'object') return step;
  if (typeof step.url === 'string') step.url = sanitizeUrl(step.url);
  if (step.action === 'navigate' && typeof step.value === 'string') {
    step.value = sanitizeUrl(step.value);
  } else if (step.action !== 'apicall' && typeof step.value === 'string') {
    // navigate handled above; apicall value is an HTTP method, not free text.
    step.value = maskGenericPII(step.value);
  }
  if (typeof step.targetLabel === 'string') step.targetLabel = maskGenericPII(step.targetLabel);
  return step;
}

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
    this.lastScreenshotTime = 0;
    this.screenshotDebounceMs = 1000; // 1 second minimum between screenshots
    this.screenshotCount = 0;
  }

  startRecording(session) {
    this.state = 'recording';
    this.session = session;
    this.stepSequence = 0;
    this.lastScreenshotTime = 0;
    this.screenshotCount = 0;
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
      stepCount: this.session?.stepCount || 0,
      screenshotCount: this.screenshotCount
    };
  }

  /**
   * BUG FIX: Fixed missing releaseLock variable declaration
   * BUG-007 FIX: Added 10-second timeout to prevent deadlock if the lock chain
   * is ever broken (e.g. by an unhandled rejection replacing the promise).
   */
  async incrementStepCount() {
    const lockTimeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('sequenceLock timeout after 10s')), 10000)
    );
    await Promise.race([this.sequenceLock, lockTimeout]).catch((err) => {
      Logger.warn('[StateManager] sequenceLock timed out, resetting:', err.message);
      this.sequenceLock = Promise.resolve(); // reset so future calls aren't permanently stuck
    });

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
      captureOnNavigation: true,
      smartDedup: true,
      imageQuality: 0.92,
      screenshotFormat: 'png',
      exportImageQuality: 'auto'
    };
  }

  async get() {
    if (this.cache) return this.cache;

    const result = await chrome.storage.local.get('settings');
    const loadedSettings = result.settings || {};

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
      const validExportQualities = ['auto', 'high', 'standard']; // P1-19: must match popup.html options and ExportService ALLOWED list
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

    if (validated.screenshotSeconds !== undefined) {
      validated.screenshotSeconds = Math.max(1, Math.min(60, parseInt(validated.screenshotSeconds)));
    }

    if (validated.maxSessions !== undefined) {
      validated.maxSessions = Math.max(1, Math.min(100, parseInt(validated.maxSessions)));
    }

    if (validated.imageQuality !== undefined) {
      validated.imageQuality = Math.max(0.1, Math.min(1.0, parseFloat(validated.imageQuality)));
    }

    if (validated.screenshotFormat !== undefined) {
      const validFormats = ['png', 'jpeg-high'];
      if (!validFormats.includes(validated.screenshotFormat)) {
        validated.screenshotFormat = this.defaults.screenshotFormat;
      }
    }

    if (validated.exportImageQuality !== undefined) {
      const validExportQualities = ['auto', 'high', 'standard']; // P1-19: must match popup.html options and ExportService ALLOWED list
      if (!validExportQualities.includes(validated.exportImageQuality)) {
        validated.exportImageQuality = this.defaults.exportImageQuality;
      }
    }

    this.cache = { ...this.defaults, ...validated };
    await chrome.storage.local.set({ settings: this.cache });
  }

  clearCache() {
    this.cache = null;
  }
}

function sameOrigin(a, b) {
  try { return new URL(a).origin === new URL(b).origin; } catch { return false; }
}

// ==================== Initialize Services ====================

const storage = new StorageManager();
const exportService = new ExportService(storage);
const stateManager = new RecordingStateManager();
const settingsManager = new SettingsManager();

// Shared content-script file list — both injection sites use this constant so they never drift.
// Note: field-name-resolver.js must be injected before content.js which depends on window.FieldNameResolver
const CONTENT_SCRIPT_FILES = [
  'src/content/logger.js',
  'src/content/selector.js',
  'src/content/field-name-resolver.js',
  'src/content/redactor.js',
  'src/content/content.js'
];

chrome.runtime.onInstalled.addListener((details) => {
  // Opens a voluntary feedback form on uninstall — no data is sent automatically.
  chrome.runtime.setUninstallURL('https://forms.gle/testsnapper-feedback');

  if (details.reason === 'install') {
    Logger.info('✅ TestSnapper installed successfully');
  } else if (details.reason === 'update') {
    Logger.info(`✅ TestSnapper updated from ${details.previousVersion} to ${chrome.runtime.getManifest().version}`);
  }
});

// storage.init() already calls _autoCleanupCheck() which enforces the 7-day gate —
// no unconditional cleanupOrphans() call needed here.
storage.init().catch(Logger.error);

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

// ==================== Session Recovery ====================

/**
 * [CRIT] FUNC-003+PERF-001: Recovery is captured as a module-level promise.
 * onMessage and onCommand await this before touching stateManager so that the
 * waking message (addStep / getState) doesn't run while stateManager.session is
 * still null.
 *
 * BUG FIX: BUG-005 - Complete Session Recovery
 * Fixed to properly validate tab existence and re-inject content scripts
 */
const recoveryReady = (async () => {
  try {
    const { activeRecording } = await chrome.storage.local.get('activeRecording');
    if (!activeRecording) return;

    Logger.debug('🔄 Recovering active recording:', activeRecording.sessionId);

    // Validate that the recording data is complete
    if (!activeRecording.session || !activeRecording.session.sessionId) {
      Logger.warn('⚠️ Invalid active recording data, clearing...');
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
        if (tab && sameOrigin(tab.url, session.env?.url)) {
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
      Logger.warn('Tab from recording session no longer exists');
    }

    if (recordingTab) {
      // Tab still exists — ping first to check if content scripts are already loaded
      Logger.debug('✅ Found recording tab, checking for existing content scripts...');

      let alreadyInjected = false;
      try {
        await chrome.tabs.sendMessage(recordingTab.id, { action: 'ping' });
        alreadyInjected = true;
        Logger.debug('Content scripts already present, skipping re-injection');
      } catch (_pingErr) {
        // No response — need to inject
      }

      if (!alreadyInjected) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: recordingTab.id },
            files: CONTENT_SCRIPT_FILES
          });
          Logger.debug('Content scripts re-injected');
        } catch (injectErr) {
          if (!injectErr.message?.includes('already')) {
            // Injection failed (e.g. chrome:// page) — mark incomplete and bail
            Logger.error('Failed to re-inject content scripts:', injectErr);
            await addPendingFlush(session.sessionId);
            await markSessionIncomplete(session.sessionId);
            await chrome.storage.local.remove('activeRecording');
            return;
          }
        }
      }

      try {
        // Wait a moment for scripts to initialize
        await new Promise(resolve => setTimeout(resolve, 200));

        // Restore recording state in content script
        let restoreSettings = {};
        try {
          restoreSettings = await settingsManager.get();
        } catch (settingsErr) {
          Logger.warn('[BG] Failed to load settings during restore, using defaults:', settingsErr);
        }
        await chrome.tabs.sendMessage(recordingTab.id, {
          action: 'restoreRecording',
          sessionId: session.sessionId,
          session: session,
          state: activeRecording.state,
          settings: restoreSettings
        });

        // Restore state manager — must happen before any queued messages are processed
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

        Logger.debug('✅ Recording session fully recovered');
      } catch (err) {
        Logger.error('Failed to restore recording state:', err);
        await addPendingFlush(session.sessionId);
        await markSessionIncomplete(session.sessionId);
        await chrome.storage.local.remove('activeRecording');
      }
    } else {
      // Tab is gone - mark session as incomplete
      Logger.warn('⚠️ Recording tab no longer exists, marking session incomplete');
      await addPendingFlush(session.sessionId);
      await markSessionIncomplete(session.sessionId);
      await chrome.storage.local.remove('activeRecording');

      try {
        await chrome.notifications.create('session-recovery-failed', {
          type: 'basic',
          iconUrl: 'src/assets/icons/icon128.png',
          title: 'TestSnapper - Recording Recovery Failed',
          message: `Your previous recording session could not be recovered because the tab was closed. The session has been saved as incomplete.`,
          priority: 1
        });
      } catch (notifErr) {
        Logger.warn('Could not show notification:', notifErr);
      }
    }
  } catch (err) {
    Logger.error('Failed to recover active recording:', err);
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
    Logger.error('Failed to mark session incomplete:', err);
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
  Logger.debug(`[Background] Cleared buffer for session ${sessionId}`);
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
    tabId: tabInfo.tabId
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
 * Captures the current viewport screenshot and adds it as a step asset.
 *
 * @param {number} tabId - The tab ID to capture
 * @param {boolean} [isManual=true] - If true, bypass rate limiting; if false, apply 1-second debounce
 * @param {boolean} [forceAnyTab=false] - If true, allow screenshot from any tab; otherwise only recorded tab
 * @returns {Promise<{success: boolean, error?: string, step?: Object, skipped?: boolean}>}
 *
 * @note Captures the full visible viewport; redaction applies to recorded values only — on-screen PII in screenshots is not masked.
 */
async function captureScreenshot(tabId, isManual = true, forceAnyTab = false, trigger = null) {
  Logger.debug('📸 Screenshot capture requested for tab:', tabId, 'manual:', isManual);

  if (!stateManager.isRecording()) {
    Logger.error('❌ Not recording, cannot capture screenshot');
    return { success: false, error: 'Not recording' };
  }

  if (!stateManager.session) {
    Logger.error('❌ No active session');
    return { success: false, error: 'No active session' };
  }

  const recordedTabId = stateManager.session.tabId;
  if (!forceAnyTab && recordedTabId && tabId !== recordedTabId) {
    Logger.warn(`Screenshot skipped: tab ${tabId} is not the recorded tab ${recordedTabId}`);
    return { success: false, error: 'Tab mismatch' };
  }

  // Rate limiting applies to auto-screenshots only; manual screenshots bypass it
  if (!isManual && !stateManager.canTakeScreenshot()) {
    Logger.debug('⏸️ Auto-screenshot rate limited');
    // CNT-MED-003: Notify content script to show visual feedback
    chrome.tabs.sendMessage(tabId, { action: 'screenshotRateLimited' }).catch(() => {});
    return { success: false, error: 'Rate limited' };
  }

  if (!isManual) {
    try {
      const sensitiveCheck = await chrome.tabs.sendMessage(tabId, { action: 'isSensitiveFieldActive' });
      if (sensitiveCheck?.sensitive) {
        Logger.debug('🔒 Auto-screenshot suppressed — sensitive field is active');
        return { success: false, error: 'Sensitive field active' };
      }
    } catch (_) {
      // Content script not yet ready; allow capture to proceed
    }
  }

  try {
    const tab = await chrome.tabs.get(tabId);

    if (!tab || !tab.windowId) {
      throw new Error('Invalid tab or window ID');
    }

    if (isManual) {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    } else if (!tab.active) {
      // FD-1: captureVisibleTab captures whatever tab is VISIBLE in the window.
      // If the recorded tab is backgrounded, an auto capture would photograph an
      // unrelated tab (mail, banking, …) into the session. Skip instead.
      Logger.debug('⏸️ Auto-screenshot skipped — recorded tab is not the active tab');
      return { success: false, error: 'Recorded tab not visible' };
    }

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

    // Validate screenshot data URL format
    if (!dataUrl || !dataUrl.startsWith('data:image/')) {
      throw new Error('Screenshot capture returned invalid data URL format');
    }

    // Additional validation
    const base64Match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/);
    if (!base64Match) {
      throw new Error('Screenshot data URL has invalid format');
    }

    stateManager.markScreenshotTaken();
    stateManager.screenshotCount++;

    const sequence = await stateManager.incrementStepCount();

    const step = {
      id: Utils.generateUUID(),
      sessionId: stateManager.session.sessionId,
      sequence: sequence,
      action: 'screenshot',
      fieldName: 'Screenshot',
      // Distinguish the automatic sources so a navigation-triggered capture is
      // never mislabeled "Auto Screenshot" (the periodic auto-capture).
      targetLabel: isManual
        ? 'Manual Screenshot'
        : (trigger === 'navigation' ? 'Navigation Screenshot' : 'Auto Screenshot'),
      screenshotTrigger: isManual ? 'manual' : (trigger || 'auto'),
      url: sanitizeUrl(tab.url), // SEC-1: strip tokens from the captured tab URL
      value: null,
      isSensitive: false,
      isManual: isManual,
      hasScreenshot: true
    };

    if (settings.includeTimestamp !== false) {
      step.timestamp = new Date().toISOString();
    }

    await storage.addStep(step);

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
    Logger.error('❌ Screenshot capture failed:', error);
    return { success: false, error: error.message };
  }
}

// ==================== API Call Capture (webRequest) ====================

/**
 * Captures XHR/fetch requests on the recorded tab as 'apicall' steps while
 * recording, gated by the captureApiCalls / captureFailedCalls / captureAllCalls
 * settings. Observation-only — reads method/url/status/type, never request or
 * response bodies, so payloads are not captured.
 *
 * Decision logic (master captureApiCalls must be on):
 *   captureFailedCalls (and not captureAllCalls) → record only failures
 *   captureAllCalls, or neither sub-flag          → record all requests
 *
 * Limitation: webRequest listeners are attached at runtime and are re-attached
 * on resume, but not across a cold service-worker restart mid-recording.
 */
const ApiCapture = {
  _attached: false,
  _tabId: null,
  _settings: null,
  _onCompleted: null,
  _onError: null,

  start(tabId, settings) {
    this.stop();
    if (!settings || !settings.captureApiCalls) return;
    if (typeof chrome === 'undefined' || !chrome.webRequest) return;

    this._tabId = tabId;
    this._settings = settings;

    const filter = { urls: ['<all_urls>'], tabId, types: ['xmlhttprequest'] };

    this._onCompleted = (details) => {
      const ok = details.statusCode < 400;
      this._maybeRecord(details, details.statusCode, ok);
    };
    this._onError = (details) => {
      this._maybeRecord(details, 0, false);
    };

    try {
      chrome.webRequest.onCompleted.addListener(this._onCompleted, filter);
      chrome.webRequest.onErrorOccurred.addListener(this._onError, filter);
      this._attached = true;
      Logger.debug('🌐 API capture attached for tab', tabId);
    } catch (err) {
      Logger.warn('API capture failed to attach:', err);
    }
  },

  stop() {
    if (this._attached) {
      try {
        if (this._onCompleted) chrome.webRequest.onCompleted.removeListener(this._onCompleted);
        if (this._onError) chrome.webRequest.onErrorOccurred.removeListener(this._onError);
      } catch (_) { /* listeners already gone */ }
    }
    this._attached = false;
    this._tabId = null;
    this._settings = null;
    this._onCompleted = null;
    this._onError = null;
  },

  _shouldRecord(ok) {
    return shouldRecordRequest(null, this._settings, ok);
  },

  async _maybeRecord(details, status, ok) {
    if (!stateManager.isRecording()) return;
    if (!this._shouldRecord(ok)) return;
    try {
      const method = (details.method || 'GET').toUpperCase();
      const displayUrl = ApiCapture._stripQuery(details.url);
      const sequence = await stateManager.incrementStepCount();
      const step = {
        id: Utils.generateUUID(),
        sessionId: stateManager.session.sessionId,
        sequence,
        action: 'apicall',
        fieldName: 'API Call',
        targetLabel: method,
        url: sanitizeUrl(details.url), // SEC-6: strip tokens from captured request URLs
        value: method,
        apiStatus: ok ? status : (status || 'failed'),
        isSensitive: false,
        isManual: false,
        hasScreenshot: false,
        description: `${method} ${displayUrl} → ${ok ? status : (status || 'failed')}`
      };
      if (this._settings && this._settings.includeTimestamp !== false) {
        step.timestamp = new Date().toISOString();
      }

      await storage.addStep(step);
      await storage.updateSession(stateManager.session);
      await persistActiveRecording();
      broadcastSessionChange(stateManager.session.sessionId, 'steps_changed');
    } catch (err) {
      Logger.warn('API capture step failed:', err);
    }
  },

  _stripQuery(url) {
    try {
      const u = new URL(url);
      return u.origin + u.pathname;
    } catch (_) {
      return (url || '').split('?')[0];
    }
  }
};

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

    // Ping first to skip re-injection if content scripts are already loaded
    let alreadyLoaded = false;
    try {
      await chrome.tabs.sendMessage(tabId, { action: 'ping' });
      alreadyLoaded = true;
    } catch (_) {
      // Not loaded yet
    }

    if (!alreadyLoaded) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: CONTENT_SCRIPT_FILES
        });
      } catch (injectErr) {
        if (!injectErr.message?.includes('already')) {
          throw injectErr;
        }
      }
    }

    await new Promise(resolve => setTimeout(resolve, 100));

    const settings = await settingsManager.get();
    await chrome.tabs.sendMessage(tabId, {
      action: 'startRecording',
      sessionId: session.sessionId,
      session: session,
      settings: settings
    });

    // API call capture (gated on captureApiCalls inside start())
    ApiCapture.start(tabId, settings);

    Logger.debug('✅ Recording started:', session.sessionId);
    return { success: true, sessionId: session.sessionId };

  } catch (error) {
    Logger.error('Failed to start recording:', error);
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
  ApiCapture.stop();

  try {
    await chrome.tabs.sendMessage(tabId, { action: 'pauseRecording' });
  } catch (err) {
    Logger.warn('Could not notify content script of pause:', err);
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
  ApiCapture.start(tabId, await settingsManager.get());

  try {
    await chrome.tabs.sendMessage(tabId, { action: 'resumeRecording' });
  } catch (err) {
    Logger.warn('Could not notify content script of resume:', err);
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
    ApiCapture.stop();

    try {
      await chrome.tabs.sendMessage(tabId, { action: 'stopRecording' });
    } catch (err) {
      Logger.debug('Content script not responding, continuing...');
    }

    // Do NOT call cleanupOrphans() here. storage.init() already invokes _autoCleanupCheck()
    // which enforces the 7-day gate. Unconditional cleanup would spike memory usage.

    // Check autoSave — if disabled, discard the session immediately
    const settings = await settingsManager.get();
    if (settings.autoSave === false) {
      Logger.debug('⚠️ autoSave=false — discarding session:', sessionId);
      try {
        await storage.clearSession(sessionId);
      } catch (err) {
        Logger.warn('Failed to discard session after stop:', err);
      }
      broadcastSessionChange(sessionId, 'deleted');
      return { success: true, sessionId, discarded: true };
    }

    // Enforce maxSessions limit — delete oldest sessions beyond the cap
    try {
      const allSessions = await storage.getAllSessions();
      const maxSessions = settings.maxSessions || 25;
      if (allSessions.length > maxSessions) {
        const sorted = allSessions.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        const toDelete = sorted.slice(0, allSessions.length - maxSessions);
        for (const old of toDelete) {
          Logger.warn(`⚠️ maxSessions limit (${maxSessions}) reached — pruning session: ${old.sessionId} (created: ${old.createdAt})`);
          await storage.clearSession(old.sessionId);
          broadcastSessionChange(old.sessionId, 'deleted');
          Logger.debug('🗑️ Pruned old session:', old.sessionId);
        }
      }
    } catch (err) {
      Logger.warn('Session limit enforcement failed:', err);
    }

    // Add to pending flush list so window contexts know to flush to disk
    if (sessionId) {
      await addPendingFlush(sessionId);
      // Broadcast flush request to any already-open popup/review pages.
      // The review tab created below opens AFTER this broadcast and will not
      // receive it; instead it reads PENDING_FLUSH_KEY via getPendingFlush on
      // load, which is why addPendingFlush must be awaited before tab creation.
      chrome.runtime.sendMessage({
        action: 'flushRecordingBuffer',
        sessionId
      }).catch(() => { }); // No listeners is fine — safety net on next popup open
    }

    Logger.debug('✅ Recording stopped:', sessionId);
    broadcastSessionChange(sessionId, 'created');

    if (sessionId) {
      const reviewUrl = chrome.runtime.getURL(
        `src/ui/review/review-standalone.html?sessionId=${sessionId}`
      );
      await chrome.tabs.create({ url: reviewUrl });
    }

    return { success: true, sessionId };
  } catch (error) {
    Logger.error('Failed to stop recording:', error);
    stateManager.stopRecording();
    await persistActiveRecording();
    return { success: false, error: error.message };
  }
}

// ==================== Step Management ====================

// Track the last step to detect consecutive duplicates at the background level
let _lastAddedStep = null;

async function addStep(stepData, senderTabId) {
  // Reject steps when not actively recording (e.g. paused) — MED-001
  if (stateManager.state !== 'recording') {
    return { success: false, error: 'Not recording' };
  }

  // [FUNC-002]: Only accept steps from the recorded tab
  if (senderTabId && stateManager.session?.tabId && senderTabId !== stateManager.session.tabId) {
    Logger.warn(`addStep: ignored step from tab ${senderTabId}, recorded tab is ${stateManager.session.tabId}`);
    return { success: false, error: 'Wrong tab' };
  }

  if (!stateManager.session) {
    Logger.error('❌ No active session - rejecting step');
    return { success: false, error: 'No active session' };
  }

  try {
    const settings = await settingsManager.get();

    // Server-side consecutive duplicate detection (gated on smartDedup setting)
    if (settings.smartDedup !== false && _isConsecutiveDuplicate(stepData, _lastAddedStep)) {
      Logger.debug('⏭️ Skipping consecutive duplicate step:', stepData.action, stepData.fieldName);
      return { success: true, skipped: true };
    }
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

    // SEC-1/SEC-2: sanitize URLs + PII backstop before the step touches storage.
    sanitizeStepForStorage(step);

    _lastAddedStep = stepData;

    await storage.addStep(step);
    await storage.updateSession(stateManager.session);
    await persistActiveRecording();

    return { success: true, step };
  } catch (error) {
    Logger.error('Failed to add step:', error);
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

    await chrome.storage.local.set({
      activeExport: { sessionId, format, startedAt: Date.now() }
    });

    const progressCallback = (update = {}) => {
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
      Logger.warn('Unable to load steps for progress metadata', e);
    }

    const result = await exportService.exportSession(sessionId, format, progressCallback);

    let downloadUrl;
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

    await chrome.storage.local.remove('activeExport');

    progressCallback({
      percent: 100,
      status: 'Download started',
      done: true
    });

    return { success: true, filename };
  } catch (error) {
    Logger.error('Export failed:', error);
    stateManager.state = 'idle';

    await chrome.storage.local.remove('activeExport').catch(() => {});

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

/**
 * [MED] FUNC-016 + [LOW] SEC-005:
 * - For content-script senders, always use sender.tab.id (never trust message.tabId).
 * - For popup/review-page senders (no sender.tab), honour message.tabId only when
 *   sender.id === chrome.runtime.id (own extension), otherwise fall back to
 *   stateManager.session?.tabId to avoid acting on the active tab instead of the
 *   recorded tab.
 */
async function getSenderTabId(sender, message) {
  // Extension page hosted in a TAB (popup.html or review page opened/pinned as
  // a tab, or e2e tests): it has sender.tab like a content script, but it is
  // our own trusted UI — honor its explicit tabId. Without this, its messages
  // were mis-attributed to its own tab (recording would target the popup tab
  // and capture zero steps). Content scripts can never match this check:
  // their sender.url is the web page URL, not chrome-extension://.
  const extensionOrigin = chrome.runtime.getURL('');
  if (sender?.tab?.id && message?.tabId &&
      sender?.id === chrome.runtime.id &&
      sender?.url?.startsWith(extensionOrigin)) {
    return message.tabId;
  }

  // Content script — always trust the sender's own tab (never message.tabId — SEC-005)
  if (sender?.tab?.id) return sender.tab.id;

  // Popup or review page from the same extension
  if (sender?.id === chrome.runtime.id) {
    // Explicit tabId from the popup is allowed for popup senders (no sender.tab)
    if (message?.tabId) return message.tabId;
  }

  // Fall back to the recorded tab instead of the active tab to avoid FUNC-016 issues
  if (stateManager.session?.tabId) return stateManager.session.tabId;

  // Last resort: active tab (legacy behaviour, rarely hit now)
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return activeTab?.id;
}

// ==================== Runtime Message Handler ====================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (sender.id !== chrome.runtime.id) {
      Logger.warn('Rejected message from unknown sender:', sender.id);
      sendResponse({ success: false, error: 'Unauthorized' });
      return;
    }

    try {
      await recoveryReady;

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
          // Pass content-script's tab ID for FUNC-002 validation
          response = await addStep(message.stepData, sender?.tab?.id);
          break;

        case 'getState': {
          // Include settings so content scripts can re-arm auto-screenshot and
          // navigation options after a page load (P0-6: settings were lost on
          // every navigation because getState never carried them).
          let stateSettings = {};
          try {
            stateSettings = await settingsManager.get();
          } catch (_) { /* defaults */ }
          response = { ...stateManager.getState(), settings: stateSettings };
          break;
        }

        case 'captureScreenshot':
          if (!tabId) throw new Error('No tab context for screenshot');
          // message.isManual is false for auto/navigation captures, true (default) for manual.
          // message.trigger ('navigation') distinguishes the automatic sources for labeling.
          response = await captureScreenshot(tabId, message.isManual !== false, false, message.trigger || null);
          break;

        // Both UIs export locally via their own ExportService instance — there is no
        // background export path. The exportSession() function is kept for backward-compat.

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

        case 'getAllSessions': {
          let sessions = await storage.getAllSessions();
          sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
          response = { success: true, sessions };
          break;
        }

        case 'getSession': {
          const session = await storage.getSession(message.sessionId);
          // session may be null if it was deleted; only enrich a real object.
          if (session && stateManager.session && stateManager.session.sessionId === message.sessionId) {
            session.startTime = stateManager.session.createdAt;
          }
          response = { success: true, session };
          break;
        }

        case 'getSessionSteps': {
          let steps = await storage.getSteps(message.sessionId);
          steps.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
          response = { success: true, steps };
          break;
        }

        case 'getScreenshot':
          response = await getScreenshot(message.stepId);
          break;

        case 'deleteSession':
          await storage.clearSession(message.sessionId);
          broadcastSessionChange(message.sessionId, 'deleted');
          response = { success: true };
          break;

        case 'clearAllSessions': {
          const allSessions = await storage.getAllSessions();
          for (const sessionItem of allSessions) {
            await storage.clearSession(sessionItem.sessionId);
            broadcastSessionChange(sessionItem.sessionId, 'deleted');
          }
          response = { success: true };
          break;
        }

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

        case 'getSettings': {
          const settings = await settingsManager.get();
          response = { success: true, settings };
          break;
        }

        case 'saveSettings':
          await settingsManager.save(message.settings);
          response = { success: true };
          break;

        // New action for storage usage monitoring
        case 'getStorageUsage': {
          const usage = await storage.getStorageUsage();
          response = { success: true, usage };
          break;
        }

        // STR-MED-003: Backup/Restore functionality
        case 'exportAllData': {
          const exportData = await storage.exportAllData();
          response = { success: true, data: exportData };
          break;
        }

        case 'importAllData':
          if (!message.data || !message.data.sessions || !message.data.meta) {
            response = { success: false, error: 'Invalid import data: missing required fields' };
            break;
          }
          await storage.importData(message.data);
          response = { success: true };
          break;

        case 'exportSession': {
          const result = await exportService.exportSession(message.sessionId, message.format || 'json');
          let dataUrl;
          if (result.blob) {
            // FileReader not available in SW — convert via arrayBuffer
            const buffer = await result.blob.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            let binary = '';
            for (let i = 0; i < bytes.length; i += 0x8000) {
              binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
            }
            dataUrl = `data:${result.blob.type};base64,${btoa(binary)}`;
          }
          response = { success: true, dataUrl, content: result.content, filename: result.filename, mimeType: result.mimeType };
          break;
        }

        // Filesystem storage: clear buffer after successful flush to disk
        case 'clearBuffer':
          await clearBufferForSession(message.sessionId);
          response = { success: true };
          break;

        // Filesystem storage: get buffered session data for flushing
        case 'getBufferedSession': {
          const bufferedSession = await storage.getSession(message.sessionId);
          if (bufferedSession) {
            const bufferedSteps = bufferedSession.steps || await storage.getSteps(message.sessionId);
            const bufferedAssets = bufferedSession.assets || await storage.getAllAssets(message.sessionId);
            response = { success: true, session: bufferedSession, steps: bufferedSteps, assets: bufferedAssets };
          } else {
            response = { success: false, error: 'Session not found in buffer' };
          }
          break;
        }

        // Filesystem storage: get pending flush list
        case 'getPendingFlush': {
          const pending = await getPendingFlush();
          response = { success: true, pending };
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
      Logger.error('Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true;
});

// ==================== Screenshot Retrieval (display only) ====================

/**
 * BUG FIX: BUG-006 - Validated screenshot retrieval (using dataUrl)
 * Kept for review UI display; not exposed via message handler export pipeline (FUNC-017).
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

// ==================== Keyboard Shortcut Handler ====================

chrome.commands?.onCommand.addListener(async (command) => {
  await recoveryReady;

  const recordedTabId = stateManager.session?.tabId;

  if (command === 'capture_screenshot' || command === '_execute_action') {
    try {
      // Screenshot must target the recorded tab, not the currently active tab
      if (!recordedTabId) {
        Logger.warn('No recorded tab for screenshot command');
        return;
      }
      const result = await captureScreenshot(recordedTabId, true);
      if (!result.success) {
        Logger.warn('Screenshot command failed:', result.error);
      }
    } catch (err) {
      Logger.error('Error handling screenshot command:', err);
    }
  }

  if (command === 'toggle_recording') {
    if (!recordedTabId) return;
    if (stateManager.state === 'recording') {
      await pauseRecording(recordedTabId);
    } else if (stateManager.state === 'paused') {
      await resumeRecording(recordedTabId);
    }
  }

  if (command === 'stop_recording') {
    if (!recordedTabId) return;
    await stopRecording(recordedTabId);
  }
});

chrome.runtime.onSuspend.addListener(() => {
  Logger.debug('⚠️ Service worker suspending - persisting state');
  // Best-effort: onSuspend cannot be awaited; state changes persist eagerly on each mutation
  persistActiveRecording();
});

Logger.debug('✅ TestSnapper background service worker initialized');
