import { describe, it, expect } from 'vitest';
import { sanitizeUrl, maskGenericPII } from '../../src/core/privacy-utils.js';

// ──────────────────────────────────────────────
// sanitizeUrl (SEC-1 / SEC-6)
// ──────────────────────────────────────────────

describe('sanitizeUrl', () => {
  it('strips OAuth / token query params but keeps the rest', () => {
    const out = sanitizeUrl('https://app.example.com/cb?code=abc123&state=xyz&page=2');
    expect(out).not.toContain('abc123');
    expect(out).not.toContain('state=xyz');
    expect(out).toContain('page=2');
    expect(out.startsWith('https://app.example.com/cb')).toBe(true);
  });

  it('strips a wide set of sensitive keys (case-insensitive)', () => {
    for (const key of ['token', 'access_token', 'jwt', 'api_key', 'password', 'sig', 'otp', 'reset_token', 'SessionId']) {
      const out = sanitizeUrl(`https://x.test/p?${key}=SECRET&keep=1`);
      expect(out).not.toContain('SECRET');
      expect(out).toContain('keep=1');
    }
  });

  it('strips a token-bearing fragment (OAuth implicit flow)', () => {
    const out = sanitizeUrl('https://x.test/cb#access_token=SECRET&token_type=bearer');
    expect(out).not.toContain('SECRET');
  });

  it('leaves clean URLs and relative/non-URLs untouched', () => {
    expect(sanitizeUrl('https://example.com/path?page=3')).toBe('https://example.com/path?page=3');
    expect(sanitizeUrl('/relative/path')).toBe('/relative/path');
    expect(sanitizeUrl('')).toBe('');
    expect(sanitizeUrl(null)).toBe('');
  });
});

// ──────────────────────────────────────────────
// maskGenericPII (SEC-2 / SEC-3)
// ──────────────────────────────────────────────

describe('maskGenericPII', () => {
  it('partially masks emails', () => {
    const out = maskGenericPII('reach me at john.doe@company.co.uk please');
    expect(out).not.toContain('john.doe@company.co.uk');
    expect(out).toContain('@company.co.uk');
  });

  it('masks Luhn-valid cards of 15 and 16 digits, incl. spaced', () => {
    expect(maskGenericPII('378282246310005')).toContain('****');       // Amex
    expect(maskGenericPII('4111 1111 1111 1111')).toContain('****');   // Visa spaced
  });

  it('does NOT mask a card-shaped number that fails Luhn', () => {
    expect(maskGenericPII('order 1234567890123456')).toContain('1234567890123456');
  });

  it('masks separated / parenthesized / international phones', () => {
    expect(maskGenericPII('(555) 123-4567')).toContain('***-***-****');
    expect(maskGenericPII('+1 555 123 4567')).toContain('***-***-****');
    expect(maskGenericPII('555.123.4567')).toContain('***-***-****');
  });

  it('masks dashed SSNs', () => {
    expect(maskGenericPII('SSN 123-45-6789')).toContain('***-**-****');
  });

  it('leaves plain text and non-strings untouched', () => {
    expect(maskGenericPII('just a normal label')).toBe('just a normal label');
    expect(maskGenericPII(null)).toBe(null);
    expect(maskGenericPII(42)).toBe(42);
  });

  it('is idempotent (re-masking already-masked text is stable)', () => {
    const once = maskGenericPII('card 4111 1111 1111 1111 phone (555) 123-4567');
    expect(maskGenericPII(once)).toBe(once);
  });
});
