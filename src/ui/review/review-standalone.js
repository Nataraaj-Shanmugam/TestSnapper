/**
 * Review Session Page - WITH ADD STEP FEATURE
 * Proper export flow through background script
 */

import { StorageManager } from '../../storage.js';
import { Utils } from '../../core/utils.js';

// ==================== Initialize Services ====================

const storage = new StorageManager();

let sessionId = null;
let sessionData = null;
let stepsData = [];

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

let newStepScreenshotBlob = null;
let insertAfterStepId = null;

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
  } catch (error) {
    console.error('Initialization failed:', error);
    showMessage('Failed to initialize: ' + error.message, 'error');
  }
}

function setupEventListeners() {
  bulkDeleteBtn.addEventListener('click', handleBulkDelete);
  saveExportBtn.addEventListener('click', handleSaveAndExport);
  cancelBtn.addEventListener('click', () => window.close());

  // Session name auto-save
  sessionNameInput.addEventListener('blur', saveSessionName);

  // Listen for checkbox changes
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

  // Drag & drop for screenshot
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

// ==================== Step Rendering ====================

async function renderSteps() {
  const container = document.getElementById('stepsContainer');

  if (!stepsData || stepsData.length === 0) {
    container.innerHTML = '<div class="loading">No steps recorded</div>';
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

  // Render steps
  container.innerHTML = stepsData.map((step, index) => {
    // Use custom description if set, otherwise generate from fields
    const description = step.description || generateStepDescription(step);
    const screenshotData = screenshotMap.get(step.id);

    return `
      <div class="step-doc-line" data-step-id="${step.id}">
        <div class="step-left">
          <input type="checkbox" class="step-checkbox" data-step-id="${step.id}">
          <span class="step-number">${index + 1}.</span>
          <span class="step-text">${description}</span>
        </div>
        <div class="step-actions">
          ${screenshotData ? `
            <button class="icon-btn toggle-img-btn" data-step-id="${step.id}" title="Show Screenshot">📸</button>
          ` : ''}
          <button class="icon-btn edit-btn" title="Edit" data-step-id="${step.id}">✏️</button>
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
  document.querySelectorAll('.edit-btn').forEach(btn =>
    btn.addEventListener('click', () => toggleEdit(btn.dataset.stepId))
  );

  document.querySelectorAll('.delete-btn').forEach(btn =>
    btn.addEventListener('click', () => handleDeleteStep(btn.dataset.stepId))
  );

  document.querySelectorAll('.step-checkbox').forEach(box =>
    box.addEventListener('change', handleCheckboxChange)
  );

  document.querySelectorAll('.toggle-img-btn').forEach(btn =>
    btn.addEventListener('click', () => toggleScreenshot(btn.dataset.stepId))
  );

  document.querySelectorAll('.add-step-after').forEach(btn =>
    btn.addEventListener('click', () => openAddStepModal(btn.dataset.afterStepId))
  );
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

    // Insert into array and resequence
    stepsData.splice(afterStepIndex + 1, 0, newStep);
    stepsData.forEach((step, index) => {
      step.sequence = index + 1;
    });

    // Update all sequences in database
    for (const step of stepsData) {
      await storage.updateStep(step);
    }

    // Update session count
    sessionData.stepCount = stepsData.length;
    await storage.updateSession(sessionData);

    // Re-render and close modal
    await renderSteps();
    sessionStepCount.textContent = `Steps: ${stepsData.length}`;
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
    btn.textContent = '🙈';
    btn.title = 'Hide Screenshot';
  } else {
    imgBlock.classList.add('hidden');
    btn.textContent = '📸';
    btn.title = 'Show Screenshot';
  }
}

async function toggleEdit(stepId) {
  const line = document.querySelector(`.step-doc-line[data-step-id="${stepId}"]`);
  if (!line) return;

  const editBtn = line.querySelector('.edit-btn');
  const textNode = line.querySelector('.step-text');
  const step = stepsData.find(s => s.id === stepId);
  if (!step) return;

  const isEditing = line.classList.contains('editing');

  if (!isEditing) {
    // ✏️ Enter edit mode
    line.classList.add('editing');
    editBtn.textContent = '💾';
    editBtn.title = 'Save';

    // Use existing description or generate from fields
    const currentText = step.description || generateStepDescription(step);
    textNode.innerHTML = `
      <textarea class="edit-input"
        style="width: 100%; font-size: 15px; padding: 4px 8px;
               border: 1px solid var(--border-color); border-radius: 4px;
               background: var(--bg-secondary); color: var(--text-primary);
               resize: vertical; min-height: 60px;">${Utils.escapeHtml(currentText)}</textarea>
    `;
    textNode.querySelector('.edit-input').focus();
  } else {
    // 💾 Save mode
    const input = textNode.querySelector('.edit-input');
    const newText = input.value.trim();
    if (!newText) {
      showMessage('Description cannot be empty', 'error');
      return;
    }

    // ✅ Save the custom description to override auto-generation
    step.description = newText;

    try {
      await storage.updateStep(step);
      line.classList.remove('editing');
      editBtn.textContent = '✏️';
      editBtn.title = 'Edit';

      // Re-render to show saved description
      await renderSteps();
      showMessage('Step updated successfully', 'success');
    } catch (err) {
      console.error('Update step failed:', err);
      showMessage('Failed to update step: ' + err.message, 'error');
    }
  }
}

async function handleDeleteStep(stepId) {
  if (!confirm('Delete this step?')) return;

  try {
    await storage.deleteStep(stepId);

    stepsData = stepsData.filter(s => s.id !== stepId);

    // Resequence
    stepsData.forEach((step, index) => {
      step.sequence = index + 1;
    });

    // Update sequences in database
    for (const step of stepsData) {
      await storage.updateStep(step);
    }

    // Update session count
    sessionData.stepCount = stepsData.length;
    await storage.updateSession(sessionData);

    await renderSteps();
    sessionStepCount.textContent = `Steps: ${stepsData.length}`;
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

    stepsData = stepsData.filter(s => !s.selected);

    // Resequence
    stepsData.forEach((step, index) => {
      step.sequence = index + 1;
    });

    for (const step of stepsData) {
      await storage.updateStep(step);
    }

    sessionData.stepCount = stepsData.length;
    await storage.updateSession(sessionData);

    await renderSteps();
    sessionStepCount.textContent = `Steps: ${stepsData.length}`;
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

// ==================== Export ====================

async function handleSaveAndExport() {
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

    if (response.success) {
      showMessage(`Exported as ${format.toUpperCase()} successfully!`, 'success');

      setTimeout(() => {
        if (confirm('Export successful! Close this window?')) {
          window.close();
        }
      }, 1000);
    } else {
      throw new Error(response.error || 'Export failed');
    }
  } catch (error) {
    console.error('Save and export failed:', error);
    showMessage('Failed: ' + error.message, 'error');
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