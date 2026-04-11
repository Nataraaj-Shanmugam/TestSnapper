/**
 * Export Service
 *
 * Orchestrates the export of test sessions in multiple formats: JSON, CSV, DOCX, and PDF.
 * Handles screenshot loading from multiple sources (dataUrl, data, blob), progress tracking,
 * and export cancellation.
 *
 * Fix applied (screenshots never appearing in exported .doc / review page):
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
 */

import { Utils } from './utils.js';
import { ImageProcessor } from './image-processor.js';

export class ExportService {
  /**
   * Initialize the export service
   * @param {StorageManager} storage - Storage manager instance
   */
  constructor(storage) {
    this.storage = storage;
    this.cancelledExports = new Set(); // Track cancelled exports
    console.log('ExportService initialized');
  }

  /**
   * Cancel an ongoing export (BUG FIX: EXP-HIGH-001)
   * @param {string} sessionId - Session identifier
   */
  cancelExport(sessionId) {
    this.cancelledExports.add(sessionId);
    console.log('Export cancelled for session:', sessionId);
  }

  /**
   * Check if export was cancelled
   * @private
   * @param {string} sessionId - Session identifier
   * @returns {boolean} true if export was cancelled
   */
  _isCancelled(sessionId) {
    return this.cancelledExports.has(sessionId);
  }

  /**
   * Clear cancellation flag
   * @private
   * @param {string} sessionId - Session identifier
   */
  _clearCancellation(sessionId) {
    this.cancelledExports.delete(sessionId);
  }

  /**
   * Main export orchestrator
   * Loads session, processes steps/assets, and delegates to format-specific exporter
   * @async
   * @param {string} sessionId - Session identifier
   * @param {string} format - Export format: 'json', 'csv', 'docx', or 'pdf'
   * @param {Function} [progressCallback] - Optional progress callback
   * @returns {Promise<Object>} Export result object with content, filename, mimeType
   * @throws {Error} If export is cancelled or format is unsupported
   * @example
   * const result = await exportService.exportSession(sessionId, 'docx', (progress) => {
   *   console.log(`${progress.percent}% - ${progress.status}`);
   * });
   */
  async exportSession(sessionId, format, progressCallback, options = {}) {
    const notify =
      typeof progressCallback === 'function' ? progressCallback : () => { };

    // R-004: Parse export options
    const includeScreenshots = options.includeScreenshots !== false;
    const includeSelectors = options.includeSelectors !== false;
    const onlyFailed = options.onlyFailed === true;

    // Clear any previous cancellation
    this._clearCancellation(sessionId);

    console.log('Starting export:', format, 'for session:', sessionId);

    // Check cancellation
    if (this._isCancelled(sessionId)) {
      throw new Error('Export cancelled');
    }

    notify({ percent: 5, status: 'Loading session...' });

    const session = await this.storage.getSession(sessionId);
    notify({ percent: 10, status: 'Session loaded' });

    let steps = await this.storage.getSteps(sessionId);
    steps.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

    // R-004: Apply step filter
    if (onlyFailed) steps = steps.filter(s => s.failed === true);

    // R-004: Strip selectors if not included
    if (!includeSelectors) {
      steps = steps.map(s => ({ ...s, selector: undefined }));
    }

    notify({
      percent: 20,
      status: 'Steps loaded',
      totalSteps: steps.length
    });

    const exportData = {
      session: this._formatSessionData(session, steps.length),
      steps: steps,
      _includeScreenshots: includeScreenshots
    };

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
        return await this._exportPDF(exportData, sessionId);

      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  // ==================== Private Helpers ====================

  /**
   * Format session data for export
   * @private
   * @param {Object} session - Session object
   * @param {number} stepCount - Number of steps
   * @returns {Object} Formatted session data
   */
  _formatSessionData(session, stepCount) {
    return {
      id: session.sessionId,
      name: session.sessionName || 'Untitled Session',
      createdAt: session.createdAt,
      environment: session.env,
      stepCount
    };
  }

  /**
   * Resolve a usable base64 data-URL from a storage asset
   * Priority:
   *   1. asset.dataUrl  — what background.js writes for captured screenshots
   *   2. asset.data     — what review-standalone writes for manually-added screenshots
   *   3. asset.blob     — only valid in live session (becomes {} after storage round-trip)
   * @private
   * @async
   * @param {Object} asset - Asset object
   * @returns {Promise<string|null>} Data-URL string or null if no usable image
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
        return await Utils.blobToDataURL(asset.blob);
      } catch (err) {
        console.warn('blobToDataURL failed for asset', asset.id, err);
      }
    }

    return null;
  }

  // ==================== Format Exporters ====================

  /**
   * Export as JSON
   * @private
   * @param {Object} exportData - Export data object
   * @param {string} sessionId - Session identifier
   * @returns {Object} Export result with content, filename, mimeType
   */
  _exportJSON(exportData, sessionId) {
    const content = JSON.stringify(exportData, null, 2);
    const sessionName = (exportData.session.name || 'Untitled_Session').replace(/[^a-z0-9]/gi, '_');
    const filename = `${sessionName}_${Date.now()}.json`;

    return {
      content,
      filename,
      mimeType: 'application/json'
    };
  }

  /**
   * Export as CSV
   * @private
   * @param {Object} exportData - Export data object
   * @param {string} sessionId - Session identifier
   * @returns {Object} Export result with content, filename, mimeType
   */
  _exportCSV(exportData, sessionId) {
    const headers = ['Step', 'Action', 'Field Name', 'Selector (CSS)', 'Value', 'URL'];
    const rows = exportData.steps
      .filter(s => s.action !== 'screenshot')
      .map((step, index) => [
        index + 1,
        step.action,
        step.fieldName || 'N/A',
        step.selector?.css || '',
        step.value || '',
        step.url
      ]);

    const content = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    const filename = `testsnapper_${sessionId.substring(0, 8)}_${Date.now()}.csv`;

    return {
      content,
      filename,
      mimeType: 'text/csv'
    };
  }

  /**
   * Export as DOCX with embedded screenshots
   * Attempts to use docx library with CDN fallback; falls back to ZIP-based DOCX if library unavailable
   * @private
   * @async
   * @param {Object} exportData - Export data object
   * @param {string} sessionId - Session identifier
   * @param {Function} notify - Progress callback
   * @returns {Promise<Object>} Export result with blob, filename, mimeType
   */
  async _exportDOCX(exportData, sessionId, notify) {
    const { session, steps } = exportData;

    notify({ percent: 25, status: 'Loading DOCX library...' });

    // Try to load the bundled docx library with CDN fallback
    let docxLib = null;
    try {
      if (window.docx) {
        docxLib = window.docx;
      } else {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');

          // Try local library first
          script.src = chrome.runtime.getURL('libs/docx.min.js');

          script.onload = () => {
            console.log('Loaded docx library from local bundle');
            resolve();
          };

          script.onerror = () => {
            console.warn('Local docx library not found, trying CDN...');
            script.remove();

            // CDN fallback with SRI integrity hash for security
            const cdnScript = document.createElement('script');
            cdnScript.src = 'https://unpkg.com/docx@7.8.2/build/index.js';
            cdnScript.crossOrigin = 'anonymous';
            // SRI hash verified for docx@7.8.2 (unpkg.com/docx@7.8.2/build/index.js)
            cdnScript.integrity = 'sha384-zjTqOObJTD6OT6CUn8mSpDY+crIiP0cX457OjcZosSATiUFbmdXa9KRScjfLVxFH';
            cdnScript.onload = () => {
              console.log('Loaded docx library from CDN');
              resolve();
            };
            cdnScript.onerror = () => {
              reject(new Error('Failed to load docx library from both local and CDN'));
            };
            document.head.appendChild(cdnScript);
          };

          document.head.appendChild(script);
        });
        docxLib = window.docx;
      }
    } catch (e) {
      console.warn('docx library not available, falling back to ZIP-based DOCX:', e);
    }

    // Load user's export quality preference
    let exportFormat = 'auto';
    try {
      const settings = await this.storage.getSettings();
      exportFormat = settings.exportImageQuality || settings.imageQuality || 'auto';
    } catch (e) { /* use default */ }

    notify({ percent: 30, status: 'Loading screenshots...' });

    // Load screenshots via _resolveAssetUrl (checks dataUrl, then data, then blob)
    const screenshotAssets = exportData._includeScreenshots !== false
      ? await this.storage.getAllAssets(session.id)
      : [];
    const screenshotMap = new Map();
    const totalScreens = screenshotAssets.length || 1;
    let processed = 0;

    for (const asset of screenshotAssets) {
      if (this._isCancelled(session.id)) {
        this._clearCancellation(session.id);
        throw new Error('Export cancelled by user');
      }

      const url = await this._resolveAssetUrl(asset);
      if (url) {
        const imgObj = await ImageProcessor.processForExport(url, {
          quality: 0.92,
          format: exportFormat
        });
        screenshotMap.set(asset.stepId, imgObj);
      } else {
        console.warn('No usable image data for asset', asset.id, '(stepId:', asset.stepId + ')');
      }

      processed++;
      // Progress: 30–70% during screenshot work
      const pct = 30 + Math.floor((processed / totalScreens) * 40);
      notify({
        percent: Math.min(pct, 70),
        status: `Processing screenshots... (${processed}/${totalScreens})`
      });

      await new Promise(resolve => setTimeout(resolve, 10));
    }

    notify({ percent: 75, status: 'Building DOCX document...' });

    if (this._isCancelled(session.id)) {
      this._clearCancellation(session.id);
      throw new Error('Export cancelled by user');
    }

    const sessionName = (session.name || 'Untitled_Session').replace(/[^a-z0-9]/gi, '_');
    const filename = `${sessionName}_${Date.now()}.docx`;

    let result;
    if (docxLib) {
      result = await this._buildDocxWithLibrary(docxLib, session, steps, filename, screenshotMap, notify);
    } else {
      result = await this._buildDocxFallback(session, steps, filename, screenshotMap, notify);
    }

    screenshotMap.clear();

    notify({ percent: 95, status: 'DOCX generated' });

    return {
      content: null,
      filename: result.filename,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      blob: result.blob
    };
  }

  /**
   * Build a proper .docx using the docx library
   * @private
   * @async
   * @param {Object} docxLib - docx library reference
   * @param {Object} session - Session object
   * @param {Array} steps - Steps array
   * @param {string} filename - Output filename
   * @param {Map} screenshotMap - Map of stepId to image objects
   * @param {Function} notify - Progress callback
   * @returns {Promise<Object>} { blob, filename }
   */
  async _buildDocxWithLibrary(docxLib, session, steps, filename, screenshotMap, notify) {
    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
            AlignmentType, BorderStyle, WidthType, ShadingType, HeadingLevel,
            ImageRun } = docxLib;

    const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
    const borders = { top: border, bottom: border, left: border, right: border };
    const headerShading = { fill: '0284C7', type: ShadingType.CLEAR };
    const headerTextRun = (text) => new TextRun({ text, bold: true, color: 'FFFFFF', size: 22 });
    const cellWidth = (w) => ({ size: w, type: WidthType.DXA });

    // Column widths (sum = 9360 DXA = 6.5" content area on US Letter with 1" margins)
    const colWidths = [600, 1600, 1560, 2600, 3000];

    // Header row
    const headerRow = new TableRow({
      children: ['#', 'Action', 'Field', 'Selector', 'Value / URL'].map((label, i) =>
        new TableCell({
          borders,
          width: cellWidth(colWidths[i]),
          shading: headerShading,
          margins: { top: 60, bottom: 60, left: 80, right: 80 },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [headerTextRun(label)] })]
        })
      )
    });

    // Data rows — process in chunks to avoid memory issues
    const CHUNK_SIZE = 50;
    const dataRows = [];
    const totalSteps = steps.length;
    let processedCount = 0;

    for (let chunkStart = 0; chunkStart < totalSteps; chunkStart += CHUNK_SIZE) {
      const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, totalSteps);
      const chunk = steps.slice(chunkStart, chunkEnd);

      for (const step of chunk) {
        if (this._isCancelled(session.id)) {
          this._clearCancellation(session.id);
          throw new Error('Export cancelled by user');
        }

        const selectorDisplay = step.selector?.css || step.selector?.xpath || 'N/A';
        const valueDisplay = step.value || step.url || 'N/A';

        dataRows.push(new TableRow({
          children: [
            String(processedCount + 1),
            step.action || '',
            step.fieldName || 'N/A',
            selectorDisplay,
            valueDisplay
          ].map((cellText, i) =>
            new TableCell({
              borders,
              width: cellWidth(colWidths[i]),
              shading: { fill: processedCount % 2 === 0 ? 'F8FAFC' : 'FFFFFF', type: ShadingType.CLEAR },
              margins: { top: 60, bottom: 60, left: 80, right: 80 },
              children: [new Paragraph({ children: [new TextRun({ text: String(cellText), size: 20 })] })]
            })
          )
        }));

        processedCount++;
      }

      if (chunkEnd < totalSteps) {
        const pct = 75 + Math.floor((processedCount / totalSteps) * 15);
        if (notify) notify({ percent: Math.min(pct, 90), status: `Building document... (${processedCount}/${totalSteps})` });
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    // Screenshot paragraphs — embed each screenshot after the steps table
    const screenshotParagraphs = [];
    if (screenshotMap && screenshotMap.size > 0 && ImageRun) {
      for (const step of steps) {
        const imgObj = screenshotMap.get(step.id);
        if (imgObj && imgObj.dataUrl) {
          try {
            // Convert data URL to ArrayBuffer for ImageRun
            const base64 = imgObj.dataUrl.split(',')[1];
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let k = 0; k < binary.length; k++) bytes[k] = binary.charCodeAt(k);

            const isJpeg = imgObj.dataUrl.startsWith('data:image/jpeg');
            screenshotParagraphs.push(
              new Paragraph({
                children: [new TextRun({ text: `Screenshot — step: ${step.action || ''}`, bold: true, size: 20 })]
              }),
              new Paragraph({
                children: [
                  new ImageRun({
                    data: bytes.buffer,
                    transformation: { width: imgObj.width || 600, height: imgObj.height || 450 },
                    type: isJpeg ? 'jpg' : 'png'
                  })
                ]
              })
            );
          } catch (imgErr) {
            console.warn('Failed to embed screenshot for step', step.id, imgErr);
          }
        }
      }
    }

    const doc = new Document({
      styles: {
        default: { document: { run: { font: 'Arial', size: 22 } } }
      },
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },           // US Letter
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } // 1" margins
          }
        },
        children: [
          // Title
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: 'TestSnapper — Test Recording', bold: true, size: 32, color: '0284C7' })]
          }),

          // Session metadata
          new Paragraph({ spacing: { before: 200 }, children: [
            new TextRun({ text: 'Session: ', bold: true, size: 22 }),
            new TextRun({ text: session.name || session.id || 'Unnamed', size: 22 })
          ]}),
          new Paragraph({ children: [
            new TextRun({ text: 'Created: ', bold: true, size: 22 }),
            new TextRun({ text: new Date(session.createdAt).toLocaleString(), size: 22 })
          ]}),
          new Paragraph({ children: [
            new TextRun({ text: 'URL: ', bold: true, size: 22 }),
            new TextRun({ text: session.environment?.url || 'N/A', size: 22 })
          ]}),
          new Paragraph({ children: [
            new TextRun({ text: 'Total Steps: ', bold: true, size: 22 }),
            new TextRun({ text: String(steps.length), size: 22 })
          ]}),

          // Spacer
          new Paragraph({ spacing: { before: 300, after: 100 }, children: [] }),

          // Steps table
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            columnWidths: colWidths,
            rows: [headerRow, ...dataRows]
          }),

          // Screenshots section (if any)
          ...(screenshotParagraphs.length > 0 ? [
            new Paragraph({ spacing: { before: 400 }, children: [] }),
            new Paragraph({
              heading: HeadingLevel.HEADING_2,
              children: [new TextRun({ text: 'Screenshots', bold: true, size: 28, color: '0284C7' })]
            }),
            ...screenshotParagraphs
          ] : [])
        ]
      }]
    });

    const buffer = await Packer.toBuffer(doc);
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

    return { blob, filename };
  }

  /**
   * Fallback: create a minimal .docx without the library
   * A .docx is just a ZIP containing a few XML files. Built manually
   * so export never fails even if the library failed to load
   * @private
   * @async
   * @param {Object} session - Session object
   * @param {Array} steps - Steps array
   * @param {string} filename - Output filename
   * @param {Map} screenshotMap - Map of stepId to image objects
   * @param {Function} notify - Progress callback
   * @returns {Promise<Object>} { blob, filename }
   */
  async _buildDocxFallback(session, steps, filename, screenshotMap, notify) {
    const escXml = (s) => Utils.escapeHtml(String(s || ''));

    let bodyParagraphs = `
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
        <w:r><w:t>TestSnapper — Test Recording</w:t></w:r></w:p>
      <w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Session: </w:t></w:r>
        <w:r><w:t>${escXml(session.name || session.id)}</w:t></w:r></w:p>
      <w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Created: </w:t></w:r>
        <w:r><w:t>${escXml(new Date(session.createdAt).toLocaleString())}</w:t></w:r></w:p>
      <w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">URL: </w:t></w:r>
        <w:r><w:t>${escXml(session.environment?.url || 'N/A')}</w:t></w:r></w:p>
      <w:p><w:r><w:t/></w:r></w:p>`;

    // Process in chunks to avoid memory issues
    const CHUNK_SIZE = 50;
    const totalSteps = steps.length;

    for (let chunkStart = 0; chunkStart < totalSteps; chunkStart += CHUNK_SIZE) {
      const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, totalSteps);
      const chunk = steps.slice(chunkStart, chunkEnd);

      for (let idx = 0; idx < chunk.length; idx++) {
        const step = chunk[idx];
        const i = chunkStart + idx;

        if (this._isCancelled(session.id)) {
          this._clearCancellation(session.id);
          throw new Error('Export cancelled by user');
        }

        const sel = escXml(step.selector?.css || step.selector?.xpath || 'N/A');
        const val = escXml(step.value || step.url || 'N/A');
        bodyParagraphs += `
        <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
          <w:r><w:t>Step ${i + 1}: ${escXml(step.action)}</w:t></w:r></w:p>
        <w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Field: </w:t></w:r>
          <w:r><w:t>${escXml(step.fieldName || 'N/A')}</w:t></w:r></w:p>
        <w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Selector: </w:t></w:r>
          <w:r><w:t>${sel}</w:t></w:r></w:p>
        <w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Value: </w:t></w:r>
          <w:r><w:t>${val}</w:t></w:r></w:p>`;
      }

      if (chunkEnd < totalSteps) {
        const pct = 75 + Math.floor((chunkEnd / totalSteps) * 15);
        if (notify) notify({ percent: Math.min(pct, 90), status: `Building document... (${chunkEnd}/${totalSteps})` });
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    // Note screenshots in the fallback (full binary embedding requires relationship
    // wiring that is out of scope for this minimal ZIP builder)
    if (screenshotMap && screenshotMap.size > 0) {
      bodyParagraphs += `
        <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
          <w:r><w:t>Screenshots</w:t></w:r></w:p>`;
      for (const [stepId] of screenshotMap) {
        bodyParagraphs += `
        <w:p><w:r><w:t xml:space="preserve">Screenshot for step: ${escXml(stepId)} (open .docx in Word to view embedded images)</w:t></w:r></w:p>`;
      }
    }

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyParagraphs}<w:sectPr/></w:body>
</w:document>`;

    const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

    const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

    const wordRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="2C3E50"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:pPr><w:spacing w:before="200" w:after="80"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="34495E"/></w:rPr>
  </w:style>
</w:styles>`;

    const blob = await this._createZipBlob({
      '[Content_Types].xml': contentTypesXml,
      '_rels/.rels': relsXml,
      'word/_rels/document.xml.rels': wordRelsXml,
      'word/document.xml': documentXml,
      'word/styles.xml': stylesXml
    });

    return { blob, filename };
  }

  /**
   * Minimal ZIP file builder (no dependencies)
   * Handles only stored (uncompressed) entries — sufficient for .docx XML
   * @private
   * @async
   * @param {Object<string, string>} files - Map of filename to content
   * @returns {Promise<Blob>} ZIP file Blob
   */
  async _createZipBlob(files) {
    const encoder = new TextEncoder();
    const entries = [];
    let offset = 0;

    for (const [name, content] of Object.entries(files)) {
      const nameBytes = encoder.encode(name);
      const contentBytes = encoder.encode(content);
      const crc = this._crc32(contentBytes);

      // Local file header
      const local = new Uint8Array(30 + nameBytes.length);
      const localView = new DataView(local.buffer);
      localView.setUint32(0, 0x04034b50, true);   // signature
      localView.setUint16(4, 20, true);            // version needed
      localView.setUint16(6, 0, true);             // flags
      localView.setUint16(8, 0, true);             // compression: stored
      localView.setUint16(10, 0, true);            // mod time
      localView.setUint16(12, 0, true);            // mod date
      localView.setUint32(14, crc, true);          // crc32
      localView.setUint32(18, contentBytes.length, true); // compressed size
      localView.setUint32(22, contentBytes.length, true); // uncompressed size
      localView.setUint16(26, nameBytes.length, true);    // name length
      localView.setUint16(28, 0, true);            // extra length
      local.set(nameBytes, 30);

      entries.push({ name: nameBytes, content: contentBytes, local, crc, offset });
      offset += local.length + contentBytes.length;
    }

    // Central directory
    const cdParts = [];
    let cdSize = 0;
    for (const entry of entries) {
      const cd = new Uint8Array(46 + entry.name.length);
      const cdView = new DataView(cd.buffer);
      cdView.setUint32(0, 0x02014b50, true);      // signature
      cdView.setUint16(4, 20, true);               // version made by
      cdView.setUint16(6, 20, true);               // version needed
      cdView.setUint16(8, 0, true);                // flags
      cdView.setUint16(10, 0, true);               // compression
      cdView.setUint16(12, 0, true);               // mod time
      cdView.setUint16(14, 0, true);               // mod date
      cdView.setUint32(16, entry.crc, true);       // crc32
      cdView.setUint32(20, entry.content.length, true);
      cdView.setUint32(24, entry.content.length, true);
      cdView.setUint16(28, entry.name.length, true);
      cdView.setUint16(30, 0, true);               // extra len
      cdView.setUint16(32, 0, true);               // comment len
      cdView.setUint16(34, 0, true);               // disk number
      cdView.setUint16(36, 0, true);               // internal attrs
      cdView.setUint32(38, 0, true);               // external attrs
      cdView.setUint32(42, entry.offset, true);    // local header offset
      cd.set(entry.name, 46);
      cdParts.push(cd);
      cdSize += cd.length;
    }

    // End of central directory
    const eocd = new Uint8Array(22);
    const eocdView = new DataView(eocd.buffer);
    eocdView.setUint32(0, 0x06054b50, true);       // signature
    eocdView.setUint16(4, 0, true);                // disk number
    eocdView.setUint16(6, 0, true);                // cd disk
    eocdView.setUint16(8, entries.length, true);   // entries on disk
    eocdView.setUint16(10, entries.length, true);  // total entries
    eocdView.setUint32(12, cdSize, true);          // cd size
    eocdView.setUint32(16, offset, true);          // cd offset
    eocdView.setUint16(20, 0, true);               // comment length

    // Concatenate everything
    const parts = [];
    for (const entry of entries) {
      parts.push(entry.local, entry.content);
    }
    parts.push(...cdParts, eocd);

    const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
    const result = new Uint8Array(totalLen);
    let pos = 0;
    for (const part of parts) {
      result.set(part, pos);
      pos += part.length;
    }

    return new Blob([result], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  /**
   * CRC-32 computation (standard polynomial 0xEDB88320)
   * @private
   * @param {Uint8Array} bytes - Data to compute CRC for
   * @returns {number} CRC-32 hash
   */
  _crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
      }
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  /**
   * Export as PDF
   * @private
   * @async
   * @param {Object} exportData - Export data object
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Object>} Export result with filename, mimeType
   */
  async _exportPDF(exportData, sessionId) {
    const { session, steps } = exportData;

    if (typeof window.jspdf === 'undefined') {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
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

    let stepNumber = 0;
    for (const step of steps) {
      if (step.action !== 'screenshot' || step.isManual) {
        stepNumber++;

        if (yPosition > pageHeight - 30) {
          doc.addPage();
          yPosition = margin;
        }

        doc.setFontSize(11);
        doc.setFont('helvetica', 'bold');

        const description = step.description ||
          `${step.action.toUpperCase()} ${step.fieldName || ''}`;

        const lines = doc.splitTextToSize(`${stepNumber}. ${description}`, contentWidth);
        lines.forEach(line => {
          doc.text(line, margin, yPosition);
          yPosition += 5;
        });

        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100, 100, 100);

        if (step.selector?.css) {
          doc.text(`Selector: ${step.selector.css}`, margin + 5, yPosition);
          yPosition += 4;
        }

        doc.setTextColor(0, 0, 0);
        yPosition += 4;
      }
    }

    const sessionName = (session.name || 'Session').replace(/[^a-z0-9]/gi, '_');
    const filename = `${sessionName}_${Date.now()}.pdf`;

    doc.save(filename);

    return {
      content: null,
      filename,
      mimeType: 'application/pdf'
    };
  }
}
