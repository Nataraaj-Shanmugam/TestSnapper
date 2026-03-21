/**
 * Shared test fixtures — realistic session and step objects
 * used across all test files.
 */

export const sampleSession = {
  sessionId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  sessionName: 'Login Flow Test',
  createdAt: 1700000000000,
  lastModified: 1700000060000,
  env: {
    url: 'https://example.com/login',
    title: 'Example Login Page',
    userAgent: 'Mozilla/5.0 Chrome/120',
    viewport: { width: 1280, height: 800 }
  }
};

export const sampleSteps = [
  {
    stepId: 'step-001',
    action: 'navigate',
    fieldName: '',
    value: 'https://example.com/login',
    url: 'https://example.com/login',
    timestamp: 1700000001000,
    selector: { css: null, xpath: null, text: null },
    notes: ''
  },
  {
    stepId: 'step-002',
    action: 'type',
    fieldName: 'Email',
    value: 'user@example.com',
    url: 'https://example.com/login',
    timestamp: 1700000005000,
    selector: { css: 'input[name="email"]', xpath: '//input[@name="email"]', text: '' },
    notes: ''
  },
  {
    stepId: 'step-003',
    action: 'type',
    fieldName: 'Password',
    value: 'secret',
    url: 'https://example.com/login',
    timestamp: 1700000010000,
    selector: { css: 'input[name="password"]', xpath: '//input[@name="password"]', text: '' },
    isSensitive: true,
    notes: ''
  },
  {
    stepId: 'step-004',
    action: 'click',
    fieldName: 'Login Button',
    value: '',
    url: 'https://example.com/login',
    timestamp: 1700000015000,
    selector: { css: 'button[type="submit"]', xpath: '//button[@type="submit"]', text: 'Login' },
    notes: ''
  },
  {
    stepId: 'step-005',
    action: 'screenshot',
    fieldName: '',
    value: '',
    url: 'https://example.com/dashboard',
    timestamp: 1700000020000,
    selector: { css: null, xpath: null, text: null },
    isManual: true,
    notes: 'After login'
  }
];

// A tiny 1x1 red pixel PNG as a data URL (valid base64)
export const tinyPngDataURL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI6QAAAABJRU5ErkJggg==';

export const sensitiveSteps = [
  {
    stepId: 'sens-001',
    action: 'type',
    fieldName: 'SSN',
    value: '123-45-6789',
    url: 'https://example.com/form',
    timestamp: 1700000030000,
    selector: { css: 'input[name="ssn"]', xpath: null, text: '' },
    isSensitive: true
  },
  {
    stepId: 'sens-002',
    action: 'type',
    fieldName: 'Credit Card',
    value: '4532 1234 5678 9010',
    url: 'https://example.com/checkout',
    timestamp: 1700000040000,
    selector: { css: 'input[name="card"]', xpath: null, text: '' },
    isSensitive: true
  }
];
