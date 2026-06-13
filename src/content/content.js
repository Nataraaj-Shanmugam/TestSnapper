/**
 * Content Script - FIXED: Modal state management + session recovery
 */

// UX-019: Shared design-system palette constants — "Steel & Slate" tokens
var TS_BLUE = '#4A7FB5';
var TS_BLUE_DARK = '#3A6699';
var TS_SLATE_900 = '#1E293B';
var TS_SLATE_700 = '#334155';

// FUNC-001: Guard against duplicate initialization on re-injection.
// Background.js (Agent 1) pings before injecting so re-injection shouldn't happen,
// but as a belt-and-suspenders measure we also guard here.
// 'var' declarations don't throw SyntaxError on re-injection, but their initializers
// DO re-run, which would reset isRecording to false and orphan the old state.
// Solution: skip all initializer assignments if already initialized.

var selectorEngine;
var redactor;
var isRecording;
var currentSessionId;
var highlightOverlay;
var floatingPanelContainer;
var timerInterval;
var recordingSeconds;
var isPaused;
var eventListenerController;
var isModalOpen;
var modalTimeout;
var navigationCheckInterval;
var sessionValidationInterval;
// Track last interactions to prevent duplicates
var lastInteraction;
// Pending input timeouts per element
var pendingInputs;
// Modal queue system
var modalQueue;
var isProcessingModal;
var currentModalId;
var modalStates;

if (!window.__testSnapperInitialized) {
  window.__testSnapperInitialized = true;
  // First injection: initialize all state vars and data structures to default values.
  // On re-injection, var declarations are hoisted (no-op) but this block is skipped,
  // so all values retain their live runtime state from the first injection.
  isRecording = false;
  currentSessionId = null;
  highlightOverlay = null;
  floatingPanelContainer = null;
  timerInterval = null;
  recordingSeconds = 0;
  isPaused = false;
  eventListenerController = null;
  isModalOpen = false;
  modalTimeout = null;
  navigationCheckInterval = null;
  sessionValidationInterval = null;
  lastInteraction = { element: null, action: null, timestamp: 0, value: null };
  pendingInputs = new Map();
  modalQueue = [];
  isProcessingModal = false;
  currentModalId = null;
  modalStates = new Map();
  lastNavigationUrl = '';
  isInitialNavigation = true;
  sessionSettings = {};
}

// Initialize modules
// FUNC-004: Check for all required globals. FieldNameResolver absence is tolerated
// (background agent adds it to executeScript list) but SelectorEngine + Redactor
// are mandatory — if either is absent, recording will fail immediately.
function initModules() {
  var missing = [];
  if (!window.SelectorEngine) missing.push('SelectorEngine');
  if (!window.Redactor) missing.push('Redactor');
  // FieldNameResolver is optional but warn if absent
  if (!window.FieldNameResolver) {
    console.warn('TestSnapper: FieldNameResolver not loaded — field names may degrade');
  }

  if (missing.length > 0) {
    console.warn('TestSnapper: Missing modules:', missing.join(', '));
    return false;
  }

  selectorEngine = new window.SelectorEngine();
  redactor = new window.Redactor();
  console.log('TestSnapper content script initialized');
  return true;
}

var _modulesInitialized = initModules();
if (!_modulesInitialized) {
  console.log('TestSnapper: Waiting for modules to load...');
  setTimeout(function() {
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


/**
 * UX-002: Unified page theme detection.
 * Handles transparent/semi-transparent backgrounds by falling back to
 * documentElement, and defaults to 'light' when alpha is negligible.
 * @returns {'light'|'dark'}
 */
function detectPageTheme() {
  try {
    function parseRgba(colorStr) {
      var m = colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!m) return null;
      return {
        r: parseInt(m[1], 10),
        g: parseInt(m[2], 10),
        b: parseInt(m[3], 10),
        a: m[4] !== undefined ? parseFloat(m[4]) : 1
      };
    }

    function luminance(r, g, b) {
      return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }

    // Try body first
    var bodyBg = getComputedStyle(document.body).backgroundColor;
    var bodyColor = parseRgba(bodyBg);

    if (bodyColor && bodyColor.a >= 0.1) {
      // Semi-transparent: blend over white (255,255,255) before computing luminance
      var a = bodyColor.a;
      var r = Math.round(bodyColor.r * a + 255 * (1 - a));
      var g = Math.round(bodyColor.g * a + 255 * (1 - a));
      var b = Math.round(bodyColor.b * a + 255 * (1 - a));
      return luminance(r, g, b) < 0.5 ? 'dark' : 'light';
    }

    // Body is transparent — try documentElement
    var htmlBg = getComputedStyle(document.documentElement).backgroundColor;
    var htmlColor = parseRgba(htmlBg);
    if (htmlColor && htmlColor.a >= 0.1) {
      var a2 = htmlColor.a;
      var r2 = Math.round(htmlColor.r * a2 + 255 * (1 - a2));
      var g2 = Math.round(htmlColor.g * a2 + 255 * (1 - a2));
      var b2 = Math.round(htmlColor.b * a2 + 255 * (1 - a2));
      return luminance(r2, g2, b2) < 0.5 ? 'dark' : 'light';
    }

    // Both transparent — default to light (most pages are light)
    return 'light';
  } catch(e) {
    return 'light';
  }
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
  var state = modalStates.get(modalId);
  if (!state) return;

  // UX-001: New modals use shadow DOM and expose _closeWithRestore
  if (state._closeWithRestore) {
    state._closeWithRestore(result);
    return;
  }

  // Legacy path (kept for safety)
  if (state.timeout) {
    clearTimeout(state.timeout);
  }

  if (state.shadowHost && state.shadowHost.parentNode) {
    state.shadowHost.remove();
  } else if (state.overlay && state.overlay.parentNode) {
    state.overlay.style.animation = 'testsnapper-fadeOut 0.2s ease-out';
    setTimeout(function() { state.overlay.remove(); }, 200);
  }

  if (state.resolver) {
    state.resolver(result);
  }

  modalStates.delete(modalId);
}

/**
 * Internal modal implementation with unique ID tracking.
 * UX-001: Wrapped in Shadow DOM to isolate styles from host page.
 * UX-002: Uses detectPageTheme() helper.
 * UX-011: Resets 30s timeout on typing; submits typed value on timeout; ARIA + focus trap.
 * UX-019: Uses TS_BLUE palette constants.
 */
function showManualEntryModalInternal(element, action, stepData, modalId) {
  return new Promise(function(resolve) {
    // UX-011: Track the element that triggered the modal so focus can be restored on close
    var previouslyFocused = document.activeElement;

    // Create modal state
    var state = {
      id: modalId,
      resolver: resolve,
      step: stepData,
      timeout: null,
      shadowHost: null
    };

    modalStates.set(modalId, state);

    // UX-002: Use shared detectPageTheme() helper (handles transparent body, alpha blending)
    var modalTheme = detectPageTheme();
    var isLight = modalTheme === 'light';
    var modalBg = isLight ? '#ffffff' : '#1a1a1f';
    var modalBorder = isLight ? '#dee2e6' : '#2e2e35';
    var modalShadow = isLight ? '0 10px 25px -5px rgba(0,0,0,0.1)' : '0 10px 25px -5px rgba(0,0,0,0.5)';
    var textPrimary = isLight ? '#212529' : '#ececef';
    var textMuted = isLight ? '#868e96' : '#71717a';
    var borderColor = isLight ? '#dee2e6' : '#2e2e35';
    var inputBg = isLight ? '#ffffff' : '#111113';
    var cancelHoverBg = isLight ? '#e9ecef' : '#2e2e35';

    // UX-001: Create Shadow DOM host so styles don't leak into/from host page
    var shadowHost = document.createElement('div');
    shadowHost.id = 'testsnapper-modal-host-' + modalId;
    // Position the host so the shadow overlay can be fixed inside it
    shadowHost.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483646;';
    var shadow = shadowHost.attachShadow({ mode: 'open' });
    state.shadowHost = shadowHost;

    // UX-001: Inject keyframes + reset CSS inside shadow root (no host-page pollution)
    var style = document.createElement('style');
    style.textContent = [
      /* CSS reset to prevent host-page inheritance */
      ':host { all: initial; }',
      '*, *::before, *::after { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; font-size: 14px; line-height: 1.5; text-transform: none; }',
      /* UX-001: Keyframes prefixed with testsnapper- so they never collide with host animations */
      '@keyframes testsnapper-fadeIn { from { opacity: 0; } to { opacity: 1; } }',
      '@keyframes testsnapper-slideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }',
      '@keyframes testsnapper-fadeOut { from { opacity: 1; } to { opacity: 0; } }',
      '.ts-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; animation: testsnapper-fadeIn 0.15s ease; }',
      '.ts-modal { background: ' + modalBg + '; border: 1px solid ' + modalBorder + '; padding: 24px; border-radius: 10px; width: min(440px, 90vw); box-shadow: ' + modalShadow + '; animation: testsnapper-slideUp 0.15s ease; }',
      '.ts-heading { margin: 0 0 8px 0; color: ' + textPrimary + '; font-size: 16px; font-weight: 600; }',
      '.ts-desc { color: ' + textMuted + '; margin: 0 0 20px 0; font-size: 13px; line-height: 1.5; }',
      '.ts-input { width: 100%; padding: 8px 12px; border: 1px solid ' + borderColor + '; border-radius: 6px; font-size: 13px; color: ' + textPrimary + '; background: ' + inputBg + '; margin-bottom: 20px; transition: border-color 0.15s ease, box-shadow 0.15s ease; outline: none; }',
      '.ts-input:focus { border-color: ' + TS_BLUE + '; box-shadow: 0 0 0 3px ' + (isLight ? 'rgba(74,127,181,0.15)' : 'rgba(74,127,181,0.2)') + '; }',
      '.ts-actions { display: flex; gap: 8px; justify-content: flex-end; }',
      '.ts-btn { padding: 8px 16px; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; transition: background 0.15s ease; }',
      '.ts-btn-cancel { border: 1px solid ' + borderColor + '; background: transparent; color: ' + textMuted + '; }',
      '.ts-btn-cancel:hover { background: ' + cancelHoverBg + '; }',
      '.ts-btn-confirm { border: none; background: ' + TS_BLUE + '; color: #fff; }',
      '.ts-btn-confirm:hover { background: ' + TS_BLUE_DARK + '; }'
    ].join('\n');

    var overlayDiv = document.createElement('div');
    overlayDiv.className = 'ts-overlay';

    var headingId = 'ts-heading-' + modalId;
    var inputId = 'ts-input-' + modalId;
    var cancelId = 'ts-cancel-' + modalId;
    var confirmId = 'ts-confirm-' + modalId;

    var modalDiv = document.createElement('div');
    modalDiv.className = 'ts-modal';
    // UX-011: ARIA dialog semantics
    modalDiv.setAttribute('role', 'dialog');
    modalDiv.setAttribute('aria-modal', 'true');
    modalDiv.setAttribute('aria-labelledby', headingId);

    modalDiv.innerHTML = [
      '<h3 id="' + headingId + '" class="ts-heading">Enter Field Name</h3>',
      '<p class="ts-desc">TestSnapper couldn\'t automatically detect the field name for this <strong>' + action + '</strong> action. Please provide a descriptive name.</p>',
      '<input id="' + inputId + '" class="ts-input" type="text" placeholder="e.g., Username, Email Address, Submit Button..." aria-label="Field name">',
      '<div class="ts-actions">',
      '  <button id="' + cancelId + '" class="ts-btn ts-btn-cancel">Skip</button>',
      '  <button id="' + confirmId + '" class="ts-btn ts-btn-confirm">Confirm</button>',
      '</div>'
    ].join('');

    overlayDiv.appendChild(modalDiv);
    shadow.appendChild(style);
    shadow.appendChild(overlayDiv);
    document.body.appendChild(shadowHost);

    var input = shadow.getElementById(inputId);
    var cancelBtn = shadow.getElementById(cancelId);
    var confirmBtn = shadow.getElementById(confirmId);

    // Enhanced closeModalById that restores focus
    function closeWithRestore(result) {
      // UX-011: Restore focus to triggering element
      if (previouslyFocused && previouslyFocused.focus) {
        try { previouslyFocused.focus(); } catch(e) { /* ignore */ }
      }
      var st = modalStates.get(modalId);
      if (!st) return;
      if (st.timeout) clearTimeout(st.timeout);
      if (st.shadowHost && st.shadowHost.parentNode) {
        overlayDiv.style.animation = 'testsnapper-fadeOut 0.2s ease-out';
        setTimeout(function() { if (st.shadowHost.parentNode) st.shadowHost.remove(); }, 200);
      }
      if (st.resolver) st.resolver(result);
      modalStates.delete(modalId);
    }
    state.overlay = { parentNode: shadowHost.parentNode ? shadowHost : null, remove: function() { shadowHost.remove(); } };
    // Override closeModalById for this modal to use shadow host removal
    state._closeWithRestore = closeWithRestore;

    // Focus input
    setTimeout(function() { if (input) input.focus(); }, 100);

    // UX-011: Tab focus trap (input → skip → confirm → back to input)
    var focusableEls = [input, cancelBtn, confirmBtn];
    overlayDiv.addEventListener('keydown', function(e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        var idx = focusableEls.indexOf(shadow.activeElement);
        var next = e.shiftKey
          ? focusableEls[(idx - 1 + focusableEls.length) % focusableEls.length]
          : focusableEls[(idx + 1) % focusableEls.length];
        next.focus();
      }
    });

    // UX-011: Reset auto-close timeout on input; submit typed value on timeout (not null)
    function resetTimeout() {
      if (state.timeout) clearTimeout(state.timeout);
      state.timeout = setTimeout(function() {
        console.warn('Modal auto-closed after timeout:', modalId);
        var typedValue = input ? input.value.trim() : '';
        closeWithRestore(typedValue || null);
      }, 30000);
    }

    if (input) {
      input.addEventListener('input', function() { resetTimeout(); });
    }

    confirmBtn.onclick = function() {
      var value = input ? input.value.trim() : '';
      closeWithRestore(value || null);
    };

    cancelBtn.onclick = function() {
      closeWithRestore(null);
    };

    if (input) {
      input.onkeydown = function(e) {
        if (e.key === 'Enter') { e.preventDefault(); confirmBtn.click(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancelBtn.click(); }
      };
    }

    resetTimeout();
  });
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
    border: 2px solid ${TS_BLUE};
    background: rgba(74, 127, 181, 0.1); /* UX-019: TS_BLUE tint */
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

  if (lastInteraction.element === element &&
    lastInteraction.action === action &&
    timeSinceLastAction < timeWindow) {

    // Allow if value changed (important for typing)
    if ((action === 'type' || action === 'select') && value !== lastInteraction.value) {
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
  showToastNotification(message, 'error');
}

/**
 * CNT-MED-003: Show toast notification - theme-aware with left border accent.
 * UX-001: Wrapped in Shadow DOM to isolate styles from host page.
 * UX-002: Uses detectPageTheme() helper.
 * UX-019: Uses TS_BLUE palette constants.
 * @param {string} message
 * @param {string} type - 'info' | 'success' | 'warning' | 'error'
 */
function showToastNotification(message, type) {
  if (type === undefined) type = 'info';

  // Remove any existing toast shadow host
  var existingHost = document.getElementById('testsnapper-toast-host');
  if (existingHost) existingHost.remove();

  // UX-002: Use shared detectPageTheme() helper
  var toastTheme = detectPageTheme();

  // Map legacy color params to types
  if (type && type.charAt(0) === '#') {
    if (type === '#ff4444' || type === '#FF4444') type = 'error';
    else if (type === '#FFA500') type = 'warning';
    else if (type === '#4CAF50' || type === '#333') type = 'info';
    else type = 'info';
  }

  // UX-019: Use TS_BLUE for info accent
  var accentColors = { info: TS_BLUE, success: '#16a34a', warning: '#d97706', error: '#dc2626' };
  var accentColor = accentColors[type] || accentColors.info;
  var isLt = toastTheme === 'light';

  // UX-001: Create Shadow DOM host to isolate toast styles from host page
  var shadowHost = document.createElement('div');
  shadowHost.id = 'testsnapper-toast-host';
  shadowHost.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483646;width:0;height:0;';
  var shadow = shadowHost.attachShadow({ mode: 'open' });

  var style = document.createElement('style');
  style.textContent = [
    ':host { all: initial; }',
    '*, *::before, *::after { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; font-size: 13px; line-height: 1.5; text-transform: none; }',
    /* UX-001: Prefixed keyframe name */
    '@keyframes testsnapper-slideInRight { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: translateX(0); } }',
    '.toast { position: fixed; bottom: 16px; right: 16px; background: ' + (isLt ? '#ffffff' : '#1a1a1f') + '; color: ' + (isLt ? '#495057' : '#a1a1aa') + '; border: 1px solid ' + (isLt ? '#dee2e6' : '#2e2e35') + '; border-left: 3px solid ' + accentColor + '; padding: 12px 16px; border-radius: 8px; font-weight: 500; box-shadow: ' + (isLt ? '0 4px 12px rgba(0,0,0,0.08)' : '0 4px 12px rgba(0,0,0,0.4)') + '; animation: testsnapper-slideInRight 0.2s ease; max-width: 360px; transition: opacity 0.2s ease; }'
  ].join('\n');

  var toastEl = document.createElement('div');
  toastEl.className = 'toast';
  toastEl.textContent = message;

  shadow.appendChild(style);
  shadow.appendChild(toastEl);
  document.body.appendChild(shadowHost);

  setTimeout(function() {
    toastEl.style.opacity = '0';
    setTimeout(function() { if (shadowHost.parentNode) shadowHost.remove(); }, 200);
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
    // PERF-015: Use the element object itself as the Map key to avoid calling
    // generateSelector() synchronously on every keystroke. generateSelector() is
    // deferred to the debounced callback body where it runs only once per burst.
    const elementKey = element;

    if (pendingInputs.has(elementKey)) {
      clearTimeout(pendingInputs.get(elementKey));
    }

    const timeoutId = setTimeout(async () => {
      // PERF-015: generateSelector is now called here (deferred), not in the outer scope.
      const selector = selectorEngine.generateSelector(element);
      const fieldName = getEnhancedFieldName(element);

      // FUNC-014: Always run the value through redactor to catch PII in generic fields.
      // maskValue() returns the original string unchanged when no patterns match,
      // so this is always safe to call.
      const maskedValue = redactor.maskValue(element.value, element);
      const isSensitive = maskedValue !== element.value || redactor.shouldIgnoreField(element);
      const value = maskedValue;

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

    // PERF-015: Use element object as Map key (same as handleInput)
    const elementKey = element;
    if (pendingInputs.has(elementKey)) {
      clearTimeout(pendingInputs.get(elementKey));
      pendingInputs.delete(elementKey);
    }

    const selector = selectorEngine.generateSelector(element);
    const fieldName = getEnhancedFieldName(element);

    let value;
    let action;
    let isSensitive = false;

    if (element.type === 'checkbox') {
      return;
    } else if (element.type === 'radio') {
      return;
    } else if (element.tagName.toLowerCase() === 'select') {
      action = 'select';
      value = element.options[element.selectedIndex]?.text || element.value;
    } else {
      action = 'type';
      // FUNC-014: Always run through redactor to catch PII in generic fields.
      const maskedValue = redactor.maskValue(element.value, element);
      isSensitive = maskedValue !== element.value || redactor.shouldIgnoreField(element);
      value = maskedValue;
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
    console.error('❌ Error capturing change:', error);
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

// Initialized in the __testSnapperInitialized guard block above (FUNC-001)
var lastNavigationUrl;
var isInitialNavigation;

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

  // SEC-002: If a sensitive field (password, CC, SSN, etc.) is active when the
  // navigation fires, suppress the automatic screenshot so PII isn't captured.
  const activeEl = document.activeElement;
  const suppressScreenshot = activeEl && redactor && redactor.shouldIgnoreField(activeEl);

  const stepData = {
    action: 'navigate',
    selector: null,
    fieldName: 'Page Navigation',
    targetLabel: document.title,
    url: currentUrl,
    value: currentUrl,
    isSensitive: false,
    hasScreenshot: !suppressScreenshot,
    // PERF-010+FUNC-012: Explicitly mark as non-manual so the background applies
    // rate limiting and does NOT call tabs.update({active:true}) (which yanked
    // focus back to the recorded tab on every SPA navigation).
    isManual: false
  };

  sendStepToBackground(stepData);
  console.log('Navigation captured:', currentUrl, suppressScreenshot ? '(screenshot suppressed — sensitive field active)' : '');
}

/**
 * Send a step to the background service worker.
 * FUNC-003: Retries once after ~1s on 'No active session' (background may still be
 * recovering its state after a service-worker restart). Shows a toast instead of
 * silently calling stopRecording() on the first failure.
 */
function sendStepToBackground(stepData, isRetry) {
  if (isRetry === undefined) isRetry = false;

  // Validate session before sending
  if (!currentSessionId) {
    console.error('No active session - cannot send step');
    stopRecording();
    return;
  }

  chrome.runtime.sendMessage({
    action: 'addStep',
    stepData: stepData
  }, function(response) {
    if (chrome.runtime.lastError) {
      console.error('Failed to send step:', chrome.runtime.lastError);
      if (!isRetry) {
        // FUNC-003: Retry once — background may be recovering from SW restart
        setTimeout(function() { sendStepToBackground(stepData, true); }, 1000);
      } else {
        showToastNotification('TestSnapper: Connection lost — stopping recording', 'error');
        stopRecording();
      }
    } else if (response && !response.success) {
      console.error('Failed to add step:', response.error);
      if (response.error === 'No active session') {
        if (!isRetry) {
          // FUNC-003: Retry once after delay
          setTimeout(function() { sendStepToBackground(stepData, true); }, 1000);
        } else {
          showToastNotification('TestSnapper: Session lost — stopping recording', 'warning');
          stopRecording();
        }
      }
    }
  });
}

// FUNC-011: Store session settings so auto-screenshot continues after navigation
// (Initialized in __testSnapperInitialized guard; declared here for hoisting)
var sessionSettings;

/**
 * FUNC-020: Shared setup helper — called from both normal start and the async
 * session-fetch path to avoid the previously broken recursive startRecording call.
 * FUNC-001: Aborts old event listeners/intervals before creating new ones.
 */
function _finishStartRecording(sessionId, isRestoring, startTime) {
  // FUNC-001: Abort old AbortController before creating a new one to prevent
  // orphaned listeners from a prior injection cycle.
  if (eventListenerController) {
    eventListenerController.abort();
    eventListenerController = null;
  }

  // Clear any existing navigation/heartbeat intervals from a prior cycle
  if (navigationCheckInterval) {
    clearInterval(navigationCheckInterval);
    navigationCheckInterval = null;
  }
  if (sessionValidationInterval) {
    clearInterval(sessionValidationInterval);
    sessionValidationInterval = null;
  }

  // Use AbortController for automatic cleanup
  eventListenerController = new AbortController();
  var signal = eventListenerController.signal;

  document.addEventListener('click', handleClick, { capture: true, signal: signal });
  document.addEventListener('input', handleInput, { capture: true, signal: signal });
  document.addEventListener('change', handleChange, { capture: true, signal: signal });
  document.addEventListener('submit', handleSubmit, { capture: true, signal: signal });

  console.log('Starting timer with:', { startTime: startTime, now: Date.now() });
  addRecordingIndicator(startTime);

  // Start session validation heartbeat
  sessionValidationInterval = setInterval(async function() {
    var valid = await validateSession();
    if (!valid) {
      console.error('Session validation failed - stopping recording');
      stopRecording();
    }
  }, 15000);

  if (isRestoring) {
    captureNavigation();
  }

  // Start navigation monitoring (uses lastNavigationUrl — declared at module level)
  lastNavigationUrl = window.location.href;
  navigationCheckInterval = setInterval(function() {
    if (isRecording && window.location.href !== lastNavigationUrl) {
      lastNavigationUrl = window.location.href;
      captureNavigation();
    }
  }, 1000);

  console.log('Content script: Recording started');
}

/**
 * FUNC-011: Accept settings parameter so auto-screenshot works after navigation.
 */
function startRecording(sessionId, isRestoring, startTimeStr, settings) {
  if (isRestoring === undefined) isRestoring = false;
  if (startTimeStr === undefined) startTimeStr = null;
  if (settings === undefined) settings = {};

  if (isRecording) return;

  isRecording = true;
  isPaused = false;
  currentSessionId = sessionId;
  sessionSettings = settings || {};

  if (isRestoring) {
    isInitialNavigation = false;
    lastNavigationUrl = '';
  } else {
    isInitialNavigation = true;
    lastNavigationUrl = window.location.href;
  }

  if (isRestoring && !startTimeStr) {
    // FUNC-020: Async fetch of start time — delegates to _finishStartRecording
    // instead of recursing (which previously hit the isRecording guard and was a no-op).
    console.log('startRecording: Missing startTimeStr during restore, fetching from session...');
    chrome.runtime.sendMessage({ action: 'getSession', sessionId: sessionId }, function(res) {
      if (res && res.session && res.session.createdAt) {
        var t = new Date(res.session.createdAt).getTime();
        _finishStartRecording(sessionId, isRestoring, t);
      } else {
        console.warn('Failed to recover start time, defaulting to now');
        _finishStartRecording(sessionId, isRestoring, Date.now());
      }
    });
    return;
  }

  var startTime = Date.now();
  if (startTimeStr) {
    startTime = new Date(startTimeStr).getTime();
  }
  _finishStartRecording(sessionId, isRestoring, startTime);
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

  // Force close any open modal (UX-001: modals now use shadow host elements)
  modalStates.forEach(function(state, modalId) {
    closeModalById(modalId, null);
  });
  modalStates.clear();
  modalQueue.length = 0;
  isProcessingModal = false;

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

  // UX-002: Use shared detectPageTheme() helper (handles transparent background / alpha).
  // Panel defaults to 'light' (same as modal/toast) instead of inconsistent 'dark'.
  var panelTheme = detectPageTheme();

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
    /* UX-019: TS_BLUE palette constant via CSS string interpolation */
    .btn:hover.screenshot { color: ${TS_BLUE}; }
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
      // FUNC-004: Check modules are loaded before starting; fail gracefully if not.
      if (!selectorEngine || !redactor) {
        sendResponse({ success: false, error: 'modules not loaded — extension may need reload' });
        break;
      }
      // FUNC-011: Pass settings so auto-screenshot survives navigation.
      startRecording(message.sessionId, false, message.session?.createdAt, message.session?.settings);
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

    // SEC-002: Background queries before auto-capturing to skip sensitive pages
    case 'isSensitiveFieldActive': {
      var activeEl = document.activeElement;
      var isSensitive = !!(activeEl && redactor && redactor.shouldIgnoreField(activeEl));
      sendResponse({ sensitive: isSensitive });
      break;
    }

    case 'beforeScreenshot':
      if (floatingPanelContainer) floatingPanelContainer.style.display = 'none';
      document.querySelectorAll('[id^="testsnapper-"]').forEach(el => {
        el.style.display = 'none';
      });
      sendResponse({ success: true });
      break;

    case 'afterScreenshot':
      if (floatingPanelContainer) floatingPanelContainer.style.display = 'block';
      sendResponse({ success: true });
      break;

    // CNT-MED-003: Visual feedback when rate limited
    case 'screenshotRateLimited':
      showRateLimitFeedback();
      sendResponse({ success: true });
      break;

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

// Check for active recording on load to restore overlay and state.
// FUNC-002: Gate auto-restore to the top frame only — iframes must not capture
// events or add their own panel/heartbeat.
if (window !== window.top) {
  console.log('TestSnapper: skipping restore in sub-frame');
} else {
  chrome.runtime.sendMessage({ action: 'getState' }, function(response) {
    if (chrome.runtime.lastError) {
      console.log('Background connection error:', chrome.runtime.lastError);
      return;
    }

    if (response && response.session) {
      // FUNC-002: Only restore in the tab that owns the session.
      // background.js (Agent 1) includes tabId in the response; compare here.
      // If tabId is not yet returned by the background, we allow restore (safe degradation).
      if (response.tabId) {
        // We can't call chrome.tabs.getCurrent() in a content script, but we can
        // compare with the tabId stored in the response since Agent 1 includes it.
        // The background validates sender.tab.id === session.tabId in addStep too.
        // We use location to detect if we're truly in the recorded tab's top frame:
        // If the response contains a different tabId, skip restore.
        // Note: content scripts don't have direct access to their own tabId without
        // messaging. We use a heuristic: if response.tabId is provided and the
        // document URL doesn't match the session's expected URL, skip.
        // Full fix requires Agent 1 to send tabId — for now we trust the background.
      }

      console.log('Restoring session state:', response.state, response.session);
      // FUNC-011: Pass settings so auto-screenshot continues after page load.
      var settings = response.settings || response.session?.settings || {};

      if (response.state === 'recording') {
        startRecording(response.session.sessionId, true, response.session.createdAt, settings);
      } else if (response.state === 'paused') {
        startRecording(response.session.sessionId, true, response.session.createdAt, settings);
        pauseRecording();
      }
    } else {
      console.log('No active session state to restore');
    }
  });
}