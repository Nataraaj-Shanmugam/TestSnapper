/**
 * Shared Utilities
 * Common functions used across the extension
 */

export const Utils = {
  /**
   * Generate RFC4122 compliant UUID v4
   */
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  },

  /**
   * Escape HTML special characters
   */
  escapeHtml(text) {
    if (!text) return '';
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
  },

  /**
   * Convert Blob to Base64 Data URL
   */
  blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  },

  /**
   * Convert Data URL to Blob
   */
  dataURLtoBlob(dataURL) {
    try {
      const parts = dataURL.split(',');
      const mime = parts[0].match(/:(.*?);/)[1];
      const bstr = atob(parts[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      return new Blob([u8arr], { type: mime });
    } catch (error) {
      console.error('Failed to convert dataURL to Blob:', error);
      throw error;
    }
  },

  /**
   * Download file in browser
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
   * Show toast message (for use in HTML pages)
   * UX-015: auto-dismiss all types; clear any stale timer to prevent race conditions
   */
  showMessage(messageDiv, text, type = 'info', duration = 0) {
    // Clear any previous auto-dismiss timer stored on the element
    if (messageDiv._msgTimer) {
      clearTimeout(messageDiv._msgTimer);
      messageDiv._msgTimer = null;
    }

    messageDiv.textContent = text;
    messageDiv.className = `message ${type}`;
    messageDiv.style.display = 'block';

    // Default durations per type if not specified
    const effectiveDuration = duration > 0 ? duration :
      (type === 'success' ? 4000 :
       type === 'error'   ? 6000 :
       type === 'warning' ? 8000 :
       type === 'info'    ? 5000 : 3000);

    messageDiv._msgTimer = setTimeout(() => {
      messageDiv.style.display = 'none';
      messageDiv._msgTimer = null;
    }, effectiveDuration);
  },

  /**
   * Debounce function execution
   */
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  /**
   * Format timestamp for display
   */
  formatTimestamp(timestamp) {
    return new Date(timestamp).toLocaleString();
  },

  /**
   * Truncate text with ellipsis
   */
  truncate(text, maxLength = 50) {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  },

  /**
   * Generate a human-readable description for a recorded step.
   */
  generateStepDescription(step) {
    const { action, fieldName, value, isManual } = step;
    const field = (fieldName || '').trim();
    const val = (value || '').trim();
    switch (action) {
      case 'type':
        if (val && field) return `Entered "${val}" in ${field} field`;
        if (val) return `Entered "${val}"`;
        if (field) return `Typed in ${field} field`;
        return 'Typed in field';
      case 'click':
        return field ? `Clicked on ${field}` : 'Clicked on element';
      case 'select':
        if (val && field) return `Selected "${val}" from ${field} dropdown`;
        if (val) return `Selected "${val}"`;
        return field ? `Selected from ${field} dropdown` : 'Selected option';
      case 'check':
        return `Checked the ${field} checkbox`;
      case 'uncheck':
        return `Unchecked the ${field} checkbox`;
      case 'submit':
        return `Submitted the ${field} form`;
      case 'navigate':
        return val ? `Navigated to ${val}` : 'Navigated to page';
      case 'screenshot':
        return isManual ? 'Manual screenshot taken' : 'Auto screenshot captured';
      default:
        return field ? `${action} on ${field}` : action;
    }
  }
};

// FUNC-021: window.TestSnapperUtils assignment removed — never read by any module