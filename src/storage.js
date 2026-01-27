/**
 * Storage Module - FIXED: Transaction deadlocks and error recovery
 */

class StorageManager {
  constructor() {
    this.dbName = 'TestSnapperDB';
    this.version = 2;
    this.db = null;
    // 🔧 FIX #6: Add retry configuration
    this.maxRetries = 3;
    this.retryDelay = 100;
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

        if (!db.objectStoreNames.contains('sessions')) {
          const sessionStore = db.createObjectStore('sessions', { keyPath: 'sessionId' });
          sessionStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        if (!db.objectStoreNames.contains('steps')) {
          const stepStore = db.createObjectStore('steps', { keyPath: 'id' });
          stepStore.createIndex('sessionId', 'sessionId', { unique: false });
          stepStore.createIndex('timestamp', 'timestamp', { unique: false });
          stepStore.createIndex('sequence', 'sequence', { unique: false });
        }

        if (!db.objectStoreNames.contains('assets')) {
          const assetStore = db.createObjectStore('assets', { keyPath: 'id' });
          assetStore.createIndex('sessionId', 'sessionId', { unique: false });
          assetStore.createIndex('stepId', 'stepId', { unique: false });
          assetStore.createIndex('type', 'type', { unique: false });
        }
      };
    });
  }

  /**
   * 🔧 FIX #6: Generic retry wrapper for operations
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

  async createSession(sessionData) {
    if (!this.db) await this.init();

    return this._retryOperation(() => {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['sessions'], 'readwrite');
        const store = transaction.objectStore('sessions');
        const request = store.add(sessionData);

        request.onsuccess = () => resolve(sessionData);
        request.onerror = () => reject(request.error);

        // 🔧 FIX #6: Handle transaction errors
        transaction.onerror = () => reject(transaction.error);
      });
    }, 'createSession');
  }

  async getSession(sessionId) {
    if (!this.db) await this.init();

    return this._retryOperation(() => {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['sessions'], 'readonly');
        const store = transaction.objectStore('sessions');
        const request = store.get(sessionId);

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.onerror = () => reject(transaction.error);
      });
    }, 'getSession');
  }

  async updateSession(sessionData) {
    if (!this.db) await this.init();

    return this._retryOperation(() => {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['sessions'], 'readwrite');
        const store = transaction.objectStore('sessions');
        const request = store.put(sessionData);

        request.onsuccess = () => resolve(sessionData);
        request.onerror = () => reject(request.error);
        transaction.onerror = () => reject(transaction.error);
      });
    }, 'updateSession');
  }

  async addStep(step) {
    if (!this.db) await this.init();

    return this._retryOperation(() => {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['steps'], 'readwrite');
        const store = transaction.objectStore('steps');
        const request = store.add(step);

        request.onsuccess = () => resolve(step);
        request.onerror = () => reject(request.error);
        transaction.onerror = () => reject(transaction.error);
      });
    }, 'addStep');
  }

  async getSteps(sessionId) {
    if (!this.db) await this.init();

    return this._retryOperation(() => {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['steps'], 'readonly');
        const store = transaction.objectStore('steps');
        const index = store.index('sessionId');
        const request = index.getAll(sessionId);

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
        transaction.onerror = () => reject(transaction.error);
      });
    }, 'getSteps');
  }

  async deleteStep(stepId) {
    if (!this.db) await this.init();
    if (!stepId) throw new Error("Step ID is required");

    return this._retryOperation(() => {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['steps'], 'readwrite');
        const store = transaction.objectStore('steps');
        const request = store.delete(stepId);

        request.onsuccess = () => resolve(true);
        request.onerror = () => reject(request.error);
        transaction.onerror = () => reject(transaction.error);
      });
    }, 'deleteStep');
  }

  async updateStep(step) {
    if (!this.db) await this.init();
    if (!step || !step.id) throw new Error("Valid step with ID is required");

    return this._retryOperation(() => {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['steps'], 'readwrite');
        const store = transaction.objectStore('steps');
        const request = store.put(step);

        request.onsuccess = () => resolve(step);
        request.onerror = () => reject(request.error);
        transaction.onerror = () => reject(transaction.error);
      });
    }, 'updateStep');
  }

  async addAsset(asset) {
    if (!this.db) await this.init();

    return this._retryOperation(() => {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['assets'], 'readwrite');
        const store = transaction.objectStore('assets');
        const request = store.add(asset);

        request.onsuccess = () => resolve(asset);
        request.onerror = () => reject(request.error);
        transaction.onerror = () => reject(transaction.error);
      });
    }, 'addAsset');
  }

  async getAllAssets(sessionId) {
    if (!this.db) await this.init();

    return this._retryOperation(() => {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['assets'], 'readonly');
        const store = transaction.objectStore('assets');
        const index = store.index('sessionId');
        const request = index.getAll(sessionId);

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
        transaction.onerror = () => reject(transaction.error);
      });
    }, 'getAllAssets');
  }

  async getAssetsByStepId(stepId) {
    if (!this.db) await this.init();

    return this._retryOperation(() => {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['assets'], 'readonly');
        const store = transaction.objectStore('assets');
        const index = store.index('stepId');
        const request = index.getAll(stepId);

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
        transaction.onerror = () => reject(transaction.error);
      });
    }, 'getAssetsByStepId');
  }

  async deleteAssets(sessionId) {
    if (!this.db) await this.init();

    return this._retryOperation(async () => {
      const assets = await this.getAllAssets(sessionId);

      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['assets'], 'readwrite');
        const store = transaction.objectStore('assets');

        for (const asset of assets) {
          store.delete(asset.id);
        }

        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => reject(transaction.error);
      });
    }, 'deleteAssets');
  }

  async clearSession(sessionId) {
    if (!this.db) await this.init();

    // 🔧 FIX #6: Sequential operations with proper error handling
    return this._retryOperation(async () => {
      try {
        // Step 1: Delete all steps
        const steps = await this.getSteps(sessionId);
        for (const step of steps) {
          await this.deleteStep(step.id);
        }

        // Step 2: Delete all assets
        await this.deleteAssets(sessionId);

        // Step 3: Delete session
        return new Promise((resolve, reject) => {
          const transaction = this.db.transaction(['sessions'], 'readwrite');
          const store = transaction.objectStore('sessions');
          const request = store.delete(sessionId);

          request.onsuccess = () => resolve(true);
          request.onerror = () => reject(request.error);
          transaction.onerror = () => reject(transaction.error);
        });
      } catch (error) {
        console.error('clearSession partial failure:', error);
        throw error;
      }
    }, 'clearSession');
  }

  async getAllSessions() {
    if (!this.db) await this.init();

    return this._retryOperation(() => {
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['sessions'], 'readonly');
        const store = transaction.objectStore('sessions');
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
        transaction.onerror = () => reject(transaction.error);
      });
    }, 'getAllSessions');
  }

  /**
   * 🔧 FIX #6: Atomic update with rollback on failure
   */
  async updateSessionName(sessionId, sessionName) {
    if (!this.db) await this.init();

    return this._retryOperation(() => {
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
        transaction.onerror = () => reject(transaction.error);
      });
    }, 'updateSessionName');
  }

  async updateAllSteps(sessionId, steps) {
    if (!this.db) await this.init();

    return this._retryOperation(async () => {
      // Use a single transaction for all operations
      return new Promise((resolve, reject) => {
        const transaction = this.db.transaction(['steps', 'sessions'], 'readwrite');
        const stepStore = transaction.objectStore('steps');
        const sessionStore = transaction.objectStore('sessions');
        const stepIndex = stepStore.index('sessionId');

        // Step 1: Get all existing steps
        const getExistingRequest = stepIndex.getAll(sessionId);

        getExistingRequest.onsuccess = () => {
          const existingSteps = getExistingRequest.result;

          // Step 2: Delete existing steps
          for (const step of existingSteps) {
            stepStore.delete(step.id);
          }

          // Step 3: Add new steps
          for (const step of steps) {
            stepStore.put(step);
          }

          // Step 4: Update session count
          const sessionRequest = sessionStore.get(sessionId);

          sessionRequest.onsuccess = () => {
            const session = sessionRequest.result;
            if (session) {
              session.stepCount = steps.length;
              sessionStore.put(session);
            }
          };

          sessionRequest.onerror = () => {
            console.error('Failed to update session during step update');
          };
        };

        getExistingRequest.onerror = () => reject(getExistingRequest.error);

        // Transaction completes or aborts atomically
        transaction.oncomplete = () => {
          console.log('✅ All steps updated successfully in single transaction');
          resolve(true);
        };

        transaction.onerror = () => {
          console.error('❌ Transaction failed, rolling back all changes');
          reject(transaction.error);
        };

        transaction.onabort = () => {
          console.error('❌ Transaction aborted');
          reject(new Error('Transaction aborted'));
        };
      });
    }, 'updateAllSteps');
  }
}

export { StorageManager };