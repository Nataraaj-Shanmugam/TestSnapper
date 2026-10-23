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

import { FSStorageManager } from '../../core/fs-storage.js';
import { ExportService } from '../../core/export-service.js';
import { Utils } from '../../core/utils.js';
import { Logger } from '../../core/logger.js';
import { ImageProcessor } from '../../core/image-processor.js';
import { setupTheme, applyTheme } from '../theme.js';

// ==================== Initialize Services ====================

const storage = new FSStorageManager();
const exportService = new ExportService(storage);

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

// UX-017: screenshot assets captured at delete time, keyed by stepId, so an
// undo can restore one even if it's since been swept by the orphan cleaner.
// Deliberately independent of the history array index — deleteStep() never
// actually removes the asset immediately (it's an orphan-cleanup candidate),
// so this only ever does real work in that edge case; it's a no-op otherwise.
const _recentlyDeletedAssets = new Map();

// Drag state
let draggedStepId = null;

// PERF-008: Screenshot asset cache — loaded once per session, invalidated on add/delete
let _assetCache = null;

// ==================== UI Elements ====================

const messageDiv = document.getElementById('message');
const sessionNameInput = document.getElementById('sessionName');
const sessionAuthorInput = document.getElementById('sessionAuthor');
const sessionStartTimeInput = document.getElementById('sessionStartTime');
const sessionEndTimeInput = document.getElementById('sessionEndTime');
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

/**
 * F-20: saves that are still in flight. Edits save on blur, asynchronously, and
 * "Done" used to call window.close() immediately — the tab could die before the
 * write landed and the edit was silently lost. Done now waits for these.
 */
const _pendingWrites = new Set();
function trackWrite(promise) {
  const p = Promise.resolve(promise);
  _pendingWrites.add(p);
  p.finally(() => _pendingWrites.delete(p));
  return p;
}

function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Grow a textarea to fit its content.
 *
 * The previous version set `height = scrollHeight`. scrollHeight excludes the
 * border, but these textareas are `box-sizing: border-box`, so the height it
 * set included the border and left the content permanently 2px short — every
 * description was clipped by exactly its border width. Add the border back.
 */
function autosizeTextarea(textarea) {
  textarea.style.height = 'auto';
  const border = textarea.offsetHeight - textarea.clientHeight;
  textarea.style.height = (textarea.scrollHeight + border) + 'px';
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
    Logger.error('Initialization failed:', error);
    showMessage('Failed to initialize: ' + error.message, 'error');
  }
}

function setupEventListeners() {
  setupV12Features();
  bulkDeleteBtn.addEventListener('click', handleBulkDelete);
  saveExportBtn.addEventListener('click', handleSaveAndExport);
  cancelBtn.addEventListener('click', async () => {
    // The field being edited blurs on this button's mousedown, so its save has
    // already started by the time this click runs; wait for it (F-20).
    cancelBtn.disabled = true;
    await Promise.allSettled([..._pendingWrites]);
    window.close();
  });

  // UX-008: Persistent keyboard-accessible "Add Step" button
  const addStepAtEndBtn = document.getElementById('addStepAtEndBtn');
  if (addStepAtEndBtn) {
    addStepAtEndBtn.addEventListener('click', () => {
      openAddStepModal(stepsData[stepsData.length - 1]?.id, addStepAtEndBtn);
    });
  }

  // UX-009: Drag reordering is handled at the container level (not per-card)
  // so dropping past the last card still resolves to "insert at end" instead
  // of silently doing nothing.
  stepsContainer.addEventListener('dragover', handleContainerDragOver);
  stepsContainer.addEventListener('drop', handleContainerDrop);

  // Session name / author / start / end time auto-save
  sessionNameInput.addEventListener('blur', () => trackWrite(saveSessionName()));
  sessionAuthorInput.addEventListener('blur', () => trackWrite(saveSessionAuthor()));
  sessionStartTimeInput.addEventListener('change', () => trackWrite(saveSessionStartTime()));
  sessionEndTimeInput.addEventListener('change', () => trackWrite(saveSessionEndTime()));

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

  // Filters — PERF-008: applyFilters() toggles existing card visibility
  // instead of renderSteps() rebuilding the whole list on every keystroke.
  if (stepSearchInput) {
    stepSearchInput.addEventListener(
      'input',
      debounce((e) => {
        searchTerm = e.target.value.trim().toLowerCase();
        applyFilters();
      }, 300)
    );
  }

  if (actionFilterSelect) {
    actionFilterSelect.addEventListener('change', (e) => {
      filterAction = e.target.value;
      applyFilters();
    });
  }

  if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', () => {
      searchTerm = '';
      filterAction = 'all';
      if (stepSearchInput) stepSearchInput.value = '';
      if (actionFilterSelect) actionFilterSelect.value = 'all';
      applyFilters();
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

    // A-7 (WCAG 2.1.2): Escape was scoped to the Add Step modal only, so during
    // an export the user was inside a dialog with no keyboard way out.
    if (e.key === 'Escape' && progressModal && progressModal.classList.contains('active')) {
      e.preventDefault();
      cancelExportBtn?.click();
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

  // FUNC-009: cancel the LOCAL exportService instance (not a background
  // message — this page owns its own ExportService and background has no
  // export in flight to cancel). exportSession() checks this flag at each
  // stage and throws, so the download never fires. The dialog is also closed
  // here so Cancel feels immediate even if the export is past its last check.
  if (cancelExportBtn) {
    cancelExportBtn.addEventListener('click', () => {
      try {
        exportService.cancelExport(sessionId);
      } catch (err) {
        Logger.error('Cancel export failed:', err);
      }
      hideProgressModal();
      showMessage('Export cancelled.', 'info');
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
    sessionStepCount.textContent = stepsData.length;
    // Session panel: when the session was recorded.
    const sessionDateEl = document.getElementById('sessionDate');
    if (sessionDateEl) {
      const created = sessionData.createdAt ? new Date(sessionData.createdAt) : null;
      sessionDateEl.textContent = created && !isNaN(created)
        ? created.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
        : '-';
    }

    // Author — default to the last-used author (convenience) when this
    // session doesn't have one set yet.
    let author = sessionData.author || '';
    if (!author) {
      try {
        const stored = await chrome.storage.local.get('lastAuthor');
        author = stored.lastAuthor || '';
      } catch (_) { /* ignore — leave blank */ }
    }
    sessionAuthorInput.value = author;

    // Start/End Time — Start defaults to createdAt, End defaults to now for
    // legacy sessions recorded before these fields existed (new sessions
    // already have both set by background.js).
    sessionStartTimeInput.value = Utils.toDatetimeLocalValue(sessionData.startTime || sessionData.createdAt);
    sessionEndTimeInput.value = Utils.toDatetimeLocalValue(sessionData.endTime || new Date().toISOString());

    // PERF-008: Build asset cache once on session load
    invalidateAssetCache(); // revoke any stale object URLs first
    await buildAssetCache();

    // Initialize history with initial state
    history = [];
    historyIndex = -1;
    if (stepsData.length > 0) {
      sessionData.stepCount = stepsData.length; // LOW-027: sync stepCount before initial snapshot
      saveToHistory('initial');
    } else {
      updateHistoryButtons();
    }

    await renderSteps();
    hideMessage();

    // F-7: the incomplete flag replaces the old "[INCOMPLETE]" name prefix.
    // Shown AFTER hideMessage() — shown any earlier, the line above clears it
    // along with "Loading session…" and the user never sees it.
    if (sessionData.incomplete) {
      showMessage(
        `This recording ended unexpectedly — the tab was closed. The ${stepsData.length} step${stepsData.length === 1 ? '' : 's'} captured before that are all here.`,
        'warning'
      );
    }

    Logger.info('✅ Session loaded:', sessionId, 'Steps:', stepsData.length);
  } catch (error) {
    Logger.error('Failed to load session:', error);
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

      Logger.info('✅ Session name saved:', newName, sessionData.sessionId);
    }
  } catch (error) {
    Logger.error('Failed to save session name:', error);
  }
}

async function saveSessionAuthor() {
  try {
    let author = sessionAuthorInput.value.trim();
    // Same defensive sanitization as saveSessionName (SEC-009).
    author = author.replace(/[\x00-\x1F\x7F]/g, '').substring(0, 200);
    sessionAuthorInput.value = author;

    if (sessionData) {
      sessionData.author = author;
      await storage.updateSession(sessionData);
      // Remember as a convenience default for the next session.
      try { await chrome.storage.local.set({ lastAuthor: author }); } catch (_) { /* non-critical */ }
    }
  } catch (error) {
    Logger.error('Failed to save author:', error);
  }
}

async function saveSessionStartTime() {
  try {
    if (!sessionData) return;
    sessionData.startTime = Utils.fromDatetimeLocalValue(sessionStartTimeInput.value) || sessionData.createdAt;
    await storage.updateSession(sessionData);
  } catch (error) {
    Logger.error('Failed to save start time:', error);
  }
}

async function saveSessionEndTime() {
  try {
    if (!sessionData) return;
    sessionData.endTime = Utils.fromDatetimeLocalValue(sessionEndTimeInput.value);
    await storage.updateSession(sessionData);
  } catch (error) {
    Logger.error('Failed to save end time:', error);
  }
}

// ==================== Filters & History ====================

// PERF-008: shared per-step predicate so applyFilters() (toggle visibility)
// and filterSteps() (get the matching array) can never drift apart.
function stepMatchesFilters(step) {
  if (searchTerm) {
    const fields = [step.description, step.fieldName, step.value, step.action, step.url];
    if (!fields.some((v) => v && String(v).toLowerCase().includes(searchTerm))) return false;
  }

  if (filterAction && filterAction !== 'all') {
    if ((step.action || 'click').toLowerCase() !== filterAction.toLowerCase()) return false;
  }

  return true;
}

function filterSteps() {
  return stepsData.filter(stepMatchesFilters);
}

// PERF-008: toggle existing card visibility instead of calling renderSteps()
// (full innerHTML rebuild + listener re-attach + asset cache work) on every
// debounced search keystroke and every filter change.
function applyFilters() {
  const visibleSteps = filterSteps();
  const visibleIds = new Set(visibleSteps.map(s => s.id));

  document.querySelectorAll('.step-card').forEach(card => {
    card.classList.toggle('is-filtered-out', !visibleIds.has(card.dataset.stepId));
  });

  if (stepResultsSummary) {
    stepResultsSummary.textContent = visibleSteps.length === stepsData.length
      ? `${stepsData.length} Documented Steps`
      : `Showing ${visibleSteps.length} of ${stepsData.length} steps`;
  }

  if (noResultsMsg) {
    noResultsMsg.classList.toggle('hidden', visibleSteps.length !== 0);
  }

  // R-001: Table view has no persistent cards to hide — re-render it from the
  // same filtered list, so search and the action filter work in both views.
  if (currentView === 'table') {
    renderTableView(visibleSteps);
    return;
  }

  // A-3: "first"/"last" for the Move up/down buttons means first/last VISIBLE
  // card. With PERF-008 hiding cards rather than removing them, computing this
  // over every card left Move up enabled on the first visible card.
  updateMoveButtonEdges();
}

function updateMoveButtonEdges() {
  const visibleCards = [...document.querySelectorAll('.step-card:not(.is-filtered-out)')];
  document.querySelectorAll('.step-card').forEach(card => {
    const i = visibleCards.indexOf(card);
    const up = card.querySelector('.step-move[data-dir="up"]');
    const down = card.querySelector('.step-move[data-dir="down"]');
    if (up) up.setAttribute('aria-disabled', String(i <= 0));
    if (down) down.setAttribute('aria-disabled', String(i === -1 || i === visibleCards.length - 1));
  });
}

function saveToHistory(actionLabel) {
  // PERF-018: structuredClone is faster and handles more types than JSON round-trip
  const snapshot = structuredClone(stepsData);
  history.push({ action: actionLabel, steps: snapshot });

  // Adaptive cap: keep fewer snapshots for large sessions
  const cap = stepsData.length > 200 ? 20 : MAX_HISTORY;
  if (history.length > cap) history.shift();

  historyIndex = history.length - 1;
  updateHistoryButtons();
}

function updateHistoryButtons() {
  if (!undoBtn) return;
  undoBtn.disabled = historyIndex <= 0;
}

// UX-017: snapshot each stepId's screenshot asset before a delete goes
// through, so a later undo can put it back even if the orphan cleaner has
// since swept it (deleteStep() itself never touches assets, so this is
// normally a no-op safety net rather than the common path).
async function captureAssetsForUndo(stepIds) {
  for (const stepId of stepIds) {
    try {
      const assets = await storage.getAssetsByStepId(stepId, sessionId);
      for (const asset of assets) {
        _recentlyDeletedAssets.set(asset.stepId, asset);
      }
    } catch (err) {
      Logger.warn('Failed to snapshot asset for undo:', stepId, err);
    }
  }
  // Bound the cache the same way history itself is bounded.
  while (_recentlyDeletedAssets.size > MAX_HISTORY) {
    _recentlyDeletedAssets.delete(_recentlyDeletedAssets.keys().next().value);
  }
}

// UX-017: re-insert any captured screenshot asset that's missing for a step
// that just reappeared via undo.
async function restoreMissingAssets(steps) {
  const candidates = steps.filter(s => s.hasScreenshot && _recentlyDeletedAssets.has(s.id));
  if (!candidates.length) return;

  let restoredAny = false;
  for (const step of candidates) {
    const asset = _recentlyDeletedAssets.get(step.id);
    const stillPresent = (await storage.getAssetsByStepId(step.id, sessionId)).length > 0;
    if (!stillPresent) {
      await storage.addAsset(asset);
      restoredAny = true;
    }
  }
  if (restoredAny) invalidateAssetCache();
}

async function restoreFromHistory(targetIndex) {
  if (targetIndex < 0 || targetIndex >= history.length) return;

  historyIndex = targetIndex;
  // PERF-018: reuse the already-frozen snapshot; clone so live edits don't corrupt history
  stepsData = structuredClone(history[historyIndex].steps);

  await restoreMissingAssets(stepsData);

  // Persist to DB
  await storage.updateAllSteps(sessionId, stepsData);
  if (sessionData) {
    sessionData.stepCount = stepsData.length;
    await storage.updateSession(sessionData);
    sessionStepCount.textContent = stepsData.length;
  }

  await renderSteps();
  updateHistoryButtons();
}

async function undo() {
  // P1-1: saveToHistory() snapshots state BEFORE each mutation and leaves
  // historyIndex pointing at that snapshot — so history[historyIndex] IS the
  // one-step-back state. Restoring historyIndex - 1 went one further and
  // reverted TWO operations, then persisted the result via updateAllSteps().
  // It looked correct only because history[0] and history[1] are duplicates.
  //
  // restoreFromHistory() sets historyIndex = targetIndex, so we walk the
  // pointer back afterwards; otherwise a second Undo would replay the same
  // snapshot forever.
  if (historyIndex <= 0 || !history[historyIndex]) return;
  const snapshotIndex = historyIndex;
  await restoreFromHistory(snapshotIndex);
  historyIndex = snapshotIndex - 1;
  updateHistoryButtons();
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

// PERF-008: object URLs from a previous cache must be revoked before the
// cache is dropped/rebuilt, or every add/delete/undo leaks the blob it
// backed for the lifetime of the page.
function invalidateAssetCache() {
  if (_assetCache) {
    for (const url of _assetCache.values()) {
      if (typeof url === 'string' && url.startsWith('blob:')) {
        URL.revokeObjectURL(url);
      }
    }
  }
  _assetCache = null;
}

// ==================== Step Rendering ====================

/**
 * Resolve a usable image URL from a storage asset.
 *
 * chrome.storage.local round-trips through JSON, so Blob objects are
 * deserialised as plain empty objects `{}`.  The reliable persisted
 * representation is `asset.data`/`asset.dataUrl` (a base64 data-URL string
 * written at capture time).  This helper tries both paths so it works
 * regardless of whether the asset was captured in the current session (blob
 * still live) or loaded from a previous one (only data survives).
 *
 * PERF-008: the result is always a `blob:` object URL, never a raw base64
 * data URL — a multi-MB base64 string held as innerHTML + a DOM attribute +
 * this cache Map is 2-3x the image's actual size in memory; a blob: URL is
 * a short string backed by a single browser-managed buffer. Callers that
 * invalidate the cache must call invalidateAssetCache() so these get revoked.
 */
const SAFE_DATA_URL_RE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

async function resolveScreenshotUrl(asset) {
  // 1. Live Blob (only valid in the same session before a storage round-trip)
  //    — already exactly what we want, no base64 round-trip needed.
  if (asset.blob && asset.blob instanceof Blob && asset.blob.size > 0) {
    try {
      return URL.createObjectURL(asset.blob);
    } catch (err) {
      Logger.warn('createObjectURL failed for live blob:', err);
    }
  }

  // 2. asset.dataUrl — what background.js writes for EVERY captured screenshot
  //    and what FileSync.readAssets() returns (P0-3: this field was never
  //    checked, so recorded screenshots never rendered in the review page).
  // 3. asset.data — manually-added screenshots from this review page
  // SEC-001: only accept well-formed image data URLs to prevent HTML injection
  const dataUrl =
    (typeof asset.dataUrl === 'string' && SAFE_DATA_URL_RE.test(asset.dataUrl) && asset.dataUrl) ||
    (typeof asset.data === 'string' && SAFE_DATA_URL_RE.test(asset.data) && asset.data) ||
    null;
  if (!dataUrl) return null; // nothing usable or failed validation

  try {
    return URL.createObjectURL(ImageProcessor._dataUrlToBlob(dataUrl));
  } catch (err) {
    Logger.warn('Failed to convert screenshot to a blob URL, falling back to the data URL:', err);
    return dataUrl;
  }
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

  // R-001: Table view renders the filtered list itself (a table rebuild is
  // cheap and has no per-card listeners), so branch off before building cards.
  const tableContainer = document.getElementById('tableContainer');
  if (currentView === 'table') {
    container.hidden = true;
    if (tableContainer) tableContainer.hidden = false;
    applyFilters();
    return;
  }
  container.hidden = false;
  if (tableContainer) tableContainer.hidden = true;

  // PERF-008: build cards for the FULL list, not just what currently
  // matches search/filter. applyFilters() (below) then hides non-matching
  // cards via a CSS class instead of rebuilding the DOM — search keystrokes
  // and filter changes no longer touch innerHTML, listeners, or storage at all.
  container.innerHTML = stepsData.map((step, index) => {
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

          <!-- A-3 (WCAG 2.5.7 Dragging Movements, AA): dragging was the ONLY
               pointer route to reorder. 2.5.7 requires a single-pointer
               alternative specifically — the ArrowUp/Down handler does not
               discharge it, and it was undiscoverable anyway. These buttons
               share moveStep() with drag and the arrow keys, so all three
               routes behave identically. -->
          <div class="step-reorder">
            <button type="button" class="step-move" data-dir="up" data-step-id="${safeId}"
                    aria-label="Move step ${badgeNum} up" title="Move up">▲</button>
            <!-- UX-009: draggable="true" on handle only, not whole card -->
            <div class="step-handle" draggable="true" tabindex="0" role="button"
                 aria-roledescription="sortable step handle"
                 aria-label="Reorder step ${badgeNum}"
                 aria-keyshortcuts="ArrowUp ArrowDown"
                 title="Drag to reorder, or press Arrow Up / Arrow Down" style="cursor: grab;">⋮⋮</div>
            <button type="button" class="step-move" data-dir="down" data-step-id="${safeId}"
                    aria-label="Move step ${badgeNum} down" title="Move down">▼</button>
          </div>

          <!-- checkbox – fixed width, top-aligned -->
          <div style="display: flex; align-items: flex-start; justify-content: center; width: 24px; flex-shrink: 0; padding-top: 8px;">
            <input type="checkbox" class="step-checkbox" data-step-id="${safeId}"
                   ${step.selected ? 'checked' : ''}
                   draggable="false"
                   aria-label="Select step ${badgeNum} for bulk actions"
                   style="cursor: pointer; accent-color: var(--accent);">
          </div>

          <!-- main content: description + meta line (v1.2 design) -->
          <div class="step-main">
            <textarea
              class="step-description-area"
              data-step-id="${safeId}"
              placeholder="Describe this step..."
              aria-label="Description for step ${badgeNum}"
              draggable="false"
              rows="1">${safeDescription}</textarea>

            <!-- P2-4: the card used to show none of what was captured — action,
                 field and URL were stored on every step and rendered nowhere,
                 so filtering to "Navigate" looked identical to "Click". The
                 selector is deliberately NOT shown (acd82c4, reconfirmed for
                 this port). -->
            ${renderStepMeta(step)}
          </div>

          <!-- v1.2: screenshot as a right-hand thumbnail instead of a
               full-width block. This also resolves P2-3 — full-width images
               made a 200-step session ~110,000px tall. -->
          ${screenshotData ? `
            <button type="button" class="step-thumb" data-step-id="${safeId}"
                    aria-label="View screenshot for step ${badgeNum}" title="View screenshot">
              <img src="${screenshotData}" alt="" loading="lazy">
            </button>
          ` : ''}

          <!-- delete button – top-aligned -->
          <div class="step-actions">
            <button class="icon-btn delete-btn" title="Delete Step" aria-label="Delete step ${badgeNum}"
                    data-step-id="${safeId}">✕</button>
          </div>
        </div>
      </div>
      ${index === stepsData.length - 1 ? `
        <div class="add-between">
           <button class="btn-add" data-after-last="true" title="Add step at the end" aria-label="Add step at the end">+</button>
        </div>
      ` : ''}
    `;
  }).join('');

  attachStepEventListeners();
  applyFilters();
}

/**
 * v1.2 design: the badge/label shown for each recorded action.
 *
 * A fixed map rather than interpolating step.action, for two reasons: the
 * value feeds a CSS attribute selector and visible text, so it must never be
 * attacker-influenced; and several raw actions intentionally share one visual
 * style (select, select_radio and check are all "a choice was made").
 */
const ACTION_BADGES = {
  click:        { style: 'click',      label: 'Click' },
  type:         { style: 'type',       label: 'Type' },
  navigate:     { style: 'navigate',   label: 'Navigate' },
  select:       { style: 'select',     label: 'Select' },
  select_radio: { style: 'select',     label: 'Radio' },
  check:        { style: 'select',     label: 'Check' },
  submit:       { style: 'submit',     label: 'Submit' },
  keypress:     { style: 'submit',     label: 'Key' },
  screenshot:   { style: 'screenshot', label: 'Screenshot' },
  apicall:      { style: 'apicall',    label: 'API call' }
};

/** Path + query of a URL, for a compact meta line. Falls back to the raw string. */
function shortUrl(raw) {
  if (!raw || typeof raw !== 'string') return '';
  try {
    const u = new URL(raw);
    return (u.pathname + u.search) || '/';
  } catch (_) {
    return raw;
  }
}

/**
 * The meta line under a step's description: action badge, field, URL and —
 * when the value was masked — a redaction marker.
 *
 * UX F-22: every step carries isSensitive, but no UI read it, so a compliance
 * user exporting audit evidence could neither confirm masking happened nor
 * spot a value that should have been masked and wasn't. The marker also warns
 * that screenshots are NOT redacted, since the text column looking clean makes
 * the screenshot beside it look trustworthy when it is not.
 */
function renderStepMeta(step) {
  const badge = ACTION_BADGES[step.action] || { style: 'default', label: 'Step' };
  const parts = [
    `<span class="step-action" data-action="${badge.style}">${badge.label}</span>`
  ];

  if (step.fieldName && step.action !== 'navigate' && step.action !== 'screenshot') {
    parts.push(`<span class="step-field">${Utils.escapeHtml(step.fieldName)}</span>`);
  }

  const url = step.action === 'navigate' ? (step.value || step.url) : step.url;
  const path = shortUrl(url);
  if (path) {
    parts.push(`<span class="step-url" title="${Utils.escapeHtml(url)}">${Utils.escapeHtml(path)}</span>`);
  }

  // F-4: steps whose naming prompt was deferred ("Name later").
  if (step.needsName) {
    parts.push(`<span class="step-needs-name" title="Name this field in Table view or edit the description.">Needs a name</span>`);
  }

  if (step.isSensitive) {
    parts.push(
      `<span class="step-redacted" title="This value was masked before saving. Screenshots are not redacted — check them before sharing.">` +
      `<svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>` +
      `Redacted</span>`
    );
  }

  return `<div class="step-meta">${parts.join('')}</div>`;
}

/**
 * Plain-text description of a step. Returns UNESCAPED text: every caller
 * escapes at the point it inserts into HTML (card textarea, table cell, export
 * preview), and one compares against a textarea's already-decoded value.
 * This used to escape field and value here as well, so they were escaped twice
 * and "Terms & Conditions" displayed as "Terms &amp; Conditions" — and saving
 * the card persisted the "&amp;" into the description and every export.
 */
function generateStepDescription(step) {
  const action = step.action || 'Action';
  const field = step.fieldName ? String(step.fieldName).trim() : '';
  const value = step.value ? String(step.value).trim() : '';

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
    case 'keypress':
      // Q-1: Enter in a field outside a form (e.g. a JS search box).
      return `Press ${value || 'Enter'} in ${field || 'field'}`;
    case 'screenshot':
      if (step.isManual) return '📸 Manual screenshot';
      return step.screenshotTrigger === 'navigation' ? '📸 Navigation screenshot' : '📸 Auto screenshot';
    case 'apicall':
      return step.description ? `🌐 ${step.description}` : `🌐 API ${value}`.trim();
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
    textarea.addEventListener('input', () => autosizeTextarea(textarea));
    autosizeTextarea(textarea); // Initial

    textarea.addEventListener('blur', async (e) => {
      const stepId = e.target.dataset.stepId;
      const step = stepsData.find(s => s.id === stepId);
      if (!step) return;

      const newText = e.target.value.trim();
      const oldText = step.description || generateStepDescription(step);

      if (newText && newText !== oldText) {
        const previousDescription = step.description;
        try {
          saveToHistory('edit');
          step.description = newText;
          await trackWrite(storage.updateStep(step));
          showMessage('Step updated', 'success');
        } catch (err) {
          Logger.error('Failed to update step:', err);
          // Restore the in-memory step too — only resetting the textarea left
          // stepsData disagreeing with storage (the P1-6 failure shape).
          step.description = previousDescription;
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
      await moveStep(card.dataset.stepId, e.key === 'ArrowUp' ? -1 : 1);
    });
  });

  // A-3: pointer alternative to dragging. Delegated so it survives re-render.
  document.querySelectorAll('.step-move').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const b = e.currentTarget;
      await moveStep(b.dataset.stepId, b.dataset.dir === 'up' ? -1 : 1);
      // Focus the equivalent button on the card in its new position, so
      // repeated clicks keep working without re-aiming.
      const moved = document.querySelector(
        `.step-card[data-step-id="${CSS.escape(b.dataset.stepId)}"] .step-move[data-dir="${b.dataset.dir}"]`
      );
      if (moved) moved.focus();
    });
  });

  // v1.2: thumbnails open the full-size screenshot.
  document.querySelectorAll('.step-thumb').forEach(btn => {
    btn.addEventListener('click', () => openScreenshotViewer(btn.dataset.stepId));
  });

  // A-3: edge (first/last visible) state is set by applyFilters(), which runs
  // after every render and every filter change. aria-disabled rather than
  // disabled, so the control keeps its place in the tab order.

  // UX-009: dragover/drop are handled once at the container level (see
  // setupEventListeners) so dropping past the last card still works.
}

/**
 * A-4: move one step relative to its neighbours in the VISIBLE list.
 *
 * The previous inline handler took `currentIndex` from the full `stepsData`
 * but then focused `handles[targetIndex]` from `querySelectorAll`, which only
 * returns the cards a filter left on screen. With any search term or action
 * filter active the two index spaces diverge: the move swapped against hidden
 * neighbours (so the visible order appeared not to change) and focus landed on
 * an unrelated step or was dropped to <body> entirely. Nothing was announced.
 *
 * Operating on the filtered list makes "up" and "down" mean what the user sees,
 * and re-querying by data-step-id removes the index/DOM race the 50ms
 * setTimeout was papering over.
 *
 * @param {string} stepId - id of the step to move
 * @param {number} delta  - -1 to move up, +1 to move down
 */
async function moveStep(stepId, delta) {
  const visible = filterSteps();
  const vIdx = visible.findIndex(s => s.id === stepId);
  if (vIdx === -1) return;

  const neighbour = visible[vIdx + delta];
  if (!neighbour) return; // already at the edge of the visible list

  const from = stepsData.findIndex(s => s.id === stepId);
  const to = stepsData.findIndex(s => s.id === neighbour.id);
  if (from === -1 || to === -1) return;

  saveToHistory('reorder');
  const [moved] = stepsData.splice(from, 1);
  stepsData.splice(to, 0, moved);
  await resequenceAndPersist();

  // Re-query by identity, never by index — the list has just re-rendered.
  const handle = document.querySelector(
    `.step-card[data-step-id="${CSS.escape(stepId)}"] .step-handle`
  );
  if (handle) handle.focus();

  // A-4 (WCAG 4.1.3): the move used to be completely silent.
  showMessage(`Step moved to position ${vIdx + delta + 1} of ${visible.length}.`, 'info');
}

// ==================== Add Step Modal ====================

function openAddStepModal(afterStepId, triggerElement) {
  // UX-012: Save trigger so focus can be restored on close
  _modalTriggerElement = triggerElement || document.activeElement;
  insertAfterStepId = afterStepId;
  newStepDescription.value = '';
  newStepAction.value = 'click';
  newStepScreenshotBlob = null;
  // v1.2 port: toggled via the `hidden` attribute rather than style.display,
  // so the markup and the script agree on one mechanism.
  screenshotPreview.hidden = true;
  screenshotPreview.removeAttribute('src');
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
  // Store the File directly so handleConfirmAddStep doesn't race on an async fetch (LOW-025)
  newStepScreenshotBlob = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    screenshotPreview.src = e.target.result;
    screenshotPreview.hidden = false;
    screenshotUpload.classList.add('has-image');
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
        Logger.warn('Failed to convert new screenshot to data URL:', err);
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
      invalidateAssetCache();
    }

    // Save history BEFORE mutation
    saveToHistory('add');

    // Insert into array and resequence + persist
    stepsData.splice(afterStepIndex + 1, 0, newStep);
    await resequenceAndPersist();

    closeAddStepModal();
    showMessage('Step added successfully!', 'success');
  } catch (error) {
    Logger.error('Failed to add step:', error);
    showMessage('Failed to add step: ' + error.message, 'error');
  }
}

// ==================== Step Actions ====================

async function handleDeleteStep(stepId) {
  try {
    // Save history BEFORE mutation
    saveToHistory('delete');

    // UX-017: capture the screenshot asset before deleting so undo can
    // restore it if it's no longer in storage by the time the user clicks undo.
    await captureAssetsForUndo([stepId]);

    // PERF-007: pass sessionId — the review page always knows it, and
    // deleteStep() only scans every session on disk when it isn't given.
    await storage.deleteStep(stepId, sessionId);
    stepsData = stepsData.filter(s => s.id !== stepId);

    // PERF-008: Invalidate asset cache if step had a screenshot
    invalidateAssetCache();

    await resequenceAndPersist();

    // UX-017: Show undo hint in the toast
    showMessageWithUndo('Step deleted');
  } catch (error) {
    Logger.error('Failed to delete step:', error);
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

    // UX-017: capture screenshot assets before deleting (see handleDeleteStep)
    await captureAssetsForUndo(stepIds);

    // PERF-007: pass sessionId so this doesn't scan every session on disk.
    await storage.batchDeleteSteps(stepIds, sessionId);

    stepsData = stepsData.filter(s => !s.selected);

    // PERF-008: invalidate asset cache — same reasoning as handleDeleteStep.
    invalidateAssetCache();

    await resequenceAndPersist();
    showMessage('Selected steps deleted.', 'success');
  } catch (error) {
    Logger.error('Bulk delete failed:', error);
    showMessage('Failed to delete: ' + error.message, 'error');
  }
}

function handleCheckboxChange(e) {
  const stepId = e.target.dataset.stepId;
  const isChecked = e.target.checked;
  const step = stepsData.find(s => s.id === stepId);
  if (step) {
    step.selected = isChecked;
    Logger.info('Step checkbox changed:', stepId, isChecked);
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

// UX-009 fix: find the card whose vertical midpoint the cursor is currently
// above. Returns null when the cursor is below every remaining card, which
// means "insert at the end" — previously that case had no drop target at
// all (per-card dragover only), so dropping past the last step silently
// did nothing.
function getDragAfterElement(container, y) {
  // PERF-008: cards now stay in the DOM (display:none) when filtered out by
  // search, so they must be excluded here too — their getBoundingClientRect()
  // would otherwise return a zeroed rect and skew the distance calculation.
  const cards = [...container.querySelectorAll('.step-card:not(.dragging):not(.is-filtered-out)')];
  return cards.reduce((closest, card) => {
    const box = card.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset, element: card };
    }
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
}

function clearDropIndicator() {
  document.querySelectorAll('.add-between.drag-target').forEach(el =>
    el.classList.remove('drag-target')
  );
}

// The insertion point is shown as an overlay on the existing `.add-between`
// strip (the same one used for the "+" add-step button) instead of a dashed
// border around the whole target card, so the drop point reads as "insert
// here" rather than a card-to-card swap.
function showDropIndicator(afterElement) {
  clearDropIndicator();
  const indicator = afterElement
    ? afterElement.previousElementSibling
    : document.querySelectorAll('.add-between')[document.querySelectorAll('.add-between').length - 1];
  if (indicator && indicator.classList.contains('add-between')) {
    indicator.classList.add('drag-target');
  }
}

function handleContainerDragOver(event) {
  if (!draggedStepId) return;
  event.preventDefault();
  const afterElement = getDragAfterElement(stepsContainer, event.clientY);
  showDropIndicator(afterElement);
}

async function handleContainerDrop(event) {
  if (!draggedStepId) return;
  event.preventDefault();

  const afterElement = getDragAfterElement(stepsContainer, event.clientY);
  clearDropIndicator();

  const fromIndex = stepsData.findIndex(s => s.id === draggedStepId);
  if (fromIndex === -1) return;

  // toIndex is where the dragged step should land relative to the
  // PRE-removal array; null afterElement means "past the last card".
  const toIndex = afterElement
    ? stepsData.findIndex(s => s.id === afterElement.dataset.stepId)
    : stepsData.length;
  if (toIndex === -1) return;

  const insertIndex = toIndex > fromIndex ? toIndex - 1 : toIndex;
  if (insertIndex === fromIndex) return;

  // Save history BEFORE mutation
  saveToHistory('reorder');

  const [moved] = stepsData.splice(fromIndex, 1);
  stepsData.splice(insertIndex, 0, moved);

  await resequenceAndPersist();
}

function handleDragEnd(event) {
  // UX-009: handle is currentTarget; remove classes from parent card
  const handle = event.currentTarget;
  const card = handle ? handle.closest('.step-card') : null;
  if (card) card.classList.remove('dragging');
  draggedStepId = null;
  clearDropIndicator();
  document.querySelectorAll('.step-card.dragging').forEach(el =>
    el.classList.remove('dragging')
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
    sessionStepCount.textContent = stepsData.length;
  }

  await renderSteps();
}

// ==================== Export + Progress ====================

// ==================== v1.2 features (ported) ====================
//
// Re-implemented on the current code rather than copied: v1.2's own versions
// interpolated step.id into attributes unescaped, numbered rows by filtered
// index instead of step.sequence, called a storage variable (fsStorage) that
// does not exist here, and mutated steps before writes with no rollback.

// R-001: current view. Per-viewer convenience, so localStorage (guarded —
// the accessor itself can throw in some contexts).
let currentView = 'cards';
try {
  if (localStorage.getItem('testsnapper_view') === 'table') currentView = 'table';
} catch (_) { /* default to cards */ }

function switchView(view) {
  currentView = view === 'table' ? 'table' : 'cards';
  try { localStorage.setItem('testsnapper_view', currentView); } catch (_) { /* non-critical */ }
  const cardsBtn = document.getElementById('viewCardsBtn');
  const tableBtn = document.getElementById('viewTableBtn');
  cardsBtn?.classList.toggle('active', currentView === 'cards');
  tableBtn?.classList.toggle('active', currentView === 'table');
  cardsBtn?.setAttribute('aria-pressed', String(currentView === 'cards'));
  tableBtn?.setAttribute('aria-pressed', String(currentView === 'table'));
  // "Add step at end" belongs to the card layout.
  const addFooter = document.querySelector('.add-step-footer');
  if (addFooter) addFooter.hidden = currentView === 'table';
}

// Columns a user may edit in the table. A fixed allowlist — data-field is read
// back from the DOM on blur and used as a property key, so it must never be
// free-form.
const TABLE_EDITABLE = {
  fieldName: 'Field name',
  value: 'Value',
  description: 'Description'
};

function tableCellValue(step, field) {
  return field === 'description'
    ? (step.description || generateStepDescription(step))
    : (step[field] || '');
}

function editableCell(step, field, n) {
  return `<td contenteditable="true" class="table-editable" role="textbox"
      data-step-id="${Utils.escapeHtml(step.id)}" data-field="${field}"
      aria-label="${TABLE_EDITABLE[field]} for step ${n}">${Utils.escapeHtml(tableCellValue(step, field))}</td>`;
}

function renderTableView(steps) {
  const container = document.getElementById('tableContainer');
  if (!container) return;
  if (!steps.length) { container.innerHTML = ''; return; }

  const rows = steps.map((s, i) => {
    const n = s.sequence || (i + 1);
    const badge = ACTION_BADGES[s.action] || { style: 'default', label: 'Step' };
    const url = s.action === 'navigate' ? (s.value || s.url) : s.url;
    // Redacted values are read-only. v1.2 made them editable, so correcting a
    // "••••" cell would have overwritten the stored value with mask characters.
    const valueCell = s.isSensitive
      ? `<td class="table-sensitive">${Utils.escapeHtml(s.value || '')} <span class="step-redacted">Redacted</span></td>`
      : editableCell(s, 'value', n);
    return `<tr>
      <td class="table-time">${n}</td>
      <td><span class="step-action" data-action="${badge.style}">${badge.label}</span></td>
      ${editableCell(s, 'fieldName', n)}
      ${valueCell}
      ${editableCell(s, 'description', n)}
      <td class="table-url" title="${Utils.escapeHtml(url || '')}">${Utils.escapeHtml(shortUrl(url))}</td>
      <td class="table-time">${s.timestamp ? Utils.escapeHtml(new Date(s.timestamp).toLocaleTimeString()) : '—'}</td>
    </tr>`;
  }).join('');

  // No Selector column — acd82c4 removed locators, reconfirmed for this port.
  container.innerHTML = `
    <table class="review-table">
      <caption class="visually-hidden">Recorded steps</caption>
      <thead><tr>
        <th scope="col">#</th><th scope="col">Action</th><th scope="col">Field name</th>
        <th scope="col">Value</th><th scope="col">Description</th><th scope="col">URL</th><th scope="col">Time</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;

  container.querySelectorAll('.table-editable').forEach(cell => {
    cell.addEventListener('blur', handleTableCellEdit);
    // Enter commits rather than inserting a line break into a single-line field.
    cell.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); cell.blur(); }
    });
  });
}

async function handleTableCellEdit(e) {
  const cell = e.currentTarget;
  const field = cell.dataset.field;
  if (!Object.prototype.hasOwnProperty.call(TABLE_EDITABLE, field)) return;
  const step = stepsData.find(s => s.id === cell.dataset.stepId);
  if (!step) return;

  const newVal = cell.innerText.trim();
  const oldVal = tableCellValue(step, field);
  if (newVal === oldVal) return;

  saveToHistory('edit');
  const previous = step[field];
  const previousNeedsName = step.needsName;
  step[field] = newVal;
  // Naming the field resolves a deferred "Name later" (F-4).
  if (field === 'fieldName' && newVal) delete step.needsName;
  try {
    await trackWrite(storage.updateStep(step));
  } catch (err) {
    // Roll back — otherwise the table shows an edit that was never persisted
    // (the same failure shape as P1-6).
    step[field] = previous;
    if (previousNeedsName) step.needsName = previousNeedsName;
    cell.innerText = oldVal;
    showMessage(`Couldn't save that edit — ${err.message}. The previous value was restored.`, 'error');
  }
}

// R-004: export configuration. Per-viewer convenience, so localStorage.
const SCREENSHOT_SIZES = ['full', 'medium', 'small'];

function readExportConfig() {
  const size = document.getElementById('ecScreenshotSize')?.value;
  const config = {
    includeScreenshots: document.getElementById('ecIncludeScreenshots')?.checked !== false,
    screenshotSize: SCREENSHOT_SIZES.includes(size) ? size : 'full'
  };
  try { localStorage.setItem('testsnapper_export_config', JSON.stringify(config)); } catch (_) { /* non-critical */ }
  return config;
}

function restoreExportConfig() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('testsnapper_export_config') || 'null'); } catch (_) { /* ignore */ }
  if (!saved || typeof saved !== 'object') return;
  const include = document.getElementById('ecIncludeScreenshots');
  const size = document.getElementById('ecScreenshotSize');
  if (include && typeof saved.includeScreenshots === 'boolean') include.checked = saved.includeScreenshots;
  if (size && SCREENSHOT_SIZES.includes(saved.screenshotSize)) size.value = saved.screenshotSize;
}

function showExportPreview() {
  const config = readExportConfig();
  const content = document.getElementById('exportPreviewContent');
  if (!content) return;
  // Exports include every step in sequence order regardless of on-screen
  // filters, so the preview does too — otherwise it would misrepresent the file.
  const preview = [...stepsData]
    .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
    .slice(0, 5);
  const sizeLabel = { full: 'full size', medium: '800px', small: '400px' }[config.screenshotSize];
  const rows = preview.map(s => {
    const badge = ACTION_BADGES[s.action] || { style: 'default', label: 'Step' };
    return `<tr>
      <td class="table-time">${s.sequence || ''}</td>
      <td><span class="step-action" data-action="${badge.style}">${badge.label}</span></td>
      <td>${Utils.escapeHtml(s.description || generateStepDescription(s))}</td>
    </tr>`;
  }).join('');
  content.innerHTML = `
    <p class="preview-note">Screenshots: ${config.includeScreenshots ? `included (${sizeLabel})` : 'omitted'} ·
      ${stepsData.length} step${stepsData.length === 1 ? '' : 's'} in the full export.</p>
    <table class="review-table">
      <thead><tr><th scope="col">#</th><th scope="col">Action</th><th scope="col">Step</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  openDialog(document.getElementById('exportPreviewModal'));
}

// R-003: privacy audit, driven by the authoritative isSensitive flag. v1.2
// counted redactions by matching the literal strings '[REDACTED]' and '***',
// but the redactor writes '••••••••', '***-**-****', '**** **** **** ****' and
// others — so its count was effectively always zero.
function showPrivacyAudit() {
  const content = document.getElementById('privacyAuditContent');
  if (!content) return;
  const redacted = [...stepsData]
    .filter(s => s.isSensitive)
    .sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  const withShots = redacted.filter(s => _assetCache && _assetCache.has(s.id)).length;

  let html = `<p class="audit-summary"><strong>${redacted.length}</strong> value${redacted.length === 1 ? '' : 's'} masked before saving.</p>`;
  if (withShots) {
    html += `<p class="audit-warning">Of these, <strong>${withShots}</strong> ${withShots === 1 ? 'has' : 'have'} a screenshot.
      Screenshots are <strong>not</strong> redacted — the value may be visible in the image. Review them before sharing.</p>`;
  }
  if (redacted.length) {
    html += `<table class="review-table">
      <thead><tr><th scope="col">#</th><th scope="col">Field</th><th scope="col">Stored value</th><th scope="col">Screenshot</th></tr></thead>
      <tbody>${redacted.map(s => `<tr>
        <td class="table-time">${s.sequence || ''}</td>
        <td>${Utils.escapeHtml(s.fieldName || '—')}</td>
        <td class="table-sensitive">${Utils.escapeHtml(s.value || '—')}</td>
        <td>${_assetCache && _assetCache.has(s.id) ? 'Yes — review' : '—'}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  } else {
    html += '<p class="audit-empty">No values in this session were identified as sensitive.</p>';
  }
  content.innerHTML = html;
  openDialog(document.getElementById('privacyAuditModal'));
}

function setupV12Features() {
  switchView(currentView);
  restoreExportConfig();

  // Descriptions were sized once at render and never again, so resizing the
  // window re-wrapped the text inside a fixed height and clipped it.
  window.addEventListener('resize', debounce(() => {
    document.querySelectorAll('.step-description-area').forEach(autosizeTextarea);
  }, 150));

  document.getElementById('viewCardsBtn')?.addEventListener('click', () => { switchView('cards'); renderSteps(); });
  document.getElementById('viewTableBtn')?.addEventListener('click', () => { switchView('table'); renderSteps(); });
  document.getElementById('previewExportBtn')?.addEventListener('click', showExportPreview);
  document.getElementById('privacyAuditBtn')?.addEventListener('click', showPrivacyAudit);
  document.getElementById('ecIncludeScreenshots')?.addEventListener('change', readExportConfig);
  document.getElementById('ecScreenshotSize')?.addEventListener('change', readExportConfig);

  wireDialog(document.getElementById('screenshotViewer'), document.getElementById('closeScreenshotViewer'));
  wireDialog(document.getElementById('exportPreviewModal'), document.getElementById('closeExportPreview'));
  wireDialog(document.getElementById('privacyAuditModal'), document.getElementById('closePrivacyAudit'));

}

// ==================== Generic dialog helper (v1.2 port) ====================
//
// The v1.2 design adds three dialogs (screenshot viewer, export preview,
// privacy audit). v1.2's own versions were bare <div>s shown with inline
// display:flex — no role, no focus management, no Escape, background still
// tabbable. Rather than repeat A-7's fix three times, they share this helper.

const _dialogReturnFocus = new WeakMap();

function openDialog(overlay) {
  if (!overlay) return;
  _dialogReturnFocus.set(overlay, document.activeElement);
  overlay.classList.add('active');
  const appWrapper = document.querySelector('.app-wrapper');
  if (appWrapper) appWrapper.inert = true;
  const first = overlay.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (first) first.focus();
}

function closeDialog(overlay) {
  if (!overlay || !overlay.classList.contains('active')) return;
  overlay.classList.remove('active');
  // Only release inert when no other dialog is still open.
  if (!document.querySelector('.modal-overlay.active')) {
    const appWrapper = document.querySelector('.app-wrapper');
    if (appWrapper) appWrapper.inert = false;
  }
  const back = _dialogReturnFocus.get(overlay);
  if (back && typeof back.focus === 'function') back.focus();
}

/** Wire close button, backdrop click and Escape for a dialog overlay. */
function wireDialog(overlay, closeBtn) {
  if (!overlay) return;
  if (closeBtn) closeBtn.addEventListener('click', () => closeDialog(overlay));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeDialog(overlay); });
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDialog(overlay); }
  });
}

function openScreenshotViewer(stepId) {
  const overlay = document.getElementById('screenshotViewer');
  const img = document.getElementById('screenshotViewerImg');
  const title = document.getElementById('screenshotViewerTitle');
  const thumb = document.querySelector(`.step-thumb[data-step-id="${CSS.escape(stepId)}"] img`);
  if (!overlay || !img || !thumb) return;
  const step = stepsData.find(s => s.id === stepId);
  const n = step?.sequence || '';
  img.src = thumb.src;
  img.alt = `Screenshot for step ${n}`;
  img.hidden = false;
  if (title) title.textContent = n ? `Step ${n} — screenshot` : 'Screenshot';
  openDialog(overlay);
}

// A-7: remembers what to hand focus back to when the export modal closes.
let _progressTriggerElement = null;

function showProgressModal() {
  if (!progressModal) return;
  _progressTriggerElement = document.activeElement;
  progressModal.classList.add('active');
  updateProgressUI(0, 'Starting export...');

  // A-7 (WCAG 2.4.3/2.1.2): focus stayed on the Export button BEHIND the scrim,
  // and Tab walked every step textarea underneath the overlay. Move focus in
  // and make the rest of the page inert for the duration.
  const appWrapper = document.querySelector('.app-wrapper') || document.querySelector('main');
  if (appWrapper) appWrapper.inert = true;
  if (cancelExportBtn) cancelExportBtn.focus();
}

function hideProgressModal() {
  if (!progressModal) return;
  progressModal.classList.remove('active');
  const appWrapper = document.querySelector('.app-wrapper') || document.querySelector('main');
  if (appWrapper) appWrapper.inert = false;
  if (_progressTriggerElement && typeof _progressTriggerElement.focus === 'function') {
    _progressTriggerElement.focus();
  }
  _progressTriggerElement = null;
}

// FUNC-009: shared by the local export's progressCallback (exportSession runs
// in-process now — there is no background 'exportProgress' message to listen for).
function updateProgressUI(percent, status) {
  const circle = document.getElementById('progressCircle');
  const pct = Math.round(percent || 0);
  if (progressPercent) {
    progressPercent.textContent = `${pct}%`;
    // A-7: expose progress to assistive tech, not just to sighted users.
    progressPercent.setAttribute('aria-valuenow', String(pct));
    progressPercent.setAttribute('aria-valuetext', `${pct} percent`);
  }
  if (progressStatus) progressStatus.textContent = status || 'Exporting...';
  if (circle) circle.style.strokeDashoffset = 125.6 - (pct / 100) * 125.6;
}

async function handleSaveAndExport() {
  // P1-9: saveExportBtn was never disabled, so the natural response to an
  // apparently-hung export (click it again) launched a SECOND concurrent export
  // of the same session.
  if (saveExportBtn.disabled) return;
  saveExportBtn.disabled = true;

  try {
    showMessage('Saving changes...', 'info');
    await saveSessionName();

    const format = exportFormatSelect.value;
    showProgressModal();

    // R-004: the Configure Export panel's choices reach the export.
    const result = await exportService.exportSession(sessionId, format, (progress) => {
      updateProgressUI(progress.percent || 0, progress.status);
    }, readExportConfig());

    let downloadUrl;
    const filename = result.filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');

    if (result.blob) {
      downloadUrl = URL.createObjectURL(result.blob);
    } else {
      const utf8Bytes = new TextEncoder().encode(result.content);
      let binary = '';
      for (let i = 0; i < utf8Bytes.length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, utf8Bytes.subarray(i, i + 0x8000));
      }
      downloadUrl = `data:${result.mimeType};charset=utf-8;base64,${btoa(binary)}`;
    }

    await chrome.downloads.download({ url: downloadUrl, filename, saveAs: false, conflictAction: 'uniquify' });
    // P1-9: revoking on the next line races the download's own read of the
    // blob. chrome.downloads.download resolves when the item is CREATED, not
    // when the bytes have been consumed.
    if (result.blob) setTimeout(() => URL.revokeObjectURL(downloadUrl), 60000);

    hideProgressModal();
    // P2-6: .docx is built with the bundled docx library; if that fails to
    // load, the service falls back to a Word-compatible HTML .doc. Say so.
    if (format === 'docx' && !/\.docx$/i.test(filename)) {
      showMessage('Exported as a Word-compatible .doc — the .docx library could not load. Word opens it, but tools that read .docx may not.', 'warning');
    } else {
      showMessage(`Exported as ${format.toUpperCase()} successfully!`, 'success');
    }
  } catch (error) {
    hideProgressModal();
    // FUNC-009: a user-triggered cancelExport() surfaces here as a thrown
    // error from exportSession — show it as a neutral cancellation, not a failure.
    if (/cancel/i.test(error?.message || '')) {
      showMessage('Export cancelled.', 'info');
    } else {
      Logger.error('Save and export failed:', error);
      showMessage(
        `Export failed — ${error.message}. Your session is safe; CSV and JSON don't need the Word/PDF libraries.`,
        'error'
      );
    }
  } finally {
    // FUNC-009: clear the cancel flag, or the NEXT export would be treated as
    // pre-cancelled and abort before it starts.
    exportService.resetCancellation(sessionId);
    saveExportBtn.disabled = false;
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
  messageDiv.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = text + ' — ';
  // A-1 (4.1.2): a real <button>, not <a href="#"> with a click handler.
  const undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.className = 'link-button';
  undoBtn.textContent = 'Undo';
  undoBtn.addEventListener('click', () => {
    messageDiv.style.display = 'none';
    undo();
  });
  messageDiv.appendChild(span);
  messageDiv.appendChild(undoBtn);
  messageDiv.className = 'message success';
  messageDiv.style.display = 'block';
  // F-18 / WCAG 2.2.1: this vanished after 6 seconds, and it is the one
  // affordance for recovering deleted steps — a slower reader, or anyone who
  // glanced away, lost it for good. It now stays until the next message
  // replaces it. (Ctrl+Z / the header Undo button still work regardless.)
}

function hideMessage() {
  messageDiv.style.display = 'none';
}

// ==================== Initialize ====================

document.addEventListener('DOMContentLoaded', init);