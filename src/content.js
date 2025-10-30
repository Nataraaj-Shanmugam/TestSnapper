/**
 * Content Script - Records user interactions with smart deduplication
 * FIXED: Eliminates redundant steps and incorrect ordering
 */

let selectorEngine;
let redactor;
let isRecording = false;
let currentSessionId = null;
let highlightOverlay = null;

// ✅ NEW: Track last interactions to prevent duplicates
let lastInteraction = {
  element: null,
  action: null,
  timestamp: 0,
  value: null
};

// ✅ NEW: Pending input timeouts per element
const pendingInputs = new Map();

// Initialize modules
function initModules() {
  if (window.SelectorEngine && window.Redactor) {
    selectorEngine = new window.SelectorEngine();
    redactor = new window.Redactor();
    console.log('TestSnapper content script initialized');
    return true;
  }
  return false;
}

if (!initModules()) {
  console.log('TestSnapper: Waiting for modules to load...');
  setTimeout(() => {
    if (!initModules()) {
      console.error('TestSnapper: Failed to initialize - modules not available');
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
 * ✅ NEW: Check if this interaction is a duplicate
 */
function isDuplicateInteraction(element, action, value = null) {
  const now = Date.now();
  const timeSinceLastAction = now - lastInteraction.timestamp;
  
  // If same element and action within 500ms, it's a duplicate
  if (lastInteraction.element === element && 
      lastInteraction.action === action && 
      timeSinceLastAction < 500) {
    
    // For input fields, only consider duplicate if value is same
    if (action === 'type' && value !== lastInteraction.value) {
      return false;
    }
    
    return true;
  }
  
  return false;
}

/**
 * ✅ NEW: Update last interaction tracking
 */
function updateLastInteraction(element, action, value = null) {
  lastInteraction = {
    element: element,
    action: action,
    timestamp: Date.now(),
    value: value
  };
}

/**
 * ✅ NEW: Check if element is an input field
 */
function isInputElement(element) {
  const tag = element.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

/**
 * ✅ FIXED: Capture click event - skip redundant clicks on input fields
 */
function handleClick(event) {
  if (!isRecording || !selectorEngine || !redactor) return;

  const element = event.target;

  // Skip TestSnapper UI
  if (element.id?.startsWith('testsnapper-')) return;

  // ✅ Skip click on input fields (will be captured as type/change)
  if (isInputElement(element) && element.type !== 'radio' && element.type !== 'checkbox' && element.type !== 'submit' && element.type !== 'button') {
    console.log('Skipping click on input field - will capture as type/change');
    return;
  }

  // ✅ Check for duplicate
  if (isDuplicateInteraction(element, 'click')) {
    console.log('Skipping duplicate click');
    return;
  }

  const selector = selectorEngine.generateSelector(element);
  const fieldName = selectorEngine.extractFieldName(element);

  // ✅ Determine correct action based on element type
  let action = 'click';
  let value = null;

  if (element.type === 'radio') {
    action = 'select_radio';
    value = element.value;
  } else if (element.type === 'checkbox') {
    action = 'check';
    value = element.checked ? 'checked' : 'unchecked';
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

  createHighlight(element);
  updateLastInteraction(element, action, value);
  sendStepToBackground(stepData);

  console.log('Interaction captured:', action, fieldName);
}

/**
 * ✅ FIXED: Capture input event with proper debouncing
 */
function handleInput(event) {
  if (!isRecording || !selectorEngine || !redactor) return;

  const element = event.target;
  const elementKey = selectorEngine.generateSelector(element)?.css || element;
  
  // ✅ Cancel any pending input for this element
  if (pendingInputs.has(elementKey)) {
    clearTimeout(pendingInputs.get(elementKey));
  }

  // ✅ Debounce input - wait for user to stop typing
  const timeoutId = setTimeout(() => {
    const selector = selectorEngine.generateSelector(element);
    const fieldName = selectorEngine.extractFieldName(element);
    const isSensitive = redactor.shouldIgnoreField(element);
    const value = isSensitive ? redactor.maskValue(element.value, element) : element.value;

    // ✅ Skip if this is a duplicate
    if (isDuplicateInteraction(element, 'type', value)) {
      console.log('Skipping duplicate input');
      return;
    }

    const stepData = {
      action: 'type',
      selector: selector,
      fieldName: fieldName,
      targetLabel: selectorEngine.getElementText(element),
      url: window.location.href,
      value: value,
      isSensitive: isSensitive
    };

    updateLastInteraction(element, 'type', value);
    sendStepToBackground(stepData);
    pendingInputs.delete(elementKey);
    
    console.log('Input captured:', fieldName, value);
  }, 800); // Increased debounce time for better UX

  pendingInputs.set(elementKey, timeoutId);
}

/**
 * ✅ FIXED: Capture change event - avoid duplicates with input
 */
function handleChange(event) {
  if (!isRecording || !selectorEngine || !redactor) return;

  const element = event.target;
  
  // ✅ Cancel any pending input for this element to avoid duplicate
  const elementKey = selectorEngine.generateSelector(element)?.css || element;
  if (pendingInputs.has(elementKey)) {
    clearTimeout(pendingInputs.get(elementKey));
    pendingInputs.delete(elementKey);
  }

  const selector = selectorEngine.generateSelector(element);
  const fieldName = selectorEngine.extractFieldName(element);

  let value;
  let action;

  if (element.type === 'checkbox') {
    // ✅ Skip - already handled by click
    return;
  } else if (element.type === 'radio') {
    // ✅ Skip - already handled by click
    return;
  } else if (element.tagName.toLowerCase() === 'select') {
    action = 'select';
    value = element.options[element.selectedIndex]?.text || element.value;
  } else {
    // ✅ For text inputs, use 'type' action
    action = 'type';
    const isSensitive = redactor.shouldIgnoreField(element);
    value = isSensitive ? redactor.maskValue(element.value, element) : element.value;
  }

  // ✅ Check for duplicate
  if (isDuplicateInteraction(element, action, value)) {
    console.log('Skipping duplicate change');
    return;
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

  updateLastInteraction(element, action, value);
  sendStepToBackground(stepData);
  console.log('Change captured:', fieldName, value);
}

/**
 * ✅ FIXED: Capture form submit - prevent duplicate with button click
 */
function handleSubmit(event) {
  if (!isRecording || !selectorEngine) return;

  const form = event.target;
  
  // ✅ Check for duplicate submit
  if (isDuplicateInteraction(form, 'submit')) {
    console.log('Skipping duplicate submit');
    return;
  }

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

  updateLastInteraction(form, 'submit');
  sendStepToBackground(stepData);
  console.log('Submit captured:', fieldName);
}

/**
 * ✅ FIXED: Capture navigation - only once per URL change
 */
let lastNavigationUrl = '';
let isInitialNavigation = true;

function captureNavigation() {
  if (!isRecording) return;

  const currentUrl = window.location.href;
  
  // ✅ Skip initial navigation when recording starts
  if (isInitialNavigation) {
    isInitialNavigation = false;
    lastNavigationUrl = currentUrl;
    console.log('Skipping initial navigation');
    return;
  }

  // ✅ Skip if URL hasn't changed
  if (currentUrl === lastNavigationUrl) {
    return;
  }

  lastNavigationUrl = currentUrl;

  const stepData = {
    action: 'navigate',
    selector: null,
    fieldName: 'Page Navigation',
    targetLabel: document.title,
    url: currentUrl,
    value: currentUrl,
    isSensitive: false
  };

  sendStepToBackground(stepData);
  console.log('Navigation captured:', currentUrl);
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
  isInitialNavigation = true; // ✅ Reset initial navigation flag
  lastNavigationUrl = window.location.href;

  document.addEventListener('click', handleClick, true);
  document.addEventListener('input', handleInput, true);
  document.addEventListener('change', handleChange, true);
  document.addEventListener('submit', handleSubmit, true);

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

  // ✅ Clear all pending inputs
  pendingInputs.forEach(timeoutId => clearTimeout(timeoutId));
  pendingInputs.clear();

  // ✅ Reset tracking
  lastInteraction = { element: null, action: null, timestamp: 0, value: null };

  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('input', handleInput, true);
  document.removeEventListener('change', handleChange, true);
  document.removeEventListener('submit', handleSubmit, true);

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

// ✅ FIXED: Monitor URL changes without capturing initial load
let lastUrl = window.location.href;
setInterval(() => {
  if (isRecording && window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    captureNavigation();
  }
}, 1000);

console.log('TestSnapper content script loaded');