/**
 * Shared flush coordination helpers.
 * Used by both background.js (service worker) and FSStorageManager (window context)
 * to track which sessions need to be flushed from chrome.storage to the filesystem.
 *
 * PERF-004 FIX: Each pending sessionId is stored as its own chrome.storage key
 * (`testsnapper_pending_{sessionId}`) instead of a shared array to eliminate
 * read-modify-write races when multiple operations complete concurrently.
 */

/** @param {string} sessionId */
function _pendingKey(sessionId) {
  return `testsnapper_pending_${sessionId}`;
}

/**
 * Return all session IDs that are currently pending a filesystem flush.
 * @returns {Promise<string[]>}
 */
export async function getPendingFlush() {
  // Enumerate all testsnapper_pending_* keys to collect pending sessions
  const allData = await chrome.storage.local.get(null);
  const prefix = 'testsnapper_pending_';
  return Object.keys(allData)
    .filter(k => k.startsWith(prefix) && allData[k] === true)
    .map(k => k.slice(prefix.length));
}

/**
 * Mark a sessionId as needing a filesystem flush.
 * Race-safe: each sessionId writes its own independent key.
 * @param {string} sessionId
 */
export async function addPendingFlush(sessionId) {
  if (!sessionId) return;
  await chrome.storage.local.set({ [_pendingKey(sessionId)]: true });
}

/**
 * Remove a sessionId from the pending-flush set after a successful flush.
 * Race-safe: operates only on the single key for this session.
 * @param {string} sessionId
 */
export async function removePendingFlush(sessionId) {
  if (!sessionId) return;
  await chrome.storage.local.remove(_pendingKey(sessionId));
}
