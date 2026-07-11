# TestSnapper Quick Start Guide

**Get recording UI tests in 5 minutes.** This guide gets you from zero to your first exported test case with screenshots and auto-generated selectors.

---

## 🚀 Installation (2 minutes)

### Step 1: Build the Extension
```bash
npm install
npm run setup        # First time only
npm run build        # Creates dist/ folder
```

### Step 2: Load in Chrome
1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `dist/` folder from your project
5. Pin the TestSnapper icon to your toolbar

**Done!** The extension icon appears in your Chrome toolbar.

---

## 🎬 Your First Recording (3 minutes)

### Start Recording
1. Click the TestSnapper icon in your toolbar
2. Click the **Start Recording** button
3. The indicator turns **red** — you're recording!

### Interact with Your Application
Navigate to any website and perform actions:
- **Click** buttons, links, or elements
- **Type** into input fields (you'll be prompted to name each field)
- **Select** from dropdowns
- **Check/uncheck** checkboxes or radio buttons
- **Navigate** to different pages
- **Capture screenshots** manually or enable auto-capture

### Stop and Review
1. Click the TestSnapper icon
2. Click **Stop Recording**
3. Click **View Steps** to see your recorded session

**Result:** A complete test case with automated selectors, field names, and screenshots.

---

## ⌨️ Keyboard Shortcuts

| Action | Shortcut | Context |
|--------|----------|---------|
| **Take Screenshot** | `Ctrl+Shift+S` (Windows/Linux)<br>`Cmd+Shift+S` (Mac) | During recording |
| **Pause Recording** | Click popup button | Any time |
| **Theme Toggle** | Moon/Sun icon | Review page |

---

## 💼 Common Use Cases

### 1. Bug Reports
**Scenario:** Developer needs to report a login bug

1. Start recording
2. Navigate to login page
3. Enter invalid credentials
4. Capture screenshot of error message (`Ctrl+Shift+S`)
5. Stop recording
6. Export as **DOCX** with screenshots
7. Attach to bug tracker

**Time saved:** 10-15 minutes per bug report

---

### 2. Test Case Documentation
**Scenario:** QA needs to document regression tests

1. Start recording
2. Execute test flow (e.g., checkout process)
3. Enable **Auto Screenshot** (Settings → every 3 seconds)
4. Stop recording
5. Review steps, add descriptions where needed
6. Export as **Markdown** or **PDF**
7. Store in test documentation repository

**Benefit:** Automated selector generation eliminates manual XPath/CSS creation

---

### 3. Training & Onboarding
**Scenario:** Train new team members on complex workflows

1. Record the workflow once with clear field names
2. Export as **PDF** with full-width screenshots
3. Share with team as visual guide

**Result:** Self-documenting tutorials with real UI screenshots

---

### 4. Test Automation Scripts
**Scenario:** Generate Selenium/Playwright selectors

1. Record user flow
2. Export as **JSON**
3. Use the `selector` and `xpath` fields in automation code:

```javascript
// From exported JSON
{
  "action": "click",
  "selector": "button[data-testid='submit-btn']",
  "xpath": "//button[@data-testid='submit-btn']"
}
```

**Benefit:** Multi-strategy selectors (ID, data-testid, ARIA, XPath, framework-specific) for resilient automation

---

## ⚙️ Essential Settings

Access settings from the popup:

| Setting | Purpose | Recommended |
|---------|---------|-------------|
| **Auto Screenshot** | Capture screenshots at intervals | **ON** for testing, **OFF** for automation |
| **Screenshot Interval** | Time between auto captures | **3-5 seconds** |
| **Privacy Mode** | Redact sensitive data | **ON** for demos with real data |
| **Field Name Prompts** | Ask for input field names | **ON** for readable test cases |

---

## 🎨 Theme Toggle

TestSnapper offers two distinct themes:

### Professional Light Mode
- **Purpose:** Age-friendly, accessible design (WCAG AAA)
- **Colors:** Refined blue (#4f7cbb), high contrast (13.8:1)
- **Best for:** Client presentations, enterprise documentation, users 50+ years
- **Toggle:** Click sun icon (top-right in Review page)

### Terminal Dark Mode
- **Purpose:** Developer-focused aesthetic
- **Colors:** Neon cyan (#00ffcc), sharp corners, scanline overlay
- **Best for:** Late-night testing, developer workflows
- **Toggle:** Click moon icon (top-right in Review page)

Both themes persist across sessions via `chrome.storage.local`.

---

## 📤 Export Formats Guide

| Format | Best For | Features |
|--------|----------|----------|
| **DOCX** | Bug reports, test documentation | Full-width screenshots (1200px), professional layout, editable in Word |
| **PDF** | Archival, compliance, sharing | Non-editable, universal compatibility |
| **Markdown** | GitHub issues, wikis, READMEs | Code-friendly, version control compatible |
| **JSON** | Test automation, data analysis | Complete data with selectors, XPaths, framework-specific attributes |
| **CSV** | Excel analysis, filtering | Spreadsheet-friendly, import into tools |

### Export Options
- **Include Screenshots:** Toggle in export dialog
- **GZIP Compression:** Automatic for step data (40-60% size reduction)
- **Cancellation:** Cancel long exports mid-process

---

## 🔒 Privacy & Security

### Data Storage
- **Location:** Local only (`chrome.storage.local`)
- **No cloud sync:** All data stays on your machine
- **Permissions:** Extension requires `unlimitedStorage` for screenshot data

### Sensitive Data Redaction
Enable **Privacy Mode** in settings to:
- Redact password fields (shown as `••••••••`)
- Mask credit card numbers
- Hide email addresses
- Obfuscate phone numbers

### Manual Cleanup
- Delete individual sessions from Export tab
- Delete individual steps from Review page
- Clear all data: Chrome → Extensions → TestSnapper → Remove

---

## ⚠️ Troubleshooting

### 1. No steps are being recorded
**Cause:** Content scripts not injected

**Solution:**
- Reload the page after starting recording
- Check if the page is an extension page or chrome:// URL (not supported)
- Verify extension is enabled in `chrome://extensions`

---

### 2. Field name modal not appearing
**Cause:** Modal queue system blocked

**Solution:**
- Check browser console for errors
- Ensure "Field Name Prompts" is enabled in settings
- Reload page and try again

---

### 3. Screenshots are blank
**Cause:** CSP or DRM restrictions on page

**Solution:**
- Test on a different domain (e.g., https://example.com)
- Disable DRM on Netflix/Spotify pages
- Use manual screenshot (`Ctrl+Shift+S`) instead of auto

---

### 4. Export fails with "Quota Exceeded"
**Cause:** Too many sessions with screenshots

**Solution:**
- Delete old sessions from Export tab
- Disable auto-screenshots for long recordings
- Export without screenshots (toggle off in export dialog)

---

### 5. DOCX export shows "fallback mode"
**Cause:** Libraries not loaded or CSP blocked CDN

**Solution:**
- Ensure `npm run setup-libs` was run during build
- Check `dist/libs/docx.min.js` exists
- Fallback mode creates valid DOCX manually (no quality loss)

---

## 💡 Pro Tips

### 1. Use Descriptive Field Names
When prompted for input field names, use clear descriptions:
- ✅ "Email Address"
- ✅ "Billing ZIP Code"
- ❌ "input1"
- ❌ "field"

**Why:** Makes exported test cases readable without context

---

### 2. Pause Recording for Setup
If you need to prepare data or navigate privately:
1. Click **Pause**
2. Perform setup actions
3. Click **Resume**

**Result:** Cleaner test cases without noise

---

### 3. Leverage Auto-Screenshots
Enable auto-screenshots with 3-5 second intervals for:
- Visual regression testing
- Step-by-step tutorials
- Bug reports with state changes

**Avoid:** Very long recordings (quota limits)

---

### 4. Reorder Steps with Drag-and-Drop
The Review page supports drag-and-drop reordering:
1. Open **View Steps**
2. Drag steps using the `⋮⋮` handle
3. Changes save automatically

**Use case:** Reorganize out-of-order manual screenshots

---

### 5. Bulk Delete Unwanted Steps
Select multiple steps in Review page:
1. Check boxes next to steps
2. Click **Delete Selection** (top header)
3. Confirm deletion

**Faster than:** Deleting steps one-by-one

---

### 6. Use JSON Export for Automation
Export to JSON and parse selectors programmatically:

```javascript
// Example: Convert to Playwright
const steps = require('./testsnapper-export.json').steps;
steps.forEach(step => {
  if (step.action === 'click') {
    console.log(`await page.click('${step.selector}')`);
  }
});
```

---

### 7. Name Your Sessions
During export, the filename includes:
- Session date/time
- Export format
- Timestamp

**Tip:** Create sessions for specific features (e.g., "Login Flow", "Checkout Process") by recording focused workflows

---

## 📋 Quick Reference Card

```
╔══════════════════════════════════════════════════════════╗
║              TESTSNAPPER QUICK REFERENCE                 ║
╠══════════════════════════════════════════════════════════╣
║  START        → Click icon → Start Recording             ║
║  PAUSE        → Click icon → Pause                       ║
║  SCREENSHOT   → Ctrl+Shift+S (Cmd+Shift+S on Mac)        ║
║  STOP         → Click icon → Stop Recording              ║
║  REVIEW       → Popup → View Steps                       ║
║  EXPORT       → Popup → Export tab → Choose format       ║
║  THEME        → Review page → Moon/Sun icon (top-right)  ║
║  DELETE       → Export tab → Select session → Delete     ║
╠══════════════════════════════════════════════════════════╣
║  SUPPORTED ACTIONS:                                      ║
║    • Click            • Type          • Select           ║
║    • Checkbox         • Radio         • Navigate         ║
║    • Screenshot       • Redaction                        ║
╠══════════════════════════════════════════════════════════╣
║  EXPORT FORMATS:                                         ║
║    DOCX   → Bug reports, test docs                       ║
║    PDF    → Archival, compliance                         ║
║    JSON   → Automation, analysis                         ║
║    CSV    → Excel, filtering                             ║
║    MD     → GitHub, wikis                                ║
╠══════════════════════════════════════════════════════════╣
║  SELECTORS GENERATED:                                    ║
║    ID, data-testid, name, ARIA, placeholder,             ║
║    React/Vue/Angular/Svelte/Solid, CSS, XPath            ║
╚══════════════════════════════════════════════════════════╝
```

---

## 🔗 Additional Resources

- **Full Documentation:** [README.md](README.md)
- **Architecture:** README.md → Architecture Section
- **Contributing:** GitHub Issues

---

## ✅ What's Next?

You're now ready to record professional UI tests. Here's what to try:

1. **Record a complex workflow** (5+ steps) with auto-screenshots
2. **Export to DOCX** and review the professional formatting
3. **Try both themes** (light for presentations, dark for dev work)
4. **Use JSON export** to generate automation selectors
5. **Enable Privacy Mode** if working with sensitive data

**Questions?** Check [README.md](README.md) for comprehensive documentation.

---

**TestSnapper v1.1.3** — Professional UI Test Recording for Chrome
Built with Manifest V3 | MIT License | Made with ❤️ for QA Engineers
