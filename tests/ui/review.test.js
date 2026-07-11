import { describe, it, expect } from 'vitest';
import { deduplicateConsecutiveSteps } from '../../src/core/step-utils.js';

// Helpers to build minimal step objects
function makeStep(overrides = {}) {
  return {
    action: 'click',
    fieldName: 'Button',
    url: 'https://example.com',
    selector: { css: '#btn' },
    value: '',
    ...overrides
  };
}

// ──────────────────────────────────────────────
// deduplicateConsecutiveSteps
// ──────────────────────────────────────────────

describe('deduplicateConsecutiveSteps', () => {
  it('returns null/undefined as-is', () => {
    expect(deduplicateConsecutiveSteps(null)).toBeNull();
    expect(deduplicateConsecutiveSteps(undefined)).toBeUndefined();
  });

  it('returns empty array unchanged', () => {
    expect(deduplicateConsecutiveSteps([])).toEqual([]);
  });

  it('returns single-element array unchanged', () => {
    const step = makeStep();
    expect(deduplicateConsecutiveSteps([step])).toEqual([step]);
  });

  it('removes consecutive duplicate click steps', () => {
    const s = makeStep({ action: 'click', fieldName: 'OK', selector: { css: '#ok' } });
    const result = deduplicateConsecutiveSteps([s, { ...s }, { ...s }]);
    expect(result).toHaveLength(1);
  });

  it('keeps non-consecutive identical steps', () => {
    const a = makeStep({ action: 'click', fieldName: 'A', selector: { css: '#a' } });
    const b = makeStep({ action: 'click', fieldName: 'B', selector: { css: '#b' } });
    const result = deduplicateConsecutiveSteps([a, b, { ...a }]);
    expect(result).toHaveLength(3);
  });

  it('never removes screenshot steps even if consecutive', () => {
    const s = makeStep({ action: 'screenshot', fieldName: '', selector: { css: null } });
    const result = deduplicateConsecutiveSteps([s, { ...s }, { ...s }]);
    expect(result).toHaveLength(3);
  });

  it('never removes navigate steps even if consecutive', () => {
    const s = makeStep({ action: 'navigate', fieldName: '', value: 'https://example.com', selector: { css: null } });
    const result = deduplicateConsecutiveSteps([s, { ...s }, { ...s }]);
    expect(result).toHaveLength(3);
  });

  it('keeps consecutive type steps with different values', () => {
    const s1 = makeStep({ action: 'type', fieldName: 'Email', value: 'a@b.com', selector: { css: '#email' } });
    const s2 = makeStep({ action: 'type', fieldName: 'Email', value: 'c@d.com', selector: { css: '#email' } });
    const result = deduplicateConsecutiveSteps([s1, s2]);
    expect(result).toHaveLength(2);
  });

  it('removes consecutive type steps with same value', () => {
    const s = makeStep({ action: 'type', fieldName: 'Email', value: 'a@b.com', selector: { css: '#email' } });
    const result = deduplicateConsecutiveSteps([s, { ...s }]);
    expect(result).toHaveLength(1);
  });

  it('keeps consecutive select steps with different values', () => {
    const s1 = makeStep({ action: 'select', fieldName: 'Country', value: 'USA', selector: { css: '#country' } });
    const s2 = makeStep({ action: 'select', fieldName: 'Country', value: 'CAN', selector: { css: '#country' } });
    const result = deduplicateConsecutiveSteps([s1, s2]);
    expect(result).toHaveLength(2);
  });

  it('removes consecutive click steps with same selector and url', () => {
    const s = makeStep({ action: 'click', fieldName: 'OK', selector: { css: '#ok' }, url: 'https://example.com' });
    const result = deduplicateConsecutiveSteps([s, { ...s }]);
    expect(result).toHaveLength(1);
  });

  it('keeps steps with same action but different field names', () => {
    const s1 = makeStep({ action: 'click', fieldName: 'Button A', selector: { css: '#a' } });
    const s2 = makeStep({ action: 'click', fieldName: 'Button B', selector: { css: '#b' } });
    const result = deduplicateConsecutiveSteps([s1, s2]);
    expect(result).toHaveLength(2);
  });

  it('keeps steps with same action but different URLs', () => {
    const s1 = makeStep({ action: 'click', fieldName: 'OK', selector: { css: '#ok' }, url: 'https://example.com/a' });
    const s2 = makeStep({ action: 'click', fieldName: 'OK', selector: { css: '#ok' }, url: 'https://example.com/b' });
    const result = deduplicateConsecutiveSteps([s1, s2]);
    expect(result).toHaveLength(2);
  });

  it('handles mixed sequence correctly', () => {
    const click = makeStep({ action: 'click', fieldName: 'Login', selector: { css: '#login' } });
    const nav   = makeStep({ action: 'navigate', value: 'https://example.com/dash' });
    const shot  = makeStep({ action: 'screenshot' });

    const steps = [click, { ...click }, nav, { ...nav }, shot, { ...shot }];
    const result = deduplicateConsecutiveSteps(steps);

    // The duplicate click is removed; nav and shot are kept regardless
    expect(result).toHaveLength(5);
    expect(result.filter(s => s.action === 'navigate')).toHaveLength(2);
    expect(result.filter(s => s.action === 'screenshot')).toHaveLength(2);
  });
});
