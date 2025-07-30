// Popup script for TestSnapper extension
class TestSnapperPopup {
  constructor() {
    this.isRecording = false;
    this.sessions = [];
    this.settings = {
      autoScreenshot: true,
      screenshotQuality: 'medium',
      redactionPatterns: 'password,secret,token,api_key',
      darkMode: false
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

    document.getElementById('stop-btn').addEventListener('click', () => {
      this.stopRecording();
    });

    // Settings
    document.getElementById('save-settings').addEventListener('click', () => {
      this.saveSettings();
    });
  }

  switchTab(tabName) {
    console.log('Switching to tab:', tabName);

    // Update navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // Update content
    document.querySelectorAll('.tab-content').forEach(content => {
      content.classList.add('hidden');
    });
    document.getElementById(`${tabName}-tab`).classList.remove('hidden');

    this.currentTab = tabName;

    // Refresh data for sessions tab
    if (tabName === 'sessions') {
      console.log('Refreshing sessions data...');
      this.loadSessions().then(() => this.renderSessions());
    }
  }

  async loadData() {
    console.log('Loading popup data...');
    try {
      await Promise.all([
        this.loadRecordingStatus(),
        this.loadSessions(),
        this.loadSettings()
      ]);
      console.log('Data loaded successfully');
    } catch (error) {
      console.error('Error loading data:', error);
    }
  }

  async loadRecordingStatus() {
    try {
      console.log('Loading recording status...');
      const response = await chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATUS' });
      console.log('Recording status response:', response);

      if (response && typeof response.isRecording === 'boolean') {
        this.isRecording = response.isRecording;
        console.log('Recording status loaded:', this.isRecording);
      } else {
        console.warn('Invalid recording status response:', response);
        this.isRecording = false;
      }
    } catch (error) {
      console.error('Error loading recording status:', error);
      this.isRecording = false;
    }
  }

  async loadSessions() {
    try {
      console.log('Loading sessions...');
      const response = await chrome.runtime.sendMessage({ type: 'GET_SESSIONS' });
      console.log('Sessions response:', response);

      if (response && Array.isArray(response.sessions)) {
        this.sessions = response.sessions;
        console.log('Sessions loaded:', this.sessions.length);
      } else {
        console.warn('Invalid sessions response:', response);
        this.sessions = [];
      }
    } catch (error) {
      console.error('Error loading sessions:', error);
      this.sessions = [];
    }
  }

  async loadSettings() {
    try {
      console.log('Loading settings...');
      const result = await chrome.storage.local.get(['settings']);
      if (result.settings) {
        this.settings = { ...this.settings, ...result.settings };
        console.log('Settings loaded:', this.settings);
      }
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  updateUI() {
    console.log('Updating UI...');
    this.updateRecordingUI();
    this.renderSessions();
    this.updateSettingsUI();
  }

  updateRecordingUI() {
    const statusIndicator = document.getElementById('status-indicator');
    const notRecordingDiv = document.getElementById('not-recording');
    const recordingDiv = document.getElementById('recording');

    console.log('Updating recording UI, isRecording:', this.isRecording);

    if (this.isRecording) {
      statusIndicator.classList.add('recording');
      notRecordingDiv.classList.add('hidden');
      recordingDiv.classList.remove('hidden');
    } else {
      statusIndicator.classList.remove('recording');
      notRecordingDiv.classList.remove('hidden');
      recordingDiv.classList.add('hidden');
    }
  }

  renderAllInteractions(session) {
    if (!session.interactions || session.interactions.length === 0) return '';
    return `
    <div style="font-size:11px; margin:6px 0 2px 0; color:#374151; border-top:1px dashed #e5e7eb; padding-top:4px;">
      <div style="font-weight:600; color:#3b82f6; margin-bottom:2px;">Interactions:</div>
      ${session.interactions.map(i => {
      let desc = `[${Math.round((i.relativeTime || 0) / 1000)}s] ${i.type.toUpperCase()}`;
      if (i.selector) desc += ` <span style="color:#9ca3af">"${i.selector}"</span>`;
      if (i.value) desc += ` value: <span style="color:#059669">"${i.value}"</span>`;
      if (i.text && !i.value) desc += ` text: <span style="color:#059669">"${i.text}"</span>`;
      return `<div>• ${desc}</div>`;
    }).join('')}
    </div>
  `;
  }


  renderSessions() {
    const sessionsList = document.getElementById('sessions-list');
    const noSessions = document.getElementById('no-sessions');
    const sessionCount = document.getElementById('session-count');

    console.log('Rendering sessions, count:', this.sessions.length);

    sessionCount.textContent = `(${this.sessions.length})`;

    if (this.sessions.length === 0) {
      sessionsList.innerHTML = '';
      noSessions.classList.remove('hidden');
      return;
    }

    noSessions.classList.add('hidden');

    // Build HTML with data-session-id, not onclick
    sessionsList.innerHTML = this.sessions.map(session => `
  <div class="session-item">
    <div class="session-title">${this.escapeHtml(session.name)}</div>
    <div class="session-meta">
      ${new Date(session.startTime).toLocaleDateString()} • 
      ${session.interactions?.length || 0} interactions • 
      ${Math.round((session.duration || 0) / 1000)}s
    </div>
    <div class="session-url">${this.escapeHtml(session.url || '')}</div>
    ${this.renderAllInteractions(session)}
    ${session.networkCalls && session.networkCalls.length > 0 ?
        `<div style="font-size: 11px; color: #ef4444; margin-top: 4px;">
        ⚠️ ${session.networkCalls.length} network errors detected
      </div>` : ''
      }
    <div class="session-actions">
      <button class="btn-small btn-export" data-session-id="${session.id}">
        Export
      </button>
      <button class="btn-small btn-delete" data-session-id="${session.id}">
        Delete
      </button>
    </div>
  </div>
`).join('');


    // Add event listeners for Export
    sessionsList.querySelectorAll('.btn-export').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const sessionId = btn.getAttribute('data-session-id');
        this.exportSession(sessionId);
      });
    });

    // Add event listeners for Delete
    sessionsList.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const sessionId = btn.getAttribute('data-session-id');
        this.deleteSession(sessionId);
      });
    });
  }


  updateSettingsUI() {
    document.getElementById('auto-screenshot').checked = this.settings.autoScreenshot;
    document.getElementById('screenshot-quality').value = this.settings.screenshotQuality;
    document.getElementById('redaction-patterns').value = this.settings.redactionPatterns;
    document.getElementById('dark-mode').checked = this.settings.darkMode;
  }

  async startRecording() {
    try {
      console.log('Starting recording...');

      // Disable button to prevent double clicks
      const startBtn = document.getElementById('start-btn');
      startBtn.disabled = true;
      startBtn.textContent = 'Starting...';

      const response = await chrome.runtime.sendMessage({ type: 'START_RECORDING' });
      console.log('Start recording response:', response);

      if (response && response.success) {
        this.isRecording = true;
        this.updateRecordingUI();
        console.log('Recording started successfully');

        // Close popup after starting recording
        setTimeout(() => {
          console.log('Closing popup...');
          window.close();
        }, 500);
      } else {
        throw new Error(response?.error || 'Failed to start recording');
      }
    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Failed to start recording: ' + error.message);

      // Re-enable button
      const startBtn = document.getElementById('start-btn');
      startBtn.disabled = false;
      startBtn.textContent = 'Start Recording';
    }
  }

  async stopRecording() {
    try {
      console.log('Stopping recording...');

      // Disable button to prevent double clicks
      const stopBtn = document.getElementById('stop-btn');
      stopBtn.disabled = true;
      stopBtn.textContent = 'Stopping...';

      const response = await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
      console.log('Stop recording response:', response);

      if (response && response.success) {
        this.isRecording = false;
        this.updateRecordingUI();
        console.log('Recording stopped successfully');

        // Refresh sessions list
        await this.loadSessions();
        this.renderSessions();
        console.log('Sessions refreshed after stop');
      } else {
        throw new Error(response?.error || 'Failed to stop recording');
      }
    } catch (error) {
      console.error('Error stopping recording:', error);
      alert('Failed to stop recording: ' + error.message);
    } finally {
      // Re-enable button
      const stopBtn = document.getElementById('stop-btn');
      stopBtn.disabled = false;
      stopBtn.textContent = 'Stop Recording';
    }
  }

  async exportSession(sessionId) {
    try {
      console.log('Exporting session:', sessionId);
      const response = await chrome.runtime.sendMessage({
        type: 'EXPORT_SESSION',
        sessionId
      });

      if (response && response.exportData) {
        // Create and download the .txt file
        const blob = new Blob([response.exportData.txtContent], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${response.exportData.session.name.replace(/[^a-z0-9]/gi, '_')}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        console.log('Session exported successfully');
      } else {
        throw new Error('No export data received');
      }
    } catch (error) {
      console.error('Error exporting session:', error);
      alert('Failed to export session: ' + error.message);
    }
  }

  async deleteSession(sessionId) {
    if (!confirm('Are you sure you want to delete this session?')) return;

    try {
      console.log('Deleting session:', sessionId);
      const updatedSessions = this.sessions.filter(s => s.id !== sessionId);
      await chrome.storage.local.set({ sessions: updatedSessions });
      this.sessions = updatedSessions;
      this.renderSessions();
      console.log('Session deleted successfully');
    } catch (error) {
      console.error('Error deleting session:', error);
      alert('Failed to delete session: ' + error.message);
    }
  }

  async saveSettings() {
    try {
      this.settings.autoScreenshot = document.getElementById('auto-screenshot').checked;
      this.settings.screenshotQuality = document.getElementById('screenshot-quality').value;
      this.settings.redactionPatterns = document.getElementById('redaction-patterns').value;
      this.settings.darkMode = document.getElementById('dark-mode').checked;

      await chrome.storage.local.set({ settings: this.settings });

      // Visual feedback
      const btn = document.getElementById('save-settings');
      const originalText = btn.textContent;
      btn.textContent = 'Saved!';
      btn.style.background = '#059669';
      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.background = '';
      }, 1500);

      console.log('Settings saved successfully');
    } catch (error) {
      console.error('Error saving settings:', error);
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