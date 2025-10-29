/**
 * Content Script - Records user interactions and captures element information
 */


let selectorEngine;
let redactor;
let isRecording = false;
let currentSessionId = null;
let highlightOverlay = null;

// Initialize modules - wait for window to have the classes
function initModules() {
  if (window.SelectorEngine && window.Redactor) {
    selectorEngine = new window.SelectorEngine();
    redactor = new window.Redactor();
    console.log('TestSnapper content script initialized');
    return true;
  }
  return false;
}

// Try to initialize, with retry logic
if (!initModules()) {
  console.log('TestSnapper: Waiting for modules to load...');
  console.log('Available:', {
    hasSelectorEngine: !!window.SelectorEngine,
    hasRedactor: !!window.Redactor
  });
  setTimeout(() => {
    if (!initModules()) {
      console.error('TestSnapper: Failed to initialize - modules not available');
      console.error('Window keys:', Object.keys(window).filter(k => k.includes('Selector') || k.includes('Redactor')));
    }
  }, 100);
}

/**
 * Create highlight overlay for captured elements
 */
function createHighlight(element) {
  removeHighlight();

  const rect = element.getBoundingClientRect();
  highlightOverlay = document.createElement('div');
  highlightOverlay.id = 'testsnapper-highlight';
  highlightOverlay.style.cssText = `
    position: fixed;
    top: ${rect.top}px;
    left: ${rect.left}px;
    width: ${rect.width}px;
    height: ${rect.height}px;
    border: 2px solid #FF6B6B;
    background: rgba(255, 107, 107, 0.1);
    pointer-events: none;
    z-index: 999999;
    transition: all 0.2s;
  `;

  document.body.appendChild(highlightOverlay);

  // Auto-remove after 1 second
  setTimeout(removeHighlight, 1000);
}

/**
 * Remove highlight overlay
 */
function removeHighlight() {
  if (highlightOverlay) {
    highlightOverlay.remove();
    highlightOverlay = null;
  }
}

/**
 * Capture click event
 */
function handleClick(event) {
  if (!isRecording || !selectorEngine || !redactor) return;

  const element = event.target;

  // Skip if clicking on TestSnapper UI
  if (element.id?.startsWith('testsnapper-')) return;

  const selector = selectorEngine.generateSelector(element);
  const fieldName = selectorEngine.extractFieldName(element);

  const stepData = {
    action: 'click',
    selector: selector,
    fieldName: fieldName,
    targetLabel: selectorEngine.getElementText(element),
    url: window.location.href,
    value: null,
    isSensitive: false
  };

  // Highlight the element
  createHighlight(element);

  // Send to background
  sendStepToBackground(stepData);

  console.log('Click captured:', fieldName, selector);
}

/**
 * Capture input event
 */
function handleInput(event) {
  if (!isRecording || !selectorEngine || !redactor) return;

  const element = event.target;
  const selector = selectorEngine.generateSelector(element);
  const fieldName = selectorEngine.extractFieldName(element);
  const isSensitive = redactor.shouldIgnoreField(element);
  const value = isSensitive ? redactor.maskValue(element.value, element) : element.value;

  const stepData = {
    action: 'type',
    selector: selector,
    fieldName: fieldName,
    targetLabel: selectorEngine.getElementText(element),
    url: window.location.href,
    value: value,
    isSensitive: isSensitive
  };

  // Debounce input events - use simpler approach
  if (!element._testSnapperTimeout) {
    element._testSnapperTimeout = null;
  }

  clearTimeout(element._testSnapperTimeout);
  element._testSnapperTimeout = setTimeout(() => {
    sendStepToBackground(stepData);
    console.log('Input captured:', fieldName, value);
  }, 500);
}

/**
 * Capture change event (select, checkbox, radio)
 */
function handleChange(event) {
  if (!isRecording || !selectorEngine || !redactor) return;

  const element = event.target;
  const selector = selectorEngine.generateSelector(element);
  const fieldName = selectorEngine.extractFieldName(element);

  let value;
  let action;

  if (element.type === 'checkbox') {
    action = 'check';
    value = element.checked ? 'checked' : 'unchecked';
  } else if (element.type === 'radio') {
    action = 'select_radio';
    value = element.value;
  } else if (element.tagName.toLowerCase() === 'select') {
    action = 'select';
    value = element.options[element.selectedIndex]?.text || element.value;
  } else {
    action = 'change';
    value = element.value;
  }

  const stepData = {
    action: action,
    selector: selector,
    fieldName: fieldName,
    targetLabel: selectorEngine.getElementText(element),
    url: window.location.href,
    value: value,
    isSensitive: false
  };

  sendStepToBackground(stepData);
  console.log('Change captured:', fieldName, value);
}

/**
 * Capture form submit
 */
function handleSubmit(event) {
  if (!isRecording || !selectorEngine) return;

  const form = event.target;
  const selector = selectorEngine.generateSelector(form);
  const fieldName = selectorEngine.extractFieldName(form) || 'Form';

  const stepData = {
    action: 'submit',
    selector: selector,
    fieldName: fieldName,
    targetLabel: 'Submit Form',
    url: window.location.href,
    value: null,
    isSensitive: false
  };

  sendStepToBackground(stepData);
  console.log('Submit captured:', fieldName);
}

/**
 * Capture navigation
 */
function captureNavigation() {
  if (!isRecording) return;

  const stepData = {
    action: 'navigate',
    selector: null,
    fieldName: 'Page Navigation',
    targetLabel: document.title,
    url: window.location.href,
    value: window.location.href,
    isSensitive: false
  };

  sendStepToBackground(stepData);
  console.log('Navigation captured:', window.location.href);
}

/**
 * Send step to background script
 */
function sendStepToBackground(stepData) {
  chrome.runtime.sendMessage({
    action: 'addStep',
    stepData: stepData
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Failed to send step:', chrome.runtime.lastError);
    } else if (response && !response.success) {
      console.error('Failed to add step:', response.error);
    }
  });
}

/**
 * Start recording
 */
function startRecording(sessionId) {
  if (isRecording) return;

  isRecording = true;
  currentSessionId = sessionId;

  document.addEventListener('click', handleClick, true);
  document.addEventListener('input', handleInput, true);
  document.addEventListener('change', handleChange, true);
  document.addEventListener('submit', handleSubmit, true);

  // Capture initial navigation
  captureNavigation();

  // Add recording indicator
  addRecordingIndicator();

  console.log('Content script: Recording started');
}

/**
 * Pause recording
 */
function pauseRecording() {
  if (!isRecording) return;
  isRecording = false;
  updateRecordingIndicator('PAUSED');
  console.log('Content script: Recording paused');
}

/**
 * Resume recording
 */
function resumeRecording() {
  if (isRecording) return;
  isRecording = true;
  updateRecordingIndicator('RECORDING');
  console.log('Content script: Recording resumed');
}

/**
 * Stop recording
 */
function stopRecording() {
  if (!isRecording && !currentSessionId) return;

  isRecording = false;
  currentSessionId = null;

  // Remove event listeners
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('input', handleInput, true);
  document.removeEventListener('change', handleChange, true);
  document.removeEventListener('submit', handleSubmit, true);

  // Remove recording indicator
  removeRecordingIndicator();
  removeHighlight();

  console.log('Content script: Recording stopped');
}

/**
 * Add recording indicator to page
 */
function addRecordingIndicator() {
  if (document.getElementById('testsnapper-indicator')) return;

  const indicator = document.createElement('div');
  indicator.id = 'testsnapper-indicator';
  indicator.innerHTML = `
    <div style="
      position: fixed;
      top: 10px;
      right: 10px;
      padding: 8px 16px;
      background: #FF0000;
      color: white;
      border-radius: 20px;
      font-family: sans-serif;
      font-size: 12px;
      font-weight: bold;
      z-index: 999999;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      display: flex;
      align-items: center;
      gap: 8px;
    ">
      <div style="
        width: 8px;
        height: 8px;
        background: white;
        border-radius: 50%;
        animation: pulse 1s infinite;
      "></div>
      <span>RECORDING</span>
    </div>
    <style>
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }
    </style>
  `;

  document.body.appendChild(indicator);
}

/**
 * Update recording indicator
 */
function updateRecordingIndicator(status) {
  const indicator = document.getElementById('testsnapper-indicator');
  if (!indicator) return;

  const span = indicator.querySelector('span');
  const dot = indicator.querySelector('div > div');
  const container = indicator.querySelector('div');

  if (status === 'PAUSED') {
    span.textContent = 'PAUSED';
    container.style.background = '#FFA500';
    dot.style.animation = 'none';
  } else if (status === 'RECORDING') {
    span.textContent = 'RECORDING';
    container.style.background = '#FF0000';
    dot.style.animation = 'pulse 1s infinite';
  }
}

/**
 * Remove recording indicator
 */
function removeRecordingIndicator() {
  const indicator = document.getElementById('testsnapper-indicator');
  if (indicator) {
    indicator.remove();
  }
}

/**
 * Listen for messages from background script
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Content script received message:', message.action);

  switch (message.action) {
    case 'startRecording':
      startRecording(message.sessionId);
      sendResponse({ success: true });
      break;

    case 'pauseRecording':
      pauseRecording();
      sendResponse({ success: true });
      break;

    case 'resumeRecording':
      resumeRecording();
      sendResponse({ success: true });
      break;

    case 'stopRecording':
      stopRecording();
      sendResponse({ success: true });
      break;

    default:
      sendResponse({ success: false, error: 'Unknown action' });
  }

  return true;
});

// Listen for navigation changes
let lastUrl = window.location.href;
setInterval(() => {
  if (isRecording && window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    captureNavigation();
  }
}, 1000);

console.log('TestSnapper content script loaded');
