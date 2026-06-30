/**
 * QuotaMonitor - Self-imposed storage budget monitoring
 *
 * With unlimitedStorage removed from manifest.json, chrome.storage.local has a
 * practical default quota (~10 MB in older Chrome, up to the profile disk space
 * in modern Chrome with storage). We enforce a configurable self-imposed cap
 * (default 500 MB) so warnings remain meaningful, and cache the permission
 * check once per instance init.
 */
import { Logger } from './logger.js';

export class QuotaMonitor {
  /**
   * @param {number} maxBytes  Self-imposed byte budget (default 500 MB)
   */
  constructor(maxBytes = 500 * 1024 * 1024) {
    this.maxBytes = maxBytes;
    this._hasUnlimitedStorage = null; // cached after first check
    this.WARN_THRESHOLD  = 0.80; // 80% warn
    this.CRIT_THRESHOLD  = 0.95; // 95% critical
    this._listeners = []; // quota-warning listeners (registered via onQuotaWarning)
  }

  /**
   * Register a listener invoked with the usage object when a quota
   * warning/critical threshold is crossed (via checkQuota).
   * @param {(usage: Object) => void} listener
   */
  onQuotaWarning(listener) {
    if (typeof listener === 'function') this._listeners.push(listener);
  }

  /**
   * Remove a previously-registered quota-warning listener.
   * @param {Function} listener
   */
  offQuotaWarning(listener) {
    this._listeners = this._listeners.filter((l) => l !== listener);
  }

  /**
   * Notify all registered listeners of a quota warning. Listener errors are
   * isolated so one bad listener can't break the rest.
   * @param {Object} usage
   */
  _notifyQuotaWarning(usage) {
    for (const listener of this._listeners) {
      try {
        listener(usage);
      } catch (err) {
        Logger.error('[QuotaMonitor] quota-warning listener threw:', err);
      }
    }
  }

  /**
   * Pre-write quota gate. Notifies listeners on warning/critical and throws a
   * non-retryable error when the critical threshold is exceeded so callers can
   * abort the write instead of silently corrupting storage.
   * @returns {Promise<Object>} the usage object when under the critical threshold
   * @throws {Error} (name: 'StorageQuotaExceeded') when usage is critical
   */
  async checkQuota() {
    const usage = await this.getStorageUsage();
    if (usage.warning || usage.error) {
      this._notifyQuotaWarning(usage);
    }
    if (usage.error) {
      const err = new Error(
        `Storage quota critically exceeded (${(usage.percentage * 100).toFixed(1)}% of budget). ` +
        'Delete old sessions or enable a File System storage folder.'
      );
      err.name = 'StorageQuotaExceeded'; // matches storage.js NON_RETRYABLE list
      throw err;
    }
    return usage;
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
      Logger.error('[QuotaMonitor] Failed to get storage usage:', err);
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
      Logger.warn(`[QuotaMonitor] CRITICAL: ${(usage.percentage * 100).toFixed(1)}% of budget used.`);
      // Broadcast to any open popup/review pages
      try {
        chrome.runtime.sendMessage({
          action: 'storageQuotaWarning',
          level: 'critical',
          usage,
        });
      } catch { /* no listeners */ }
    } else if (usage.warning) {
      Logger.warn(`[QuotaMonitor] WARNING: ${(usage.percentage * 100).toFixed(1)}% of budget used.`);
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
