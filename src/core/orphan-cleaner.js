/**
 * Orphan Cleaner – Asset cleanup utility
 *
 * Manages detection and removal of orphaned assets that reference
 * non-existent steps or sessions. Runs automatically on a weekly schedule.
 */

const CLEANUP_INTERVAL_DAYS = 7;

export class OrphanCleaner {
  /**
   * Initialize orphan cleaner with storage reference
   * @param {StorageManager} storage - StorageManager instance for data access
   */
  constructor(storage) {
    this.storage = storage;
  }

  /**
   * Find assets that reference non-existent steps or sessions
   * @returns {Promise<Array>} Array of orphaned asset objects
   */
  async findOrphanedAssets() {
    const sessions = await this.storage._readSessions();
    const orphaned = [];

    for (const session of sessions) {
      const steps = await this.storage._readSteps(session.sessionId);
      const assets = await this.storage._readAssets(session.sessionId);
      const stepIds = new Set(steps.map(s => s.id));

      for (const asset of assets) {
        if (!stepIds.has(asset.stepId)) {
          orphaned.push(asset);
        }
      }
    }

    return orphaned;
  }

  /**
   * Remove orphaned assets and update metadata
   * @returns {Promise<number>} Total number of assets removed
   */
  async cleanupOrphans() {
    const sessions = await this.storage._readSessions();
    let totalRemoved = 0;

    for (const session of sessions) {
      const steps = await this.storage._readSteps(session.sessionId);
      const assets = await this.storage._readAssets(session.sessionId);
      const stepIds = new Set(steps.map(s => s.id));

      const beforeCount = assets.length;
      const cleaned = assets.filter(a => stepIds.has(a.stepId));
      const removed = beforeCount - cleaned.length;

      if (removed > 0) {
        await this.storage._writeAssets(session.sessionId, cleaned);
        totalRemoved += removed;
      }
    }

    // Update last cleanup time in metadata
    const meta = await this.storage._readMeta();
    meta.lastCleanup = Date.now();
    await this.storage._writeMeta(meta);

    console.log(`🧹 Cleaned up ${totalRemoved} orphaned assets`);
    return totalRemoved;
  }

  /**
   * Check if cleanup is needed (runs once per week)
   * @returns {Promise<void>}
   */
  async autoCleanupCheck() {
    const meta = await this.storage._readMeta();
    const daysSinceCleanup = (Date.now() - (meta.lastCleanup || 0)) / (1000 * 60 * 60 * 24);

    if (daysSinceCleanup >= CLEANUP_INTERVAL_DAYS) {
      console.log('🧹 Running automatic cleanup...');
      await this.cleanupOrphans();
    }
  }
}

export const CLEANUP_INTERVAL_DAYS_CONST = CLEANUP_INTERVAL_DAYS;
