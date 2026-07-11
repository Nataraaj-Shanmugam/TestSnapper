import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';

// redactor.js ships a module.exports fallback for Node/test environments
const require = createRequire(import.meta.url);
const { Redactor } = require('../../src/content/redactor.js');

// Helper to create a minimal input element with given attributes
function makeInput(attrs = {}) {
  const el = document.createElement('input');
  if (attrs.type)        el.type        = attrs.type;
  if (attrs.name)        el.name        = attrs.name;
  if (attrs.id)          el.id          = attrs.id;
  if (attrs.placeholder) el.placeholder = attrs.placeholder;
  if (attrs.className)   el.className   = attrs.className;
  if (attrs['aria-label']) el.setAttribute('aria-label', attrs['aria-label']);
  if (attrs['data-sensitive'] !== undefined) {
    el.dataset.sensitive = attrs['data-sensitive'];
  }
  return el;
}

// ──────────────────────────────────────────────
// shouldIgnoreField
// ──────────────────────────────────────────────

describe('Redactor.shouldIgnoreField', () => {
  let redactor;
  beforeEach(() => { redactor = new Redactor(); });

  it('returns false for null element', () => {
    expect(redactor.shouldIgnoreField(null)).toBe(false);
  });

  it('returns true for password-type inputs', () => {
    expect(redactor.shouldIgnoreField(makeInput({ type: 'password' }))).toBe(true);
  });

  it('returns true when data-sensitive="true"', () => {
    expect(redactor.shouldIgnoreField(makeInput({ 'data-sensitive': 'true' }))).toBe(true);
  });

  it('returns true for input named "ssn"', () => {
    expect(redactor.shouldIgnoreField(makeInput({ name: 'ssn' }))).toBe(true);
  });

  it('returns true for input named "credit_card"', () => {
    expect(redactor.shouldIgnoreField(makeInput({ name: 'credit_card' }))).toBe(true);
  });

  it('returns true for input with id "password"', () => {
    expect(redactor.shouldIgnoreField(makeInput({ id: 'user_password' }))).toBe(true);
  });

  it('returns true for input with placeholder containing "token"', () => {
    expect(redactor.shouldIgnoreField(makeInput({ placeholder: 'Enter token' }))).toBe(true);
  });

  it('returns true for input with aria-label containing "passport"', () => {
    expect(redactor.shouldIgnoreField(makeInput({ 'aria-label': 'passport number' }))).toBe(true);
  });

  it('returns false for normal text input', () => {
    expect(redactor.shouldIgnoreField(makeInput({ name: 'username', type: 'text' }))).toBe(false);
  });

  it('returns false for email input with neutral name', () => {
    expect(redactor.shouldIgnoreField(makeInput({ name: 'email', type: 'email' }))).toBe(false);
  });
});

// ──────────────────────────────────────────────
// maskValue
// ──────────────────────────────────────────────

describe('Redactor.maskValue', () => {
  let redactor;
  beforeEach(() => { redactor = new Redactor(); });

  it('returns empty string for empty value', () => {
    expect(redactor.maskValue('', makeInput())).toBe('');
  });

  it('fully redacts value for sensitive fields (password)', () => {
    const el = makeInput({ type: 'password' });
    const result = redactor.maskValue('mysecret', el);
    expect(result).toMatch(/^•+$/);
  });

  it('masks email address in non-email context (partial mask)', () => {
    const el = makeInput({ name: 'notes' });
    const result = redactor.maskValue('contact user@example.com now', el);
    expect(result).not.toContain('user@example.com');
    expect(result).toContain('@');
  });

  it('fully masks email address in email-type input', () => {
    const el = makeInput({ type: 'email', name: 'email' });
    const result = redactor.maskValue('user@example.com', el);
    expect(result).toBe('***@***.com');
  });

  it('masks phone numbers', () => {
    const el = makeInput({ name: 'notes' });
    const result = redactor.maskValue('Call 555-123-4567 today', el);
    expect(result).not.toContain('555-123-4567');
    expect(result).toContain('***-***-****');
  });

  it('masks SSN pattern', () => {
    const el = makeInput({ name: 'notes' });
    const result = redactor.maskValue('SSN: 123-45-6789', el);
    expect(result).not.toContain('123-45-6789');
    expect(result).toContain('***-**-****');
  });

  it('masks credit card numbers', () => {
    const el = makeInput({ name: 'payment' });
    const result = redactor.maskValue('4111 1111 1111 1111', el);
    expect(result).not.toContain('4111');
    expect(result).toContain('**** **** **** ****');
  });

  // SEC-3: broadened patterns
  it('masks a 15-digit Amex card (Luhn-valid)', () => {
    const el = makeInput({ name: 'payment' });
    // 378282246310005 is the canonical Amex test number (passes Luhn)
    const result = redactor.maskValue('card 378282246310005 exp', el);
    expect(result).not.toContain('378282246310005');
    expect(result).toContain('****');
  });

  it('does NOT mask a 16-digit non-card number (fails Luhn)', () => {
    const el = makeInput({ name: 'notes' });
    const result = redactor.maskValue('order 1234567890123456', el);
    expect(result).toContain('1234567890123456'); // preserved — not a real card
  });

  it('masks a parenthesized / spaced phone number', () => {
    const el = makeInput({ name: 'notes' });
    const result = redactor.maskValue('call (555) 123 4567 please', el);
    expect(result).not.toContain('123 4567');
    expect(result).toContain('***-***-****');
  });

  it('masks date of birth pattern', () => {
    const el = makeInput({ name: 'info' });
    const result = redactor.maskValue('DOB: 01/15/1990', el);
    expect(result).not.toContain('01/15/1990');
    expect(result).toContain('**/**/****');
  });

  it('leaves normal text unchanged', () => {
    const el = makeInput({ name: 'notes' });
    const result = redactor.maskValue('hello world', el);
    expect(result).toBe('hello world');
  });

  it('is callable multiple times without lastIndex drift (no /g bug)', () => {
    const el = makeInput({ name: 'info' });
    const first  = redactor.maskValue('Call 555-123-4567 today', el);
    const second = redactor.maskValue('Call 555-123-4567 today', el);
    expect(first).toBe(second);
  });
});

// ──────────────────────────────────────────────
// Luhn gate (SEC-3)
// ──────────────────────────────────────────────

describe('Redactor._luhnValid', () => {
  let redactor;
  beforeEach(() => { redactor = new Redactor(); });

  it('accepts known-valid card numbers', () => {
    expect(redactor._luhnValid('4111111111111111')).toBe(true); // Visa test
    expect(redactor._luhnValid('378282246310005')).toBe(true);  // Amex test
  });

  it('rejects non-Luhn digit runs and wrong lengths', () => {
    expect(redactor._luhnValid('1234567890123456')).toBe(false);
    expect(redactor._luhnValid('123456789')).toBe(false); // too short
  });
});

// NOTE: redactStep() was removed (SEC-2). The server-side backstop is now
// covered by tests/core/privacy-utils.test.js (maskGenericPII).
