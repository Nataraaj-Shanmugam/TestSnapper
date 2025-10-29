/**
 * Storage Module - Handles IndexedDB operations for sessions and steps
 */

class StorageManager {
  constructor() {
    this.dbName = 'TestSnapperDB';
    this.version = 1;
    this.db = null;
  }

  /**
   * Initialize IndexedDB
   */
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
        }

        // Create assets store (for screenshots)
        if (!db.objectStoreNames.contains('assets')) {
          const assetStore = db.createObjectStore('assets', { keyPath: 'id' });
          assetStore.createIndex('sessionId', 'sessionId', { unique: false });
        }
      };
    });
  }

  /**
   * Create a new session
   */
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

  /**
   * Get session by ID
   */
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

  /**
   * Update session
   */
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

  /**
   * Add step to session
   */
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

  /**
   * Get all steps for a session
   */
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

  /**
   * Delete step
   */
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
   * Clear all data for a session
   */
  async clearSession(sessionId) {
    if (!this.db) await this.init();

    return new Promise(async (resolve, reject) => {
      try {
        // Delete all steps
        const steps = await this.getSteps(sessionId);
        for (const step of steps) {
          await this.deleteStep(step.id);
        }

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
}

// Ensure export is at the very end
export { StorageManager };