/**
 * Review Session Page - WITH ADD STEP FEATURE + DND + FILTER + HISTORY + PROGRESS
 * Proper export flow through background script
 */

import { StorageManager } from '../../storage.js';
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
// const redoBtn = document.getElementById('redoBtn');

// Export progress UI
const progressModal = document.getElementById('progressModal');
const progressFill = document.getElementById('progressFill');
const progressStatus = document.getElementById('progressStatus');
const progressPercent = document.getElementById('progressPercent');
const cancelExportBtn = document.getElementById('cancelExportBtn');

let newStepScreenshotBlob = null;
let insertAfterStepId = null;

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
    setupTheme();
  } catch (error) {
    console.error('Initialization failed:', error);
    showMessage('Failed to initialize: ' + error.message, 'error');
  }
}

function setupTheme() {
  const themeToggle = document.getElementById('themeToggle');
  const icon = themeToggle.querySelector('.icon');

  // 1. Check for manual override in localStorage
  const savedTheme = localStorage.getItem('theme');

  if (savedTheme) {
    applyTheme(savedTheme);
  } else {
    // 2. Default to time-based logic (Dark: 6 PM - 6 AM)
    const hour = new Date().getHours();
    const isDarkTime = hour >= 18 || hour < 6;
    applyTheme(isDarkTime ? 'dark' : 'light');
  }

  // Toggle Listener
  themeToggle.addEventListener('click', () => {
    // Logic: if current is light (has class), switch to dark. If default dark, switch to light.

    // If body has .light-mode, we are compatible with Light.
    // If not, we are Dark.
    const currentIsLight = document.body.classList.contains('light-mode');
    const newTheme = currentIsLight ? 'dark' : 'light';

    applyTheme(newTheme);
    localStorage.setItem('theme', newTheme);
  });
}

function applyTheme(theme) {
  const icon = document.querySelector('#themeToggle .icon');
  if (theme === 'light') {
    document.body.classList.add('light-mode');
    if (icon) icon.textContent = '☀️';
  } else {
    document.body.classList.remove('light-mode');
    if (icon) icon.textContent = '🌙';
  }
}

function setupEventListeners() {
  bulkDeleteBtn.addEventListener('click', handleBulkDelete);
  saveExportBtn.addEventListener('click', handleSaveAndExport);
  cancelBtn.addEventListener('click', () => window.close());

  // Session name auto-save
  sessionNameInput.addEventListener('blur', saveSessionName);

  // Listen for checkbox changes (delegated)
  stepsContainer.addEventListener('change', (e) => {
    if (e.target.classList.contains('step-checkbox')) {
      updateBulkDeleteButton();
    }
  });

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

  // Undo / Redo buttons
  if (undoBtn) undoBtn.addEventListener('click', undo);
  // if (redoBtn) redoBtn.addEventListener('click', redo);

  // Keyboard shortcuts: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z
  document.addEventListener('keydown', (e) => {
    const meta = e.metaKey;
    const ctrl = e.ctrlKey;

    if ((ctrl || meta) && !e.altKey) {
      if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
      /*else if (e.key.toLowerCase() === 'z' && e.shiftKey) {
         e.preventDefault();
         redo();
       }*/
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

  // Listen for export progress events from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'exportProgress') {
      handleExportProgress(message);
    }
  });
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
    const newName = sessionNameInput.value.trim();
    if (newName && sessionData) {
      sessionData.sessionName = newName;
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
    filtered = filtered.filter(
      (step) => (step.action || '').toLowerCase() === filterAction
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

/*function redo() {
  if (historyIndex >= history.length - 1) return;
  restoreFromHistory(historyIndex + 1);
}*/

// ==================== Step Rendering ====================

async function renderSteps() {
  const container = stepsContainer;

  if (!stepsData || stepsData.length === 0) {
    container.innerHTML = '<div class="loading">No steps recorded</div>';
    if (stepResultsSummary) {
      stepResultsSummary.textContent = '';
    }
    if (noResultsMsg) {
      noResultsMsg.classList.add('hidden');
    }
    return;
  }

  // Load all screenshots for the session
  const screenshotAssets = await storage.getAllAssets(sessionId);
  const screenshotMap = new Map();

  for (const asset of screenshotAssets) {
    if (asset.blob) {
      try {
        const dataUrl = await Utils.blobToDataURL(asset.blob);
        screenshotMap.set(asset.stepId, dataUrl);
      } catch (err) {
        console.warn('Failed to convert screenshot blob:', err);
      }
    }
  }

  const visibleSteps = filterSteps();

  if (stepResultsSummary) {
    if (visibleSteps.length === stepsData.length) {
      stepResultsSummary.textContent = `Showing ${stepsData.length} steps`;
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
    container.innerHTML = '<div class="loading">No results found</div>';
    return;
  }

  container.innerHTML = visibleSteps.map((step, index) => {
    // Use custom description if set, otherwise generate from fields
    const description = step.description || generateStepDescription(step);
    const screenshotData = screenshotMap.get(step.id) || null;
    const safeDescription = Utils.escapeHtml(description);

    return `
      <div class="step-doc-line" data-step-id="${step.id}" draggable="true">
        <div class="step-left">
          <span class="drag-handle" title="Drag to reorder">☰</span>
          <input type="checkbox" class="step-checkbox" data-step-id="${step.id}" ${step.selected ? 'checked' : ''}>
          <span class="step-number">${index + 1}.</span>
          <div class="step-text" style="flex: 1;">
            <textarea
              class="step-text-input"
              data-step-id="${step.id}"
              style="width: 100%; font-size: 15px; padding: 4px 8px;
                     border-radius: 4px; border: 1px solid var(--border-color);
                     background: var(--bg-secondary); color: var(--text-primary);
                     resize: vertical; min-height: 40px;">${safeDescription}</textarea>
          </div>
        </div>
        <div class="step-actions">
          ${screenshotData ? `
            <button class="icon-btn toggle-img-btn" data-step-id="${step.id}" title="Show Screenshot">📸</button>
          ` : ''}
          <button class="icon-btn delete-btn" title="Delete" data-step-id="${step.id}">🗑️</button>
        </div>
        <button class="add-step-after" data-after-step-id="${step.id}" title="Add step after this">+</button>
        ${screenshotData ? `
          <div class="step-screenshot hidden" id="img-${step.id}">
            <img src="${screenshotData}" alt="Step Screenshot" />
          </div>
        ` : ''}
      </div>
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
  // Delete
  document.querySelectorAll('.delete-btn').forEach(btn =>
    btn.addEventListener('click', () => handleDeleteStep(btn.dataset.stepId))
  );

  // Checkbox selection
  document.querySelectorAll('.step-checkbox').forEach(box =>
    box.addEventListener('change', handleCheckboxChange)
  );

  // Screenshot toggle
  document.querySelectorAll('.toggle-img-btn').forEach(btn =>
    btn.addEventListener('click', () => toggleScreenshot(btn.dataset.stepId))
  );

  // Add step after
  document.querySelectorAll('.add-step-after').forEach(btn =>
    btn.addEventListener('click', () => openAddStepModal(btn.dataset.afterStepId))
  );

  // Inline editing: auto-save on blur
  document.querySelectorAll('.step-text-input').forEach(textarea => {
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

  // Drag and drop for reordering
  document.querySelectorAll('.step-doc-line').forEach(line => {
    line.addEventListener('dragstart', handleDragStart);
    line.addEventListener('dragover', handleDragOver);
    line.addEventListener('drop', handleDrop);
    line.addEventListener('dragend', handleDragEnd);
  });
}

// ==================== Add Step Modal ====================

function openAddStepModal(afterStepId) {
  insertAfterStepId = afterStepId;
  newStepDescription.value = '';
  newStepAction.value = 'click';
  newStepScreenshotBlob = null;
  screenshotPreview.style.display = 'none';
  screenshotUpload.classList.remove('has-image');
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
    const newSequence = afterStepIndex + 2; // Insert after the clicked step

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

    // If screenshot provided, save it
    if (newStepScreenshotBlob) {
      await storage.addAsset({
        id: Utils.generateUUID(),
        sessionId: sessionId,
        stepId: newStep.id,
        type: 'screenshot',
        blob: newStepScreenshotBlob,
        createdAt: new Date().toISOString()
      });
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

async function toggleScreenshot(stepId) {
  const imgBlock = document.getElementById(`img-${stepId}`);
  const btn = document.querySelector(`.toggle-img-btn[data-step-id="${stepId}"]`);

  if (!imgBlock) return;

  const isHidden = imgBlock.classList.contains('hidden');
  if (isHidden) {
    imgBlock.classList.remove('hidden');
    if (btn) {
      btn.textContent = '🙈';
      btn.title = 'Hide Screenshot';
    }
  } else {
    imgBlock.classList.add('hidden');
    if (btn) {
      btn.textContent = '📸';
      btn.title = 'Show Screenshot';
    }
  }
}

async function handleDeleteStep(stepId) {
  // if (!confirm('Delete this step?')) return;

  try {
    await storage.deleteStep(stepId);

    // Save history BEFORE mutation
    saveToHistory('delete');

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
    for (const step of selectedSteps) {
      await storage.deleteStep(step.id);
    }

    // Save history BEFORE mutation
    saveToHistory('bulk-delete');

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
  if (step) step.selected = isChecked;
  updateBulkDeleteButton();
}

function updateBulkDeleteButton() {
  const checkedCount = document.querySelectorAll('.step-checkbox:checked').length;
  bulkDeleteBtn.disabled = checkedCount === 0;
  bulkDeleteBtn.querySelector('span:last-child').textContent =
    checkedCount > 0 ? `Delete Selected (${checkedCount})` : 'Delete Selected';
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
  const line = event.currentTarget;
  if (!line.classList.contains('dragging')) {
    line.classList.add('drag-over');
  }
}

async function handleDrop(event) {
  event.preventDefault();
  const targetLine = event.currentTarget;
  const targetStepId = targetLine.dataset.stepId;

  document.querySelectorAll('.step-doc-line.drag-over').forEach(el =>
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
  document.querySelectorAll('.step-doc-line.dragging').forEach(el =>
    el.classList.remove('dragging')
  );
  document.querySelectorAll('.step-doc-line.drag-over').forEach(el =>
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
  if (progressFill) progressFill.style.width = '0%';
  if (progressStatus) progressStatus.textContent = 'Starting export...';
  if (progressPercent) progressPercent.textContent = '0%';
}

function hideProgressModal() {
  if (!progressModal) return;
  progressModal.classList.remove('active');
}

function handleExportProgress(message) {
  const { percent, status, error, done } = message;

  if (typeof percent === 'number' && progressFill && progressPercent) {
    progressFill.style.width = `${percent}%`;
    progressPercent.textContent = `${percent}%`;
  }

  if (status && progressStatus) {
    progressStatus.textContent = status;
  }

  if (error) {
    hideProgressModal();
    showMessage('Export failed: ' + error, 'error');
  }

  // 🔑 THIS MUST EXIST
  if (done) {
    hideProgressModal();
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

      /*setTimeout(() => {
        if (confirm('Export successful! Close this window?')) {
          window.close();
        }
      }, 1000);*/
    } else if (response && !response.success) {
      throw new Error(response.error || 'Export failed');
    }
  } catch (error) {
    console.error('Save and export failed:', error);
    showMessage('Failed: ' + error.message, 'error');
  } finally {
    // 🛟 Safety net: close modal even if progress events misbehave
    hideProgressModal();
  }
}

// ==================== UI Helpers ====================

function showMessage(text, type = 'info') {
  Utils.showMessage(messageDiv, text, type);
}

function hideMessage() {
  messageDiv.style.display = 'none';
}

// ==================== Initialize ====================

document.addEventListener('DOMContentLoaded', init);
