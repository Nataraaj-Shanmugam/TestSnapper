import { describe, it, expect } from 'vitest';
import { _isConsecutiveDuplicate, shouldRecordRequest, validateSettings, shouldCaptureNavigationScreenshot } from '../../src/core/recorder-utils.js';

// ─────────────────────────────────────────────────────────────────────────────
// shouldCaptureNavigationScreenshot — "Auto-Capture Screenshots" is the master
// switch; navigation screenshots require it ON (bug: nav shots fired while the
// periodic auto-capture was disabled, mislabeled "Auto Screenshot").
// ─────────────────────────────────────────────────────────────────────────────

describe('shouldCaptureNavigationScreenshot', () => {
  it('does NOT capture when auto-capture is off (even if captureOnNavigation is on)', () => {
    expect(shouldCaptureNavigationScreenshot({ autoScreenshot: false, captureOnNavigation: true }, false)).toBe(false);
  });

  it('captures when auto-capture is on and captureOnNavigation is on (default)', () => {
    expect(shouldCaptureNavigationScreenshot({ autoScreenshot: true, captureOnNavigation: true }, false)).toBe(true);
    expect(shouldCaptureNavigationScreenshot({ autoScreenshot: true }, false)).toBe(true); // nav opt-in defaults on
  });

  it('does NOT capture when captureOnNavigation is explicitly off', () => {
    expect(shouldCaptureNavigationScreenshot({ autoScreenshot: true, captureOnNavigation: false }, false)).toBe(false);
  });

  it('suppresses capture when a sensitive field is focused', () => {
    expect(shouldCaptureNavigationScreenshot({ autoScreenshot: true, captureOnNavigation: true }, true)).toBe(false);
  });

  it('treats missing settings as no capture (master defaults off)', () => {
    expect(shouldCaptureNavigationScreenshot(undefined, false)).toBe(false);
    expect(shouldCaptureNavigationScreenshot({}, false)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// _isConsecutiveDuplicate
// ─────────────────────────────────────────────────────────────────────────────

describe('_isConsecutiveDuplicate', () => {
  it('returns true when selector and field are identical', () => {
    const stepData = {
      action: 'type',
      fieldName: 'username',
      url: '/login',
      selector: { css: 'input.user' },
      value: 'alice',
      targetLabel: 'Username'
    };
    const lastStep = {
      action: 'type',
      fieldName: 'username',
      url: '/login',
      selector: { css: 'input.user' },
      value: 'alice',
      targetLabel: 'Username'
    };
    expect(_isConsecutiveDuplicate(stepData, lastStep)).toBe(true);
  });

  it('returns false when selector is same but field differs', () => {
    const stepData = {
      action: 'type',
      fieldName: 'username',
      url: '/login',
      selector: { css: 'input.user' },
      value: 'alice',
      targetLabel: 'Username'
    };
    const lastStep = {
      action: 'type',
      fieldName: 'password',
      url: '/login',
      selector: { css: 'input.user' },
      value: 'secret',
      targetLabel: 'Password'
    };
    expect(_isConsecutiveDuplicate(stepData, lastStep)).toBe(false);
  });

  it('returns false when field is same but selector differs', () => {
    const stepData = {
      action: 'type',
      fieldName: 'username',
      url: '/login',
      selector: { css: 'input.username' },
      value: 'alice',
      targetLabel: 'Username'
    };
    const lastStep = {
      action: 'type',
      fieldName: 'username',
      url: '/login',
      selector: { css: 'input.user' },
      value: 'alice',
      targetLabel: 'Username'
    };
    expect(_isConsecutiveDuplicate(stepData, lastStep)).toBe(false);
  });

  it('returns false when lastStep is undefined', () => {
    const stepData = {
      action: 'type',
      fieldName: 'username',
      url: '/login',
      selector: { css: 'input.user' },
      value: 'alice',
      targetLabel: 'Username'
    };
    expect(_isConsecutiveDuplicate(stepData, undefined)).toBe(false);
  });

  it('returns false when lastStep is null', () => {
    const stepData = {
      action: 'type',
      fieldName: 'username',
      url: '/login',
      selector: { css: 'input.user' },
      value: 'alice',
      targetLabel: 'Username'
    };
    expect(_isConsecutiveDuplicate(stepData, null)).toBe(false);
  });

  it('returns false when actions differ', () => {
    const stepData = {
      action: 'click',
      fieldName: 'submit',
      url: '/login',
      selector: { css: 'button.submit' },
      value: '',
      targetLabel: 'Submit'
    };
    const lastStep = {
      action: 'type',
      fieldName: 'submit',
      url: '/login',
      selector: { css: 'button.submit' },
      value: 'alice',
      targetLabel: 'Submit'
    };
    expect(_isConsecutiveDuplicate(stepData, lastStep)).toBe(false);
  });

  it('returns false when URLs differ', () => {
    const stepData = {
      action: 'type',
      fieldName: 'username',
      url: '/dashboard',
      selector: { css: 'input.user' },
      value: 'alice',
      targetLabel: 'Username'
    };
    const lastStep = {
      action: 'type',
      fieldName: 'username',
      url: '/login',
      selector: { css: 'input.user' },
      value: 'alice',
      targetLabel: 'Username'
    };
    expect(_isConsecutiveDuplicate(stepData, lastStep)).toBe(false);
  });

  it('returns false when type action but values differ', () => {
    const stepData = {
      action: 'type',
      fieldName: 'username',
      url: '/login',
      selector: { css: 'input.user' },
      value: 'bob',
      targetLabel: 'Username'
    };
    const lastStep = {
      action: 'type',
      fieldName: 'username',
      url: '/login',
      selector: { css: 'input.user' },
      value: 'alice',
      targetLabel: 'Username'
    };
    expect(_isConsecutiveDuplicate(stepData, lastStep)).toBe(false);
  });

  it('returns false when select action but values differ', () => {
    const stepData = {
      action: 'select',
      fieldName: 'country',
      url: '/checkout',
      selector: { css: 'select.country' },
      value: 'Canada',
      targetLabel: 'Country'
    };
    const lastStep = {
      action: 'select',
      fieldName: 'country',
      url: '/checkout',
      selector: { css: 'select.country' },
      value: 'USA',
      targetLabel: 'Country'
    };
    expect(_isConsecutiveDuplicate(stepData, lastStep)).toBe(false);
  });

  it('returns true for click actions with identical selector even without value', () => {
    const stepData = {
      action: 'click',
      fieldName: 'submit',
      url: '/login',
      selector: { css: 'button.submit' },
      value: '',
      targetLabel: 'Submit'
    };
    const lastStep = {
      action: 'click',
      fieldName: 'submit',
      url: '/login',
      selector: { css: 'button.submit' },
      value: '',
      targetLabel: 'Submit'
    };
    expect(_isConsecutiveDuplicate(stepData, lastStep)).toBe(true);
  });

  it('handles missing selector CSS gracefully', () => {
    const stepData = {
      action: 'type',
      fieldName: 'username',
      url: '/login',
      selector: {},
      value: 'alice',
      targetLabel: 'Username'
    };
    const lastStep = {
      action: 'type',
      fieldName: 'username',
      url: '/login',
      selector: {},
      value: 'alice',
      targetLabel: 'Username'
    };
    expect(_isConsecutiveDuplicate(stepData, lastStep)).toBe(true);
  });

  it('returns true when one selector is missing CSS but matching on other fields', () => {
    const stepData = {
      action: 'type',
      fieldName: 'username',
      url: '/login',
      selector: { css: 'input.user' },
      value: 'alice',
      targetLabel: 'Username'
    };
    const lastStep = {
      action: 'type',
      fieldName: 'username',
      url: '/login',
      selector: {},
      value: 'alice',
      targetLabel: 'Username'
    };
    // One has CSS, one doesn't — they don't match on selector
    // but still match on action+field+url, so returns true (same action+field+url)
    expect(_isConsecutiveDuplicate(stepData, lastStep)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// shouldRecordRequest
// ─────────────────────────────────────────────────────────────────────────────

describe('shouldRecordRequest', () => {
  it('returns true when captureApiCalls is enabled and captureAllCalls is true', () => {
    const details = { url: 'https://api.example.com/data', method: 'GET' };
    const filter = { captureApiCalls: true, captureAllCalls: true };
    expect(shouldRecordRequest(details, filter, true)).toBe(true);
  });

  it('returns true for failed requests when captureFailedCalls is true and captureAllCalls is false', () => {
    const details = { url: 'https://api.example.com/data', method: 'GET' };
    const filter = {
      captureApiCalls: true,
      captureAllCalls: false,
      captureFailedCalls: true
    };
    expect(shouldRecordRequest(details, filter, false)).toBe(true);
  });

  it('returns false for successful requests when only captureFailedCalls is enabled', () => {
    const details = { url: 'https://api.example.com/data', method: 'GET' };
    const filter = {
      captureApiCalls: true,
      captureAllCalls: false,
      captureFailedCalls: true
    };
    expect(shouldRecordRequest(details, filter, true)).toBe(false);
  });

  it('returns false when captureApiCalls is false (master switch)', () => {
    const details = { url: 'https://api.example.com/data', method: 'GET' };
    const filter = {
      captureApiCalls: false,
      captureAllCalls: true,
      captureFailedCalls: true
    };
    expect(shouldRecordRequest(details, filter, true)).toBe(false);
  });

  it('returns false when filter is null', () => {
    const details = { url: 'https://api.example.com/data', method: 'GET' };
    expect(shouldRecordRequest(details, null, true)).toBe(false);
  });

  it('returns false when filter is undefined', () => {
    const details = { url: 'https://api.example.com/data', method: 'GET' };
    expect(shouldRecordRequest(details, undefined, true)).toBe(false);
  });

  it('returns true when captureApiCalls is true and captureAllCalls is not set', () => {
    const details = { url: 'https://api.example.com/data', method: 'GET' };
    const filter = { captureApiCalls: true };
    expect(shouldRecordRequest(details, filter, true)).toBe(true);
  });

  it('returns true when captureAllCalls and captureFailedCalls are both false (defaults to all)', () => {
    const details = { url: 'https://api.example.com/data', method: 'GET' };
    const filter = {
      captureApiCalls: true,
      captureAllCalls: false,
      captureFailedCalls: false
    };
    // When both flags are false, defaults to recording all requests
    expect(shouldRecordRequest(details, filter, true)).toBe(true);
  });

  it('handles different HTTP methods in request details', () => {
    const detailsPost = { url: 'https://api.example.com/data', method: 'POST' };
    const filter = { captureApiCalls: true, captureAllCalls: true };
    expect(shouldRecordRequest(detailsPost, filter, true)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateSettings
// ─────────────────────────────────────────────────────────────────────────────

describe('validateSettings', () => {
  const defaults = {
    screenshotSeconds: 5,
    maxSessions: 25,
    imageQuality: 0.92,
    autoScreenshot: true,
    captureApiCalls: false,
    captureFailedCalls: true,
    captureAllCalls: false,
    includeTimestamp: true,
    autoSave: false,
    captureOnNavigation: false,
    smartDedup: true,
    screenshotFormat: 'png',
    exportImageQuality: 'auto'
  };

  it('clamps screenshotSeconds to 1-60 range', () => {
    const raw = { screenshotSeconds: 200 };
    const result = validateSettings(raw, defaults);
    expect(result.screenshotSeconds).toBe(60);
  });

  it('clamps screenshotSeconds below minimum to 1', () => {
    const raw = { screenshotSeconds: 0 };
    const result = validateSettings(raw, defaults);
    expect(result.screenshotSeconds).toBe(1);
  });

  it('preserves valid screenshotSeconds in range', () => {
    const raw = { screenshotSeconds: 30 };
    const result = validateSettings(raw, defaults);
    expect(result.screenshotSeconds).toBe(30);
  });

  it('clamps maxSessions to 1-100 range', () => {
    const raw = { maxSessions: 500 };
    const result = validateSettings(raw, defaults);
    expect(result.maxSessions).toBe(100);
  });

  it('clamps maxSessions below minimum to 1', () => {
    const raw = { maxSessions: 0 };
    const result = validateSettings(raw, defaults);
    expect(result.maxSessions).toBe(1);
  });

  it('clamps imageQuality to 0.1-1.0 range (upper bound)', () => {
    const raw = { imageQuality: 1.5 };
    const result = validateSettings(raw, defaults);
    expect(result.imageQuality).toBe(1.0);
  });

  it('clamps imageQuality to 0.1-1.0 range (lower bound)', () => {
    const raw = { imageQuality: 0.05 };
    const result = validateSettings(raw, defaults);
    expect(result.imageQuality).toBe(0.1);
  });

  it('preserves valid imageQuality in range', () => {
    const raw = { imageQuality: 0.8 };
    const result = validateSettings(raw, defaults);
    expect(result.imageQuality).toBe(0.8);
  });

  it('preserves valid boolean setting autoScreenshot', () => {
    const raw = { autoScreenshot: false };
    const result = validateSettings(raw, defaults);
    expect(result.autoScreenshot).toBe(false);
  });

  it('preserves valid boolean setting smartDedup', () => {
    const raw = { smartDedup: false };
    const result = validateSettings(raw, defaults);
    expect(result.smartDedup).toBe(false);
  });

  it('preserves valid boolean setting captureApiCalls', () => {
    const raw = { captureApiCalls: true };
    const result = validateSettings(raw, defaults);
    expect(result.captureApiCalls).toBe(true);
  });

  it('preserves valid boolean setting captureFailedCalls', () => {
    const raw = { captureFailedCalls: false };
    const result = validateSettings(raw, defaults);
    expect(result.captureFailedCalls).toBe(false);
  });

  it('preserves valid boolean setting captureAllCalls', () => {
    const raw = { captureAllCalls: true };
    const result = validateSettings(raw, defaults);
    expect(result.captureAllCalls).toBe(true);
  });

  it('fills in defaults for missing keys', () => {
    const raw = {};
    const result = validateSettings(raw, defaults);
    expect(result.screenshotSeconds).toBe(5);
    expect(result.maxSessions).toBe(25);
    expect(result.imageQuality).toBe(0.92);
    expect(result.smartDedup).toBe(true);
  });

  it('merges raw settings with defaults', () => {
    const raw = { screenshotSeconds: 10, imageQuality: 0.8 };
    const result = validateSettings(raw, defaults);
    expect(result.screenshotSeconds).toBe(10);
    expect(result.imageQuality).toBe(0.8);
    expect(result.maxSessions).toBe(25); // from defaults
    expect(result.smartDedup).toBe(true); // from defaults
  });

  it('returns default for invalid screenshotFormat', () => {
    const raw = { screenshotFormat: 'invalid-format' };
    const result = validateSettings(raw, defaults);
    expect(result.screenshotFormat).toBe('png');
  });

  it('preserves valid screenshotFormat enum values', () => {
    const raw = { screenshotFormat: 'jpeg-high' };
    const result = validateSettings(raw, defaults);
    expect(result.screenshotFormat).toBe('jpeg-high');
  });

  it('returns default for invalid exportImageQuality', () => {
    const raw = { exportImageQuality: 'super-high' };
    const result = validateSettings(raw, defaults);
    expect(result.exportImageQuality).toBe('auto');
  });

  it('preserves valid exportImageQuality enum values', () => {
    // P1-19: valid enum is auto|high|standard (must match popup.html options
    // and ExportService._resolveExportImageOpts ALLOWED list)
    for (const value of ['auto', 'high', 'standard']) {
      const result = validateSettings({ exportImageQuality: value }, defaults);
      expect(result.exportImageQuality).toBe(value);
    }
  });

  it('replaces legacy exportImageQuality values with the default', () => {
    // 'png' / 'jpeg-high' / 'jpeg-standard' were a stale enum the UI never
    // offered — stored copies must fall back to the default
    for (const value of ['png', 'jpeg-high', 'jpeg-standard']) {
      const result = validateSettings({ exportImageQuality: value }, defaults);
      expect(result.exportImageQuality).toBe(defaults.exportImageQuality);
    }
  });

  it('handles null raw settings', () => {
    const result = validateSettings(null, defaults);
    expect(result.screenshotSeconds).toBe(5);
    expect(result.maxSessions).toBe(25);
  });

  it('handles null defaults', () => {
    const raw = { screenshotSeconds: 15 };
    const result = validateSettings(raw, null);
    expect(result.screenshotSeconds).toBe(15);
  });

  it('handles both null raw and defaults', () => {
    const result = validateSettings(null, null);
    expect(result).toEqual({});
  });

  it('converts numeric strings to numbers for screenshotSeconds', () => {
    const raw = { screenshotSeconds: '25' };
    const result = validateSettings(raw, defaults);
    expect(result.screenshotSeconds).toBe(25);
  });

  it('converts numeric strings to numbers for maxSessions', () => {
    const raw = { maxSessions: '50' };
    const result = validateSettings(raw, defaults);
    expect(result.maxSessions).toBe(50);
  });

  it('converts numeric strings to numbers for imageQuality', () => {
    const raw = { imageQuality: '0.75' };
    const result = validateSettings(raw, defaults);
    expect(result.imageQuality).toBe(0.75);
  });

  it('handles NaN values by using defaults', () => {
    const raw = { screenshotSeconds: 'not-a-number' };
    const result = validateSettings(raw, defaults);
    expect(result.screenshotSeconds).toBe(5);
  });

  it('preserves all valid boolean settings together', () => {
    const raw = {
      autoScreenshot: true,
      captureApiCalls: true,
      captureFailedCalls: false,
      captureAllCalls: true,
      includeTimestamp: false,
      autoSave: true,
      captureOnNavigation: true,
      smartDedup: false
    };
    const result = validateSettings(raw, defaults);
    expect(result.autoScreenshot).toBe(true);
    expect(result.captureApiCalls).toBe(true);
    expect(result.captureFailedCalls).toBe(false);
    expect(result.captureAllCalls).toBe(true);
    expect(result.includeTimestamp).toBe(false);
    expect(result.autoSave).toBe(true);
    expect(result.captureOnNavigation).toBe(true);
    expect(result.smartDedup).toBe(false);
  });

  it('strips unknown keys from result', () => {
    const raw = {
      screenshotSeconds: 10,
      unknownKey: 'should-be-stripped',
      anotherUnknown: 123
    };
    const result = validateSettings(raw, defaults);
    expect(result.unknownKey).toBeUndefined();
    expect(result.anotherUnknown).toBeUndefined();
    expect(result.screenshotSeconds).toBe(10);
  });

  it('handles complex mixed input with multiple clamping and defaults', () => {
    const raw = {
      screenshotSeconds: 200,
      imageQuality: 0.05,
      smartDedup: true,
      screenshotFormat: 'invalid',
      captureApiCalls: true
    };
    const result = validateSettings(raw, defaults);
    expect(result.screenshotSeconds).toBe(60); // clamped
    expect(result.imageQuality).toBe(0.1); // clamped
    expect(result.smartDedup).toBe(true); // preserved
    expect(result.screenshotFormat).toBe('png'); // default for invalid enum
    expect(result.captureApiCalls).toBe(true); // preserved
    expect(result.maxSessions).toBe(25); // from defaults
  });
});
