# 📐 System Architecture Overview

TestSnapper is structured as a modular Chrome Extension with the following layers:

```
src/background/background.js       → Service worker (session engine, messaging, screenshot capture)
src/content/content.js             → DOM event listeners, step builder
src/content/selector.js            → Multi-strategy selector extraction
src/content/redactor.js            → Sensitive data masking
src/storage.js                     → IndexedDB storage layer
src/core/export-service.js         → Export engine (DOCX / JSON / CSV)
src/ui/popup/popup.js             → Popup event handling & UI state
src/ui/review/review-standalone.js → Session editor page logic
```

### High-Level Flow

```
Popup UI → Background → Content Scripts → Background → Storage → Export → Review UI
```

---

# 🔄 Recording Lifecycle

## 1. Start Recording

When the user clicks **Start** in the popup, popup.js sends:

```json
{ "action": "startRecording", "tabInfo": { "url": "...", "title": "...", "width": 1920, "height": 1080 } }
```

### Background actions:

* Create a new session
* Generate `sessionId`
* Initialize metadata (title, createdAt, step count)
* Set global state to `recording`

---

## 2. Content Script Activation

`content.js` attaches event listeners:

* `click`
* `input`
* `change`
* `keydown`
* Navigation events (`hashchange`, `popstate`, history API)

Each event is translated into a structured **Step Object**.

---

## 3. Step Construction (content.js)

Every recorded event becomes:

```json
{
  "id": "uuid",
  "type": "click | input | navigation | screenshot | manual | api",
  "timestamp": 1234567890,
  "selector": { ... },
  "fieldName": "Email",
  "value": "john@example.com",
  "meta": {},
  "screenshotId": null
}
```

### The step builder performs:

* Selector extraction (selector.js)
* Field name extraction
* Value redaction (redactor.js)
* Metadata attachment
* Transmission to background.js

---

# 🎯 Selector Engine (selector.js)

Selectors are generated using a **multi-strategy scoring model**.

### Strategy Priority

1. **ID selectors** (if stable and unique)
2. **Class selectors**
3. **`<label for>` association**
4. **Parent `<label>` wrapper detection**
5. **ARIA attributes** (`aria-label`, `aria-labelledby`)
6. **Placeholder-based selectors**
7. **Visible text selectors** (`button:contains("Submit")`)
8. **XPath fallback**
9. **Position-based CSS nth-child fallback**

### Output Example

```json
{
  "best": "input[name='email']",
  "all": {
    "css": "input[name='email']",
    "xpath": "//input[@name='email']",
    "text": "Email"
  }
}
```

---

# 🧬 Field Name Extraction Logic

Defined and refined from FIELD_NAMES_AND_LOCATORS.md.

### Priority Order

1. `<label for="id">Text</label>`
2. Parent `<label>` wrapping
3. `aria-label`
4. Placeholder attribute
5. `name` attribute
6. `id` attribute
7. Nearby text nodes
8. Fallback: `"Element"`

### Example

```html
<label for="email">Email Address</label>
<input id="email">
```

Extracted name:

```
Email Address
```

---

# 🧼 Redaction Layer (redactor.js)

To ensure no sensitive data leaks into storage or exports.

### Masked Categories

* Password fields
* Credit card numbers
* CVV / OTP patterns
* Financial numbers
* `input[type=password]`
* Regex-based PII patterns

### Example Transformation

```
Password123 → ************
4111 1111 1111 1111 → **** **** **** 1111
```

---

# 📸 Screenshot Capture

Screenshots are stored as **compressed Blobs** inside IndexedDB.

### Manual Screenshot

Triggered from popup:

```
chrome.tabs.captureVisibleTab()
```

Creates a `screenshot` step & asset.

### Auto Screenshot

Configured in popup settings:

* `autoScreenshot: true`
* `screenshotSeconds: X`

Background triggers screenshot at intervals during recording.

### Screenshot Asset Structure

```json
{
  "id": "uuid",
  "blob": "<binary>",
  "createdAt": 1234567
}
```

---

# 💾 Storage System (IndexedDB)

All persistent data goes through `storage.js`.

### Databases

* `sessions` → session metadata
* `steps:{sessionId}` → event steps
* `assets:{sessionId}` → screenshot blobs

### Step Model

```json
{
  "id": "uuid",
  "type": "click|input|navigation|screenshot|manual",
  "fieldName": "Username",
  "value": "John",
  "selector": { ... },
  "meta": {},
  "screenshotId": null
}
```

### Session Model

```json
{
  "sessionId": "uuid",
  "sessionName": "Login Flow",
  "createdAt": 12345678,
  "updatedAt": 12345999,
  "stepCount": 12
}
```

---

# 📤 Export Engine (export-service.js)

Supports **DOCX**, **CSV**, and **JSON**.

---

## JSON Export

* Raw dump of session + steps + selectors
* Perfect for replay systems or automation scripts

---

## CSV Export

Columns include:

* Step number
* Action type
* Field name
* Selector (best)
* Value (masked)

---

## DOCX Export

DOCX includes:

* Title page
* Steps in numbered format
* Screenshot blocks
* Compressed images (resized to ~500px)
* Session metadata

DOCX is generated through:

* `jspdf.umd.min.js` (embedded in web accessible resources)
* Canvas downscaling
* Blob embedding

---

# 🎨 Review UI (review-standalone.js)

A complete session editor rendered outside the popup.

### Features

* Step renaming & editing
* Inline editing
* Drag-and-drop reordering
* Insert step between existing steps
* Delete step
* Screenshot preview + toggle
* Screenshot replacement
* Session name editing
* Auto-save after edits

Supports large sessions with smooth scrolling & virtualization.

---

# 🗺 Roadmap

### Short-Term

* Playwright/Cypress code export
* Dark mode for review UI
* Screenshot diffing
* Better test grouping

### Long-Term

* Cloud sync for recorded sessions
* Multi-user team collaboration
* Versioned session history
* Video recording integration

---

# 🏁 End of Developer Guide

This file now contains the complete, clean, and updated `DEVELOPER_GUIDE.md` mapped directly to your current codebase.
