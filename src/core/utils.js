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
  }
};

// For non-module scripts (like content.js)
if (typeof window !== 'undefined') {
  window.TestSnapperUtils = Utils;
}