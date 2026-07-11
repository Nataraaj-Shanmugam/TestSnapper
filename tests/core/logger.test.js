import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '../../src/core/logger.js';

// Logger uses module-level `currentLevel` state.
// Reset to 'info' (the default) after each test so tests are isolated.
afterEach(() => {
  Logger.setLevel('info');
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// setLevel
// ─────────────────────────────────────────────────────────────────────────────

describe('Logger.setLevel', () => {
  it('accepts "debug" and fires debug messages', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    Logger.setLevel('debug');
    Logger.debug('test debug');
    expect(spy).toHaveBeenCalled();
  });

  it('accepts "warn" and silences info messages', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    Logger.setLevel('warn');
    Logger.info('should be silent');
    expect(spy).not.toHaveBeenCalled();
  });

  it('accepts "error" and silences warn messages', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    Logger.setLevel('error');
    Logger.warn('should be silent');
    expect(spy).not.toHaveBeenCalled();
  });

  it('accepts "none" and silences all messages', () => {
    const logSpy  = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy  = vi.spyOn(console, 'error').mockImplementation(() => {});
    Logger.setLevel('none');
    Logger.debug('x');
    Logger.info('x');
    Logger.warn('x');
    Logger.error('x');
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('falls back to "info" level for unknown level strings', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    Logger.setLevel('unknown-level');
    Logger.info('should fire');
    expect(spy).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Logger.debug
// ─────────────────────────────────────────────────────────────────────────────

describe('Logger.debug', () => {
  it('does NOT fire at default "info" level', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    Logger.debug('silent debug');
    expect(spy).not.toHaveBeenCalled();
  });

  it('fires at "debug" level', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    Logger.setLevel('debug');
    Logger.debug('visible debug');
    expect(spy).toHaveBeenCalledWith('[TestSnapper]', 'visible debug');
  });

  it('passes multiple arguments through', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    Logger.setLevel('debug');
    Logger.debug('msg', { key: 'val' }, 42);
    expect(spy).toHaveBeenCalledWith('[TestSnapper]', 'msg', { key: 'val' }, 42);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Logger.info
// ─────────────────────────────────────────────────────────────────────────────

describe('Logger.info', () => {
  it('fires at default "info" level', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    Logger.info('hello info');
    expect(spy).toHaveBeenCalledWith('[TestSnapper]', 'hello info');
  });

  it('fires at "debug" level (debug ≤ info)', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    Logger.setLevel('debug');
    Logger.info('still fires');
    expect(spy).toHaveBeenCalled();
  });

  it('does NOT fire at "warn" level', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    Logger.setLevel('warn');
    Logger.info('silent info');
    expect(spy).not.toHaveBeenCalled();
  });

  it('does NOT fire at "error" level', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    Logger.setLevel('error');
    Logger.info('silent info');
    expect(spy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Logger.warn
// ─────────────────────────────────────────────────────────────────────────────

describe('Logger.warn', () => {
  it('fires at default "info" level (info ≤ warn)', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    Logger.warn('warning message');
    expect(spy).toHaveBeenCalledWith('[TestSnapper]', 'warning message');
  });

  it('fires at "warn" level', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    Logger.setLevel('warn');
    Logger.warn('explicit warn');
    expect(spy).toHaveBeenCalled();
  });

  it('does NOT fire at "error" level', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    Logger.setLevel('error');
    Logger.warn('silent warn');
    expect(spy).not.toHaveBeenCalled();
  });

  it('does NOT fire at "none" level', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    Logger.setLevel('none');
    Logger.warn('silent warn');
    expect(spy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Logger.error
// ─────────────────────────────────────────────────────────────────────────────

describe('Logger.error', () => {
  it('fires at default "info" level', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    Logger.error('error message');
    expect(spy).toHaveBeenCalledWith('[TestSnapper]', 'error message');
  });

  it('fires at "warn" level', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    Logger.setLevel('warn');
    Logger.error('error at warn level');
    expect(spy).toHaveBeenCalled();
  });

  it('fires at "error" level', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    Logger.setLevel('error');
    Logger.error('explicit error');
    expect(spy).toHaveBeenCalled();
  });

  it('does NOT fire at "none" level', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    Logger.setLevel('none');
    Logger.error('silent error');
    expect(spy).not.toHaveBeenCalled();
  });

  it('passes Error objects through as extra arguments', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = new Error('boom');
    Logger.error('caught:', err);
    expect(spy).toHaveBeenCalledWith('[TestSnapper]', 'caught:', err);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Level ordering sanity
// ─────────────────────────────────────────────────────────────────────────────

describe('Logger level ordering', () => {
  it('at "debug": debug, info, warn, error all fire', () => {
    const logSpy  = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy  = vi.spyOn(console, 'error').mockImplementation(() => {});
    Logger.setLevel('debug');
    Logger.debug('d'); Logger.info('i'); Logger.warn('w'); Logger.error('e');
    expect(logSpy).toHaveBeenCalledTimes(2);  // debug + info both use console.log
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledTimes(1);
  });

  it('at "warn": only warn and error fire', () => {
    const logSpy  = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy  = vi.spyOn(console, 'error').mockImplementation(() => {});
    Logger.setLevel('warn');
    Logger.debug('d'); Logger.info('i'); Logger.warn('w'); Logger.error('e');
    expect(logSpy).toHaveBeenCalledTimes(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledTimes(1);
  });
});
