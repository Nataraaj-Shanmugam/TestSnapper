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
import { DomUtils } from '../../core/dom-utils.js';
import { deduplicateConsecutiveSteps } from '../../core/step-utils.js';
import { setupTheme } from '../theme.js';

// ==================== Initialize Services ====================

const fsStorage = new FSStorageManager();
const exportService = new ExportService(fsStorage);

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

// View mode (cards | table)
let currentView = localStorage.getItem('testsnapper_view') || 'cards';

// ==================== Consecutive Duplicate Removal ====================
// deduplicateConsecutiveSteps is imported from ../../core/step-utils.js

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

// ==================== Utils ====================

// ==================== Toast Notifications ====================

function showToastNotification(message, type = 'info') {
  const toast = document.createElement('div');
  const colors = { success: '#22c55e', error: '#ef4444', warning: '#f59e0b', info: '#3b82f6' };
  toast.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;padding:10px 16px;border-radius:8px;background:${colors[type]||colors.info};color:#fff;font-size:13px;font-weight:500;box-shadow:0 4px 12px rgba(0,0,0,0.2);transition:opacity 0.3s`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2800);
}

// ==================== R-002: Selector Stability ====================

function getSelectorStability(selector) {
  if (!selector) return { label: 'Unknown', color: '#6b7280', reason: 'No selector' };
  if (selector.startsWith('#') || /^[a-zA-Z]+$/.test(selector)) return { label: 'Stable', color: '#22c55e', reason: 'ID selector' };
  if (selector.includes('[data-testid') || selector.includes('[data-test')) return { label: 'Stable', color: '#22c55e', reason: 'Test attribute' };
  if (selector.startsWith('//*[@id=')) return { label: 'Stable', color: '#22c55e', reason: 'XPath by ID' };
  if (selector.includes('nth-child') || selector.includes('nth-of-type')) return { label: 'Fragile', color: '#ef4444', reason: 'Position-dependent' };
  if ((selector.match(/\./g) || []).length >= 4) return { label: 'Fragile', color: '#ef4444', reason: 'Complex class chain' };
  return { label: 'OK', color: '#f59e0b', reason: 'Attribute/class selector' };
}

// ==================== R-001: View Toggle ====================

function switchView(view) {
  currentView = view;
  try { localStorage.setItem('testsnapper_view', view); } catch(e) {}
  const cardsContainer = document.getElementById('stepsContainer');
  const tableContainer = document.getElementById('tableContainer');
  const cardsBtn = document.getElementById('viewCardsBtn');
  const tableBtn = document.getElementById('viewTableBtn');
  if (cardsContainer) cardsContainer.style.display = view === 'cards' ? '' : 'none';
  if (tableContainer) tableContainer.style.display = view === 'table' ? '' : 'none';
  if (cardsBtn) cardsBtn.classList.toggle('active', view === 'cards');
  if (tableBtn) tableBtn.classList.toggle('active', view === 'table');
}

function renderTableView(steps) {
  const container = document.getElementById('tableContainer');
  if (!container) return;
  if (!steps || steps.length === 0) { container.innerHTML = '<p style="padding:24px;color:var(--text-muted)">No steps to display.</p>'; return; }
  const rows = steps.map((s, i) => `
    <tr>
      <td style="width:36px;text-align:center;color:var(--text-muted)">${i + 1}</td>
      <td>${Utils.escapeHtml(s.action || '')}</td>
      <td contenteditable="true" data-step-id="${s.id}" data-field="fieldName" class="table-editable">${Utils.escapeHtml(s.fieldName || '')}</td>
      <td contenteditable="true" data-step-id="${s.id}" data-field="value" class="table-editable">${Utils.escapeHtml(s.value || '')}</td>
      <td contenteditable="true" data-step-id="${s.id}" data-field="notes" class="table-editable">${Utils.escapeHtml(s.notes || '')}</td>
      <td class="table-selector">${Utils.escapeHtml(s.selector?.css || '—')}</td>
      <td class="table-url">${Utils.escapeHtml((s.url || '').replace(/^https?:\/\/[^/]+/, ''))}</td>
      <td style="white-space:nowrap;font-size:11px;color:var(--text-muted)">${s.timestamp ? new Date(s.timestamp).toLocaleTimeString() : '—'}</td>
    </tr>`).join('');
  container.innerHTML = `
    <table class="review-table">
      <thead><tr>
        <th>#</th><th>Action</th><th>Field Name</th><th>Value</th><th>Notes</th><th>Selector</th><th>URL</th><th>Time</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  container.querySelectorAll('.table-editable').forEach(cell => {
    cell.addEventListener('blur', handleTableCellEdit);
  });
}

async function handleTableCellEdit(e) {
  const cell = e.target;
  const stepId = cell.dataset.stepId;
  const field = cell.dataset.field;
  const newVal = cell.innerText.trim();
  const step = stepsData.find(s => s.id === stepId);
  if (!step || step[field] === newVal) return;
  try {
    step[field] = newVal;
    await fsStorage.updateStep(step);
  } catch(err) {
    console.error('Table cell edit failed:', err);
  }
}

// ==================== R-004: Export Config ====================

function readExportConfig() {
  const config = {
    includeScreenshots: document.getElementById('ecIncludeScreenshots')?.checked !== false,
    includeSelectors: document.getElementById('ecIncludeSelectors')?.checked !== false,
    onlyFailed: document.getElementById('ecOnlyFailed')?.checked || false,
    screenshotSize: document.getElementById('ecScreenshotSize')?.value || 'medium'
  };
  try { localStorage.setItem('testsnapper_export_config', JSON.stringify(config)); } catch(e) {}
  return config;
}

function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ==================== Initialization ====================

async function init() {
  showMessage('Initializing...', 'info');

  try {
    await fsStorage.init();

    const urlParams = new URLSearchParams(window.location.search);
    sessionId = urlParams.get('sessionId');

    if (!sessionId) {
      showMessage('No session ID provided in URL', 'error');
      return;
    }

    // Flush buffered session to disk if needed (review opens right after recording stops)
    await flushIfPending(sessionId);

    await loadSession();
    setupEventListeners();
    setupTheme();
  } catch (error) {
    console.error('Initialization failed:', error);
    showMessage('Failed to initialize: ' + error.message, 'error');
  }
}

/**
 * Flush a buffered session to disk if it hasn't been flushed yet.
 */
async function flushIfPending(sid) {
  const fsReady = await fsStorage.isFilesystemReady();
  if (!fsReady) return;

  const inBuffer = await fsStorage.isInBuffer(sid);
  if (!inBuffer) return;

  showMessage('Saving session to disk...', 'info');
  const success = await fsStorage.flushSession(sid);
  if (success) {
    chrome.runtime.sendMessage({ action: 'clearBuffer', sessionId: sid }).catch(() => {});
  }
}

// setupTheme / applyTheme imported from ../theme.js

function setupEventListeners() {
  bulkDeleteBtn.addEventListener('click', handleBulkDelete);
  saveExportBtn.addEventListener('click', handleSaveAndExport);
  cancelBtn.addEventListener('click', () => window.close());

  // Session name auto-save
  sessionNameInput.addEventListener('blur', saveSessionName);

  // Add Step Modal
  screenshotUpload.addEventListener('click', () => screenshotInput.click());
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

  // Keyboard shortcuts: Ctrl/Cmd+Z
  document.addEventListener('keydown', (e) => {
    const meta = e.metaKey;
    const ctrl = e.ctrlKey;

    if ((ctrl || meta) && !e.altKey) {
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
    }
  });

  // Cancel export
  if (cancelExportBtn) {
    cancelExportBtn.addEventListener('click', async () => {
      try {
        await chrome.runtime.sendMessage({
          action: 'cancelExport',
          sessionId
        });
      } catch (err) {
        console.error('Failed to send cancelExport:', err);
      }
      hideProgressModal();
      showMessage('Export cancelled.', 'info');
    });
  }

  // Listen for export progress and storage flush events from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'exportProgress') {
      handleExportProgress(message);
    } else if (message.action === 'flushRecordingBuffer' && message.sessionId === sessionId) {
      flushIfPending(message.sessionId);
    }
  });

  // R-001: View toggle
  document.getElementById('viewCardsBtn')?.addEventListener('click', () => { switchView('cards'); renderSteps(); });
  document.getElementById('viewTableBtn')?.addEventListener('click', () => { switchView('table'); renderSteps(); });

  // R-004: Export preview
  document.getElementById('previewExportBtn')?.addEventListener('click', () => {
    const config = readExportConfig();
    let steps = config.onlyFailed ? stepsData.filter(s => s.failed) : stepsData;
    const preview = steps.slice(0, 5);
    const rows = preview.map((s, i) => `<tr>
      <td style="padding:6px 10px;border-bottom:1px solid var(--border-default)">${i+1}</td>
      <td style="padding:6px 10px;border-bottom:1px solid var(--border-default)">${Utils.escapeHtml(s.action||'')}</td>
      <td style="padding:6px 10px;border-bottom:1px solid var(--border-default)">${Utils.escapeHtml(s.fieldName||'')}</td>
      <td style="padding:6px 10px;border-bottom:1px solid var(--border-default)">${Utils.escapeHtml(s.value||'')}</td>
      <td style="padding:6px 10px;border-bottom:1px solid var(--border-default)">${Utils.escapeHtml(s.notes||'')}</td>
    </tr>`).join('');
    document.getElementById('exportPreviewContent').innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr style="background:var(--bg-surface)">
        <th style="padding:6px 10px;text-align:left;font-weight:600">#</th>
        <th style="padding:6px 10px;text-align:left;font-weight:600">Action</th>
        <th style="padding:6px 10px;text-align:left;font-weight:600">Field</th>
        <th style="padding:6px 10px;text-align:left;font-weight:600">Value</th>
        <th style="padding:6px 10px;text-align:left;font-weight:600">Notes</th>
      </tr></thead><tbody>${rows}</tbody></table>`;
    const modal = document.getElementById('exportPreviewModal');
    if (modal) modal.style.display = 'flex';
  });
  document.getElementById('closeExportPreview')?.addEventListener('click', () => {
    document.getElementById('exportPreviewModal').style.display = 'none';
  });

  // R-008: Remember all field names
  document.getElementById('rememberAllFieldsBtn')?.addEventListener('click', async () => {
    let count = 0;
    for (const step of stepsData) {
      if (step.fieldName && step.selector?.css) {
        await chrome.runtime.sendMessage({ action: 'saveFieldNameMemory', fingerprint: step.selector.css, fieldName: step.fieldName });
        count++;
      }
    }
    showToastNotification(`Remembered ${count} field name(s)`, 'success');
  });

  // R-003: Privacy audit
  document.getElementById('privacyAuditBtn')?.addEventListener('click', () => {
    const sensitiveSteps = stepsData.filter(s => s.isSensitive || /password|secret|token|key|auth/i.test(s.fieldName || ''));
    const redactedSteps = stepsData.filter(s => s.value === '[REDACTED]' || s.value === '***');
    let html = `<p style="margin-bottom:12px"><strong>${sensitiveSteps.length}</strong> sensitive field(s) &nbsp;|&nbsp; <strong>${redactedSteps.length}</strong> redacted value(s)</p>`;
    if (sensitiveSteps.length) {
      html += `<table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:var(--bg-surface)">
          <th style="padding:6px 10px;text-align:left">Field</th>
          <th style="padding:6px 10px;text-align:left">Action</th>
          <th style="padding:6px 10px;text-align:left">Value (preview)</th>
        </tr></thead><tbody>`;
      for (const s of sensitiveSteps) {
        const preview = (s.value || '').length > 20 ? s.value.slice(0, 20) + '…' : (s.value || '—');
        html += `<tr>
          <td style="padding:6px 10px;border-bottom:1px solid var(--border-default)">${Utils.escapeHtml(s.fieldName || '—')}</td>
          <td style="padding:6px 10px;border-bottom:1px solid var(--border-default)">${Utils.escapeHtml(s.action || '—')}</td>
          <td style="padding:6px 10px;border-bottom:1px solid var(--border-default)"><code>${Utils.escapeHtml(preview)}</code></td>
        </tr>`;
      }
      html += '</tbody></table>';
    } else {
      html += '<p style="color:var(--text-muted)">No sensitive fields detected.</p>';
    }
    document.getElementById('privacyAuditContent').innerHTML = html;
    const modal = document.getElementById('privacyAuditModal');
    if (modal) modal.style.display = 'flex';
  });
  document.getElementById('closePrivacyAudit')?.addEventListener('click', () => {
    document.getElementById('privacyAuditModal').style.display = 'none';
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

    sessionData = await fsStorage.getSession(sessionId);

    if (!sessionData) {
      throw new Error('Session not found');
    }

    stepsData = await fsStorage.getSteps(sessionId);
    stepsData.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

    // Auto-remove consecutive duplicate steps (same action + fieldName + selector + url)
    const originalCount = stepsData.length;
    stepsData = deduplicateConsecutiveSteps(stepsData);
    if (stepsData.length < originalCount) {
      console.log(`🧹 Removed ${originalCount - stepsData.length} consecutive duplicate step(s)`);
      // Resequence and persist the cleaned data
      stepsData.forEach((step, index) => { step.sequence = index + 1; });
      await fsStorage.updateAllSteps(sessionId, stepsData);
    }

    // Update UI
    sessionNameInput.value = sessionData.sessionName ||
      `Session ${Utils.formatTimestamp(sessionData.createdAt)}`;
    sessionDate.textContent = `Created: ${Utils.formatTimestamp(sessionData.createdAt)}`;
    sessionStepCount.textContent = `Steps: ${stepsData.length}`;

    // Initialize history with initial state
    history = [];
    historyIndex = -1;
    if (stepsData.length > 0) {
      saveToHistory('initial');
    } else {
      updateHistoryButtons();
    }

    await renderSteps();
    switchView(currentView);
    hideMessage();

    // R-004: Restore export config from localStorage
    try {
      const saved = JSON.parse(localStorage.getItem('testsnapper_export_config') || '{}');
      if (saved.includeScreenshots === false) { const el = document.getElementById('ecIncludeScreenshots'); if (el) el.checked = false; }
      if (saved.includeSelectors === false) { const el = document.getElementById('ecIncludeSelectors'); if (el) el.checked = false; }
      if (saved.onlyFailed === true) { const el = document.getElementById('ecOnlyFailed'); if (el) el.checked = true; }
      if (saved.screenshotSize) { const el = document.getElementById('ecScreenshotSize'); if (el) el.value = saved.screenshotSize; }
    } catch(e) {}

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
      sessionNameInput.value = newName;
      await fsStorage.updateSessionName(sessionData.sessionId, newName);
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
  const snapshot = JSON.parse(JSON.stringify(stepsData));

  // Truncate future if we are in the middle
  if (historyIndex < history.length - 1) {
    history = history.slice(0, historyIndex + 1);
  }

  history.push({ action: actionLabel, steps: snapshot });

  if (history.length > MAX_HISTORY) {
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
  const snapshot = history[historyIndex].steps;
  stepsData = JSON.parse(JSON.stringify(snapshot));

  // Persist to DB
  await fsStorage.updateAllSteps(sessionId, stepsData);
  if (sessionData) {
    sessionData.stepCount = stepsData.length;
    await fsStorage.updateSession(sessionData);
    sessionStepCount.textContent = `Steps: ${stepsData.length}`;
  }

  await renderSteps();
  updateHistoryButtons();
}

function undo() {
  if (historyIndex <= 0) return;
  restoreFromHistory(historyIndex - 1);
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
function resolveScreenshotUrl(asset) {
  // Screenshots are stored as base64 data URLs in the filesystem format
  if (typeof asset.dataUrl === 'string' && asset.dataUrl.length > 0) return asset.dataUrl;
  // Legacy fallback for chrome.storage assets
  if (typeof asset.data === 'string' && asset.data.length > 0) return asset.data;
  return null;
}

async function renderSteps() {
  const container = stepsContainer;

  if (!stepsData || stepsData.length === 0) {
    container.innerHTML = '<div class="loading" style="text-align: center; padding: 40px;">No steps recorded. Start a session to see steps here!</div>';
    if (stepResultsSummary) stepResultsSummary.textContent = '';
    if (noResultsMsg) noResultsMsg.classList.add('hidden');
    return;
  }

  // ---------- Load screenshots ----------
  const screenshotAssets = await fsStorage.getAllAssets(sessionId);
  const screenshotMap = new Map();

  for (const asset of screenshotAssets) {
    const url = resolveScreenshotUrl(asset);
    if (url) screenshotMap.set(asset.stepId, url);
  }
  // ---------- End screenshot loading ----------

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
    if (currentView === 'table') renderTableView([]);
    return;
  }

  if (currentView === 'table') {
    renderTableView(visibleSteps);
    return;
  }

  container.innerHTML = visibleSteps.map((step, index) => {
    const description = step.description || Utils.generateStepDescription(step);
    const screenshotData = screenshotMap.get(step.id) || null;
    const safeDescription = Utils.escapeHtml(description);

    return `
      <div class="add-between">
         <button class="btn-add" data-before-step-id="${step.id}" title="Add step here">+</button>
      </div>
      <div class="step-card" data-step-id="${step.id}" draggable="true">
        <div class="step-number-badge">${index + 1}</div>

        <!-- FIX 2: align-items: flex-start keeps checkbox / handle / delete
             pinned to the TOP of the card even when the screenshot makes
             .step-main tall. -->
        <div class="step-top" style="align-items: flex-start;">

          <!-- drag handle -->
          <div class="step-handle" title="Drag to reorder" style="font-size: 20px; padding-top: 10px;">⋮⋮</div>

          <!-- checkbox – fixed width, top-aligned -->
          <div style="display: flex; align-items: flex-start; justify-content: center; width: 40px; flex-shrink: 0; padding-top: 8px;">
            <input type="checkbox" class="step-checkbox" data-step-id="${step.id}"
                   ${step.selected ? 'checked' : ''}
                   style="width: 22px; height: 22px; cursor: pointer; accent-color: var(--accent);">
          </div>

          <!-- main content (textarea + optional screenshot) -->
          <div class="step-main">
            <textarea
              class="step-description-area"
              data-step-id="${step.id}"
              placeholder="Describe this step..."
              rows="1">${safeDescription}</textarea>

            ${screenshotData ? `
              <div class="screenshot-container" id="img-${step.id}" data-step-id="${step.id}">
                <img src="${screenshotData}" alt="Interaction Screenshot" loading="lazy">
              </div>
            ` : ''}
          </div>

          <!-- delete button – top-aligned -->
          <div class="step-actions" style="flex-shrink: 0; padding-top: 4px; display:flex; flex-direction:column; gap:4px;">
            <button class="delete-btn" title="Delete Step" data-step-id="${step.id}">
              ✕
            </button>
            <!-- R-010: Retake screenshot -->
            <button class="retake-screenshot-btn" title="Retake screenshot" data-step-id="${step.id}" style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--text-muted);padding:2px;">↺</button>
          </div>
        </div>
        <!-- R-002: Selector Inspector -->
        ${(() => {
          const cssSt = getSelectorStability(step.selector?.css || '');
          const xpathSt = getSelectorStability(step.selector?.xpath || '');
          return `<div class="selector-inspector">
            <button class="inspector-toggle-btn">Selector Inspector ▸</button>
            <div class="inspector-panel" style="display:none">
              <div class="inspector-row">
                <span class="inspector-label">CSS</span>
                <code class="inspector-code">${Utils.escapeHtml(step.selector?.css || '—')}</code>
                <span class="stability-badge" style="background:${cssSt.color}">${cssSt.label}</span>
                <button class="copy-selector-btn" data-val="${Utils.escapeHtml(step.selector?.css || '')}">Copy</button>
              </div>
              <div class="inspector-row">
                <span class="inspector-label">XPath</span>
                <code class="inspector-code">${Utils.escapeHtml(step.selector?.xpath || '—')}</code>
                <span class="stability-badge" style="background:${xpathSt.color}">${xpathSt.label}</span>
                <button class="copy-selector-btn" data-val="${Utils.escapeHtml(step.selector?.xpath || '')}">Copy</button>
              </div>
              <div class="inspector-reason">${Utils.escapeHtml(cssSt.reason)}</div>
            </div>
          </div>`;
        })()}
      </div>
      ${index === visibleSteps.length - 1 ? `
        <div class="add-between">
           <button class="btn-add" data-after-last="true" title="Add step at the end">+</button>
        </div>
      ` : ''}
    `;
  }).join('');

  attachStepEventListeners();
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
        openAddStepModal(stepsData[stepsData.length - 1]?.id);
      } else {
        const index = stepsData.findIndex(s => s.id === stepId);
        const targetId = index > 0 ? stepsData[index - 1].id : null;
        openAddStepModal(targetId);
      }
    })
  );

  // R-010: Retake screenshot buttons
  document.querySelectorAll('.retake-screenshot-btn').forEach(btn =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleRetakeScreenshot(btn.dataset.stepId);
    })
  );

  // R-002: Selector inspector toggles
  document.querySelectorAll('.inspector-toggle-btn').forEach(btn =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const panel = btn.nextElementSibling;
      const open = panel.style.display !== 'none';
      panel.style.display = open ? 'none' : 'flex';
      btn.textContent = open ? 'Selector Inspector ▸' : 'Selector Inspector ▾';
    })
  );

  // R-002: Copy selector buttons
  document.querySelectorAll('.copy-selector-btn').forEach(btn =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      navigator.clipboard.writeText(btn.dataset.val || '').then(() => {
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = orig; }, 1500);
      }).catch(() => {});
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
      const oldText = step.description || Utils.generateStepDescription(step);

      if (newText && newText !== oldText) {
        try {
          saveToHistory('edit');
          step.description = newText;
          await fsStorage.updateStep(step);
          showMessage('Step updated', 'success');
            } catch (err) {
          console.error('Failed to update step:', err);
          showMessage('Failed to update step: ' + err.message, 'error');
          e.target.value = oldText;
        }
      }
    });
  });

  document.querySelectorAll('.step-card').forEach(card => {
    card.addEventListener('dragstart', handleDragStart);
    card.addEventListener('dragover', handleDragOver);
    card.addEventListener('drop', handleDrop);
    card.addEventListener('dragend', handleDragEnd);
    card.addEventListener('dragleave', handleDragLeave);
  });
}

// ==================== Add Step Modal ====================

function openAddStepModal(afterStepId) {
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
    await fsStorage.addStep(newStep);

    if (newStepScreenshotBlob) {
      let dataUrl = null;
      try {
        dataUrl = await Utils.blobToDataURL(newStepScreenshotBlob);
      } catch (err) {
        console.warn('Failed to convert new screenshot to data URL:', err);
      }

      if (dataUrl) {
        await fsStorage.addAsset({
          id: Utils.generateUUID(),
          sessionId: sessionId,
          stepId: newStep.id,
          type: 'screenshot',
          dataUrl,
          createdAt: new Date().toISOString()
        });
      }
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

// R-010: Retake screenshot for a specific step
async function handleRetakeScreenshot(stepId) {
  try {
    const result = await chrome.runtime.sendMessage({ action: 'captureScreenshot', trigger: 'manual' });
    if (result && result.success && result.stepId) {
      // The background creates a new screenshot step — link the asset to this step instead
      // For simplicity: show a toast; the new screenshot appears as its own step at the end
      showToastNotification('Screenshot captured — it appears as the last step', 'info');
    } else {
      showToastNotification('Cannot retake: not currently recording', 'warning');
    }
  } catch (e) {
    showToastNotification('Retake failed: ' + e.message, 'error');
  }
}

async function handleDeleteStep(stepId) {
  try {
    // Save history BEFORE mutation
    saveToHistory('delete');

    await fsStorage.deleteStep(stepId);
    stepsData = stepsData.filter(s => s.id !== stepId);

    await resequenceAndPersist();
    showMessage('Step deleted successfully', 'success');
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
    await fsStorage.batchDeleteSteps(stepIds);

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
  const line = event.currentTarget;
  draggedStepId = line.dataset.stepId;
  line.classList.add('dragging');
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

function handleDragEnd() {
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

  await fsStorage.updateAllSteps(sessionId, stepsData);

  if (sessionData) {
    sessionData.stepCount = stepsData.length;
    await fsStorage.updateSession(sessionData);
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

    const progressCallback = (update) => handleExportProgress(update);

    const exportOptions = readExportConfig();
    const result = await exportService.exportSession(sessionId, format, progressCallback, exportOptions);

    let downloadUrl;
    let filename = result.filename.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');

    if (result.blob) {
      downloadUrl = await Utils.blobToDataURL(result.blob);
    } else {
      const utf8Bytes = new TextEncoder().encode(result.content);
      let binaryString = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < utf8Bytes.length; i += chunkSize) {
        binaryString += String.fromCharCode.apply(null, utf8Bytes.subarray(i, i + chunkSize));
      }
      downloadUrl = `data:${result.mimeType};charset=utf-8;base64,${btoa(binaryString)}`;
    }

    await chrome.downloads.download({
      url: downloadUrl,
      filename,
      saveAs: false,
      conflictAction: 'uniquify'
    });

    showMessage(`Exported as ${format.toUpperCase()} successfully!`, 'success');
  } catch (error) {
    console.error('Save and export failed:', error);
    showMessage('Failed: ' + error.message, 'error');
  } finally {
    hideProgressModal();
  }
}

// ==================== UI Helpers ====================

function showMessage(text, type = 'info') {
  DomUtils.showMessage(messageDiv, text, type);
}

function hideMessage() {
  messageDiv.style.display = 'none';
}

// ==================== Initialize ====================

document.addEventListener('DOMContentLoaded', init);