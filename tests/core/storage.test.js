/**
 * StorageManager unit tests.
 *
 * Exercises the chrome.storage.local-backed StorageManager against a small
 * in-memory chrome.storage mock. Covers:
 *   - updateSession strips hydrated steps/assets from the metadata index row (fix #4)
 *   - _stepsCache respects its size cap (fix #5)
 *   - importData normalizes/validates non-string + oversized sessionName/fieldName (fix #3)
 *   - createSession → addStep → getSteps round-trip + clearSession cleanup
 *
 * Mocking style mirrors tests/core/fs-storage.test.js (in-memory Map + vi.stubGlobal).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { sampleSession, sampleSteps, tinyPngDataURL } from '../helpers/fixtures.js';

// ─────────────────────────────────────────────────────────────────────────────
// In-memory chrome.storage.local mock (installed fresh in beforeEach)
// ─────────────────────────────────────────────────────────────────────────────

const chromeStore = new Map();

vi.stubGlobal('chrome', {
  storage: {
    local: {
      get: vi.fn(async (keys) => {
        if (keys === null || keys === undefined) {
          const result = {};
          for (const [k, v] of chromeStore.entries()) result[k] = v;
          return result;
        }
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
      remove: vi.fn(async (keys) => {
        const ks = Array.isArray(keys) ? keys : [keys];
        for (const k of ks) chromeStore.delete(k);
      }),
      getBytesInUse: vi.fn(async () => {
        let total = 0;
        for (const [k, v] of chromeStore.entries()) {
          total += k.length + JSON.stringify(v ?? null).length;
        }
        return total;
      }),
    },
  },
});

// Import AFTER the global is stubbed.
const { StorageManager } = await import('../../src/core/storage.js');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeStorage() {
  const storage = new StorageManager();
  // Neutralize quota gating so createSession/addStep/addAsset don't depend on
  // QuotaMonitor internals (out of scope for these fixes).
  storage._checkQuota = vi.fn().mockResolvedValue(undefined);
  storage.getStorageUsage = vi.fn().mockResolvedValue({ percentage: 0 });
  return storage;
}

/** Read the raw persisted session-index array from the mock store. */
function readIndexRow(sessionId) {
  const sessions = chromeStore.get('testsnapper_sessions') || [];
  return sessions.find(s => s.sessionId === sessionId);
}

beforeEach(() => {
  chromeStore.clear();
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-trip: createSession → addStep → getSteps → clearSession
// ─────────────────────────────────────────────────────────────────────────────

describe('StorageManager — round-trip', () => {
  it('creates a session, adds a step, reads it back, then clears it', async () => {
    const storage = makeStorage();
    await storage.createSession({ ...sampleSession });

    const step = { ...sampleSteps[1], id: sampleSteps[1].stepId, sessionId: sampleSession.sessionId };
    await storage.addStep(step);

    const steps = await storage.getSteps(sampleSession.sessionId);
    expect(steps).toHaveLength(1);
    expect(steps[0].id).toBe(step.id);

    // stepCount tracked in the index row
    expect(readIndexRow(sampleSession.sessionId).stepCount).toBe(1);

    await storage.clearSession(sampleSession.sessionId);
    expect(readIndexRow(sampleSession.sessionId)).toBeUndefined();
    expect(chromeStore.has(`testsnapper_steps_${sampleSession.sessionId}`)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fix #4 — updateSession strips hydrated steps/assets from the index row
// ─────────────────────────────────────────────────────────────────────────────

describe('StorageManager.updateSession — metadata-only index row (fix #4)', () => {
  it('drops steps and assets arrays before persisting the session index', async () => {
    const storage = makeStorage();
    await storage.createSession({ ...sampleSession });

    // Simulate passing a HYDRATED session (e.g. from getSession()).
    const hydrated = {
      ...sampleSession,
      sessionName: 'Renamed',
      steps: sampleSteps.map(s => ({ ...s, id: s.stepId })),
      assets: [{ id: 'a1', dataUrl: tinyPngDataURL }],
    };

    await storage.updateSession(hydrated, { stepCount: 5 });

    const row = readIndexRow(sampleSession.sessionId);
    expect(row.sessionName).toBe('Renamed');
    expect(row.stepCount).toBe(5);
    // Heavy fields must NOT leak into the lightweight metadata index.
    expect(row.steps).toBeUndefined();
    expect(row.assets).toBeUndefined();
  });

  it('keeps stepCount handling intact when no hint is given', async () => {
    const storage = makeStorage();
    await storage.createSession({ ...sampleSession });
    await storage.addStep({ id: 'step-001', sessionId: sampleSession.sessionId, action: 'click' });
    await storage.addStep({ id: 'step-002', sessionId: sampleSession.sessionId, action: 'type' });

    await storage.updateSession({ ...sampleSession, sessionName: 'X' });
    expect(readIndexRow(sampleSession.sessionId).stepCount).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fix #5 — _stepsCache size cap
// ─────────────────────────────────────────────────────────────────────────────

describe('StorageManager._stepsCache — size cap (fix #5)', () => {
  it('never exceeds the configured maximum number of entries', async () => {
    const storage = makeStorage();

    // Populate well beyond the cap (cap is 25).
    for (let i = 0; i < 60; i++) {
      storage._cacheSteps(`session-${i}`, [{ id: `s${i}` }]);
    }

    expect(storage._stepsCache.size).toBeLessThanOrEqual(25);
  });

  it('evicts the oldest entry first (insertion order)', async () => {
    const storage = makeStorage();
    for (let i = 0; i < 26; i++) {
      storage._cacheSteps(`session-${i}`, [{ id: `s${i}` }]);
    }
    // session-0 was the first inserted → evicted; session-25 retained.
    expect(storage._stepsCache.has('session-0')).toBe(false);
    expect(storage._stepsCache.has('session-25')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fix #3 — importData normalizes hostile sessionName / fieldName
// ─────────────────────────────────────────────────────────────────────────────

describe('StorageManager.importData — field normalization (fix #3)', () => {
  function makeBackup(overrides = {}) {
    return {
      meta: { version: 2, sessionCount: 1, lastCleanup: Date.now() },
      sessions: [
        {
          sessionId: 'imp0001-1111-2222-3333-444455556666',
          sessionName: 'Valid Name',
          steps: [],
          assets: [],
          ...overrides,
        },
      ],
    };
  }

  it('coerces a non-string sessionName to an empty string', async () => {
    const storage = makeStorage();
    const backup = makeBackup({ sessionName: { evil: true } });
    await storage.importData(backup);

    const sessions = chromeStore.get('testsnapper_sessions');
    expect(sessions[0].sessionName).toBe('');
  });

  it('truncates an oversized sessionName to the 500-char cap', async () => {
    const storage = makeStorage();
    const backup = makeBackup({ sessionName: 'x'.repeat(5000) });
    await storage.importData(backup);

    const sessions = chromeStore.get('testsnapper_sessions');
    expect(sessions[0].sessionName.length).toBe(500);
  });

  it('normalizes a non-string fieldName on a step to empty string', async () => {
    const storage = makeStorage();
    const backup = makeBackup({
      steps: [{ id: 'aaaaaaaa', action: 'type', fieldName: 12345 }],
    });
    await storage.importData(backup);

    const steps = await storage.getSteps('imp0001-1111-2222-3333-444455556666');
    expect(steps[0].fieldName).toBe('');
  });

  it('truncates an oversized fieldName to the 500-char cap', async () => {
    const storage = makeStorage();
    const backup = makeBackup({
      steps: [{ id: 'bbbbbbbb', action: 'type', fieldName: 'y'.repeat(5000) }],
    });
    await storage.importData(backup);

    const steps = await storage.getSteps('imp0001-1111-2222-3333-444455556666');
    expect(steps[0].fieldName.length).toBe(500);
  });

  it('still rejects a malformed backup structure', async () => {
    const storage = makeStorage();
    await expect(storage.importData({ meta: {}, sessions: 'nope' })).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// exportAllData — 50MB size guard (fix #2)
// ─────────────────────────────────────────────────────────────────────────────

describe('StorageManager.exportAllData — size guard (fix #2)', () => {
  it('returns a normal export for small datasets', async () => {
    const storage = makeStorage();
    await storage.createSession({ ...sampleSession });
    await storage.addStep({ id: 'step-001', sessionId: sampleSession.sessionId, action: 'click' });

    const data = await storage.exportAllData();
    expect(Array.isArray(data.sessions)).toBe(true);
    expect(data.sessions[0].sessionId).toBe(sampleSession.sessionId);
  });

  it('throws a clear error when the dataset exceeds the 50MB limit', async () => {
    const storage = makeStorage();
    await storage.createSession({ ...sampleSession });

    // Inject an oversized steps payload that bypasses normal write paths,
    // so exportAllData's accumulator trips the guard.
    const huge = [{ id: 'big', blob: 'z'.repeat(60 * 1024 * 1024) }];
    vi.spyOn(storage, '_readSteps').mockResolvedValue(huge);
    vi.spyOn(storage, '_readAssets').mockResolvedValue([]);

    await expect(storage.exportAllData()).rejects.toThrow(/50MB safe limit/);
  });
});
