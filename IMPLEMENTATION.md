# TestSnapper Implementation Guide

## Overview

This document provides a complete implementation reference for the TestSnapper Chrome Extension, including architecture, components, and the field name/locator extraction system.

## Core Components

### 1. Selector Engine (`src/selector.js`)

The selector engine is the heart of TestSnapper's field name and locator extraction system.

#### Key Methods

**`generateSelector(element)`**
- Generates a robust CSS selector for any DOM element
- Returns object: `{ css, xpath, text, role }`
- Prioritizes selectors by stability and uniqueness

**Selector Priority Algorithm:**

```javascript
1. ID selector (#id) - Score: 100
   - Most stable, unique identifier
   - Example: #username

2. data-testid - Score: 95
   - Designed for testing
   - Example: [data-testid="login-button"]

3. name attribute - Score: 90
   - Common for form elements
   - Example: input[name="email"]

4. aria-label - Score: 85
   - Accessibility attribute
   - Example: button[aria-label="Submit"]

5. type + placeholder - Score: 80
   - For input elements
   - Example: input[type="email"][placeholder="Enter email"]

6. class - Score: 70
   - Filtered to remove dynamic classes
   - Example: button.primary-btn

7. nth-of-type - Score: 50
   - Position-based fallback
   - Example: button:nth-of-type(2)

8. XPath - Fallback
   - Last resort for complex elements
   - Example: /html/body/div[1]/form/input[2]
```

**`extractFieldName(element)`**
- Extracts human-readable field name from element
- Tries multiple sources in priority order

**Field Name Extraction Priority:**

```javascript
1. aria-label attribute
   → Most explicit labeling

2. aria-labelledby (resolve reference)
   → Linked label element

3. placeholder attribute
   → Inline hint text

4. name attribute
   → Form field identifier

5. id attribute
   → Element identifier

6. Associated <label> element
   → Via for= attribute or parent

7. title attribute
   → Tooltip text

8. Text content
   → For buttons, links

9. data-testid attribute
   → Test identifier
```

**`isUniqueSelector(selector, element)`**
- Validates that selector matches exactly one element
- Ensures selector reliability

#### Usage Example

```javascript
import { SelectorEngine } from './selector.js';

const engine = new SelectorEngine();
const element = document.querySelector('input[type="email"]');

// Generate selector
const selector = engine.generateSelector(element);
console.log(selector);
// Output: {
//   css: 'input[name="email"]',
//   text: 'user@example.com',
//   role: 'input'
// }

// Extract field name
const fieldName = engine.extractFieldName(element);
console.log(fieldName);
// Output: "Email Address" (from associated label)
```

### 2. Content Script (`src/content.js`)

Captures user interactions and sends data to background script.

#### Event Handlers

**Click Events** (`handleClick`)
- Captures all click events
- Extracts: element, selector, field name
- Highlights captured element
- Action type: 'click'

**Input Events** (`handleInput`)
- Captures typing in text fields
- Debounced (500ms delay)
- Redacts sensitive values
- Action type: 'type'

**Change Events** (`handleChange`)
- Captures: select, checkbox, radio changes
- Action types: 'select', 'check', 'select_radio'
- Records selected values

**Submit Events** (`handleSubmit`)
- Captures form submissions
- Records form identifier
- Action type: 'submit'

**Navigation** (`captureNavigation`)
- Detects URL changes (polling every 1 second)
- Records page navigation
- Action type: 'navigate'

#### Visual Feedback

**Highlight Overlay**
- Red border on captured elements
- Semi-transparent background
- Auto-removes after 1 second
- Fixed positioning (stays in viewport)

**Recording Indicator**
- Fixed position (top-right corner)
- Pulsing red dot when recording
- Orange when paused
- Removed when stopped

### 3. Background Service Worker (`src/background.js`)

Manages application state and coordinates components.

#### State Machine

```
IDLE
  ↓ startRecording()
RECORDING
  ↓ pauseRecording()
PAUSED
  ↓ resumeRecording()
RECORDING
  ↓ stopRecording()
IDLE
  ↓ exportSession()
EXPORTING → IDLE
```

#### Message Handlers

- `startRecording`: Create session, enable recording
- `pauseRecording`: Pause without losing state
- `resumeRecording`: Continue recording
- `stopRecording`: End session, clear state
- `addStep`: Store captured step
- `getState`: Return current state
- `exportSession`: Generate and download export file
- `getAllSessions`: Retrieve session list
- `getSessionSteps`: Get steps for session

#### Data Flow

```
User Action (Page)
  ↓
Content Script (Capture)
  ↓
Message to Background
  ↓
Background (Process & Store)
  ↓
IndexedDB (Persist)
  ↓
Export (Generate File)
  ↓
Download
```

### 4. Storage Manager (`src/storage.js`)

IndexedDB wrapper for persistent storage.

#### Schema

**Sessions Store**
```javascript
{
  sessionId: string (primary key),
  createdAt: string (ISO date),
  env: {
    url: string,
    title: string,
    ua: string,
    viewport: { width, height }
  },
  stepCount: number
}
```

**Steps Store**
```javascript
{
  id: string (primary key),
  sessionId: string (indexed),
  timestamp: string (ISO date, indexed),
  action: string,
  selector: {
    css: string,
    xpath: string,
    text: string,
    role: string
  },
  fieldName: string,
  targetLabel: string,
  value: string,
  url: string,
  isSensitive: boolean,
  notes: string
}
```

**Assets Store** (for future screenshot support)
```javascript
{
  id: string (primary key),
  sessionId: string (indexed),
  type: 'screenshot',
  data: blob,
  metadata: object
}
```

### 5. Privacy Redactor (`src/redactor.js`)

Filters and masks sensitive information.

#### Sensitive Patterns

```javascript
- password, passwd, pwd
- secret, token
- api-key, api_key
- auth, authorization
- credit-card, credit_card
- cvv, cvc
- ssn, social-security
```

#### Masking Rules

**Password Fields**
```javascript
type="password" → '••••••••'
```

**Email Addresses**
```javascript
'user@example.com' → 'us***@example.com'
```

**Phone Numbers**
```javascript
'123-456-7890' → '***-***-****'
```

**Credit Cards**
```javascript
'4532 1234 5678 9010' → '**** **** **** ****'
```

#### Methods

**`shouldIgnoreField(element)`**
- Returns true if field should be redacted
- Checks: type, data-sensitive, name/id patterns

**`maskValue(value, element)`**
- Applies appropriate masking
- Returns masked string

### 6. Export Module (`src/export.js`)

Transforms session data into exportable formats.

#### JSON Export

Complete structured data with all metadata:

```json
{
  "session": {
    "id": "uuid",
    "createdAt": "ISO date",
    "environment": { url, title, ua, viewport },
    "stepCount": number
  },
  "steps": [
    {
      "stepNumber": number,
      "timestamp": "ISO date",
      "action": "click|type|select|check|submit|navigate",
      "fieldName": "string",
      "selector": { css, xpath, text, role },
      "value": "string",
      "url": "string",
      "notes": "string"
    }
  ]
}
```

#### CSV Export

Tabular format for spreadsheet import:

```csv
"Step","Timestamp","Action","Field Name","Selector (CSS)","Selector (XPath)","Text Content","Value","URL","Notes"
```

#### Markdown Export

Human-readable documentation:

```markdown
# Test Recording Session

**Session ID:** ...
**Created:** ...

## Steps

### Step 1: click
- **Field Name:** ...
- **Selector (CSS):** `...`
```

## Step Data Structure

Each recorded step contains:

```javascript
{
  id: 'uuid',                    // Unique step ID
  sessionId: 'uuid',             // Parent session ID
  timestamp: '2025-01-15T...',   // ISO timestamp
  action: 'click',               // Action type
  selector: {
    css: '#login-btn',           // CSS selector
    xpath: '//*[@id="..."]',     // XPath (optional)
    text: 'Login',               // Element text
    role: 'button'               // Element role
  },
  fieldName: 'Login Button',     // Extracted field name
  targetLabel: 'Login',          // Visible text
  value: null,                   // Input value (if applicable)
  url: 'https://...',            // Page URL
  isSensitive: false,            // Privacy flag
  notes: ''                      // User notes (optional)
}
```

## Message Protocol

### Background → Content

```javascript
// Start recording
{ action: 'startRecording', sessionId: 'uuid' }

// Pause recording
{ action: 'pauseRecording' }

// Resume recording
{ action: 'resumeRecording' }

// Stop recording
{ action: 'stopRecording' }
```

### Content → Background

```javascript
// Add step
{
  action: 'addStep',
  stepData: {
    action: string,
    selector: object,
    fieldName: string,
    targetLabel: string,
    value: string,
    url: string,
    isSensitive: boolean
  }
}
```

### Popup ↔ Background

```javascript
// Get current state
{ action: 'getState' }
→ { state: 'idle|recording|paused', session: object, stepCount: number }

// Export session
{ action: 'exportSession', sessionId: 'uuid', format: 'json|csv|markdown' }
→ { success: boolean, filename: string }

// Get all sessions
{ action: 'getAllSessions' }
→ { success: boolean, sessions: array }

// Get session steps
{ action: 'getSessionSteps', sessionId: 'uuid' }
→ { success: boolean, steps: array }
```

## Field Name & Locator Extraction Examples

### Example 1: Login Form

**HTML:**
```html
<form id="login-form">
  <label for="username">Username:</label>
  <input id="username" name="username" type="text" placeholder="Enter username">
  
  <label for="password">Password:</label>
  <input id="password" name="password" type="password">
  
  <button type="submit">Login</button>
</form>
```

**Extracted Data:**

```javascript
// Username field
{
  fieldName: "Username:",           // From <label>
  selector: {
    css: "#username",               // ID selector (score: 100)
    text: "",
    role: "input"
  }
}

// Password field
{
  fieldName: "Password:",           // From <label>
  selector: {
    css: "#password",               // ID selector
    text: "",
    role: "input"
  },
  value: "••••••••",               // Masked (sensitive)
  isSensitive: true
}

// Submit button
{
  fieldName: "Login",               // From text content
  selector: {
    css: "button[type='submit']",   // Type selector
    text: "Login",
    role: "button"
  }
}
```

### Example 2: Registration Form

**HTML:**
```html
<input type="email" 
       name="email" 
       placeholder="Email address" 
       aria-label="Your email">
       
<input type="tel" 
       name="phone" 
       placeholder="Phone number">
       
<select name="country">
  <option>United States</option>
  <option>Canada</option>
</select>
```

**Extracted Data:**

```javascript
// Email field
{
  fieldName: "Your email",          // From aria-label (priority 1)
  selector: {
    css: "input[name='email']",     // Name selector (score: 90)
    text: "",
    role: "input"
  }
}

// Phone field
{
  fieldName: "Phone number",        // From placeholder (priority 3)
  selector: {
    css: "input[name='phone']",
    text: "",
    role: "input"
  },
  value: "***-***-****"             // Masked phone number
}

// Country select
{
  fieldName: "country",             // From name attribute (priority 4)
  selector: {
    css: "select[name='country']",
    text: "",
    role: "select"
  },
  value: "United States"            // Selected option text
}
```

### Example 3: Dynamic UI (data-testid)

**HTML:**
```html
<button data-testid="add-to-cart-btn" 
        class="btn btn-primary btn-lg">
  Add to Cart
</button>

<div data-testid="product-price" class="price">
  $29.99
</div>
```

**Extracted Data:**

```javascript
// Add to cart button
{
  fieldName: "Add to Cart",                    // From text content
  selector: {
    css: "[data-testid='add-to-cart-btn']",   // data-testid (score: 95)
    text: "Add to Cart",
    role: "button"
  }
}

// Product price (if clicked)
{
  fieldName: "$29.99",                         // From text content
  selector: {
    css: "[data-testid='product-price']",
    text: "$29.99",
    role: "div"
  }
}
```

## Best Practices

### For Developers Using TestSnapper

1. **Use Semantic HTML**
   - Add `data-testid` attributes for stable selectors
   - Use proper `<label>` elements for inputs
   - Include `aria-label` for accessible names

2. **Avoid Dynamic Classes**
   - Classes like `ng-xxx`, `is-xxx`, `has-xxx` are filtered
   - Use stable identifiers (id, name, data-testid)

3. **Test in Real Scenarios**
   - Record actual user workflows
   - Verify selectors work after page reloads
   - Check for selector uniqueness

### For QA Testers

1. **Review Extracted Names**
   - Verify field names are meaningful
   - Add notes for clarification if needed
   - Export in multiple formats for different audiences

2. **Privacy Awareness**
   - TestSnapper automatically masks passwords
   - Review exports before sharing
   - Sensitive data stays local

3. **Session Management**
   - Use descriptive session names (future feature)
   - Export sessions regularly
   - Clean up old sessions

## Troubleshooting

### Selector Not Unique

**Problem**: Generated selector matches multiple elements

**Solution**: 
- Add `data-testid` to target element
- Ensure IDs are unique
- Check for duplicate name attributes

### Field Name Extraction Fails

**Problem**: Field name shows generic values like "input" or "div"

**Solution**:
- Add proper `<label>` elements
- Include `aria-label` attributes
- Use meaningful placeholder text

### Privacy Masking Too Aggressive

**Problem**: Non-sensitive fields are being masked

**Solution**:
- Avoid sensitive keywords in field names (password, token, etc.)
- Use specific field types
- Review `redactor.js` patterns

### Steps Not Being Captured

**Problem**: Interactions not recorded

**Solution**:
- Ensure recording is started
- Check if elements are inside iframes (not supported)
- Verify elements are interactable (not disabled)
- Look for JavaScript event listeners preventing defaults

## Performance Considerations

### Input Debouncing

Input events are debounced with a 500ms delay to avoid capturing every keystroke:

```javascript
clearTimeout(element._inputTimeout);
element._inputTimeout = setTimeout(() => {
  sendStepToBackground(stepData);
}, 500);
```

### Selector Validation

Selector uniqueness is validated on capture, not on replay. This ensures:
- Fast capture performance
- Accurate selector scoring
- No page slowdown during recording

### Storage Optimization

- IndexedDB for efficient local storage
- Steps stored individually for incremental updates
- Sessions loaded on-demand in popup

## Extension Permissions

Required permissions and their purposes:

- **storage**: IndexedDB for session data
- **downloads**: Export file downloads
- **scripting**: Inject content scripts
- **activeTab**: Access current tab for recording
- **tabs**: Get tab info (URL, title)
- **host_permissions**: Access web pages for event capture

## Future Enhancements

Based on the architecture document, potential improvements:

1. **Screenshot Capture**
   - Capture visible tab for each step
   - Crop to element bounds
   - Store in IndexedDB assets

2. **Step Editing**
   - Edit field names inline
   - Reorder steps
   - Add custom notes
   - Delete steps

3. **Import/Export Sessions**
   - Import previously exported sessions
   - Edit and re-export
   - Merge sessions

4. **Browser Compatibility**
   - Firefox support (MV3 polyfill)
   - Edge support
   - Safari (if API available)

5. **Advanced Selectors**
   - Shadow DOM support
   - iframe traversal
   - Dynamic content detection

6. **Collaboration**
   - Share sessions via URL
   - Export as HTML bundle
   - Embed playback viewer

## Version History

**v1.1.0** (Current)
- Initial implementation
- Field name & locator extraction
- Multiple export formats
- Privacy redaction
- Session management
- No AI features (as requested)

---

**Last Updated**: January 2025
