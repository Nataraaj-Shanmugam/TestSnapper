# TestSnapper - Complete Bug Fixes Guide

## Files Fixed

### ✅ COMPLETE FIXES PROVIDED
1. **popup.js** - Fixed and ready (see `/fixed/popup.js`)
2. **manifest.json** - Fixed and ready (see `/fixed/manifest.json`)

### 📝 FIXES TO APPLY (Code Snippets Below)
3. **content.js** - 6 critical bugs
4. **background.js** - 2 critical bugs  
5. **storage.js** - 2 critical bugs
6. **selector.js** - 2 bugs
7. **export-service.js** - 2 bugs
8. **redactor.js** - 1 bug

---

## CONTENT.JS FIXES

### Bug #4: Modal Timeout Memory Leak
**Location:** Lines 194-198, closeModal function

**PROBLEM:**
```javascript
modalTimeout = setTimeout(() => {
  console.warn('⚠️ Modal auto-closed after timeout');
  closeModal(overlay);
  resolve(null);
}, 30000);
```

**FIX:** Add cleanup in closeModal function
```javascript
function closeModal(overlay) {
  // Clear the timeout to prevent memory leak
  if (modalTimeout) {
    clearTimeout(modalTimeout);
    modalTimeout = null;
  }
  
  isModalOpen = false;
  modalResolver = null;
  pendingStep = null;
  
  if (overlay && overlay.parentNode) {
    overlay.remove();
  }
}
```

---

### Bug #5: Session Validation Interval Never Started
**Location:** Line 33

**ADD THIS CODE** after line 53 (after module initialization):
```javascript
// Heartbeat to detect background script restart
function startSessionValidation() {
  if (sessionValidationInterval) {
    clearInterval(sessionValidationInterval);
  }
  
  sessionValidationInterval = setInterval(() => {
    if (isRecording && currentSessionId) {
      chrome.runtime.sendMessage({ action: 'ping' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          console.error('Background script disconnected, stopping recording');
          stopRecording();
          alert('Recording stopped: Connection to extension lost');
        }
      });
    }
  }, 5000); // Check every 5 seconds
}

// Start validation when recording starts
// Add to startRecording function around line 600
```

---

### Bug #6: Highlight Overlay Not Removed
**Location:** Line 9, stopRecording function

**FIND** the `stopRecording` function and **ADD** this cleanup:
```javascript
function stopRecording() {
  if (!isRecording) return;

  isRecording = false;
  isPaused = false;
  currentSessionId = null;

  // Clear highlight overlay
  if (highlightOverlay && highlightOverlay.parentNode) {
    highlightOverlay.remove();
    highlightOverlay = null;
  }

  // Clear pending inputs
  pendingInputs.clear(); // Bug #7 fix

  // Clear session validation
  if (sessionValidationInterval) {
    clearInterval(sessionValidationInterval);
    sessionValidationInterval = null;
  }

  removeRecordingIndicator();
  
  // ... rest of existing stopRecording code
}
```

---

### Bug #7: Input Debounce Map Never Cleaned
**Location:** Line 24

**SOLUTION:** Already included in Bug #6 fix above. Additionally, add cleanup after timeouts fire:

**FIND** the input handling code and **MODIFY**:
```javascript
// When processing input
const timeoutId = setTimeout(() => {
  // ... process input
  
  // Clean up after processing
  pendingInputs.delete(element);
}, 500);

pendingInputs.set(element, timeoutId);
```

---

### Bug #14: Timer Continues When Paused
**Location:** Lines 1112-1119

**REPLACE** the pauseRecording function with:
```javascript
function pauseRecording() {
  if (!isRecording || isPaused) return;
  
  isPaused = true;
  
  // FIX: Stop the timer when paused
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  
  updateRecordingIndicator('PAUSED');
}

function resumeRecording() {
  if (!isRecording || !isPaused) return;
  
  isPaused = false;
  
  // FIX: Restart the timer when resumed
  if (!timerInterval && floatingPanelContainer) {
    const shadow = floatingPanelContainer.shadowRoot;
    const timeDisplay = shadow.getElementById('time-display');
    
    timerInterval = setInterval(() => {
      recordingSeconds++;
      const mins = Math.floor(recordingSeconds / 60).toString().padStart(2, '0');
      const secs = (recordingSeconds % 60).toString().padStart(2, '0');
      if (timeDisplay) timeDisplay.textContent = `${mins}:${secs}`;
    }, 1000);
  }
  
  updateRecordingIndicator('RECORDING');
}
```

---

### Bug #15: Floating Panel Drag Boundary Not Enforced
**Location:** Lines 1061-1072

**REPLACE** handleMouseMove with:
```javascript
const handleMouseMove = (e) => {
  if (!isDragging) return;
  e.preventDefault();

  let x = e.clientX - initialX;
  let y = e.clientY - initialY;

  // FIX: Enforce boundaries
  const panelWidth = 200; // Approximate width
  const panelHeight = 60; // Approximate height
  
  // Keep panel within viewport
  x = Math.max(0, Math.min(x, window.innerWidth - panelWidth));
  y = Math.max(0, Math.min(y, window.innerHeight - panelHeight));

  panelContainer.style.left = `${x}px`;
  panelContainer.style.top = `${y}px`;
};
```

---

### Bug #16: Module Init Retry Logic Insufficient
**Location:** Lines 46-53

**REPLACE** with exponential backoff:
```javascript
function initModules(attemptNumber = 0, maxAttempts = 5) {
  if (window.SelectorEngine && window.Redactor) {
    selectorEngine = new window.SelectorEngine();
    redactor = new window.Redactor();
    console.log('TestSnapper content script initialized');
    return true;
  }
  return false;
}

function retryInit(attempt = 0) {
  if (initModules(attempt)) {
    return; // Success
  }
  
  if (attempt < 5) {
    const delay = 100 * Math.pow(2, attempt); // Exponential backoff: 100, 200, 400, 800, 1600ms
    console.log(`TestSnapper: Retry ${attempt + 1}/5 in ${delay}ms...`);
    setTimeout(() => retryInit(attempt + 1), delay);
  } else {
    console.error('TestSnapper: Failed to initialize after 5 attempts - modules not available');
  }
}

// Initial attempt
if (!initModules()) {
  retryInit(0);
}
```

---

## BACKGROUND.JS FIXES

### Bug #8: Export Progress Race Condition
**Location:** Lines 511-519

**WRAP** sendMessage calls in try-catch:
```javascript
async function sendExportProgress(message) {
  try {
    await chrome.runtime.sendMessage(message);
  } catch (err) {
    // Popup may be closed - this is expected
    console.log('Export progress not sent (no receiver):', err.message);
  }
}

// Then replace all chrome.runtime.sendMessage calls in exportSession with:
await sendExportProgress({
  action: 'exportProgress',
  sessionId,
  percent: 95,
  status: 'Preparing download...'
});
```

---

### Bug #9: Badge Not Cleared on All Tabs
**Location:** Lines 150-166, stopRecording function

**REPLACE** badge clearing code:
```javascript
async function stopRecording(tabId) {
  // ... existing stop logic ...

  // FIX: Clear badge on ALL tabs, not just current one
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map(tab => BadgeManager.clear(tab.id)));
  } catch (err) {
    console.warn('Failed to clear badges:', err);
  }

  return { success: true, sessionId };
}
```

---

## STORAGE.JS FIXES

### Bug #10: No Transaction Atomicity

**ADD** this transaction wrapper class:
```javascript
class StorageTransaction {
  constructor(storage) {
    this.storage = storage;
    this.locks = new Map();
  }

  async withLock(key, operation) {
    // Wait for existing lock
    while (this.locks.has(key)) {
      await this.locks.get(key);
    }

    // Create new lock
    let releaseLock;
    const lockPromise = new Promise(resolve => {
      releaseLock = resolve;
    });
    this.locks.set(key, lockPromise);

    try {
      return await operation();
    } finally {
      this.locks.delete(key);
      releaseLock();
    }
  }
}

// In StorageManager constructor:
constructor() {
  this.maxRetries = 3;
  this.retryDelay = 100;
  this.transaction = new StorageTransaction(this);
}

// Wrap all write operations:
async addStep(step) {
  return this.transaction.withLock('testsnapper_data', async () => {
    return this._retryOperation(async () => {
      const data = await this._read();
      const idx = this._findSessionIndex(data.sessions, step.sessionId);

      if (idx === -1) throw new Error(`Session ${step.sessionId} not found`);

      data.sessions[idx].steps.push(step);
      data.sessions[idx].stepCount = data.sessions[idx].steps.length;
      await this._write(data);
      return step;
    }, 'addStep');
  });
}
```

---

### Bug #11: Missing Storage Quota Check

**ADD** quota checking methods:
```javascript
async checkStorageQuota() {
  try {
    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage || 0;
    const quota = estimate.quota || 0;
    const percentUsed = (usage / quota) * 100;

    return {
      usage,
      quota,
      percentUsed,
      available: quota - usage
    };
  } catch (err) {
    console.warn('Storage quota check failed:', err);
    return null;
  }
}

async ensureStorageSpace(requiredBytes = 1000000) { // 1MB default
  const quota = await this.checkStorageQuota();
  
  if (quota && quota.available < requiredBytes) {
    console.warn(`Low storage: ${Math.round(quota.percentUsed)}% used`);
    
    if (quota.percentUsed > 90) {
      throw new Error('Storage quota exceeded. Please delete old sessions.');
    }
  }
}

// Call before large writes:
async addAsset(asset) {
  await this.ensureStorageSpace(asset.dataUrl?.length || 1000000);
  
  return this._retryOperation(async () => {
    // ... existing code
  }, 'addAsset');
}
```

---

## SELECTOR.JS FIXES

### Bug #17: Generated ID Detection False Positives
**Location:** Lines 165-177

**REPLACE** pattern:
```javascript
_isGeneratedId(id) {
  const patterns = [
    /^[a-f0-9]{8,}$/i,           // Long hex strings (8+ chars)
    /^\d{8,}$/,                   // FIX: 8+ digits only (not just 3)
    /^ember\d+/,                  // Ember.js
    /^react-[a-z0-9-]+/,         // React
    /^__next/,                    // Next.js
    /^[a-z]-\d+-\d+/,            // Framework patterns
    /^:r[a-z0-9]+:/,             // React 18+
    /^mui-\d+/                    // Material-UI
  ];
  return patterns.some(pattern => pattern.test(id));
}
```

---

### Bug #18: Class Selector Memory Leak
**Location:** Lines 275-278

**REPLACE** class filtering logic:
```javascript
_addClassSelectors(element, candidates) {
  if (!element.className || typeof element.className !== 'string') return;

  const tag = element.tagName.toLowerCase();
  // FIX: Use for...of to avoid array allocation churn
  const classList = element.className.trim().split(/\s+/);
  
  for (const cls of classList) {
    // Skip generic/framework classes
    if (this._isGenericClass(cls)) continue;

    const selector = `${tag}.${CSS.escape(cls)}`;
    const isUnique = this._isUnique(selector, element);
    
    if (isUnique) {
      candidates.push({
        selector,
        type: 'css-class-single',
        strategy: 'single-class',
        isUnique: true,
        length: selector.length
      });
      break; // Found unique class, no need to continue
    }
  }
}
```

---

## EXPORT-SERVICE.JS FIXES

### Bug #19: Progress Callback Not Validated
**Location:** Throughout file

**REPLACE** notify calls with safe wrapper:
```javascript
async exportSession(sessionId, format, progressCallback) {
  // FIX: Create safe notify wrapper
  const notify = (data) => {
    if (typeof progressCallback === 'function') {
      try {
        progressCallback(data);
      } catch (err) {
        console.warn('Progress callback failed:', err);
      }
    }
  };

  console.log('📄 Starting export:', format, 'for session:', sessionId);
  notify({ percent: 5, status: 'Loading session...' });
  
  // ... rest of function uses notify() safely
}
```

---

### Bug #20: Image Compression Fallback Orphans Canvas
**Location:** Lines 158-176

**WRAP** in finally block:
```javascript
canvas.toBlob(
  (compressedBlob) => {
    resolve(compressedBlob || blob);
  },
  'image/jpeg',
  quality
);

// FIX: Move cleanup to finally
img.onload = () => {
  try {
    // ... existing canvas code ...
  } catch (err) {
    console.warn('Canvas compression failed:', err);
    resolve(blob);
  } finally {
    // Cleanup always runs
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
    img.src = '';
  }
};
```

---

## REDACTOR.JS FIX

### Bug #23: Misleading Comment
**Location:** Lines 69, 108

**REPLACE** comments:
```javascript
// Original FIX comment (line 8):
/**
 * Privacy Redactor - Filters and masks sensitive data
 *
 * Fixes applied:
 *  1. Removed /g flag from instance-level RegExp properties.
 *  2. Removed the .test() → .replace() two-step pattern entirely.
 *  3. Uses Unicode bullet character (\u2022 = •) for masking
 */

// Line 69 - REPLACE comment:
return '\u2022'.repeat(Math.min(value.length, 8)); // Bullet character (•) - up to 8

// Line 108 - REPLACE comment:
redacted.value = '\u2022'.repeat(8); // Bullet character (•)
```

---

## IMPLEMENTATION CHECKLIST

### Priority Order:

**Week 1 (Critical - P0):**
- [ ] Apply all content.js fixes (Bugs #4-7, #14-16)
- [ ] Apply background.js fixes (Bugs #8-9)
- [ ] Apply storage.js fixes (Bugs #10-11)
- [ ] Test recording sessions > 1 hour
- [ ] Test multiple tab switches
- [ ] Test storage near quota

**Week 2 (High - P1):**
- [ ] Apply selector.js fixes (Bugs #17-18)
- [ ] Apply export-service.js fixes (Bugs #19-20)
- [ ] Test selector generation on various sites
- [ ] Test export with large sessions

**Week 3 (Medium - P2):**
- [ ] Apply redactor.js comment fix (Bug #23)
- [ ] Code review and documentation update
- [ ] Add unit tests for critical paths

---

## Testing Strategy

### Critical Tests:
1. **Memory Leak Test:** Record for 2+ hours, monitor memory
2. **State Recovery Test:** Refresh page during recording
3. **Storage Quota Test:** Fill storage to 90%, verify warnings
4. **Concurrent Operations:** Rapid clicks, multiple modals
5. **Tab Switching:** Switch tabs 20+ times during recording

### Validation:
```javascript
// Add to popup.js for debugging
console.log('Memory:', performance.memory);
console.log('Storage:', await storage.checkStorageQuota());
```

---

## Additional Recommendations

1. **Add TypeScript:** Prevent type-related bugs
2. **Add Unit Tests:** Jest/Vitest for critical functions
3. **Add Error Boundary:** Global error handler
4. **Add Telemetry:** Track common failure modes
5. **Add Migration:** Handle storage schema changes

---

**Document Version:** 1.0  
**Last Updated:** February 2, 2026  
**Total Fixes:** 24 bugs across 10 files
