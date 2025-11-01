/**
 * Popup Script (CSP-safe, full functionality version)
 * Handles UI state, recording control, export, and settings
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
  await updateState();
  await loadSessions();
  await loadSettings();
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'sessionNameUpdated') {
    loadSessions();
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
// Chrome Messaging Logic
// =====================
async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function handleStart() {
  try {
    const tab = await getCurrentTab();
    const response = await chrome.runtime.sendMessage({
      action: "startRecording",
      tabInfo: { url: tab.url, title: tab.title, width: tab.width || 1920, height: tab.height || 1080 },
    });

    if (response.success) {
      currentSessionId = response.sessionId;
      showMessage("Recording started!", "success");
      await updateState();
      liveStepsViewer.style.display = "block";
    } else showMessage("Failed to start: " + response.error, "error");
  } catch (err) {
    console.error("Start failed:", err);
    showMessage("Error starting recording", "error");
  }
}

async function handlePause() {
  const response = await chrome.runtime.sendMessage({ action: "pauseRecording" });
  response.success ? showMessage("Recording paused", "info") : showMessage("Pause failed", "error");
  await updateState();
}

async function handleResume() {
  const response = await chrome.runtime.sendMessage({ action: "resumeRecording" });
  response.success ? showMessage("Recording resumed", "success") : showMessage("Resume failed", "error");
  await updateState();
}

async function handleStop() {
  stopBtn.disabled = true;
  showMessage("Stopping recording...", "info");
  try {
    const response = await chrome.runtime.sendMessage({ action: "stopRecording" });
    if (response.success) {
      showMessage("Recording stopped!", "success");
      liveStepsViewer.style.display = "none";
      setTimeout(() => window.close(), 800);
    } else showMessage("Failed to stop: " + response.error, "error");
  } catch (err) {
    console.error("Stop failed:", err);
    showMessage("Error stopping recording", "error");
  } finally {
    stopBtn.disabled = false;
  }
}

async function handleScreenshot() {
  const response = await chrome.runtime.sendMessage({ action: "captureScreenshot" });
  response.success ? showMessage("Screenshot captured!", "success") : showMessage("Capture failed", "error");
}

async function handleExport() {
  const sessionId = sessionDropdown.value;
  if (!sessionId) return showMessage("Select a session first", "error");

  const format = document.querySelector('input[name="format"]:checked').value;
  showMessage("Exporting...", "info");
  
  const response = await chrome.runtime.sendMessage({ action: "exportSession", sessionId, format });
  
  if (response.success) {
    showMessage(`Exported as ${response.filename}`, "success");
  } else {
    showMessage("Export failed: " + response.error, "error");
  }
}

async function handleViewSteps() {
  const sessionId = sessionDropdown.value;
  if (!sessionId) return showMessage("Select a session", "error");
  const url = chrome.runtime.getURL(`src/ui/review/review-standalone.html?sessionId=${sessionId}`);
  await chrome.tabs.create({ url });
  setTimeout(() => window.close(), 500);
}

async function handleDeleteSession() {
  const sessionId = sessionDropdown.value;
  if (!sessionId) return showMessage("Select a session", "error");
  if (!confirm("Delete this session?")) return;
  const response = await chrome.runtime.sendMessage({ action: "deleteSession", sessionId });
  response.success ? showMessage("Deleted session", "success") : showMessage("Delete failed", "error");
  await loadSessions();
}

async function handleClearAll() {
  if (!confirm("Delete ALL sessions?")) return;
  const response = await chrome.runtime.sendMessage({ action: "clearAllSessions" });
  response.success ? showMessage("Cleared all sessions", "success") : showMessage("Clear failed", "error");
  await loadSessions();
}

// =====================
// Session + Settings
// =====================
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
  const res = await chrome.runtime.sendMessage({ action: "getSettings" });
  if (!res.success) return;
  const s = res.settings;
  captureApiCalls.checked = s.captureApiCalls || false;
  captureFailedCalls.checked = s.captureFailedCalls || false;
  captureAllCalls.checked = s.captureAllCalls || false;
  includeTimestamp.checked = s.includeTimestamp !== false;
  autoScreenshot.checked = s.autoScreenshot || false;
  screenshotSeconds.value = s.screenshotSeconds || 5;
  autoSave.checked = s.autoSave !== false;
  maxSessions.value = s.maxSessions || 25;
  apiCallsOptions.style.display = captureApiCalls.checked ? "block" : "none";
  screenshotInterval.style.display = autoScreenshot.checked ? "block" : "none";
}

async function handleSaveSettings() {
  const settings = {
    captureApiCalls: captureApiCalls.checked,
    captureFailedCalls: captureFailedCalls.checked,
    captureAllCalls: captureAllCalls.checked,
    includeTimestamp: includeTimestamp.checked,
    autoScreenshot: autoScreenshot.checked,
    screenshotSeconds: parseInt(screenshotSeconds.value) || 5,
    autoSave: autoSave.checked,
    maxSessions: parseInt(maxSessions.value) || 25,
  };
  const res = await chrome.runtime.sendMessage({ action: "saveSettings", settings });
  res.success ? showMessage("Settings saved!", "success") : showMessage("Save failed", "error");
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
  const res = await chrome.runtime.sendMessage({ action: "getSessionSteps", sessionId: currentSessionId });
  if (res.success) displaySteps(res.steps, liveStepsList);
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
        <span class="step-action">${step.action}</span>
      </div>
      <div class="step-details">
        ${step.fieldName ? `<div><strong>Field:</strong> ${step.fieldName}</div>` : ""}
        ${step.selector?.css ? `<div><strong>Selector:</strong> <code>${step.selector.css}</code></div>` : ""}
        ${step.value ? `<div><strong>Value:</strong> ${step.value}</div>` : ""}
      </div>
    </div>`
    )
    .join("");
}

function showMessage(text, type = "info") {
  messageDiv.textContent = text;
  messageDiv.className = "message " + type;
  messageDiv.style.display = "block";
  setTimeout(() => (messageDiv.style.display = "none"), 3000);
}
