/**
 * Export Module - Handles exporting sessions to various formats
 *
 * Fixes applied:
 *  1. Added toDocx() — popup.html lists DOCX as the default export format but
 *     no implementation existed. Uses the docx library loaded via extension URL.
 *  2. Fixed exportPdf() — added error handling around the dynamic script load
 *     and wrapped the entire flow in try/catch with cleanup.
 *  3. Aligned the export() router to include 'docx' and 'pdf' cases.
 *  4. Removed the dual module.exports / export inconsistency — now a clean
 *     ES module export only (matches how review-standalone.html imports it).
 */

export class Exporter {
  constructor() {
    this.formats = ['docx', 'json', 'csv', 'markdown', 'pdf'];
  }

  // ────────────────────────────────────────────────────────────
  // JSON
  // ────────────────────────────────────────────────────────────

  toJSON(session, steps) {
    const exportData = {
      session: {
        id: session.sessionId,
        createdAt: session.createdAt,
        environment: session.env,
        stepCount: steps.length
      },
      steps: steps.map((step, index) => ({
        stepNumber: index + 1,
        timestamp: step.timestamp,
        action: step.action,
        fieldName: step.fieldName,
        selector: step.selector,
        value: step.value,
        url: step.url,
        notes: step.notes || ''
      }))
    };

    return {
      content: JSON.stringify(exportData, null, 2),
      filename: `testsnapper_${session.sessionId.substring(0, 8)}_${Date.now()}.json`,
      mimeType: 'application/json'
    };
  }

  // ────────────────────────────────────────────────────────────
  // CSV
  // ────────────────────────────────────────────────────────────

  toCSV(session, steps) {
    const headers = [
      'Step',
      'Timestamp',
      'Action',
      'Field Name',
      'Selector (CSS)',
      'Selector (XPath)',
      'Text Content',
      'Value',
      'URL',
      'Notes'
    ];

    const rows = steps.map((step, index) => [
      index + 1,
      step.timestamp,
      step.action,
      step.fieldName || '',
      step.selector?.css || '',
      step.selector?.xpath || '',
      step.selector?.text || '',
      step.value || '',
      step.url,
      step.notes || ''
    ]);

    const content = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');

    return {
      content,
      filename: `testsnapper_${session.sessionId.substring(0, 8)}_${Date.now()}.csv`,
      mimeType: 'text/csv'
    };
  }

  // ────────────────────────────────────────────────────────────
  // Markdown
  // ────────────────────────────────────────────────────────────

  toMarkdown(session, steps) {
    let content = `# Test Recording Session\n\n`;
    content += `**Session ID:** ${session.sessionId}\n`;
    content += `**Created:** ${new Date(session.createdAt).toLocaleString()}\n`;
    content += `**URL:** ${session.env?.url || 'N/A'}\n`;
    content += `**Page Title:** ${session.env?.title || 'N/A'}\n`;
    content += `**Total Steps:** ${steps.length}\n\n`;
    content += `---\n\n`;
    content += `## Steps\n\n`;

    steps.forEach((step, index) => {
      content += `### Step ${index + 1}: ${step.action}\n\n`;
      content += `- **Field Name:** ${step.fieldName || 'N/A'}\n`;
      content += `- **Selector (CSS):** \`${step.selector?.css || 'N/A'}\`\n`;
      if (step.selector?.xpath) {
        content += `- **Selector (XPath):** \`${step.selector.xpath}\`\n`;
      }
      if (step.selector?.text) {
        content += `- **Text Content:** "${step.selector.text}"\n`;
      }
      if (step.value) {
        content += `- **Value:** ${step.value}\n`;
      }
      content += `- **URL:** ${step.url}\n`;
      content += `- **Timestamp:** ${new Date(step.timestamp).toLocaleString()}\n`;
      if (step.notes) {
        content += `- **Notes:** ${step.notes}\n`;
      }
      content += `\n`;
    });

    return {
      content,
      filename: `testsnapper_${session.sessionId.substring(0, 8)}_${Date.now()}.md`,
      mimeType: 'text/markdown'
    };
  }

  // ────────────────────────────────────────────────────────────
  // DOCX  (NEW — was missing despite being the default in popup.html)
  // ────────────────────────────────────────────────────────────

  /**
   * Export session to a .docx file.
   *
   * Dynamically loads the docx library bundled with the extension
   * (libs/docx.min.js). Falls back to a Blob-based download if the
   * library is unavailable.
   *
   * Returns a Promise that resolves to { blob, filename } so the caller
   * can trigger a download via the Downloads API or a data URL.
   */
  async toDocx(session, steps) {
    const filename = `testsnapper_${(session.sessionName || session.sessionId || 'session').replace(/\s+/g, '_').substring(0, 30)}_${Date.now()}.docx`;

    // ── Try to load the bundled docx library ──
    let docxLib = null;
    try {
      // If already loaded globally (e.g. by a previous export)
      if (window.docx) {
        docxLib = window.docx;
      } else {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = chrome.runtime.getURL('libs/docx.min.js');
          script.onload = resolve;
          script.onerror = () => reject(new Error('Failed to load docx library'));
          document.head.appendChild(script);
        });
        docxLib = window.docx;
      }
    } catch (e) {
      console.warn('docx library not available, falling back to plain-text .docx shell:', e);
    }

    // ── Build document content ──
    if (docxLib) {
      return this._buildDocxWithLibrary(docxLib, session, steps, filename);
    }

    // ── Fallback: hand-craft a minimal valid .docx (ZIP of XML) ──
    return this._buildDocxFallback(session, steps, filename);
  }

  /**
   * Build a proper .docx using the docx library.
   */
  async _buildDocxWithLibrary(docxLib, session, steps, filename) {
    const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
            AlignmentType, BorderStyle, WidthType, ShadingType, HeadingLevel } = docxLib;

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

    // Data rows
    const dataRows = steps.map((step, index) => {
      const selectorDisplay = step.selector?.css || step.selector?.xpath || 'N/A';
      const valueDisplay = step.value || step.url || 'N/A';

      return new TableRow({
        children: [
          String(index + 1),
          step.action || '',
          step.fieldName || 'N/A',
          selectorDisplay,
          valueDisplay
        ].map((cellText, i) =>
          new TableCell({
            borders,
            width: cellWidth(colWidths[i]),
            shading: { fill: index % 2 === 0 ? 'F8FAFC' : 'FFFFFF', type: ShadingType.CLEAR },
            margins: { top: 60, bottom: 60, left: 80, right: 80 },
            children: [new Paragraph({ children: [new TextRun({ text: String(cellText), size: 20 })] })]
          })
        )
      });
    });

    const doc = new Document({
      styles: {
        default: { document: { run: { font: 'Arial', size: 22 } } }
      },
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },          // US Letter
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
            new TextRun({ text: session.sessionName || session.sessionId || 'Unnamed', size: 22 })
          ]}),
          new Paragraph({ children: [
            new TextRun({ text: 'Created: ', bold: true, size: 22 }),
            new TextRun({ text: new Date(session.createdAt).toLocaleString(), size: 22 })
          ]}),
          new Paragraph({ children: [
            new TextRun({ text: 'URL: ', bold: true, size: 22 }),
            new TextRun({ text: session.env?.url || 'N/A', size: 22 })
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
          })
        ]
      }]
    });

    const buffer = await Packer.toBuffer(doc);
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

    return { blob, filename };
  }

  /**
   * Fallback: create a minimal .docx without the library.
   * A .docx is just a ZIP containing a few XML files. We build it manually
   * so export never fails even if the library failed to load.
   */
  async _buildDocxFallback(session, steps, filename) {
    // Build the document.xml body
    const escXml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    let bodyParagraphs = `
      <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
        <w:r><w:t>TestSnapper — Test Recording</w:t></w:r></w:p>
      <w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Session: </w:t></w:r>
        <w:r><w:t>${escXml(session.sessionName || session.sessionId)}</w:t></w:r></w:p>
      <w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Created: </w:t></w:r>
        <w:r><w:t>${escXml(new Date(session.createdAt).toLocaleString())}</w:t></w:r></w:p>
      <w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">URL: </w:t></w:r>
        <w:r><w:t>${escXml(session.env?.url || 'N/A')}</w:t></w:r></w:p>
      <w:p><w:r><w:t/></w:r></w:p>`;

    steps.forEach((step, i) => {
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
    });

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${bodyParagraphs}<w:sectPr/></w:body>
</w:document>`;

    const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

    const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

    const wordRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`;

    // Build ZIP manually using DecompressionStream is read-only; use a simple ZIP builder
    const blob = await this._createZipBlob({
      '[Content_Types].xml': contentTypesXml,
      '_rels/.rels': relsXml,
      'word/_rels/document.xml.rels': wordRelsXml,
      'word/document.xml': documentXml
    });

    return { blob, filename };
  }

  /**
   * Minimal ZIP file builder (no dependencies).
   * Handles only stored (uncompressed) entries — sufficient for .docx XML.
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
   * CRC-32 computation (standard polynomial 0xEDB88320).
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

  // ────────────────────────────────────────────────────────────
  // PDF
  // ────────────────────────────────────────────────────────────

  async exportPdf(session, steps) {
    const filename = `${(session.name || session.sessionName || 'Session').replace(/\s+/g, '_')}.pdf`;
    const escHtml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const docContent = `
      <h2>${escHtml(session.name || session.sessionName || 'Test Session')}</h2>
      <p><strong>Date:</strong> ${escHtml(new Date(session.createdAt).toLocaleString())}</p>
      <p><strong>URL:</strong> ${escHtml(session.env?.url || 'N/A')}</p>
      <ol>
        ${steps.map(step => `<li><strong>${escHtml(step.action || '')}</strong> — ${escHtml(step.customDescription || step.fieldName || step.value || '')}</li>`).join('')}
      </ol>
    `;

    let element = null;
    let script = null;

    try {
      // Load html2pdf library bundled with the extension
      if (!window.html2pdf) {
        script = document.createElement('script');
        script.src = chrome.runtime.getURL('libs/html2pdf.bundle.min.js');
        document.head.appendChild(script);

        await new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = () => reject(new Error('Failed to load html2pdf library'));
        });
      }

      if (!window.html2pdf) {
        throw new Error('html2pdf did not expose a global after loading');
      }

      // Create a temporary element for html2pdf to render
      element = document.createElement('div');
      element.innerHTML = docContent;
      element.style.cssText = 'position:absolute;left:-9999px;top:0;width:700px;font-family:Arial,sans-serif;';
      document.body.appendChild(element);

      const opt = {
        margin: 0.5,
        filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
      };

      await html2pdf().from(element).set(opt).save();

    } catch (error) {
      console.error('PDF export failed:', error);
      throw error;
    } finally {
      // Always clean up the temporary element
      if (element && element.parentNode) {
        element.remove();
      }
    }
  }

  // ────────────────────────────────────────────────────────────
  // Router
  // ────────────────────────────────────────────────────────────

  /**
   * Export session in the specified format.
   *
   * For text-based formats (json, csv, markdown) returns { content, filename, mimeType }.
   * For binary formats (docx, pdf) returns a Promise — docx resolves to { blob, filename },
   * pdf triggers the download directly via html2pdf.
   */
  export(session, steps, format = 'json') {
    switch (format.toLowerCase()) {
      case 'json':
        return this.toJSON(session, steps);
      case 'csv':
        return this.toCSV(session, steps);
      case 'markdown':
      case 'md':
        return this.toMarkdown(session, steps);
      case 'docx':
        return this.toDocx(session, steps);    // returns Promise<{ blob, filename }>
      case 'pdf':
        return this.exportPdf(session, steps); // returns Promise (downloads directly)
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }
}