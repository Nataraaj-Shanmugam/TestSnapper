/**
 * Storage Module - FIXED: Proper IndexedDB transactions
 */

class StorageManager {
  constructor() {
    this.dbName = 'TestSnapperDB';
    this.version = 2;
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

        // Create assets store for screenshots (blob storage)
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
    if (!stepId) throw new Error("Step ID is required");

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['steps'], 'readwrite');
      const store = transaction.objectStore('steps');
      const request = store.delete(stepId);

      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  async updateStep(step) {
    if (!this.db) await this.init();
    if (!step || !step.id) throw new Error("Valid step with ID is required");

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['steps'], 'readwrite');
      const store = transaction.objectStore('steps');
      const request = store.put(step);

      request.onsuccess = () => resolve(step);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Add asset (screenshot blob)
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
   * Get all assets for a session
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
   * Get assets for a specific step
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
   * Delete all assets for a session
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

        // Delete all assets
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

  /**
   * ✅ FIXED: Update session name with proper transaction handling
   */
  async updateSessionName(sessionId, sessionName) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['sessions'], 'readwrite');
      const store = transaction.objectStore('sessions');
      const getRequest = store.get(sessionId);

      getRequest.onsuccess = () => {
        const session = getRequest.result;
        if (session) {
          session.sessionName = sessionName;
          const putRequest = store.put(session);
          
          putRequest.onsuccess = () => resolve(session);
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          reject(new Error('Session not found'));
        }
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * ✅ FIXED: Update all steps with proper transaction handling
   */
  async updateAllSteps(sessionId, steps) {
    if (!this.db) await this.init();

    return new Promise(async (resolve, reject) => {
      try {
        // First, delete all existing steps for this session
        const transaction1 = this.db.transaction(['steps'], 'readwrite');
        const store1 = transaction1.objectStore('steps');
        const index = store1.index('sessionId');
        const existingRequest = index.getAll(sessionId);

        existingRequest.onsuccess = () => {
          const existingSteps = existingRequest.result;
          
          for (const step of existingSteps) {
            store1.delete(step.id);
          }
        };

        await new Promise((res, rej) => {
          transaction1.oncomplete = res;
          transaction1.onerror = () => rej(transaction1.error);
        });

        // Then, add updated steps
        const transaction2 = this.db.transaction(['steps'], 'readwrite');
        const store2 = transaction2.objectStore('steps');

        for (const step of steps) {
          store2.put(step);
        }

        await new Promise((res, rej) => {
          transaction2.oncomplete = res;
          transaction2.onerror = () => rej(transaction2.error);
        });

        // Finally, update session step count
        const transaction3 = this.db.transaction(['sessions'], 'readwrite');
        const sessionStore = transaction3.objectStore('sessions');
        const sessionRequest = sessionStore.get(sessionId);

        sessionRequest.onsuccess = () => {
          const session = sessionRequest.result;
          if (session) {
            session.stepCount = steps.length;
            sessionStore.put(session);
          }
        };

        transaction3.oncomplete = () => resolve(true);
        transaction3.onerror = () => reject(transaction3.error);

      } catch (error) {
        reject(error);
      }
    });
  }
}

export { StorageManager };