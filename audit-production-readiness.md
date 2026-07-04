# TestSnapper — Production Readiness Audit (2026-07-03)

> ## Fix status (batch 1 — 2026-07-04)
> **FIXED:** P0-1 (content logger → classic script `src/content/logger.js`, also added to executeScript file list), P0-2 (jsPDF downloaded + SRI cross-verified from 3 CDNs + hash pinned + webpack build assertion + release scripts now check jspdf and read version from package.json), P0-3 (review reads `asset.dataUrl` first), P0-4 (`getElementText` never returns typed values; regression tests added), P0-5 (SPA navigation capture works; navigation screenshot actually captured, gated on `captureOnNavigation`; `isInitialNavigation` removed), P0-6 (`getState` now includes settings), P0-7 (`minimum_chrome_version` → 98), P0-8 (dead custom-dropdown code removed, ~200 lines; init phases failure-isolated), FD-1 (auto-screenshot skips when recorded tab not visible), FD-2 (panel/heartbeat/nav-poll/auto-interval gated to top frame; event capture stays in all frames), FD-3 (FS `addAsset` accepts `dataUrl` or `data`), P1-19 (exportImageQuality enum aligned in background + recorder-utils, tests updated), P1 missing handlers (`restoreRecording`, `getIframeLabel` implemented in content.js).
> **Verified:** 409/409 unit tests, production build (with new lib guard), e2e suite re-run (see below).
> **FIXED (batch 1b — follow-up on the "0 steps captured" e2e observation):** `getSenderTabId` mis-attributed messages from extension pages hosted in a TAB (popup.html/review page opened or pinned as a tab): `sender.tab` exists for those, so the content-script branch returned the extension page's own tab and ignored the explicit `message.tabId` — recording would target the popup's tab and capture zero steps. Real toolbar-popup usage was unaffected (no `sender.tab`), but tabbed extension pages and the e2e harness hit it. Fix: honor explicit `tabId` when the sender URL is our own `chrome-extension://` origin (content scripts can never match — their sender.url is the web page). The lenient e2e test was tightened to a hard assertion and now proves capture end-to-end: **4/4 interactions captured** (was 0, silently tolerated).
> **NEW (noticed during fix):** sub-frames never re-attach event capture after a full-page navigation — the load-time restore is top-frame-only, so iframe interaction capture only works until the first navigation. Now that `_finishStartRecording` self-gates UI to the top frame, sub-frame restore could be enabled safely; left unchanged in this batch to keep the recovery path low-risk. (P2)
> **Still open:** remaining P1s (tab-close handling, ApiCapture after SW restart, double-start race, export cancel/progress, undo screenshot loss, double-escaping, FS backup omits screenshots, maxSessions in FS mode, review-page flush, badge after navigation, uninstall URL, orphan-cleaner gate), P2s, P3s.

Full-codebase audit on branch `fix/v1.1.6-parallel-fixes`. Baseline: **build passes, 407/407 unit tests pass** — but the tests do not cover several user-visible breakages below.

Severity: **P0** = shipped-broken feature or privacy issue · **P1** = wrong behavior users will hit · **P2** = correctness/robustness debt · **P3** = quality/perf/hygiene.

---

## P0 — Broken in the current build

### P0-1: `logger.js` throws SyntaxError on every page (content script is not a module)
`src/core/logger.js` ends with `export const Logger = {...}` but is injected as a **classic** content script (`manifest.json` → `content_scripts.js[0]`). Classic scripts cannot contain `export` → `Uncaught SyntaxError: Unexpected token 'export'` on **every page the user visits**, and `window.Logger` is never defined. All `window.Logger?.…` calls in content.js/selector.js/field-name-resolver.js silently no-op, so there is zero content-script logging (including errors) in production, plus a visible console error on every site.
**Fix:** ship a non-module copy for content-script use (e.g. strip `export` in a build transform, or a `logger.content.js` that only sets `window.Logger`), keep the ES module for `import` consumers. Verified in `dist/src/core/logger.js`.

### P0-2: PDF export cannot work — `libs/jspdf.umd.min.js` does not exist
`export-service.js:_loadJsPDF()` loads `libs/jspdf.umd.min.js`, but the file is missing from both `libs/` and `dist/libs/` (only `docx.min.js` + `html2pdf.bundle.min.js` are present; the libs folder predates the jspdf entry in `scripts/download-libs.js`). Every PDF export currently produces the `*_ERROR.txt` fallback.
**Fix:** run `npm run setup-libs`, and make the build **fail** if a required lib is absent (assert in webpack config or a prebuild script).

### P0-3: Review page never renders recorded screenshots
`review-standalone.js:resolveScreenshotUrl()` checks `asset.blob` then `asset.data` — but the background stores every captured screenshot under **`asset.dataUrl`** (`background.js` `storage.addAsset({... dataUrl})`; `FileSync.readAssets()` also returns `dataUrl`). Only manually-uploaded screenshots (stored as `data`) render. This is the same class of bug the export-service header documents having fixed (`_resolveAssetUrl` checks all three fields); the review page still has it.
**Fix:** check `asset.dataUrl` first (mirror `ExportService._resolveAssetUrl`), add a test.

### P0-4: Privacy leak — raw input values (incl. redacted/sensitive ones) stored in `targetLabel`
`content.js handleInput/handleChange` set `targetLabel: selectorEngine.getElementText(element)`, and `selector.js:getElementText()` returns **`element.value`** for `<input>` elements. The redactor masks `step.value`, but the raw, unmasked value (passwords, SSNs, emails…) is persisted verbatim in `step.targetLabel` and flows into storage, JSON export, and backups.
**Fix:** never use `element.value` as label text (use placeholder/label only), or run `targetLabel` through `redactor.maskValue()` / blank it when `isSensitive`.

### P0-5: SPA navigation capture is dead code
`content.js` navigation interval (≈line 1168) sets `lastNavigationUrl = window.location.href` **before** calling `captureNavigation()`, and `captureNavigation()` early-returns when `currentUrl === lastNavigationUrl` (≈line 1032). Additionally the `isInitialNavigation` flag consumes the first real URL change. Net effect: **no SPA navigation is ever recorded**; `navigate` steps only appear on full page reloads via the restore path. The `captureOnNavigation` ("Screenshot Before Navigation") setting is also not implemented end-to-end — the step carries `hasScreenshot: true` but the background never captures a screenshot for navigate steps.
**Fix:** let `captureNavigation()` own the `lastNavigationUrl` update; don't pre-set it in the interval. Decide and implement the navigation-screenshot behavior (background triggers `captureScreenshot` on navigate steps when enabled) or remove the setting.

### P0-6: Auto-screenshot (and all session settings) die after the first navigation
On page load the content script restores state via `getState`, reading `response.settings` — but `RecordingStateManager.getState()` never includes settings. `sessionSettings` becomes `{}` after every navigation, so the auto-screenshot interval is never re-armed mid-session (contradicting the in-code comments claiming it survives navigation).
**Fix:** include the resolved settings in the `getState` response (background has `settingsManager` right there).

### P0-7: `structuredClone` breaks the review page on Chrome 91–97
`review-standalone.js` uses `structuredClone` (history snapshots, ≈lines 399/420) which requires **Chrome 98**; `manifest.json` declares `minimum_chrome_version: "91"` and webpack/babel targets Chrome 88. Undo/history throws on older supported Chromes.
**Fix:** raise `minimum_chrome_version` to ≥98 (simplest) and align the babel target, or use a JSON-clone fallback.

---

## P1 — Wrong behavior users will hit

1. **`getIframeLabel` has no handler** — background's `getFrameLabel` relay (`background.js` ≈1356) sends `{action:'getIframeLabel'}` to frame 0; `content.js` has no such case → always "Unknown action" → the entire cross-frame label feature (`field-name-resolver.js:initFrameContext`) is dead.
2. **`restoreRecording` has no handler** — recovery (`background.js` ≈389) sends it; content.js replies "Unknown action". Recovery works only incidentally because injected scripts call `getState` at load. Either implement the handler or remove the message.
3. **Recording UI appears on every tab** — the load-time `getState` restore (`content.js` ≈1663) doesn't verify the tab is the recorded tab (content scripts can't see their tabId; background must tell them). Any page loaded in any tab during a recording shows the floating panel/timer; its steps are then rejected with 'Wrong tab' and panel buttons (screenshot) fail confusingly.
4. **Closing the recorded tab never stops the recording** — no `chrome.tabs.onRemoved`/`onReplaced` listener. State stays `recording` indefinitely; webRequest listeners stay attached; the badge/session only recover on browser restart. Add a tab-close handler that stops + marks incomplete.
5. **ApiCapture doesn't survive service-worker restarts** (acknowledged in a comment) and the recovery path never calls `ApiCapture.start()` — API-call capture silently stops mid-session.
6. **Double-start race** — `startRecording` checks `isIdle()` then awaits `createSession()` before setting state; two rapid start messages (popup double-click + hotkey) can create two sessions. Set state synchronously before the first await, roll back on failure.
7. **Export cancel is fake in the review page** — the Cancel button only hides the modal (`review-standalone.js` ≈263); the local `ExportService.cancelExport()` is never invoked. PDF export additionally never checks `_isCancelled` in its loop and drops the `notify` argument (`_exportPDF(exportData, sessionId)` — 2-arg signature, called with 3), so PDF has neither progress nor cancellation anywhere.
8. **Popup export progress never shows percentages** — `popup.js` passes `(pct) => typeof pct === 'number'…` but the service calls back with `{percent, status}` objects. Always displays bare "Exporting...".
9. **Delete step → Undo permanently loses the screenshot** — `handleDeleteStep` deletes the asset from storage; undo restores the step row via `updateAllSteps` but not the asset.
10. **Double-escaping corrupts descriptions in review** — `generateStepDescription()` (local copy) HTML-escapes field/value, then `renderSteps` escapes the whole description again → `O'Brien` shows as `O&#039;Brien` in the textarea; on blur the corrupted text is **persisted** as `step.description`.
11. **Backups in filesystem mode silently omit all screenshots** — `FSStorageManager.exportAllData()` FS path sets `assets: []` and strips `screenshotFile`; popup reports "Backup saved" with no warning; restore elsewhere loses every image.
12. **`maxSessions` cap doesn't apply in filesystem mode** — pruning in `stopRecording` uses the background's buffer `StorageManager`; FS sessions are invisible to it.
13. **Markdown export "Recorded:" is always blank** — it reads `session.startTime`, but `_formatSessionData` only produces `createdAt`. Also HTML-escaping is applied in a Markdown context (wrong escaping domain).
14. **DOCX/PDF print "Invalid Date"** when the include-timestamps setting is off (`new Date(undefined)` on `shot.timestamp`).
15. **Review page never flushes the buffer to disk** — the background comment claims the review tab reads the pending-flush key on load; it doesn't. Disk sync only happens the next time the popup opens. Session edits meanwhile live only in `chrome.storage`.
16. **Badge disappears after navigation** — tab-scoped badge text is cleared by Chrome on navigation; there's no `tabs.onUpdated` re-set while recording.
17. **Uninstall URL is a placeholder** — `https://forms.gle/testsnapper-feedback` is not a real forms.gle short link format; it will 404 for every uninstalling user.
18. **Manual-cleanup no-op** — the 7-day gate lives inside `OrphanCleaner.cleanupOrphans()` itself, so any explicit/manual invocation within 7 days silently does nothing; also Phase 1 loads every asset (full base64 screenshots) of every session into memory at once.

---

## P2 — Correctness & robustness debt

1. **Steps-cache aliasing** — `StorageManager._readSteps` returns the cached array by reference; `background.js getSessionSteps` sorts it **in place** and any caller mutation corrupts the cache. Return a copy (or freeze).
2. **No cross-context file locking** — popup and review page can both rewrite `sessions.json`/`session.json` (`FileSync._updateIndexForSession` read-modify-write); concurrent windows can clobber the index. `flush-utils` mutex is per-context only.
3. **`Math.random()` UUIDs** (`utils.js:generateUUID`) — use `crypto.randomUUID()`. Compounded by `FileSync._findSessionFolder` matching folders by the first-8-chars suffix, so an 8-hex collision silently reads/writes the wrong session folder.
4. **Selector strings don't escape quotes** — `[aria-label="${ariaLabel}"]`, `[name="${element.name}"]`, `[v-model="…"]` etc. (`selector.js`) generate invalid CSS when values contain `"`. `_isUnique` returns false but the broken selector can still be emitted as a candidate/primary.
5. **Selector/field-name WeakMap caches are never invalidated** on attribute/DOM changes — long-lived pages can record stale selectors. At minimum clear on navigation.
6. **Scoring gaps** — `data-test-id`/`data-cy` candidates get 0 base score (strategy string not in `strategyScores`); `_addNameSelectors` XPath candidate reuses the **CSS** uniqueness check; the React branch of `_addFrameworkSelectors` is an empty block.
7. **Background `exportSession()` function is dead** but reachable in principle: `setExporting()` clobbers an active recording state, and it duplicates the encode/download logic of `case 'exportSession'`. Delete or guard it.
8. **`sessionId` interpolated unescaped into popup HTML** (`popup.js renderCustomDropdown` `data-value="${s.sessionId}"`, `id="session-opt-…"`) while import validation never constrains sessionId charset → stored-XSS vector on an extension page. CSP (`script-src 'self'`) blocks inline handlers today, but escape it and validate sessionId (`SAFE_ID_RE`) on import.
9. **FS-mode import bypasses all validation** that buffer-mode `StorageManager.importData` performs (id regex, dataUrl allowlist, name caps) — `FSStorageManager.importData` writes straight to disk.
10. **`compress()` unawaited writer promises** (`compression.js`) — `writer.write()`/`close()` rejections become unhandled promise rejections outside the try/catch.
11. **`handleInput` debounce body is unprotected** — the try/catch wraps scheduling only; errors inside the `setTimeout` callback (selector generation on detached nodes) are uncaught.
12. **`markSessionIncomplete` stacks `[INCOMPLETE]` prefixes** on repeated recovery failures.
13. **`_isConsecutiveDuplicate` can swallow legitimate repeats** (two intentional clicks on "Add row" with no selector change are deduped regardless of time gap — background dedup has no time window, unlike the content-side one).
14. **Redactor `/auth/i`** matches "author"/"authority" fields → over-masking; DOB pattern masks any `MM/DD/YYYY` date in any field (e.g., appointment dates). Document or scope by field context like the routing-number check.
15. **Modal auto-submits the typed value after 30 s** (`content.js` modal timeout) — silently committing a half-typed field name is surprising; prefer cancel.
16. **Recovery doesn't restore `screenshotCount`**, and `chrome.tabs.query({url: session.env.url})` uses a full URL (with query) as a match pattern, which throws and is silently swallowed — the URL-based tab fallback effectively never matches URLs with query strings.

---

## P3 — Performance, hygiene, docs

1. **Dead code / dead weight:** `ImageProcessor.compressForStorage` (unused), `step-utils.js` (used only by tests), `html2pdf.bundle.min.js` ~900 KB shipped but never referenced, empty React branch in selector.js, `Utils.generateStepDescription` duplicated (and divergent) in review-standalone.js.
2. **O(n) per step append:** every `addStep` decompresses/recompresses the entire step array (gzip) and rewrites it; fine for dozens of steps, degrades for long sessions. Consider chunked/append-friendly storage.
3. **Quota check per write:** `getBytesInUse(null)` on every addStep/addAsset; cache with a short TTL.
4. **DOM export path encodes JPEG even when PNG is explicit** (`image-processor.js` `_processImageDOM`) — the MED-017 optimization was applied only to the offscreen path.
5. **`getAssetsByStepId` FS path** loads all screenshots of all sessions to find one step's asset.
6. **Logger production level never applies to copied files** — `process` is undefined at runtime in content scripts/UI pages, so they log at `info` in production builds (only the webpack-bundled background gets `warn` via DefinePlugin).
7. **Manifest hygiene:** `web_accessible_resources.matches: ["chrome-extension://*/*"]` is ineffective (extension pages don't need WAR; content scripts don't use these icons) — remove the block. `minimum_chrome_version 91` vs babel target 88 vs actual Chrome-98 API usage (see P0-7).
8. **SRI is warn-only with null hashes** in `scripts/download-libs.js` — the "SRI integrity" claim in CLAUDE.md isn't enforced; pin real sha384 hashes and fail on mismatch.
9. **Doc drift in CLAUDE.md:** references `src/core/dom-utils.js` (doesn't exist), "CDN fallback for docx and html2pdf" (removed; jsPDF local-only now), QuotaMonitor header claims `unlimitedStorage` was removed from the manifest (it wasn't). Popup storage bar uses a 1 GB reference while QuotaMonitor's non-unlimited budget is 500 MB.
10. **Repo hygiene:** stray root files `_smoke_settings.cjs`, `testsnapper-v1.1.4-*.zip`; `tests/debug_export.js`, `verify_*.js`, `__init__.py` mixed into `tests/`; review page has undo but no redo despite history plumbing.
11. **Test gaps:** 407 tests pass but nothing covers review-page screenshot resolution, navigation capture, content-script injection order/classic-script constraints, or targetLabel redaction — exactly where the P0s live. Add regression tests for each P0/P1 fix.

---

## Second-pass findings (UI markup, release scripts, docs)

### P1-19: "Export Image Quality" setting silently resets to Auto — enum mismatch
The popup select and `ExportService._resolveExportImageOpts()` use the values **`auto | high | standard`** ([popup.html:282-287](src/ui/popup/popup.html), [export-service.js:183](src/core/export-service.js)), but the background `SettingsManager.save()/get()` and `recorder-utils.validateSettings()` validate against **`['auto','png','jpeg-high','jpeg-standard']`** ([background.js:200,236](src/background/background.js), [recorder-utils.js:190](src/core/recorder-utils.js)). Picking "High" or "Standard" and saving silently stores `'auto'` — the setting only ever works as Auto, and the popup visibly reverts to Auto on reopen.
**Fix:** align all three enum lists to `auto | high | standard` (the UI/export-service set) and add a round-trip test.

### P1-20: Release packaging scripts verify the wrong libraries and hardcode stale versions
- `create-release-zip.sh` announces **v1.1.3** and names the zip `testsnapper-v1.1.3-*.zip`; `create-release-zip.bat` says **v1.1.4**; `package.json` is 1.1.5. Version should be read from `package.json`.
- Both scripts assert the presence of `docx.min.js` and **`html2pdf.bundle.min.js` (which is unused by the code)** but do **not** check `jspdf.umd.min.js` (which PDF export actually requires and which is currently missing — see P0-2). The release gate green-lights a broken PDF feature.

### P2-17: Stale comment says API-capture settings elements don't exist
[popup.js:249-250](src/ui/popup/popup.js) claims `captureApiCalls` etc. "have no corresponding HTML elements" — they exist in popup.html (lines 240-252). Comment is misleading maintenance debt (the optional chaining is harmless).

### P3-12: README / docs drift (second batch)
- README badge says **v1.1.3**; claims "docx.js + html2pdf.js, CDN with local fallback, SRI integrity" (html2pdf is unused, CDN fallback was removed, SRI isn't enforced); troubleshooting says "Chrome 88+" (manifest says 91, actual requirement is 98 — see P0-7); file-tree lists html2pdf but not jspdf.
- Review page's export dropdown lacks the **Markdown** option that the popup offers (`review-standalone.html:41-45`) — inconsistent feature surface.
- PRIVACY_POLICY states authentication data is never collected — the P0-4 `targetLabel` leak stores raw typed values (incl. passwords) in local session data and exports, contradicting the policy's spirit; fixing P0-4 is required to keep the policy accurate.

---

## P0-8 (E2E-CONFIRMED): Popup init crashes — most popup functionality is dead in this build

**Live evidence:** running the Playwright e2e suite against `dist/` → **6 of 40 tests fail**, headlined by `popup loads without uncaught exceptions`: `"Cannot read properties of null (reading 'setAttribute')"`.

**Root cause:** popup.html's Export tab uses a plain native `<select id="sessionDropdown">` ([popup.html:116](src/ui/popup/popup.html)) — the custom combobox markup (`sessionSelectWrapper` / `sessionSelectTrigger` / `sessionDropdownList`) does not exist in the HTML — but popup.js still carries the full custom-dropdown implementation. `setupCustomDropdown()` calls `trigger.setAttribute('role','combobox')` on a null element ([popup.js:814](src/ui/popup/popup.js:814)) and throws.

**Blast radius — `init()` aborts at line 97, so none of the following ever run** ([popup.js:94-113](src/ui/popup/popup.js:94)):
- `setupTheme()` → theme toggle dead (e2e failure #2)
- `fsStorage.init()` → popup storage never initialized
- `updateState()` + the 3s polling interval (registered after `await init()`) → recording state never displays (e2e failure #6)
- `checkFileSyncStatus()` → onboarding / re-auth banners never managed
- `flushAllPending()` → **the only automatic buffer→disk flush trigger never fires** — in filesystem mode, stopped recordings stay in chrome.storage indefinitely (escalates P1-15)
- `loadSessions()` → session dropdown is empty when the popup opens (only partially repopulated if a `sessionDataChanged` broadcast arrives while it's open; even then `renderCustomDropdown()` throws mid-way, swallowed by loadSessions' catch)
- `loadSettings()` / `loadExportFormat()` → settings tab shows HTML defaults, not saved values (e2e failures #4, #5)
- `updateStorageUsage()` → stuck at "Calculating..." (e2e failure #3)
- keyboard-shortcut help, version footer → dead

**Fix:** delete the dead custom-dropdown code paths (`setupCustomDropdown`, `renderCustomDropdown`, `selectCustomDropdownItem`) or reinstate the markup; either way make each `init()` phase failure-isolated (per-step try/catch) so one broken widget can't take down the whole popup. Add the e2e run to CI so `popup loads without uncaught exceptions` gates releases.

**E2E failures with this single root cause:** `popup loads without uncaught exceptions`, `popup theme toggle changes body data-theme attribute`, `export tab shows storage usage section`, `settings: changing maxSessions persists`, `settings: autoScreenshot toggles and saves`, `recording: start button transitions to recording state`. (34 of 40 passed — mostly static-markup and review-page checks.)

---

## Feature deep-dive findings (end-to-end flow traces)

### FD-1 (P0/privacy): Auto-screenshot can capture the WRONG tab's content
`captureScreenshot()` in auto mode never verifies the recorded tab is the active tab. `chrome.tabs.captureVisibleTab(tab.windowId)` captures **whatever tab is currently visible in that window**. If the user switches tabs mid-recording while auto-screenshot is on (the interval still fires, throttled, from the backgrounded recorded tab), screenshots of unrelated tabs — mail, banking, anything — are captured and attached to the session as "Auto Screenshot" steps labeled with the recorded tab's URL. The manual path activates the tab first ([background.js:585-588](src/background/background.js:585)); the auto path skips that and captures blind ([background.js:604](src/background/background.js:604)).
**Fix:** in the auto path, `if (!tab.active) return {success:false, error:'Tab not visible'}` before capturing.

### FD-2 (P1): `startRecording` message is not frame-gated — every iframe runs the full recording UI
The load-time restore is correctly gated to the top frame ([content.js:1660](src/content/content.js:1660)), but the `startRecording`/`restoreRecording`-era message path is not: `chrome.tabs.sendMessage(tabId, …)` without `frameId` broadcasts to **all frames** (`all_frames: true`), and the content handler ([content.js:1580](src/content/content.js:1580)) starts recording in every frame. Consequences on any page with iframes:
- `addRecordingIndicator()` appends a **floating panel inside every iframe's body** (visible in large embeds).
- Every frame runs its own 15-second `validateSession` heartbeat and 1-second navigation poll — an ad iframe rotating its URL generates junk `navigate` steps for iframe URLs.
- With auto-screenshot on, every frame runs its own capture interval (N frames × requests; rate limiter absorbs the writes but not the message spam).
Event listeners in iframes ARE needed (to capture clicks inside frames) — the fix is to gate the *panel, heartbeat, navigation poll, and auto-screenshot interval* to `window === window.top`, keeping only event capture in subframes.

### FD-3 (P1): Manually-uploaded screenshots are silently discarded in filesystem mode
`FSStorageManager.addAsset()` FS path only writes the screenshot when **`asset.dataUrl`** is set ([fs-storage.js:715](src/core/fs-storage.js:715)), but the review page's Add Step uploads pass `blob` + `data` — never `dataUrl` ([review-standalone.js:812-820](src/ui/review/review-standalone.js:812)). Once a session has been flushed to disk, adding a step with a screenshot silently drops the image (`updated` stays false, no error, no file written). Mirror image of P0-3. Fix both together: agree on one canonical field (`dataUrl`) or accept all three everywhere.

### FD-4 (P2): Sensitive-field suppression is unreliable for payment/credential iframes
Before an auto-screenshot, the background asks `isSensitiveFieldActive` via `tabs.sendMessage` without `frameId` — all frames receive it and **the first responder wins**. When the focused sensitive field lives inside an embedded iframe (the classic Stripe/checkout case), the top frame's `document.activeElement` is the `<iframe>` element → it answers `sensitive: false`, usually first. The suppression feature works only for same-frame fields.

### FD-5 (P2): Filesystem migration leaves full data copies in chrome.storage forever
`FileSync.migrateFromChromeStorage()` writes every session to disk and sets the migrated flag, but never deletes the migrated sessions from `chrome.storage.local`. All steps and base64 screenshots remain buffered indefinitely — invisible to the UI in FS mode, but consuming quota (and re-importable as stale data). Clear each session from the buffer after a successful `writeSession`.

### FD-6 (P3): E2E suite avoids every broken path
The 40 Playwright tests cover popup/review UI plumbing but have **zero coverage** of: screenshot rendering in review (P0-3), PDF export (P0-2), SPA navigation capture (P0-5), auto-screenshot, iframe behavior (FD-2), settings enum round-trips (P1-19), or backup/restore. The suite passing is not evidence the features work.

---

## Suggested fix order

1. P0-1, P0-2 (build-breaking: logger + jspdf, plus build-time lib assertion)
2. P0-4 (privacy), P0-3 (review screenshots), P0-5/P0-6 (navigation + settings), P0-7 (min Chrome version)
3. P1 items 1–7 (dead handlers, tab lifecycle, export cancel/progress)
4. P1 items 8–18, then P2, then P3 cleanups
