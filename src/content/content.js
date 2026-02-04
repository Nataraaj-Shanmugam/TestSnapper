/**
 * Content Script - FIXED: Modal state management + session recovery
 */
if (window.testSnapperInitialized) {
  console.log('TestSnapper content script already initialized');
  // Optional: We could trigger a re-bind here if needed, but for now just exit to avoid syntax errors
  // Actually, we can't exit from top-level 'let' declarations by checking a flag *after* they run if they run first.
  // We must wrap the whole file or accept that we cannot re-inject this script.
  // HOWEVER, the error is SyntaxError, which happens at parsing time. 
  // We can't fix parsing errors with code inside the file unless we remove the 'let'.
  // Changing 'let' to 'var' fixes the SyntaxError.
}
window.testSnapperInitialized = true;

var selectorEngine;
var redactor;
var isRecording = false;
var currentSessionId = null;
var highlightOverlay = null;
var floatingPanelContainer = null;
var timerInterval = null;
var recordingSeconds = 0;
var isPaused = false;
var eventListenerController = null;
var isModalOpen = false;
var modalTimeout = null;

// Track last interactions to prevent duplicates
var lastInteraction = {
  element: null,
  action: null,
  timestamp: 0,
  value: null
};

// Pending input timeouts per element
var pendingInputs = new Map();

// 🔧 FIX: BUG-003 - Modal queue system to prevent race conditions
var modalQueue = [];
var isProcessingModal = false;
var currentModalId = null;
var modalStates = new Map(); // Track state per modal: { id, overlay, resolver, timeout, step }

// 🔧 FIX #7: Add heartbeat to detect background script restart
var sessionValidationInterval = null;

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
 * Enhanced field name extraction for better reporting
 */
function getEnhancedFieldName(element) {
  const label = findAssociatedLabel(element);
  if (label) return cleanFieldName(label);

  if (element.placeholder) {
    return cleanFieldName(element.placeholder);
  }

  if (element.getAttribute('aria-label')) {
    return cleanFieldName(element.getAttribute('aria-label'));
  }
  if (element.getAttribute('aria-labelledby')) {
    const labelElement = document.getElementById(element.getAttribute('aria-labelledby'));
    if (labelElement) return cleanFieldName(labelElement.textContent);
  }

  if (element.name) {
    return cleanFieldName(element.name);
  }

  if (element.id) {
    return cleanFieldName(element.id);
  }

  if (element.type) {
    return cleanFieldName(element.type);
  }

  const nearbyText = findNearbyText(element);
  if (nearbyText) return cleanFieldName(nearbyText);

  const fallback = selectorEngine.extractFieldName(element);
  return fallback || null;
}

function findAssociatedLabel(element) {
  if (element.id) {
    const label = document.querySelector(`label[for="${element.id}"]`);
    if (label) return label.textContent.trim();
  }

  const parentLabel = element.closest('label');
  if (parentLabel) {
    const clone = parentLabel.cloneNode(true);
    const inputs = clone.querySelectorAll('input, select, textarea');
    inputs.forEach(input => input.remove());
    return clone.textContent.trim();
  }

  let sibling = element.previousElementSibling;
  while (sibling) {
    if (sibling.tagName.toLowerCase() === 'label') {
      return sibling.textContent.trim();
    }
    sibling = sibling.previousElementSibling;
  }

  return null;
}

function findNearbyText(element) {
  let parent = element.parentElement;
  let depth = 0;

  while (parent && depth < 2) {
    const textNodes = Array.from(parent.childNodes).filter(
      node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()
    );

    if (textNodes.length > 0) {
      return textNodes[0].textContent.trim();
    }

    const labelCandidates = parent.querySelectorAll('span, div:not(:has(*)), p');
    for (const candidate of labelCandidates) {
      const text = candidate.textContent.trim();
      if (text && text.length < 50 && !candidate.contains(element)) {
        return text;
      }
    }

    parent = parent.parentElement;
    depth++;
  }

  return null;
}

function cleanFieldName(text) {
  if (!text) return '';

  return text
    .trim()
    .replace(/[*:]/g, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ')
    .trim();
}

function getSuggestedFieldName(element, selector) {
  if (selector?.css) {
    const css = selector.css;

    const idMatch = css.match(/#([a-zA-Z0-9_-]+)/);
    if (idMatch) return cleanFieldName(idMatch[1]);

    const classMatch = css.match(/\.([a-zA-Z0-9_-]+)/);
    if (classMatch) return cleanFieldName(classMatch[1]);

    const nameMatch = css.match(/\[name="([^"]+)"\]/);
    if (nameMatch) return cleanFieldName(nameMatch[1]);
  }

  return cleanFieldName(element.tagName + ' ' + (element.type || 'Field'));
}


function showManualEntryModal(element, action, stepData) {
  return queueModal(element, action, stepData);
}

/**
 * BUG FIX: BUG-003 - Queue-based modal system
 */
async function queueModal(element, action, stepData) {
  const modalId = `modal_${Date.now()}_${Math.random()}`;

  return new Promise((resolve) => {
    modalQueue.push({
      id: modalId,
      element,
      action,
      stepData,
      resolve
    });

    // Process queue if not already processing
    if (!isProcessingModal) {
      processModalQueue();
    }
  });
}

async function processModalQueue() {
  if (modalQueue.length === 0) {
    isProcessingModal = false;
    return;
  }

  isProcessingModal = true;
  const modalRequest = modalQueue.shift();
  currentModalId = modalRequest.id;

  try {
    const result = await showManualEntryModalInternal(
      modalRequest.element,
      modalRequest.action,
      modalRequest.stepData,
      modalRequest.id
    );
    modalRequest.resolve(result);
  } catch (error) {
    console.error('Modal error:', error);
    modalRequest.resolve(null);
  }

  currentModalId = null;

  // Process next in queue
  setTimeout(() => processModalQueue(), 100);
}

function closeModalById(modalId, result) {
  const state = modalStates.get(modalId);
  if (!state) return;

  // Clear timeout
  if (state.timeout) {
    clearTimeout(state.timeout);
  }

  // Remove overlay
  if (state.overlay && state.overlay.parentNode) {
    state.overlay.style.animation = 'fadeOut 0.2s ease-out';
    setTimeout(() => state.overlay.remove(), 200);
  }

  // Resolve promise
  if (state.resolver) {
    state.resolver(result);
  }

  // Clean up state
  modalStates.delete(modalId);
}

/**
 * Internal modal implementation with unique ID tracking
 */
function showManualEntryModalInternal(element, action, stepData, modalId) {
  return new Promise((resolve) => {
    // Create modal state
    const state = {
      id: modalId,
      resolver: resolve,
      step: stepData,
      timeout: null
    };

    modalStates.set(modalId, state);

    // Auto-close after 30 seconds
    state.timeout = setTimeout(() => {
      console.warn('⚠️ Modal auto-closed after timeout:', modalId);
      closeModalById(modalId, null);
    }, 30000);
  })
}
/**
 * 🔧 FIX #2: Enhanced cleanup
 */
function closeModal(overlay) {
  if (modalTimeout) {
    clearTimeout(modalTimeout);
    modalTimeout = null;
  }

  if (overlay && overlay.parentNode) {
    overlay.style.animation = 'fadeOut 0.2s ease-out';
    setTimeout(() => {
      overlay.remove();
      isModalOpen = false;
      pendingStep = null;
      modalResolver = null;
    }, 200);
  } else {
    isModalOpen = false;
    pendingStep = null;
    modalResolver = null;
  }
}

/**
 * 🔧 FIX #2: Process step with modal pause/resume
 */
async function processStepWithManualEntry(element, action, stepData) {
  let fieldName = stepData.fieldName;

  if (!fieldName || fieldName === 'Unknown Field' || fieldName.trim() === '') {
    console.log('⚠️ Field name not detected, requesting manual entry...');

    const wasRecording = isRecording;
    isRecording = false;
    updateRecordingIndicator('PAUSED');

    fieldName = await showManualEntryModal(element, action, stepData);

    // 🔧 FIX #2: Only resume if still valid
    if (wasRecording && currentSessionId) {
      // Validate session still exists
      const valid = await validateSession();
      if (valid) {
        isRecording = true;
        updateRecordingIndicator('RECORDING');
      } else {
        console.error('❌ Session invalidated during modal - stopping recording');
        stopRecording();
        return null;
      }
    }

    if (!fieldName) {
      console.log('⏭️ User skipped field name entry');
      return null;
    }

    console.log('✅ Manual field name entered:', fieldName);
  }

  stepData.fieldName = fieldName;
  return stepData;
}

/**
 * 🔧 FIX #7: Validate session still exists in background
 */
async function validateSession() {
  if (!currentSessionId) return false;

  try {
    const response = await chrome.runtime.sendMessage({ action: 'getState' });
    if (!response || response.session?.sessionId !== currentSessionId) {
      console.error('❌ Session mismatch or background restarted');
      return false;
    }
    return true;
  } catch (error) {
    console.error('❌ Failed to validate session:', error);
    return false;
  }
}

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

function removeHighlight() {
  if (highlightOverlay) {
    highlightOverlay.remove();
    highlightOverlay = null;
  }
}

function isDuplicateInteraction(element, action, value = null) {
  const now = Date.now();
  const timeSinceLastAction = now - lastInteraction.timestamp;

  if (lastInteraction.element === element &&
    lastInteraction.action === action &&
    timeSinceLastAction < 500) {

    if (action === 'type' && value !== lastInteraction.value) {
      return false;
    }

    return true;
  }

  return false;
}

function updateLastInteraction(element, action, value = null) {
  lastInteraction = {
    element: element,
    action: action,
    timestamp: Date.now(),
    value: value
  };
}

function isInputElement(element) {
  const tag = element.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select';
}

async function handleClick(event) {
  if (!isRecording || !selectorEngine || !redactor || isModalOpen) return;
  try {
    const element = event.target;

    if (element.id?.startsWith('testsnapper-')) return;

    if (isInputElement(element) && element.type !== 'radio' && element.type !== 'checkbox' && element.type !== 'submit' && element.type !== 'button') {
      console.log('Skipping click on input field - will capture as type/change');
      return;
    }

    if (isDuplicateInteraction(element, 'click')) {
      console.log('Skipping duplicate click');
      return;
    }

    const selector = selectorEngine.generateSelector(element);
    const fieldName = getEnhancedFieldName(element);

    let action = 'click';
    let value = null;

    if (element.type === 'radio') {
      action = 'select_radio';
      value = element.value;
    } else if (element.type === 'checkbox') {
      action = 'check';
      value = element.checked ? 'checked' : 'unchecked';
    }

    let stepData = {
      action: action,
      selector: selector,
      fieldName: fieldName,
      targetLabel: selectorEngine.getElementText(element),
      url: window.location.href,
      value: value,
      isSensitive: false
    };

    stepData = await processStepWithManualEntry(element, action, stepData);
    if (!stepData) return;

    createHighlight(element);
    updateLastInteraction(element, action, value);
    sendStepToBackground(stepData);

    console.log('Interaction captured:', action, stepData.fieldName);
  } catch (error) {
    console.error('❌ Error capturing click:', error);
    // showErrorNotification('Failed to capture click: ' + error.message);
    // Don't stop recording, just log and continue
  }
}

function showErrorNotification(message) {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: #ff4444;
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    z-index: 2147483646;
    font-family: sans-serif;
    font-size: 14px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => notification.remove(), 5000);
}

function handleInput(event) {
  if (!isRecording || !selectorEngine || !redactor || isModalOpen) return;

  try {
    const element = event.target;
    const elementKey = selectorEngine.generateSelector(element)?.css || element;

    if (pendingInputs.has(elementKey)) {
      clearTimeout(pendingInputs.get(elementKey));
    }

    const timeoutId = setTimeout(async () => {
      const selector = selectorEngine.generateSelector(element);
      const fieldName = getEnhancedFieldName(element);
      const isSensitive = redactor.shouldIgnoreField(element);
      const value = isSensitive ? redactor.maskValue(element.value, element) : element.value;

      if (isDuplicateInteraction(element, 'type', value)) {
        console.log('Skipping duplicate input');
        return;
      }

      let stepData = {
        action: 'type',
        selector: selector,
        fieldName: fieldName,
        targetLabel: selectorEngine.getElementText(element),
        url: window.location.href,
        value: value,
        isSensitive: isSensitive
      };

      stepData = await processStepWithManualEntry(element, 'type', stepData);
      if (!stepData) return;

      updateLastInteraction(element, 'type', value);
      sendStepToBackground(stepData);
      pendingInputs.delete(elementKey);

      console.log('Input captured:', stepData.fieldName, value);
    }, 800);

    pendingInputs.set(elementKey, timeoutId);
  } catch (error) {
    console.error('❌ Error capturing click:', error);
    // showErrorNotification('Failed to capture click: ' + error.message);
    // Don't stop recording, just log and continue
  }
}

async function handleChange(event) {
  if (!isRecording || !selectorEngine || !redactor || isModalOpen) return;

  try {
    const element = event.target;

    const elementKey = selectorEngine.generateSelector(element)?.css || element;
    if (pendingInputs.has(elementKey)) {
      clearTimeout(pendingInputs.get(elementKey));
      pendingInputs.delete(elementKey);
    }

    const selector = selectorEngine.generateSelector(element);
    const fieldName = getEnhancedFieldName(element);

    let value;
    let action;

    if (element.type === 'checkbox') {
      return;
    } else if (element.type === 'radio') {
      return;
    } else if (element.tagName.toLowerCase() === 'select') {
      action = 'select';
      value = element.options[element.selectedIndex]?.text || element.value;
    } else {
      action = 'type';
      const isSensitive = redactor.shouldIgnoreField(element);
      value = isSensitive ? redactor.maskValue(element.value, element) : element.value;
    }

    if (isDuplicateInteraction(element, action, value)) {
      console.log('Skipping duplicate change');
      return;
    }

    let stepData = {
      action: action,
      selector: selector,
      fieldName: fieldName,
      targetLabel: selectorEngine.getElementText(element),
      url: window.location.href,
      value: value,
      isSensitive: false
    };

    stepData = await processStepWithManualEntry(element, action, stepData);
    if (!stepData) return;

    updateLastInteraction(element, action, value);
    sendStepToBackground(stepData);
    console.log('Change captured:', stepData.fieldName, value);
  } catch (error) {
    console.error('❌ Error capturing click:', error);
    // showErrorNotification('Failed to capture click: ' + error.message);
    // Don't stop recording, just log and continue
  }
}

function handleSubmit(event) {
  if (!isRecording || !selectorEngine || isModalOpen) return;

  try {
    const form = event.target;

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
  } catch (error) {
    console.error('❌ Error capturing click:', error);
    // showErrorNotification('Failed to capture click: ' + error.message);
    // Don't stop recording, just log and continue
  }
}

var lastNavigationUrl = '';
var isInitialNavigation = true;

function captureNavigation() {
  if (!isRecording || isModalOpen) return;

  const currentUrl = window.location.href;

  if (isInitialNavigation) {
    isInitialNavigation = false;
    lastNavigationUrl = currentUrl;
    console.log('Skipping initial navigation');
    return;
  }

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
 * 🔧 FIX #7: Enhanced with validation
 */
function sendStepToBackground(stepData) {
  // Validate session before sending
  if (!currentSessionId) {
    console.error('❌ No active session - cannot send step');
    stopRecording();
    return;
  }

  chrome.runtime.sendMessage({
    action: 'addStep',
    stepData: stepData
  }, (response) => {
    if (chrome.runtime.lastError) {
      console.error('Failed to send step:', chrome.runtime.lastError);
      // 🔧 FIX #7: Background might have restarted
      console.warn('⚠️ Background script may have restarted - stopping recording');
      stopRecording();
    } else if (response && !response.success) {
      console.error('Failed to add step:', response.error);
      if (response.error === 'No active session') {
        stopRecording();
      }
    }
  });
}

function startRecording(sessionId, isRestoring = false, startTimeStr = null) {
  if (isRecording) return;

  isRecording = true;
  isPaused = false;
  currentSessionId = sessionId;

  if (isRestoring) {
    isInitialNavigation = false;
    lastNavigationUrl = '';
  } else {
    isInitialNavigation = true;
    lastNavigationUrl = window.location.href;
  }

  // 🔧 FIX: CNT-007 - Use AbortController for automatic cleanup
  eventListenerController = new AbortController();
  const signal = eventListenerController.signal;

  document.addEventListener('click', handleClick, { capture: true, signal });
  document.addEventListener('input', handleInput, { capture: true, signal });
  document.addEventListener('change', handleChange, { capture: true, signal });
  document.addEventListener('submit', handleSubmit, { capture: true, signal });

  if (isRestoring && !startTimeStr) {
    console.log('⚠️ startRecording: Missing startTimeStr during restore, fetching from session...');
    chrome.runtime.sendMessage({ action: 'getSession', sessionId }, (res) => {
      if (res && res.session && res.session.createdAt) {
        startRecording(sessionId, isRestoring, res.session.createdAt);
      } else {
        console.warn('❌ Failed to recover start time, defaulting to now');
        addRecordingIndicator(Date.now());
      }
    });
    return;
  }

  let startTime = Date.now();
  if (startTimeStr) {
    startTime = new Date(startTimeStr).getTime();
  }
  console.log('Starting timer with:', { startTimeStr, startTime, now: Date.now() });
  addRecordingIndicator(startTime);

  // 🔧 FIX #7: Start session validation heartbeat
  sessionValidationInterval = setInterval(async () => {
    const valid = await validateSession();
    if (!valid) {
      console.error('❌ Session validation failed - stopping recording');
      stopRecording();
    }
  }, 5000);

  if (isRestoring) {
    captureNavigation();
  }

  console.log('Content script: Recording started');
}

function pauseRecording() {
  if (!isRecording) return;
  isRecording = false;
  isPaused = true;
  updateRecordingIndicator('PAUSED');
  console.log('Content script: Recording paused');
}

function resumeRecording() {
  if (isRecording) return;
  isRecording = true;
  isPaused = false;
  updateRecordingIndicator('RECORDING');
  console.log('Content script: Recording resumed');
}

function stopRecording() {
  if (!isRecording && !currentSessionId) return;

  isRecording = false;
  currentSessionId = null;

  // 🔧 FIX #7: Clear validation interval
  if (sessionValidationInterval) {
    clearInterval(sessionValidationInterval);
    sessionValidationInterval = null;
  }

  pendingInputs.forEach(timeoutId => clearTimeout(timeoutId));
  pendingInputs.clear();

  lastInteraction = { element: null, action: null, timestamp: 0, value: null };

  // 🔧 FIX #2: Force close modal if open
  const modal = document.getElementById('testsnapper-modal-overlay');
  if (modal) {
    closeModal(modal);
  }

  if (modalTimeout) {
    clearTimeout(modalTimeout);
    modalTimeout = null;
  }

  // 🔧 FIX: CNT-007 - Abort all event listeners at once
  if (eventListenerController) {
    eventListenerController.abort();
    eventListenerController = null;
  }

  removeRecordingIndicator();
  removeHighlight();

  console.log('Content script: Recording stopped');
}

function addRecordingIndicator(startTime = Date.now()) {
  if (document.getElementById('testsnapper-control-panel-container')) {
    // Just update the timer if it exists? No, easier to rely on existing one unless we want to force resync.
    // But for navigation, the container is gone, so this runs fresh.
    return;
  }

  const panelContainer = document.createElement('div');
  panelContainer.id = 'testsnapper-control-panel-container';
  const shadow = panelContainer.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host {
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .panel {
      display: flex;
      align-items: center;
      gap: 12px;
      background: #1e1e1e;
      padding: 8px 16px;
      border-radius: 999px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.1);
      cursor: grab;
      backdrop-filter: blur(10px);
      transition: transform 0.1s;
      user-select: none;
    }
    .panel:active {
      cursor: grabbing;
      transform: scale(0.98);
    }
    .status-container {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      background: #FF4444;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    .status-dot.paused {
      background: #FFBB33;
      animation: none;
    }
    .time-display {
      font-variant-numeric: tabular-nums;
      font-size: 13px;
      color: #e0e0e0;
      font-weight: 500;
      min-width: 35px;
    }
    .divider {
      width: 1px;
      height: 16px;
      background: rgba(255,255,255,0.15);
    }
    .controls {
      display: flex;
      gap: 4px;
    }
    .btn {
      background: transparent;
      border: none;
      cursor: pointer;
      padding: 6px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #e0e0e0;
      transition: all 0.2s ease;
    }
    .btn:hover {
      background: rgba(255,255,255,0.1);
      transform: translateY(-1px);
    }
    .btn:active {
      transform: translateY(1px);
    }
    .btn svg {
      width: 18px;
      height: 18px;
      fill: currentColor;
    }
    .btn.stop { color: #FF6B6B; }
    .btn.pause { color: #FFCC00; }
    .btn.resume { color: #4CAF50; }
    .btn.screenshot { color: #4FC3F7; }

    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(255, 68, 68, 0.4); }
      70% { box-shadow: 0 0 0 6px rgba(255, 68, 68, 0); }
      100% { box-shadow: 0 0 0 0 rgba(255, 68, 68, 0); }
    }
  `;

  const panel = document.createElement('div');
  panel.className = 'panel';

  panel.innerHTML = `
    <div class="status-container">
      <div class="status-dot" id="status-dot"></div>
      <div class="time-display" id="time-display">00:00</div>
    </div>
    <div class="divider"></div>
    <div class="controls">
      <button class="btn pause" id="btn-pause" title="Pause">
        <svg viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
      </button>
      <button class="btn resume" id="btn-resume" title="Resume" style="display:none">
         <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
      </button>
      <button class="btn screenshot" id="btn-screenshot" title="Screenshot">
           <svg viewBox="0 0 24 24"><path d="M12 12m-3.2 0a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0 -6.4 0"/><path d="M9 2L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5s5 2.24 5 5s-2.24 5-5 5z"/></svg>
      </button>
      <button class="btn stop" id="btn-stop" title="Stop">
          <svg viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>
      </button>
    </div>
  `;

  shadow.appendChild(style);
  shadow.appendChild(panel);
  document.body.appendChild(panelContainer);
  floatingPanelContainer = panelContainer;

  // --- Drag Logic ---
  let isDragging = false;
  let startX, startY;
  let initialLeft, initialTop;

  // We need to handle offsets because the container uses transform for centering first
  // But subsequent drags should probably set top/left directly and remove transform centering

  // Actually simplest way: Use transform translate for dragging
  let currentTranslateX = -50; // percent
  let currentTranslateY = 0;   // px
  // But wait, using pixels for drag is smoother.
  // Let's reset the container positioning to simply be absolute/fixed coordinates after first drag.

  let xOffset = 0;
  let yOffset = 0;
  let initialX;
  let initialY;

  // We will use transform properly
  // Since initial is left:50% translateX(-50%)
  // It's tricky. Let's just set top/left to computed values on drag start.

  const handleMouseDown = (e) => {
    if (e.target.closest('button')) return;
    isDragging = true;

    // Get current visual position
    const rect = panelContainer.getBoundingClientRect();

    // Switch to explicit pixel positioning to make dragging easier
    panelContainer.style.transform = 'none';
    panelContainer.style.left = rect.left + 'px';
    panelContainer.style.top = rect.top + 'px';

    initialX = e.clientX - rect.left;
    initialY = e.clientY - rect.top;

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;
    e.preventDefault();

    const x = e.clientX - initialX;
    const y = e.clientY - initialY;

    // Boundary checks (optional)

    panelContainer.style.left = `${x}px`;
    panelContainer.style.top = `${y}px`;
  };

  const handleMouseUp = () => {
    isDragging = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  panel.addEventListener('mousedown', handleMouseDown);

  // --- Event Wiring ---
  shadow.getElementById('btn-pause').onclick = (e) => {
    e.stopPropagation();
    chrome.runtime.sendMessage({ action: 'pauseRecording' });
  };
  shadow.getElementById('btn-resume').onclick = (e) => {
    e.stopPropagation();
    chrome.runtime.sendMessage({ action: 'resumeRecording' });
  };
  shadow.getElementById('btn-stop').onclick = (e) => {
    e.stopPropagation();
    chrome.runtime.sendMessage({ action: 'stopRecording' });
  };
  shadow.getElementById('btn-screenshot').onclick = (e) => {
    e.stopPropagation();
    chrome.runtime.sendMessage({ action: 'captureScreenshot' });
  };

  // --- Timer ---
  recordingSeconds = Math.floor((Date.now() - startTime) / 1000);
  if (recordingSeconds < 0) recordingSeconds = 0;

  if (timerInterval) clearInterval(timerInterval);
  const timeDisplay = shadow.getElementById('time-display');

  // Initial display
  const mins = Math.floor(recordingSeconds / 60).toString().padStart(2, '0');
  const secs = (recordingSeconds % 60).toString().padStart(2, '0');
  if (timeDisplay) timeDisplay.textContent = `${mins}:${secs}`;

  // 🔧 FIX: CNT-005 - Only increment timer when not paused
  timerInterval = setInterval(() => {
    if (!isPaused) {
      recordingSeconds++;
    }
    const timeDisplay = shadow.getElementById('time-display');
    if (timeDisplay) {
      timeDisplay.textContent = formatTime(recordingSeconds);
    }
  }, 1000);
}

function updateRecordingIndicator(status) {
  if (!floatingPanelContainer || !floatingPanelContainer.shadowRoot) return;
  const shadow = floatingPanelContainer.shadowRoot;

  const pauseBtn = shadow.getElementById('btn-pause');
  const resumeBtn = shadow.getElementById('btn-resume');
  const dot = shadow.getElementById('status-dot');

  if (status === 'PAUSED') {
    pauseBtn.style.display = 'none';
    resumeBtn.style.display = 'flex';
    dot.classList.add('paused');
  } else if (status === 'RECORDING') {
    pauseBtn.style.display = 'flex';
    resumeBtn.style.display = 'none';
    dot.classList.remove('paused');
  }
}

function removeRecordingIndicator() {
  if (floatingPanelContainer) {
    floatingPanelContainer.remove();
    floatingPanelContainer = null;
  }
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Content script received message:', message.action);

  switch (message.action) {
    case 'startRecording':
      startRecording(message.sessionId, false, message.session?.createdAt);
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

    case 'beforeScreenshot':
      if (floatingPanelContainer) floatingPanelContainer.style.display = 'none';
      document.querySelectorAll('[id^="testsnapper-"]').forEach(el => {
        el.style.display = 'none';
      });
      sendResponse({ success: true });
      break;

    case 'afterScreenshot':
      if (floatingPanelContainer) floatingPanelContainer.style.display = 'block';
      // Note: we don't automatically restore other bits like modals to avoid logic issues, 
      // but usually the modal is what triggered the capture or it's manual.
      sendResponse({ success: true });
      break;

    default:
      sendResponse({ success: false, error: 'Unknown action' });
  }

  return true;
});

var lastUrl = window.location.href;
setInterval(() => {
  if (isRecording && window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    captureNavigation();
  }
}, 1000);

function formatTime(totalSeconds) {
  const mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const secs = (totalSeconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

console.log('TestSnapper content script loaded');

// Check for active recording on load to restore overlay and state
chrome.runtime.sendMessage({ action: 'getState' }, (response) => {
  if (chrome.runtime.lastError) {
    console.log('Background connection error:', chrome.runtime.lastError);
    return;
  }

  if (response && response.session) {
    console.log('Restoring session state:', response.state, response.session);
    if (response.state === 'recording') {
      startRecording(response.session.sessionId, true, response.session.createdAt);
    } else if (response.state === 'paused') {
      startRecording(response.session.sessionId, true, response.session.createdAt);
      pauseRecording();
    }
  } else {
    console.log('No active session state to restore');
  }
});