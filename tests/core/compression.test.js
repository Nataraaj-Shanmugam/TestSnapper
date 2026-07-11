import { describe, it, expect, beforeAll } from 'vitest';
import { compress, decompress, isCompressed, isPlainFallback } from '../../src/core/compression.js';
import { installCompressionPolyfill } from '../helpers/compression-polyfill.js';

// ─────────────────────────────────────────────────────────────────────────────
// Polyfill CompressionStream / DecompressionStream for Node / jsdom
// ─────────────────────────────────────────────────────────────────────────────
beforeAll(() => {
  installCompressionPolyfill();
});

// ─────────────────────────────────────────────────────────────────────────────
// isCompressed
// ─────────────────────────────────────────────────────────────────────────────

describe('isCompressed', () => {
  it('returns true for a string with COMPRESSED::GZIP:: prefix', () => {
    expect(isCompressed('COMPRESSED::GZIP::abc123==')).toBe(true);
  });

  it('returns false for a PLAIN:: prefixed string', () => {
    expect(isCompressed('PLAIN::[]')).toBe(false);
  });

  it('returns false for a plain JSON string', () => {
    expect(isCompressed('[]')).toBe(false);
  });

  it('returns false for a non-string (array)', () => {
    expect(isCompressed([])).toBe(false);
  });

  it('returns false for a non-string (object)', () => {
    expect(isCompressed({ key: 'value' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isCompressed(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isCompressed(undefined)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isPlainFallback
// ─────────────────────────────────────────────────────────────────────────────

describe('isPlainFallback', () => {
  it('returns true for PLAIN:: prefixed string', () => {
    expect(isPlainFallback('PLAIN::[]')).toBe(true);
  });

  it('returns false for COMPRESSED::GZIP:: string', () => {
    expect(isPlainFallback('COMPRESSED::GZIP::abc')).toBe(false);
  });

  it('returns false for a raw JSON string', () => {
    expect(isPlainFallback('[{"action":"click"}]')).toBe(false);
  });

  it('returns false for non-string values', () => {
    expect(isPlainFallback([])).toBe(false);
    expect(isPlainFallback(null)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// decompress — non-GZIP paths (no CompressionStream needed)
// ─────────────────────────────────────────────────────────────────────────────

describe('decompress — fallback paths', () => {
  it('returns non-string input as-is (legacy uncompressed array)', async () => {
    const data = [{ action: 'click', fieldName: 'OK' }];
    await expect(decompress(data)).resolves.toEqual(data);
  });

  it('parses a PLAIN:: prefixed string back to original data', async () => {
    const original = [{ action: 'type', fieldName: 'Email', value: 'a@b.com' }];
    const plain = 'PLAIN::' + JSON.stringify(original);
    await expect(decompress(plain)).resolves.toEqual(original);
  });

  it('parses a raw JSON string that has no prefix', async () => {
    const original = [{ action: 'navigate', value: 'https://example.com' }];
    await expect(decompress(JSON.stringify(original))).resolves.toEqual(original);
  });

  it('returns the raw string as-is when input is an invalid / unrecognised string', async () => {
    // The implementation tries JSON.parse; on failure it returns the string unchanged
    await expect(decompress('not-valid-json-or-prefix')).resolves.toBe('not-valid-json-or-prefix');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// compress + decompress round-trip (uses CompressionStream polyfill)
// ─────────────────────────────────────────────────────────────────────────────

describe('compress / decompress round-trip', () => {
  const steps = [
    { stepId: '1', action: 'click', fieldName: 'Login', selector: { css: '#login-btn' } },
    { stepId: '2', action: 'type',  fieldName: 'Email', value: 'user@example.com' },
    { stepId: '3', action: 'navigate', value: 'https://example.com/dashboard' },
  ];

  it('compress returns a string with the COMPRESSED::GZIP:: prefix', async () => {
    const result = await compress(steps);
    expect(typeof result).toBe('string');
    expect(result.startsWith('COMPRESSED::GZIP::')).toBe(true);
  });

  it('round-trip preserves the original data exactly', async () => {
    const compressed = await compress(steps);
    const decompressed = await decompress(compressed);
    expect(decompressed).toEqual(steps);
  });

  it('isCompressed returns true for compress() output', async () => {
    const compressed = await compress(steps);
    expect(isCompressed(compressed)).toBe(true);
  });

  it('compresses larger data to fewer bytes than raw JSON', async () => {
    const large = Array.from({ length: 100 }, (_, i) => ({
      stepId: `step-${i}`,
      action: 'click',
      fieldName: 'Submit Button',
      selector: { css: '#submit-btn', xpath: '//button[@type="submit"]' },
    }));
    const raw = JSON.stringify(large);
    const compressed = await compress(large);
    // Strip prefix before measuring (prefix is overhead, body should be smaller)
    const body = compressed.slice('COMPRESSED::GZIP::'.length);
    expect(body.length).toBeLessThan(raw.length);
  });

  it('handles an empty array without throwing', async () => {
    const compressed = await compress([]);
    const decompressed = await decompress(compressed);
    expect(decompressed).toEqual([]);
  });

  it('handles deeply nested objects', async () => {
    const complex = [{ a: { b: { c: [1, 2, 3] } }, d: 'hello', e: null }];
    const compressed = await compress(complex);
    const decompressed = await decompress(compressed);
    expect(decompressed).toEqual(complex);
  });
});
