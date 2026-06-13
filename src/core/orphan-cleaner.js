/**
 * OrphanCleaner — removes storage keys that belong to deleted/missing sessions.
 *
 * FIX: PERF-013 + FUNC-019
 *
 * Problem: clearSession removes the session index entry first then data keys.
 * A SW kill between those two writes leaves testsnapper_steps_{id} /
 * testsnapper_assets_{id} / testsnapper_asset_{id}_{assetId} /
 * testsnapper_assetIndex_{id} keys orphaned forever.
 * OrphanCleaner previously only iterated existing sessions so it never
 * discovered keys whose session was already removed from the index.
 *
 * Fix: after the normal within-session orphan sweep (assets whose stepId no
 * longer exists), perform a full key sweep: enumerate all storage keys, find
 * any testsnapper_(steps|assets|asset|assetIndex)_* key whose embedded
 * sessionId is NOT in the live session set, and remove them.
 *
 * The weekly-gate is preserved so this extra sweep does not run unconditionally.
 */

const META_KEY = 'testsnapper_meta';
const SESSIONS_KEY = 'testsnapper_sessions';
const CLEANUP_INTERVAL_DAYS = 7;

// Regex to extract sessionId from orphan-candidate keys.
// Matches:
//   testsnapper_steps_{sessionId}
//   testsnapper_assets_{sessionId}          (legacy single-array key)
//   testsnapper_assetIndex_{sessionId}      (PERF-002 index key)
//   testsnapper_asset_{sessionId}_{assetId} (PERF-002 per-asset key)
const ORPHAN_KEY_RE = /^testsnapper_(?:steps|assets|assetIndex|asset)_([^_]+)/;

export class OrphanCleaner {
    /**
     * @param {StorageManager} storageManager
     */
    constructor(storageManager) {
        this._storage = storageManager;
    }

    /**
     * Find assets inside each known session that reference non-existent steps.
     * @returns {Promise<Array>} orphaned asset objects
     */
    async findOrphanedAssets() {
        const sessions = await this._storage._readSessions();
        const orphaned = [];

        for (const session of sessions) {
            const steps = await this._storage._readSteps(session.sessionId);
            const assets = await this._storage.getAssets(session.sessionId);
            const stepIds = new Set(steps.map(s => s.id));

            for (const asset of assets) {
                if (!stepIds.has(asset.stepId)) {
                    orphaned.push(asset);
                }
            }
        }

        return orphaned;
    }

    /**
     * Remove orphaned assets within known sessions AND sweep for keys whose
     * session was already deleted from the index (PERF-013 key sweep).
     *
     * Respects the weekly gate — only runs when CLEANUP_INTERVAL_DAYS have passed.
     *
     * @returns {Promise<number>} total number of orphaned items removed
     */
    async cleanupOrphans() {
        // ── Weekly gate ──────────────────────────────────────────────────────
        const metaResult = await chrome.storage.local.get(META_KEY);
        const meta = metaResult[META_KEY] || {};
        const daysSinceCleanup = (Date.now() - (meta.lastCleanup || 0)) / (1000 * 60 * 60 * 24);

        if (daysSinceCleanup < CLEANUP_INTERVAL_DAYS) {
            // Not yet time — skip silently
            return 0;
        }
        // ─────────────────────────────────────────────────────────────────────

        let totalRemoved = 0;

        // ── Phase 1: within-session orphan sweep (assets without a matching step) ──
        const sessions = await this._storage._readSessions();
        const liveSessionIds = new Set(sessions.map(s => s.sessionId));

        for (const session of sessions) {
            const steps = await this._storage._readSteps(session.sessionId);
            const assets = await this._storage.getAssets(session.sessionId);
            const stepIds = new Set(steps.map(s => s.id));

            const beforeCount = assets.length;
            const cleaned = assets.filter(a => stepIds.has(a.stepId));
            const removed = beforeCount - cleaned.length;

            if (removed > 0) {
                // Rewrite assets for this session using the current storage API
                await this._storage._writeAssetsFromArray(session.sessionId, cleaned);
                totalRemoved += removed;
            }
        }

        // ── Phase 2: key sweep for fully-orphaned sessions ───────────────────
        // FIX: PERF-013 / FUNC-019 — detect keys whose session was deleted
        let allStorage;
        try {
            allStorage = await chrome.storage.local.get(null);
        } catch (err) {
            console.warn('OrphanCleaner: could not enumerate all keys:', err);
            allStorage = {};
        }

        const keysToRemove = [];
        for (const key of Object.keys(allStorage)) {
            const match = ORPHAN_KEY_RE.exec(key);
            if (!match) continue;
            const sessionId = match[1];
            if (!liveSessionIds.has(sessionId)) {
                keysToRemove.push(key);
            }
        }

        if (keysToRemove.length > 0) {
            // Remove in batches to avoid a single massive call
            const BATCH = 50;
            for (let i = 0; i < keysToRemove.length; i += BATCH) {
                await chrome.storage.local.remove(keysToRemove.slice(i, i + BATCH));
            }
            console.log(`OrphanCleaner: removed ${keysToRemove.length} orphaned storage keys`);
            totalRemoved += keysToRemove.length;
        }

        // ── Update last cleanup timestamp ────────────────────────────────────
        meta.lastCleanup = Date.now();
        await chrome.storage.local.set({ [META_KEY]: meta });

        console.log(`OrphanCleaner: cleanup complete — ${totalRemoved} items removed`);
        return totalRemoved;
    }
}
