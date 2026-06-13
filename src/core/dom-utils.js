/**
 * DOM-dependent utilities
 * Only for use in window (browser page) contexts, not service workers.
 * FUNC-021: downloadFile is kept only if imported elsewhere; showMessage is used by review.
 */

/**
 * Trigger a file download in the browser.
 * @param {string} content   Text content to download
 * @param {string} filename  Download filename
 * @param {string} mimeType  MIME type
 */
export function downloadFile(content, filename, mimeType) {
  const base64Content = btoa(unescape(encodeURIComponent(content)));
  const dataUrl = `data:${mimeType};base64,${base64Content}`;

  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Show a toast notification in a message element.
 * UX-015: clears any previous timer; auto-dismisses all message types.
 * @param {HTMLElement} msgEl    The message container element
 * @param {string}      text     Message text
 * @param {string}      type     'info'|'success'|'error'|'warning'
 * @param {number}      duration Override auto-dismiss ms (0 = use defaults)
 */
export function showMessage(msgEl, text, type = 'info', duration = 0) {
  if (!msgEl) return;
  if (msgEl._msgTimer) {
    clearTimeout(msgEl._msgTimer);
    msgEl._msgTimer = null;
  }

  msgEl.textContent = text;
  msgEl.className = `message ${type}`;
  msgEl.style.display = 'block';

  const ms = duration > 0 ? duration :
    (type === 'success' ? 4000 :
     type === 'error'   ? 6000 :
     type === 'warning' ? 8000 : 5000); // info default 5 s

  msgEl._msgTimer = setTimeout(() => {
    msgEl.style.display = 'none';
    msgEl._msgTimer = null;
  }, ms);
}
