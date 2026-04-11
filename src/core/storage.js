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

import { compress, decompress, isCompressed } from './compression.js';
import { QuotaMonitor } from './quota-monitor.js';
import { migrateIfNeeded, STORAGE_VERSION } from './schema-migrator.js';
import { OrphanCleaner } from './orphan-cleaner.js';

const META_KEY = 'testsnapper_meta';
const SESSIONS_KEY = 'testsnapper_sessions';
const MAX_IMAGE_WIDTH = 1920;
const MAX_IMAGE_HEIGHT = 1080;
const IMAGE_QUALITY = 0.95;

class StorageManager {
  constructor() {
    this.maxRetries = 3;
    this.retryDelay = 100; // ms base; multiplied by attempt number
    this.quotaMonitor = new QuotaMonitor();
    this.orphanCleaner = new OrphanCleaner(this);
  }

  // ════════════════════════════════════════════════════════════════
  // Internal helpers
  // ════════════════════════════════════════════════════════════════

  /**
   * Read metadata (version, counts, etc.)
   * @private
   * @async
   * @returns {Promise<Object>} Metadata object with version, sessionCount, lastCleanup
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
   * @private
   * @async
   * @param {Object} meta - Metadata object to write
   * @returns {Promise<void>}
   */
  async _writeMeta(meta) {
    await chrome.storage.local.set({ [META_KEY]: meta });
  }

  /**
   * Read all session metadata (without steps/assets)
   * @private
   * @async
   * @returns {Promise<Array>} Array of session metadata objects
   */
  async _readSessions() {
    const result = await chrome.storage.local.get(SESSIONS_KEY);
    return result[SESSIONS_KEY] || [];
  }

  /**
   * Write all session metadata
   * @private
   * @async
   * @param {Array} sessions - Array of session metadata objects
   * @returns {Promise<void>}
   */
  async _writeSessions(sessions) {
    await chrome.storage.local.set({ [SESSIONS_KEY]: sessions });
  }

  /**
   * Read steps for a specific session
   * Decompresses step data if stored compressed (STR-MED-001 fix)
   * @private
   * @async
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Array>} Array of step objects
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
   * Compresses step data before storage (STR-MED-001 fix)
   * @private
   * @async
   * @param {string} sessionId - Session identifier
   * @param {Array} steps - Array of step objects
   * @returns {Promise<void>}
   */
  async _writeSteps(sessionId, steps) {
    const key = `testsnapper_steps_${sessionId}`;
    const compressed = await compress(steps);
    await chrome.storage.local.set({ [key]: compressed });
  }

  /**
   * Read assets for a specific session
   * @private
   * @async
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Array>} Array of asset objects
   */
  async _readAssets(sessionId) {
    const key = `testsnapper_assets_${sessionId}`;
    const result = await chrome.storage.local.get(key);
    return result[key] || [];
  }

  /**
   * Write assets for a specific session
   * @private
   * @async
   * @param {string} sessionId - Session identifier
   * @param {Array} assets - Array of asset objects
   * @returns {Promise<void>}
   */
  async _writeAssets(sessionId, assets) {
    const key = `testsnapper_assets_${sessionId}`;
    await chrome.storage.local.set({ [key]: assets });
  }

  /**
   * Generic retry wrapper with exponential backoff
   * @private
   * @async
   * @param {Function} operation - Async operation to retry
   * @param {string} operationName - Name for logging
   * @param {number} [retries=3] - Maximum number of retries
   * @returns {Promise<*>} Result of the operation
   * @throws {Error} If operation fails after all retries
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
   * Find the index of a session by ID
   * @private
   * @param {Array} sessions - Array of session metadata
   * @param {string} sessionId - Session identifier
   * @returns {number} Index of session, or -1 if not found
   */
  _findSessionIndex(sessions, sessionId) {
    return sessions.findIndex(s => s.sessionId === sessionId);
  }

  // ════════════════════════════════════════════════════════════════
  // BUG-004: Storage Quota Monitoring (delegated to QuotaMonitor)
  // ════════════════════════════════════════════════════════════════

  /**
   * Get current storage usage statistics
   * @async
   * @returns {Promise<Object>} { used, total, percentage, warning, error }
   */
  async getStorageUsage() {
    return this.quotaMonitor.getStorageUsage();
  }

  /**
   * Check quota before write operation
   * @private
   * @async
   * @returns {Promise<void>}
   * @throws {Error} If quota is critically exceeded
   */
  async _checkQuota() {
    return this.quotaMonitor.checkQuota();
  }

  /**
   * Notify quota warning listeners
   * @private
   * @param {Object} usage - Storage usage statistics
   */
  _notifyQuotaWarning(usage) {
    return this.quotaMonitor._notifyQuotaWarning(usage);
  }

  /**
   * Add a quota warning listener
   * @param {Function} listener - Callback function
   * @returns {void}
   */
  onQuotaWarning(listener) {
    return this.quotaMonitor.onQuotaWarning(listener);
  }

  /**
   * Remove a quota warning listener
   * @param {Function} listener - Callback function
   * @returns {void}
   */
  offQuotaWarning(listener) {
    return this.quotaMonitor.offQuotaWarning(listener);
  }

  // ════════════════════════════════════════════════════════════════
  // STR-004: Orphaned Asset Cleanup (delegated to OrphanCleaner)
  // ════════════════════════════════════════════════════════════════

  /**
   * Find assets that reference non-existent steps or sessions
   * @async
   * @returns {Promise<Array>} Array of orphaned asset objects
   */
  async findOrphanedAssets() {
    return this.orphanCleaner.findOrphanedAssets();
  }

  /**
   * Remove orphaned assets from storage
   * @async
   * @returns {Promise<number>} Number of assets removed
   */
  async cleanupOrphans() {
    return this.orphanCleaner.cleanupOrphans();
  }

  /**
   * Check if cleanup is needed (runs once per week)
   * @private
   * @async
   * @returns {Promise<void>}
   */
  async _autoCleanupCheck() {
    return this.orphanCleaner.autoCleanupCheck();
  }

  // ════════════════════════════════════════════════════════════════
  // STR-005: Export/Import for Backup
  // ════════════════════════════════════════════════════════════════

  /**
   * Export all data for backup
   * @async
   * @returns {Promise<Object>} Complete data object with meta and sessions
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
   * @async
   * @param {Object} data - Backup data object with meta and sessions
   * @returns {Promise<boolean>} true if successful
   * @throws {Error} If backup data structure is invalid
   */
  async importData(data) {
    // Validate data structure
    if (!data || !data.meta || !Array.isArray(data.sessions)) {
      throw new Error('Invalid backup data structure');
    }

    for (const [i, s] of data.sessions.entries()) {
      if (!s || typeof s.sessionId !== 'string') {
        throw new Error(`Invalid session at index ${i}: missing or invalid sessionId`);
      }
      if (s.steps !== undefined && !Array.isArray(s.steps)) {
        throw new Error(`Invalid session ${s.sessionId}: steps must be an array`);
      }
      if (s.assets !== undefined && !Array.isArray(s.assets)) {
        throw new Error(`Invalid session ${s.sessionId}: assets must be an array`);
      }
    }

    // Clear only TestSnapper keys (not all extension storage)
    const allData = await chrome.storage.local.get(null);
    const testsnapperKeys = Object.keys(allData).filter(k => k.startsWith('testsnapper_'));
    await chrome.storage.local.remove(testsnapperKeys);

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

    console.log('Data imported successfully');
    return true;
  }

  // ════════════════════════════════════════════════════════════════
  // STR-006: Batch Operations
  // ════════════════════════════════════════════════════════════════

  /**
   * Update multiple steps in a single transaction
   * @async
   * @param {string} sessionId - Session identifier
   * @param {Array<Object>} stepUpdates - Array of step objects with id and updated fields
   * @returns {Promise<Array>} Updated steps array
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
   * @async
   * @param {Array<string>} stepIds - Array of step IDs to delete
   * @returns {Promise<number>} Total number of steps deleted
   */
  async batchDeleteSteps(stepIds) {
    return this._retryOperation(async () => {
      const sessions = await this._readSessions();
      const stepIdSet = new Set(stepIds);
      let totalDeleted = 0;

      const stepCountUpdates = {};

      for (const session of sessions) {
        const steps = await this._readSteps(session.sessionId);
        const beforeCount = steps.length;
        const filtered = steps.filter(s => !stepIdSet.has(s.id));
        const deleted = beforeCount - filtered.length;

        if (deleted > 0) {
          await this._writeSteps(session.sessionId, filtered);
          stepCountUpdates[session.sessionId] = filtered.length;
          totalDeleted += deleted;
        }
      }

      // Single read-modify-write for all stepCount updates
      if (Object.keys(stepCountUpdates).length > 0) {
        const allSessions = await this._readSessions();
        for (const [sessionId, newCount] of Object.entries(stepCountUpdates)) {
          const idx = this._findSessionIndex(allSessions, sessionId);
          if (idx !== -1) allSessions[idx].stepCount = newCount;
        }
        await this._writeSessions(allSessions);
      }

      return totalDeleted;
    }, 'batchDeleteSteps');
  }

  /**
   * Read user settings from storage.
   * @async
   * @returns {Promise<Object>} Settings object (empty object if not set)
   */
  async getSettings() {
    const result = await chrome.storage.local.get('settings');
    return result.settings || {};
  }

  // ════════════════════════════════════════════════════════════════
  // Public API (same signatures as the old IndexedDB version)
  // ════════════════════════════════════════════════════════════════

  /**
   * Initialize storage and run migrations
   * @async
   * @returns {Promise<boolean>} true if successful
   * @throws {Error} If storage initialization fails
   */
  async init() {
    // Verify the API is available (fails fast in non-extension contexts)
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      throw new Error('chrome.storage.local is not available. Are you running inside a Chrome extension?');
    }

    // Run migrations if needed
    await migrateIfNeeded({
      readMeta: () => this._readMeta(),
      writeMeta: (m) => this._writeMeta(m),
      writeSessions: (s) => this._writeSessions(s),
      writeSteps: (id, steps) => this._writeSteps(id, steps),
      writeAssets: (id, assets) => this._writeAssets(id, assets)
    });

    // Run auto-cleanup check
    await this._autoCleanupCheck();

    return true;
  }

  // ──── Sessions ─────────────────────────────────────────────────────

  /**
   * Create a new session
   * @async
   * @param {Object} sessionData - Session metadata object
   * @param {string} sessionData.sessionId - Unique session identifier
   * @param {string} sessionData.sessionName - Human-readable session name
   * @param {number} sessionData.createdAt - Creation timestamp
   * @returns {Promise<Object>} Created session object
   * @throws {Error} If session already exists or quota exceeded
   */
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

  /**
   * Get a session with all its steps and assets
   * @async
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Object|null>} Session object with steps and assets, or null if not found
   */
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

  /**
   * Update session metadata
   * @async
   * @param {Object} sessionData - Updated session metadata
   * @param {string} sessionData.sessionId - Session identifier
   * @returns {Promise<Object>} Updated session object
   * @throws {Error} If session not found
   */
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

  /**
   * Get all sessions (metadata only)
   * @async
   * @returns {Promise<Array>} Array of session metadata objects
   */
  async getAllSessions() {
    return this._retryOperation(async () => {
      const sessions = await this._readSessions();
      return sessions;
    }, 'getAllSessions');
  }

  /**
   * Update a session's name
   * @async
   * @param {string} sessionId - Session identifier
   * @param {string} sessionName - New session name
   * @returns {Promise<Object>} Updated session object
   * @throws {Error} If session not found
   */
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

  /**
   * Add a step to a session
   * @async
   * @param {Object} step - Step object with sessionId
   * @returns {Promise<Object>} The added step
   * @throws {Error} If session not found or quota exceeded
   */
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

  /**
   * Get all steps for a session
   * @async
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Array>} Array of step objects
   */
  async getSteps(sessionId) {
    return this._retryOperation(async () => {
      const steps = await this._readSteps(sessionId);
      return steps;
    }, 'getSteps');
  }

  /**
   * Delete a single step by ID
   * @async
   * @param {string} stepId - Step identifier
   * @returns {Promise<boolean>} true if deleted, false if not found
   * @throws {Error} If stepId is not provided
   */
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

  /**
   * Update a single step
   * @async
   * @param {Object} step - Step object with id and updated fields
   * @returns {Promise<Object>} Updated step object
   * @throws {Error} If step not found or invalid
   */
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
   * Replace ALL steps for a session in one atomic write
   * Also updates the session's stepCount
   * @async
   * @param {string} sessionId - Session identifier
   * @param {Array} steps - New array of step objects
   * @returns {Promise<boolean>} true if successful
   * @throws {Error} If session not found
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

      console.log('All steps updated successfully');
      return true;
    }, 'updateAllSteps');
  }

  // ──── Assets ───────────────────────────────────────────────────────

  /**
   * Add an asset (screenshot) to a session
   * @async
   * @param {Object} asset - Asset object
   * @param {string} asset.sessionId - Session identifier
   * @param {string} asset.stepId - Step identifier
   * @param {string} asset.dataUrl - Base64 data URL of image
   * @returns {Promise<Object>} The added asset
   * @throws {Error} If session not found or quota exceeded
   */
  async addAsset(asset) {
    return this._retryOperation(async () => {
      await this._checkQuota();

      const sessions = await this._readSessions();
      const idx = this._findSessionIndex(sessions, asset.sessionId);

      if (idx === -1) throw new Error(`Session ${asset.sessionId} not found`);

      // Store screenshot as-is (PNG lossless from capture, or JPEG-high)
      // Compression only happens at export time for maximum quality preservation
      if (asset.type === 'screenshot' && asset.dataUrl) {
        asset.format = this._detectImageFormat(asset.dataUrl);
        asset.originalSize = asset.dataUrl.length;
      }

      const assets = await this._readAssets(asset.sessionId);
      assets.push(asset);
      await this._writeAssets(asset.sessionId, assets);

      // Warn if PNG storage is consuming significant space
      if (asset.type === 'screenshot' && asset.format === 'png') {
        try {
          const usage = await this.getStorageUsage();
          if (usage.percentage > 0.60) {
            console.warn('PNG storage is consuming significant space (' +
              Math.round(usage.percentage * 100) + '%). Consider switching to JPEG-high in settings.');
          }
        } catch (e) { /* non-critical */ }
      }

      return asset;
    }, 'addAsset');
  }

  /**
   * Detect image format from data URL prefix
   * @private
   * @param {string} dataUrl - Data URL string
   * @returns {string} Format string: 'png', 'jpeg', 'webp', or 'unknown'
   */
  _detectImageFormat(dataUrl) {
    if (dataUrl.startsWith('data:image/png')) return 'png';
    if (dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')) return 'jpeg';
    if (dataUrl.startsWith('data:image/webp')) return 'webp';
    return 'unknown';
  }

  /**
   * Get all assets for a session
   * @async
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Array>} Array of asset objects
   */
  async getAllAssets(sessionId) {
    return this._retryOperation(async () => {
      const assets = await this._readAssets(sessionId);
      return assets;
    }, 'getAllAssets');
  }

  /**
   * Get all assets associated with a specific step
   * @async
   * @param {string} stepId - Step identifier
   * @returns {Promise<Array>} Array of asset objects for the step
   */
  async getAssetsByStepId(stepId, sessionId = null) {
    return this._retryOperation(async () => {
      if (sessionId) {
        const assets = await this._readAssets(sessionId);
        return assets.filter(a => a.stepId === stepId);
      }
      // Fallback: scan all sessions
      const sessions = await this._readSessions();
      for (const session of sessions) {
        const assets = await this._readAssets(session.sessionId);
        const matched = assets.filter(a => a.stepId === stepId);
        if (matched.length > 0) return matched;
      }
      return [];
    }, 'getAssetsByStepId');
  }

  /**
   * Delete all assets for a session
   * @async
   * @param {string} sessionId - Session identifier
   * @returns {Promise<boolean>} true if successful
   */
  async deleteAssets(sessionId) {
    return this._retryOperation(async () => {
      await this._writeAssets(sessionId, []);
      return true;
    }, 'deleteAssets');
  }

  // ──── Session lifecycle ────────────────────────────────────────────

  /**
   * Delete a session and all its steps + assets in one atomic operation
   * @async
   * @param {string} sessionId - Session identifier
   * @returns {Promise<boolean>} true if successful
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

      console.log(`Session ${sessionId} cleared`);
      return true;
    }, 'clearSession');
  }
}

export { StorageManager };
