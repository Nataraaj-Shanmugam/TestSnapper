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
 * PERF-003: Export memory fix — process screenshots one at a time, null
 *   out references immediately, use URL.createObjectURL for downloads.
 *
 * FUNC-005/PERF-011: PDF fix — load jsPDF from local lib via chrome.runtime.getURL
 *   instead of CDN (blocked by extension CSP). DOCX fix — detect lib availability
 *   before the image pipeline to avoid wasted CPU+memory.
 *
 * SEC-003: URL sanitization at export time — strips sensitive query params
 *   from step.url and navigate step.value in all export formats.
 */

export class ExportService {
  constructor(storage) {
    this.storage = storage;
    this.cancelledExports = new Set(); // Track cancelled exports
    console.log('ExportService initialized');
  }

  /**
   * Cancel an ongoing export
   */
  cancelExport(sessionId) {
    this.cancelledExports.add(sessionId);
    console.log('Export cancelled for session:', sessionId);
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
    if (!url || typeof url !== 'string') return url || '';
    try {
      const parsed = new URL(url);
      const sensitiveKeys = /^(token|access_token|code|key|api_key|password|secret|sig|signature|auth|session|jwt|otp|reset|magic|verify)$/i;
      const toDelete = [];
      parsed.searchParams.forEach((_, key) => {
        if (sensitiveKeys.test(key)) toDelete.push(key);
      });
      toDelete.forEach(k => parsed.searchParams.delete(k));
      return parsed.toString();
    } catch {
      // Relative URL or non-parseable — return as-is
      return url;
    }
  }

  /**
   * Main export orchestrator
   */
  async exportSession(sessionId, format, progressCallback) {
    const notify =
      typeof progressCallback === 'function' ? progressCallback : () => { };

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

    notify({
      percent: 20,
      status: 'Steps loaded',
      totalSteps: steps.length
    });

    const exportData = {
      session: this._formatSessionData(session, steps.length),
      steps: steps
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

  async _compressImage(blob, maxWidth = 600, quality = 0.95) {
    try {
      const useOffscreen = typeof OffscreenCanvas !== 'undefined';

      if (useOffscreen) {
        const imageBitmap = await createImageBitmap(blob);
        const scale = Math.min(maxWidth / imageBitmap.width, 1);
        const width = Math.floor(imageBitmap.width * scale);
        const height = Math.floor(imageBitmap.height * scale);

        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d', { alpha: false });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(imageBitmap, 0, 0, width, height);

        const compressed = await canvas.convertToBlob({
          type: 'image/jpeg',
          quality
        });

        imageBitmap.close();
        return compressed;
      } else {
        const dataUrl = await this._blobToDataURL(blob);

        return await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            try {
              const scale = Math.min(maxWidth / img.width, 1);
              const canvas = document.createElement('canvas');
              const width = Math.floor(img.width * scale);
              const height = Math.floor(img.height * scale);
              canvas.width = width;
              canvas.height = height;

              const ctx = canvas.getContext('2d', { alpha: false });
              ctx.imageSmoothingEnabled = true;
              ctx.imageSmoothingQuality = 'high';

              if (width < img.width * 0.5) {
                const tempCanvas = document.createElement('canvas');
                const intermediateWidth = Math.floor(img.width * 0.7);
                const intermediateHeight = Math.floor(img.height * 0.7);
                tempCanvas.width = intermediateWidth;
                tempCanvas.height = intermediateHeight;

                const tempCtx = tempCanvas.getContext('2d');
                tempCtx.imageSmoothingEnabled = true;
                tempCtx.imageSmoothingQuality = 'high';
                tempCtx.drawImage(img, 0, 0, intermediateWidth, intermediateHeight);
                ctx.drawImage(tempCanvas, 0, 0, width, height);
                tempCanvas.width = 0;
                tempCanvas.height = 0;
              } else {
                ctx.drawImage(img, 0, 0, width, height);
              }

              canvas.toBlob(
                (compressedBlob) => {
                  canvas.width = 0;
                  canvas.height = 0;
                  img.src = '';
                  resolve(compressedBlob || blob);
                },
                'image/jpeg',
                quality
              );
            } catch (err) {
              console.warn('Canvas compression failed:', err);
              img.src = '';
              resolve(blob);
            }
          };
          img.onerror = () => {
            img.src = '';
            resolve(blob);
          };
          img.src = dataUrl;
        });
      }
    } catch (err) {
      console.warn('Image compression failed, using original:', err);
      return blob;
    }
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
        console.warn('blobToDataURL failed for asset', asset.id, err);
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
    // Apply URL sanitization to all steps (SEC-003)
    const sanitizedSteps = exportData.steps.map(step => {
      const sanitized = { ...step };
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
   * Export to CSV. Sanitizes URLs for SEC-003.
   */
  _exportCSV(exportData, sessionId) {
    const headers = ['Step', 'Action', 'Field Name', 'Selector (CSS)', 'Value', 'URL'];
    const rows = exportData.steps
      .filter(s => s.action !== 'screenshot')
      .map((step, index) => {
        // SEC-003: sanitize URL and navigate value
        const safeUrl = this._sanitizeUrl(step.url);
        const safeValue = (step.action === 'navigate' && step.value)
          ? this._sanitizeUrl(step.value)
          : (step.value || '');

        return [
          index + 1,
          step.action,
          step.fieldName || 'N/A',
          step.selector?.css || '',
          safeValue,
          safeUrl
        ];
      });

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
   * Resize an image data URL for export. Caps at maxWidth=1280 to avoid
   * retaining oversized images (PERF-003).
   */
  async _resizeImageForExport(dataUrl, maxWidth = 1280, maxHeight = 720) {
    // Helper to check if we are in a Service Worker or similar context
    const useOffscreen = typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined';

    if (useOffscreen) {
      try {
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        const bitmap = await createImageBitmap(blob);

        const { width: imgWidth, height: imgHeight } = bitmap;
        const scale = Math.min(maxWidth / imgWidth, maxHeight / imgHeight, 1);

        if (scale >= 1) {
          bitmap.close();
          return { dataUrl, width: imgWidth, height: imgHeight };
        }

        const canvasWidth = Math.floor(imgWidth * scale);
        const canvasHeight = Math.floor(imgHeight * scale);

        const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, canvasWidth, canvasHeight);

        const resizedBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
        const reader = new FileReader();
        const resizedDataUrl = await new Promise((resolve) => {
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(resizedBlob);
        });

        bitmap.close();
        return { dataUrl: resizedDataUrl, width: canvasWidth, height: canvasHeight };

      } catch (error) {
        console.error('Offscreen image resize failed:', error);
        return { dataUrl, width: 1280, height: 720 };
      }
    } else {
      return new Promise((resolve) => {
        const img = new Image();

        img.onload = () => {
          try {
            const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);

            if (scale >= 1) {
              resolve({ dataUrl: dataUrl, width: img.width, height: img.height });
              return;
            }

            const canvas = document.createElement('canvas');
            canvas.width = Math.floor(img.width * scale);
            canvas.height = Math.floor(img.height * scale);

            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

            const resized = canvas.toDataURL('image/jpeg', 0.85);
            // Free canvas memory immediately
            canvas.width = 0;
            canvas.height = 0;
            img.src = '';

            resolve({ dataUrl: resized, width: Math.floor(img.width * scale), height: Math.floor(img.height * scale) });
          } catch (error) {
            console.error('Image resize failed:', error);
            img.src = '';
            resolve({ dataUrl: dataUrl, width: 1280, height: 720 });
          }
        };

        img.onerror = () => {
          img.src = '';
          resolve({ dataUrl: dataUrl, width: 1280, height: 720 });
        };

        img.src = dataUrl;
      });
    }
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
          console.warn('[ExportService] Failed to load local jsPDF lib');
          resolve(false);
        };
        document.head.appendChild(script);
      });
    }

    return false;
  }

  /**
   * Export to DOCX (HTML word document).
   *
   * PERF-003 fix: processes screenshots one at a time — load asset, build
   * HTML img tag, null out reference, then delete from map. Only one
   * asset's bytes live in heap at a time. Uses URL.createObjectURL for
   * the download trigger to avoid +33% base64 overhead on large blobs.
   *
   * SEC-003: sanitizes URLs in step data.
   */
  async _exportDOCX(exportData, sessionId, progressCallback) {
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
      max-height: 4.11in !important;
      height: auto !important;
      margin-top: 15px;
      border: 1px solid #ccc;
      display: block;
    }
    .automated-screenshots { margin-top: 40px; padding-top: 20px; border-top: 2px solid #3498db; }
    .auto-screenshot { margin: 30px 0; text-align: center; }
    .auto-screenshot img {
      max-width: 7.29in !important;
      max-height: 4.11in !important;
      height: auto !important;
      margin: 15px auto;
      border: 1px solid #ccc;
      display: block;
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
    // PERF-003: We load images one at a time as we encounter each step
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

          // PERF-003: load + process this one asset, then null it out
          const asset = assetIndex.get(step.id);
          if (asset) {
            const rawUrl = await this._resolveAssetUrl(asset);
            if (rawUrl) {
              const imgObj = await this._resizeImageForExport(rawUrl, 1280, 720);
              html += `<br><img src="${imgObj.dataUrl}" width="${imgObj.width}" height="${imgObj.height}" class="screenshot-img" alt="Manual Screenshot"/>`;
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
            const imgObj = await this._resizeImageForExport(rawUrl, 1280, 720);
            html += `
    <div class='auto-screenshot'>
      <p><b>Auto Screenshot ${i + 1}</b> - ${new Date(screenshot.timestamp).toLocaleTimeString()}</p>
      <img src="${imgObj.dataUrl}" width="${imgObj.width}" height="${imgObj.height}" alt="Automated Screenshot ${i + 1}"/>
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

    // PERF-003: clear the asset index map
    assetIndex.clear();

    notify({ percent: 90, status: 'Finalizing DOCX content...' });

    const sessionName = (session.name || 'Untitled_Session').replace(/[^a-z0-9]/gi, '_');
    const filename = `${sessionName}_${Date.now()}.doc`;

    notify({ percent: 95, status: 'DOCX generated' });

    // PERF-003: use URL.createObjectURL for download to avoid +33% base64 overhead
    if (typeof Blob !== 'undefined' && typeof URL !== 'undefined' && URL.createObjectURL) {
      const blob = new Blob([html], { type: 'application/msword' });
      const objectUrl = URL.createObjectURL(blob);
      // Revoke after a short delay to allow download to start
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
      return {
        content: null,
        objectUrl,
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

    // FUNC-005: load local jsPDF, NOT CDN
    const loaded = await this._loadJsPDF();
    if (!loaded || typeof window === 'undefined' || !window.jspdf || !window.jspdf.jsPDF) {
      console.error('[ExportService] jsPDF library not available. Ensure libs/jspdf.umd.min.js is present.');
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

        // SEC-003: sanitize URL shown in PDF
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
    }

    const sessionName = (session.name || 'Session').replace(/[^a-z0-9]/gi, '_');
    const filename = `${sessionName}_${Date.now()}.pdf`;

    // PERF-003: use output('blob') + URL.createObjectURL instead of doc.save()
    // which internally converts to a base64 data URL (+33% overhead)
    if (typeof URL !== 'undefined' && URL.createObjectURL) {
      const pdfBlob = doc.output('blob');
      const objectUrl = URL.createObjectURL(pdfBlob);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
      return {
        content: null,
        objectUrl,
        filename,
        mimeType: 'application/pdf'
      };
    }

    // Fallback if URL.createObjectURL unavailable
    doc.save(filename);
    return {
      content: null,
      filename,
      mimeType: 'application/pdf'
    };
  }
}
