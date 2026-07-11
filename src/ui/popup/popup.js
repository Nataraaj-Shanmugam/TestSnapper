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
 * - FUNC-006: Fixed broken dynamic import path (../../core/storage.js)
 * - UX-004: Custom session combobox keyboard navigation (ArrowDown/Up, Home/End, Enter/Space, Escape)
 * - UX-010: Export shows persistent progress (not auto-dismissed) until promise settles
 * - UX-013: Help button renders shortcuts as structured content
 * - UX-020: Popup tabs arrow-key navigation with roving tabindex
 */

import { FSStorageManager } from '../../core/fs-storage.js';
import { ExportService } from '../../core/export-service.js';
import { Utils } from '../../core/utils.js';
import { Logger } from '../../core/logger.js';
import { setupTheme } from '../theme.js';

Logger.info("✅ TestSnapper Popup loaded");

const fsStorage = new FSStorageManager();
const fileSync = fsStorage.fileSync;
const exportService = new ExportService(fsStorage);

document.addEventListener("DOMContentLoaded", async () => {
  await init();
  // Poll background state only while recording/paused; started after init() so
  // currentState is already populated from the background response (LOW-024).
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

// =====================
// Initialization
// =====================
// Failure-isolate each init phase: one broken widget must never take down
// the whole popup (P0-8: a single null-element throw used to abort init()).
async function safePhase(name, fn) {
  try {
    await fn();
  } catch (err) {
    Logger.error(`Popup init phase "${name}" failed:`, err);
  }
}

async function init() {
  await safePhase('setupTabs', () => setupTabs());
  await safePhase('setupEventListeners', () => setupEventListeners());
  await safePhase('setupTheme', () => setupTheme());
  await safePhase('storageInit', () => fsStorage.init());
  await safePhase('updateState', () => updateState());
  await safePhase('checkFileSyncStatus', () => checkFileSyncStatus());
  await safePhase('flushAllPending', () => flushAllPending()); // Flush buffered sessions from previous recordings
  await safePhase('loadSessions', () => loadSessions());
  await safePhase('loadSettings', () => loadSettings());
  await safePhase('loadExportFormat', () => loadExportFormat()); // POP-MED-003
  await safePhase('updateStorageUsage', () => updateStorageUsage()); // POP-003
  await safePhase('setupKeyboardShortcuts', () => setupKeyboardShortcuts()); // POP-006
  const versionFooter = document.getElementById('versionFooter');
  if (versionFooter) {
    const { version } = chrome.runtime.getManifest();
    versionFooter.textContent = `TestSnapper v${version}`;
  }
}

// setupTheme / applyTheme imported from ../theme.js

/**
 * UX-013 / POP-006 - Keyboard shortcuts documentation
 * Wired to #keyboardShortcutsHelp button in popup.html.
 * Renders structured shortcut list, not a plain toast string.
 */
function setupKeyboardShortcuts() {
  const helpBtn = document.getElementById('keyboardShortcutsHelp');
  if (!helpBtn) return;

  helpBtn.addEventListener('click', () => {
    // Toggle: a second click while the shortcuts list is showing dismisses
    // it instead of re-showing it (a help popover should close on repeat click).
    const isShortcutsShowing = messageDiv.style.display === 'flex' &&
      messageDiv.classList.contains('message-multiline');
    if (isShortcutsShowing) {
      hideMessage();
      return;
    }

    const shortcuts = [
      { keys: 'Ctrl+Shift+S / ⌘⇧S', desc: 'Capture Screenshot' },
      { keys: 'Ctrl+Shift+U / ⌘⇧U', desc: 'Pause/Resume Recording' },
      { keys: 'Ctrl+Shift+E / ⌘⇧E', desc: 'Stop Recording' },
      { keys: 'Ctrl+Enter / ⌘↵',    desc: 'Export Session' },
      { keys: '← → Arrow Keys',      desc: 'Navigate Tabs' },
    ];
    const lines = shortcuts.map(s => `• ${s.keys}: ${s.desc}`).join('\n');
    showMessage(lines, 'info', 8000);
    // UX-013: the shared toast is built for a single centered line; a
    // multi-line shortcut list needs left-aligned text with real line breaks.
    messageDiv.classList.add('message-multiline');
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
  const tabs = Array.from(document.querySelectorAll(".tab"));
  const tablist = document.querySelector(".tabs");

  // Ensure tablist has proper ARIA role
  if (tablist) {
    tablist.setAttribute('role', 'tablist');
  }

  function activateTab(tab) {
    const targetTab = tab.dataset.tab;

    // Update tabs: roving tabindex
    tabs.forEach((t) => {
      t.classList.remove("active");
      t.setAttribute('tabindex', '-1');
      t.setAttribute('aria-selected', 'false');
    });
    tab.classList.add("active");
    tab.setAttribute('tabindex', '0');
    tab.setAttribute('aria-selected', 'true');

    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    document.getElementById(targetTab + "-tab").classList.add("active");

    if (targetTab === "export") loadSessions();
  }

  tabs.forEach((tab) => {
    // Set initial roving tabindex
    tab.setAttribute('role', 'tab');
    tab.setAttribute('tabindex', tab.classList.contains('active') ? '0' : '-1');
    tab.setAttribute('aria-selected', tab.classList.contains('active') ? 'true' : 'false');

    tab.addEventListener("click", () => activateTab(tab));
  });

  // UX-020: Arrow key navigation on tablist
  if (tablist) {
    tablist.addEventListener('keydown', (e) => {
      const currentIndex = tabs.findIndex(t => t === document.activeElement);
      if (currentIndex === -1) return;

      let nextIndex = currentIndex;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        nextIndex = (currentIndex + 1) % tabs.length;
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      } else if (e.key === 'Home') {
        e.preventDefault();
        nextIndex = 0;
      } else if (e.key === 'End') {
        e.preventDefault();
        nextIndex = tabs.length - 1;
      } else {
        return;
      }

      // Per ARIA APG: arrow keys only move focus; Enter/Space activate (HIGH-027)
      tabs[nextIndex].focus();
    });
  }
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
    syncNavScreenshotDependency();
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
}

/**
 * "Auto-Capture Screenshots" is the master switch for all automatic screenshots.
 * "Screenshot Before Navigation" is a sub-option that only applies when
 * auto-capture is on, so grey it out (and visually mark the dependency) when
 * auto-capture is off.
 */
function syncNavScreenshotDependency() {
  const navBox = document.getElementById('captureOnNavigation');
  if (!navBox) return;
  const enabled = !!autoScreenshot?.checked;
  navBox.disabled = !enabled;
  const label = navBox.closest('.checkbox-label') || navBox.parentElement;
  if (label) {
    label.style.opacity = enabled ? '' : '0.5';
    label.title = enabled ? '' : 'Enable "Auto-Capture Screenshots" to use this';
  }
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

  });

  // Make all buttons keyboard accessible — native <button> already handles Enter/Space,
  // so no keydown listener is needed (LOW-021 / LOW-022: removed dead Tab block and double-fire listener).
  const makeButtonAccessible = (button) => {
    if (!button) return;
    if (!button.hasAttribute('tabindex')) {
      button.setAttribute('tabindex', '0');
    }
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
async function updateStorageUsage() {
  const bar = document.getElementById('storageUsageBar');
  const text = document.getElementById('storageUsageText');
  if (!bar || !text) return;
  try {
    const used = await new Promise(resolve => chrome.storage.local.getBytesInUse(null, resolve));
    // unlimitedStorage — use 1 GB as a soft reference ceiling for display
    const maxBytes = 1024 * 1024 * 1024;
    const pct = Math.min((used / maxBytes) * 100, 100);
    bar.style.width = pct + '%';
    bar.className = 'storage-usage-bar ' + (pct > 95 ? 'storage-critical' : pct > 80 ? 'storage-warn' : 'storage-ok');
    const mb = (used / (1024 * 1024)).toFixed(1);
    text.textContent = `${mb} MB used`;
  } catch {
    text.textContent = 'Storage unavailable';
  }
}

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
    Logger.error("Start failed:", err);
    showMessage("Error starting recording. Check permissions.", "error");
  }
}

async function handlePause() {
  try {
    const response = await chrome.runtime.sendMessage({ action: "pauseRecording" });
    response.success ? showMessage("Recording paused", "info") : showMessage("Pause failed", "error");
    await updateState();
  } catch (err) {
    Logger.error("Pause failed:", err);
    showMessage("Error pausing recording", "error");
  }
}

async function handleResume() {
  try {
    const response = await chrome.runtime.sendMessage({ action: "resumeRecording" });
    response.success ? showMessage("Recording resumed", "success") : showMessage("Resume failed", "error");
    await updateState();
  } catch (err) {
    Logger.error("Resume failed:", err);
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
    Logger.error("Stop failed:", err);
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
    Logger.error("Screenshot failed:", err);
    showMessage("Error capturing screenshot", "error");
  }
}

async function handleExport() {
  const sessionId = sessionDropdown.value;
  if (!sessionId) return showMessage("Select a session first", "error");

  const format = document.querySelector('input[name="format"]:checked')?.value || 'json';

  // UX-010: Show persistent progress — do NOT auto-dismiss while export is running.
  // Keep the status visible until the promise settles (success or error).
  showExportProgress("Exporting...");

  try {
    const result = await exportService.exportSession(sessionId, format, (pct) => {
      // Progress callback: update the status message with percentage if provided
      if (typeof pct === 'number') {
        showExportProgress(`Exporting... ${Math.round(pct * 100)}%`);
      }
    });

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
    hideExportProgress();
    showMessage(`Exported as ${filename}`, "success");
  } catch (err) {
    Logger.error("Export failed:", err);
    hideExportProgress();
    showMessage("Export failed: " + err.message, "error");
  }
}

/**
 * UX-010: Show a persistent (non-auto-dismissing) export progress status.
 * Disables the export button and suppresses the normal toast auto-dismiss timer.
 * @param {string} msg - Status message to display
 */
function showExportProgress(msg) {
  // Cancel any pending toast auto-dismiss timer so the message stays visible
  if (_toastTimer) { clearTimeout(_toastTimer); _toastTimer = null; }

  const icon = _toastIcons.info;
  messageDiv.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-text">${Utils.escapeHtml(msg)}</span>`;
  messageDiv.className = "message info exporting";
  messageDiv.style.display = "flex";
  messageDiv.classList.remove("toast-exit");

  if (exportBtn) exportBtn.disabled = true;
}

/**
 * UX-010: Clear the export progress status and re-enable the export button.
 */
function hideExportProgress() {
  if (exportBtn) exportBtn.disabled = false;
}

async function handleViewSteps() {
  const sessionId = sessionDropdown.value;
  if (!sessionId) return showMessage("Select a session", "error");

  try {
    const url = chrome.runtime.getURL(`src/ui/review/review-standalone.html?sessionId=${sessionId}`);
    await chrome.tabs.create({ url });
    setTimeout(() => window.close(), 500);
  } catch (err) {
    Logger.error("View steps failed:", err);
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
    Logger.error("Delete failed:", err);
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
    Logger.error("Clear all failed:", err);
    showMessage("Error clearing sessions", "error");
  }
}

// =====================
// STR-MED-003: Backup/Restore
// =====================
async function handleBackupAll() {
  try {
    showMessage("Preparing backup...", "info");

    // PERF-016: call exportAllData() directly in window context — no message bus, no 64MB limit.
    // FSStorageManager reads from filesystem (or chrome.storage with a size guard) directly.
    const backupData = await fsStorage.exportAllData();

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const filename = `testsnapper-backup-${timestamp}.json`;

    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    showMessage(`Backup saved: ${filename}`, "success");
  } catch (err) {
    Logger.error("Backup failed:", err);
    showMessage("Error creating backup: " + err.message, "error");
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

    // PERF-016: call importData() directly in window context — no 64MB message limit.
    await fsStorage.importData(backupData);

    showMessage(`Restored ${backupData.sessions.length} sessions successfully`, "success");
    await loadSessions();
    await updateStorageUsage();
  } catch (err) {
    Logger.error("Restore failed:", err);
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
      captureOnNavigation: document.getElementById('captureOnNavigation')?.checked !== false,
      smartDedup: document.getElementById('smartDedup')?.checked !== false,
      autoSave: autoSave?.checked !== false,
      maxSessions: maxSessionsValue,
      screenshotFormat: screenshotFormatValue,
      exportImageQuality: exportImageQualityValue,
      captureApiCalls: captureApiCalls?.checked || false,
      captureFailedCalls: captureFailedCalls?.checked || false,
      captureAllCalls: captureAllCalls?.checked || false,
      includeTimestamp: includeTimestamp?.checked !== false
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
    Logger.error("Save settings failed:", err);
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
      sessionDropdown.innerHTML = '<option value="">Re-authorize to view sessions...</option>';
      handleSessionSelect();
      return;
    }

    // Read directly from filesystem (or buffer for active/pending sessions)
    const sessions = await fsStorage.getAllSessions();
    sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    sessionDropdown.innerHTML = '<option value="">Select a session...</option>';
    sessions.forEach((s) => {
      const opt = document.createElement("option");
      const sessionName = s.sessionName || `Session ${new Date(s.createdAt).toLocaleString()}`;
      opt.value = s.sessionId;
      opt.textContent = `${sessionName} (${s.stepCount || 0} steps)`;
      sessionDropdown.appendChild(opt);
    });

    if (currentSessionId) {
      sessionDropdown.value = currentSessionId;
    }
    handleSessionSelect();
  } catch (e) {
    Logger.error("Load sessions failed:", e);
  }
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

    // Update visibility
    if (apiCallsOptions) apiCallsOptions.style.display = captureApiCalls?.checked ? "block" : "none";
    if (screenshotInterval) screenshotInterval.style.display = autoScreenshot?.checked ? "block" : "none";
    syncNavScreenshotDependency();
  } catch (err) {
    Logger.error("Load settings failed:", err);
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
    Logger.error("Load export format failed:", err);
  }
}

async function saveExportFormat(format) {
  try {
    await chrome.storage.local.set({ exportFormat: format });
  } catch (err) {
    Logger.error("Save export format failed:", err);
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
    Logger.error("State update failed:", e);
  }
}

async function updateLiveSteps() {
  try {
    const res = await chrome.runtime.sendMessage({ action: "getSessionSteps", sessionId: currentSessionId });
    if (res.success) displaySteps(res.steps, liveStepsList);
  } catch (err) {
    Logger.error("Update live steps failed:", err);
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

// Manual dismiss — same exit animation as the auto-dismiss timer in showMessage().
function hideMessage() {
  if (_toastTimer) { clearTimeout(_toastTimer); _toastTimer = null; }
  messageDiv.classList.add("toast-exit");
  setTimeout(() => {
    messageDiv.style.display = "none";
    messageDiv.classList.remove("toast-exit", "message-multiline");
  }, 200);
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
    Logger.error('File sync status check failed:', err);
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
      const { StorageManager } = await import('../../core/storage.js');
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
    Logger.error('Set storage folder failed:', err);
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
    Logger.error('Re-authorize failed:', err);
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