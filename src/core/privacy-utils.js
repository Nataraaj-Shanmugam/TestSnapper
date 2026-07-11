/**
 * Privacy Utilities — canonical, testable helpers for stripping sensitive data.
 *
 * Single source of truth so the background service worker, ExportService, and
 * the storage layer all sanitize identically (previously URL sanitization lived
 * only in export-service and ran ONLY at export time — SEC-1).
 *
 * NOTE: The content-script redactor (src/content/redactor.js) is a classic
 * script and cannot import this module, so it mirrors the PII patterns below.
 * Keep the two in sync — both are covered by tests.
 */

// Query-string keys whose values are almost always secrets. Matched case-insensitively.
const SENSITIVE_QUERY_KEYS =
  /^(token|access_token|refresh_token|id_token|code|key|api_key|apikey|password|passwd|pwd|secret|client_secret|sig|signature|auth|authorization|session|sessionid|sid|jwt|otp|reset|reset_token|magic|verify|verification|nonce|state|ticket)$/i;

/**
 * Strip sensitive query parameters from a URL, preserving everything else.
 * Applied at CAPTURE time (server-side, in the background) so tokens are never
 * written to storage/backups — not just masked at export (SEC-1 / SEC-6).
 *
 * @param {string} url
 * @returns {string} URL with sensitive query params removed, or the original
 *                   string on parse failure (relative/non-URL values).
 */
export function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return url || '';
  try {
    const parsed = new URL(url);
    const toDelete = [];
    parsed.searchParams.forEach((_, key) => {
      if (SENSITIVE_QUERY_KEYS.test(key)) toDelete.push(key);
    });
    toDelete.forEach((k) => parsed.searchParams.delete(k));
    // Also drop a token-bearing fragment (e.g. #access_token=… in OAuth implicit flow).
    if (parsed.hash && SENSITIVE_QUERY_KEYS.test(parsed.hash.replace(/^#/, '').split('=')[0])) {
      parsed.hash = '';
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

// ── PII patterns (SEC-3: broadened) ──────────────────────────────────────────
// Stored WITHOUT the /g flag; add /g inline where global replace is needed.
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
// Phone: optional +CC, optional (area), separators space/dot/hyphen. Requires at
// least one separator or parentheses so bare 10-digit ids aren't over-masked here.
const PHONE_RE = /(\+\d{1,3}[\s.-]?)?(\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}\b/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
// Candidate card numbers: 13–16 digits, optional space/hyphen grouping.
const CARD_CANDIDATE_RE = /\b(?:\d[ -]?){13,16}\b/g;

/**
 * Luhn checksum — used to avoid masking arbitrary 13–16 digit numbers (order
 * ids, etc.) that merely look card-shaped. Only real card numbers pass.
 * @param {string} digits - digits only
 * @returns {boolean}
 */
function luhnValid(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0 && digits.length >= 13;
}

/**
 * Generic, context-free PII masking backstop (SEC-2). Applied server-side in the
 * background to step.value / step.targetLabel so PII is masked even for step
 * paths that never ran the content-script field-aware redactor.
 *
 * Deliberately conservative to avoid corrupting legitimate data:
 *  - cards masked only when they pass the Luhn check
 *  - phones masked only when separated/parenthesized
 *  - bare 9-digit SSNs are NOT masked here (no field context → would hit order
 *    ids); those stay the content-script redactor's job in financial fields.
 *
 * @param {*} text
 * @returns {*} masked string, or the input unchanged when not a string
 */
export function maskGenericPII(text) {
  if (typeof text !== 'string' || text.length === 0) return text;

  let out = text.replace(EMAIL_RE, (email) => {
    const at = email.indexOf('@');
    const name = email.slice(0, at);
    const domain = email.slice(at + 1);
    return `${name.slice(0, 2)}***@${domain}`;
  });

  out = out.replace(CARD_CANDIDATE_RE, (match) => {
    const digits = match.replace(/[ -]/g, '');
    if (digits.length >= 13 && digits.length <= 16 && luhnValid(digits)) {
      return '**** **** **** ****';
    }
    return match; // not a real card — leave untouched
  });

  out = out.replace(PHONE_RE, '***-***-****');
  out = out.replace(SSN_RE, '***-**-****');

  return out;
}
