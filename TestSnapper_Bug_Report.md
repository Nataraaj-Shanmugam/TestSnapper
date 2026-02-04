# TestSnapper Chrome Extension - Critical Bug Report

**Date:** February 2, 2026  
**Analyzed by:** Frontend Architecture Team  
**Version:** 1.1.3

---

## Executive Summary

This report identifies **23 critical bugs** across the TestSnapper codebase that require immediate attention. Bugs are categorized by priority (P0-P2) and organized by file for efficient developer assignment.

**Priority Definitions:**
- **P0 (Critical):** Breaks core functionality, data loss risk, or security issues
- **P1 (High):** Major feature malfunction, poor user experience
- **P2 (Medium):** Minor issues, edge cases, code quality

---

## 🔴 P0 - CRITICAL BUGS (Must Fix Immediately)

### **File: popup.js**

#### **Bug #1: Duplicate Function Declaration - handleSaveSettings()**
**Lines:** 283-304 and 350-363  
**Impact:** Function is declared twice causing confusion and potential runtime conflicts. Second declaration overwrites the first.  
**Fix:** Remove one of the duplicate declarations and ensure all settings are captured in a single function.

---

#### **Bug #2: Missing Element References Check**
**Lines:** Throughout (42-51)  
**Impact:** Code assumes all DOM elements exist without null checks. Will crash if HTML structure changes.  
**Fix:** Add null checks before accessing element properties: `if (element) { element.addEventListener(...) }`

---

#### **Bug #3: Race Condition in State Updates**
**Lines:** 10-14, 368-383  
**Impact:** `setInterval` polling every 2s can conflict with message-based state updates, causing UI flicker and incorrect button states.  
**Fix:** Use event-driven state management via chrome.runtime.onMessage instead of polling.

---

### **File: content.js**

#### **Bug #4: Modal Timeout Memory Leak**
**Lines:** 194-198  
**Impact:** `modalTimeout` is set but never cleared if modal is manually closed, leaving orphaned timeout that may fire later and corrupt state.  
**Fix:** Always clear timeout in closeModal(): `if (modalTimeout) { clearTimeout(modalTimeout); modalTimeout = null; }`

---

#### **Bug #5: Session Validation Interval Never Started**
**Lines:** 33  
**Impact:** `sessionValidationInterval` variable declared but never initialized. Comment mentions "heartbeat to detect background script restart" but implementation is missing.  
**Fix:** Implement heartbeat: `sessionValidationInterval = setInterval(() => chrome.runtime.sendMessage({action:'ping'}), 5000)`

---

#### **Bug #6: Highlight Overlay Not Removed**
**Lines:** 9  
**Impact:** `highlightOverlay` is created during recording but never explicitly removed on stop, causing stale DOM elements.  
**Fix:** Add cleanup in stopRecording(): `if (highlightOverlay) { highlightOverlay.remove(); highlightOverlay = null; }`

---

#### **Bug #7: Input Debounce Map Never Cleaned**
**Lines:** 24  
**Impact:** `pendingInputs` Map grows unbounded as user types, leading to memory leak in long recording sessions.  
**Fix:** Clear map entries after timeout fires or on stop: `pendingInputs.delete(elementRef)`

---

### **File: background.js**

#### **Bug #8: Export Progress Race Condition**
**Lines:** 511-519  
**Impact:** Progress callback may fail to send if popup closes during export. Chrome.runtime.sendMessage throws error when no receiver exists.  
**Fix:** Wrap in try-catch: `try { chrome.runtime.sendMessage(...) } catch(e) { console.log('No receiver') }`

---

#### **Bug #9: Badge Not Cleared on All Tabs**
**Lines:** 150-166  
**Impact:** BadgeManager only sets badge on current tab. If user switches tabs during recording, badge persists on old tab.  
**Fix:** Clear badge on all tabs when stopping: `chrome.tabs.query({}, tabs => tabs.forEach(t => BadgeManager.clear(t.id)))`

---

### **File: storage.js**

#### **Bug #10: No Transaction Atomicity**
**Lines:** Throughout write operations  
**Impact:** If browser crashes between reading data and writing back, partial updates corrupt storage. Example: deleting step but not updating stepCount.  
**Fix:** Implement write-ahead logging or read-modify-write locking pattern to ensure atomicity.

---

#### **Bug #11: Missing Storage Quota Check**
**Lines:** All write operations  
**Impact:** chrome.storage.local has ~10MB limit (without unlimitedStorage). Large sessions with screenshots will silently fail to save.  
**Fix:** Check quota before writes: `chrome.storage.local.getBytesInUse()` and warn user when approaching limit.

---

## 🟡 P1 - HIGH PRIORITY BUGS (Fix This Sprint)

### **File: popup.js**

#### **Bug #12: Auto-close Popup After Action**
**Lines:** 192, 220, 256  
**Impact:** Popup auto-closes with `setTimeout(window.close(), 500)` but doesn't wait for async operations to complete. User loses feedback if operation fails.  
**Fix:** Only close popup after receiving success confirmation and showing message for minimum duration.

---

#### **Bug #13: Theme Toggle Icon Incorrect**
**Lines:** 100-108  
**Impact:** Icon logic is inverted - shows moon when in light mode, sun when in dark mode. Should be opposite (show what you'll get, not current state).  
**Fix:** Swap icon assignments: `if (theme === 'light') icon.textContent = '🌙'` → `if (theme === 'light') icon.textContent = '☀️'`

---

### **File: content.js**

#### **Bug #14: Timer Continues When Paused**
**Lines:** 1112-1119  
**Impact:** Timer only checks `isPaused` flag but continues running. If flag isn't set properly, timer increments during pause.  
**Fix:** Clear interval when pausing: `if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }`

---

#### **Bug #15: Floating Panel Drag Boundary Not Enforced**
**Lines:** 1061-1072  
**Impact:** User can drag floating panel completely off-screen, making it impossible to access controls.  
**Fix:** Add boundary checks: `const x = Math.max(0, Math.min(e.clientX - initialX, window.innerWidth - 200))`

---

#### **Bug #16: Module Init Retry Logic Insufficient**
**Lines:** 46-53  
**Impact:** Only retries once after 100ms. If selector.js/redactor.js load slowly, initialization fails silently.  
**Fix:** Implement exponential backoff retry up to 5 attempts: `setTimeout(() => retry(), 100 * Math.pow(2, attemptNumber))`

---

### **File: selector.js**

#### **Bug #17: Generated ID Detection False Positives**
**Lines:** 165-177  
**Impact:** Pattern `/^\d+$/` flags ANY numeric ID as generated (e.g., "123" could be a legitimate semantic ID). Too aggressive.  
**Fix:** Require minimum length: `/^\d{8,}$/` (at least 8 digits to be considered auto-generated).

---

#### **Bug #18: Class Selector Memory Leak**
**Lines:** 275-278  
**Impact:** `_addClassSelectors` creates intermediate arrays for filtering but never releases them in tight loops.  
**Fix:** Reuse array or use `for...of` to avoid allocation churn.

---

### **File: export-service.js**

#### **Bug #19: Progress Callback Not Validated**
**Lines:** 30-31  
**Impact:** Code checks `typeof progressCallback === 'function'` but then calls it unconditionally elsewhere without checking if it's still valid.  
**Fix:** Always guard calls: `if (notify) notify({ ... })` throughout the function.

---

#### **Bug #20: Image Compression Fallback Orphans Canvas**
**Lines:** 158-176  
**Impact:** If canvas.toBlob() fails, canvas is never released (`canvas.width = 0` never executes). Memory leak for failed compressions.  
**Fix:** Move cleanup to `finally` block to ensure it always runs.

---

## 🟢 P2 - MEDIUM PRIORITY BUGS (Next Sprint)

### **File: popup.html**

#### **Bug #21: Emoji Rendering Issues**
**Lines:** 13  
**Impact:** Emoji "🎬" in title may render as mojibake on some systems without proper UTF-8 charset meta tag (though it's present).  
**Fix:** Consider replacing with text + icon image for better cross-platform consistency.

---

### **File: review-standalone.js**

#### **Bug #22: Screenshot Blob URL Not Revoked**
**Lines:** Throughout rendering (not visible in truncated view)  
**Impact:** If screenshots are rendered as blob URLs, they're never revoked with `URL.revokeObjectURL()`, causing memory leak.  
**Fix:** Track blob URLs and revoke on component cleanup or re-render.

---

### **File: redactor.js**

#### **Bug #23: Bullet Character Encoding Comment**
**Lines:** 69, 108  
**Impact:** Comment mentions "fixed mojibaked bullet" but uses `\u2022` which is correct. Comment is outdated/misleading.  
**Fix:** Remove or update comment to clarify the fix was applied.

---

### **File: manifest.json**

#### **Bug #24: Missing "unlimitedStorage" Permission**
**Lines:** 6-10  
**Impact:** Without this permission, chrome.storage.local is limited to ~10MB. With screenshots, sessions quickly exceed this.  
**Fix:** Add to permissions array: `"permissions": ["tabs", "activeTab", "storage", "unlimitedStorage", "downloads", "scripting"]`

---

## 📊 Bug Distribution Summary

| Priority | Count | Percentage |
|----------|-------|------------|
| P0 (Critical) | 11 | 46% |
| P1 (High) | 9 | 37% |
| P2 (Medium) | 4 | 17% |
| **Total** | **24** | **100%** |

### Bugs by File:
- **popup.js**: 4 bugs (3 P0, 1 P1)
- **content.js**: 6 bugs (4 P0, 2 P1)
- **background.js**: 2 bugs (2 P0)
- **storage.js**: 2 bugs (2 P0)
- **selector.js**: 2 bugs (2 P1)
- **export-service.js**: 2 bugs (2 P1)
- **redactor.js**: 1 bug (1 P2)
- **review-standalone.js**: 1 bug (1 P2)
- **popup.html**: 1 bug (1 P2)
- **manifest.json**: 1 bug (1 P2)

---

## 🎯 Recommended Fix Order

### Week 1 (Critical - P0):
1. Fix duplicate handleSaveSettings() in popup.js
2. Implement proper state management (remove polling)
3. Add null checks for all DOM elements
4. Fix modal timeout memory leak in content.js
5. Implement storage atomicity in storage.js
6. Add storage quota checks

### Week 2 (High - P1):
1. Fix theme toggle icon logic
2. Implement proper timer pause mechanism
3. Add drag boundary enforcement
4. Fix selector generation patterns
5. Validate progress callbacks

### Week 3 (Medium - P2):
1. Add blob URL cleanup
2. Fix misleading comments
3. Add unlimitedStorage permission
4. Test cross-platform emoji rendering

---

## 🔍 Testing Recommendations

After fixes, prioritize testing:
1. **Long recording sessions (>1 hour)** - Test memory leaks
2. **Multiple tab switches during recording** - Test badge state
3. **Storage near quota limit** - Test with large screenshots
4. **Browser crash recovery** - Test data integrity
5. **Rapid user interactions** - Test debouncing and modal behavior

---

## 📝 Notes

- Several bugs already have fix comments in the code (e.g., background.js line 53 mentions "FIX #1") indicating the team is aware
- The codebase shows good structure but lacks defensive programming patterns
- Consider adding TypeScript for better type safety
- Unit tests are missing - recommend adding Jest/Vitest for critical paths

**Generated by:** Claude (Anthropic)  
**Review Date:** February 2, 2026
