/**
 * Recorder Utilities — testable extraction of recording logic from background.js
 *
 * This module exports pure functions for recording decision logic:
 * - Duplicate detection
 * - API request filtering
 * - Settings validation
 *
 * Usage:
 *   import { _isConsecutiveDuplicate, shouldRecordRequest, validateSettings } from './recorder-utils.js';
 */

/**
 * Detects if a step is a consecutive duplicate of the last added step.
 * Used to prevent recording the same action twice in a row.
 *
 * @param {Object} stepData - Current step data to check
 * @param {string} stepData.action - The action type (e.g., 'type', 'select', 'apicall')
 * @param {string} stepData.fieldName - The field name
 * @param {string} stepData.url - The page/API URL
 * @param {string} stepData.value - The value entered/selected
 * @param {Object} [stepData.selector] - Selector information with optional css property
 * @param {string} stepData.targetLabel - Human-readable target label
 *
 * @param {Object} lastStep - The previously added step (or null)
 * @param {string} lastStep.action - The action type
 * @param {string} lastStep.fieldName - The field name
 * @param {string} lastStep.url - The page/API URL
 * @param {string} lastStep.value - The value entered/selected
 * @param {Object} [lastStep.selector] - Selector information with optional css property
 * @param {string} lastStep.targetLabel - Human-readable target label
 *
 * @returns {boolean} true if this step is a duplicate of the last step
 *
 * @example
 * const stepData = { action: 'type', fieldName: 'username', url: '/', selector: { css: 'input.user' }, value: 'alice' };
 * const lastStep = { action: 'type', fieldName: 'username', url: '/', selector: { css: 'input.user' }, value: 'alice' };
 * _isConsecutiveDuplicate(stepData, lastStep) → true
 */
export function _isConsecutiveDuplicate(stepData, lastStep) {
  if (!lastStep) return false;

  // Same action + same fieldName + same selector CSS + same URL = duplicate
  if (lastStep.action !== stepData.action) return false;
  if (lastStep.fieldName !== stepData.fieldName) return false;
  if (lastStep.url !== stepData.url) return false;

  // For type/select actions, allow if value changed
  if ((stepData.action === 'type' || stepData.action === 'select') &&
      stepData.value !== lastStep.value) {
    return false;
  }

  // For apicall steps, different status codes (200 vs 500) are distinct events (LOW-007)
  if (stepData.action === 'apicall' && stepData.apiStatus !== lastStep.apiStatus) return false;

  // Compare selector CSS if both have one
  const prevCss = lastStep.selector?.css || '';
  const currCss = stepData.selector?.css || '';
  if (prevCss && currCss && prevCss !== currCss) return false;

  // If target labels match too, it's definitely a duplicate
  if (lastStep.targetLabel === stepData.targetLabel) return true;

  // Even without matching targetLabel, same action+field+url+selector is enough
  return true;
}

/**
 * Determines whether an API request should be recorded based on settings.
 *
 * The recording decision is based on three independent flags:
 * - captureApiCalls: master flag (if false, never record)
 * - captureAllCalls: if true, record all requests
 * - captureFailedCalls: if true and captureAllCalls is false, record only failures
 *
 * @param {Object} details - The request details
 * @param {string} details.url - The request URL
 * @param {string} details.method - The HTTP method (GET, POST, etc.)
 *
 * @param {Object} filter - Settings filter object
 * @param {boolean} filter.captureApiCalls - Master flag to capture API calls at all
 * @param {boolean} [filter.captureAllCalls] - If true, capture all requests
 * @param {boolean} [filter.captureFailedCalls] - If true and !captureAllCalls, capture only failures
 *
 * @param {boolean} ok - true if the request succeeded (HTTP 2xx/3xx), false otherwise
 *
 * @returns {boolean} true if this request should be recorded
 *
 * @example
 * // Record all API calls
 * shouldRecordRequest({ url: 'https://api.example.com/data', method: 'GET' },
 *   { captureApiCalls: true, captureAllCalls: true },
 *   true) → true
 *
 * // Record only failed calls
 * const filter = { captureApiCalls: true, captureAllCalls: false, captureFailedCalls: true };
 * shouldRecordRequest({ url: 'https://api.example.com/data', method: 'GET' }, filter, false) → true
 * shouldRecordRequest({ url: 'https://api.example.com/data', method: 'GET' }, filter, true) → false
 */
export function shouldRecordRequest(details, filter, ok) {
  if (!filter || !filter.captureApiCalls) return false;
  const failedOnly = filter.captureFailedCalls && !filter.captureAllCalls;
  if (failedOnly) return !ok;
  return true; // captureAllCalls, or master-on default → all
}

/**
 * Decide whether a page navigation should trigger an automatic screenshot.
 *
 * "Auto-Capture Screenshots" (settings.autoScreenshot) is the MASTER switch for
 * all automatic screenshots. "Screenshot Before Navigation"
 * (settings.captureOnNavigation) is a sub-option that only applies when the
 * master is on. A screenshot is also suppressed when a sensitive field is
 * focused (avoid capturing on-screen PII).
 *
 * NOTE: content.js (a classic script that cannot import ES modules) mirrors this
 * exact rule inline in captureNavigation(). Keep the two in sync — this copy is
 * the tested source of truth.
 *
 * @param {Object} settings - session settings ({ autoScreenshot, captureOnNavigation })
 * @param {boolean} sensitiveFieldActive - true if a sensitive field is focused
 * @returns {boolean} true if a navigation screenshot should be captured
 *
 * @example
 * shouldCaptureNavigationScreenshot({ autoScreenshot: false, captureOnNavigation: true }, false) → false
 * shouldCaptureNavigationScreenshot({ autoScreenshot: true,  captureOnNavigation: true }, false) → true
 */
export function shouldCaptureNavigationScreenshot(settings, sensitiveFieldActive) {
  const s = settings || {};
  const autoCaptureOn = !!s.autoScreenshot;                // master OFF by default
  const navOptIn = s.captureOnNavigation !== false;        // sub-option ON by default
  return autoCaptureOn && navOptIn && !sensitiveFieldActive;
}

/**
 * Validates and clamps raw settings to safe ranges.
 *
 * Out-of-range numeric values are clamped to min/max; invalid enum values
 * are replaced with defaults; missing keys are filled from defaults.
 *
 * @param {Object} raw - Raw settings object (may contain invalid values)
 * @param {Object} defaults - Default settings with safe ranges and values
 *
 * @returns {Object} Validated settings object with all defaults merged in
 *
 * @example
 * const defaults = {
 *   screenshotSeconds: 5,
 *   maxSessions: 25,
 *   imageQuality: 0.92,
 *   screenshotFormat: 'png',
 *   exportImageQuality: 'auto'
 * };
 * const raw = { screenshotSeconds: 200, imageQuality: 1.5 };
 * validateSettings(raw, defaults);
 * → { screenshotSeconds: 60, imageQuality: 1.0, maxSessions: 25, screenshotFormat: 'png', ... }
 */
export function validateSettings(raw, defaults) {
  if (!raw) raw = {};
  if (!defaults) defaults = {};

  const validated = {};

  // Validate screenshotSeconds (1-60)
  if (raw.screenshotSeconds !== undefined) {
    const val = parseInt(raw.screenshotSeconds);
    validated.screenshotSeconds = isNaN(val) ? defaults.screenshotSeconds : Math.max(1, Math.min(60, val));
  }

  // Validate maxSessions (1-100)
  if (raw.maxSessions !== undefined) {
    const val = parseInt(raw.maxSessions);
    validated.maxSessions = isNaN(val) ? defaults.maxSessions : Math.max(1, Math.min(100, val));
  }

  // Validate imageQuality (0.1-1.0)
  if (raw.imageQuality !== undefined) {
    const val = parseFloat(raw.imageQuality);
    validated.imageQuality = isNaN(val) ? defaults.imageQuality : Math.max(0.1, Math.min(1.0, val));
  }

  // Validate boolean fields
  if (raw.autoScreenshot !== undefined) {
    validated.autoScreenshot = Boolean(raw.autoScreenshot);
  }
  if (raw.captureApiCalls !== undefined) {
    validated.captureApiCalls = Boolean(raw.captureApiCalls);
  }
  if (raw.captureFailedCalls !== undefined) {
    validated.captureFailedCalls = Boolean(raw.captureFailedCalls);
  }
  if (raw.captureAllCalls !== undefined) {
    validated.captureAllCalls = Boolean(raw.captureAllCalls);
  }
  if (raw.includeTimestamp !== undefined) {
    validated.includeTimestamp = Boolean(raw.includeTimestamp);
  }
  if (raw.autoSave !== undefined) {
    validated.autoSave = Boolean(raw.autoSave);
  }
  if (raw.captureOnNavigation !== undefined) {
    validated.captureOnNavigation = Boolean(raw.captureOnNavigation);
  }
  if (raw.smartDedup !== undefined) {
    validated.smartDedup = Boolean(raw.smartDedup);
  }

  // Validate screenshotFormat (enum)
  if (raw.screenshotFormat !== undefined) {
    const validFormats = ['png', 'jpeg-high'];
    validated.screenshotFormat = validFormats.includes(raw.screenshotFormat)
      ? raw.screenshotFormat : defaults.screenshotFormat;
  }

  // Validate exportImageQuality (enum)
  if (raw.exportImageQuality !== undefined) {
    const validExportQualities = ['auto', 'high', 'standard']; // P1-19: must match popup.html options and ExportService ALLOWED list
    validated.exportImageQuality = validExportQualities.includes(raw.exportImageQuality)
      ? raw.exportImageQuality : defaults.exportImageQuality;
  }

  return { ...defaults, ...validated };
}
