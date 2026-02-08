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

  async _compressImage(blob, maxWidth = 1920, quality = 0.95) {
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
   * 🔧 FIX: EXP-002 - Resize images for exports to reduce file size
   */
  async _resizeImageForExport(dataUrl, maxWidth = 800, maxHeight = 600) {
    // Helper to check if we are in a Service Worker or similar context
    const useOffscreen = typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined';

    if (useOffscreen) {
      try {
        // Service Worker implementation using OffscreenCanvas
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        const bitmap = await createImageBitmap(blob);

        const { width: imgWidth, height: imgHeight } = bitmap;

        // Calculate scale
        const scale = Math.min(
          maxWidth / imgWidth,
          maxHeight / imgHeight,
          1
        );

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

        // Convert back to blob -> dataUrl
        // OffscreenCanvas.convertToBlob is standard
        const resizedBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
        const reader = new FileReader();
        const resizedDataUrl = await new Promise((resolve) => {
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(resizedBlob);
        });

        bitmap.close();
        console.log(`📐 Resized image (Offscreen): ${imgWidth}x${imgHeight} → ${canvasWidth}x${canvasHeight}`);
        return { dataUrl: resizedDataUrl, width: canvasWidth, height: canvasHeight };

      } catch (error) {
        console.error('Offscreen image resize failed:', error);
        // We might not know dimensions if bitmap creation failed, safe fallback
        return { dataUrl, width: 800, height: 600 };
      }
    } else {
      // Standard DOM implementation
      return new Promise((resolve, reject) => {
        const img = new Image();

        img.onload = () => {
          try {
            // Calculate scale to fit within max dimensions
            const scale = Math.min(
              maxWidth / img.width,
              maxHeight / img.height,
              1 // Don't upscale
            );

            if (scale >= 1) {
              // No resize needed
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
            console.log(`📐 Resized image: ${img.width}x${img.height} → ${canvas.width}x${canvas.height}`);

            resolve({ dataUrl: resized, width: canvas.width, height: canvas.height });
          } catch (error) {
            console.error('Image resize failed:', error);
            resolve({ dataUrl: dataUrl, width: 800, height: 600 }); // Fallback with safe defaults
          }
        };

        img.onerror = () => {
          console.error('Failed to load image for resizing');
          resolve({ dataUrl: dataUrl, width: 800, height: 600 }); // Fallback
        };

        img.src = dataUrl;
      });
    }
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
      width: 100% !important; 
      max-width: 6.5in !important; 
      height: auto !important; 
      margin-top: 15px; 
      border: 1px solid #ccc; 
      display: block; 
    }
    .automated-screenshots { margin-top: 40px; padding-top: 20px; border-top: 2px solid #3498db; }
    .auto-screenshot { margin: 30px 0; text-align: center; }
    .auto-screenshot img { 
      width: 100% !important; 
      max-width: 6.5in !important; 
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
        // 🔧 FIX: EXP-002 - Resize before using (reduced from 1600 to 1200 for smaller files)
        const imgObj = await this._resizeImageForExport(url, 1200, 900);
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