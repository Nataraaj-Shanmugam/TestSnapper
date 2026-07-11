import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FileSync } from '../../src/core/file-sync.js';
import { sampleSession, sampleSteps, tinyPngDataURL } from '../helpers/fixtures.js';

// ─────────────────────────────────────────────────────────────────────────────
// FSAPI mock helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build an in-memory FSAPI-like directory handle.
 * Supports getFileHandle, getDirectoryHandle, entries, removeEntry.
 */
function makeDirHandle(name = 'root', initialFiles = {}, initialDirs = {}) {
  const files = new Map(Object.entries(initialFiles));
  const dirs = new Map(Object.entries(initialDirs));

  const handle = {
    kind: 'directory',
    name,
    queryPermission: vi.fn().mockResolvedValue('granted'),
    requestPermission: vi.fn().mockResolvedValue('granted'),
    getFileHandle: vi.fn(async (fileName, opts = {}) => {
      if (!files.has(fileName) && !opts.create) {
        const e = new Error(`File not found: ${fileName}`);
        e.name = 'NotFoundError';
        throw e;
      }
      if (!files.has(fileName)) files.set(fileName, '');
      return makeFileHandle(fileName, files);
    }),
    getDirectoryHandle: vi.fn(async (dirName, opts = {}) => {
      if (!dirs.has(dirName) && !opts.create) {
        const e = new Error(`Dir not found: ${dirName}`);
        e.name = 'NotFoundError';
        throw e;
      }
      if (!dirs.has(dirName)) dirs.set(dirName, makeDirHandle(dirName));
      return dirs.get(dirName);
    }),
    removeEntry: vi.fn(async (name) => {
      files.delete(name);
      dirs.delete(name);
    }),
    entries: vi.fn(function* () {
      for (const [n, f] of files) yield [n, { kind: 'file', name: n }];
      for (const [n, d] of dirs) yield [n, d];
    }),
    // Expose internals for test assertions
    _files: files,
    _dirs: dirs,
  };

  return handle;
}

function makeFileHandle(fileName, filesMap) {
  return {
    kind: 'file',
    name: fileName,
    getFile: vi.fn(async () => ({
      text: vi.fn(async () => filesMap.get(fileName) || ''),
    })),
    createWritable: vi.fn(async () => {
      let buf = '';
      return {
        write: vi.fn(async (content) => { buf = content; }),
        close: vi.fn(async () => { filesMap.set(fileName, buf); }),
      };
    }),
  };
}

/**
 * Mock IndexedDB for FileSync._openDB() / _storeHandle() / _getStoredHandle()
 */
function mockIndexedDB(storedHandle = null) {
  const store = new Map();
  if (storedHandle) store.set('directoryHandle', storedHandle);

  const db = {
    transaction: vi.fn((storeName, mode) => ({
      objectStore: vi.fn(() => ({
        get: vi.fn((key) => {
          const req = { result: store.get(key), onsuccess: null, onerror: null };
          queueMicrotask(() => req.onsuccess && req.onsuccess());
          return req;
        }),
        put: vi.fn((val, key) => {
          store.set(key, val);
          const req = { onsuccess: null, onerror: null };
          queueMicrotask(() => req.onsuccess && req.onsuccess());
          return req;
        }),
        delete: vi.fn((key) => {
          store.delete(key);
          const req = { onsuccess: null, onerror: null };
          queueMicrotask(() => req.onsuccess && req.onsuccess());
          return req;
        }),
      })),
    })),
  };

  const openReq = {
    result: db,
    onupgradeneeded: null,
    onsuccess: null,
    onerror: null,
  };

  vi.stubGlobal('indexedDB', {
    open: vi.fn(() => {
      queueMicrotask(() => openReq.onsuccess && openReq.onsuccess());
      return openReq;
    }),
  });

  return { db, store };
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure method tests (no mocks needed)
// ─────────────────────────────────────────────────────────────────────────────

let fileSync;
beforeEach(() => { fileSync = new FileSync(); });

describe('FileSync._sanitizeFolderName', () => {
  it('removes characters invalid in folder names', () => {
    const result = fileSync._sanitizeFolderName('File<>:"/\\|?*Name');
    expect(result).not.toMatch(/[<>:"/\\|?*]/);
  });

  it('collapses whitespace runs into underscores', () => {
    const result = fileSync._sanitizeFolderName('My   Session');
    expect(result).not.toContain('   ');
    expect(result).toContain('My');
    expect(result).toContain('Session');
  });

  it('collapses consecutive underscores into one', () => {
    const result = fileSync._sanitizeFolderName('A___B');
    expect(result).not.toContain('___');
  });

  it('enforces maximum length of 80 characters', () => {
    const result = fileSync._sanitizeFolderName('a'.repeat(100));
    expect(result.length).toBeLessThanOrEqual(80);
  });

  it('falls back to "Unnamed" for empty input', () => {
    expect(fileSync._sanitizeFolderName('')).toBe('Unnamed');
  });

  it('falls back to "Unnamed" for all-invalid-char input', () => {
    const result = fileSync._sanitizeFolderName('<>:"/\\|?*');
    expect(result.length).toBeGreaterThan(0);
  });

  it('preserves normal alphanumeric names', () => {
    expect(fileSync._sanitizeFolderName('LoginFlowTest')).toBe('LoginFlowTest');
  });
});

describe('FileSync._sessionFolderName', () => {
  it('combines sanitized session name with first 8 chars of sessionId', () => {
    const session = { sessionName: 'Login Flow', sessionId: 'abcdef12-rest-of-uuid' };
    const result = fileSync._sessionFolderName(session);
    expect(result).toContain('Login');
    expect(result).toContain('abcdef12');
  });

  it('uses "Session" as fallback when sessionName is missing', () => {
    const session = { sessionId: 'xyz12345-rest' };
    const result = fileSync._sessionFolderName(session);
    expect(result).toContain('Session');
    expect(result).toContain('xyz12345');
  });

  it('format is {SanitizedName}_{shortId}', () => {
    const session = { sessionName: 'My Test', sessionId: '11223344-aaaa-bbbb' };
    expect(fileSync._sessionFolderName(session)).toBe('My_Test_11223344');
  });
});

describe('FileSync._dataURLtoBlob', () => {
  const PNG_DATA_URL =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI6QAAAABJRU5ErkJggg==';

  it('converts a valid PNG data URL to a Blob', () => {
    const blob = fileSync._dataURLtoBlob(PNG_DATA_URL);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('returns null for invalid data URL', () => {
    expect(fileSync._dataURLtoBlob('not-a-data-url')).toBeNull();
  });

  it('returns null for malformed base64', () => {
    expect(fileSync._dataURLtoBlob('data:image/png;base64,!!!invalid!!!')).toBeNull();
  });

  it('returns a Blob with correct byte size', () => {
    const blob = fileSync._dataURLtoBlob(PNG_DATA_URL);
    expect(blob.size).toBeGreaterThan(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// _readFile & _writeFile
// ─────────────────────────────────────────────────────────────────────────────

describe('FileSync._readFile and _writeFile', () => {
  it('writes JSON and reads it back', async () => {
    const dir = makeDirHandle();
    const data = { hello: 'world', count: 42 };
    await fileSync._writeFile(dir, 'test.json', JSON.stringify(data));
    const result = await fileSync._readFile(dir, 'test.json');
    expect(result).toEqual(data);
  });

  it('returns null when file does not exist', async () => {
    const dir = makeDirHandle();
    const result = await fileSync._readFile(dir, 'missing.json');
    expect(result).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// _findSessionFolder
// ─────────────────────────────────────────────────────────────────────────────

describe('FileSync._findSessionFolder', () => {
  it('finds a directory whose name ends with _shortId', async () => {
    const sessionId = 'abcd1234-some-uuid';
    const folderName = 'Login_Flow_abcd1234';
    const sessionDir = makeDirHandle(folderName);
    const root = makeDirHandle('root', {}, { [folderName]: sessionDir });

    const found = await fileSync._findSessionFolder(root, sessionId);
    expect(found).not.toBeNull();
    expect(found.name).toBe(folderName);
  });

  it('returns null if no matching folder exists', async () => {
    const root = makeDirHandle('root', {}, {});
    const found = await fileSync._findSessionFolder(root, 'xyz99999-uuid');
    expect(found).toBeNull();
  });

  it('returns null for empty sessionId', async () => {
    const root = makeDirHandle('root');
    const found = await fileSync._findSessionFolder(root, '');
    expect(found).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// writeSession round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe('FileSync.writeSession + readSession', () => {
  beforeEach(() => {
    // Mock getHandle to return a fresh in-memory dir
    const root = makeDirHandle('.TestSnapper');
    fileSync.getHandle = vi.fn().mockResolvedValue(root);
    mockIndexedDB(root);
  });

  it('writes a session with steps and reads it back', async () => {
    const session = { ...sampleSession };
    const steps = sampleSteps.map(s => ({ ...s, id: s.stepId }));
    const assets = [{ stepId: sampleSteps[0].stepId, dataUrl: tinyPngDataURL }];

    await fileSync.writeSession(session, steps, assets);

    const handle = await fileSync.getHandle();
    // The session folder should have been created
    const folderName = fileSync._sessionFolderName(session);
    expect(handle._dirs.has(folderName)).toBe(true);

    // Read back
    const data = await fileSync._readFile(handle._dirs.get(folderName), 'session.json');
    expect(data).not.toBeNull();
    expect(data.version).toBe(2);
    expect(data.session.sessionId).toBe(session.sessionId);
    expect(data.steps).toHaveLength(steps.length);
  });

  it('stores screenshot as a separate file and references it via screenshotFile', async () => {
    const session = { ...sampleSession };
    const steps = [{ ...sampleSteps[0], id: sampleSteps[0].stepId }];
    const assets = [{ stepId: sampleSteps[0].stepId, dataUrl: tinyPngDataURL }];

    await fileSync.writeSession(session, steps, assets);

    const handle = await fileSync.getHandle();
    const folderName = fileSync._sessionFolderName(session);
    const data = await fileSync._readFile(handle._dirs.get(folderName), 'session.json');

    // PERF-007: screenshots are stored as separate binary files; session.json has a path reference
    expect(data.steps[0].screenshotFile).toMatch(/^screenshots\//);
    // The raw dataUrl should NOT be embedded in session.json any more
    expect(data.steps[0].screenshot).toBeUndefined();
  });

  it('updates sessions.json index after write', async () => {
    const session = { ...sampleSession };
    await fileSync.writeSession(session, sampleSteps.map(s => ({ ...s, id: s.stepId })), []);

    const handle = await fileSync.getHandle();
    const index = JSON.parse(handle._files.get('sessions.json'));
    expect(Array.isArray(index)).toBe(true);
    expect(index.some(s => s.sessionId === session.sessionId)).toBe(true);
  });

  it('throws when no handle is configured', async () => {
    fileSync.getHandle = vi.fn().mockResolvedValue(null);
    await expect(fileSync.writeSession(sampleSession, [], [])).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// readSessionIndex
// ─────────────────────────────────────────────────────────────────────────────

describe('FileSync.readSessionIndex', () => {
  it('returns empty array when no sessions.json', async () => {
    const root = makeDirHandle('.TestSnapper');
    fileSync.getHandle = vi.fn().mockResolvedValue(root);
    const index = await fileSync.readSessionIndex();
    expect(index).toEqual([]);
  });

  it('returns parsed sessions.json content', async () => {
    const sessions = [{ sessionId: 'abc', sessionName: 'Test' }];
    const root = makeDirHandle('.TestSnapper', {
      'sessions.json': JSON.stringify(sessions),
    });
    fileSync.getHandle = vi.fn().mockResolvedValue(root);
    const index = await fileSync.readSessionIndex();
    expect(index).toEqual(sessions);
  });

  it('returns empty array when no handle', async () => {
    fileSync.getHandle = vi.fn().mockResolvedValue(null);
    const index = await fileSync.readSessionIndex();
    expect(index).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// readSteps / readAssets
// ─────────────────────────────────────────────────────────────────────────────

describe('FileSync.readSteps', () => {
  it('returns steps array from session.json', async () => {
    const sessionId = sampleSession.sessionId;
    const folderName = fileSync._sessionFolderName(sampleSession);
    const sessionData = {
      version: 2,
      session: { sessionId },
      steps: sampleSteps.map(s => ({ ...s, id: s.stepId })),
    };
    const sessionDir = makeDirHandle(folderName, {
      'session.json': JSON.stringify(sessionData),
    });
    const root = makeDirHandle('.TestSnapper', {}, { [folderName]: sessionDir });
    fileSync.getHandle = vi.fn().mockResolvedValue(root);

    const steps = await fileSync.readSteps(sessionId);
    expect(steps).toHaveLength(sampleSteps.length);
    expect(steps[0].stepId).toBe(sampleSteps[0].stepId);
  });

  it('returns empty array if session not found', async () => {
    const root = makeDirHandle('.TestSnapper');
    fileSync.getHandle = vi.fn().mockResolvedValue(root);
    const steps = await fileSync.readSteps('no-such-session-id');
    expect(steps).toEqual([]);
  });
});

describe('FileSync.readAssets', () => {
  it('extracts screenshot assets from steps', async () => {
    const sessionId = sampleSession.sessionId;
    const folderName = fileSync._sessionFolderName(sampleSession);
    const sessionData = {
      version: 2,
      session: { sessionId },
      steps: [
        { id: 'step-001', action: 'navigate', screenshot: null },
        { id: 'step-002', action: 'screenshot', screenshot: tinyPngDataURL },
      ],
    };
    const sessionDir = makeDirHandle(folderName, {
      'session.json': JSON.stringify(sessionData),
    });
    const root = makeDirHandle('.TestSnapper', {}, { [folderName]: sessionDir });
    fileSync.getHandle = vi.fn().mockResolvedValue(root);

    const assets = await fileSync.readAssets(sessionId);
    expect(assets).toHaveLength(1);
    expect(assets[0].stepId).toBe('step-002');
    expect(assets[0].dataUrl).toBe(tinyPngDataURL);
    expect(assets[0].type).toBe('screenshot');
  });

  it('returns empty array when no screenshots', async () => {
    const sessionId = sampleSession.sessionId;
    const folderName = fileSync._sessionFolderName(sampleSession);
    const sessionData = {
      version: 2,
      session: { sessionId },
      steps: [{ id: 'step-001', action: 'navigate', screenshot: null }],
    };
    const sessionDir = makeDirHandle(folderName, {
      'session.json': JSON.stringify(sessionData),
    });
    const root = makeDirHandle('.TestSnapper', {}, { [folderName]: sessionDir });
    fileSync.getHandle = vi.fn().mockResolvedValue(root);

    const assets = await fileSync.readAssets(sessionId);
    expect(assets).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteSession
// ─────────────────────────────────────────────────────────────────────────────

describe('FileSync.deleteSession', () => {
  it('removes the session folder and updates index', async () => {
    const sessionId = sampleSession.sessionId;
    const folderName = fileSync._sessionFolderName(sampleSession);
    const index = [{ sessionId, sessionName: sampleSession.sessionName }];
    const sessionDir = makeDirHandle(folderName);
    const root = makeDirHandle('.TestSnapper', {
      'sessions.json': JSON.stringify(index),
    }, { [folderName]: sessionDir });
    fileSync.getHandle = vi.fn().mockResolvedValue(root);

    await fileSync.deleteSession(sessionId);

    expect(root.removeEntry).toHaveBeenCalledWith(folderName, { recursive: true });

    // Index should have been updated
    const updatedIndex = JSON.parse(root._files.get('sessions.json'));
    expect(updatedIndex.some(s => s.sessionId === sessionId)).toBe(false);
  });

  it('does nothing when no handle is configured', async () => {
    fileSync.getHandle = vi.fn().mockResolvedValue(null);
    await expect(fileSync.deleteSession('any-id')).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sessionExists
// ─────────────────────────────────────────────────────────────────────────────

describe('FileSync.sessionExists', () => {
  it('returns true when session folder exists', async () => {
    const sessionId = sampleSession.sessionId;
    const folderName = fileSync._sessionFolderName(sampleSession);
    const sessionDir = makeDirHandle(folderName);
    const root = makeDirHandle('.TestSnapper', {}, { [folderName]: sessionDir });
    fileSync.getHandle = vi.fn().mockResolvedValue(root);

    expect(await fileSync.sessionExists(sessionId)).toBe(true);
  });

  it('returns false when session folder is absent', async () => {
    const root = makeDirHandle('.TestSnapper');
    fileSync.getHandle = vi.fn().mockResolvedValue(root);
    expect(await fileSync.sessionExists('no-such-id')).toBe(false);
  });

  it('returns false when no handle configured', async () => {
    fileSync.getHandle = vi.fn().mockResolvedValue(null);
    expect(await fileSync.sessionExists('any-id')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateSessionIndex
// ─────────────────────────────────────────────────────────────────────────────

describe('FileSync.updateSessionIndex', () => {
  it('overwrites sessions.json with new array', async () => {
    const root = makeDirHandle('.TestSnapper');
    fileSync.getHandle = vi.fn().mockResolvedValue(root);

    const sessions = [{ sessionId: 'aaa', sessionName: 'A' }, { sessionId: 'bbb', sessionName: 'B' }];
    await fileSync.updateSessionIndex(sessions);

    const written = JSON.parse(root._files.get('sessions.json'));
    expect(written).toEqual(sessions);
  });

  it('does nothing when no handle configured', async () => {
    fileSync.getHandle = vi.fn().mockResolvedValue(null);
    await expect(fileSync.updateSessionIndex([])).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// migrateFromChromeStorage
// ─────────────────────────────────────────────────────────────────────────────

describe('FileSync.migrateFromChromeStorage', () => {
  it('migrates all sessions from legacy storage to filesystem', async () => {
    const root = makeDirHandle('.TestSnapper');
    fileSync.getHandle = vi.fn().mockResolvedValue(root);
    fileSync.setMigrated = vi.fn().mockResolvedValue(undefined);

    const legacyStorage = {
      getAllSessions: vi.fn().mockResolvedValue([sampleSession]),
      getSteps: vi.fn().mockResolvedValue(sampleSteps.map(s => ({ ...s, id: s.stepId }))),
      getAllAssets: vi.fn().mockResolvedValue([]),
    };

    const result = await fileSync.migrateFromChromeStorage(legacyStorage);

    expect(result.migrated).toBe(1);
    expect(legacyStorage.getAllSessions).toHaveBeenCalled();
    expect(legacyStorage.getSteps).toHaveBeenCalledWith(sampleSession.sessionId);
    expect(fileSync.setMigrated).toHaveBeenCalled();

    // Verify session folder was created
    const folderName = fileSync._sessionFolderName(sampleSession);
    expect(root._dirs.has(folderName)).toBe(true);
  });

  it('throws when no handle is configured', async () => {
    fileSync.getHandle = vi.fn().mockResolvedValue(null);
    const legacyStorage = { getAllSessions: vi.fn().mockResolvedValue([]) };
    await expect(fileSync.migrateFromChromeStorage(legacyStorage)).rejects.toThrow();
  });

  it('returns migrated: 0 when no legacy sessions', async () => {
    const root = makeDirHandle('.TestSnapper');
    fileSync.getHandle = vi.fn().mockResolvedValue(root);
    fileSync.setMigrated = vi.fn().mockResolvedValue(undefined);

    const legacyStorage = { getAllSessions: vi.fn().mockResolvedValue([]) };
    const result = await fileSync.migrateFromChromeStorage(legacyStorage);
    expect(result.migrated).toBe(0);
  });
});
