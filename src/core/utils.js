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
   * Generate a natural, human-readable sentence describing a recorded step.
   * Returns plain text — callers are responsible for HTML escaping.
   */
  generateStepDescription(step) {
    const action = (step.action || 'action').toLowerCase();
    const field  = (step.fieldName || '').trim();
    const value  = (step.value || '').trim();

    switch (action) {
      case 'type':
        if (value && field) return `Entered "${value}" in ${field} field`;
        if (value)          return `Entered "${value}"`;
        if (field)          return `Typed in ${field} field`;
        return 'Typed in field';

      case 'click':
        return field ? `Clicked on ${field}` : 'Clicked on element';

      case 'select':
        if (value && field) return `Selected "${value}" from ${field} dropdown`;
        if (value)          return `Selected "${value}" from dropdown`;
        if (field)          return `Selected from ${field} dropdown`;
        return 'Selected from dropdown';

      case 'check':
        return field ? `Checked the ${field} checkbox` : 'Checked checkbox';

      case 'uncheck':
        return field ? `Unchecked the ${field} checkbox` : 'Unchecked checkbox';

      case 'submit':
        return field ? `Submitted the ${field} form` : 'Submitted the form';

      case 'navigate':
        return value ? `Navigated to ${value}` : 'Navigated to page';

      case 'screenshot':
        return step.isManual ? 'Manual screenshot taken' : 'Auto screenshot captured';

      default:
        if (field && value) return `${action} "${value}" on ${field}`;
        if (field)          return `${action} on ${field}`;
        return action;
    }
  }
};

// For non-module scripts (like content.js)
if (typeof window !== 'undefined') {
  window.TestSnapperUtils = Utils;
}