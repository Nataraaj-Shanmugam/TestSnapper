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
var fieldNameResolver;
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
var navigationCheckInterval = null;
var autoScreenshotInterval = null;
var sessionSettings = {};

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

// Track elements hidden before screenshot so they can be restored after
var hiddenScreenshotElements = [];

// Initialize modules
function initModules() {
  if (window.SelectorEngine && window.Redactor && window.FieldNameResolver) {
    selectorEngine = new window.SelectorEngine();
    redactor = new window.Redactor();
    fieldNameResolver = new window.FieldNameResolver(selectorEngine);
    console.log('TestSnapper content script initialized');
    return true;
  }
  if (!window.SelectorEngine) console.error('TestSnapper: SelectorEngine not loaded');
  if (!window.Redactor) console.error('TestSnapper: Redactor not loaded');
  if (!window.FieldNameResolver) console.error('TestSnapper: FieldNameResolver not loaded');
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
  // Delegate to the advanced resolver if available
  if (fieldNameResolver) {
    var resolved = fieldNameResolver.resolve(element);
    if (resolved) return resolved;
  }

  // Fallback to legacy detection for backward compatibility
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

  // Extract title attribute or visible text from the element itself
  if (element.title) {
    return cleanFieldName(element.title);
  }

  const visibleText = (element.innerText || '').trim();
  if (visibleText && visibleText.length > 0 && visibleText.length < 60) {
    return cleanFieldName(visibleText.split('\n')[0].trim());
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
  processModalQueue();
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
  if (modalStates.size === 0) isModalOpen = false;
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

    // Detect page theme for modal styling
    var modalTheme = 'light';
    try {
      var bgVal = getComputedStyle(document.body).backgroundColor;
      var rgbMatch = bgVal.match(/\d+/g);
      if (rgbMatch) {
        var rgbNums = rgbMatch.map(Number);
        var lum = (0.299 * rgbNums[0] + 0.587 * rgbNums[1] + 0.114 * rgbNums[2]) / 255;
        modalTheme = lum < 0.5 ? 'dark' : 'light';
      }
    } catch(e) { /* fallback to light */ }

    var isLight = modalTheme === 'light';
    var modalBg = isLight ? '#ffffff' : '#1a1a1f';
    var modalBorder = isLight ? '#dee2e6' : '#2e2e35';
    var modalShadow = isLight ? '0 10px 25px -5px rgba(0,0,0,0.1)' : '0 10px 25px -5px rgba(0,0,0,0.5)';
    var textPrimary = isLight ? '#212529' : '#ececef';
    var textMuted = isLight ? '#868e96' : '#71717a';
    var borderColor = isLight ? '#dee2e6' : '#2e2e35';
    var inputBg = isLight ? '#ffffff' : '#111113';
    var cancelBg = isLight ? 'transparent' : 'transparent';
    var cancelHoverBg = isLight ? '#e9ecef' : '#2e2e35';

    // CREATE MODAL UI
    const overlay = document.createElement('div');
    overlay.id = `testsnapper-modal-overlay-${modalId}`;
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 2147483646;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.15s ease;
    `;

    const modal = document.createElement('div');
    modal.style.cssText = `
      background: ${modalBg};
      border: 1px solid ${modalBorder};
      padding: 24px;
      border-radius: 10px;
      width: min(440px, 90vw);
      box-shadow: ${modalShadow};
      animation: slideUp 0.15s ease;
    `;

    modal.innerHTML = `
      <h3 style="margin: 0 0 8px 0; color: ${textPrimary}; font-size: 16px; font-weight: 600;">
        Enter Field Name
      </h3>
      <p style="color: ${textMuted}; margin: 0 0 20px 0; font-size: 13px; line-height: 1.5;">
        TestSnapper couldn't automatically detect the field name for this <strong>${action}</strong> action.
        Please provide a descriptive name.
      </p>
      <input type="text"
             id="testsnapper-field-input-${modalId}"
             placeholder="e.g., Username, Email Address, Submit Button..."
             style="width: 100%;
                    padding: 8px 12px;
                    border: 1px solid ${borderColor};
                    border-radius: 6px;
                    font-size: 13px;
                    color: ${textPrimary};
                    background: ${inputBg};
                    margin-bottom: 20px;
                    box-sizing: border-box;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
                    transition: border-color 0.15s ease, box-shadow 0.15s ease;
                    outline: none;">
      <div style="display: flex; gap: 8px; justify-content: flex-end;">
        <button id="testsnapper-modal-cancel-${modalId}"
                style="padding: 8px 16px;
                       border: 1px solid ${borderColor};
                       border-radius: 6px;
                       background: ${cancelBg};
                       color: ${textMuted};
                       cursor: pointer;
                       font-size: 13px;
                       font-weight: 500;
                       transition: background 0.15s ease;">
          Skip
        </button>
        <button id="testsnapper-modal-confirm-${modalId}"
                style="padding: 8px 16px;
                       border: none;
                       border-radius: 6px;
                       background: #2563eb;
                       color: white;
                       cursor: pointer;
                       font-size: 13px;
                       font-weight: 500;
                       transition: background 0.15s ease;">
          Confirm
        </button>
      </div>
    `;

    // Add CSS animations
    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slideUp {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
      }
    `;
    overlay.appendChild(style);
    overlay.appendChild(modal);
    isModalOpen = true;
    document.body.appendChild(overlay);
    state.overlay = overlay;

    const input = document.getElementById(`testsnapper-field-input-${modalId}`);
    const cancelBtn = document.getElementById(`testsnapper-modal-cancel-${modalId}`);
    const confirmBtn = document.getElementById(`testsnapper-modal-confirm-${modalId}`);

    // Focus input with focus ring
    setTimeout(() => {
      input.focus();
      input.style.borderColor = '#2563eb';
      input.style.boxShadow = '0 0 0 3px ' + (isLight ? '#eff6ff' : 'rgba(59,130,246,0.1)');
    }, 100);

    input.onfocus = () => {
      input.style.borderColor = '#2563eb';
      input.style.boxShadow = '0 0 0 3px ' + (isLight ? '#eff6ff' : 'rgba(59,130,246,0.1)');
    };
    input.onblur = () => {
      input.style.borderColor = borderColor;
      input.style.boxShadow = 'none';
    };

    // Button hover effects
    confirmBtn.onmouseover = () => { confirmBtn.style.background = '#1d4ed8'; };
    confirmBtn.onmouseout = () => { confirmBtn.style.background = '#2563eb'; };
    cancelBtn.onmouseover = () => { cancelBtn.style.background = cancelHoverBg; };
    cancelBtn.onmouseout = () => { cancelBtn.style.background = cancelBg; };

    // Event handlers
    confirmBtn.onclick = () => {
      const value = input.value.trim();
      closeModalById(modalId, value || null);
    };

    cancelBtn.onclick = () => {
      closeModalById(modalId, null);
    };

    input.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirmBtn.click();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelBtn.click();
      }
    };

    // Auto-close after 30 seconds
    state.timeout = setTimeout(() => {
      console.warn('⚠️ Modal auto-closed after timeout:', modalId);
      closeModalById(modalId, null);
    }, 30000);
  });
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
    isPaused = true;
    updateRecordingIndicator('PAUSED');

    fieldName = await showManualEntryModal(element, action, stepData);

    // 🔧 FIX #2: Only resume if still valid
    if (wasRecording && currentSessionId) {
      // Validate session still exists
      const valid = await validateSession();
      if (valid) {
        isRecording = true;
        isPaused = false;
        updateRecordingIndicator('RECORDING');
      } else {
        console.error('❌ Session invalidated during modal - stopping recording');
        stopRecording();
        return null;
      }
    } else {
      isPaused = false;
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
    border: 2px solid #2563eb;
    background: rgba(37, 99, 235, 0.1);
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

  // CNT-MED-004: Smarter duplicate detection with action-specific time windows
  let timeWindow = 500; // Default 500ms

  // Stricter window for rapid clicks
  if (action === 'click' || action === 'submit') {
    timeWindow = 300; // 300ms for clicks to allow intentional double-clicks
  }
  // More lenient for typing to handle debouncing
  else if (action === 'type' || action === 'select') {
    timeWindow = 800; // 800ms for typing
  }

  if (timeSinceLastAction >= timeWindow) return false;
  if (lastInteraction.action !== action) return false;

  // Match by DOM element reference OR by selector fingerprint
  // (frameworks like Salesforce Aura, React re-render and replace DOM nodes)
  var sameElement = (lastInteraction.element === element) ||
    (lastInteraction.selectorKey && lastInteraction.selectorKey === _getElementFingerprint(element));

  if (sameElement) {
    // Allow if value changed (important for typing)
    if ((action === 'type' || action === 'select') && value !== lastInteraction.value) {
      return false;
    }
    return true;
  }

  return false;
}

/**
 * Generate a lightweight fingerprint for an element using its tag, key attributes,
 * and text. Used to detect duplicates even when the DOM node is re-created by a framework.
 */
function _getElementFingerprint(element) {
  var tag = element.tagName;
  var id = element.id || '';
  var name = element.name || '';
  var type = element.type || '';
  var cls = (element.className && typeof element.className === 'string')
    ? element.className.split(/\s+/).sort().join('.') : '';
  var text = (element.innerText || '').trim().substring(0, 30);
  return tag + '|' + id + '|' + name + '|' + type + '|' + cls + '|' + text;
}

function updateLastInteraction(element, action, value = null) {
  lastInteraction = {
    element: element,
    selectorKey: _getElementFingerprint(element),
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
  showToastNotification(message, 'error');
}

/**
 * CNT-MED-003: Show toast notification - theme-aware with left border accent
 * @param {string} message
 * @param {string} type - 'info' | 'success' | 'warning' | 'error'
 */
function showToastNotification(message, type = 'info') {
  // Remove any existing notification
  const existing = document.getElementById('testsnapper-toast');
  if (existing) existing.remove();

  // Detect page theme
  var toastTheme = 'light';
  try {
    var bgStr = getComputedStyle(document.body).backgroundColor;
    var rgbArr = bgStr.match(/\d+/g);
    if (rgbArr) {
      var rgbN = rgbArr.map(Number);
      var lv = (0.299 * rgbN[0] + 0.587 * rgbN[1] + 0.114 * rgbN[2]) / 255;
      toastTheme = lv < 0.5 ? 'dark' : 'light';
    }
  } catch(e) { /* fallback to light */ }

  // Map legacy color params to types
  if (type.startsWith('#')) {
    if (type === '#ff4444' || type === '#FF4444') type = 'error';
    else if (type === '#FFA500') type = 'warning';
    else if (type === '#4CAF50' || type === '#333') type = 'info';
    else type = 'info';
  }

  var accentColors = { info: '#2563eb', success: '#16a34a', warning: '#d97706', error: '#dc2626' };
  var accentColor = accentColors[type] || accentColors.info;
  var isLt = toastTheme === 'light';

  const notification = document.createElement('div');
  notification.id = 'testsnapper-toast';
  notification.style.cssText = `
    position: fixed;
    bottom: 16px;
    right: 16px;
    background: ${isLt ? '#ffffff' : '#1a1a1f'};
    color: ${isLt ? '#495057' : '#a1a1aa'};
    border: 1px solid ${isLt ? '#dee2e6' : '#2e2e35'};
    border-left: 3px solid ${accentColor};
    padding: 12px 16px;
    border-radius: 8px;
    z-index: 2147483646;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    font-size: 13px;
    font-weight: 500;
    box-shadow: ${isLt ? '0 4px 12px rgba(0,0,0,0.08)' : '0 4px 12px rgba(0,0,0,0.4)'};
    animation: slideInRight 0.2s ease;
    max-width: 360px;
  `;
  notification.textContent = message;

  // Add animation keyframe
  var toastStyle = document.createElement('style');
  toastStyle.textContent = `
    @keyframes slideInRight {
      from { opacity: 0; transform: translateX(16px); }
      to { opacity: 1; transform: translateX(0); }
    }
  `;
  notification.appendChild(toastStyle);
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transition = 'opacity 0.2s ease';
    setTimeout(() => notification.remove(), 200);
  }, 3000);
}

/**
 * CNT-MED-003: Show rate limit feedback
 */
function showRateLimitFeedback() {
  showToastNotification('Screenshot rate limited - please wait a moment', 'warning');
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
    console.error('❌ Error capturing input:', error);
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
    }

    const isSensitive = action === 'type' ? redactor.shouldIgnoreField(element) : false;
    if (action === 'type') {
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
      isSensitive: isSensitive
    };

    stepData = await processStepWithManualEntry(element, action, stepData);
    if (!stepData) return;

    updateLastInteraction(element, action, value);
    sendStepToBackground(stepData);
    console.log('Change captured:', stepData.fieldName, value);
  } catch (error) {
    console.error('❌ Error capturing input:', error);
    // Don't stop recording, just log and continue
  }
}

async function handleSubmit(event) {
  if (!isRecording || !selectorEngine || isModalOpen) return;

  try {
    const form = event.target;

    if (isDuplicateInteraction(form, 'submit')) {
      console.log('Skipping duplicate submit');
      return;
    }

    const selector = selectorEngine.generateSelector(form);
    const fieldName = selectorEngine.extractFieldName(form) || 'Form';

    let stepData = {
      action: 'submit',
      selector: selector,
      fieldName: fieldName,
      targetLabel: 'Submit Form',
      url: window.location.href,
      value: null,
      isSensitive: false
    };

    stepData = await processStepWithManualEntry(form, 'submit', stepData);
    if (!stepData) return;

    updateLastInteraction(form, 'submit');
    sendStepToBackground(stepData);
    console.log('Submit captured:', stepData.fieldName);
  } catch (error) {
    console.error('❌ Error capturing submit:', error);
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

  // Capture screenshot before navigation if the setting is enabled
  if (sessionSettings.captureOnNavigation !== false) {
    chrome.runtime.sendMessage({ action: 'captureScreenshot', sessionId: currentSessionId });
  }

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

function startAutoScreenshotInterval() {
  if (autoScreenshotInterval) clearInterval(autoScreenshotInterval);
  if (!sessionSettings.autoScreenshot) return;
  const seconds = Math.max(1, Math.min(60, sessionSettings.screenshotSeconds || 5));
  autoScreenshotInterval = setInterval(() => {
    if (isRecording && !isPaused) {
      chrome.runtime.sendMessage({ action: 'captureScreenshot', sessionId: currentSessionId, isManual: false });
    }
  }, seconds * 1000);
}

function startRecording(sessionId, isRestoring = false, startTimeStr = null, settings = {}) {
  if (isRecording) return;

  isRecording = true;
  isPaused = false;
  currentSessionId = sessionId;
  sessionSettings = settings;

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

  // Pre-fetch iframe label context for cross-frame detection
  if (fieldNameResolver) {
    fieldNameResolver.clearCache();
    fieldNameResolver.initFrameContext();
  }

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

  // 🔧 FIX #7: Start session validation heartbeat (reduced frequency)
  sessionValidationInterval = setInterval(async () => {
    const valid = await validateSession();
    if (!valid) {
      console.error('❌ Session validation failed - stopping recording');
      stopRecording();
    }
  }, 15000); // Reduced from 5s to 15s to improve performance

  if (isRestoring) {
    captureNavigation();
  }

  // Start navigation monitoring
  if (!navigationCheckInterval) {
    lastNavigationUrl = window.location.href;
    navigationCheckInterval = setInterval(() => {
      if (isRecording && window.location.href !== lastNavigationUrl) {
        lastNavigationUrl = window.location.href;
        captureNavigation();
      }
    }, 1000);
  }

  // Start auto-screenshot interval if enabled
  startAutoScreenshotInterval();

  console.log('Content script: Recording started');
}

function pauseRecording() {
  if (!isRecording) return;
  isRecording = false;
  isPaused = true;
  if (autoScreenshotInterval) {
    clearInterval(autoScreenshotInterval);
    autoScreenshotInterval = null;
  }
  updateRecordingIndicator('PAUSED');
  console.log('Content script: Recording paused');
}

function resumeRecording() {
  if (isRecording) return;
  isRecording = true;
  isPaused = false;
  startAutoScreenshotInterval();
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

  // 🔧 FIX #2: Force close all open modals
  for (const [id] of modalStates) {
    closeModalById(id, null);
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

  // 🔧 FIX: CNT-HIGH-001 - Clear navigation interval
  if (navigationCheckInterval) {
    clearInterval(navigationCheckInterval);
    navigationCheckInterval = null;
  }

  // Clear auto-screenshot interval
  if (autoScreenshotInterval) {
    clearInterval(autoScreenshotInterval);
    autoScreenshotInterval = null;
  }
  sessionSettings = {};

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

  // Detect page theme for panel styling
  var panelTheme = 'dark';
  try {
    var bg = getComputedStyle(document.body).backgroundColor;
    var rgb = bg.match(/\d+/g);
    if (rgb) {
      var nums = rgb.map(Number);
      var luminance = (0.299 * nums[0] + 0.587 * nums[1] + 0.114 * nums[2]) / 255;
      panelTheme = luminance < 0.5 ? 'dark' : 'light';
    }
  } catch(e) { /* fallback to dark */ }

  const style = document.createElement('style');
  style.textContent = `
    :host {
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    }
    .panel {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-radius: 8px;
      cursor: grab;
      user-select: none;
      transition: transform 0.1s;
    }
    .panel.theme-light {
      background: #ffffff;
      border: 1px solid #dee2e6;
      box-shadow: 0 4px 12px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.06);
    }
    .panel.theme-dark {
      background: #1a1a1f;
      border: 1px solid #2e2e35;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    }
    .panel:active {
      cursor: grabbing;
    }
    .status-container {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .status-dot {
      width: 6px;
      height: 6px;
      background: #dc2626;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    .status-dot.paused {
      background: #d97706;
      animation: none;
    }
    .time-display {
      font-variant-numeric: tabular-nums;
      font-size: 12px;
      font-weight: 500;
      min-width: 35px;
    }
    .theme-light .time-display { color: #495057; }
    .theme-dark .time-display { color: #a1a1aa; }
    .divider {
      width: 1px;
      height: 14px;
    }
    .theme-light .divider { background: #dee2e6; }
    .theme-dark .divider { background: #2e2e35; }
    .controls {
      display: flex;
      gap: 4px;
    }
    .btn {
      background: transparent;
      border: none;
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .theme-light .btn { color: #868e96; }
    .theme-dark .btn { color: #71717a; }
    .theme-light .btn:hover { background: #e9ecef; }
    .theme-dark .btn:hover { background: #2e2e35; }
    .btn:hover.stop { color: #dc2626; }
    .btn:hover.pause { color: #d97706; }
    .btn:hover.resume { color: #16a34a; }
    .btn:hover.screenshot { color: #2563eb; }
    .btn svg {
      width: 16px;
      height: 16px;
      fill: currentColor;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
  `;

  const panel = document.createElement('div');
  panel.className = 'panel theme-' + panelTheme;

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

    let x = e.clientX - initialX;
    let y = e.clientY - initialY;

    // Boundary checks to prevent dragging off-screen
    const rect = panelContainer.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width;
    const maxY = window.innerHeight - rect.height;

    x = Math.max(0, Math.min(x, maxX));
    y = Math.max(0, Math.min(y, maxY));

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
      startRecording(message.sessionId, false, message.session?.createdAt, message.settings || {});
      sendResponse({ success: true });
      break;

    // BUG-004 FIX: Handle session restore after service worker restart
    case 'restoreRecording':
      startRecording(message.sessionId, true, message.session?.createdAt, message.settings || {});
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
      hiddenScreenshotElements = [];
      document.querySelectorAll('[id^="testsnapper-"]').forEach(el => {
        el.style.display = 'none';
        hiddenScreenshotElements.push(el);
      });
      sendResponse({ success: true });
      break;

    case 'afterScreenshot':
      hiddenScreenshotElements.forEach(el => { el.style.display = ''; });
      hiddenScreenshotElements = [];
      sendResponse({ success: true });
      break;

    // CNT-MED-003: Visual feedback when rate limited
    case 'screenshotRateLimited':
      showRateLimitFeedback();
      sendResponse({ success: true });
      break;

    // Cross-frame label resolution: find aria-label/title of an iframe element
    case 'getIframeLabel': {
      let iframeLabel = null;
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        try {
          if (iframe.src === message.frameUrl) {
            iframeLabel = iframe.getAttribute('aria-label') || iframe.title || iframe.name || null;
            break;
          }
        } catch (e) { /* skip */ }
      }
      sendResponse({ label: iframeLabel });
      break;
    }

    default:
      sendResponse({ success: false, error: 'Unknown action' });
  }

  return true;
});

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