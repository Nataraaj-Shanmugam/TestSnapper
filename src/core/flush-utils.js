/**
 * Shared flush coordination helpers.
 * Used by both background.js (service worker) and FSStorageManager (window context)
 * to track which sessions need to be flushed from chrome.storage to the filesystem.
 *
 * SINGLE-INDEX APPROACH: Pending session IDs are stored in ONE chrome.storage key
 * (`testsnapper_pending_index`) holding an array of sessionIds, rather than one key
 * per session (`testsnapper_pending_{sessionId}`).
 *
 * The single-index scheme provides a small RMW window in add/remove, but eliminates
 * the far more expensive O(all-keys) scan in getPendingFlush() — which would call
 * chrome.storage.local.get(null), pulling EVERY key into memory just to find a
 * handful of flag keys. For TestSnapper's normal single-actor flush cadence the RMW
 * window is acceptable; the memory/perf win is significant.
 */

import { Logger } from './logger.js';

const PENDING_INDEX_KEY = 'testsnapper_pending_index';

/**
 * Read the pending-index array from storage.
 * @private
 * @returns {Promise<string[]>}
 */
async function _readIndex() {
  const result = await chrome.storage.local.get(PENDING_INDEX_KEY);
  const arr = result[PENDING_INDEX_KEY];
  return Array.isArray(arr) ? arr : [];
}

/**
 * Return all session IDs that are currently pending a filesystem flush.
 * @returns {Promise<string[]>}
 */
export async function getPendingFlush() {
  return _readIndex();
}

/**
 * Mark a sessionId as needing a filesystem flush.
 * No-op on a falsy id. Deduplicates: an id already present is not added again.
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
export async function addPendingFlush(sessionId) {
  if (!sessionId) return;
  const index = await _readIndex();
  if (index.includes(sessionId)) return;
  index.push(sessionId);
  await chrome.storage.local.set({ [PENDING_INDEX_KEY]: index });
}

/**
 * Remove a sessionId from the pending-flush set after a successful flush.
 * No-op on a falsy id.
 * @param {string} sessionId
 * @returns {Promise<void>}
 */
export async function removePendingFlush(sessionId) {
  if (!sessionId) return;
  const index = await _readIndex();
  const next = index.filter(id => id !== sessionId);
  if (next.length === index.length) return; // nothing to remove
  await chrome.storage.local.set({ [PENDING_INDEX_KEY]: next });
}
