/**
 * Content Script - Modal state management + session recovery
 */

// Shared design-system palette constants — "Steel & Slate" tokens
var TS_BLUE = '#4A7FB5';
var TS_BLUE_DARK = '#3A6699';
var TS_SLATE_900 = '#1E293B';
var TS_SLATE_700 = '#334155';

// Guard against duplicate initialization on re-injection.
// Background.js pings before injecting so re-injection shouldn't happen,
// but as a belt-and-suspenders measure we also guard here.
// 'var' declarations don't throw SyntaxError on re-injection, but their initializers
// DO re-run, which would reset isRecording to false and orphan the old state.
// Solution: skip all initializer assignments if already initialized.

var selectorEngine;
var redactor;
var fieldNameResolver;
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
var autoScreenshotInterval;
// Track last interactions to prevent duplicates
var lastInteraction;
// Pending input timeouts per element
var pendingInputs;
// Modal queue system
var modalQueue;
var isProcessingModal;
var currentModalId;
var modalStates;
var lastNavigationUrl;
var sessionSettings;

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
  autoScreenshotInterval = null;
  lastInteraction = { element: null, action: null, timestamp: 0, value: null };
  pendingInputs = new Map();
  modalQueue = [];
  isProcessingModal = false;
  currentModalId = null;
  modalStates = new Map();
  lastNavigationUrl = '';
  sessionSettings = {};
}

// Initialize modules
// Check for all required globals. FieldNameResolver absence is tolerated
// (background agent adds it to executeScript list) but SelectorEngine + Redactor
// are mandatory — if either is absent, recording will fail immediately.
function initModules() {
  var missing = [];
  if (!window.SelectorEngine) missing.push('SelectorEngine');
  if (!window.Redactor) missing.push('Redactor');
  // FieldNameResolver is optional but warn if absent
  if (!window.FieldNameResolver) {
    window.Logger?.warn('TestSnapper: FieldNameResolver not loaded — field names may degrade');
  }

  if (missing.length > 0) {
    window.Logger?.warn('TestSnapper: Missing modules:', missing.join(', '));
    return false;
  }

  selectorEngine = new window.SelectorEngine();
  redactor = new window.Redactor();
  // Wire the superior FieldNameResolver when present. Cache a single instance
  // (it holds a WeakMap cache) instead of constructing one per resolve() call.
  if (window.FieldNameResolver) {
    try {
      fieldNameResolver = new window.FieldNameResolver(selectorEngine);
    } catch (e) {
      fieldNameResolver = null;
    }
  }
  window.Logger?.info('TestSnapper content script initialized');
  return true;
}

var _modulesInitialized = initModules();
if (!_modulesInitialized) {
  window.Logger?.debug('TestSnapper: Waiting for modules to load...');
  setTimeout(function() {
    if (!initModules()) {
      window.Logger?.error('TestSnapper: Failed to initialize - modules not available');
    }
  }, 100);
}

/**
 * Enhanced field name extraction for better reporting
 */
function getEnhancedFieldName(element) {
  // Prefer the dedicated FieldNameResolver (Shadow DOM, ARIA, form groups,
  // proximity scoring, etc.) when it is loaded. Fall back to the inline
  // heuristics below if the resolver is absent, throws, or returns null.
  if (fieldNameResolver) {
    try {
      const resolved = fieldNameResolver.resolve(element);
      if (resolved) return resolved;
    } catch (e) {
      // Fall through to inline heuristics
    }
  }

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

    // Use filter instead of :has() — requires Chrome 105+ which exceeds minimum_chrome_version (LOW-011)
    const labelCandidates = Array.from(parent.querySelectorAll('span, div, p'))
      .filter(el => el.tagName !== 'DIV' || el.children.length === 0);
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

  // Prefer the resolver's cleaning logic so names stay consistent with the
  // primary resolve() path. Fall back to the inline implementation below.
  if (fieldNameResolver && typeof fieldNameResolver._cleanFieldName === 'function') {
    try {
      return fieldNameResolver._cleanFieldName(text);
    } catch (e) {
      // Fall through to inline cleaning
    }
  }

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
 * documentElement, checks prefers-color-scheme media query, and defaults to 'light' when alpha is negligible.
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

    // Both transparent — check prefers-color-scheme media query
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }

    // Default to light (most pages are light)
    return 'light';
  } catch(e) {
    return 'light';
  }
}

function showManualEntryModal(element, action, stepData) {
  return queueModal(element, action, stepData);
}

/**
 * Queue-based modal system
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
    window.Logger?.error('Modal error:', error);
    modalRequest.resolve(null);
  }

  currentModalId = null;

  // Process next item directly; no setTimeout needed since processModalQueue
  // is async and each modal awaits the previous one before returning.
  processModalQueue();
}

function closeModalById(modalId, result) {
  var state = modalStates.get(modalId);
  if (!state) return;

  // New modals use shadow DOM and expose _closeWithRestore
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
 * Wrapped in Shadow DOM to isolate styles from host page.
 * Uses detectPageTheme() helper.
 * Resets 30s timeout on typing; submits typed value on timeout; ARIA + focus trap.
 * Uses TS_BLUE palette constants.
 */
function showManualEntryModalInternal(element, action, stepData, modalId) {
  return new Promise(function(resolve) {
    // Track the element that triggered the modal so focus can be restored on close
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

    // Use shared detectPageTheme() helper (handles transparent body, alpha blending)
    var modalTheme = detectPageTheme();
    var isLight = modalTheme === 'light';
    // UX-019: dark surfaces use the TS_SLATE palette (defined at top of file)
    // instead of one-off hex, so the injected UI matches the extension's own theme.
    var modalBg = isLight ? '#ffffff' : TS_SLATE_900;
    var modalBorder = isLight ? '#dee2e6' : TS_SLATE_700;
    var modalShadow = isLight ? '0 10px 25px -5px rgba(0,0,0,0.1)' : '0 10px 25px -5px rgba(0,0,0,0.5)';
    var textPrimary = isLight ? '#212529' : '#ececef';
    var textMuted = isLight ? '#868e96' : '#71717a';
    var borderColor = isLight ? '#dee2e6' : TS_SLATE_700;
    var inputBg = isLight ? '#ffffff' : TS_SLATE_900;
    var cancelHoverBg = isLight ? '#e9ecef' : TS_SLATE_700;

    // Create Shadow DOM host so styles don't leak into/from host page
    var shadowHost = document.createElement('div');
    shadowHost.id = 'testsnapper-modal-host-' + modalId;
    // Position the host so the shadow overlay can be fixed inside it
    shadowHost.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483646;';
    var shadow = shadowHost.attachShadow({ mode: 'open' });
    state.shadowHost = shadowHost;

    // Inject keyframes + reset CSS inside shadow root (no host-page pollution)
    var style = document.createElement('style');
    style.textContent = [
      /* CSS reset to prevent host-page inheritance */
      ':host { all: initial; }',
      '*, *::before, *::after { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; font-size: 14px; line-height: 1.5; text-transform: none; }',
      /* Keyframes prefixed with testsnapper- so they never collide with host animations */
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
    // ARIA dialog semantics
    modalDiv.setAttribute('role', 'dialog');
    modalDiv.setAttribute('aria-modal', 'true');
    modalDiv.setAttribute('aria-labelledby', headingId);

    var h3 = document.createElement('h3');
    h3.id = headingId;
    h3.className = 'ts-heading';
    h3.textContent = 'Enter Field Name';
    var p = document.createElement('p');
    p.className = 'ts-desc';
    p.textContent = 'TestSnapper couldn\'t automatically detect the field name for this ';
    var strong = document.createElement('strong');
    strong.textContent = action;
    p.appendChild(strong);
    p.appendChild(document.createTextNode(' action. Please provide a descriptive name.'));
    var inp = document.createElement('input');
    inp.id = inputId;
    inp.className = 'ts-input';
    inp.type = 'text';
    inp.placeholder = 'e.g., Username, Email Address, Submit Button...';
    inp.setAttribute('aria-label', 'Field name');
    var actions = document.createElement('div');
    actions.className = 'ts-actions';
    var skipBtn = document.createElement('button');
    skipBtn.id = cancelId;
    skipBtn.className = 'ts-btn ts-btn-cancel';
    skipBtn.textContent = 'Skip';
    var okBtn = document.createElement('button');
    okBtn.id = confirmId;
    okBtn.className = 'ts-btn ts-btn-confirm';
    okBtn.textContent = 'Confirm';
    actions.appendChild(skipBtn);
    actions.appendChild(okBtn);
    modalDiv.appendChild(h3);
    modalDiv.appendChild(p);
    modalDiv.appendChild(inp);
    modalDiv.appendChild(actions);

    overlayDiv.appendChild(modalDiv);
    shadow.appendChild(style);
    shadow.appendChild(overlayDiv);
    document.body.appendChild(shadowHost);

    var input = shadow.getElementById(inputId);
    var cancelBtn = shadow.getElementById(cancelId);
    var confirmBtn = shadow.getElementById(confirmId);

    // Enhanced closeWithRestore that restores focus
    function closeWithRestore(result) {
      // Restore focus to triggering element
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

    // Tab focus trap (input → skip → confirm → back to input)
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

    // Reset auto-close timeout on input; submit typed value on timeout (not null)
    function resetTimeout() {
      if (state.timeout) clearTimeout(state.timeout);
      state.timeout = setTimeout(function() {
        window.Logger?.warn('Modal auto-closed after timeout:', modalId);
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
 * Process step with modal pause/resume
 */
async function processStepWithManualEntry(element, action, stepData) {
  let fieldName = stepData.fieldName;

  if (!fieldName || fieldName === 'Unknown Field' || fieldName.trim() === '') {
    window.Logger?.debug('⚠️ Field name not detected, requesting manual entry...');

    isModalOpen = true;
    updateRecordingIndicator('PAUSED');

    fieldName = await showManualEntryModal(element, action, stepData);

    isModalOpen = false;
    // Only resume if still valid
    if (isRecording && currentSessionId) {
      // Validate session still exists
      const valid = await validateSession();
      if (valid) {
        updateRecordingIndicator('RECORDING');
      } else {
        window.Logger?.error('❌ Session invalidated during modal - stopping recording');
        stopRecording();
        return null;
      }
    }

    if (!fieldName) {
      window.Logger?.debug('⏭️ User skipped field name entry');
      return null;
    }

    window.Logger?.info('✅ Manual field name entered:', fieldName);
  }

  stepData.fieldName = fieldName;
  return stepData;
}

/**
 * Validate session still exists in background
 */
async function validateSession() {
  if (!currentSessionId) return false;

  try {
    const response = await chrome.runtime.sendMessage({ action: 'getState' });
    if (!response || response.session?.sessionId !== currentSessionId) {
      window.Logger?.error('❌ Session mismatch or background restarted');
      return false;
    }
    return true;
  } catch (error) {
    window.Logger?.error('❌ Failed to validate session:', error);
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

  // Smarter duplicate detection with action-specific time windows
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
      window.Logger?.debug('Skipping click on input field - will capture as type/change');
      return;
    }

    if (isDuplicateInteraction(element, 'click')) {
      window.Logger?.debug('Skipping duplicate click');
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

    window.Logger?.info('Interaction captured:', action, stepData.fieldName);
  } catch (error) {
    window.Logger?.error('❌ Error capturing click:', error);
    // showErrorNotification('Failed to capture click: ' + error.message);
    // Don't stop recording, just log and continue
  }
}

function showErrorNotification(message) {
  showToastNotification(message, 'error');
}

/**
 * Show toast notification - theme-aware with left border accent.
 * Wrapped in Shadow DOM to isolate styles from host page.
 * Uses detectPageTheme() helper.
 * Uses TS_BLUE palette constants.
 * @param {string} message
 * @param {string} type - 'info' | 'success' | 'warning' | 'error'
 */
function showToastNotification(message, type) {
  if (type === undefined) type = 'info';

  // Remove any existing toast shadow host
  var existingHost = document.getElementById('testsnapper-toast-host');
  if (existingHost) existingHost.remove();

  // Use shared detectPageTheme() helper
  var toastTheme = detectPageTheme();

  // Map legacy color params to types
  if (type && type.charAt(0) === '#') {
    if (type === '#ff4444' || type === '#FF4444') type = 'error';
    else if (type === '#FFA500') type = 'warning';
    else if (type === '#4CAF50' || type === '#333') type = 'info';
    else type = 'info';
  }

  // Use TS_BLUE for info accent
  var accentColors = { info: TS_BLUE, success: '#16a34a', warning: '#d97706', error: '#dc2626' };
  var accentColor = accentColors[type] || accentColors.info;
  var isLt = toastTheme === 'light';

  // Create Shadow DOM host to isolate toast styles from host page
  var shadowHost = document.createElement('div');
  shadowHost.id = 'testsnapper-toast-host';
  shadowHost.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483646;width:0;height:0;';
  var shadow = shadowHost.attachShadow({ mode: 'open' });

  var style = document.createElement('style');
  style.textContent = [
    ':host { all: initial; }',
    '*, *::before, *::after { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; font-size: 13px; line-height: 1.5; text-transform: none; }',
    /* Prefixed keyframe name */
    '@keyframes testsnapper-slideInRight { from { opacity: 0; transform: translateX(16px); } to { opacity: 1; transform: translateX(0); } }',
    // UX-019: TS_SLATE_900/700 instead of one-off dark hex
    '.toast { position: fixed; bottom: 16px; right: 16px; background: ' + (isLt ? '#ffffff' : TS_SLATE_900) + '; color: ' + (isLt ? '#495057' : '#a1a1aa') + '; border: 1px solid ' + (isLt ? '#dee2e6' : TS_SLATE_700) + '; border-left: 3px solid ' + accentColor + '; padding: 12px 16px; border-radius: 8px; font-weight: 500; box-shadow: ' + (isLt ? '0 4px 12px rgba(0,0,0,0.08)' : '0 4px 12px rgba(0,0,0,0.4)') + '; animation: testsnapper-slideInRight 0.2s ease; max-width: 360px; transition: opacity 0.2s ease; }'
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
 * Show rate limit feedback
 */
function showRateLimitFeedback() {
  showToastNotification('Screenshot rate limited - please wait a moment', 'warning');
}

/**
 * SEC-002: feedback when a manual screenshot was skipped because a
 * sensitive field (password, etc.) is focused — captureVisibleTab records
 * exactly what's on screen, so this is the same guard already applied to
 * auto-screenshots, now covering the explicit Ctrl+Shift+S action too.
 */
function showSensitiveScreenshotBlockedFeedback() {
  showToastNotification('Screenshot skipped — a sensitive field is focused', 'warning');
}

function handleInput(event) {
  if (!isRecording || !selectorEngine || !redactor || isModalOpen) return;

  try {
    const element = event.target;
    // Use the element object itself as the Map key to avoid calling
    // generateSelector() synchronously on every keystroke. generateSelector() is
    // deferred to the debounced callback body where it runs only once per burst.
    const elementKey = element;

    if (pendingInputs.has(elementKey)) {
      clearTimeout(pendingInputs.get(elementKey));
    }

    const timeoutId = setTimeout(async () => {
      // generateSelector is now called here (deferred), not in the outer scope.
      const selector = selectorEngine.generateSelector(element);
      const fieldName = getEnhancedFieldName(element);

      // Always run the value through redactor to catch PII in generic fields.
      // maskValue() returns the original string unchanged when no patterns match,
      // so this is always safe to call.
      // PERF-017: compute shouldIgnoreField once and pass it in, instead of
      // maskValue computing it internally and this line recomputing it again.
      const isIgnored = redactor.shouldIgnoreField(element);
      const maskedValue = redactor.maskValue(element.value, element, isIgnored);
      const isSensitive = maskedValue !== element.value || isIgnored;
      const value = maskedValue;

      if (isDuplicateInteraction(element, 'type', value)) {
        window.Logger?.debug('Skipping duplicate input');
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

      window.Logger?.info('Input captured:', stepData.fieldName, value);
    }, 800);

    pendingInputs.set(elementKey, timeoutId);
  } catch (error) {
    window.Logger?.error('❌ Error capturing input:', error);
    // Don't stop recording, just log and continue
  }
}

async function handleChange(event) {
  if (!isRecording || !selectorEngine || !redactor || isModalOpen) return;

  try {
    const element = event.target;

    // Use element object as Map key (same as handleInput)
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
      // Always run through redactor to catch PII in generic fields.
      // PERF-017: compute shouldIgnoreField once, reuse for both maskValue and isSensitive.
      const isIgnored = redactor.shouldIgnoreField(element);
      const maskedValue = redactor.maskValue(element.value, element, isIgnored);
      isSensitive = maskedValue !== element.value || isIgnored;
      value = maskedValue;
    }

    if (isDuplicateInteraction(element, action, value)) {
      window.Logger?.debug('Skipping duplicate change');
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
    window.Logger?.info('Change captured:', stepData.fieldName, value);
  } catch (error) {
    window.Logger?.error('❌ Error capturing change:', error);
    // Don't stop recording, just log and continue
  }
}

function handleSubmit(event) {
  if (!isRecording || !selectorEngine || isModalOpen) return;

  try {
    const form = event.target;

    if (isDuplicateInteraction(form, 'submit')) {
      window.Logger?.debug('Skipping duplicate submit');
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
    window.Logger?.info('Submit captured:', fieldName);
  } catch (error) {
    window.Logger?.error('❌ Error capturing submit:', error);
  }
}

function captureNavigation() {
  if (!isRecording || isModalOpen) return;

  const currentUrl = window.location.href;

  // P0-5: captureNavigation owns lastNavigationUrl. Callers must NOT pre-set it,
  // otherwise this guard makes every navigation a no-op (the old interval did
  // exactly that, which killed SPA navigation capture entirely).
  if (currentUrl === lastNavigationUrl) {
    return;
  }

  lastNavigationUrl = currentUrl;

  // "Auto-Capture Screenshots" is the master switch for ALL automatic
  // screenshots. A navigation screenshot is taken only when auto-capture is on
  // AND "Screenshot Before Navigation" is on. If auto-capture is off, the
  // navigate STEP is still recorded, but no screenshot is captured — so
  // disabling auto-capture stops every automatic screenshot.
  const activeEl = document.activeElement;
  const autoCaptureOn = !!(sessionSettings && sessionSettings.autoScreenshot);
  const navOptIn = !sessionSettings || sessionSettings.captureOnNavigation !== false;
  // Suppress when auto-capture is off, the nav sub-option is off, or a sensitive
  // field is active (avoid capturing PII on screen).
  const suppressScreenshot = !autoCaptureOn || !navOptIn ||
    (activeEl && redactor && redactor.shouldIgnoreField(activeEl));

  const stepData = {
    action: 'navigate',
    selector: null,
    fieldName: 'Page Navigation',
    targetLabel: document.title,
    url: currentUrl,
    value: currentUrl,
    isSensitive: false,
    // Screenshots are separate steps with their own assets — a navigate step
    // never carries one itself.
    hasScreenshot: false,
    // Explicitly mark as non-manual so the background applies
    // rate limiting and does NOT call tabs.update({active:true}) (which yanked
    // focus back to the recorded tab on every SPA navigation).
    isManual: false
  };

  sendStepToBackground(stepData);

  // Take the navigation screenshot only when not suppressed. `trigger:'navigation'`
  // lets the background label it "Navigation Screenshot" (distinct from the
  // periodic "Auto Screenshot"), so the two automatic sources are never conflated.
  if (!suppressScreenshot) {
    chrome.runtime.sendMessage({ action: 'captureScreenshot', isManual: false, trigger: 'navigation' }, function () {
      void chrome.runtime.lastError; // capture may be rate-limited/skipped — fine
    });
  }

  window.Logger?.info('Navigation captured:', currentUrl, suppressScreenshot ? '(screenshot suppressed)' : '');
}

/**
 * Send a step to the background service worker.
 * Retries once after ~1s on 'No active session' (background may still be
 * recovering its state after a service-worker restart). Shows a toast instead of
 * silently calling stopRecording() on the first failure.
 */
function sendStepToBackground(stepData, isRetry) {
  if (isRetry === undefined) isRetry = false;

  // Validate session before sending
  if (!currentSessionId) {
    window.Logger?.error('No active session - cannot send step');
    stopRecording();
    return;
  }

  chrome.runtime.sendMessage({
    action: 'addStep',
    stepData: stepData
  }, function(response) {
    if (chrome.runtime.lastError) {
      window.Logger?.error('Failed to send step:', chrome.runtime.lastError);
      if (!isRetry) {
        // Retry once — background may be recovering from SW restart
        setTimeout(function() { sendStepToBackground(stepData, true); }, 1000);
      } else {
        showToastNotification('TestSnapper: Connection lost — stopping recording', 'error');
        stopRecording();
      }
    } else if (response && !response.success) {
      window.Logger?.error('Failed to add step:', response.error);
      if (response.error === 'No active session') {
        if (!isRetry) {
          // Retry once after delay
          setTimeout(function() { sendStepToBackground(stepData, true); }, 1000);
        } else {
          showToastNotification('TestSnapper: Session lost — stopping recording', 'warning');
          stopRecording();
        }
      }
    }
  });
}

/**
 * Shared setup helper — called from both normal start and the async
 * session-fetch path to avoid the previously broken recursive startRecording call.
 * Aborts old event listeners/intervals before creating new ones.
 */
function _finishStartRecording(sessionId, isRestoring, startTime) {
  // Abort old AbortController before creating a new one to prevent
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
  if (autoScreenshotInterval) {
    clearInterval(autoScreenshotInterval);
    autoScreenshotInterval = null;
  }

  // Use AbortController for automatic cleanup
  eventListenerController = new AbortController();
  var signal = eventListenerController.signal;

  document.addEventListener('click', handleClick, { capture: true, signal: signal });
  document.addEventListener('input', handleInput, { capture: true, signal: signal });
  document.addEventListener('change', handleChange, { capture: true, signal: signal });
  document.addEventListener('submit', handleSubmit, { capture: true, signal: signal });

  // Pre-fetch iframe label context for cross-frame field name resolution (MED-010)
  if (fieldNameResolver && typeof fieldNameResolver.initFrameContext === 'function') {
    fieldNameResolver.initFrameContext();
  }

  // FD-2: event capture must run in every frame (clicks inside iframes are only
  // visible to the iframe's own listeners), but the floating panel, heartbeat,
  // navigation polling, and auto-screenshot interval belong to the TOP frame
  // only. Without this gate, every ad/embed iframe added its own panel and
  // generated junk navigate steps for iframe-internal URL changes.
  if (window !== window.top) {
    window.Logger?.debug('Content script: sub-frame recording (event capture only)');
    return;
  }

  window.Logger?.debug('Starting timer with:', { startTime: startTime, now: Date.now() });
  addRecordingIndicator(startTime);

  // Start session validation heartbeat
  sessionValidationInterval = setInterval(async function() {
    var valid = await validateSession();
    if (!valid) {
      window.Logger?.error('Session validation failed - stopping recording');
      stopRecording();
    }
  }, 15000);

  if (isRestoring) {
    captureNavigation();
  }

  // Start navigation monitoring. captureNavigation() itself checks and updates
  // lastNavigationUrl — do NOT pre-set it here (P0-5: pre-setting it made the
  // equality guard inside captureNavigation skip every SPA navigation).
  lastNavigationUrl = window.location.href;
  navigationCheckInterval = setInterval(function() {
    if (isRecording && !isModalOpen && window.location.href !== lastNavigationUrl) {
      captureNavigation();
    }
  }, 1000);

  // Auto-Capture Screenshots: when enabled, request a (non-manual) screenshot
  // every N seconds while actively recording. Background applies rate limiting
  // and sensitive-field suppression. Paused state no-ops via isRecording.
  if (sessionSettings && sessionSettings.autoScreenshot) {
    var autoSecs = Math.max(1, Math.min(60, parseInt(sessionSettings.screenshotSeconds) || 5));
    autoScreenshotInterval = setInterval(function() {
      if (isRecording && !isModalOpen) {
        chrome.runtime.sendMessage({ action: 'captureScreenshot', isManual: false }, function () {
          void chrome.runtime.lastError; // rate-limited/skipped is fine
        });
      }
    }, autoSecs * 1000);
    window.Logger?.info('Auto-screenshot enabled: every ' + autoSecs + 's');
  }

  window.Logger?.info('Content script: Recording started');
}

/**
 * Accept settings parameter so auto-screenshot works after navigation.
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
    // Empty lastNavigationUrl lets the restore-path captureNavigation() record
    // the freshly loaded page as a navigate step.
    lastNavigationUrl = '';
  } else {
    lastNavigationUrl = window.location.href;
  }

  if (isRestoring && !startTimeStr) {
    // Async fetch of start time — delegates to _finishStartRecording
    // instead of recursing (which previously hit the isRecording guard and was a no-op).
    window.Logger?.debug('startRecording: Missing startTimeStr during restore, fetching from session...');
    chrome.runtime.sendMessage({ action: 'getSession', sessionId: sessionId }, function(res) {
      if (res && res.session && res.session.createdAt) {
        var t = new Date(res.session.createdAt).getTime();
        _finishStartRecording(sessionId, isRestoring, t);
      } else {
        window.Logger?.warn('Failed to recover start time, defaulting to now');
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
  window.Logger?.info('Content script: Recording paused');
}

function resumeRecording() {
  if (isRecording) return;
  isRecording = true;
  isPaused = false;
  updateRecordingIndicator('RECORDING');
  window.Logger?.info('Content script: Recording resumed');
}

function stopRecording() {
  if (!isRecording && !currentSessionId) return;

  isRecording = false;
  isPaused = false;
  isModalOpen = false;
  currentSessionId = null;

  // Clear validation interval
  if (sessionValidationInterval) {
    clearInterval(sessionValidationInterval);
    sessionValidationInterval = null;
  }
  if (autoScreenshotInterval) {
    clearInterval(autoScreenshotInterval);
    autoScreenshotInterval = null;
  }

  pendingInputs.forEach(timeoutId => clearTimeout(timeoutId));
  pendingInputs.clear();

  lastInteraction = { element: null, action: null, timestamp: 0, value: null };

  // Force close any open modal (modals now use shadow host elements)
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

  // Abort all event listeners at once
  if (eventListenerController) {
    eventListenerController.abort();
    eventListenerController = null;
  }

  // Clear navigation interval
  if (navigationCheckInterval) {
    clearInterval(navigationCheckInterval);
    navigationCheckInterval = null;
  }

  removeRecordingIndicator();
  removeHighlight();

  window.Logger?.info('Content script: Recording stopped');
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

  // Use shared detectPageTheme() helper (handles transparent background / alpha).
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
      background: ${TS_SLATE_900};
      border: 1px solid ${TS_SLATE_700};
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
    .theme-dark .divider { background: ${TS_SLATE_700}; }
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
    .theme-dark .btn:hover { background: ${TS_SLATE_700}; }
    .btn:hover.stop { color: #dc2626; }
    .btn:hover.pause { color: #d97706; }
    .btn:hover.resume { color: #16a34a; }
    /* TS_BLUE palette constant via CSS string interpolation */
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
  // On drag start we switch the container from transform-centered positioning
  // to explicit pixel top/left so the panel tracks the cursor smoothly.
  let isDragging = false;
  let initialX;
  let initialY;

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

    const dragSignal = eventListenerController ? { signal: eventListenerController.signal } : {};
    document.addEventListener('mousemove', handleMouseMove, dragSignal);
    document.addEventListener('mouseup', handleMouseUp, dragSignal);
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

  // Only increment timer when not paused
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
  window.Logger?.debug('Content script received message:', message.action);

  switch (message.action) {
    case 'startRecording':
      // Check modules are loaded before starting; fail gracefully if not.
      if (!selectorEngine || !redactor) {
        sendResponse({ success: false, error: 'modules not loaded — extension may need reload' });
        break;
      }
      // Pass settings so auto-screenshot survives navigation.
      // Background sends settings as a top-level field (message.settings), not nested.
      startRecording(message.sessionId, false, message.session?.createdAt, message.settings);
      sendResponse({ success: true });
      break;

    // Sent by background session recovery after a service-worker restart.
    // Previously unhandled ("Unknown action") — recovery only worked by luck
    // via the load-time getState path.
    case 'restoreRecording':
      if (!selectorEngine || !redactor) {
        sendResponse({ success: false, error: 'modules not loaded' });
        break;
      }
      startRecording(message.sessionId, true, message.session?.createdAt, message.settings);
      if (message.state === 'paused') {
        pauseRecording();
      }
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

    // Background queries before auto-capturing to skip sensitive pages
    case 'isSensitiveFieldActive': {
      var activeEl = document.activeElement;
      var isSensitive = !!(activeEl && redactor && redactor.shouldIgnoreField(activeEl));
      sendResponse({ sensitive: isSensitive });
      break;
    }

    case 'beforeScreenshot': {
      var hiddenEls = [];
      document.querySelectorAll('[id^="testsnapper-"]').forEach(function(el) {
        hiddenEls.push({ el: el, display: el.style.display });
        el.style.display = 'none';
      });
      window.__testSnapperHiddenEls = hiddenEls;
      sendResponse({ success: true });
      break;
    }

    case 'afterScreenshot': {
      var toRestore = window.__testSnapperHiddenEls || [];
      toRestore.forEach(function(entry) {
        entry.el.style.display = entry.display;
      });
      window.__testSnapperHiddenEls = [];
      sendResponse({ success: true });
      break;
    }

    // Visual feedback when rate limited
    case 'screenshotRateLimited':
      showRateLimitFeedback();
      sendResponse({ success: true });
      break;

    // SEC-002: visual feedback when a manual capture is skipped for a
    // focused sensitive field
    case 'screenshotBlockedSensitive':
      showSensitiveScreenshotBlockedFeedback();
      sendResponse({ success: true });
      break;

    // Cross-frame label resolution: an iframe's FieldNameResolver asks the
    // background, which relays here (frame 0). Find the <iframe> whose src
    // matches and return a human label for it. Previously unhandled — the
    // whole cross-frame label feature was dead (MED-010).
    case 'getIframeLabel': {
      var frameLabel = null;
      try {
        var frames = document.querySelectorAll('iframe');
        for (var fi = 0; fi < frames.length; fi++) {
          if (frames[fi].src && frames[fi].src === message.frameUrl) {
            var f = frames[fi];
            frameLabel = f.title || f.getAttribute('aria-label') || f.name || null;
            break;
          }
        }
      } catch (e) { /* label stays null */ }
      sendResponse({ label: frameLabel });
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

window.Logger?.info('TestSnapper content script loaded');

// Check for active recording on load to restore overlay and state.
// Gate auto-restore to the top frame only — iframes must not capture
// events or add their own panel/heartbeat.
if (window !== window.top) {
  window.Logger?.debug('TestSnapper: skipping restore in sub-frame');
} else {
  chrome.runtime.sendMessage({ action: 'getState' }, function(response) {
    if (chrome.runtime.lastError) {
      window.Logger?.debug('Background connection error:', chrome.runtime.lastError);
      return;
    }

    if (response && response.session) {
      window.Logger?.info('Restoring session state:', response.state, response.session);
      // Pass settings so auto-screenshot continues after page load.
      var settings = response.settings || response.session?.settings || {};

      if (response.state === 'recording') {
        startRecording(response.session.sessionId, true, response.session.createdAt, settings);
      } else if (response.state === 'paused') {
        startRecording(response.session.sessionId, true, response.session.createdAt, settings);
        pauseRecording();
      }
    } else {
      window.Logger?.debug('No active session state to restore');
    }
  });
}