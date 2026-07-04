import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';

// CSS.escape is a browser API not implemented in jsdom — polyfill it
if (!globalThis.CSS) {
  globalThis.CSS = {
    escape(value) {
      return value.replace(/[^\w-]/g, s => `\\${s}`);
    }
  };
}

// selector.js is a content script (no ES module export).
// It ships with a module.exports fallback for exactly this purpose.
const require = createRequire(import.meta.url);
const { SelectorEngine } = require('../../src/content/selector.js');

// ──────────────────────────────────────────────
// _isGeneratedId — pure logic, no DOM needed
// ──────────────────────────────────────────────

describe('SelectorEngine._isGeneratedId', () => {
  let engine;
  beforeEach(() => { engine = new SelectorEngine(); });

  it('returns false for short IDs (< 4 chars)', () => {
    expect(engine._isGeneratedId('nav')).toBe(false);
    expect(engine._isGeneratedId('app')).toBe(false);
    expect(engine._isGeneratedId('foo')).toBe(false);
  });

  it('returns false for meaningful human-authored IDs', () => {
    expect(engine._isGeneratedId('username')).toBe(false);
    expect(engine._isGeneratedId('login-form')).toBe(false);
    expect(engine._isGeneratedId('email-input')).toBe(false);
    expect(engine._isGeneratedId('submit-btn')).toBe(false);
  });

  it('returns false for IDs starting with common semantic prefixes', () => {
    expect(engine._isGeneratedId('header-title')).toBe(false);
    expect(engine._isGeneratedId('nav-menu')).toBe(false);
    expect(engine._isGeneratedId('modal-close')).toBe(false);
    expect(engine._isGeneratedId('btn-submit')).toBe(false);
  });

  it('detects long hex strings as generated', () => {
    expect(engine._isGeneratedId('a1b2c3d4e5f6')).toBe(true);   // 12 hex chars
    expect(engine._isGeneratedId('aabbccddeeff00')).toBe(true);  // 14 hex chars
  });

  it('detects Ember.js IDs as generated', () => {
    expect(engine._isGeneratedId('ember123')).toBe(true);
    expect(engine._isGeneratedId('ember9999')).toBe(true);
  });

  it('detects React IDs with 6+ random chars as generated', () => {
    expect(engine._isGeneratedId('react-abcdef')).toBe(true);
    expect(engine._isGeneratedId('react-xyzpqr')).toBe(true);
  });

  it('detects React 18 useId format', () => {
    // Pattern: /^:r[a-z0-9]+:$/ — lowercase only
    expect(engine._isGeneratedId(':r1:')).toBe(true);
    expect(engine._isGeneratedId(':rabc:')).toBe(true);
  });

  it('detects Material-UI IDs as generated', () => {
    expect(engine._isGeneratedId('mui-123')).toBe(true);
    expect(engine._isGeneratedId('mui-9999')).toBe(true);
  });

  it('detects pure numeric IDs of 4+ digits as generated', () => {
    expect(engine._isGeneratedId('12345')).toBe(true);
    expect(engine._isGeneratedId('1000')).toBe(true);
  });

  it('detects CSS module underscore+hex IDs as generated', () => {
    expect(engine._isGeneratedId('_a1b2c3d4')).toBe(true);  // underscore + 8 hex chars
  });
});

// ──────────────────────────────────────────────
// isStepDuplicate — pure logic, no DOM needed
// ──────────────────────────────────────────────

describe('SelectorEngine.isStepDuplicate', () => {
  let engine;
  const now = 1700000000000;

  beforeEach(() => { engine = new SelectorEngine(); });

  it('returns false when existingSteps is empty', () => {
    const step = { action: 'click', selector: { css: '#btn' }, value: '', fieldName: 'OK', timestamp: now };
    expect(engine.isStepDuplicate(step, [])).toBe(false);
  });

  it('returns false when existingSteps is null', () => {
    const step = { action: 'click', selector: { css: '#btn' }, value: '', fieldName: 'OK', timestamp: now };
    expect(engine.isStepDuplicate(step, null)).toBe(false);
  });

  it('detects an exact duplicate within the time window', () => {
    const existing = [{ action: 'click', selector: { css: '#btn' }, value: '', fieldName: 'OK', timestamp: now - 500 }];
    const newStep  = { action: 'click', selector: { css: '#btn' }, value: '', fieldName: 'OK', timestamp: now };
    expect(engine.isStepDuplicate(newStep, existing, 3000)).toBe(true);
  });

  it('does not flag a step outside the time window as duplicate', () => {
    const existing = [{ action: 'click', selector: { css: '#btn' }, value: '', fieldName: 'OK', timestamp: now - 5000 }];
    const newStep  = { action: 'click', selector: { css: '#btn' }, value: '', fieldName: 'OK', timestamp: now };
    expect(engine.isStepDuplicate(newStep, existing, 3000)).toBe(false);
  });

  it('does not flag steps with different actions as duplicates', () => {
    const existing = [{ action: 'type', selector: { css: '#input' }, value: 'hello', fieldName: 'Name', timestamp: now - 100 }];
    const newStep  = { action: 'click', selector: { css: '#input' }, value: 'hello', fieldName: 'Name', timestamp: now };
    expect(engine.isStepDuplicate(newStep, existing, 3000)).toBe(false);
  });

  it('does not flag steps with different selectors as duplicates', () => {
    const existing = [{ action: 'click', selector: { css: '#btn1' }, value: '', fieldName: 'OK', timestamp: now - 100 }];
    const newStep  = { action: 'click', selector: { css: '#btn2' }, value: '', fieldName: 'OK', timestamp: now };
    expect(engine.isStepDuplicate(newStep, existing, 3000)).toBe(false);
  });

  it('does not flag steps with different values as duplicates', () => {
    const existing = [{ action: 'type', selector: { css: '#name' }, value: 'Alice', fieldName: 'Name', timestamp: now - 100 }];
    const newStep  = { action: 'type', selector: { css: '#name' }, value: 'Bob',   fieldName: 'Name', timestamp: now };
    expect(engine.isStepDuplicate(newStep, existing, 3000)).toBe(false);
  });

  it('uses default time window of 3000 ms', () => {
    const existing = [{ action: 'click', selector: { css: '#x' }, value: '', fieldName: 'X', timestamp: now - 2999 }];
    const newStep  = { action: 'click', selector: { css: '#x' }, value: '', fieldName: 'X', timestamp: now };
    expect(engine.isStepDuplicate(newStep, existing)).toBe(true);
  });
});

// ──────────────────────────────────────────────
// DOM-based tests (jsdom provides real DOM)
// ──────────────────────────────────────────────

describe('SelectorEngine.getElementText', () => {
  let engine;
  beforeEach(() => { engine = new SelectorEngine(); });

  it('returns empty string for null', () => {
    expect(engine.getElementText(null)).toBe('');
  });

  it('never returns the typed value for data-entry inputs (P0-4 privacy)', () => {
    // getElementText feeds step.targetLabel and step.selector.text UNREDACTED —
    // returning element.value here leaked passwords/PII past the redactor.
    const input = document.createElement('input');
    input.value = 'hello@example.com';
    expect(engine.getElementText(input)).toBe('');

    const password = document.createElement('input');
    password.type = 'password';
    password.value = 'hunter2';
    password.placeholder = 'Password';
    expect(engine.getElementText(password)).toBe('Password');

    const textarea = document.createElement('textarea');
    textarea.value = 'my SSN is 123-45-6789';
    textarea.placeholder = 'Notes';
    expect(engine.getElementText(textarea)).toBe('Notes');
  });

  it('returns the value for button-like inputs (author label, not user data)', () => {
    const submit = document.createElement('input');
    submit.type = 'submit';
    submit.value = 'Send Message';
    expect(engine.getElementText(submit)).toBe('Send Message');
  });

  it('returns placeholder when input has no value', () => {
    const input = document.createElement('input');
    input.placeholder = 'Enter email';
    expect(engine.getElementText(input)).toBe('Enter email');
  });

  it('returns trimmed text content for buttons', () => {
    const btn = document.createElement('button');
    btn.textContent = '  Submit  ';
    expect(engine.getElementText(btn)).toBe('Submit');
  });

  it('returns trimmed text for generic elements', () => {
    const div = document.createElement('div');
    div.textContent = 'Hello World';
    expect(engine.getElementText(div)).toBe('Hello World');
  });

  it('truncates long text at 50 chars', () => {
    const div = document.createElement('div');
    div.textContent = 'a'.repeat(60);
    const result = engine.getElementText(div);
    expect(result).toBe('a'.repeat(50) + '...');
  });
});

describe('SelectorEngine.isInteractable', () => {
  let engine;
  beforeEach(() => { engine = new SelectorEngine(); });

  it('returns false for null', () => {
    expect(engine.isInteractable(null)).toBe(false);
  });

  it('returns true for input elements', () => {
    expect(engine.isInteractable(document.createElement('input'))).toBe(true);
  });

  it('returns true for button elements', () => {
    expect(engine.isInteractable(document.createElement('button'))).toBe(true);
  });

  it('returns true for select elements', () => {
    expect(engine.isInteractable(document.createElement('select'))).toBe(true);
  });

  it('returns true for textarea elements', () => {
    expect(engine.isInteractable(document.createElement('textarea'))).toBe(true);
  });

  it('returns true for anchor elements', () => {
    const a = document.createElement('a');
    a.href = '#';
    expect(engine.isInteractable(a)).toBe(true);
  });

  it('returns false for plain div', () => {
    expect(engine.isInteractable(document.createElement('div'))).toBe(false);
  });

  it('returns false for span', () => {
    expect(engine.isInteractable(document.createElement('span'))).toBe(false);
  });

  it('returns true for element with ARIA role=button', () => {
    const div = document.createElement('div');
    div.setAttribute('role', 'button');
    expect(engine.isInteractable(div)).toBe(true);
  });

  it('returns true for element with onclick attribute', () => {
    const div = document.createElement('div');
    div.setAttribute('onclick', 'doSomething()');
    expect(engine.isInteractable(div)).toBe(true);
  });
});

describe('SelectorEngine.generateSelectors', () => {
  let engine;
  beforeEach(() => {
    engine = new SelectorEngine();
    document.body.innerHTML = '';
  });

  it('returns null for null input', () => {
    expect(engine.generateSelectors(null)).toBeNull();
  });

  it('finds ID-based selector for element with id', () => {
    const input = document.createElement('input');
    input.id = 'email-field';
    document.body.appendChild(input);

    const result = engine.generateSelectors(input);
    expect(result).not.toBeNull();
    // result.primary is a candidate object; the selector string is in .selector
    expect(result.primary.selector).toContain('#email-field');
  });

  it('finds data-testid selector', () => {
    const btn = document.createElement('button');
    btn.setAttribute('data-testid', 'submit-btn');
    document.body.appendChild(btn);

    const result = engine.generateSelectors(btn);
    expect(result).not.toBeNull();
    const allSelectors = result.all.map(s => s.selector).join(' ');
    expect(allSelectors).toContain('submit-btn');
  });

  it('finds name-based selector for input with name', () => {
    const input = document.createElement('input');
    input.name = 'username';
    document.body.appendChild(input);

    const result = engine.generateSelectors(input);
    expect(result).not.toBeNull();
    const allSelectors = result.all.map(s => s.selector).join(' ');
    expect(allSelectors).toContain('username');
  });

  it('returns primary, alternatives, and all properties', () => {
    const btn = document.createElement('button');
    btn.id = 'my-btn';
    document.body.appendChild(btn);

    const result = engine.generateSelectors(btn);
    expect(result).toHaveProperty('primary');
    expect(result).toHaveProperty('alternatives');
    expect(result).toHaveProperty('all');
  });
});

describe('SelectorEngine.getCacheStats', () => {
  it('starts with zero hits and misses', () => {
    const engine = new SelectorEngine();
    const stats = engine.getCacheStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.total).toBe(0);
    expect(stats.hitRate).toBe('0%');
  });
});
