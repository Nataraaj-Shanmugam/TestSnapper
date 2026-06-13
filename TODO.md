# TestSnapper â€” Consolidated Fix TODO

Single actionable checklist built from the 65 reviewer observations in [Observations/](Observations/).
**Organized by source file** so a fixing agent can work one file top-to-bottom with full context and minimal edit conflicts. Each item is self-contained: severity, originating observation ID(s), exact file + lines, the **Problem**, the **Impact**, and the **Fix**. Cross-file fixes are listed under their primary file and name the secondary files.

> 58 work items consolidated from 65 observations (7 cross-cutting duplicates merged). Every observation ID still appears. For the full reasoning/snippets behind any item, open the matching `Observations/<ID>-*.md`.

## How to use
1. Do the **Critical** items first (see priority list), then High â†’ Medium â†’ Low, or just go file-by-file if you prefer fewer context switches.
2. Tick each `- [ ]` as you complete it. Sub-bullets under an item are the concrete edits.
3. Items tagged with multiple IDs (e.g. `[PERF-010+FUNC-012]`) are merged duplicates â€” one fix resolves all listed observations.
4. This TODO only fixes code; the `Observations/*.md` files are the backing detail and can stay.

## Priority checklist (do these first)

**Critical (6):**
- [x] FUNC-001+PERF-006 â€” re-injection breaks recording (class decls + globals reset)
- [x] FUNC-002 â€” recording leaks into every tab and iframe
- [x] FUNC-003+PERF-001 â€” SW-restart race kills the live session
- [x] PERF-002 â€” per-screenshot whole-asset-array rewrite (O(nÂ²))
- [x] PERF-003 â€” export buffers all screenshots in RAM
- [x] PERF-004 â€” crash-recovered sessions stranded invisible

**High (17):** FUNC-004, FUNC-005+PERF-011+SEC-004, FUNC-006, FUNC-007, FUNC-008, FUNC-009, PERF-005, PERF-007, PERF-008, PERF-009, PERF-010+FUNC-012, UX-001, UX-002, UX-003, UX-004.

## Severity rollup
| Severity | Count |
|----------|-------|
| Critical | 6 |
| High | 17 |
| Medium | 25 |
| Low | 17 |
| **Total observations** | **65** (â†’ 58 work items after merges) |

---

## src/background/background.js
Service worker: recording state, screenshots, exports, session recovery.

- [x] **[CRIT][FUNC-003+PERF-001]** SW-restart race rejects steps and silently kills recording â€” `background.js` 304-417 (recovery IIFE), 822-826 (`addStep`), 1002-1006 (`onMessage`); also `content.js` 979-1003, 1068-1074.
  - Problem: the async recovery IIFE repopulates `stateManager` only at ~373-376, but `onMessage` is registered synchronously, so the message that woke the worker (`addStep`/`getState` heartbeat) runs while `stateManager.session` is still `null` â†’ returns `'No active session'`.
  - Impact: the waking interaction is lost; the content script then calls `stopRecording()` and tears down all listeners â€” unbounded silent data loss for the rest of a long session.
  - Fix: capture the recovery promise at module scope `const recoveryReady = (async () => { â€¦recoveryâ€¦ })();` and `await recoveryReady` at the top of the `onMessage` async body and the `commands.onCommand` handlers before touching `stateManager`. In `addStep`, if `session` is null but `activeRecording` exists in storage, restore lazily / buffer instead of rejecting. In `content.js sendStepToBackground()` / `validateSession()`, retry once after a short delay before treating `'No active session'` as fatal; show a toast instead of silently stopping. Consider a `chrome.alarms` 1-min checkpoint during recording.

- [x] **[CRIT][PERF-004]** Crash-recovered "incomplete" sessions are stranded and invisible in every UI â€” `background.js` 260, 386-410, 422-433, 760-770; also `fs-storage.js` 311-341, `flush-utils.js` 14-20, `popup.js` 96-97, 625.
  - Problem: `addPendingFlush(sessionId)` is only called on clean `stopRecording` (760-761). On crash/tab-gone, recovery calls `markSessionIncomplete` + removes `activeRecording` but never enqueues a pending flush, and `fs-storage.getAllSessions` overlays only *pending* buffered sessions (325-337) â€” so the fully-persisted session is in neither the FS index nor the pending list.
  - Impact: 100% effective data loss of a crashed recording despite the bytes still being in `chrome.storage.local`; its `steps_/assets_` keys also leak permanently.
  - Fix: in `markSessionIncomplete()` and both recovery failure paths (386-391, 392-410), call `addPendingFlush(sessionId)` before removing `activeRecording`. Defense-in-depth: in `fs-storage.getAllSessions()` overlay **all** buffered sessions (flag `buffered:true`), not just pending ones. Add a test: kill state with `activeRecording` present + tab absent, restart, assert the session lists and flushes.

- [x] **[HIGH][FUNC-004]** Programmatic injection omits `field-name-resolver.js` â†’ silent zero-step recordings â€” `background.js` 347-350 and 638-641; also `content.js` 56-77, 650, `manifest.json` 40-45.
  - Problem: the manifest injects 4 content scripts but both `executeScript` calls inject only 3 (no `field-name-resolver.js`). `content.js initModules()` requires `window.FieldNameResolver`; without it `selectorEngine`/`redactor` stay undefined and every handler bails.
  - Impact: starting a recording on a tab opened before the extension was installed/reloaded shows a working badge/panel but captures zero steps, with no error.
  - Fix: add `'src/content/field-name-resolver.js'` to both file lists (order: selector â†’ field-name-resolver â†’ redactor â†’ content). Extract the list to one shared constant so the two never drift. In `content.js`, if `initModules()` ultimately fails, respond to `startRecording` with `{success:false,error:'modules not loaded'}` so the badge isn't shown.

- [x] **[HIGH][PERF-009]** Orphan cleanup loads every session's full screenshot data into SW memory on every startup and after every stop â€” `background.js` 277-287, 721-726; also `orphan-cleaner.js` 46-72, `storage.js` 474-476.
  - Problem: an unconditional `storage.cleanupOrphans()` runs on every SW cold start and after every `stopRecording`, and `cleanupOrphans` decompresses every session's steps and reads every session's asset data URLs into the heap. The weekly `lastCleanup` gate is bypassed.
  - Impact: memory-spiking, slow SW cold starts proportional to total stored screenshot bytes, repeated dozens of times per browsing session; widens the FUNC-003/PERF-001 race window.
  - Fix: remove the unconditional startup `cleanupOrphans()` (278-287) â€” rely on `_autoCleanupCheck()` inside `storage.init()` which honours the 7-day interval. Scope post-stop cleanup to the just-stopped session (`cleanupOrphans(sessionId)`). In `orphan-cleaner.js`, compare ids/stepIds only â€” never load image bytes for orphan detection (works once PERF-002's per-asset keys exist).

- [x] **[MED][FUNC-016]** Stop/pause/screenshot act on the *active* tab, not the *recorded* tab â€” `background.js` 974-980, 705-719, 669-703, 1205-1238.
  - Problem: `getSenderTabId` falls back to the active tab and the keyboard commands query `{active:true}`; popup messages have no `sender.tab`, so controls hit whatever tab is focused, not `stateManager.session.tabId`.
  - Impact: stopping/pausing from another tab leaves the recorded tab's panel/listeners/intervals alive with a stale badge; screenshots of unrelated tabs can enter the session.
  - Fix: route `stopRecording`/`pauseRecording`/`resumeRecording` and the `commands.onCommand` handlers to `stateManager.session?.tabId` for `BadgeManager` and `sendMessage`. In `captureScreenshot` (509), validate `tabId === stateManager.session.tabId`.

- [x] **[MED][FUNC-017]** Dead background export pipeline diverges from the live UI path â€” `background.js` 868-970, 985-998, 1039-1041, 1079-1081; also `popup.js` 387-423, `review-standalone.js` 908-950.
  - Problem: `exportSession()`/`getScreenshot` handlers (and the write-only `activeExport` key, `setExporting`) have **no sender** â€” both UIs export locally via their own `ExportService`. The dead path reads the chrome.storage buffer (stale for flushed sessions) and would also break in a SW (`window`/`document` refs).
  - Impact: ~170 lines of divergent dead code; filename/download logic duplicated in 3 places; false impression that export crash-recovery exists.
  - Fix: delete the unreachable `exportSession`/`getScreenshot` handlers + helpers (and `setExporting`/`'exporting'` state if unused). Extract the shared "result â†’ sanitized filename â†’ downloadUrl â†’ `chrome.downloads.download`" logic from `popup.js` and `review-standalone.js` into one helper in `dom-utils.js`.

- [ ] **[MED][SEC-002]** Screenshots capture on-screen secrets/PII despite text redaction â€” `background.js` 509-615; also `redactor.js` 79-145, `content.js` 957-960, 1005-1014.
  - Problem: `redactor.maskValue` masks only the recorded text `value` of sensitive fields; `captureVisibleTab` records whatever is rendered (tokens/SSNs/cards in `type=text`, OTP, "show password" reveals, PII already on the page), stored verbatim and embedded into `session.json` and DOCX/PDF.
  - Impact: recordings/backups/exports can leak plaintext images of credentials and PII even when the field value was redacted.
  - Fix: document clearly (UI + PRIVACY_POLICY) that screenshots are not redacted. Suppress auto-screenshot while `document.activeElement` matches `redactor.shouldIgnoreField`. Add a setting to disable screenshots on sensitive pages/fields and/or region-mask matching elements before capture.

- [x] **[LOW][SEC-005]** `onMessage` does no sender validation and trusts caller-supplied `message.tabId` â€” `background.js` 974-980, 1002-1201.
  - Problem: privileged actions dispatch without inspecting `sender`; `getSenderTabId` prefers `message.tabId` (caller-controlled) over `sender.tab.id`. (Mitigated today: no `externally_connectable`, no `onMessageExternal`.)
  - Impact: defense-in-depth gap â€” if the message surface is ever exposed, attacker-chosen `tabId` could drive cross-tab capture / storage manipulation.
  - Fix: only honour `message.tabId` when `sender` is a trusted extension page (`sender.id === chrome.runtime.id` and no `sender.tab`); for content scripts always use `sender.tab.id`. Add an explicit `sender.id === chrome.runtime.id` check at the top of the handler. Never add `externally_connectable` without per-action authorization.

---

## src/content/content.js
Event capture, floating panel, modal system, toasts, navigation polling.

- [x] **[CRIT][FUNC-001+PERF-006]** Content-script re-injection breaks recovery (SyntaxError) and leaks listeners/intervals â€” `content.js` 4-30, 1032-1044, 1068-1089, 1145-1161; `selector.js` 8, `redactor.js` 15; `background.js` 345-353, 638-647.
  - Problem: `selector.js`/`redactor.js` use top-level `class` (lexical binding) â†’ re-injecting throws `Identifier already declared`, which makes recovery's `executeScript` reject and `markSessionIncomplete` brand the live session `[INCOMPLETE]`. Separately, re-running `content.js` reassigns top-level `var` globals (`eventListenerController`, the interval handles) to null while the previous run's `AbortController`/intervals/listeners stay alive but unreachable â†’ duplicate polls/heartbeats and un-abortable listeners that run forever.
  - Impact: every SW restart during recording can orphan the session and silently lose the remainder; CPU/memory leak grows with each restart.
  - Fix: in `selector.js`/`redactor.js` make the classes re-injection-safe (`var X = class {â€¦}` or `if (!window.X) { â€¦ }`). In `content.js`, bail on re-init: wrap top-level state in `if (!window.testSnapperInitialized) { â€¦ }` or keep state on a single reused `window.__testSnapperState`; before creating new listeners/intervals in `startRecording`, abort the old controller and `clearInterval` all old handles. In `background.js` recovery (345-353), ping the tab first (`{action:'ping'}`) and only `executeScript` when absent; wrap the inject in its own try/catch tolerating "already declared".

- [x] **[CRIT][FUNC-002]** Recording activates in every tab and every iframe, not just the recorded tab â€” `content.js` 1543-1561; also `background.js` 74-80, 1029-1031, `manifest.json` 34-48.
  - Problem: scripts inject into `<all_urls>` + `all_frames:true`; the restore block starts recording whenever `getState` reports an active session, with no check that this document belongs to the recorded tab. Every other tab and every iframe then captures events, adds its own panel/poll/heartbeat/screenshot interval.
  - Impact: clicks/typed values from unrelated tabs (Gmail subject lines, searches) enter the session â€” functional + privacy failure; duplicate panels and spurious steps on multi-frame pages.
  - Fix: have `getState` return both `session.tabId` and the sender's tab id (`sender.tab?.id`), and in `content.js` only restore when they match; gate auto-restore + floating panel to the top frame (`if (window !== window.top) return;`). In `background.js addStep`, validate `sender.tab.id === stateManager.session.tabId` before accepting a step.

- [x] **[HIGH][PERF-010+FUNC-012]** SPA navigation screenshots are treated as "manual" â€” bypass the 1s rate limit and steal tab/window focus â€” `content.js` 957-960, 1081-1089; also `background.js` 509-541, 1033-1037.
  - Problem: `captureNavigation()` omits `isManual:false`; the BG default treats missing flag as manual, which skips the rate limit and forcibly `tabs.update({active})` + `windows.update({focused})`. `captureOnNavigation` defaults true and URL changes are polled every 1s.
  - Impact: on SPAs the window is repeatedly yanked back to the recorded tab; unthrottled full-size PNG bursts hit `captureVisibleTab`'s 2/s quota (errors â†’ failed steps) and amplify storage churn; steps mislabeled "Manual".
  - Fix: send `{action:'captureScreenshot', sessionId, isManual:false}` from `captureNavigation` (959). In `background.js`, invert the default so captures are auto unless explicitly `isManual === true` (only popup/panel/keyboard pass true); even for manual, skip `tabs.update/windows.update` when `tab.active` is already true. Fix the misleading "before navigation" comment (957).

- [x] **[MED][FUNC-011]** Session settings lost on navigation â†’ auto-screenshot silently stops â€” `content.js` 1543-1561, 1016-1022, 1005-1013; also `background.js` 74-80.
  - Problem: the restore-on-load call passes no `settings`, so after the first navigation `sessionSettings` is `{}` and `startAutoScreenshotInterval` returns early.
  - Impact: any multi-page recording loses its configured auto-screenshots after the first navigation, with no indication.
  - Fix: include current settings in the `getState` response, and pass them through in the restore call: `startRecording(..., response.settings || {})` for both `recording` and `paused` branches. Alternatively have `startRecording` fetch settings itself when empty during restore.

- [x] **[MED][FUNC-014]** PII pattern masking is unreachable â€” emails/phones/cards stored in plaintext â€” `content.js` 804-805, 868-871; also `redactor.js` 79-145.
  - Problem: callers run `maskValue` only when `shouldIgnoreField` is already true, but `maskValue` early-returns for those fields â€” so the entire PII-pattern body (and the PIN branch) is dead. PII typed into a generic field is stored verbatim.
  - Impact: advertised redaction silently fails for non-keyword fields; PII propagates to `session.json` and every export.
  - Fix: always run values through the redactor in `handleInput` (805) and `handleChange` (870): `const value = redactor.maskValue(element.value, element);`. Remove the unreachable inner `shouldIgnoreField` check in `redactor.js` (137-142). Set `isSensitive` when pattern masking actually changed the value.

- [x] **[MED][PERF-015]** Heavy synchronous selector + field-name work inside capture-phase handlers (incl. per keystroke) â€” `content.js` 666-667, 795, 845, 851-852; also `selector.js` 59-129, 790-819, `field-name-resolver.js` 374-407.
  - Problem: `handleClick` runs ~11 selector strategies with whole-document uniqueness probes; `_fromProximityText` calls `getBoundingClientRect()` per text node (layout thrash); `handleInput` calls `generateSelector` on every keystroke just to build the debounce key, before the 800ms debounce.
  - Impact: 5-100ms added per first interaction on large DOMs, in the capture phase ahead of the page's own handlers â†’ input latency on exactly the heavyweight apps targeted.
  - Fix: in `handleInput` use the element object itself as the debounce Map key and defer `generateSelector` to the debounced callback. In `_fromProximityText` cap candidates (~first 30 text nodes) and bail when one within ~150px is found. In `generateSelectors` short-circuit once a high-score unique candidate (ID/data-testid/name) is found. Move alternatives/element-path behind lazy/raf-deferred computation.

- [x] **[HIGH][UX-001]** Injected modal + toast have no style isolation and leak global keyframes into host pages â€” `content.js` 336-433, 414-430, 743-774, 766-773 (compare 1177-1179).
  - Problem: the panel uses Shadow DOM but the field-name modal and toast are appended to `document.body` with inline styles only, and both inject generically named `@keyframes fadeIn/slideUp/fadeOut/slideInRight` into the page.
  - Impact: host CSS (Bootstrap/Animate.css/Tailwind) restyles/breaks the modal/toast, and the extension can corrupt the host page's own animations while recording.
  - Fix: render the modal (`showManualEntryModalInternal`, 300-488) and toast (`showToastNotification`, 714-781) inside Shadow DOM hosts like `addRecordingIndicator`, moving the keyframes into the shadow root. Add explicit `font-family/size/line-height/box-sizing/text-transform:none` resets on modal heading/paragraph/buttons. If Shadow DOM isn't adopted, at minimum prefix keyframe names (`testsnapper-fade-in`).

- [x] **[HIGH][UX-002]** Injected-UI theme detection reads a transparent body background as "black", forcing dark UI on light pages â€” `content.js` 313-322 (modal), 720-729 (toast), 1182-1191 (panel).
  - Problem: luminance is computed from `getComputedStyle(document.body).backgroundColor` without checking alpha; an unset body background computes to `rgba(0,0,0,0)` â†’ luminance 0 â†’ classified dark. Fallback defaults are also inconsistent (modal/toast `light`, panel `dark`).
  - Impact: on the many sites that leave `body` unset, the panel/modal/toasts render as dark boxes on white pages â€” looks broken.
  - Fix: extract one helper that parses alpha â€” if `body` background is transparent, fall back to `documentElement`'s computed background, else default **light**; blend semi-transparent backgrounds over white before computing luminance. Unify the fallback to `light` across all three.

- [ ] **[MED][UX-011]** Field-name modal discards typed input after 30s and has no dialog semantics/focus trap â€” `content.js` 336-350, 363-412, 441-445, 482-487.
  - Problem: a 30s `setTimeout` calls `closeModalById(modalId, null)` and is never reset on typing; the overlay has no `role="dialog"`/`aria-modal`/`aria-labelledby`; focus is set on a timer but never restored.
  - Impact: users lose typed field names with no warning; screen-reader users aren't told a modal opened; keyboard focus escapes behind the overlay into a page the extension thinks is paused.
  - Fix: reset the timeout on `input` (or show a visible countdown) and on timeout submit the typed value instead of `null`; add `role="dialog"`, `aria-modal="true"`, `aria-labelledby`; trap Tab within inputâ†’Skipâ†’Confirm and restore focus to the element captured before opening.

- [x] **[LOW][FUNC-020]** Restore-without-startTime path is a no-op (recursive `startRecording` hits the `isRecording` guard) â€” `content.js` 1016-1058.
  - Problem: `startRecording` sets `isRecording=true`, attaches listeners, then for the missing-start-time case recurses; the recursive call returns immediately at the guard, so panel/heartbeat/nav-poll/auto-screenshot are never set up.
  - Impact: edge-case restores produce a headless recorder â€” events captured but no panel/timer/stop UI, no navigation steps, no heartbeat.
  - Fix: extract panel/heartbeat/interval setup into a `finishStart(startTime)` helper called from both the normal path and the async `getSession` callback; delete the recursive call.

- [x] **[LOW][UX-019]** Injected in-page UI uses a hardcoded off-brand palette â€” `content.js` 325-333, 403, 443-449, 457-458, 566-567, 739, 1213-1255, 1275-1278.
  - Problem: the modal/highlight/toast/panel use Tailwind blue `#2563eb` and warm-black grays instead of the popup/review "Steel & Slate" tokens (`#4A7FB5`, slate neutrals).
  - Impact: the in-page UI looks like a different product than the launcher; palette changes must be made in two unrelated places.
  - Fix: define the shared palette once as JS constants (e.g. `src/core/ui-tokens.js`) and consume in `content.js`; replace `#2563eb`/`#1d4ed8` with `#4A7FB5`/`#3A6699` and `#1a1a1f`/`#2e2e35` with slate `#1E293B`/`#334155`.

---

## src/core/storage.js
StorageManager: split-key storage, compression, quota, migration.

- [x] **[CRIT][PERF-002]** Every screenshot rewrites the entire asset array (O(nÂ²) I/O + SW memory spikes) â€” `storage.js` 154-171, 753-786; also `background.js` 595-607.
  - Problem: all screenshots live in one `testsnapper_assets_{id}` key; `addAsset` reads the whole array, pushes, and writes it all back â€” k-th screenshot costs kÃ—S bytes; `getAssetsByStepId` without a sessionId scans every session.
  - Impact: heap spikes proportional to total screenshot bytes on every capture (SW OOM risk â†’ triggers PERF-001); capture latency grows linearly; ~1.9GB cumulative traffic for 50Ã—1.5MB (estimate).
  - Fix: store each asset under its own key `testsnapper_asset_{sessionId}_{assetId}` with a small per-session id-index â†’ `addAsset` O(1). Make `getAssetsByStepId` require/propagate `sessionId` (callers in `background.js` 985-998). Keep `_readAssets/_writeAssets` for migration only. Consider downscaling/compressing at capture time (`ImageProcessor.compressForStorage` exists but is never called).

- [x] **[HIGH][FUNC-007]** `compress()` failure fallback writes a format `_readSteps` can't read â†’ silent loss of all steps â€” `storage.js` 116-130; also `compression.js` 61-65.
  - Problem: on GZIP failure `compress()` returns plain `JSON.stringify(data)` (no prefix); `_readSteps` only handles the `COMPRESSED::GZIP::` prefix or an array, so a plain string yields `[]`. Then `updateSession` recomputes `stepCount=0` and orphan cleanup purges the screenshots.
  - Impact: one compression failure â†’ every step of the session silently dropped on next read and screenshots purged; unrecoverable, only a console warning.
  - Fix: in `_readSteps` handle plain strings: `if (typeof data === 'string') return await decompress(data);` (decompress already JSON-parses non-prefixed strings). Optionally give the uncompressed fallback its own self-describing prefix. Add a unit test with a mocked failing `CompressionStream` that round-trips.

- [x] **[HIGH][FUNC-008]** Unserialized read-modify-write â†’ concurrent steps/assets lost; retries duplicate â€” `storage.js` 617-636, 753-786, 554-573; also `background.js` 822-860, 575-608, `flush-utils.js` 14-26.
  - Problem: every mutation is readâ†’pushâ†’write with awaits between and no serialization; two near-simultaneous `addStep`/`addAsset` both read the same array and the second `set` overwrites the first. `_retryOperation` re-runs the whole closure â†’ duplicate push on partial failure. `addPendingFlush`/`removePendingFlush` have the same shared-array RMW race.
  - Impact: rapid interactions (typing+clicking, nav+screenshot bursts, multi-frame) intermittently drop or duplicate steps/screenshots; silent and non-deterministic.
  - Fix: add an async mutex (`this._writeQueue = this._writeQueue.then(op)`) wrapping all RMW methods (`addStep`, `addAsset`, `updateSession`, `updateAllSteps`, `deleteStep`, `batchDeleteSteps`, `clearSession`, `createSession`). Make retried closures idempotent (`steps.some(s => s.id === step.id)` before push). Serialize `addPendingFlush`/`removePendingFlush` or store pending ids as individual keys.

- [x] **[HIGH][PERF-005]** Each step re-reads/re-GZIPs/rewrites the whole step array + 3 redundant writes (O(nÂ²)) â€” `storage.js` 116-145, 554-573, 617-636; also `compression.js` 17-66, `background.js` 829-853, 489-501.
  - Problem: one `addStep` does `_checkQuota` + full `_readSteps` decompress + push + full `_writeSteps` recompress + `_writeSessions`; then `updateSession` does **another** full `_readSteps` decompress just to recount `stepCount`; then `persistActiveRecording` writes the whole session. Per-step cost grows with step count.
  - Impact: step-commit latency grows over long recordings; gzip+base64 of the whole array runs on the SW thread that also handles screenshots/exports.
  - Fix: keep an in-memory steps cache per active session so `addStep` appends without re-reading (or chunk steps into `..._{chunk}` keys and rewrite only the tail). Make `updateSession` accept a known `stepCount` (pass `stateManager.session.stepCount`) instead of recounting. Merge the redundant `updateSession` write into `addStep`'s existing `_writeSessions`. Defer GZIP to flush/stop time; store plain array during recording.

- [x] **[MED][PERF-012]** Retry wrapper re-runs non-idempotent multi-key sequences â†’ duplicate steps/assets â€” `storage.js` 183-196, 617-636, 753-786, 492-519.
  - Problem: `_retryOperation` re-runs the entire closure; if `_writeSteps` succeeded but `_writeSessions` threw, the retry re-reads (now-containing) steps and pushes again. `createSession` retry hits "already exists". `_checkQuota` deterministic throws burn 3 backoff attempts.
  - Impact: duplicate steps (partly masked by review dedup) and duplicate multi-MB screenshot assets (never deduped); ~600ms futile retries per step on deterministic quota errors.
  - Fix: make `addStep`/`addAsset` closures idempotent (id existence check before push). In `createSession`, treat "already exists" on retry as success when content matches. Classify `_checkQuota` errors as non-transient so `_retryOperation` doesn't retry them.

- [x] **[MED][PERF-013+FUNC-019]** Interrupted `clearSession` orphans `steps_/assets_` keys that no cleanup can find; orphan cleaner never reclaims deleted-session keys â€” `storage.js` 858-881; also `orphan-cleaner.js` 23-72, `background.js` 741-757.
  - Problem: `clearSession` removes the session index entry first, then the data keys in separate awaits â€” a SW kill between leaves orphaned `testsnapper_steps_{id}`/`assets_{id}` with no referencing session. `OrphanCleaner` only iterates existing sessions, so it never finds keys orphaned from *sessions*. `maxSessions` pruning runs this loop after every stop.
  - Impact: permanent invisible storage leak (tens of MB per occurrence); inflates `getBytesInUse`/full-scans forever.
  - Fix: in `clearSession`, remove `steps`/`assets` keys **first**, index entry last (a session pointing at missing keys self-heals to `[]`). In `cleanupOrphans`, add a key sweep: `chrome.storage.local.get(null)`, collect `testsnapper_(steps|assets)_*` whose sessionId isn't in `_readSessions()`, and remove. Re-run the sweep after `maxSessions` pruning.

- [x] **[MED][FUNC-010]** v1â†’v2 migration never runs when no meta key exists â€” legacy `testsnapper_data` stranded â€” `storage.js` 66-73; also `schema-migrator.js` 24-31.
  - Problem: `_readMeta` defaults a missing meta key to `{version: STORAGE_VERSION}` (=2), so `migrateIfNeeded` sees an up-to-date version and skips, then stamps version 2 permanently â€” locking out the v1 blob migration.
  - Impact: users upgrading from a v1 layout lose all prior sessions (vanish from UI) while the dead blob keeps consuming storage; loss is permanent.
  - Fix: in `schema-migrator.js` detect v1 directly â€” check `chrome.storage.local.get('testsnapper_data')` regardless of `meta.version` and convert when present (removed after, so idempotent). In `_readMeta`, stop defaulting `version` to current for a missing key (return `undefined`/`1`); write `STORAGE_VERSION` only after `migrateIfNeeded` completes.

---

## src/core/export-service.js
Export orchestration (JSON, CSV, DOCX, PDF), chunking, screenshot processing.

- [x] **[CRIT][PERF-003]** Export buffers every screenshot in RAM in 4-6 concurrent copies; nothing streams â€” `export-service.js` 310-341, 459-491, 553-556; also `background.js` 909-937, `review-standalone.js` 919-941.
  - Problem: `getAllAssets` (originals) + `screenshotMap` (processed) coexist for the whole loop; each image is base64-decoded to a `Uint8Array` for `ImageRun`; `Packer.toBuffer` materializes the whole .docx; then it's converted to a base64 data URL (+33%) for `chrome.downloads.download`. The CHUNK_SIZE batching only batches table-row construction, not memory.
  - Impact: ~300-500MB peak heap for 50Ã—1.5MB (estimate); 100+ screenshots likely crashes the page; a 100MB+ base64 `data:` download may fail outright.
  - Fix: release source assets incrementally (null out `asset.dataUrl`, or fetch one asset at a time once PERF-002's per-asset keys exist). Decode base64 lazily per image and delete the map entry right after building each `ImageRun`. In window contexts use `URL.createObjectURL(result.blob)` for the download instead of `blobToDataURL` (revoke after start). Auto-cap processed resolution (maxWidth 1280) or use `jpeg` for large sessions.

- [x] **[HIGH][FUNC-005+PERF-011+SEC-004]** PDF export can never succeed (CDN-only jsPDF blocked by CSP); SW DOCX wastes work; no SRI â€” `export-service.js` 804-893, 256-298, 625-633; also `manifest.json` 25-27, `review-standalone.html` 43, `scripts/download-libs.js` 30-90, `libs/`.
  - Problem: `_exportPDF` loads jsPDF only from cdnjs (no local lib, no `integrity`); extension CSP `script-src 'self'` always blocks it â†’ export rejects. Even if loaded, it returns `content:null` â†’ a junk `*.pdf` containing "null" downloads. In the SW path, `_exportDOCX` runs the full image pipeline only to fall back to the imageless ZIP builder with a misleading "images embedded" note. `download-libs.js` fetches libs with no hash check.
  - Impact: selecting PDF always shows "Export failed"; SW DOCX burns seconds of CPU + hundreds of MB for zero images; build-time supply-chain risk.
  - Fix: ship jsPDF locally (`libs/jspdf.umd.min.js`) and load via `chrome.runtime.getURL` like the docx path; remove the CDN-only branch; make `_exportPDF` return `doc.output('blob')` not `content:null`. In `_exportDOCX`, detect library availability **before** the image-processing loop and skip `processForExport` when only the fallback is available; guard context probes with `typeof window !== 'undefined'`; fix the fallback stub text. Add SRI/hash verification in `download-libs.js`; remove/â€‹wire-up the unused `libs/html2pdf.bundle.min.js`.

- [x] **[MED][SEC-003]** URLs (incl. query-string secrets) stored and exported with no redaction â€” `content.js` 939-974, 680-688, 812-820; `redactor.js` 79-162; `export-service.js` 214-238, 421-446.
  - Problem: every step stores `url: location.href` and navigate steps store `value: currentUrl`; `maskValue` is only applied to form-field values, never to `url`/navigate `value`/`targetLabel`/`fieldName`. Tokens, reset/magic-link params, OAuth codes, API keys are recorded verbatim and surfaced in CSV/DOCX/PDF/JSON and `session.json`.
  - Impact: bearer tokens and reset URLs captured during a recording propagate into every export and backup; a shared recording can leak live credentials.
  - Fix: add a URL-redaction helper in `redactor.js` (mask sensitive query params: `token|access_token|code|key|api_key|password|secret|sig|signature|auth|session|jwt|otp|â€¦`) and apply it to `url` and navigate `value` before `sendStepToBackground`. Apply the same redaction at export time in `export-service.js` (CSV/DOCX/PDF/JSON) so existing recordings are sanitized. Consider redacting PII in `targetLabel`/`fieldName`.

---

## src/ui/review/review-standalone.js (+ .css, .html)
Full session review page: rendering, editing, drag-reorder, export, undo.

- [x] **[HIGH][FUNC-009]** "Cancel export" cancels the wrong ExportService instance and clobbers recording state â€” `review-standalone.js` 230-243, 919; also `background.js` 1044-1057, `popup.js` 23.
  - Problem: exports run on the page-local `ExportService`, but Cancel sends `cancelExport` to the background, whose `cancelledExports` Set is a different object â†’ the running export never sees the cancel and still downloads. Worse, the BG handler unconditionally sets `stateManager.state = 'idle'`, which during an active recording bricks `stopRecording` and makes the next `addStep` delete `activeRecording`.
  - Impact: cancellation is a silent no-op; cancelling during a recording disables stop and destroys crash-recovery data.
  - Fix: in the cancel handler call the **local** `exportService.cancelExport(sessionId)` directly. In the BG `cancelExport` case, only reset state when it's actually `'exporting'`. Audit the other unconditional `state='idle'` assignments (939, 953) with the same guard.

- [x] **[HIGH][PERF-008]** Review page renders all steps + all screenshots inline, no virtualization, full reload+re-render per interaction â€” `review-standalone.js` 439-541, 544-608, 186-194, 845-859.
  - Problem: `renderSteps()` rebuilds the whole list as one `innerHTML` with inline base64 `img src` (`loading="lazy"` doesn't help data URLs); before every render `getAllAssets` re-reads the entire `session.json`; render fires on every 300ms search keystroke, filter, delete/add/drag, and undo, re-creating ~6000+ DOM nodes and force-resizing every textarea.
  - Impact: multi-second freezes per interaction for large sessions; tab-OOM risk; steady-state memory ~2-3Ã— screenshot bytes.
  - Fix: cache the screenshot map once per session load (invalidate on asset add/delete) instead of `getAllAssets` per render. Render screenshots as `URL.createObjectURL(blob)` and lazy-load via IntersectionObserver. Mutate only affected cards on edit/delete/drag (event delegation on the container) instead of full `innerHTML` rebuild. Make filter/search toggle CSS visibility, not rebuild.

- [ ] **[MED][SEC-001]** Review page renders screenshot `src` and `step.id` into HTML unescaped (reachable via malicious imported backup) â€” `review-standalone.js` 431-538; also `storage.js` 332-370.
  - Problem: the description is escaped, but `screenshotData` (from `resolveScreenshotUrl`, no `data:image` validation) and `step.id` are interpolated raw into `img src` and `data-*` attributes. `importData` only checks shapes, not `asset.dataUrl`/`step.id` content. (Script is blocked by CSP â€” this is HTML injection in an extension-origin page, defense-in-depth.)
  - Impact: a crafted "Restore" backup can inject non-script HTML (spoofed UI, hidden iframes, off-origin image beacons) into the privileged review page; any future CSP relaxation makes it stored XSS.
  - Fix: escape every interpolated attribute (`Utils.escapeHtml(step.id)` in `data-before-step-id`/`data-step-id`/checkbox). In `resolveScreenshotUrl`, only return strings matching `^data:image\/(png|jpeg|jpg|webp);base64,` else null. In `storage.importData` (+ `importAllData` handler), validate `asset.dataUrl`/`data` as `data:image/...` and constrain `step.id` to a UUID/charset allowlist before persisting.

- [x] **[MED][UX-006]** Flash of light theme on load; review page applies theme only after the whole session loads â€” `review-standalone.js` 99-123; also `theme.js` 9-35, `popup.js` 88-102, the two HTML files.
  - Problem: theming is JS-only (`body.dataset.theme`) with light CSS defaults and no pre-paint script; the review page calls `setupTheme()` **after** `await loadSession()`, so it sits fully rendered in light theme for a noticeable time.
  - Impact: dark-mode users get a white flash (popup) and a prolonged wrong-theme period (review).
  - Fix: call `setupTheme()` **before** `await loadSession()`. Add a small classic `theme-init.js` loaded first in each `<head>` that reads `localStorage.theme` and sets `documentElement.dataset.theme` pre-paint (CSP blocks inline). Add a `@media (prefers-color-scheme: dark)` / `color-scheme` fallback for the token block.

- [x] **[MED][UX-008]** "Add step between" buttons are hover-only â€” invisible focus stop, undiscoverable â€” `review-standalone.css` 902-915; also `review-standalone.js` 488-489, 532-536.
  - Problem: `.add-between` is `opacity:0` revealed only on `:hover`, with no `:focus-within`; tabbing onto `.btn-add` focuses an invisible control; nothing else hints steps can be added.
  - Impact: keyboard users focus an invisible control (WCAG 2.4.7); mouse users rarely discover the feature.
  - Fix: add `.add-between:focus-within { opacity: 1; }`. Add a persistent visible "+ Add Step" entry point (after the last card or in the toolbar). Give `.btn-add` an `aria-label="Add step here"`.

- [x] **[MED][UX-009]** Step reordering drags the whole card (not the handle), no keyboard alternative, conflicts with text editing â€” `review-standalone.js` 491, 500, 511-515, 602-608, 787-843; also `.css` 710-724.
  - Problem: `draggable="true"` is on the whole `.step-card` while the `â‹®â‹®` handle is decorative; dragging can start from the description textarea; reordering is drag-only (no keyboard); the drop indicator is a whole-card outline that doesn't show before/after.
  - Impact: accidental reorders while editing text; keyboard users can't reorder at all; ambiguous drop position.
  - Fix: move `draggable="true"` from the card to the `.step-handle` (and toggle the dragging class from the handle). Add move-up/move-down buttons or ArrowUp/Down on the focused handle (`tabindex="0"`, `role="button"`, `aria-label="Reorder step"`), reusing `resequenceAndPersist()`. Replace the whole-card `drag-over` outline with an insertion-line indicator.

- [x] **[MED][UX-012]** Add Step modal: no Escape close, no focus trap/restore, mouse-only screenshot dropzone â€” `review-standalone.html` 132-172, 156-165; also `review-standalone.js` 152-163, 216-227, 613-628.
  - Problem: the page keydown handler only does Ctrl/Cmd+Z; the modal closes only via Cancel/overlay-click; Tab escapes behind it and focus isn't restored to the `+` trigger; the dropzone `<div>` has only a click listener, no `tabindex`/`role`/Enter-Space.
  - Impact: keyboard/AT users get stuck behind the dialog, can't dismiss it normally, and can't attach screenshots at all.
  - Fix: add an Escape handler calling `closeAddStepModal()` when active; implement a focus trap and restore focus to the triggering `.btn-add`; make the dropzone `tabindex="0"` `role="button"` `aria-label="Upload screenshot"` with Enter/Space triggering the file input.

- [x] **[LOW][UX-016]** Step number badges renumber from 1 under filters â€” `review-standalone.js` 459, 482, 492.
  - Problem: cards are numbered by index within the filtered list, while `step.sequence` is never shown â€” so filtered positions look like authoritative step numbers.
  - Impact: users cross-referencing exported "step 7" against a filtered view see wrong numbers and may edit/delete the wrong step.
  - Fix: render the step's true position (`step.sequence` or its index in `stepsData`) in `.step-number-badge` so numbering is stable under search/filter.

- [x] **[LOW][UX-017]** Single-step delete is instant with no confirm and no undo hint â€” `review-standalone.js` 545-549, 723-737, 732; also `.html` 86-88.
  - Problem: the per-card `âœ•` deletes and persists immediately; the success toast never mentions Undo (the only safety net), and undo restores the step list but not the deleted screenshot asset.
  - Impact: a stray click silently removes a step; users unaware of Ctrl+Z assume it's gone; even undo may yield a step whose screenshot no longer renders.
  - Fix: change the post-delete toast to an actionable "Step deleted â€” Undo" (button calling `undo()`). Verify/restore asset linkage on undo (in `restoreFromHistory`), or soft-delete and purge assets only when history is discarded.

- [ ] **[LOW][PERF-018]** Undo history keeps up to 50 full deep copies of the step array, persisting every restore â€” `review-standalone.js` 36-38, 372-412.
  - Problem: every mutation snapshots `stepsData` via `JSON.parse(JSON.stringify(...))` and retains up to MAX_HISTORY=50; `restoreFromHistory` deep-copies again and triggers a full persist + re-render.
  - Impact: tens of MB retained on a 500-step session (estimate); double-serialization per edit; undo latency dominated by the full persist/re-render it triggers.
  - Fix: use `structuredClone(stepsData)` and/or store diffs (action + affected ids) instead of full snapshots; reuse the snapshot reference in `restoreFromHistory` instead of re-copying; optionally lower MAX_HISTORY adaptively above ~200 steps.

---

## src/core/file-sync.js (+ fs-storage.js)
FileSystem Access API wrapper; hybrid storage abstraction.

- [x] **[HIGH][PERF-007]** Filesystem layer rewrites the whole `session.json` (all base64 screenshots) on every edit; single-step updates scan every session â€” `file-sync.js` 525-587, 581; also `fs-storage.js` 412-435, 474-529, 539-572, 650-678, `review-standalone.js` 579-599, 811-833, 845-859.
  - Problem: all screenshots are embedded base64 in one pretty-printed `session.json`; `updateStep`/`deleteStep`/`batchDeleteSteps` read+parse every session file until they find the step, then full-rewrite; drag-and-drop = read 100MB â†’ parse â†’ stringify â†’ write 100MB â†’ read again for re-render.
  - Impact: review-page edits/drag degrade to multi-second per action; ~3Ã— file-size heap per edit; high SSD write amplification.
  - Fix: split storage on disk â€” `session.json` (metadata + steps, no images) plus `screenshots/{stepId}.png` binaries (the unused `_dataURLtoBlob` helper at 315-329). Add a `sessionId` parameter to `updateStep`/`deleteStep`/`batchDeleteSteps` (review page always knows it) to stop scanning all sessions. Drop pretty-printing of `session.json`.

- [x] **[MED][FUNC-015]** `FileSync.writeSession` silently drops step fields (`targetLabel`, `isManual`, `hasScreenshot`) on flush â€” `file-sync.js` 562-578; also `export-service.js` 849, `utils.js` 140.
  - Problem: the step is rebuilt from an explicit allowlist that omits `targetLabel`/`isManual`/`hasScreenshot`/`sessionId`; after the first flush, screenshot steps read back with `isManual === undefined`, so PDF export omits manual screenshots and descriptions always read "Auto screenshot captured".
  - Impact: recorded data degrades the moment it hits disk; exports from disk differ from exports from the buffer for the same session.
  - Fix: spread the original step and only override/strip what's necessary: `return { ...step, screenshot };` (instead of allowlisting), or add the missing fields to the allowlist and document the on-disk schema. Add a bufferâ†’flushâ†’read round-trip test.

---

## src/ui/popup/popup.js (+ popup.html)
Extension popup: recording controls, session list, export, settings.

- [x] **[HIGH][FUNC-006]** Broken dynamic import `../../storage.js` â†’ chrome.storageâ†’filesystem migration is dead â€” `popup.js` 1060; also `core/storage.js` (actual location), `webpack.config.js` 51.
  - Problem: `import('../../storage.js')` from `src/ui/popup/` resolves to the non-existent `src/storage.js` (moved to `src/core/storage.js`). The import rejects, so `migrateFromChromeStorage()` never runs and `setMigrated()` is never called â€” the only call site of the whole migration feature.
  - Impact: every first-time filesystem setup shows an error toast and previously-recorded chrome.storage sessions never appear in the configured folder (effectively vanish).
  - Fix: change the path to `import('../../core/storage.js')` (or a static top import). Ensure `setMigrated()` is reached on success and migrated sessions show in `loadSessions()`. Add an eslint `import/no-unresolved` check over `src/` so moved modules fail the build.

- [x] **[HIGH][UX-004]** Custom session dropdown is not keyboard-operable; export tab unusable without a mouse â€” `popup.html` 116-127; `popup.js` 679-761.
  - Problem: the native `<select>` is hidden and replaced by a custom combobox that supports only Enter/Space/Escape â€” no Arrow navigation, options have no `id`/`tabindex`/`aria-selected`, no `aria-activedescendant`, label has no `for`. Export/View/Delete are disabled until a session is selected.
  - Impact: keyboard-only/screen-reader users can't select a session â†’ can't export/review/delete (WCAG 2.1.1).
  - Fix: implement ArrowDown/Up/Home/End + type-ahead with `aria-activedescendant`; give each option an `id` and `aria-selected`; associate the label (`aria-labelledby`/`aria-label`). Simplest robust alternative: drop the custom widget and style the native `<select>`.

- [x] **[MED][UX-010]** Popup export shows no progress â€” the "Exporting..." toast auto-dismisses after 3s while the export runs â€” `popup.js` 387-423, 976-991.
  - Problem: `showMessage('Exporting...')` auto-dismisses after 3s; `exportSession` is called without the progress callback the service supports; there's no cancel and closing the popup kills the export silently.
  - Impact: for non-trivial sessions users assume the export failed, re-click, or close the popup mid-export.
  - Fix: pass a progress callback and surface it (persistent status line or inline spinner+percent using existing `.spinner`/`.btn.loading`); keep the indicator visible until the promise settles; consider a cancel button mirroring the review page.

- [ ] **[MED][PERF-016]** Backup/restore round-trips the entire store (all screenshots) through one runtime message (~64MB limit) â€” `background.js` 1132-1144; also `storage.js` 301-322, `fs-storage.js` 794-816, `file-sync.js` 495-509.
  - Problem: `exportAllData` builds one object with every session/step/screenshot and returns it via `sendResponse`; beyond ~64MB the message throws and backup fails. `importAllData` is the same in reverse. The payload exists as ~4-5Ã— copies across SW + popup.
  - Impact: backup/restore fails for exactly the large data sets users most want to back up; multi-hundred-MB transient heap (estimate).
  - Fix: when filesystem storage is ready, do backup entirely in the window context (`fsStorage.exportAllData()`) â€” never message the payload. For the buffer path, chunk by session (one message per session). Stream sessions one at a time into the output file via `FileSystemWritableFileStream`.

- [x] **[LOW][UX-013]** Keyboard-shortcuts help wires to a button that doesn't exist â€” shortcuts undiscoverable â€” `popup.js` 106-121; `popup.html` (no matching element).
  - Problem: `setupKeyboardShortcuts()` looks up `#keyboardShortcutsHelp`, which exists nowhere â†’ silent no-op; the global shortcuts are documented nowhere; the multi-line toast string would collapse to one line anyway.
  - Impact: users can't learn the recording shortcuts from the product.
  - Fix: add a visible `?` help affordance (`id="keyboardShortcutsHelp"` in the header or a Settings line) and render the shortcut list as structured content (`<dl>`/tooltip), not a newline-joined toast.

- [x] **[LOW][UX-020]** Popup tabs declare `role="tablist"` but lack arrow-key navigation and roving tabindex â€” `popup.html` 42-46; `popup.js` 141-159.
  - Problem: `setupTabs()` wires only click; with `role="tab"` present, screen readers instruct arrow-key use that does nothing, and all three tabs are separate Tab stops.
  - Impact: AT users get non-working operating instructions; extra Tab stops.
  - Fix: add a `keydown` handler implementing ArrowLeft/Right (wrap) + Home/End; maintain roving tabindex (active `0`, inactive `-1`) alongside the existing `aria-selected` toggling.

---

## src/ui/popup/popup.css (+ review-standalone.css)
Design tokens, buttons, focus, typography.

- [x] **[HIGH][UX-003]** White text on warning/success/info buttons fails WCAG AA in both themes â€” `popup.css` 91-99, 194-199, 640-656, 707-753; `review-standalone.css` 94-105, 202-207, 545-567.
  - Problem: filled variants use white 12px/600 text; ratios fall to 3.2:1 (`.btn-warning` light), 3.3:1 (`.btn-success` light), and 2.1-2.3:1 in dark mode on the bright fills â€” and dark mode keeps white text on the **Pause/Resume** controls (no dark override exists except `.btn-primary`).
  - Impact: low-vision/bright-light users can't reliably read Pause/Resume/Re-authorize labels; fails WCAG 1.4.3.
  - Fix: add dark-theme overrides giving `.btn-warning`/`.btn-success` dark text on the bright dark fills (mirroring `[data-theme="dark"] .btn-primary`). For light theme darken the fills to AA values (warning `#B45309`, success `#15803D`) or use dark labels. Re-check `.btn-info`/`.btn-primary` light (4.2:1).

- [ ] **[MED][UX-005]** Onboarding + re-auth banners use undefined `--surface` â†’ backgrounds never render â€” `popup.css` 1450, 1472.
  - Problem: `color-mix(in srgb, var(--accent) 10%, var(--surface))` references `--surface`, which is defined nowhere and has no fallback â†’ the whole `background` is invalid, so the first-run onboarding CTA and re-auth warning render with transparent backgrounds.
  - Impact: the single most important first-run prompt blends into the page instead of standing out.
  - Fix: replace `var(--surface)` with the existing `var(--bg-card)` (or `var(--surface, var(--bg-card))`) at both lines; verify the 10% tint shows in light and dark.

- [ ] **[MED][UX-007]** Global focus indicator uses 40%-alpha color, ~1.5:1 â€” fails non-text contrast â€” `popup.css` 121, 176, 1907-1910; `review-standalone.css` 127, 184, 1263-1266.
  - Problem: `*:focus-visible { outline: 2px solid var(--focus-ring) }` where `--focus-ring` is a 40%-alpha steel blue (~`#BCCFE3` over the page), well below WCAG 1.4.11's 3:1.
  - Impact: keyboard users can barely see the focused control (compounds with UX-004).
  - Fix: change `*:focus-visible` to a solid token (`var(--border-focus)` â€” `#4A7FB5` light / `#5E96C8` dark, both â‰¥3:1), keeping the translucent `--focus-ring` only for the decorative box-shadow glow.

- [ ] **[LOW][UX-014]** 9px text in format cards and session metadata is below readable size â€” `popup.css` 982-987, 1073-1079, 1153-1159.
  - Problem: `.format-desc`, `.session-meta`, `.item-meta` hardcode 9px (below the 10px `--text-overline` token) in low-emphasis `--text-muted`, carrying real info (format descriptions, step-count + date).
  - Impact: step counts/dates that differentiate sessions are effectively illegible in the picker.
  - Fix: raise `.format-desc` to â‰¥10px (preferably 11px `--text-caption`); raise `.session-meta`/`.item-meta` to 11px; if space-constrained, trim the date detail rather than the font.

---

## src/content/selector.js
Multi-strategy selector engine.

- [x] **[MED][FUNC-013]** `_addXPathRelative` crashes on SVG ancestors â†’ clicks on/inside SVG icons dropped â€” `selector.js` 589-591; also `content.js` 666, 698-702.
  - Problem: it calls `.trim()` on `current.className`, which for SVG is an `SVGAnimatedString` (truthy object) â†’ `TypeError`; the exception propagates out of the un-try/caught strategy loop and `handleClick`'s catch drops the step. Other class strategies correctly use `className.baseVal`.
  - Impact: clicks on `<svg class="...">` icon buttons (toolbar/close/chevron â€” very common) are silently not recorded.
  - Fix: normalize className like `_addClassSelectors` does (`baseVal` for SVG, or `getAttribute('class')`) before `.trim()`. Wrap each strategy call in `generateSelectors` (71-105) in try/catch so one failing strategy degrades gracefully. Fix `_isGeneratedClass` to operate on the normalized string.

---

## src/core/redactor.js
Privacy redaction patterns. *(See also FUNC-014 under content.js and SEC-003 under export-service.js, which both edit redactor.js.)*

- [x] **[LOW][PERF-017]** Redactor recompiles 6 RegExp per `maskValue` and rescans the 21-pattern sensitivity check up to 3Ã— per event â€” `redactor.js` 49-66, 79-145; also `content.js` 804-805, 868-871.
  - Problem: `maskValue` builds fresh `/g` regexes from sources on every call; `shouldIgnoreField`'s 21-pattern scan runs up to three times per typed value. (Cost is well under 1ms/event â€” this is GC-churn cleanliness, not a hot path.)
  - Impact: ~6 RegExp allocations + 21Ã—3 scans per captured input; thousands of short-lived objects over a session (estimate).
  - Fix: pre-compile global variants once in the constructor (`.replace()` resets `lastIndex`, so the original bug doesn't recur). Have `maskValue` accept the already-computed `isSensitive` flag instead of re-calling `shouldIgnoreField` internally.

---

## src/core/quota-monitor.js
Storage quota monitoring. *(Merged with FUNC-018; also edits content.js, popup.js, background.js.)*

- [x] **[MED][PERF-014+FUNC-018]** With `unlimitedStorage` the quota system is inert dead code, yet real write failures drop steps silently and probes tax every write â€” `quota-monitor.js` 21-79; also `manifest.json` 17, `storage.js` 619, 755, 774-781, `content.js` 987-1002, `popup.js` 286, `background.js` 290-298.
  - Problem: `unlimitedStorage` makes `getStorageUsage` return `percentage:0`, so the 80/95% thresholds, the `storageQuotaWarning` broadcast, the popup handler, and the PNG-space warning are all dead â€” while every `addStep`/`addAsset` still pays a `getBytesInUse` + `permissions.contains` probe. When the disk actually fills, `set` rejects, `addStep` returns `success:false`, and the content script only `console.error`s it (only `'No active session'` acts) â†’ recording continues dropping every step. The popup's `updateStorageUsage()` is stubbed empty with 5 callers.
  - Impact: silent open-ended data loss once writes start failing; ~2 wasted async round-trips per step for the extension's life; dead warning UI gives false safety.
  - Fix: cache `permissions.contains` once; when unlimited, skip `getBytesInUse` in `checkQuota` (keep it only for the explicit UI call). In `content.js sendStepToBackground`, on any `success:false` show an error toast and after N consecutive failures pause recording + update the indicator. In `background.js`, notify via `chrome.notifications` when writes throw after retries. Decide: implement a self-imposed soft byte budget (warn at a configurable MB) or remove QuotaMonitor + plumbing entirely; restore or delete `updateStorageUsage()` and align CLAUDE.md/README claims.

---

## src/core/dom-utils.js

- [x] **[LOW][UX-015]** Review page info/warning messages never auto-dismiss; racing timers hide fresh errors â€” `dom-utils.js` 28-38; also `review-standalone.js` 241, 911, 915, 954-956.
  - Problem: `showMessage` auto-dismisses only `success`/`error`, so `info` (e.g. "Export cancelled.") persists forever; and a stale `setTimeout` blindly hides whatever message replaced the original, prematurely clearing genuine errors. (The popup's `showMessage` does this correctly.)
  - Impact: stale banners linger; real errors can vanish after ~2s.
  - Fix: store the timeout handle on the element, clear it on each call, and auto-dismiss `info`/`warning` too. Optionally unify both pages on the popup's richer toast.

---

## manifest.json

- [x] **[LOW][SEC-006]** `web_accessible_resources` exposed to `<all_urls>` enables extension fingerprinting â€” `manifest.json` 91-98 (and broad permissions 11-23).
  - Problem: `libs/*` + icons are web-accessible to every origin; with a stable extension ID any site can probe `chrome-extension://<id>/libs/docx.min.js` to detect TestSnapper. These libs are only loaded by the extension's own pages via `chrome.runtime.getURL` (no WAR needed).
  - Impact: stable cross-site detection of the installed extension (privacy/fingerprinting).
  - Fix: remove `libs/*.js`/`libs/*.css` from `web_accessible_resources`; if any entry must stay, narrow `matches` to specific origins or use `use_dynamic_url:true`. Re-evaluate whether the content script needs always-on `<all_urls>` + `all_frames` vs on-demand `activeTab`/`scripting` injection.

---

## Cross-file: fonts & dead code / docs

- [x] **[LOW][UX-018]** Extension pages depend on remote Google Fonts â€” FOUT/layout shift per open, silent offline fallback, widened CSP â€” `popup.html` 8, 10; `review-standalone.html` 8, 10.
  - Problem: Inter + Geist Mono load from Google's CDN with `display=swap` and a deliberately opened CSP; every popup open repaints from `system-ui` â†’ Inter and round-trips the network; offline the tuned 9-13px scale falls back to different metrics; leaks a fingerprint per open.
  - Impact: routine flash/layout shift, inconsistent offline typography, an unnecessary third-party request from a local-only tool.
  - Fix: self-host Inter + Geist Mono (woff2 400-700) under `libs/fonts/` (extend `npm run setup-libs`), declare via `@font-face`, remove the `<link>` tags, and tighten the CSP back to `style-src 'self' 'unsafe-inline'; font-src 'self'`.

- [x] **[LOW][FUNC-021]** Dead code inventory + documentation/feature mismatches â€” `src/injected.js`, `core/logger.js`, `selector.js` 32-47, `image-processor.js` 140-228, `utils.js` 151-153, `dom-utils.js` 12-22, `background.js` 913, `CLAUDE.md`.
  - Problem: verified-unreferenced and shipped in every build: `src/injected.js`, `core/logger.js` (imported by zero modules; 100+ raw `console.*` remain), `SelectorEngine.isStepDuplicate`, `ImageProcessor.compressForStorage`, `window.TestSnapperUtils`, `DomUtils.downloadFile`. Docs promise features that don't exist: Markdown export (CLAUDE.md + `background.js:913` comment, but `exportSession` supports only json|csv|docx|pdf), the Logger abstraction, storage compression; CLAUDE.md says "dev branch V1.1.3" (repo is V1.1.5) and references deleted `arch-review.md`/`TODO.md`.
  - Impact: dead modules inflate the bundle/review surface; four parallel dedup implementations invite divergence; docs waste future debugging time.
  - Fix: delete `src/injected.js` (or wire it up). Adopt `Logger` across modules or delete it and amend CLAUDE.md MED-008. Remove `isStepDuplicate`/`compressForStorage`/`TestSnapperUtils`/`downloadFile` or add real call sites. Implement a `markdown` export case (+ UI option) or remove Markdown from docs/comment. Update the CLAUDE.md branch reference and drop pointers to deleted files.
