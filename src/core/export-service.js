/**
 * Export Service - Refactored DOCX Screenshot Handling
 */

export class ExportService {
  constructor(storage) {
    this.storage = storage;
    console.log('✅ ExportService initialized');
  }

  /**
   * Main export orchestrator
   */
  async exportSession(sessionId, format) {
    console.log('📄 Starting export:', format, 'for session:', sessionId);

    const session = await this.storage.getSession(sessionId);
    let steps = await this.storage.getSteps(sessionId);
    steps.sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

    const exportData = {
      session: this._formatSessionData(session, steps.length),
      steps: steps
    };

    switch (format.toLowerCase()) {
      case 'json':
        return this._exportJSON(exportData, sessionId);
      case 'csv':
        return this._exportCSV(exportData, sessionId);
      case 'docx':
        return await this._exportDOCX(exportData, sessionId);
      case 'pdf':
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

  /**
   * ✅ Convert blob to data URL (works in service worker)
   */
  async _blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * ✅ Compress image using canvas (if available)
   * Falls back to direct conversion in service worker
   */
  /**
 * ✅ Universal image compressor — works in both browser & service worker.
 * Produces small JPEGs (~50–100 KB) with visible clarity.
 */
  async _compressImage(blob, maxWidth = 150, quality = 0.4) {
    try {
      // Use OffscreenCanvas if available (works in service worker)
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
        return compressed;
      } else {
        // DOM fallback for popup or background pages
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
                (compressedBlob) => resolve(compressedBlob || blob),
                'image/jpeg',
                quality
              );
            } catch (err) {
              console.warn('Canvas compression failed:', err);
              resolve(blob);
            }
          };
          img.onerror = () => resolve(blob);
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

  async _exportDOCX(exportData, sessionId) {
  const { session, steps } = exportData;

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
      width: 500px !important; 
      max-width: 500px !important; 
      height: auto !important; 
      margin-top: 10px; 
      border: 1px solid #ddd; 
      display: block; 
    }
    .automated-screenshots { margin-top: 30px; padding-top: 20px; border-top: 2px solid #3498db; }
    .auto-screenshot { margin: 20px 0; text-align: center; }
    .auto-screenshot img { 
      width: 500px !important; 
      max-width: 500px !important; 
      height: auto !important; 
      margin: 10px auto; 
      border: 1px solid #ddd; 
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

  // ✅ Load and process screenshots with error handling
  const screenshotAssets = await this.storage.getAllAssets(session.id);
  const screenshotMap = new Map();

  for (const asset of screenshotAssets) {
    if (asset.blob) {
      try {
        // CRITICAL: Compress to EXACTLY 500px width to match CSS
        // Quality 0.85 gives good clarity while keeping file size reasonable
        const compressed = await this._compressImage(asset.blob, 500, 0.85);
        const dataUrl = await this._blobToDataURL(compressed);
        screenshotMap.set(asset.stepId, dataUrl);
      } catch (err) {
        console.warn(`Failed to process screenshot for step ${asset.stepId}:`, err);
      }
    }
  }

  // ✅ Separate manual and automated screenshots
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

  // ✅ Start ordered list
  html += `<ol>`;

  // ✅ Render regular steps as simple list items
  for (const step of regularSteps) {
    let oneliner;

    if (step.action === 'screenshot') {
      // Manual screenshot step
      oneliner = '📸 Manual screenshot captured';
      html += `<li>${oneliner}`;

      const screenshotData = screenshotMap.get(step.id);
      if (screenshotData) {
        html += `<br><img src="${screenshotData}" class="screenshot-img" width="500" height="auto" alt="Manual Screenshot"/>`;
      }

      html += `</li>`;
    } else {
      // Regular action step - use custom description if available, otherwise auto-generate
      if (step.description) {
        // Use custom description if set
        oneliner = this._escapeHtml(step.description);
      } else {
        // Auto-generate from fields
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

  // ✅ Close ordered list
  html += `</ol>`;

  // ✅ Render automated screenshots section
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
      <img src="${screenshotData}" width="500" height="auto" alt="Automated Screenshot ${i + 1}"/>
    </div>`;
      }
    }

    html += `</div>`;
  }

  html += `
</body>
</html>`;

  const sessionName = (session.name || 'Untitled_Session').replace(/[^a-z0-9]/gi, '_');
  const filename = `${sessionName}_${Date.now()}.doc`;

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