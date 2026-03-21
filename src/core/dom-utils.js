/**
 * DOM-dependent utilities — safe to import only from window (UI) contexts.
 * Do NOT import in background.js (service worker) — document/DOM are unavailable there.
 *
 * Pure / universal helpers live in utils.js.
 */

export const DomUtils = {
  /**
   * Download a text-based file in the browser by creating a temporary anchor element.
   */
  downloadFile(content, filename, mimeType) {
    const base64Content = btoa(unescape(encodeURIComponent(content)));
    const dataUrl = `data:${mimeType};base64,${base64Content}`;

    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },

  /**
   * Show a toast/status message in a DOM element.
   * @param {HTMLElement} messageDiv - the element to render the message into
   */
  showMessage(messageDiv, text, type = 'info', duration = 3000) {
    messageDiv.textContent = text;
    messageDiv.className = `message ${type}`;
    messageDiv.style.display = 'block';

    if (duration > 0 && (type === 'success' || type === 'error')) {
      setTimeout(() => {
        messageDiv.style.display = 'none';
      }, duration);
    }
  }
};
