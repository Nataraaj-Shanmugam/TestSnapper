/**
 * Popup Script - Controls the extension popup UI
 */

// Tab switching
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const targetTab = tab.dataset.tab;
    
    // Update active tab
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    
    // Update active content
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.remove('active');
    });
    document.getElementById(targetTab + '-tab').classList.add('active');
    
    // Load sessions when switching to export tab
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

let currentState = 'idle';
let currentSessionId = null;

/**
 * Initialize popup
 */
async function init() {
  await updateState();
  await loadSessions();
  setupEventListeners();
}

/**
 * Setup event listeners
 */
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
}

/**
 * Get current tab info
 */
async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/**
 * Handle start recording
 */
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

/**
 * Handle pause recording
 */
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

/**
 * Handle resume recording
 */
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

/**
 * Handle stop recording
 */
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
      
      // Switch to export tab
      document.querySelector('[data-tab="export"]').click();
      
      // Auto-select the latest session
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

/**
 * Handle screenshot
 */
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

/**
 * Handle export session
 */
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

/**
 * Handle view steps
 */
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

/**
 * Handle delete session
 */
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

/**
 * Handle clear all
 */
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
 * Display steps in viewer
 */
function displaySteps(steps, targetElement) {
  if (!targetElement) targetElement = stepsList;
  
  if (!steps || steps.length === 0) {
    targetElement.innerHTML = '<p style="text-align: center; color: #999; font-size: 11px;">No steps recorded</p>';
    return;
  }

  targetElement.innerHTML = steps.map((step, index) => `
    <div class="step-item">
      <div class="step-header">
        <span class="step-number">Step ${index + 1}</span>
        <span class="step-action">${step.action}</span>
      </div>
      <div class="step-details">
        <div class="step-detail">
          <strong>Field:</strong>
          <span>${step.fieldName || 'N/A'}</span>
        </div>
        <div class="step-detail">
          <strong>Selector:</strong>
          <code>${step.selector?.css || 'N/A'}</code>
        </div>
        ${step.value ? `
          <div class="step-detail">
            <strong>Value:</strong>
            <span>${step.value}</span>
          </div>
        ` : ''}
      </div>
    </div>
  `).join('');
}

/**
 * Handle session select
 */
function handleSessionSelect() {
  const hasSelection = sessionDropdown.value !== '';
  exportBtn.disabled = !hasSelection;
  viewStepsBtn.disabled = !hasSelection;
  deleteSessionBtn.disabled = !hasSelection;
}

/**
 * Update UI state
 */
async function updateState() {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'getState'
    });

    if (response) {
      currentState = response.state;
      currentSessionId = response.session?.sessionId || null;
      
      // Update state indicator
      stateText.textContent = currentState.charAt(0).toUpperCase() + currentState.slice(1);
      stateDot.className = 'state-dot ' + (currentState === 'recording' ? 'recording' : currentState === 'paused' ? 'paused' : '');
      
      // Update step count
      stepCount.textContent = response.stepCount || 0;
      
      // Update button states
      updateButtonStates();
      
      // Update live steps if recording
      if (currentState === 'recording' && currentSessionId) {
        updateLiveSteps();
      }
    }
  } catch (error) {
    console.error('Failed to get state:', error);
  }
}

/**
 * Update live steps
 */
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

/**
 * Update button states based on current state
 */
function updateButtonStates() {
  startBtn.disabled = currentState !== 'idle';
  pauseBtn.disabled = currentState !== 'recording';
  resumeBtn.disabled = currentState !== 'paused';
  stopBtn.disabled = currentState === 'idle';
  screenshotBtn.disabled = currentState !== 'recording';
}

/**
 * Load sessions into dropdown
 */
async function loadSessions() {
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'getAllSessions'
    });

    if (response.success) {
      const sessions = response.sessions || [];
      
      sessionDropdown.innerHTML = '<option value="">Select a session...</option>';
      
      sessions.reverse().forEach(session => {
        const option = document.createElement('option');
        option.value = session.sessionId;
        const date = new Date(session.createdAt).toLocaleString();
        option.textContent = `${date} - ${session.stepCount || 0} steps`;
        sessionDropdown.appendChild(option);
      });

      // Select current session if recording
      if (currentSessionId) {
        sessionDropdown.value = currentSessionId;
        handleSessionSelect();
      }
    }
  } catch (error) {
    console.error('Failed to load sessions:', error);
  }
}

/**
 * Show message to user
 */
function showMessage(text, type = 'info') {
  messageDiv.textContent = text;
  messageDiv.className = 'message ' + type;
  messageDiv.style.display = 'block';

  setTimeout(() => {
    messageDiv.style.display = 'none';
  }, 3000);
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);

// Update state periodically when recording
setInterval(() => {
  if (currentState === 'recording' || currentState === 'paused') {
    updateState();
  }
}, 2000);