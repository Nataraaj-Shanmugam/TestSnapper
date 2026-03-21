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
async function init() {
  setupTabs();
  setupEventListeners();
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
  captureApiCalls?.addEventListener("change", (e) => {
    apiCallsOptions.style.display = e.target.checked ? "block" : "none";
    if (!e.target.checked) {
      captureFailedCalls.checked = false;
      captureAllCalls.checked = false;
    }
  });

  autoScreenshot?.addEventListener("change", (e) => {
    screenshotInterval.style.display = e.target.checked ? "block" : "none";
  });

  captureFailedCalls?.addEventListener("change", (e) => {
    if (e.target.checked) captureAllCalls.checked = false;
  });
  captureAllCalls?.addEventListener("change", (e) => {
    if (e.target.checked) captureFailedCalls.checked = false;
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
async function updateStorageUsage() {
  const usageBar = document.getElementById('storageUsageBar');
  const usageText = document.getElementById('storageUsageText');
  if (!usageBar || !usageText) return;

  const fsReady = await fsStorage.isFilesystemReady();
  if (fsReady) {
    // Filesystem has no quota — show a simple status
    usageBar.style.width = '0%';
    usageBar.className = 'storage-usage-bar storage-ok';
    usageText.textContent = 'Filesystem storage (no limit)';
  } else {
    // Still using chrome.storage buffer — show quota
    try {
      const response = await chrome.runtime.sendMessage({ action: "getStorageUsage" });
      if (response?.success) {
        const { percentage, error: err, warning, used, total } = response.usage;
        const pct = (percentage * 100).toFixed(1);
        usageBar.style.width = `${pct}%`;
        usageBar.className = 'storage-usage-bar' + (err ? ' storage-critical' : warning ? ' storage-warning' : ' storage-ok');
        const usedMB = (used / 1024 / 1024).toFixed(1);
        const totalMB = (total / 1024 / 1024).toFixed(0);
        usageText.textContent = `${usedMB} MB / ${totalMB} MB (${pct}%)`;
      }
    } catch (e) {
      console.error('Failed to update storage usage:', e);
    }
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
    showMessage(`Exported as ${filename}`, "success");
  } catch (err) {
    console.error("Export failed:", err);
    showMessage("Export failed: " + err.message, "error");
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
    console.error("Save settings failed:", err);
    showMessage("Error saving settings", "error");
  }
}

async function loadSessions() {
  try {
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
    if (currentSessionId) sessionDropdown.value = currentSessionId;
    handleSessionSelect();
  } catch (e) {
    console.error("Load sessions failed:", e);
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

    const screenshotFormatInput = document.getElementById('screenshotFormat');
    if (screenshotFormatInput) screenshotFormatInput.value = s.screenshotFormat || 'png';

    const exportImageQualityInput = document.getElementById('exportImageQuality');
    if (exportImageQualityInput) exportImageQualityInput.value = s.exportImageQuality || 'auto';

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
      stateText.textContent = currentState.charAt(0).toUpperCase() + currentState.slice(1);
      stateDot.className = "state-dot " + (currentState === "recording" ? "recording" : currentState === "paused" ? "paused" : "");
      stepCount.textContent = response.stepCount || 0;

      // Update screenshot count
      const screenshotCountEl = document.getElementById('screenshotCount');
      if (screenshotCountEl) {
        screenshotCountEl.textContent = response.screenshotCount || 0;
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
  startBtn.disabled = currentState !== "idle";
  pauseBtn.disabled = currentState !== "recording";
  resumeBtn.disabled = currentState !== "paused";
  stopBtn.disabled = currentState === "idle";
  screenshotBtn.disabled = currentState !== "recording";
}

function displaySteps(steps, target = stepsList) {
  if (!steps?.length) {
    target.innerHTML = `<p style="text-align:center;color:var(--text-muted);font-size:11px;">No steps recorded</p>`;
    return;
  }
  target.innerHTML = steps
    .map(
      (step, i) => `
    <div class="step-item">
      <div class="step-header">
        <span class="step-number">Step ${i + 1}</span>
        <span class="step-action">${Utils.escapeHtml(step.action)}</span>
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


function showMessage(text, type = "info", duration = 3000) {
  messageDiv.textContent = text;
  messageDiv.className = "message " + type;
  messageDiv.style.display = "block";
  setTimeout(() => (messageDiv.style.display = "none"), duration);
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
    } else if (permission === 'prompt') {
      // Popup open = user gesture context — silently re-request permission
      // so the user doesn't have to click a separate "Re-authorize" button.
      try {
        const granted = await fileSync.requestPermission();
        if (granted) {
          updateSyncUI('active', folderName || '.TestSnapper');
          await flushAllPending();
          await loadSessions();
        } else {
          updateSyncUI('needs-auth', `${folderName || '.TestSnapper'} (needs re-auth)`);
        }
      } catch {
        updateSyncUI('needs-auth', `${folderName || '.TestSnapper'} (needs re-auth)`);
      }
    } else {
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