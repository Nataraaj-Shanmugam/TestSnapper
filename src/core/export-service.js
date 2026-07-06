/**
 * Export Service
 *
 * Fix applied (screenshots never appearing in exported .doc / review page):
 *
 *   background.js stores every screenshot asset as:
 *       { …, dataUrl: "data:image/jpeg;base64,…" }
 *
 *   The old export-service loop checked ONLY `asset.blob`.
 *   A Blob is a live runtime object — it does NOT survive the JSON
 *   round-trip through chrome.storage.local (it becomes `{}`).
 *   So `asset.blob` was always falsy on every read-back and the entire
 *   screenshot-loading loop was silently skipped.
 *
 *   The fix: read `asset.dataUrl` first (what background.js writes).
 *   Fall back to `asset.data`, then to `asset.blob` (live-session only)
 *   so every possible write-path is covered.
 *
 * Export memory optimization: process screenshots one at a time, null
 * out references immediately, use URL.createObjectURL for downloads.
 *
 * PDF fix — load jsPDF from local lib via chrome.runtime.getURL
 * instead of CDN (blocked by extension CSP). DOCX fix — detect lib availability
 * before the image pipeline to avoid wasted CPU+memory.
 *
 * URL sanitization at export time — strips sensitive query params
 * from step.url and navigate step.value in all export formats.
 *
 * Image export quality — DOCX and PDF route every screenshot through
 * ImageProcessor.processForExport (content-aware PNG/JPEG, lossless for text-heavy UI)
 * instead of the old forced JPEG-0.85 downscale. PDF now embeds screenshots via
 * jsPDF addImage; DOCX sizes images with a single unit and avoids page splits.
 */

import { ImageProcessor } from './image-processor.js';
import { Logger } from './logger.js';
import { sanitizeUrl } from './privacy-utils.js';

export class ExportService {
  constructor(storage) {
    this.storage = storage;
    this.cancelledExports = new Set();
    this._imgOptsMap = new Map(); // per-session imgOpts, prevents cross-export races (MED-020)
    Logger.debug('ExportService initialized');
  }

  /**
   * Cancel an ongoing export
   */
  cancelExport(sessionId) {
    this.cancelledExports.add(sessionId);
    Logger.debug('Export cancelled for session:', sessionId);
  }

  /**
   * Check if export was cancelled
   */
  _isCancelled(sessionId) {
    return this.cancelledExports.has(sessionId);
  }

  /**
   * Clear cancellation flag
   */
  _clearCancellation(sessionId) {
    this.cancelledExports.delete(sessionId);
  }

  /**
   * Sanitize a URL by stripping sensitive query parameters.
   * Applies to step.url and navigate step.value at export time (SEC-003).
   *
   * @param {string} url - Original URL
   * @returns {string} URL with sensitive params removed, or original on parse error
   */
  _sanitizeUrl(url) {
    // Delegate to the canonical implementation (privacy-utils) so capture-time
    // and export-time sanitization can never diverge (SEC-1).
    return sanitizeUrl(url);
  }

  /**
   * Main export orchestrator
   */
  async exportSession(sessionId, format, progressCallback) {
    const notify =
      typeof progressCallback === 'function' ? progressCallback : () => { };

    // Resolve per-session so concurrent exports don't share state (MED-020).
    this._imgOptsMap.set(sessionId, await this._resolveExportImageOpts());

    Logger.info('Starting export:', format, 'for session:', sessionId);

    // Check pre-cancellation (must come before _clearCancellation so
    // cancelExport() called before exportSession() is actually honoured).
    if (this._isCancelled(sessionId)) {
      this._clearCancellation(sessionId);
      throw new Error('Export cancelled');
    }

    notify({ percent: 5, status: 'Loading session...' });

    const session = await this.storage.getSession(sessionId);
    notify({ percent: 10, status: 'Session loaded' });

    let steps = await this.storage.getSteps(sessionId);
    steps.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

    notify({
      percent: 20,
      status: 'Steps loaded',
      totalSteps: steps.length
    });

    const exportData = {
      session: this._formatSessionData(session, steps.length),
      steps: steps
    };

    try {
      switch (format.toLowerCase()) {
        case 'json':
          notify({ percent: 90, status: 'Preparing JSON export...' });
          return this._exportJSON(exportData, sessionId);

        case 'csv':
          notify({ percent: 90, status: 'Preparing CSV export...' });
          return this._exportCSV(exportData, sessionId);

        case 'docx':
          return await this._exportDOCX(exportData, sessionId, notify);

        case 'pdf':
          notify({ percent: 90, status: 'Preparing PDF export...' });
          return await this._exportPDF(exportData, sessionId, notify);

        case 'markdown':
          notify({ percent: 90, status: 'Preparing Markdown export...' });
          return this._exportMarkdown(exportData, sessionId);

        default:
          throw new Error(`Unsupported format: ${format}`);
      }
    } finally {
      this._clearCancellation(sessionId);
      this._imgOptsMap.delete(sessionId);
    }
  }

  // ==================== Private Helpers ====================

  /**
   * Resolve the export image format/quality from the user's
   * `exportImageQuality` setting. Falls back to 'auto' (recommended) if the
   * setting is missing or chrome.storage is unavailable (e.g. tests).
   *   'auto'     → content-aware PNG/JPEG, quality 0.92 (sharp text, balanced)
   *   'high'     → content-aware, quality 0.95 (largest, best fidelity)
   *   'standard' → JPEG ~0.85 (smallest files)
   * @private
   * @returns {Promise<{format: string, quality: number}>}
   */
  async _resolveExportImageOpts() {
    let pref = 'auto';
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const r = await chrome.storage.local.get('settings');
        pref = r?.settings?.exportImageQuality || 'auto';
      }
    } catch (_) { /* default */ }

    // Validate against the known set; fall back to 'auto' for unknown/invalid
    // values so a corrupted setting can't diverge into an invalid state.
    const ALLOWED = ['auto', 'high', 'standard'];
    if (!ALLOWED.includes(pref)) pref = 'auto';

    switch (pref) {
      case 'high': return { format: 'auto', quality: 0.95 };
      case 'standard': return { format: 'jpeg-standard', quality: 0.85 };
      case 'auto':
      default: return { format: 'auto', quality: 0.92 };
    }
  }

  _formatSessionData(session, stepCount) {
    return {
      id: session.sessionId,
      name: session.sessionName || 'Untitled Session',
      createdAt: session.createdAt,
      environment: session.env,
      stepCount
    };
  }

  async _blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result;
        reader.abort();
        resolve(result);
      };
      reader.onerror = () => {
        reader.abort();
        reject(reader.error);
      };
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Resolve a usable base64 data-URL from a storage asset.
   *
   * Priority:
   *   1. asset.dataUrl  — what background.js writes for every captured screenshot
   *   2. asset.data     — what review-standalone writes for manually-added screenshots
   *   3. asset.blob     — only valid while the session is still live in memory
   *                        (becomes {} after chrome.storage.local JSON round-trip)
   *
   * Returns a data-URL string, or null if nothing usable is found.
   */
  async _resolveAssetUrl(asset) {
    // 1. dataUrl string (primary path — background.js captureScreenshot)
    if (typeof asset.dataUrl === 'string' && asset.dataUrl.length > 0) {
      return asset.dataUrl;
    }

    // 2. data string (secondary path — manually added via review page)
    if (typeof asset.data === 'string' && asset.data.length > 0) {
      return asset.data;
    }

    // 3. Live Blob (only works in the same session before storage round-trip)
    if (asset.blob && asset.blob instanceof Blob && asset.blob.size > 0) {
      try {
        return await this._blobToDataURL(asset.blob);
      } catch (err) {
        Logger.warn('blobToDataURL failed for asset', asset.id, err);
      }
    }

    return null;
  }

  _escapeHtml(text) {
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

  // ==================== Format Exporters ====================

  /**
   * Export to JSON. Sanitizes URLs for SEC-003.
   */
  _exportJSON(exportData, sessionId) {
    // Apply URL sanitization to all steps (SEC-003).
    // Unified export: drop the CSS/XPath locator so JSON matches the Word doc
    // (which never included it) — step, action, field, value, url only.
    const sanitizedSteps = exportData.steps.map(step => {
      const { selector, ...sanitized } = step;
      if (sanitized.url) sanitized.url = this._sanitizeUrl(sanitized.url);
      if (sanitized.action === 'navigate' && sanitized.value) {
        sanitized.value = this._sanitizeUrl(sanitized.value);
      }
      return sanitized;
    });

    const content = JSON.stringify({ session: exportData.session, steps: sanitizedSteps }, null, 2);
    const sessionName = (exportData.session.name || 'Untitled_Session').replace(/[^a-z0-9]/gi, '_');
    const filename = `${sessionName}_${Date.now()}.json`;

    return {
      content,
      filename,
      mimeType: 'application/json'
    };
  }

  /**
   * Neutralize CSV formula injection. A cell whose first character is one of
   * `= + - @` (or a leading tab/CR) is interpreted as a formula by Excel /
   * Google Sheets. Prefixing it with a single apostrophe defuses execution
   * while keeping the visible value intact. (CSV Injection / CWE-1236)
   * @private
   * @param {*} value - raw cell value
   * @returns {string}
   */
  _csvSafeCell(value) {
    const str = String(value).replace(/[\r\n]+/g, ' ');
    if (/^[=+\-@\t\r]/.test(str)) {
      return `'${str}`;
    }
    return str;
  }

  /**
   * Export to CSV. Sanitizes URLs for SEC-003 and defuses formula injection.
   */
  _exportCSV(exportData, sessionId) {
    // Unified export: no locator column (matches the Word doc).
    const headers = ['Step', 'Action', 'Field Name', 'Value', 'URL'];
    const rows = exportData.steps
      .filter(s => s.action !== 'screenshot')
      .map((step, index) => {
        // Sanitize URL and navigate value
        const safeUrl = this._sanitizeUrl(step.url);
        const safeValue = (step.action === 'navigate' && step.value)
          ? this._sanitizeUrl(step.value)
          : (step.value || '');

        return [
          index + 1,
          step.action,
          step.fieldName || 'N/A',
          safeValue,
          safeUrl
        ];
      });

    const content = [headers, ...rows]
      .map(row => row.map(cell => `"${this._csvSafeCell(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const filename = `testsnapper_${sessionId.substring(0, 8)}_${Date.now()}.csv`;

    return {
      content,
      filename,
      mimeType: 'text/csv'
    };
  }

  /**
   * Export to Markdown.
   */
  _exportMarkdown(exportData, sessionId) {
    const { session, steps } = exportData;
    const sessionName = session.name || 'Untitled Session';
    const lines = [
      `# ${this._escapeHtml(sessionName)}`,
      '',
      `**Recorded:** ${session.startTime || ''}  `,
      `**Steps:** ${steps.length}`,
      '',
      '---',
      ''
    ];

    steps.forEach((step, i) => {
      const safeUrl = this._sanitizeUrl(step.url);
      lines.push(`### Step ${i + 1}: ${step.action}`);
      if (step.fieldName) lines.push(`- **Field:** ${step.fieldName}`);
      if (step.value)     lines.push(`- **Value:** \`${step.value}\``);
      // Unified export: no locator line (matches the Word doc).
      if (safeUrl)        lines.push(`- **URL:** ${safeUrl}`);
      lines.push('');
    });

    const content = lines.join('\n');
    const filename = `${sessionName.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.md`;

    return { content, filename, mimeType: 'text/markdown' };
  }

  /**
   * Load the local jsPDF library via chrome.runtime.getURL (FUNC-005).
   * CDN loading is intentionally removed — extension CSP blocks it.
   * @private
   * @returns {Promise<boolean>} true if jsPDF loaded successfully
   */
  async _loadJsPDF() {
    // Already loaded?
    if (typeof window !== 'undefined' && window.jspdf && window.jspdf.jsPDF) {
      return true;
    }

    // Load local lib via chrome.runtime.getURL (CSP-safe)
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL) {
      return new Promise((resolve) => {
        const localUrl = chrome.runtime.getURL('libs/jspdf.umd.min.js');
        const script = document.createElement('script');
        script.src = localUrl;
        script.onload = () => resolve(true);
        script.onerror = () => {
          Logger.warn('[ExportService] Failed to load local jsPDF lib');
          resolve(false);
        };
        document.head.appendChild(script);
      });
    }

    return false;
  }

  /**
   * Export to DOCX.
   *
   * EXP-IMG-005: prefer a real OOXML `.docx` built with the bundled `docx`
   * library — images embed as binary `ImageRun` parts (no fragile base64
   * data-URLs), sized in EMUs (deterministic across Word versions). Falls
   * back to the legacy HTML `.doc` builder when the library can't load
   * (e.g. a non-window/service-worker context).
   *
   * @returns {Promise<{ blob?: Blob, content?: string, filename: string, mimeType: string }>}
   */
  async _exportDOCX(exportData, sessionId, progressCallback) {
    const notify = typeof progressCallback === 'function' ? progressCallback : () => { };
    const loaded = await this._loadDocx();
    if (loaded) {
      try {
        return await this._buildDocxBlob(exportData, sessionId, notify);
      } catch (err) {
        if (err && /cancelled/i.test(err.message || '')) throw err;
        Logger.warn('[ExportService] docx-library build failed, falling back to HTML .doc:', err);
      }
    }
    return this._exportDOCXHtml(exportData, sessionId, notify);
  }

  /**
   * Load the bundled `docx` library via chrome.runtime.getURL (CSP-safe).
   * Returns false in non-window contexts (no document to inject into) so the
   * caller can fall back to the HTML `.doc` path.
   * @private
   * @returns {Promise<boolean>}
   */
  async _loadDocx() {
    if (typeof window !== 'undefined' && window.docx && window.docx.Packer) return true;
    if (typeof document === 'undefined' || typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.getURL) {
      return false;
    }
    return new Promise((resolve) => {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('libs/docx.min.js');
      script.onload = () => resolve(!!(window.docx && window.docx.Packer));
      script.onerror = () => {
        Logger.warn('[ExportService] Failed to load local docx lib');
        resolve(false);
      };
      document.head.appendChild(script);
    });
  }

  /**
   * Build a true `.docx` Blob with the `docx` library (EXP-IMG-005).
   * Mirrors the HTML builder's structure: numbered execution steps with inline
   * manual screenshots, then an "Automated Screenshots" section. Each image is
   * embedded as a binary ImageRun via {@link _docxImageParagraph}.
   * @private
   */
  async _buildDocxBlob(exportData, sessionId, notify) {
    const { session, steps } = exportData;
    const { Document, Packer, Paragraph, TextRun, HeadingLevel } = window.docx;

    notify({ percent: 30, status: 'Building DOCX...' });

    // stepId → asset index; images are loaded lazily as each step is reached.
    const screenshotAssets = await this.storage.getAllAssets(session.id);
    const assetIndex = new Map();
    for (const asset of screenshotAssets) {
      if (asset.stepId) assetIndex.set(asset.stepId, asset);
    }
    screenshotAssets.length = 0;

    const automatedScreenshots = [];
    const regularSteps = [];
    steps.forEach(step => {
      if (step.action === 'screenshot' && !step.isManual) automatedScreenshots.push(step);
      else regularSteps.push(step);
    });

    const children = [];
    children.push(new Paragraph({ text: `${session.name || 'Untitled Session'} - Test Document`, heading: HeadingLevel.HEADING_1 }));
    children.push(new Paragraph({ children: [new TextRun({ text: 'Created: ', bold: true }), new TextRun(new Date(session.createdAt).toLocaleString())] }));
    children.push(new Paragraph({ children: [new TextRun({ text: 'Total Steps: ', bold: true }), new TextRun(String(session.stepCount))] }));
    children.push(new Paragraph({ text: 'Test Execution Steps', heading: HeadingLevel.HEADING_2 }));

    const total = regularSteps.length;
    let stepNumber = 0;
    for (const step of regularSteps) {
      if (this._isCancelled(session.id)) { this._clearCancellation(session.id); throw new Error('Export cancelled by user'); }
      stepNumber++;

      let text;
      if (step.action === 'screenshot') {
        text = `${stepNumber}. Manual screenshot`;
      } else if (step.description) {
        text = `${stepNumber}. ${step.description}`;
      } else {
        text = `${stepNumber}. ${step.action.toUpperCase()}`;
        if (step.fieldName && step.fieldName !== 'N/A') text += ` on "${step.fieldName}"`;
        if (step.value && step.action !== 'navigate') text += ` with value "${step.value}"`;
        if (step.action === 'navigate') text += ` to ${this._sanitizeUrl(step.value || step.url)}`;
      }
      children.push(new Paragraph({ children: [new TextRun(text)], spacing: { before: 120 } }));

      const imgPara = await this._docxImageParagraph(assetIndex.get(step.id), this._imgOptsMap.get(sessionId));
      if (imgPara) children.push(imgPara);
      assetIndex.delete(step.id);

      if (stepNumber % 10 === 0) {
        notify({ percent: 30 + Math.floor((stepNumber / Math.max(total, 1)) * 55), status: `Processing step ${stepNumber}/${total}...` });
      }
    }

    if (automatedScreenshots.length > 0) {
      children.push(new Paragraph({ text: 'Automated Screenshots', heading: HeadingLevel.HEADING_2 }));
      for (let i = 0; i < automatedScreenshots.length; i++) {
        if (this._isCancelled(session.id)) { this._clearCancellation(session.id); throw new Error('Export cancelled by user'); }
        const shot = automatedScreenshots[i];
        children.push(new Paragraph({ children: [new TextRun({ text: `Auto Screenshot ${i + 1}`, bold: true }), new TextRun(` - ${new Date(shot.timestamp).toLocaleTimeString()}`)] }));
        const imgPara = await this._docxImageParagraph(assetIndex.get(shot.id), this._imgOptsMap.get(sessionId));
        if (imgPara) children.push(imgPara);
        assetIndex.delete(shot.id);
      }
    }

    assetIndex.clear();

    notify({ percent: 90, status: 'Finalizing DOCX...' });
    const doc = new Document({ sections: [{ children }] });
    const blob = await Packer.toBlob(doc);
    notify({ percent: 95, status: 'DOCX generated' });

    const sessionName = (session.name || 'Untitled_Session').replace(/[^a-z0-9]/gi, '_');
    return {
      blob,
      filename: `${sessionName}_${Date.now()}.docx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    };
  }

  /**
   * Build a docx Paragraph holding one screenshot as a binary ImageRun, or
   * null if the asset has no usable image. Runs the image through the
   * content-aware ImageProcessor (lossless PNG for text) and embeds the bytes
   * directly. Display size is in pixels (docx converts px → EMU).
   * @private
   */
  async _docxImageParagraph(asset, imgOpts) {
    if (!asset) return null;
    const rawUrl = await this._resolveAssetUrl(asset);
    if (!rawUrl) return null;
    try {
      const { Paragraph, ImageRun } = window.docx;
      const imgObj = await ImageProcessor.processForExport(rawUrl, {
        maxWidth: 1920, maxHeight: 1080, displayWidth: 600, displayHeight: 450,
        ...(imgOpts || { format: 'auto', quality: 0.92 })
      });
      const bytes = new Uint8Array(await (await fetch(imgObj.dataUrl)).arrayBuffer());
      const type = /^data:image\/png/i.test(imgObj.dataUrl) ? 'png' : 'jpg';
      imgObj.dataUrl = null;
      return new Paragraph({
        children: [new ImageRun({ type, data: bytes, transformation: { width: imgObj.width, height: imgObj.height } })],
        spacing: { after: 200 }
      });
    } catch (err) {
      Logger.warn('[ExportService] docx image embed failed:', err);
      return null;
    }
  }

  /**
   * Legacy HTML-based `.doc` export (fallback when the docx library is
   * unavailable). Processes screenshots one at a time (PERF-003) and embeds
   * them via the content-aware ImageProcessor pipeline. SEC-003: sanitizes URLs.
   */
  async _exportDOCXHtml(exportData, sessionId, progressCallback) {
    const notify =
      typeof progressCallback === 'function' ? progressCallback : () => { };

    const { session, steps } = exportData;

    notify({ percent: 30, status: 'Building DOCX template...' });

    let html = `
<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
  <meta charset='utf-8'>
  <title>Test Documentation</title>
  <style>
    body { font-family: Calibri, Arial, sans-serif; margin: 40px; }
    h1 { color: #2c3e50; border-bottom: 3px solid #3498db; padding-bottom: 10px; margin-bottom: 30px; }
    h2 { color: #34495e; margin-top: 30px; margin-bottom: 15px; font-size: 18px; }
    .info { margin: 20px 0 30px 0; }
    .info p { margin: 8px 0; font-size: 14px; color: #333; }
    .divider { border-top: 2px solid #ddd; margin: 30px 0; }
    ol { line-height: 1.8; padding-left: 30px; margin-top: 20px; }
    li { margin: 15px 0; color: #333; font-size: 14px; }
    .screenshot-img {
      max-width: 7.29in !important;
      height: auto !important;
      margin-top: 15px;
      border: 1px solid #ccc;
      display: block;
      page-break-inside: avoid;
    }
    .automated-screenshots { margin-top: 40px; padding-top: 20px; border-top: 2px solid #3498db; }
    .auto-screenshot { margin: 30px 0; text-align: center; page-break-inside: avoid; }
    .auto-screenshot img {
      max-width: 7.29in !important;
      height: auto !important;
      margin: 15px auto;
      border: 1px solid #ccc;
      display: block;
      page-break-inside: avoid;
    }
  </style>
</head>
<body>
  <h1>${this._escapeHtml(session.name)} - Test Document</h1>

  <div class='info'>
    <p><b>Created:</b> ${new Date(session.createdAt).toLocaleString()}</p>
    <p><b>Created by:</b> </p>
    <p><b>Total Steps:</b> ${session.stepCount}</p>
  </div>

  <div class='divider'></div>

  <h2>Test Execution Steps</h2>
`;

    // ------------------------------------------------------------------
    // Build a lookup: stepId -> asset (reference only, don't load yet)
    // Load images one at a time as we encounter each step
    // ------------------------------------------------------------------
    const screenshotAssets = await this.storage.getAllAssets(session.id);
    // Build a stepId → asset index (not the data URLs themselves)
    const assetIndex = new Map();
    for (const asset of screenshotAssets) {
      if (asset.stepId) {
        assetIndex.set(asset.stepId, asset);
      }
    }
    // screenshotAssets array no longer needed — release reference
    screenshotAssets.length = 0;
    // ------------------------------------------------------------------

    const automatedScreenshots = [];
    const regularSteps = [];

    steps.forEach(step => {
      if (step.action === 'screenshot' && step.isManual) {
        regularSteps.push(step);
      } else if (step.action === 'screenshot' && !step.isManual) {
        automatedScreenshots.push(step);
      } else {
        regularSteps.push(step);
      }
    });

    html += `<ol>`;

    const CHUNK_SIZE = 50;
    const totalSteps = regularSteps.length;
    let processedCount = 0;

    for (let chunkStart = 0; chunkStart < totalSteps; chunkStart += CHUNK_SIZE) {
      const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, totalSteps);
      const chunk = regularSteps.slice(chunkStart, chunkEnd);

      for (const step of chunk) {
        if (this._isCancelled(session.id)) {
          this._clearCancellation(session.id);
          throw new Error('Export cancelled by user');
        }

        let oneliner;

        if (step.action === 'screenshot') {
          oneliner = 'Manual screenshot captured';
          html += `<li>${oneliner}`;

          // Load + process this one asset, then null it out
          const asset = assetIndex.get(step.id);
          if (asset) {
            const rawUrl = await this._resolveAssetUrl(asset);
            if (rawUrl) {
              // EXP-IMG-002/003: content-aware, lossless-for-text pipeline.
              // EXP-IMG-004: single unit — set display width only, omit height (aspect follows).
              const imgObj = await ImageProcessor.processForExport(rawUrl, {
                maxWidth: 1920, maxHeight: 1080, displayWidth: 700, displayHeight: 525,
                ...(this._imgOptsMap.get(sessionId) || { format: 'auto', quality: 0.92 })
              });
              html += `<br><img src="${imgObj.dataUrl}" width="${imgObj.width}" class="screenshot-img" alt="Manual Screenshot"/>`;
              // Null out immediately after use
              imgObj.dataUrl = null;
            }
            // Remove from index so GC can collect
            assetIndex.delete(step.id);
          }

          html += `</li>`;
        } else {
          if (step.description) {
            oneliner = this._escapeHtml(step.description);
          } else {
            oneliner = `${step.action.toUpperCase()}`;

            if (step.fieldName && step.fieldName !== 'N/A') {
              oneliner += ` on "${this._escapeHtml(step.fieldName)}"`;
            }

            if (step.value && step.action !== 'navigate') {
              oneliner += ` with value "${this._escapeHtml(step.value)}"`;
            }

            if (step.action === 'navigate') {
              // SEC-003: sanitize navigate URL
              const safeVal = this._sanitizeUrl(step.value || step.url);
              oneliner += ` to ${this._escapeHtml(safeVal)}`;
            }
          }

          html += `<li>${oneliner}</li>`;
        }

        processedCount++;

        if (processedCount % 10 === 0) {
          notify({
            percent: 30 + Math.floor((processedCount / totalSteps) * 60),
            status: `Processing step ${processedCount}/${totalSteps}...`
          });
        }
      }

      // Release chunk memory
      chunk.length = 0;

      if (chunkEnd < totalSteps) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    html += `</ol>`;

    if (automatedScreenshots.length > 0) {
      html += `
  <div class='automated-screenshots'>
    <h2>Automated Screenshots</h2>`;

      for (let i = 0; i < automatedScreenshots.length; i++) {
        if (this._isCancelled(session.id)) {
          this._clearCancellation(session.id);
          throw new Error('Export cancelled by user');
        }

        const screenshot = automatedScreenshots[i];
        const asset = assetIndex.get(screenshot.id);
        if (asset) {
          const rawUrl = await this._resolveAssetUrl(asset);
          if (rawUrl) {
            // EXP-IMG-002/003/004: lossless-for-text pipeline, display-width only.
            const imgObj = await ImageProcessor.processForExport(rawUrl, {
              maxWidth: 1920, maxHeight: 1080, displayWidth: 700, displayHeight: 525,
              ...(this._imgOptsMap.get(sessionId) || { format: 'auto', quality: 0.92 })
            });
            html += `
    <div class='auto-screenshot'>
      <p><b>Auto Screenshot ${i + 1}</b> - ${new Date(screenshot.timestamp).toLocaleTimeString()}</p>
      <img src="${imgObj.dataUrl}" width="${imgObj.width}" alt="Automated Screenshot ${i + 1}"/>
    </div>`;
            imgObj.dataUrl = null;
          }
          assetIndex.delete(screenshot.id);
        }
      }

      html += `</div>`;
    }

    html += `
</body>
</html>`;

    // Clear the asset index map
    assetIndex.clear();

    notify({ percent: 90, status: 'Finalizing DOCX content...' });

    const sessionName = (session.name || 'Untitled_Session').replace(/[^a-z0-9]/gi, '_');
    const filename = `${sessionName}_${Date.now()}.doc`;

    notify({ percent: 95, status: 'DOCX generated' });

    // Return a Blob — both callers (popup, background) consume result.blob and
    // create their own object URL / data URL. Text fallback for non-Blob ctx.
    if (typeof Blob !== 'undefined') {
      return {
        blob: new Blob([html], { type: 'application/msword' }),
        filename,
        mimeType: 'application/msword'
      };
    }

    return {
      content: html,
      filename,
      mimeType: 'application/msword'
    };
  }

  /**
   * Export to PDF using local jsPDF (FUNC-005).
   *
   * CDN loading has been removed — extension CSP (script-src 'self') always
   * blocks it. Instead we load jsPDF from libs/jspdf.umd.min.js via
   * chrome.runtime.getURL, which is CSP-safe.
   *
   * If the local lib is unavailable, returns a user-friendly error blob
   * instead of a junk file containing "null".
   *
   * SEC-003: sanitizes step URLs.
   */
  async _exportPDF(exportData, sessionId) {
    const { session, steps } = exportData;

    // Load local jsPDF, NOT CDN
    const loaded = await this._loadJsPDF();
    if (!loaded || typeof window === 'undefined' || !window.jspdf || !window.jspdf.jsPDF) {
      Logger.error('[ExportService] jsPDF library not available. Ensure libs/jspdf.umd.min.js is present.');
      // Return a user-friendly error text file rather than a junk "null" PDF
      const errorMsg = 'PDF export failed: jsPDF library not found.\n\nPlease run "npm run setup-libs" to download the required library, then reload the extension.';
      const sessionName = (session.name || 'Session').replace(/[^a-z0-9]/gi, '_');
      return {
        content: errorMsg,
        filename: `${sessionName}_${Date.now()}_ERROR.txt`,
        mimeType: 'text/plain'
      };
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - (2 * margin);
    let yPosition = margin;

    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text(session.name || 'Test Documentation', pageWidth / 2, yPosition, { align: 'center' });
    yPosition += 15;

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Created: ${new Date(session.createdAt).toLocaleString()}`, margin, yPosition);
    yPosition += 6;
    doc.text(`Total Steps: ${session.stepCount}`, margin, yPosition);
    yPosition += 15;

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Test Steps', margin, yPosition);
    yPosition += 10;

    // EXP-IMG-001: build a stepId → asset index so every screenshot step can
    // embed its image. PERF-003: keep only one asset's bytes live at a time —
    // load + embed + null out + delete from the index as we go.
    const screenshotAssets = await this.storage.getAllAssets(session.id);
    const assetIndex = new Map();
    for (const asset of screenshotAssets) {
      if (asset.stepId) assetIndex.set(asset.stepId, asset);
    }
    screenshotAssets.length = 0;

    let stepNumber = 0;
    for (const step of steps) {
      const isScreenshot = step.action === 'screenshot';
      stepNumber++;

      if (yPosition > pageHeight - 30) {
        doc.addPage();
        yPosition = margin;
      }

      doc.setFontSize(11);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(0, 0, 0);

      const description = step.description ||
        (isScreenshot
          ? (step.isManual ? 'Manual screenshot' : 'Automated screenshot')
          : `${step.action.toUpperCase()} ${step.fieldName || ''}`);

      const lines = doc.splitTextToSize(`${stepNumber}. ${description}`, contentWidth);
      lines.forEach(line => {
        doc.text(line, margin, yPosition);
        yPosition += 5;
      });

      // Metadata (selector / URL) for action steps only
      if (!isScreenshot) {
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 100, 100);

        // Unified export: no locator line (matches the Word doc).

        // Sanitize URL shown in PDF
        if (step.url) {
          const safeUrl = this._sanitizeUrl(step.url);
          const urlLines = doc.splitTextToSize(`URL: ${safeUrl}`, contentWidth - 5);
          urlLines.forEach(line => {
            doc.text(line, margin + 5, yPosition);
            yPosition += 4;
          });
        }

        doc.setTextColor(0, 0, 0);
        yPosition += 4;
      }

      // EXP-IMG-001: embed this step's screenshot, if any
      const asset = assetIndex.get(step.id);
      if (asset) {
        const rawUrl = await this._resolveAssetUrl(asset);
        if (rawUrl) {
          // Content-aware, lossless-for-text pipeline (PNG stays PNG)
          const result = await ImageProcessor.processForExport(rawUrl, {
            maxWidth: 1920, maxHeight: 1080,
            ...(this._imgOptsMap.get(sessionId) || { format: 'auto', quality: 0.92 })
          });
          // jsPDF needs 'PNG' or 'JPEG'; derive from the actual mime type
          const fmt = /^data:image\/png/i.test(result.dataUrl) ? 'PNG' : 'JPEG';
          const ratio = result.actualHeight / result.actualWidth;
          let imgW = contentWidth;
          let imgH = imgW * ratio;
          const maxImgH = pageHeight - (2 * margin);
          if (imgH > maxImgH) { imgH = maxImgH; imgW = imgH / ratio; }
          // Page-fit: don't split the image across a page boundary
          if (yPosition + imgH > pageHeight - margin) {
            doc.addPage();
            yPosition = margin;
          }
          try {
            doc.addImage(result.dataUrl, fmt, margin, yPosition, imgW, imgH, undefined, 'SLOW');
            yPosition += imgH + 6;
          } catch (err) {
            Logger.warn('PDF addImage failed for step', step.id, err);
          }
          result.dataUrl = null;
        }
        assetIndex.delete(step.id);
      }
    }

    assetIndex.clear();

    const sessionName = (session.name || 'Session').replace(/[^a-z0-9]/gi, '_');
    const filename = `${sessionName}_${Date.now()}.pdf`;

    // Return a Blob — both callers (popup, background) consume result.blob and
    // build their own object URL / data URL for chrome.downloads.
    return {
      blob: doc.output('blob'),
      filename,
      mimeType: 'application/pdf'
    };
  }
}
