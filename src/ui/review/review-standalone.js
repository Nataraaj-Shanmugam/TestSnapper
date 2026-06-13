/**
 * Review Session Page - WITH ADD STEP FEATURE + DND + FILTER + HISTORY + PROGRESS
 * Proper export flow through background script
 *
 * Fixes applied:
 *  1. Screenshot rendering: chrome.storage.local serialises to JSON, so Blob
 *     objects come back as plain `{}`.  The code now falls back to `asset.data`
 *     (the persisted base64 data-URL string) when `asset.blob` is missing or
 *     not a real Blob.
 *  2. Step-card alignment: `.step-top` now uses `align-items: flex-start`
 *     instead of `center` so the checkbox, drag-handle, and delete button
 *     stay pinned to the top of the card regardless of screenshot height.
 */

import { StorageManager } from '../../core/storage.js';
import { Utils } from '../../core/utils.js';

// ==================== Initialize Services ====================

const storage = new StorageManager();

let sessionId = null;
let sessionData = null;
let stepsData = [];

// Filters
let searchTerm = '';
let filterAction = 'all';

// History (undo/redo)
let history = [];
let historyIndex = -1;
const MAX_HISTORY = 50;

// Drag state
let draggedStepId = null;

// PERF-008: Screenshot asset cache — loaded once per session, invalidated on add/delete
let _assetCache = null;

// ==================== UI Elements ====================

const messageDiv = document.getElementById('message');
const sessionNameInput = document.getElementById('sessionName');
const sessionDate = document.getElementById('sessionDate');
const sessionStepCount = document.getElementById('sessionStepCount');
const stepsContainer = document.getElementById('stepsContainer');
const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
const saveExportBtn = document.getElementById('saveExportBtn');
const cancelBtn = document.getElementById('cancelBtn');
const exportFormatSelect = document.getElementById('exportFormat');

// Add Step Modal elements
const addStepModal = document.getElementById('addStepModal');
const newStepDescription = document.getElementById('newStepDescription');
const newStepAction = document.getElementById('newStepAction');
const screenshotUpload = document.getElementById('screenshotUpload');
const screenshotInput = document.getElementById('screenshotInput');
const screenshotPreview = document.getElementById('screenshotPreview');
const cancelAddStep = document.getElementById('cancelAddStep');
const confirmAddStep = document.getElementById('confirmAddStep');

// Filters UI
const stepSearchInput = document.getElementById('stepSearch');
const actionFilterSelect = document.getElementById('actionFilter');
const clearFiltersBtn = document.getElementById('clearFiltersBtn');
const stepResultsSummary = document.getElementById('stepResultsSummary');
const noResultsMsg = document.getElementById('noResultsMsg');

// Undo/Redo UI
const undoBtn = document.getElementById('undoBtn');

// Export progress UI
const progressModal = document.getElementById('progressModal');
const progressStatus = document.getElementById('progressStatus');
const progressPercent = document.getElementById('progressPercent');
const cancelExportBtn = document.getElementById('cancelExportBtn');

let newStepScreenshotBlob = null;
let insertAfterStepId = null;
// UX-012: Track the trigger element so focus can be restored on modal close
let _modalTriggerElement = null;

// ==================== Utils ====================

function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ==================== Initialization ====================

async function init() {
  // UX-006: Apply theme BEFORE loading session to prevent flash of wrong theme
  setupTheme();
  showMessage('Initializing...', 'info');

  try {
    await storage.init();

    const urlParams = new URLSearchParams(window.location.search);
    sessionId = urlParams.get('sessionId');

    if (!sessionId) {
      showMessage('No session ID provided in URL', 'error');
      return;
    }

    await loadSession();
    setupEventListeners();
  } catch (error) {
    console.error('Initialization failed:', error);
    showMessage('Failed to initialize: ' + error.message, 'error');
  }
}

function setupTheme() {
  // UX-006: Apply theme immediately to prevent flash; localStorage is the fast mirror
  const savedTheme = localStorage.getItem('theme');
  const initialTheme = savedTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(initialTheme);

  const themeToggle = document.getElementById('themeToggle');
  if (!themeToggle) return;

  themeToggle.addEventListener('click', () => {
    const currentTheme = document.body.dataset.theme || 'light';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    applyTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    // Also persist to chrome.storage as secondary mirror
    try {
      chrome.storage.local.set({ theme: newTheme });
    } catch (e) { /* non-critical */ }
  });
}

function applyTheme(theme) {
  const iconEl = document.querySelector('#themeToggle .icon');
  document.body.dataset.theme = theme;

  if (iconEl) {
    if (theme === 'light') {
      iconEl.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
    } else {
      iconEl.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
    }
  }
}

function setupEventListeners() {
  bulkDeleteBtn.addEventListener('click', handleBulkDelete);
  saveExportBtn.addEventListener('click', handleSaveAndExport);
  cancelBtn.addEventListener('click', () => window.close());

  // UX-008: Persistent keyboard-accessible "Add Step" button
  const addStepAtEndBtn = document.getElementById('addStepAtEndBtn');
  if (addStepAtEndBtn) {
    addStepAtEndBtn.addEventListener('click', () => {
      openAddStepModal(stepsData[stepsData.length - 1]?.id, addStepAtEndBtn);
    });
  }

  // Session name auto-save
  sessionNameInput.addEventListener('blur', saveSessionName);

  // Add Step Modal
  screenshotUpload.addEventListener('click', () => screenshotInput.click());
  // UX-012: Make screenshot dropzone keyboard accessible
  screenshotUpload.setAttribute('tabindex', '0');
  screenshotUpload.setAttribute('role', 'button');
  screenshotUpload.setAttribute('aria-label', 'Upload screenshot (Enter or Space to open file dialog)');
  screenshotUpload.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      screenshotInput.click();
    }
  });

  screenshotInput.addEventListener('change', handleScreenshotUpload);
  cancelAddStep.addEventListener('click', closeAddStepModal);
  confirmAddStep.addEventListener('click', handleConfirmAddStep);

  // Click outside modal to close
  addStepModal.addEventListener('click', (e) => {
    if (e.target === addStepModal) {
      closeAddStepModal();
    }
  });

  // Drag & drop for screenshot upload
  screenshotUpload.addEventListener('dragover', (e) => {
    e.preventDefault();
    screenshotUpload.style.borderColor = 'var(--color-primary)';
  });

  screenshotUpload.addEventListener('dragleave', (e) => {
    e.preventDefault();
    screenshotUpload.style.borderColor = 'var(--border-color)';
  });

  screenshotUpload.addEventListener('drop', (e) => {
    e.preventDefault();
    screenshotUpload.style.borderColor = 'var(--border-color)';
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      processScreenshotFile(file);
    }
  });

  // Filters
  if (stepSearchInput) {
    stepSearchInput.addEventListener(
      'input',
      debounce((e) => {
        searchTerm = e.target.value.trim().toLowerCase();
        renderSteps();
      }, 300)
    );
  }

  if (actionFilterSelect) {
    actionFilterSelect.addEventListener('change', (e) => {
      filterAction = e.target.value;
      renderSteps();
    });
  }

  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', () => {
      searchTerm = '';
      filterAction = 'all';
      if (stepSearchInput) stepSearchInput.value = '';
      if (actionFilterSelect) actionFilterSelect.value = 'all';
      renderSteps();
    });
  }

  // Undo button
  if (undoBtn) undoBtn.addEventListener('click', undo);

  // Keyboard shortcuts: Ctrl/Cmd+Z and UX-012: Escape to close modal
  document.addEventListener('keydown', (e) => {
    const meta = e.metaKey;
    const ctrl = e.ctrlKey;

    if ((ctrl || meta) && !e.altKey) {
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
    }

    // UX-012: Escape closes the Add Step modal
    if (e.key === 'Escape' && addStepModal.classList.contains('active')) {
      e.preventDefault();
      closeAddStepModal();
    }
  });

  // UX-012: Focus trap inside modal
  addStepModal.addEventListener('keydown', (e) => {
    if (!addStepModal.classList.contains('active')) return;
    if (e.key !== 'Tab') return;

    const focusable = Array.from(addStepModal.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(el => el.offsetParent !== null);

    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  });

  // FUNC-009: Cancel export - do NOT send cancelExport to background as that
  // incorrectly resets recording state to 'idle'. Simply dismiss the UI.
  // The background export will complete/fail naturally (file download is suppressed
  // since the user won't be waiting for it).
  if (cancelExportBtn) {
    cancelExportBtn.addEventListener('click', () => {
      hideProgressModal();
      showMessage('Export cancelled.', 'info');
    });
  }

  // Listen for export progress events from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'exportProgress') {
      handleExportProgress(message);
    }
  });

  // Mobile sidebar toggle
  var sidebarToggle = document.getElementById('sidebarToggle');
  var sidebar = document.getElementById('sidebar');
  var sidebarOverlay = document.getElementById('sidebarOverlay');

  if (sidebarToggle && sidebar && sidebarOverlay) {
    sidebarToggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      sidebarOverlay.classList.toggle('active');
    });
    sidebarOverlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      sidebarOverlay.classList.remove('active');
    });
  }
}

// ==================== Session Management ====================

async function loadSession() {
  try {
    showMessage('Loading session...', 'info');

    sessionData = await storage.getSession(sessionId);

    if (!sessionData) {
      throw new Error('Session not found');
    }

    stepsData = await storage.getSteps(sessionId);
    stepsData.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

    // Update UI
    sessionNameInput.value = sessionData.sessionName ||
      `Session ${Utils.formatTimestamp(sessionData.createdAt)}`;
    sessionDate.textContent = `Created: ${Utils.formatTimestamp(sessionData.createdAt)}`;
    sessionStepCount.textContent = `Steps: ${stepsData.length}`;

    // PERF-008: Build asset cache once on session load
    _assetCache = null; // invalidate first
    await buildAssetCache();

    // Initialize history with initial state
    history = [];
    historyIndex = -1;
    if (stepsData.length > 0) {
      saveToHistory('initial');
    } else {
      updateHistoryButtons();
    }

    await renderSteps();
    hideMessage();

    console.log('✅ Session loaded:', sessionId, 'Steps:', stepsData.length);
  } catch (error) {
    console.error('Failed to load session:', error);
    showMessage('Failed to load session: ' + error.message, 'error');
  }
}

async function saveSessionName() {
  try {
    let newName = sessionNameInput.value.trim();

    // SEC-009: Sanitize session name
    // Remove control characters and limit length
    newName = newName.replace(/[\x00-\x1F\x7F]/g, ''); // Remove control characters
    newName = newName.substring(0, 200); // Limit to 200 characters

    if (newName && sessionData) {
      sessionData.sessionName = newName;
      sessionNameInput.value = newName; // Update input with sanitized value
      await storage.updateSession(sessionData);

      await chrome.runtime.sendMessage({
        action: 'updateSessionName',
        sessionId: sessionData.sessionId,
        sessionName: newName
      });

      console.log('✅ Session name saved:', newName, sessionData.sessionId);
    }
  } catch (error) {
    console.error('Failed to save session name:', error);
  }
}

// ==================== Filters & History ====================

function filterSteps() {
  let filtered = [...stepsData];

  if (searchTerm) {
    const term = searchTerm;
    filtered = filtered.filter((step) => {
      const fields = [
        step.description,
        step.fieldName,
        step.value,
        step.action,
        step.url
      ];
      return fields.some(
        (v) => v && String(v).toLowerCase().includes(term)
      );
    });
  }

  if (filterAction && filterAction !== 'all') {
    const targetAction = filterAction.toLowerCase();
    filtered = filtered.filter(
      (step) => (step.action || 'click').toLowerCase() === targetAction
    );
  }

  return filtered;
}

function saveToHistory(actionLabel) {
  // PERF-018: structuredClone is faster and handles more types than JSON round-trip
  const snapshot = structuredClone(stepsData);

  // Truncate future if we are in the middle
  if (historyIndex < history.length - 1) {
    history = history.slice(0, historyIndex + 1);
  }

  history.push({ action: actionLabel, steps: snapshot });

  // Adaptive cap: keep fewer snapshots for large sessions
  const cap = stepsData.length > 200 ? 20 : MAX_HISTORY;
  if (history.length > cap) {
    history.shift();
  }

  historyIndex = history.length - 1;
  updateHistoryButtons();
}

function updateHistoryButtons() {
  if (!undoBtn) return;
  undoBtn.disabled = historyIndex <= 0;
}

async function restoreFromHistory(targetIndex) {
  if (targetIndex < 0 || targetIndex >= history.length) return;

  historyIndex = targetIndex;
  // PERF-018: reuse the already-frozen snapshot; clone so live edits don't corrupt history
  stepsData = structuredClone(history[historyIndex].steps);

  // Persist to DB
  await storage.updateAllSteps(sessionId, stepsData);
  if (sessionData) {
    sessionData.stepCount = stepsData.length;
    await storage.updateSession(sessionData);
    sessionStepCount.textContent = `Steps: ${stepsData.length}`;
  }

  await renderSteps();
  updateHistoryButtons();
}

function undo() {
  if (historyIndex <= 0) return;
  restoreFromHistory(historyIndex - 1);
}

// ==================== Asset Cache ====================

/**
 * PERF-008: Build screenshot asset cache once per session load.
 * Only re-runs when assets are explicitly added or deleted.
 */
async function buildAssetCache() {
  const screenshotAssets = await storage.getAllAssets(sessionId);
  _assetCache = new Map();
  for (const asset of screenshotAssets) {
    const url = await resolveScreenshotUrl(asset);
    if (url) {
      _assetCache.set(asset.stepId, url);
    }
  }
}

// ==================== Step Rendering ====================

/**
 * Resolve a usable image data-URL from a storage asset.
 *
 * chrome.storage.local round-trips through JSON, so Blob objects are
 * deserialised as plain empty objects `{}`.  The reliable persisted
 * representation is `asset.data` (a base64 data-URL string written at
 * capture time).  This helper tries both paths so it works regardless of
 * whether the asset was captured in the current session (blob still live)
 * or loaded from a previous one (only data survives).
 */
const SAFE_DATA_URL_RE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

async function resolveScreenshotUrl(asset) {
  // 1. If .blob is a real Blob, convert it (live-session fast path)
  if (asset.blob && asset.blob instanceof Blob && asset.blob.size > 0) {
    try {
      const url = await Utils.blobToDataURL(asset.blob);
      // SEC-001: reject non-image data URLs from untrusted blobs
      if (!SAFE_DATA_URL_RE.test(url)) return null;
      return url;
    } catch (err) {
      console.warn('blobToDataURL failed, falling back to asset.data:', err);
    }
  }

  // 2. Fall back to the persisted base64 data-URL string
  // SEC-001: only accept well-formed image data URLs to prevent HTML injection
  if (typeof asset.data === 'string' && SAFE_DATA_URL_RE.test(asset.data)) {
    return asset.data;
  }

  return null; // nothing usable or failed validation
}

async function renderSteps() {
  const container = stepsContainer;

  if (!stepsData || stepsData.length === 0) {
    container.innerHTML = '<div class="loading" style="text-align: center; padding: 40px;">No steps recorded. Start a session to see steps here!</div>';
    if (stepResultsSummary) stepResultsSummary.textContent = '';
    if (noResultsMsg) noResultsMsg.classList.add('hidden');
    return;
  }

  // PERF-008: Use cached screenshot map; only rebuild if cache is missing
  if (!_assetCache) {
    await buildAssetCache();
  }
  const screenshotMap = _assetCache;

  const visibleSteps = filterSteps();

  if (stepResultsSummary) {
    if (visibleSteps.length === stepsData.length) {
      stepResultsSummary.textContent = `${stepsData.length} Documented Steps`;
    } else {
      stepResultsSummary.textContent = `Showing ${visibleSteps.length} of ${stepsData.length} steps`;
    }
  }

  if (noResultsMsg) {
    if (visibleSteps.length === 0) {
      noResultsMsg.classList.remove('hidden');
    } else {
      noResultsMsg.classList.add('hidden');
    }
  }

  if (visibleSteps.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = visibleSteps.map((step, index) => {
    const description = step.description || generateStepDescription(step);
    const screenshotData = screenshotMap.get(step.id) || null;
    const safeDescription = Utils.escapeHtml(description);
    // SEC-001: escape step.id before use in HTML attributes
    const safeId = Utils.escapeHtml(step.id);
    // UX-016: Show step.sequence (stable position), not filtered list index
    const badgeNum = step.sequence || (index + 1);

    return `
      <div class="add-between">
         <button class="btn-add" data-before-step-id="${safeId}" title="Add step here" aria-label="Add step before step ${badgeNum}">+</button>
      </div>
      <div class="step-card" data-step-id="${safeId}">
        <div class="step-number-badge">${badgeNum}</div>

        <!-- align-items: flex-start keeps checkbox / handle / delete
             pinned to the TOP of the card even when the screenshot makes
             .step-main tall. -->
        <div class="step-top" style="align-items: flex-start;">

          <!-- UX-009: draggable="true" on handle only, not whole card -->
          <div class="step-handle" draggable="true" tabindex="0" role="button"
               aria-label="Drag to reorder step ${badgeNum}"
               title="Drag to reorder" style="font-size: 20px; padding-top: 10px; cursor: grab;">⋮⋮</div>

          <!-- checkbox – fixed width, top-aligned -->
          <div style="display: flex; align-items: flex-start; justify-content: center; width: 40px; flex-shrink: 0; padding-top: 8px;">
            <input type="checkbox" class="step-checkbox" data-step-id="${safeId}"
                   ${step.selected ? 'checked' : ''}
                   draggable="false"
                   style="width: 22px; height: 22px; cursor: pointer; accent-color: var(--primary);">
          </div>

          <!-- main content (textarea + optional screenshot) -->
          <div class="step-main">
            <textarea
              class="step-description-area"
              data-step-id="${safeId}"
              placeholder="Describe this step..."
              draggable="false"
              rows="1">${safeDescription}</textarea>

            ${screenshotData ? `
              <div class="screenshot-container" id="img-${safeId}" data-step-id="${safeId}">
                <img src="${screenshotData}" alt="Interaction Screenshot" loading="lazy">
              </div>
            ` : ''}
          </div>

          <!-- delete button – top-aligned -->
          <div class="step-actions" style="flex-shrink: 0; padding-top: 4px;">
            <button class="icon-btn delete-btn" title="Delete Step" aria-label="Delete step ${badgeNum}"
                    data-step-id="${safeId}" style="border: none; background: transparent; font-size: 20px; color: var(--text-muted);">
              ✕
            </button>
          </div>
        </div>
      </div>
      ${index === visibleSteps.length - 1 ? `
        <div class="add-between">
           <button class="btn-add" data-after-last="true" title="Add step at the end" aria-label="Add step at the end">+</button>
        </div>
      ` : ''}
    `;
  }).join('');

  attachStepEventListeners();
}

function generateStepDescription(step) {
  const action = step.action || 'Action';
  const field = step.fieldName ? Utils.escapeHtml(step.fieldName.trim()) : '';
  const value = step.value ? Utils.escapeHtml(step.value.trim()) : '';

  switch (action.toLowerCase()) {
    case 'click':
      return `Click "${field || 'element'}"`;
    case 'type':
      return `Type "${value || 'text'}" in ${field || 'field'}`;
    case 'navigate':
      return `Navigate to ${value}`;
    case 'select':
      return `Select "${value || field}" from dropdown`;
    case 'check':
      return `Check the box ${field ? `for "${field}"` : ''}`;
    case 'submit':
      return `Submit the form`;
    case 'screenshot':
      return step.isManual ? '📸 Manual screenshot' : '📸 Auto screenshot';
    default:
      return `${action} ${field} ${value ? `→ "${value}"` : ''}`.trim();
  }
}

function attachStepEventListeners() {
  document.querySelectorAll('.delete-btn').forEach(btn =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleDeleteStep(btn.dataset.stepId);
    })
  );

  document.querySelectorAll('.step-checkbox').forEach(box =>
    box.addEventListener('change', handleCheckboxChange)
  );

  document.querySelectorAll('.btn-add').forEach(btn =>
    btn.addEventListener('click', () => {
      const stepId = btn.dataset.beforeStepId;
      const isLast = btn.dataset.afterLast === 'true';
      if (isLast) {
        // UX-012: pass btn as trigger for focus restore
        openAddStepModal(stepsData[stepsData.length - 1]?.id, btn);
      } else {
        const index = stepsData.findIndex(s => s.id === stepId);
        const targetId = index > 0 ? stepsData[index - 1].id : null;
        openAddStepModal(targetId, btn);
      }
    })
  );

  // Auto-resize textareas
  document.querySelectorAll('.step-description-area').forEach(textarea => {
    const resize = () => {
      textarea.style.height = 'auto';
      textarea.style.height = (textarea.scrollHeight) + 'px';
    };
    textarea.addEventListener('input', resize);
    resize(); // Initial

    textarea.addEventListener('blur', async (e) => {
      const stepId = e.target.dataset.stepId;
      const step = stepsData.find(s => s.id === stepId);
      if (!step) return;

      const newText = e.target.value.trim();
      const oldText = step.description || generateStepDescription(step);

      if (newText && newText !== oldText) {
        try {
          saveToHistory('edit');
          step.description = newText;
          await storage.updateStep(step);
          showMessage('Step updated', 'success');
        } catch (err) {
          console.error('Failed to update step:', err);
          showMessage('Failed to update step: ' + err.message, 'error');
          e.target.value = oldText;
        }
      }
    });
  });

  // UX-009: Drag events on the handle only; drop target remains the card
  document.querySelectorAll('.step-handle').forEach(handle => {
    handle.addEventListener('dragstart', handleDragStart);
    handle.addEventListener('dragend', handleDragEnd);

    // UX-009: Keyboard reorder via ArrowUp/Down on focused handle
    handle.addEventListener('keydown', async (e) => {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const card = handle.closest('.step-card');
      if (!card) return;
      const stepId = card.dataset.stepId;
      const currentIndex = stepsData.findIndex(s => s.id === stepId);
      if (currentIndex === -1) return;

      const targetIndex = e.key === 'ArrowUp' ? currentIndex - 1 : currentIndex + 1;
      if (targetIndex < 0 || targetIndex >= stepsData.length) return;

      saveToHistory('reorder');
      const [moved] = stepsData.splice(currentIndex, 1);
      stepsData.splice(targetIndex, 0, moved);
      await resequenceAndPersist();

      // Restore focus to the moved handle
      setTimeout(() => {
        const handles = document.querySelectorAll('.step-handle');
        if (handles[targetIndex]) handles[targetIndex].focus();
      }, 50);
    });
  });

  document.querySelectorAll('.step-card').forEach(card => {
    card.addEventListener('dragover', handleDragOver);
    card.addEventListener('drop', handleDrop);
    card.addEventListener('dragleave', handleDragLeave);
  });
}

// ==================== Add Step Modal ====================

function openAddStepModal(afterStepId, triggerElement) {
  // UX-012: Save trigger so focus can be restored on close
  _modalTriggerElement = triggerElement || document.activeElement;
  insertAfterStepId = afterStepId;
  newStepDescription.value = '';
  newStepAction.value = 'click';
  newStepScreenshotBlob = null;
  screenshotPreview.style.display = 'none';
  screenshotPreview.src = '';
  addStepModal.classList.add('active');
  newStepDescription.focus();
}

function closeAddStepModal() {
  addStepModal.classList.remove('active');
  insertAfterStepId = null;
  newStepScreenshotBlob = null;
  // UX-012: Restore focus to the element that triggered the modal
  if (_modalTriggerElement && typeof _modalTriggerElement.focus === 'function') {
    _modalTriggerElement.focus();
  }
  _modalTriggerElement = null;
}

function handleScreenshotUpload(event) {
  const file = event.target.files[0];
  if (file && file.type.startsWith('image/')) {
    processScreenshotFile(file);
  }
}

function processScreenshotFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    screenshotPreview.src = e.target.result;
    screenshotPreview.style.display = 'block';
    screenshotUpload.classList.add('has-image');

    // Convert to blob
    fetch(e.target.result)
      .then(res => res.blob())
      .then(blob => {
        newStepScreenshotBlob = blob;
      });
  };
  reader.readAsDataURL(file);
}

async function handleConfirmAddStep() {
  const description = newStepDescription.value.trim();

  if (!description) {
    showMessage('Please enter a step description', 'error');
    return;
  }

  try {
    showMessage('Adding step...', 'info');

    // Find the position to insert
    const afterStepIndex = stepsData.findIndex(s => s.id === insertAfterStepId);
    const newSequence = afterStepIndex + 2;

    // Create new step
    const newStep = {
      id: Utils.generateUUID(),
      sessionId: sessionId,
      sequence: newSequence,
      action: newStepAction.value,
      description: description,
      fieldName: 'Manual Step',
      url: sessionData.env?.url || '',
      timestamp: new Date().toISOString(),
      isSensitive: false,
      hasScreenshot: !!newStepScreenshotBlob
    };

    // Add step to database
    await storage.addStep(newStep);

    // If screenshot provided, save it as both blob AND data URL so it
    // survives the chrome.storage.local JSON round-trip.
    if (newStepScreenshotBlob) {
      let dataUrl = null;
      try {
        dataUrl = await Utils.blobToDataURL(newStepScreenshotBlob);
      } catch (err) {
        console.warn('Failed to convert new screenshot to data URL:', err);
      }

      await storage.addAsset({
        id: Utils.generateUUID(),
        sessionId: sessionId,
        stepId: newStep.id,
        type: 'screenshot',
        blob: newStepScreenshotBlob,   // live-session use (won't survive reload)
        data: dataUrl,                  // persisted base64 string (survives reload)
        createdAt: new Date().toISOString()
      });
      // PERF-008: Invalidate cache so new screenshot is picked up
      _assetCache = null;
    }

    // Save history BEFORE mutation
    saveToHistory('add');

    // Insert into array and resequence + persist
    stepsData.splice(afterStepIndex + 1, 0, newStep);
    await resequenceAndPersist();

    closeAddStepModal();
    showMessage('Step added successfully!', 'success');
  } catch (error) {
    console.error('Failed to add step:', error);
    showMessage('Failed to add step: ' + error.message, 'error');
  }
}

// ==================== Step Actions ====================

async function handleDeleteStep(stepId) {
  try {
    // Save history BEFORE mutation
    saveToHistory('delete');

    await storage.deleteStep(stepId);
    stepsData = stepsData.filter(s => s.id !== stepId);

    // PERF-008: Invalidate asset cache if step had a screenshot
    _assetCache = null;

    await resequenceAndPersist();

    // UX-017: Show undo hint in the toast
    showMessageWithUndo('Step deleted');
  } catch (error) {
    console.error('Failed to delete step:', error);
    showMessage('Failed to delete: ' + error.message, 'error');
  }
}

async function handleBulkDelete() {
  const selectedSteps = stepsData.filter(s => s.selected);

  if (!selectedSteps.length) {
    showMessage('No steps selected.', 'error');
    return;
  }

  if (!confirm(`Delete ${selectedSteps.length} selected step(s)?`)) return;

  try {
    // Save history BEFORE mutation
    saveToHistory('bulk-delete');

    // STR-MED-002: Use batch delete for better performance
    const stepIds = selectedSteps.map(s => s.id);
    await storage.batchDeleteSteps(stepIds);

    stepsData = stepsData.filter(s => !s.selected);

    await resequenceAndPersist();
    showMessage('Selected steps deleted.', 'success');
  } catch (error) {
    console.error('Bulk delete failed:', error);
    showMessage('Failed to delete: ' + error.message, 'error');
  }
}

function handleCheckboxChange(e) {
  const stepId = e.target.dataset.stepId;
  const isChecked = e.target.checked;
  const step = stepsData.find(s => s.id === stepId);
  if (step) {
    step.selected = isChecked;
    console.log('Step checkbox changed:', stepId, isChecked);
  }
  updateBulkDeleteButton();
}

function updateBulkDeleteButton() {
  const checkedCount = document.querySelectorAll('.step-checkbox:checked').length;
  if (bulkDeleteBtn) {
    bulkDeleteBtn.disabled = checkedCount === 0;
  }
}

// ==================== Drag & Drop Reordering ====================

function handleDragStart(event) {
  // UX-009: drag starts from .step-handle; find parent card for stepId
  const handle = event.currentTarget;
  const card = handle.closest('.step-card');
  if (!card) return;
  draggedStepId = card.dataset.stepId;
  card.classList.add('dragging');
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
  }
}

function handleDragOver(event) {
  event.preventDefault();
  const card = event.currentTarget.closest('.step-card');
  if (card && !card.classList.contains('dragging')) {
    card.classList.add('drag-over');
  }
}

function handleDragLeave(event) {
  const card = event.currentTarget.closest('.step-card');
  if (card) {
    card.classList.remove('drag-over');
  }
}

async function handleDrop(event) {
  event.preventDefault();
  const targetLine = event.currentTarget;
  const targetStepId = targetLine.dataset.stepId;

  document.querySelectorAll('.step-card.drag-over').forEach(el =>
    el.classList.remove('drag-over')
  );

  if (!draggedStepId || draggedStepId === targetStepId) return;

  const fromIndex = stepsData.findIndex(s => s.id === draggedStepId);
  const toIndex = stepsData.findIndex(s => s.id === targetStepId);
  if (fromIndex === -1 || toIndex === -1) return;

  // Save history BEFORE mutation
  saveToHistory('reorder');

  const [moved] = stepsData.splice(fromIndex, 1);
  stepsData.splice(toIndex, 0, moved);

  await resequenceAndPersist();
}

function handleDragEnd(event) {
  // UX-009: handle is currentTarget; remove classes from parent card
  const handle = event.currentTarget;
  const card = handle ? handle.closest('.step-card') : null;
  if (card) card.classList.remove('dragging');
  draggedStepId = null;
  document.querySelectorAll('.step-card.dragging').forEach(el =>
    el.classList.remove('dragging')
  );
  document.querySelectorAll('.step-card.drag-over').forEach(el =>
    el.classList.remove('drag-over')
  );
}

async function resequenceAndPersist() {
  stepsData.forEach((step, index) => {
    step.sequence = index + 1;
  });

  await storage.updateAllSteps(sessionId, stepsData);

  if (sessionData) {
    sessionData.stepCount = stepsData.length;
    await storage.updateSession(sessionData);
    sessionStepCount.textContent = `Steps: ${stepsData.length}`;
  }

  await renderSteps();
}

// ==================== Export + Progress ====================

function showProgressModal() {
  if (!progressModal) return;
  progressModal.classList.add('active');
  const circle = document.getElementById('progressCircle');
  if (circle) circle.style.strokeDashoffset = '125.6';
  if (progressStatus) progressStatus.textContent = 'Starting export...';
  if (progressPercent) progressPercent.textContent = '0%';
}

function hideProgressModal() {
  if (!progressModal) return;
  progressModal.classList.remove('active');
}

function handleExportProgress(message) {
  if (!progressModal.classList.contains('active')) {
    progressModal.classList.add('active');
  }

  const percent = message.percent || 0;
  const status = message.status || 'Exporting...';
  const circle = document.getElementById('progressCircle');

  if (progressPercent) progressPercent.textContent = `${percent}%`;
  if (progressStatus) progressStatus.textContent = status;

  if (circle) {
    const offset = 125.6 - (percent / 100) * 125.6;
    circle.style.strokeDashoffset = offset;
  }

  if (message.done) {
    setTimeout(() => {
      hideProgressModal();
      if (message.error) {
        showMessage(`Export failed: ${message.error}`, 'error');
      } else if (message.canceled) {
        // Handled via cancel btn listener mostly
      } else {
        showMessage('Export complete!', 'success');
      }
    }, 1000);
  }
}

async function handleSaveAndExport() {
  showProgressModal();
  try {
    showMessage('Saving changes...', 'info');
    await saveSessionName();

    const format = exportFormatSelect.value;
    showMessage(`Exporting as ${format.toUpperCase()}...`, 'info');

    const response = await chrome.runtime.sendMessage({
      action: 'exportSession',
      sessionId: sessionId,
      format: format
    });

    if (response && response.success) {
      showMessage(`Exported as ${format.toUpperCase()} successfully!`, 'success');
    } else if (response && !response.success) {
      throw new Error(response.error || 'Export failed');
    }
  } catch (error) {
    console.error('Save and export failed:', error);
    showMessage('Failed: ' + error.message, 'error');
  } finally {
    hideProgressModal();
  }
}

// ==================== UI Helpers ====================

function showMessage(text, type = 'info') {
  Utils.showMessage(messageDiv, text, type);
}

/**
 * UX-017: Show a message with a clickable Undo link.
 */
function showMessageWithUndo(text) {
  // Clear any previous timer
  if (messageDiv._msgTimer) {
    clearTimeout(messageDiv._msgTimer);
    messageDiv._msgTimer = null;
  }
  // Set innerHTML with a link to trigger undo
  messageDiv.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = text + ' — ';
  const undoLink = document.createElement('a');
  undoLink.href = '#';
  undoLink.textContent = 'Undo';
  undoLink.style.cssText = 'font-weight:bold; text-decoration:underline; cursor:pointer;';
  undoLink.addEventListener('click', (e) => {
    e.preventDefault();
    messageDiv.style.display = 'none';
    undo();
  });
  messageDiv.appendChild(span);
  messageDiv.appendChild(undoLink);
  messageDiv.className = 'message success';
  messageDiv.style.display = 'block';
  messageDiv._msgTimer = setTimeout(() => {
    messageDiv.style.display = 'none';
    messageDiv._msgTimer = null;
  }, 6000);
}

function hideMessage() {
  messageDiv.style.display = 'none';
}

// ==================== Initialize ====================

document.addEventListener('DOMContentLoaded', init);