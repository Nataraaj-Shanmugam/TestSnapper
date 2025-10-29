# TestSnapper - Quick Start Guide

## Installation Steps

### 1. Open Chrome Extensions Page
- Open Google Chrome
- Navigate to `chrome://extensions/`
- Or click Menu (⋮) → More Tools → Extensions

### 2. Enable Developer Mode
- Look for "Developer mode" toggle in the top-right corner
- Click to enable it

### 3. Load the Extension
- Click "Load unpacked" button (appears after enabling developer mode)
- Navigate to and select the `/app` folder (where manifest.json is located)
- Click "Select Folder"

### 4. Verify Installation
- You should see "TestSnapper" in your extensions list
- The TestSnapper icon should appear in your Chrome toolbar
- If you don't see the icon, click the puzzle piece icon and pin TestSnapper

## First Recording

### Step 1: Open Demo Page
- Open the included `demo.html` file in Chrome
- Or navigate to any website you want to test

### Step 2: Start Recording
1. Click the TestSnapper extension icon in your toolbar
2. Click "Start Recording" button
3. You'll see:
   - Red "RECORDING" indicator on the page (top-right)
   - Extension badge shows "REC"
   - Step count shows "0"

### Step 3: Interact with the Page
Try these interactions on the demo page:
- ✅ Click buttons and links
- ✅ Type into text fields
- ✅ Select options from dropdowns
- ✅ Check/uncheck checkboxes
- ✅ Select radio buttons
- ✅ Submit forms

**Visual Feedback:**
- Elements flash red when captured
- Step count increases in the popup
- Recording indicator pulses

### Step 4: Stop Recording
1. Click the TestSnapper icon again
2. Click "Stop" button
3. Recording indicator disappears
4. Your session is saved!

### Step 5: Export Your Recording
1. In the popup, select your session from the dropdown
   - Shows date, time, and step count
2. Choose export format:
   - **JSON**: Complete structured data
   - **CSV**: Spreadsheet format
   - **Markdown**: Documentation format
3. Click "Export Session"
4. Choose where to save the file
5. Done! 🎉

## Understanding the Export

### Field Names Extracted From:
1. ✅ `aria-label` attribute
2. ✅ Associated `<label>` element
3. ✅ `placeholder` attribute
4. ✅ `name` attribute
5. ✅ `id` attribute
6. ✅ Text content (for buttons)

### Selectors Generated (Priority Order):
1. ✅ `#id` - ID selector (most stable)
2. ✅ `[data-testid="..."]` - Test ID
3. ✅ `input[name="..."]` - Name attribute
4. ✅ `[aria-label="..."]` - Aria label
5. ✅ `.class` - Class selector
6. ✅ `:nth-of-type()` - Position-based
7. ✅ XPath - Fallback

### Example Export (JSON):

```json
{
  "session": {
    "id": "abc123...",
    "createdAt": "2025-01-15T10:30:00.000Z",
    "stepCount": 3
  },
  "steps": [
    {
      "stepNumber": 1,
      "action": "type",
      "fieldName": "Username:",
      "selector": {
        "css": "#username",
        "text": "",
        "role": "input"
      },
      "value": "testuser"
    },
    {
      "stepNumber": 2,
      "action": "type",
      "fieldName": "Password:",
      "selector": {
        "css": "#password",
        "text": "",
        "role": "input"
      },
      "value": "••••••••",
      "isSensitive": true
    },
    {
      "stepNumber": 3,
      "action": "click",
      "fieldName": "Submit Form",
      "selector": {
        "css": "[data-testid='submit-button']",
        "text": "Submit Form",
        "role": "button"
      }
    }
  ]
}
```

## Key Features Demonstrated

### 1. Field Name Extraction ✅
- **What it does**: Automatically finds the human-readable name for each field
- **How**: Checks labels, placeholders, aria-labels, and more
- **Example**: Input with `<label>Username:</label>` → Field name: "Username:"

### 2. CSS Selector Generation ✅
- **What it does**: Creates stable, unique selectors for each element
- **How**: Prioritizes ID, data-testid, name, then fallback options
- **Example**: `<input id="email">` → Selector: `#email`

### 3. Privacy Protection ✅
- **What it does**: Automatically masks sensitive data
- **Fields masked**: passwords, tokens, emails, phone numbers
- **Example**: Password "secret123" → Stored as "••••••••"

### 4. Multiple Export Formats ✅
- **JSON**: Full data structure for automation
- **CSV**: Import into Excel/Google Sheets
- **Markdown**: Human-readable documentation

## Tips for Best Results

### For Recording
1. ✅ **Go slow**: Give each action a moment to register
2. ✅ **Be deliberate**: Clear, distinct actions work best
3. ✅ **Complete workflows**: Record entire user journeys
4. ✅ **Use meaningful IDs**: Elements with IDs get better selectors

### For Developers
1. ✅ **Add data-testid**: Most stable selectors
2. ✅ **Use semantic HTML**: Proper labels and aria attributes
3. ✅ **Avoid dynamic classes**: Use stable identifiers
4. ✅ **Test after recording**: Verify selectors still work

### For QA Testers
1. ✅ **Export regularly**: Don't lose your recordings
2. ✅ **Review field names**: Ensure they're meaningful
3. ✅ **Try multiple formats**: Different audiences prefer different formats
4. ✅ **Add notes**: Document edge cases (future feature)

## Troubleshooting

### Extension Not Appearing
**Problem**: Can't see TestSnapper icon

**Solution**:
1. Check `chrome://extensions/` - is it installed?
2. Look for puzzle piece icon (🧩) in toolbar
3. Click puzzle piece and pin TestSnapper
4. Refresh the page you're testing

### Recording Not Starting
**Problem**: Clicking "Start Recording" doesn't work

**Solution**:
1. Refresh the webpage
2. Check console for errors (F12)
3. Verify extension has permissions
4. Make sure you're not on `chrome://` pages (not allowed)

### Elements Not Captured
**Problem**: Some clicks/inputs aren't recorded

**Solution**:
1. Check if element is visible and interactable
2. Try clicking slower (debounce delay)
3. iframes not supported (limitation)
4. Shadow DOM limited support

### Export File Empty
**Problem**: Downloaded file has no steps

**Solution**:
1. Verify you recorded some interactions
2. Check step count in popup (should be > 0)
3. Try different export format
4. Check browser console for errors

## File Locations

After installation, here's what you'll find:

```
/app/
├── manifest.json              # Extension configuration
├── README.md                  # Full documentation
├── IMPLEMENTATION.md          # Technical details
├── demo.html                  # Test page
├── QUICK_START.md            # This file
└── src/
    ├── background.js          # State management
    ├── content.js             # Event capture
    ├── popup.js               # UI controls
    ├── selector.js            # Field name & selector extraction ⭐
    ├── redactor.js            # Privacy protection
    ├── storage.js             # Data persistence
    ├── export.js              # Export formats
    ├── injected.js            # DOM helpers
    └── assets/
        ├── html/popup.html    # Extension popup
        ├── css/popup.css      # Popup styling
        └── icons/             # Extension icons
```

## Common Use Cases

### 1. Bug Reporting
**Goal**: Document steps to reproduce a bug

**Steps**:
1. Start recording
2. Reproduce the bug
3. Stop recording
4. Export as Markdown
5. Attach to bug report

**Result**: Clear, step-by-step reproduction with exact selectors

### 2. Test Case Documentation
**Goal**: Create automated test cases

**Steps**:
1. Record user flow
2. Export as JSON
3. Use selectors in test automation
4. Field names provide context

**Result**: Complete test data with selectors and field names

### 3. UI Walkthroughs
**Goal**: Document UI for training

**Steps**:
1. Record complete workflow
2. Export as Markdown
3. Share with team
4. Visual indicators help understanding

**Result**: Human-readable documentation

### 4. API Testing Preparation
**Goal**: Understand form fields for API testing

**Steps**:
1. Record form interaction
2. Export as CSV
3. View all field names and values
4. Map to API parameters

**Result**: Field mapping for API tests

## Next Steps

### Learn More
- 📖 Read full [README.md](README.md) for features and architecture
- 🔧 Check [IMPLEMENTATION.md](IMPLEMENTATION.md) for technical details
- 🧪 Try [demo.html](demo.html) for hands-on practice

### Customize
- Review `src/selector.js` to understand selector generation
- Modify `src/redactor.js` to adjust privacy patterns
- Customize export formats in `src/export.js`

### Contribute
- Report issues and suggestions
- Improve selector algorithms
- Add new export formats
- Enhance privacy protection

## Support

### Getting Help
1. Check README.md for full documentation
2. Review IMPLEMENTATION.md for technical details
3. Inspect browser console for errors
4. Try demo.html to verify installation

### Known Limitations
- ⚠️ No AI features (as requested)
- ⚠️ No iframe support (currently)
- ⚠️ Limited shadow DOM support
- ⚠️ SPA navigation polling (1 second)
- ⚠️ Desktop Chrome only (v88+)

## Success Checklist

Before you start using TestSnapper in production:

- ✅ Extension installed and icon visible
- ✅ Tested on demo.html successfully
- ✅ Recorded at least one session
- ✅ Exported in all three formats (JSON, CSV, Markdown)
- ✅ Verified field names are meaningful
- ✅ Checked selectors are stable
- ✅ Confirmed privacy masking works
- ✅ Reviewed exported data

**You're ready to go! 🚀**

---

**TestSnapper v1.1.0**  
*Field Name & Locator Extraction Without AI*

For questions or issues, refer to the full documentation in README.md and IMPLEMENTATION.md.
