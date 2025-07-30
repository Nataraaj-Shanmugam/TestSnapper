// Enhanced Popup script for TestSnapper extension with multi-format export

class TestSnapperPopup {
  constructor() {
    this.isRecording = false;
    this.isPaused = false;
    this.sessions = [];
    this.settings = {
      autoScreenshot: true,
      screenshotQuality: 'medium',
      redactionPatterns: 'password,secret,token,api_key',
      darkMode: false,
      defaultExportFormat: 'txt'
    };
    this.currentTab = 'record';
    this.init();
  }

  async init() {
    console.log('TestSnapper Popup initializing...');
    this.setupEventListeners();
    await this.loadData();
    this.updateUI();
    console.log('TestSnapper Popup initialized');
  }

  setupEventListeners() {
    // Tab navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.switchTab(e.target.dataset.tab);
      });
    });

    // Recording controls
    document.getElementById('start-btn').addEventListener('click', () => {
      this.startRecording();
    });
    document.getElementById('pause-btn').addEventListener('click', () => {
      this.pauseRecording();
    });
    document.getElementById('resume-btn').addEventListener('click', () => {
      this.resumeRecording();
    });
    document.getElementById('stop-btn').addEventListener('click', () => {
      this.stopRecording();
    });

    // Manual screenshot
    const screenshotBtn = document.getElementById('screenshot-btn');
    if (screenshotBtn) {
      screenshotBtn.addEventListener('click', () => {
        this.captureManualScreenshot();
      });
    }

    // Settings save
    document.getElementById('save-settings').addEventListener('click', () => {
      this.saveSettings();
    });

    // Export format selector in settings
    const exportFormatSelect = document.getElementById('export-format-select');
    if (exportFormatSelect) {
      exportFormatSelect.addEventListener('change', (e) => {
        this.settings.defaultExportFormat = e.target.value;
        this.saveSettings();
      });
    }
  }

  switchTab(tabName) {
    console.log('Switching to tab:', tabName);

    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.add('hidden');
    });
    document.getElementById(`${tabName}-tab`).classList.remove('hidden');

    this.currentTab = tabName;
    if (tabName === 'sessions') {
      this.loadSessions().then(() => this.renderSessions());
    }
  }

  async loadData() {
    try {
      await Promise.all([
        this.loadRecordingStatus(),
        this.loadSessions(),
        this.loadSettings()
      ]);
    } catch (error) {
      console.error('Error loading data:', error);
    }
  }

  async loadRecordingStatus() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATUS' });
      if (response && typeof response.isRecording === 'boolean') {
        this.isRecording = response.isRecording;
        this.isPaused = response.isPaused || false;
      } else {
        this.isRecording = false;
        this.isPaused = false;
      }
    } catch (error) {
      this.isRecording = false;
      this.isPaused = false;
    }
  }

  async loadSessions() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SESSIONS' });
      if (response && Array.isArray(response.sessions)) {
        this.sessions = response.sessions;
      } else {
        this.sessions = [];
      }
    } catch (error) {
      this.sessions = [];
    }
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.local.get(['settings']);
      if (result.settings) {
        this.settings = { ...this.settings, ...result.settings };
      }
    } catch (error) { }
  }

  updateUI() {
    this.updateRecordingUI();
    this.renderSessions();
    this.updateSettingsUI();
  }

  updateRecordingUI() {
    const statusIndicator = document.getElementById('status-indicator');
    const notRecordingDiv = document.getElementById('not-recording');
    const recordingDiv = document.getElementById('recording');
    const pausedDiv = document.getElementById('paused');

    statusIndicator.classList.remove('recording', 'paused');
    notRecordingDiv.classList.add('hidden');
    recordingDiv.classList.add('hidden');
    pausedDiv.classList.add('hidden');

    if (this.isRecording) {
      if (this.isPaused) {
        statusIndicator.classList.add('paused');
        pausedDiv.classList.remove('hidden');
      } else {
        statusIndicator.classList.add('recording');
        recordingDiv.classList.remove('hidden');
      }
    } else {
      notRecordingDiv.classList.remove('hidden');
    }
  }

  renderSessions() {
    const sessionsList = document.getElementById('sessions-list');
    const noSessions = document.getElementById('no-sessions');
    const sessionCount = document.getElementById('session-count');
    sessionCount.textContent = `(${this.sessions.length})`;

    if (this.sessions.length === 0) {
      sessionsList.innerHTML = '';
      noSessions.classList.remove('hidden');
      return;
    }
    noSessions.classList.add('hidden');

    sessionsList.innerHTML = this.sessions.map(session => {
      const activeDuration = session.activeDuration || session.duration || 0;
      const totalDuration = session.duration || 0;
      const durationText = activeDuration !== totalDuration ?
        `${Math.round(activeDuration / 1000)}s active (${Math.round(totalDuration / 1000)}s total)` :
        `${Math.round(totalDuration / 1000)}s`;

      return `
      <div class="session-item">
        <div class="session-title">${this.escapeHtml(session.name)}</div>
        <div class="session-meta">
          ${new Date(session.startTime).toLocaleDateString()} • 
          ${session.interactions?.length || 0} interactions • 
          ${session.screenshots?.length || 0} screenshots • 
          ${durationText}
        </div>
        <div class="session-url">${this.escapeHtml(session.url || '')}</div>
        ${this.renderSessionDetails(session)}
        <div class="session-actions">
          <div class="export-controls">
            <select class="export-format-select" data-session-id="${session.id}">
              <option value="txt">TXT</option>
              <option value="csv">CSV</option>
              <option value="docx">DOCX (with screenshots)</option>
              <option value="pdf">PDF (with screenshots)</option>
            </select>
            <button class="btn-small btn-export" data-session-id="${session.id}">
              Export
            </button>
          </div>
          <button class="btn-small btn-delete" data-session-id="${session.id}">
            Delete
          </button>
        </div>
      </div>
      `;
    }).join('');

    // Add export, delete, format selector event listeners
    this.addSessionEventListeners();
  }

  renderSessionDetails(session) {
    let details = '';

    if (session.pauseEvents && session.pauseEvents.length > 0) {
      const pauseCount = session.pauseEvents.filter(e => e.type === 'pause').length;
      details += `<div style="font-size:10px; color:#f59e0b; margin-bottom:2px;">⏸️ ${pauseCount} pause(s) during session</div>`;
    }
    if (session.screenshots && session.screenshots.length > 0) {
      details += `<div style="font-size:10px; color:#10b981; margin-bottom:2px;">📸 ${session.screenshots.length} screenshots captured</div>`;
    }
    if (session.interactions && session.interactions.length > 0) {
      details += `
      <div style="font-size:11px; margin:6px 0 2px 0; color:#374151; border-top:1px dashed #e5e7eb; padding-top:4px;">
        <div style="font-weight:600; color:#3b82f6; margin-bottom:2px;">Recent Interactions:</div>
        ${session.interactions.slice(-3).map(i => {
        let desc = `[${Math.round((i.relativeTime || 0) / 1000)}s] ${i.type.toUpperCase()}`;
        if (i.selector) desc += ` <span style="color:#9ca3af">"${i.selector}"</span>`;
        if (i.value) desc += ` value: <span style="color:#059669">"${i.value}"</span>`;
        if (i.text && !i.value) desc += ` text: <span style="color:#059669">"${i.text.substring(0, 30)}"</span>`;
        return `<div>• ${desc}</div>`;
      }).join('')}
        ${session.interactions.length > 3 ? `<div style="color:#9ca3af;">... and ${session.interactions.length - 3} more</div>` : ''}
      </div>
      `;
    }
    if (session.networkCalls && session.networkCalls.length > 0) {
      details += `<div style="font-size: 11px; color: #ef4444; margin-top: 4px;">⚠️ ${session.networkCalls.length} network errors detected</div>`;
    }
    return details;
  }

  addSessionEventListeners() {
    const sessionsList = document.getElementById('sessions-list');
    // Export buttons
    sessionsList.querySelectorAll('.btn-export').forEach(btn => {
      btn.addEventListener('click', () => {
        const sessionId = btn.getAttribute('data-session-id');
        const formatSelect = sessionsList.querySelector(`select[data-session-id="${sessionId}"]`);
        const format = formatSelect ? formatSelect.value : this.settings.defaultExportFormat;
        this.exportSession(sessionId, format);
      });
    });
    // Delete buttons
    sessionsList.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', () => {
        const sessionId = btn.getAttribute('data-session-id');
        this.deleteSession(sessionId);
      });
    });
    // Format selectors (for UI sync)
    sessionsList.querySelectorAll('.export-format-select').forEach(select => {
      select.value = this.settings.defaultExportFormat;
    });
  }

  updateSettingsUI() {
    document.getElementById('auto-screenshot').checked = this.settings.autoScreenshot;
    document.getElementById('screenshot-quality').value = this.settings.screenshotQuality;
    document.getElementById('redaction-patterns').value = this.settings.redactionPatterns;
    document.getElementById('dark-mode').checked = this.settings.darkMode;
    const exportFormatSelect = document.getElementById('export-format-select');
    if (exportFormatSelect) exportFormatSelect.value = this.settings.defaultExportFormat;
  }

  async startRecording() {
    try {
      const startBtn = document.getElementById('start-btn');
      startBtn.disabled = true;
      startBtn.textContent = 'Starting...';
      const response = await chrome.runtime.sendMessage({ type: 'START_RECORDING' });
      if (response && response.success) {
        this.isRecording = true;
        this.isPaused = false;
        this.updateRecordingUI();
        setTimeout(() => { window.close(); }, 500);
      } else {
        throw new Error(response?.error || 'Failed to start recording');
      }
    } catch (error) {
      alert('Failed to start recording: ' + error.message);
      const startBtn = document.getElementById('start-btn');
      startBtn.disabled = false;
      startBtn.textContent = 'Start Recording';
    }
  }


  async pauseRecording() {
    try {
      const pauseBtn = document.getElementById('pause-btn');
      pauseBtn.disabled = true;
      pauseBtn.textContent = 'Pausing...';
      const response = await chrome.runtime.sendMessage({ type: 'PAUSE_RECORDING' });
      if (response && response.success) {
        this.isPaused = true;
        this.updateRecordingUI();
      } else {
        throw new Error(response?.error || 'Failed to pause recording');
      }
    } catch (error) {
      alert('Failed to pause recording: ' + error.message);
    } finally {
      const pauseBtn = document.getElementById('pause-btn');
      pauseBtn.disabled = false;
      pauseBtn.textContent = 'Pause';
    }
  }

  async resumeRecording() {
    try {
      const resumeBtn = document.getElementById('resume-btn');
      resumeBtn.disabled = true;
      resumeBtn.textContent = 'Resuming...';
      const response = await chrome.runtime.sendMessage({ type: 'RESUME_RECORDING' });
      if (response && response.success) {
        this.isPaused = false;
        this.updateRecordingUI();
      } else {
        throw new Error(response?.error || 'Failed to resume recording');
      }
    } catch (error) {
      alert('Failed to resume recording: ' + error.message);
    } finally {
      const resumeBtn = document.getElementById('resume-btn');
      resumeBtn.disabled = false;
      resumeBtn.textContent = 'Resume';
    }
  }

  async stopRecording() {
    try {
      const stopBtn = document.getElementById('stop-btn');
      stopBtn.disabled = true;
      stopBtn.textContent = 'Stopping...';
      const response = await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
      if (response && response.success) {
        this.isRecording = false;
        this.isPaused = false;
        this.updateRecordingUI();
        await this.loadSessions();
        this.renderSessions();
      } else {
        throw new Error(response?.error || 'Failed to stop recording');
      }
    } catch (error) {
      alert('Failed to stop recording: ' + error.message);
    } finally {
      const stopBtn = document.getElementById('stop-btn');
      stopBtn.disabled = false;
      stopBtn.textContent = 'Stop Recording';
    }
  }

  async captureManualScreenshot() {
    try {
      const screenshotBtn = document.getElementById('screenshot-btn');
      screenshotBtn.disabled = true;
      screenshotBtn.textContent = 'Capturing...';
      const response = await chrome.runtime.sendMessage({
        type: 'CAPTURE_SCREENSHOT',
        data: { type: 'manual', timestamp: Date.now() }
      });
      if (response && response.success) {
        screenshotBtn.textContent = 'Captured!';
        screenshotBtn.style.background = '#059669';
        setTimeout(() => {
          screenshotBtn.textContent = '📸 Screenshot';
          screenshotBtn.style.background = '';
          screenshotBtn.disabled = false;
        }, 1000);
      } else {
        throw new Error('Failed to capture screenshot');
      }
    } catch (error) {
      const screenshotBtn = document.getElementById('screenshot-btn');
      screenshotBtn.disabled = false;
      screenshotBtn.textContent = '📸 Screenshot';
    }
  }

  async exportSession(sessionId, format = 'txt') {
    try {
      const exportBtn = document.querySelector(`button[data-session-id="${sessionId}"]`);
      const originalText = exportBtn.textContent;
      exportBtn.disabled = true;
      exportBtn.textContent = 'Exporting...';

      if (format === 'docx') {
        // DOCX is generated locally
        const session = this.sessions.find(s => s.id === sessionId);
        if (session) {
          await downloadDocxFromSession(session);
          exportBtn.textContent = 'Exported!';
          exportBtn.style.background = '#059669';
          setTimeout(() => {
            exportBtn.textContent = originalText;
            exportBtn.style.background = '';
            exportBtn.disabled = false;
          }, 1500);
          return;
        } else {
          throw new Error('Session not found for DOCX export');
        }
      }

      // For other formats, keep existing flow
      const response = await chrome.runtime.sendMessage({
        type: 'EXPORT_SESSION',
        sessionId,
        format
      });

      if (response && response.exportData) {
        await this.downloadExportedFile(response.exportData, format);
        exportBtn.textContent = 'Exported!';
        exportBtn.style.background = '#059669';
        setTimeout(() => {
          exportBtn.textContent = originalText;
          exportBtn.style.background = '';
          exportBtn.disabled = false;
        }, 1500);
      } else {
        throw new Error('No export data received');
      }
    } catch (error) {
      alert('Failed to export session: ' + error.message);
      const exportBtn = document.querySelector(`button[data-session-id="${sessionId}"]`);
      exportBtn.disabled = false;
      exportBtn.textContent = 'Export';
    }
  }

  async downloadExportedFile(exportData, format) {
    let blob, filename, content;
    switch (format.toLowerCase()) {
      case 'txt':
        blob = new Blob([exportData.txtContent], { type: 'text/plain' });
        filename = exportData.filename;
        break;
      case 'csv':
        blob = new Blob([exportData.csvContent], { type: 'text/csv' });
        filename = exportData.filename;
        break;
      case 'docx':
        content = JSON.stringify(exportData.docxData, null, 2);
        content = `// DOCX Export Data for ${exportData.session.name}\n// This file contains structured data that can be processed into a DOCX document\n// Screenshots are included as base64 data URLs\n\n${content}`;
        blob = new Blob([content], { type: 'application/json' });
        filename = exportData.filename.replace('.docx', '_data.json');
        break;
      case 'pdf':
        content = JSON.stringify(exportData.pdfData, null, 2);
        content = `// PDF Export Data for ${exportData.session.name}\n// This file contains structured data that can be processed into a PDF document\n// Screenshots are included as base64 data URLs\n\n${content}`;
        blob = new Blob([content], { type: 'application/json' });
        filename = exportData.filename.replace('.pdf', '_data.json');
        break;
      default:
        throw new Error('Unsupported export format: ' + format);
    }
    // Download the file
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async deleteSession(sessionId) {
    if (!confirm('Are you sure you want to delete this session? This action cannot be undone.')) return;
    try {
      const updatedSessions = this.sessions.filter(s => s.id !== sessionId);
      await chrome.storage.local.set({ sessions: updatedSessions });
      this.sessions = updatedSessions;
      this.renderSessions();
    } catch (error) {
      alert('Failed to delete session: ' + error.message);
    }
  }

  async saveSettings() {
    try {
      this.settings.autoScreenshot = document.getElementById('auto-screenshot').checked;
      this.settings.screenshotQuality = document.getElementById('screenshot-quality').value;
      this.settings.redactionPatterns = document.getElementById('redaction-patterns').value;
      this.settings.darkMode = document.getElementById('dark-mode').checked;
      const exportFormatSelect = document.getElementById('export-format-select');
      if (exportFormatSelect) this.settings.defaultExportFormat = exportFormatSelect.value;

      await chrome.storage.local.set({ settings: this.settings });
      const btn = document.getElementById('save-settings');
      const originalText = btn.textContent;
      btn.textContent = 'Saved!';
      btn.style.background = '#059669';
      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.background = '';
      }, 1500);
    } catch (error) {
      alert('Failed to save settings: ' + error.message);
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Add or replace this function in popup.js
async function downloadDocxFromSession(session) {
  const { Document, Packer, Paragraph, TextRun } = window.docx;
  const doc = new Document();

  let children = [
    new Paragraph({ children: [new TextRun({ text: `Session Name: ${session.name || 'TestSnapper Session'}`, bold: true, size: 28 })] }),
    new Paragraph({ text: `URL: ${session.url || ''}` }),
    new Paragraph({ text: `Date: ${new Date(session.startTime).toLocaleString()}` }),
    new Paragraph({ text: "" }),
    new Paragraph({ text: "Interactions:", bold: true }),
  ];

  // Add interactions
  for (const i of session.interactions || []) {
    let parts = [];
    parts.push(new TextRun({ text: `[${i.type.toUpperCase()}] `, bold: true }));
    if (i.selector) parts.push(new TextRun({ text: `Selector: ${i.selector}  ` }));
    if (i.text) parts.push(new TextRun({ text: `Text: ${i.text}  ` }));
    if (i.value) parts.push(new TextRun({ text: `Value: ${i.value}` }));
    children.push(new Paragraph({ children: parts }));
  }

  // Add screenshots (if any)
  if (session.screenshots && session.screenshots.length > 0) {
    children.push(new Paragraph({ text: "" }));
    children.push(new Paragraph({ text: "Screenshots:", bold: true }));

    for (const [idx, shot] of session.screenshots.entries()) {
      children.push(new Paragraph({ text: `Screenshot ${idx + 1} (${new Date(shot.timestamp).toLocaleString()})` }));
      if (shot.dataUrl && shot.dataUrl.startsWith("data:image")) {
        const imageRun = await doc.createImage(shot.dataUrl, { width: 400, height: 250 });
        children.push(new Paragraph(imageRun));
      }
      children.push(new Paragraph({ text: "" }));
    }
  }

  // CRITICAL: addSection must be called BEFORE toBlob
  doc.addSection({ children });

  const blob = await Packer.toBlob(doc);

  // Download
  const filename = `${session.name || 'session'}.docx`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}


// Initialize popup
console.log('Initializing TestSnapper popup...');
const popup = new TestSnapperPopup();
