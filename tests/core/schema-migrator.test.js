/**
 * SchemaMigrator unit tests.
 *
 * Exercises the SchemaMigrator class against a mock chrome.storage.local.
 * Tests:
 *   - v1 → v2 migration moves step keys correctly and removes old v1 key
 *   - Idempotency (running migration twice produces same state)
 *   - Already-v2 data is untouched
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
const { SchemaMigrator } = await import('../../src/core/schema-migrator.js');

// ─────────────────────────────────────────────────────────────────────────────
// Mock StorageManager with _writeSteps and _writeAssetsLegacy
// ─────────────────────────────────────────────────────────────────────────────

class MockStorageManager {
  constructor() {
    this.writtenSteps = new Map();
    this.writtenAssets = new Map();
  }

  async _writeSteps(sessionId, steps) {
    this.writtenSteps.set(sessionId, steps);
    const obj = {};
    obj[`testsnapper_steps_${sessionId}`] = steps;
    for (const [k, v] of Object.entries(obj)) {
      chromeStore.set(k, v);
    }
  }

  async _writeAssetsLegacy(sessionId, assets) {
    this.writtenAssets.set(sessionId, assets);
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
// v1 → v2 migration tests
// ─────────────────────────────────────────────────────────────────────────────

describe('SchemaMigrator.migrateIfNeeded', () => {
  it('migrates v1 data to v2 split-key architecture', async () => {
    // Ensure clean state
    chromeStore.clear();

    // Setup v1 data
    const v1Data = {
      sessions: [
        {
          sessionId: 'session-1',
          sessionName: 'Test 1',
          steps: [
            { id: 'step-1', action: 'click', fieldName: 'Login' },
            { id: 'step-2', action: 'type', fieldName: 'Email', value: 'test@example.com' },
          ],
          assets: [
            { id: 'asset-1', stepId: 'step-1', type: 'screenshot', dataUrl: 'data:image/png;base64,abc123' },
          ],
        },
      ],
    };

    chromeStore.set('testsnapper_data', v1Data);

    // Run migration
    const storage = new MockStorageManager();
    const migrator = new SchemaMigrator(storage);
    await migrator.migrateIfNeeded();

    // Verify v1 key was removed
    expect(chromeStore.has('testsnapper_data')).toBe(false);

    // Verify v2 structure was created
    expect(chromeStore.has('testsnapper_sessions')).toBe(true);
    const sessions = chromeStore.get('testsnapper_sessions');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('session-1');
    expect(sessions[0].sessionName).toBe('Test 1');
    // Steps and assets should NOT be in the index row
    expect(sessions[0].steps).toBeUndefined();
    expect(sessions[0].assets).toBeUndefined();

    // Verify split keys were created
    expect(chromeStore.has('testsnapper_steps_session-1')).toBe(true);
    expect(chromeStore.has('testsnapper_assets_session-1')).toBe(true);

    const steps = chromeStore.get('testsnapper_steps_session-1');
    expect(steps).toHaveLength(2);
    expect(steps[0].id).toBe('step-1');

    const assets = chromeStore.get('testsnapper_assets_session-1');
    expect(assets).toHaveLength(1);
    expect(assets[0].id).toBe('asset-1');

    // Verify meta was created
    expect(chromeStore.has('testsnapper_meta')).toBe(true);
    const meta = chromeStore.get('testsnapper_meta');
    expect(meta.version).toBe(2);
    expect(meta.sessionCount).toBe(1);
  });

  it('handles v1 data with multiple sessions', async () => {
    const v1Data = {
      sessions: [
        {
          sessionId: 'session-1',
          sessionName: 'Session 1',
          steps: [{ id: 'step-1-1', action: 'click' }],
          assets: [],
        },
        {
          sessionId: 'session-2',
          sessionName: 'Session 2',
          steps: [
            { id: 'step-2-1', action: 'type' },
            { id: 'step-2-2', action: 'navigate' },
          ],
          assets: [{ id: 'asset-2-1', stepId: 'step-2-1', type: 'screenshot' }],
        },
      ],
    };

    chromeStore.set('testsnapper_data', v1Data);

    const storage = new MockStorageManager();
    const migrator = new SchemaMigrator(storage);
    await migrator.migrateIfNeeded();

    const sessions = chromeStore.get('testsnapper_sessions');
    expect(sessions).toHaveLength(2);
    expect(sessions[0].sessionId).toBe('session-1');
    expect(sessions[1].sessionId).toBe('session-2');

    const meta = chromeStore.get('testsnapper_meta');
    expect(meta.sessionCount).toBe(2);
  });

  it('skips invalid sessions during migration', async () => {
    const v1Data = {
      sessions: [
        {
          sessionId: 'session-1',
          sessionName: 'Valid',
          steps: [{ id: 'step-1', action: 'click' }],
          assets: [],
        },
        {
          // Missing sessionId
          sessionName: 'Invalid',
          steps: [],
          assets: [],
        },
        {
          sessionId: 'session-2',
          sessionName: 'Also Valid',
          steps: [],
          assets: [],
        },
      ],
    };

    chromeStore.set('testsnapper_data', v1Data);

    const storage = new MockStorageManager();
    const migrator = new SchemaMigrator(storage);
    await migrator.migrateIfNeeded();

    const sessions = chromeStore.get('testsnapper_sessions');
    expect(sessions).toHaveLength(2); // Only valid sessions
    expect(sessions.map(s => s.sessionId)).toEqual(['session-1', 'session-2']);
  });

  it('does not migrate if v1 key is absent', async () => {
    // No v1 key in storage
    const storage = new MockStorageManager();
    const migrator = new SchemaMigrator(storage);
    await migrator.migrateIfNeeded();

    // No keys should be written
    expect(chromeStore.has('testsnapper_sessions')).toBe(false);
    expect(storage.writtenSteps.size).toBe(0);
  });

  it('does nothing if already v2', async () => {
    // Setup v2 data (no v1 key)
    chromeStore.set('testsnapper_meta', { version: 2 });
    chromeStore.set('testsnapper_sessions', [
      { sessionId: 'session-1', sessionName: 'Existing' },
    ]);
    chromeStore.set('testsnapper_steps_session-1', [
      { id: 'step-1', action: 'click' },
    ]);

    const storage = new MockStorageManager();
    const migrator = new SchemaMigrator(storage);
    await migrator.migrateIfNeeded();

    // Storage should not be modified
    expect(storage.writtenSteps.size).toBe(0);

    // Existing data should remain
    const sessions = chromeStore.get('testsnapper_sessions');
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionName).toBe('Existing');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Idempotency tests
// ─────────────────────────────────────────────────────────────────────────────

describe('SchemaMigrator.migrateIfNeeded — idempotency', () => {
  it('running migration twice produces the same final state', async () => {
    const v1Data = {
      sessions: [
        {
          sessionId: 'session-1',
          sessionName: 'Test',
          steps: [{ id: 'step-1', action: 'click' }],
          assets: [{ id: 'asset-1', stepId: 'step-1', type: 'screenshot' }],
        },
      ],
    };

    chromeStore.set('testsnapper_data', v1Data);

    // First migration
    const storage1 = new MockStorageManager();
    const migrator1 = new SchemaMigrator(storage1);
    await migrator1.migrateIfNeeded();

    // Capture state after first migration
    const sessionsAfterFirst = chromeStore.get('testsnapper_sessions');
    const stepsAfterFirst = chromeStore.get('testsnapper_steps_session-1');
    const metaAfterFirst = chromeStore.get('testsnapper_meta');

    // Second migration
    const storage2 = new MockStorageManager();
    const migrator2 = new SchemaMigrator(storage2);
    await migrator2.migrateIfNeeded();

    // Verify state is identical after second migration
    const sessionsAfterSecond = chromeStore.get('testsnapper_sessions');
    const stepsAfterSecond = chromeStore.get('testsnapper_steps_session-1');
    const metaAfterSecond = chromeStore.get('testsnapper_meta');

    expect(sessionsAfterSecond).toEqual(sessionsAfterFirst);
    expect(stepsAfterSecond).toEqual(stepsAfterFirst);
    // Meta version should still be 2
    expect(metaAfterSecond.version).toBe(2);
  });

  it('v1 key is not recreated after removal', async () => {
    const v1Data = {
      sessions: [
        {
          sessionId: 'session-1',
          sessionName: 'Test',
          steps: [],
          assets: [],
        },
      ],
    };

    chromeStore.set('testsnapper_data', v1Data);

    const storage = new MockStorageManager();
    const migrator = new SchemaMigrator(storage);
    await migrator.migrateIfNeeded();

    // First migration removes the key
    expect(chromeStore.has('testsnapper_data')).toBe(false);

    // Run migration again
    await migrator.migrateIfNeeded();

    // Key should still be gone
    expect(chromeStore.has('testsnapper_data')).toBe(false);
  });
});
