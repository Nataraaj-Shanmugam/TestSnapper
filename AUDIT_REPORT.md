# TestSnapper — Independent Codebase Audit
**Date:** 2026-07-01  
**Branch:** `fix/v1.1.6-parallel-fixes`  
**Method:** 4 parallel specialist audit teams, 5–6 personas each, covering all 26 source files independently (no reference to prior issue lists)

---

## Severity Summary

| Severity | Count |
|----------|-------|
| 🔴 CRITICAL | 3 |
| 🟠 HIGH | 30 |
| 🟡 MEDIUM | 32 |
| 🔵 LOW | 30 |
| **Total** | **95** |

---

## 🔴 CRITICAL

---

### CRIT-001 — `exportToFormat()` does not exist on `ExportService`
- **Area:** Background / Export
- **File:** `src/background/background.js:1314`
- **What:** The `'exportSession'` message case calls `exportService.exportToFormat(session, steps, message.format)`. `ExportService` has no `exportToFormat()` method — the correct API is `exportSession(sessionId, format, progressCallback)`.
- **Why:** Every export dispatched through the background handler throws `TypeError: exportService.exportToFormat is not a function`. The outer try/catch silently returns `{ success: false }`. No export from the review page (which routes through background) ever succeeds.
- **Fix:** Replace with `await exportService.exportSession(session.sessionId, message.format)` or remove the entire case (the comment at line 1193 already states "Both UIs export locally").

---

### CRIT-002 — Export cancellation guard always passes — pre-cancel is permanently broken
- **Area:** Export
- **File:** `src/core/export-service.js:99` then `:107`
- **What:** `exportSession()` calls `this._clearCancellation(sessionId)` at line 99, then immediately checks `this._isCancelled(sessionId)` at line 107. Because the Set entry was just deleted, `_isCancelled` always returns `false`.
- **Why:** It is impossible to pre-cancel an export. Calling `cancelExport()` before `exportSession()` is invoked is silently discarded. The guard on line 107 is permanently dead code.
- **Fix:** Remove `_clearCancellation(sessionId)` from the start of `exportSession()`; only call it after the export is done or cleanly cancelled.

---

### CRIT-003 — PDF export format option absent from popup — advertised feature inaccessible
- **Area:** UI / Feature Gap
- **File:** `src/ui/popup/popup.html:114–128`
- **What:** The popup's Export tab offers only DOCX, JSON, CSV radio buttons. There is no PDF option. `manifest.json` description and docs advertise PDF as a first-class format. `ExportService` has a full `case 'pdf':` implementation.
- **Why:** PDF export is completely inaccessible from the popup (the primary export surface). The feature works only via the review page dropdown.
- **Fix:** Add `<label><input type="radio" name="format" value="pdf"> PDF</label>` to the popup's format radio group.

---

## 🟠 HIGH

---

### HIGH-001 — Session rename permanently deletes all screenshots
- **Area:** Storage / FileSync
- **File:** `src/core/file-sync.js:738` / `src/core/fs-storage.js:365`
- **What:** On rename, `writeSession` detects `existingFolder.name !== newFolderName`, calls `handle.removeEntry(existingFolder.name, { recursive: true })` (deleting the entire folder + `screenshots/` subdirectory), then creates an empty new folder. `_extractAssets()` (called by `updateSessionName`) always returns `[]` for filesystem sessions because it only collects steps with inline `step.screenshot`, never `step.screenshotFile`.
- **Why:** Every session rename permanently and silently destroys all screenshots. `screenshotFile` paths in `session.json` point to files that no longer exist.
- **Fix:** Before removing the old folder, copy all binary files from its `screenshots/` subdirectory into the new folder, or do an atomic two-phase copy-then-delete.

---

### HIGH-002 — `isModalOpen` is never set to `true` — event suppression never activates
- **Area:** Content Script / Recording
- **File:** `src/content/content.js:57` (initialized), never written
- **What:** `isModalOpen` is initialized to `false` and set to `false` in cleanup, but never set to `true` before `showManualEntryModal` is called. Every event handler guard includes `|| isModalOpen` but the condition never fires.
- **Why:** During the field-name modal, clicks/inputs/changes are NOT suppressed. Concurrent user interactions race with the open modal's `await`, producing steps with incorrect or empty field names and interleaved in wrong order.
- **Fix:** Set `isModalOpen = true` before calling `showManualEntryModal` in `processStepWithManualEntry` and restore `false` after the `await`.

---

### HIGH-003 — `processStepWithManualEntry` sets `isRecording = false` instead of `isModalOpen = true`
- **Area:** Content Script / Recording
- **File:** `src/content/content.js:586–603`
- **What:** To suppress events during a modal, the function sets `isRecording = false` and `wasRecording`. But event handlers check `isModalOpen` (not `isRecording`) for suppression. Setting `isRecording = false` breaks the 15-second heartbeat validator which may call `stopRecording()` when it sees `isRecording === false` with an active `currentSessionId`.
- **Why:** The wrong flag is toggled. Events are not suppressed (due to HIGH-002), and the transient `isRecording = false` state can trigger spurious `stopRecording()` via the heartbeat.
- **Fix:** Replace the `isRecording = false / true` toggle with `isModalOpen = true / false` (after also fixing HIGH-002 to make the flag actually work).

---

### HIGH-004 — `isPaused` never reset to `false` in `stopRecording()`
- **Area:** Content Script / State
- **File:** `src/content/content.js:1229–1256`
- **What:** `stopRecording()` resets `isRecording = false`, `currentSessionId = null`, etc. but never resets `isPaused`. If the user paused and then stopped, `isPaused` remains `true` for the next recording session in the same tab.
- **Why:** On the next recording, `if (!isPaused) recordingSeconds++` never fires — the timer stays at 0 forever, making the elapsed-time display show 0:00 throughout the entire session.
- **Fix:** Add `isPaused = false;` to the cleanup block in `stopRecording()`.

---

### HIGH-005 — `mousemove`/`mouseup` drag listeners bypass `AbortController` — accumulate on stop/start
- **Area:** Content Script / Memory
- **File:** `src/content/content.js:1445–1447`
- **What:** `handleMouseDown` adds `document.addEventListener('mousemove', ...)` and `document.addEventListener('mouseup', ...)` without the `{ signal: eventListenerController.signal }` option used by every other listener. `AbortController.abort()` in `stopRecording()` does not clean them up.
- **Why:** On repeated start/stop cycles, orphaned `mousemove`/`mouseup` handlers accumulate on `document`. After 10 start/stop cycles, 10 pairs of stale drag handlers remain attached.
- **Fix:** Pass `{ signal: eventListenerController.signal }` to both drag listeners, or use a panel-scoped `AbortController` aborted in `removeRecordingIndicator()`.

---

### HIGH-006 — `afterScreenshot` only restores `floatingPanelContainer` — modal/toast hosts stay hidden
- **Area:** Content Script / Screenshot
- **File:** `src/content/content.js:1590–1598`
- **What:** `beforeScreenshot` hides all `[id^="testsnapper-"]` elements (panel, modal hosts, toast host). `afterScreenshot` restores only `floatingPanelContainer.style.display = 'block'`. Any modal or toast host hidden at screenshot time is never restored.
- **Why:** If a modal is open when a screenshot fires (auto-screenshot timer), the modal host stays `display:none` after the screenshot. The modal overlay disappears permanently and any queued field-name modals are lost.
- **Fix:** In `afterScreenshot`, re-query all `[id^="testsnapper-"]` elements and restore their original `display` values (track them in a list during `beforeScreenshot`).

---

### HIGH-007 — `innerHTML` concatenation with `action` variable — latent XSS
- **Area:** Content Script / Security
- **File:** `src/content/content.js:488–496`
- **What:** `modalDiv.innerHTML = [..., '<strong>' + action + '</strong>', ...].join('')`. `action` is currently always an internal constant string (e.g., `'click'`, `'type'`). But the pattern is one refactor away from injection if `action` ever comes from DOM data.
- **Why:** If any future code path sets `action` from element content or external data, this becomes a persistent XSS vector inside a Shadow DOM on every recorded page.
- **Fix:** Set the `<strong>` element's `textContent = action` after the `innerHTML` assignment rather than concatenating into HTML.

---

### HIGH-008 — `[data-testid]` hardcoded in selector regardless of matched attribute
- **Area:** Selector Engine
- **File:** `src/content/selector.js:287`
- **What:** `_addTestIdSelectors` reads from four attributes (`data-testid`, `data-test-id`, `data-cy`, `data-testid` via dataset). Regardless of which attribute was matched, the generated CSS selector always uses `[data-testid="..."]`.
- **Why:** An element with `data-cy="login-btn"` generates `[data-testid="login-btn"]`. `_isUnique` returns `false` (no element matches). The exported selector is invalid and will fail in any test runner.
- **Fix:** Track the source attribute name and use it in the generated selector (e.g., `[data-cy="..."]` when sourced from `data-cy`).

---

### HIGH-009 — `[[ngModel]]` and `bind:value` / `on:click` / `:binding` produce invalid CSS selectors
- **Area:** Selector Engine
- **File:** `src/content/selector.js:438` (Angular), `:461–498` (Svelte/Solid), `:414–425` (Vue)
- **What:** Three framework-specific selector paths generate CSS with double brackets (`[[ngModel]]`), colon-prefixed attribute names (`[bind:value]`, `[on:click]`, `[:class]`). All are syntactically invalid CSS.
- **Why:** `document.querySelectorAll()` throws `SyntaxError` on these strings. `_isUnique` catches the error and returns `false`. Exported selectors will throw in every test framework.
- **Fix:** Escape brackets (`[\[ngModel\]]`), escape colons (`[bind\:value]`), and skip Vue shorthand colon-prefix attributes in the CSS selector path (emit documentation-only candidates instead).

---

### HIGH-010 — `aria-labelledby` with multiple space-separated IDs silently fails
- **Area:** Field Name Resolver
- **File:** `src/content/field-name-resolver.js:209`
- **What:** `document.getElementById(ariaLabelledBy)` receives the full attribute value (e.g., `"label-id description-id"`). No element has a space in its ID, so `getElementById` returns `null` for any multi-value `aria-labelledby`.
- **Why:** Fields on modern accessible forms (which often use compound `aria-labelledby` pointing to heading + description) silently fall back to less-specific field name strategies, producing poor step descriptions.
- **Fix:** Split `ariaLabelledBy` on whitespace and look up each ID separately, concatenating the text content.

---

### HIGH-011 — `aria-describedby` used as field label (wrong semantic)
- **Area:** Field Name Resolver
- **File:** `src/content/field-name-resolver.js:215–221`
- **What:** `_fromAriaAttributes` falls through to `aria-describedby` and returns its text as the field's display name. `aria-describedby` is semantically a *description* (e.g., "Password must be 8 characters"), not a label.
- **Why:** Steps record "Password must be 8 characters" as the field name instead of "Password", producing meaningless test documentation.
- **Fix:** Remove `aria-describedby` from `_fromAriaAttributes`, or relegate it to a lowest-priority fallback with a score penalty.

---

### HIGH-012 — Phone pattern matches non-phone data (order numbers, tracking codes)
- **Area:** Redactor / Privacy
- **File:** `src/content/redactor.js:46`
- **What:** `phonePattern = /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/` matches any 10-digit number group: order numbers, tracking IDs, product codes, ZIP+4 codes.
- **Why:** Legitimate non-PII data is aggressively masked in recordings, corrupting the step's captured value silently. Users cannot tell why their order ID appears as bullets.
- **Fix:** Gate phone masking behind a field-context check (name/id/label contains `phone`, `mobile`, `tel`, `cell`, `fax`) matching the `looksFinancial` pattern on line 143.

---

### HIGH-013 — CSS class name inclusion in `shouldIgnoreField` causes false positives
- **Area:** Redactor / Privacy
- **File:** `src/content/redactor.js:78`
- **What:** `shouldIgnoreField` concatenates `element.className` into the attribute string tested against all `sensitivePatterns`. Patterns like `/auth/i` and `/token/i` match CSS class names like `auth-button`, `token-input-wrapper`, `authorization-panel`.
- **Why:** Entire form fields are fully redacted (value replaced with `••••••••`) when their CSS classes contain common words like "auth" or "token", even if the field contains non-sensitive data.
- **Fix:** Remove `element.className` from the `shouldIgnoreField` attribute concatenation, or test class names only against a much tighter set of explicit PII-focused patterns.

---

### HIGH-014 — `_exportPDF` never receives `notify` callback — progress stuck at 90%
- **Area:** Export
- **File:** `src/core/export-service.js:144`
- **What:** The PDF `case` in `exportSession()` calls `this._exportPDF(exportData, sessionId)` without passing `notify`. The progress bar is notified once at 90% before the call but never again during (potentially long) PDF generation.
- **Why:** For large sessions, the progress UI stalls at 90% for the entire PDF render with no feedback. The cancel button appears active but progress never updates.
- **Fix:** Pass `notify` as the third argument to `_exportPDF` and add per-step `notify` calls inside the step loop, matching `_exportDOCXHtml`.

---

### HIGH-015 — `'markdown'` case missing from `exportSession()` switch — throws on every Markdown export
- **Area:** Export
- **File:** `src/core/export-service.js:130–148`
- **What:** The switch handles `'json'`, `'csv'`, `'docx'`, `'pdf'` only. Passing `format: 'markdown'` falls through to `default` and throws `Unsupported format: markdown`. Markdown is listed as a supported format in `CLAUDE.md` and advertised in the extension.
- **Why:** Any Markdown export attempt crashes with an unhandled error, silently returning `{ success: false }` to the caller.
- **Fix:** Implement `_exportMarkdown(exportData, sessionId)` and add `case 'markdown':` to the switch, or remove all Markdown references from docs and UI.

---

### HIGH-016 — `_compressImage` is 80-line dead method, never called
- **Area:** Export / Dead Code
- **File:** `src/core/export-service.js:211–297`
- **What:** `_compressImage(blob, maxWidth, quality)` is a private method that duplicates `ImageProcessor`'s logic. No call site in the codebase invokes it. All active image processing goes through `ImageProcessor.processForExport`.
- **Why:** Dead code that will silently rot, confuse maintainers, and diverge from the live `ImageProcessor` path (it only produces JPEG, with no content-aware PNG selection).
- **Fix:** Delete `_compressImage` and `_blobToDataURL` (lines 195–297) entirely.

---

### HIGH-017 — `fetch(dataUrl)` round-trip in `ImageProcessor` doubles screenshot memory
- **Area:** Image Processing / Performance
- **File:** `src/core/image-processor.js:153` and `:237`
- **What:** `await fetch(dataUrl)` on a `data:` URI decodes the entire base64 payload into a Response body, then `.blob()` re-materializes it. Peak memory holds both the data-URL string and the decoded Blob simultaneously — ~2× the image size.
- **Why:** For 4 MB retina screenshots, this peaks at 8–12 MB of heap per compression call in the service worker. With auto-screenshots every second, this can OOM the service worker and kill the entire recording session.
- **Fix:** Replace `fetch(dataUrl).then(r => r.blob())` with a direct base64 decode using `atob()` + `Uint8Array` to build the Blob in a single pass.

---

### HIGH-018 — `{ alpha: false }` on canvas blackens transparent pixels in all exports
- **Area:** Image Processing
- **File:** `src/core/image-processor.js:248` and `:306`
- **What:** `canvas.getContext('2d', { alpha: false })` fills transparent pixels with black before drawing. Applied to screenshots that contain any transparency (dialog overlays, tooltips, custom dropdowns).
- **Why:** Any screenshot with transparent elements produces black artifacts in all DOCX/PDF exports. This affects virtually any modern web app using CSS transparency.
- **Fix:** Remove `{ alpha: false }` from both `getContext('2d', ...)` calls; use `willReadFrequently: true` instead if the edge-detection read hint is needed.

---

### HIGH-019 — `Utils.downloadFile` uses DOM APIs — crashes if called in service worker
- **Area:** Utils / Architecture
- **File:** `src/core/utils.js:68–78`
- **What:** `Utils.downloadFile` calls `document.createElement('a')` and `document.body.appendChild`. `Utils` is imported by `background.js` (service worker). If any code path in the background ever calls `Utils.downloadFile`, it throws `ReferenceError: document is not defined`.
- **Why:** `dom-utils.js` was created specifically to house DOM-dependent utilities, but `downloadFile` and `showMessage` remain in `utils.js` (the non-DOM module), making the import boundary unsafe.
- **Fix:** Remove `downloadFile` and `showMessage` from `utils.js`; update all call sites to import from `dom-utils.js`.

---

### HIGH-020 — `unescape()` is deprecated — fails in strict environments and on large content
- **Area:** Utils
- **File:** `src/core/utils.js:69` / `src/core/dom-utils.js:14`
- **What:** `btoa(unescape(encodeURIComponent(content)))` uses the long-deprecated `unescape()`. For large exports (~10 MB JSON), the intermediate percent-encoded string is ~30 MB, and passing a 30 MB data-URI to `<a href>` silently fails in Chrome (data-URI size limit).
- **Why:** Large session exports produce corrupt or blank download files. `unescape()` is formally removed from strict-mode TypeScript and Deno.
- **Fix:** Replace with `URL.createObjectURL(new Blob([content], { type: mimeType }))` and revoke after click; this handles arbitrary sizes without data-URI limits.

---

### HIGH-021 — 9 file-sync DOM IDs referenced in `popup.js` are absent from `popup.html`
- **Area:** UI / Popup
- **File:** `src/ui/popup/popup.js:63–68`
- **What:** `setStorageFolderBtn`, `reauthorizeFolderBtn`, `syncIndicator`, `syncFolderName`, `fileSyncStatus`, `storageOnboarding`, `storageReauthBanner`, `onboardingPickFolderBtn`, `onboardingReauthBtn` are all `document.getElementById(...)` calls in JS whose target IDs do not exist in `popup.html`.
- **Why:** The entire file-sync setup flow (pick folder, re-authorize, onboarding banner, sync status indicator) is invisible to the user. `checkFileSyncStatus()` and `updateSyncUI()` run on every popup open but silently do nothing. Filesystem storage is effectively unconfigurable from the popup.
- **Fix:** Add the missing folder-setup UI section to `popup.html` (onboarding banner, re-auth banner, sync status, Set Folder / Re-authorize buttons).

---

### HIGH-022 — `updateStorageUsage()` is an explicit async no-op — bar shows "Calculating…" forever
- **Area:** UI / Popup
- **File:** `src/ui/popup/popup.js:342`
- **What:** `async function updateStorageUsage() { }` — empty body. Called 4 times on various events. `popup.html:143–148` renders a visible `<div class="storage-usage">` with initial text "Calculating…" and a `<div id="storageUsageBar" style="width: 0%">`.
- **Why:** Users see a permanent "Calculating…" label and empty bar. The storage usage feature is visible in the UI but entirely broken.
- **Fix:** Implement the function (query `chrome.storage.local.getBytesInUse(null, ...)` and update the bar), or remove the `<div class="storage-usage">` block from `popup.html`.

---

### HIGH-023 — `screenshotCount` never tracked or returned from `getState()` — counter always 0
- **Area:** UI / Popup
- **File:** `src/ui/popup/popup.js:1021` / `src/background/background.js:69–74`
- **What:** `updateState()` reads `response.screenshotCount || 0`. `RecordingStateManager.getState()` returns only `{ state, session, stepCount }` — `screenshotCount` is never tracked or included.
- **Why:** The Screenshots stat counter in the recording panel always displays 0, regardless of how many screenshots have been captured.
- **Fix:** Add a `screenshotCount` field to `RecordingStateManager`, increment it in the screenshot capture path, and include it in `getState()`.

---

### HIGH-024 — Review page uses `StorageManager` (chrome.storage) not `FSStorageManager` — flushed sessions vanish
- **Area:** Architecture / Storage
- **File:** `src/ui/review/review-standalone.js:15`
- **What:** `review-standalone.js` imports `StorageManager`. Once the user configures filesystem storage, sessions are flushed from chrome.storage to disk. Re-opening the review page for a flushed session calls `storage.getSession(sessionId)` on chrome.storage which returns `null`.
- **Why:** Any session that has been flushed to the filesystem is permanently invisible from the review page. The page shows "Session not found" silently.
- **Fix:** Replace `import { StorageManager }` with `import { FSStorageManager }` in `review-standalone.js`, matching the popup.

---

### HIGH-025 — Review page has local `setupTheme`/`applyTheme` duplicating `theme.js`
- **Area:** UI / Theme
- **File:** `src/ui/review/review-standalone.js:120–152`
- **What:** The review page defines its own local `setupTheme()` and `applyTheme()` that are copy-pasted divergences from `theme.js`. The review version also writes to `chrome.storage.local` on toggle, while `theme.js` does not.
- **Why:** The two pages have diverged theme behavior. Any fix to `theme.js` is not reflected in the review page. The chrome.storage write in the review page creates a persistence inconsistency.
- **Fix:** Remove local `setupTheme`/`applyTheme` from `review-standalone.js` and import `{ setupTheme } from '../theme.js'`.

---

### HIGH-026 — `docs/` folder is copied into the extension build
- **Area:** Build
- **File:** `webpack.config.js:75`
- **What:** `{ from: 'docs', to: 'docs', noErrorOnMissing: true }` copies developer documentation into `dist/`, making it accessible as `chrome-extension://<id>/docs/index.html`.
- **Why:** Internal architecture documentation is exposed to anyone inspecting the installed extension. It also bloats the Chrome Web Store package unnecessarily.
- **Fix:** Remove the `docs` CopyPlugin entry from `webpack.config.js`.

---

### HIGH-027 — Arrow-key tab navigation activates tabs immediately — violates ARIA spec and fires `loadSessions()` on every keypress
- **Area:** UI / Accessibility
- **File:** `src/ui/popup/popup.js:190`
- **What:** The tablist keydown handler calls `activateTab(tabs[nextIndex])` on every ArrowRight/ArrowLeft press. Per ARIA Authoring Practices Guide (APG), arrow keys should only move focus; Enter/Space activate. The current pattern also triggers `loadSessions()` (a storage read) on every single arrow keypress through the tabs.
- **Why:** Rapid keyboard navigation fires 3–5 async storage reads. Screen readers announce tabs as activated when they should only be focused.
- **Fix:** In the keydown handler, only call `tabs[nextIndex].focus()` on arrow keys; let the existing click listener handle activation.

---

### HIGH-028 — Review page export progress modal broken — `finally` dismisses it before events arrive
- **Area:** UI / Review
- **File:** `src/ui/review/review-standalone.js:1082–1108`
- **What:** `handleSaveAndExport()` calls `showProgressModal()` then `await chrome.runtime.sendMessage(...)`. The `finally` block calls `hideProgressModal()` before any `exportProgress` messages arrive from the background. The background's `exportToFormat` call (broken by CRIT-001) also never sends progress events.
- **Why:** The progress modal flashes briefly and disappears immediately. The circular progress bar and cancel button are never functional.
- **Fix:** Let `handleExportProgress` own the modal lifecycle entirely (already handles `message.done`); remove `showProgressModal()`/`hideProgressModal()` from `handleSaveAndExport()`.

---

### HIGH-029 — `showMessageWithUndo` uses `display:block`; `showMessage`/`hideMessage` use `hidden` class — incompatible
- **Area:** UI / Review
- **File:** `src/ui/review/review-standalone.js:1119–1149`
- **What:** `showMessageWithUndo()` sets `messageDiv.style.display = 'block'`. `showMessage()` calls `Utils.showMessage()` which uses a `hidden` CSS class. `hideMessage()` sets `display = 'none'`. The three functions leave the div in different CSS states.
- **Why:** After `showMessageWithUndo`, calling `showMessage` may not correctly hide the undo message because both modify different properties. State inconsistency causes visible/hidden messages to appear in wrong combinations.
- **Fix:** Standardize on one visibility strategy (either class-based or inline style) across all three message helpers.

---

### HIGH-030 — `_permissions_comment` is an unknown manifest key — risks Chrome Web Store rejection
- **Area:** Manifest
- **File:** `manifest.json:20–22`
- **What:** A `"_permissions_comment": {...}` object at the manifest top level is an unsupported key in the MV3 schema.
- **Why:** The Chrome Web Store automated validator may reject the extension. Any strict manifest linter reports an error.
- **Fix:** Remove the `_permissions_comment` block; move the rationale to a `PERMISSIONS.md` file or a webpack.config.js comment.

---

## 🟡 MEDIUM

---

### MED-001 — Steps accepted while recording is paused
- **Area:** Background / Recording
- **File:** `src/background/background.js:968`
- **What:** `addStep()` checks `stateManager.session` existence and sender tab ID, but not `stateManager.state === 'paused'`. Events fired during a deliberate pause are silently accepted and written to storage.
- **Fix:** Add `if (stateManager.state !== 'recording') return { success: false };` at the top of `addStep()`.

---

### MED-002 — `addPendingFlush`/`removePendingFlush` unprotected read-modify-write race
- **Area:** Storage / FlushUtils
- **File:** `src/core/flush-utils.js:46–65`
- **What:** Both functions perform async read-modify-write on `testsnapper_pending_index` with no mutex. Concurrent calls can interleave reads and overwrites, silently losing a session ID from the index.
- **Fix:** Serialize both functions through a shared promise queue (same pattern as `StorageManager._enqueue`).

---

### MED-003 — `addPendingFlush` called before `buffer.createSession` confirms success
- **Area:** Storage / FSStorage
- **File:** `src/core/fs-storage.js:225–230`
- **What:** If `buffer.createSession` throws (e.g., quota exceeded), the session ID is already in the pending flush index. `flushSession` later finds no session data and returns `false`, but never removes the stale ID.
- **Fix:** Move `addPendingFlush` inside the `_enqueue` operation so it only runs after `createSession` succeeds, or add try/catch that calls `removePendingFlush` on failure.

---

### MED-004 — `var` state declarations placed far from their use inside guard block
- **Area:** Content Script / Maintainability
- **File:** `src/content/content.js:67–69` (use) vs `:994–995, 1088` (declaration)
- **What:** `lastNavigationUrl`, `isInitialNavigation`, and `sessionSettings` are assigned inside the `__testSnapperInitialized` guard block but their `var` declarations appear hundreds of lines later. `sessionSettings.captureOnNavigation` is accessed without a null-check if the guard block was never reached.
- **Fix:** Move all `var` declarations to the top of the file alongside other state declarations (lines 17–41).

---

### MED-005 — Dead `tabId` check block — multi-tab isolation never implemented
- **Area:** Content Script
- **File:** `src/content/content.js:1638–1648`
- **What:** `if (response.tabId) { /* comment only */ }` — the body is a comment. No actual tab comparison is performed. Multiple tabs with active sessions could each create a floating panel.
- **Fix:** Implement the tab comparison or remove the dead block and leave a `// TODO` comment.

---

### MED-006 — `importData` not wrapped in `_enqueue` — concurrent write race
- **Area:** Storage
- **File:** `src/core/storage.js:534–611`
- **What:** `importData` performs multiple sequential writes (`_writeMeta`, `_writeSessions`, `_writeSteps`, etc.) outside the serialization queue. A concurrent `addStep` from an in-flight message can interleave and partially overwrite import results.
- **Fix:** Wrap the entire `importData` body in `return this._enqueue(...)`.

---

### MED-007 — `_fromProximityText` TreeWalker unbounded on large DOMs — main thread blocks
- **Area:** Field Name Resolver / Performance
- **File:** `src/content/field-name-resolver.js:335–367`
- **What:** `_fromProximityText` creates a TreeWalker rooted at `element.parentElement || document.body`. On content-heavy pages, this walks thousands of text nodes synchronously per interaction, blocking the main thread for tens of milliseconds.
- **Fix:** Limit the walker root to 2–3 ancestor levels above the element rather than falling back to `document.body`.

---

### MED-008 — `_fromExplicitLabel` returns first label in parent's subtree, not associated one
- **Area:** Field Name Resolver
- **File:** `src/content/field-name-resolver.js:176–191`
- **What:** `parent.querySelector('label')` returns the first label in the parent subtree regardless of DOM position. In a multi-field form, all fields return the label of the first field.
- **Fix:** Verify the found label is directly associated with the target element (check `label.htmlFor === element.id` or `label.control === element`).

---

### MED-009 — `_fromButtonContext` includes icon glyphs in field name
- **Area:** Field Name Resolver
- **File:** `src/content/field-name-resolver.js:288–307`
- **What:** Returns `element.innerText` directly for buttons and links. `<button>Download ▼</button>` produces field name `"Download ▼"` including the icon glyph.
- **Fix:** Strip non-alphanumeric/non-space characters from the returned text before returning.

---

### MED-010 — `initFrameContext` never called — frame context strategy always returns null
- **Area:** Field Name Resolver
- **File:** `src/content/field-name-resolver.js:129–141`
- **What:** `_fromFrameContext` returns `this._cachedFrameLabel`, set only by `initFrameContext()`. No call site invokes `initFrameContext()`, so `_cachedFrameLabel` is always `null` and the strategy is permanently dead.
- **Fix:** Call `fieldNameResolver.initFrameContext()` in `_finishStartRecording` when `window !== window.top`, or remove the strategy.

---

### MED-011 — XPath `contains(text(), ...)` with unescaped quotes produces invalid XPath
- **Area:** Selector Engine
- **File:** `src/content/selector.js:554`
- **What:** `//button[contains(text(), "${text}")]` — if `text` contains a double-quote, the XPath string is invalid. `_isUniqueXPath` catches the error and returns `false`, so a broken XPath is stored as a candidate.
- **Fix:** Escape double-quotes using XPath's `concat()` trick, or replace `"` with `'` when the text doesn't also contain `'`.

---

### MED-012 — `_isGeneratedClass` pattern too narrow — Tailwind/Bootstrap/Emotion classes included as stable selectors
- **Area:** Selector Engine
- **File:** `src/content/selector.js:727–730`
- **What:** `_isGeneratedClass` only blocks `^(_|css-|sc-|makeStyles|jss\d)`. Tailwind (`text-sm`, `px-4`), Bootstrap (`col-md-6`), Emotion (`e123456`), and CSS Modules classes pass through and appear as CSS selector candidates despite being design-system utilities that change frequently.
- **Fix:** Expand the blocklist to include common utility class prefixes, or use a positive allowlist of class patterns considered stable.

---

### MED-013 — `redactStep` only scrubs steps where `isSensitive = true` — submit/navigate steps bypass redaction
- **Area:** Redactor / Privacy
- **File:** `src/content/redactor.js:166–175`
- **What:** `handleSubmit` (line 980) and navigation steps (line 1023) always pass `isSensitive: false`. `redactStep` only replaces values when `isSensitive === true`. Sensitive query parameters in URLs and sensitive form submission values are never redacted.
- **Fix:** In `redactStep`, also run the PII pattern scan against `redacted.value` unconditionally for all step types.

---

### MED-014 — `shouldIgnoreField` with `/ein/i` matches common words — false positives
- **Area:** Redactor / Privacy
- **File:** `src/content/redactor.js:39`
- **What:** `/ein/i` matches substrings of `klein`, `einstein`, `weinberg`, `feint`, `seine`. Fields with these strings in their name/id/label get fully redacted.
- **Fix:** Change to `/\bein\b/i` to require word boundaries, or match only the actual EIN format `/\bein\d{2}-\d{7}\b/i`.

---

### MED-015 — `emailPattern` matches email-like strings in URLs and template expressions
- **Area:** Redactor / Privacy
- **File:** `src/content/redactor.js:46`
- **What:** The email regex matches `user@host.com` embedded in `https://user@host.com/path` or Angular template `{{email@binding}}`. URL fields or template-display fields get aggressively masked.
- **Fix:** Add negative lookbehind for `://` and `{{` to exclude URL userinfo and template expression contexts.

---

### MED-016 — `FileReader` in `compressForStorage` has no `onerror` — silent hang on failure
- **Area:** Image Processing
- **File:** `src/core/image-processor.js:172–177`
- **What:** The offscreen compression path wraps `FileReader.readAsDataURL` in a Promise with only `onloadend`. If reading fails, the Promise never resolves or rejects — the `await` hangs indefinitely until the service worker is killed.
- **Fix:** Add `reader.onerror = () => reject(reader.error)` inside the Promise constructor.

---

### MED-017 — Double `convertToBlob` call for PNG auto-detection — wastes CPU/memory
- **Area:** Image Processing / Performance
- **File:** `src/core/image-processor.js:268–274`
- **What:** When format is `'auto'`, the code encodes PNG first (line 261), then unconditionally encodes JPEG as well (line 269) to compare sizes. Every auto-detected PNG that remains PNG pays for a full JPEG encode it doesn't need.
- **Fix:** Only encode JPEG if the PNG size exceeds the comparison threshold.

---

### MED-018 — `_blobToDataURL` and `_escapeHtml` duplicate `Utils` equivalents
- **Area:** Export / Dead Code
- **File:** `src/core/export-service.js:195–209` / `:333–343`
- **What:** Both are character-for-character duplicates of `Utils.blobToDataURL` and `Utils.escapeHtml`. Any security fix must be applied in two places.
- **Fix:** Import `Utils` in `export-service.js` and replace both private methods with calls to the shared utilities.

---

### MED-019 — CSV formula injection: embedded newlines not neutralized
- **Area:** Export / Security
- **File:** `src/core/export-service.js:383`
- **What:** `_csvSafeCell` prefixes dangerous first characters with apostrophe but does not strip or encode embedded `\n`/`\r` in cell values. A multiline field value can inject content onto the next CSV row.
- **Fix:** Strip or encode `\n` and `\r` within cell values before wrapping in quotes.

---

### MED-020 — `this._imgOpts` shared instance property — race between concurrent exports
- **Area:** Export
- **File:** `src/core/export-service.js:102`
- **What:** `_imgOpts` is assigned to `this` (shared singleton). If two export calls overlap (edge case), the second call overwrites `_imgOpts` while the first export is mid-stream, silently switching image quality settings.
- **Fix:** Return `imgOpts` from `_resolveExportImageOpts()` and pass it as a local variable into each `_export*` method.

---

### MED-021 — `dom-utils.js` is entirely dead code — no import site anywhere in `src/`
- **Area:** Architecture / Dead Code
- **File:** `src/core/dom-utils.js`
- **What:** Zero files in `src/` import from `dom-utils.js`. Both functions (`downloadFile`, `showMessage`) are duplicated in `utils.js` and called from there. The module created to separate DOM utilities from pure utilities has no consumers.
- **Fix:** Update `review-standalone.js` to import `showMessage` from `dom-utils.js`; update `popup.js` or other callers of `Utils.downloadFile`; then remove the duplicates from `utils.js`.

---

### MED-022 — Modal queue uses unnecessary 100ms `setTimeout` between entries
- **Area:** Content Script
- **File:** `src/content/content.js:374`
- **What:** `processModalQueue` chains with `setTimeout(() => processModalQueue(), 100)` between modals. The 100ms gap is unnecessary and `setTimeout` callbacks survive after `stopRecording()` clears the queue (harmless but wasteful).
- **Fix:** Call `processModalQueue()` directly, with an `isRecording` guard at the top.

---

### MED-023 — Theme `data-theme` set on `<body>` by `theme.js` but on `<html>` by `theme-init.js` — split state
- **Area:** UI / Theme
- **File:** `src/ui/theme-init.js:14` vs `src/ui/theme.js:11`
- **What:** `theme-init.js` sets `document.documentElement.dataset.theme`. `theme.js` and the review page's local `applyTheme` update `document.body.dataset.theme`. `dark-mode`/`light-mode` classes added to `<html>` by `theme-init.js` are never removed or toggled by subsequent `applyTheme()` calls.
- **Fix:** Standardize on `document.documentElement` everywhere; in `theme.js`'s `applyTheme`, also update `document.documentElement.classList` to swap `dark-mode`/`light-mode`.

---

### MED-024 — Popup footer version `v1.1.5` hardcoded — will desync on every release
- **Area:** Build / Versioning
- **File:** `src/ui/popup/popup.html:295` / `manifest.json:6`
- **What:** `popup.html` has `<p>TestSnapper v1.1.5</p>` hardcoded. `manifest.json` has `"version": "0.0.0"` as a placeholder (injected at build time from `package.json`). The HTML footer is not transformed.
- **Fix:** In `popup.js`'s `init()`, read `chrome.runtime.getManifest().version` and set the footer text dynamically.

---

### MED-025 — UI files not transpiled via Babel — polyfills missing for Chrome 88
- **Area:** Build
- **File:** `webpack.config.js:63`
- **What:** UI files (`popup.js`, `review-standalone.js`, etc.) are copied as-is by CopyPlugin, not processed by `babel-loader`. Babel's `targets: { chrome: '88' }` config only applies to the bundled `background.js`.
- **Fix:** Add UI entry points to webpack so they are also transpiled, or raise `minimum_chrome_version` in the manifest to explicitly document the real minimum.

---

### MED-026 — Popup DOM queries at module scope — null refs can crash before DOMContentLoaded
- **Area:** UI / Popup
- **File:** `src/ui/popup/popup.js:43–62`
- **What:** All button constants (`startBtn`, `pauseBtn`, etc.) are queried at module parse time. `setupEventListeners()` calls `.addEventListener()` on these without null-guards. If any element is absent, the popup throws `TypeError: Cannot read properties of null` and becomes entirely non-functional.
- **Fix:** Move all `getElementById` calls inside `init()` (after `DOMContentLoaded`), or add null-checks in `setupEventListeners()`.

---

### MED-027 — `webRequest` permission in MV3 requires Chrome Web Store justification
- **Area:** Manifest / Security
- **File:** `manifest.json:18`
- **What:** `webRequest` in MV3 grants broad network observation. The CWS requires explicit justification for this permission and may reject the submission without one.
- **Fix:** Verify whether `declarativeNetRequest` can replace `webRequest` for the API capture feature; if not, document the justification in a `PRIVACY_POLICY.md` / store listing.

---

### MED-028 — Undo implemented but redo never built — history future-truncation code is dead
- **Area:** UI / Review
- **File:** `src/ui/review/review-standalone.js:432–475`
- **What:** `saveToHistory` correctly truncates future states (`history.slice(0, historyIndex + 1)`) for a redo-aware stack, but `redo()` is never implemented and no Redo button exists. Ctrl+Shift+Z does nothing.
- **Fix:** Implement `redo()` with Ctrl+Shift+Z binding and a redo button, or simplify `saveToHistory` to a simple stack without future truncation.

---

### MED-029 — `aria-labelledby` uses multi-value attribute single-element lookup
- **Area:** UI / Accessibility
- **File:** `src/ui/popup/popup.html` and `src/ui/review/review-standalone.html`
- **What:** Tab buttons lack `aria-controls` pointing to their panel IDs. Tab panels lack `role="tabpanel"` and `aria-labelledby`. Screen readers cannot associate tabs with their content panes.
- **Fix:** Add `aria-controls="recording-tab"` (etc.) to each tab button; add `role="tabpanel" aria-labelledby="<button-id>"` to each panel.

---

### MED-030 — `handleSubmit` error message says "click" not "submit" — wrong copy-paste label
- **Area:** Content Script / Debugging
- **File:** `src/content/content.js:987`
- **What:** The catch block in `handleSubmit` logs `'❌ Error capturing click:'`. Copy-pasted from `handleClick`.
- **Fix:** Change to `'❌ Error capturing submit:'`.

---

### MED-031 — `SettingsManager.save()` falsy-zero check silently skips validation
- **Area:** Background / Settings
- **File:** `src/background/background.js:213, 217, 221`
- **What:** `if (validated.screenshotSeconds)`, `if (validated.maxSessions)`, `if (validated.imageQuality)` skip validation when the value is `0`. `screenshotSeconds: 0` can cause divide-by-zero or immediate auto-screenshot loops.
- **Fix:** Replace with `!== undefined` checks throughout.

---

### MED-032 — `_fromProximityText` TreeWalker returns element's own text as label
- **Area:** Field Name Resolver
- **File:** `src/content/field-name-resolver.js:336–367`
- **What:** The TreeWalker is rooted at `element.parentElement` which includes text nodes inside the element itself. For `<button>Click me</button>`, the walker finds "Click me" as a "nearby" label and returns it.
- **Fix:** Add `if (element.contains(node.parentElement)) continue;` inside the walker loop to skip descendant text nodes.

---

## 🔵 LOW

---

### LOW-001 — Dead imports (`validateSettings`, `shouldRecordRequest`) in background.js
- **File:** `src/background/background.js:13`
- **What:** Both are imported from `recorder-utils.js` but never used. `ApiCapture._shouldRecord()` re-implements `shouldRecordRequest` inline.
- **Fix:** Remove the imports; wire `ApiCapture._shouldRecord` to call the shared `shouldRecordRequest` instead.

---

### LOW-002 — `importData` outside `_enqueue` — concurrent write race
- **File:** `src/core/storage.js:534`
- (Covered in MED-006; filed separately for the StorageManager class context)

---

### LOW-003 — O(n²) string concatenation in `_readScreenshot`
- **File:** `src/core/file-sync.js:524–528`
- **What:** `for (let i; ...) binary += String.fromCharCode(bytes[i])` — 2M string allocations for a 2 MB screenshot. `compression.js` already uses the correct chunked `String.fromCharCode.apply` pattern.
- **Fix:** Use `String.fromCharCode.apply(null, bytes.subarray(i, i + 8192))` in 8KB chunks.

---

### LOW-004 — `_checkUnlimited()` defined but never called — quota UI always shows 500 MB cap
- **File:** `src/core/quota-monitor.js:83–95`
- **What:** `_checkUnlimited` was presumably intended to adjust `maxBytes` for `unlimitedStorage` users. It is dead. Users with the `unlimitedStorage` permission still see the 500 MB cap.
- **Fix:** Call `_checkUnlimited()` in `getStorageUsage()` and adjust `total` accordingly, or delete it.

---

### LOW-005 — `checkAndNotify()` in `QuotaMonitor` is dead and has unhandled promise rejection
- **File:** `src/core/quota-monitor.js:131–154`
- **What:** Never called anywhere. Also calls `chrome.runtime.sendMessage(...)` without `await` inside a try/catch — any rejection becomes an unhandled promise rejection.
- **Fix:** Delete `checkAndNotify` or wire it to a `chrome.alarms` handler; if kept, add `.catch(() => {})` to the sendMessage call.

---

### LOW-006 — `updateAllSteps` populates then immediately invalidates the steps cache
- **File:** `src/core/storage.js:987–1004`
- **What:** `_writeSteps(...)` sets the cache via `_cacheSteps`; the very next line `this._stepsCache.delete(sessionId)` invalidates it. The next read triggers a full decompress.
- **Fix:** Remove the `_stepsCache.delete` line (the write already set the correct cached value).

---

### LOW-007 — apicall dedup doesn't compare `apiStatus` — success/error consecutive calls merged
- **File:** `src/core/step-utils.js:28–44` / `src/core/recorder-utils.js:40–64`
- **What:** Two consecutive API calls to the same endpoint with different HTTP status codes (200 then 500) are treated as duplicates. The error-response step is dropped.
- **Fix:** Add `&& prev.apiStatus === curr.apiStatus` to the duplicate condition.

---

### LOW-008 — `console.error` in `compression.js` bypasses `Logger` abstraction
- **File:** `src/core/compression.js:138`
- **What:** `console.error('Decompression failed:', error)` bypasses the configurable log-level system. It prints in production even when Logger is silenced.
- **Fix:** Replace with `Logger.error('Decompression failed:', error)`.

---

### LOW-009 — `_extractAssets` is dead code for all non-legacy filesystem sessions
- **File:** `src/core/fs-storage.js:985–1001`
- **What:** Returns `[]` for every modern session (which use `step.screenshotFile`, not inline `step.screenshot`). All call sites pass an empty array to `writeSession` — the method's intent is never realized.
- **Fix:** Remove `_extractAssets` and pass `[]` directly at call sites, with a comment explaining screenshots live on `step.screenshotFile`.

---

### LOW-010 — `deleteSessionFolder` doesn't update `sessions.json`
- **File:** `src/core/file-sync.js:929–945`
- **What:** Legacy method deletes the folder but leaves the session in `sessions.json`. The session reappears on next load as a ghost entry pointing to deleted files.
- **Fix:** Either delete the method (no active callers) or add the `sessions.json` index update matching `deleteSession()`.

---

### LOW-011 — `:has()` CSS pseudo-class used in `findNearbyText` — unsupported in Chrome 88–104
- **File:** `src/content/content.js:204`
- **What:** `div:not(:has(*))` requires Chrome 105+. On Chrome 88–104, `querySelectorAll` throws a `SyntaxError`. No try/catch wraps this call.
- **Fix:** Replace with `Array.from(...querySelectorAll('div')).filter(el => el.children.length === 0)`.

---

### LOW-012 — React legacy attributes (`data-reactid` etc.) only exist in React 15 (deprecated 2016)
- **File:** `src/content/selector.js:382–397`
- **What:** `_addFrameworkSelectors` searches for `data-reactid`, `data-react-checksum`, `data-reactroot`. React 16+ (2017–present) does not use these. The `__reactFiber` detection (line 382) correctly identifies modern React, but the attribute-search code that follows always produces no candidates.
- **Fix:** Remove obsolete legacy React attribute checks; focus detection on the `__reactFiber` presence and fallback to `data-testid`.

---

### LOW-013 — `_fromFormGroup` misses `aria-labelledby` on group roles
- **File:** `src/content/field-name-resolver.js:244–261`
- **What:** Only reads `aria-label` from `role="group"` elements; misses `aria-labelledby` pointing to external headings. Form groups labeled via `aria-labelledby` return null.
- **Fix:** Add `aria-labelledby` resolution alongside `aria-label` in `_fromFormGroup`.

---

### LOW-014 — `_fromElementText` 100-char threshold allows paragraph-length field names
- **File:** `src/content/field-name-resolver.js:315–325`
- **What:** Returns `element.innerText` for any text under 100 characters. Clickable card elements with 90-char descriptions get the paragraph as their field name.
- **Fix:** Reduce threshold to 50 characters, matching the text-selector length limit used in `selector.js`.

---

### LOW-015 — DOB pattern replacement uses 4-digit mask for 2-digit year
- **File:** `src/content/redactor.js:52`
- **What:** `dobPattern` matches `MM/DD/YY` (2-digit year) but the replacement is `**/**/****` (4 asterisks for year). `12/25/99` becomes `**/**/****` — length-inaccurate mask.
- **Fix:** Use a replacement function that produces length-accurate masking.

---

### LOW-016 — `routingPattern` is a public instance property — bypasses financial context guard
- **File:** `src/content/redactor.js:51`
- **What:** The raw 9-digit pattern is accessible as `redactor.routingPattern`. Without the `looksFinancial` guard used in `maskValue`, external callers get false positives on any 9-digit number.
- **Fix:** Rename to `_routingPattern` and add a JSDoc comment warning against direct use.

---

### LOW-017 — Absolute XPath candidates marked `isUnique: true` without verification
- **File:** `src/content/selector.js:242` / `:297`
- **What:** Both the ID-XPath and testId-XPath candidates hardcode `isUnique: true` without calling `_isUniqueXPath`. On pages with duplicate IDs or shared testid values, these produce false-unique selectors that match multiple elements.
- **Fix:** Replace `isUnique: true` with `this._isUniqueXPath(xpathExpression, element)` at both sites.

---

### LOW-018 — Class filter anchored with `^` — misses state classes in compound names
- **File:** `src/content/selector.js:514`
- **What:** `!c.match(/^(ng-|is-|has-|active|selected|focus|hover|disabled)/)` uses `^` anchor, missing `btn-active`, `option-disabled`, `has-content` patterns. Also case-sensitive — `Active` passes through.
- **Fix:** Use case-insensitive, unanchored match or a Set-based blocklist.

---

### LOW-019 — `_addTextSelectors` only covers 4 element tags — misses common clickable elements
- **File:** `src/content/selector.js:550`
- **What:** Text-based selectors only generated for `['button', 'a', 'span', 'div']`. Skips `<li role="option">`, `<td>`, `<label>`, `<p>`, custom elements.
- **Fix:** Broaden the tag filter or remove it; rely on the 50-char length limit for quality control.

---

### LOW-020 — Absolute XPath fragility not documented — appears as high-confidence selector
- **File:** `src/content/selector.js:806–828`
- **What:** Absolute XPath positions (`[2]`) change when siblings are dynamically added. They are presented with `isUnique: true` implying stability.
- **Fix:** Document fragility in a comment; lower score or mark as `isStable: false`.

---

### LOW-021 — `makeButtonAccessible` double-fires native buttons on Enter keypress
- **File:** `src/ui/popup/popup.js:306–320`
- **What:** Adds a `keydown` listener that calls `button.click()` on Enter/Space. Native `<button>` elements already fire `click` on Enter — causing Start Recording, Export, etc. to trigger twice.
- **Fix:** Remove the `keydown` listener in `makeButtonAccessible` for native `<button>` elements entirely.

---

### LOW-022 — Empty `if (e.key === 'Tab')` block — dead code
- **File:** `src/ui/popup/popup.js:298–302`
- **What:** `if (e.key === 'Tab') { // two comments, no code }` — the block body is two comment lines with no implementation.
- **Fix:** Remove the dead `if` block.

---

### LOW-023 — Extension icons exposed to `<all_urls>` via `web_accessible_resources` — enables fingerprinting
- **File:** `manifest.json:95–100`
- **What:** Any webpage can detect TestSnapper is installed by requesting `chrome-extension://<id>/src/assets/icons/icon16.png`.
- **Fix:** Change `web_accessible_resources` `matches` to only extensions-internal origins, or remove if no web page needs the icons.

---

### LOW-024 — Polling interval starts before `init()` completes — possible stale state on first tick
- **File:** `src/ui/popup/popup.js:33`
- **What:** `setInterval` (line 33) fires immediately but `currentState` is populated by `init()` which is async. The inverted comment ("Reduced from 2s to 3s") describes a slowdown, not a speedup, and is misleading.
- **Fix:** Start the interval inside `init()` after `currentState` is first set from the background response.

---

### LOW-025 — Async blob race in screenshot file processing (`processScreenshotFile`)
- **File:** `src/ui/review/review-standalone.js:819`
- **What:** `fetch(dataUrl).then(r => r.blob()).then(blob => { newStepScreenshotBlob = blob; })` is started asynchronously. If the user clicks "Add Step" before the fetch resolves, `newStepScreenshotBlob` is null and the step is saved without its screenshot.
- **Fix:** `await` the blob conversion in `handleConfirmAddStep()` if `newStepScreenshotBlob` is null, or replace with a synchronous `FileReader` conversion.

---

### LOW-026 — `package.json` missing `engines` field — no Node version guard
- **File:** `package.json`
- **What:** `cross-env ^10.1.0` requires Node 18+. No `"engines"` field prevents installation on Node 14–16. Failure only surfaces during the build step.
- **Fix:** Add `"engines": { "node": ">=18.0.0" }` to `package.json`.

---

### LOW-027 — `stepCount` divergence between metadata and steps after undo-to-initial
- **File:** `src/ui/review/review-standalone.js:463`
- **What:** `restoreFromHistory()` writes `sessionData.stepCount = stepsData.length` to storage, but the initial `stepCount` in metadata may differ from the actual initial `stepsData.length` if the session was loaded with an already-incorrect count.
- **Fix:** In `loadSession()`, verify and sync `sessionData.stepCount = stepsData.length` before calling `saveToHistory('initial')`.

---

### LOW-028 — `debug log reads `img.width`/`img.height` after `img.src = ''` — logs `0x0`
- **File:** `src/core/image-processor.js:357`
- **What:** After `img.src = ''` unloads the image, `img.width`/`img.height` return 0. The debug log uses `|| canvasWidth` fallback but `img.width` is read after the unload.
- **Fix:** Capture `const origW = img.width, origH = img.height` before clearing `img.src`.

---

### LOW-029 — Decorative SVG icons in review page not `aria-hidden` — read by screen readers
- **File:** `src/ui/review/review-standalone.html`
- **What:** Inline SVG icons in action buttons (`bulkDeleteBtn`, toolbar buttons) have no `aria-hidden="true"`. Screen readers may announce SVG title or raw path data.
- **Fix:** Add `aria-hidden="true"` to all decorative SVG elements across both popup and review pages.

---

### LOW-030 — `tabindex`/`role` on screenshot dropzone set only in JS, not HTML
- **File:** `src/ui/review/review-standalone.js:171`
- **What:** `tabindex="0"` and `role="button"` are added dynamically via JS. If `setupEventListeners()` runs late or fails, the dropzone is not keyboard-accessible.
- **Fix:** Add `tabindex="0"` and `role="button"` directly in `review-standalone.html` on the screenshot upload `<div>`.

---

## Appendix — Issues by File

| File | Issue IDs |
|------|-----------|
| `background.js` | CRIT-001, MED-001, MED-031, LOW-001 |
| `storage.js` | MED-006, LOW-006 |
| `fs-storage.js` | HIGH-001, MED-003, LOW-009 |
| `flush-utils.js` | MED-002 |
| `file-sync.js` | LOW-003, LOW-010 |
| `compression.js` | LOW-008 |
| `quota-monitor.js` | LOW-004, LOW-005 |
| `recorder-utils.js` | LOW-001, LOW-007 |
| `step-utils.js` | LOW-007 |
| `export-service.js` | CRIT-002, HIGH-014, HIGH-015, HIGH-016, MED-018, MED-019, MED-020 |
| `image-processor.js` | HIGH-017, HIGH-018, MED-016, MED-017, LOW-028 |
| `utils.js` | HIGH-019, HIGH-020, MED-021 |
| `dom-utils.js` | MED-021 |
| `content.js` | HIGH-002, HIGH-003, HIGH-004, HIGH-005, HIGH-006, HIGH-007, MED-004, MED-005, MED-022, MED-030, LOW-011 |
| `selector.js` | HIGH-008, HIGH-009, MED-011, MED-012, LOW-012, LOW-017, LOW-018, LOW-019, LOW-020 |
| `field-name-resolver.js` | HIGH-010, HIGH-011, MED-007, MED-008, MED-009, MED-010, MED-032, LOW-013, LOW-014 |
| `redactor.js` | HIGH-012, HIGH-013, MED-013, MED-014, MED-015, LOW-015, LOW-016 |
| `popup.js` | HIGH-021, HIGH-022, HIGH-023, HIGH-027, MED-024, MED-026, LOW-021, LOW-022, LOW-024 |
| `popup.html` | CRIT-003, HIGH-021, MED-029 |
| `review-standalone.js` | HIGH-024, HIGH-025, HIGH-028, HIGH-029, MED-028, LOW-025, LOW-027 |
| `review-standalone.html` | MED-029, LOW-029, LOW-030 |
| `theme.js` / `theme-init.js` | HIGH-025, MED-023 |
| `manifest.json` | HIGH-030, MED-027, LOW-023 |
| `webpack.config.js` | HIGH-026, MED-025 |
| `package.json` | LOW-026 |
