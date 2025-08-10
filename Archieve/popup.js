// Enhanced Popup script for TestSnapper extension with bulk session management and auto-clear

class TestSnapperPopup {
  constructor() {
    this.isRecording = false;
    this.isPaused = false;
    this.sessions = [];
    this.selectedSessions = new Set();
    this.settings = {
      autoScreenshot: true,
      inputTimeFrame: 2000, // 2 seconds default
      screenshotQuality: 'medium',
      redactionPatterns: 'password,secret,token,api_key',
      darkMode: false,
      defaultExportFormat: 'txt',
      autoClearDays: 2 // Auto-clear sessions after 2 days
    };
    this.currentTab = 'record';
    this.init();
  }

  async init() {
    console.log('TestSnapper Popup initializing...');
    this.setupEventListeners();
    
    // Auto-clear old sessions before loading data
    await this.autoClearOldSessions();
    
    await this.loadData();
    this.updateUI();
    console.log('TestSnapper Popup initialized');
  }

  async autoClearOldSessions() {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_SESSIONS' });
      if (response && Array.isArray(response.sessions)) {
        const sessions = response.sessions;
        const cutoffTime = Date.now() - (this.settings.autoClearDays * 24 * 60 * 60 * 1000);
        
        const validSessions = sessions.filter(session => {
          return session.startTime && session.startTime > cutoffTime;
        });

        if (validSessions.length < sessions.length) {
          console.log(`Auto-clearing ${sessions.length - validSessions.length} old sessions`);
          await chrome.storage.local.set({ sessions: validSessions });
        }
      }
    } catch (error) {
      console.log('Auto-clear failed:', error);
    }
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

    // Manual screenshot (works even when paused)
    const screenshotBtns = document.querySelectorAll('#screenshot-btn');
    screenshotBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.captureManualScreenshot();
      });
    });

    // Settings save
    document.getElementById('save-settings').addEventListener('click', () => {
      this.saveSettings();
    });

    // Input time frame slider
    const timeFrameSlider = document.getElementById('input-time-frame');
    const timeFrameValue = document.getElementById('time-frame-value');
    if (timeFrameSlider && timeFrameValue) {
      timeFrameSlider.addEventListener('input', (e) => {
        const value = parseInt(e.target.value);
        timeFrameValue.textContent = `${value / 1000}s`;
        this.settings.inputTimeFrame = value;
      });
    }

    // Export format selector in settings
    const exportFormatSelect = document.getElementById('export-format-select');
    if (exportFormatSelect) {
      exportFormatSelect.addEventListener('change', (e) => {
        this.settings.defaultExportFormat = e.target.value;
        this.saveSettings();
      });
    }

    // Bulk session management
    this.setupBulkSessionControls();
  }

  setupBulkSessionControls() {
    // Will be called after sessions tab is rendered
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
      const response = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (response && response.settings) {
        this.settings = { ...this.settings, ...response.settings };
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
      this.renderBulkControls(false);
      return;
    }
    noSessions.classList.add('hidden');

    // Render bulk controls first
    this.renderBulkControls(true);

    sessionsList.innerHTML = this.sessions.map(session => {
      const activeDuration = session.activeDuration || session.duration || 0;
      const totalDuration = session.duration || 0;
      const durationText = activeDuration !== totalDuration ?
        `${Math.round(activeDuration / 1000)}s active (${Math.round(totalDuration / 1000)}s total)` :
        `${Math.round(totalDuration / 1000)}s`;

      const isSelected = this.selectedSessions.has(session.id);

      return `
      <div class="session-item">
        <div class="session-header">
          <input type="checkbox" class="session-checkbox" data-session-id="${session.id}" ${isSelected ? 'checked' : ''}>
          <div class="session-title">${this.escapeHtml(session.name)}</div>
        </div>
        <div class="session-meta">
          ${new Date(session.startTime).toLocaleDateString()} • 
          ${session.interactions?.length || 0} interactions • 
          ${session.screenshots?.length || 0} screenshots • 
          ${durationText}${session.apiFailures?.length ? ` • ${session.apiFailures.length} API failures` : ''}
        </div>
        <div class="session-url">${this.escapeHtml(session.url || '')}</div>
        ${this.renderSessionDetails(session)}
        <div class="session-actions">
          <div class="export-controls">
            <select class="export-format-select" data-session-id="${session.id}">
              <option value="txt">TXT</option>
              <option value="csv">CSV</option>
              <option value="docx">DOCX</option>
              <option value="pdf">PDF</option>
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

    // Add event listeners
    this.addSessionEventListeners();
  }

  renderBulkControls(hasSessions) {
    const bulkControlsContainer = document.getElementById('bulk-controls');
    if (!bulkControlsContainer) {
      // Create bulk controls container if it doesn't exist
      const sessionsTab = document.getElementById('sessions-tab');
      const bulkControls = document.createElement('div');
      bulkControls.id = 'bulk-controls';
      bulkControls.className = 'bulk-controls';
      sessionsTab.insertBefore(bulkControls, document.getElementById('sessions-list'));
    }

    const bulkControls = document.getElementById('bulk-controls');
    
    if (!hasSessions) {
      bulkControls.style.display = 'none';
      return;
    }

    bulkControls.style.display = 'block';
    bulkControls.innerHTML = `
      <div class="bulk-controls-row">
        <div class="bulk-selection">
          <button id="select-all-btn" class="btn-small">Select All</button>
          <button id="deselect-all-btn" class="btn-small">Deselect All</button>
          <span id="selected-count" class="selected-count">0 selected</span>
        </div>
        <div class="bulk-actions">
          <button id="clear-all-btn" class="btn-small btn-danger">Clear All Sessions</button>
          <button id="delete-selected-btn" class="btn-small btn-danger" disabled>Delete Selected</button>
        </div>
      </div>
    `;

    // Add bulk control event listeners
    document.getElementById('select-all-btn').addEventListener('click', () => {
      this.selectAllSessions();
    });

    document.getElementById('deselect-all-btn').addEventListener('click', () => {
      this.deselectAllSessions();
    });

    document.getElementById('clear-all-btn').addEventListener('click', () => {
      this.clearAllSessions();
    });

    document.getElementById('delete-selected-btn').addEventListener('click', () => {
      this.deleteSelectedSessions();
    });

    this.updateBulkControlsState();
  }

  selectAllSessions() {
    this.selectedSessions.clear();
    this.sessions.forEach(session => {
      this.selectedSessions.add(session.id);
    });
    this.updateSessionCheckboxes();
    this.updateBulkControlsState();
  }

  deselectAllSessions() {
    this.selectedSessions.clear();
    this.updateSessionCheckboxes();
    this.updateBulkControlsState();
  }

  updateSessionCheckboxes() {
    document.querySelectorAll('.session-checkbox').forEach(checkbox => {
      const sessionId = checkbox.getAttribute('data-session-id');
      checkbox.checked = this.selectedSessions.has(sessionId);
    });
  }

  updateBulkControlsState() {
    const selectedCountEl = document.getElementById('selected-count');
    const deleteSelectedBtn = document.getElementById('delete-selected-btn');
    
    if (selectedCountEl) {
      selectedCountEl.textContent = `${this.selectedSessions.size} selected`;
    }
    
    if (deleteSelectedBtn) {
      deleteSelectedBtn.disabled = this.selectedSessions.size === 0;
    }
  }

  async clearAllSessions() {
    if (!confirm('Are you sure you want to clear ALL sessions? This action cannot be undone.')) return;
    
    try {
      await chrome.storage.local.set({ sessions: [] });
      this.sessions = [];
      this.selectedSessions.clear();
      this.renderSessions();
      console.log('All sessions cleared');
    } catch (error) {
      alert('Failed to clear sessions: ' + error.message);
    }
  }

  async deleteSelectedSessions() {
    if (this.selectedSessions.size === 0) return;
    
    if (!confirm(`Are you sure you want to delete ${this.selectedSessions.size} selected session(s)? This action cannot be undone.`)) return;
    
    try {
      const updatedSessions = this.sessions.filter(s => !this.selectedSessions.has(s.id));
      await chrome.storage.local.set({ sessions: updatedSessions });
      this.sessions = updatedSessions;
      this.selectedSessions.clear();
      this.renderSessions();
      console.log('Selected sessions deleted');
    } catch (error) {
      alert('Failed to delete selected sessions: ' + error.message);
    }
  }

  renderSessionDetails(session) {
    let details = '';

    // Settings used during recording
    if (session.metadata && session.metadata.settings) {
      const settings = session.metadata.settings;
      details += `<div style="font-size:10px; color:#6b7280; margin-bottom:4px; border-top:1px dashed #e5e7eb; padding-top:4px;">`;
      details += `⚙️ Time frame: ${(settings.inputTimeFrame || 2000) / 1000}s • `;
      details += `Screenshots: ${settings.autoScreenshot ? 'Auto' : 'Manual'}`;
      details += `</div>`;
    }

    if (session.pauseEvents && session.pauseEvents.length > 0) {
      const pauseCount = session.pauseEvents.filter(e => e.type === 'pause').length;
      details += `<div style="font-size:10px; color:#f59e0b; margin-bottom:2px;">⏸️ ${pauseCount} pause(s) during session</div>`;
    }

    if (session.apiFailures && session.apiFailures.length > 0) {
      details += `<div style="font-size:10px; color:#ef4444; margin-bottom:2px;">⚠️ ${session.apiFailures.length} API failure(s)</div>`;
    }

    if (session.screenshots && session.screenshots.length > 0) {
      details += `<div style="font-size:10px; color:#10b981; margin-bottom:2px;">📸 ${session.screenshots.length} screenshots captured</div>`;
    }

    // Create combined timeline of interactions and API failures
    const combinedTimeline = this.createCombinedTimeline(session);

    if (combinedTimeline.length > 0) {
      details += `
      <div style="font-size:11px; margin:6px 0 2px 0; color:#374151; border-top:1px dashed #e5e7eb; padding-top:4px;">
        <div style="font-weight:600; color:#3b82f6; margin-bottom:2px;">Recent Timeline:</div>
        ${combinedTimeline.slice(-4).map(item => {
        if (item.type === 'api_failure') {
          return `<div style="color:#ef4444;">• [${Math.round(item.relativeTime / 1000)}s] ⚠️ API FAILURE: ${item.method} ${item.url} (${item.statusCode || item.error})${item.afterStep ? ` after step ${item.afterStep.step}` : ''}</div>`;
        } else {
          let desc = `[${Math.round(item.relativeTime / 1000)}s] ${item.type.toUpperCase()}`;
          if (item.timeFrame) desc += ` <span style="color:#f59e0b;">(${item.timeFrame})</span>`;
          if (item.selector) desc += ` <span style="color:#9ca3af">"${item.selector}"</span>`;
          if (item.value) desc += ` value: <span style="color:#059669">"${item.value}"</span>`;
          if (item.text && !item.value) desc += ` text: <span style="color:#059669">"${item.text.substring(0, 30)}"</span>`;
          return `<div>• ${desc}</div>`;
        }
      }).join('')}
        ${combinedTimeline.length > 4 ? `<div style="color:#9ca3af;">... and ${combinedTimeline.length - 4} more events</div>` : ''}
      </div>
      `;
    }

    return details;
  }

  createCombinedTimeline(session) {
    const timeline = [];

    // Add interactions
    if (session.interactions) {
      session.interactions.forEach(interaction => {
        timeline.push({
          ...interaction,
          itemType: 'interaction'
        });
      });
    }

    // Add API failures
    if (session.apiFailures) {
      session.apiFailures.forEach(failure => {
        timeline.push({
          ...failure,
          itemType: 'api_failure'
        });
      });
    }

    // Sort by relative time
    timeline.sort((a, b) => (a.relativeTime || 0) - (b.relativeTime || 0));

    return timeline;
  }

  addSessionEventListeners() {
    const sessionsList = document.getElementById('sessions-list');
    
    // Session checkboxes
    sessionsList.querySelectorAll('.session-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const sessionId = e.target.getAttribute('data-session-id');
        if (e.target.checked) {
          this.selectedSessions.add(sessionId);
        } else {
          this.selectedSessions.delete(sessionId);
        }
        this.updateBulkControlsState();
      });
    });
    
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

    // Input time frame slider
    const timeFrameSlider = document.getElementById('input-time-frame');
    const timeFrameValue = document.getElementById('time-frame-value');
    if (timeFrameSlider && timeFrameValue) {
      timeFrameSlider.value = this.settings.inputTimeFrame;
      timeFrameValue.textContent = `${this.settings.inputTimeFrame / 1000}s`;
    }

    const exportFormatSelect = document.getElementById('export-format-select');
    if (exportFormatSelect) exportFormatSelect.value = this.settings.defaultExportFormat;
  }

  async startRecording() {
    try {
      // First save current settings to ensure they are applied
      await this.saveSettings();

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
      const screenshotBtns = document.querySelectorAll('#screenshot-btn');
      screenshotBtns.forEach(btn => {
        btn.disabled = true;
        btn.textContent = 'Capturing...';
      });

      // Manual screenshots should always work regardless of auto-screenshot setting or paused state
      const response = await chrome.runtime.sendMessage({
        type: 'CAPTURE_SCREENSHOT',
        data: {
          type: 'manual_capture',
          manual: true, // This flag ensures it works even when autoScreenshot is disabled
          allowWhenPaused: true, // This flag allows screenshots when paused
          timestamp: Date.now()
        }
      });

      if (response && response.success) {
        screenshotBtns.forEach(btn => {
          btn.textContent = 'Captured!';
          btn.style.background = '#059669';
        });
        setTimeout(() => {
          screenshotBtns.forEach(btn => {
            btn.textContent = '📸 Screenshot';
            btn.style.background = '';
            btn.disabled = false;
          });
        }, 1000);
      } else {
        throw new Error('Failed to capture screenshot');
      }
    } catch (error) {
      const screenshotBtns = document.querySelectorAll('#screenshot-btn');
      screenshotBtns.forEach(btn => {
        btn.disabled = false;
        btn.textContent = '📸 Screenshot';
      });
    }
  }

  async exportSession(sessionId, format = 'txt') {
    try {
      const exportBtn = document.querySelector(`button[data-session-id="${sessionId}"]`);
      const originalText = exportBtn.textContent;
      exportBtn.disabled = true;
      exportBtn.textContent = 'Exporting...';

      if (format === 'docx') {
        // DOCX is generated locally using the fixed function
        const session = this.sessions.find(s => s.id === sessionId);
        if (session) {
          await this.downloadDocxFromSession(session);
          exportBtn.textContent = 'Exported!';
          exportBtn.classList.add('success');
          setTimeout(() => {
            exportBtn.textContent = originalText;
            exportBtn.classList.remove('success');
            exportBtn.disabled = false;
          }, 1500);
          return;
        } else {
          throw new Error('Session not found for DOCX export');
        }
      }

      // For other formats, use background script
      const response = await chrome.runtime.sendMessage({
        type: 'EXPORT_SESSION',
        sessionId,
        format
      });

      if (response && response.exportData) {
        await this.downloadExportedFile(response.exportData, format);
        exportBtn.textContent = 'Exported!';
        exportBtn.classList.add('success');
        setTimeout(() => {
          exportBtn.textContent = originalText;
          exportBtn.classList.remove('success');
          exportBtn.disabled = false;
        }, 1500);
      } else {
        throw new Error('No export data received');
      }
    } catch (error) {
      console.error('Export failed:', error);
      alert('Failed to export session: ' + error.message);
      const exportBtn = document.querySelector(`button[data-session-id="${sessionId}"]`);
      exportBtn.disabled = false;
      exportBtn.textContent = 'Export';
      exportBtn.classList.add('error');
      setTimeout(() => {
        exportBtn.classList.remove('error');
      }, 2000);
    }
  }

  // Fixed DOCX export function with proper screenshot handling and time frame support
  async downloadDocxFromSession(session) {
    try {
      if (!window.docx) {
        throw new Error('DOCX library not loaded');
      }

      const { Document, Packer, Paragraph, TextRun, ImageRun } = window.docx;

      // Create document content
      const children = await this.createDocumentContent(session);

      // Create document
      const doc = new Document({
        sections: [{
          children: children
        }]
      });

      // Generate and download
      const blob = await Packer.toBlob(doc);
      const filename = `${(session.name || 'session').replace(/[^a-z0-9]/gi, '_')}.docx`;

      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);

      console.log('DOCX exported successfully:', filename);
    } catch (error) {
      console.error('DOCX export failed:', error);
      throw error;
    }
  }

  async createDocumentContent(session) {
    const { Paragraph, TextRun, ImageRun } = window.docx;
    const children = [];

    // Title and metadata
    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `TestSnapper Session: ${session.name || 'Untitled Session'}`,
            bold: true,
            size: 32,
            color: "2563EB"
          })
        ],
        spacing: { after: 200 }
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "URL: ", bold: true }),
          new TextRun({ text: session.url || 'N/A' })
        ]
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "Date: ", bold: true }),
          new TextRun({ text: new Date(session.startTime).toLocaleString() })
        ]
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "Duration: ", bold: true }),
          new TextRun({
            text: `${Math.round((session.activeDuration || session.duration || 0) / 1000)}s active` +
              (session.duration !== session.activeDuration ?
                ` (${Math.round((session.duration || 0) / 1000)}s total)` : '')
          })
        ]
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "Time Frame: ", bold: true }),
          new TextRun({
            text: `${(session.metadata?.settings?.inputTimeFrame || 2000) / 1000}s`
          })
        ]
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "Interactions: ", bold: true }),
          new TextRun({ text: `${session.interactions?.length || 0}` })
        ]
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "Screenshots: ", bold: true }),
          new TextRun({ text: `${session.screenshots?.length || 0}` })
        ]
      }),

      new Paragraph({
        children: [
          new TextRun({ text: "API Failures: ", bold: true }),
          new TextRun({ text: `${session.apiFailures?.length || 0}` })
        ]
      }),

      // Empty line
      new Paragraph({ text: "" })
    );

    // Create combined timeline
    const combinedTimeline = this.createCombinedTimeline(session);

    if (combinedTimeline.length > 0) {
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: "Timeline (Interactions & API Failures):", bold: true, size: 24 })
          ],
          spacing: { before: 200, after: 100 }
        })
      );

      for (let i = 0; i < combinedTimeline.length; i++) {
        const item = combinedTimeline[i];
        if (item.itemType === 'api_failure') {
          const failureParagraphs = await this.createApiFailureParagraphs(item, i + 1);
          children.push(...failureParagraphs);
        } else {
          const interactionParagraphs = await this.createInteractionParagraphs(item, i + 1, session.screenshots);
          children.push(...interactionParagraphs);
        }
      }
    }

    // Add screenshots section if any
    if (session.screenshots && session.screenshots.length > 0) {
      children.push(
        new Paragraph({ text: "" }),
        new Paragraph({
          children: [
            new TextRun({ text: "Screenshots:", bold: true, size: 24 })
          ],
          spacing: { before: 200, after: 100 }
        })
      );

      for (let i = 0; i < session.screenshots.length; i++) {
        const screenshot = session.screenshots[i];
        const screenshotParagraphs = await this.createScreenshotParagraphs(screenshot, i + 1);
        children.push(...screenshotParagraphs);
      }
    }

    return children;
  }

  async createInteractionParagraphs(interaction, index, screenshots) {
    const { Paragraph, TextRun } = window.docx;
    const paragraphs = [];

    // Main interaction description
    const interactionText = [
      new TextRun({
        text: `${index}. [${Math.round((interaction.relativeTime || 0) / 1000)}s] `,
        bold: true,
        color: "374151"
      }),
      new TextRun({
        text: interaction.type.toUpperCase(),
        bold: true,
        color: this.getInteractionColor(interaction.type)
      })
    ];

    // Add time frame if available
    if (interaction.timeFrame) {
      interactionText.push(
        new TextRun({
          text: ` (${interaction.timeFrame})`,
          color: "F59E0B",
          bold: true
        })
      );
    }

    if (interaction.selector) {
      interactionText.push(
        new TextRun({ text: ' on ' }),
        new TextRun({
          text: `"${interaction.selector}"`,
          italics: true,
          color: "6B7280"
        })
      );
    }

    paragraphs.push(new Paragraph({ children: interactionText }));

    // Add details
    const details = [];
    if (interaction.value && interaction.value !== '[REDACTED]') {
      details.push(`Value: "${interaction.value}"`);
    } else if (interaction.value === '[REDACTED]') {
      details.push('Value: [REDACTED]');
    }

    if (interaction.text && !interaction.value) {
      const text = interaction.text.length > 50 ?
        interaction.text.substring(0, 50) + '...' :
        interaction.text;
      details.push(`Text: "${text}"`);
    }

    if (details.length > 0) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `   ${details.join(' | ')}`,
              color: "6B7280",
              size: 20
            })
          ]
        })
      );
    }

    // Add related screenshot if exists
    const relatedScreenshot = screenshots?.find(s =>
      s.context.interactionId === interaction.id ||
      s.context.interactionType === interaction.type
    );

    if (relatedScreenshot) {
      try {
        const screenshotParagraph = await this.createInlineScreenshot(relatedScreenshot);
        if (screenshotParagraph) {
          paragraphs.push(screenshotParagraph);
        }
      } catch (error) {
        console.warn('Failed to add screenshot to interaction:', error);
      }
    }

    paragraphs.push(new Paragraph({ text: "" })); // Empty line

    return paragraphs;
  }

  async createApiFailureParagraphs(failure, index) {
    const { Paragraph, TextRun } = window.docx;
    const paragraphs = [];

    // Main failure description
    const failureText = [
      new TextRun({
        text: `${index}. [${Math.round((failure.relativeTime || 0) / 1000)}s] `,
        bold: true,
        color: "374151"
      }),
      new TextRun({
        text: "⚠️ API FAILURE",
        bold: true,
        color: "EF4444"
      }),
      new TextRun({
        text: ` ${failure.method} ${failure.url}`,
        color: "374151"
      })
    ];

    paragraphs.push(new Paragraph({ children: failureText }));

    // Add failure details
    const details = [];
    details.push(`Status: ${failure.statusCode || failure.error}`);
    if (failure.afterStep) {
      details.push(`After Step: ${failure.afterStep.step} - ${failure.afterStep.type.toUpperCase()}`);
      if (failure.afterStep.selector) {
        details.push(`Element: "${failure.afterStep.selector}"`);
      }
    }

    if (details.length > 0) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `   ${details.join(' | ')}`,
              color: "DC2626",
              size: 20
            })
          ]
        })
      );
    }

    paragraphs.push(new Paragraph({ text: "" })); // Empty line

    return paragraphs;
  }

  async createScreenshotParagraphs(screenshot, index) {
    const { Paragraph, TextRun } = window.docx;
    const paragraphs = [];

    // Screenshot title
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `Screenshot ${index}: `,
            bold: true
          }),
          new TextRun({
            text: `${screenshot.context.type || 'manual'} `,
            color: "3B82F6"
          }),
          new TextRun({
            text: `[${Math.round((screenshot.relativeTime || 0) / 1000)}s]`,
            color: "6B7280"
          })
        ]
      })
    );

    // Add screenshot image
    try {
      const screenshotParagraph = await this.createInlineScreenshot(screenshot, 400);
      if (screenshotParagraph) {
        paragraphs.push(screenshotParagraph);
      }
    } catch (error) {
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `   [Screenshot could not be embedded: ${error.message}]`,
              italics: true,
              color: "EF4444"
            })
          ]
        })
      );
    }

    paragraphs.push(new Paragraph({ text: "" })); // Empty line

    return paragraphs;
  }

  async createInlineScreenshot(screenshot, maxWidth = 300) {
    const { Paragraph, ImageRun } = window.docx;

    if (!screenshot.dataUrl || !screenshot.dataUrl.startsWith('data:image')) {
      return null;
    }

    try {
      // Convert data URL to buffer
      const response = await fetch(screenshot.dataUrl);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = new Uint8Array(arrayBuffer);

      // Create image run
      const imageRun = new ImageRun({
        data: buffer,
        transformation: {
          width: maxWidth,
          height: Math.round(maxWidth * 0.6) // Maintain aspect ratio approximately
        }
      });

      return new Paragraph({
        children: [imageRun],
        spacing: { before: 100, after: 100 }
      });

    } catch (error) {
      console.error('Failed to create inline screenshot:', error);
      return null;
    }
  }

  getInteractionColor(type) {
    const colors = {
      'click': '3B82F6',      // Blue
      'input': '10B981',      // Green
      'change': '10B981',     // Green
      'navigation': '8B5CF6', // Purple
      'url_change': '8B5CF6', // Purple
      'scroll': '6B7280',     // Gray
      'hover': 'F59E0B',      // Orange
      'keypress': 'EF4444',   // Red
      'session_start': '059669', // Dark green
      'session_end': 'DC2626',   // Dark red
      'session_pause': 'D97706', // Dark orange
      'session_resume': '047857' // Dark green
    };
    return colors[type] || '374151'; // Default gray
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
      this.selectedSessions.delete(sessionId); // Remove from selection if selected
      this.renderSessions();
    } catch (error) {
      alert('Failed to delete session: ' + error.message);
    }
  }

  async saveSettings() {
    try {
      // Update settings from UI
      this.settings.autoScreenshot = document.getElementById('auto-screenshot').checked;
      this.settings.screenshotQuality = document.getElementById('screenshot-quality').value;
      this.settings.redactionPatterns = document.getElementById('redaction-patterns').value;
      this.settings.darkMode = document.getElementById('dark-mode').checked;

      // Input time frame from slider
      const timeFrameSlider = document.getElementById('input-time-frame');
      if (timeFrameSlider) {
        this.settings.inputTimeFrame = parseInt(timeFrameSlider.value);
      }

      const exportFormatSelect = document.getElementById('export-format-select');
      if (exportFormatSelect) this.settings.defaultExportFormat = exportFormatSelect.value;

      // Save to both local storage and send to background script
      await chrome.storage.local.set({ settings: this.settings });

      // Update background script settings
      await chrome.runtime.sendMessage({
        type: 'UPDATE_SETTINGS',
        settings: this.settings
      });

      const btn = document.getElementById('save-settings');
      const originalText = btn.textContent;
      btn.textContent = 'Saved!';
      btn.style.background = '#059669';
      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.background = '';
      }, 1500);

      console.log('Settings saved successfully:', this.settings);
    } catch (error) {
      console.error('Failed to save settings:', error);
      alert('Failed to save settings: ' + error.message);
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}

// Initialize popup
console.log('Initializing TestSnapper popup...');
const popup = new TestSnapperPopup();