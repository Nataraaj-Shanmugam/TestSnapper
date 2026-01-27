/**
 * Export Service
 */

export class ExportService {
  constructor(storage) {
    this.storage = storage;
    console.log('✅ ExportService initialized');
  }

  /**
   * Main export orchestrator
   * (UPDATED: now accepts optional progressCallback)
   */
  async exportSession(sessionId, format, progressCallback) {
    const notify =
      typeof progressCallback === 'function' ? progressCallback : () => { };

    console.log('📄 Starting export:', format, 'for session:', sessionId);

    // Progress: loading session
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
          // Pass progress callback into DOCX exporter
          return await this._exportDOCX(exportData, sessionId, notify);

        case 'pdf':
          notify({ percent: 90, status: 'Preparing PDF export...' });
          return await this._exportPDF(exportData, sessionId);

        default:
          throw new Error(`Unsupported format: ${format}`);
      }
    } finally {
      // // 🔧 FIX #5: Force garbage collection hint
      // if (global.gc) global.gc();
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
        reader.abort(); // Explicit cleanup
        resolve(result);
      };
      reader.onerror = () => {
        reader.abort();
        reject(reader.error);
      };
      reader.readAsDataURL(blob);
    });
  }

  async _compressImage(blob, maxWidth = 1600, quality = 0.9) {
    try {
      const useOffscreen = typeof OffscreenCanvas !== 'undefined';

      if (useOffscreen) {
        const imageBitmap = await createImageBitmap(blob);
        const scale = Math.min(maxWidth / imageBitmap.width, 1);
        const width = Math.floor(imageBitmap.width * scale);
        const height = Math.floor(imageBitmap.height * scale);

        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d', { alpha: false });
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
              ctx.drawImage(img, 0, 0, width, height);

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

    const screenshotAssets = await this.storage.getAllAssets(session.id);
    const screenshotMap = new Map();
    const BATCH_SIZE = 5;
    const totalScreens = screenshotAssets.length || 1; // avoid divide-by-zero

    let processed = 0;

    for (let i = 0; i < screenshotAssets.length; i += BATCH_SIZE) {
      const batch = screenshotAssets.slice(i, i + BATCH_SIZE);

      await Promise.all(batch.map(async (asset) => {
        if (asset.blob) {
          try {
            const compressed = await this._compressImage(asset.blob, 1200, 0.9);
            const dataUrl = await this._blobToDataURL(compressed);
            screenshotMap.set(asset.stepId, dataUrl);
          } catch (err) {
            console.warn(`Failed to process screenshot for step ${asset.stepId}:`, err);
          }
        }
      }));

      processed += batch.length;

      // Progress: 40–80% during screenshot work
      const pct = 40 + Math.floor((processed / totalScreens) * 40);
      notify({
        percent: Math.min(pct, 80),
        status: `Processing screenshots... (${processed}/${totalScreens})`
      });

      await new Promise(resolve => setTimeout(resolve, 10));
    }

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

    for (const step of regularSteps) {
      let oneliner;

      if (step.action === 'screenshot') {
        oneliner = '📸 Manual screenshot captured';
        html += `<li>${oneliner}`;

        const screenshotData = screenshotMap.get(step.id);
        if (screenshotData) {
          html += `<br><img src="${screenshotData}" class="screenshot-img" alt="Manual Screenshot"/>`;
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
    }

    html += `</ol>`;

    if (automatedScreenshots.length > 0) {
      html += `
  <div class='automated-screenshots'>
    <h2>📷 Automated Screenshots</h2>`;

      for (let i = 0; i < automatedScreenshots.length; i++) {
        const screenshot = automatedScreenshots[i];
        const screenshotData = screenshotMap.get(screenshot.id);
        if (screenshotData) {
          html += `
    <div class='auto-screenshot'>
      <p><b>Auto Screenshot ${i + 1}</b> - ${new Date(screenshot.timestamp).toLocaleTimeString()}</p>
      <img src="${screenshotData}" class="auto-screenshot img" alt="Automated Screenshot ${i + 1}"/>
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

    let content = `Test Recording Session\n\n`;
    content += `Session: ${session.name}\n`;
    content += `Date: ${new Date(session.createdAt).toLocaleString()}\n`;
    content += `URL: ${session.environment?.url || 'N/A'}\n`;
    content += `Total Steps: ${session.stepCount}\n\n`;
    content += `${'='.repeat(60)}\n\n`;
    content += `Steps:\n\n`;

    let stepNumber = 0;
    steps.forEach((step) => {
      if (step.action !== 'screenshot' || step.isManual) {
        stepNumber++;

        let description;
        if (step.action === 'screenshot') {
          description = '📸 Manual screenshot captured';
        } else {
          description = `${step.action.toUpperCase()}`;
          if (step.fieldName && step.fieldName !== 'N/A') {
            description += ` on "${step.fieldName}"`;
          }
          if (step.value && step.action !== 'navigate') {
            description += ` with value "${step.value}"`;
          }
          if (step.action === 'navigate') {
            description += ` to ${step.value || step.url}`;
          }
        }

        content += `${stepNumber}. ${description}\n`;

        if (step.timestamp) {
          content += `   Time: ${new Date(step.timestamp).toLocaleString()}\n`;
        }

        content += `\n`;
      }
    });

    const sessionName = (session.name || 'Untitled_Session').replace(/[^a-z0-9]/gi, '_');
    const filename = `${sessionName}_${Date.now()}.txt`;

    return {
      content,
      filename,
      mimeType: 'text/plain'
    };
  }
}
