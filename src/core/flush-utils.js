/**
 * Shared flush coordination helpers.
 * Used by both background.js (service worker) and FSStorageManager (window context)
 * to track which sessions need to be flushed from chrome.storage to the filesystem.
 */

export const PENDING_FLUSH_KEY = 'testsnapper_pendingFlush';

export async function getPendingFlush() {
  const result = await chrome.storage.local.get(PENDING_FLUSH_KEY);
  return result[PENDING_FLUSH_KEY] || [];
}

export async function addPendingFlush(sessionId) {
  const pending = await getPendingFlush();
  if (!pending.includes(sessionId)) {
    pending.push(sessionId);
    await chrome.storage.local.set({ [PENDING_FLUSH_KEY]: pending });
  }
}

export async function removePendingFlush(sessionId) {
  const pending = await getPendingFlush();
  const updated = pending.filter(id => id !== sessionId);
  await chrome.storage.local.set({ [PENDING_FLUSH_KEY]: updated });
}
