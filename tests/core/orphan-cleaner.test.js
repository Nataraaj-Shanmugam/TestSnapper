/**
 * OrphanCleaner unit tests.
 *
 * Exercises the OrphanCleaner class against a mock chrome.storage.local.
 * Tests:
 *   - cleanupOrphans deletes assets with no matching session ID
 *   - Weekly guard (second call within 7 days skipped)
 *   - No-op when no orphans
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// In-memory chrome.storage.local mock
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
    },
  },
});

// Import AFTER global is stubbed
const { OrphanCleaner } = await import('../../src/core/orphan-cleaner.js');

// ─────────────────────────────────────────────────────────────────────────────
// Mock StorageManager with minimal interface
// ─────────────────────────────────────────────────────────────────────────────

class MockStorageManager {
  constructor() {
    this.cleanedSessions = [];
  }

  async _readSessions() {
    const sessions = chromeStore.get('testsnapper_sessions') || [];
    return sessions;
  }

  async _readSteps(sessionId) {
    return chromeStore.get(`testsnapper_steps_${sessionId}`) || [];
  }

  async getAssets(sessionId) {
    return chromeStore.get(`testsnapper_assets_${sessionId}`) || [];
  }

  async _writeAssetsFromArray(sessionId, assets) {
    const obj = {};
    obj[`testsnapper_assets_${sessionId}`] = assets;
    for (const [k, v] of Object.entries(obj)) {
      chromeStore.set(k, v);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  chromeStore.clear();
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// cleanupOrphans tests
// ─────────────────────────────────────────────────────────────────────────────

describe('OrphanCleaner.cleanupOrphans', () => {
  it('deletes assets with no matching session ID', async () => {
    // Setup: session-1 exists, but we have orphaned keys for session-deleted
    chromeStore.set('testsnapper_sessions', [
      { sessionId: 'session-1', sessionName: 'Session 1' },
    ]);
    chromeStore.set('testsnapper_steps_session-1', [
      { id: 'step-1', action: 'click' },
    ]);
    chromeStore.set('testsnapper_assets_session-1', [
      { id: 'asset-1', stepId: 'step-1', type: 'screenshot' },
    ]);

    // Orphaned key (session was deleted but this key remains)
    chromeStore.set('testsnapper_steps_session-deleted', [
      { id: 'step-orphan', action: 'click' },
    ]);
    chromeStore.set('testsnapper_assets_session-deleted', [
      { id: 'asset-orphan', stepId: 'step-orphan' },
    ]);

    // Set lastCleanup to past so cleanup will run
    chromeStore.set('testsnapper_meta', {
      lastCleanup: Date.now() - 8 * 24 * 60 * 60 * 1000, // 8 days ago
    });

    const storage = new MockStorageManager();
    const cleaner = new OrphanCleaner(storage);
    const removed = await cleaner.cleanupOrphans();

    // Orphaned keys should be deleted
    expect(chromeStore.has('testsnapper_steps_session-deleted')).toBe(false);
    expect(chromeStore.has('testsnapper_assets_session-deleted')).toBe(false);

    // Valid session keys should remain
    expect(chromeStore.has('testsnapper_steps_session-1')).toBe(true);
    expect(chromeStore.has('testsnapper_assets_session-1')).toBe(true);

    // Should return count of removed items
    expect(removed).toBeGreaterThan(0);
  });

  it('deletes multiple orphaned session keys', async () => {
    chromeStore.set('testsnapper_sessions', [
      { sessionId: 'session-1', sessionName: 'Session 1' },
    ]);
    chromeStore.set('testsnapper_meta', {
      lastCleanup: Date.now() - 8 * 24 * 60 * 60 * 1000,
    });

    // Add orphaned keys from multiple deleted sessions
    chromeStore.set('testsnapper_steps_session-deleted-1', [
      { id: 'step-1', action: 'click' },
    ]);
    chromeStore.set('testsnapper_assets_session-deleted-1', [
      { id: 'asset-1', stepId: 'step-1' },
    ]);
    chromeStore.set('testsnapper_steps_session-deleted-2', [
      { id: 'step-2', action: 'type' },
    ]);
    chromeStore.set('testsnapper_assetIndex_session-deleted-2', {
      assets: [],
    });

    const storage = new MockStorageManager();
    const cleaner = new OrphanCleaner(storage);
    const removed = await cleaner.cleanupOrphans();

    expect(chromeStore.has('testsnapper_steps_session-deleted-1')).toBe(false);
    expect(chromeStore.has('testsnapper_assets_session-deleted-1')).toBe(false);
    expect(chromeStore.has('testsnapper_steps_session-deleted-2')).toBe(false);
    expect(chromeStore.has('testsnapper_assetIndex_session-deleted-2')).toBe(false);

    expect(removed).toBeGreaterThan(0);
  });

  it('does nothing when no orphans exist', async () => {
    chromeStore.set('testsnapper_sessions', [
      { sessionId: 'session-1', sessionName: 'Session 1' },
    ]);
    chromeStore.set('testsnapper_steps_session-1', [
      { id: 'step-1', action: 'click' },
    ]);
    chromeStore.set('testsnapper_assets_session-1', [
      { id: 'asset-1', stepId: 'step-1' },
    ]);
    chromeStore.set('testsnapper_meta', {
      lastCleanup: Date.now() - 8 * 24 * 60 * 60 * 1000,
    });

    const beforeKeys = new Set(chromeStore.keys());

    const storage = new MockStorageManager();
    const cleaner = new OrphanCleaner(storage);
    const removed = await cleaner.cleanupOrphans();

    const afterKeys = new Set(chromeStore.keys());

    // No keys should be deleted
    expect(beforeKeys.size).toEqual(afterKeys.size);
    expect(removed).toBeGreaterThanOrEqual(0);
  });

  it('handles per-asset orphaned keys (PERF-002 format)', async () => {
    chromeStore.set('testsnapper_sessions', [
      { sessionId: 'session-1', sessionName: 'Session 1' },
    ]);
    chromeStore.set('testsnapper_meta', {
      lastCleanup: Date.now() - 8 * 24 * 60 * 60 * 1000,
    });

    // Add orphaned per-asset keys from deleted session
    chromeStore.set('testsnapper_asset_session-deleted_asset-1', { dataUrl: 'data:...' });
    chromeStore.set('testsnapper_asset_session-deleted_asset-2', { dataUrl: 'data:...' });

    const storage = new MockStorageManager();
    const cleaner = new OrphanCleaner(storage);
    const removed = await cleaner.cleanupOrphans();

    expect(chromeStore.has('testsnapper_asset_session-deleted_asset-1')).toBe(false);
    expect(chromeStore.has('testsnapper_asset_session-deleted_asset-2')).toBe(false);

    expect(removed).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Weekly gate tests
// ─────────────────────────────────────────────────────────────────────────────

describe('OrphanCleaner.cleanupOrphans — weekly gate', () => {
  it('skips cleanup if called within 7 days of last cleanup', async () => {
    chromeStore.set('testsnapper_sessions', [
      { sessionId: 'session-1', sessionName: 'Session 1' },
    ]);

    // Set lastCleanup to just 1 day ago
    const oneDayAgo = Date.now() - 1 * 24 * 60 * 60 * 1000;
    chromeStore.set('testsnapper_meta', {
      lastCleanup: oneDayAgo,
    });

    // Add an orphaned key (should NOT be cleaned because gate blocks it)
    chromeStore.set('testsnapper_steps_session-deleted', [
      { id: 'step-orphan', action: 'click' },
    ]);

    const storage = new MockStorageManager();
    const cleaner = new OrphanCleaner(storage);
    const removed = await cleaner.cleanupOrphans();

    // Orphaned key should still be there
    expect(chromeStore.has('testsnapper_steps_session-deleted')).toBe(true);

    // Should return 0 removed
    expect(removed).toBe(0);
  });

  it('runs cleanup if 7 days or more have passed since last cleanup', async () => {
    chromeStore.set('testsnapper_sessions', [
      { sessionId: 'session-1', sessionName: 'Session 1' },
    ]);

    // Set lastCleanup to 8 days ago (beyond the 7-day threshold)
    const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
    chromeStore.set('testsnapper_meta', {
      lastCleanup: eightDaysAgo,
    });

    // Add an orphaned key (should be cleaned)
    chromeStore.set('testsnapper_steps_session-deleted', [
      { id: 'step-orphan', action: 'click' },
    ]);

    const storage = new MockStorageManager();
    const cleaner = new OrphanCleaner(storage);
    const removed = await cleaner.cleanupOrphans();

    // Orphaned key should be deleted
    expect(chromeStore.has('testsnapper_steps_session-deleted')).toBe(false);

    expect(removed).toBeGreaterThan(0);
  });

  it('runs cleanup if no lastCleanup timestamp exists', async () => {
    chromeStore.set('testsnapper_sessions', [
      { sessionId: 'session-1', sessionName: 'Session 1' },
    ]);

    // No lastCleanup set (first run)
    chromeStore.set('testsnapper_meta', {});

    // Add an orphaned key (should be cleaned)
    chromeStore.set('testsnapper_steps_session-deleted', [
      { id: 'step-orphan', action: 'click' },
    ]);

    const storage = new MockStorageManager();
    const cleaner = new OrphanCleaner(storage);
    const removed = await cleaner.cleanupOrphans();

    // Orphaned key should be deleted
    expect(chromeStore.has('testsnapper_steps_session-deleted')).toBe(false);

    expect(removed).toBeGreaterThan(0);
  });

  it('updates lastCleanup timestamp after running', async () => {
    chromeStore.set('testsnapper_sessions', []);
    chromeStore.set('testsnapper_meta', {
      lastCleanup: Date.now() - 8 * 24 * 60 * 60 * 1000,
    });

    const beforeTime = Date.now();

    const storage = new MockStorageManager();
    const cleaner = new OrphanCleaner(storage);
    await cleaner.cleanupOrphans();

    const afterTime = Date.now();

    const meta = chromeStore.get('testsnapper_meta');
    expect(meta.lastCleanup).toBeGreaterThanOrEqual(beforeTime);
    expect(meta.lastCleanup).toBeLessThanOrEqual(afterTime);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Asset orphan detection tests
// ─────────────────────────────────────────────────────────────────────────────

describe('OrphanCleaner.cleanupOrphans — asset orphans within sessions', () => {
  it('removes assets whose stepId does not exist in the session', async () => {
    chromeStore.clear();

    chromeStore.set('testsnapper_sessions', [
      { sessionId: 'session-1', sessionName: 'Session 1' },
    ]);

    // Session has steps 1 and 2
    chromeStore.set('testsnapper_steps_session-1', [
      { id: 'step-1', action: 'click' },
      { id: 'step-2', action: 'type' },
    ]);

    // But assets reference steps 1, 2, and 3 (step-3 doesn't exist)
    chromeStore.set('testsnapper_assets_session-1', [
      { id: 'asset-1', stepId: 'step-1', type: 'screenshot' },
      { id: 'asset-2', stepId: 'step-2', type: 'screenshot' },
      { id: 'asset-3', stepId: 'step-3', type: 'screenshot' }, // Orphaned
    ]);

    chromeStore.set('testsnapper_meta', {
      lastCleanup: Date.now() - 8 * 24 * 60 * 60 * 1000,
    });

    const storage = new MockStorageManager();
    const cleaner = new OrphanCleaner(storage);
    const removed = await cleaner.cleanupOrphans();

    // Verify orphaned asset was removed
    const assets = chromeStore.get('testsnapper_assets_session-1');
    expect(assets).toHaveLength(2);
    expect(assets.map(a => a.id)).toEqual(['asset-1', 'asset-2']);

    expect(removed).toBeGreaterThan(0);
  });
});
