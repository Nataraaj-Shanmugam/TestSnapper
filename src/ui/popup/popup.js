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

console.log("✅ TestSnapper Popup loaded");

document.addEventListener("DOMContentLoaded", async () => {
  await init();
  setInterval(() => {
    if (currentState === "recording" || currentState === "paused") {
      updateState();
    }
  }, 2000);
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

// Settings section
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
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
  await updateState();
  await loadSessions();
  await loadSettings();
  await updateStorageUsage(); // BUG FIX: POP-003
  setupKeyboardShortcuts(); // BUG FIX: POP-006
}

/**
 * BUG FIX: BUG-002 - Theme State Inconsistency
 * Standardized on light-mode class toggle with explicit state management
 */
function setupTheme() {
  const themeToggle = document.getElementById('themeToggle');
  if (!themeToggle) return;

  const icon = themeToggle.querySelector('.icon');

  // 1. Check for manual override in localStorage
  const savedTheme = localStorage.getItem('theme');

  if (savedTheme) {
    applyTheme(savedTheme);
  } else {
    // 2. Default to time-based logic (Dark: 6 PM - 6 AM)
    const hour = new Date().getHours();
    const isDarkTime = hour >= 18 || hour < 6;
    applyTheme(isDarkTime ? 'dark' : 'light');
  }

  // Toggle Listener
  themeToggle.addEventListener('click', () => {
    // Check current theme from data attribute for reliability
    const currentTheme = document.body.dataset.theme || 'dark';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';

    applyTheme(newTheme);
    localStorage.setItem('theme', newTheme);
  });
}

/**
 * BUG FIX: BUG-002 - Theme application with explicit state tracking
 */
function applyTheme(theme) {
  const icon = document.querySelector('#themeToggle .icon');

  // Set data attribute for reliable state tracking
  document.body.dataset.theme = theme;

  if (theme === 'light') {
    document.body.classList.add('light-mode');
    if (icon) icon.textContent = '☀️';
  } else {
    document.body.classList.remove('light-mode');
    if (icon) icon.textContent = '🌙';
  }
}

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'sessionNameUpdated') {
    loadSessions();
  } else if (message.action === 'storageQuotaWarning') {
    // BUG FIX: POP-003 - Storage quota warning
    showMessage(`⚠️ Storage ${(message.usage.percentage * 100).toFixed(1)}% full. Consider deleting old sessions.`, 'warning', 10000);
    updateStorageUsage();
  }
});

// =====================
// UI Setup
// =====================
function setupTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const targetTab = tab.dataset.tab;

      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

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
}

// =====================
// BUG FIX: POP-003 - Storage Usage Indicator
// =====================
async function updateStorageUsage() {
  try {
    const response = await chrome.runtime.sendMessage({ action: "getStorageUsage" });
    if (response.success) {
      const usage = response.usage;
      const usageBar = document.getElementById('storageUsageBar');
      const usageText = document.getElementById('storageUsageText');

      if (usageBar && usageText) {
        const percentage = (usage.percentage * 100).toFixed(1);
        usageBar.style.width = `${percentage}%`;
        usageBar.className = 'storage-usage-bar';

        // Color coding
        if (usage.error) {
          usageBar.classList.add('storage-critical');
        } else if (usage.warning) {
          usageBar.classList.add('storage-warning');
        } else {
          usageBar.classList.add('storage-ok');
        }

        const usedMB = (usage.used / 1024 / 1024).toFixed(1);
        const totalMB = (usage.total / 1024 / 1024).toFixed(0);
        usageText.textContent = `${usedMB} MB / ${totalMB} MB (${percentage}%)`;
      }
    }
  } catch (error) {
    console.error('Failed to update storage usage:', error);
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
    const response = await chrome.runtime.sendMessage({ action: "exportSession", sessionId, format });

    if (response.success) {
      showMessage(`Exported as ${response.filename}`, "success");
    } else {
      showMessage("Export failed: " + (response.error || "Unknown error"), "error");
    }
  } catch (err) {
    console.error("Export failed:", err);
    showMessage("Error during export", "error");
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
    const response = await chrome.runtime.sendMessage({ action: "deleteSession", sessionId });
    if (response.success) {
      showMessage("Deleted session", "success");
      await loadSessions();
      await updateStorageUsage(); // Update storage after delete
    } else {
      showMessage("Delete failed: " + (response.error || "Unknown error"), "error");
    }
  } catch (err) {
    console.error("Delete failed:", err);
    showMessage("Error deleting session", "error");
  }
}

async function handleClearAll() {
  if (!confirm("Delete ALL sessions? This cannot be undone.")) return;

  try {
    const response = await chrome.runtime.sendMessage({ action: "clearAllSessions" });
    if (response.success) {
      showMessage("Cleared all sessions", "success");
      await loadSessions();
      await updateStorageUsage(); // Update storage after clear
    } else {
      showMessage("Clear failed: " + (response.error || "Unknown error"), "error");
    }
  } catch (err) {
    console.error("Clear all failed:", err);
    showMessage("Error clearing sessions", "error");
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
    const imageQualityValue = parseFloat(document.getElementById('imageQuality')?.value) || 0.92;

    // Validation ranges
    if (screenshotSecondsValue < 1 || screenshotSecondsValue > 60) {
      showMessage("Screenshot interval must be between 1-60 seconds", "error");
      return;
    }

    if (maxSessionsValue < 1 || maxSessionsValue > 100) {
      showMessage("Max sessions must be between 1-100", "error");
      return;
    }

    if (imageQualityValue < 0.1 || imageQualityValue > 1.0) {
      showMessage("Image quality must be between 0.1-1.0", "error");
      return;
    }

    const settings = {
      autoScreenshot: autoScreenshot?.checked || false,
      screenshotSeconds: screenshotSecondsValue,
      captureOnNavigation: document.getElementById('captureOnNavigation')?.checked !== false,
      smartDedup: document.getElementById('smartDedup')?.checked !== false,
      autoSave: autoSave?.checked !== false,
      maxSessions: maxSessionsValue,
      imageQuality: imageQualityValue,
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
    const response = await chrome.runtime.sendMessage({ action: "getAllSessions" });
    if (response.success) {
      const sessions = response.sessions || [];
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
    }
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

    const imageQualityInput = document.getElementById('imageQuality');
    if (imageQualityInput) imageQualityInput.value = s.imageQuality || 0.92;

    // Update visibility
    if (apiCallsOptions) apiCallsOptions.style.display = captureApiCalls?.checked ? "block" : "none";
    if (screenshotInterval) screenshotInterval.style.display = autoScreenshot?.checked ? "block" : "none";
  } catch (err) {
    console.error("Load settings failed:", err);
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
    target.innerHTML = `<p style="text-align:center;color:#999;font-size:11px;">No steps recorded</p>`;
    return;
  }
  target.innerHTML = steps
    .map(
      (step, i) => `
    <div class="step-item">
      <div class="step-header">
        <span class="step-number">Step ${i + 1}</span>
        <span class="step-action">${escapeHtml(step.action)}</span>
      </div>
      <div class="step-details">
        ${step.fieldName ? `<div><strong>Field:</strong> ${escapeHtml(step.fieldName)}</div>` : ""}
        ${step.selector?.css ? `<div><strong>Selector:</strong> <code>${escapeHtml(step.selector.css)}</code></div>` : ""}
        ${step.value ? `<div><strong>Value:</strong> ${escapeHtml(step.value)}</div>` : ""}
      </div>
    </div>`
    )
    .join("");
}

/**
 * BUG FIX: Added HTML escaping to prevent XSS
 */
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showMessage(text, type = "info", duration = 3000) {
  messageDiv.textContent = text;
  messageDiv.className = "message " + type;
  messageDiv.style.display = "block";
  setTimeout(() => (messageDiv.style.display = "none"), duration);
}