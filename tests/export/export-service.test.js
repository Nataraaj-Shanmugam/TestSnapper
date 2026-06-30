import { describe, it, expect, beforeEach } from 'vitest';
import { ExportService } from '../../src/core/export-service.js';
import { Utils } from '../../src/core/utils.js';

// ExportService requires a storage instance in the constructor,
// but the pure methods we test here don't use it.
const fakeStorage = {};

// _escapeHtml was moved to Utils.escapeHtml during architecture refactor
describe('Utils.escapeHtml (formerly ExportService._escapeHtml)', () => {
  it('escapes ampersand', () => {
    expect(Utils.escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes less-than', () => {
    expect(Utils.escapeHtml('<div>')).toContain('&lt;');
  });

  it('escapes greater-than', () => {
    expect(Utils.escapeHtml('<div>')).toContain('&gt;');
  });

  it('returns empty string for null/undefined', () => {
    expect(Utils.escapeHtml(null)).toBe('');
    expect(Utils.escapeHtml(undefined)).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(Utils.escapeHtml('hello')).toBe('hello');
  });
});

describe('ExportService._formatSessionData', () => {
  let service;
  const session = {
    sessionId: 'abc-123',
    sessionName: 'Smoke Test',
    createdAt: 1700000000000,
    env: { url: 'https://example.com', title: 'Example' }
  };

  beforeEach(() => { service = new ExportService(fakeStorage); });

  it('returns an object', () => {
    const result = service._formatSessionData(session, 5);
    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
  });

  it('includes session id', () => {
    const result = service._formatSessionData(session, 5);
    const str = JSON.stringify(result);
    expect(str).toContain('abc-123');
  });

  it('includes session name', () => {
    const result = service._formatSessionData(session, 5);
    const str = JSON.stringify(result);
    expect(str).toContain('Smoke Test');
  });

  it('includes step count', () => {
    const result = service._formatSessionData(session, 7);
    const str = JSON.stringify(result);
    expect(str).toContain('7');
  });
});

describe('ExportService._isCancelled / cancelExport', () => {
  let service;
  beforeEach(() => { service = new ExportService(fakeStorage); });

  it('initially not cancelled for any session', () => {
    expect(service._isCancelled('session-1')).toBe(false);
  });

  it('marks session as cancelled after cancelExport()', () => {
    service.cancelExport('session-1');
    expect(service._isCancelled('session-1')).toBe(true);
  });

  it('clears cancellation after _clearCancellation()', () => {
    service.cancelExport('session-1');
    service._clearCancellation('session-1');
    expect(service._isCancelled('session-1')).toBe(false);
  });

  it('does not affect other sessions', () => {
    service.cancelExport('session-1');
    expect(service._isCancelled('session-2')).toBe(false);
  });
});

describe('ExportService._exportCSV — formula injection (CWE-1236)', () => {
  let service;
  beforeEach(() => { service = new ExportService(fakeStorage); });

  it('neutralizes a cell starting with = (HYPERLINK formula)', () => {
    const exportData = {
      steps: [
        { action: 'input', fieldName: '=HYPERLINK("x")', selector: { css: '#a' }, value: 'v', url: 'https://e.com' }
      ]
    };
    const { content } = service._exportCSV(exportData, 'abc-123');
    // The dangerous formula must be prefixed with an apostrophe inside the quoted cell.
    expect(content).toContain(`"'=HYPERLINK(""x"")"`);
    // And must NOT appear as a bare, executable formula.
    expect(content).not.toContain(`"=HYPERLINK`);
  });

  it('defuses leading +, -, @ characters', () => {
    expect(service._csvSafeCell('+1+1')).toBe("'+1+1");
    expect(service._csvSafeCell('-2-2')).toBe("'-2-2");
    expect(service._csvSafeCell('@cmd')).toBe("'@cmd");
    expect(service._csvSafeCell('\t=evil')).toBe("'\t=evil");
  });

  it('leaves ordinary values untouched', () => {
    expect(service._csvSafeCell('hello')).toBe('hello');
    expect(service._csvSafeCell('https://example.com')).toBe('https://example.com');
  });
});
