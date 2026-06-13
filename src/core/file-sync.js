/**
 * FileSync — File System Access API wrapper for primary filesystem storage
 *
 * Chrome extensions' service workers cannot use the File System Access API,
 * so this module runs exclusively in window contexts (popup, review page).
 * During active recording, data buffers in chrome.storage.local; when
 * recording stops, it flushes to the filesystem via this module.
 *
 * Directory handle is persisted in IndexedDB so permission survives across
 * page reloads (though a browser restart may require re-authorization via
 * a user gesture).
 *
 * Folder structure on disk (PERF-007 split format):
 *   <chosen-folder>/
 *     .TestSnapper/
 *       sessions.json                         — lightweight index of all sessions
 *       {SessionName}_{shortId}/
 *         session.json                        — metadata + steps (NO image data)
 *         screenshots/
 *           {stepId}.jpg (or .png)            — binary screenshot files
 *
 * Screenshots are stored as separate binary files so that session.json stays
 * small and step edits / drag-and-drop reordering only read/write the compact
 * metadata file rather than a potentially 100MB+ combined file.
 *
 * FUNC-015 fix: step fields (targetLabel, isManual, hasScreenshot, sessionId,
 * etc.) are preserved using a spread when serializing to disk, rather than an
 * explicit allowlist that previously dropped these fields.
 */

const DB_NAME = 'testsnapper_filesync';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'directoryHandle';
const MIGRATION_KEY = 'migrationComplete';

export class FileSync {
  /**
   * Initialize FileSync with IndexedDB connection
   */
  constructor() {
    this._db = null;
    this._dirHandle = null;
  }

  // ─────────────────────────────────────────────
  // IndexedDB — persist the directory handle
  // ─────────────────────────────────────────────

  /**
   * Open or create IndexedDB database for handle persistence
   * @private
   * @async
   * @returns {Promise<IDBDatabase>} Database instance
   */
  async _openDB() {
    if (this._db) return this._db;

    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);

      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      req.onsuccess = () => {
        this._db = req.result;
        resolve(this._db);
      };

      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Retrieve stored directory handle from IndexedDB
   * @private
   * @async
   * @returns {Promise<FileSystemDirectoryHandle|null>} Directory handle or null
   */
  async _getStoredHandle() {
    const db = await this._openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(HANDLE_KEY);

      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Store directory handle in IndexedDB
   * @private
   * @async
   * @param {FileSystemDirectoryHandle} handle - Directory handle to store
   * @returns {Promise<void>}
   */
  async _storeHandle(handle) {
    const db = await this._openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(handle, HANDLE_KEY);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Remove stored directory handle from IndexedDB
   * @private
   * @async
   * @returns {Promise<void>}
   */
  async _removeHandle() {
    const db = await this._openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(HANDLE_KEY);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // ─────────────────────────────────────────────
  // Migration flag persistence
  // ─────────────────────────────────────────────

  /**
   * Check if migration from chrome.storage has been completed
   * @async
   * @returns {Promise<boolean>} true if migration is complete
   */
  async isMigrated() {
    const db = await this._openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(MIGRATION_KEY);
      req.onsuccess = () => resolve(!!req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * Mark migration from chrome.storage as complete
   * @async
   * @returns {Promise<void>}
   */
  async setMigrated() {
    const db = await this._openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put({ migrated: true, migratedAt: Date.now() }, MIGRATION_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // ─────────────────────────────────────────────
  // Directory handle management
  // ─────────────────────────────────────────────

  /**
   * Open a directory picker, then auto-create .TestSnapper inside it.
   * The user picks any parent folder (e.g. their home directory), and
   * we create/reuse a .TestSnapper subfolder automatically.
   * Must be called from a user gesture (click handler).
   * @async
   * @returns {Promise<Object>} { name: '.TestSnapper', parentName: string }
   */
  async pickDirectory() {
    const parentHandle = await window.showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'documents'
    });

    // Create .TestSnapper inside the chosen folder (no-op if it exists)
    const tsHandle = await parentHandle.getDirectoryHandle('.TestSnapper', { create: true });

    // Store the .TestSnapper handle (scoped — all ops happen inside it)
    await this._storeHandle(tsHandle);
    this._dirHandle = tsHandle;

    return { name: '.TestSnapper', parentName: parentHandle.name };
  }

  /**
   * Retrieve the stored directory handle and verify permission.
   * Returns null if not configured or permission revoked.
   * @async
   * @returns {Promise<FileSystemDirectoryHandle|null>} Directory handle or null
   */
  async getHandle() {
    if (this._dirHandle) {
      const perm = await this._dirHandle.queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') return this._dirHandle;
    }

    const stored = await this._getStoredHandle();
    if (!stored) return null;

    const perm = await stored.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      this._dirHandle = stored;
      return stored;
    }

    // Permission not granted — caller should show re-authorize button
    return null;
  }

  /**
   * Check if a directory handle has been configured (may still need re-auth)
   * @async
   * @returns {Promise<boolean>} true if directory was previously selected
   */
  async isConfigured() {
    const stored = await this._getStoredHandle();
    return stored !== null;
  }

  /**
   * Check current permission state
   * @async
   * @returns {Promise<'granted'|'prompt'|'denied'|'none'>} Permission state
   */
  async checkPermission() {
    const stored = await this._getStoredHandle();
    if (!stored) return 'none';

    try {
      return await stored.queryPermission({ mode: 'readwrite' });
    } catch {
      return 'denied';
    }
  }

  /**
   * Re-request permission on a stored handle.
   * Must be called from a user gesture.
   * @async
   * @returns {Promise<boolean>} true if permission granted
   */
  async requestPermission() {
    const stored = await this._getStoredHandle();
    if (!stored) return false;

    const perm = await stored.requestPermission({ mode: 'readwrite' });
    if (perm === 'granted') {
      this._dirHandle = stored;
      return true;
    }
    return false;
  }

  /**
   * Clear the stored directory handle
   * @async
   * @returns {Promise<void>}
   */
  async clearDirectory() {
    this._dirHandle = null;
    await this._removeHandle();
  }

  /**
   * Get the folder name for display
   * @async
   * @returns {Promise<string|null>} Folder name or null
   */
  async getFolderName() {
    const stored = await this._getStoredHandle();
    return stored ? stored.name : null;
  }

  // ─────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────

  /**
   * Sanitize a string for use as a folder name
   * @private
   * @param {string} name - Original name
   * @returns {string} Sanitized name safe for filesystem
   */
  _sanitizeFolderName(name) {
    return name
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 80) || 'Unnamed';
  }

  /**
   * Build the folder name for a session: {SessionName}_{shortId}
   * @private
   * @param {Object} session - Session object
   * @returns {string} Folder name
   */
  _sessionFolderName(session) {
    const name = this._sanitizeFolderName(session.sessionName || 'Session');
    const shortId = (session.sessionId || '').substring(0, 8);
    return `${name}_${shortId}`;
  }

  /**
   * Determine the file extension for a screenshot data URL.
   * @private
   * @param {string} dataURL - Screenshot data URL
   * @returns {string} 'jpg' or 'png'
   */
  _screenshotExtension(dataURL) {
    if (typeof dataURL === 'string' && dataURL.startsWith('data:image/png')) {
      return 'png';
    }
    return 'jpg';
  }

  /**
   * Convert a data URL to a Blob
   * @private
   * @param {string} dataURL - Data URL string
   * @returns {Blob|null} Blob object or null on error
   */
  _dataURLtoBlob(dataURL) {
    try {
      const parts = dataURL.split(',');
      const mime = parts[0].match(/:(.*?);/)[1];
      const bstr = atob(parts[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      return new Blob([u8arr], { type: mime });
    } catch {
      return null;
    }
  }

  /**
   * Convert a data URL to a Uint8Array (raw bytes, no overhead).
   * @private
   * @param {string} dataURL - Data URL string
   * @returns {Uint8Array|null} Raw bytes or null on error
   */
  _dataURLtoBytes(dataURL) {
    try {
      const parts = dataURL.split(',');
      const bstr = atob(parts[1]);
      const u8arr = new Uint8Array(bstr.length);
      for (let i = 0; i < bstr.length; i++) {
        u8arr[i] = bstr.charCodeAt(i);
      }
      return u8arr;
    } catch {
      return null;
    }
  }

  /**
   * Read the raw bytes of a file from a directory handle.
   * Returns an ArrayBuffer or null on failure.
   * @private
   * @async
   * @param {FileSystemDirectoryHandle} dirHandle
   * @param {string} fileName
   * @returns {Promise<ArrayBuffer|null>}
   */
  async _readFileBytes(dirHandle, fileName) {
    try {
      const fileHandle = await dirHandle.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      return await file.arrayBuffer();
    } catch {
      return null;
    }
  }

  /**
   * Write a file into a directory handle
   * @private
   * @async
   * @param {FileSystemDirectoryHandle} dirHandle - Directory handle
   * @param {string} fileName - File name
   * @param {string|Uint8Array|ArrayBuffer} content - File content
   * @returns {Promise<void>}
   */
  async _writeFile(dirHandle, fileName, content) {
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  /**
   * Read a file from a directory handle. Returns parsed JSON or null on failure.
   * @private
   * @async
   * @param {FileSystemDirectoryHandle} dirHandle - Directory handle
   * @param {string} fileName - File name
   * @returns {Promise<Object|null>} Parsed JSON object or null
   */
  async _readFile(dirHandle, fileName) {
    try {
      const fileHandle = await dirHandle.getFileHandle(fileName);
      const file = await fileHandle.getFile();
      const text = await file.text();
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  /**
   * Delete a file from a directory handle (ignores NotFoundError).
   * @private
   * @async
   * @param {FileSystemDirectoryHandle} dirHandle
   * @param {string} fileName
   * @returns {Promise<void>}
   */
  async _deleteFile(dirHandle, fileName) {
    try {
      await dirHandle.removeEntry(fileName);
    } catch (err) {
      if (err.name !== 'NotFoundError') {
        console.warn(`[FileSync] _deleteFile failed for ${fileName}:`, err);
      }
    }
  }

  /**
   * Get or create the screenshots/ subdirectory for a session folder.
   * @private
   * @async
   * @param {FileSystemDirectoryHandle} sessionDir - Session folder handle
   * @returns {Promise<FileSystemDirectoryHandle>} screenshots subdirectory handle
   */
  async _getScreenshotsDir(sessionDir, { create = true } = {}) {
    return await sessionDir.getDirectoryHandle('screenshots', { create });
  }

  /**
   * Find a session folder by scanning for the sessionId suffix.
   * Returns the directory handle or null.
   * @private
   * @async
   * @param {FileSystemDirectoryHandle} handle - Root directory handle
   * @param {string} sessionId - Session identifier
   * @returns {Promise<FileSystemDirectoryHandle|null>} Session folder or null
   */
  async _findSessionFolder(handle, sessionId) {
    const shortId = (sessionId || '').substring(0, 8);
    if (!shortId) return null;

    for await (const [name, entry] of handle.entries()) {
      if (entry.kind === 'directory' && name.endsWith(`_${shortId}`)) {
        return entry;
      }
    }
    return null;
  }

  // ─────────────────────────────────────────────
  // Screenshot file helpers (PERF-007)
  // ─────────────────────────────────────────────

  /**
   * Write a screenshot data URL as a binary file in the screenshots/ subfolder.
   * Returns the relative file path stored on the step: 'screenshots/{stepId}.ext'
   * @private
   * @async
   * @param {FileSystemDirectoryHandle} sessionDir - Session folder handle
   * @param {string} stepId - Step identifier
   * @param {string} dataUrl - Screenshot data URL
   * @returns {Promise<string>} Relative path e.g. 'screenshots/abc123.jpg'
   */
  async _writeScreenshot(sessionDir, stepId, dataUrl) {
    const ext = this._screenshotExtension(dataUrl);
    const fileName = `${stepId}.${ext}`;
    const screenshotsDir = await this._getScreenshotsDir(sessionDir, { create: true });
    const bytes = this._dataURLtoBytes(dataUrl);
    if (bytes) {
      await this._writeFile(screenshotsDir, fileName, bytes);
    }
    return `screenshots/${fileName}`;
  }

  /**
   * Read a screenshot from disk and return it as a data URL.
   * @private
   * @async
   * @param {FileSystemDirectoryHandle} sessionDir - Session folder handle
   * @param {string} screenshotFile - Relative path e.g. 'screenshots/abc123.jpg'
   * @returns {Promise<string|null>} data URL or null
   */
  async _readScreenshot(sessionDir, screenshotFile) {
    try {
      const parts = screenshotFile.split('/');
      if (parts.length !== 2) return null;
      const [dirName, fileName] = parts;
      const screenshotsDir = await sessionDir.getDirectoryHandle(dirName);
      const buf = await this._readFileBytes(screenshotsDir, fileName);
      if (!buf) return null;
      const ext = fileName.split('.').pop().toLowerCase();
      const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
      // Convert ArrayBuffer to base64 data URL
      const bytes = new Uint8Array(buf);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return `data:${mime};base64,${btoa(binary)}`;
    } catch {
      return null;
    }
  }

  /**
   * Delete a screenshot binary file from disk.
   * @private
   * @async
   * @param {FileSystemDirectoryHandle} sessionDir
   * @param {string} screenshotFile - e.g. 'screenshots/abc123.jpg'
   * @returns {Promise<void>}
   */
  async _deleteScreenshot(sessionDir, screenshotFile) {
    try {
      const parts = screenshotFile.split('/');
      if (parts.length !== 2) return;
      const [dirName, fileName] = parts;
      const screenshotsDir = await sessionDir.getDirectoryHandle(dirName);
      await this._deleteFile(screenshotsDir, fileName);
    } catch {
      // ignore — screenshot may not exist
    }
  }

  // ─────────────────────────────────────────────
  // Read operations
  // ─────────────────────────────────────────────

  /**
   * Read the sessions.json index
   * @async
   * @returns {Promise<Array>} Array of session metadata objects, or empty array
   */
  async readSessionIndex() {
    const handle = await this.getHandle();
    if (!handle) return [];

    const data = await this._readFile(handle, 'sessions.json');
    return Array.isArray(data) ? data : [];
  }

  /**
   * Read session metadata + steps from session.json (no screenshot data).
   * Returns the raw session.json content or null on failure.
   * @async
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Object|null>} { version, session, steps } or null
   */
  async readSession(sessionId) {
    const handle = await this.getHandle();
    if (!handle) return null;

    const sessionDir = await this._findSessionFolder(handle, sessionId);
    if (!sessionDir) return null;

    return await this._readFile(sessionDir, 'session.json');
  }

  /**
   * Read steps for a session from disk (metadata only, no screenshot data).
   * @async
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Array>} Steps array or empty array
   */
  async readSteps(sessionId) {
    const data = await this.readSession(sessionId);
    if (!data || !Array.isArray(data.steps)) return [];
    return data.steps;
  }

  /**
   * Read screenshot assets for a session.
   * Steps with a screenshotFile field have their screenshots loaded from
   * the binary files in screenshots/ and returned in asset format.
   * @async
   * @param {string} sessionId - Session identifier
   * @returns {Promise<Array>} Asset-format array [{id, sessionId, stepId, type, dataUrl}]
   */
  async readAssets(sessionId) {
    const handle = await this.getHandle();
    if (!handle) return [];

    const sessionDir = await this._findSessionFolder(handle, sessionId);
    if (!sessionDir) return [];

    const data = await this._readFile(sessionDir, 'session.json');
    if (!data || !Array.isArray(data.steps)) return [];

    const assets = [];
    for (const step of data.steps) {
      if (step.screenshotFile) {
        const dataUrl = await this._readScreenshot(sessionDir, step.screenshotFile);
        if (dataUrl) {
          assets.push({
            id: `asset_${step.id}`,
            sessionId,
            stepId: step.id,
            type: 'screenshot',
            dataUrl
          });
        }
      } else if (step.screenshot) {
        // Legacy format: screenshot embedded inline — expose as asset
        assets.push({
          id: `asset_${step.id}`,
          sessionId,
          stepId: step.id,
          type: 'screenshot',
          dataUrl: step.screenshot
        });
      }
    }
    return assets;
  }

  /**
   * Check if a session folder exists on disk
   * @async
   * @param {string} sessionId - Session identifier
   * @returns {Promise<boolean>} true if session folder exists
   */
  async sessionExists(sessionId) {
    const handle = await this.getHandle();
    if (!handle) return false;

    const folder = await this._findSessionFolder(handle, sessionId);
    return folder !== null;
  }

  /**
   * List all session folder names in the .TestSnapper root
   * @async
   * @returns {Promise<Array<string>>} Array of folder names
   */
  async listSessionFolders() {
    const handle = await this.getHandle();
    if (!handle) return [];

    const folders = [];
    for await (const [name, entry] of handle.entries()) {
      if (entry.kind === 'directory') {
        folders.push(name);
      }
    }
    return folders;
  }

  /**
   * Read all sessions fully (for export/import).
   * Does NOT inline screenshot data — steps will have screenshotFile references.
   * @async
   * @returns {Promise<Array<Object>>} Array of session.json content objects
   */
  async readAllSessionsFull() {
    const handle = await this.getHandle();
    if (!handle) return [];

    const sessions = [];
    for await (const [name, entry] of handle.entries()) {
      if (entry.kind === 'directory') {
        const data = await this._readFile(entry, 'session.json');
        if (data && data.session) {
          sessions.push(data);
        }
      }
    }
    return sessions;
  }

  // ─────────────────────────────────────────────
  // Write operations (PERF-007)
  // ─────────────────────────────────────────────

  /**
   * Write a session to disk.
   *
   * PERF-007: Screenshots are stored as separate binary files in a
   * screenshots/ subdirectory instead of being embedded as base64 in
   * session.json. This keeps session.json compact so step edits and
   * drag-and-drop reordering only read/write the small metadata file.
   *
   * FUNC-015: All step fields are preserved via spread (not an allowlist).
   * The raw dataUrl is stripped from the on-disk step representation;
   * screenshotFile replaces it.
   *
   * @async
   * @param {Object} session - Session metadata
   * @param {Array} steps - Step objects
   * @param {Array} assets - Asset objects [{stepId, dataUrl, ...}]
   * @returns {Promise<void>}
   * @throws {Error} If no filesystem handle configured
   */
  async writeSession(session, steps, assets) {
    const handle = await this.getHandle();
    if (!handle) throw new Error('No filesystem handle — storage folder not configured');

    // Build step-to-asset map
    const assetMap = new Map();
    if (assets && assets.length > 0) {
      for (const asset of assets) {
        if (asset.stepId) {
          assetMap.set(asset.stepId, asset);
        }
      }
    }

    // Find and remove old folder if session was renamed
    const existingFolder = await this._findSessionFolder(handle, session.sessionId);
    const newFolderName = this._sessionFolderName(session);
    if (existingFolder && existingFolder.name !== newFolderName) {
      try {
        await handle.removeEntry(existingFolder.name, { recursive: true });
      } catch { /* ignore if not found */ }
    }

    const sessionDir = await handle.getDirectoryHandle(newFolderName, { create: true });

    // Write screenshots as separate binary files (PERF-007)
    const serializedSteps = [];
    for (const step of steps) {
      const asset = assetMap.get(step.id);
      const dataUrl = asset ? (asset.dataUrl || asset.data || null) : null;

      // FUNC-015: preserve all step fields via spread.
      // Strip the raw dataUrl / screenshot fields from on-disk representation.
      // Add screenshotFile reference if we have screenshot data.
      const { dataUrl: _du, screenshot: _sc, ...stepFields } = step;
      const serializedStep = { ...stepFields };

      if (dataUrl) {
        // Write binary screenshot file; store relative path on step
        const screenshotFile = await this._writeScreenshot(sessionDir, step.id, dataUrl);
        serializedStep.screenshotFile = screenshotFile;
      } else if (step.screenshotFile) {
        // Already has a file reference from a previous write — preserve it
        serializedStep.screenshotFile = step.screenshotFile;
      }

      serializedSteps.push(serializedStep);
    }

    // PERF-007: compact JSON (no pretty-printing) to reduce file size and write time
    const sessionData = {
      version: 2,
      savedAt: new Date().toISOString(),
      session: {
        sessionId: session.sessionId,
        sessionName: session.sessionName,
        createdAt: session.createdAt,
        lastModified: session.lastModified || new Date().toISOString(),
        env: session.env,
        stepCount: steps.length
      },
      steps: serializedSteps
    };

    await this._writeFile(sessionDir, 'session.json', JSON.stringify(sessionData));

    // Update the sessions.json index
    await this._updateIndexForSession(handle, sessionData.session);

    console.log(`[FileSync] Wrote session ${newFolderName}`);
  }

  /**
   * Update a single step in session.json without touching screenshot files.
   * PERF-007: reads only the compact session.json, patches the step, rewrites it.
   * @async
   * @param {string} sessionId - Session identifier (direct lookup — no scan)
   * @param {string} stepId - Step identifier
   * @param {Object} changes - Fields to merge into the step
   * @returns {Promise<Object|null>} Updated step or null if not found
   */
  async updateStep(sessionId, stepId, changes) {
    const handle = await this.getHandle();
    if (!handle) return null;

    const sessionDir = await this._findSessionFolder(handle, sessionId);
    if (!sessionDir) return null;

    const data = await this._readFile(sessionDir, 'session.json');
    if (!data || !Array.isArray(data.steps)) return null;

    const idx = data.steps.findIndex(s => s.id === stepId);
    if (idx === -1) return null;

    // FUNC-015: spread preserves all existing step fields
    const { dataUrl: _du, screenshot: _sc, ...safeChanges } = changes;
    data.steps[idx] = { ...data.steps[idx], ...safeChanges };

    await this._writeFile(sessionDir, 'session.json', JSON.stringify(data));
    return data.steps[idx];
  }

  /**
   * Delete a single step from session.json and its screenshot file.
   * PERF-007: direct session lookup — no cross-session scan.
   * @async
   * @param {string} sessionId - Session identifier
   * @param {string} stepId - Step identifier
   * @returns {Promise<boolean>} true if deleted, false if not found
   */
  async deleteStep(sessionId, stepId) {
    const handle = await this.getHandle();
    if (!handle) return false;

    const sessionDir = await this._findSessionFolder(handle, sessionId);
    if (!sessionDir) return false;

    const data = await this._readFile(sessionDir, 'session.json');
    if (!data || !Array.isArray(data.steps)) return false;

    const idx = data.steps.findIndex(s => s.id === stepId);
    if (idx === -1) return false;

    const step = data.steps[idx];

    // Delete the binary screenshot file if present
    if (step.screenshotFile) {
      await this._deleteScreenshot(sessionDir, step.screenshotFile);
    }

    data.steps.splice(idx, 1);
    data.session = { ...data.session, stepCount: data.steps.length };

    await this._writeFile(sessionDir, 'session.json', JSON.stringify(data));

    // Update index stepCount
    await this._updateIndexForSession(handle, data.session);
    return true;
  }

  /**
   * Update a session's entry in sessions.json index
   * @private
   * @async
   * @param {FileSystemDirectoryHandle} handle - Root directory handle
   * @param {Object} sessionMeta - Session metadata
   * @returns {Promise<void>}
   */
  async _updateIndexForSession(handle, sessionMeta) {
    const index = await this._readFile(handle, 'sessions.json') || [];
    const existing = index.findIndex(s => s.sessionId === sessionMeta.sessionId);
    if (existing >= 0) {
      index[existing] = sessionMeta;
    } else {
      index.push(sessionMeta);
    }
    await this._writeFile(handle, 'sessions.json', JSON.stringify(index));
  }

  /**
   * Write the full sessions.json index
   * @async
   * @param {Array} sessions - Array of session metadata
   * @returns {Promise<void>}
   */
  async updateSessionIndex(sessions) {
    const handle = await this.getHandle();
    if (!handle) return;
    await this._writeFile(handle, 'sessions.json', JSON.stringify(sessions));
  }

  /**
   * Delete a session from disk (folder + all screenshots) and update the index.
   * @async
   * @param {string} sessionId - Session identifier
   * @returns {Promise<void>}
   */
  async deleteSession(sessionId) {
    const handle = await this.getHandle();
    if (!handle) return;

    try {
      const folder = await this._findSessionFolder(handle, sessionId);
      if (folder) {
        await handle.removeEntry(folder.name, { recursive: true });
        console.log(`[FileSync] Deleted session folder: ${folder.name}`);
      }

      // Update index
      const index = await this._readFile(handle, 'sessions.json') || [];
      const updated = index.filter(s => s.sessionId !== sessionId);
      await this._writeFile(handle, 'sessions.json', JSON.stringify(updated));
    } catch (error) {
      if (error.name !== 'NotFoundError') {
        console.warn('[FileSync] Failed to delete session:', error);
      }
    }
  }

  /**
   * Delete a session folder from disk (legacy method — kept for backward compat).
   * Prefer deleteSession() which also updates the index.
   * @async
   * @param {string} sessionId - Session identifier
   * @param {string} [sessionName] - Optional session name
   * @returns {Promise<void>}
   */
  async deleteSessionFolder(sessionId, sessionName) {
    const handle = await this.getHandle();
    if (!handle) return;

    try {
      const folderName = this._sessionFolderName({
        sessionId,
        sessionName: sessionName || 'Session'
      });
      await handle.removeEntry(folderName, { recursive: true });
      console.log(`[FileSync] Deleted session folder: ${folderName}`);
    } catch (error) {
      if (error.name !== 'NotFoundError') {
        console.warn('[FileSync] Failed to delete session folder:', error);
      }
    }
  }

  /**
   * Sync a single session from StorageManager to disk (legacy method).
   * Used during migration from chrome.storage.
   * @async
   * @param {string} sessionId - Session identifier
   * @param {StorageManager} storage - Storage manager instance
   * @returns {Promise<void>}
   */
  async syncSession(sessionId, storage) {
    const session = await storage.getSession(sessionId);
    if (!session) return;

    const steps = await storage.getSteps(sessionId);
    const assets = await storage.getAllAssets(sessionId);

    await this.writeSession(session, steps, assets);
  }

  /**
   * Sync ALL sessions from StorageManager to disk (legacy/migration).
   * @async
   * @param {StorageManager} storage - Storage manager instance
   * @returns {Promise<void>}
   */
  async syncAll(storage) {
    const handle = await this.getHandle();
    if (!handle) return;

    const sessions = await storage.getAllSessions();
    for (const session of sessions) {
      await this.syncSession(session.sessionId, storage);
    }
    console.log(`[FileSync] Full sync complete: ${sessions.length} sessions`);
  }

  // ─────────────────────────────────────────────
  // Migration
  // ─────────────────────────────────────────────

  /**
   * Migrate all data from chrome.storage.local to the filesystem.
   * Called once on first launch after the storage migration update.
   * @async
   * @param {StorageManager} legacyStorage - Initialized StorageManager instance
   * @returns {Promise<Object>} { migrated: number } count of migrated sessions
   * @throws {Error} If no filesystem handle configured
   */
  async migrateFromChromeStorage(legacyStorage) {
    const handle = await this.getHandle();
    if (!handle) throw new Error('No filesystem handle — pick a folder first');

    const sessions = await legacyStorage.getAllSessions();
    let migrated = 0;

    for (const session of sessions) {
      try {
        const steps = await legacyStorage.getSteps(session.sessionId);
        const assets = await legacyStorage.getAllAssets(session.sessionId);
        await this.writeSession(session, steps, assets);
        migrated++;
      } catch (error) {
        console.warn(`[FileSync] Migration failed for session ${session.sessionId}:`, error);
      }
    }

    // Mark migration complete
    await this.setMigrated();

    console.log(`[FileSync] Migration complete: ${migrated}/${sessions.length} sessions`);
    return { migrated };
  }
}
