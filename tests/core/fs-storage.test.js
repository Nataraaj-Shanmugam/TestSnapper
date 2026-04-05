/**
 * FSStorageManager unit tests.
 *
 * FSStorageManager routes operations between:
 *   - FileSync (filesystem, window context)
 *   - StorageManager (chrome.storage buffer, service worker context)
 *
 * We mock both dependencies so tests are pure JS with no real I/O.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sampleSession, sampleSteps, tinyPngDataURL } from '../helpers/fixtures.js';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks: set up before importing FSStorageManager
// ─────────────────────────────────────────────────────────────────────────────

// Mock chrome.storage.local
const chromeStore = new Map();
vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (keys) => {
        if (typeof keys === 'string') return { [keys]: chromeStore.get(keys) };
        const result = {};
        for (const k of (Array.isArray(keys) ? keys : Object.keys(keys))) {
          result[k] = chromeStore.get(k);
        }
        return result;
      }),
      set: vi.fn(async (obj) => {
        for (const [k, v] of Object.entries(obj)) chromeStore.set(k, v);
      }),
    },
  },
});

// Mock FileSync
const mockFileSync = {
  getHandle: vi.fn(),
  readSessionIndex: vi.fn(),
  readSession: vi.fn(),
  readSteps: vi.fn(),
  readAssets: vi.fn(),
  writeSession: vi.fn(),
  deleteSession: vi.fn(),
  sessionExists: vi.fn(),
  updateSessionIndex: vi.fn(),
  readAllSessionsFull: vi.fn(),
};

// Mock StorageManager
const mockBuffer = {
  init: vi.fn().mockResolvedValue(true),
  createSession: vi.fn(),
  getSession: vi.fn(),
  getAllSessions: vi.fn(),
  updateSession: vi.fn(),
  updateSessionName: vi.fn(),
  clearSession: vi.fn(),
  addStep: vi.fn(),
  getSteps: vi.fn(),
  deleteStep: vi.fn(),
  updateStep: vi.fn(),
  updateAllSteps: vi.fn(),
  batchUpdateSteps: vi.fn(),
  batchDeleteSteps: vi.fn(),
  addAsset: vi.fn(),
  getAllAssets: vi.fn(),
  getAssetsByStepId: vi.fn(),
  deleteAssets: vi.fn(),
  getStorageUsage: vi.fn(),
  exportAllData: vi.fn(),
  importData: vi.fn(),
};

vi.mock('../../src/core/file-sync.js', () => ({
  FileSync: vi.fn(() => mockFileSync),
}));

vi.mock('../../src/core/storage.js', () => ({
  StorageManager: vi.fn(() => mockBuffer),
}));

// Import AFTER mocks
const { FSStorageManager } = await import('../../src/core/fs-storage.js');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeWindowStorage() {
  // Force window context
  const fs = new FSStorageManager();
  fs._isServiceWorker = false;
  return fs;
}

function makeWorkerStorage() {
  const fs = new FSStorageManager();
  fs._isServiceWorker = true;
  fs._fileSync = null; // mirror what constructor does when isServiceWorker=true
  return fs;
}

beforeEach(() => {
  chromeStore.clear();
  vi.clearAllMocks();
  mockBuffer.init.mockResolvedValue(true);
  mockFileSync.getHandle.mockResolvedValue({ kind: 'directory', name: '.TestSnapper' });
});

// ─────────────────────────────────────────────────────────────────────────────
// Context detection
// ─────────────────────────────────────────────────────────────────────────────

describe('FSStorageManager — context detection', () => {
  it('creates a FileSync instance in window context', () => {
    const fs = makeWindowStorage();
    expect(fs.fileSync).toBe(mockFileSync);
  });

  it('has no FileSync in service worker context', () => {
    const fs = makeWorkerStorage();
    expect(fs.fileSync).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// init
// ─────────────────────────────────────────────────────────────────────────────

describe('FSStorageManager.init', () => {
  it('initializes the buffer', async () => {
    const fs = makeWindowStorage();
    await fs.init();
    expect(mockBuffer.init).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isFilesystemReady
// ─────────────────────────────────────────────────────────────────────────────

describe('FSStorageManager.isFilesystemReady', () => {
  it('returns true when FileSync.getHandle returns a handle', async () => {
    const fs = makeWindowStorage();
    mockFileSync.getHandle.mockResolvedValue({ kind: 'directory' });
    expect(await fs.isFilesystemReady()).toBe(true);
  });

  it('returns false when FileSync.getHandle returns null', async () => {
    const fs = makeWindowStorage();
    mockFileSync.getHandle.mockResolvedValue(null);
    expect(await fs.isFilesystemReady()).toBe(false);
  });

  it('returns false in service worker context', async () => {
    const fs = makeWorkerStorage();
    expect(await fs.isFilesystemReady()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pending flush management
// ─────────────────────────────────────────────────────────────────────────────

describe('FSStorageManager — pending flush', () => {
  it('adds and retrieves a pending flush entry', async () => {
    const fs = makeWindowStorage();
    await fs.addPendingFlush('session-abc');
    const pending = await fs.getPendingFlush();
    expect(pending).toContain('session-abc');
  });

  it('does not duplicate entries', async () => {
    const fs = makeWindowStorage();
    await fs.addPendingFlush('dup-id');
    await fs.addPendingFlush('dup-id');
    const pending = await fs.getPendingFlush();
    expect(pending.filter(id => id === 'dup-id')).toHaveLength(1);
  });

  it('removes a pending flush entry', async () => {
    const fs = makeWindowStorage();
    await fs.addPendingFlush('to-remove');
    await fs.removePendingFlush('to-remove');
    const pending = await fs.getPendingFlush();
    expect(pending).not.toContain('to-remove');
  });

  it('isInBuffer returns true for buffered session', async () => {
    const fs = makeWindowStorage();
    await fs.addPendingFlush('buffered-session');
    expect(await fs.isInBuffer('buffered-session')).toBe(true);
  });

  it('isInBuffer returns false for non-buffered session', async () => {
    const fs = makeWindowStorage();
    expect(await fs.isInBuffer('not-buffered')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// flushSession
// ─────────────────────────────────────────────────────────────────────────────

describe('FSStorageManager.flushSession', () => {
  it('reads from buffer and writes to filesystem, then clears buffer', async () => {
    const fs = makeWindowStorage();
    const sessionId = sampleSession.sessionId;

    await fs.addPendingFlush(sessionId);
    mockBuffer.getSession.mockResolvedValue({
      ...sampleSession,
      steps: sampleSteps.map(s => ({ ...s, id: s.stepId })),
      assets: [],
    });
    mockBuffer.getSteps.mockResolvedValue(sampleSteps.map(s => ({ ...s, id: s.stepId })));
    mockBuffer.getAllAssets.mockResolvedValue([]);
    mockBuffer.clearSession.mockResolvedValue(true);
    mockFileSync.writeSession.mockResolvedValue();

    const ok = await fs.flushSession(sessionId);
    expect(ok).toBe(true);
    expect(mockFileSync.writeSession).toHaveBeenCalled();
    expect(mockBuffer.clearSession).toHaveBeenCalledWith(sessionId);

    // Should be removed from pending
    expect(await fs.isInBuffer(sessionId)).toBe(false);
  });

  it('returns false in service worker context', async () => {
    const fs = makeWorkerStorage();
    expect(await fs.flushSession('any')).toBe(false);
  });

  it('returns false when filesystem not ready', async () => {
    const fs = makeWindowStorage();
    mockFileSync.getHandle.mockResolvedValue(null);
    expect(await fs.flushSession('any')).toBe(false);
  });

  it('returns false when session not found in buffer', async () => {
    const fs = makeWindowStorage();
    mockBuffer.getSession.mockResolvedValue(null);
    expect(await fs.flushSession('no-such')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getAllSessions
// ─────────────────────────────────────────────────────────────────────────────

describe('FSStorageManager.getAllSessions', () => {
  it('reads from filesystem index in window context', async () => {
    const fs = makeWindowStorage();
    const sessions = [{ sessionId: 'abc', sessionName: 'A' }];
    mockFileSync.readSessionIndex.mockResolvedValue(sessions);

    const result = await fs.getAllSessions();
    expect(mockFileSync.readSessionIndex).toHaveBeenCalled();
    expect(result).toContainEqual(expect.objectContaining({ sessionId: 'abc' }));
  });

  it('merges buffered sessions with filesystem index', async () => {
    const fs = makeWindowStorage();
    const fsSessions = [{ sessionId: 'fs-1', sessionName: 'FS One' }];
    const bufSessions = [{ sessionId: 'buf-1', sessionName: 'Buffer One' }];

    mockFileSync.readSessionIndex.mockResolvedValue(fsSessions);
    await fs.addPendingFlush('buf-1');
    mockBuffer.getAllSessions.mockResolvedValue(bufSessions);

    const result = await fs.getAllSessions();
    expect(result).toHaveLength(2);
    expect(result.some(s => s.sessionId === 'fs-1')).toBe(true);
    expect(result.some(s => s.sessionId === 'buf-1')).toBe(true);
  });

  it('routes to buffer in service worker context', async () => {
    const fs = makeWorkerStorage();
    mockBuffer.getAllSessions.mockResolvedValue([sampleSession]);
    const result = await fs.getAllSessions();
    expect(mockBuffer.getAllSessions).toHaveBeenCalled();
    expect(result).toContainEqual(sampleSession);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getSession
// ─────────────────────────────────────────────────────────────────────────────

describe('FSStorageManager.getSession', () => {
  it('reads from filesystem when not in buffer', async () => {
    const fs = makeWindowStorage();
    const sessionId = sampleSession.sessionId;

    mockFileSync.readSession.mockResolvedValue({
      session: { ...sampleSession },
      steps: sampleSteps.map(s => ({ ...s, id: s.stepId })),
    });

    const result = await fs.getSession(sessionId);
    expect(mockFileSync.readSession).toHaveBeenCalledWith(sessionId);
    expect(result.sessionId).toBe(sessionId);
  });

  it('reads from buffer when session is pending flush', async () => {
    const fs = makeWindowStorage();
    const sessionId = sampleSession.sessionId;

    await fs.addPendingFlush(sessionId);
    mockBuffer.getSession.mockResolvedValue(sampleSession);

    const result = await fs.getSession(sessionId);
    expect(mockBuffer.getSession).toHaveBeenCalledWith(sessionId);
    expect(mockFileSync.readSession).not.toHaveBeenCalled();
  });

  it('routes to buffer in service worker context', async () => {
    const fs = makeWorkerStorage();
    mockBuffer.getSession.mockResolvedValue(sampleSession);
    const result = await fs.getSession(sampleSession.sessionId);
    expect(mockBuffer.getSession).toHaveBeenCalled();
    expect(result).toEqual(sampleSession);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createSession
// ─────────────────────────────────────────────────────────────────────────────

describe('FSStorageManager.createSession', () => {
  it('writes to filesystem in window context', async () => {
    const fs = makeWindowStorage();
    mockFileSync.writeSession.mockResolvedValue();

    const session = await fs.createSession({ ...sampleSession });
    expect(mockFileSync.writeSession).toHaveBeenCalled();
    expect(session.sessionId).toBe(sampleSession.sessionId);
  });

  it('buffers and marks pending in service worker context', async () => {
    const fs = makeWorkerStorage();
    mockBuffer.createSession.mockResolvedValue(sampleSession);

    await fs.createSession(sampleSession);
    expect(mockBuffer.createSession).toHaveBeenCalled();
    // Should add to pending flush
    const pending = await fs.getPendingFlush();
    expect(pending).toContain(sampleSession.sessionId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// clearSession
// ─────────────────────────────────────────────────────────────────────────────

describe('FSStorageManager.clearSession', () => {
  it('deletes from filesystem and buffer in window context', async () => {
    const fs = makeWindowStorage();
    const sessionId = sampleSession.sessionId;
    await fs.addPendingFlush(sessionId);
    mockBuffer.clearSession.mockResolvedValue(true);
    mockFileSync.deleteSession.mockResolvedValue();

    await fs.clearSession(sessionId);
    expect(mockBuffer.clearSession).toHaveBeenCalledWith(sessionId);
    expect(mockFileSync.deleteSession).toHaveBeenCalledWith(sessionId);
  });

  it('routes to buffer in service worker context', async () => {
    const fs = makeWorkerStorage();
    mockBuffer.clearSession.mockResolvedValue(true);
    await fs.clearSession('any-id');
    expect(mockBuffer.clearSession).toHaveBeenCalledWith('any-id');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getSteps
// ─────────────────────────────────────────────────────────────────────────────

describe('FSStorageManager.getSteps', () => {
  it('reads steps from filesystem and strips screenshot field', async () => {
    const fs = makeWindowStorage();
    const sessionId = sampleSession.sessionId;
    const rawSteps = sampleSteps.map(s => ({
      ...s,
      id: s.stepId,
      screenshot: tinyPngDataURL,
    }));
    mockFileSync.readSteps.mockResolvedValue(rawSteps);

    const steps = await fs.getSteps(sessionId);
    expect(mockFileSync.readSteps).toHaveBeenCalledWith(sessionId);
    expect(steps[0].screenshot).toBeUndefined();
  });

  it('routes to buffer when session is pending flush', async () => {
    const fs = makeWindowStorage();
    const sessionId = sampleSession.sessionId;
    await fs.addPendingFlush(sessionId);
    mockBuffer.getSteps.mockResolvedValue(sampleSteps);

    const steps = await fs.getSteps(sessionId);
    expect(mockBuffer.getSteps).toHaveBeenCalledWith(sessionId);
    expect(mockFileSync.readSteps).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getAllAssets
// ─────────────────────────────────────────────────────────────────────────────

describe('FSStorageManager.getAllAssets', () => {
  it('reads assets from filesystem when not in buffer', async () => {
    const fs = makeWindowStorage();
    const sessionId = sampleSession.sessionId;
    const assets = [{ id: 'a1', stepId: 'step-001', dataUrl: tinyPngDataURL }];
    mockFileSync.readAssets.mockResolvedValue(assets);

    const result = await fs.getAllAssets(sessionId);
    expect(mockFileSync.readAssets).toHaveBeenCalledWith(sessionId);
    expect(result).toEqual(assets);
  });

  it('reads from buffer when session is pending flush', async () => {
    const fs = makeWindowStorage();
    const sessionId = sampleSession.sessionId;
    await fs.addPendingFlush(sessionId);
    mockBuffer.getAllAssets.mockResolvedValue([]);

    await fs.getAllAssets(sessionId);
    expect(mockBuffer.getAllAssets).toHaveBeenCalledWith(sessionId);
    expect(mockFileSync.readAssets).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// addAsset
// ─────────────────────────────────────────────────────────────────────────────

describe('FSStorageManager.addAsset', () => {
  it('embeds screenshot into the matching step on disk', async () => {
    const fs = makeWindowStorage();
    const asset = {
      sessionId: sampleSession.sessionId,
      stepId: 'step-001',
      dataUrl: tinyPngDataURL,
    };
    const existingData = {
      session: { ...sampleSession },
      steps: [{ id: 'step-001', action: 'screenshot', screenshot: null }],
    };
    mockFileSync.readSession.mockResolvedValue(existingData);
    mockFileSync.writeSession.mockResolvedValue();

    await fs.addAsset(asset);
    expect(mockFileSync.writeSession).toHaveBeenCalled();
    const [, writtenSteps] = mockFileSync.writeSession.mock.calls[0];
    expect(writtenSteps[0].screenshot).toBe(tinyPngDataURL);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateAllSteps
// ─────────────────────────────────────────────────────────────────────────────

describe('FSStorageManager.updateAllSteps', () => {
  it('preserves existing screenshots when rewriting steps', async () => {
    const fs = makeWindowStorage();
    const sessionId = sampleSession.sessionId;
    const existingData = {
      session: { ...sampleSession },
      steps: [
        { id: 'step-001', action: 'screenshot', screenshot: tinyPngDataURL },
        { id: 'step-002', action: 'click', screenshot: null },
      ],
    };
    mockFileSync.readSession.mockResolvedValue(existingData);
    mockFileSync.writeSession.mockResolvedValue();

    const newSteps = [
      { id: 'step-001', action: 'screenshot', notes: 'updated' },
      { id: 'step-002', action: 'click' },
    ];
    await fs.updateAllSteps(sessionId, newSteps);

    expect(mockFileSync.writeSession).toHaveBeenCalled();
    const [, writtenSteps] = mockFileSync.writeSession.mock.calls[0];
    // Screenshot from existing step should be preserved
    const step001 = writtenSteps.find(s => s.id === 'step-001');
    expect(step001.screenshot).toBe(tinyPngDataURL);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getStorageUsage
// ─────────────────────────────────────────────────────────────────────────────

describe('FSStorageManager.getStorageUsage', () => {
  it('returns filesystem indicator in window context', async () => {
    const fs = makeWindowStorage();
    const usage = await fs.getStorageUsage();
    expect(usage.filesystem).toBe(true);
    expect(usage.percentage).toBe(0);
  });

  it('delegates to buffer in service worker context', async () => {
    const fs = makeWorkerStorage();
    mockBuffer.getStorageUsage.mockResolvedValue({ used: 100, total: 5000, percentage: 2 });
    const usage = await fs.getStorageUsage();
    expect(mockBuffer.getStorageUsage).toHaveBeenCalled();
    expect(usage.percentage).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// _extractAssets helper
// ─────────────────────────────────────────────────────────────────────────────

describe('FSStorageManager._extractAssets', () => {
  it('extracts assets from steps with screenshots', () => {
    const fs = makeWindowStorage();
    const steps = [
      { id: 'step-001', action: 'navigate', screenshot: null },
      { id: 'step-002', action: 'screenshot', screenshot: tinyPngDataURL },
      { id: 'step-003', action: 'click', screenshot: null },
    ];
    const assets = fs._extractAssets('session-1', steps);
    expect(assets).toHaveLength(1);
    expect(assets[0].stepId).toBe('step-002');
    expect(assets[0].dataUrl).toBe(tinyPngDataURL);
    expect(assets[0].sessionId).toBe('session-1');
  });

  it('returns empty array when no screenshots', () => {
    const fs = makeWindowStorage();
    const steps = [{ id: 's1', action: 'click', screenshot: null }];
    expect(fs._extractAssets('sid', steps)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// No-op methods
// ─────────────────────────────────────────────────────────────────────────────

describe('FSStorageManager — no-op methods', () => {
  it('cleanupOrphans returns 0', async () => {
    const fs = makeWindowStorage();
    expect(await fs.cleanupOrphans()).toBe(0);
  });

  it('findOrphanedAssets returns empty array', async () => {
    const fs = makeWindowStorage();
    expect(await fs.findOrphanedAssets()).toEqual([]);
  });

  it('onQuotaWarning / offQuotaWarning do not throw', () => {
    const fs = makeWindowStorage();
    expect(() => fs.onQuotaWarning()).not.toThrow();
    expect(() => fs.offQuotaWarning()).not.toThrow();
  });
});
