/**
 * Storage Module – chrome.storage.local (file-based, persistent)
 *
 * Replaces IndexedDB with chrome.storage.local, which persists data to a flat
 * file on disk managed by Chrome. All public methods keep the same signatures
 * so the rest of the extension needs zero changes.
 *
 * Key architectural features:
 * - Quota monitoring with warnings at 80%, errors at 95%
 * - Image compression using canvas API
 * - Schema versioning with migration support
 * - Split storage into multiple keys to avoid 10MB per-key limit
 * - Orphaned asset cleanup
 * - Export/import for backup
 * - Batch operations for better performance
 * - GZIP compression for step data
 * - Per-asset O(1) storage with index key
 * - _readSteps handles PLAIN:: prefix from compression fallback
 * - Write-queue mutex serialises all RMW operations; idempotency guards
 * - In-memory steps cache; updateSession accepts optional { stepCount } hint
 * - _retryOperation skips retries for deterministic quota errors
 * - clearSession deletes data keys BEFORE session index entry
 * - _readMeta returns { version: 1 } when key absent for migration trigger
 *
 * Data layout (split across keys for scalability):
 *   testsnapper_meta              → { version, sessionCount, lastCleanup }
 *   testsnapper_sessions          → [ { sessionId, sessionName, … } ]
 *   testsnapper_steps_{id}        → GZIP/PLAIN compressed JSON array of steps
 *   testsnapper_assetIndex_{id}   → [ assetId, … ]          (PERF-002)
 *   testsnapper_asset_{id}_{aid}  → { id, sessionId, stepId, type, dataUrl, … }
 *   testsnapper_assets_{id}       → legacy single-array (migrated on first read)
 *
 * Add "storage" and "unlimitedStorage" permissions to manifest.json.
 */

import { compress, decompress, isCompressed, isPlainFallback } from './compression.js';
import { QuotaMonitor } from './quota-monitor.js';
import { SchemaMigrator } from './schema-migrator.js';
import { OrphanCleaner } from './orphan-cleaner.js';
import { Logger } from './logger.js';

const META_KEY = 'testsnapper_meta';
const SESSIONS_KEY = 'testsnapper_sessions';
const MAX_IMAGE_WIDTH = 1920;
const MAX_IMAGE_HEIGHT = 1080;
const IMAGE_QUALITY = 0.95;

// Safe ceiling for a single exportAllData() payload held in memory (mirrors fs-storage guard).
const MAX_EXPORT_BYTES = 50 * 1024 * 1024; // 50MB

// Defensive caps for imported (potentially hostile) string fields.
const MAX_SESSION_NAME_LEN = 500;
const MAX_FIELD_NAME_LEN = 500;

// In-memory steps cache size cap (PERF-005). Oldest entry evicted on overflow.
const MAX_STEPS_CACHE_ENTRIES = 25;

// Error types that must NOT be retried (deterministic failures)
const NON_RETRYABLE = ['QuotaExceededError', 'StorageQuotaExceeded'];

// STORAGE_VERSION from schema-migrator (kept for backward compat references)
const STORAGE_VERSION = 2;

class StorageManager {
  constructor() {
    this.maxRetries = 3;
    this.retryDelay = 100; // ms base; multiplied by attempt number
    this.quotaMonitor = new QuotaMonitor();
    this.orphanCleaner = new OrphanCleaner(this);

    // Async write-queue mutex serialises all read-modify-write operations.
    this._writeQueue = Promise.resolve();

    // In-memory steps cache: Map<sessionId, steps[]>
    this._stepsCache = new Map();
  }

  // ════════════════════════════════════════════════════════════════
  // Internal helpers
  // ════════════════════════════════════════════════════════════════

  /**
   * Insert/refresh a steps-cache entry while bounding the cache size (PERF-005).
   * Map preserves insertion order, so when the cache exceeds MAX_STEPS_CACHE_ENTRIES
   * we evict the oldest (first) key. Re-setting an existing key keeps its position,
   * which is acceptable for this lightweight LRU-ish bound.
   * @private
   * @param {string} sessionId
   * @param {Array} steps
   */
  _cacheSteps(sessionId, steps) {
    this._stepsCache.set(sessionId, steps);
    while (this._stepsCache.size > MAX_STEPS_CACHE_ENTRIES) {
      const oldestKey = this._stepsCache.keys().next().value;
      if (oldestKey === undefined) break;
      this._stepsCache.delete(oldestKey);
    }
  }

  /**
   * Read metadata (version, counts, etc.)
   * FIX: FUNC-010 — Return { version: 1 } when key absent so SchemaMigrator's
   * v1-detection fires correctly on first run.
   * @private
   * @async
   * @returns {Promise<Object>} Metadata object with version, sessionCount, lastCleanup
   */
  async _readMeta() {
    const result = await chrome.storage.local.get(META_KEY);
    return result[META_KEY] || {
      version: 1,      // FIX: was STORAGE_VERSION (=2), which masked the v1→v2 migration
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
   * Read steps for a specific session — with in-memory cache (PERF-005).
   * FIX: FUNC-007 — Handles COMPRESSED::GZIP::, PLAIN::, raw Array, and bare JSON string.
   * @private
   * @async
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Array>} Array of step objects
   */
  async _readSteps(sessionId) {
    // FIX: PERF-005 — serve from cache when available
    if (this._stepsCache.has(sessionId)) {
      return this._stepsCache.get(sessionId);
    }

    const key = `testsnapper_steps_${sessionId}`;
    const result = await chrome.storage.local.get(key);
    const data = result[key];

    let steps;
    if (!data) {
      steps = [];
    } else if (Array.isArray(data)) {
      steps = data;
    } else if (isCompressed(data)) {
      steps = await decompress(data);
    } else if (isPlainFallback(data)) {
      // FIX: FUNC-007 — PLAIN:: prefix written by compression fallback
      steps = JSON.parse(data.slice('PLAIN::'.length));
    } else if (typeof data === 'string') {
      // Legacy bare JSON string (shouldn't occur but tolerate it)
      try { steps = JSON.parse(data); } catch (e) { steps = []; }
    } else {
      steps = [];
    }

    // FIX: PERF-005 — populate cache (size-bounded)
    this._cacheSteps(sessionId, steps);
    return steps;
  }

  /**
   * Write steps for a specific session
   * Compresses step data before storage (STR-MED-001 fix)
   * FIX: PERF-005 — keep cache in sync after write
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
    // FIX: PERF-005 — keep cache in sync (size-bounded)
    this._cacheSteps(sessionId, steps);
  }

  // ──── Asset helpers (PERF-002 per-asset-key architecture) ──────────────

  _assetIndexKey(sessionId) { return `testsnapper_assetIndex_${sessionId}`; }
  _assetKey(sessionId, assetId) { return `testsnapper_asset_${sessionId}_${assetId}`; }
  _legacyAssetKey(sessionId) { return `testsnapper_assets_${sessionId}`; }

  /**
   * Read asset index (array of assetId strings) for a session.
   * Migrates from the legacy single-array format on first access.
   * FIX: PERF-002 — migrate from legacy testsnapper_assets_{id} key on first read
   * @private
   * @async
   * @param {string} sessionId
   * @returns {Promise<string[]>} Array of asset IDs
   */
  async _readAssetIndex(sessionId) {
    const indexKey = this._assetIndexKey(sessionId);
    const result = await chrome.storage.local.get(indexKey);
    if (result[indexKey]) {
      return result[indexKey]; // already migrated
    }

    // FIX: PERF-002 — migrate from legacy testsnapper_assets_{id} key on first read
    const legacyKey = this._legacyAssetKey(sessionId);
    const legacyResult = await chrome.storage.local.get(legacyKey);
    const legacyAssets = legacyResult[legacyKey];

    if (!legacyAssets || !Array.isArray(legacyAssets) || legacyAssets.length === 0) {
      return []; // No assets at all
    }

    // Write each asset to its own key and build an index
    const assetIds = legacyAssets.map(a => a.id);
    const batch = { [indexKey]: assetIds };
    for (const asset of legacyAssets) {
      batch[this._assetKey(sessionId, asset.id)] = asset;
    }
    await chrome.storage.local.set(batch);
    await chrome.storage.local.remove(legacyKey);

    return assetIds;
  }

  /**
   * Read all assets for a session as an array (backward-compatible API).
   * FIX: PERF-002 — reads via per-asset keys; backward-compatible (returns .dataUrl).
   * @private
   * @async
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Array>} Array of asset objects
   */
  async _readAssets(sessionId) {
    const assetIds = await this._readAssetIndex(sessionId);
    if (assetIds.length === 0) return [];

    const keys = assetIds.map(id => this._assetKey(sessionId, id));
    const result = await chrome.storage.local.get(keys);
    return assetIds
      .map(id => result[this._assetKey(sessionId, id)])
      .filter(Boolean);
  }

  /**
   * Write a single asset to its own key and update the index atomically.
   * FIX: PERF-002 — O(1) write instead of O(n) read+push+write.
   * @private
   * @async
   * @param {string} sessionId
   * @param {Object} asset
   */
  async _writeAsset(sessionId, asset) {
    const indexKey = this._assetIndexKey(sessionId);
    const assetKey = this._assetKey(sessionId, asset.id);

    // Read current index (may trigger legacy migration)
    const assetIds = await this._readAssetIndex(sessionId);

    // Write asset + updated index in one chrome.storage.local.set call
    const batch = {
      [assetKey]: asset,
      [indexKey]: [...assetIds, asset.id]
    };
    await chrome.storage.local.set(batch);
  }

  /**
   * Write assets from an array — used by migration paths and orphan cleaner.
   * Replaces the entire asset collection for a session.
   * @private
   * @async
   * @param {string} sessionId
   * @param {Array} assets
   */
  async _writeAssetsFromArray(sessionId, assets) {
    const indexKey = this._assetIndexKey(sessionId);

    if (!assets || assets.length === 0) {
      // Clear all existing asset keys for this session
      const existingIds = await this._readAssetIndex(sessionId);
      const keysToRemove = existingIds.map(id => this._assetKey(sessionId, id));
      keysToRemove.push(indexKey);
      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
      }
      return;
    }

    const batch = { [indexKey]: assets.map(a => a.id) };
    for (const asset of assets) {
      batch[this._assetKey(sessionId, asset.id)] = asset;
    }
    await chrome.storage.local.set(batch);
  }

  /**
   * Legacy write path used by SchemaMigrator (v1→v2).
   * Writes assets using new per-key format.
   * @private
   */
  async _writeAssetsLegacy(sessionId, assets) {
    await this._writeAssetsFromArray(sessionId, assets);
  }

  /**
   * Write assets (kept for internal migration only).
   * @deprecated Use _writeAssetsFromArray instead.
   * @private
   */
  async _writeAssets(sessionId, assets) {
    await this._writeAssetsFromArray(sessionId, assets);
  }

  /**
   * Generic retry wrapper with exponential backoff.
   * FIX: PERF-012 — QuotaExceededError / StorageQuotaExceeded errors are deterministic;
   * retrying them wastes backoff budget. They are re-thrown immediately.
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
        // FIX: PERF-012 — do not retry deterministic quota failures
        const isQuotaError =
          NON_RETRYABLE.includes(error.name) ||
          (error.message && error.message.includes('quota'));
        if (isQuotaError) {
          Logger.error(`${operationName} quota error (non-retryable):`, error.message);
          throw error;
        }

        if (attempt === retries) {
          Logger.error(`${operationName} failed after ${retries} attempts:`, error);
          throw error;
        }
        Logger.warn(`${operationName} attempt ${attempt} failed, retrying...`);
        await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
      }
    }
  }

  /**
   * Enqueue an operation on the write queue.
   * FIX: FUNC-008 — serialises all read-modify-write mutations.
   * @private
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  _enqueue(fn) {
    const next = this._writeQueue
      .then(() => fn())
      .catch(err => { throw err; });
    // Keep the chain alive even if this slot throws
    this._writeQueue = next.catch(() => {});
    return next;
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
  // Storage quota monitoring (delegated to QuotaMonitor)
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
  // Orphaned asset cleanup (delegated to OrphanCleaner)
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
  // Export/import for backup
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

    // Load full session data including steps and assets.
    // Guard the in-memory payload size: a full chrome.storage export (with base64
    // screenshots) can blow up RAM. Mirror the fs-storage 50MB safe limit.
    let accumulatedBytes = JSON.stringify({ meta, sessions: [] }).length;
    for (const session of sessions) {
      const steps = await this._readSteps(session.sessionId);
      const assets = await this._readAssets(session.sessionId);

      const entry = { ...session, steps, assets };
      accumulatedBytes += JSON.stringify(entry).length;
      if (accumulatedBytes > MAX_EXPORT_BYTES) {
        throw new Error(
          'Export aborted: dataset exceeds the 50MB safe limit for chrome.storage export. ' +
          'Use File System storage mode for large datasets.'
        );
      }

      data.sessions.push(entry);
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

    // Allowlists for imported content
    const SAFE_ID_RE = /^[0-9a-f-]{8,64}$/i;
    const SAFE_DATA_URL_RE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

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
      // Defense-in-depth: type/length-validate the human-supplied sessionName.
      // Non-string → coerce to empty string; over-long → truncate. (No HTML-escaping
      // here — escaping belongs at render time.)
      if (s.sessionName !== undefined) {
        if (typeof s.sessionName !== 'string') {
          s.sessionName = '';
        } else if (s.sessionName.length > MAX_SESSION_NAME_LEN) {
          s.sessionName = s.sessionName.slice(0, MAX_SESSION_NAME_LEN);
        }
      }
      // Validate step IDs are safe identifiers + normalize fieldName
      if (Array.isArray(s.steps)) {
        for (const [j, step] of s.steps.entries()) {
          if (step && typeof step.id === 'string' && !SAFE_ID_RE.test(step.id)) {
            throw new Error(`Invalid step id at session ${s.sessionId} step ${j}`);
          }
          // Defense-in-depth: type/length-validate fieldName when present.
          if (step && step.fieldName !== undefined) {
            if (typeof step.fieldName !== 'string') {
              step.fieldName = '';
            } else if (step.fieldName.length > MAX_FIELD_NAME_LEN) {
              step.fieldName = step.fieldName.slice(0, MAX_FIELD_NAME_LEN);
            }
          }
        }
      }
      // Validate asset data URLs are well-formed image URLs
      if (Array.isArray(s.assets)) {
        for (const [j, asset] of s.assets.entries()) {
          const url = asset && (asset.dataUrl || asset.data);
          if (url && typeof url === 'string' && !SAFE_DATA_URL_RE.test(url)) {
            throw new Error(`Invalid asset dataUrl at session ${s.sessionId} asset ${j}`);
          }
        }
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
      await this._writeAssetsFromArray(session.sessionId, session.assets || []);
    }

    Logger.info('Data imported successfully');
    return true;
  }

  // Alias used by background.js
  async importAllData(data) { return this.importData(data); }

  // ════════════════════════════════════════════════════════════════
  // Batch operations
  // ════════════════════════════════════════════════════════════════

  /**
   * Update multiple steps in a single transaction
   * @async
   * @param {string} sessionId - Session identifier
   * @param {Array<Object>} stepUpdates - Array of step objects with id and updated fields
   * @returns {Promise<Array>} Updated steps array
   */
  async batchUpdateSteps(sessionId, stepUpdates) {
    return this._enqueue(() => this._retryOperation(async () => {
      const steps = await this._readSteps(sessionId);
      const updateMap = new Map(stepUpdates.map(s => [s.id, s]));

      const updated = steps.map(step => {
        const update = updateMap.get(step.id);
        return update ? { ...step, ...update } : step;
      });

      await this._writeSteps(sessionId, updated);
      return updated;
    }, 'batchUpdateSteps'));
  }

  /**
   * Delete multiple steps in a single transaction
   * @async
   * @param {Array<string>} stepIds - Array of step IDs to delete
   * @returns {Promise<number>} Total number of steps deleted
   */
  async batchDeleteSteps(stepIds) {
    return this._enqueue(() => this._retryOperation(async () => {
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

          // Re-read sessions inside the lock to avoid stale index
          const freshSessions = await this._readSessions();
          const idx = this._findSessionIndex(freshSessions, session.sessionId);
          if (idx !== -1) {
            freshSessions[idx].stepCount = filtered.length;
            await this._writeSessions(freshSessions);
          }

          totalDeleted += deleted;
        }
      }

      return totalDeleted;
    }, 'batchDeleteSteps'));
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

    // Run migrations using SchemaMigrator (delegates modularly)
    const migrator = new SchemaMigrator(this);
    await migrator.migrateIfNeeded();

    // Run auto-cleanup check
    await this._autoCleanupCheck();

    return true;
  }

  // ──── Sessions ─────────────────────────────────────────────────────

  /**
   * Create a new session
   * FIX: FUNC-008 — queued + idempotent (collision returns existing session)
   * @async
   * @param {Object} sessionData - Session metadata object
   * @param {string} sessionData.sessionId - Unique session identifier
   * @param {string} sessionData.sessionName - Human-readable session name
   * @param {number} sessionData.createdAt - Creation timestamp
   * @returns {Promise<Object>} Created session object
   * @throws {Error} If quota exceeded
   */
  async createSession(sessionData) {
    return this._enqueue(() => this._retryOperation(async () => {
      await this._checkQuota();

      const sessions = await this._readSessions();
      const existing = this._findSessionIndex(sessions, sessionData.sessionId);

      // FIX: FUNC-008 — treat collision as success (idempotent)
      if (existing !== -1) {
        return sessions[existing];
      }

      // Create session metadata
      const session = { ...sessionData, stepCount: 0 };
      sessions.push(session);
      await this._writeSessions(sessions);

      // Initialize empty steps and asset index
      await this._writeSteps(sessionData.sessionId, []);
      await chrome.storage.local.set({
        [this._assetIndexKey(sessionData.sessionId)]: []
      });

      // Update meta
      const meta = await this._readMeta();
      meta.sessionCount = (meta.sessionCount || 0) + 1;
      await this._writeMeta(meta);

      return session;
    }, 'createSession'));
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
   * FIX: FUNC-008 — queued; FIX: PERF-005 — accepts optional { stepCount } hint
   * @async
   * @param {Object} sessionData - Updated session metadata
   * @param {string} sessionData.sessionId - Session identifier
   * @param {Object} [opts] - Optional hints
   * @param {number} [opts.stepCount] - Skip _readSteps if stepCount is provided
   * @returns {Promise<Object>} Updated session object
   * @throws {Error} If session not found
   */
  async updateSession(sessionData, { stepCount } = {}) {
    return this._enqueue(() => this._retryOperation(async () => {
      const sessions = await this._readSessions();
      const idx = this._findSessionIndex(sessions, sessionData.sessionId);

      if (idx === -1) {
        throw new Error(`Session ${sessionData.sessionId} not found`);
      }

      let count = stepCount;
      if (count === undefined) {
        // FIX: PERF-005 — use cache when available to avoid full decompress
        if (this._stepsCache.has(sessionData.sessionId)) {
          count = this._stepsCache.get(sessionData.sessionId).length;
        } else {
          const steps = await this._readSteps(sessionData.sessionId);
          count = steps.length;
        }
      }

      // FIX: strip heavy hydrated fields before writing the lightweight session index.
      // Callers sometimes pass a fully-hydrated session (e.g. from getSession(), or
      // markSessionIncomplete) that carries steps/assets arrays; embedding those into the
      // `testsnapper_sessions` metadata row bloats every getAllSessions() read. Only
      // metadata belongs here — drop steps/assets explicitly.
      const { steps: _steps, assets: _assets, ...meta } = sessionData;
      sessions[idx] = { ...meta, stepCount: count };
      await this._writeSessions(sessions);
      return sessions[idx];
    }, 'updateSession'));
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
   * FIX: FUNC-008 — queued
   * @async
   * @param {string} sessionId - Session identifier
   * @param {string} sessionName - New session name
   * @returns {Promise<Object>} Updated session object
   * @throws {Error} If session not found
   */
  async updateSessionName(sessionId, sessionName) {
    return this._enqueue(() => this._retryOperation(async () => {
      const sessions = await this._readSessions();
      const idx = this._findSessionIndex(sessions, sessionId);

      if (idx === -1) throw new Error('Session not found');

      sessions[idx].sessionName = sessionName;
      await this._writeSessions(sessions);
      return sessions[idx];
    }, 'updateSessionName'));
  }

  // ──── Steps ────────────────────────────────────────────────────────

  /**
   * Add a step to a session
   * FIX: FUNC-008 — queued + idempotency guard on duplicate step IDs
   * FIX: PERF-005 — uses cache
   * @async
   * @param {Object} step - Step object with sessionId
   * @returns {Promise<Object>} The added step
   * @throws {Error} If session not found or quota exceeded
   */
  async addStep(step) {
    return this._enqueue(() => this._retryOperation(async () => {
      await this._checkQuota();

      const sessions = await this._readSessions();
      const idx = this._findSessionIndex(sessions, step.sessionId);

      if (idx === -1) throw new Error(`Session ${step.sessionId} not found`);

      const steps = await this._readSteps(step.sessionId);

      // FIX: FUNC-008 — Idempotency guard: don't push duplicate step ids
      if (!steps.some(s => s.id === step.id)) {
        steps.push(step);
      }

      await this._writeSteps(step.sessionId, steps);

      // Update session step count
      sessions[idx].stepCount = steps.length;
      await this._writeSessions(sessions);

      return step;
    }, 'addStep'));
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
   * FIX: FUNC-008 — queued
   * @async
   * @param {string} stepId - Step identifier
   * @returns {Promise<boolean>} true if deleted, false if not found
   * @throws {Error} If stepId is not provided
   */
  async deleteStep(stepId) {
    return this._enqueue(() => this._retryOperation(async () => {
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
    }, 'deleteStep'));
  }

  /**
   * Update a single step
   * FIX: FUNC-008 — queued
   * @async
   * @param {Object} step - Step object with id and updated fields
   * @returns {Promise<Object>} Updated step object
   * @throws {Error} If step not found or invalid
   */
  async updateStep(step) {
    return this._enqueue(() => this._retryOperation(async () => {
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
    }, 'updateStep'));
  }

  /**
   * Replace ALL steps for a session in one atomic write
   * Also updates the session's stepCount
   * FIX: FUNC-008 — queued; FIX: PERF-005 — invalidate cache on bulk replace
   * @async
   * @param {string} sessionId - Session identifier
   * @param {Array} steps - New array of step objects
   * @returns {Promise<boolean>} true if successful
   * @throws {Error} If session not found
   */
  async updateAllSteps(sessionId, steps) {
    return this._enqueue(() => this._retryOperation(async () => {
      const sessions = await this._readSessions();
      const idx = this._findSessionIndex(sessions, sessionId);

      if (idx === -1) throw new Error(`Session ${sessionId} not found`);

      await this._writeSteps(sessionId, steps);
      // FIX: PERF-005 — invalidate cache on bulk replace
      this._stepsCache.delete(sessionId);

      // Update session step count
      sessions[idx].stepCount = steps.length;
      await this._writeSessions(sessions);

      Logger.info('All steps updated successfully');
      return true;
    }, 'updateAllSteps'));
  }

  // ──── Assets ───────────────────────────────────────────────────────

  /**
   * Add an asset (screenshot) to a session
   * FIX: PERF-002 — O(1) write using per-asset key
   * FIX: FUNC-008 — queued + idempotency guard
   * @async
   * @param {Object} asset - Asset object
   * @param {string} asset.sessionId - Session identifier
   * @param {string} asset.stepId - Step identifier
   * @param {string} asset.dataUrl - Base64 data URL of image
   * @returns {Promise<Object>} The added asset
   * @throws {Error} If session not found or quota exceeded
   */
  async addAsset(asset) {
    return this._enqueue(() => this._retryOperation(async () => {
      await this._checkQuota();

      const sessions = await this._readSessions();
      const idx = this._findSessionIndex(sessions, asset.sessionId);

      if (idx === -1) throw new Error(`Session ${asset.sessionId} not found`);

      // Store screenshot as-is (PNG lossless from capture, or JPEG-high)
      // Compression only happens at export time for maximum quality preservation
      if (asset.type === 'screenshot' && asset.dataUrl) {
        asset = { ...asset, format: this._detectImageFormat(asset.dataUrl), originalSize: asset.dataUrl.length };
      }

      // FIX: FUNC-008 — Idempotency guard: check if asset id already in index
      const existingIds = await this._readAssetIndex(asset.sessionId);
      if (existingIds.includes(asset.id)) {
        return asset; // Already stored — no-op
      }

      // FIX: PERF-002 — Write single asset key + update index (O(1))
      await this._writeAsset(asset.sessionId, asset);

      // Warn if PNG storage is consuming significant space
      if (asset.type === 'screenshot' && asset.format === 'png') {
        try {
          const usage = await this.getStorageUsage();
          if (usage.percentage > 0.60) {
            Logger.warn('PNG storage is consuming significant space (' +
              Math.round(usage.percentage * 100) + '%). Consider switching to JPEG-high in settings.');
          }
        } catch (e) { /* non-critical */ }
      }

      return asset;
    }, 'addAsset'));
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
   * FIX: PERF-002 — reads via per-asset keys
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
   * Alias used by export-service.js — backward-compatible with PERF-002.
   * @async
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Array>} Array of asset objects
   */
  async getAssets(sessionId) {
    return this.getAllAssets(sessionId);
  }

  /**
   * Get all assets associated with a specific step
   * FIX: PERF-002 — sessionId strongly preferred to avoid O(n*k) scan
   * @async
   * @param {string} stepId - Step identifier
   * @param {string|null} sessionId - Session identifier (strongly recommended)
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
   * FIX: FUNC-008 — queued; FIX: PERF-002 — clears per-asset keys
   * @async
   * @param {string} sessionId - Session identifier
   * @returns {Promise<boolean>} true if successful
   */
  async deleteAssets(sessionId) {
    return this._enqueue(() => this._retryOperation(async () => {
      await this._writeAssetsFromArray(sessionId, []);
      return true;
    }, 'deleteAssets'));
  }

  // ──── Session lifecycle ────────────────────────────────────────────

  /**
   * Delete a session and all its steps + assets in one atomic operation
   * FIX: PERF-013 — Delete data keys FIRST, then remove the session index entry.
   * FIX: FUNC-008 — queued; FIX: PERF-005 — invalidates cache
   * @async
   * @param {string} sessionId - Session identifier
   * @returns {Promise<boolean>} true if successful
   */
  async clearSession(sessionId) {
    return this._enqueue(() => this._retryOperation(async () => {
      const sessions = await this._readSessions();
      const idx = this._findSessionIndex(sessions, sessionId);

      if (idx === -1) return true; // already gone

      // FIX: PERF-013 — Remove DATA keys BEFORE updating the session index
      const stepKey = `testsnapper_steps_${sessionId}`;
      const legacyAssetKey = this._legacyAssetKey(sessionId);
      const indexKey = this._assetIndexKey(sessionId);

      // Gather per-asset keys
      const assetIds = await this._readAssetIndex(sessionId);
      const perAssetKeys = assetIds.map(id => this._assetKey(sessionId, id));

      // Remove all data keys first
      const dataKeys = [stepKey, legacyAssetKey, indexKey, ...perAssetKeys];
      await chrome.storage.local.remove(dataKeys);

      // FIX: PERF-005 — invalidate cache
      this._stepsCache.delete(sessionId);

      // Now remove the session index entry
      sessions.splice(idx, 1);
      await this._writeSessions(sessions);

      // Update meta
      const meta = await this._readMeta();
      meta.sessionCount = sessions.length;
      await this._writeMeta(meta);

      Logger.info(`Session ${sessionId} cleared`);
      return true;
    }, 'clearSession'));
  }
}

export { StorageManager };
