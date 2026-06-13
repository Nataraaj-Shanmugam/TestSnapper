/**
 * SchemaMigrator — handles versioned storage migrations for TestSnapper.
 *
 * FIX: FUNC-010 — v1→v2 migration never ran when meta key was absent.
 *
 * Root cause: _readMeta defaulted a missing meta key to { version: STORAGE_VERSION (=2) }
 * so migrateIfNeeded saw version 2 and skipped. Users upgrading from v1 were permanently
 * locked out of migration.
 *
 * Fix: detect v1 by checking for the presence of the old `testsnapper_data` key regardless
 * of what the meta version field says. Migration is idempotent — old key is removed after
 * successful migration so it will never re-run.
 */

const STORAGE_VERSION = 2;
const META_KEY = 'testsnapper_meta';
const SESSIONS_KEY = 'testsnapper_sessions';
const V1_DATA_KEY = 'testsnapper_data';

export class SchemaMigrator {
    /**
     * @param {StorageManager} storageManager - The StorageManager instance (for _writeSteps / _writeAssets)
     */
    constructor(storageManager) {
        this._storage = storageManager;
    }

    /**
     * Run any pending migrations and update meta.version.
     * Called once during StorageManager.init().
     *
     * @returns {Promise<void>}
     */
    async migrateIfNeeded() {
        // FIX: FUNC-010 — Always probe for the v1 key regardless of meta.version.
        // If testsnapper_data exists with sessions, we need to migrate no matter what
        // the meta says.  This handles users whose meta was missing (defaulted to v2).
        const v1Check = await chrome.storage.local.get(V1_DATA_KEY);
        if (v1Check[V1_DATA_KEY] && v1Check[V1_DATA_KEY].sessions) {
            await this._migrateV1toV2(v1Check[V1_DATA_KEY]);
            return;
        }

        // No v1 data — check meta version for any other migrations
        const metaResult = await chrome.storage.local.get(META_KEY);
        const meta = metaResult[META_KEY];

        // If meta is absent or version is already current, nothing to do.
        if (!meta || meta.version >= STORAGE_VERSION) {
            return;
        }

        // Placeholder: future migrations (v2→v3, etc.) go here.
        console.log(`SchemaMigrator: no migration path from v${meta.version} to v${STORAGE_VERSION}`);
    }

    /**
     * Migrate from v1 (single `testsnapper_data` key) to v2 (split-key architecture).
     * Idempotent — removes `testsnapper_data` after success so it won't re-run.
     *
     * @param {{ sessions: Array }} v1Data
     * @returns {Promise<void>}
     */
    async _migrateV1toV2(v1Data) {
        console.log('SchemaMigrator: migrating v1 → v2...');

        const sessions = v1Data.sessions;

        if (!Array.isArray(sessions)) {
            console.error('SchemaMigrator: v1 sessions is not an array — aborting migration');
            throw new Error('Invalid v1 data format: sessions must be an array');
        }

        const validSessions = sessions.filter(s => {
            if (!s || !s.sessionId) {
                console.warn('SchemaMigrator: skipping invalid session during migration:', s);
                return false;
            }
            return true;
        });

        if (validSessions.length === 0) {
            console.warn('SchemaMigrator: no valid sessions in v1 data');
        } else {
            // Write session index (strip embedded steps/assets from metadata row)
            const sessionMeta = validSessions.map(({ steps, assets, ...meta }) => meta);
            await chrome.storage.local.set({ [SESSIONS_KEY]: sessionMeta });

            // Write per-session steps and assets
            for (const session of validSessions) {
                const steps = Array.isArray(session.steps) ? session.steps : [];
                const assets = Array.isArray(session.assets) ? session.assets : [];
                await this._storage._writeSteps(session.sessionId, steps);
                // Use the old _writeAssets path so the asset migration also works with the
                // new per-asset-key format introduced by PERF-002 if that fix is active.
                await this._storage._writeAssetsLegacy(session.sessionId, assets);
            }

            console.log(`SchemaMigrator: migrated ${validSessions.length} sessions`);
        }

        // Remove old key (idempotent — silently no-ops on second call)
        await chrome.storage.local.remove(V1_DATA_KEY);

        // Update meta version
        const metaResult = await chrome.storage.local.get(META_KEY);
        const meta = metaResult[META_KEY] || {};
        meta.version = STORAGE_VERSION;
        if (!meta.sessionCount) meta.sessionCount = validSessions.length;
        if (!meta.lastCleanup) meta.lastCleanup = Date.now();
        await chrome.storage.local.set({ [META_KEY]: meta });

        console.log('SchemaMigrator: v1 → v2 migration complete');
    }
}
