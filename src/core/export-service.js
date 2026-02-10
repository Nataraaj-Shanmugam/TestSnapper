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
 */

export class ExportService {
  constructor(storage) {
    this.storage = storage;
    this.cancelledExports = new Set(); // Track cancelled exports
    console.log('✅ ExportService initialized');
  }

  /**
   * BUG FIX: EXP-HIGH-001 - Cancel an ongoing export
   */
  cancelExport(sessionId) {
    this.cancelledExports.add(sessionId);
    console.log('🛑 Export cancelled for session:', sessionId);
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
   * Main export orchestrator
   */
  async exportSession(sessionId, format, progressCallback) {
    const notify =
      typeof progressCallback === 'function' ? progressCallback : () => { };

    // Clear any previous cancellation
    this._clearCancellation(sessionId);

    console.log('📄 Starting export:', format, 'for session:', sessionId);

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
   * Process image for export with smart format selection.
   * - Text-heavy screenshots: export as PNG (preserves text clarity)
   * - Photo-heavy screenshots: export as JPEG (smaller file size)
   *
   * Returns both the actual pixel dimensions (actualWidth/actualHeight)
   * and the recommended display dimensions (width/height) for DOCX embedding.
   * The image data is kept at high resolution so zooming in reveals detail.
   *
   * @param {string} dataUrl - Original image data URL
   * @param {Object} options - { maxWidth, maxHeight, displayWidth, displayHeight, quality, format }
   * @returns {{ dataUrl, width, height, actualWidth, actualHeight, format }}
   */
  async _processImageForExport(dataUrl, options = {}) {
    const {
      maxWidth = 1920,         // Actual pixel cap (keep high for zoom quality)
      maxHeight = 1080,
      displayWidth = 600,      // Display size in DOCX (old layout)
      displayHeight = 450,
      quality = 0.92,
      format = 'auto'          // 'auto', 'png', 'jpeg-high', 'jpeg-standard'
    } = options;

    const jpegQuality = format === 'jpeg-standard' ? 0.85 : quality;
    const useOffscreen = typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined';

    let result;
    if (useOffscreen) {
      result = await this._processImageOffscreen(dataUrl, maxWidth, maxHeight, jpegQuality, format);
    } else {
      result = await this._processImageDOM(dataUrl, maxWidth, maxHeight, jpegQuality, format);
    }

    // Calculate display dimensions that fit within displayWidth x displayHeight
    // while preserving aspect ratio
    const scale = Math.min(displayWidth / result.width, displayHeight / result.height, 1);
    result.actualWidth = result.width;
    result.actualHeight = result.height;
    result.width = Math.floor(result.width * scale);
    result.height = Math.floor(result.height * scale);

    return result;
  }

  async _processImageOffscreen(dataUrl, maxWidth, maxHeight, quality, format) {
    try {
      const response = await fetch(dataUrl);
      const blob = await response.blob();
      const bitmap = await createImageBitmap(blob);

      const { width: imgWidth, height: imgHeight } = bitmap;

      const scale = Math.min(maxWidth / imgWidth, maxHeight / imgHeight, 1);
      const canvasWidth = Math.floor(imgWidth * scale);
      const canvasHeight = Math.floor(imgHeight * scale);

      const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, canvasWidth, canvasHeight);

      // Determine output format
      let outputFormat = format;
      if (outputFormat === 'auto') {
        outputFormat = this._detectContentType(ctx, canvasWidth, canvasHeight);
      }

      let outputBlob;
      if (outputFormat === 'png') {
        outputBlob = await canvas.convertToBlob({ type: 'image/png' });
      } else {
        outputBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
        outputFormat = 'jpeg';
      }

      // Safety: if auto-selected PNG is >3x larger than JPEG, use JPEG
      if (format === 'auto' && outputFormat === 'png') {
        const jpegBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
        if (outputBlob.size > jpegBlob.size * 3) {
          outputBlob = jpegBlob;
          outputFormat = 'jpeg';
        }
      }

      bitmap.close();

      const reader = new FileReader();
      const outputDataUrl = await new Promise((resolve) => {
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(outputBlob);
      });

      console.log(`📐 Export image (Offscreen): ${imgWidth}x${imgHeight} → ${canvasWidth}x${canvasHeight} [${outputFormat}]`);
      return { dataUrl: outputDataUrl, width: canvasWidth, height: canvasHeight, format: outputFormat };
    } catch (error) {
      console.error('Offscreen export image processing failed:', error);
      return { dataUrl, width: 1200, height: 900, format: 'original' };
    }
  }

  async _processImageDOM(dataUrl, maxWidth, maxHeight, quality, format) {
    return new Promise((resolve) => {
      const img = new Image();

      img.onload = () => {
        try {
          const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);
          const canvasWidth = Math.floor(img.width * scale);
          const canvasHeight = Math.floor(img.height * scale);

          const canvas = document.createElement('canvas');
          canvas.width = canvasWidth;
          canvas.height = canvasHeight;

          const ctx = canvas.getContext('2d', { alpha: false });
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          // Step-down scaling for large reductions (better quality)
          if (canvasWidth < img.width * 0.5) {
            const tempCanvas = document.createElement('canvas');
            const intermediateWidth = Math.floor(img.width * 0.7);
            const intermediateHeight = Math.floor(img.height * 0.7);
            tempCanvas.width = intermediateWidth;
            tempCanvas.height = intermediateHeight;
            const tempCtx = tempCanvas.getContext('2d');
            tempCtx.imageSmoothingEnabled = true;
            tempCtx.imageSmoothingQuality = 'high';
            tempCtx.drawImage(img, 0, 0, intermediateWidth, intermediateHeight);
            ctx.drawImage(tempCanvas, 0, 0, canvasWidth, canvasHeight);
            tempCanvas.width = 0;
            tempCanvas.height = 0;
          } else {
            ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);
          }

          // Determine output format
          let outputFormat = format;
          if (outputFormat === 'auto') {
            outputFormat = this._detectContentType(ctx, canvasWidth, canvasHeight);
          }

          if (outputFormat === 'png') {
            const pngDataUrl = canvas.toDataURL('image/png');
            const jpegDataUrl = canvas.toDataURL('image/jpeg', quality);

            // Safety: if PNG is >3x JPEG, use JPEG
            if (format === 'auto' && pngDataUrl.length > jpegDataUrl.length * 3) {
              outputFormat = 'jpeg';
              canvas.width = 0;
              canvas.height = 0;
              img.src = '';
              resolve({ dataUrl: jpegDataUrl, width: canvasWidth, height: canvasHeight, format: 'jpeg' });
              return;
            }

            canvas.width = 0;
            canvas.height = 0;
            img.src = '';
            resolve({ dataUrl: pngDataUrl, width: canvasWidth, height: canvasHeight, format: 'png' });
          } else {
            const jpegDataUrl = canvas.toDataURL('image/jpeg', quality);
            canvas.width = 0;
            canvas.height = 0;
            img.src = '';
            console.log(`📐 Export image: ${img.width || canvasWidth}x${img.height || canvasHeight} → ${canvasWidth}x${canvasHeight} [jpeg]`);
            resolve({ dataUrl: jpegDataUrl, width: canvasWidth, height: canvasHeight, format: 'jpeg' });
          }
        } catch (error) {
          console.error('DOM export image processing failed:', error);
          img.src = '';
          resolve({ dataUrl, width: 1200, height: 900, format: 'original' });
        }
      };

      img.onerror = () => {
        console.error('Failed to load image for export processing');
        resolve({ dataUrl, width: 1200, height: 900, format: 'original' });
      };

      img.src = dataUrl;
    });
  }

  /**
   * Detect whether image content is text-heavy or photo-heavy using edge density.
   * Samples a pixel region and counts sharp luminance transitions.
   * High edge density = text/UI → PNG; Low = photo → JPEG.
   */
  _detectContentType(ctx, width, height) {
    try {
      const sampleSize = Math.min(200, width, height);
      const imageData = ctx.getImageData(0, 0, Math.min(sampleSize, width), Math.min(sampleSize, height));
      const data = imageData.data;
      const w = imageData.width;

      let edgeCount = 0;
      let totalPixels = 0;
      const threshold = 30;

      for (let y = 0; y < imageData.height - 1; y++) {
        for (let x = 0; x < w - 1; x++) {
          const idx = (y * w + x) * 4;
          const idxRight = (y * w + x + 1) * 4;
          const idxBelow = ((y + 1) * w + x) * 4;

          const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
          const lumRight = 0.299 * data[idxRight] + 0.587 * data[idxRight + 1] + 0.114 * data[idxRight + 2];
          const lumBelow = 0.299 * data[idxBelow] + 0.587 * data[idxBelow + 1] + 0.114 * data[idxBelow + 2];

          if (Math.abs(lum - lumRight) > threshold || Math.abs(lum - lumBelow) > threshold) {
            edgeCount++;
          }
          totalPixels++;
        }
      }

      const edgeDensity = totalPixels > 0 ? edgeCount / totalPixels : 0;
      console.log(`🔍 Content detection: edge density = ${edgeDensity.toFixed(3)} → ${edgeDensity > 0.12 ? 'PNG (text/UI)' : 'JPEG (photo)'}`);
      return edgeDensity > 0.12 ? 'png' : 'jpeg';
    } catch (e) {
      return 'jpeg'; // Safe fallback
    }
  }

  /**
   * @deprecated Use _processImageForExport instead. Kept for backward compatibility.
   */
  async _resizeImageForExport(dataUrl, maxWidth = 600, maxHeight = 450) {
    return this._processImageForExport(dataUrl, {
      displayWidth: maxWidth,
      displayHeight: maxHeight,
      format: 'auto'
    });
  }

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
    // Load user's export quality preference
    let exportFormat = 'auto';
    try {
      const settingsResult = await chrome.storage.local.get('settings');
      const settings = settingsResult.settings || {};
      exportFormat = settings.exportImageQuality || 'auto';
    } catch (e) { /* use default */ }

    // Load screenshots — use _resolveAssetUrl which checks dataUrl first,
    // then data, then blob.  This is the line that was broken before: it
    // only checked asset.blob, which is always {} after storage round-trip.
    // ------------------------------------------------------------------
    const screenshotAssets = await this.storage.getAllAssets(session.id);
    const screenshotMap = new Map();
    const totalScreens = screenshotAssets.length || 1;
    let processed = 0;

    for (const asset of screenshotAssets) {
      // BUG FIX: EXP-HIGH-001 - Check cancellation during processing
      if (this._isCancelled(session.id)) {
        this._clearCancellation(session.id);
        throw new Error('Export cancelled by user');
      }

      let url = await this._resolveAssetUrl(asset);
      if (url) {
        // Smart export: high-res data (1920x1080) for zoom quality,
        // display at 600x450 in DOCX for old layout
        const imgObj = await this._processImageForExport(url, {
          quality: 0.92,
          format: exportFormat
        });
        screenshotMap.set(asset.stepId, imgObj);
      } else {
        console.warn('No usable image data for asset', asset.id, '(stepId:', asset.stepId + ')');
      }

      processed++;
      // Progress: 40–80% during screenshot work
      const pct = 40 + Math.floor((processed / totalScreens) * 40);
      notify({
        percent: Math.min(pct, 80),
        status: `Processing screenshots… (${processed}/${totalScreens})`
      });

      // Yield to keep the UI responsive
      await new Promise(resolve => setTimeout(resolve, 10));
    }
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

    // 🔧 FIX: EXP-001 - Process in chunks to avoid memory issues
    const CHUNK_SIZE = 50;
    const totalSteps = regularSteps.length;
    let processedCount = 0;

    for (let chunkStart = 0; chunkStart < totalSteps; chunkStart += CHUNK_SIZE) {
      const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, totalSteps);
      const chunk = regularSteps.slice(chunkStart, chunkEnd);

      console.log(`Processing chunk ${chunkStart}-${chunkEnd} of ${totalSteps}`);

      for (const step of chunk) {
        // BUG FIX: EXP-HIGH-001 - Check cancellation during step processing
        if (this._isCancelled(session.id)) {
          this._clearCancellation(session.id);
          throw new Error('Export cancelled by user');
        }

        let oneliner;

        if (step.action === 'screenshot') {
          oneliner = '📸 Manual screenshot captured';
          html += `<li>${oneliner}`;

          const screenshotData = screenshotMap.get(step.id);
          if (screenshotData && screenshotData.dataUrl) {
            html += `<br><img src="${screenshotData.dataUrl}" width="${screenshotData.width}" height="${screenshotData.height}" class="screenshot-img" alt="Manual Screenshot"/>`;
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
              oneliner += ` to ${this._escapeHtml(step.value || step.url)}`;
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

      // Small delay to allow GC
      if (chunkEnd < totalSteps) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    html += `</ol>`;

    if (automatedScreenshots.length > 0) {
      html += `
  <div class='automated-screenshots'>
    <h2>📷 Automated Screenshots</h2>`;

      for (let i = 0; i < automatedScreenshots.length; i++) {
        const screenshot = automatedScreenshots[i];
        const screenshotData = screenshotMap.get(screenshot.id);
        if (screenshotData && screenshotData.dataUrl) {
          html += `
    <div class='auto-screenshot'>
      <p><b>Auto Screenshot ${i + 1}</b> - ${new Date(screenshot.timestamp).toLocaleTimeString()}</p>
      <img src="${screenshotData.dataUrl}" width="${screenshotData.width}" height="${screenshotData.height}" alt="Automated Screenshot ${i + 1}"/>
    </div>`;
        }
      }

      html += `</div>`;
    }

    html += `
</body>
</html>`;

    screenshotMap.clear();

    notify({ percent: 90, status: 'Finalizing DOCX content...' });

    const sessionName = (session.name || 'Untitled_Session').replace(/[^a-z0-9]/gi, '_');
    const filename = `${sessionName}_${Date.now()}.doc`;

    notify({ percent: 95, status: 'DOCX generated' });

    return {
      content: html,
      filename,
      mimeType: 'application/msword'
    };
  }

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