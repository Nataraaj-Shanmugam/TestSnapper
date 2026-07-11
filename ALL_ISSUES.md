# TestSnapper — Full Codebase Issue Audit

**Date:** 2026-07-01  
**Branch:** `fix/v1.1.6-parallel-fixes`  
**Auditors:** 4 parallel specialist agents (runtime, content, export, UI/build)

---

## Severity Summary

| Severity | Count |
|----------|-------|
| 🔴 CRITICAL | 4 |
| 🟠 HIGH | 21 |
| 🟡 MEDIUM | 28 |
| 🔵 LOW | 16 |
| **Total** | **69** |

---

## 🔴 CRITICAL

---

### ISS-001 — `exportToFormat()` does not exist on `ExportService`
- **Severity:** CRITICAL
- **Area:** Export
- **File:** `src/background/background.js:1315` (handler), `src/ui/review/review-standalone.js:1091`
- **Root cause:** The background `exportSession` message handler calls `exportService.exportToFormat(session, steps, message.format)`. `ExportService` has no `exportToFormat()` method — the correct method is `exportSession(sessionId, format, progressCallback)`. Every export attempt from the review page throws `TypeError: exportService.exportToFormat is not a function` and silently returns `{ success: false }`. No export ever works from the review page.
- **Fix:** Replace the background handler body with `await exportService.exportSession(message.sessionId, message.format)` and return the result. Better yet, remove the background export path entirely and have `review-standalone.js` call `ExportService` directly in its own window context (matching how `popup.js` works), per the architecture comment at `background.js:1194–1196`.

---

### ISS-002 — Review page uses `StorageManager` (chrome.storage) while popup uses `FSStorageManager` (filesystem) — sessions vanish after flush
- **Severity:** CRITICAL
- **Area:** Architecture / Storage
- **File:** `src/ui/review/review-standalone.js:15`
- **Root cause:** `review-standalone.js` imports and reads from `StorageManager` (chrome.storage backend). `popup.js` uses `FSStorageManager`, which flushes completed sessions from chrome.storage to the filesystem. Once a session is flushed, `StorageManager.getSession()` finds nothing in chrome.storage and returns null. The review page opens immediately after stop (before flush is guaranteed), but any re-opened review for an already-flushed session silently shows "Session not found". This is a permanent breakage for any session that has been flushed.
- **Fix:** Replace `import { StorageManager }` with `import { FSStorageManager }` in `review-standalone.js` and update all `storage.*` calls accordingly to match the popup's storage backend.

---

### ISS-003 — `CONTENT_SCRIPT_FILES` in background.js is missing `src/core/logger.js`
- **Severity:** CRITICAL
- **Area:** Runtime / Content Scripts
- **File:** `src/background/background.js:261–266`
- **Root cause:** `manifest.json` declarative injection lists `logger.js` first in `content_scripts[0].js`. The background's `CONTENT_SCRIPT_FILES` constant (used for dynamic `chrome.scripting.executeScript` injection during `startRecording()` and session recovery) omits `src/core/logger.js`. On any page where content scripts are dynamically injected (new tab, session recovery), `content.js` calls `window.Logger?.debug()` on a `Logger` global that was never loaded, silently degrading logging. More seriously, if any content script path uses `Logger` non-optionally, it throws `ReferenceError: Logger is not defined`.
- **Fix:** Add `'src/core/logger.js'` as the first entry in `CONTENT_SCRIPT_FILES` at `background.js:261`.

---

### ISS-004 — Export cancellation checks `session.id` instead of the `sessionId` parameter — fragile identity mismatch
- **Severity:** CRITICAL
- **Area:** Export
- **File:** `src/core/export-service.js:542, 570` (`_buildDocxBlob`); `:690, 726` (`_exportDOCXHtml`); `:937` (`_exportPDF`)
- **Root cause:** `_buildDocxBlob(exportData, sessionId, notify)` receives the raw `sessionId` string as a parameter, but all `_isCancelled()` and `_clearCancellation()` calls use `session.id` (from `exportData.session.id`, which is set by `_formatSessionData`'s `id: session.sessionId` mapping). These happen to match today, but the `sessionId` parameter exists exactly for this purpose. If `_formatSessionData` is ever changed or a test constructs `exportData` differently, cancellation silently fails — leaving the export running with no way to stop it. Same issue in `_exportDOCXHtml` and `_exportPDF`.
- **Fix:** Replace every `session.id` in `_isCancelled`/`_clearCancellation` calls within these three methods with the `sessionId` parameter variable.

---

## 🟠 HIGH

---

### ISS-005 — `navigator.userAgent` throws `ReferenceError` in service worker context
- **Severity:** HIGH
- **Area:** Runtime / Background
- **File:** `src/background/background.js:496`
- **Root cause:** `createSession()` builds a session object with `ua: navigator.userAgent`. In a Manifest V3 service worker, `navigator` is not defined — only `self.navigator` (a limited subset) is available. This throws `ReferenceError: navigator is not defined` on every recording start, making `startRecording()` always fail with an unhandled error propagated back to the popup.
- **Fix:** Replace `navigator.userAgent` with `self.navigator?.userAgent || ''`, or pass the UA from the popup content (which runs in a window context) as part of the `tabInfo` message payload.

---

### ISS-006 — `ORPHAN_KEY_RE` misparses `testsnapper_asset_{sessionId}_{assetId}` keys — deletes all screenshots on next weekly cleanup
- **Severity:** HIGH
- **Area:** Storage / OrphanCleaner
- **File:** `src/core/orphan-cleaner.js:23`
- **Root cause:** Per-asset keys follow the pattern `testsnapper_asset_{sessionId}_{assetId}` where both IDs are UUIDs (contain hyphens). The regex `([^_]+)` stops at the first `_` inside the UUID, producing a truncated and invalid `sessionId`. `liveSessionIds.has(truncatedId)` always returns `false`, so every per-asset key is falsely classified as orphaned and deleted on the next weekly run. This silently wipes all screenshots.
- **Fix:** Change the capture group to match a full UUID: `/^testsnapper_(?:steps|assets|assetIndex)_([\w-]+)$|^testsnapper_asset_([\w-]{36})_/`. The per-asset variant needs to capture exactly 36 characters (UUID length) after `_asset_`.

---

### ISS-007 — `addPendingFlush` / `removePendingFlush` have unguarded read-modify-write race
- **Severity:** HIGH
- **Area:** Storage / FlushUtils
- **File:** `src/core/flush-utils.js:46–66`
- **Root cause:** Both functions follow an async read-then-write pattern with no mutex. Concurrent calls (e.g. `stopRecording` adding a flush while a previous remove is in-flight) can interleave: A reads `[id1]`, B reads `[id1]`, A writes `[id1, id2]`, B writes `[id1]` — `id2` is permanently lost, leaving the session never flushed to disk.
- **Fix:** Serialize all RMW operations on the pending index key via a module-level promise queue (same pattern as `StorageManager._writeQueue`), or maintain a single `testsnapper_pending_index` key that is only ever written by one context.

---

### ISS-008 — Service worker cold restart silently drops `webRequest` API-capture listeners
- **Severity:** HIGH
- **Area:** Runtime / Background
- **File:** `src/background/background.js:405`
- **Root cause:** MV3 service workers are ephemeral. `recoveryReady` correctly restores `stateManager.state` and `stateManager.session`, but never calls `ApiCapture.start()`. After cold restart, `ApiCapture._attached` resets to `false` and API calls go unrecorded with no user-visible indication.
- **Fix:** In the recovery path (~line 405), after restoring the recording state, call `ApiCapture.start(recordingTab.id, restoreSettings)` when the recovered state is `'recording'`. The settings object is already available in that scope.

---

### ISS-009 — `FSStorageManager.importData()` skips the deep validation that `StorageManager.importData()` performs
- **Severity:** HIGH
- **Area:** Security / Storage
- **File:** `src/core/fs-storage.js:927–942`
- **Root cause:** `FSStorageManager.importData()` only validates that `data.meta` and `data.sessions` exist, then writes sessions to disk. It skips the session ID regex validation, asset data-URL format validation, `sessionName` length cap, and `fieldName` sanitization that `StorageManager.importData()` (lines 541–589) performs. A crafted import file can embed arbitrary string values in session metadata or inject non-image data as "assets".
- **Fix:** Factor the validation logic in `StorageManager.importData()` into a shared `_validateImportData(data)` function and call it at the top of both `importData` implementations.

---

### ISS-010 — `afterScreenshot` does not restore elements hidden inside Shadow DOM
- **Severity:** HIGH
- **Area:** Content Script / Screenshot
- **File:** `src/content/content.js:1590–1598`
- **Root cause:** `beforeScreenshot` hides all `[id^="testsnapper-"]` elements, including modal shadow hosts with IDs like `testsnapper-modal-host-{id}`. `afterScreenshot` restores only `floatingPanelContainer`. Any toast or modal host hidden at screenshot time remains invisible indefinitely.
- **Fix:** Track the exact set of elements hidden in `beforeScreenshot` in a local array, and restore exactly those elements in `afterScreenshot` rather than restoring only a known single element.

---

### ISS-011 — Drag `mousemove`/`mouseup` listeners bypass `AbortController` — leak on recording stop
- **Severity:** HIGH
- **Area:** Content Script / Memory
- **File:** `src/content/content.js:1446–1447`
- **Root cause:** Inside `addRecordingIndicator`, `handleMouseDown` adds `mousemove` and `mouseup` listeners directly on `document` without the `{ signal: eventListenerController.signal }` option used by all other listeners. Calling `eventListenerController.abort()` in `stopRecording()` leaves these handlers alive. On repeated start/stop cycles, orphaned handlers accumulate.
- **Fix:** Pass `{ signal: eventListenerController.signal }` to both `document.addEventListener` calls in the drag handler.

---

### ISS-012 — `initModules()` re-runs on every re-injection, resetting `selectorEngine`/`redactor` instances
- **Severity:** HIGH
- **Area:** Content Script / Initialization
- **File:** `src/content/content.js:106–114`
- **Root cause:** `var _modulesInitialized = initModules()` is declared outside the `if (!window.__testSnapperInitialized)` guard block. On re-injection, the hoisted `var` initializer re-executes `initModules()`, recreating all module instances and discarding any cached state (including the selector WeakMap cache). The 100ms retry `setTimeout` also fires into a stale closure.
- **Fix:** Move the `_modulesInitialized` declaration and initializer inside the `__testSnapperInitialized` guard block.

---

### ISS-013 — `processStepWithManualEntry` pauses recording by setting `isRecording = false` — drops all concurrent events
- **Severity:** HIGH
- **Area:** Content Script / Recording
- **File:** `src/content/content.js:586–589`
- **Root cause:** To suppress events during the manual-field-name modal, `processStepWithManualEntry` sets `isRecording = false`. This is the global flag checked by all event handlers — not the `isModalOpen` flag that already exists for this purpose. Any user interaction during the modal is permanently lost. On serialized modal queues, nested calls can also restore `isRecording = true` before the outer modal finishes.
- **Fix:** Replace the `isRecording = false / true` toggle in `processStepWithManualEntry` with `isModalOpen = true / false`. Event handlers already check `isModalOpen`.

---

### ISS-014 — `startRecording` message handler fires in every iframe — duplicate steps and multiple floating panels
- **Severity:** HIGH
- **Area:** Content Script / Frame Isolation
- **File:** `src/content/content.js:1555`
- **Root cause:** The `chrome.runtime.onMessage` listener is unconditional — it runs in all injected frames (including iframes). If the background sends `startRecording` without a `frameId` filter, every iframe starts recording independently, sending duplicate events to the background and each rendering its own floating panel.
- **Fix:** Add a `if (window !== window.top) return;` guard at the start of the `startRecording` case inside `onMessage.addListener`, or verify that background.js uses `frameId: 0` exclusively when sending `startRecording`.

---

### ISS-015 — CSV formula-injection guard uses apostrophe prefix — not universally suppressed by all spreadsheet apps
- **Severity:** HIGH
- **Area:** Security / Export
- **File:** `src/core/export-service.js:381–387`
- **Root cause:** `_csvSafeCell` prefixes dangerous cells (`=`, `+`, `-`, `@`) with `'` (apostrophe). Excel and Google Sheets suppress the leading apostrophe, but LibreOffice Calc and other tools display or process it inconsistently. Per OWASP CWE-1236, the recommended mitigation is quoting and escaping the value so it is treated as a string regardless of application. The `\t` guard in the regex is redundant since tab-only cells are benign.
- **Fix:** Replace the apostrophe-prefix with wrapping the cell value in `=""` + escaped value + `""` (the OWASP-recommended defense), or at minimum add a comment documenting the known limitation of the apostrophe approach.

---

### ISS-016 — `_loadJsPDF` calls `document.createElement` without a guard — throws `ReferenceError` in service worker
- **Severity:** HIGH
- **Area:** Export
- **File:** `src/core/export-service.js:432–454`
- **Root cause:** `_loadDocx` correctly guards `if (typeof document === 'undefined') return false` before DOM access. `_loadJsPDF` does not have this guard. If `_exportPDF` is ever called from the service worker context, `_loadJsPDF` throws `ReferenceError: document is not defined`.
- **Fix:** Add `if (typeof document === 'undefined') return false;` as the first line of `_loadJsPDF`, mirroring the guard in `_loadDocx:490`.

---

### ISS-017 — `ImageProcessor` context detection (`useOffscreen`) is misleadingly named and fragile in worker polyfill contexts
- **Severity:** HIGH
- **Area:** Image Processing
- **File:** `src/core/image-processor.js:110`
- **Root cause:** `typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined'` is meant to detect a service-worker context. In modern Chrome, `OffscreenCanvas` is also available in window contexts, making the second condition load-bearing. The variable name `useOffscreen` implies a capability check, not a context check, which misleads future readers into thinking it can be true in window contexts.
- **Fix:** Rename to `isServiceWorkerCtx` and add `typeof WorkerGlobalScope !== 'undefined'` for explicitness. Add a clarifying comment.

---

### ISS-018 — Theme: `theme-init.js` sets `dataset.theme` on `<html>` but `theme.js` reads/writes from `<body>` — flash-of-wrong-theme
- **Severity:** HIGH
- **Area:** UI / Theme
- **File:** `src/ui/theme-init.js:14` vs `src/ui/theme.js:11`
- **Root cause:** `theme-init.js` (pre-paint bootstrap) sets `document.documentElement.dataset.theme`. `theme.js`'s `setupTheme()` reads `document.body.dataset.theme`, which is initially empty. On first call, `currentTheme` defaults to `'light'` regardless of the pre-paint value, so one click always resets to dark even for light-mode users. CSS rules keyed on `body[data-theme]` disagree with the pre-paint `html[data-theme]` until `setupTheme()` fires.
- **Fix:** Change `theme-init.js:14` to target `document.body`: `document.body.dataset.theme = t;`. Add the mode class to `document.body` as well.

---

### ISS-019 — `review-standalone.js` defines its own `setupTheme`/`applyTheme` instead of importing `theme.js`
- **Severity:** HIGH
- **Area:** UI / Theme
- **File:** `src/ui/review/review-standalone.js:120–152`
- **Root cause:** The shared `theme.js` was created to fix MED-007 (theme duplication), but `review-standalone.js` never imports it. The local copy persists `localStorage` primarily and `chrome.storage` only as a try/catch afterthought, diverging from `theme.js`'s behavior. Theme changes in the review page are not reliably reflected in the popup.
- **Fix:** Remove local `setupTheme`/`applyTheme` from `review-standalone.js` and add `import { setupTheme } from '../theme.js';` at the top of the file.

---

### ISS-020 — Manifest `version` is `"0.0.0"` placeholder; `popup.html` footer hardcodes `v1.1.5`
- **Severity:** HIGH
- **Area:** Build / Versioning
- **File:** `manifest.json:6`, `src/ui/popup/popup.html:295`
- **Root cause:** The webpack CopyPlugin transform injects the version from `package.json` into `dist/manifest.json`. But `popup.html` has a hardcoded `<p>TestSnapper v1.1.5</p>` footer that is never transformed. Any developer loading the extension from the source tree sees `v0.0.0`. The footer will desync from the real version on every release.
- **Fix:** In `popup.js`'s `init()`, set the footer text to `chrome.runtime.getManifest().version` dynamically. Remove the hardcoded version from `popup.html`.

---

### ISS-021 — `_permissions_comment` object in `manifest.json` — Chrome MV3 validator rejects unknown top-level keys
- **Severity:** HIGH
- **Area:** Manifest / Build
- **File:** `manifest.json:20–23`
- **Root cause:** A `"_permissions_comment": { ... }` object at the manifest's top level is an unsupported JSON key. Chrome's MV3 validator can reject the entire manifest with a parse error, preventing extension load. Even if currently tolerated, it is officially unsupported and will break on stricter validation.
- **Fix:** Remove the `_permissions_comment` block. Strip it during the build via the webpack CopyPlugin transform (delete the key from the parsed manifest object before `JSON.stringify`), or move the rationale to a `PERMISSIONS.md` file.

---

### ISS-022 — `popup.js` stat counter `#screenshotCount` always displays `0` — field missing from `getState` response
- **Severity:** HIGH
- **Area:** UI / Popup
- **File:** `src/ui/popup/popup.js:1021`, `src/background/background.js:69–75`
- **Root cause:** `popup.js:1021` reads `response.screenshotCount || 0` from the `getState` response. `RecordingStateManager.getState()` returns `{ state, session, stepCount }` only — `screenshotCount` is never tracked or returned. The stat counter in the Recording tab always shows `0`.
- **Fix:** Add `screenshotCount: 0` to `RecordingStateManager`, increment it in `captureScreenshot()`, and include it in the `getState()` return value.

---

### ISS-023 — `"file:///*"` in `content_scripts[0].matches` is redundant and misleading
- **Severity:** HIGH
- **Area:** Manifest
- **File:** `manifest.json:40–41`
- **Root cause:** `<all_urls>` already covers all URL schemes including `file://` (when the user grants file access). The additional `"file:///*"` entry is redundant. More critically, it creates the false expectation that local files are always captured — in Chrome, `file://` access requires the user to explicitly enable "Allow access to file URLs" in extension settings regardless of what the manifest declares.
- **Fix:** Remove `"file:///*"` from the `matches` array. Document the "Allow access to file URLs" requirement in `README.md`.

---

### ISS-024 — Review page routes export through background service worker — contradicts architecture; broken by ISS-001
- **Severity:** HIGH
- **Area:** Architecture / Export
- **File:** `src/ui/review/review-standalone.js:1091–1095`
- **Root cause:** `review-standalone.js` sends `{ action: 'exportSession' }` to the background for all exports. `background.js:1194–1196` explicitly comments "Both UIs export locally via their own ExportService instance — there is no background export path." The review page is the odd one out and is broken by ISS-001.
- **Fix:** Remove the `chrome.runtime.sendMessage` export path from `review-standalone.js`. Instantiate `ExportService` locally and call `exportService.exportSession(sessionId, format, progressCallback)` directly, matching `popup.js`'s approach.

---

### ISS-025 — `FSStorageManager.updateSession` calls `_extractAssets` on on-disk steps — always returns `[]`, silently no-op
- **Severity:** HIGH
- **Area:** Storage / Filesystem
- **File:** `src/core/fs-storage.js:310`
- **Root cause:** `_extractAssets()` only extracts assets from steps that have an inline `step.screenshot` field. On-disk steps use `step.screenshotFile` (a file path reference), so `_extractAssets` always returns `[]` for loaded sessions. The `assets` argument to `writeSession()` is always empty, making the screenshot file writing path dead for every `updateSession` call. Metadata-only updates work, but any code path that intends to write new screenshots via `updateSession` will silently drop them.
- **Fix:** Either document that `updateSession` is metadata-only (and add an assertion), or change `_extractAssets` to also process steps with `screenshotFile` references.

---

## 🟡 MEDIUM

---

### ISS-026 — `shouldRecordRequest` and `validateSettings` imported from `recorder-utils.js` but never called
- **Severity:** MEDIUM
- **Area:** Background / Dead Code
- **File:** `src/background/background.js:13`
- **Root cause:** Both symbols are imported but the call sites use inline implementations (`ApiCapture._shouldRecord()` and `SettingsManager`). The dead imports add confusion about where canonical logic lives.
- **Fix:** Either wire the imported functions into the existing call sites, or remove the imports (and potentially the exports from `recorder-utils.js`) if the inline versions are intentional.

---

### ISS-027 — `exportSession()` function in `background.js` is dead code (~100 lines)
- **Severity:** MEDIUM
- **Area:** Background / Dead Code
- **File:** `src/background/background.js:1020–1116`
- **Root cause:** The comment at line 1194–1196 confirms there is no background export path; the function is never dispatched from the message handler switch. It imports and retains an `exportService` instance used nowhere else in the background, increasing service worker memory footprint.
- **Fix:** Delete `exportSession()` (lines 1020–1116). Verify `ExportService` import and `exportService` instance can be removed from `background.js` as well.

---

### ISS-028 — `SettingsManager.save()` falsy check silently skips clamping for `0`-valued settings
- **Severity:** MEDIUM
- **Area:** Background / Settings
- **File:** `src/background/background.js:213, 217, 221`
- **Root cause:** `if (validated.screenshotSeconds)`, `if (validated.maxSessions)`, and `if (validated.imageQuality)` are all falsy checks. If any of these are set to `0`, the `if` body is skipped and the `0` is persisted unclamped, bypassing the range validation.
- **Fix:** Replace all three with explicit `!== undefined` checks: `if (validated.screenshotSeconds !== undefined)`, etc., matching the pattern in `SettingsManager.get()`.

---

### ISS-029 — `clearBuffer` / `flushSession` race can corrupt on-disk session
- **Severity:** MEDIUM
- **Area:** Storage / FlushUtils
- **File:** `src/core/fs-storage.js:190–193`
- **Root cause:** `clearBuffer(sessionId)` calls `this._buffer.clearSession(sessionId)` and `removePendingFlush(sessionId)` in sequence. If `flushSession` is running concurrently: (1) flush reads from buffer, (2) clearBuffer deletes it, (3) flush writes incomplete data to disk, (4) removePendingFlush clears the flag — resulting in a corrupted or empty on-disk session.
- **Fix:** Ensure `flushSession` completes its read-write-clear sequence atomically before `clearBuffer` can run. A simple mutex flag per `sessionId` would suffice.

---

### ISS-030 — `FileSync._readScreenshot` uses O(n²) string concatenation — slow and memory-intensive for large screenshots
- **Severity:** MEDIUM
- **Area:** Performance / FileSync
- **File:** `src/core/file-sync.js:524–528`
- **Root cause:** `for (let i = 0; i < bytes.length; i++) { binary += String.fromCharCode(bytes[i]); }` allocates a new string on every iteration. For a 2 MB screenshot this runs 2 million string concatenations.
- **Fix:** Replace with chunked `String.fromCharCode.apply`: `const CHUNK = 8192; for (let i = 0; i < bytes.length; i += CHUNK) { binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)); }`.

---

### ISS-031 — `_autoCleanupCheck` wrapper in `StorageManager` is a no-op alias
- **Severity:** MEDIUM
- **Area:** Storage / Code Clarity
- **File:** `src/core/storage.js:482–484`
- **Root cause:** `_autoCleanupCheck()` and `cleanupOrphans()` both delegate to `this.orphanCleaner.cleanupOrphans()`. The wrapper adds no value and obscures that both methods do the same thing.
- **Fix:** Remove `_autoCleanupCheck` and call `this.orphanCleaner.cleanupOrphans()` directly in `init()`.

---

### ISS-032 — Cross-context RMW on pending flush index is inherently unsafe
- **Severity:** MEDIUM
- **Area:** Storage / FlushUtils
- **File:** `src/core/flush-utils.js:46–66`
- **Root cause:** `addPendingFlush` is called from the service worker (background.js) and `removePendingFlush` from the window context (review/popup). A JS-level mutex cannot protect across JS contexts. Concurrent reads can cause both contexts to overwrite each other's writes. (Companion to ISS-007.)
- **Fix:** Document the invariant that background is the sole writer for `addPendingFlush` and window contexts the sole writer for `removePendingFlush`. Enforce with a comment and runtime assertion. Consider a dedicated single-writer key per operation type.

---

### ISS-033 — `stopRecording` guard does not clear `navigationCheckInterval` on early return
- **Severity:** MEDIUM
- **Area:** Content Script
- **File:** `src/content/content.js:1229–1230`
- **Root cause:** If `stopRecording` is called in a state where `isRecording = false && currentSessionId = null`, the guard `return` fires before `clearInterval(navigationCheckInterval)`. In a race between `_finishStartRecording` (async) and an early stop, the interval leaks.
- **Fix:** Extract a `_cleanupRecordingState()` helper that always clears all intervals, and call it from both the guard early-return path and the main stop body.

---

### ISS-034 — `handleSubmit` bypasses `processStepWithManualEntry` — no field-name modal for form submits
- **Severity:** MEDIUM
- **Area:** Content Script / Recording
- **File:** `src/content/content.js:984`
- **Root cause:** `handleClick`, `handleInput`, and `handleChange` all route through `processStepWithManualEntry`. `handleSubmit` calls `sendStepToBackground` directly, so form submit steps never prompt for a field name override.
- **Fix:** Route `handleSubmit` through `processStepWithManualEntry`, or document explicitly that form submits intentionally skip the manual-entry flow.

---

### ISS-035 — `SelectorEngine.isStepDuplicate` defined but never called; steps don't include a `timestamp` field it requires
- **Severity:** MEDIUM
- **Area:** Content Script / Selector
- **File:** `src/content/selector.js:43–58`
- **Root cause:** `isStepDuplicate` is dead code. The active duplicate-detection in `content.js` is the inline `isDuplicateInteraction()` (line 667). Additionally, `isStepDuplicate` compares `step.timestamp`, but content-script step objects don't include a `timestamp` field, making the method doubly unusable.
- **Fix:** Remove `isStepDuplicate` from `SelectorEngine`, or wire it into the background's `addStep` handler where timestamps and session step arrays are available.

---

### ISS-036 — Angular selector `[[ngModel]="..."]` is invalid CSS — `querySelectorAll` throws `SyntaxError`
- **Severity:** MEDIUM
- **Area:** Content Script / Selector
- **File:** `src/content/selector.js:439`
- **Root cause:** The second part of `[ng-model="${ngModel}"], [[ngModel]="${ngModel}"]` is syntactically invalid CSS (brackets inside an attribute selector). `querySelectorAll` throws a `SyntaxError`, silently caught in `_addFrameworkSelectors`'s try/catch. The generated step record carries an unchecked invalid selector that breaks any test runner consuming it.
- **Fix:** Escape the brackets: `'[\\[ngModel\\]="' + ngModel + '"]'`, or generate two separate candidate entries.

---

### ISS-037 — `_addTestIdSelectors` hard-codes `isUnique: true` for XPath variant without checking
- **Severity:** MEDIUM
- **Area:** Content Script / Selector
- **File:** `src/content/selector.js:295–300`
- **Root cause:** `data-testid` values are frequently non-unique (e.g. repeated list items). Hard-coding `isUnique: true` gives a +100 score bonus, causing an unreliable selector to rank as primary.
- **Fix:** Replace `isUnique: true` with `this._isUniqueXPath(...)` validation, as used for other XPath candidates.

---

### ISS-038 — Proximity text scorer in `FieldNameResolver` walks element's own children — returns the element's own text as label
- **Severity:** MEDIUM
- **Area:** Content Script / FieldNameResolver
- **File:** `src/content/field-name-resolver.js:336–367`
- **Root cause:** `_fromProximityText` creates a `TreeWalker` rooted at `element.parentElement`, which includes text nodes inside the element itself. For a `<button>Click me</button>`, the walker finds "Click me" inside the button and returns it as a label.
- **Fix:** Skip descendant text nodes: add `if (element.contains(node.parentElement)) continue;` inside the walker loop.

---

### ISS-039 — `_fromShadowDOMLabels` matches any label in ancestor shadow root, not one associated with the specific element
- **Severity:** MEDIUM
- **Area:** Content Script / FieldNameResolver
- **File:** `src/content/field-name-resolver.js:377–388`
- **Root cause:** The strategy returns the first `label` found in any ancestor's shadow root, without checking `label.htmlFor === element.id` or proximity. Every field inside the same shadow component gets the same (wrong) label.
- **Fix:** After finding a label in the shadow root, verify it is associated with `element` via `for` attribute or `label.control === element` before returning its text.

---

### ISS-040 — `redactStep` double-masks already-partially-masked values — discards contextual masking
- **Severity:** MEDIUM
- **Area:** Content Script / Redactor
- **File:** `src/content/redactor.js:167–177`
- **Root cause:** `maskValue` runs at capture time (partial masking, e.g. `jo***@example.com`). If masking changes the value, `isSensitive = true` is set. `redactStep` then replaces the already-masked value with `'••••••••'`, discarding the partial mask's context.
- **Fix:** Document the intended contract: `maskValue` is the primary masker; `redactStep` is export-time backup. If `maskValue` already ran, mark the step with `_alreadyMasked: true` and skip `redactStep`'s replacement.

---

### ISS-041 — DOB pattern masks version strings and date-formatted non-PII without field context
- **Severity:** MEDIUM
- **Area:** Content Script / Redactor
- **File:** `src/content/redactor.js:52`
- **Root cause:** `dobPattern` matches any `M/D/Y` date format, including version strings like `1.2/3.4` or dates in URL paths, replacing them with `**/**/****`. No field-context check guards it (unlike routing numbers which check `looksFinancial`).
- **Fix:** Gate `dobPattern` masking behind a field-context check — only apply it when the element's name/id/placeholder/aria-label contains `dob`, `birth`, `age`, or `date`.

---

### ISS-042 — Navigation polling updates `lastNavigationUrl` before `captureNavigation` — drops intermediate navigations on early return
- **Severity:** MEDIUM
- **Area:** Content Script / Navigation
- **File:** `src/content/content.js:1143–1149`
- **Root cause:** The polling callback sets `lastNavigationUrl = window.location.href` at line 1145 before calling `captureNavigation()`. If `captureNavigation` returns early (because `isRecording = false` or `isModalOpen = true`), the URL has already been consumed. The intermediate navigation is permanently lost.
- **Fix:** Move the `lastNavigationUrl` update to inside `captureNavigation()` only, after the recording guards have passed.

---

### ISS-043 — `validateSession` uses inconsistent path to access `sessionId` from `getState` response
- **Severity:** MEDIUM
- **Area:** Content Script / Session Management
- **File:** `src/content/content.js:621–635`
- **Root cause:** `validateSession` reads `response.session?.sessionId`. If the background's `getState` response shape uses a different nesting (e.g. `response.sessionId`), `validateSession` always returns `false`, causing the 15-second heartbeat to stop recording every cycle.
- **Fix:** Audit `background.js`'s `getState` response shape and add a defensive fallback: `const sid = response.session?.sessionId || response.sessionId`.

---

### ISS-044 — `_fromFrameContext` strategy is dead code — `initFrameContext` is never called
- **Severity:** MEDIUM
- **Area:** Content Script / FieldNameResolver
- **File:** `src/content/field-name-resolver.js:396–398`
- **Root cause:** `_fromFrameContext` returns `this._cachedFrameLabel`, which is set by `initFrameContext()`. But `initFrameContext()` is never called anywhere in the content scripts, so `_cachedFrameLabel` is always `null`. The strategy always returns `null` and is dead code.
- **Fix:** Either call `fieldNameResolver.initFrameContext()` in `content.js` after construction when `window !== window.top`, or remove the strategy entirely.

---

### ISS-045 — Raw `step.value` (passwords, OTPs, card numbers) exported verbatim in JSON, CSV, DOCX, PDF
- **Severity:** MEDIUM
- **Area:** Security / Export
- **File:** `src/core/export-service.js:350–369`
- **Root cause:** `_exportJSON`, `_exportCSV`, and the document builders export `step.value` for non-navigate steps without applying the redactor. If a `type` action was recorded on a password input, the plaintext password appears in every export format.
- **Fix:** Apply the redactor to `step.value` before export for sensitive field types (check `step.fieldType === 'password'`, or apply `Redactor.maskValue` to all step values). At minimum, document the limitation prominently.

---

### ISS-046 — Compression `compress()` fallback `JSON.stringify` in catch can throw — unhandled rejection, silent data loss
- **Severity:** MEDIUM
- **Area:** Core / Compression
- **File:** `src/core/compression.js:62–68`
- **Root cause:** The catch block calls `JSON.stringify(data)` as a fallback. If the original `JSON.stringify` on line 20 threw (e.g. circular reference), the catch's `JSON.stringify` throws again. The unhandled rejection means `compress()` resolves to `undefined`. `getSteps` then gets `undefined` instead of an array, likely crashing downstream code.
- **Fix:** Wrap the fallback `JSON.stringify` in its own try/catch. If that also fails, return `PLAIN_PREFIX + '[]'` and log a `Logger.error` to make the data loss visible.

---

### ISS-047 — Missing `'markdown'` export format case — every Markdown export throws `Unsupported format: markdown`
- **Severity:** MEDIUM
- **Area:** Export
- **File:** `src/core/export-service.js:130–148`
- **Root cause:** The `exportSession` switch handles `'json'`, `'csv'`, `'docx'`, `'pdf'`. There is no `'markdown'` case. The extension advertises Markdown export; any call with `format: 'markdown'` hits the `default` branch and throws.
- **Fix:** Implement `_exportMarkdown(exportData, sessionId)` and add a `'markdown':` case to the switch.

---

### ISS-048 — `fetch(dataUrl)` round-trip for DOCX image bytes causes 3.5× memory spike
- **Severity:** MEDIUM
- **Area:** Export / Performance
- **File:** `src/core/export-service.js:611`
- **Root cause:** `new Uint8Array(await (await fetch(imgObj.dataUrl)).arrayBuffer())` round-trips a base64 data-URL through the Fetch API. At peak, memory holds the data-URL string + ArrayBuffer + Uint8Array simultaneously — about 3.5× the raw image size. For sessions with many screenshots this creates significant GC pressure.
- **Fix:** Decode the base64 directly: extract the base64 portion of the data-URL, call `atob()`, and build the `Uint8Array` from the binary string. No Fetch round-trip needed.

---

### ISS-049 — `ImageProcessor._processImageOffscreen` uses `FileReader` — unavailable in Chrome 88–92 service workers
- **Severity:** MEDIUM
- **Area:** Image Processing
- **File:** `src/core/image-processor.js:278`
- **Root cause:** `Utils.blobToDataURL` uses `FileReader`. `FileReader` was added to service workers in Chrome 93; the extension targets Chrome 88+. On Chrome 88–92, `_processImageOffscreen` silently returns the original uncompressed data-URL.
- **Fix:** Replace `Utils.blobToDataURL(outputBlob)` in the offscreen path with a `Response`-based conversion: `const ab = await outputBlob.arrayBuffer(); return 'data:image/' + fmt + ';base64,' + btoa(/* chunked */);`. Or raise the minimum Chrome version in the manifest to 93.

---

### ISS-050 — `popup.js` `setupEventListeners()` lacks null guards — crashes if any DOM element is missing
- **Severity:** MEDIUM
- **Area:** UI / Popup
- **File:** `src/ui/popup/popup.js:218`
- **Root cause:** Top-level `getElementById` calls execute before `DOMContentLoaded`. `setupEventListeners()` calls `.addEventListener()` on these references without null-checking. If any element is absent, the popup crashes before any user interaction.
- **Fix:** Move all `getElementById` calls inside `init()` (after `DOMContentLoaded`), or add null guards in `setupEventListeners()` mirroring those in `updateButtonStates()`.

---

### ISS-051 — Storage usage bar shows "Calculating..." forever — `updateStorageUsage()` is a no-op
- **Severity:** MEDIUM
- **Area:** UI / Popup
- **File:** `src/ui/popup/popup.html:144–148`, `src/ui/popup/popup.js:342`
- **Root cause:** `updateStorageUsage()` is explicitly empty (`async function updateStorageUsage() { }`). The bar initial text "Calculating..." never resolves.
- **Fix:** Either remove the storage usage bar from `popup.html` (since filesystem storage has no chrome quota limit), or set a static descriptive label on page load such as "Filesystem storage — no quota limit".

---

### ISS-052 — `innerHTML` in modal body uses string concatenation with `action` variable — structurally unsafe pattern
- **Severity:** MEDIUM
- **Area:** Security / Content Script
- **File:** `src/content/content.js:488–496`
- **Root cause:** `modalDiv.innerHTML` is set via `'<strong>' + action + '</strong>'`. `action` is currently always a hardcoded string literal, so there is no active XSS. But the pattern is one refactor away from a vulnerability if `action` ever comes from external data.
- **Fix:** Build the `<strong>` element programmatically (`el.textContent = action`) rather than via `innerHTML` concatenation.

---

### ISS-053 — `_buildDocxBlob` and `_exportDOCXHtml` use `session.id` for cancellation — should use `sessionId` parameter (companion to ISS-004)
- **Severity:** MEDIUM
- **Area:** Export
- **File:** `src/core/export-service.js:542, 570, 726`
- **Root cause:** Covered by ISS-004; these specific locations need the same fix applied.
- **Fix:** Replace `session.id` with the `sessionId` parameter in cancellation calls within `_buildDocxBlob` and `_exportDOCXHtml`.

---

---

## 🔵 LOW

---

### ISS-054 — `QuotaMonitor.checkAndNotify()` is defined but never called — dead code
- **Severity:** LOW
- **Area:** Storage / Dead Code
- **File:** `src/core/quota-monitor.js:131–154`
- **Root cause:** `checkAndNotify()` is never invoked. The active quota warning path goes through `checkQuota()` → `_notifyQuotaWarning()` → registered listeners. This method duplicates the broadcast logic already in `background.js`.
- **Fix:** Remove `checkAndNotify()`. If periodic polling is wanted, hook it to a `chrome.alarms` handler instead.

---

### ISS-055 — `FSStorageManager.getStorageUsage()` returns `0%` in filesystem mode — quota UI always shows empty
- **Severity:** LOW
- **Area:** Storage / UI
- **File:** `src/core/fs-storage.js:843–851`
- **Root cause:** When the filesystem backend is active, `getStorageUsage()` short-circuits to `{ used: 0, percentage: 0, warning: false }`. Active recordings are still buffered in chrome.storage, so the quota warning UI shows 0% even if the buffer is near full.
- **Fix:** When filesystem mode is active but a recording is buffered, query `this._buffer.getStorageUsage()` and return the buffer usage alongside the `filesystem: true` indicator.

---

### ISS-056 — `_findSessionFolder` matches on only 8 hex chars of UUID — theoretical collision risk
- **Severity:** LOW
- **Area:** Storage / FileSync
- **File:** `src/core/file-sync.js:467–476`
- **Root cause:** Folder names are matched by the first 8 hex characters of `sessionId`. Two sessions sharing the same 8-char prefix (1 in 4 billion probability) would be confused.
- **Fix:** Use 12 or 16 characters. Alternatively, store the full `sessionId` in `session.json` and verify it after locating the folder by suffix.

---

### ISS-057 — `ExportService._compressImage` is dead code — all callers migrated to `ImageProcessor`
- **Severity:** LOW
- **Area:** Export / Dead Code
- **File:** `src/core/export-service.js:211–297`
- **Root cause:** `_compressImage` is an ~87-line method that duplicates `ImageProcessor`'s logic. No call site in the codebase invokes it.
- **Fix:** Delete `_compressImage` from `ExportService`.

---

### ISS-058 — `ExportService._blobToDataURL` duplicates `Utils.blobToDataURL` exactly
- **Severity:** LOW
- **Area:** Export / Duplication
- **File:** `src/core/export-service.js:195–209`
- **Root cause:** Identical `FileReader` promise implementation. The MED-006 split was supposed to eliminate this duplication but the `ExportService` copy was never removed.
- **Fix:** Replace `this._blobToDataURL(blob)` with `Utils.blobToDataURL(blob)` (import `Utils`) and delete the private method.

---

### ISS-059 — `ExportService._escapeHtml` duplicates `Utils.escapeHtml` exactly
- **Severity:** LOW
- **Area:** Export / Duplication
- **File:** `src/core/export-service.js:333–343`
- **Root cause:** Character-for-character identical to `Utils.escapeHtml`. Any future fix must be applied in two places.
- **Fix:** Import `Utils` in `export-service.js` and replace all `this._escapeHtml(...)` calls with `Utils.escapeHtml(...)`. Delete `_escapeHtml`.

---

### ISS-060 — `compression.js` catch block uses `console.error` — bypasses `Logger` abstraction
- **Severity:** LOW
- **Area:** Core / Logging
- **File:** `src/core/compression.js:138`
- **Root cause:** `console.error('Decompression failed:', error)` bypasses the configurable log-level system and always prints to console in production.
- **Fix:** Replace with `Logger.warn('Decompression failed:', error)`.

---

### ISS-061 — `Utils.downloadFile` and `Utils.showMessage` still present — MED-006 DOM/pure split incomplete
- **Severity:** LOW
- **Area:** Core / Duplication
- **File:** `src/core/utils.js:68–106`
- **Root cause:** The `MED-006` refactor split DOM-dependent utilities into `dom-utils.js`, but `downloadFile` and `showMessage` (both `document`-dependent) were not removed from `utils.js`. Service-worker code could accidentally call `Utils.downloadFile` and get `ReferenceError: document is not defined`.
- **Fix:** Remove `downloadFile` and `showMessage` from `utils.js`. Update callers to import from `dom-utils.js`.

---

### ISS-062 — `proxy text scorer` log reads stale `img.width`/`img.height` after `img.src = ''`
- **Severity:** LOW
- **Area:** Image Processing
- **File:** `src/core/image-processor.js:357`
- **Root cause:** `img.src = ''` unloads the image; `img.width`/`img.height` become `0` in some browsers. The `|| canvasWidth` fallback in the log masks the bug but logs wrong dimensions.
- **Fix:** Capture `const origW = img.width; const origH = img.height;` before clearing `img.src`.

---

### ISS-063 — `_fromExplicitLabel` strategy returns first label in parent, not nearest to element
- **Severity:** LOW
- **Area:** Content Script / FieldNameResolver
- **File:** `src/content/field-name-resolver.js:177–190`
- **Root cause:** `parent.querySelector('label')` returns the first label in the parent, regardless of DOM order. In a form group with two inputs and two labels, both inputs get the same (first) label.
- **Fix:** Limit to labels that appear before `element` in document order, or apply proximity scoring.

---

### ISS-064 — `cleanFieldName` implementations diverge between `content.js`, `selector.js`, and `field-name-resolver.js`
- **Severity:** LOW
- **Area:** Content Script / Consistency
- **File:** `src/content/content.js:232`, `src/content/selector.js:972`, `src/content/field-name-resolver.js:459`
- **Root cause:** `content.js` and `selector.js` strip all `*` and `:` globally. `field-name-resolver.js` strips only leading/trailing `*` and trailing `:`. `"Label: (required*)"` produces `"Label (required)"` in the first two and `"Label: (required)"` in the third.
- **Fix:** Centralise the cleaning logic in `FieldNameResolver._cleanFieldName` and call it from all three sites.

---

### ISS-065 — `getState` tabId check block is dead code with empty body
- **Severity:** LOW
- **Area:** Content Script / Dead Code
- **File:** `src/content/content.js:1638–1648`
- **Root cause:** `if (response.tabId) { /* comment only */ }` — no actual implementation. The tab-ID isolation check was never written despite the groundwork.
- **Fix:** Implement the check or remove the dead `if` block, leaving a `// TODO` comment if cross-tab isolation is a future concern.

---

### ISS-066 — `web_accessible_resources` exposes extension icons to `<all_urls>` — enables extension fingerprinting
- **Severity:** LOW (Security)
- **Area:** Manifest / Security
- **File:** `manifest.json:95–100`
- **Root cause:** Icons do not need to be web-page-accessible. Any website can detect TestSnapper by requesting `chrome-extension://<id>/src/assets/icons/icon16.png`.
- **Fix:** Change `"matches"` in `web_accessible_resources` to `["chrome-extension://<extension-id>/*"]`, or remove the entry if no web page needs to reference these icons.

---

### ISS-067 — `popup.js` `makeButtonAccessible` adds redundant `Enter`/`Space` keydown handler — double-fires `click` on native buttons
- **Severity:** LOW
- **Area:** UI / Popup
- **File:** `src/ui/popup/popup.js:306–321`
- **Root cause:** Native `<button>` elements already fire `click` on Enter/Space. The added `keydown` listener synthesizes a second `click()`, causing double-invocation for every keyboard activation.
- **Fix:** Remove the `makeButtonAccessible` function and its `forEach` call (lines 306–326) entirely.

---

### ISS-068 — `liveStepsViewer` is shown then the popup closes in 500ms — feature is never visible
- **Severity:** LOW
- **Area:** UI / Popup
- **File:** `src/ui/popup/popup.js:379–380`
- **Root cause:** `liveStepsViewer.style.display = "block"` is set at line 379 then `window.close()` fires at line 380 in 500ms. The viewer is never seen.
- **Fix:** Either remove `window.close()` to let the live viewer be usable, or remove the `liveStepsViewer` show call since it has no visible effect.

---

### ISS-069 — `docs/` directory is shipped inside the extension `dist/` bundle
- **Severity:** LOW
- **Area:** Build
- **File:** `webpack.config.js:74–75`
- **Root cause:** The CopyPlugin pattern `{ from: 'docs', to: 'docs' }` copies internal documentation into the packaged extension, increasing bundle size and exposing project-internal docs to anyone who installs the extension.
- **Fix:** Remove the `docs` CopyPlugin entry.

---

## Appendix — Issues by Area

| Area | Issue IDs |
|------|-----------|
| Export / Export Formats | ISS-001, ISS-004, ISS-015, ISS-016, ISS-024, ISS-045, ISS-047, ISS-048, ISS-053, ISS-057, ISS-058, ISS-059 |
| Storage / FlushUtils | ISS-002, ISS-006, ISS-007, ISS-009, ISS-025, ISS-029, ISS-031, ISS-032 |
| Background / Service Worker | ISS-003, ISS-005, ISS-008, ISS-026, ISS-027, ISS-028 |
| Content Scripts | ISS-010, ISS-011, ISS-012, ISS-013, ISS-014, ISS-033, ISS-034, ISS-042, ISS-043, ISS-052, ISS-065 |
| Selectors / FieldNameResolver | ISS-035, ISS-036, ISS-037, ISS-038, ISS-039, ISS-044, ISS-063, ISS-064 |
| Security / Privacy | ISS-009, ISS-015, ISS-040, ISS-041, ISS-045, ISS-052, ISS-066 |
| UI / Popup | ISS-020, ISS-022, ISS-050, ISS-051, ISS-067, ISS-068 |
| UI / Review | ISS-018, ISS-019, ISS-024 |
| Image Processing | ISS-017, ISS-049, ISS-062 |
| Compression | ISS-046, ISS-060 |
| Manifest / Build | ISS-020, ISS-021, ISS-023, ISS-069 |
| Dead Code | ISS-026, ISS-027, ISS-031, ISS-035, ISS-044, ISS-054, ISS-057, ISS-058, ISS-059, ISS-061, ISS-065 |
| Redactor | ISS-040, ISS-041 |
| Performance | ISS-030, ISS-048, ISS-055 |
