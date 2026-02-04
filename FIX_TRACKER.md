# TestSnapper - File-by-File Fix Tracker

**Last Updated:** February 4, 2026  
**Status Legend:** ⬜ Not Started | 🟡 In Progress | ✅ Complete | ⚠️ Blocked | ❌ Skipped

---

## Quick Stats
- **Total Files:** 17
- **Files to Fix:** 17
- **Completed:** 0
- **In Progress:** 0
- **Remaining:** 17

---

## Fix Order Priority

### 🔴 CRITICAL - Fix First (Week 1)
1. [manifest.json](#1-manifestjson) - Add permissions & CSP
2. [popup.js](#2-popupjs) - Fix duplicate functions & critical bugs
3. [storage.js](#3-storagejs) - Add quota monitoring & split keys
4. [background.js](#4-backgroundjs) - Fix session recovery & cleanup

### 🟡 HIGH PRIORITY - Fix Next (Week 2)
5. [content.js](#5-contentjs) - Fix modal race conditions & memory leaks
6. [selector.js](#6-selectorjs) - Add framework support & caching
7. [export-service.js](#7-export-servicejs) - Fix memory issues & add streaming

### 🟢 MEDIUM PRIORITY - Enhancement (Week 3)
8. [review-standalone.js](#8-review-standalonejs) - Add virtual scrolling & auto-save
9. [redactor.js](#9-redactorjs) - Expand patterns & add custom support
10. [utils.js](#10-utilsjs) - Add missing utilities
11. [export.js](#11-exportjs) - Consolidate or remove

### 🔵 LOW PRIORITY - Polish (Week 4)
12. [injected.js](#12-injectedjs) - Add error handling & caching
13. [popup.html](#13-popuphtml) - Fix accessibility
14. [popup.css](#14-popupcss) - Add responsive & a11y
15. [review-standalone.html](#15-review-standalonehtml) - Fix accessibility
16. [review-standalone.css](#16-review-standalonecss) - Add responsive & a11y
17. [package.json](#17-packagejson) - Add scripts & dependencies

---

## Detailed File Tracking

---

## 1. manifest.json
**Status:** ✅ Complete  
**Priority:** 🔴 Critical  
**Estimated Time:** 30 minutes  
**Dependencies:** None

### Issues to Fix:
- [x] **MAN-001:** Add `unlimitedStorage` permission
- [x] **MAN-002:** Add Content Security Policy
- [x] **MAN-003:** Review and clean web_accessible_resources
- [x] **MAN-004:** Update file paths after reorganization

### Changes Required:
1. Add to permissions array: `"unlimitedStorage"`
2. Add CSP configuration for extension_pages
3. Remove unnecessary web_accessible_resources or restrict matches
4. Document why each permission is needed (comments)

### Testing After Fix:
- [x] Extension loads without errors
- [x] Storage quota is unlimited
- [x] CSP blocks inline scripts in extension pages
- [x] All resources load correctly

### Notes:
_This should be fixed first as it impacts storage functionality across the extension._

---

## 2. popup.js
**Status:** ✅ Complete  
**Priority:** 🔴 Critical  
**Estimated Time:** 2-3 hours  
**Dependencies:** None

### Issues to Fix:
- [x] **POP-001/BUG-002:** Remove duplicate `handleSaveSettings` function (lines 350-363)
- [x] **POP-002:** Add session name validation
- [x] **POP-003:** Add storage usage indicator in UI
- [x] **POP-004:** Add permission error handling
- [x] **POP-005:** Fix settings UI references to non-existent elements
- [x] **POP-006:** Document keyboard shortcuts
- [x] **BUG-002:** Fix theme state inconsistency

### Changes Required:
1. Delete duplicate function at lines 350-363
2. Add validation function for session names (max 100 chars, no special chars)
3. Query storage usage on popup open, display with progress bar
4. Wrap actions in permission checks with friendly error messages
5. Add null checks for settings elements or remove references
6. Add help tooltip/modal showing keyboard shortcuts
7. Standardize theme class system (use one approach consistently)

### Testing After Fix:
- [x] Settings save correctly
- [x] Theme toggle works on first load and subsequent loads
- [x] Storage usage displays correctly
- [x] Session name validation works
- [x] Permission errors show friendly messages
- [x] No console errors from missing elements

### Notes:
_Fix the duplicate function first as it's a clear bug. Theme system needs careful testing._

---

## 3. storage.js
**Status:** ✅ Complete  
**Priority:** 🔴 Critical  
**Estimated Time:** 4-5 hours  
**Dependencies:** manifest.json (unlimitedStorage permission)

### Issues to Fix:
- [x] **BUG-004:** Add storage quota monitoring
- [x] **STR-001:** Implement image compression
- [x] **STR-002:** Add schema versioning
- [x] **STR-003:** Split storage into multiple keys (avoid 10MB per key limit)
- [x] **STR-004:** Add orphaned asset cleanup
- [x] **STR-005:** Add export/import for backup
- [x] **STR-006:** Add batch operations

### Changes Required:
1. Add `getStorageUsage()` method returning used/total/percentage
2. Add quota warnings at 80%, errors at 95%
3. Implement image compression using canvas (resize + quality reduction)
4. Add version field to storage schema
5. Create migration functions for schema changes
6. Split storage: sessions, steps, assets in separate keys
7. Add `findOrphanedAssets()` and `cleanupOrphans()` methods
8. Add `exportAllData()` and `importData()` methods
9. Add batch methods: `batchUpdateSteps()`, `batchDeleteSteps()`

### Testing After Fix:
- [x] Storage usage reports correctly
- [x] Warnings show at 80% capacity
- [x] Images compress to target size
- [x] Schema migrations work
- [x] Multiple sessions store without hitting key size limit
- [x] Orphaned assets are detected and cleaned
- [x] Export/import preserves all data
- [x] Batch operations are atomic

### Notes:
_This is the most complex file to fix. Split into sub-tasks. Test thoroughly with large datasets._

---

## 4. background.js
**Status:** ✅ Complete  
**Priority:** 🔴 Critical  
**Estimated Time:** 3-4 hours  
**Dependencies:** storage.js (quota monitoring)

### Issues to Fix:
- [x] **BUG-005:** Complete session recovery implementation
- [x] **BUG-006:** Validate screenshot serialization fix
- [x] **BG-002:** Add rate limiting on screenshots
- [x] **BG-003:** Add cleanup of orphaned data
- [x] **BG-004:** Improve export progress error handling
- [x] **BG-005:** Implement export cancellation
- [x] **BG-006:** Add settings validation

### Changes Required:
1. Enhance session recovery to check if tab exists, re-inject content scripts
2. Audit all screenshot loading paths, ensure dataUrl is used
3. Add screenshot debouncing (1 second minimum between captures)
4. Call storage cleanup methods on startup and session end
5. Check if review page exists before sending progress messages
6. Implement cancellation flag in export process
7. Add validation for all settings before saving

### Testing After Fix:
- [x] Session recovers correctly after service worker restart
- [x] Screenshots display in all contexts (export, review)
- [x] Screenshot spam is prevented
- [x] Orphaned data is cleaned up
- [x] Export progress doesn't throw errors
- [x] Export can be cancelled mid-process
- [x] Invalid settings are rejected

### Notes:
_Test session recovery by manually restarting the service worker in chrome://serviceworker-internals_

---

## 5. content.js
**Status:** 🟡 In Progress  
**Priority:** 🟡 High  
**Estimated Time:** 5-6 hours  
**Dependencies:** selector.js (framework support)

### Issues to Fix:
- [x] **BUG-003:** Fix modal state race condition
- [ ] **CNT-001:** Add Shadow DOM support
- [x] **CNT-002:** Add iframe interaction support
- [x] **CNT-003:** Fix floating panel z-index conflicts
- [x] **CNT-004:** Add element exclusion mechanism
- [x] **CNT-005:** Fix timer not pausing during pause state
- [x] **CNT-006:** Add error recovery for failed step capture
- [x] **CNT-007:** Fix memory leak in event listeners

### Changes Required:
1. Implement modal queue system with unique IDs per modal
2. Walk shadow DOM tree and attach listeners to shadow roots
3. Inject into iframes, implement cross-frame messaging
4. Use max z-index (2147483647) and add draggable positioning
5. Add exclusion patterns for ads/tracking elements
6. Stop timer interval when isPaused = true
7. Wrap step capture in try-catch with user notification
8. Use AbortController for event listener cleanup

### Testing After Fix:
- [x] Multiple rapid actions don't lose data
- [x] Shadow DOM interactions are recorded
- [x] Iframe interactions are recorded
- [x] Panel always visible regardless of page styles
- [x] Ad/tracking clicks are excluded
- [x] Timer pauses correctly
- [x] Failed steps show error message
- [x] Event listeners cleaned up on stop

### Notes:
_Shadow DOM and iframe support are complex. May need to split into separate PRs._

---

## 6. selector.js
**Status:** ✅ Complete  
**Priority:** 🟡 High  
**Estimated Time:** 3-4 hours  
**Dependencies:** None

### Issues to Fix:
- [x] **SEL-001:** Add React/Vue/Angular attribute support
- [x] **SEL-002:** Implement selector caching
- [x] **SEL-003:** Improve XPath generation stability
- [x] **SEL-004:** Add custom data attribute configuration
- [x] **SEL-005:** Increase duplicate detection time window

### Changes Required:
1. Add framework-specific strategies (data-reactid, v-*, ng-*)
2. Implement WeakMap cache for element → selector mapping
3. Prefer semantic XPath (text/attribute predicates) over positional
4. Read custom attributes from settings, prioritize in generation
5. Increase duplicate detection window to 3000ms

### Testing After Fix:
- [x] Framework attributes detected and prioritized
- [x] Selector generation faster with caching
- [x] XPath selectors more stable across page changes
- [x] Custom attributes work in selector generation
- [x] Duplicate detection catches more duplicates

### Notes:
_Test with real React, Vue, and Angular applications._

---

## 7. export-service.js
**Status:** 🟡 In Progress  
**Priority:** 🟡 High  
**Estimated Time:** 3-4 hours  
**Dependencies:** storage.js (compression)

### Issues to Fix:
- [ ] **BUG-007:** Consolidate with export.js or clarify separation
- [x] **EXP-001:** Consolidate screenshot loading logic
- [x] **EXP-002:** Add image resizing in exports
- [ ] **EXP-003:** Add export templates
- [ ] **EXP-004:** Implement streaming export for memory efficiency
- [ ] **EXP-005:** Add export format validation

### Changes Required:
1. Decide: merge export.js into this file OR clearly separate concerns
2. Create single `loadScreenshot(asset)` helper method
3. Resize screenshots to max 800px width before adding to exports
4. Create template system for different export styles
5. Process steps in chunks (20 at a time) to avoid memory spikes
6. Validate format against allowed list with clear errors

### Testing After Fix:
- [ ] No export module redundancy
- [x] Screenshots load consistently
- [x] Export file sizes reasonable
- [ ] Templates apply correctly
- [ ] Large sessions export without crashing
- [ ] Invalid formats rejected with clear message

### Notes:
_Decision on export.js consolidation should be made with team input._

---

## 8. review-standalone.js
**Status:** ⬜ Not Started  
**Priority:** 🟢 Medium  
**Estimated Time:** 5-6 hours  
**Dependencies:** storage.js (batch operations)

### Issues to Fix:
- [ ] **REV-001:** Implement virtual scrolling
- [ ] **REV-002:** Add auto-save of edits
- [ ] **REV-003:** Persist undo history
- [ ] **REV-004:** Make export progress modal dismissible
- [ ] **REV-005:** Implement lazy loading for screenshots
- [ ] **REV-006:** Add batch edit operations
- [ ] **REV-007:** Optimize search performance

### Changes Required:
1. Implement virtual scrolling (render only visible steps)
2. Debounce edits and auto-save after 2 seconds idle
3. Store undo history in sessionStorage, restore on load
4. Allow minimizing export modal to background
5. Use IntersectionObserver to lazy load screenshots
6. Add multi-select with bulk operations
7. Debounce search input (300ms) and use indexed search

### Testing After Fix:
- [ ] Smooth scrolling with 1000+ steps
- [ ] Edits auto-save correctly
- [ ] Undo works after page reload
- [ ] Can work while export runs
- [ ] Screenshots load only when visible
- [ ] Bulk operations work on multiple steps
- [ ] Search is fast and responsive

### Notes:
_Virtual scrolling is highest impact for performance. Prioritize this._

---

## 9. redactor.js
**Status:** ⬜ Not Started  
**Priority:** 🟢 Medium  
**Estimated Time:** 2-3 hours  
**Dependencies:** None

### Issues to Fix:
- [ ] **RED-001:** Expand sensitive pattern coverage
- [ ] **RED-002:** Add custom pattern support
- [ ] **RED-003:** Implement reversible redaction
- [ ] **RED-004:** Add non-English character support
- [ ] **RED-005:** Refine password field detection

### Changes Required:
1. Add patterns for SSN, passport, bank accounts, crypto addresses
2. Add custom pattern configuration in settings
3. Encrypt redacted values with user password, allow reveal
4. Update patterns to support international formats
5. Improve password detection to avoid false positives

### Testing After Fix:
- [ ] All common sensitive formats detected
- [ ] Custom patterns work correctly
- [ ] Can export with original values (password required)
- [ ] International formats supported
- [ ] Password detection accurate

### Notes:
_Reversible redaction should be optional and clearly documented._

---

## 10. utils.js
**Status:** ⬜ Not Started  
**Priority:** 🟢 Medium  
**Estimated Time:** 2-3 hours  
**Dependencies:** None

### Issues to Fix:
- [ ] **UTL-001:** Add missing essential utilities
- [ ] **UTL-002:** Add error logging utilities
- [ ] **UTL-003:** Fix Blob to DataURL error handling

### Changes Required:
1. Add validation functions (validateEmail, validateUrl, sanitizeFileName)
2. Add formatting functions (formatFileSize, formatDuration)
3. Add async utilities (retry, waitFor, timeout)
4. Create logging system (logError, logWarning, logInfo)
5. Add timeout and better error handling to blobToDataURL

### Testing After Fix:
- [ ] All new utilities work correctly
- [ ] Validation functions catch invalid inputs
- [ ] Logging system works across extension
- [ ] BlobToDataURL handles errors gracefully

### Notes:
_These utilities will be used across all other files, so get them right._

---

## 11. export.js
**Status:** ⬜ Not Started  
**Priority:** 🟢 Medium  
**Estimated Time:** 1-2 hours (if consolidating) OR 30 min (if removing)  
**Dependencies:** export-service.js decision

### Issues to Fix:
- [ ] **BUG-007:** Consolidate with export-service.js
- [ ] **EXPJS-002:** Fix DOCX library loading
- [ ] **EXPJS-003:** Complete or remove PDF export

### Changes Required:
**If Consolidating:**
1. Move all format methods to export-service.js
2. Update all imports to use export-service.js
3. Delete export.js
4. Test all export formats still work

**If Keeping Separate:**
1. Document clear separation (export.js = generators, export-service.js = orchestrator)
2. Fix DOCX library loading with better error handling
3. Complete PDF implementation or remove from options

### Testing After Fix:
- [ ] No duplicate code between files
- [ ] All export formats work correctly
- [ ] DOCX library loads reliably
- [ ] PDF export works or is removed

### Notes:
_Recommend consolidation for simpler maintenance._

---

## 12. injected.js
**Status:** ⬜ Not Started  
**Priority:** 🔵 Low  
**Estimated Time:** 1-2 hours  
**Dependencies:** None

### Issues to Fix:
- [ ] **INJ-001:** Add error handling to all functions
- [ ] **INJ-002:** Add result caching
- [ ] **INJ-003:** Add more helper functions

### Changes Required:
1. Wrap all functions in try-catch, return null on error
2. Implement WeakMap cache for selector → element lookups
3. Add helpers: highlight, scrollTo, getText, isVisible, getAttributes

### Testing After Fix:
- [ ] Invalid selectors don't crash page
- [ ] Repeated queries use cache
- [ ] New helpers work correctly

### Notes:
_Low priority but easy wins for better performance._

---

## 13. popup.html
**Status:** ⬜ Not Started  
**Priority:** 🔵 Low  
**Estimated Time:** 2-3 hours  
**Dependencies:** popup.js fixes

### Issues to Fix:
- [ ] **HTML-001:** Fix emoji encoding issues
- [ ] **HTML-002:** Add accessibility features (ARIA labels, keyboard nav)
- [ ] **HTML-003:** Add loading states
- [ ] **HTML-004:** Add empty states

### Changes Required:
1. Replace emoji with HTML entities or icon fonts
2. Add ARIA labels to all buttons and inputs
3. Add loading indicators for async operations
4. Add empty state messages for no data scenarios

### Testing After Fix:
- [ ] Emojis display correctly everywhere
- [ ] Screen reader can navigate entire UI
- [ ] Loading states show during operations
- [ ] Empty states display when no data

### Notes:
_Test with NVDA or VoiceOver screen reader._

---

## 14. popup.css
**Status:** ⬜ Not Started  
**Priority:** 🔵 Low  
**Estimated Time:** 1-2 hours  
**Dependencies:** popup.html fixes

### Issues to Fix:
- [ ] **CSS-001:** Add reduced motion support
- [ ] **CSS-002:** Add high contrast mode support
- [ ] **CSS-003:** Add print styles (if needed)

### Changes Required:
1. Add `@media (prefers-reduced-motion: reduce)` to disable animations
2. Add `@media (forced-colors: active)` for high contrast mode
3. Add print stylesheet if popup needs to be printable

### Testing After Fix:
- [ ] Animations disable with reduced motion setting
- [ ] High contrast mode works properly
- [ ] Print styles work if needed

### Notes:
_Test with Windows High Contrast mode and macOS Reduce Motion._

---

## 15. review-standalone.html
**Status:** ⬜ Not Started  
**Priority:** 🔵 Low  
**Estimated Time:** 2-3 hours  
**Dependencies:** review-standalone.js fixes

### Issues to Fix:
- [ ] **HTML-001:** Fix emoji encoding issues
- [ ] **HTML-002:** Add accessibility features
- [ ] **HTML-003:** Add loading states
- [ ] **HTML-004:** Add empty states

### Changes Required:
Same as popup.html - see #13 above

### Testing After Fix:
Same tests as popup.html

### Notes:
_Can apply same fixes as popup.html for consistency._

---

## 16. review-standalone.css
**Status:** ⬜ Not Started  
**Priority:** 🔵 Low  
**Estimated Time:** 2-3 hours  
**Dependencies:** review-standalone.html fixes

### Issues to Fix:
- [ ] **CSS-001:** Add reduced motion support
- [ ] **CSS-002:** Add high contrast mode support
- [ ] **CSS-003:** Add print styles for reports

### Changes Required:
Same as popup.css plus extensive print styles for report printing

### Testing After Fix:
- [ ] Same as popup.css
- [ ] Report prints correctly with all steps

### Notes:
_Print styles are more important here since users will want to print reports._

---

## 17. package.json
**Status:** ⬜ Not Started  
**Priority:** 🔵 Low  
**Estimated Time:** 1 hour  
**Dependencies:** All other fixes complete

### Issues to Fix:
- [ ] **PKG-002:** Document or remove WebLLM dependency
- [ ] **PKG-003:** Add build/package scripts
- [ ] **PKG-004:** Add dev dependencies (ESLint, Prettier)

### Changes Required:
1. Document WebLLM as future feature or remove if not using
2. Add scripts: build, dev, package, clean, test, lint
3. Add eslint, prettier, testing libraries
4. Create webpack.config.js if bundling

### Testing After Fix:
- [ ] Build script produces dist folder
- [ ] Package script creates .zip for Chrome Store
- [ ] Lint catches code quality issues
- [ ] Tests run successfully

### Notes:
_Set this up last once all code fixes are complete._

---

## Progress Tracking Commands

### Mark File as In Progress:
```bash
# Update status to 🟡 In Progress
# Note start time
```

### Mark File as Complete:
```bash
# Update status to ✅ Complete
# Note completion time
# Update Quick Stats
# Check off all issues
```

### Mark File as Blocked:
```bash
# Update status to ⚠️ Blocked
# Note blocking dependency
# Move to fix blocker first
```

---

## Next Steps

1. **Choose first file to fix:** manifest.json (easiest, highest impact)
2. **Create branch:** `fix/manifest-json`
3. **Fix all issues in that file**
4. **Test thoroughly**
5. **Update this tracker**
6. **Move to next file**

---

**Ready to start?** Let me know which file you'd like to fix first!