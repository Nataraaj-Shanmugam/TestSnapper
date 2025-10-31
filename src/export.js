/**
 * Export Module - Handles exporting sessions to various formats
 */

export class Exporter {
  constructor() {
    this.formats = ['json', 'csv', 'markdown'];
  }

  /**
   * Export session to JSON
   */
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

  /**
   * Export session to CSV
   */
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

  /**
   * Export session to Markdown
   */
  toMarkdown(session, steps) {
    let content = `# Test Recording Session\n\n`;
    content += `**Session ID:** ${session.sessionId}\n`;
    content += `**Created:** ${new Date(session.createdAt).toLocaleString()}\n`;
    content += `**URL:** ${session.env.url}\n`;
    content += `**Page Title:** ${session.env.title}\n`;
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

  /**
   * Export session in specified format
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
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  async exportPdf(session, steps) {
  const filename = `${session.name || 'Session'}.pdf`;
  const docContent = `
    <h2>${session.name || 'Test Session'}</h2>
    <p><strong>Date:</strong> ${new Date(session.createdAt).toLocaleString()}</p>
    <ol>
      ${steps.map(step => `<li>${step.customDescription || step.action || ''}</li>`).join('')}
    </ol>
  `;

  // Dynamically import html2pdf (no external URL — for Chrome extension CSP)
  const script = document.createElement('script');
  script.src = chrome.runtime.getURL('libs/html2pdf.bundle.min.js');
  document.head.appendChild(script);

  await new Promise(res => (script.onload = res));

  const element = document.createElement('div');
  element.innerHTML = docContent;
  document.body.appendChild(element);

  const opt = {
    margin: 0.5,
    filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2 },
    jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
  };

  await html2pdf().from(element).set(opt).save();
  element.remove();
}

}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Exporter };
}