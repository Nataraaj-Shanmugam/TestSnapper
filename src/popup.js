/**
 * Popup Script - FIXED: Session ordering, step display
 */

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const targetTab = tab.dataset.tab;

    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.remove('active');
    });
    document.getElementById(targetTab + '-tab').classList.add('active');

    if (targetTab === 'export') {
      loadSessions();
    }
  });
});

// UI Elements
const startBtn = document.getElementById('startBtn');
const pauseBtn = document.getElementById('pauseBtn');
const resumeBtn = document.getElementById('resumeBtn');
const stopBtn = document.getElementById('stopBtn');
const screenshotBtn = document.getElementById('screenshotBtn');
const exportBtn = document.getElementById('exportBtn');
const viewStepsBtn = document.getElementById('viewStepsBtn');
const closeStepsBtn = document.getElementById('closeStepsBtn');
const deleteSessionBtn = document.getElementById('deleteSessionBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const stateIndicator = document.getElementById('stateIndicator');
const stateDot = document.getElementById('stateDot');
const stateText = document.getElementById('stateText');
const stepCount = document.getElementById('stepCount');
const messageDiv = document.getElementById('message');
const sessionDropdown = document.getElementById('sessionDropdown');
const stepsViewer = document.getElementById('stepsViewer');
const stepsList = document.getElementById('stepsList');
const liveStepsViewer = document.getElementById('liveStepsViewer');
const liveStepsList = document.getElementById('liveStepsList');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const captureApiCalls = document.getElementById('captureApiCalls');
const apiCallsOptions = document.getElementById('apiCallsOptions');
const captureFailedCalls = document.getElementById('captureFailedCalls');
const captureAllCalls = document.getElementById('captureAllCalls');
const includeTimestamp = document.getElementById('includeTimestamp');
const autoScreenshot = document.getElementById('autoScreenshot');
const screenshotInterval = document.getElementById('screenshotInterval');
const screenshotSeconds = document.getElementById('screenshotSeconds');
const autoSave = document.getElementById('autoSave');
const maxSessions = document.getElementById('maxSessions');

let currentState = 'idle';
let currentSessionId = null;

async function init() {
  await updateState();
  await loadSessions();
  await loadSettings();
  setupEventListeners();
}

function setupEventListeners() {
  startBtn.addEventListener('click', handleStart);
  pauseBtn.addEventListener('click', handlePause);
  resumeBtn.addEventListener('click', handleResume);
  stopBtn.addEventListener('click', handleStop);
  screenshotBtn.addEventListener('click', handleScreenshot);
  exportBtn.addEventListener('click', handleExport);
  viewStepsBtn.addEventListener('click', handleViewSteps);
  closeStepsBtn.addEventListener('click', () => {
    stepsViewer.style.display = 'none';
  });
  deleteSessionBtn.addEventListener('click', handleDeleteSession);
  clearAllBtn.addEventListener('click', handleClearAll);
  sessionDropdown.addEventListener('change', handleSessionSelect);

  saveSettingsBtn.addEventListener('click', handleSaveSettings);

  captureApiCalls.addEventListener('change', (e) => {
    apiCallsOptions.style.display = e.target.checked ? 'block' : 'none';
    if (!e.target.checked) {
      captureFailedCalls.checked = false;
      captureAllCalls.checked = false;
    }
  });

  autoScreenshot.addEventListener('change', (e) => {
    screenshotInterval.style.display = e.target.checked ? 'block' : 'none';
  });

  captureFailedCalls.addEventListener('change', (e) => {
    if (e.target.checked) {
      captureAllCalls.checked = false;
    }
  });

  captureAllCalls.addEventListener('change', (e) => {
    if (e.target.checked) {
      captureFailedCalls.checked = false;
    }
  });
}

async function loadSettings() {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'getSettings'
    });

    if (response.success) {
      const settings = response.settings;

      captureApiCalls.checked = settings.captureApiCalls || false;
      captureFailedCalls.checked = settings.captureFailedCalls || false;
      captureAllCalls.checked = settings.captureAllCalls || false;
      includeTimestamp.checked = settings.includeTimestamp !== false;
      autoScreenshot.checked = settings.autoScreenshot || false;
      screenshotSeconds.value = settings.screenshotSeconds || 5;
      autoSave.checked = settings.autoSave !== false;
      maxSessions.value = settings.maxSessions || 25;

      apiCallsOptions.style.display = captureApiCalls.checked ? 'block' : 'none';
      screenshotInterval.style.display = autoScreenshot.checked ? 'block' : 'none';
    }
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
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
    maxSessions: parseInt(maxSessions.value) || 25
  };

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'saveSettings',
      settings: settings
    });

    if (response.success) {
      showMessage('Settings saved successfully!', 'success');
    } else {
      showMessage('Failed to save settings', 'error');
    }
  } catch (error) {
    console.error('Save settings failed:', error);
    showMessage('Error saving settings', 'error');
  }
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function handleStart() {
  try {
    const tab = await getCurrentTab();

    const response = await chrome.runtime.sendMessage({
      action: 'startRecording',
      tabInfo: {
        url: tab.url,
        title: tab.title,
        width: tab.width || 1920,
        height: tab.height || 1080
      }
    });

    if (response.success) {
      currentSessionId = response.sessionId;
      showMessage('Recording started!', 'success');
      await updateState();
      liveStepsViewer.style.display = 'block';
    } else {
      showMessage('Failed to start: ' + response.error, 'error');
    }
  } catch (error) {
    console.error('Start failed:', error);
    showMessage('Error starting recording', 'error');
  }
}

async function handlePause() {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'pauseRecording'
    });

    if (response.success) {
      showMessage('Recording paused', 'info');
      await updateState();
    } else {
      showMessage('Failed to pause: ' + response.error, 'error');
    }
  } catch (error) {
    console.error('Pause failed:', error);
    showMessage('Error pausing recording', 'error');
  }
}

async function handleResume() {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'resumeRecording'
    });

    if (response.success) {
      showMessage('Recording resumed', 'success');
      await updateState();
    } else {
      showMessage('Failed to resume: ' + response.error, 'error');
    }
  } catch (error) {
    console.error('Resume failed:', error);
    showMessage('Error resuming recording', 'error');
  }
}

async function handleStop() {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'stopRecording'
    });

    if (response.success) {
      showMessage('Recording stopped!', 'success');
      liveStepsViewer.style.display = 'none';
      await updateState();
      await loadSessions();

      document.querySelector('[data-tab="export"]').click();

      if (currentSessionId) {
        sessionDropdown.value = currentSessionId;
        handleSessionSelect();
      }
    } else {
      showMessage('Failed to stop: ' + response.error, 'error');
    }
  } catch (error) {
    console.error('Stop failed:', error);
    showMessage('Error stopping recording', 'error');
  }
}

async function handleScreenshot() {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'captureScreenshot'
    });

    if (response.success) {
      showMessage('Screenshot captured!', 'success');
      await updateState();
    } else {
      showMessage('Failed to capture: ' + response.error, 'error');
    }
  } catch (error) {
    console.error('Screenshot failed:', error);
    showMessage('Error capturing screenshot', 'error');
  }
}

async function handleExport() {
  try {
    const selectedSessionId = sessionDropdown.value;
    if (!selectedSessionId) {
      showMessage('Please select a session', 'error');
      return;
    }

    const format = document.querySelector('input[name="format"]:checked').value;

    showMessage('Exporting...', 'info');

    const response = await chrome.runtime.sendMessage({
      action: 'exportSession',
      sessionId: selectedSessionId,
      format: format
    });

    if (response.success) {
      showMessage(`Exported as ${response.filename}`, 'success');
    } else {
      showMessage('Export failed: ' + response.error, 'error');
    }
  } catch (error) {
    console.error('Export failed:', error);
    showMessage('Error exporting session', 'error');
  }
}

async function handleViewSteps() {
  try {
    const selectedSessionId = sessionDropdown.value;
    if (!selectedSessionId) {
      showMessage('Please select a session', 'error');
      return;
    }

    const response = await chrome.runtime.sendMessage({
      action: 'getSessionSteps',
      sessionId: selectedSessionId
    });

    if (response.success) {
      displaySteps(response.steps, stepsList);
      stepsViewer.style.display = 'block';
    } else {
      showMessage('Failed to load steps: ' + response.error, 'error');
    }
  } catch (error) {
    console.error('View steps failed:', error);
    showMessage('Error loading steps', 'error');
  }
}

async function handleDeleteSession() {
  const selectedSessionId = sessionDropdown.value;
  if (!selectedSessionId) {
    showMessage('Please select a session', 'error');
    return;
  }

  if (!confirm('Delete this session? This cannot be undone.')) {
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'deleteSession',
      sessionId: selectedSessionId
    });

    if (response.success) {
      showMessage('Session deleted', 'success');
      await loadSessions();
      sessionDropdown.value = '';
      handleSessionSelect();
    } else {
      showMessage('Failed to delete: ' + response.error, 'error');
    }
  } catch (error) {
    console.error('Delete failed:', error);
    showMessage('Error deleting session', 'error');
  }
}

async function handleClearAll() {
  if (!confirm('Delete ALL sessions? This cannot be undone.')) {
    return;
  }

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'clearAllSessions'
    });

    if (response.success) {
      showMessage('All sessions cleared', 'success');
      await loadSessions();
    } else {
      showMessage('Failed to clear: ' + response.error, 'error');
    }
  } catch (error) {
    console.error('Clear all failed:', error);
    showMessage('Error clearing sessions', 'error');
  }
}

/**
 * ✅ SOLID: Display steps with async screenshot loading
 */
async function displaySteps(steps, targetElement) {
  if (!targetElement) targetElement = stepsList;

  if (!steps || steps.length === 0) {
    targetElement.innerHTML = '<p style="text-align: center; color: #999; font-size: 11px;">No steps recorded</p>';
    return;
  }

  // Build HTML first
  const htmlParts = await Promise.all(steps.map(async (step, index) => {
    let oneliner = '';
    
    if (step.action === 'screenshot') {
      oneliner = step.isManual ? '📸 Manual screenshot captured' : '📸 Automated screenshot captured';
      
      // ✅ Fetch screenshot from background
      const screenshotResponse = await chrome.runtime.sendMessage({
        action: 'getScreenshot',
        stepId: step.id
      });
      
      if (screenshotResponse.success && screenshotResponse.dataUrl) {
        return `
        <div class="step-item">
          <div class="step-header">
            <span class="step-number">Step ${index + 1}</span>
            <span class="step-action">${step.action}</span>
          </div>
          <div class="step-details">
            <div class="step-detail">${oneliner}</div>
            <div style="margin-top: 8px;">
              <img src="${screenshotResponse.dataUrl}" alt="Screenshot" style="max-width: 100%; height: auto; border: 1px solid var(--border-color); border-radius: 4px;"/>
            </div>
          </div>
        </div>`;
      } else {
        return `
        <div class="step-item">
          <div class="step-header">
            <span class="step-number">Step ${index + 1}</span>
            <span class="step-action">${step.action}</span>
          </div>
          <div class="step-details">
            <div class="step-detail">${oneliner}</div>
            <div style="margin-top: 8px; color: var(--text-tertiary); font-size: 11px;">
              Loading screenshot...
            </div>
          </div>
        </div>`;
      }
    }
    
    // ✅ Build one-liner description
    oneliner = `${step.action.toUpperCase()}`;
    if (step.fieldName && step.fieldName !== 'N/A') {
      oneliner += ` on "${step.fieldName}"`;
    }
    if (step.value && step.action !== 'navigate' && step.action !== 'screenshot') {
      oneliner += ` with value "${step.value}"`;
    }
    if (step.action === 'navigate') {
      oneliner += ` to ${step.value || step.url}`;
    }
    
    return `
    <div class="step-item">
      <div class="step-header">
        <span class="step-number">Step ${index + 1}</span>
        <span class="step-action">${step.action}</span>
      </div>
      <div class="step-details">
        <div class="step-detail">${oneliner}</div>
      </div>
    </div>`;
  }));

  targetElement.innerHTML = htmlParts.join('');
}

function handleSessionSelect() {
  const hasSelection = sessionDropdown.value !== '';
  exportBtn.disabled = !hasSelection;
  viewStepsBtn.disabled = !hasSelection;
  deleteSessionBtn.disabled = !hasSelection;
}

async function updateState() {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'getState'
    });

    if (response) {
      currentState = response.state;
      currentSessionId = response.session?.sessionId || null;

      stateText.textContent = currentState.charAt(0).toUpperCase() + currentState.slice(1);
      stateDot.className = 'state-dot ' + (currentState === 'recording' ? 'recording' : currentState === 'paused' ? 'paused' : '');

      stepCount.textContent = response.stepCount || 0;

      updateButtonStates();

      if (currentState === 'recording' && currentSessionId) {
        updateLiveSteps();
      }
    }
  } catch (error) {
    console.error('Failed to get state:', error);
  }
}

async function updateLiveSteps() {
  if (!currentSessionId) return;

  try {
    const response = await chrome.runtime.sendMessage({
      action: 'getSessionSteps',
      sessionId: currentSessionId
    });

    if (response.success) {
      displaySteps(response.steps, liveStepsList);
    }
  } catch (error) {
    console.error('Failed to update live steps:', error);
  }
}

function updateButtonStates() {
  startBtn.disabled = currentState !== 'idle';
  pauseBtn.disabled = currentState !== 'recording';
  resumeBtn.disabled = currentState !== 'paused';
  stopBtn.disabled = currentState === 'idle';
  screenshotBtn.disabled = currentState !== 'recording';
}

/**
 * ✅ FIXED: Load sessions in DESCENDING order (newest first)
 */
async function loadSessions() {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'getAllSessions'
    });

    if (response.success) {
      const sessions = response.sessions || [];
      // ✅ Sessions already sorted descending from background.js

      sessionDropdown.innerHTML = '<option value="">Select a session...</option>';

      sessions.forEach(session => {
        const option = document.createElement('option');
        option.value = session.sessionId;
        const date = new Date(session.createdAt).toLocaleString();
        option.textContent = `${date} - ${session.stepCount || 0} steps`;
        sessionDropdown.appendChild(option);
      });

      if (currentSessionId) {
        sessionDropdown.value = currentSessionId;
        handleSessionSelect();
      }
    }
  } catch (error) {
    console.error('Failed to load sessions:', error);
  }
}

function showMessage(text, type = 'info') {
  messageDiv.textContent = text;
  messageDiv.className = 'message ' + type;
  messageDiv.style.display = 'block';

  setTimeout(() => {
    messageDiv.style.display = 'none';
  }, 3000);
}

document.addEventListener('DOMContentLoaded', init);

setInterval(() => {
  if (currentState === 'recording' || currentState === 'paused') {
    updateState();
  }
}, 2000);