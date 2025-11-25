# Field Names and Locators Reference

## Overview

This document provides a comprehensive reference for how TestSnapper extracts field names and generates locators (CSS selectors) for web elements.

## Field Name Extraction

### Priority Order

TestSnapper extracts field names from the following sources, in priority order:

| Priority | Source | Example | Field Name Result |
|----------|--------|---------|-------------------|
| 1 | `aria-label` attribute | `<input aria-label="Email Address">` | "Email Address" |
| 2 | `aria-labelledby` (resolved) | `<div id="lbl">Username</div><input aria-labelledby="lbl">` | "Username" |
| 3 | `placeholder` attribute | `<input placeholder="Enter password">` | "Enter password" |
| 4 | `name` attribute | `<input name="user_email">` | "user_email" |
| 5 | `id` attribute | `<input id="phone-number">` | "phone-number" |
| 6 | Associated `<label>` | `<label for="age">Age:</label><input id="age">` | "Age:" |
| 7 | Parent `<label>` | `<label>City: <input></label>` | "City:" |
| 8 | `title` attribute | `<input title="Search query">` | "Search query" |
| 9 | Text content | `<button>Submit Form</button>` | "Submit Form" |
| 10 | `data-testid` attribute | `<input data-testid="username-field">` | "username-field" |

### Source Location Details

#### 1. aria-label (Highest Priority)
```html
<input type="text" aria-label="Your Email Address">
```
**Extracted Field Name**: "Your Email Address"

**Why Priority 1**: Most explicit and semantic way to label an element for accessibility.

---

#### 2. aria-labelledby (Referenced Label)
```html
<div id="email-label">Email Address</div>
<input type="email" aria-labelledby="email-label">
```
**Extracted Field Name**: "Email Address"

**Why Priority 2**: Explicit reference to another element containing the label.

---

#### 3. placeholder
```html
<input type="text" placeholder="Enter your username">
```
**Extracted Field Name**: "Enter your username"

**Why Priority 3**: Provides inline hint text, commonly used for field identification.

---

#### 4. name attribute
```html
<input type="text" name="first_name">
```
**Extracted Field Name**: "first_name"

**Why Priority 4**: Form field identifier, stable across sessions.

---

#### 5. id attribute
```html
<input type="text" id="user-email">
```
**Extracted Field Name**: "user-email"

**Why Priority 5**: Unique identifier, often descriptive.

---

#### 6. Associated Label (for attribute)
```html
<label for="username">Username:</label>
<input type="text" id="username">
```
**Extracted Field Name**: "Username:"

**Why Priority 6**: Standard HTML form labeling method.

---

#### 7. Parent Label
```html
<label>
  Phone Number:
  <input type="tel">
</label>
```
**Extracted Field Name**: "Phone Number:"

**Why Priority 7**: Alternative HTML labeling method.

---

#### 8. title attribute
```html
<input type="text" title="Search for products">
```
**Extracted Field Name**: "Search for products"

**Why Priority 8**: Tooltip text, sometimes descriptive.

---

#### 9. Text Content (for buttons, links)
```html
<button type="submit">Create Account</button>
<a href="/login">Sign In</a>
```
**Extracted Field Name**: "Create Account" / "Sign In"

**Why Priority 9**: Visible text for interactive elements.

---

#### 10. data-testid
```html
<input type="text" data-testid="email-input">
```
**Extracted Field Name**: "email-input"

**Why Priority 10**: Last resort, but useful for test-friendly markup.

---

## CSS Selector Generation

### Selector Priority and Scoring

TestSnapper generates CSS selectors with a scoring system to ensure stability and uniqueness.

| Priority | Selector Type | Score | Example | Notes |
|----------|---------------|-------|---------|-------|
| 1 | ID | 100 | `#username` | Most stable and unique |
| 2 | data-testid | 95 | `[data-testid="login-btn"]` | Designed for testing |
| 3 | name | 90 | `input[name="email"]` | Stable form identifier |
| 4 | aria-label | 85 | `button[aria-label="Submit"]` | Semantic identifier |
| 5 | type + placeholder | 80 | `input[type="email"][placeholder="Email"]` | Combined attributes |
| 6 | class | 70 | `button.primary-btn` | Filtered for stability |
| 7 | nth-of-type | 50 | `button:nth-of-type(2)` | Position-based fallback |
| 8 | XPath | Fallback | `/html/body/form/input[2]` | Last resort |

### Selector Details

#### 1. ID Selector (Score: 100)
```html
<input id="user-email" type="email">
```
**Generated Selector**: `#user-email`

**Uniqueness Check**: ✅ Must match exactly one element

**Why Best**: IDs are required to be unique in HTML, making them the most stable selector.

---

#### 2. data-testid Selector (Score: 95)
```html
<button data-testid="submit-form-btn">Submit</button>
```
**Generated Selector**: `[data-testid="submit-form-btn"]`

**Uniqueness Check**: ✅ Must match exactly one element

**Why High Priority**: Explicitly added for testing purposes, unlikely to change.

---

#### 3. name Selector (Score: 90)
```html
<input type="text" name="username">
```
**Generated Selector**: `input[name="username"]`

**Uniqueness Check**: ✅ Must match exactly one element

**Why High Priority**: Form field names are stable and meaningful.

---

#### 4. aria-label Selector (Score: 85)
```html
<button aria-label="Close dialog">×</button>
```
**Generated Selector**: `button[aria-label="Close dialog"]`

**Uniqueness Check**: ✅ Must match exactly one element

**Why High Priority**: Semantic and accessibility-focused, relatively stable.

---

#### 5. type + placeholder Selector (Score: 80)
```html
<input type="email" placeholder="Enter your email">
```
**Generated Selector**: `input[type="email"][placeholder="Enter your email"]`

**Uniqueness Check**: ✅ Must match exactly one element

**Why Moderate Priority**: Combination of attributes increases specificity.

---

#### 6. class Selector (Score: 70)
```html
<button class="btn primary-btn submit-action">Submit</button>
```
**Generated Selector**: `button.btn.primary-btn.submit-action`

**Uniqueness Check**: ✅ Must match exactly one element

**Filtering**: Excludes dynamic classes like `ng-*`, `is-*`, `has-*`

**Why Lower Priority**: Classes can change with styling updates.

---

#### 7. nth-of-type Selector (Score: 50)
```html
<form>
  <input type="text">
  <input type="email">  <!-- This one -->
  <input type="password">
</form>
```
**Generated Selector**: `input:nth-of-type(2)`

**Uniqueness Check**: ❌ Relative to parent, can change if DOM changes

**Why Fallback**: Position-based, fragile but works when nothing else does.

---

#### 8. XPath (Fallback)
```html
<div>
  <form>
    <input>  <!-- This one -->
  </form>
</div>
```
**Generated XPath**: `/html/body/div[1]/form[1]/input[1]`

**Uniqueness Check**: ❌ Very fragile

**Why Last Resort**: Works for any element but breaks easily with DOM changes.

---

## Complete Examples

### Example 1: Login Form

```html
<form id="login-form" data-testid="login-form">
  <label for="username">Username:</label>
  <input 
    id="username" 
    name="username" 
    type="text" 
    placeholder="Enter username"
    aria-label="Username input field"
    data-testid="username-input"
  >
  
  <label for="password">Password:</label>
  <input 
    id="password" 
    name="password" 
    type="password" 
    placeholder="Enter password"
    data-testid="password-input"
  >
  
  <button type="submit" data-testid="login-button">
    Login
  </button>
</form>
```

#### Captured Data:

**Username Field:**
- **Field Name**: "Username input field" (from `aria-label`, priority 1)
- **Selector**: `#username` (ID selector, score 100)
- **Alternative Field Name Sources**:
  - aria-label: "Username input field" ✅ (used)
  - Label: "Username:"
  - placeholder: "Enter username"
  - name: "username"
  - id: "username"
  - data-testid: "username-input"

**Password Field:**
- **Field Name**: "Password:" (from `<label>`, priority 6, since no aria-label)
- **Selector**: `#password` (ID selector, score 100)
- **Value**: `••••••••` (masked, sensitive field)
- **isSensitive**: `true`

**Login Button:**
- **Field Name**: "Login" (from text content, priority 9)
- **Selector**: `[data-testid="login-button"]` (data-testid selector, score 95)
  - Note: data-testid preferred over ID for buttons when both exist

---

### Example 2: Registration Form

```html
<form>
  <input 
    type="email" 
    name="email" 
    placeholder="Email address"
  >
  
  <input 
    type="tel" 
    name="phone" 
    placeholder="Phone number"
  >
  
  <select name="country">
    <option value="">Select country</option>
    <option value="us">United States</option>
    <option value="uk">United Kingdom</option>
  </select>
  
  <input type="checkbox" id="terms" name="terms">
  <label for="terms">I agree to terms</label>
  
  <button class="btn submit-btn">Create Account</button>
</form>
```

#### Captured Data:

**Email Field:**
- **Field Name**: "Email address" (from `placeholder`, priority 3)
- **Selector**: `input[name="email"]` (name selector, score 90)
- **Value**: "us***@example.com" (masked email)

**Phone Field:**
- **Field Name**: "Phone number" (from `placeholder`, priority 3)
- **Selector**: `input[name="phone"]` (name selector, score 90)
- **Value**: "***-***-****" (masked phone)

**Country Select:**
- **Field Name**: "country" (from `name`, priority 4)
- **Selector**: `select[name="country"]` (name selector, score 90)
- **Value**: "United States" (selected option text)

**Terms Checkbox:**
- **Field Name**: "I agree to terms" (from `<label>`, priority 6)
- **Selector**: `#terms` (ID selector, score 100)
- **Value**: "checked" or "unchecked"

**Submit Button:**
- **Field Name**: "Create Account" (from text content, priority 9)
- **Selector**: `button.btn.submit-btn` (class selector, score 70)

---

### Example 3: Complex UI with ARIA

```html
<div role="navigation" aria-label="Main menu">
  <button 
    role="menuitem" 
    aria-label="Open settings"
    data-testid="settings-btn"
  >
    <svg>...</svg>
  </button>
</div>

<div role="dialog" aria-labelledby="dialog-title">
  <h2 id="dialog-title">Confirm Action</h2>
  <button aria-label="Confirm">OK</button>
  <button aria-label="Cancel">Cancel</button>
</div>
```

#### Captured Data:

**Settings Button:**
- **Field Name**: "Open settings" (from `aria-label`, priority 1)
- **Selector**: `[data-testid="settings-btn"]` (data-testid selector, score 95)
- **Text**: "" (SVG icon, no text)
- **Role**: "menuitem"

**Dialog Confirm Button:**
- **Field Name**: "Confirm" (from `aria-label`, priority 1)
- **Selector**: `button[aria-label="Confirm"]` (aria-label selector, score 85)
- **Text**: "OK"
- **Role**: "button"

**Dialog Cancel Button:**
- **Field Name**: "Cancel" (from `aria-label`, priority 1)
- **Selector**: `button[aria-label="Cancel"]` (aria-label selector, score 85)
- **Text**: "Cancel"
- **Role**: "button"

---

## Selector Validation

### Uniqueness Check

For each generated selector, TestSnapper validates:

```javascript
const matches = document.querySelectorAll(selector);
return matches.length === 1 && matches[0] === targetElement;
```

**If selector is not unique:**
- Try next priority selector
- If all fail, use nth-of-type or XPath

### Stability Scoring

Selectors are scored based on:

1. **Uniqueness**: Must match exactly one element (mandatory)
2. **Stability**: How likely to remain valid after page changes
3. **Readability**: How human-readable the selector is

**Best practices for stable selectors:**
- Use `data-testid` attributes
- Ensure IDs are unique and descriptive
- Use semantic name attributes
- Add aria-labels for accessibility and testing

---

## Privacy & Sensitive Data

### Sensitive Field Detection

Fields are marked as sensitive if they match:

**Type Checks:**
- `type="password"`

**Attribute Checks:**
- `data-sensitive="true"`
- `data-sensitive` (empty value)

**Name/ID/Placeholder Pattern Matching:**
- password, passwd, pwd
- secret, token
- api-key, api_key, apikey
- auth, authorization
- credit-card, creditcard, cc
- cvv, cvc, cvn
- ssn, social-security

### Data Masking

**Passwords:**
```javascript
"MySecretPassword123" → "••••••••"
```

**Emails:**
```javascript
"user@example.com" → "us***@example.com"
```

**Phone Numbers:**
```javascript
"123-456-7890" → "***-***-****"
"(555) 123-4567" → "***-***-****"
```

**Credit Cards:**
```javascript
"4532 1234 5678 9010" → "**** **** **** ****"
```

---

## Best Practices

### For Developers

**1. Use Semantic HTML**
```html
<!-- Good -->
<label for="email">Email:</label>
<input id="email" name="email" type="email">

<!-- Better -->
<input 
  id="email" 
  name="email" 
  type="email"
  aria-label="Email address"
  data-testid="email-input"
>
```

**2. Add data-testid Attributes**
```html
<button data-testid="submit-btn">Submit</button>
<input data-testid="username-input">
```

**3. Use Meaningful IDs**
```html
<!-- Good -->
<input id="user-email">

<!-- Bad -->
<input id="input-37492">
```

### For QA Testers

**1. Verify Field Names**
- Check that extracted names are meaningful
- Report unclear names to developers
- Add notes for clarification (future feature)

**2. Test Selector Stability**
- Refresh page and verify selectors still work
- Test after code deployments
- Report broken selectors

**3. Privacy Review**
- Ensure sensitive data is masked
- Review exports before sharing
- Never include real passwords or tokens

---

## Troubleshooting

### Field Name Shows "input" or Generic Tag

**Problem**: No descriptive sources found

**Solutions**:
1. Add `aria-label` to element
2. Associate with a `<label>` element
3. Add meaningful `placeholder`
4. Use descriptive `name` or `id`

### Selector Not Unique

**Problem**: Multiple elements match selector

**Solutions**:
1. Add unique `id` to target element
2. Add `data-testid` attribute
3. Ensure `name` attributes are unique in context
4. Use more specific classes

### Privacy Masking Too Aggressive

**Problem**: Non-sensitive field is masked

**Solutions**:
1. Avoid keywords like "password", "token" in field names
2. Don't use `data-sensitive` attribute unintentionally
3. Review patterns in `src/redactor.js`

---

## Summary

**Field Name Extraction:**
- ✅ 10 different sources checked
- ✅ Priority-based selection
- ✅ Fallback to tag name if all fail

**Selector Generation:**
- ✅ 8 selector types with scoring
- ✅ Uniqueness validation required
- ✅ Stability prioritized over specificity

**Privacy Protection:**
- ✅ Automatic sensitive field detection
- ✅ Multiple masking strategies
- ✅ Configurable patterns

**For complete implementation details, see:**
- `src/selector.js` - Selector engine code
- `src/redactor.js` - Privacy filter code
- `IMPLEMENTATION.md` - Full technical documentation

---

**TestSnapper v1.1.0**  
*Comprehensive Field Name & Locator Extraction*
