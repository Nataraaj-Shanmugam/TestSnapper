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

describe('ExportService — unified output omits the locator (matches Word)', () => {
  let service;
  beforeEach(() => { service = new ExportService(fakeStorage); });

  const exportData = {
    session: { name: 'S', createdAt: new Date().toISOString(), stepCount: 1 },
    steps: [
      { action: 'click', fieldName: 'Login', selector: { css: '#login-btn', xpath: '//button' }, value: '', url: 'https://e.com' }
    ]
  };

  it('CSV has no Selector column and no selector value', () => {
    const { content } = service._exportCSV(exportData, 'abc-123');
    expect(content).not.toContain('Selector');
    expect(content).not.toContain('#login-btn');
    expect(content).toContain('Field Name');
  });

  it('JSON drops the selector from every step', () => {
    const { content } = service._exportJSON(exportData, 'abc-123');
    const parsed = JSON.parse(content);
    expect(parsed.steps[0].selector).toBeUndefined();
    expect(content).not.toContain('#login-btn');
    expect(parsed.steps[0].fieldName).toBe('Login');
  });

  it('Markdown has no Selector line', () => {
    const { content } = service._exportMarkdown(exportData, 'abc-123');
    expect(content).not.toContain('Selector');
    expect(content).not.toContain('#login-btn');
  });
});

describe('ExportService — Author / Start Time / End Time in every export', () => {
  let service;
  beforeEach(() => { service = new ExportService(fakeStorage); });

  const rawSession = { sessionId: 's1', sessionName: 'Login Flow', createdAt: '2026-06-01T10:00:00.000Z' };
  const withMeta = { ...rawSession, author: 'Jane Doe', startTime: '2026-06-01T10:00:00.000Z', endTime: '2026-06-01T10:05:00.000Z' };

  it('_formatSessionData surfaces author/startTime/endTime with sane fallbacks', () => {
    const noMeta = service._formatSessionData(rawSession, 3);
    expect(noMeta.author).toBe('');
    expect(noMeta.startTime).toBe(rawSession.createdAt); // falls back to createdAt
    expect(noMeta.endTime).toBe('');

    const withMetaFormatted = service._formatSessionData(withMeta, 3);
    expect(withMetaFormatted.author).toBe('Jane Doe');
    expect(withMetaFormatted.startTime).toBe(withMeta.startTime);
    expect(withMetaFormatted.endTime).toBe(withMeta.endTime);
  });

  it('CSV includes an Author/Start Time/End Time preamble and unifies the filename to the session name', () => {
    const exportData = { session: service._formatSessionData(withMeta, 0), steps: [] };
    const { content, filename } = service._exportCSV(exportData, 's1');
    expect(content).toContain('Author');
    expect(content).toContain('Jane Doe');
    expect(content).toContain('Start Time');
    expect(content).toContain('End Time');
    expect(filename).toMatch(/^Login_Flow_\d+\.csv$/); // was testsnapper_<id>_<ts>.csv — now unified
  });

  it('CSV shows N/A when author/end time are absent (not "undefined")', () => {
    const exportData = { session: service._formatSessionData(rawSession, 0), steps: [] };
    const { content } = service._exportCSV(exportData, 's1');
    expect(content).not.toContain('undefined');
    expect(content).toMatch(/"N\/A"/);
  });

  it('JSON includes author/startTime/endTime on the session object', () => {
    const exportData = { session: service._formatSessionData(withMeta, 0), steps: [] };
    const { content } = service._exportJSON(exportData, 's1');
    const parsed = JSON.parse(content);
    expect(parsed.session.author).toBe('Jane Doe');
    expect(parsed.session.startTime).toBe(withMeta.startTime);
    expect(parsed.session.endTime).toBe(withMeta.endTime);
  });

  it('Markdown includes Author/Start Time/End Time lines', () => {
    const exportData = { session: service._formatSessionData(withMeta, 0), steps: [] };
    const { content } = service._exportMarkdown(exportData, 's1');
    expect(content).toContain('**Author:** Jane Doe');
    expect(content).toContain('**Start Time:**');
    expect(content).toContain('**End Time:**');
  });
});
