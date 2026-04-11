/**
 * Popup Script (CSP-safe, full functionality version)
 * Handles UI state, recording control, export, and settings
 * 
 * CRITICAL FIXES APPLIED:
 * - BUG-001: Removed duplicate handleSaveSettings function (was at lines 350-363)
 * - BUG-002: Fixed theme state inconsistency - standardized on light-mode class
 * - POP-002: Added session name validation
 * - POP-003: Added storage usage indicator
 * - POP-004: Added permission error handling
 * - POP-006: Added keyboard shortcuts documentation
 */

import { FSStorageManager } from '../../core/fs-storage.js';
import { ExportService } from '../../core/export-service.js';
import { Utils } from '../../core/utils.js';
import { setupTheme } from '../theme.js';

console.log("✅ TestSnapper Popup loaded");

const fsStorage = new FSStorageManager();
const fileSync = fsStorage.fileSync;
const exportService = new ExportService(fsStorage);

document.addEventListener("DOMContentLoaded", async () => {
  await init();
  // POP-MED-002: Reduced from 2s to 3s for better performance
  setInterval(() => {
    if (currentState === "recording" || currentState === "paused") {
      updateState();
    }
  }, 3000);
});

// =====================
// Global UI References
// =====================
const startBtn = document.getElementById("startBtn");
const pauseBtn = document.getElementById("pauseBtn");
const resumeBtn = document.getElementById("resumeBtn");
const stopBtn = document.getElementById("stopBtn");
const screenshotBtn = document.getElementById("screenshotBtn");
const exportBtn = document.getElementById("exportBtn");
const viewStepsBtn = document.getElementById("viewStepsBtn");
const closeStepsBtn = document.getElementById("closeStepsBtn");
const deleteSessionBtn = document.getElementById("deleteSessionBtn");
const clearAllBtn = document.getElementById("clearAllBtn");
const stateIndicator = document.getElementById("stateIndicator");
const stateDot = document.getElementById("stateDot");
const stateText = document.getElementById("stateText");
const stepCount = document.getElementById("stepCount");
const messageDiv = document.getElementById("message");
const sessionDropdown = document.getElementById("sessionDropdown");
const stepsViewer = document.getElementById("stepsViewer");
const stepsList = document.getElementById("stepsList");
const liveStepsViewer = document.getElementById("liveStepsViewer");
const liveStepsList = document.getElementById("liveStepsList");

// File sync
const setStorageFolderBtn = document.getElementById("setStorageFolderBtn");
const reauthorizeFolderBtn = document.getElementById("reauthorizeFolderBtn");
const syncIndicator = document.getElementById("syncIndicator");
const syncFolderName = document.getElementById("syncFolderName");
const fileSyncStatus = document.getElementById("fileSyncStatus");

// Settings section
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
const backupAllBtn = document.getElementById("backupAllBtn"); // STR-MED-003
const restoreAllBtn = document.getElementById("restoreAllBtn"); // STR-MED-003
const restoreFileInput = document.getElementById("restoreFileInput"); // STR-MED-003
const captureApiCalls = document.getElementById("captureApiCalls");
const apiCallsOptions = document.getElementById("apiCallsOptions");
const captureFailedCalls = document.getElementById("captureFailedCalls");
const captureAllCalls = document.getElementById("captureAllCalls");
const includeTimestamp = document.getElementById("includeTimestamp");
const autoScreenshot = document.getElementById("autoScreenshot");
const screenshotInterval = document.getElementById("screenshotInterval");
const screenshotSeconds = document.getElementById("screenshotSeconds");
const autoSave = document.getElementById("autoSave");
const maxSessions = document.getElementById("maxSessions");

let currentState = "idle";
let currentSessionId = null;

// R-007: Settings profiles
const SETTING_PROFILES = {
  fast: { screenshotSeconds: 0, screenshotMode: 'events', autoScreenshot: false },
  docs: { screenshotSeconds: 3, screenshotMode: 'both', autoScreenshot: true }
};

function applyProfileToForm(preset) {
  const fields = SETTING_PROFILES[preset];
  if (!fields) return;
  if (fields.screenshotSeconds !== undefined && screenshotSeconds) screenshotSeconds.value = fields.screenshotSeconds;
  if (fields.screenshotMode !== undefined) { const el = document.getElementById('screenshotMode'); if (el) el.value = fields.screenshotMode; }
  if (fields.autoScreenshot !== undefined && autoScreenshot) {
    autoScreenshot.checked = fields.autoScreenshot;
    if (screenshotInterval) screenshotInterval.style.display = fields.autoScreenshot ? 'block' : 'none';
  }
}

// R-009: Format bytes helper
function _formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// R-009: Load storage breakdown
async function loadStorageBreakdown() {
  const list = document.getElementById('storageBreakdownList');
  if (!list) return;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      if (quota && usage / quota > 0.85) {
        const banner = document.getElementById('storageWarningBanner');
        if (banner) banner.style.display = 'block';
      }
    }
    const { testsnapper_sessions } = await chrome.storage.local.get('testsnapper_sessions');
    const sessions = (testsnapper_sessions || []).slice(0, 10);
    const withSizes = await Promise.all(sessions.map(async s => {
      const sid = s.sessionId;
      const [stepsD, assetsD] = await Promise.all([
        chrome.storage.local.get(`testsnapper_steps_${sid}`),
        chrome.storage.local.get(`testsnapper_assets_${sid}`)
      ]);
      const totalBytes = JSON.stringify(stepsD[`testsnapper_steps_${sid}`] || []).length
        + JSON.stringify(assetsD[`testsnapper_assets_${sid}`] || []).length;
      return { ...s, totalBytes };
    }));
    withSizes.sort((a, b) => b.totalBytes - a.totalBytes);
    const top5 = withSizes.slice(0, 5);
    if (!top5.length) { list.textContent = 'No sessions found.'; return; }
    const maxBytes = top5[0].totalBytes || 1;
    list.innerHTML = top5.map(s => {
      const pct = Math.round((s.totalBytes / maxBytes) * 100);
      return `<div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;font-size:12px"><span>${Utils.escapeHtml(s.sessionName || s.sessionId)}</span><span>${_formatBytes(s.totalBytes)}</span></div>
        <div style="height:4px;background:var(--border);border-radius:2px;margin-top:3px"><div style="height:100%;width:${pct}%;background:var(--accent);border-radius:2px"></div></div>
      </div>`;
    }).join('');
  } catch(e) {
    if (list) list.textContent = 'Could not load breakdown.';
  }
}

// =====================
// Initialization
// =====================
async function init() {
  setupTabs();
  setupEventListeners();
  setupCustomDropdown();
  setupTheme();
  await fsStorage.init();
  await updateState();
  await checkFileSyncStatus();
  await flushAllPending(); // Flush any buffered sessions from previous recordings
  await loadSessions();
  await loadSettings();
  await loadExportFormat(); // POP-MED-003: Load saved export format
  await updateStorageUsage(); // BUG FIX: POP-003
  setupKeyboardShortcuts(); // BUG FIX: POP-006
  loadStorageBreakdown(); // R-009: non-blocking
}

// setupTheme / applyTheme imported from ../theme.js

/**
 * BUG FIX: POP-006 - Keyboard shortcuts documentation
 */
function setupKeyboardShortcuts() {
  const helpBtn = document.getElementById('keyboardShortcutsHelp');
  if (!helpBtn) return;

  helpBtn.addEventListener('click', () => {
    showMessage(`
Keyboard Shortcuts:
• Ctrl+Shift+S (⌘⇧S): Capture Screenshot
• Ctrl+Shift+U (⌘⇧U): Pause/Resume Recording
• Ctrl+Shift+E (⌘⇧E): Stop Recording
    `.trim(), 'info', 8000);
  });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'sessionNameUpdated') {
    loadSessions();
  } else if (message.action === 'storageQuotaWarning') {
    // BUG FIX: POP-003 - Storage quota warning (only relevant if still using buffer)
    showMessage(`Storage ${(message.usage.percentage * 100).toFixed(1)}% full. Consider deleting old sessions.`, 'warning', 10000);
    updateStorageUsage();
  } else if (message.action === 'sessionDataChanged') {
    if (message.changeType !== 'deleted') loadSessions();
  } else if (message.action === 'flushRecordingBuffer') {
    // Recording stopped — flush buffered session from chrome.storage to filesystem
    flushBufferedSession(message.sessionId);
  }
});

// =====================
// UI Setup
// =====================
function setupTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const targetTab = tab.dataset.tab;

      document.querySelectorAll(".tab").forEach((t) => {
        t.classList.remove("active");
        t.setAttribute("aria-selected", "false");
      });
      tab.classList.add("active");
      tab.setAttribute("aria-selected", "true");

      document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
      document.getElementById(targetTab + "-tab").classList.add("active");

      if (targetTab === "export") loadSessions();
    });
  });
}

function setupEventListeners() {
  startBtn.addEventListener("click", handleStart);
  pauseBtn.addEventListener("click", handlePause);
  resumeBtn.addEventListener("click", handleResume);
  stopBtn.addEventListener("click", handleStop);
  screenshotBtn.addEventListener("click", handleScreenshot);
  exportBtn.addEventListener("click", handleExport);
  viewStepsBtn.addEventListener("click", handleViewSteps);
  closeStepsBtn.addEventListener("click", () => (stepsViewer.style.display = "none"));
  deleteSessionBtn.addEventListener("click", handleDeleteSession);
  clearAllBtn.addEventListener("click", handleClearAll);
  sessionDropdown.addEventListener("change", handleSessionSelect);
  saveSettingsBtn?.addEventListener("click", handleSaveSettings);

  // STR-MED-003: Backup/Restore
  backupAllBtn?.addEventListener("click", handleBackupAll);
  restoreAllBtn?.addEventListener("click", () => restoreFileInput.click());
  restoreFileInput?.addEventListener("change", handleRestoreAll);

  // File sync
  setStorageFolderBtn?.addEventListener("click", handleSetStorageFolder);
  reauthorizeFolderBtn?.addEventListener("click", handleReauthorize);
  document.getElementById("onboardingPickFolderBtn")?.addEventListener("click", handleSetStorageFolder);
  document.getElementById("onboardingReauthBtn")?.addEventListener("click", handleReauthorize);

  // Settings interactivity
  // BUG-005 FIX: captureApiCalls, captureFailedCalls, captureAllCalls, includeTimestamp, apiCallsOptions
  // have no corresponding HTML elements — all inner references use optional chaining to avoid crashes.
  captureApiCalls?.addEventListener("change", (e) => {
    if (apiCallsOptions) apiCallsOptions.style.display = e.target.checked ? "block" : "none";
    if (!e.target.checked) {
      if (captureFailedCalls) captureFailedCalls.checked = false;
      if (captureAllCalls) captureAllCalls.checked = false;
    }
  });

  autoScreenshot?.addEventListener("change", (e) => {
    if (screenshotInterval) screenshotInterval.style.display = e.target.checked ? "block" : "none";
  });

  captureFailedCalls?.addEventListener("change", (e) => {
    if (e.target.checked && captureAllCalls) captureAllCalls.checked = false;
  });
  captureAllCalls?.addEventListener("change", (e) => {
    if (e.target.checked && captureFailedCalls) captureFailedCalls.checked = false;
  });

  // POP-MED-003: Save export format when changed
  document.querySelectorAll('input[name="format"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.checked) {
        saveExportFormat(e.target.value);
      }
    });
  });

  // POP-MED-001: Keyboard navigation
  setupKeyboardNavigation();

  // R-007: Settings profiles
  document.getElementById('settingsProfile')?.addEventListener('change', (e) => {
    if (e.target.value !== 'custom') applyProfileToForm(e.target.value);
  });
  document.getElementById('exportSettingsBtn')?.addEventListener('click', async () => {
    const { settings } = await chrome.storage.local.get('settings');
    const blob = new Blob([JSON.stringify(settings || {}, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'testsnapper-settings.json'; a.click();
    URL.revokeObjectURL(url);
  });
  document.getElementById('importSettingsBtn')?.addEventListener('click', () => {
    document.getElementById('importSettingsFile')?.click();
  });
  document.getElementById('importSettingsFile')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = JSON.parse(text);
      if (typeof imported !== 'object' || Array.isArray(imported)) throw new Error('Invalid format');
      await chrome.runtime.sendMessage({ action: 'saveSettings', settings: imported });
      await loadSettings();
      showMessage('Settings imported!', 'success');
    } catch(err) {
      showMessage('Import failed: ' + err.message, 'error');
    }
    e.target.value = '';
  });

  // R-003: URL params toggle
  document.getElementById('redactUrlParams')?.addEventListener('change', (e) => {
    const row = document.getElementById('urlParamDenylistRow');
    if (row) row.style.display = e.target.checked ? 'block' : 'none';
  });

  // R-009: Smart cleanup
  document.getElementById('smartCleanupBtn')?.addEventListener('click', async () => {
    const { testsnapper_sessions } = await chrome.storage.local.get('testsnapper_sessions');
    const sessions = testsnapper_sessions || [];
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const old = sessions.filter(s => s.createdAt && new Date(s.createdAt).getTime() < cutoff);
    if (!old.length) { showMessage('No sessions older than 30 days.', 'info'); return; }
    const withSizes = await Promise.all(old.map(async s => {
      const sid = s.sessionId;
      const [stepsD, assetsD] = await Promise.all([
        chrome.storage.local.get(`testsnapper_steps_${sid}`),
        chrome.storage.local.get(`testsnapper_assets_${sid}`)
      ]);
      return { ...s, totalBytes: JSON.stringify(stepsD[`testsnapper_steps_${sid}`]||[]).length + JSON.stringify(assetsD[`testsnapper_assets_${sid}`]||[]).length };
    }));
    const totalSize = withSizes.reduce((acc, s) => acc + s.totalBytes, 0);
    if (!confirm(`Delete ${old.length} session(s) older than 30 days? (~${_formatBytes(totalSize)} freed)`)) return;
    for (const s of old) {
      await chrome.runtime.sendMessage({ action: 'deleteSession', sessionId: s.sessionId });
    }
    showMessage(`Cleaned up ${old.length} session(s).`, 'success');
    await loadSessions();
    await loadStorageBreakdown();
  });
}

// =====================
// POP-MED-001: Keyboard Navigation
// =====================
function setupKeyboardNavigation() {
  // Global keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Ctrl+Enter or Cmd+Enter: Export
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!exportBtn.disabled) {
        handleExport();
      }
    }

    // Escape: Close modals or steps viewer
    if (e.key === 'Escape') {
      if (stepsViewer.style.display !== 'none') {
        stepsViewer.style.display = 'none';
      }
    }

    // Tab navigation enhancement - ensure focusable elements
    if (e.key === 'Tab') {
      // Let browser handle default tab behavior
      // Just ensure our buttons are focusable
    }
  });

  // Make all buttons keyboard accessible
  const makeButtonAccessible = (button) => {
    if (!button) return;

    // Ensure button has tabindex
    if (!button.hasAttribute('tabindex')) {
      button.setAttribute('tabindex', '0');
    }

    // Add Enter/Space key support if not already present
    button.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        button.click();
      }
    });
  };

  // Make all control buttons accessible
  [startBtn, pauseBtn, resumeBtn, stopBtn, screenshotBtn,
    exportBtn, viewStepsBtn, deleteSessionBtn, clearAllBtn,
    saveSettingsBtn, closeStepsBtn].forEach(makeButtonAccessible);

  // Session dropdown - arrow key navigation
  sessionDropdown?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSessionSelect();
    }
  });
}

// =====================
// Storage Usage Indicator
// =====================
// Storage usage bar removed — filesystem storage has no quota limits.
// This function is kept as a no-op so existing callers don't break.
async function updateStorageUsage() { }

// =====================
// Chrome Messaging Logic
// =====================
async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/**
 * BUG FIX: POP-004 - Permission error handling
 */
async function handleStart() {
  try {
    const tab = await getCurrentTab();

    // Check if we have necessary permissions
    if (!tab) {
      showMessage("Cannot access current tab. Please try again.", "error");
      return;
    }

    if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
      showMessage("Cannot record on Chrome internal pages.", "error");
      return;
    }

    const response = await chrome.runtime.sendMessage({
      action: "startRecording",
      tabInfo: { url: tab.url, title: tab.title, width: tab.width || 1920, height: tab.height || 1080 },
    });

    if (response.success) {
      currentSessionId = response.sessionId;
      showMessage("Recording started!", "success");
      await updateState();
      liveStepsViewer.style.display = "block";
      setTimeout(() => window.close(), 500);
    } else {
      showMessage("Failed to start: " + (response.error || "Unknown error"), "error");
    }
  } catch (err) {
    console.error("Start failed:", err);
    showMessage("Error starting recording. Check permissions.", "error");
  }
}

async function handlePause() {
  try {
    const response = await chrome.runtime.sendMessage({ action: "pauseRecording" });
    response.success ? showMessage("Recording paused", "info") : showMessage("Pause failed", "error");
    await updateState();
  } catch (err) {
    console.error("Pause failed:", err);
    showMessage("Error pausing recording", "error");
  }
}

async function handleResume() {
  try {
    const response = await chrome.runtime.sendMessage({ action: "resumeRecording" });
    response.success ? showMessage("Recording resumed", "success") : showMessage("Resume failed", "error");
    await updateState();
  } catch (err) {
    console.error("Resume failed:", err);
    showMessage("Error resuming recording", "error");
  }
}

async function handleStop() {
  stopBtn.disabled = true;
  showMessage("Stopping recording...", "info");
  try {
    const response = await chrome.runtime.sendMessage({ action: "stopRecording" });
    if (response.success) {
      showMessage("Recording stopped!", "success");
      liveStepsViewer.style.display = "none";
      await updateStorageUsage(); // Update storage after stop
      setTimeout(() => window.close(), 800);
    } else {
      showMessage("Failed to stop: " + (response.error || "Unknown error"), "error");
    }
  } catch (err) {
    console.error("Stop failed:", err);
    showMessage("Error stopping recording", "error");
  } finally {
    stopBtn.disabled = false;
  }
}

async function handleScreenshot() {
  try {
    const response = await chrome.runtime.sendMessage({ action: "captureScreenshot" });
    response.success ? showMessage("Screenshot captured!", "success") : showMessage("Capture failed", "error");
  } catch (err) {
    console.error("Screenshot failed:", err);
    showMessage("Error capturing screenshot", "error");
  }
}

async function handleExport() {
  const sessionId = sessionDropdown.value;
  if (!sessionId) return showMessage("Select a session first", "error");

  if (exportBtn) exportBtn.disabled = true;

  const format = document.querySelector('input[name="format"]:checked')?.value || 'json';
  showMessage("Exporting...", "info");

  try {
    const result = await exportService.exportSession(sessionId, format);

    let downloadUrl;
    let filename = result.filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');

    if (result.blob) {
      downloadUrl = URL.createObjectURL(result.blob);
    } else {
      const utf8Bytes = new TextEncoder().encode(result.content);
      let binaryString = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < utf8Bytes.length; i += chunkSize) {
        binaryString += String.fromCharCode.apply(null, utf8Bytes.subarray(i, i + chunkSize));
      }
      downloadUrl = `data:${result.mimeType};charset=utf-8;base64,${btoa(binaryString)}`;
    }

    await chrome.downloads.download({ url: downloadUrl, filename, saveAs: false, conflictAction: 'uniquify' });
    if (result.blob) URL.revokeObjectURL(downloadUrl);
    showMessage(`Exported as ${filename}`, "success");
  } catch (err) {
    console.error("Export failed:", err);
    showMessage("Export failed: " + err.message, "error");
  } finally {
    if (exportBtn) exportBtn.disabled = false;
  }
}

async function handleViewSteps() {
  const sessionId = sessionDropdown.value;
  if (!sessionId) return showMessage("Select a session", "error");

  try {
    const url = chrome.runtime.getURL(`src/ui/review/review-standalone.html?sessionId=${sessionId}`);
    await chrome.tabs.create({ url });
    setTimeout(() => window.close(), 500);
  } catch (err) {
    console.error("View steps failed:", err);
    showMessage("Error opening review page", "error");
  }
}

async function handleDeleteSession() {
  const sessionId = sessionDropdown.value;
  if (!sessionId) return showMessage("Select a session", "error");
  if (!confirm("Delete this session? This cannot be undone.")) return;

  try {
    // Delete from filesystem (and buffer if pending)
    await fsStorage.clearSession(sessionId);
    // Also notify background to clear any buffer state
    chrome.runtime.sendMessage({ action: "deleteSession", sessionId }).catch(() => {});
    showMessage("Deleted session", "success");
    await loadSessions();
  } catch (err) {
    console.error("Delete failed:", err);
    showMessage("Error deleting session", "error");
  }
}

async function handleClearAll() {
  if (!confirm("Delete ALL sessions? This cannot be undone.")) return;

  try {
    const sessions = await fsStorage.getAllSessions();
    for (const s of sessions) {
      await fsStorage.clearSession(s.sessionId);
    }
    // Also clear all from background buffer
    chrome.runtime.sendMessage({ action: "clearAllSessions" }).catch(() => {});
    showMessage("Cleared all sessions", "success");
    await loadSessions();
  } catch (err) {
    console.error("Clear all failed:", err);
    showMessage("Error clearing sessions", "error");
  }
}

// =====================
// STR-MED-003: Backup/Restore
// =====================
async function handleBackupAll() {
  try {
    showMessage("Preparing backup...", "info");

    const response = await chrome.runtime.sendMessage({ action: "exportAllData" });

    if (response.success) {
      const backupData = response.data;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const filename = `testsnapper-backup-${timestamp}.json`;

      // Create download
      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      showMessage(`Backup saved: ${filename}`, "success");
    } else {
      showMessage("Backup failed: " + (response.error || "Unknown error"), "error");
    }
  } catch (err) {
    console.error("Backup failed:", err);
    showMessage("Error creating backup", "error");
  }
}

async function handleRestoreAll(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!file.name.endsWith('.json')) {
    showMessage("Invalid file type. Please select a .json backup file.", "error");
    return;
  }

  if (!confirm("Restore from backup? This will replace ALL current data. Current sessions will be lost!")) {
    event.target.value = ''; // Reset file input
    return;
  }

  try {
    showMessage("Restoring from backup...", "info");

    const text = await file.text();
    const backupData = JSON.parse(text);

    // Validate backup data structure
    if (!backupData.meta || !backupData.sessions || !Array.isArray(backupData.sessions)) {
      throw new Error("Invalid backup file format");
    }

    const response = await chrome.runtime.sendMessage({
      action: "importAllData",
      data: backupData
    });

    if (response.success) {
      showMessage(`Restored ${backupData.sessions.length} sessions successfully`, "success");
      await loadSessions();
      await updateStorageUsage();
    } else {
      showMessage("Restore failed: " + (response.error || "Unknown error"), "error");
    }
  } catch (err) {
    console.error("Restore failed:", err);
    showMessage("Error restoring backup: " + err.message, "error");
  } finally {
    event.target.value = ''; // Reset file input
  }
}

// =====================
// Session + Settings
// =====================

/**
 * BUG FIX: BUG-001 - Removed duplicate function
 * This is the ONLY handleSaveSettings function now
 * Includes validation for all settings (BUG FIX: POP-002)
 */
async function handleSaveSettings() {
  try {
    // Validate settings before saving
    const screenshotSecondsValue = parseInt(screenshotSeconds?.value) || 5;
    const maxSessionsValue = parseInt(maxSessions?.value) || 25;
    const screenshotFormatValue = document.getElementById('screenshotFormat')?.value || 'png';
    const exportImageQualityValue = document.getElementById('exportImageQuality')?.value || 'auto';

    // Validation ranges
    if (screenshotSecondsValue < 1 || screenshotSecondsValue > 60) {
      showMessage("Screenshot interval must be between 1-60 seconds", "error");
      return;
    }

    if (maxSessionsValue < 1 || maxSessionsValue > 100) {
      showMessage("Max sessions must be between 1-100", "error");
      return;
    }

    const settings = {
      autoScreenshot: autoScreenshot?.checked || false,
      screenshotSeconds: screenshotSecondsValue,
      screenshotMode: document.getElementById('screenshotMode')?.value || 'interval', // R-010
      captureOnNavigation: document.getElementById('captureOnNavigation')?.checked !== false,
      smartDedup: document.getElementById('smartDedup')?.checked !== false,
      autoSave: autoSave?.checked !== false,
      maxSessions: maxSessionsValue,
      screenshotFormat: screenshotFormatValue,
      exportImageQuality: exportImageQualityValue,
      imageQuality: screenshotFormatValue === 'jpeg-high' ? 0.92 : 0.92,
      captureApiCalls: captureApiCalls?.checked || false,
      captureFailedCalls: captureFailedCalls?.checked || false,
      captureAllCalls: captureAllCalls?.checked || false,
      includeTimestamp: includeTimestamp?.checked !== false,
      // R-003: Privacy settings
      customRedactionPatterns: (document.getElementById('customRedactionPatterns')?.value || '')
        .split('\n').map(p => p.trim()).filter(Boolean).map(p => ({ pattern: p, flags: 'i' })),
      redactUrlParams: document.getElementById('redactUrlParams')?.checked || false,
      urlParamDenylist: document.getElementById('urlParamDenylist')?.value || ''
    };

    const res = await chrome.runtime.sendMessage({
      action: 'saveSettings',
      settings
    });

    if (res.success) {
      showMessage('Settings saved!', 'success');
    } else {
      showMessage('Failed to save settings: ' + (res.error || "Unknown error"), 'error');
    }
  } catch (err) {
    console.error("Save settings failed:", err);
    showMessage("Error saving settings", "error");
  }
}

async function loadSessions() {
  try {
    // Check if filesystem is ready — if not, sessions may exist but can't be read
    const fsReady = await fsStorage.isFilesystemReady();
    if (!fsReady && await fileSync.isConfigured()) {
      // Folder is configured but permission isn't granted — sessions are on disk
      // but inaccessible until the user clicks Re-authorize
      renderCustomDropdown([], true);
      return;
    }

    // Read directly from filesystem (or buffer for active/pending sessions)
    const sessions = await fsStorage.getAllSessions();
    sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Update hidden native select for compatibility
    sessionDropdown.innerHTML = '<option value="">Select a session...</option>';
    sessions.forEach((s) => {
      const opt = document.createElement("option");
      const sessionName = s.sessionName || `Session ${new Date(s.createdAt).toLocaleString()}`;
      opt.value = s.sessionId;
      opt.textContent = `${sessionName} (${s.stepCount || 0} steps)`;
      sessionDropdown.appendChild(opt);
    });

    // R-006: Compute size labels asynchronously (non-blocking)
    calculateAllSessionSizes(sessions).then(() => renderCustomDropdown(sessions));

    // Update custom dropdown (immediate, sizes populate after)
    renderCustomDropdown(sessions);

    if (currentSessionId) {
      sessionDropdown.value = currentSessionId;
      selectCustomDropdownItem(currentSessionId);
    }
    handleSessionSelect();
  } catch (e) {
    console.error("Load sessions failed:", e);
  }
}

// R-006: Format bytes to human-readable KB/MB
function _formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// R-006: Calculate and annotate session sizes (mutates session objects with _sizeLabel)
async function calculateAllSessionSizes(sessions) {
  for (const s of sessions) {
    try {
      const assets = await fsStorage.getAllAssets(s.sessionId);
      let total = 0;
      assets.forEach(a => { if (a.dataUrl) total += a.dataUrl.length * 0.75; }); // base64 → bytes approx
      s._sizeLabel = _formatBytes(total);
    } catch (e) { s._sizeLabel = ''; }
  }
}

// R-006: Archive or unarchive a session
async function handleArchiveSession(sessionId, archive) {
  try {
    await fsStorage.updateSession(sessionId, { archived: archive });
    await loadSessions();
    showMessage(archive ? 'Session archived' : 'Session unarchived', 'success');
  } catch (e) {
    showMessage('Failed to update session', 'error');
  }
}

// R-006: Filter visible dropdown items by search query
function filterSessionsDropdown(query) {
  const list = document.getElementById('sessionDropdownList');
  if (!list) return;
  const q = query.toLowerCase().trim();
  list.querySelectorAll('.session-dropdown-item').forEach(item => {
    const name = (item.querySelector('.item-name') || {}).textContent || '';
    item.style.display = (!q || name.toLowerCase().includes(q)) ? '' : 'none';
  });
}

function renderCustomDropdown(sessions, needsReauth = false) {
  const list = document.getElementById("sessionDropdownList");
  const trigger = document.getElementById("sessionSelectTrigger");

  if (needsReauth) {
    list.innerHTML = `
      <div class="empty-state" style="padding: 20px 16px;">
        <svg class="empty-state-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span class="empty-state-title">Re-authorization needed</span>
        <span class="empty-state-desc">Click <strong>Re-authorize</strong> in the Folder & Sessions section to access your saved sessions</span>
      </div>`;
    trigger.innerHTML = `<span class="session-placeholder">Re-authorize to view sessions</span>
      <svg class="chevron-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
    return;
  }

  if (!sessions.length) {
    list.innerHTML = `
      <div class="empty-state" style="padding: 20px 16px;">
        <svg class="empty-state-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
        <span class="empty-state-title">No sessions yet</span>
        <span class="empty-state-desc">Start recording to create your first test session</span>
      </div>`;
    trigger.innerHTML = `<span class="session-placeholder">No sessions available</span>
      <svg class="chevron-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
    return;
  }

  // R-006: Separate active vs archived
  const activeSessions = sessions.filter(s => !s.archived);
  const archivedSessions = sessions.filter(s => s.archived);

  list.innerHTML = activeSessions.map((s) => _renderSessionItem(s)).join('') +
    (archivedSessions.length ? `
      <div class="archived-section" id="archivedSection">
        <button class="archived-toggle" id="archivedToggle" type="button">
          Archived (${archivedSessions.length}) ▸
        </button>
        <div class="archived-list hidden" id="archivedList">
          ${archivedSessions.map(s => _renderSessionItem(s, true)).join('')}
        </div>
      </div>` : '');

  // Wire archive toggle
  const toggleBtn = list.querySelector('#archivedToggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const archivedList = list.querySelector('#archivedList');
      const isHidden = archivedList.classList.toggle('hidden');
      toggleBtn.textContent = `Archived (${archivedSessions.length}) ${isHidden ? '▸' : '▾'}`;
    });
  }

  // Wire archive buttons
  list.querySelectorAll('.session-archive-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const sessionId = btn.dataset.sessionId;
      const isArchived = btn.dataset.archived === 'true';
      await handleArchiveSession(sessionId, !isArchived);
    });
  });
}

function _renderSessionItem(s, isArchived = false) {
  const name = Utils.escapeHtml(s.sessionName || `Session ${new Date(s.createdAt).toLocaleString()}`);
  const date = new Date(s.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const steps = s.stepCount || 0;
  const sizeLabel = s._sizeLabel || '';
  const archiveTitle = isArchived ? 'Unarchive' : 'Archive';
  const archiveIcon = isArchived
    ? '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-5.5"/></svg>'
    : '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/></svg>';
  return `
    <div class="session-dropdown-item${isArchived ? ' archived-item' : ''}" data-value="${s.sessionId}" role="option">
      <span class="item-name">${name}</span>
      <span class="item-meta">
        <span class="meta-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg> ${steps} steps</span>
        <span class="meta-badge"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${date}</span>
        ${sizeLabel ? `<span class="meta-badge session-size-badge">${sizeLabel}</span>` : ''}
      </span>
      <button class="session-archive-btn" data-session-id="${s.sessionId}" data-archived="${isArchived}" title="${archiveTitle}" type="button">${archiveIcon}</button>
    </div>`;
}

function selectCustomDropdownItem(value) {
  const wrapper = document.getElementById("sessionSelectWrapper");
  const trigger = document.getElementById("sessionSelectTrigger");
  const items = wrapper.querySelectorAll(".session-dropdown-item");
  let found = false;

  items.forEach((item) => {
    const isMatch = item.dataset.value === value;
    item.classList.toggle("selected", isMatch);
    if (isMatch) {
      found = true;
      const name = item.querySelector(".item-name")?.textContent || "";
      const meta = item.querySelector(".item-meta")?.innerHTML || "";
      trigger.innerHTML = `
        <span class="session-info">
          <span class="session-name">${Utils.escapeHtml(name)}</span>
          <span class="session-meta">${meta}</span>
        </span>
        <svg class="chevron-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
    }
  });

  if (!found) {
    trigger.innerHTML = `<span class="session-placeholder">Select a session...</span>
      <svg class="chevron-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
  }
}

function setupCustomDropdown() {
  const wrapper = document.getElementById("sessionSelectWrapper");
  const trigger = document.getElementById("sessionSelectTrigger");
  const list = document.getElementById("sessionDropdownList");

  // R-006: Session search wiring
  const searchInput = document.getElementById('sessionSearch');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => filterSessionsDropdown(e.target.value));
    // Open dropdown when user starts typing
    searchInput.addEventListener('focus', () => {
      wrapper.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
    });
  }

  trigger.addEventListener("click", () => {
    const isOpen = wrapper.classList.toggle("open");
    trigger.setAttribute("aria-expanded", isOpen);
  });

  list.addEventListener("click", (e) => {
    const item = e.target.closest(".session-dropdown-item");
    if (!item) return;
    const value = item.dataset.value;
    sessionDropdown.value = value;
    selectCustomDropdownItem(value);
    wrapper.classList.remove("open");
    trigger.setAttribute("aria-expanded", "false");
    handleSessionSelect();
  });

  // Close on outside click
  document.addEventListener("click", (e) => {
    if (!wrapper.contains(e.target)) {
      wrapper.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
    }
  });

  // Keyboard support
  trigger.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      trigger.click();
    } else if (e.key === "Escape") {
      wrapper.classList.remove("open");
      trigger.setAttribute("aria-expanded", "false");
    }
  });
}

function handleSessionSelect() {
  const has = sessionDropdown.value !== "";
  exportBtn.disabled = !has;
  viewStepsBtn.disabled = !has;
  deleteSessionBtn.disabled = !has;
}

async function loadSettings() {
  try {
    const res = await chrome.runtime.sendMessage({ action: "getSettings" });
    if (!res.success) return;

    const s = res.settings;

    // Load settings with null checks
    if (captureApiCalls) captureApiCalls.checked = s.captureApiCalls || false;
    if (captureFailedCalls) captureFailedCalls.checked = s.captureFailedCalls || false;
    if (captureAllCalls) captureAllCalls.checked = s.captureAllCalls || false;
    if (includeTimestamp) includeTimestamp.checked = s.includeTimestamp !== false;
    if (autoScreenshot) autoScreenshot.checked = s.autoScreenshot || false;
    if (screenshotSeconds) screenshotSeconds.value = s.screenshotSeconds || 5;
    const screenshotModeEl = document.getElementById('screenshotMode'); // R-010
    if (screenshotModeEl) screenshotModeEl.value = s.screenshotMode || 'interval';
    if (autoSave) autoSave.checked = s.autoSave !== false;
    if (maxSessions) maxSessions.value = s.maxSessions || 25;

    const captureOnNavigationInput = document.getElementById('captureOnNavigation');
    if (captureOnNavigationInput) captureOnNavigationInput.checked = s.captureOnNavigation !== false;

    const smartDedupInput = document.getElementById('smartDedup');
    if (smartDedupInput) smartDedupInput.checked = s.smartDedup !== false;

    const screenshotFormatInput = document.getElementById('screenshotFormat');
    if (screenshotFormatInput) screenshotFormatInput.value = s.screenshotFormat || 'png';

    const exportImageQualityInput = document.getElementById('exportImageQuality');
    if (exportImageQualityInput) exportImageQualityInput.value = s.exportImageQuality || 'auto';

    // R-003: Privacy fields
    const patternsEl = document.getElementById('customRedactionPatterns');
    if (patternsEl) patternsEl.value = (s.customRedactionPatterns || []).map(p => p.pattern).join('\n');
    const redactUrlParamsEl = document.getElementById('redactUrlParams');
    if (redactUrlParamsEl) {
      redactUrlParamsEl.checked = s.redactUrlParams || false;
      const row = document.getElementById('urlParamDenylistRow');
      if (row) row.style.display = s.redactUrlParams ? 'block' : 'none';
    }
    const denylistEl = document.getElementById('urlParamDenylist');
    if (denylistEl) denylistEl.value = s.urlParamDenylist || '';

    // Update visibility
    if (apiCallsOptions) apiCallsOptions.style.display = captureApiCalls?.checked ? "block" : "none";
    if (screenshotInterval) screenshotInterval.style.display = autoScreenshot?.checked ? "block" : "none";
  } catch (err) {
    console.error("Load settings failed:", err);
  }
}

// POP-MED-003: Persist export format selection
async function loadExportFormat() {
  try {
    const result = await chrome.storage.local.get('exportFormat');
    const savedFormat = result.exportFormat || 'docx';

    // Set the correct radio button as checked
    const formatRadio = document.querySelector(`input[name="format"][value="${savedFormat}"]`);
    if (formatRadio) {
      formatRadio.checked = true;
    }
  } catch (err) {
    console.error("Load export format failed:", err);
  }
}

async function saveExportFormat(format) {
  try {
    await chrome.storage.local.set({ exportFormat: format });
  } catch (err) {
    console.error("Save export format failed:", err);
  }
}

// =====================
// UI Helpers
// =====================
async function updateState() {
  try {
    const response = await chrome.runtime.sendMessage({ action: "getState" });
    if (response) {
      currentState = response.state;
      currentSessionId = response.session?.sessionId || null;
      // BUG-008 FIX: null-guard all DOM element accesses to avoid crashes if
      // an element is ever missing from the DOM.
      if (stateText) {
        stateText.textContent = currentState.charAt(0).toUpperCase() + currentState.slice(1);
        stateText.classList.toggle("recording", currentState === "recording");
        stateText.classList.toggle("paused", currentState === "paused");
      }
      if (stateDot) {
        stateDot.className = "state-dot " + (currentState === "recording" ? "recording" : currentState === "paused" ? "paused" : "");
      }
      if (stateIndicator) {
        stateIndicator.classList.toggle("is-recording", currentState === "recording");
        stateIndicator.classList.toggle("is-paused", currentState === "paused");
      }

      // Animate stat values
      const newStepCount = response.stepCount || 0;
      const newScreenshotCount = response.screenshotCount || 0;
      const screenshotCountEl = document.getElementById('screenshotCount');

      if (_isFirstStateUpdate) {
        // Count-up animation on first load
        _isFirstStateUpdate = false;
        if (stepCount) animateCountUp(stepCount, newStepCount);
        if (screenshotCountEl) animateCountUp(screenshotCountEl, newScreenshotCount);
      } else {
        // Bump animation on subsequent changes
        if (stepCount) {
          const prevStepCount = stepCount.textContent;
          stepCount.textContent = newStepCount;
          if (String(newStepCount) !== prevStepCount) {
            stepCount.classList.remove("bumped");
            void stepCount.offsetWidth;
            stepCount.classList.add("bumped");
          }
        }

        if (screenshotCountEl) {
          const prevScreenshots = screenshotCountEl.textContent;
          screenshotCountEl.textContent = newScreenshotCount;
          if (String(newScreenshotCount) !== prevScreenshots) {
            screenshotCountEl.classList.remove("bumped");
            void screenshotCountEl.offsetWidth;
            screenshotCountEl.classList.add("bumped");
          }
        }
      }

      // Update session duration
      const sessionDurationEl = document.getElementById('sessionDuration');
      if (sessionDurationEl && response.session?.startTime) {
        const start = new Date(response.session.startTime).getTime();
        const elapsed = Math.floor((Date.now() - start) / 1000);
        const mins = Math.floor(elapsed / 60);
        const secs = elapsed % 60;
        sessionDurationEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
      } else if (sessionDurationEl) {
        sessionDurationEl.textContent = '0:00';
      }

      updateButtonStates();
      if (currentState === "recording" && currentSessionId) updateLiveSteps();
    }
  } catch (e) {
    console.error("State update failed:", e);
  }
}

async function updateLiveSteps() {
  try {
    const res = await chrome.runtime.sendMessage({ action: "getSessionSteps", sessionId: currentSessionId });
    if (res.success) displaySteps(res.steps, liveStepsList);
  } catch (err) {
    console.error("Update live steps failed:", err);
  }
}

function updateButtonStates() {
  if (startBtn) startBtn.disabled = currentState !== "idle";
  if (pauseBtn) pauseBtn.disabled = currentState !== "recording";
  if (resumeBtn) resumeBtn.disabled = currentState !== "paused";
  if (stopBtn) stopBtn.disabled = currentState === "idle";
  if (screenshotBtn) screenshotBtn.disabled = currentState !== "recording";
}

function displaySteps(steps, target = stepsList) {
  if (!steps?.length) {
    target.innerHTML = `
      <div class="empty-state">
        <svg class="empty-state-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
        <span class="empty-state-title">No steps yet</span>
        <span class="empty-state-desc">Interact with the page to start capturing test steps</span>
      </div>`;
    return;
  }
  target.innerHTML = steps
    .map(
      (step, i) => `
    <div class="step-item">
      <div class="step-header">
        <span class="step-number">Step ${i + 1}</span>
        <span class="step-action" data-action="${Utils.escapeHtml(step.action.toLowerCase())}">${Utils.escapeHtml(step.action)}</span>
      </div>
      <div class="step-details">
        ${step.fieldName ? `<div><strong>Field:</strong> ${Utils.escapeHtml(step.fieldName)}</div>` : ""}
        ${step.selector?.css ? `<div><strong>Selector:</strong> <code>${Utils.escapeHtml(step.selector.css)}</code></div>` : ""}
        ${step.value ? `<div><strong>Value:</strong> ${Utils.escapeHtml(step.value)}</div>` : ""}
      </div>
    </div>`
    )
    .join("");
}


const _toastIcons = {
  success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  warning: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
};
let _toastTimer = null;
let _isFirstStateUpdate = true;

function animateCountUp(el, target, durationMs = 400) {
  const start = parseInt(el.textContent) || 0;
  if (start === target || target === 0) { el.textContent = target; return; }
  const startTime = performance.now();
  function tick(now) {
    const progress = Math.min((now - startTime) / durationMs, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    el.textContent = Math.round(start + (target - start) * eased);
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function showMessage(text, type = "info", duration = 3000) {
  // Clear any pending dismiss
  if (_toastTimer) { clearTimeout(_toastTimer); _toastTimer = null; }

  const icon = _toastIcons[type] || _toastIcons.info;
  messageDiv.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-text">${Utils.escapeHtml(text)}</span><span class="toast-progress"></span>`;
  messageDiv.className = "message " + type;
  messageDiv.style.setProperty("--toast-duration", duration + "ms");
  messageDiv.style.display = "flex";
  messageDiv.classList.remove("toast-exit");

  _toastTimer = setTimeout(() => {
    messageDiv.classList.add("toast-exit");
    setTimeout(() => { messageDiv.style.display = "none"; messageDiv.classList.remove("toast-exit"); }, 200);
  }, duration);
}

// =====================
// File Sync / Storage Setup
// =====================

async function checkFileSyncStatus() {
  try {
    const configured = await fileSync.isConfigured();
    if (!configured) {
      updateSyncUI('none', 'No folder linked');
      return;
    }

    const permission = await fileSync.checkPermission();
    const folderName = await fileSync.getFolderName();

    if (permission === 'granted') {
      updateSyncUI('active', folderName || '.TestSnapper');
    } else {
      // 'prompt' or 'denied' — requestPermission() requires a real user gesture
      // so we can't silently call it here. Show the re-auth banner instead.
      updateSyncUI('needs-auth', `${folderName || '.TestSnapper'} (needs re-auth)`);
    }
  } catch (err) {
    console.error('File sync status check failed:', err);
    updateSyncUI('none', 'Error checking folder');
  }
}

function updateSyncUI(state, label) {
  const onboardingBanner = document.getElementById('storageOnboarding');
  const reauthBanner = document.getElementById('storageReauthBanner');

  // Control top-of-popup banners
  if (onboardingBanner) onboardingBanner.style.display = state === 'none' ? 'flex' : 'none';
  if (reauthBanner) reauthBanner.style.display = state === 'needs-auth' ? 'flex' : 'none';

  // Update compact status in Export tab
  if (!syncIndicator || !syncFolderName || !fileSyncStatus) return;

  syncIndicator.className = 'sync-indicator';
  fileSyncStatus.className = 'file-sync-status';
  syncFolderName.textContent = label || 'No folder set';

  if (state === 'active') {
    syncIndicator.classList.add('sync-active');
    fileSyncStatus.classList.add('active');
    if (setStorageFolderBtn) setStorageFolderBtn.textContent = 'Change Location';
    if (reauthorizeFolderBtn) reauthorizeFolderBtn.style.display = 'none';
  } else if (state === 'needs-auth') {
    syncIndicator.classList.add('sync-needs-auth');
    fileSyncStatus.classList.add('needs-auth');
    if (reauthorizeFolderBtn) reauthorizeFolderBtn.style.display = '';
  } else {
    if (reauthorizeFolderBtn) reauthorizeFolderBtn.style.display = 'none';
    if (setStorageFolderBtn) setStorageFolderBtn.textContent = 'Setup .TestSnapper';
  }
}

async function handleSetStorageFolder() {
  try {
    showMessage('Pick a parent folder — .TestSnapper will be created inside it', 'info', 5000);
    const result = await fileSync.pickDirectory();
    updateSyncUI('active', `.TestSnapper (in ${result.parentName})`);

    // Run migration if chrome.storage has existing sessions and not yet migrated
    const migrated = await fileSync.isMigrated();
    if (!migrated) {
      const { StorageManager } = await import('../../storage.js');
      const legacyStorage = new StorageManager();
      await legacyStorage.init();
      showMessage('Migrating existing sessions to filesystem...', 'info', 5000);
      const { migrated: count } = await fileSync.migrateFromChromeStorage(legacyStorage);
      showMessage(`${count} session(s) migrated to ${result.parentName}/.TestSnapper`, 'success');
    } else {
      showMessage(`Storage folder set: ${result.parentName}/.TestSnapper`, 'success');
    }

    await loadSessions();
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error('Set storage folder failed:', err);
    showMessage('Failed to set folder: ' + err.message, 'error');
  }
}

async function handleReauthorize() {
  try {
    const granted = await fileSync.requestPermission();
    if (granted) {
      const folderName = await fileSync.getFolderName();
      updateSyncUI('active', folderName);
      await flushAllPending();
      await loadSessions();
      showMessage('Folder access restored', 'success');
    } else {
      showMessage('Permission denied. Try setting a new folder.', 'error');
    }
  } catch (err) {
    console.error('Re-authorize failed:', err);
    showMessage('Re-authorization failed', 'error');
  }
}

// =====================
// Flush Helpers (Buffer → Filesystem)
// =====================

/**
 * Flush a single buffered session from chrome.storage to the filesystem.
 */
async function flushBufferedSession(sessionId) {
  if (!sessionId) return;
  const fsReady = await fsStorage.isFilesystemReady();
  if (!fsReady) return;

  const success = await fsStorage.flushSession(sessionId);
  if (success) {
    // Notify background to clear buffer
    chrome.runtime.sendMessage({ action: 'clearBuffer', sessionId }).catch(() => {});
    await loadSessions();
  }
}

/**
 * Flush all sessions that are pending flush from previous recordings.
 */
async function flushAllPending() {
  const fsReady = await fsStorage.isFilesystemReady();
  if (!fsReady) return;

  const response = await chrome.runtime.sendMessage({ action: 'getPendingFlush' }).catch(() => null);
  if (!response?.pending?.length) return;

  for (const sessionId of response.pending) {
    await flushBufferedSession(sessionId);
  }
}