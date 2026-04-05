# TestSnapper — TODO: 34 Issues Fixed

All 34 issues have been resolved. Tests: 207/207 passing. Build: clean.

---

## CRITICAL (9) — All Fixed ✅

- [x] **CRIT-1** `background.js:247` — Removed duplicate `storage.init()` call; single chained `.then()` remains
- [x] **CRIT-2** `background.js:1137` — `importAllData` validates `message.data` shape before calling `storage.importData()`
- [x] **CRIT-3** `background.js:749-752` — `stopRecording` pruning path: `broadcastSessionChange('deleted')` added after each pruned session; `storage.clearSession()` confirmed throughout
- [x] **CRIT-4** `background.js:18` — `PENDING_FLUSH_KEY` import confirmed; now also exported from `flush-utils.js`
- [x] **CRIT-5** `content.js:1136` — `stopRecording` iterates `modalStates` and calls `closeModalById(id, null)` for each
- [x] **CRIT-6** `content.js:487` — Legacy `closeModal()` function deleted (referenced undeclared `pendingStep`/`modalResolver`)
- [x] **CRIT-7** `background.js:1241` — `onSuspend` documented as best-effort; `persistActiveRecording()` called on each state mutation
- [x] **CRIT-8** `storage.js:404` — `batchDeleteSteps` fixed: stepCount updates collected in map, single read-modify-write after loop
- [x] **CRIT-9** `storage.js:350` — `importData` now removes only `testsnapper_` keys instead of `chrome.storage.local.clear()`

---

## HIGH (8) — All Fixed ✅

- [x] **HIGH-1** `content.js:1484` — `restoreRecording` correctly passes `message.session?.createdAt` (confirmed)
- [x] **HIGH-2** `background.js:762` — `addPendingFlush` awaited before `chrome.tabs.create`; ordering comment added
- [x] **HIGH-3** `content.js:432` — `isModalOpen = true` set in `showManualEntryModalInternal`; `isModalOpen = false` cleared in `closeModalById` when `modalStates` is empty
- [x] **HIGH-4** `content.js:501` — `processStepWithManualEntry` sets `isPaused = true` when pausing; restores `isPaused = false` on resume
- [x] **HIGH-5** `popup.js:415` — `URL.revokeObjectURL(downloadUrl)` called after `chrome.downloads.download` resolves
- [x] **HIGH-6** `content.js:1491` — `beforeScreenshot` hides all `[id^="testsnapper-"]` elements into array; `afterScreenshot` restores all
- [x] **HIGH-7** `background.js:538` — `captureScreenshot(tabId, isManual=true)`; focus/activation skipped for auto-screenshots
- [x] **HIGH-8** `content.js:819` — `handleChange` uses computed `isSensitive` variable instead of hardcoded `false`

---

## MEDIUM (16) — All Fixed ✅

- [x] **MED-1** `background.js:342` — `settingsManager.get()` guarded in recovery path (pre-existing fix, confirmed)
- [x] **MED-2** `background.js:88` — `sequenceLock` 10s timeout implemented (pre-existing fix, confirmed)
- [x] **MED-3** `background.js:245` — `SettingsManager.save()` merges with defaults: `this.cache = { ...this.defaults, ...validated }`
- [x] **MED-4** `background.js:230` — `save()` validates `screenshotFormat` (enum: `png`/`jpeg-high`) and `exportImageQuality` (string enum)
- [x] **MED-5** `storage.js:820` — `getAssetsByStepId(stepId, sessionId=null)` scopes read to one session when sessionId provided
- [x] **MED-6** `popup.html:238` — Added `captureApiCalls`, `apiCallsOptions`, `captureFailedCalls`, `captureAllCalls`, `includeTimestamp` elements
- [x] **MED-7** `content.js:834,895,931` — Catch blocks now say `'Error capturing input'`, `'Error capturing input'`, `'Error capturing submit'`
- [x] **MED-8** `content.js:924` — `handleSubmit` now calls `processStepWithManualEntry` for field-name prompting
- [x] **MED-9** `popup.js:842` — `updateState()` guards all DOM accesses with `if (stateText)`, `if (stateDot)`, `if (stateIndicator)`
- [x] **MED-10** `content.js:269` — `setTimeout(() => processModalQueue(), 100)` replaced with direct `processModalQueue()`
- [x] **MED-11** `background.js:254` — `sameOrigin(a, b)` helper added; tab recovery uses origin comparison instead of strict equality
- [x] **MED-12** `content.js:1082` — `lastUrl` removed; navigation polling uses `lastNavigationUrl` throughout
- [x] **MED-13** `content.js:1082` — `lastNavigationUrl` and `lastUrl` unified into single variable
- [x] **MED-14** `export-service.js:303` — `_exportDOCX` reads settings via `this.storage.getSettings()` (new method on StorageManager)
- [x] **MED-15** `background.js:749` — `maxSessions` pruning logs `console.warn` and broadcasts `'deleted'` for each pruned session
- [x] **MED-16** `content.js:482` — Auto-dismiss is 30 000ms in code; CLAUDE.md documentation corrected to say 30 seconds

---

## LOW (5) — All Fixed ✅

- [x] **LOW-1** `export-service.js` — `chunk.length = 0` no-op removed
- [x] **LOW-2** `storage.js:338` — `importData` validates per-session shape (sessionId type, steps/assets are arrays)
- [x] **LOW-3** `popup.js:391` — Export button disabled at start of `handleExport`, re-enabled in `finally`
- [x] **LOW-4** `export-service.js:281` — SRI hash for `docx@7.8.2` verified correct (`zjTqOObJTD6OT6CUn8mSpDY+...`)
- [x] **LOW-5** `quota-monitor.js:36` — When `unlimitedStorage` present, returns `{ warning: false, error: false, percentage: 0 }` immediately

---

## Additional Fixes (Test Infrastructure)

- Fixed `tests/core/fs-storage.test.js` mock path: `src/storage.js` → `src/core/storage.js`
- Added `addPendingFlush/getPendingFlush/removePendingFlush` instance methods to `FSStorageManager`
- Updated `tests/export/export-service.test.js` to test `Utils.escapeHtml` (moved from ExportService)
- Removed orphaned `tests/export/exporter.test.js` (tested removed `src/export.js`)
