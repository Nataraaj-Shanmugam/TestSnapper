import { describe, it, expect, beforeEach } from 'vitest';
import { ExportService } from '../../src/core/export-service.js';

// ExportService requires a storage instance in the constructor,
// but the pure methods we test here don't use it.
const fakeStorage = {};

describe('ExportService._escapeHtml', () => {
  let service;
  beforeEach(() => { service = new ExportService(fakeStorage); });

  it('escapes ampersand', () => {
    expect(service._escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes less-than', () => {
    expect(service._escapeHtml('<div>')).toContain('&lt;');
  });

  it('escapes greater-than', () => {
    expect(service._escapeHtml('<div>')).toContain('&gt;');
  });

  it('returns empty string for null/undefined', () => {
    expect(service._escapeHtml(null)).toBe('');
    expect(service._escapeHtml(undefined)).toBe('');
  });

  it('returns plain text unchanged', () => {
    expect(service._escapeHtml('hello')).toBe('hello');
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
