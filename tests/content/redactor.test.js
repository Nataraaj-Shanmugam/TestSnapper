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
    const result = redactor.maskValue('4532 1234 5678 9010', el);
    expect(result).not.toContain('4532');
    expect(result).toContain('**** **** **** ****');
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
// redactStep
// ──────────────────────────────────────────────

describe('Redactor.redactStep', () => {
  let redactor;
  beforeEach(() => { redactor = new Redactor(); });

  it('returns null/undefined as-is', () => {
    expect(redactor.redactStep(null)).toBeNull();
    expect(redactor.redactStep(undefined)).toBeUndefined();
  });

  it('replaces value with bullet dots when isSensitive is true', () => {
    const step = { action: 'type', fieldName: 'Password', value: 'hunter2', isSensitive: true };
    const result = redactor.redactStep(step);
    expect(result.value).toBe('••••••••');
  });

  it('preserves value when isSensitive is false', () => {
    const step = { action: 'type', fieldName: 'Name', value: 'Alice', isSensitive: false };
    const result = redactor.redactStep(step);
    expect(result.value).toBe('Alice');
  });

  it('does not mutate the original step', () => {
    const step = { action: 'type', fieldName: 'Password', value: 'hunter2', isSensitive: true };
    redactor.redactStep(step);
    expect(step.value).toBe('hunter2');
  });

  it('preserves non-sensitive fields unchanged', () => {
    const step = { action: 'click', fieldName: 'Submit', value: '', isSensitive: false, url: 'https://example.com' };
    const result = redactor.redactStep(step);
    expect(result.action).toBe('click');
    expect(result.fieldName).toBe('Submit');
    expect(result.url).toBe('https://example.com');
  });
});
