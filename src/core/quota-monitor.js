/**
 * QuotaMonitor – Storage quota monitoring subsystem.
 *
 * Extracted from StorageManager (BUG-004 / MED-002 architecture refactor).
 * Provides quota usage reporting, threshold-based warnings, and a listener
 * pattern so callers can react to low-storage conditions without polling.
 */

export const QUOTA_WARNING_THRESHOLD = 0.80; // 80%
export const QUOTA_ERROR_THRESHOLD = 0.95;   // 95%

export class QuotaMonitor {
  constructor() {
    this.quotaListeners = new Set();
  }

  /**
   * Get current storage usage.
   * Returns { used, total, percentage, warning, error }
   */
  async getStorageUsage() {
    try {
      const bytesInUse = await chrome.storage.local.getBytesInUse();

      let hasUnlimited = false;
      let QUOTA_BYTES = 10485760; // 10MB default (no unlimitedStorage)
      try {
        hasUnlimited = await chrome.permissions.contains({ permissions: ['unlimitedStorage'] });
        if (!hasUnlimited) {
          QUOTA_BYTES = chrome.storage.local.QUOTA_BYTES || 10485760;
        }
      } catch (err) {
        QUOTA_BYTES = chrome.storage.local.QUOTA_BYTES || 10485760;
      }

      if (hasUnlimited) {
        return {
          used: bytesInUse,
          total: Infinity,
          percentage: 0,
          warning: false,
          error: false
        };
      }

      const percentage = bytesInUse / QUOTA_BYTES;

      return {
        used: bytesInUse,
        total: QUOTA_BYTES,
        percentage: percentage,
        warning: percentage >= QUOTA_WARNING_THRESHOLD,
        error: percentage >= QUOTA_ERROR_THRESHOLD
      };
    } catch (error) {
      console.error('Failed to get storage usage:', error);
      return { used: 0, total: 0, percentage: 0, warning: false, error: false };
    }
  }

  /**
   * Check quota before a write operation.
   * Throws if quota is critically exceeded; warns (and notifies listeners) if
   * usage is above the warning threshold.
   */
  async checkQuota() {
    const usage = await this.getStorageUsage();

    if (usage.error) {
      throw new Error(`Storage quota critically low (${(usage.percentage * 100).toFixed(1)}%). Delete old sessions or enable cleanup.`);
    }

    if (usage.warning) {
      console.warn(`⚠️ Storage quota warning: ${(usage.percentage * 100).toFixed(1)}% used`);
      this._notifyQuotaWarning(usage);
    }

    return usage;
  }

  /**
   * Notify all registered quota warning listeners.
   */
  _notifyQuotaWarning(usage) {
    this.quotaListeners.forEach(listener => {
      try {
        listener(usage);
      } catch (error) {
        console.error('Quota listener error:', error);
      }
    });
  }

  /**
   * Add a quota warning listener.
   */
  onQuotaWarning(listener) {
    this.quotaListeners.add(listener);
  }

  /**
   * Remove a quota warning listener.
   */
  offQuotaWarning(listener) {
    this.quotaListeners.delete(listener);
  }
}
