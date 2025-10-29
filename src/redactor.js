/**
 * Privacy Redactor - Filters and masks sensitive data
 */

class Redactor {
  constructor() {
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
      /social[_-]?security/i
    ];

    this.emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
    this.phonePattern = /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g;
    this.creditCardPattern = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g;
  }

  /**
   * Check if an input field should be ignored/redacted
   */
  shouldIgnoreField(element) {
    if (!element) return false;

    // Check input type
    if (element.type === 'password') {
      return true;
    }

    // Check for data-sensitive attribute
    if (element.dataset.sensitive === 'true' || element.dataset.sensitive === '') {
      return true;
    }

    // Check name, id, placeholder, aria-label for sensitive keywords
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
   * Mask sensitive value
   */
  maskValue(value, element) {
    if (!value) return '';

    // If field should be ignored, return masked
    if (this.shouldIgnoreField(element)) {
      return '•'.repeat(Math.min(value.length, 8));
    }

    // Mask emails
    if (this.emailPattern.test(value)) {
      return value.replace(this.emailPattern, (email) => {
        const [name, domain] = email.split('@');
        return `${name.substring(0, 2)}***@${domain}`;
      });
    }

    // Mask phone numbers
    if (this.phonePattern.test(value)) {
      return value.replace(this.phonePattern, '***-***-****');
    }

    // Mask credit cards
    if (this.creditCardPattern.test(value)) {
      return value.replace(this.creditCardPattern, '**** **** **** ****');
    }

    return value;
  }

  /**
   * Redact sensitive data from step
   */
  redactStep(step) {
    if (!step) return step;

    // Create a copy
    const redacted = { ...step };

    // If value exists and should be masked
    if (redacted.value && redacted.isSensitive) {
      redacted.value = '•'.repeat(8);
    }

    return redacted;
  }
}

if (typeof window !== 'undefined') {
  window.Redactor = Redactor;
}