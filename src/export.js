// FILE: assets/js/export.js
// Export page logic: Enhanced version with better error handling, performance, and UX
// Features: load session, render steps (enriched + raw), inline edit, bulk operations,
// select all/unselect all, per-item delete, bulk delete with undo, Save, Download formats

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

// Enhanced state management
let sessionId = null;
let session = null;
let selection = new Set();      // selected step IDs
let trash = [];                 // [{step, index, timestamp}] for undo
let undoHistory = [];           // Stack for multiple undo levels
let wrapLines = true;
let showRaw = false;
let dirty = false;              // any edit or delete pending
let autoSaveTimer = null;
let lastSaveTime = 0;

// Configuration
const CONFIG = {
  autoSaveDelay: 2000,    // Auto-save after 2 seconds of inactivity
  maxUndoLevels: 10,      // Maximum undo operations to keep
  debounceDelay: 300,     // Debounce delay for input events
  maxStepLength: 500      // Maximum characters per step
};

// Enhanced element references with validation
const elements = {
  stepsList: $('#stepsList'),
  tplStepItem: $('#tplStepItem'),
  sessionTitle: $('#sessionTitle'),
  sessionMeta: $('#sessionMeta'),
  btnSave: $('#btnSave'),
  btnDownloadTxt: $('#btnDownloadTxt'),
  btnDownloadDocx: $('#btnDownloadDocx'),
  btnDownloadHar: $('#btnDownloadHar'),
  btnClose: $('#btnClose'),
  btnSelectAll: $('#btnSelectAll'),
  btnUnselectAll: $('#btnUnselectAll'),
  btnBulkDelete: $('#btnBulkDelete'),
  btnUndo: $('#btnUndo'),
  btnRedo: $('#btnRedo'), // Added for redo functionality
  toggleRaw: $('#toggleRaw'),
  toggleWrap: $('#toggleWrap'),
  counterInfo: $('#counterInfo'),
  footerStats: $('#footerStats'),
  loadingIndicator: $('#loadingIndicator')
};

// Validate required elements exist
function validateElements() {
  const required = ['stepsList', 'tplStepItem', 'sessionTitle', 'btnSave'];
  const missing = required.filter(key => !elements[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required elements: ${missing.join(', ')}`);
  }
}

// Utility Functions
function qsParam(name) {
  const u = new URL(location.href);
  return u.searchParams.get(name);
}

function debounce(func, delay) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func.apply(this, args), delay);
  };
}

function sanitizeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatTimestamp(timestamp) {
  if (!timestamp) return 'Unknown';
  try {
    return new Date(timestamp).toLocaleString();
  } catch (error) {
    return 'Invalid date';
  }
}

function showMessage(text, type = 'info', duration = 3000) {
  // Create or get message container
  let messageContainer = $('#messageContainer');
  if (!messageContainer) {
    messageContainer = document.createElement('div');
    messageContainer.id = 'messageContainer';
    messageContainer.className = 'ts-message-container';
    document.body.appendChild(messageContainer);
  }

  const message = document.createElement('div');
  message.className = `ts-message ts-message--${type}`;
  message.textContent = text;
  
  messageContainer.appendChild(message);
  
  // Auto-remove after duration
  setTimeout(() => {
    message.remove();
    if (messageContainer.children.length === 0) {
      messageContainer.remove();
    }
  }, duration);
}

// Enhanced dirty state management
function setDirty(v = true) {
  dirty = v;
  updateSaveButton();
  
  if (dirty && !autoSaveTimer) {
    autoSaveTimer = setTimeout(() => {
      if (dirty && Date.now() - lastSaveTime > CONFIG.autoSaveDelay) {
        autoSave();
      }
    }, CONFIG.autoSaveDelay);
  } else if (!dirty && autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
}

function updateSaveButton() {
  if (!elements.btnSave) return;
  
  elements.btnSave.disabled = !dirty;
  elements.btnSave.textContent = dirty ? 'Save *' : 'Save';
  elements.btnSave.title = dirty ? 'Unsaved changes' : 'No changes to save';
}

function updateCounters() {
  const total = session?.steps?.length ?? 0;
  const selected = selection.size;
  const deleted = trash.length;
  
  if (elements.counterInfo) {
    elements.counterInfo.textContent = `${total} step${total === 1 ? '' : 's'}`;
  }
  
  if (elements.footerStats) {
    elements.footerStats.textContent = `Selected: ${selected} • Deleted (pending): ${deleted}`;
  }
  
  // Update button states
  if (elements.btnBulkDelete) elements.btnBulkDelete.disabled = selected === 0;
  if (elements.btnUndo) elements.btnUndo.disabled = trash.length === 0;
  if (elements.btnRedo) elements.btnRedo.disabled = undoHistory.length === 0;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function ensureId(step, idx) {
  if (!step.id) {
    step.id = `s_${idx}_${Math.random().toString(36).slice(2, 8)}`;
  }
  return step.id;
}

function minimalRaw(step) {
  const action = step?.action || step?.name || 'Action';
  const loc = step?.locatorNorm || step?.locatorRaw || step?.locator || '';
  return `${action} ${loc}`.trim();
}

function currentSentence(step) {
  return (step.enriched && String(step.enriched).trim()) || minimalRaw(step);
}

function validateStep(step) {
  return {
    id: step.id || `step_${Date.now()}_${Math.random().toString(36).slice(2, 4)}`,
    action: step.action || step.name || 'unknown',
    enriched: step.enriched || '',
    locator: step.locator || step.locatorRaw || step.locatorNorm || '',
    ts: step.ts || Date.now(),
    ...step
  };
}

// Enhanced rendering functions
function renderSession() {
  if (!session) {
    console.error('[Export] No session data to render');
    return;
  }

  console.log('[Export] Rendering session:', session.id);

  elements.stepsList.innerHTML = '';
  selection.clear();
  setDirty(false);
  trash = [];
  undoHistory = [];
  updateCounters();

  // Update header
  if (elements.sessionTitle) {
    elements.sessionTitle.textContent = `Export: ${session.name || `Session ${session.id}`}`;
  }
  
  if (elements.sessionMeta) {
    const when = formatTimestamp(session.created);
    const meta = session.meta || {};
    const browser = meta.browser || 'Unknown Browser';
    const os = meta.os || 'Unknown OS';
    elements.sessionMeta.textContent = `${when} • ${browser} • ${os}`;
  }

  // Validate and render steps
  const steps = Array.isArray(session.steps) ? session.steps : [];
  steps.forEach((step, idx) => {
    const validatedStep = validateStep(step);
    ensureId(validatedStep, idx);
    session.steps[idx] = validatedStep; // Update with validated version
    
    try {
      const stepElement = renderStep(validatedStep, idx);
      if (stepElement) {
        elements.stepsList.appendChild(stepElement);
      }
    } catch (error) {
      console.error(`[Export] Failed to render step ${idx}:`, error);
      // Continue with other steps
    }
  });

  updateCounters();
  console.log(`[Export] Rendered ${steps.length} steps`);
}

function renderStep(step, idx) {
  if (!elements.tplStepItem || !elements.tplStepItem.content) {
    console.error('[Export] Step template not found');
    return null;
  }

  const li = elements.tplStepItem.content.firstElementChild.cloneNode(true);
  li.dataset.id = step.id;

  // Index
  const indexEl = $('.ts-step__index', li);
  if (indexEl) indexEl.textContent = `${idx + 1}.`;

  // Checkbox
  const checkboxEl = $('.ts-step__check', li);
  if (checkboxEl) {
    checkboxEl.addEventListener('change', () => {
      if (checkboxEl.checked) {
        selection.add(step.id);
      } else {
        selection.delete(step.id);
      }
      updateCounters();
    });
  }

  // Enriched text (editable)
  const enrichedEl = $('.ts-step__enriched', li);
  if (enrichedEl) {
    enrichedEl.textContent = currentSentence(step);
    enrichedEl.classList.toggle('nowrap', !wrapLines);
    
    // Enhanced input handling with debouncing
    const debouncedUpdate = debounce((text) => {
      const trimmed = text.trim();
      if (trimmed.length > CONFIG.maxStepLength) {
        showMessage(`Step text truncated to ${CONFIG.maxStepLength} characters`, 'warning');
        step.enriched = trimmed.slice(0, CONFIG.maxStepLength);
        enrichedEl.textContent = step.enriched;
      } else {
        step.enriched = trimmed;
      }
      setDirty(true);
    }, CONFIG.debounceDelay);
    
    enrichedEl.addEventListener('input', (e) => {
      debouncedUpdate(e.target.textContent);
    });
    
    enrichedEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        enrichedEl.blur();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        enrichedEl.blur();
      }
    });
    
    enrichedEl.addEventListener('blur', () => {
      const normalized = (step.enriched || '').replace(/\s+/g, ' ').trim();
      step.enriched = normalized;
      enrichedEl.textContent = normalized;
    });

    // Add focus/blur visual feedback
    enrichedEl.addEventListener('focus', () => {
      enrichedEl.classList.add('ts-step__enriched--editing');
    });

    enrichedEl.addEventListener('blur', () => {
      enrichedEl.classList.remove('ts-step__enriched--editing');
    });
  }

  // Raw step display
  const rawEl = $('.ts-step__raw', li);
  if (rawEl) {
    rawEl.textContent = minimalRaw(step);
    rawEl.style.display = showRaw ? 'block' : 'none';
    rawEl.classList.toggle('nowrap', !wrapLines);
  }

  // Metadata
  const metaEl = $('.ts-step__meta', li);
  if (metaEl) {
    const timestamp = formatTimestamp(step.ts);
    const locator = step.locatorNorm || step.locatorRaw || step.locator || '';
    const metaParts = [timestamp, locator].filter(Boolean);
    metaEl.textContent = metaParts.join(' • ');
    metaEl.title = `Full locator: ${locator}`;
  }

  // Delete button
  const deleteEl = $('.ts-step__delete', li);
  if (deleteEl) {
    deleteEl.addEventListener('click', () => {
      deleteOne(step.id);
    });
  }

  return li;
}

// Enhanced bulk operations
function selectAll() {
  if (!session?.steps) return;
  
  $$('.ts-step__check', elements.stepsList).forEach((checkbox) => {
    checkbox.checked = true;
  });
  
  session.steps.forEach((step) => selection.add(step.id));
  updateCounters();
  
  showMessage(`Selected all ${session.steps.length} steps`, 'info', 2000);
}

function unselectAll() {
  $$('.ts-step__check', elements.stepsList).forEach((checkbox) => {
    checkbox.checked = false;
  });
  
  selection.clear();
  updateCounters();
  
  showMessage('All steps unselected', 'info', 2000);
}

function deleteOne(id) {
  if (!session?.steps) return;
  
  const idx = session.steps.findIndex((s) => s.id === id);
  if (idx === -1) return;

  const [removed] = session.steps.splice(idx, 1);
  trash.push({ 
    step: removed, 
    index: idx, 
    timestamp: Date.now(),
    operation: 'delete_single'
  });
  
  selection.delete(id);
  setDirty(true);
  
  // Re-render to keep indices correct
  renderSession();
  
  showMessage('Step deleted', 'info', 2000);
}

function bulkDelete() {
  if (!session?.steps || selection.size === 0) return;

  const confirmation = confirm(
    `Are you sure you want to delete ${selection.size} selected step${selection.size === 1 ? '' : 's'}?`
  );
  
  if (!confirmation) return;

  const ids = new Set(selection);
  const deletedSteps = [];
  const keep = [];

  session.steps.forEach((step, index) => {
    if (ids.has(step.id)) {
      deletedSteps.push({ step, index, timestamp: Date.now() });
    } else {
      keep.push(step);
    }
  });

  // Add to trash as a single bulk operation
  trash.push({
    operation: 'bulk_delete',
    steps: deletedSteps,
    timestamp: Date.now()
  });

  session.steps = keep;
  selection.clear();
  setDirty(true);
  renderSession();
  
  showMessage(`${deletedSteps.length} steps deleted`, 'info', 2000);
}

function undoDelete() {
  if (trash.length === 0) return;

  const lastOperation = trash.pop();
  
  if (lastOperation.operation === 'bulk_delete') {
    // Restore bulk deleted steps
    const stepsToRestore = lastOperation.steps || [];
    
    // Sort by original index in reverse order for proper insertion
    stepsToRestore.sort((a, b) => b.index - a.index);
    
    stepsToRestore.forEach(({ step, index }) => {
      session.steps.splice(index, 0, step);
    });
    
    showMessage(`Restored ${stepsToRestore.length} steps`, 'success', 2000);
    
  } else if (lastOperation.step && typeof lastOperation.index === 'number') {
    // Restore single deleted step
    session.steps.splice(lastOperation.index, 0, lastOperation.step);
    showMessage('Step restored', 'success', 2000);
  }

  // Move to redo history
  undoHistory.push(lastOperation);
  if (undoHistory.length > CONFIG.maxUndoLevels) {
    undoHistory.shift();
  }

  setDirty(true);
  renderSession();
}

function redoDelete() {
  if (undoHistory.length === 0) return;

  const operation = undoHistory.pop();
  
  if (operation.operation === 'bulk_delete') {
    const stepsToRemove = operation.steps || [];
    stepsToRemove.forEach(({ step }) => {
      const idx = session.steps.findIndex(s => s.id === step.id);
      if (idx !== -1) {
        session.steps.splice(idx, 1);
      }
    });
    showMessage(`Re-deleted ${stepsToRemove.length} steps`, 'info', 2000);
  } else if (operation.step) {
    const idx = session.steps.findIndex(s => s.id === operation.step.id);
    if (idx !== -1) {
      session.steps.splice(idx, 1);
      showMessage('Step re-deleted', 'info', 2000);
    }
  }

  trash.push(operation);
  setDirty(true);
  renderSession();
}

// Enhanced save and download functions
async function saveEdits() {
  if (!dirty || !session) return;
  
  console.log('[Export] Saving edits...');
  elements.btnSave.disabled = true;
  elements.btnSave.textContent = 'Saving...';
  
  try {
    // Prepare step data for save
    const stepsToSave = (session.steps || []).map((step) => ({
      id: step.id,
      enriched: (step.enriched || '').trim()
    }));

    const response = await chrome.runtime.sendMessage({
      type: 'EXPORT_SAVE',
      sessionId,
      steps: stepsToSave,
      metadata: {
        editedAt: Date.now(),
        totalSteps: stepsToSave.length,
        version: '2.0'
      }
    });
    
    if (!response?.ok) {
      throw new Error(response?.error || 'SAVE_FAILED');
    }
    
    console.log('[Export] Save successful');
    lastSaveTime = Date.now();
    setDirty(false);
    trash = [];
    undoHistory = [];
    updateCounters();
    
    // Show success feedback
    elements.btnSave.textContent = 'Saved ✓';
    showMessage('Changes saved successfully', 'success', 2000);
    
    setTimeout(() => {
      if (!dirty) {
        elements.btnSave.textContent = 'Save';
        elements.btnSave.disabled = false;
      }
    }, 2000);
    
  } catch (error) {
    console.error('[Export] Save error:', error);
    showMessage('Failed to save changes. Please try again.', 'error', 4000);
    
    elements.btnSave.textContent = 'Save Error';
    
    setTimeout(() => {
      updateSaveButton();
    }, 2000);
  } finally {
    if (autoSaveTimer) {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = null;
    }
  }
}

async function autoSave() {
  if (!dirty || !session) return;
  
  console.log('[Export] Auto-saving...');
  
  try {
    await saveEdits();
    console.log('[Export] Auto-save completed');
  } catch (error) {
    console.warn('[Export] Auto-save failed:', error);
    // Don't show error message for auto-save failures to avoid interrupting user
  }
}

async function downloadTxt() {
  if (!session) return;
  
  console.log('[Export] Downloading TXT...');
  const btn = elements.btnDownloadTxt;
  
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Downloading...';
  }
  
  try {
    const response = await chrome.runtime.sendMessage({ 
      type: 'EXPORT_TXT', 
      sessionId,
      options: {
        includeMetadata: true,
        includeTimestamps: true,
        format: 'detailed'
      }
    });
    
    if (!response?.ok) {
      throw new Error(response?.error || 'DOWNLOAD_FAILED');
    }
    
    console.log('[Export] TXT download successful');
    showMessage('Text file downloaded successfully', 'success', 2000);
    
    if (btn) {
      btn.textContent = 'Downloaded ✓';
      setTimeout(() => {
        btn.textContent = 'Download .txt';
        btn.disabled = false;
      }, 2000);
    }
    
  } catch (error) {
    console.error('[Export] Download .txt error:', error);
    showMessage('Failed to download text file', 'error', 3000);
    
    if (btn) {
      btn.textContent = 'Download Error';
      setTimeout(() => {
        btn.textContent = 'Download .txt';
        btn.disabled = false;
      }, 2000);
    }
  }
}

async function downloadDocx() {
  console.log('[Export] DOCX download not implemented yet');
  showMessage('DOCX export feature is coming soon. Use TXT export for now.', 'info', 3000);
}

async function downloadHar() {
  if (!session) return;
  
  console.log('[Export] Downloading HAR...');
  const btn = elements.btnDownloadHar;
  
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Downloading...';
  }
  
  try {
    const response = await chrome.runtime.sendMessage({ 
      type: 'EXPORT_HAR', 
      sessionId,
      options: {
        includeResponseBodies: false, // For privacy
        filterSensitiveHeaders: true,
        format: 'har-1.2'
      }
    });
    
    if (!response?.ok) {
      throw new Error(response?.error || 'DOWNLOAD_FAILED');
    }
    
    console.log('[Export] HAR download successful');
    showMessage('HAR file downloaded successfully', 'success', 2000);
    
    if (btn) {
      btn.textContent = 'Downloaded ✓';
      setTimeout(() => {
        btn.textContent = 'Download .har';
        btn.disabled = false;
      }, 2000);
    }
    
  } catch (error) {
    console.error('[Export] Download .har error:', error);
    showMessage('Failed to download HAR file', 'error', 3000);
    
    if (btn) {
      btn.textContent = 'Download Error';
      setTimeout(() => {
        btn.textContent = 'Download .har';
        btn.disabled = false;
      }, 2000);
    }
  }
}

// Enhanced toggle functions
function onToggleRaw() {
  showRaw = elements.toggleRaw?.checked ?? false;

  // Use $$ to get a list
  $$('.ts-step__raw', elements.stepsList || document).forEach((rawEl) => {
    rawEl.style.display = showRaw ? 'block' : 'none';
  });

  try {
    localStorage.setItem('testsnapper-export-show-raw', showRaw.toString());
  } catch (error) {
    console.warn('[Export] Failed to save raw display pref:', error);
  }
}

function onToggleWrap() {
  wrapLines = elements.toggleWrap?.checked ?? true;

  const toggleClassAll = (selector, className) => {
    $$(selector, elements.stepsList || document).forEach((el) => {
      el.classList.toggle(className, !wrapLines);
    });
  };

  toggleClassAll('.ts-step__enriched', 'nowrap');
  toggleClassAll('.ts-step__raw', 'nowrap');

  try {
    localStorage.setItem('testsnapper-export-wrap-lines', wrapLines.toString());
  } catch (error) {
    console.warn('[Export] Failed to save wrap pref:', error);
  }
}

// Enhanced close function with unsaved changes protection
function closeTab() {
  if (dirty) {
    const confirmed = confirm(
      'You have unsaved changes that will be lost. Are you sure you want to close?'
    );
    if (!confirmed) return;
  }
  
  // Clean up any pending timers
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
  }
  
  try {
    window.close();
  } catch (error) {
    console.warn('[Export] Could not close tab programmatically');
    showMessage('Please close the tab manually', 'info', 3000);
  }
}

// Enhanced keyboard shortcuts
function setupKeyboardShortcuts() {
  const shortcuts = {
    // Save shortcuts
    's': (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (!elements.btnSave?.disabled) saveEdits();
      }
    },
    
    // Select all
    'a': (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        selectAll();
      }
    },
    
    // Escape key actions
    'Escape': (e) => {
      if (!dirty) {
        closeTab();
      } else {
        // Blur any focused input
        document.activeElement?.blur();
      }
    },
    
    // Delete selected
    'Delete': (e) => {
      if (!e.target.matches('[contenteditable]') && selection.size > 0) {
        e.preventDefault();
        bulkDelete();
      }
    },
    
    // Undo/Redo
    'z': (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        undoDelete();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey) {
        e.preventDefault();
        redoDelete();
      }
    }
  };
  
  document.addEventListener('keydown', (e) => {
    const handler = shortcuts[e.key];
    if (handler) {
      handler(e);
    }
  });
  
  console.log('[Export] Keyboard shortcuts enabled');
}

// Load user preferences
function loadPreferences() {
  try {
    const savedShowRaw = localStorage.getItem('testsnapper-export-show-raw');
    const savedWrapLines = localStorage.getItem('testsnapper-export-wrap-lines');
    
    if (savedShowRaw !== null) {
      showRaw = savedShowRaw === 'true';
      if (elements.toggleRaw) elements.toggleRaw.checked = showRaw;
    }
    
    if (savedWrapLines !== null) {
      wrapLines = savedWrapLines === 'true';
      if (elements.toggleWrap) elements.toggleWrap.checked = wrapLines;
    }
    
    console.log('[Export] Preferences loaded:', { showRaw, wrapLines });
  } catch (error) {
    console.warn('[Export] Failed to load preferences:', error);
  }
}

// Enhanced initialization
async function init() {
  try {
    console.log('[Export] Initializing export view...');
    
    // Validate required elements
    validateElements();
    
    // Get session ID from URL
    sessionId = qsParam('session');
    if (!sessionId) {
      throw new Error('No session ID provided in URL');
    }
    
    console.log('[Export] Loading session:', sessionId);
    
    // Show loading state
    if (elements.sessionTitle) {
      elements.sessionTitle.textContent = 'Loading...';
    }
    
    // Load session data
    const response = await chrome.runtime.sendMessage({ 
      type: 'EXPORT_LOAD', 
      sessionId,
      options: {
        includeSteps: true,
        includeNetwork: true,
        includeScreenshots: false // Don't load screenshots for export view
      }
    });
    
    if (!response?.ok || !response.session) {
      throw new Error(response?.error || 'Failed to load session data');
    }
    
    session = response.session;
    console.log('[Export] Session loaded:', session.name, `(${session.steps?.length || 0} steps)`);

    // Load user preferences
    loadPreferences();
    
    // Wire up event handlers
    const eventHandlers = [
      [elements.btnSelectAll, 'click', selectAll],
      [elements.btnUnselectAll, 'click', unselectAll],
      [elements.btnBulkDelete, 'click', bulkDelete],
      [elements.btnUndo, 'click', undoDelete],
      [elements.btnRedo, 'click', redoDelete],
      [elements.btnSave, 'click', saveEdits],
      [elements.btnDownloadTxt, 'click', downloadTxt],
      [elements.btnDownloadDocx, 'click', downloadDocx],
      [elements.btnDownloadHar, 'click', downloadHar],
      [elements.btnClose, 'click', closeTab],
      [elements.toggleRaw, 'change', onToggleRaw],
      [elements.toggleWrap, 'change', onToggleWrap]
    ];
    
    eventHandlers.forEach(([element, event, handler]) => {
      if (element && handler) {
        element.addEventListener(event, handler);
      }
    });

    // Set up keyboard shortcuts
    setupKeyboardShortcuts();
    
    // Apply initial toggle states
    onToggleRaw();
    onToggleWrap();
    
    // Render the session
    renderSession();
    
    // Set up periodic auto-save check
    setInterval(() => {
      if (dirty && Date.now() - lastSaveTime > CONFIG.autoSaveDelay * 2) {
        console.log('[Export] Triggering periodic auto-save check');
        autoSave();
      }
    }, CONFIG.autoSaveDelay);
    
    console.log('[Export] Initialization complete');
    showMessage('Session loaded successfully', 'success', 2000);
    
  } catch (error) {
    console.error('[Export] Initialization error:', error);
    
    // Show error state
    if (elements.sessionTitle) {
      elements.sessionTitle.textContent = 'Error Loading Session';
    }
    
    showMessage(
      `Failed to load session: ${error.message}. Please try refreshing the page.`,
      'error',
      10000
    );
    
    // Disable most functionality
    Object.values(elements).forEach(el => {
      if (el && el.tagName === 'BUTTON' && el !== elements.btnClose) {
        el.disabled = true;
      }
    });
  }
}

// Enhanced page lifecycle management
window.addEventListener('beforeunload', (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = 'You have unsaved changes. Leave anyway?';
    return e.returnValue;
  }
  
  // Clean up timers
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
  }
});

// Handle visibility changes (auto-save when tab becomes hidden)
document.addEventListener('visibilitychange', () => {
  if (document.hidden && dirty) {
    console.log('[Export] Tab hidden, triggering auto-save');
    autoSave();
  }
});

// Error boundary for unhandled errors
window.addEventListener('error', (event) => {
  console.error('[Export] Unhandled error:', event.error);
  showMessage('An unexpected error occurred. Please refresh the page.', 'error', 5000);
});

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Export some functions for debugging
window.TestSnapperExport = {
  session,
  selection,
  trash,
  saveEdits,
  renderSession,
  showMessage
};