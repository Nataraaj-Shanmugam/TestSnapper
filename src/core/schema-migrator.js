/**
 * Schema Migrator – chrome.storage.local schema versioning.
 *
 * Extracted from StorageManager (STR-002 / MED-002 architecture refactor).
 * Performs one-time data migrations when the stored schema version is behind
 * the current STORAGE_VERSION constant.
 *
 * The function receives a `storageOps` bag of helpers so it has no runtime
 * dependency on StorageManager internals.
 */

export const STORAGE_VERSION = 2;

/**
 * Migrate stored data to the current schema version if needed.
 *
 * @param {object} storageOps
 * @param {() => Promise<object>}                           storageOps.readMeta
 * @param {(meta: object) => Promise<void>}                 storageOps.writeMeta
 * @param {(sessions: object[]) => Promise<void>}           storageOps.writeSessions
 * @param {(id: string, steps: object[]) => Promise<void>}  storageOps.writeSteps
 * @param {(id: string, assets: object[]) => Promise<void>} storageOps.writeAssets
 */
export async function migrateIfNeeded(storageOps) {
  const { readMeta, writeMeta, writeSessions, writeSteps, writeAssets } = storageOps;
  const meta = await readMeta();

  if (!meta.version || meta.version < STORAGE_VERSION) {
    console.log(`🔄 Migrating storage from v${meta.version || 1} to v${STORAGE_VERSION}`);

    if (meta.version === 1 || !meta.version) {
      // Migration from v1 to v2: Split single-key storage into multi-key
      const oldKey = 'testsnapper_data';
      const oldData = await chrome.storage.local.get(oldKey);

      // BUG FIX: STR-HIGH-001 - Validate data before migration
      if (oldData[oldKey] && oldData[oldKey].sessions) {
        const sessions = oldData[oldKey].sessions;

        // Validate sessions array
        if (!Array.isArray(sessions)) {
          console.error('Migration failed: sessions is not an array');
          throw new Error('Invalid data format for migration');
        }

        // Validate each session has required fields
        const validSessions = sessions.filter(s => {
          if (!s || !s.sessionId) {
            console.warn('Skipping invalid session during migration:', s);
            return false;
          }
          return true;
        });

        if (validSessions.length === 0) {
          console.warn('No valid sessions to migrate');
        } else {
          // Write new format
          const sessionMeta = validSessions.map(({ steps, assets, ...meta }) => meta);
          await writeSessions(sessionMeta);

          for (const session of validSessions) {
            const steps = Array.isArray(session.steps) ? session.steps : [];
            const assets = Array.isArray(session.assets) ? session.assets : [];
            await writeSteps(session.sessionId, steps);
            await writeAssets(session.sessionId, assets);
          }

          console.log(`✅ Migration v1→v2 complete: ${validSessions.length} sessions migrated`);
        }

        // Remove old key
        await chrome.storage.local.remove(oldKey);
      }
    }

    // Update version
    meta.version = STORAGE_VERSION;
    await writeMeta(meta);
  }
}
