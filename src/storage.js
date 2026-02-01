/**
 * Storage Module — chrome.storage.local (file-based, persistent)
 *
 * Replaces IndexedDB with chrome.storage.local, which persists data to a flat
 * file on disk managed by Chrome. All public methods keep the same signatures
 * so the rest of the extension needs zero changes.
 *
 * Data layout (single key):
 *   testsnapper_data → {
 *     sessions: [
 *       {
 *         sessionId, sessionName, createdAt, env, stepCount,
 *         steps:  [{ id, sessionId, action, fieldName, selector, value, url, timestamp, sequence, ... }],
 *         assets: [{ id, sessionId, stepId, type, data, ... }]
 *       },
 *       ...
 *     ]
 *   }
 *
 * Add "storage" permission and optionally "unlimitedStorage" (removes 10 MB
 * quota) to manifest.json.
 */

const STORAGE_KEY = 'testsnapper_data';

class StorageManager {
  constructor() {
    this.maxRetries = 3;
    this.retryDelay = 100; // ms base; multiplied by attempt number
  }

  // ────────────────────────────────────────────────────────────
  // Internal helpers
  // ────────────────────────────────────────────────────────────

  /**
   * Read the entire data blob from chrome.storage.local.
   * Returns { sessions: [...] }, never undefined.
   */
  async _read() {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return result[STORAGE_KEY] || { sessions: [] };
  }

  /**
   * Persist the entire data blob back to chrome.storage.local.
   */
  async _write(data) {
    await chrome.storage.local.set({ [STORAGE_KEY]: data });
  }

  /**
   * Generic retry wrapper — identical contract to the old IndexedDB version.
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

  // ────────────────────────────────────────────────────────────
  // Public API  (same signatures as the old IndexedDB version)
  // ────────────────────────────────────────────────────────────

  /**
   * No-op for chrome.storage.local — kept so callers that do `await storage.init()`
   * continue to work without changes.
   */
  async init() {
    // Verify the API is available (fails fast in non-extension contexts)
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      throw new Error('chrome.storage.local is not available. Are you running inside a Chrome extension?');
    }
    return true;
  }

  // ── Sessions ──────────────────────────────────────────────

  async createSession(sessionData) {
    return this._retryOperation(async () => {
      const data = await this._read();

      // Duplicate guard
      if (this._findSessionIndex(data.sessions, sessionData.sessionId) !== -1) {
        throw new Error(`Session ${sessionData.sessionId} already exists`);
      }

      // Ensure embedded arrays exist
      const session = { ...sessionData, steps: [], assets: [] };
      data.sessions.push(session);
      await this._write(data);
      return session;
    }, 'createSession');
  }

  async getSession(sessionId) {
    return this._retryOperation(async () => {
      const data = await this._read();
      const session = data.sessions.find(s => s.sessionId === sessionId);
      return session || null;
    }, 'getSession');
  }

  async updateSession(sessionData) {
    return this._retryOperation(async () => {
      const data = await this._read();
      const idx = this._findSessionIndex(data.sessions, sessionData.sessionId);

      if (idx === -1) {
        throw new Error(`Session ${sessionData.sessionId} not found`);
      }

      // Preserve steps and assets that live on the stored object
      const existing = data.sessions[idx];
      data.sessions[idx] = {
        ...sessionData,
        steps: sessionData.steps || existing.steps || [],
        assets: sessionData.assets || existing.assets || []
      };

      await this._write(data);
      return data.sessions[idx];
    }, 'updateSession');
  }

  async getAllSessions() {
    return this._retryOperation(async () => {
      const data = await this._read();
      // Return sessions without the embedded steps/assets arrays for list views
      return data.sessions.map(({ steps, assets, ...meta }) => ({
        ...meta,
        stepCount: steps ? steps.length : (meta.stepCount || 0)
      }));
    }, 'getAllSessions');
  }

  async updateSessionName(sessionId, sessionName) {
    return this._retryOperation(async () => {
      const data = await this._read();
      const idx = this._findSessionIndex(data.sessions, sessionId);

      if (idx === -1) throw new Error('Session not found');

      data.sessions[idx].sessionName = sessionName;
      await this._write(data);
      return data.sessions[idx];
    }, 'updateSessionName');
  }

  // ── Steps ─────────────────────────────────────────────────

  async addStep(step) {
    return this._retryOperation(async () => {
      const data = await this._read();
      const idx = this._findSessionIndex(data.sessions, step.sessionId);

      if (idx === -1) throw new Error(`Session ${step.sessionId} not found`);

      data.sessions[idx].steps.push(step);
      data.sessions[idx].stepCount = data.sessions[idx].steps.length;
      await this._write(data);
      return step;
    }, 'addStep');
  }

  async getSteps(sessionId) {
    return this._retryOperation(async () => {
      const data = await this._read();
      const session = data.sessions.find(s => s.sessionId === sessionId);
      return session ? [...session.steps] : [];
    }, 'getSteps');
  }

  async deleteStep(stepId) {
    return this._retryOperation(async () => {
      if (!stepId) throw new Error('Step ID is required');

      const data = await this._read();

      for (const session of data.sessions) {
        const beforeLen = session.steps.length;
        session.steps = session.steps.filter(s => s.id !== stepId);

        if (session.steps.length < beforeLen) {
          session.stepCount = session.steps.length;
          await this._write(data);
          return true;
        }
      }

      // Step not found in any session — not an error, just a no-op
      return false;
    }, 'deleteStep');
  }

  async updateStep(step) {
    return this._retryOperation(async () => {
      if (!step || !step.id) throw new Error('Valid step with ID is required');

      const data = await this._read();

      for (const session of data.sessions) {
        const idx = session.steps.findIndex(s => s.id === step.id);
        if (idx !== -1) {
          session.steps[idx] = { ...session.steps[idx], ...step };
          await this._write(data);
          return session.steps[idx];
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
      const data = await this._read();
      const idx = this._findSessionIndex(data.sessions, sessionId);

      if (idx === -1) throw new Error(`Session ${sessionId} not found`);

      data.sessions[idx].steps = steps;
      data.sessions[idx].stepCount = steps.length;
      await this._write(data);

      console.log('✅ All steps updated successfully');
      return true;
    }, 'updateAllSteps');
  }

  // ── Assets ────────────────────────────────────────────────

  async addAsset(asset) {
    return this._retryOperation(async () => {
      const data = await this._read();
      const idx = this._findSessionIndex(data.sessions, asset.sessionId);

      if (idx === -1) throw new Error(`Session ${asset.sessionId} not found`);

      data.sessions[idx].assets.push(asset);
      await this._write(data);
      return asset;
    }, 'addAsset');
  }

  async getAllAssets(sessionId) {
    return this._retryOperation(async () => {
      const data = await this._read();
      const session = data.sessions.find(s => s.sessionId === sessionId);
      return session ? [...session.assets] : [];
    }, 'getAllAssets');
  }

  async getAssetsByStepId(stepId) {
    return this._retryOperation(async () => {
      const data = await this._read();

      for (const session of data.sessions) {
        const matched = session.assets.filter(a => a.stepId === stepId);
        if (matched.length > 0) return matched;
      }
      return [];
    }, 'getAssetsByStepId');
  }

  async deleteAssets(sessionId) {
    return this._retryOperation(async () => {
      const data = await this._read();
      const idx = this._findSessionIndex(data.sessions, sessionId);

      if (idx === -1) return true; // nothing to delete

      data.sessions[idx].assets = [];
      await this._write(data);
      return true;
    }, 'deleteAssets');
  }

  // ── Session lifecycle ─────────────────────────────────────

  /**
   * Delete a session and all its steps + assets in one atomic write.
   */
  async clearSession(sessionId) {
    return this._retryOperation(async () => {
      const data = await this._read();
      const idx = this._findSessionIndex(data.sessions, sessionId);

      if (idx === -1) return true; // already gone

      data.sessions.splice(idx, 1);
      await this._write(data);
      console.log(`✅ Session ${sessionId} cleared`);
      return true;
    }, 'clearSession');
  }
}

export { StorageManager };