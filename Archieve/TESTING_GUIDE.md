# TestSnapper v1.0 - Installation and Testing Guide

## Quick Installation Steps

1. **Enable Developer Mode in Chrome**:
   - Open Chrome and navigate to `chrome://extensions/`
   - Toggle "Developer mode" ON (top-right corner)

2. **Load the Extension**:
   - Click "Load unpacked" button
   - Select the `/app/testsnapper-extension` folder
   - Click "Select Folder"

3. **Verify Installation**:
   - TestSnapper icon should appear in Chrome toolbar
   - Extension should be listed as "TestSnapper v1.0" in extensions page

## Test Scenario Walkthrough

### Step 1: Start Recording
1. Click the TestSnapper icon in toolbar
2. Click "Start Recording" button
3. Popup closes and recording begins (red indicator when reopened)

### Step 2: Perform Test Interactions
Open `/app/testsnapper-extension/demo.html` in browser and:

**Form Testing**:
- Fill out the contact form with various inputs
- Test password field (should be redacted)
- Select dropdown options
- Check/uncheck checkboxes
- Submit the form

**Button Interactions**:
- Click "Show Alert" button
- Click "Change Background" multiple times
- Click "Add List Item" several times
- Toggle section visibility

**Network Error Testing**:
- Click "Trigger 404 Error" button
- Click "Trigger 500 Error" button  
- Click "Trigger Timeout" button
- Click "Successful Request" for comparison

**Navigation & Scrolling**:
- Click navigation links (smooth scrolling)
- Scroll within the scrollable content section
- Hover over the colored boxes

### Step 3: Stop Recording
1. Click TestSnapper icon again
2. Click "Stop Recording" button
3. Session is automatically saved

### Step 4: View Session Data
1. Click "Sessions" tab in extension popup
2. Review recorded session with:
   - Session name and timestamp
   - Number of interactions captured
   - Duration of recording
   - Network error count (if any)

### Step 5: Export Session
1. Click "Export" button next to a session
2. Download `.txt` file with detailed log
3. Review exported content containing:
   - Step-by-step interactions with selectors
   - Timestamps and metadata
   - Network errors (4xx/5xx) with URLs and status codes
   - Browser and system information

### Step 6: Test Settings
1. Click "Settings" tab
2. Modify configuration options:
   - Toggle auto-screenshot setting
   - Change screenshot quality
   - Update data redaction patterns
   - Enable/disable dark mode
3. Click "Save Settings"

## Expected Export Format Example

```
TestSnapper Session Export
Session: Session 1/20/2025, 2:30:15 PM
URL: file:///app/testsnapper-extension/demo.html
Date: 1/20/2025, 2:30:15 PM
Duration: 45s

Metadata:
Browser: Chrome
Version: Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36...
OS: Linux x86_64

Recorded Interactions:
1. [2s] CLICK "input#name" value: "John Doe" at file:///app/testsnapper-extension/demo.html
2. [5s] INPUT "input#email" value: "john@example.com" at file:///app/testsnapper-extension/demo.html
3. [8s] INPUT "input#password" value: "[REDACTED]" at file:///app/testsnapper-extension/demo.html
4. [12s] CLICK "button[onclick="trigger404()"]" text: "Trigger 404 Error" at file:///app/testsnapper-extension/demo.html
5. [15s] SCROLL scrollY: 150 at file:///app/testsnapper-extension/demo.html

Failed Network Calls:
1. GET https://httpstat.us/404 - Status: 404 
2. GET https://httpstat.us/500 - Status: 500
```

## Troubleshooting Common Issues

**Extension Not Loading**:
- Ensure all files are in `/app/testsnapper-extension/` directory
- Check that manifest.json is valid
- Look for errors in Chrome extension console

**Recording Not Working**:
- Refresh the web page after installing extension
- Check browser console for JavaScript errors
- Ensure content script permissions are granted

**Network Tracking Issues**:
- Some requests may be blocked by CORS
- Test with different websites
- Check background script console for errors

**Export Not Working**:
- Disable popup blockers
- Check browser download permissions
- Ensure sufficient storage space

## Success Criteria Verification

✅ **UI Interaction Recording**: All clicks, inputs, navigation captured with accurate selectors
✅ **Network Error Tracking**: 4xx/5xx HTTP errors detected and logged  
✅ **Session Management**: Sessions saved locally, viewable, and deletable
✅ **Export Functionality**: .txt files generated with structured interaction data
✅ **Settings Configuration**: User preferences saved and applied
✅ **Chrome Compatibility**: Works with Chrome v126+ and Manifest V3
✅ **Privacy Compliance**: All data stored locally, no external transmissions
✅ **Performance**: Minimal impact on page load and interaction responsiveness

## Next Development Phase

The foundation is ready for implementing:
- Screenshot capture with html2canvas
- Annotation tools (arrows, highlights, blur, text)
- .har file export for network data
- Enhanced session search and filtering
- Project-based organization

The current MVP provides complete QA recording functionality for the first two priority features, with a robust architecture ready for feature expansion.