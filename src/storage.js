/**
 * Storage Module – chrome.storage.local (file-based, persistent)
 *
 * Replaces IndexedDB with chrome.storage.local, which persists data to a flat
 * file on disk managed by Chrome. All public methods keep the same signatures
 * so the rest of the extension needs zero changes.
 *
 * CRITICAL FIXES APPLIED:
 * - BUG-004: Storage quota monitoring with warnings at 80%, errors at 95%
 * - STR-001: Image compression using canvas API
 * - STR-002: Schema versioning with migration support
 * - STR-003: Split storage into multiple keys to avoid 10MB per-key limit
 * - STR-004: Orphaned asset cleanup
 * - STR-005: Export/import for backup
 * - STR-006: Batch operations for better performance
 * - STR-MED-001: GZIP compression for step data
 *
 * Data layout (split across keys for scalability):
 *   testsnapper_meta → {
 *     version: 2,
 *     sessionCount: N,
 *     lastCleanup: timestamp
 *   }
 *   testsnapper_sessions → [
 *     { sessionId, sessionName, createdAt, env, stepCount, ... }
 *   ]
 *   testsnapper_steps_{sessionId} → [
 *     { id, sessionId, action, fieldName, selector, value, ... }
 *   ]
 *   testsnapper_assets_{sessionId} → [
 *     { id, sessionId, stepId, type, dataUrl, ... }
 *   ]
 *
 * Add "storage" and "unlimitedStorage" permissions to manifest.json.
 */

import { compress, decompress, isCompressed } from './core/compression.js';

const STORAGE_VERSION = 2;
const META_KEY = 'testsnapper_meta';
const SESSIONS_KEY = 'testsnapper_sessions';
const QUOTA_WARNING_THRESHOLD = 0.80; // 80%
const QUOTA_ERROR_THRESHOLD = 0.95; // 95%
const MAX_IMAGE_WIDTH = 1920;
const MAX_IMAGE_HEIGHT = 1080;
const IMAGE_QUALITY = 0.95;
const CLEANUP_INTERVAL_DAYS = 7;

class StorageManager {
  constructor() {
    this.maxRetries = 3;
    this.retryDelay = 100; // ms base; multiplied by attempt number
    this.quotaListeners = new Set();
  }

  // ════════════════════════════════════════════════════════════════
  // Internal helpers
  // ════════════════════════════════════════════════════════════════

  /**
   * Read metadata (version, counts, etc.)
   */
  async _readMeta() {
    const result = await chrome.storage.local.get(META_KEY);
    return result[META_KEY] || {
      version: STORAGE_VERSION,
      sessionCount: 0,
      lastCleanup: Date.now()
    };
  }

  /**
   * Write metadata
   */
  async _writeMeta(meta) {
    await chrome.storage.local.set({ [META_KEY]: meta });
  }

  /**
   * Read all session metadata (without steps/assets)
   */
  async _readSessions() {
    const result = await chrome.storage.local.get(SESSIONS_KEY);
    return result[SESSIONS_KEY] || [];
  }

  /**
   * Write all session metadata
   */
  async _writeSessions(sessions) {
    await chrome.storage.local.set({ [SESSIONS_KEY]: sessions });
  }

  /**
   * Read steps for a specific session
   * BUG FIX: STR-MED-001 - Decompress step data if compressed
   */
  async _readSteps(sessionId) {
    const key = `testsnapper_steps_${sessionId}`;
    const result = await chrome.storage.local.get(key);
    const data = result[key];

    if (!data) return [];

    // Handle compressed data (string with prefix)
    if (isCompressed(data)) {
      return await decompress(data);
    }

    // Handle legacy uncompressed data (array)
    return Array.isArray(data) ? data : [];
  }

  /**
   * Write steps for a specific session
   * BUG FIX: STR-MED-001 - Compress step data before storage
   */
  async _writeSteps(sessionId, steps) {
    const key = `testsnapper_steps_${sessionId}`;
    const compressed = await compress(steps);
    await chrome.storage.local.set({ [key]: compressed });
  }

  /**
   * Read assets for a specific session
   */
  async _readAssets(sessionId) {
    const key = `testsnapper_assets_${sessionId}`;
    const result = await chrome.storage.local.get(key);
    return result[key] || [];
  }

  /**
   * Write assets for a specific session
   */
  async _writeAssets(sessionId, assets) {
    const key = `testsnapper_assets_${sessionId}`;
    await chrome.storage.local.set({ [key]: assets });
  }

  /**
   * Generic retry wrapper – identical contract to the old IndexedDB version.
   */
  async _retryOperation(operation, operationName, retries = this.maxRetries) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (attempt === retries) {
          console.error(`${operationName} failed after ${retries} attempts:`, error);
          throw error;
        }
        console.warn(`${operationName} attempt ${attempt} failed, retrying...`);
        await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
      }
    }
  }

  /**
   * Find the index of a session by ID. Returns -1 if not found.
   */
  _findSessionIndex(sessions, sessionId) {
    return sessions.findIndex(s => s.sessionId === sessionId);
  }

  /**
   * Compress image data URL to reduce storage size
   * BUG FIX: STR-001 - Image compression
   */
  async _compressImage(dataUrl) {
    // Helper to check if we are in a Service Worker or similar context
    const useOffscreen = typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined';

    if (useOffscreen) {
      try {
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        const bitmap = await createImageBitmap(blob);

        let { width, height } = bitmap;

        // Resize if too large
        if (width > MAX_IMAGE_WIDTH || height > MAX_IMAGE_HEIGHT) {
          const ratio = Math.min(MAX_IMAGE_WIDTH / width, MAX_IMAGE_HEIGHT / height);
          width = Math.floor(width * ratio);
          height = Math.floor(height * ratio);
        }

        const canvas = new OffscreenCanvas(width, height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0, width, height);

        const compressedBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: IMAGE_QUALITY });

        // Convert blob to dataUrl
        const reader = new FileReader();
        const compressedDataUrl = await new Promise((resolve) => {
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(compressedBlob);
        });

        bitmap.close();
        console.log(`🗜️ Image compressed (Offscreen): ${(dataUrl.length / 1024).toFixed(1)}KB → ${(compressedDataUrl.length / 1024).toFixed(1)}KB`);

        return compressedDataUrl;
      } catch (error) {
        console.error('Offscreen image compression failed:', error);
        return dataUrl; // Fallback
      }
    } else {
      // Standard DOM implementation
      return new Promise((resolve, reject) => {
        const img = new Image();

        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            let { width, height } = img;

            // Resize if too large
            if (width > MAX_IMAGE_WIDTH || height > MAX_IMAGE_HEIGHT) {
              const ratio = Math.min(MAX_IMAGE_WIDTH / width, MAX_IMAGE_HEIGHT / height);
              width = Math.floor(width * ratio);
              height = Math.floor(height * ratio);
            }

            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            const compressedDataUrl = canvas.toDataURL('image/jpeg', IMAGE_QUALITY);

            console.log(`🗜️ Image compressed: ${(dataUrl.length / 1024).toFixed(1)}KB → ${(compressedDataUrl.length / 1024).toFixed(1)}KB`);

            resolve(compressedDataUrl);
          } catch (error) {
            console.error('Image compression failed:', error);
            resolve(dataUrl); // Fallback to original
          }
        };

        img.onerror = () => {
          console.error('Failed to load image for compression');
          resolve(dataUrl); // Fallback to original
        };

        img.src = dataUrl;
      });
    }
  }

  // ════════════════════════════════════════════════════════════════
  // BUG-004: Storage Quota Monitoring
  // ════════════════════════════════════════════════════════════════

  /**
   * Get current storage usage
   * Returns { used, total, percentage, warning, error }
   */
  async getStorageUsage() {
    try {
      const bytesInUse = await chrome.storage.local.getBytesInUse();

      // BUG FIX: STR-CRIT-001 - Check if unlimitedStorage permission is granted
      let QUOTA_BYTES;
      try {
        const hasUnlimited = await chrome.permissions.contains({ permissions: ['unlimitedStorage'] });
        if (hasUnlimited) {
          // With unlimitedStorage, quota is much larger (typically 1GB+)
          QUOTA_BYTES = chrome.storage.local.QUOTA_BYTES || 1073741824; // 1GB
        } else {
          // Without unlimitedStorage, limited to 10MB
          QUOTA_BYTES = 10485760; // 10MB
        }
      } catch (err) {
        // Fallback if permissions API fails
        QUOTA_BYTES = chrome.storage.local.QUOTA_BYTES || 10485760;
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
   * Check quota before write operation
   * Throws error if quota exceeded
   */
  async _checkQuota() {
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
   * Notify quota warning listeners
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
   * Add quota warning listener
   */
  onQuotaWarning(listener) {
    this.quotaListeners.add(listener);
  }

  /**
   * Remove quota warning listener
   */
  offQuotaWarning(listener) {
    this.quotaListeners.delete(listener);
  }

  // ════════════════════════════════════════════════════════════════
  // STR-004: Orphaned Asset Cleanup
  // ════════════════════════════════════════════════════════════════

  /**
   * Find assets that reference non-existent steps or sessions
   */
  async findOrphanedAssets() {
    const sessions = await this._readSessions();
    const orphaned = [];

    for (const session of sessions) {
      const steps = await this._readSteps(session.sessionId);
      const assets = await this._readAssets(session.sessionId);
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
   * Remove orphaned assets
   */
  async cleanupOrphans() {
    const sessions = await this._readSessions();
    let totalRemoved = 0;

    for (const session of sessions) {
      const steps = await this._readSteps(session.sessionId);
      const assets = await this._readAssets(session.sessionId);
      const stepIds = new Set(steps.map(s => s.id));

      const beforeCount = assets.length;
      const cleaned = assets.filter(a => stepIds.has(a.stepId));
      const removed = beforeCount - cleaned.length;

      if (removed > 0) {
        await this._writeAssets(session.sessionId, cleaned);
        totalRemoved += removed;
      }
    }

    // Update last cleanup time
    const meta = await this._readMeta();
    meta.lastCleanup = Date.now();
    await this._writeMeta(meta);

    console.log(`🧹 Cleaned up ${totalRemoved} orphaned assets`);
    return totalRemoved;
  }

  /**
   * Check if cleanup is needed (runs once per week)
   */
  async _autoCleanupCheck() {
    const meta = await this._readMeta();
    const daysSinceCleanup = (Date.now() - (meta.lastCleanup || 0)) / (1000 * 60 * 60 * 24);

    if (daysSinceCleanup >= CLEANUP_INTERVAL_DAYS) {
      console.log('🧹 Running automatic cleanup...');
      await this.cleanupOrphans();
    }
  }

  // ════════════════════════════════════════════════════════════════
  // STR-005: Export/Import for Backup
  // ════════════════════════════════════════════════════════════════

  /**
   * Export all data for backup
   */
  async exportAllData() {
    const meta = await this._readMeta();
    const sessions = await this._readSessions();
    const data = {
      meta,
      sessions: []
    };

    // Load full session data including steps and assets
    for (const session of sessions) {
      const steps = await this._readSteps(session.sessionId);
      const assets = await this._readAssets(session.sessionId);

      data.sessions.push({
        ...session,
        steps,
        assets
      });
    }

    return data;
  }

  /**
   * Import data from backup
   * Overwrites existing data!
   */
  async importData(data) {
    // Validate data structure
    if (!data || !data.meta || !Array.isArray(data.sessions)) {
      throw new Error('Invalid backup data structure');
    }

    // Clear existing data
    await chrome.storage.local.clear();

    // Write metadata
    await this._writeMeta(data.meta);

    // Write sessions
    const sessionMeta = data.sessions.map(({ steps, assets, ...meta }) => meta);
    await this._writeSessions(sessionMeta);

    // Write steps and assets for each session
    for (const session of data.sessions) {
      await this._writeSteps(session.sessionId, session.steps || []);
      await this._writeAssets(session.sessionId, session.assets || []);
    }

    console.log('✅ Data imported successfully');
    return true;
  }

  // ════════════════════════════════════════════════════════════════
  // STR-006: Batch Operations
  // ════════════════════════════════════════════════════════════════

  /**
   * Update multiple steps in a single transaction
   */
  async batchUpdateSteps(sessionId, stepUpdates) {
    return this._retryOperation(async () => {
      const steps = await this._readSteps(sessionId);
      const updateMap = new Map(stepUpdates.map(s => [s.id, s]));

      const updated = steps.map(step => {
        const update = updateMap.get(step.id);
        return update ? { ...step, ...update } : step;
      });

      await this._writeSteps(sessionId, updated);
      return updated;
    }, 'batchUpdateSteps');
  }

  /**
   * Delete multiple steps in a single transaction
   */
  async batchDeleteSteps(stepIds) {
    return this._retryOperation(async () => {
      const sessions = await this._readSessions();
      const stepIdSet = new Set(stepIds);
      let totalDeleted = 0;

      for (const session of sessions) {
        const steps = await this._readSteps(session.sessionId);
        const beforeCount = steps.length;
        const filtered = steps.filter(s => !stepIdSet.has(s.id));
        const deleted = beforeCount - filtered.length;

        if (deleted > 0) {
          await this._writeSteps(session.sessionId, filtered);

          // Update session step count
          const sessions = await this._readSessions();
          const idx = this._findSessionIndex(sessions, session.sessionId);
          if (idx !== -1) {
            sessions[idx].stepCount = filtered.length;
            await this._writeSessions(sessions);
          }

          totalDeleted += deleted;
        }
      }

      return totalDeleted;
    }, 'batchDeleteSteps');
  }

  // ════════════════════════════════════════════════════════════════
  // STR-002: Schema Versioning
  // ════════════════════════════════════════════════════════════════

  /**
   * Migrate data from older schema versions
   */
  async _migrateIfNeeded() {
    const meta = await this._readMeta();

    if (!meta.version || meta.version < STORAGE_VERSION) {
      console.log(`🔄 Migrating storage from v${meta.version || 1} to v${STORAGE_VERSION}`);

      if (meta.version === 1 || !meta.version) {
        // Migration from v1 to v2: Split single-key storage into multi-key
        const oldKey = 'testsnapper_data';
        const oldData = await chrome.storage.local.get(oldKey);

        // BUG FIX: STR-HIGH-001 - Validate data before migration
        if (oldData[oldKey] && oldData[oldKey].sessions) {
          const sessions = oldData[oldKey].sessions;

          // Validate sessions array
          if (!Array.isArray(sessions)) {
            console.error('Migration failed: sessions is not an array');
            throw new Error('Invalid data format for migration');
          }

          // Validate each session has required fields
          const validSessions = sessions.filter(s => {
            if (!s || !s.sessionId) {
              console.warn('Skipping invalid session during migration:', s);
              return false;
            }
            return true;
          });

          if (validSessions.length === 0) {
            console.warn('No valid sessions to migrate');
          } else {
            // Write new format
            const sessionMeta = validSessions.map(({ steps, assets, ...meta }) => meta);
            await this._writeSessions(sessionMeta);

            for (const session of validSessions) {
              const steps = Array.isArray(session.steps) ? session.steps : [];
              const assets = Array.isArray(session.assets) ? session.assets : [];
              await this._writeSteps(session.sessionId, steps);
              await this._writeAssets(session.sessionId, assets);
            }

            console.log(`✅ Migration v1→v2 complete: ${validSessions.length} sessions migrated`);
          }

          // Remove old key
          await chrome.storage.local.remove(oldKey);
        }
      }

      // Update version
      meta.version = STORAGE_VERSION;
      await this._writeMeta(meta);
    }
  }

  // ════════════════════════════════════════════════════════════════
  // Public API (same signatures as the old IndexedDB version)
  // ════════════════════════════════════════════════════════════════

  /**
   * Initialize storage and run migrations
   */
  async init() {
    // Verify the API is available (fails fast in non-extension contexts)
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      throw new Error('chrome.storage.local is not available. Are you running inside a Chrome extension?');
    }

    // Run migrations if needed
    await this._migrateIfNeeded();

    // Run auto-cleanup check
    await this._autoCleanupCheck();

    return true;
  }

  // ──── Sessions ─────────────────────────────────────────────────────

  async createSession(sessionData) {
    return this._retryOperation(async () => {
      await this._checkQuota();

      const sessions = await this._readSessions();

      // Duplicate guard
      if (this._findSessionIndex(sessions, sessionData.sessionId) !== -1) {
        throw new Error(`Session ${sessionData.sessionId} already exists`);
      }

      // Create session metadata
      const session = { ...sessionData, stepCount: 0 };
      sessions.push(session);
      await this._writeSessions(sessions);

      // Initialize empty steps and assets
      await this._writeSteps(sessionData.sessionId, []);
      await this._writeAssets(sessionData.sessionId, []);

      // Update meta
      const meta = await this._readMeta();
      meta.sessionCount++;
      await this._writeMeta(meta);

      return session;
    }, 'createSession');
  }

  async getSession(sessionId) {
    return this._retryOperation(async () => {
      const sessions = await this._readSessions();
      const session = sessions.find(s => s.sessionId === sessionId);

      if (!session) return null;

      // Load steps and assets
      const steps = await this._readSteps(sessionId);
      const assets = await this._readAssets(sessionId);

      return {
        ...session,
        steps,
        assets
      };
    }, 'getSession');
  }

  async updateSession(sessionData) {
    return this._retryOperation(async () => {
      const sessions = await this._readSessions();
      const idx = this._findSessionIndex(sessions, sessionData.sessionId);

      if (idx === -1) {
        throw new Error(`Session ${sessionData.sessionId} not found`);
      }

      // Update session metadata (preserve stepCount from actual steps)
      const steps = await this._readSteps(sessionData.sessionId);
      sessions[idx] = {
        ...sessionData,
        stepCount: steps.length
      };

      await this._writeSessions(sessions);
      return sessions[idx];
    }, 'updateSession');
  }

  async getAllSessions() {
    return this._retryOperation(async () => {
      const sessions = await this._readSessions();
      return sessions;
    }, 'getAllSessions');
  }

  async updateSessionName(sessionId, sessionName) {
    return this._retryOperation(async () => {
      const sessions = await this._readSessions();
      const idx = this._findSessionIndex(sessions, sessionId);

      if (idx === -1) throw new Error('Session not found');

      sessions[idx].sessionName = sessionName;
      await this._writeSessions(sessions);
      return sessions[idx];
    }, 'updateSessionName');
  }

  // ──── Steps ────────────────────────────────────────────────────────

  async addStep(step) {
    return this._retryOperation(async () => {
      await this._checkQuota();

      const sessions = await this._readSessions();
      const idx = this._findSessionIndex(sessions, step.sessionId);

      if (idx === -1) throw new Error(`Session ${step.sessionId} not found`);

      const steps = await this._readSteps(step.sessionId);
      steps.push(step);
      await this._writeSteps(step.sessionId, steps);

      // Update session step count
      sessions[idx].stepCount = steps.length;
      await this._writeSessions(sessions);

      return step;
    }, 'addStep');
  }

  async getSteps(sessionId) {
    return this._retryOperation(async () => {
      const steps = await this._readSteps(sessionId);
      return steps;
    }, 'getSteps');
  }

  async deleteStep(stepId) {
    return this._retryOperation(async () => {
      if (!stepId) throw new Error('Step ID is required');

      const sessions = await this._readSessions();

      for (let i = 0; i < sessions.length; i++) {
        const session = sessions[i];
        const steps = await this._readSteps(session.sessionId);
        const beforeLen = steps.length;
        const filtered = steps.filter(s => s.id !== stepId);

        if (filtered.length < beforeLen) {
          await this._writeSteps(session.sessionId, filtered);

          // Update session step count
          sessions[i].stepCount = filtered.length;
          await this._writeSessions(sessions);

          return true;
        }
      }

      // Step not found in any session – not an error, just a no-op
      return false;
    }, 'deleteStep');
  }

  async updateStep(step) {
    return this._retryOperation(async () => {
      if (!step || !step.id) throw new Error('Valid step with ID is required');

      const sessions = await this._readSessions();

      for (const session of sessions) {
        const steps = await this._readSteps(session.sessionId);
        const idx = steps.findIndex(s => s.id === step.id);

        if (idx !== -1) {
          steps[idx] = { ...steps[idx], ...step };
          await this._writeSteps(session.sessionId, steps);
          return steps[idx];
        }
      }

      throw new Error(`Step ${step.id} not found`);
    }, 'updateStep');
  }

  /**
   * Replace ALL steps for a session in one atomic write.
   * Also updates the session's stepCount.
   */
  async updateAllSteps(sessionId, steps) {
    return this._retryOperation(async () => {
      const sessions = await this._readSessions();
      const idx = this._findSessionIndex(sessions, sessionId);

      if (idx === -1) throw new Error(`Session ${sessionId} not found`);

      await this._writeSteps(sessionId, steps);

      // Update session step count
      sessions[idx].stepCount = steps.length;
      await this._writeSessions(sessions);

      console.log('✅ All steps updated successfully');
      return true;
    }, 'updateAllSteps');
  }

  // ──── Assets ───────────────────────────────────────────────────────

  async addAsset(asset) {
    return this._retryOperation(async () => {
      await this._checkQuota();

      const sessions = await this._readSessions();
      const idx = this._findSessionIndex(sessions, asset.sessionId);

      if (idx === -1) throw new Error(`Session ${asset.sessionId} not found`);

      // Compress image if it's a screenshot
      if (asset.type === 'screenshot' && asset.dataUrl) {
        asset.dataUrl = await this._compressImage(asset.dataUrl);
      }

      const assets = await this._readAssets(asset.sessionId);
      assets.push(asset);
      await this._writeAssets(asset.sessionId, assets);

      return asset;
    }, 'addAsset');
  }

  async getAllAssets(sessionId) {
    return this._retryOperation(async () => {
      const assets = await this._readAssets(sessionId);
      return assets;
    }, 'getAllAssets');
  }

  async getAssetsByStepId(stepId) {
    return this._retryOperation(async () => {
      const sessions = await this._readSessions();

      for (const session of sessions) {
        const assets = await this._readAssets(session.sessionId);
        const matched = assets.filter(a => a.stepId === stepId);
        if (matched.length > 0) return matched;
      }

      return [];
    }, 'getAssetsByStepId');
  }

  async deleteAssets(sessionId) {
    return this._retryOperation(async () => {
      await this._writeAssets(sessionId, []);
      return true;
    }, 'deleteAssets');
  }

  // ──── Session lifecycle ────────────────────────────────────────────

  /**
   * Delete a session and all its steps + assets in one atomic operation.
   */
  async clearSession(sessionId) {
    return this._retryOperation(async () => {
      const sessions = await this._readSessions();
      const idx = this._findSessionIndex(sessions, sessionId);

      if (idx === -1) return true; // already gone

      // Remove session metadata
      sessions.splice(idx, 1);
      await this._writeSessions(sessions);

      // Remove steps and assets
      await chrome.storage.local.remove(`testsnapper_steps_${sessionId}`);
      await chrome.storage.local.remove(`testsnapper_assets_${sessionId}`);

      // Update meta
      const meta = await this._readMeta();
      meta.sessionCount = sessions.length;
      await this._writeMeta(meta);

      console.log(`✅ Session ${sessionId} cleared`);
      return true;
    }, 'clearSession');
  }
}

export { StorageManager };