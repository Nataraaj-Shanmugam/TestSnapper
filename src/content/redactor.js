/**
 * Privacy Redactor - Filters and masks sensitive data
 *
 * Fixes applied:
 *  1. Removed /g flag from instance-level RegExp properties. Storing a /g regex
 *     as a property and calling .test() on it advances its internal lastIndex,
 *     which causes the subsequent .replace() to miss the first match on repeated
 *     calls. The /g flag is now used only inline inside .replace() calls.
 *  2. Removed the .test() → .replace() two-step pattern entirely. .replace() with
 *     /g already returns the original string unchanged when there is no match, so
 *     the .test() guard is unnecessary and was the source of the bug.
 *  3. Fixed mojibaked bullet character (â€¢ → •).
 */

class Redactor {
  constructor() {
    // Keywords that flag a field as sensitive (no /g needed — used with .some/.test on short strings)
    // RED-MED-001: Enhanced with PIN, routing, account, DOB patterns
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
      /ein/i,
      /driver[_-]?license/i,
      /passport/i
    ];

    // PII detection patterns — stored WITHOUT /g to avoid lastIndex state.
    // /g is added inline only where .replace() needs global replacement.
    this.emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;
    this.phonePattern = /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/;
    this.creditCardPattern = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/;
    this.ssnPattern = /\b\d{3}-\d{2}-\d{4}\b/;
    this.pinPattern = /\b\d{4,6}\b/; // 4-6 digit PINs
    this.routingPattern = /\b\d{9}\b/; // 9 digit routing numbers
    this.dobPattern = /\b(0?[1-9]|1[0-2])[\/\-](0?[1-9]|[12]\d|3[01])[\/\-](\d{4}|\d{2})\b/; // MM/DD/YYYY or MM-DD-YY
  }

  /**
   * Check if an input field should be ignored / fully redacted.
   */
  shouldIgnoreField(element) {
    if (!element) return false;

    if (element.type === 'password') return true;

    if (element.dataset.sensitive === 'true' || element.dataset.sensitive === '') return true;

    // Concatenate all labeling attributes and test against sensitive keywords
    const attributes = [
      element.name,
      element.id,
      element.placeholder,
      element.getAttribute('aria-label'),
      element.className
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

    let result = value;

    // RED-MED-002: Mask emails - full masking for email fields, partial for others
    result = result.replace(
      new RegExp(this.emailPattern.source, 'g'),
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

    // Mask phone numbers
    result = result.replace(
      new RegExp(this.phonePattern.source, 'g'),
      '***-***-****'
    );

    // Mask credit card numbers
    result = result.replace(
      new RegExp(this.creditCardPattern.source, 'g'),
      '**** **** **** ****'
    );

    // RED-MED-001: Mask SSN
    result = result.replace(
      new RegExp(this.ssnPattern.source, 'g'),
      '***-**-****'
    );

    // Mask routing numbers (9 digits)
    result = result.replace(
      new RegExp(this.routingPattern.source, 'g'),
      '*********'
    );

    // Mask dates of birth
    result = result.replace(
      new RegExp(this.dobPattern.source, 'g'),
      '**/**/****'
    );

    // Mask PINs (4-6 digit numbers) - only if in sensitive context
    if (this.shouldIgnoreField(element)) {
      result = result.replace(
        new RegExp(this.pinPattern.source, 'g'),
        (match) => '\u2022'.repeat(match.length)
      );
    }

    return result;
  }

  /**
   * Redact sensitive data from a recorded step object.
   */
  redactStep(step) {
    if (!step) return step;

    const redacted = { ...step };

    if (redacted.value && redacted.isSensitive) {
      redacted.value = '\u2022'.repeat(8); // ••••••••
    }

    return redacted;
  }
}

if (typeof window !== 'undefined') {
  if (!window.Redactor) {
    window.Redactor = Redactor;
  }
}