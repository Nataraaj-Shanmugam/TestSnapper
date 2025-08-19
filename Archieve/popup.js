// popup.js — FINAL (bulk buttons fixed + export selected + per-session export/delete +
// style modes + pause-safe controls + visible labels + duplicate “Select All” guard)

/* ==============================================
   Constants & Helpers
================================================= */
const STYLE_LIGHT = 'light';
const STYLE_MODERN = 'modern';

function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, (t) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[t]||t));
}
function formatTimestamp(ts) { return ts ? new Date(ts).toLocaleString() : ''; }

const LIGHT_CSS = `
body{font-family:Arial,sans-serif;font-size:14px;margin:0;padding:0;background:#fff;color:#333}
.header{padding:8px 12px;border-bottom:1px solid #ddd;font-weight:bold}
.nav-btn{background:none;border:none;padding:6px 12px;cursor:pointer;transition:background-color .2s}
.nav-btn:hover{background:rgba(0,0,0,.05)}
.nav-btn.active{border-bottom:2px solid #3b82f6;font-weight:bold}
.session-item{padding:8px;border-bottom:1px solid #eee}
.session-item:hover{background:rgba(0,0,0,.02)}
.session-timeline{margin-top:6px}
.timeline-toggle{color:#3b82f6;cursor:pointer}
.timeline-toggle:hover{text-decoration:underline}
.selected{outline:2px solid #2563eb20;border-radius:6px}
.btn-small{padding:4px 8px;border:1px solid #d1d5db;border-radius:6px;background:#fff;cursor:pointer}
.btn-primary{border-color:#2563eb}
.btn-danger{border-color:#ef4444}
.btn-export{border-color:#10b981}
.hidden{display:none}
`;

const MODERN_CSS = `
body{font-family:"Segoe UI",Tahoma,sans-serif;font-size:14px;margin:0;padding:0;background:var(--bg,#f8f9fa);color:var(--fg,#222)}
.header{padding:12px 16px;border-bottom:1px solid #ccc;font-weight:bold;background:var(--header,#fff)}
.nav-btn{background:none;border:none;padding:10px 14px;cursor:pointer;font-size:14px;transition:background-color .25s,color .25s;border-radius:6px}
.nav-btn:hover{background:rgba(59,130,246,.1);color:#2563eb}
.nav-btn.active{background:#2563eb;color:#fff}
.session-item{background:var(--card,#fff);margin:8px 12px;padding:10px 14px;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,.08);transition:box-shadow .2s}
.session-item:hover{box-shadow:0 2px 6px rgba(0,0,0,.12)}
.session-timeline{margin-top:8px;padding:8px;background:rgba(0,0,0,.02);border-radius:4px}
.timeline-toggle{color:#2563eb;cursor:pointer;font-weight:500;margin-top:4px;display:inline-block}
.timeline-toggle:hover{text-decoration:underline}
.selected{outline:2px solid #2563eb40}
.btn-small{padding:4px 8px;border:1px solid #33415533;border-radius:8px;background:var(--header,#fff);cursor:pointer}
.btn-primary{border-color:#2563eb}
.btn-danger{border-color:#ef4444}
.btn-export{border-color:#10b981}
.hidden{display:none}
body.dark{--bg:#1f2937;--fg:#f9fafb;--header:#111827;--card:#374151}
`;

function injectStyle(css) {
  let tag = document.getElementById('dynamic-style');
  if (!tag) { tag = document.createElement('style'); tag.id = 'dynamic-style'; document.head.appendChild(tag); }
  tag.textContent = css;
}
function applyStyleMode(mode, darkMode) {
  if (mode === STYLE_LIGHT) { injectStyle(LIGHT_CSS); document.body.classList.remove('dark'); }
  else { injectStyle(MODERN_CSS); document.body.classList.toggle('dark', !!darkMode); }
}

// Tolerate both old and new checkbox classes
function getSessionCheckboxes() {
  return Array.from(document.querySelectorAll('.session-checkbox, .session-select'));
}

/* ==============================================
   Visibility fixes for blank-looking buttons
================================================= */
(function ensureButtonTextCSS() {
  const fix = document.createElement('style');
  fix.id = 'btn-text-visibility-fix';
  fix.textContent = `
    .btn-small { color: var(--fg, #111) !important; }
    /* If a button has no text, show its data-label (fallback) */
    .btn-small:empty::after { content: attr(data-label); }
  `;
  document.head.appendChild(fix);
})();

function ensureBulkButtonLabels() {
  const setIfEmpty = (el, label) => {
    if (!el) return;
    const hasText = el.textContent && el.textContent.trim().length > 0;
    if (!hasText) {
      el.textContent = label;                 // primary
      el.setAttribute('data-label', label);   // fallback via CSS
      el.setAttribute('aria-label', label);
      el.title = label;
    }
  };
  setIfEmpty(document.getElementById('select-all-btn'), 'Select All');
  setIfEmpty(document.getElementById('deselect-all-btn'), 'Deselect All');
  setIfEmpty(document.getElementById('export-selected-btn'), 'Export Selected');
  setIfEmpty(document.getElementById('delete-selected-btn'), 'Delete Selected');
  setIfEmpty(document.getElementById('clear-all-btn') || document.getElementById('clear-all-sessions-btn'), 'Clear All');
}

function hideDuplicateSelectAllIfPresent() {
  const btn = document.getElementById('select-all-btn');
  const cb  = document.getElementById('select-all-sessions');
  if (btn && cb) {
    const label = cb.closest('label') || cb;
    label.style.display = 'none';
  }
}

/* ==============================================
   Popup Class
================================================= */
class TestSnapperPopup {
  constructor() {
    this.isRecording = false;
    this.isPaused = false;
    this.sessions = [];
    this.selectedSessions = new Set();
    this.expandedTimelines = new Set();

    this.settings = {
      autoScreenshot: true,
      inputTimeFrame: 2000,
      screenshotQuality: 'medium',
      redactionPatterns: 'password,secret,token,api_key',
      darkMode: false,
      defaultExportFormat: 'txt',
      autoClearDays: 2,
      styleMode: STYLE_MODERN
    };

    this.currentTab = 'record';
    this.$ = {};
  }

  async init() {
    console.log('TestSnapper Popup initializing...');
    this.$.sessionsList = document.getElementById('sessions-list');
    this.$.noSessions = document.getElementById('no-sessions');
    this.$.sessionCount = document.getElementById('session-count');

    applyStyleMode(this.settings.styleMode, this.settings.darkMode);
    this.setupEventListeners();

    await this.autoClearOldSessions();
    await this.loadRecordingStatus();
    await this.loadSessions();
    await this.loadSettings();

    applyStyleMode(this.settings.styleMode, this.settings.darkMode);
    this.updateUI();
    console.log('TestSnapper Popup initialized');
  }

  /* ---------------- Events ---------------- */
  setupEventListeners() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
    });

    const startBtn = document.getElementById('start-btn');
    const pauseBtn = document.getElementById('pause-btn');
    const resumeBtn = document.getElementById('resume-btn');
    const stopBtn = document.getElementById('stop-btn');
    if (startBtn) startBtn.addEventListener('click', () => this.startRecording());
    if (pauseBtn) pauseBtn.addEventListener('click', () => this.pauseRecording());
    if (resumeBtn) resumeBtn.addEventListener('click', () => this.resumeRecording());
    if (stopBtn) stopBtn.addEventListener('click', () => this.stopRecording());

    document.querySelectorAll('#screenshot-btn').forEach(btn => {
      btn.addEventListener('click', () => this.captureManualScreenshot());
      btn.disabled = false; // keep usable while paused
    });

    const saveSettingsBtn = document.getElementById('save-settings');
    if (saveSettingsBtn) saveSettingsBtn.addEventListener('click', () => this.saveSettings());

    const timeFrameSlider = document.getElementById('input-time-frame');
    const timeFrameValue = document.getElementById('time-frame-value');
    if (timeFrameSlider && timeFrameValue) {
      timeFrameSlider.addEventListener('input', (e) => {
        const v = Math.max(0, parseInt(e.target.value || '2000', 10));
        timeFrameValue.textContent = `${v/1000}s`;
        this.settings.inputTimeFrame = v;
      });
    }

    const exportFormatSelect = document.getElementById('export-format-select');
    if (exportFormatSelect) {
      exportFormatSelect.addEventListener('change', (e) => {
        this.settings.defaultExportFormat = (e.target.value || 'txt').toLowerCase();
        this.persistSettingsSilently();
      });
    }

    const styleModeSelect = document.getElementById('style-mode-select');
    if (styleModeSelect) {
      styleModeSelect.addEventListener('change', (e) => {
        this.settings.styleMode = (e.target.value === STYLE_LIGHT) ? STYLE_LIGHT : STYLE_MODERN;
        applyStyleMode(this.settings.styleMode, this.settings.darkMode);
        this.persistSettingsSilently();
      });
    }

    const darkModeCheckbox = document.getElementById('dark-mode');
    if (darkModeCheckbox) {
      darkModeCheckbox.addEventListener('change', (e) => {
        this.settings.darkMode = !!e.target.checked;
        applyStyleMode(this.settings.styleMode, this.settings.darkMode);
        this.persistSettingsSilently();
      });
    }

    // Wire bulk controls now; we’ll call again after render
    this.setupBulkSessionControls();
  }

  /* ---------------- Data ---------------- */
  async autoClearOldSessions() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_SESSIONS' });
      if (!res || !Array.isArray(res.sessions)) return;
      const cutoff = Date.now() - (this.settings.autoClearDays * 86400000);
      const valid = res.sessions.filter(s => s.startTime && s.startTime > cutoff);
      if (valid.length < res.sessions.length) {
        await chrome.storage.local.set({ sessions: valid });
      }
    } catch (e) { console.log('Auto-clear failed:', e); }
  }

  async loadRecordingStatus() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATUS' });
      if (res && typeof res.isRecording === 'boolean') {
        this.isRecording = !!res.isRecording;
        this.isPaused = !!res.isPaused;
      } else { this.isRecording = false; this.isPaused = false; }
    } catch { this.isRecording = false; this.isPaused = false; }
  }

  async loadSessions() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_SESSIONS' });
      this.sessions = (res && Array.isArray(res.sessions)) ? res.sessions : [];
    } catch { this.sessions = []; }
  }

  async loadSettings() {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
      if (res && res.settings) {
        this.settings = { ...this.settings, ...res.settings };
        if (![STYLE_LIGHT, STYLE_MODERN].includes(this.settings.styleMode)) this.settings.styleMode = STYLE_MODERN;
      }
    } catch { /* keep defaults */ }
  }

  async persistSettingsSilently() {
    try {
      await chrome.storage.local.set({ settings: this.settings });
      await chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings: this.settings });
    } catch (e) { console.warn('Silent settings save failed', e); }
  }

  /* ---------------- UI ---------------- */
  updateUI() {
    this.updateRecordingUI();
    this.renderSessions();
    this.updateSettingsUI();
  }

  updateRecordingUI() {
    const status = document.getElementById('status-indicator');
    const v1 = document.getElementById('not-recording');
    const v2 = document.getElementById('recording');
    const v3 = document.getElementById('paused');

    status && status.classList.remove('recording','paused');
    v1 && v1.classList.add('hidden');
    v2 && v2.classList.add('hidden');
    v3 && v3.classList.add('hidden');

    if (this.isRecording) {
      if (this.isPaused) { status && status.classList.add('paused'); v3 && v3.classList.remove('hidden'); }
      else { status && status.classList.add('recording'); v2 && v2.classList.remove('hidden'); }
    } else { v1 && v1.classList.remove('hidden'); }

    // Keep Stop/Screenshot usable in pause state
    document.querySelectorAll('#screenshot-btn, #stop-btn').forEach(b => b && (b.disabled = false));
  }

  updateSettingsUI() {
    const autoShot = document.getElementById('auto-screenshot');
    const qual = document.getElementById('screenshot-quality');
    const redact = document.getElementById('redaction-patterns');
    const dark = document.getElementById('dark-mode');
    const slider = document.getElementById('input-time-frame');
    const sliderVal = document.getElementById('time-frame-value');
    const exportSelect = document.getElementById('export-format-select');
    const styleModeSelect = document.getElementById('style-mode-select');

    if (autoShot) autoShot.checked = !!this.settings.autoScreenshot;
    if (qual) qual.value = this.settings.screenshotQuality || 'medium';
    if (redact) redact.value = this.settings.redactionPatterns || 'password,secret,token,api_key';
    if (dark) dark.checked = !!this.settings.darkMode;
    if (slider) slider.value = this.settings.inputTimeFrame || 2000;
    if (sliderVal) sliderVal.textContent = `${(this.settings.inputTimeFrame || 2000)/1000}s`;
    if (exportSelect) exportSelect.value = (this.settings.defaultExportFormat || 'txt').toLowerCase();
    if (styleModeSelect) styleModeSelect.value = this.settings.styleMode || STYLE_MODERN;

    applyStyleMode(this.settings.styleMode, this.settings.darkMode);
  }

  /* ---------------- Sessions rendering ---------------- */
  renderSessions() {
    const list = this.$.sessionsList;
    if (!list) return;
    list.innerHTML = '';

    const count = document.getElementById('session-count');
    const empty = this.$.noSessions;

    if (!this.sessions.length) {
      empty && empty.classList.remove('hidden');
      count && (count.textContent = '0');
      this.setupBulkSessionControls();
      // make sure labels show even when empty
      ensureBulkButtonLabels();
      hideDuplicateSelectAllIfPresent();
      this.updateBulkControlsState();
      return;
    }
    empty && empty.classList.add('hidden');
    count && (count.textContent = String(this.sessions.length));

    list.innerHTML = this.sessions.map((s, i) => {
      const active = s.activeDuration || s.duration || 0;
      const total = s.duration || 0;
      const dur = active !== total
        ? `${Math.round(active/1000)}s active (${Math.round(total/1000)}s total)`
        : `${Math.round(total/1000)}s`;

      return `
        <div class="session-item" data-session-id="${escapeHTML(s.id)}">
          <div class="session-header" style="display:flex;gap:10px;align-items:center;justify-content:space-between">
            <div style="display:flex;gap:10px;align-items:center">
              <input type="checkbox" class="session-select" data-session-id="${escapeHTML(s.id)}">
              <div class="session-title">${escapeHTML(s.name || `Session ${i+1}`)}</div>
            </div>
            <span class="timeline-toggle" data-session-id="${escapeHTML(s.id)}"></span>
          </div>

          <div class="session-meta" style="color:#6b7280;font-size:12px;margin-top:4px">
            ${new Date(s.startTime).toLocaleDateString()} •
            ${s.interactions?.length || 0} interactions •
            ${s.screenshots?.length || 0} screenshots •
            ${dur}${s.apiFailures?.length ? ` • ${s.apiFailures.length} API failures` : ''}
          </div>

          <div class="session-url" style="color:#374151;font-size:12px;margin:3px 0">${escapeHTML(s.url || '')}</div>

          <div class="session-actions" style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap">
            <div class="export-controls" style="display:flex;gap:6px;align-items:center">
              <select class="export-format-select" data-session-id="${escapeHTML(s.id)}">
                <option value="txt">TXT</option>
                <option value="csv">CSV</option>
                <option value="docx">DOCX</option>
                <option value="pdf">PDF</option>
              </select>
              <button class="btn-small btn-export btn-export-one" data-session-id="${escapeHTML(s.id)}"></button>
            </div>
            <button class="btn-small btn-danger btn-delete-one" data-session-id="${escapeHTML(s.id)}"></button>
          </div>

          <div class="session-timeline hidden" id="timeline-${escapeHTML(s.id)}"></div>
        </div>
      `;
    }).join('');

    // Ensure per-session buttons have labels if HTML was empty
    document.querySelectorAll('.btn-export-one').forEach(b => {
      if (!b.textContent.trim()) { b.textContent = 'Export'; b.setAttribute('data-label','Export'); }
    });
    document.querySelectorAll('.btn-delete-one').forEach(b => {
      if (!b.textContent.trim()) { b.textContent = 'Delete'; b.setAttribute('data-label','Delete'); }
    });

    // Wire per-session controls & bulk controls
    this.addSessionEventListeners();
    this.setupBulkSessionControls();

    // Make sure bulk buttons are visibly labeled and not duplicated
    ensureBulkButtonLabels();
    hideDuplicateSelectAllIfPresent();

    // Reflect selection and state
    this.updateSessionCheckboxes();
    this.updateBulkControlsState();
  }

  addSessionEventListeners() {
    const list = document.getElementById('sessions-list');
    if (!list) return;

    // Checkboxes → selection set
    getSessionCheckboxes().forEach(cb => {
      cb.addEventListener('change', (e) => {
        const id = e.target.getAttribute('data-session-id');
        if (!id) return;
        if (e.target.checked) this.selectedSessions.add(id);
        else this.selectedSessions.delete(id);
        const card = e.target.closest('.session-item');
        if (card) card.classList.toggle('selected', e.target.checked);
        this.updateBulkControlsState();
      });
    });

    // Toggle timeline
    list.querySelectorAll('.timeline-toggle').forEach(t => {
      t.addEventListener('click', (e) => {
        const id = e.target.getAttribute('data-session-id');
        const panel = document.getElementById(`timeline-${id}`);
        if (!panel) return;
        const isHidden = panel.classList.contains('hidden');
        panel.classList.toggle('hidden', !isHidden);
        e.target.textContent = isHidden ? 'Hide timeline' : 'Show timeline';
        if (isHidden) this.renderTimeline(id, panel);
      });
      // Initialize label text
      const id = t.getAttribute('data-session-id');
      t.textContent = this.expandedTimelines.has(id) ? 'Hide timeline' : 'Show timeline';
      const panel = document.getElementById(`timeline-${id}`);
      if (panel && this.expandedTimelines.has(id)) { panel.classList.remove('hidden'); this.renderTimeline(id, panel); }
    });

    // Per-session export
    list.querySelectorAll('.btn-export-one').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-session-id');
        const sel = list.querySelector(`select.export-format-select[data-session-id="${id}"]`);
        const fmt = (sel ? sel.value : (this.settings.defaultExportFormat || 'txt')).toLowerCase();
        await this.exportSession(id, fmt);
      });
    });

    // Per-session delete
    list.querySelectorAll('.btn-delete-one').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-session-id');
        this.deleteSession(id);
      });
    });
  }

  renderTimeline(sessionId, container) {
    const s = this.sessions.find(x => x.id === sessionId);
    if (!s) { container.textContent = '(Session not found)'; return; }
    const items = [];

    if (Array.isArray(s.interactions)) {
      s.interactions.forEach(i => items.push({ ...i, _k: 'interaction' }));
    }
    if (Array.isArray(s.apiFailures)) {
      s.apiFailures.forEach(f => items.push({ ...f, _k: 'api_failure' }));
    }
    items.sort((a,b) => (a.relativeTime || a.timestamp || 0) - (b.relativeTime || b.timestamp || 0));

    container.innerHTML = (items.length ? items.map((x, idx) => {
      const label = x._k === 'api_failure'
        ? `⚠️ API FAILURE: ${x.method || ''} ${x.url || ''} (${x.statusCode || x.error || x.status || ''})`
        : (x.type ? x.type.toUpperCase() : 'EVENT');
      const when = x.timestamp ? formatTimestamp(x.timestamp) : `${Math.round((x.relativeTime || 0)/1000)}s`;
      const extra = [];
      if (x.selector) extra.push(`element: "${escapeHTML(x.selector)}"`);
      if (x.value && x.value !== '[REDACTED]') extra.push(`value: "${escapeHTML(x.value)}"`);
      if (x.value === '[REDACTED]') extra.push('value: [REDACTED]');
      if (x.text && !x.value) extra.push(`text: "${escapeHTML(x.text.slice(0, 60))}${x.text.length>60?'…':''}"`);
      return `<div>• ${idx+1}. [${escapeHTML(when)}] ${escapeHTML(label)}${extra.length?' — '+extra.join(' | '):''}</div>`;
    }).join('') : '(No events recorded)');
  }

  /* ---------------- Bulk controls ---------------- */
  setupBulkSessionControls() {
    const selectAllBtn = document.getElementById('select-all-btn');
    const selectAllCheckbox = document.getElementById('select-all-sessions'); // tolerate old html
    const deselectAllBtn = document.getElementById('deselect-all-btn');
    const clearAllBtn = document.getElementById('clear-all-btn') || document.getElementById('clear-all-sessions-btn');
    const deleteSelectedBtn = document.getElementById('delete-selected-btn');
    const exportSelectedBtn = document.getElementById('export-selected-btn');

    if (selectAllBtn) {
      selectAllBtn.onclick = () => {
        this.selectedSessions.clear();
        this.sessions.forEach(s => this.selectedSessions.add(s.id));
        this.updateSessionCheckboxes();
        selectAllCheckbox && (selectAllCheckbox.checked = true);
        this.updateBulkControlsState();
      };
    }
    if (selectAllCheckbox) {
      selectAllCheckbox.onchange = (e) => {
        if (e.target.checked) { this.selectedSessions.clear(); this.sessions.forEach(s => this.selectedSessions.add(s.id)); }
        else { this.selectedSessions.clear(); }
        this.updateSessionCheckboxes();
        this.updateBulkControlsState();
      };
    }
    if (deselectAllBtn) {
      deselectAllBtn.onclick = () => {
        this.selectedSessions.clear();
        selectAllCheckbox && (selectAllCheckbox.checked = false);
        this.updateSessionCheckboxes();
        this.updateBulkControlsState();
      };
    }
    if (clearAllBtn) {
      clearAllBtn.onclick = async () => {
        if (!confirm('Clear ALL sessions? This cannot be undone.')) return;
        await chrome.storage.local.set({ sessions: [] });
        this.sessions = [];
        this.selectedSessions.clear();
        this.renderSessions();
      };
    }
    if (deleteSelectedBtn) {
      deleteSelectedBtn.onclick = async () => {
        if (!this.selectedSessions.size) return;
        if (!confirm(`Delete ${this.selectedSessions.size} selected session(s)?`)) return;
        const updated = this.sessions.filter(s => !this.selectedSessions.has(s.id));
        await chrome.storage.local.set({ sessions: updated });
        this.sessions = updated;
        this.selectedSessions.clear();
        this.renderSessions();
      };
    }
    if (exportSelectedBtn) {
      exportSelectedBtn.onclick = async () => {
        if (!this.selectedSessions.size) return;
        const fmt = (this.settings?.defaultExportFormat || 'txt').toLowerCase();
        for (const id of this.selectedSessions) {
          await this.exportSession(id, fmt);
        }
      };
    }

    this.updateBulkControlsState();
  }

  updateBulkControlsState() {
    const n = this.selectedSessions.size;
    const selectedCountEl = document.getElementById('selected-count');
    const deleteSelectedBtn = document.getElementById('delete-selected-btn');
    const exportSelectedBtn = document.getElementById('export-selected-btn');
    if (selectedCountEl) selectedCountEl.textContent = `${n} selected`;
    if (deleteSelectedBtn) deleteSelectedBtn.disabled = n === 0;
    if (exportSelectedBtn) exportSelectedBtn.disabled = n === 0;
  }

  updateSessionCheckboxes() {
    getSessionCheckboxes().forEach(cb => {
      const id = cb.getAttribute('data-session-id');
      if (!id) return;
      const checked = this.selectedSessions.has(id);
      cb.checked = checked;
      const card = cb.closest('.session-item');
      if (card) card.classList.toggle('selected', checked);
    });
  }

  /* ---------------- Export ---------------- */
  async exportSession(sessionId, format = 'txt') {
    try {
      const s = this.sessions.find(x => x.id === sessionId);
      if (!s) throw new Error('Session not found');

      // DOCX client-side if docx lib loaded
      if (format === 'docx' && window.docx) {
        await this.downloadDocxFromSession(s);
        return;
      }

      // Ask background for other formats
      const res = await chrome.runtime.sendMessage({
        type: 'EXPORT_SESSION',
        sessionId,
        format
      });

      if (!res || !res.exportData) throw new Error('No export data');
      await this.downloadExportedFile(res.exportData, format);
    } catch (e) {
      console.error('Export failed:', e);
      alert('Export failed: ' + (e?.message || 'Unknown error'));
    }
  }

  async downloadExportedFile(exportData, format) {
    let blob, filename, content;
    switch ((format || 'txt').toLowerCase()) {
      case 'txt':
        blob = new Blob([exportData.txtContent], { type: 'text/plain' });
        filename = exportData.filename || 'session.txt';
        break;
      case 'csv':
        blob = new Blob([exportData.csvContent], { type: 'text/csv' });
        filename = exportData.filename || 'session.csv';
        break;
      case 'pdf':
        content = JSON.stringify(exportData.pdfData || exportData, null, 2);
        blob = new Blob([content], { type: 'application/json' });
        filename = (exportData.filename || 'session').replace(/\.pdf$/,'') + '_data.json';
        break;
      default:
        blob = new Blob([exportData.txtContent], { type: 'text/plain' });
        filename = (exportData.filename || 'session') + '.txt';
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  async downloadDocxFromSession(session) {
    const { Document, Packer, Paragraph, TextRun } = window.docx;
    const children = [];

    children.push(
      new Paragraph({ children: [ new TextRun({ text: `TestSnapper Session: ${session.name || 'Untitled'}`, bold: true }) ] }),
      new Paragraph({ children: [ new TextRun({ text: `URL: ${session.url || 'N/A'}` }) ] }),
      new Paragraph({ children: [ new TextRun({ text: `Date: ${formatTimestamp(session.startTime)}` }) ] }),
      new Paragraph({ children: [ new TextRun({ text: `Duration: ${Math.round((session.activeDuration||session.duration||0)/1000)}s` }) ] }),
      new Paragraph({ text: "" })
    );

    const items = [];
    if (Array.isArray(session.interactions)) items.push(...session.interactions.map(i => ({...i,_k:'interaction'})));
    if (Array.isArray(session.apiFailures)) items.push(...session.apiFailures.map(f => ({...f,_k:'api_failure'})));
    items.sort((a,b) => (a.relativeTime||a.timestamp||0)-(b.relativeTime||b.timestamp||0));

    items.forEach((x, i) => {
      const label = x._k === 'api_failure'
        ? `⚠️ API FAILURE: ${x.method||''} ${x.url||''} (${x.statusCode||x.error||x.status||''})`
        : (x.type? x.type.toUpperCase() : 'EVENT');
      const when = x.timestamp ? formatTimestamp(x.timestamp) : `${Math.round((x.relativeTime||0)/1000)}s`;
      const parts = [`${i+1}. [${when}] ${label}`];
      if (x.selector) parts.push(`element: "${x.selector}"`);
      if (x.value && x.value !== '[REDACTED]') parts.push(`value: "${x.value}"`);
      if (x.value === '[REDACTED]') parts.push('value: [REDACTED]');
      if (x.text && !x.value) parts.push(`text: "${x.text.slice(0,60)}${x.text.length>60?'…':''}"`);
      children.push(new Paragraph({ children: [ new TextRun(parts.join(' — ')) ] }));
    });

    const doc = new Document({ sections: [{ children }] });
    const blob = await Packer.toBlob(doc);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(session.name||'session').replace(/[^a-z0-9]/gi,'_')}.docx`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  /* ---------------- Recording controls ---------------- */
  async startRecording() {
    await chrome.runtime.sendMessage({ type: 'START_RECORDING' });
    this.isRecording = true; this.isPaused = false; this.updateUI();
  }
  async pauseRecording() {
    await chrome.runtime.sendMessage({ type: 'PAUSE_RECORDING' });
    this.isPaused = true; this.updateUI();
  }
  async resumeRecording() {
    await chrome.runtime.sendMessage({ type: 'RESUME_RECORDING' });
    this.isPaused = false; this.updateUI();
  }
  async stopRecording() {
    await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
    this.isRecording = false; this.isPaused = false;
    await this.loadSessions(); this.updateUI();
  }
  async captureManualScreenshot() {
    try {
      await chrome.runtime.sendMessage({ type: 'CAPTURE_SCREENSHOT', data: { type: 'manual_capture', manual: true, allowWhenPaused: true, timestamp: Date.now() } });
      console.log('Manual screenshot captured');
    } catch (e) { console.error('Screenshot failed:', e); }
  }

  /* ---------------- Delete ---------------- */
  async deleteSession(sessionId) {
    if (!sessionId) return;
    if (!confirm('Delete this session? This action cannot be undone.')) return;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'DELETE_SESSIONS', ids: [sessionId] });
      if (!res || res.success === false) {
        const updated = this.sessions.filter(s => s.id !== sessionId);
        await chrome.storage.local.set({ sessions: updated });
      }
      await this.loadSessions();
      this.selectedSessions.delete(sessionId);
      this.renderSessions();
    } catch (e) {
      console.error('Failed to delete session:', e);
      alert('Failed to delete session: ' + (e?.message || 'Unknown error'));
    }
  }

  /* ---------------- Tabs ---------------- */
  switchTab(tabName) {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const tabBtn = document.querySelector(`.nav-btn[data-tab="${tabName}"]`); tabBtn && tabBtn.classList.add('active');

    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    const active = document.getElementById(`${tabName}-tab`); active && active.classList.remove('hidden');

    this.currentTab = tabName;
    if (tabName === 'sessions') this.loadSessions().then(() => this.renderSessions());
  }
}

/* ==============================================
   Boot
================================================= */
document.addEventListener('DOMContentLoaded', () => {
  const popup = new TestSnapperPopup();
  popup.init().catch(err => console.error('Popup init failed:', err));
});
