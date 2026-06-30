/**
 * FSStorageManager — Storage abstraction that routes to filesystem or chrome.storage buffer
 *
 * In window contexts (popup, review page): reads/writes directly to the filesystem
 * via FileSync using the File System Access API.
 *
 * In service worker context (background.js): reads/writes to chrome.storage.local
 * as a temporary buffer during active recording.
 *
 * Provides the same public API as StorageManager so callers need minimal changes.
 *
 * A Proxy wraps the instance so any method not explicitly defined here is
 * auto-routed: service-worker → buffer, window → filesystem (or buffer fallback).
 * This future-proofs the class against new methods added to StorageManager/FileSync.
 *
 * updateStep/deleteStep use the sessionId parameter for direct lookup
 * instead of scanning all session files.
 *
 * exportAllData() no longer routes through the runtime message bus.
 * In filesystem mode it reads directly from FileSync. In chrome.storage mode it
 * aborts with a user-friendly error if the payload would exceed ~50MB.
 */

import { FileSync } from './file-sync.js';
import { StorageManager } from './storage.js';
import { getPendingFlush, addPendingFlush, removePendingFlush } from './flush-utils.js';
import { Logger } from './logger.js';

// Abort threshold for chrome.storage bulk export (bytes)
const EXPORT_SIZE_LIMIT_BYTES = 50 * 1024 * 1024; // 50 MB

export class FSStorageManager {
  /**
   * Initialize the FSStorageManager with auto-routing Proxy
   * @returns {Proxy} Proxy instance for auto-routing unknown methods
   */
  constructor() {
    this._isServiceWorker = (typeof window === 'undefined' ||
      typeof ServiceWorkerGlobalScope !== 'undefined');
    this._buffer = new StorageManager();
    this._fileSync = this._isServiceWorker ? null : new FileSync();
    this._initialized = false;

    /**
     * Auto-routing Proxy for method dispatch
     *
     * Unknown method calls are routed based on context:
     * - Service worker: all unknown methods route to `this._buffer` (StorageManager)
     * - Window contexts: methods attempt filesystem first (FileSync), fall back to `this._buffer`
     *
     * Explicit `_fileSync`-only methods must be called directly on `this._fileSync`;
     * the Proxy will not redirect them to the filesystem if they're not defined on
     * the FSStorageManager instance.
     *
     * Note: background.js uses StorageManager directly; only window contexts
     * (popup, review page) use FSStorageManager for hybrid storage.
     */
    return new Proxy(this, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (value !== undefined) return value;

        // Auto-route unknown methods: service-worker → buffer only.
        // Window context: try filesystem first, fall back to buffer.
        if (typeof target._buffer[prop] === 'function') {
          return async (...args) => {
            if (target._isServiceWorker) {
              return target._buffer[prop](...args);
            }
            const fsReady = await target.isFilesystemReady();
            if (!fsReady) {
              return target._buffer[prop](...args);
            }
            // For methods whose first argument is a sessionId, honour the buffer
            // if the session hasn't been flushed to disk yet.
            const sessionId = args[0];
            if (sessionId && typeof sessionId === 'string') {
              const inBuffer = await target.isInBuffer(sessionId);
              if (inBuffer) return target._buffer[prop](...args);
            }
            if (target._fileSync && typeof target._fileSync[prop] === 'function') {
              return target._fileSync[prop](...args);
            }
            return target._buffer[prop](...args);
          };
        }

        return undefined;
      }
    });
  }

  // ════════════════════════════════════════════════════════════════
  // Accessors
  // ════════════════════════════════════════════════════════════════

  /**
   * Get the FileSync instance (window contexts only)
   * @returns {FileSync|null} FileSync instance or null in service worker context
   */
  get fileSync() {
    return this._fileSync;
  }

  /**
   * Check if the filesystem is available and configured
   * @async
   * @returns {Promise<boolean>} true if filesystem is ready for use
   */
  async isFilesystemReady() {
    if (this._isServiceWorker) return false;
    if (!this._fileSync) return false;
    const handle = await this._fileSync.getHandle();
    return handle !== null;
  }

  // ════════════════════════════════════════════════════════════════
  // Initialization
  // ════════════════════════════════════════════════════════════════

  /**
   * Initialize the storage manager.
   * Initializes both buffer and filesystem if available.
   * @async
   * @returns {Promise<boolean>} true if successful
   */
  async init() {
    // Always init the buffer (chrome.storage) for service worker or fallback.
    await this._buffer.init();
    this._initialized = true;
    return true;
  }

  // ════════════════════════════════════════════════════════════════
  // Pending flush management
  // ════════════════════════════════════════════════════════════════

  /**
   * Check if a session is in the pending flush buffer
   * @async
   * @param {string} sessionId - Session identifier
   * @returns {Promise<boolean>} true if session is buffered
   */
  async isInBuffer(sessionId) {
    const pending = await getPendingFlush();
    return pending.includes(sessionId);
  }

  /**
   * Flush a buffered session from chrome.storage to filesystem.
   * Called from window contexts after recording stops.
   * @async
   * @param {string} sessionId - Session identifier
   * @returns {Promise<boolean>} true if flushed successfully
   */
  async flushSession(sessionId) {
    if (this._isServiceWorker || !this._fileSync) return false;

    const fsReady = await this.isFilesystemReady();
    if (!fsReady) return false;

    try {
      // Read from chrome.storage buffer
      const session = await this._buffer.getSession(sessionId);
      if (!session) return false;

      const steps = session.steps || await this._buffer.getSteps(sessionId);
      const assets = session.assets || await this._buffer.getAllAssets(sessionId);

      // Write to filesystem
      await this._fileSync.writeSession(session, steps, assets);

      // Clear from buffer
      await this.clearBuffer(sessionId);

      Logger.info(`[FSStorage] Flushed session ${sessionId} to disk`);
      return true;
    } catch (error) {
      Logger.error(`[FSStorage] Failed to flush session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Clear a session's data from the chrome.storage buffer
   * @async
   * @param {string} sessionId - Session identifier
   * @returns {Promise<void>}
   */
  async clearBuffer(sessionId) {
    await this._buffer.clearSession(sessionId);
    await removePendingFlush(sessionId);
  }

  /**
   * Flush all pending sessions from buffer to disk
   * @async
   * @returns {Promise<void>}
   */
  async flushAllPending() {
    if (this._isServiceWorker || !this._fileSync) return;

    const pending = await getPendingFlush();
    for (const sessionId of pending) {
      await this.flushSession(sessionId);
    }
  }

  async addPendingFlush(sessionId) { return addPendingFlush(sessionId); }
  async getPendingFlush() { return getPendingFlush(); }
  async removePendingFlush(sessionId) { return removePendingFlush(sessionId); }

  // ════════════════════════════════════════════════════════════════
  // Session operations
  // ════════════════════════════════════════════════════════════════

  /**
   * Create a new session.
   * Service worker: creates in buffer and marks pending flush.
   * Window: writes directly to filesystem (falls back to buffer).
   * @async
   * @param {Object} sessionData - Session metadata
   * @returns {Promise<Object>} Created session object
   */
  async createSession(sessionData) {
    if (this._isServiceWorker) {
      const session = await this._buffer.createSession(sessionData);
      await addPendingFlush(sessionData.sessionId);
      return session;
    }

    // Window context: write directly to filesystem
    const fsReady = await this.isFilesystemReady();
    if (fsReady) {
      const session = { ...sessionData, stepCount: 0 };
      await this._fileSync.writeSession(session, [], []);
      return session;
    }

    // Fallback to buffer if filesystem not ready
    return await this._buffer.createSession(sessionData);
  }

  /**
   * Get a session by ID.
   * Window: reads from filesystem (or buffer if pending flush).
   * Service worker: reads from buffer.
   * @async
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Object|null>} Session object with steps and assets, or null
   */
  async getSession(sessionId) {
    if (this._isServiceWorker) {
      return await this._buffer.getSession(sessionId);
    }

    // Check if this session is still in the buffer (not yet flushed)
    const inBuffer = await this.isInBuffer(sessionId);
    if (inBuffer) {
      return await this._buffer.getSession(sessionId);
    }

    // Read from filesystem
    const fsReady = await this.isFilesystemReady();
    if (fsReady) {
      const data = await this._fileSync.readSession(sessionId);
      if (data) {
        // Steps are already clean (no screenshot data in new format)
        // Strip any legacy screenshot field just in case
        const steps = (data.steps || []).map(s => {
          const { screenshot, ...stepData } = s;
          return stepData;
        });
        const assets = await this._fileSync.readAssets(sessionId);

        return {
          ...data.session,
          steps,
          assets
        };
      }
    }

    return null;
  }

  /**
   * Update session metadata.
   * Reads existing filesystem data, merges the update, and rewrites.
   * @async
   * @param {Object} sessionData - Updated session metadata
   * @returns {Promise<Object>} Updated session object
   */
  async updateSession(sessionData) {
    if (this._isServiceWorker) {
      return await this._buffer.updateSession(sessionData);
    }

    const inBuffer = await this.isInBuffer(sessionData.sessionId);
    if (inBuffer) {
      return await this._buffer.updateSession(sessionData);
    }

    const fsReady = await this.isFilesystemReady();
    if (fsReady) {
      const existing = await this._fileSync.readSession(sessionData.sessionId);
      if (existing) {
        const session = { ...existing.session, ...sessionData };
        const steps = existing.steps || [];
        const assets = this._extractAssets(sessionData.sessionId, steps);
        await this._fileSync.writeSession(session, steps, assets);
        return session;
      }
    }

    return await this._buffer.updateSession(sessionData);
  }

  /**
   * Get all sessions (metadata only).
   * Merges filesystem index with any sessions still in the pending-flush buffer.
   * @async
   * @returns {Promise<Array>} Array of session metadata
   */
  async getAllSessions() {
    if (this._isServiceWorker) {
      return await this._buffer.getAllSessions();
    }

    const fsReady = await this.isFilesystemReady();
    const sessions = [];

    if (fsReady) {
      const index = await this._fileSync.readSessionIndex();
      sessions.push(...index);
    }

    // Overlay buffered sessions that haven't been flushed yet
    const pending = await getPendingFlush();
    if (pending.length > 0) {
      const bufferedSessions = await this._buffer.getAllSessions();
      for (const bs of bufferedSessions) {
        if (pending.includes(bs.sessionId)) {
          const existIdx = sessions.findIndex(s => s.sessionId === bs.sessionId);
          if (existIdx >= 0) {
            sessions[existIdx] = bs;
          } else {
            sessions.push(bs);
          }
        }
      }
    }

    return sessions;
  }

  /**
   * Update session name.
   * Reads existing filesystem data, patches the name field, and rewrites.
   * @async
   * @param {string} sessionId - Session identifier
   * @param {string} sessionName - New session name
   * @returns {Promise<Object>} Updated session object
   */
  async updateSessionName(sessionId, sessionName) {
    if (this._isServiceWorker) {
      return await this._buffer.updateSessionName(sessionId, sessionName);
    }

    const inBuffer = await this.isInBuffer(sessionId);
    if (inBuffer) {
      return await this._buffer.updateSessionName(sessionId, sessionName);
    }

    const fsReady = await this.isFilesystemReady();
    if (fsReady) {
      const data = await this._fileSync.readSession(sessionId);
      if (data) {
        const session = { ...data.session, sessionName };
        const assets = this._extractAssets(sessionId, data.steps || []);
        await this._fileSync.writeSession(session, data.steps || [], assets);
        return session;
      }
    }

    return await this._buffer.updateSessionName(sessionId, sessionName);
  }

  /**
   * Delete a session and all its data from both filesystem and buffer.
   * @async
   * @param {string} sessionId - Session identifier
   * @returns {Promise<boolean>} true if successful
   */
  async clearSession(sessionId) {
    if (this._isServiceWorker) {
      return await this._buffer.clearSession(sessionId);
    }

    // Clear from buffer if pending
    const inBuffer = await this.isInBuffer(sessionId);
    if (inBuffer) {
      await this.clearBuffer(sessionId);
    }

    // Clear from filesystem
    const fsReady = await this.isFilesystemReady();
    if (fsReady) {
      await this._fileSync.deleteSession(sessionId);
    }

    return true;
  }

  // ════════════════════════════════════════════════════════════════
  // Step operations
  // ════════════════════════════════════════════════════════════════

  /**
   * Add a step to a session.
   * On the filesystem this requires a full read-modify-write cycle.
   * @async
   * @param {Object} step - Step object with sessionId
   * @returns {Promise<Object>} The added step
   */
  async addStep(step) {
    if (this._isServiceWorker) {
      return await this._buffer.addStep(step);
    }

    const inBuffer = await this.isInBuffer(step.sessionId);
    if (inBuffer) {
      return await this._buffer.addStep(step);
    }

    const fsReady = await this.isFilesystemReady();
    if (fsReady) {
      const data = await this._fileSync.readSession(step.sessionId);
      if (data) {
        // Preserve all step fields; only strip raw image data
        const { dataUrl: _du, screenshot: _sc, ...stepFields } = step;
        const steps = [...(data.steps || []), stepFields];
        const assets = this._extractAssets(step.sessionId, steps);
        const session = { ...data.session, stepCount: steps.length };
        await this._fileSync.writeSession(session, steps, assets);
        return step;
      }
    }

    return await this._buffer.addStep(step);
  }

  /**
   * Get all steps for a session.
   * Strips the inline screenshot field — screenshots are accessed via getAllAssets.
   * @async
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Array>} Array of step objects
   */
  async getSteps(sessionId) {
    if (this._isServiceWorker) {
      return await this._buffer.getSteps(sessionId);
    }

    const inBuffer = await this.isInBuffer(sessionId);
    if (inBuffer) {
      return await this._buffer.getSteps(sessionId);
    }

    const fsReady = await this.isFilesystemReady();
    if (fsReady) {
      const steps = await this._fileSync.readSteps(sessionId);
      // Strip on-disk-only fields from step objects returned to callers
      return steps.map(s => {
        const { screenshot, screenshotFile, ...stepData } = s;
        return stepData;
      });
    }

    return await this._buffer.getSteps(sessionId);
  }

  /**
   * Delete a single step by ID.
   * PERF-007: if sessionId is provided, opens the session file directly.
   * Falls back to scan if sessionId is not known.
   * @async
   * @param {string} stepId - Step identifier
   * @param {string} [sessionId] - Optional session identifier for direct lookup
   * @returns {Promise<boolean>} true if deleted, false if not found
   */
  async deleteStep(stepId, sessionId) {
    if (this._isServiceWorker) {
      return await this._buffer.deleteStep(stepId);
    }

    const fsReady = await this.isFilesystemReady();
    if (fsReady) {
      // If sessionId given, go directly to that session
      if (sessionId) {
        const deleted = await this._fileSync.deleteStep(sessionId, stepId);
        if (deleted) return true;
      }

      // Fallback: scan all sessions (legacy path, slower)
      const allSessions = await this._fileSync.readSessionIndex();
      for (const sessionMeta of allSessions) {
        const deleted = await this._fileSync.deleteStep(sessionMeta.sessionId, stepId);
        if (deleted) return true;
      }
    }

    return await this._buffer.deleteStep(stepId);
  }

  /**
   * Update a single step's fields.
   * PERF-007: if step.sessionId is provided, opens the file directly.
   * Falls back to scan if sessionId not in step.
   * FUNC-015: all step fields preserved via spread.
   * @async
   * @param {Object} step - Step object with id and updated fields
   * @returns {Promise<Object>} Updated step object
   */
  async updateStep(step) {
    if (this._isServiceWorker) {
      return await this._buffer.updateStep(step);
    }

    const fsReady = await this.isFilesystemReady();
    if (fsReady) {
      // Prefer direct lookup using step.sessionId
      if (step.sessionId) {
        const updated = await this._fileSync.updateStep(step.sessionId, step.id, step);
        if (updated) return updated;
      }

      // Fallback: scan all sessions
      const allSessions = await this._fileSync.readSessionIndex();
      for (const sessionMeta of allSessions) {
        const updated = await this._fileSync.updateStep(sessionMeta.sessionId, step.id, step);
        if (updated) return updated;
      }
    }

    return await this._buffer.updateStep(step);
  }

  /**
   * Replace all steps for a session.
   * Preserves existing screenshot file references by matching on step ID.
   * @async
   * @param {string} sessionId - Session identifier
   * @param {Array} steps - New array of step objects
   * @returns {Promise<boolean>} true if successful
   */
  async updateAllSteps(sessionId, steps) {
    if (this._isServiceWorker) {
      return await this._buffer.updateAllSteps(sessionId, steps);
    }

    const inBuffer = await this.isInBuffer(sessionId);
    if (inBuffer) {
      return await this._buffer.updateAllSteps(sessionId, steps);
    }

    const fsReady = await this.isFilesystemReady();
    if (fsReady) {
      const data = await this._fileSync.readSession(sessionId);
      if (data) {
        // Preserve existing screenshot file references — match by step id
        const existingScreenshots = new Map();
        for (const s of (data.steps || [])) {
          if (s.screenshotFile) {
            existingScreenshots.set(s.id, s.screenshotFile);
          } else if (s.screenshot) {
            // Legacy inline screenshot — keep it
            existingScreenshots.set(s.id, s.screenshot);
          }
        }
        // Preserve all step fields, restore screenshot reference
        const stepsWithScreenshots = steps.map(s => {
          const existing = existingScreenshots.get(s.id);
          if (!existing) return s;
          // Determine whether it's a file reference or legacy inline
          if (typeof existing === 'string' && existing.startsWith('screenshots/')) {
            return { ...s, screenshotFile: existing };
          } else if (typeof existing === 'string' && existing.startsWith('data:')) {
            return { ...s, screenshot: existing };
          }
          return s;
        });
        const session = { ...data.session, stepCount: steps.length };
        const assets = this._extractAssets(sessionId, stepsWithScreenshots);
        await this._fileSync.writeSession(session, stepsWithScreenshots, assets);
        return true;
      }
    }

    return await this._buffer.updateAllSteps(sessionId, steps);
  }

  /**
   * Apply partial updates to a subset of steps in a session.
   * @async
   * @param {string} sessionId - Session identifier
   * @param {Array<Object>} stepUpdates - Array of step objects with id and updated fields
   * @returns {Promise<Array>} Updated steps array
   */
  async batchUpdateSteps(sessionId, stepUpdates) {
    if (this._isServiceWorker) {
      return await this._buffer.batchUpdateSteps(sessionId, stepUpdates);
    }

    const fsReady = await this.isFilesystemReady();
    if (fsReady) {
      const data = await this._fileSync.readSession(sessionId);
      if (data) {
        const updateMap = new Map(stepUpdates.map(s => [s.id, s]));
        // Spread preserves all fields
        const steps = (data.steps || []).map(step => {
          const update = updateMap.get(step.id);
          return update ? { ...step, ...update } : step;
        });
        const assets = this._extractAssets(sessionId, steps);
        await this._fileSync.writeSession(data.session, steps, assets);
        return steps;
      }
    }

    return await this._buffer.batchUpdateSteps(sessionId, stepUpdates);
  }

  /**
   * Delete multiple steps by ID.
   * PERF-007: groups by session to minimize file rewrites.
   * @async
   * @param {Array<string>} stepIds - Array of step IDs to delete
   * @returns {Promise<number>} Total number of steps deleted
   */
  async batchDeleteSteps(stepIds) {
    if (this._isServiceWorker) {
      return await this._buffer.batchDeleteSteps(stepIds);
    }

    const stepIdSet = new Set(stepIds);
    let totalDeleted = 0;

    const fsReady = await this.isFilesystemReady();
    if (fsReady) {
      const allSessions = await this._fileSync.readSessionIndex();
      for (const sessionMeta of allSessions) {
        const data = await this._fileSync.readSession(sessionMeta.sessionId);
        if (!data) continue;
        const steps = data.steps || [];
        const toDelete = steps.filter(s => stepIdSet.has(s.id));
        if (toDelete.length === 0) continue;

        // Delete screenshot files for removed steps (PERF-007)
        const handle = await this._fileSync.getHandle();
        if (handle) {
          const sessionDir = await this._fileSync._findSessionFolder(handle, sessionMeta.sessionId);
          if (sessionDir) {
            for (const step of toDelete) {
              if (step.screenshotFile) {
                await this._fileSync._deleteScreenshot(sessionDir, step.screenshotFile);
              }
            }
          }
        }

        const filtered = steps.filter(s => !stepIdSet.has(s.id));
        const session = { ...data.session, stepCount: filtered.length };
        const assets = this._extractAssets(sessionMeta.sessionId, filtered);
        await this._fileSync.writeSession(session, filtered, assets);
        totalDeleted += toDelete.length;
      }
    }

    return totalDeleted;
  }

  // ════════════════════════════════════════════════════════════════
  // Asset operations
  // ════════════════════════════════════════════════════════════════

  /**
   * Add (embed) an asset screenshot into the owning step on the filesystem.
   * @async
   * @param {Object} asset - Asset object with sessionId, stepId, dataUrl
   * @returns {Promise<Object>} The added asset
   */
  async addAsset(asset) {
    if (this._isServiceWorker) {
      return await this._buffer.addAsset(asset);
    }

    const inBuffer = await this.isInBuffer(asset.sessionId);
    if (inBuffer) {
      return await this._buffer.addAsset(asset);
    }

    const fsReady = await this.isFilesystemReady();
    if (fsReady) {
      const data = await this._fileSync.readSession(asset.sessionId);
      if (data) {
        // Write screenshot to binary file and update the step's screenshotFile field
        const steps = [...(data.steps || [])];
        let updated = false;
        for (let i = 0; i < steps.length; i++) {
          if (steps[i].id === asset.stepId && asset.dataUrl) {
            const handle = await this._fileSync.getHandle();
            if (handle) {
              const sessionDir = await this._fileSync._findSessionFolder(handle, asset.sessionId);
              if (sessionDir) {
                const screenshotFile = await this._fileSync._writeScreenshot(sessionDir, asset.stepId, asset.dataUrl);
                // Preserve all step fields
                const { screenshot: _sc, ...stepFields } = steps[i];
                steps[i] = { ...stepFields, screenshotFile };
                updated = true;
              }
            }
            break;
          }
        }
        if (updated) {
          const assets = this._extractAssets(asset.sessionId, steps);
          await this._fileSync.writeSession(data.session, steps, assets);
        }
        return asset;
      }
    }

    return await this._buffer.addAsset(asset);
  }

  /**
   * Get all assets for a session.
   * On the filesystem, assets are loaded from binary screenshot files.
   * @async
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Array>} Array of asset objects
   */
  async getAllAssets(sessionId) {
    if (this._isServiceWorker) {
      return await this._buffer.getAllAssets(sessionId);
    }

    const inBuffer = await this.isInBuffer(sessionId);
    if (inBuffer) {
      return await this._buffer.getAllAssets(sessionId);
    }

    const fsReady = await this.isFilesystemReady();
    if (fsReady) {
      return await this._fileSync.readAssets(sessionId);
    }

    return await this._buffer.getAllAssets(sessionId);
  }

  /**
   * Get all assets associated with a specific step ID.
   * @async
   * @param {string} stepId - Step identifier
   * @returns {Promise<Array>} Array of asset objects for the step
   */
  async getAssetsByStepId(stepId) {
    if (this._isServiceWorker) {
      return await this._buffer.getAssetsByStepId(stepId);
    }

    const fsReady = await this.isFilesystemReady();
    if (fsReady) {
      const allSessions = await this._fileSync.readSessionIndex();
      for (const sessionMeta of allSessions) {
        const assets = await this._fileSync.readAssets(sessionMeta.sessionId);
        const matched = assets.filter(a => a.stepId === stepId);
        if (matched.length > 0) return matched;
      }
    }

    // Also check buffer
    return await this._buffer.getAssetsByStepId(stepId);
  }

  /**
   * Delete all assets for a session by removing screenshot files and clearing references.
   * @async
   * @param {string} sessionId - Session identifier
   * @returns {Promise<boolean>} true if successful
   */
  async deleteAssets(sessionId) {
    if (this._isServiceWorker) {
      return await this._buffer.deleteAssets(sessionId);
    }

    const fsReady = await this.isFilesystemReady();
    if (fsReady) {
      const data = await this._fileSync.readSession(sessionId);
      if (data) {
        const handle = await this._fileSync.getHandle();
        if (handle) {
          const sessionDir = await this._fileSync._findSessionFolder(handle, sessionId);
          if (sessionDir) {
            // Delete all screenshot binary files
            for (const step of (data.steps || [])) {
              if (step.screenshotFile) {
                await this._fileSync._deleteScreenshot(sessionDir, step.screenshotFile);
              }
            }
          }
        }

        // Remove screenshotFile references from steps
        const steps = (data.steps || []).map(s => {
          const { screenshotFile, screenshot, ...rest } = s;
          return rest;
        });
        await this._fileSync.writeSession(data.session, steps, []);
        return true;
      }
    }

    return await this._buffer.deleteAssets(sessionId);
  }

  // ════════════════════════════════════════════════════════════════
  // Storage usage
  // ════════════════════════════════════════════════════════════════

  /**
   * Get storage usage statistics.
   * @async
   * @returns {Promise<Object>} Usage object { used, total, percentage, warning, error, filesystem }
   */
  async getStorageUsage() {
    if (this._isServiceWorker) {
      return await this._buffer.getStorageUsage();
    }

    // Filesystem has no meaningful quota — return a safe indicator
    return {
      used: 0,
      total: Infinity,
      percentage: 0,
      warning: false,
      error: false,
      filesystem: true
    };
  }

  // ════════════════════════════════════════════════════════════════
  // Export / Import (PERF-016)
  // ════════════════════════════════════════════════════════════════

  /**
   * Export all data for backup.
   *
   * PERF-016 fix:
   * - Filesystem path: reads directly from FileSync in the window context —
   *   no runtime message bus involved, no 64MB message limit.
   * - chrome.storage path: estimates payload size first. If it would exceed
   *   50MB, aborts with a user-friendly error instead of silently crashing.
   *
   * @async
   * @returns {Promise<Object>} Complete data export with meta and sessions
   * @throws {Error} If payload would exceed the safe size limit (chrome.storage path)
   */
  async exportAllData() {
    if (this._isServiceWorker) {
      return await this._buffer.exportAllData();
    }

    const fsReady = await this.isFilesystemReady();
    if (fsReady) {
      // Read directly via FileSync — no message bus
      const allData = await this._fileSync.readAllSessionsFull();
      return {
        meta: { version: 2, sessionCount: allData.length },
        sessions: allData.map(data => ({
          ...data.session,
          steps: (data.steps || []).map(s => {
            // Strip on-disk-only fields from exported data
            const { screenshotFile, screenshot, ...stepData } = s;
            return stepData;
          }),
          assets: [] // Screenshots are stored as binary files; not included in JSON export
        }))
      };
    }

    // chrome.storage fallback — guard against oversized payload (PERF-016)
    const allSessions = await this._buffer.getAllSessions();
    let estimatedSize = 0;
    const sessionPayloads = [];

    for (const session of allSessions) {
      const steps = await this._buffer.getSteps(session.sessionId);
      const assets = await this._buffer.getAllAssets(session.sessionId);
      const payload = { ...session, steps, assets };
      const serialized = JSON.stringify(payload);
      estimatedSize += serialized.length;

      if (estimatedSize > EXPORT_SIZE_LIMIT_BYTES) {
        throw new Error(
          `Export aborted: payload would exceed ${Math.round(EXPORT_SIZE_LIMIT_BYTES / 1024 / 1024)}MB safe limit. ` +
          'Configure a storage folder (File System mode) to export large datasets without size restrictions.'
        );
      }
      sessionPayloads.push(payload);
    }

    return {
      meta: { version: 2, sessionCount: sessionPayloads.length },
      sessions: sessionPayloads
    };
  }

  /**
   * Import data from backup.
   * @async
   * @param {Object} data - Backup data with meta and sessions
   * @returns {Promise<boolean>} true if successful
   * @throws {Error} If data structure is invalid
   */
  async importData(data) {
    if (!data || !data.meta || !Array.isArray(data.sessions)) {
      throw new Error('Invalid backup data structure');
    }

    const fsReady = await this.isFilesystemReady();
    if (fsReady && !this._isServiceWorker) {
      for (const session of data.sessions) {
        const { steps, assets, ...meta } = session;
        await this._fileSync.writeSession(meta, steps || [], assets || []);
      }
      return true;
    }

    return await this._buffer.importData(data);
  }

  // ════════════════════════════════════════════════════════════════
  // Cleanup (filesystem doesn't need orphan cleanup the same way)
  // ════════════════════════════════════════════════════════════════

  /**
   * Cleanup orphaned assets (no-op for filesystem storage).
   * @async
   * @returns {Promise<number>} Always 0 for filesystem
   */
  async cleanupOrphans() {
    return 0;
  }

  /**
   * Find orphaned assets (no-op for filesystem storage).
   * @async
   * @returns {Promise<Array>} Always empty for filesystem
   */
  async findOrphanedAssets() {
    return [];
  }

  /** Add quota warning listener (no-op for filesystem) */
  onQuotaWarning() {}

  /** Remove quota warning listener (no-op for filesystem) */
  offQuotaWarning() {}

  // ════════════════════════════════════════════════════════════════
  // Internal helpers
  // ════════════════════════════════════════════════════════════════

  /**
   * Extract assets from steps that have embedded screenshots.
   * Handles both new screenshotFile references and legacy inline screenshots.
   * Returns in the asset format expected by writeSession.
   * @private
   * @param {string} sessionId - Session identifier
   * @param {Array} steps - Array of step objects
   * @returns {Array} Array of asset objects
   */
  _extractAssets(sessionId, steps) {
    const assets = [];
    for (const step of steps) {
      // New format: screenshotFile reference — no dataUrl inline
      // Old format: screenshot inline base64
      if (step.screenshot) {
        assets.push({
          id: `asset_${step.id}`,
          sessionId,
          stepId: step.id,
          type: 'screenshot',
          dataUrl: step.screenshot
        });
      }
      // Note: steps with screenshotFile are already on disk — no asset object needed
    }
    return assets;
  }
}
