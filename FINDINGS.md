# TestSnapper — Consolidated Review Findings

**Date:** 2026-08-28 · **Commit reviewed:** `f4cfd07` (master, clean tree) · **Scope:** ~17k LOC across `src/`, `scripts/`, `tests/`, build config

Six independent reviewer personas audited the repository in parallel: **Security & Privacy**, **Performance & Reliability**, **Architecture & Maintainability**, **UX & Accessibility**, **Build/Release & Supply Chain**, and **QA & Test Strategy**. They produced 101 raw findings. This document deduplicates them, reconciles severity where personas disagreed, and ranks by real-world impact.

Every finding was verified against the code — file:line references and quoted snippets throughout. Findings only one persona could see are marked as such; findings **two or three personas independently reached** are flagged 🔁 and should be treated as high-confidence.

**Severity scale**
| | Meaning |
|---|---|
| **P0** | Ships broken, loses user data, or blocks release |
| **P1** | Serious — fix before next release |
| **P2** | Should fix |
| **P3** | Hygiene / polish |

---

## Executive summary

The codebase is in better shape than its size suggests in three specific respects: the **security hardening in `bcd30e4` genuinely holds** (no reachable XSS, no message-forgery path, no remote code, no unused permissions), the **injected content-script UI is properly Shadow-DOM-isolated** and correctly excludes its own clicks from recording, and **`core/` was really decomposed** as CLAUDE.md claims. Those are hard things to get right and they are right.

The problems cluster into four themes, and they compound each other:

1. **Silent data loss is the dominant risk.** Three independent mechanisms drop the user's recording with the UI still showing "recording": storage quota exhaustion (the error is logged to a console nobody reads), a failed screenshot that permanently hides the Stop button, and a field-name modal that renders inside ad iframes and times out. None of them is covered by a test — and one of them, the quota path, is the exact path `tests/core/storage.test.js` **explicitly stubs out**.

2. **A performance cascade makes #1 inevitable rather than rare.** Screenshots are stored as full-resolution base64 PNG (the `MAX_IMAGE_WIDTH`/`IMAGE_QUALITY` constants that would prevent this are declared and never used), so a 10-minute recording writes 200–350 MB. Every single captured step then calls `getBytesInUse(null)` — a full read-and-serialize of that entire archive. The store gets huge, every step gets slower, and the quota ceiling arrives during normal use.

3. **The release pipeline ships the wrong artifact.** The build **downgrades** the version: `manifest.json` is checked in at `1.1.6` but webpack overwrites it from `package.json`'s `1.1.5`. If 1.1.5 is already published, the Chrome Web Store rejects the upload outright and the security release cannot ship. `dist/` was also demonstrably stale — every JS hash changed on rebuild, and the pre-existing `dist/src/background/background.js` was raw source, not the webpack bundle.

4. **The test suite is green and largely aimed at code that doesn't run.** 438 tests pass, but real statement coverage is **23.9%**, `npm run test:coverage` crashes (so nobody has ever measured it), and 42.3% of source LOC sits in files no test loads — including `background.js` and `content.js`, the two files where every mechanism in theme #1 lives. Compounding it, a systemic pattern emerged: canonical modules were extracted and tested, but the inline originals were never deleted, so `validateSettings`, `deduplicateConsecutiveSteps`, `Utils.generateStepDescription` and others are **green in CI and dead in production**, while their untested duplicates ship.

**Release verdict:** do not cut a release from this tree. The version bug (CONS-01) is a hard blocker; the three data-loss paths (CONS-02/03/04) should land in the same release.

---

## Severity rollup

| | P0 | P1 | P2 | P3 | Total |
|---|---:|---:|---:|---:|---:|
| Security & Privacy | 0 | 2 | 3 | 3 | 8 |
| Performance & Reliability | 4 | 6 | 5 | 4 | 19 |
| Architecture & Maintainability | 1 | 7 | 8 | 2 | 18 |
| UX & Accessibility | 4 | 6 | 9 | 3 | 22 |
| Build & Supply Chain | 2 | 5 | 6 | 3 | 16 |
| QA & Test Strategy | 5 | 7 | 5 | 1 | 18 |
| **Raw total** | **16** | **33** | **36** | **16** | **101** |
| **After dedup** | **13** | **28** | **32** | **15** | **88** |

---

## 🔁 Cross-persona corroboration

Findings reached independently by more than one reviewer. These carry the highest confidence.

| Consolidated | Finding | Reached by |
|---|---|---|
| CONS-01 | Build downgrades version 1.1.6 → 1.1.5 | Build, Architecture |
| CONS-02 | Quota exhaustion silently drops steps, UI still says "recording" | Performance, UX |
| CONS-03 | Failed screenshot permanently hides the floating panel | UX, Performance |
| CONS-09 | `npm run test:coverage` is broken (vitest 3 vs coverage-v8 4) | QA, Build |
| CONS-13 | `package-lock.json` gitignored — build graph unpinned | Build, Architecture |
| CONS-20 | 906 KB `html2pdf.bundle.min.js` ships, referenced by nothing | Security, Build, Architecture |
| CONS-24 | No CI, no linter on a 17k-LOC extension | Build, QA |
| CONS-30 | `MAX_IMAGE_WIDTH`/`IMAGE_QUALITY` declared and never used | Performance, Architecture |
| CONS-45 | Dead scratch files under `tests/` never executed by any runner | QA, Architecture |

---

# Release blockers

## CONS-01 · Build downgrades the extension version — release cannot ship 🔁
**P0** · Confidence High · `webpack.config.js:6-7,66-76`, `manifest.json:5`, `package.json:3` · *Build BUILD-01, Architecture ARCH-01*

`manifest.json` is checked in at `"version": "1.1.6"`. `webpack.config.js`'s CopyPlugin transform overwrites it unconditionally from `package.json`:

```js
const VERSION = packageJson.version;   // "1.1.5"
manifest.version = VERSION;            // package.json wins, always
```

Verified in built output: `grep -n '"version"' dist/manifest.json` → `5:  "version": "1.1.5",`.

Both files were bumped in the same commit `bcd30e4` ("…v1.1.6") to **different** values — manifest `1.1.3 → 1.1.6`, package.json `1.1.3 → 1.1.5`. The previous release was 1.1.3; 1.1.4 was never used. Five conflicting version claims exist in the repo (manifest 1.1.6, package.json 1.1.5, README badge 1.1.3, README changelog v1.1.5, QUICK_START 1.1.3), and `git tag` returns nothing.

**Impact:** If 1.1.5 is already published, the Chrome Web Store **rejects** the upload ("version number is the same as or lower than the published version") and the entire security-hardening release is blocked. If it is not published, the release ships under a number matching no tag, no changelog entry, and no bug report — and the next person who bumps `manifest.json` to 1.1.7 ships 1.1.5 again. Chrome also refuses to install over a higher installed version.

**Fix:** Set `package.json` to the intended release number. **Delete the `version` key from the source `manifest.json` entirely** — or replace it with a sentinel `"0.0.0-DEV"` — so a stale checked-in number can never look authoritative. Add a build assertion beside the existing `REQUIRED_LIBS` guard that throws if a real version is present in the source manifest. Then tag releases and derive the README badge from the tag.

---

## CONS-02 · Storage quota exhaustion silently discards every step while the UI keeps saying "recording" 🔁
**P0** · Confidence High · `src/content/content.js:1123-1133`, `src/core/quota-monitor.js:68-75`, `src/background/background.js:1048,1071-1074`, `:306-315` · *Performance PERF-03, UX UX-01*

At 95% of budget `checkQuota()` throws `StorageQuotaExceeded`. `_retryOperation` correctly declines to retry, `addStep()` returns `{ success: false, error }`. The content script then reacts to exactly one error string:

```js
} else if (response && !response.success) {
  window.Logger?.error('Failed to add step:', response.error);
  if (response.error === 'No active session') { ...retry / stop... }
}
```

Quota exceeded, `Session not found`, and every storage write error are logged to a console the user is not looking at and otherwise ignored. No toast, no panel change, no stop.

Two aggravating details found by the UX pass:
- `stateManager.incrementStepCount()` runs at `background.js:1048`, **before** `await storage.addStep(step)` at `:1065` — so the visible step counter keeps climbing on every dropped step. The user is actively told it's working.
- The only quota signal, `chrome.runtime.sendMessage({action:'storageQuotaWarning'})`, reaches extension pages only and ends in `.catch(() => {})`. `grep -c "storageQuotaWarning" src/content/content.js` = **0**. The popup is closed during recording by definition, so the 80% warning is broadcast to nobody in exactly the situation it exists for.

**Impact:** The user records a 40-minute regression walkthrough, watches the counter reach 200 steps, stops, opens review — and two-thirds of their work is gone with no warning at any point. This is the product's core promise failing silently, and it fails hardest on the long sessions the product is most valuable for.

**Fix:** Three changes.
1. In `sendStepToBackground`, treat any `!response.success` that is not a benign skip (`skipped`, `Wrong tab`) as fatal: show a persistent error toast ("TestSnapper is out of storage — recording paused. Export or delete old sessions to continue."), pause recording, change the panel dot to an error state.
2. Move `incrementStepCount()` to **after** a successful `storage.addStep()` so the visible count never overstates what was saved.
3. Route `storageQuotaWarning` to the active tab's content script as well as extension pages, so the 80% warning surfaces as an in-page toast while the popup is closed.

---

## CONS-03 · A single failed screenshot permanently hides the panel — Stop button gone, recording continues invisibly 🔁
**P0** · Confidence High · `src/background/background.js:627,641,643,699-702`, `src/content/content.js:1672-1690` · *UX UX-02, Performance PERF-05*

`beforeScreenshot` hides every injected element so the panel doesn't appear in the capture. `afterScreenshot` is sent on **one line only** — immediately after `captureVisibleTab` succeeds. There is no `try/finally`:

```js
await chrome.tabs.sendMessage(tabId, { action: 'beforeScreenshot' }).catch(() => {});
await new Promise(r => setTimeout(r, 150));
const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, captureOptions);
chrome.tabs.sendMessage(tabId, { action: 'afterScreenshot' }).catch(() => {});
```

`captureVisibleTab` rejects routinely: `MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND` rate limiting (manual captures deliberately bypass the 1s debounce), tab backgrounded mid-capture, DRM/protected content. Any rejection jumps to the `catch` at `:699`, which only logs — and `#testsnapper-control-panel-container` stays `display: none` for the rest of the recording.

It also poisons its own state: a second `beforeScreenshot` records `el.style.display` — now `'none'` — as the "original", so even a subsequent **successful** restore sets it back to `'none'`. Unrecoverable without stopping.

**Impact:** The user loses Stop, Pause, manual screenshot, and the timer, with no error shown (the failure returns to a callback in the closed popup). **The recording keeps running invisibly**, capturing every subsequent click and keystroke on whatever the user does next. The only way to stop it is `Ctrl+Shift+E`, which a user who just lost the visible UI has no reason to know.

**Fix:** Wrap the capture in `try { … } finally { chrome.tabs.sendMessage(tabId, {action:'afterScreenshot'}).catch(()=>{}); }`. Harden the content side: bail out of `beforeScreenshot` if `window.__testSnapperHiddenEls?.length` is non-empty (a restore is outstanding), and arm a 3s watchdog timer at hide time, cleared by `afterScreenshot`, so a dropped message can never leave the panel hidden. Surface screenshot failures as an in-page toast.

---

## CONS-04 · Field-name modal renders inside arbitrary sub-frames, blanking the iframe and dropping the step
**P0** · Confidence High · `src/content/content.js:1169-1172` vs `:1184`, `:446-452`, `:610-645` · *UX UX-03*

The top-frame gate at `content.js:1184` is deliberately placed **after** listener attachment — the comment explains that event capture must run in every frame, while "the floating panel, heartbeat, navigation polling, and auto-screenshot interval belong to the TOP frame only." The modal was not included in that list.

`handleInput`/`handleClick` → `processStepWithManualEntry()` → `showManualEntryModalInternal()` appends its shadow host to **that frame's** body with a full-viewport scrim and `width: min(440px, 90vw)`. Inside a 300×250 embed that's a black overlay over the iframe with a 270px dialog crammed in.

**Impact:** Hits any page with an embedded form — payment widgets, embedded CRM panes, third-party checkout, support widgets. The user sees the iframe go dark (or, if scrolled out of view, sees nothing) while the extension waits 30s. `isModalOpen` is frame-local, so the top-frame panel keeps showing RECORDING throughout, and `updateRecordingIndicator('PAUSED')` at `:620` is a no-op in a sub-frame. On timeout the step is discarded.

**Fix:** Gate the modal to the top frame. Either skip manual entry in sub-frames and record the step with a fallback name plus a `needsName` flag the review page surfaces for later editing, or relay the request through the background to frame 0 (`chrome.tabs.sendMessage(tabId, msg, { frameId: 0 })`) so the dialog renders once over the whole tab. The relay also fixes the frame-local `isModalOpen`/pause desync.

---

# P0 — Performance cascade

## CONS-05 · Every captured step triggers a full-store byte count
**P0** · Confidence High · `src/core/storage.js:889,1036,1061`, `src/core/quota-monitor.js:108` · *Performance PERF-01*

`addStep()` and `addAsset()` both open with `await this._checkQuota()` → `chrome.storage.local.getBytesInUse(null, …)`. Passing `null` measures **every key in the store**; Chrome implements this by reading each value out of the backing store and serializing it, so cost is proportional to total stored data — including every base64 screenshot in every retained session. `addAsset()` does it a **second** time at `:1061` purely to log an advisory warning. All of it runs inside `_enqueue()`, serializing the write queue.

**Impact:** A user on their third or fourth session with ~200 MB of prior screenshots pays a full 200 MB read+serialize *per click, per keystroke burst, per navigation*, and twice per screenshot. The service worker pegs a core, steps land seconds late, and with auto-screenshot at 5s the queue never drains. It degrades monotonically with install age — an "it used to be fast" bug with no obvious cause.

**Fix:** Do not measure quota per write. Call `getBytesInUse(null)` at most once per recording session (or on a 60s throttle), cache it, and increment the cached figure by the approximate size of each write. Delete the second call at `:1061` entirely. If a pre-write gate is genuinely wanted, measure only the keys being written: `getBytesInUse([key])`.

## CONS-06 · Weekly orphan sweep loads the entire store into the service worker heap
**P0** · Confidence High · `src/core/orphan-cleaner.js:102,82-96`, `src/core/storage.js:723-724`, `src/background/background.js:305` · *Performance PERF-02*

`storage.init()` runs at SW module scope and calls `_autoCleanupCheck()` → `cleanupOrphans()`. Past the 7-day gate, phase 1 loops every session calling `getAssets(sessionId)` (reading every screenshot data URL into memory), then phase 2 does `chrome.storage.local.get(null)` — materializing every key **and value**, all screenshots base64-decoded into JS strings, simultaneously, just to run a regex over key names.

`src/core/flush-utils.js:11-14` explicitly documents this exact call as the thing to avoid — "pulling EVERY key into memory just to find a handful of flag keys". The orphan cleaner never got the same treatment.

**Impact:** A user with 20 sessions of screenshots (a few hundred MB — well within the 1 GB budget and the `unlimitedStorage` permission) hits this once a week on whatever page load happens to start the SW. The SW either hangs for seconds or is killed for OOM. If it fires mid-recording, `stateManager` state is lost and the 15s heartbeat tears the recording down.

**Fix:** Use `chrome.storage.local.getKeys()` (Chrome 130+), or keep an explicit key manifest in `testsnapper_meta` and sweep against that. Phase 1 needs only asset *ids* — read `_readAssetIndex(sessionId)` plus per-asset metadata, not `getAssets()` which pulls `dataUrl`. Move cleanup off the SW startup path onto a `chrome.alarms` handler so it never races a recording.

## CONS-07 · Screenshots stored full-resolution and uncompressed; the size caps are dead code 🔁
**P0** · Confidence High · `src/core/storage.js:45-47,1043-1047`, `src/background/background.js:641` · *Performance PERF-04, corroborated by Architecture ARCH-08*

`storage.js` declares `MAX_IMAGE_WIDTH = 1920`, `MAX_IMAGE_HEIGHT = 1080`, `IMAGE_QUALITY = 0.95` — all three referenced **nowhere else in `src/`**. `addAsset()` states the policy outright: *"Store screenshot as-is … Compression only happens at export time for maximum quality preservation."* `captureVisibleTab(…, { format: 'png' })` returns a lossless full-viewport PNG as a base64 data URL (+33% over raw bytes), JSON-serialized again into `chrome.storage.local`, once every 5s for the entire recording with no cap on count.

**Impact:** On a 2560×1440 display a text-heavy screenshot is 1.5–3 MB as base64 PNG — ~20–35 MB per minute. A 10-minute recording writes 200–350 MB; the default `maxSessions: 25` lets the extension consume multiple GB before pruning. **This is the direct cause of CONS-05 getting slower and of CONS-02 firing at all.**

**Fix:** Run captures through `ImageProcessor.processForExport` (the OffscreenCanvas path already exists and works in the SW) *at capture time*, downscaling to the declared 1920×1080 cap — then the constants stop being a lie. Cap total assets per session and raise the auto-screenshot default interval; 5s is aggressive for a lossless full-viewport capture.

---

# P0 — UX

## CONS-08 · Floating panel sits over the host page's header, re-centres on every navigation, mouse-only to move
**P0** · Confidence High · `src/content/content.js:1364-1372,1349-1352,1498-1544` · *UX UX-04*

```css
:host { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 2147483647; }
```

A ~200×34px opaque, hit-testable panel pinned top-centre at maximum z-index — exactly where site logos, primary nav and search boxes live, above every sticky header. Three compounding factors: repositioning uses `mousedown`/`mousemove` only (no Pointer or Touch events, so **it cannot be moved on a touch device**, and there is no keyboard reposition); the dragged position is never persisted, and `addRecordingIndicator()` rebuilds the panel from scratch after every page load, snapping it back to top-centre; and there is no minimise, collapse or hide control — the only removal is Stop.

**Impact:** During a multi-page recording — the core loop — the user must re-drag the panel off their header after **every single navigation**, and cannot do it at all on touch. Any step targeting a top-centre element is unreachable without moving the panel first.

**Fix:** Default to a corner (`top: 16px; right: 16px`, matching the toast's corner). Persist the dragged offset to `chrome.storage.local` and restore it in `addRecordingIndicator()`. Switch to Pointer Events with `setPointerCapture` so touch works. Add a collapse-to-dot toggle.

> The z-index value itself is correct — `2147483647` wins every z-index war. The problem is purely placement and persistence.

---

# P0 — Test integrity

> These are severities on the *test suite*, not on shipped behaviour. They matter because every P0 above sits on an untested path.

## CONS-09 · Coverage has never been measured — `npm run test:coverage` crashes 🔁
**P0** · Confidence High · `package.json` (`vitest ^3.2.4` vs `@vitest/coverage-v8 ^4.1.0`) · *QA QA-01, Build BUILD-08*

```
$ npx vitest run --coverage
SyntaxError: The requested module 'vitest/node' does not provide an export named 'BaseCoverageProvider'
$ npm ls vitest @vitest/coverage-v8
| `-- vitest@3.2.4 deduped invalid: "4.1.2" from node_modules/@vitest/coverage-v8
npm error code ELSPROBLEMS
```

The QA reviewer worked around this by building a Babel statement-probe instrumenter and running the identical 438-test suite under it. **Real project-wide statement coverage: 1226 / 5133 = 23.9%.** Across only files any test loads: 47.5%. **5672 of 13404 src LOC (42.3%) live in files no test ever loads.**

Plain `npm test` is unaffected: 18 files, 438 tests, 0 failed, 0 skipped, 6.2s. No `it.skip`/`it.only`/stale snapshots anywhere.

**Fix:** Align the majors — pin `@vitest/coverage-v8` to `^3.2.4`, or move both to v4. Verify `npm ls` exits 0. Then add `coverage.thresholds` starting at the measured floor (`statements: 23`) and ratchet.

## CONS-10 · Zero coverage on the four largest files — including both files where every data-loss path lives
**P0** · Confidence High · *QA QA-02, QA-03, QA-10*

| file | LOC | statements | covered |
|---|---:|---:|---:|
| `src/content/content.js` | 1768 | 798 | **0 — never loaded** |
| `src/background/background.js` | 1389 | 578 | **0 — never loaded** |
| `src/ui/review/review-standalone.js` | 1265 | 560 | **0 — never loaded** |
| `src/ui/popup/popup.js` | 1147 | 574 | **0 — never loaded** |
| `src/ui/theme.js` · `theme-init.js` · `content/logger.js` | 103 | 40 | **0 — never loaded** |

`background.js` holds the session-recovery block with **five separate `chrome.storage.local.remove('activeRecording')` calls on failure branches** (`:339,393,436,443,460`) — any one firing wrongly deletes the user's in-flight recording. `content.js` holds every capture handler, the redaction call sites, and the `AbortController` cleanup that exists specifically to prevent double-listeners on re-injection.

`tests/ui/review.test.js` — the only file under `tests/ui/` — imports nothing but `deduplicateConsecutiveSteps` from `src/core/step-utils.js`, a 45-line helper **which production code never imports** (see CONS-16).

**Fix:** Extract the recovery block into a pure `restoreActiveRecording(storedState, deps)` in `recorder-utils.js` (already 98.2% covered, established test file) and add `tests/background/recovery.test.js` covering: valid state restores without removing the key; missing `session` removes the key exactly once and notifies; `paused` restores as paused; `sessionId` no longer in `testsnapper_sessions` does **not** silently drop the recording. Add `tests/content/content-guards.test.js` (dependency-init failure must not report `recording`) and `tests/content/reinjection.test.js` (click → re-init → click must produce exactly 2 `sendMessage` calls, not 3).

## CONS-11 · The quota path isn't just untested — the storage test deliberately stubs it out
**P0** · Confidence High · `tests/core/storage.test.js:63-68` · *QA QA-05*

```js
function makeStorage() {
  const storage = new StorageManager();
  // Neutralize quota gating so createSession/addStep/addAsset don't depend on
  // QuotaMonitor internals (out of scope for these fixes).
  storage._checkQuota = vi.fn().mockResolvedValue(undefined);
  storage.getStorageUsage = vi.fn().mockResolvedValue({ percentage: 0 });
```

`QuotaMonitor.checkQuota` throwing is tested in isolation. What `StorageManager.addStep`/`addAsset` **do** when it throws is never exercised — those call sites (`storage.js:744,889,1036`) run only with the stub. The PERF-012 non-retry branch in `_retryOperation` (`:353-373`) is 75% uncovered with no test referencing `NON_RETRYABLE` anywhere.

**This is the single test that would have caught CONS-02**, and it is the one that was disabled.

**Fix:** `tests/core/storage-quota.test.js` — do **not** stub `_checkQuota`. Mock `getBytesInUse` to return ≥95%, then assert: `addStep` rejects with `err.name === 'StorageQuotaExceeded'`; already-persisted steps remain readable (nothing half-written); `_retryOperation` calls the operation **exactly once** for a quota error (PERF-012 regression pin); a generic `Error` still retries `maxRetries` times.

## CONS-12 · Screenshot and step-mutation persistence paths are 0% covered
**P0** · Confidence High · `src/core/storage.js:279,934,970,1034,1079`, `:641,662` · *QA QA-04*

`addAsset` 17/17 statements uncovered, `batchDeleteSteps` 18/18, `deleteStep` 14/14, `updateStep` 11/11, `getAssetsByStepId` 10/10, `updateAllSteps` 9/9, `batchUpdateSteps` 8/8, `_writeAsset` 5/5, `_detectImageFormat` 4/4. `tests/core/storage.test.js` has 12 tests covering only create/add/get/clear round-trip.

**Impact:** If `addAsset` writes under a wrong key, or `batchDeleteSteps` deletes assets by index instead of `stepId`, screenshots are orphaned or destroyed — and `OrphanCleaner` (which *is* tested) will dutifully garbage-collect them on the weekly run. Permanent, unrecoverable.

**Fix:** `tests/core/storage-assets.test.js` with the composite case that actually catches loss: delete a step, then run `OrphanCleaner.cleanupOrphans()` and assert the *surviving* steps' assets are still present.

---

# P0 — Supply chain

## CONS-13 · No lockfile in version control — the build graph that writes `dist/` is unpinned 🔁
**P0** (Build) / **P2** (Architecture) — *taking the higher; see Contradictions* · Confidence High · `.gitignore`, `git ls-files` → 79 files, no lockfile · *Build BUILD-02, Architecture ARCH-16*

`package-lock.json` exists on disk (204,906 bytes) but is explicitly gitignored, as is `yarn.lock`. Every dependency uses a caret range, and drift is already visible: `webpack@5.105.1` vs `^5.89.0`, `@babel/core@7.29.0` vs `^7.23.0`.

The threat model is inverted. `scripts/download-libs.js` goes to considerable trouble to pin three **runtime** libraries by SHA-384 with a fatal-on-mismatch check, while several hundred unpinned transitive **build-time** packages have full write access to the shipped `background.js` bundle — which runs with `<all_urls>` host permissions. Two developers building the same commit produce different `dist/` bytes.

**Fix:** Remove `package-lock.json` from `.gitignore`, commit it, and switch `npm run setup` and the release script to `npm ci`.

---

# P1 findings

## Build & release

### CONS-14 · `dist/` is never cleaned and was verifiably stale
**P1** · `webpack.config.js:33` — `clean: false // Don't clean to preserve manually copied files` · *BUILD-03*

Hashing `dist/` before and after `npm run build`: **all 25 JS assets changed hash**. The pre-existing `dist/src/content/content.js` was 62,622 bytes, byte-identical to source (unminified); after the build it is 32,967 and minified. More telling, the pre-existing `dist/src/background/background.js` was 50,201 bytes and began with `import { StorageManager } from '../core/storage.js';` — **raw source, not the webpack bundle at all**. A real build produces a 65,055-byte IIFE.

Whatever was manually tested in Chrome, and whatever the release script would have zipped, was a different artifact from what the build produces. Separately, `clean: false` means deleted or renamed source files leave stale copies in `dist/` forever and ship to users. The justifying comment is self-contradictory — nothing is "manually copied"; CopyPlugin copies everything.

**Fix:** `output.clean: true`.

### CONS-15 · Terser rewrites the SRI-verified vendor bundles — shipped bytes are not the verified bytes
**P1** · `webpack.config.js:87` + `optimization.minimize: true` · *BUILD-04*

The build log labels them `[copied] [minimized]`; sizes confirm: `libs/jspdf.umd.min.js` 364,463 → `dist/` 346,186; `libs/docx.min.js` 329,034 → 328,572. The integrity chain has a gap at the last hop — `download-libs.js` verifies `libs/`, but what ships is a Terser re-emission of already-minified third-party UMD bundles. Nobody can verify a published `.zip` against upstream, and a Terser miscompile on a 900 KB bundle would silently corrupt PDF/DOCX export.

> This does **not** contradict the Security reviewer's "supply chain verified clean" — that assessment covered the download-and-pin hop, which is genuinely sound. This is the *next* hop.

**Fix:** `optimization.minimizer: [new TerserPlugin({ exclude: /^libs\// })]`, plus a post-build check re-verifying `dist/libs/*` against the same pinned hashes. (Both re-minified bundles were smoke-loaded in Node and still evaluate correctly — this is an integrity gap today, not a breakage.)

### CONS-16 · `npm run setup` fails open on a failed library download
**P1** · `scripts/download-libs.js`, `webpack.config.js:12` · *BUILD-05*

A download error is swallowed (`console.error(...); continue;`), then the script prints `Library setup complete!` and exits 0. The webpack guard covers only two of three libs: `REQUIRED_LIBS = ['docx.min.js', 'jspdf.umd.min.js']`. On a clean clone behind a proxy, setup reports success with an incomplete `libs/`, and the failure surfaces only at packaging time (the release script *does* hard-require html2pdf).

**Fix:** Make download failure fatal (`process.exit(1)`), matching the SRI-mismatch path which correctly aborts. Derive `REQUIRED_LIBS` from the `LIBRARIES` array rather than maintaining two lists.

### CONS-17 · The release scripts are gitignored and both are broken on the maintainer's own machine
**P1** · `.gitignore` (`release/`) · *BUILD-07*

The entire `release/` directory is gitignored — the only documented way to produce a CWS package does not exist in a fresh clone. Neither script runs here: `wmic` is NOT on PATH (removed from recent Windows 11 builds; this machine is 10.0.26200 — so the `.bat`'s `%dt%` is empty and the zip is named `testsnapper-v1.1.5--.zip`) and `zip` is NOT FOUND (Git Bash on Windows has no `zip` by default). There is no `npm run package` script. The `.bat` still reports SUCCESS after producing a mis-named archive.

**Fix:** Un-ignore and commit `release/`. Replace both scripts with one cross-platform `npm run package` in Node that reads the version from `package.json`, uses `new Date().toISOString()`, and verifies `dist/manifest.json`'s version matches before zipping.

### CONS-18 · No CI, no linter, no formatter 🔁
**P1** (Build) / P2 (QA) · no `.github/`, no `.eslintrc*`, no `.prettierrc*` · *BUILD-06, QA-17*

Nothing runs `npm test`, `npm run build`, or any static check automatically. Every finding in this document is the kind of thing CI catches for free — CONS-01 needs a 3-line version assertion, CONS-09 would have failed `npm ci` outright. Critically, the project depends on constraints nothing enforces: CLAUDE.md mandates `var` at content-script top level to survive re-injection, and no linter checks it.

**Fix:** `.github/workflows/ci.yml` running `npm ci && npm test && npm run build` plus a version-consistency step. ESLint flat config with `env: { webextensions: true }`, an override for `src/content/**` forbidding top-level `let`/`const` and `import`/`export`, and `no-console` excepting the two `logger.js` files.

## Architecture

### CONS-19 · Settings validation exists twice — the tested copy is dead, the shipped copy is incomplete
**P1** · `src/background/background.js:160-266` vs `src/core/recorder-utils.js:159-224` · *ARCH-02*

`recorder-utils.js` exports `validateSettings(raw, defaults)`, documented as canonical and covered by tests. **Nothing imports it.** What runs is `SettingsManager.get()`/`save()`, a hand-rolled re-implementation that validates strictly less: `validateSettings` coerces seven booleans; `SettingsManager.get()` coerces exactly one (`autoScreenshot`) and passes the rest through raw from `chrome.storage.local`. `save()` validates a third, different subset with no boolean coercion at all. The same magic enum list appears in four places with the comment `// P1-19: must match popup.html options and ExportService ALLOWED list` — enforced by a comment. `StorageManager.getSettings()` is a fourth, dead settings reader.

**Impact:** A string `"false"` for `captureAllCalls` is truthy, so `shouldRecordRequest` takes the wrong branch and records **every network request of the recorded tab** into the session. The test suite passes throughout, because it tests the function nobody calls.

**Fix:** Delete both inline validation bodies; call `validateSettings(raw, this.defaults)`. Move `SettingsManager.defaults` into `recorder-utils.js` as exported `DEFAULT_SETTINGS`; export the enum constants so `ExportService._resolveExportImageOpts` imports the same list. Delete `StorageManager.getSettings()`.

### CONS-20 · 906 KB of `html2pdf.bundle.min.js` ships and is referenced by nothing 🔁
**P1** (Arch) / P2 (Build) / P3 (Security) — *taking the median as P1* · *ARCH-06, BUILD-09, SEC-06*

`grep -rn "html2pdf" src/` returns **zero matches**. PDF export uses jsPDF (`export-service.js:458`). The file is nonetheless downloaded, SRI-verified, committed to git, copied into `dist/` by the blanket `{ from: 'libs', to: 'libs' }` pattern, hard-required by the release script, and shipped — **882 KiB of a 2.1 MB package, roughly 43%**.

Additionally, `background.js:9` imports and `:278` instantiates `ExportService`, then never references it again. The file documents this at `:1076-1080` (FUNC-017: "there is no background export path") — the removal stopped one line short. Because it's bundled, webpack pulls `export-service.js` (1059 LOC) and `image-processor.js` (288 LOC) into the SW bundle, code whose loaders hard-require a DOM and could never function there.

**Fix:** Delete `libs/html2pdf.bundle.min.js`, its `download-libs.js` entry, and its release-script check. Delete `background.js:9` and `:278`. Add a `FORBIDDEN_LIBS` check beside `REQUIRED_LIBS`. Update the stale CLAUDE.md sentences.

### CONS-21 · `fs-storage.js` — ~200 LOC unreachable, and `getAssetsByStepId` silently drops its `sessionId`
**P1** · `src/core/fs-storage.js:51-104,807-830,882-896` · *ARCH-03, related Performance PERF-15*

Two problems. **(a)** `FSStorageManager` is imported only by `popup.js:19` and `review-standalone.js:15` — both window contexts — so `this._isServiceWorker` is always `false` and all ~24 `if (this._isServiceWorker)` branches are dead. The class's own JSDoc admits it at `:68`.

**(b)** The Proxy hides signature drift rather than absorbing it, despite claiming "the same public API":

| Method | `StorageManager` | `FSStorageManager` |
|---|---|---|
| `deleteStep` | `(stepId)` | `(stepId, sessionId)` |
| `getAssetsByStepId` | `(stepId, sessionId = null)` | `(stepId)` — **2nd arg silently dropped** |
| `getStorageUsage` | real bytes | `{used: 0, total: Infinity}` — even when FS is not configured |
| `onQuotaWarning` | registers with QuotaMonitor | `{}` — silent no-op |

`review-standalone.js:485,508` call `getAssetsByStepId(stepId, sessionId)` with the session known; `fs-storage.js:813-830` ignores it and loops **every session on disk**, and `FileSync.readAssets` base64-encodes every screenshot file in each. One step lookup decodes every screenshot of every session until it hits a match — so undo/redo goes quadratic in total screenshots. `StorageManager` already accepts `sessionId` for exactly this reason.

**Fix:** Delete the `_isServiceWorker` branches; rename to `FilesystemBackedStorage` and document it as window-context-only. Fix `getAssetsByStepId(stepId, sessionId)` to use the hint, mirroring `deleteStep`'s existing PERF-007 shape. Guard `getStorageUsage()` behind `await this.isFilesystemReady()`. Replace the catch-all Proxy — which forwards *any* `StorageManager` name including privates — with an explicit delegation list, and add a `storage-contract.js` asserting arity at boot.

### CONS-22 · Field-name cleaning is implemented three times with three different behaviours
**P1** · `src/content/selector.js:999`, `src/content/field-name-resolver.js:485`, `src/content/content.js:222` · *ARCH-04*

Three `cleanFieldName` bodies, all reachable, none identical — one strips every `*` and `:` anywhere, one strips only leading/trailing, one trims first then strips in separate passes. Which runs depends on which resolution path won. `content.js:222` even reaches into another module's private method (`fieldNameResolver._cleanFieldName`) inside a `try` that swallows failure.

**Impact:** `Card No: 1234` cleans to `Card No 1234` on one path and stays `Card No: 1234` on another. The field name is what appears in the exported DOCX/PDF/CSV, so two recordings of the same form produce differently-named steps. Bug reports about "wrong field name in the report" cannot be reproduced without knowing which path fired.

**Fix:** One public `window.FieldNameResolver.cleanFieldName(text)`; delete the other two. Delete `getEnhancedFieldName`'s ~90-LOC inline heuristic ladder (`content.js:129-164`) plus `findAssociatedLabel`/`findNearbyText`/`getSuggestedFieldName` — all duplicate `FieldNameResolver` strategies. Make `FieldNameResolver` a hard dependency (it is already in both the manifest and `CONTENT_SCRIPT_FILES`, so the "tolerated absence" branch guards a condition that cannot occur). Net: `content.js` loses ~150 LOC.

### CONS-23 · Popup export progress never updates — object-vs-number callback contract
**P1** · `src/ui/popup/popup.js:501-507` vs `src/core/export-service.js:96-97` · *ARCH-05*

`ExportService` always calls back with an object: `notify({ percent: 5, status: 'Loading session...' })`. The review page reads it correctly. The popup does not:

```js
const result = await exportService.exportSession(sessionId, format, (pct) => {
  if (typeof pct === 'number') {          // never true — pct is an object
    showExportProgress(`Exporting... ${Math.round(pct * 100)}%`);
  }
});
```

Two errors stacked: wrong shape **and** wrong scale (popup assumes 0–1, service emits 0–100). `exportSession`'s JSDoc has no `@param` at all, so the two consumers were written independently.

**Impact:** Popup export shows a frozen `Exporting...` for the entire run with the export button disabled — on a 100-screenshot DOCX that is minutes of apparently-hung UI, which reads as a crash.

**Fix:** Freeze the shape with a `@typedef {{percent: number, status: string}} ExportProgress`, extract a shared `renderExportProgress(el, progress)` into a new `src/ui/export-ui.js` (both pages also duplicate the download half — see CONS-36), and fix the popup call site.

### CONS-24 · `content.js` (1767 LOC) fuses six responsibilities into one classic script
**P1** · `src/content/content.js` · *ARCH-07*

| Concern | Lines | ~LOC |
|---|---|---:|
| Module bootstrap + re-injection guard | 46-115 | 70 |
| Field-name heuristics (duplicates FieldNameResolver — CONS-22) | 117-263 | 147 |
| Page-theme detection | 265-323 | 59 |
| Modal queue + shadow-DOM modal rendering | 325-645 | 320 |
| Event capture + dedup + messaging | 650-1136 | 487 |
| Recording lifecycle (start/pause/resume/stop, timers) | 1143-1347 | 205 |
| Floating panel: inline HTML + CSS + drag + timer | 1349-1616 | 268 |

All state is 20 mutable module-level `var`s, so the modal queue, the panel timer and the event handlers can only be reasoned about together. It is the largest file in the repo and the one with zero coverage (CONS-10), because nothing in it is importable.

**Fix:** Split into four manifest-declared classic scripts, each attaching one namespaced global, registered in both `manifest.json:content_scripts.js` and `background.js:CONTENT_SCRIPT_FILES` (that constant exists precisely so the two lists cannot drift): `ts-ui.js` (toast, highlight, theme detection), `ts-panel.js` (mount/update/unmount, with CSS moved into a `<style>` in the shadow root instead of `cssText`), `ts-modal.js` (queue as closure state instead of file globals). `content.js` keeps init, the five handlers, dedup, messaging and lifecycle — target ~600 LOC.

### CONS-25 · `StorageManager` (1197 LOC) still owns four concerns, and storage keys are declared in three files
**P1** · `src/core/storage.js` · *ARCH-08*

MED-002 correctly extracted quota/migration/orphan-cleanup. What remains is still four things: the key/serialization layer (~240 LOC), the concurrency/reliability layer (~70), domain CRUD, and **a security-boundary backup parser** with `SAFE_ID_RE`/`SAFE_DATA_URL_RE`/length caps (~130 LOC) living inside a CRUD class.

Storage key strings are re-declared in three files that must agree — `storage.js:43-44`, `orphan-cleaner.js:13-14`, `schema-migrator.js:12-13` — and `orphan-cleaner.js:23` encodes the whole namespace as a hand-written regex that silently stops matching if a prefix is added. The step key is inline-templated three times despite sibling `_assetIndexKey()`/`_assetKey()` helpers existing.

**Fix:** `src/core/storage-keys.js` exporting the constants plus `stepsKey(id)`/`assetKey(id, aid)` and a `SESSION_SCOPED_KEY_RE` **derived** from them. `src/core/storage-backup.js` for `exportAllData`/`_importDataLocked` and the four validation constants. `src/core/storage-codec.js` for the `_read*`/`_write*` pair. Delete the dead image constants (CONS-07) and `getSettings()`. Target ~450 LOC.

## UX & Accessibility

### CONS-26 · No `<label for>` associations anywhere — every select and text input on both pages is unlabelled
**P1** · WCAG 1.3.1 (A), 3.3.2 (A), 4.1.2 (A) · `popup.html:115-118,194-196,222-227,274-291`, `review-standalone.html:50-82,113-125,159-176` · *UX-05*

`grep -c "for=" src/ui/popup/popup.html src/ui/review/review-standalone.html` returns **0** for both. Every labelled control uses an unassociated sibling: `<label>Select Session:</label><select id="sessionDropdown">`. Neither wrapped nor `for`-linked. `#stepSearch` has only a placeholder; `#actionFilter` has no label at all.

**Impact:** A screen reader announces "combo box, blank" for session selection, export format, screenshot format, max sessions, image quality, session name, author, start/end time, step search, action filter, and both Add Step fields. The export and review flows are unusable non-visually.

**Fix:** Add `for="<id>"` to every label, or wrap the control — the checkbox/radio labels at `popup.html:186-189` already do this correctly and are the pattern to copy.

### CONS-27 · No `aria-live` region anywhere — every status, error and progress update is silent
**P1** · WCAG 4.1.3 (AA) · `popup.html:38`, `review-standalone.html:107,208-210`, `popup.js:984-999`, `utils.js:69-91`, `content.js:846-856` · *UX-06*

`grep -rn "aria-live\|role=\"status\"\|role=\"alert\"" src/` returns **nothing**. Both `showMessage()` implementations write to a plain `<div id="message">` and flip `display`.

Nothing is announced: "Recording started!", "Export failed: …", "Storage 87% full", "Restored 12 sessions", 0→100% export progress, the "Screenshot skipped — a sensitive field is focused" privacy warning, or the Undo link in `showMessageWithUndo()` (which auto-dismisses after 6s, unannounced). Combined with CONS-26, both surfaces are effectively opaque non-visually.

**Fix:** `role="status" aria-live="polite" aria-atomic="true"` on `#message` (switching to `role="alert"` for errors), on `#stateIndicator`, on the injected toast inside its shadow root, and on `#stepResultsSummary`. `role="progressbar"` with `aria-valuenow` on export progress.

### CONS-28 · Review-page modals have no dialog semantics; the export modal has no focus management or Escape
**P1** · WCAG 4.1.2 (A), 2.4.3 (A) · `review-standalone.html:155-195,198-214`, `review-standalone.js:246-252` · *UX-07*

Neither modal carries `role="dialog"`, `aria-modal="true"`, or `aria-labelledby` — both are bare `<div class="modal-overlay">` with an unassociated `<h3>`. Background content is never `inert`, so a screen reader can read behind the overlay.

`#addStepModal` at least has a focus trap, Escape, and trigger restoration. `#progressModal` has none: focus stays on the Export button behind the scrim, and the Escape handler is explicitly scoped `if (e.key === 'Escape' && addStepModal.classList.contains('active'))`, so Escape does nothing during export.

> Note the inversion: the **injected** content-script modal (`content.js:490-492`) sets `role`, `aria-modal` and `aria-labelledby` correctly. The extension's own page is the one that regressed.

**Fix:** Add dialog semantics to both `.modal-card` elements. On open, move focus in and set `inert` on `.app-wrapper`; restore on close. Extend the trap and Escape to `#progressModal`, with Escape invoking `cancelExport`.

### CONS-29 · `outline: none !important` destroys the focus ring on every form control, including the step checkboxes
**P1** · WCAG 2.4.7 (AA) · `review-standalone.css:1429-1431` overriding `:1192-1200` · *UX-08*

Line 1192 defines a good ring — `*:focus-visible { outline: 2px solid #4A7FB5; outline-offset: 2px; }` (4.20:1 on white, past the 3:1 bar). Line 1429 destroys it:

```css
.input-styled:focus, …, input:focus, select:focus {
  border-color: var(--accent) !important; box-shadow: 0 0 0 3px var(--accent-subtle) !important; outline: none !important;
}
```

`!important` beats the non-important `*:focus-visible`. The replacement glow is `--accent-subtle` = `rgba(79,124,187,0.1)` → composites to `#edf2f8` over white = **1.07:1**, invisible. Worse, bare `input:focus` also matches `input[type="checkbox"]`, where `border-color`/`box-shadow` do nothing on the native `appearance: auto` control — so `.step-checkbox` gets **no focus indicator at all**, and those checkboxes drive "Delete Selection".

> The popup's equivalent rule correctly writes `input:not([type="checkbox"]):not([type="radio"]):focus`. The review-page copy dropped the exclusion.

**Fix:** Change to `:focus-visible`, restore the checkbox/radio exclusion, drop `outline: none !important`, raise the glow to `--accent-glow` (0.25α).

### CONS-30 · `--accent` as text, all four light-theme toasts, and dark `.btn-danger` fail AA
**P1** · WCAG 1.4.3 (AA) · `popup.css:1692,597,1707,1797-1798,1345-1367,1724`, `review-standalone.css:1401` · *UX-09*

All normal-size text, so 4.5:1 required:

| Selector | fg / bg | ratio |
|---|---|---:|
| `.tab.active` (light) | `#4f7cbb` on `#ffffff` | **4.26** |
| `.tab.active` (dark) | `#5b8fd0` on `#272e39` | **4.09** |
| `#stateText` idle (15px/600) | `#4f7cbb` on `#ffffff` | **4.26** |
| `#stateText` while recording | `#4f7cbb` on `#f8eceb` | **3.69** |
| selected format chip | `#4f7cbb` on `#edf2f8` | **3.78** |
| `.message.warning` (light) | `#b87333` on `#f1ebe6` | **3.21** |
| `.message.info` (light) | `#4f7cbb` on `#e6ecf4` | **3.58** |
| `.message.success` (light) | `#2d7a4d` on `#e3ebe9` | **4.33** |
| `.message.error` (light) | `#b8413b` on `#f1e6e7` | **4.46** |
| `.btn-danger` (dark) | `#ffffff` on `#e0685f` | **3.33** |

The codebase already knows this pattern — `popup.css:1640-1644` documents that `--accent` fails AA and introduces `--accent-contrast: #3e6399` for filled buttons — but never applied the reasoning to `--accent` used *as text*, nor to `--danger` as a dark-theme button background.

**Impact:** The active tab label (primary navigation indicator) and recording status text are sub-AA in **both** themes, and the recording case degrades further as the card tints red beneath it. All four light-theme toast variants fail, so **every** success/error message in the default theme is sub-AA.

**Fix:** Add `--accent-text: #3e6399` light (6.09:1) / `#8ab6ea` dark for text uses. Darken `--warning` to `#8a5424` (~5.4:1). Add `--danger-contrast: #a8332d` (~6.2:1 with white) for filled destructive buttons, keeping `--danger` for borders and tints.

### CONS-31 · Injected modal's explanatory text and Skip button are below AA in both themes
**P1** · WCAG 1.4.3 (AA) · `src/content/content.js:441,468,472` · *UX-10*

`var textMuted = isLight ? '#868e96' : '#71717a';` colours `.ts-desc` — the sentence explaining what the dialog wants — at **3.32:1** light and **3.03:1** dark, and the same token colours the **Skip** button label, so one of the dialog's two actions is styled at 3.32:1.

**Impact:** This dialog interrupts recording and blocks it for 30s. A low-vision user who can't read the explanation or spot Skip has no way to understand or dismiss it, and the step is dropped on timeout.

**Fix:** `#5c636a` (6.0:1 on white) and `#9ca3ae` (6.6:1 on `#1E293B`). Give `.ts-btn-cancel` `textPrimary` — a dialog action shouldn't be styled as de-emphasised body text.

## Security & Privacy

### CONS-32 · Session start URL bypasses the capture-time sanitizer — tokens persisted and exported
**P1** · Confidence High · `background.js:522,524`, `export-service.js:228`, `file-sync.js:797` · *SEC-01*

`sanitizeStepForStorage()` is documented as the fix that strips sensitive query params "at CAPTURE time (so tokens are never written to storage/backups)". It only touches step fields. The session record built by `createSession()` is never passed through it:

```js
env: { url: tabInfo.url, title: tabInfo.title, ua: navigator.userAgent }   // raw tab.url
```

That object propagates unmodified into three sinks: `chrome.storage.local` (plus the `activeRecording` key), the on-disk `session.json`, and every export (`_exportJSON` serializes `exportData.session` verbatim — its per-step `_sanitizeUrl` loop never reaches it).

**Impact:** Start a recording from a password-reset mail, an OAuth implicit-flow redirect, a magic link, or a signed S3 URL — exactly `?reset_token=…`, `#access_token=…`, `?sig=…`. `sanitizeUrl()` is designed to strip precisely those keys and would have, had it been called. Instead the live token is written to storage, mirrored to the user's sync folder as plaintext, and embedded in the export they attach to a ticket. Full `navigator.userAgent` rides along.

**Fix:** `url: sanitizeUrl(tabInfo.url)` in `createSession()`. Add a `sanitizeSessionForStorage(session)` sibling called from `createSession()`/`updateSession()`. Defence in depth: sanitize `_formatSessionData()`'s `environment.url` so already-recorded sessions clean up on export.

### CONS-33 · Sensitive-field detection ignores `autocomplete` and misses modern payment/MFA field names
**P1** · Confidence High · `src/content/redactor.js:92-110,20-42` · *SEC-02*

`shouldIgnoreField()` inspects only `type`, `data-sensitive`, `name`, `id`, `placeholder`, `aria-label`. **`autocomplete` appears nowhere in `src/`** (grep-verified), so the browser-standard signals `one-time-code`, `cc-csc`, `cc-number`, `current-password` are ignored. Associated `<label>` text is never consulted either. Keyword holes: `/cvv/i` misses Stripe's `cvc`; `/credit[_-]?card/i` misses `cardNumber`; nothing matches `otp`, `code`, `one-time`, `mfa`, `2fa`, `verification`, `iban`; `/\bpin\b/i` fails on camelCase (`acctPin`).

**Impact:** Two concrete leaks. (1) `<input name="code" autocomplete="one-time-code">` — no pattern match, no PII regex fires on a 6-digit string, so the **live OTP** is written into the step and printed into the DOCX/PDF. (2) `name="cardNumber"` — the Luhn gate only masks a *complete* valid PAN, so an 800ms debounce pause after 14 of 16 digits records a partial PAN in clear, and `name="cvc"` records the CVC in clear regardless. The **same predicate gates screenshots** (`content.js:1667`), so a screenshot is also permitted while an OTP or CVC field is focused.

**Fix:** Add `autocomplete` as an unconditional return-true for the standard token set; add resolved label text; extend patterns with `/cvc/i`, `/card[_-]?number/i`, `/\botp\b/i`, `/one[_-]?time/i`, `/verification[_-]?code/i`, `/\bmfa\b/i`, `/2fa/i`, `/\biban\b/i`; make `pin` camelCase-aware. Mirror into `src/core/privacy-utils.js` as that file's header instructs.

## Performance

### CONS-34 · Selector generation runs ~30 document-wide queries plus 3 XPath scans synchronously per click
**P1** · `src/content/selector.js:529-551,563-580`, `content.js:1169` · *PERF-06*

`handleClick` is capture-phase on `document` and calls `generateSelector(element)` synchronously. For an element without `id`/`data-testid`/`name` — most buttons and divs — every strategy runs: the class strategy loops one full-document `querySelectorAll` **per class** (a Tailwind element carries 20–40), then `_addTextSelectors` runs two **unindexed full-tree XPath** evaluations for tags including `div`/`span`/`li`/`td`, plus `_addRelativeCssSelectors` (3 more queries), `_addXPathRelative` and `_addNthSelectors`. If `FieldNameResolver` falls through to `_fromProximityText`, add a `TreeWalker` pass with up to 40 `getBoundingClientRect()` calls — forced synchronous layouts.

**Impact:** On a Tailwind/Material admin app with a 5,000-node DOM, each click does ~30 full-document matches plus 3 whole-tree XPath walks **before the page's own click handler runs**. Clicks feel laggy — tens to low hundreds of ms — precisely on the complex apps people record tests for.

**Fix:** Scope `_isUnique` to the nearest ancestor with an id rather than `document`. Cap `_addClassSelectors` at 5 classes, skipping generated ones via the existing `_isGeneratedClass`. Drop one of the two whole-document XPath scans and skip text strategies for generic container tags. Longer-term: capture the element on click, generate in a `requestIdleCallback` after the page's handler runs.

### CONS-35 · Review page loads every screenshot into RAM at once
**P1** · `review-standalone.js:549-557`, `storage.js:260-269` · *PERF-07*

`buildAssetCache()` → `getAllAssets(sessionId)` → one `chrome.storage.local.get(keys)` returning every screenshot's `dataUrl` simultaneously; only then does the loop convert to blob URLs. The base64 array and the growing blob set coexist at peak.

**Impact:** The review tab opens automatically after every `stopRecording()`. For the 10-minute session from CONS-07, opening it allocates 200–350 MB of base64 strings plus decoded blobs — "Aw, Snap" at the exact moment the user tries to look at what they just recorded.

**Fix:** Read the asset index, then fetch and convert in batches of ~10, releasing each base64 string after `_dataUrlToBlob`. Better: defer per-step resolution to an `IntersectionObserver` — the markup already uses `loading="lazy"` but the blob is materialized eagerly regardless.

### CONS-36 · Export encodes every screenshot twice, synchronously, on the main thread
**P1** · `src/core/image-processor.js:105,202,230-247` · *PERF-08*

`useOffscreen` is `typeof OffscreenCanvas !== 'undefined' && typeof document === 'undefined'` — the review page **has** a `document`, so exports always take `_processImageDOM`. For the default `format: 'auto'` that path encodes each image twice (`toDataURL('image/png')` then `toDataURL('image/jpeg', quality)`), both fully synchronous. Before them, `detectContentType` calls `getImageData` on a context created without `willReadFrequently` (the OffscreenCanvas path passes it at `:143`; the DOM path doesn't), forcing a GPU→CPU readback per image.

**Impact:** A 40-screenshot DOCX export = 40 × (readback + PNG encode + JPEG encode) at 1920×1080 ≈ 10–20 seconds of a completely frozen tab. The progress modal can't repaint (so it reads as a hang) and the cancel button is unclickable throughout.

**Fix:** Use `OffscreenCanvas` whenever available rather than gating on the absence of `document` — it works fine in a window context. Pass `willReadFrequently: true` on the DOM fallback. Encode PNG first, JPEG only if the PNG looks oversized. Yield between images.

### CONS-37 · The sensitive-field screenshot guard is answered by whichever frame replies first
**P1** · `background.js:597`, `content.js:1665-1670` · *PERF-09*

`chrome.tabs.sendMessage(tabId, { action: 'isSensitiveFieldActive' })` — **no `{ frameId: 0 }`**, so it's delivered to every frame. `content.js` is injected with `all_frames: true` and responds synchronously in all of them, each reporting its own `document.activeElement`. `sendMessage` resolves with the **first** response; which frame wins is nondeterministic.

**Impact:** A login page with any embedded iframe (analytics pixel, reCAPTCHA, chat widget): the sub-frame's `activeElement` is its own `<body>`, so it answers `{ sensitive: false }` — and the auto-screenshot the guard exists to suppress is taken with the password field visible and stored unredacted.

> `getFrameLabel` at `background.js:1317-1320` **does** correctly pass `{ frameId: 0 }`. The pattern is known, just not applied here.

**Fix:** Add `{ frameId: 0 }` to the `isSensitiveFieldActive`, `beforeScreenshot` and `afterScreenshot` sends.

### CONS-38 · 126 KB of content script is parsed and three engines constructed in every frame of every page
**P1** · `manifest.json` `content_scripts`, `content.js:107` · *PERF-10*

`<all_urls>` + `file:///*` with `all_frames: true`, injecting five **unminified** files totalling 128,633 bytes. At `document_end`, `content.js:107` unconditionally runs `initModules()`, constructing `new SelectorEngine()`, `new Redactor()` (6 `RegExp` compilations) and `new FieldNameResolver()` — in every frame, recording or not.

**Impact:** A news article with 15 ad iframes pays 16 × (parse 126 KB + construct 3 objects) on every page load, forever, for a user who last recorded a test in March. A fixed tax on all browsing.

**Fix:** Two independent wins. (1) Minify the content scripts — they run everywhere and are the only files not being processed. (2) Split: only `logger.js` plus a tiny bootstrap needs to be in the static entry; the rest can be injected on demand when recording starts — the machinery already exists (`CONTENT_SCRIPT_FILES` at `background.js:284`).

## QA

### CONS-39 · No test ever produces or parses a DOCX, PDF, or full export
**P1** · `export-service.js:95,484,529,620,653,904` · *QA-06*

`export-service.js` sits at **14.0%** and every uncovered statement is in the code that produces a file: `_exportPDF` 88/88 uncovered, `_exportDOCXHtml` 84/84, `_buildDocxBlob` 54/54, `exportSession` 28/28. The 25 existing tests all run against `const fakeStorage = {};` and touch only pure string helpers plus CSV/JSON/Markdown *string* output. **Nothing opens the produced artifact.** The manual DOCX ZIP builder — which CLAUDE.md describes as "builds valid ZIP manually" — has never been asserted to produce a valid ZIP.

**Fix:** `tests/export/export-artifacts.test.js`: call `_buildDocxBlob`, assert the local-file-header magic `PK\x03\x04`, unzip in-test (`zlib.inflateRaw` on stored entries suffices) and assert `[Content_Types].xml` and `word/document.xml` exist and parse as XML containing the session name. Plus a CSV round-trip through a real parser, and an end-to-end `exportSession('json')` against the in-memory chrome mock rather than `fakeStorage = {}`.

### CONS-40 · The E2E suite passes by returning early — ~27 silent bailouts, no CI, `headless: false`
**P1** · `tests/e2e/functionality.spec.js` (25), `extension.spec.js` (2), `playwright.config.js:12` · *QA-07*

The specs are genuinely written — they launch the unpacked extension via `launchPersistentContext` and drive the real popup. But nearly every assertion sits behind a bare `return`:

```js
if (!startResult?.success) {
  console.warn('[test] startRecording failed:', startResult?.error, '— skipping state assertion');
  await target.close().catch(() => {});
  return;
}
```

**A `return` in Playwright is a pass, not a skip.** If recording breaks completely, the recording tests go green with a `console.warn` nobody reads. Compounding: no CI config anywhere, `dist/` is gitignored so the specs silently target a stale or absent build (see CONS-14), and `headless: false` means they cannot run unattended.

**Impact:** The most valuable tests in the repo — the only ones that exercise `background.js`, `content.js` and `popup.js` at all — are structurally incapable of failing on the bugs they were written to catch, and are never run.

**Fix:** Replace every bare `return` with `expect(startResult?.success, startResult?.error).toBe(true)` or `test.skip(condition, reason)` so a bailout is visibly a skip. Add an unconditional guarantee spec: start → click → type → stop, then assert `getSteps(sessionId).length === 3` with the exact actions.

### CONS-41 · The `chrome.*` mock is too friendly to prove anything about MV3
**P1** · `storage.test.js:23-54` + 4 more copies · *QA-08*

There is **no shared chrome mock** — the same ~30-line `vi.stubGlobal('chrome', {...})` is copy-pasted into five test files. Every copy is promise-only and cannot fail. Missing entirely: `chrome.runtime.lastError` (grep across `tests/` returns **nothing**), callback-style invocation, `QUOTA_BYTES`/`QUOTA_BYTES_PER_ITEM` enforcement, a `set` that ever rejects, `sendMessage`/`onMessage` port semantics (no `sendResponse` returning `true` for async), `chrome.tabs`, `storage.onChanged`.

**Impact:** The suite proves the storage layer works against a `Map`. It proves nothing about `chrome.storage.local`, which in production returns errors via `lastError` rather than rejecting, silently drops writes past `QUOTA_BYTES_PER_ITEM`, and tears down message ports when the SW sleeps — every one a session-loss vector the mock cannot express.

**Fix:** `tests/helpers/chrome-mock.js` exporting `installChromeMock({ quotaBytes, failNextSet, lastError })`; switch all five files to it. Then test the three semantics above explicitly.

### CONS-42 · Concurrent step writes and step ordering are untested — `_enqueue` has no test
**P1** · `storage.js:383-391` · *QA-09*

`_enqueue` exists specifically to serialize read-modify-write mutations ("FIX: FUNC-008"). Grepping `tests/` for `Promise.all`, `concurrent`, `_enqueue` or `race` returns one unrelated hit. Every storage test awaits one operation at a time — the one shape that cannot expose a serialization bug.

**Impact:** Rapid typing fires overlapping `addStep` calls. If the queue chain breaks (an unhandled rejection detaching `_writeQueue`, or a caller bypassing `_enqueue`), concurrent RMW on `testsnapper_steps_{id}` means later writes clobber earlier ones — steps disappear from the middle of the session and the count still looks plausible.

**Fix:** Fire 20 concurrent `addStep` calls against a mock with an artificially delayed `set`; assert `getSteps` returns exactly 20 **in submission order**. Second case: the 5th write rejects, the other 19 still land (queue not poisoned).

### CONS-43 · Redaction is only unit-tested at the pattern level, never end-to-end into a stored or exported step
**P1** · `content.js:898-920,969-989`, `tests/helpers/fixtures.js` · *QA-12*

`Redactor` itself is well covered (96.5%, including Luhn). But the **call sites** are in `content.js`, which is 0% covered. Nothing asserts that the *masked* value — not `element.value` — is what reaches `addStep`. `fixtures.js` ships `sensitiveSteps` with a raw SSN `'123-45-6789'` and a raw card number, and **no export test consumes them**.

**Impact:** This is a privacy incident, not just a bug. One refactor passing `element.value` instead of `maskedValue` writes the user's real SSN and card number into a DOCX they email to a colleague — and the redactor unit tests stay green throughout.

**Fix:** `tests/content/redaction-e2e.test.js`: type `'4532 1234 5678 9010'` into `<input name="card">` in jsdom, capture the `sendMessage` payload, assert the transmitted `value` contains no 4-digit run from the input and `isSensitive === true`. Plus `tests/export/redaction-export.test.js`: run `fixtures.sensitiveSteps` through all four exporters and assert `'123-45-6789'` and `'4532'` appear in **none** of the outputs.

### CONS-44 · Selector uniqueness and stability are untested — most of the engine is 0%
**P1** · `tests/content/selector.test.js:254-307` · *QA-11*

`selector.js` is 32.5% covered and the uncovered part is the whole fallback ladder: `_addFrameworkSelectors`, `_addXPathRelative`, `_addRelativeCssSelectors`, `_addClassSelectors`, `_addNthSelectors`, `_addTextSelectors`, `_addAriaSelectors`, `_addPlaceholderSelectors`, `_generateAbsoluteXPath` — all 0%. The five `generateSelectors` tests each append **one** element to an empty body and assert with a substring match on a joined string:

```js
const allSelectors = result.all.map(s => s.selector).join(' ');
expect(allSelectors).toContain('submit-btn');
```

That proves the token appears somewhere, not that a **usable, unique** selector was produced. No test ever calls `document.querySelectorAll(selector)` to check it matches exactly one element.

**Impact:** Selector generation *is* the product. Against a real page with two `#email` elements, an auto-generated `id="ember1234"`, or React churn, the engine falls into strategies with zero coverage. A selector matching 3 elements produces a test script that fails on replay — discovered only after the recording is gone.

**Fix:** Build a realistic fixture DOM (a form in two sibling containers, one duplicated `id`, one auto-generated `id`, one `data-testid`) and assert `querySelectorAll(result.primary.selector).length === 1` **and** `querySelector(...) === element` for each. Add a duplicated-`id` case asserting the engine does *not* pick the ID strategy.

---

# P2 findings

| ID | Finding | Location | Persona |
|---|---|---|---|
| CONS-45 | **Dead exports & an orphaned module — tests green on code nothing runs.** `step-utils.js` (whole file), `validateSettings`, `shouldCaptureNavigationScreenshot`, `SelectorEngine.isStepDuplicate`, `Utils.generateStepDescription`/`debounce`/`truncate`/`dataURLtoBlob`, `SelectorEngine.isInteractable`/`clearCache`/`getCacheStats` — none imported by production code, several tested. Four separate duplicate-detection implementations exist with different semantics; only `recorder-utils.js:40` runs. Wire up or delete, in the same commit as the test. | `step-utils.js`, `utils.js:48,96,141,149`, `recorder-utils.js:129,159`, `selector.js:43,1071,1096,1104` | ARCH-13 |
| CONS-46 | **Content scripts can't import `core/`, so four safety rules are kept in sync by comment.** `privacy-utils.js:8-10` and `recorder-utils.js:117-119` both say "keep the two in sync". Nothing enforces it. A new PII pattern added to `privacy-utils.js` protects the background backstop but not the content-script redactor. **Fix:** add `content: './src/content/content.js'` as a second webpack entry — webpack's IIFE wrapper satisfies the `var`-not-`let` re-injection constraint automatically — or add a `mirror-consistency.test.js` running one shared fixture table through both copies. | `privacy-utils.js` ↔ `redactor.js`, `recorder-utils.js` ↔ `content.js:1036` | ARCH-14 |
| CONS-47 | **Three error-handling dialects, and two error identities encoded as English prose.** `content.js:1125` keys retry logic to `response.error === 'No active session'`; `review-standalone.js:1210` keys cancel-vs-failure to `/cancelled/i` — and `export-service.js` throws **four different** cancellation strings. Rewording a user-facing message silently breaks control flow. **Fix:** `src/core/errors.js` with `TSError(code, message)` and a frozen `CODES` map; match on `err.code`, never `err.message`. | `background.js` (45 sites), `storage.js` (16 throws), `file-sync.js` (17 nulls) | ARCH-09 |
| CONS-48 | **PDF export ignores cancellation entirely while the UI offers a Cancel button.** The dispatcher passes three args (`:148`) to a two-param method (`:904`), so `notify` is silently dropped; and the ~150-line step loop contains **zero** `_isCancelled()` checks (DOCX checks at 4 points). The user clicks Cancel, the modal stays up, the file downloads anyway. | `export-service.js:904` vs `:148` | ARCH-10 |
| CONS-49 | **The export download path is copy-pasted between popup and review**, ~18 lines verbatim. Already diverged: review handles cancellation, popup does not — so a cancelled popup export reports `Export failed: Export cancelled`. CLAUDE.md claims `Utils.downloadFile` exists; `grep downloadFile src/` returns nothing. | `popup.js:508-527` vs `review-standalone.js:1188-1204` | ARCH-11 |
| CONS-50 | **Step descriptions generated twice with different grammar** — `Utils.generateStepDescription` (past tense) is never called; review defines its own (imperative); export falls back to a *third* inline shape. The review copy HTML-escapes **inside** the generator while its output is used as plain text and persisted, so a field named `Q&A` round-trips to `Q&amp;amp;A` in the DOCX. | `utils.js:149-179` vs `review-standalone.js:714-739` | ARCH-12 |
| CONS-51 | **Adding an export format touches 6 files; no registry declares the valid set.** `popup.js:494` defaults to `'json'` while `:819` defaults to `'docx'`; `exportSession` throws `Unsupported format` only at runtime. **Fix:** `src/core/export-formats.js` as a registry; render the format controls from it so the HTML edits become automatic. | `export-service.js:134-155`, both HTMLs, `popup.js:494,819` | ARCH-15 |
| CONS-52 | **`fieldName` and `selector.element.text` skip the PII backstop.** `sanitizeStepForStorage` masks only `url`/`value`/`targetLabel`. `<button aria-label="Delete card ending 4242">` or a row button whose text is a customer email lands unmasked in storage, `session.json`, and the DOCX/PDF/Markdown. | `background.js:22-31`, `selector.js:94,116,1038-1039` | SEC-05 |
| CONS-53 | **Screenshot pixels are never redacted** — the largest PII channel has no filter. The JSDoc admits it. Order confirmations, banking dashboards, admin pages listing customer emails are captured losslessly and embedded in shared exports. **Fix:** overlay solid rectangles over sensitive fields in `beforeScreenshot` (the hook already exists and already hides the extension's own UI this way); add a per-screenshot blur tool in review; state the limitation in `PRIVACY_POLICY.md`. | `background.js:565,596-608,641` | SEC-03 |
| CONS-54 | **No `event.isTrusted` gate** — a recorded page can forge unlimited steps. All four capture listeners attach with no trust check (`isTrusted` appears nowhere in `src/`), no length cap on `value`, and `addStep` spreads caller data **over** its own identity fields. A hostile page can fabricate steps into a QA/compliance artifact, or exhaust disk via multi-MB synthetic `change` events under `unlimitedStorage`. | `content.js:1169-1172`, `background.js:1050-1055` | SEC-04 |
| CONS-55 | **Every top-frame page load wakes the service worker.** `content.js:1747` sends `getState` unconditionally; a message is what *starts* a stopped MV3 worker. The SW stays resident for the entire browsing session (~5–15 MB) for users not recording anything. **Fix:** read the `activeRecording` key from `chrome.storage.local` directly first (content scripts can, without waking the SW). | `content.js:1747` | PERF-11 |
| CONS-56 | **`pendingInputs` retains DOM elements on two of three exit paths.** A plain `Map` keyed by the element; `delete` is the last statement of the happy path only. Skipped modals and debounced duplicates pin their input — and, once React unmounts, the whole detached subtree — for the rest of the recording. **Fix:** `WeakMap`, or move the `delete` to the top of the callback. | `content.js:889-933` | PERF-12 |
| CONS-57 | **Every step re-gzips the entire steps array (O(n²) per session).** Step *n* compresses all *n* steps; `addStep` also rewrites the whole `testsnapper_sessions` array to bump `stepCount`. A 300-step session performs ~300 gzips averaging 100 KB. **Fix:** keep `_stepsCache` as source of truth during recording, flush every ~5s and on stop/suspend. | `storage.js:201-207,896-907` | PERF-13 |
| CONS-58 | **API-call capture stops silently after a service-worker restart.** The code documents its own defect; `ApiCapture.start()` is called from `startRecording`/`resumeRecording` but not from the `recoveryReady` block, and dynamic `webRequest` listeners don't survive SW termination. **Fix:** add `ApiCapture.start(...)` beside the badge restore at `:419-431`. | `background.js:716-719,871,911` | PERF-14 |
| CONS-59 | **Filesystem mode does an IndexedDB read and permission query per operation.** The Proxy re-checks `isFilesystemReady()` (→ `queryPermission`, possibly an IndexedDB open) and `isInBuffer()` (another `storage.get`) on every routed call, memoized nowhere — 2–3 extra round-trips per call, adding perceptible drag-and-drop lag. | `fs-storage.js:83-92`, `file-sync.js:206-223` | PERF-15 |
| CONS-60 | **Drag-to-reorder rewrites every step and rebuilds the entire card list.** Each drop re-gzips the steps key, then `container.innerHTML = stepsData.map(...)` for the whole list plus five `querySelectorAll` listener passes. Reordering a 200-step session destroys and recreates ~200 cards with `<img>` elements per drop, forcing image re-decode and losing scroll/focus. | `review-standalone.js:1137-1151,644` | PERF-16 |
| CONS-61 | **`Logger` never drops to `warn` in production.** The gate sniffs `typeof process !== 'undefined'`, which is false in a browser and a service worker. The copied path never gets DefinePlugin; the bundled path had its optional chain rewritten by Babel before substitution, so it's still behind the false `typeof process` check. Nothing else calls `setLevel`, so the level stays `info`. Session UUIDs, storage-flush traces and filesystem folder names reach production consoles. Content scripts are unaffected (`content/logger.js` hardcodes `warn`). | `src/core/logger.js:45-47` | BUILD-10 |
| CONS-62 | **Babel targets Chrome 88 while the manifest floor is 105.** Resolved definitively: acorn-parsing every file in `src/` shows the highest *syntax* requirement is ES2020 (Chrome 80), but *runtime APIs* land higher — `structuredClone` (Chrome **98**), `showDirectoryPicker` (86), `"type": "module"` background (91). **`minimum_chrome_version: 105` is correct**; Babel's 88 is stale, and a third number ("Chrome 91+") appears in a webpack comment. Lowering the manifest to match Babel would ship a broken extension. | `webpack.config.js:46-49` vs `manifest.json:9` | BUILD-11 |
| CONS-63 | **`download-libs.js` follows redirects with no limit or host allowlist, and two pins are TOFU.** The redirect branch recurses with no depth counter. The docx and html2pdf hashes are self-derived (`// TOFU-pinned 2026-07-04`) rather than cross-verified — if the CDN served tampered bytes that day, the tampering is now the pinned "known good". Bounded, because the SRI check runs after download and fails closed. | `scripts/download-libs.js` | BUILD-12 |
| CONS-64 | **CWS metadata gaps and a permission set guaranteeing extended review.** No `short_name`, no `homepage_url` (despite a live site and a `PRIVACY_POLICY.md`); the README badge points at `github.com/testsnapper/testsnapper`, not the actual remote. `webRequest` + `<all_urls>` triggers mandatory single-purpose/data-use justification and multi-week review. `web_accessible_resources` exposes `src/assets/icons/*` with no consumer. | `manifest.json` | BUILD-13 |
| CONS-65 | **Schema migration v1→v2 is tested against a synthetic fixture and a mock writer.** The `MockStorageManager._writeSteps` just does `chromeStore.set(...)`; the **real** one does GZIP compression and split-key chunking — none of which the migration test exercises. The migration deletes the v1 key. If the real compression path chokes on a large v1 payload after `testsnapper_data` is removed, the user's entire history is gone with no rollback. Idempotency *is* properly tested; the writer is the gap. | `tests/core/schema-migrator.test.js:49-112` | QA-14 |
| CONS-66 | **Export cancellation is tested only as a boolean flag, never mid-flight.** The four tests toggle and read the flag; `exportSession` — the method that checks it between chunks — is 28/28 uncovered, and `resetCancellation` is 0%. A cancellation that doesn't take effect keeps chunking; one that doesn't clean up makes the *next* export abort immediately with no explanation. | `tests/export/export-service.test.js:68-92` | QA-15 |
| CONS-67 | **Regression pins missing for the prior fix waves** — 49 fix IDs in `src/`, only 7 referenced in `tests/`. Spot-checked: PERF-012 (non-retryable quota) not pinned; HIGH-004 (content-script dependency guards) not pinned; MED-007 (theme dedup) not pinned — `theme.js` is never loaded. 42 of 49 landed fixes can silently regress. **Fix:** adopt the convention `orphan-cleaner.test.js` already uses — name the `describe` block after the fix ID. | repo-wide | QA-16 |
| CONS-68 | **The floating panel's shadow root lacks the `all: initial` reset the modal and toast both have.** Selector matching doesn't cross the shadow boundary but **inherited properties do** — `font-size`, `line-height`, `letter-spacing`, `text-transform`, `color`, `direction` all flow in from the host. `.btn` sets no `font-size` at all. The one injected surface that lives on the page for the entire session is the least protected. | `content.js:1365-1372` vs `:459-460`, `:840-841` | UX-12 |
| CONS-69 | **All injected surfaces use `position: fixed` on children of `document.body`.** If the host's `body`/`html` carries `transform`, `filter`, `backdrop-filter`, `perspective` or `contain: paint` — common with body-level dark-mode filter hacks and slide-out mobile menus — fixed positioning resolves against that element instead of the viewport. The panel drifts, the modal scrim shrinks to the body box, and the highlight overlay (positioned from viewport-coordinate `getBoundingClientRect()`) **rings the wrong element in the recording**. All silent. **Fix:** append to `document.documentElement`. | `content.js:451,835,1366-1368,670-680` | UX-13 |
| CONS-70 | **No `prefers-reduced-motion` support against 89 animation/transition declarations.** Several run indefinitely: the injected panel's `.status-dot { animation: pulse 2s infinite }`, the popup's recording pulse plus an expanding-ring `::before`, and a dark-theme `gradientShift 3s infinite` on `#stateText`. Users with vestibular disorders get an unavoidable pulsing dot on every page for the whole recording. | both CSS files, `content.js:1445-1447,1360-1362` | UX-11 |
| CONS-71 | **"Add step" buttons render at 1.79:1 and drag handles at 2.54:1 at rest.** `.add-between { opacity: 0.45 }` composites white-on-accent to 1.79:1; `.step-handle` uses `--text-disabled` `#9ca3af` = 2.54:1 light / 2.79:1 dark — below the 3:1 required of a UI graphic. The two controls driving reordering and insertion are near-invisible until pointed at. | `review-standalone.css:863-908,670-677` | UX-14 |
| CONS-72 | **Errors auto-dismiss in 3 seconds, carry raw exception text, and some are swallowed.** The popup's local `showMessage()` shadows `Utils.showMessage` (which correctly gives errors 6s) and defaults to 3000ms; every error call site omits the duration. Content is raw `err.message`. `loadSessions()` catches its own failure into `Logger.error` and shows nothing — the dropdown just stays empty. | `popup.js:984` + 8 call sites | UX-15 |
| CONS-73 | **No empty state when there are zero sessions.** The Export tab renders a complete, inert export form — dropdown with only a placeholder, four format chips, Export button, storage bar reading "Calculating..." — with nothing stating the list is empty. A first-run user must deduce that the empty dropdown is why Export is greyed out. | `popup.js` `loadSessions()`, `popup.html:110-177` | UX-16 |
| CONS-74 | **Keyboard step reorder exists but is undiscoverable and unannounced.** ArrowUp/ArrowDown on the focused handle is genuinely implemented — but the handle's accessible name is `"Drag to reorder step N"`, so a keyboard user has no way to learn the alternative exists, and nothing announces the outcome. A WCAG 2.1.1 failure narrowly avoided by implementation, then reinstated in practice by discoverability. **Fix:** `aria-label="Reorder step N of M. Press Up or Down arrow to move."`, `aria-keyshortcuts`, and a live-region announcement. | `review-standalone.js:666-668,807-830` | UX-17 |
| CONS-75 | **Nothing routes the user from "Stop" to the review page.** Stopping via the panel just makes it disappear; via the popup, a "Recording stopped!" toast. Reaching the session just recorded takes five interactions (reopen popup → Export tab → dropdown → select → View Steps), with no indication the review page exists. The hand-off between the two halves of the product is undiscoverable. | `popup.js:461-474`, `content.js:1554-1557` | UX-18 |
| CONS-76 | **Drag handle target is under 24×24 CSS px** (WCAG 2.5.8). `.step-handle` has 4px padding around a 20px `⋮⋮`; the box lands around 21–23px wide. The inline `padding-top: 10px` skews it vertically without widening. A marginal miss on the control requiring the most precise interaction. | `review-standalone.css:670-677`, `review-standalone.js:668` | UX-19 |

---

# P3 findings

| ID | Finding | Location | Persona |
|---|---|---|---|
| CONS-77 | **Generated CSS selectors interpolate page-controlled attribute values without `CSS.escape`.** ID and class strategies escape correctly; attribute-value strategies don't. `data-testid='a" i], [type="password'` yields a *valid* selector matching a **different** element — and that string is what the user pastes into Selenium/Playwright. Also `_getLabelText` (`:1044`) calls `querySelector` outside any try/catch, so `id='a"b'` throws out of `extractFieldName` and drops the submit step. | `selector.js:291,343,451,1044`, `field-name-resolver.js:181` | SEC-07 |
| CONS-78 | **`setUninstallURL` to Google Forms contradicts `offline_enabled` and the privacy policy.** The only outbound network reference in the extension. On uninstall Chrome discloses the user's IP, User-Agent and the uninstall event to Google — which `PRIVACY_POLICY.md` says does not happen. `forms.gle/testsnapper-feedback` also isn't a real provisioned short-link format, so it likely 404s. | `background.js:294`, `manifest.json:7`, `PRIVACY_POLICY.md:29,51` | SEC-08 |
| CONS-79 | **Flush to disk writes screenshots one file at a time, sequentially.** 120 screenshots = 120 sequential File System Access round-trips (`getDirectoryHandle` → `getFileHandle` → `createWritable` → `write` → `close`). Several seconds of apparent stall after stopping a recording. **Fix:** `Promise.all` over chunks of ~8. | `file-sync.js:496-499,619-621` | PERF-17 |
| CONS-80 | **Content-script re-injection adds a second `onMessage` listener.** The `__testSnapperInitialized` guard covers only state init; the listener registration (`:1618`) and `initModules()` (`:107`) sit outside it. The background pings before injecting, which prevents the common case — but the ping fails after an extension reload, when the isolated world still holds a stale `true`. | `content.js:46-72,1618` | PERF-18 |
| CONS-81 | **Highlight auto-remove timer removes whichever overlay is current, not its own.** `setTimeout(removeHighlight, 1000)` operates on the module-level `highlightOverlay`. Click twice within a second and the first timer removes the second click's highlight — cosmetic, but it makes the extension look unreliable at the moment it's confirming a capture. | `content.js:666-694` | PERF-19 |
| CONS-82 | **Six committed files under `tests/` that no runner executes**, including `tests/__init__.py` (an empty Python marker in a JS repo) and `tests/verify_selector.js`, which contains a **verbatim frozen copy** of `SelectorEngine.isStepDuplicate` and tests *that* — validating a snapshot of logic against a method now unused. `tests/debug_export.js` and `verify_content_fix.js` both admit in their own comments that they test stubs. `_smoke_settings.cjs` at repo root is the exception: it's real (launches the packed extension, spins an HTTP server with `/api/ok`/`/api/fail`, smoke-tests Settings + API capture + auto-screenshot) and is the only artifact covering API-request capture — **keep it, relocate it to `tests/e2e/`, convert its `console.log` checks to `expect`.** | `tests/{__init__.py,debug_export.js,verify_*.js,test_compression.mjs}`, `_smoke_settings.cjs` | QA-18, ARCH-17 |
| CONS-83 | **A test in `export-service.test.js` cannot fail — proven.** `expect(JSON.stringify(service._formatSessionData(session, 7))).toContain('7')` passes with `stepCount = 0`, because the serialized output contains the timestamp `1700000000000`. Verified directly. The two neighbouring tests use the same shape and are only accidentally sound. | `tests/export/export-service.test.js:61-65` | QA-13 |
| CONS-84 | **Stale premise comments contradict the shipped manifest.** `quota-monitor.js:4` opens *"With unlimitedStorage removed from manifest.json…"* — `manifest.json:14` lists it, and the code correctly queries `chrome.permissions.contains`. `storage.js:33` instructs adding permissions as if it were an open TODO; `storage.js:10` still advertises canvas image compression that moved to `ImageProcessor`. Separately, `popup.js:373-388` is a fourth storage-usage implementation re-hardcoding the 1 GB ceiling and 80/95 thresholds `QuotaMonitor` already owns. | `quota-monitor.js:4`, `storage.js:10,33`, `popup.js:373-388` | ARCH-18 |
| CONS-85 | **`.gitattributes` declares `merge=ours` for paths that aren't tracked** — all five are gitignored, so the merge driver can never apply. Cosmetic, but the rules look like protection and are inert. Keep `libs/* -text`, which is real and load-bearing. | `.gitattributes:1-5` | BUILD-16 |
| CONS-86 | **Dead weight in the shipped package**: `libs/README.md` (developer notes) is copied into the published extension, and three Terser `.LICENSE.txt` files (16.4 KB) persist in `dist/` because of `clean: false`. `dist/libs/docx.min.js.LICENSE.txt` contains only a stale banner pointing at a file that doesn't exist. | `webpack.config.js:87`, `dist/libs/` | BUILD-15 |
| CONS-87 | **Version claims inconsistent across five files, no git tags.** README badge 1.1.3, README changelog v1.1.5, QUICK_START 1.1.3, manifest 1.1.6, package.json 1.1.5, CLAUDE.md 1.1.5. Nothing anchors what was actually published — which is what makes CONS-01 hard to notice. | `README.md:5,606`, `QUICK_START.md:383` | BUILD-14 |
| CONS-88 | **Escape in the injected modal only works while the text input has focus.** The Tab trap is bound to `overlayDiv`; Enter and Escape are bound to `input` only. Once the user Tabs to Skip or Confirm, Escape does nothing, and the trap keeps cycling — the only exits are clicking or the 30s timeout. | `content.js:595-600` vs `:562-573` | UX-20 |
| CONS-89 | **Keystrokes typed into the injected modal propagate to the host page's shortcut handlers.** The key handlers call `preventDefault()` but never `stopPropagation()`; shadow-DOM events retarget but still bubble to `document`. On sites with single-key shortcuts (`/`, `j`/`k`, `?`), typing a field name into TestSnapper's dialog can scroll or navigate **the very page being recorded**, polluting the session. | `content.js:562-573,595-600` | UX-21 |
| CONS-90 | **Heading hierarchy skips `<h2>`; a dead blinking-focus animation; inconsistent terminology.** Both pages go `<h1>` → `<h3>`. `.select-styled:focus { animation: cursorBlink 1s step-end infinite }` would be a WCAG 2.2.2 violation but is inert because `:1429`'s `!important` beats it — a latent hazard for whoever removes that `!important`; delete it. Four words for one concept: "Steps" / "interactions" / "action" / "Actions"; "session" vs "recording" mixed the same way. | `popup.html:21,104…`, `review-standalone.css:1176-1187` | UX-22 |
| CONS-91 | **`.clone/` is an empty gitignored directory** left over from worktree experiments. Remove. | `.clone/` | ARCH-17 |

---

# Documentation drift

CLAUDE.md is the architecture reference and is **itself gitignored** (`/CLAUDE.md` in `.gitignore`), so drift can never be caught in code review. Twenty-one claims were checked:

| Claim | Status | Evidence |
|---|---|---|
| Current version is 1.1.5 | **Drifted** | `manifest.json:5` = 1.1.6 |
| "Versions single-sourced from package.json … injected at build time" | **Drifted (harmful)** | Mechanism works, but the manifest carries a conflicting real version, so the build *downgrades*. CONS-01 |
| `dom-utils.js` merged into `utils.js` (FUNC-021) | **Verified** | No `dom-utils.js`; `utils.js:182` documents the removal |
| utils.js provides `downloadFile`, `showMessage` | **Drifted** | `showMessage` exists; `downloadFile` exists nowhere. CONS-49 |
| MED-002: StorageManager decomposed | **Verified (partial)** | All three delegates exist; storage.js still 1197 LOC with four concerns. CONS-25 |
| MED-005: FSStorageManager Proxy pattern | **Verified, not earning its cost** | Routes only `StorageManager` names; signatures diverge silently. CONS-21 |
| HIGH-001: image compression unified | **Verified** | `image-processor.js` is the only image code |
| MED-008: Logger abstraction | **Verified — best-kept claim in the doc** | Zero raw `console.*` outside the two Logger implementations |
| MED-007: theme dedup into theme.js | **Verified** | Imported by both pages |
| Theme uses `body.dataset.theme`, manages both classes | **Drifted (minor)** | `theme.js:12-15` sets `dataset.theme` on **both** `documentElement` and `body`, toggles classes on `documentElement` only |
| "CDN fallback for docx and html2pdf with SRI" | **Drifted** | No CDN code remains; both loaders are local-only. SRI lives in a build script |
| "Local libs tried first (docx, html2pdf)" | **Drifted** | PDF uses jspdf; html2pdf referenced by nothing. CONS-20 |
| "DOCX fallback builds valid ZIP manually" | **Drifted** | `_exportDOCXHtml` emits an HTML string as `application/msword` with a `.doc` extension. No ZIP construction anywhere |
| `unlimitedStorage` for screenshots (1 GB) | **Verified (manifest), contradicted in comments** | `quota-monitor.js:4` claims it was *removed*. CONS-84 |
| "~95% JSDoc coverage (150+ methods)" | **Drifted** | Density is high, but the docs are wrong where it matters: `exportSession` has no `@param` for the callback both UIs consume differently (CONS-23); `_exportPDF` omits the third arg its caller passes (CONS-48). Coverage is a poor proxy — the gaps are at the contract seams |
| "Observations/ (65 findings)" | **Stale** | Directory doesn't exist and is gitignored |
| Content scripts use `var` at top level | **Verified** | `grep '^let \|^const ' src/content/content.js` → 0 |
| Only background.js bundled; rest copied | **Verified** | Single entry; CopyPlugin covers content/ui/core |
| Selector strategies as listed | **Verified** | All `_add*Selectors` present |
| "1 second debounce on auto-screenshots" | **Verified** | `background.js:57` `screenshotDebounceMs = 1000` |
| CLAUDE.md is the architecture reference | **Process risk** | It is gitignored, so drift is invisible to review |

---

# Verified clean

Consolidated from all six personas — things that were specifically checked and found correct. This matters as much as the findings: it bounds the problem.

**Security**
- **No permission over-reach.** Every declared permission has a live call site, including `webRequest` (tab-scoped `xmlhttprequest` observation only, no bodies read).
- **No XSS reachable from page-controlled data.** All 15 `innerHTML`/`outerHTML`/`insertAdjacentHTML` sites read individually; every interpolation of recorded data passes `Utils.escapeHtml`. The only unescaped value is `screenshotData`, a generated `blob:` URL or a data URL gated by `SAFE_DATA_URL_RE`.
- **Message-passing properly bounded.** `background.js:1130` rejects `sender.id !== chrome.runtime.id`; no `externally_connectable`. `getSenderTabId` prefers `sender.tab.id` over the attacker-influenceable `message.tabId`; `addStep` re-verifies the sender tab.
- **No remote code.** CDN fallback removed; libs load via `chrome.runtime.getURL`. No `eval`, no `new Function`, no remote `import()`. Explicit CSP `<meta>` on both extension pages.
- **Filename handling has no traversal.** Export filenames collapse `[^a-z0-9] → _` and are re-filtered before `chrome.downloads.download`; screenshot filenames are UUIDs.
- **Two prior privacy fixes still in place.** `getElementText` no longer returns `element.value` for data-entry inputs (P0-4); auto-screenshots are skipped when the recorded tab isn't visible (FD-1). CSV formula injection is defused.

**Performance**
- **Event listeners are not registered until recording starts** — the single most important thing to get right for an `<all_urls>` content script, and it is correct.
- **All recording listeners share one `AbortController`**, aborted on both stop and restart. No accumulation across start/stop cycles.
- **Read-modify-write on split keys is properly serialized** by `_enqueue`, which keeps the chain alive on rejection. Two concurrent `addStep` calls cannot lose an append.
- **Selector and field-name caches use `WeakMap`** keyed by element — detached nodes are collectable.
- **Recording timers live in the page, not the SW**, so eviction cannot silently stop them, and the heartbeat doubles as a keep-alive. `chrome.alarms` genuinely isn't needed.
- **Assets use per-key storage with an index**, so adding screenshot *n* doesn't rewrite the previous *n−1* — the mistake `_writeSteps` still makes for steps (CONS-57).
- **Search and filter avoid re-rendering** — `applyFilters` toggles a CSS class rather than rebuilding, and the input is debounced.

**UX**
- **The extension's own panel clicks are not recorded as steps.** The subtle case: because panel, modal and toast all live in shadow roots, the document-level capture listener sees the *retargeted* shadow host, whose id matches the `testsnapper-` guard. Handled correctly.
- **Injected UI is genuinely Shadow-DOM-isolated.** All three surfaces `attachShadow`; the modal builds its tree with `createElement` + `textContent`; keyframes are prefixed `testsnapper-` so they can't collide; nothing is appended to `document.head`, so no CSS leaks onto the host page. `z-index: 2147483647` wins outright.
- **Top-frame gate on panel, heartbeat, nav polling and auto-screenshot** — with an explicit comment about ad iframes each spawning their own panel. (The modal escaping this gate is CONS-04; the panel itself is right.)
- **Drag-to-reorder has a real keyboard alternative**, including history and focus restoration — this would otherwise be a clean 2.1.1 failure.
- **Destructive actions are recoverable.** Single-step delete captures assets for undo *before* mutating, offers an inline Undo, and is reachable via Ctrl/Cmd+Z; bulk operations gate on `confirm()`.
- **Recording state is unmistakable with the popup closed, and not conveyed by colour alone** — badge glyph `●`/`❚❚` plus `setTitle`, each carrying state independently of colour.
- **Theme bootstrap avoids the flash of wrong theme** — `theme-init.js` is the first `<script>` in `<head>`, synchronous, reads `localStorage` (not async `chrome.storage`), falls back to `prefers-color-scheme`.
- **Popup tabs implement the full ARIA tabs pattern** with roving `tabindex` and arrow-key navigation; icon-only header buttons carry `aria-label` with `aria-hidden` SVGs.

**Build**
- **The `libs/*` integrity protection works exactly as intended.** `core.autocrlf` is `true` here, which would corrupt the binary bundles, but `git check-attr` confirms `libs/* -text` wins. All three files re-verify against pinned SHA-384, and the fail-closed path is real (throws, deletes the untrusted file, exits 1).
- **CopyPlugin coverage is complete** — 10/10 manifest-referenced paths present in `dist/`, 0 missing; both HTML entry points and all their `import` specifiers resolve.
- **Zero production dependencies.** No `dependencies` key at all; nothing from `node_modules` reaches users except through the first-party `background.js` bundle.
- **No source maps in production**; `grep -c sourceMappingURL dist/…` → 0.
- **Console output is properly funnelled through Logger** — only 14 raw `console.*` across 25 shipped files, all inside Logger implementations.
- **Minification of the copied scripts doesn't break the two hard constraints** — content-script top-level declarations remain `var`, and ES module export names stay unmangled.

**QA — genuinely well-tested areas**
- `recorder-utils.js` (98.2%) — the strongest file in the suite; `shouldCaptureNavigationScreenshot` tested as a real state machine across the full settings matrix.
- `redactor.js` (96.5%) — tested against real jsdom `<input>` elements with actual attributes, not object literals; Luhn tested with valid and invalid numbers.
- `quota-monitor.js` (94.4%) — thresholds, error naming, and listener error *isolation*.
- `compression.js` (89.3%) — real GZIP round-trips through an actual `zlib` polyfill, not a fake.
- `schema-migrator.js` idempotency half — exactly the right property to pin for a one-shot destructive migration.
- **CSV formula injection (CWE-1236)** — a model security regression test, asserting both the positive and the negative across `=`, `+`, `-`, `@` and the leading-tab bypass.
- `privacy-utils.js`, `flush-utils.js`, `step-utils.js` (100% each) with meaningful edge cases.

---

# Contradictions and judgment calls

Where personas disagreed, and how this document resolved it.

1. **Supply chain: "verified clean" vs P1 integrity gap.** Security marked the vendored-lib chain clean; Build filed CONS-15 saying shipped bytes ≠ verified bytes. **Both are right** — they cover different hops. The download-and-pin hop is sound (SHA-384, fail-closed, CRLF-protected). The *emit* hop is not: Terser rewrites the bundles after verification. Kept as P1.

2. **Coverage tooling severity: QA P0 vs Build P2.** QA argued P0 because it means coverage has never been measured; Build argued P2 because `npm test` still works. **Resolved as P0** — not for the tooling itself, but because it's what let 23.9% coverage go unnoticed on a codebase whose two largest files are untested.

3. **Lockfile severity: Build P0 vs Architecture P2.** Build argued the build graph has write access to shipped code with `<all_urls>`; Architecture treated it as hygiene. **Took the higher (P0)** on the supply-chain argument, noting Architecture's framing.

4. **`html2pdf`: P1/P2/P3 across three personas.** Security saw dead attack surface (P3), Build saw 43% package bloat (P2), Architecture saw it alongside the dead `ExportService` import in the SW bundle (P1). **Settled at P1** because Architecture's version is strictly larger — it includes ~1300 LOC of unreachable code parsed on every SW wake.

5. **Panel-hidden bug: UX P0 vs Performance P1.** Performance saw a UI restore failure; UX additionally established that **the recording keeps running invisibly**, capturing everything the user does next. **Took P0** on the UX framing.

6. **One correction to a persona's own claim:** the QA reviewer initially described the suite as "green"; that is true for `npm test` but the coverage command crashes, which is a *different* failure it correctly separated. No contradiction, but worth stating plainly: **`npm test` genuinely passes — 438/438, 0 skipped, no stale snapshots.** The problem is what it doesn't reach, not what it reports.

---

# Suggested fix sequencing

**Wave 1 — unblock the release (small, mechanical, high value)**
1. CONS-01 version single-sourcing + build assertion
2. CONS-14 `output.clean: true`
3. CONS-09 align vitest/coverage-v8 majors
4. CONS-13 commit the lockfile, switch to `npm ci`
5. CONS-20 delete html2pdf + the dead `ExportService` import
6. CONS-18 minimal CI: `npm ci && npm test && npm run build` + version-consistency check

**Wave 2 — stop losing user data** *(each needs its regression test from Wave 4 written alongside)*
7. CONS-03 `try/finally` around screenshot capture + content-side watchdog
8. CONS-02 surface non-`No active session` failures; move `incrementStepCount` after the write; route quota warnings to the content script
9. CONS-04 gate the modal to the top frame
10. CONS-07 downscale at capture time — this is the lever that defuses CONS-05 and CONS-02

**Wave 3 — performance cascade**
11. CONS-05 cache the quota figure; delete the advisory second call
12. CONS-06 key-only orphan sweep, moved onto `chrome.alarms`
13. CONS-35 / CONS-36 batch asset loading; use OffscreenCanvas in window contexts
14. CONS-34 scope selector uniqueness checks
15. CONS-38 minify content scripts; consider on-demand injection

**Wave 4 — make regressions visible**
16. CONS-11 un-stub the quota path (the test that would have caught CONS-02)
17. CONS-41 one shared, faithful chrome mock
18. CONS-10 recovery + content-guard + re-injection tests
19. CONS-39 assert a real DOCX parses; CONS-43 assert redaction end-to-end
20. CONS-40 convert E2E bare `return`s to real skips/assertions

**Wave 5 — accessibility** (CONS-26/27/28/29/30/31 are each small and independent; CONS-26 and CONS-27 together unblock non-visual use of both pages)

**Wave 6 — structural** (CONS-19 dead-vs-shipped settings validation first — it's the cheapest and has a live bug behind it; then CONS-22, CONS-21, CONS-24, CONS-25)

---

# Appendix A — Dependency reality check

Which modules are actually loaded into which runtime context. Produced by the architecture pass; useful when deciding where a shared helper can live.

| Module | Service worker (webpack-bundled) | Extension pages (native ESM) | Content scripts (classic) |
|---|---|---|---|
| `background/background.js` | entry | — | — |
| `core/storage.js` | direct import | transitive (via fs-storage) | — |
| `core/export-service.js` | **imported + instantiated, never called** | direct import | — |
| `core/image-processor.js` | transitive (dead, via export-service) | direct (review) + transitive | — |
| `core/utils.js` | direct (only `generateUUID` used) | direct import | — |
| `core/flush-utils.js` | direct import | transitive | — |
| `core/privacy-utils.js` | direct import | transitive | **mirrored by hand** in `redactor.js` |
| `core/recorder-utils.js` | 2 of 4 exports imported | — | **rule mirrored by hand** in `content.js` |
| `core/compression.js`, `quota-monitor.js`, `schema-migrator.js`, `orphan-cleaner.js` | transitive via storage.js | transitive via storage.js | — |
| `core/fs-storage.js`, `file-sync.js` | **never imported** | direct import | — |
| `core/logger.js` | direct | direct | — |
| `core/step-utils.js` | — | — | — (**orphan: only `tests/ui/review.test.js` imports it**) |
| `content/logger.js` | — | — | manifest entry (classic twin of `core/logger.js`) |
| `content/{selector,field-name-resolver,redactor,content}.js` | — | — | manifest entries, `window.*` globals |
| `ui/theme.js` | — | direct import | — |
| `ui/theme-init.js` | — | classic `<script>` in `<head>` | — |

**Layering notes**
- No import cycles found. `storage.js → orphan-cleaner.js` passes `this` back, a runtime back-reference, not a module cycle.
- Copying `src/core` verbatim to `dist/` *and* bundling it into `background.js` is correct and intentional — pages load core as native ESM.
- **No `core/` module reaches a content script.** Every shared rule they need is hand-mirrored (CONS-46).
- `FSStorageManager`'s entire `_isServiceWorker` half is unreachable — the SW imports `StorageManager` and `flush-utils` directly (CONS-21).
- `ExportService` is instantiated in the SW where it can never work — `_loadDocx()` bails on `typeof document === 'undefined'`, `_exportPDF()` requires `window.jspdf` (CONS-20).
- `ImageProcessor`'s context guard is correct: it picks OffscreenCanvas only in the SW and DOM canvas in windows. (That the *review page* then takes the slow DOM path is CONS-36 — a performance issue, not a layering one.)

# Appendix B — Coverage baseline

`npm test`: **18 files, 438 tests, 0 failed, 0 skipped, 6.16s.** No `it.skip`/`it.only`/`it.todo`, no snapshot tests.

`npx vitest run --coverage`: **crashes** (CONS-09). Numbers below were measured by instrumenting the same 438 tests with a Babel statement probe — a Vite `transform` plugin for ESM sources plus a `Module._extensions['.js']` hook for the three content scripts loaded via `createRequire`. No repo file was modified.

**Project-wide statement coverage: 1226 / 5133 = 23.9%.** Across only files any test loads: 47.5%. **5672 of 13404 src LOC (42.3%) are in files no test ever loads.**

| file | LOC | stmt | hit | cov% |
|---|---:|---:|---:|---:|
| `src/content/content.js` | 1768 | 798 | 0 | **0.0 — never loaded** |
| `src/background/background.js` | 1389 | 578 | 0 | **0.0 — never loaded** |
| `src/ui/review/review-standalone.js` | 1265 | 560 | 0 | **0.0 — never loaded** |
| `src/ui/popup/popup.js` | 1147 | 574 | 0 | **0.0 — never loaded** |
| `src/content/logger.js` | 43 | 12 | 0 | **0.0 — never loaded** |
| `src/ui/theme.js` | 40 | 21 | 0 | **0.0 — never loaded** |
| `src/ui/theme-init.js` | 20 | 7 | 0 | **0.0 — never loaded** |
| `src/core/export-service.js` | 1060 | 392 | 55 | **14.0** |
| `src/core/image-processor.js` | 289 | 133 | 24 | **18.0** |
| `src/content/selector.js` | 1126 | 351 | 114 | **32.5** |
| `src/core/file-sync.js` | 1042 | 331 | 136 | 41.1 |
| `src/core/fs-storage.js` | 1049 | 371 | 166 | 44.7 |
| `src/core/storage.js` | 1198 | 361 | 174 | 48.2 |
| `src/core/utils.js` | 182 | 71 | 53 | 74.6 |
| `src/content/field-name-resolver.js` | 514 | 170 | 131 | 77.1 |
| `src/core/orphan-cleaner.js` | 136 | 55 | 43 | 78.2 |
| `src/core/compression.js` | 168 | 75 | 67 | 89.3 |
| `src/core/schema-migrator.js` | 112 | 42 | 38 | 90.5 |
| `src/core/logger.js` | 51 | 11 | 10 | 90.9 |
| `src/core/quota-monitor.js` | 131 | 36 | 34 | 94.4 |
| `src/content/redactor.js` | 212 | 57 | 55 | 96.5 |
| `src/core/recorder-utils.js` | 225 | 55 | 54 | 98.2 |
| `src/core/privacy-utils.js` | 111 | 39 | 39 | 100.0 |
| `src/core/flush-utils.js` | 81 | 20 | 20 | 100.0 |
| `src/core/step-utils.js` | 45 | 13 | 13 | 100.0 |

**Uncovered methods inside the partially-covered files** (uncovered statements / total):

- **`export-service.js`** — `_exportPDF` 88/88, `_exportDOCXHtml` 84/84, `_buildDocxBlob` 54/54, `exportSession` 28/28, `_resolveExportImageOpts` 17/17, `_loadJsPDF` 13/13, `_docxImageParagraph` 13/13, `_loadDocx` 11/11, `_blobToDataURL` 10/10, `_resolveAssetUrl` 9/9, `_exportDOCX` 8/8 — all 0%.
- **`storage.js`** — `batchDeleteSteps` 18/18, `addAsset` 17/17, `deleteStep` 14/14, `updateStep` 11/11, `getAssetsByStepId` 10/10, `updateAllSteps` 9/9, `batchUpdateSteps` 8/8, `getSession` 7/7, `updateSessionName` 7/7, `init` 6/6, `_writeAsset` 5/5, `_detectImageFormat` 4/4 — all 0%; `_retryOperation` 9/12 uncovered.
- **`selector.js`** — `_addFrameworkSelectors` 36/36, `_addXPathRelative` 31/31, `_addRelativeCssSelectors` 23/23, `_addClassSelectors` 16/16, `_generateAbsoluteXPath` 14/14, `_getLabelText` 13/13, `_getRelativeXPath` 11/11, `_getChildPath` 11/11, `_addTextSelectors` 8/8, `_addNthSelectors` 8/8, `_addAriaSelectors` 7/7, `_addPlaceholderSelectors` 7/7, `extractFieldName` 7/7 — all 0%.
- **`image-processor.js`** — `_processImageDOM` 65/66, `_processImageOffscreen` 31/31, `processForExport` 13/13. The only tested method is `detectContentType`.

Use `statements: 23` as the initial CI threshold (CONS-09) and ratchet from there.

# Traceability index

| Consolidated | Persona finding(s) |
|---|---|
| CONS-01 | BUILD-01, ARCH-01 |
| CONS-02 | PERF-03, UX-01 |
| CONS-03 | UX-02, PERF-05 |
| CONS-04 | UX-03 |
| CONS-05 | PERF-01 |
| CONS-06 | PERF-02 |
| CONS-07 | PERF-04, ARCH-08 (partial) |
| CONS-08 | UX-04 |
| CONS-09 | QA-01, BUILD-08 |
| CONS-10 | QA-02, QA-03, QA-10 |
| CONS-11 | QA-05 |
| CONS-12 | QA-04 |
| CONS-13 | BUILD-02, ARCH-16 |
| CONS-14…18 | BUILD-03, 04, 05, 07, 06 + QA-17 |
| CONS-19…25 | ARCH-02, 06, 03, 04, 05, 07, 08 |
| CONS-26…31 | UX-05, 06, 07, 08, 09, 10 |
| CONS-32…33 | SEC-01, SEC-02 |
| CONS-34…38 | PERF-06, 07, 08, 09, 10 |
| CONS-39…44 | QA-06, 07, 08, 09, 12, 11 |
| CONS-45…51 | ARCH-13, 14, 09, 10, 11, 12, 15 |
| CONS-52…54 | SEC-05, 03, 04 |
| CONS-55…60 | PERF-11, 12, 13, 14, 15, 16 |
| CONS-61…64 | BUILD-10, 11, 12, 13 |
| CONS-65…67 | QA-14, 15, 16 |
| CONS-68…76 | UX-12, 13, 11, 14, 15, 16, 17, 18, 19 |
| CONS-77…78 | SEC-07, SEC-08 |
| CONS-79…81 | PERF-17, 18, 19 |
| CONS-82…83 | QA-18 + ARCH-17, QA-13 |
| CONS-84…87 | ARCH-18, BUILD-16, 15, 14 |
| CONS-88…91 | UX-20, 21, 22, ARCH-17 |
