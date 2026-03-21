import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Utils } from '../../src/core/utils.js';

describe('Utils.generateUUID', () => {
  it('returns a string matching RFC4122 v4 UUID format', () => {
    const uuid = Utils.generateUUID();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('generates unique values across 100 calls', () => {
    const uuids = new Set(Array.from({ length: 100 }, () => Utils.generateUUID()));
    expect(uuids.size).toBe(100);
  });
});

describe('Utils.escapeHtml', () => {
  it('escapes ampersand', () => {
    expect(Utils.escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes less-than and greater-than', () => {
    expect(Utils.escapeHtml('<div>')).toBe('&lt;div&gt;');
  });

  it('escapes double quotes', () => {
    expect(Utils.escapeHtml('"hello"')).toBe('&quot;hello&quot;');
  });

  it("escapes single quotes", () => {
    expect(Utils.escapeHtml("it's")).toBe("it&#039;s");
  });

  it('escapes all special chars in one string', () => {
    expect(Utils.escapeHtml('<a href="x">it\'s & fun</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;it&#039;s &amp; fun&lt;/a&gt;'
    );
  });

  it('returns empty string for null', () => {
    expect(Utils.escapeHtml(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(Utils.escapeHtml(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(Utils.escapeHtml('')).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(Utils.escapeHtml('hello world')).toBe('hello world');
  });
});

describe('Utils.truncate', () => {
  it('returns text unchanged when shorter than maxLength', () => {
    expect(Utils.truncate('hello', 10)).toBe('hello');
  });

  it('returns text unchanged when equal to maxLength', () => {
    expect(Utils.truncate('hello', 5)).toBe('hello');
  });

  it('truncates and appends ellipsis when over maxLength', () => {
    expect(Utils.truncate('hello world', 5)).toBe('hello...');
  });

  it('uses default maxLength of 50', () => {
    const long = 'a'.repeat(60);
    const result = Utils.truncate(long);
    expect(result).toBe('a'.repeat(50) + '...');
  });

  it('returns falsy value as-is', () => {
    expect(Utils.truncate(null, 10)).toBeNull();
    expect(Utils.truncate('', 10)).toBe('');
  });
});

describe('Utils.formatTimestamp', () => {
  it('returns a non-empty string', () => {
    const result = Utils.formatTimestamp(1700000000000);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('formats a known timestamp to a date string', () => {
    // Use a fixed timestamp and check it contains year 2023
    const result = Utils.formatTimestamp(1700000000000);
    expect(result).toMatch(/2023/);
  });
});

describe('Utils.debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not call function before wait expires', () => {
    const fn = vi.fn();
    const debounced = Utils.debounce(fn, 100);
    debounced();
    expect(fn).not.toHaveBeenCalled();
  });

  it('calls function after wait expires', () => {
    const fn = vi.fn();
    const debounced = Utils.debounce(fn, 100);
    debounced();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('only fires once for rapid calls', () => {
    const fn = vi.fn();
    const debounced = Utils.debounce(fn, 200);
    debounced('a');
    debounced('b');
    debounced('c');
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledOnce();
    expect(fn).toHaveBeenCalledWith('c');
  });
});

describe('Utils.generateStepDescription', () => {
  it('describes a type step with value and field', () => {
    const result = Utils.generateStepDescription({ action: 'type', fieldName: 'Email', value: 'test@example.com' });
    expect(result).toBe('Entered "test@example.com" in Email field');
  });

  it('describes a type step with value only', () => {
    const result = Utils.generateStepDescription({ action: 'type', fieldName: '', value: 'hello' });
    expect(result).toBe('Entered "hello"');
  });

  it('describes a type step with field only', () => {
    const result = Utils.generateStepDescription({ action: 'type', fieldName: 'Name', value: '' });
    expect(result).toBe('Typed in Name field');
  });

  it('describes a type step with no field or value', () => {
    const result = Utils.generateStepDescription({ action: 'type', fieldName: '', value: '' });
    expect(result).toBe('Typed in field');
  });

  it('describes a click step with field name', () => {
    const result = Utils.generateStepDescription({ action: 'click', fieldName: 'Login Button', value: '' });
    expect(result).toBe('Clicked on Login Button');
  });

  it('describes a click step without field name', () => {
    const result = Utils.generateStepDescription({ action: 'click', fieldName: '', value: '' });
    expect(result).toBe('Clicked on element');
  });

  it('describes a select step with value and field', () => {
    const result = Utils.generateStepDescription({ action: 'select', fieldName: 'Country', value: 'USA' });
    expect(result).toBe('Selected "USA" from Country dropdown');
  });

  it('describes a check step', () => {
    const result = Utils.generateStepDescription({ action: 'check', fieldName: 'Remember Me', value: '' });
    expect(result).toBe('Checked the Remember Me checkbox');
  });

  it('describes an uncheck step', () => {
    const result = Utils.generateStepDescription({ action: 'uncheck', fieldName: 'Newsletter', value: '' });
    expect(result).toBe('Unchecked the Newsletter checkbox');
  });

  it('describes a submit step', () => {
    const result = Utils.generateStepDescription({ action: 'submit', fieldName: 'Login', value: '' });
    expect(result).toBe('Submitted the Login form');
  });

  it('describes a navigate step with URL', () => {
    const result = Utils.generateStepDescription({ action: 'navigate', fieldName: '', value: 'https://example.com' });
    expect(result).toBe('Navigated to https://example.com');
  });

  it('describes a navigate step without URL', () => {
    const result = Utils.generateStepDescription({ action: 'navigate', fieldName: '', value: '' });
    expect(result).toBe('Navigated to page');
  });

  it('describes a manual screenshot', () => {
    const result = Utils.generateStepDescription({ action: 'screenshot', isManual: true });
    expect(result).toBe('Manual screenshot taken');
  });

  it('describes an auto screenshot', () => {
    const result = Utils.generateStepDescription({ action: 'screenshot', isManual: false });
    expect(result).toBe('Auto screenshot captured');
  });
});

describe('Utils.dataURLtoBlob', () => {
  it('converts a valid PNG data URL to a Blob', () => {
    const dataURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI6QAAAABJRU5ErkJggg==';
    const blob = Utils.dataURLtoBlob(dataURL);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('throws on invalid data URL', () => {
    expect(() => Utils.dataURLtoBlob('not-a-data-url')).toThrow();
  });
});
