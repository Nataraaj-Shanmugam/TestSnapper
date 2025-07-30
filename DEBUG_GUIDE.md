# TestSnapper Extension Debug Guide

## Current Issues Fixed:

1. **Session Saving**: Enhanced with better error handling and verification
2. **Recording State Management**: Improved state tracking between components
3. **Communication**: Fixed message passing between background, popup, and content scripts
4. **Storage Persistence**: Added storage initialization and verification

## How to Test the Fixes:

### Step 1: Reload Extension
1. Go to `chrome://extensions/`
2. Find "TestSnapper v1.0"
3. Click "Reload" button (circular arrow icon)
4. Check for any errors in the extension console

### Step 2: Debug Console Access
- **Background Script Console**: Extensions page → TestSnapper → "service worker" link
- **Popup Console**: Right-click popup → Inspect
- **Content Script Console**: F12 on any webpage where recording

### Step 3: Test Recording Flow
1. Click TestSnapper icon
2. Click "Start Recording" - should see console logs
3. Perform interactions on demo page
4. Click TestSnapper icon again  
5. Click "Stop Recording" - should see session saved logs
6. Go to "Sessions" tab - should show new session

### Step 4: Verify Session Export
1. In Sessions tab, click "Export" on any session
2. Should download .txt file with interaction details

## Expected Console Output:

**Background Script:**
```
TestSnapper Background Service Worker initialized
Starting recording for tab: [ID] [URL]
Created session: session_[timestamp]_[random]
Content script injected and recording started
Recording stopped, session ID: session_[timestamp]_[random]
Session saved successfully. Total sessions: [count]
```

**Popup:**
```
TestSnapper Popup initializing...
Loading recording status...
Recording status loaded: false
Sessions loaded: [count]
Starting recording...
Recording started successfully
```

**Content Script:**
```
TestSnapper: Starting UI recording on [URL]
TestSnapper: UI recording started successfully  
Recorded interaction: click [selector]
TestSnapper: Stopping UI recording
```

## Troubleshooting:

### If sessions still don't appear:
1. Check background script console for save errors
2. Verify storage permissions in manifest
3. Check if chrome.storage.local is working

### If recording state persists:
1. Extension was properly updated (reload extension)
2. Background script is running (check service worker)
3. Clear extension storage: Extensions → TestSnapper → Storage → Clear

### Manual Storage Check:
```javascript
// In background script console:
chrome.storage.local.get(['sessions']).then(console.log);

// Should show: {sessions: [array of session objects]}
```

Try these steps and let me know which specific part is still not working!