/**
 * Storage Module - SOLID SOLUTION: Handles IndexedDB with blob support
 */

class StorageManager {
  constructor() {
    this.dbName = 'TestSnapperDB';
    this.version = 2; // ✅ Increment version for schema update
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Create sessions store
        if (!db.objectStoreNames.contains('sessions')) {
          const sessionStore = db.createObjectStore('sessions', { keyPath: 'sessionId' });
          sessionStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // Create steps store
        if (!db.objectStoreNames.contains('steps')) {
          const stepStore = db.createObjectStore('steps', { keyPath: 'id' });
          stepStore.createIndex('sessionId', 'sessionId', { unique: false });
          stepStore.createIndex('timestamp', 'timestamp', { unique: false });
          stepStore.createIndex('sequence', 'sequence', { unique: false });
        }

        // ✅ Create assets store for screenshots (blob storage)
        if (!db.objectStoreNames.contains('assets')) {
          const assetStore = db.createObjectStore('assets', { keyPath: 'id' });
          assetStore.createIndex('sessionId', 'sessionId', { unique: false });
          assetStore.createIndex('stepId', 'stepId', { unique: false });
          assetStore.createIndex('type', 'type', { unique: false });
        }
      };
    });
  }

  async createSession(sessionData) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['sessions'], 'readwrite');
      const store = transaction.objectStore('sessions');
      const request = store.add(sessionData);

      request.onsuccess = () => resolve(sessionData);
      request.onerror = () => reject(request.error);
    });
  }

  async getSession(sessionId) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['sessions'], 'readonly');
      const store = transaction.objectStore('sessions');
      const request = store.get(sessionId);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async updateSession(sessionData) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['sessions'], 'readwrite');
      const store = transaction.objectStore('sessions');
      const request = store.put(sessionData);

      request.onsuccess = () => resolve(sessionData);
      request.onerror = () => reject(request.error);
    });
  }

  async addStep(step) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['steps'], 'readwrite');
      const store = transaction.objectStore('steps');
      const request = store.add(step);

      request.onsuccess = () => resolve(step);
      request.onerror = () => reject(request.error);
    });
  }

  async getSteps(sessionId) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['steps'], 'readonly');
      const store = transaction.objectStore('steps');
      const index = store.index('sessionId');
      const request = index.getAll(sessionId);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async deleteStep(stepId) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['steps'], 'readwrite');
      const store = transaction.objectStore('steps');
      const request = store.delete(stepId);

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * ✅ NEW: Add asset (screenshot blob)
   */
  async addAsset(asset) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['assets'], 'readwrite');
      const store = transaction.objectStore('assets');
      const request = store.add(asset);

      request.onsuccess = () => resolve(asset);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * ✅ NEW: Get all assets for a session
   */
  async getAllAssets(sessionId) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['assets'], 'readonly');
      const store = transaction.objectStore('assets');
      const index = store.index('sessionId');
      const request = index.getAll(sessionId);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * ✅ NEW: Get assets for a specific step
   */
  async getAssetsByStepId(stepId) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['assets'], 'readonly');
      const store = transaction.objectStore('assets');
      const index = store.index('stepId');
      const request = index.getAll(stepId);

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * ✅ NEW: Delete all assets for a session
   */
  async deleteAssets(sessionId) {
    if (!this.db) await this.init();

    return new Promise(async (resolve, reject) => {
      try {
        const assets = await this.getAllAssets(sessionId);
        const transaction = this.db.transaction(['assets'], 'readwrite');
        const store = transaction.objectStore('assets');

        for (const asset of assets) {
          store.delete(asset.id);
        }

        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => reject(transaction.error);
      } catch (error) {
        reject(error);
      }
    });
  }

  async clearSession(sessionId) {
    if (!this.db) await this.init();

    return new Promise(async (resolve, reject) => {
      try {
        // Delete all steps
        const steps = await this.getSteps(sessionId);
        for (const step of steps) {
          await this.deleteStep(step.id);
        }

        // ✅ Delete all assets
        await this.deleteAssets(sessionId);

        // Delete session
        const transaction = this.db.transaction(['sessions'], 'readwrite');
        const store = transaction.objectStore('sessions');
        const request = store.delete(sessionId);

        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
      } catch (error) {
        reject(error);
      }
    });
  }

  async getAllSessions() {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['sessions'], 'readonly');
      const store = transaction.objectStore('sessions');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async updateSessionName(sessionId, sessionName) {
    const tx = this.db.transaction(['sessions'], 'readwrite');
    const store = tx.objectStore('sessions');
    const session = await store.get(sessionId);

    if (session) {
      session.sessionName = sessionName;
      await store.put(session);
    }

    await tx.done;
  }

  async updateAllSteps(sessionId, steps) {
    const tx = this.db.transaction(['steps'], 'readwrite');
    const store = tx.objectStore('steps');

    // Delete all existing steps for this session
    const index = store.index('sessionId');
    const existingSteps = await index.getAll(sessionId);

    for (const step of existingSteps) {
      await store.delete(step.id);
    }

    // Add updated steps
    for (const step of steps) {
      await store.put(step);
    }

    await tx.done;

    // Update session step count
    const sessionTx = this.db.transaction(['sessions'], 'readwrite');
    const sessionStore = sessionTx.objectStore('sessions');
    const session = await sessionStore.get(sessionId);

    if (session) {
      session.stepCount = steps.length;
      await sessionStore.put(session);
    }

    await sessionTx.done;
  }
}

export { StorageManager };