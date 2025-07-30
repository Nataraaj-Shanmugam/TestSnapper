# TestSnapper v1.0 - Chrome Extension for QA Session Recording

TestSnapper is a Chrome browser extension designed for QA professionals to record UI interactions, track network errors, and capture screenshots for bug reporting.

## Features

### ✅ Currently Implemented (MVP)
- **UI Interaction Recording**: Captures clicks, form inputs, navigation, scrolling, and hover events
- **Network Error Tracking**: Monitors and logs all 4xx/5xx HTTP errors
- **Session Management**: Save, organize, and manage recording sessions locally
- **Export Functionality**: Export sessions as .txt files with detailed interaction logs
- **Local Storage**: All data stored locally in IndexedDB (no cloud syncing)
- **Settings Panel**: Configure auto-screenshot, quality settings, and data redaction patterns

### 🚧 Planned Features (Future Versions)
- Screenshot capture with annotation tools (arrows, highlights, blur, text)
- .har file export for network calls
- Advanced search and filtering in sessions
- Project-based organization

## Installation Instructions

### Method 1: Load as Unpacked Extension (Developer Mode)

1. **Enable Developer Mode**:
   - Open Chrome and go to `chrome://extensions/`
   - Toggle on "Developer mode" in the top right corner

2. **Load the Extension**:
   - Click "Load unpacked" button
   - Navigate to the `/app/testsnapper-extension` folder
   - Select the folder and click "Select Folder"

3. **Verify Installation**:
   - The TestSnapper extension should appear in your extensions list
   - You should see the TestSnapper icon in your Chrome toolbar
   - The extension should show as "Unpacked" in the extensions page

### Method 2: Build and Install (if using build tools)

```bash
# Navigate to extension directory
cd /app/testsnapper-extension

# Install dependencies (if any)
yarn install

# Build the extension (if applicable)
yarn build

# Load the 'dist' folder as unpacked extension
```

## Usage Instructions

### Starting a Recording Session

1. **Open the Extension**:
   - Click the TestSnapper icon in your Chrome toolbar
   - The popup will show the recording panel

2. **Start Recording**:
   - Click "Start Recording" button
   - The extension will begin capturing UI interactions on the current tab
   - The popup will close automatically after starting

3. **Interact with the Web Page**:
   - All your clicks, form inputs, navigation, and scrolling will be recorded
   - Network errors (4xx/5xx responses) will be automatically tracked
   - A red recording indicator will show when you reopen the popup

4. **Stop Recording**:
   - Click the TestSnapper icon again to open the popup
   - Click "Stop Recording" button
   - Your session will be automatically saved

### Managing Sessions

1. **View Sessions**:
   - Open the extension popup
   - Click on the "Sessions" tab
   - You'll see a list of all recorded sessions with metadata

2. **Export Sessions**:
   - Click the "Export" button next to any session
   - A .txt file will be downloaded with detailed interaction logs
   - The file includes timestamps, selectors, and network error details

3. **Delete Sessions**:
   - Click the "Delete" button next to any session
   - Confirm the deletion in the popup dialog

### Configuring Settings

1. **Open Settings**:
   - Click on the "Settings" tab in the extension popup

2. **Available Options**:
   - **Auto-capture screenshots**: Enable/disable automatic screenshot capture
   - **Screenshot quality**: Choose between High, Medium, Low quality
   - **Data redaction patterns**: Comma-separated list of sensitive data patterns to redact
   - **Dark mode**: Toggle dark theme (future feature)

## Technical Architecture

### File Structure
```
testsnapper-extension/
├── manifest.json          # Extension manifest (Manifest V3)
├── popup.html            # Extension popup UI
├── src/
│   ├── background.js     # Background service worker
│   ├── content.js        # Content script for UI recording
│   ├── popup.js          # Popup logic and UI handling
│   └── injected.js       # Injected script for advanced features
├── icons/                # Extension icons
└── README.md            # This file
```

### Key Components

1. **Background Service Worker** (`background.js`):
   - Manages recording state
   - Handles network request monitoring
   - Stores session data in Chrome storage
   - Coordinates between content script and popup

2. **Content Script** (`content.js`):
   - Injected into web pages
   - Captures UI interactions (clicks, inputs, navigation)
   - Generates CSS selectors for elements
   - Sends interaction data to background script

3. **Popup Interface** (`popup.js` + `popup.html`):
   - User interface for controlling recordings
   - Session management and export functionality
   - Settings configuration
   - Built with vanilla JavaScript for performance

4. **Injected Script** (`injected.js`):
   - Runs in page context for advanced features
   - Captures console logs and fetch requests
   - Future expansion point for screenshot capabilities

### Data Storage

- **Local Storage**: All data stored in Chrome's local storage
- **No Cloud Sync**: Privacy-focused approach with no external servers
- **Session Format**: JSON objects with interaction arrays and metadata
- **Export Format**: Human-readable .txt files with structured data

### Privacy & Security

- **Local-Only**: No data transmitted to external servers
- **Content Security Policy**: Strict CSP implementation
- **Data Redaction**: Configurable patterns for sensitive data
- **Permissions**: Minimal required permissions for functionality

## Supported Browsers

- **Chrome**: v126+ (recommended)
- **Microsoft Edge**: Chromium-based versions
- **Other Chromium browsers**: Should work but not officially tested

## Troubleshooting

### Common Issues

1. **Extension not loading**:
   - Ensure Developer Mode is enabled
   - Check browser console for errors
   - Verify all files are in the correct directory

2. **Recording not working**:
   - Refresh the page after loading the extension
   - Check if content script injection is successful
   - Look for JavaScript errors in the page console

3. **Export not working**:
   - Ensure popup blockers are disabled
   - Check browser download settings
   - Verify Chrome storage permissions

### Debug Information

- **Background Script Logs**: Check Chrome extension console
- **Content Script Logs**: Check web page console
- **Storage Inspection**: Use Chrome DevTools → Application → Storage

## Development Notes

### Current Limitations
- Screenshot annotation not yet implemented
- .har export feature pending
- No project-based organization yet
- Limited error handling in some edge cases

### Future Enhancements
- Advanced screenshot tools with canvas-based annotations
- Network request/response body capture
- Session replay functionality
- Integration with popular bug tracking tools
- Enhanced selector generation for dynamic content

## Support

For issues, feature requests, or contributions, this is a development version created for demonstration purposes. The extension implements core QA recording functionality with room for future enhancements.

---

**Version**: 1.0.0  
**Last Updated**: January 2025  
**Manifest Version**: 3  
**License**: MIT