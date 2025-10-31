/**
 * Review Session Page - Standalone HTML Version
 * Works independently without extension popup
 */

// ==================== IndexedDB Direct Access ====================

class ReviewStorageManager {
    constructor() {
        this.dbName = 'TestSnapperDB';
        this.version = 2;
        this.db = null;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                this.db = request.result;
                console.log('✅ Database connected');
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                if (!db.objectStoreNames.contains('sessions')) {
                    const sessionStore = db.createObjectStore('sessions', { keyPath: 'sessionId' });
                    sessionStore.createIndex('createdAt', 'createdAt', { unique: false });
                }

                if (!db.objectStoreNames.contains('steps')) {
                    const stepStore = db.createObjectStore('steps', { keyPath: 'id' });
                    stepStore.createIndex('sessionId', 'sessionId', { unique: false });
                    stepStore.createIndex('sequence', 'sequence', { unique: false });
                }

                if (!db.objectStoreNames.contains('assets')) {
                    const assetStore = db.createObjectStore('assets', { keyPath: 'id' });
                    assetStore.createIndex('sessionId', 'sessionId', { unique: false });
                    assetStore.createIndex('stepId', 'stepId', { unique: false });
                }
            };
        });
    }

    async getSession(sessionId) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['sessions'], 'readonly');
            const store = transaction.objectStore('sessions');
            const request = store.get(sessionId);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async updateSession(sessionData) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['sessions'], 'readwrite');
            const store = transaction.objectStore('sessions');
            const request = store.put(sessionData);

            request.onsuccess = () => resolve(sessionData);
            request.onerror = () => reject(request.error);
        });
    }

    async getSteps(sessionId) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['steps'], 'readonly');
            const store = transaction.objectStore('steps');
            const index = store.index('sessionId');
            const request = index.getAll(sessionId);

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async deleteStep(stepId) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['steps'], 'readwrite');
            const store = transaction.objectStore('steps');
            const request = store.delete(stepId);

            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    async updateStep(step) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['steps'], 'readwrite');
            const store = transaction.objectStore('steps');
            const request = store.put(step);

            request.onsuccess = () => resolve(step);
            request.onerror = () => reject(request.error);
        });
    }

    async addStep(step) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['steps'], 'readwrite');
            const store = transaction.objectStore('steps');
            const request = store.add(step);

            request.onsuccess = () => resolve(step);
            request.onerror = () => reject(request.error);
        });
    }

    async getAssetsByStepId(stepId) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['assets'], 'readonly');
            const store = transaction.objectStore('assets');
            const index = store.index('stepId');
            const request = index.getAll(stepId);

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async getAllAssets(sessionId) {
        if (!this.db) await this.init();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['assets'], 'readonly');
            const store = transaction.objectStore('assets');
            const index = store.index('sessionId');
            const request = index.getAll(sessionId);

            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }
}

// ==================== Main Review Logic ====================

let sessionId = null;
let sessionData = null;
let stepsData = [];
const storage = new ReviewStorageManager();

// UI Elements
const messageDiv = document.getElementById('message');
const sessionNameInput = document.getElementById('sessionName');
const sessionDate = document.getElementById('sessionDate');
const sessionStepCount = document.getElementById('sessionStepCount');
const stepsContainer = document.getElementById('stepsContainer');
const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
const saveExportBtn = document.getElementById('saveExportBtn');
const cancelBtn = document.getElementById('cancelBtn');
const exportFormatSelect = document.getElementById('exportFormat');

// Initialize
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

    // Session name auto-save on blur
    sessionNameInput.addEventListener('blur', async () => {
        await saveSessionName();
    });

    // Listen for checkbox changes
    stepsContainer.addEventListener('change', (e) => {
        if (e.target.classList.contains('step-checkbox')) {
            updateBulkDeleteButton();
        }
    });
}

// Load session data
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
            `Session ${new Date(sessionData.createdAt).toLocaleString()}`;
        sessionDate.textContent = `Created: ${new Date(sessionData.createdAt).toLocaleString()}`;
        sessionStepCount.textContent = `Steps: ${stepsData.length}`;

        await renderSteps();
        hideMessage();

        console.log('✅ Session loaded:', sessionId, 'Steps:', stepsData.length);
    } catch (error) {
        console.error('Failed to load session:', error);
        showMessage('Failed to load session: ' + error.message, 'error');
    }
}

// Save session name
async function saveSessionName() {
    try {
        const newName = sessionNameInput.value.trim();
        if (newName && sessionData) {
            sessionData.sessionName = newName;
            await storage.updateSession(sessionData);
            console.log('✅ Session name saved:', newName);
        }
    } catch (error) {
        console.error('Failed to save session name:', error);
    }
}

// Render all steps
async function renderSteps() {
  const container = document.getElementById("stepsContainer");
  if (!stepsData || stepsData.length === 0) {
    container.innerHTML = '<div class="loading">No steps recorded</div>';
    return;
  }

  // 🧠 Load all screenshots for the session first
  const screenshotAssets = await storage.getAllAssets(sessionId);
  const screenshotMap = new Map();

  for (const asset of screenshotAssets) {
    if (asset.blob) {
      try {
        const dataUrl = await blobToDataURL(asset.blob);
        screenshotMap.set(asset.stepId, dataUrl);
      } catch (err) {
        console.warn('Failed to convert screenshot blob:', err);
      }
    }
  }

  // 🧩 Render steps
  container.innerHTML = stepsData.map((step, index) => {
    const action = step.action || "Action";
    const field = step.fieldName ? step.fieldName.trim() : "";
    const value = step.value ? step.value.trim() : "";
    const description = generateStepDescription(action, field, value);
    const screenshotData = screenshotMap.get(step.id);

    return `
      <div class="step-doc-line" data-step-id="${step.id}">
        <div class="step-left">
          <input type="checkbox" class="step-checkbox" data-step-id="${step.id}">
          <span class="step-number">${index + 1}.</span>
          <span class="step-text">${description}</span>
        </div>
        <div class="step-actions">
          ${screenshotData ? `<button class="icon-btn toggle-img-btn" data-step-id="${step.id}" title="Show Screenshot">📸</button>` : ''}
          <button class="icon-btn edit-btn" title="Edit" data-step-id="${step.id}">✏️</button>
          <button class="icon-btn delete-btn" title="Delete" data-step-id="${step.id}">🗑️</button>
        </div>
        ${screenshotData ? `
          <div class="step-screenshot hidden" id="img-${step.id}">
            <img src="${screenshotData}" alt="Step Screenshot" />
          </div>
        ` : ''}
      </div>
    `;
  }).join("");

  attachStepEventListeners();
}

// Helper to generate natural language descriptions
function generateStepDescription(action, field, value) {
  switch (action.toLowerCase()) {
    case "click":
      return `Click “${field || 'element'}”`;
    case "type":
      return `Type “${value || 'text'}” in ${field || 'field'}`;
    case "navigate":
      return `Navigate to ${value}`;
    case "select":
      return `Select “${value || field}” from dropdown`;
    case "check":
      return `Check the box ${field ? `for “${field}”` : ''}`;
    case "submit":
      return `Submit the form`;
    default:
      return `${action} ${field || ''} ${value ? `→ “${value}”` : ''}`.trim();
  }
}


// Create step element
async function createStepElement(step, index) {
    const wrapper = document.createElement('div');
    wrapper.className = 'step-wrapper';
    wrapper.dataset.stepId = step.id;

    // Hover line with + button (Google Docs style)
    if (index > 0) {
        const hoverLine = document.createElement('div');
        hoverLine.className = 'hover-line';
        hoverLine.innerHTML = `<button class="add-step-btn" data-after="${index - 1}">+</button>`;
        wrapper.appendChild(hoverLine);
    }

    // Step item
    const stepItem = document.createElement('div');
    stepItem.className = 'step-item';

    // Checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'step-checkbox';
    checkbox.dataset.stepId = step.id;

    // Step number
    const stepNumber = document.createElement('div');
    stepNumber.className = 'step-number';
    stepNumber.textContent = `#${index + 1}`;

    // Step content
    const stepContent = document.createElement('div');
    stepContent.className = 'step-content';

    // Action field
    const actionField = document.createElement('div');
    actionField.className = 'step-field';
    actionField.innerHTML = `
    <label>Action:</label>
    <input type="text" class="step-input" value="${escapeHtml(step.action)}" data-field="action" readonly>
  `;

    // Field name
    const fieldNameField = document.createElement('div');
    fieldNameField.className = 'step-field';
    fieldNameField.innerHTML = `
    <label>Field:</label>
    <input type="text" class="step-input" value="${escapeHtml(step.fieldName || 'N/A')}" data-field="fieldName" readonly>
  `;

    // Value field
    const valueField = document.createElement('div');
    valueField.className = 'step-field';
    valueField.innerHTML = `
    <label>Value:</label>
    <input type="text" class="step-input" value="${escapeHtml(step.value || '')}" data-field="value" readonly>
  `;

    // Selector field
    const selectorField = document.createElement('div');
    selectorField.className = 'step-field';
    selectorField.innerHTML = `
    <label>Selector:</label>
    <input type="text" class="step-input" value="${escapeHtml(step.selector?.css || 'N/A')}" data-field="selector" readonly>
  `;

    stepContent.appendChild(actionField);
    stepContent.appendChild(fieldNameField);
    stepContent.appendChild(valueField);
    stepContent.appendChild(selectorField);

    // If screenshot, show image
    if (step.action === 'screenshot') {
        await loadScreenshot(step.id, stepContent);
    }

    // Actions
    const actions = document.createElement('div');
    actions.className = 'step-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'icon-btn edit-btn';
    editBtn.innerHTML = '✏️';
    editBtn.title = 'Edit';
    editBtn.dataset.stepId = step.id;

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'icon-btn delete-btn';
    deleteBtn.innerHTML = '🗑️';
    deleteBtn.title = 'Delete';
    deleteBtn.dataset.stepId = step.id;

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    // Assemble
    stepItem.appendChild(checkbox);
    stepItem.appendChild(stepNumber);
    stepItem.appendChild(stepContent);
    stepItem.appendChild(actions);

    wrapper.appendChild(stepItem);

    return wrapper;
}

// Attach event listeners to dynamically created elements
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
}

function toggleScreenshot(stepId) {
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

function handleCheckboxChange(e) {
  const stepId = e.target.dataset.stepId;
  const isChecked = e.target.checked;
  const step = stepsData.find(s => s.id === stepId);
  if (step) step.selected = isChecked;
}

// Load screenshot for step
async function loadScreenshot(stepId, container) {
    try {
        const assets = await storage.getAssetsByStepId(stepId);
        const screenshot = assets.find(a => a.type === 'screenshot');

        if (screenshot && screenshot.blob) {
            const dataUrl = await blobToDataURL(screenshot.blob);
            const screenshotDiv = document.createElement('div');
            screenshotDiv.className = 'step-screenshot';
            screenshotDiv.innerHTML = `<img src="${dataUrl}" alt="Screenshot" loading="lazy">`;
            container.appendChild(screenshotDiv);
        }
    } catch (error) {
        console.error('Failed to load screenshot:', error);
    }
}

// Toggle edit mode for step
async function toggleEdit(stepId) {
  const line = document.querySelector(`.step-doc-line[data-step-id="${stepId}"]`);
  if (!line) return;

  const editBtn = line.querySelector('.edit-btn');
  const textNode = line.querySelector('.step-text');
  const step = stepsData.find(s => s.id === stepId);
  if (!step) return;

  const isEditing = line.classList.contains('editing');

  if (!isEditing) {
    // Enter edit mode
    line.classList.add('editing');
    editBtn.textContent = '💾';
    const currentText = textNode.textContent.trim();
    textNode.innerHTML = `
      <input type="text" class="edit-input" value="${currentText}" 
        style="width: 100%; font-size: 15px; padding: 4px 8px;
               border: 1px solid var(--border-color); border-radius: 4px;
               background: var(--bg-secondary); color: var(--text-primary);" />
    `;
  } else {
    // Save changes
    const input = textNode.querySelector('.edit-input');
    const newText = input.value.trim();

    // Update in-memory and IndexedDB
    step.fieldName = newText;
    await storage.updateStep(step);

    // Reflect in UI
    line.classList.remove('editing');
    editBtn.textContent = '✏️';
    textNode.textContent = newText;

    showMessage('Step updated successfully', 'success');
  }
}

// Add new step between existing steps
async function handleAddStep(afterIndex) {
    try {
        const newStep = {
            id: generateUUID(),
            sessionId: sessionId,
            sequence: afterIndex + 1.5,
            action: 'click',
            fieldName: 'New Step',
            value: '',
            selector: { css: '' },
            timestamp: new Date().toISOString()
        };

        // Insert in array
        stepsData.splice(afterIndex + 1, 0, newStep);

        // Resequence
        stepsData.forEach((step, index) => {
            step.sequence = index + 1;
        });

        // Save new step
        await storage.addStep(newStep);

        // Update all sequences
        for (const step of stepsData) {
            await storage.updateStep(step);
        }

        await renderSteps();
        sessionStepCount.textContent = `Steps: ${stepsData.length}`;
        showMessage('Step added successfully', 'success');
    } catch (error) {
        console.error('Failed to add step:', error);
        showMessage('Failed to add step: ' + error.message, 'error');
    }
}

// Delete single step
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

// Bulk delete selected steps
async function handleBulkDelete() {
  const selectedSteps = stepsData.filter(s => s.selected);
  if (!selectedSteps.length) {
    showMessage('No steps selected.', 'error');
    return;
  }

  if (!confirm(`Delete ${selectedSteps.length} selected step(s)?`)) return;

  for (const step of selectedSteps) {
    await storage.deleteStep(step.id);
  }

  stepsData = stepsData.filter(s => !s.selected);
  renderSteps();
  showMessage('Selected steps deleted.', 'success');
}

// Update bulk delete button state
function updateBulkDeleteButton() {
    const checkedCount = document.querySelectorAll('.step-checkbox:checked').length;
    bulkDeleteBtn.disabled = checkedCount === 0;
    bulkDeleteBtn.querySelector('span:last-child').textContent =
        checkedCount > 0 ? `Delete Selected (${checkedCount})` : 'Delete Selected';
}

// Save and export
async function handleSaveAndExport() {
    try {
        showMessage('Saving changes...', 'info');

        // Save session name
        await saveSessionName();

        const format = exportFormatSelect.value;
        showMessage(`Exporting as ${format.toUpperCase()}...`, 'info');

        let content, filename, mimeType;

        if (format === 'json') {
            const exportData = generateJSONExport();
            content = JSON.stringify(exportData, null, 2);
            filename = `testsnapper_${sessionId.substring(0, 8)}_${Date.now()}.json`;
            mimeType = 'application/json';
            downloadFile(content, filename, mimeType);

        } else if (format === 'csv') {
            content = await generateCSVExport();
            filename = `testsnapper_${sessionId.substring(0, 8)}_${Date.now()}.csv`;
            mimeType = 'text/csv';
            downloadFile(content, filename, mimeType);

        } else if (format === 'docx') {
            content = await generateDOCXExport();
            filename = `testsnapper_${sessionId.substring(0, 8)}_${Date.now()}.doc`;
            mimeType = 'application/msword';
            downloadFile(content, filename, mimeType);

        } else if (format === 'pdf') {
            // 🆕 PDF EXPORT
            const filename = `testsnapper_${sessionId.substring(0, 8)}_${Date.now()}.pdf`;
            await exportPDF(filename);
        }

        showMessage(`Exported as ${format.toUpperCase()} successfully!`, 'success');

        setTimeout(() => {
            if (confirm('Export successful! Close this window?')) {
                window.close();
            }
        }, 1000);
    } catch (error) {
        console.error('Save and export failed:', error);
        showMessage('Failed: ' + error.message, 'error');
    }
}

async function exportPDF(filename) {
  try {
    // Dynamically load jsPDF if not already loaded
    if (typeof window.jspdf === 'undefined') {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('libs/jspdf.umd.min.js');
      document.head.appendChild(script);
      await new Promise(res => (script.onload = res));
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const marginLeft = 40;
    let y = 60;

    // Session Header
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text('TestSnapper Session Report', marginLeft, y);
    y += 20;

    // Session metadata
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    const sessionName = document.getElementById('sessionName')?.value || 'Untitled Session';
    doc.text(`Session: ${sessionName}`, marginLeft, y);
    y += 14;
    doc.text(`Date: ${new Date().toLocaleString()}`, marginLeft, y);
    y += 20;

    // Steps
    doc.setFontSize(11);
    doc.setFont('times', 'normal');
    const steps = stepsData || [];

    steps.forEach((step, i) => {
      const action = step.action || 'Action';
      const field = step.fieldName ? step.fieldName.trim() : '';
      const value = step.value ? step.value.trim() : '';
      const text = generateStepDescription(action, field, value);
      const line = `${i + 1}. ${text}`;
      const split = doc.splitTextToSize(line, 520); // wrap text
      doc.text(split, marginLeft, y);
      y += split.length * 14;
      if (y > 750) {
        doc.addPage();
        y = 60;
      }
    });

    doc.save(filename);
  } catch (error) {
    console.error('PDF export failed:', error);
    showMessage('PDF export failed: ' + error.message, 'error');
  }
}

// Generate JSON export
function generateJSONExport() {
    return {
        session: {
            id: sessionData.sessionId,
            name: sessionData.sessionName,
            createdAt: sessionData.createdAt,
            environment: sessionData.env,
            stepCount: stepsData.length
        },
        steps: stepsData.map((step, index) => ({
            id: step.id,
            stepNumber: index + 1,
            timestamp: step.timestamp,
            action: step.action,
            fieldName: step.fieldName,
            selector: step.selector,
            value: step.value,
            url: step.url,
            notes: step.notes || '',
            isManual: step.isManual,
            hasScreenshot: step.hasScreenshot
        }))
    };
}

// Generate CSV export
async function generateCSVExport() {
    const headers = ['Step', 'Action', 'Field Name', 'Selector (CSS)', 'Value', 'URL'];
    const rows = stepsData
        .filter(s => s.action !== 'screenshot')
        .map((step, index) => [
            index + 1,
            step.action,
            step.fieldName || 'N/A',
            step.selector?.css || '',
            step.value || '',
            step.url || ''
        ]);

    return [headers, ...rows]
        .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        .join('\n');
}

// Generate DOCX export (HTML-based)
async function generateDOCXExport() {
    let html = `
<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
  <meta charset='utf-8'>
  <title>Test Recording Session</title>
  <style>
    body { font-family: Calibri, Arial, sans-serif; margin: 40px; }
    h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; }
    h2 { color: #34495e; margin-top: 30px; background: #ecf0f1; padding: 10px; }
    .info { background: #f8f9fa; padding: 15px; border-left: 4px solid #3498db; margin: 20px 0; }
    .info p { margin: 5px 0; }
    .step { border: 1px solid #ddd; padding: 15px; margin: 15px 0; border-radius: 5px; page-break-inside: avoid; }
    .step-header { font-weight: bold; font-size: 16px; color: #2980b9; margin-bottom: 10px; }
    .step-oneliner { margin: 8px 0; color: #333; line-height: 1.6; }
    .screenshot { margin: 10px 0; text-align: center; }
    .screenshot img { max-width: 600px; width: 100%; height: auto; border: 1px solid #ddd; display: block; margin: 10px auto; }
    .automated-screenshots { margin-top: 30px; padding-top: 20px; border-top: 2px solid #3498db; }
  </style>
</head>
<body>
  <h1>🎬 Test Recording Session</h1>
  
  <div class='info'>
    <p><b>Session Name:</b> ${escapeHtml(sessionData.sessionName || 'Untitled')}</p>
    <p><b>Session ID:</b> ${sessionData.sessionId}</p>
    <p><b>Created:</b> ${new Date(sessionData.createdAt).toLocaleString()}</p>
    <p><b>URL:</b> ${sessionData.env?.url || 'N/A'}</p>
    <p><b>Page Title:</b> ${sessionData.env?.title || 'N/A'}</p>
    <p><b>Total Steps:</b> ${stepsData.length}</p>
  </div>
  
  <h2>📋 Recorded Steps</h2>
`;

    // Get all screenshots
    const screenshotMap = new Map();
    const allAssets = await storage.getAllAssets(sessionId);

    for (const asset of allAssets) {
        if (asset.blob && asset.type === 'screenshot') {
            try {
                const dataUrl = await blobToDataURL(asset.blob);
                screenshotMap.set(asset.stepId, dataUrl);
            } catch (err) {
                console.warn('Failed to convert screenshot:', err);
            }
        }
    }

    const automatedScreenshots = [];
    const regularSteps = [];
    let stepNumber = 0;

    // Separate manual and automated screenshots
    stepsData.forEach(step => {
        if (step.action === 'screenshot' && step.isManual) {
            regularSteps.push(step);
        } else if (step.action === 'screenshot' && !step.isManual) {
            automatedScreenshots.push(step);
        } else {
            regularSteps.push(step);
        }
    });

    // Render regular steps
    for (const step of regularSteps) {
        stepNumber++;
        html += `<div class='step'>`;
        html += `<div class='step-header'>Step ${stepNumber}</div>`;

        if (step.action === 'screenshot') {
            html += `<div class='step-oneliner'>📸 Manual screenshot captured</div>`;
            const screenshotData = screenshotMap.get(step.id);
            if (screenshotData) {
                html += `<div class='screenshot'><img src="${screenshotData}" alt="Manual Screenshot"/></div>`;
            }
        } else {
            let oneliner = `${step.action.toUpperCase()}`;
            if (step.fieldName && step.fieldName !== 'N/A') {
                oneliner += ` on "${escapeHtml(step.fieldName)}"`;
            }
            if (step.value && step.action !== 'navigate') {
                oneliner += ` with value "${escapeHtml(step.value)}"`;
            }
            if (step.action === 'navigate') {
                oneliner += ` to ${escapeHtml(step.value || step.url)}`;
            }

            html += `<div class='step-oneliner'>${oneliner}</div>`;
        }

        html += `</div>`;
    }

    // Render automated screenshots
    if (automatedScreenshots.length > 0) {
        html += `<div class='automated-screenshots'><h2>📷 Automated Screenshots</h2>`;

        for (let i = 0; i < automatedScreenshots.length; i++) {
            const screenshot = automatedScreenshots[i];
            const screenshotData = screenshotMap.get(screenshot.id);
            if (screenshotData) {
                html += `
    <div class='screenshot'>
      <p><b>Auto Screenshot ${i + 1}</b> - ${new Date(screenshot.timestamp).toLocaleTimeString()}</p>
      <img src="${screenshotData}" alt="Automated Screenshot ${i + 1}"/>
    </div>`;
            }
        }

        html += `</div>`;
    }

    html += `</body></html>`;

    return html;
}

// Download file helper
function downloadFile(content, filename, mimeType) {
    const base64Content = btoa(unescape(encodeURIComponent(content)));
    const dataUrl = `data:${mimeType};base64,${base64Content}`;

    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// ==================== Utility Functions ====================

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function escapeHtml(text) {
    if (!text) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function showMessage(text, type = 'info') {
    messageDiv.textContent = text;
    messageDiv.className = `message ${type}`;
    messageDiv.style.display = 'block';

    if (type === 'success' || type === 'error') {
        setTimeout(() => {
            messageDiv.style.display = 'none';
        }, 3000);
    }
}

function hideMessage() {
    messageDiv.style.display = 'none';
}

// Initialize on load
document.addEventListener('DOMContentLoaded', init);