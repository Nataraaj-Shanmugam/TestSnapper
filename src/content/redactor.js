/**
 * Privacy Redactor - Filters and masks sensitive data
 *
 * Key implementation details:
 *  1. Removed /g flag from instance-level RegExp properties.
 *  2. Removed the .test() → .replace() two-step pattern entirely.
 *  3. Pre-compile /g regex variants once in constructor.
 *  4. Guard against re-injection SyntaxError.
 */

// Guard against re-injection SyntaxError — same pattern as selector.js.
if (typeof window !== 'undefined' && window.Redactor) {
  // Already defined — skip re-declaration entirely.
} else {

class Redactor {
  constructor() {
    // Keywords that flag a field as sensitive (no /g needed — used with .some/.test on short strings)
    // Enhanced with PIN, routing, account, DOB patterns
    this.sensitivePatterns = [
      /password/i,
      /passwd/i,
      /pwd/i,
      /secret/i,
      /token/i,
      /api[_-]?key/i,
      /auth/i,
      /credit[_-]?card/i,
      /cvv/i,
      /ssn/i,
      /social[_-]?security/i,
      /\bpin\b/i,
      /routing[_-]?number/i,
      /account[_-]?number/i,
      /bank[_-]?account/i,
      /dob/i,
      /date[_-]?of[_-]?birth/i,
      /birthdate/i,
      /tax[_-]?id/i,
      /\bein\b/i,
      /driver[_-]?license/i,
      /passport/i
    ];

    // PII detection patterns — stored WITHOUT /g to avoid lastIndex state.
    // /g is added inline only where .replace() needs global replacement.
    // Negative lookbehind: skip emails in URLs (//user@host) and templates ({{email@…}})
    this.emailPattern = /(?<![/:{])\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
    this.phonePattern = /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/;
    this.creditCardPattern = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/;
    this.ssnPattern = /\b\d{3}-\d{2}-\d{4}\b/;
    this._routingPattern = /\b\d{9}\b/; // private — only valid in financial field context (LOW-016)
    this.dobPattern = /\b(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])[\/\-](\d{4}|\d{2})\b/; // MM/DD/YYYY or MM-DD-YY

    // Pre-compile /g variants once to avoid per-call RegExp construction.
    this._emailPatternG = new RegExp(this.emailPattern.source, 'g');
    this._phonePatternG = new RegExp(this.phonePattern.source, 'g');
    this._creditCardPatternG = new RegExp(this.creditCardPattern.source, 'g');
    this._ssnPatternG = new RegExp(this.ssnPattern.source, 'g');
    this._routingPatternG = new RegExp(this._routingPattern.source, 'g');
    this._dobPatternG = new RegExp(this.dobPattern.source, 'g');
  }

  /**
   * Check if an input field should be ignored / fully redacted.
   */
  shouldIgnoreField(element) {
    if (!element) return false;

    if (element.type === 'password') return true;

    if (element.dataset.sensitive === 'true' || element.dataset.sensitive === '') return true;

    // Concatenate labeling attributes only — class names excluded to avoid
    // false positives on utility classes like "auth-button" or "token-input-wrapper"
    const attributes = [
      element.name,
      element.id,
      element.placeholder,
      element.getAttribute('aria-label')
    ].filter(Boolean).join(' ');

    return this.sensitivePatterns.some(pattern => pattern.test(attributes));
  }

  /**
   * Mask sensitive value.
   *
   * If the field itself is sensitive (password, etc.) the entire value is
   * replaced with dots. Otherwise each replacement runs unconditionally —
   * .replace() is a no-op when the pattern doesn't match, so no .test()
   * guard is needed.
   */
  maskValue(value, element) {
    if (!value) return '';

    // Fully redact sensitive fields
    if (this.shouldIgnoreField(element)) {
      return '\u2022'.repeat(Math.min(value.length, 8)); // •••••••• (up to 8)
    }

    // FUNC-014: Apply PII pattern masking unconditionally for ALL fields.
    // Previously this block was only reached when shouldIgnoreField was false,
    // but callers only called maskValue when shouldIgnoreField was true \u2014
    // making the PII patterns unreachable dead code. Now callers always invoke
    // maskValue and this function handles the full masking logic.
    // PERF-017: Use pre-compiled /g regex variants; reset lastIndex before each
    // use since they are stored as instance properties shared across calls.

    let result = value;

    // Mask emails - full masking for email fields, partial for others
    this._emailPatternG.lastIndex = 0;
    result = result.replace(
      this._emailPatternG,
      (email) => {
        // Check if element is an email input field - use full masking
        if (element && (element.type === 'email' ||
            /email|e-mail|mail/i.test(element.name || '') ||
            /email|e-mail|mail/i.test(element.id || '') ||
            /email|e-mail|mail/i.test(element.placeholder || ''))) {
          return '***@***.com'; // Full masking for email fields
        }
        // Partial masking for other contexts
        const [name, domain] = email.split('@');
        return `${name.substring(0, 2)}***@${domain}`;
      }
    );

    // Mask phone numbers unconditionally — same policy as SSN and credit card
    this._phonePatternG.lastIndex = 0;
    result = result.replace(this._phonePatternG, '***-***-****');

    // Mask credit card numbers
    this._creditCardPatternG.lastIndex = 0;
    result = result.replace(this._creditCardPatternG, '**** **** **** ****');

    // Mask SSN
    this._ssnPatternG.lastIndex = 0;
    result = result.replace(this._ssnPatternG, '***-**-****');

    // Mask routing numbers (9 digits) — ONLY when the field context looks
    // bank/routing related. A blind \b\d{9}\b mask would corrupt legitimate
    // 9-digit values (IDs, unseparated phone numbers, etc.).
    const looksFinancial = element && /rout|aba|account|bank/i.test(
      [
        element.name,
        element.id,
        element.placeholder,
        element.getAttribute && element.getAttribute('aria-label')
      ].filter(Boolean).join(' ')
    );
    if (looksFinancial) {
      this._routingPatternG.lastIndex = 0;
      result = result.replace(this._routingPatternG, '*********');
    }

    // Mask dates of birth with length-accurate year mask (LOW-015)
    this._dobPatternG.lastIndex = 0;
    result = result.replace(this._dobPatternG, (match, month, day, year) =>
      `**/**/${'*'.repeat(year.length)}`);

    return result;
  }

  /**
   * Redact sensitive data from a recorded step object.
   */
  redactStep(step) {
    if (!step) return step;

    const redacted = { ...step };

    if (redacted.value) {
      if (redacted.isSensitive) {
        redacted.value = '•'.repeat(8);
      } else {
        redacted.value = this.maskValue(redacted.value, null);
      }
    }

    return redacted;
  }
}

if (typeof window !== 'undefined') {
  window.Redactor = Redactor;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Redactor };
}

} // end of FUNC-001 guard: if (!window.Redactor)