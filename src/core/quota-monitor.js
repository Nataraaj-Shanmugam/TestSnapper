/**
 * QuotaMonitor - Self-imposed storage budget monitoring
 *
 * PERF-014+FUNC-018: With unlimitedStorage removed from manifest.json,
 * chrome.storage.local has a practical default quota (~10 MB in older Chrome,
 * up to the profile disk space in modern Chrome with storage).
 * We enforce a configurable self-imposed cap (default 500 MB) so warnings
 * remain meaningful, and cache the permission check once per instance init.
 */
export class QuotaMonitor {
  /**
   * @param {number} maxBytes  Self-imposed byte budget (default 500 MB)
   */
  constructor(maxBytes = 500 * 1024 * 1024) {
    this.maxBytes = maxBytes;
    this._hasUnlimitedStorage = null; // cached after first check
    this.WARN_THRESHOLD  = 0.80; // 80% warn
    this.CRIT_THRESHOLD  = 0.95; // 95% critical
  }

  /**
   * Check chrome.permissions for unlimitedStorage once per instance lifetime.
   * @returns {Promise<boolean>}
   */
  async _checkUnlimited() {
    if (this._hasUnlimitedStorage !== null) {
      return this._hasUnlimitedStorage;
    }
    try {
      this._hasUnlimitedStorage = await new Promise((resolve) =>
        chrome.permissions.contains({ permissions: ['unlimitedStorage'] }, resolve)
      );
    } catch {
      this._hasUnlimitedStorage = false;
    }
    return this._hasUnlimitedStorage;
  }

  /**
   * Get current storage usage against the self-imposed budget.
   * @returns {Promise<{used: number, total: number, percentage: number, warning: boolean, error: boolean}>}
   */
  async getStorageUsage() {
    try {
      const bytesInUse = await new Promise((resolve, reject) =>
        chrome.storage.local.getBytesInUse(null, (bytes) => {
          if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
          resolve(bytes);
        })
      );

      const total      = this.maxBytes;
      const used       = bytesInUse;
      const percentage = used / total;

      return {
        used,
        total,
        percentage,
        warning: percentage >= this.WARN_THRESHOLD && percentage < this.CRIT_THRESHOLD,
        error:   percentage >= this.CRIT_THRESHOLD,
      };
    } catch (err) {
      console.error('[QuotaMonitor] Failed to get storage usage:', err);
      return { used: 0, total: this.maxBytes, percentage: 0, warning: false, error: false };
    }
  }

  /**
   * Check quota and send a warning notification if thresholds are exceeded.
   * @returns {Promise<void>}
   */
  async checkAndNotify() {
    const usage = await this.getStorageUsage();

    if (usage.error) {
      console.warn(`[QuotaMonitor] CRITICAL: ${(usage.percentage * 100).toFixed(1)}% of budget used.`);
      // Broadcast to any open popup/review pages
      try {
        chrome.runtime.sendMessage({
          action: 'storageQuotaWarning',
          level: 'critical',
          usage,
        });
      } catch { /* no listeners */ }
    } else if (usage.warning) {
      console.warn(`[QuotaMonitor] WARNING: ${(usage.percentage * 100).toFixed(1)}% of budget used.`);
      try {
        chrome.runtime.sendMessage({
          action: 'storageQuotaWarning',
          level: 'warning',
          usage,
        });
      } catch { /* no listeners */ }
    }
  }
}
