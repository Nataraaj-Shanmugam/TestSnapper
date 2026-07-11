import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';

// CSS.escape polyfill (same pattern as selector.test.js)
if (!globalThis.CSS) {
  globalThis.CSS = {
    escape(value) {
      return value.replace(/[^\w-]/g, s => `\\${s}`);
    }
  };
}

const require = createRequire(import.meta.url);
const { FieldNameResolver } = require('../../src/content/field-name-resolver.js');

// ─────────────────────────────────────────────────────────────────────────────
// _isQualityName — pure logic, no DOM
// ─────────────────────────────────────────────────────────────────────────────

describe('FieldNameResolver._isQualityName', () => {
  let resolver;
  beforeEach(() => { resolver = new FieldNameResolver(); });

  it('returns false for null', () => {
    expect(resolver._isQualityName(null)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(resolver._isQualityName('')).toBe(false);
  });

  it('returns false for strings longer than 200 chars', () => {
    expect(resolver._isQualityName('a'.repeat(201))).toBe(false);
  });

  it('returns false for generic HTML tag names', () => {
    expect(resolver._isQualityName('button')).toBe(false);
    expect(resolver._isQualityName('input')).toBe(false);
    expect(resolver._isQualityName('select')).toBe(false);
    expect(resolver._isQualityName('form')).toBe(false);
  });

  it('returns false for generic action words', () => {
    expect(resolver._isQualityName('click')).toBe(false);
    expect(resolver._isQualityName('submit')).toBe(false);
    expect(resolver._isQualityName('text')).toBe(false);
  });

  it('returns true for a meaningful short name', () => {
    expect(resolver._isQualityName('Email Address')).toBe(true);
    expect(resolver._isQualityName('First Name')).toBe(true);
    expect(resolver._isQualityName('Login Button')).toBe(true);
  });

  it('returns true for names up to 200 chars', () => {
    expect(resolver._isQualityName('a'.repeat(200))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// _isGenerated — pure logic, no DOM
// ─────────────────────────────────────────────────────────────────────────────

describe('FieldNameResolver._isGenerated', () => {
  let resolver;
  beforeEach(() => { resolver = new FieldNameResolver(); });

  it('returns false for short strings (< 3 chars)', () => {
    expect(resolver._isGenerated('ab')).toBe(false);
    expect(resolver._isGenerated('')).toBe(false);
  });

  it('detects ember IDs', () => {
    expect(resolver._isGenerated('ember123')).toBe(true);
  });

  it('detects react- prefixed IDs', () => {
    expect(resolver._isGenerated('react-abc')).toBe(true);
  });

  it('detects mui- numeric IDs', () => {
    expect(resolver._isGenerated('mui-456')).toBe(true);
  });

  it('detects React 18 useId format :r0:', () => {
    expect(resolver._isGenerated(':r0:')).toBe(true);
    expect(resolver._isGenerated(':rabc:')).toBe(true);
  });

  it('detects pure hex hashes of 8+ chars', () => {
    expect(resolver._isGenerated('a1b2c3d4')).toBe(true);
    expect(resolver._isGenerated('aabbccdd00')).toBe(true);
  });

  it('detects pure numeric IDs', () => {
    expect(resolver._isGenerated('12345')).toBe(true);
  });

  it('detects Angular ng- prefix', () => {
    expect(resolver._isGenerated('ng-model')).toBe(true);
  });

  it('detects svelte- prefix', () => {
    expect(resolver._isGenerated('svelte-hash')).toBe(true);
  });

  it('returns false for meaningful human-authored names', () => {
    expect(resolver._isGenerated('username')).toBe(false);
    expect(resolver._isGenerated('email-input')).toBe(false);
    expect(resolver._isGenerated('login-form')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// _cleanFieldName — pure logic, no DOM
// ─────────────────────────────────────────────────────────────────────────────

describe('FieldNameResolver._cleanFieldName', () => {
  let resolver;
  beforeEach(() => { resolver = new FieldNameResolver(); });

  it('converts camelCase to Title Case words', () => {
    expect(resolver._cleanFieldName('firstName')).toBe('First Name');
  });

  it('converts underscores to spaces and title-cases', () => {
    expect(resolver._cleanFieldName('email_address')).toBe('Email Address');
  });

  it('converts hyphens to spaces and title-cases', () => {
    expect(resolver._cleanFieldName('login-button')).toBe('Login Button');
  });

  it('strips trailing colon', () => {
    expect(resolver._cleanFieldName('Email Address:')).toBe('Email Address');
  });

  it('strips leading and trailing asterisks (required-field markers)', () => {
    expect(resolver._cleanFieldName('*Email*')).toBe('Email');
    expect(resolver._cleanFieldName('**First Name**')).toBe('First Name');
  });

  it('collapses multiple spaces to one', () => {
    expect(resolver._cleanFieldName('First   Name')).toBe('First Name');
  });

  it('title-cases each word', () => {
    expect(resolver._cleanFieldName('FIRST NAME')).toBe('First Name');
    expect(resolver._cleanFieldName('first name')).toBe('First Name');
  });

  it('handles mixed camelCase with underscores', () => {
    expect(resolver._cleanFieldName('street_Address')).toBe('Street Address');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolve — DOM-based tests (jsdom)
// ─────────────────────────────────────────────────────────────────────────────

describe('FieldNameResolver.resolve — null / missing element', () => {
  it('returns null for null', () => {
    const resolver = new FieldNameResolver();
    expect(resolver.resolve(null)).toBeNull();
  });
});

describe('FieldNameResolver.resolve — ARIA attributes (Strategy 2)', () => {
  let resolver;
  beforeEach(() => {
    resolver = new FieldNameResolver();
    document.body.innerHTML = '';
  });

  it('returns aria-label value', () => {
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'Search Query');
    document.body.appendChild(input);
    expect(resolver.resolve(input)).toBe('Search Query');
  });

  it('returns text of aria-labelledby target element', () => {
    document.body.innerHTML = `
      <label id="lbl-city">City</label>
      <input id="city" aria-labelledby="lbl-city" />
    `;
    const input = document.getElementById('city');
    expect(resolver.resolve(input)).toBe('City');
  });
});

describe('FieldNameResolver.resolve — placeholder (Strategy 3)', () => {
  let resolver;
  beforeEach(() => {
    resolver = new FieldNameResolver();
    document.body.innerHTML = '';
  });

  it('returns placeholder text when no label is available', () => {
    const input = document.createElement('input');
    input.placeholder = 'Enter your email';
    document.body.appendChild(input);
    expect(resolver.resolve(input)).toBe('Enter Your Email');
  });

  it('does not return placeholder when aria-label is present (aria wins)', () => {
    const input = document.createElement('input');
    input.setAttribute('aria-label', 'Email Address');
    input.placeholder = 'Enter email';
    document.body.appendChild(input);
    expect(resolver.resolve(input)).toBe('Email Address');
  });
});

describe('FieldNameResolver.resolve — explicit label[for] (Strategy 1)', () => {
  let resolver;
  beforeEach(() => {
    resolver = new FieldNameResolver();
    document.body.innerHTML = '';
  });

  it('finds label via label[for=id]', () => {
    document.body.innerHTML = `
      <label for="username-field">Username</label>
      <input id="username-field" type="text" />
    `;
    const input = document.getElementById('username-field');
    expect(resolver.resolve(input)).toBe('Username');
  });

  it('finds label when input is wrapped inside a <label>', () => {
    document.body.innerHTML = `
      <label>Phone Number <input type="tel" /></label>
    `;
    const input = document.querySelector('input');
    expect(resolver.resolve(input)).toBe('Phone Number');
  });

  it('finds previous sibling label', () => {
    document.body.innerHTML = `
      <label>Country</label>
      <select id="country"></select>
    `;
    const select = document.getElementById('country');
    expect(resolver.resolve(select)).toBe('Country');
  });
});

describe('FieldNameResolver.resolve — meaningful attributes (Strategy 5)', () => {
  let resolver;
  beforeEach(() => {
    resolver = new FieldNameResolver();
    document.body.innerHTML = '';
  });

  it('uses name attribute when no label or aria is available', () => {
    const input = document.createElement('input');
    input.name = 'first_name';
    document.body.appendChild(input);
    expect(resolver.resolve(input)).toBe('First Name');
  });

  it('uses id attribute when name is absent', () => {
    const input = document.createElement('input');
    input.id = 'phone-number';
    document.body.appendChild(input);
    expect(resolver.resolve(input)).toBe('Phone Number');
  });

  it('does not use auto-generated ember IDs', () => {
    const input = document.createElement('input');
    input.id = 'ember999';
    // No label, no aria, no placeholder, no name — fallback should skip ember ID
    document.body.appendChild(input);
    // Should return null because ember ID is generated and no other strategy fires
    expect(resolver.resolve(input)).toBeNull();
  });
});

describe('FieldNameResolver.resolve — button context (Strategy 6)', () => {
  let resolver;
  beforeEach(() => {
    resolver = new FieldNameResolver();
    document.body.innerHTML = '';
  });

  it('returns button text content', () => {
    const btn = document.createElement('button');
    btn.textContent = 'Save Changes';
    document.body.appendChild(btn);
    expect(resolver.resolve(btn)).toBe('Save Changes');
  });

  it('returns anchor text content', () => {
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = 'Forgot Password';
    document.body.appendChild(a);
    expect(resolver.resolve(a)).toBe('Forgot Password');
  });

  it('returns img alt text', () => {
    const img = document.createElement('img');
    img.alt = 'Company Logo';
    document.body.appendChild(img);
    expect(resolver.resolve(img)).toBe('Company Logo');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// clearCache
// ─────────────────────────────────────────────────────────────────────────────

describe('FieldNameResolver.clearCache', () => {
  it('allows re-resolution after cache is cleared', () => {
    const resolver = new FieldNameResolver();
    document.body.innerHTML = '';

    const input = document.createElement('input');
    input.setAttribute('aria-label', 'Original Label');
    document.body.appendChild(input);

    // First resolution — populates cache
    expect(resolver.resolve(input)).toBe('Original Label');

    // Mutate without clearing — cached value returned
    input.setAttribute('aria-label', 'Updated Label');
    expect(resolver.resolve(input)).toBe('Original Label');

    // After clearCache — fresh resolution picks up new value
    resolver.clearCache();
    expect(resolver.resolve(input)).toBe('Updated Label');
  });

  it('does not throw when called on a fresh instance', () => {
    const resolver = new FieldNameResolver();
    expect(() => resolver.clearCache()).not.toThrow();
  });
});
