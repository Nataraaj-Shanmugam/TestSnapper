/**
 * QuotaMonitor unit tests.
 *
 * Exercises the QuotaMonitor class against a mock chrome.storage.local.
 * Tests:
 *   - getStorageUsage at various thresholds (0%, 79%, 80%, 95%, 100%)
 *   - checkQuota throws StorageQuotaExceeded at ≥95%
 *   - onQuotaWarning registration and offQuotaWarning deregistration
 *   - _notifyQuotaWarning broadcasts to all listeners and isolates errors
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// In-memory chrome.storage.local mock
// ─────────────────────────────────────────────────────────────────────────────

let mockBytesInUse = 0;

vi.stubGlobal('chrome', {
  storage: {
    local: {
      getBytesInUse: vi.fn((keys, callback) => {
        callback(mockBytesInUse);
      }),
    },
  },
  runtime: {
    lastError: null,
  },
});

// Import AFTER the global is stubbed
const { QuotaMonitor } = await import('../../src/core/quota-monitor.js');

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockBytesInUse = 0;
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// getStorageUsage tests
// ─────────────────────────────────────────────────────────────────────────────

describe('QuotaMonitor.getStorageUsage', () => {
  it('returns 0 usage with 0% percentage at 0 bytes', async () => {
    const qm = new QuotaMonitor(1000);
    mockBytesInUse = 0;

    const usage = await qm.getStorageUsage();
    expect(usage.used).toBe(0);
    expect(usage.total).toBe(1000);
    expect(usage.percentage).toBe(0);
    expect(usage.warning).toBe(false);
    expect(usage.error).toBe(false);
  });

  it('returns correct usage at 79% (no warning)', async () => {
    const qm = new QuotaMonitor(1000);
    mockBytesInUse = 790;

    const usage = await qm.getStorageUsage();
    expect(usage.used).toBe(790);
    expect(usage.percentage).toBe(0.79);
    expect(usage.warning).toBe(false);
    expect(usage.error).toBe(false);
  });

  it('returns warning=true at 80% threshold', async () => {
    const qm = new QuotaMonitor(1000);
    mockBytesInUse = 800;

    const usage = await qm.getStorageUsage();
    expect(usage.used).toBe(800);
    expect(usage.percentage).toBe(0.8);
    expect(usage.warning).toBe(true);
    expect(usage.error).toBe(false);
  });

  it('returns error=true at 95% critical threshold', async () => {
    const qm = new QuotaMonitor(1000);
    mockBytesInUse = 950;

    const usage = await qm.getStorageUsage();
    expect(usage.used).toBe(950);
    expect(usage.percentage).toBe(0.95);
    expect(usage.warning).toBe(false);
    expect(usage.error).toBe(true);
  });

  it('returns error=true at 100% usage', async () => {
    const qm = new QuotaMonitor(1000);
    mockBytesInUse = 1000;

    const usage = await qm.getStorageUsage();
    expect(usage.used).toBe(1000);
    expect(usage.percentage).toBe(1);
    expect(usage.error).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// checkQuota tests
// ─────────────────────────────────────────────────────────────────────────────

describe('QuotaMonitor.checkQuota', () => {
  it('returns usage object when under 95%', async () => {
    const qm = new QuotaMonitor(1000);
    mockBytesInUse = 900; // 90%

    const usage = await qm.checkQuota();
    expect(usage.used).toBe(900);
    expect(usage.percentage).toBe(0.9);
  });

  it('throws StorageQuotaExceeded at 95%', async () => {
    const qm = new QuotaMonitor(1000);
    mockBytesInUse = 950;

    await expect(qm.checkQuota()).rejects.toThrow();
    try {
      await qm.checkQuota();
    } catch (err) {
      expect(err.name).toBe('StorageQuotaExceeded');
    }
  });

  it('throws StorageQuotaExceeded at 100%', async () => {
    const qm = new QuotaMonitor(1000);
    mockBytesInUse = 1000;

    try {
      await qm.checkQuota();
    } catch (err) {
      expect(err.name).toBe('StorageQuotaExceeded');
    }
  });

  it('calls _notifyQuotaWarning when at warning threshold (80%)', async () => {
    const qm = new QuotaMonitor(1000);
    mockBytesInUse = 800;
    vi.spyOn(qm, '_notifyQuotaWarning');

    await qm.checkQuota();
    expect(qm._notifyQuotaWarning).toHaveBeenCalled();
  });

  it('calls _notifyQuotaWarning when at critical threshold (95%)', async () => {
    const qm = new QuotaMonitor(1000);
    mockBytesInUse = 950;
    vi.spyOn(qm, '_notifyQuotaWarning');

    try {
      await qm.checkQuota();
    } catch {
      // Expected to throw
    }
    expect(qm._notifyQuotaWarning).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Listener management (onQuotaWarning / offQuotaWarning)
// ─────────────────────────────────────────────────────────────────────────────

describe('QuotaMonitor.onQuotaWarning and offQuotaWarning', () => {
  it('registers a listener via onQuotaWarning', async () => {
    const qm = new QuotaMonitor(1000);
    const listener = vi.fn();

    qm.onQuotaWarning(listener);
    expect(qm._listeners).toContain(listener);
  });

  it('does not add a listener if the argument is not a function', async () => {
    const qm = new QuotaMonitor(1000);
    qm.onQuotaWarning('not-a-function');
    qm.onQuotaWarning(null);
    qm.onQuotaWarning(undefined);

    expect(qm._listeners).toHaveLength(0);
  });

  it('removes a listener via offQuotaWarning', async () => {
    const qm = new QuotaMonitor(1000);
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    qm.onQuotaWarning(listener1);
    qm.onQuotaWarning(listener2);
    expect(qm._listeners).toHaveLength(2);

    qm.offQuotaWarning(listener1);
    expect(qm._listeners).toHaveLength(1);
    expect(qm._listeners).toContain(listener2);
  });

  it('silently ignores offQuotaWarning for a non-registered listener', async () => {
    const qm = new QuotaMonitor(1000);
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    qm.onQuotaWarning(listener1);
    qm.offQuotaWarning(listener2); // listener2 was never added
    expect(qm._listeners).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// _notifyQuotaWarning tests
// ─────────────────────────────────────────────────────────────────────────────

describe('QuotaMonitor._notifyQuotaWarning', () => {
  it('calls all registered listeners with the usage object', async () => {
    const qm = new QuotaMonitor(1000);
    const listener1 = vi.fn();
    const listener2 = vi.fn();

    qm.onQuotaWarning(listener1);
    qm.onQuotaWarning(listener2);

    const usage = { used: 800, total: 1000, percentage: 0.8, warning: true, error: false };
    qm._notifyQuotaWarning(usage);

    expect(listener1).toHaveBeenCalledWith(usage);
    expect(listener2).toHaveBeenCalledWith(usage);
  });

  it('isolates errors from individual listeners so others still run', async () => {
    const qm = new QuotaMonitor(1000);
    const listener1 = vi.fn(() => {
      throw new Error('listener1 failed');
    });
    const listener2 = vi.fn();
    const listener3 = vi.fn();

    qm.onQuotaWarning(listener1);
    qm.onQuotaWarning(listener2);
    qm.onQuotaWarning(listener3);

    const usage = { used: 800, total: 1000, percentage: 0.8, warning: true, error: false };
    // Should not throw despite listener1 throwing
    expect(() => {
      qm._notifyQuotaWarning(usage);
    }).not.toThrow();

    expect(listener1).toHaveBeenCalled();
    expect(listener2).toHaveBeenCalled();
    expect(listener3).toHaveBeenCalled();
  });

  it('does nothing when no listeners are registered', async () => {
    const qm = new QuotaMonitor(1000);
    const usage = { used: 800, total: 1000, percentage: 0.8, warning: true, error: false };

    expect(() => {
      qm._notifyQuotaWarning(usage);
    }).not.toThrow();
  });
});
