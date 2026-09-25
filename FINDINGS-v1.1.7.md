# TestSnapper v1.1.7 — Consolidated Review Findings

**Date:** 2026-09-05 · **Branch:** `V1.1.7` (`5d35132`) · **Scope:** `src/` (13.4k LOC, 41 files)

This branch is a byte-for-byte sync of the package **currently published** to the Chrome Web Store
(item `bmfadpkojaocmadfomifleaghfnipala`). Every finding below therefore describes **live user-facing
behaviour**, not a development branch.

## Method

Seven reviewer personas audited the tree in parallel, each briefed with the earlier `FINDINGS.md`
(commit `f4cfd07`) as prior art and instructed to report only *new* findings plus verification of
which old ones survive here. All seven completed.

| Persona | Status |
|---|---|
| Bug hunter (runtime correctness) | complete |
| Product strategist / competitive | complete |
| Visual UI design | complete |
| UX and first-run | complete |
| Chrome Web Store compliance and privacy | complete |
| QA engineer — output quality | complete |
| Accessibility (WCAG 2.2 AA) | complete |

**Verification status is marked per finding.** `[VERIFIED]` means the consolidator independently
confirmed it against the source. `[REPORTED]` means it rests on the persona's own reading.

---

## Resolution status

Fixes landed on `fix/v1.1.7-findings` (3 commits off `V1.1.7`). 438 tests pass, build clean.

| Group | Fixed | Partial | Open |
|---|---|---|---|
| **P0** | P0-1 · P0-2 · P0-3 · P0-4 · P0-5 · P0-6 | — | — |
| **P1** | P1-1 … P1-9 (all) | — | — |
| **P2** | P2-2 · P2-3 · P2-5 · P2-7 · P2-8 · P2-11 · P2-12 | — | P2-1 · P2-4 · P2-6 · P2-9 · P2-10 |
| **Output quality** | Q-3 · Q-4 · Q-5 · Q-6 | Q-1 · Q-7 · Q-8 | Q-2 (decision) · Q-9 · Q-10 |
| **Accessibility** | A-1 … A-10 (all) | — | — |

**Partials — what was and was not done:**

- **Q-1** — checkbox/radio `change` capture restored (keyboard and programmatic toggles were
  invisible). Still missing: `keydown` (Enter/Tab/Escape), `contextmenu`, drag, scroll, hover.
  Those need new listeners and new step types, not a fix to an existing one.
- **Q-7** — acronyms preserved and ACRONYM+Word splitting added, so `SSN`, `IBAN`, `VAT ID` and
  `customerPONumber` survive. Untouched: placeholder outranking the real field name, and
  `GENERIC_NAMES` rejecting serviceable names like `email`.
- **Q-8** — `autocomplete` is now consulted, and card/CVC/birth-date naming gaps are closed. Still
  leaking: personal names and postal addresses (no pattern at any layer), unformatted `123456789`
  and `5551234567`, and 19-digit card numbers.

**Open items and why they were left:**

| Finding | Reason |
|---|---|
| P2-1 stylesheet consolidation | ~2,600 → ~700 lines with 292 `!important` to unwind; a refactor with real regression risk, not a defect fix |
| P2-4 step-card metadata | New UI surface — needs a design decision about what to show and what to make editable |
| P2-6 `.docx` → `.doc` fallback | Conditional and cosmetic; only fires when the bundled `docx` library fails to load |
| P2-9 jsPDF 2.5.1 → 4.x | Two majors; needs PDF-export regression testing and a new SRI pin |
| P2-10 permission restructuring | `optional_permissions` + `registerContentScripts` is an architecture change affecting the install flow |
| Q-2 repeated-click collapse | **A product decision, not a bug.** `tests/background/recorder-utils.test.js` explicitly asserts the current behaviour; documented in place at `recorder-utils.js` rather than flipped silently |
| Q-9 / Q-10 export-format changes | DOCX screenshot placement, CSV numbering, and the JSON schema are output-format decisions |

---

## Executive summary

The published build has **three separate paths that destroy a user's recording**, and in each one the
UI reports success or shows a live recording indicator while the data is already gone. That is the
dominant theme and it outranks everything else here.

A second theme is that **the product's own documentation now describes a different product**. The
pivot from selector/codegen output to documentation output was made deliberately in code — four
separate comments say so — but the manifest description, README, and published privacy policy were
never updated. One of those stale documents ships *inside* the store package and asserts a behaviour
Manifest V3 forbids.

Third, the visual layer is **two complete design systems stacked on each other**, with a 190-line
override block trying to bury a 1,600-line one via 292 `!important` declarations. The burial is
theme-asymmetric, so the default light theme still renders brutalist notched corners next to rounded
cards.

The engineering underneath is not bad. The Shadow DOM isolation is correct, there is zero network
egress, `core/` really was decomposed as CLAUDE.md claims, and the split-key storage design is sound.
The problems are concentrated in lifecycle edge cases, unfinished migrations, and paperwork.

Fourth, the extension **does not meet WCAG 2.2 Level A**, let alone AA. There are zero live regions
and zero `for=` attributes in the entire UI, so a screen-reader user gets no confirmation that
recording started and hears "blank" for every form control.

**Release verdict:** do not re-upload this tree. Fix the P0 set first. Note separately that version
1.1.7 is already consumed in the store, so any re-upload needs 1.1.8+.

### If you fix only five things

1. **P0-1** — stop `autoSave: false` from silently deleting recordings while reporting success
2. **P0-6** — run `fieldName` through `maskGenericPII`; it is a live PII leak into every export
3. **A-5** — delete the 30-second modal timeout (one line; it destroys user data)
4. **A-1** — add two live regions (~1 hour; converts three opaque surfaces into usable ones)
5. **P0-4** — delete the CDN paragraphs from `libs/README.md` and stop packaging it

Items 3 and 5 are single-line deletions. Item 4 is an hour. None of the five is hard.

---

## P0 — Data loss and policy blockers

### P0-1 · "Auto-save Sessions" off silently deletes the recording, and the UI says "Recording stopped!" `[VERIFIED]`

`background.js:951-957`, `popup.html:262`, `popup.js:452`

```js
const settings = await settingsManager.get();
if (settings.autoSave === false) {
  await storage.clearSession(sessionId);          // the entire recording
  broadcastSessionChange(sessionId, 'deleted');
  return { success: true, sessionId, discarded: true };
}
```

The checkbox is labelled only *"Auto-save Sessions"* with no help text. Every natural reading is
"save automatically vs. save manually" — but there is no manual save. `handleStop` checks only
`response.success`, so the user sees **"Recording stopped!"** for a recording that no longer exists.
The review tab then loads and throws "Session not found".

**Fix:** rename to *"Keep recordings after stopping"* with the consequence spelled out, default it
safe, and confirm at Stop naming the step count. Better: delete the setting.

### P0-2 · Second tab shows a live RECORDING panel while every step in it is discarded `[VERIFIED]`

`content.js:1731-1741`, `background.js:1024-1027`

`FUNC-002` rejects steps whose sender tab differs from the recorded tab (`error: 'Wrong tab'`), but
any page loading during an active session calls `getState`, receives a session, and mounts the panel
with a running timer. The content script's response handler acts only on `'No active session'`, so
the rejection is swallowed.

Opening a link in a new tab — routine in the QA flows this product targets — produces a red pulsing
recording indicator over work that is being thrown away.

**Fix:** compare `response.session.tabId` to the current tab in the restore path; mount an inert
"recording is in another tab" state and skip listener attachment. Surface `'Wrong tab'` as a toast.

### P0-3 · Closing the recorded tab makes Stop throw — session never flushed, review never opens `[VERIFIED]`

`background.js:938`

```js
await persistActiveRecording();
await BadgeManager.clear(tabId);     // rejects: "No tab with id: N."
ApiCapture.stop();
// ...
if (sessionId) { await addPendingFlush(sessionId); }   // never reached
await chrome.tabs.create({ url: reviewUrl });          // never reached
```

Unwrapped. For a filesystem-backed user the session is **never written to disk**; `maxSessions`
pruning is skipped and `webRequest` listeners stay attached. The same shape hits `pauseRecording`
(`:888`) and `resumeRecording` (`:904`), where state is already mutated and persisted before the
badge call — so the popup reports "Pause failed" while the background is genuinely paused.

**Fix:** `.catch(() => {})` every `BadgeManager.*` call; add a `chrome.tabs.onRemoved` listener that
finalizes the session when the recorded tab dies.

### P0-4 · Package ships a document asserting remote code loading `[VERIFIED]`

`libs/README.md:43-47` (present in the published CRX)

> "The extension has built-in CDN fallback: if local library files are not found, the extension will
> attempt to load from CDN."

**The code is clean** — loading is `chrome.runtime.getURL` only, both pages carry `script-src 'self'`,
and there is no `eval`, `new Function`, or dynamic `import()` anywhere in `src/`. But a reviewer
grepping the uploaded package for "CDN" finds a first-party file asserting exactly what MV3's
Remote Hosted Code policy forbids. `README.md:460` repeats the claim.

**Fix:** delete the section; exclude `libs/README.md` from the packaged output (`webpack.config.js:84`
copies `libs` wholesale). Cheapest high-value fix in this report.

### P0-5 · Published privacy policy overstates a privacy control `[VERIFIED]`

`PRIVACY_POLICY.md:23` vs `background.js:592`

The policy promises the sensitive-field guard covers *"automatic and manual"* screenshot capture. The
code is `if (!isManual)`. Both manual entry points (`background.js:1497` keyboard, `content.js:1543`
panel) pass `isManual = true`, and the manual path force-activates and focuses the tab before
capturing. Pressing `Ctrl+Shift+S` over a focused password field stores the credential form as pixels,
contrary to a written promise.

This is the **SEC-002 revert** surfacing at the policy level. The fix exists on
`fix/v1.1.6-parallel-fixes`.

**Fix:** cherry-pick SEC-002, or correct the policy. Do not leave the promise unbacked — a stated
control induces reliance.

### P0-6 · `fieldName` is never sanitized, and arbitrary page text is lifted into it `[VERIFIED]`

`background.js:22-33`, `field-name-resolver.js:349-390`

```js
function sanitizeStepForStorage(step) {
  if (typeof step.url === 'string') step.url = sanitizeUrl(step.url);
  // ... value handled ...
  if (typeof step.targetLabel === 'string') step.targetLabel = maskGenericPII(step.targetLabel);
  return step;                        // fieldName never touched
}
```

The storage backstop masks `url`, `value` and `targetLabel` — and skips `fieldName`. Meanwhile
`_fromProximityText` and `_fromElementText` lift arbitrary nearby page text *into* `fieldName`. Page
chrome reading "Signed in as jane.doe@acme.com" becomes the field name of a nearby unlabeled control
and is exported verbatim in **every** format.

This is the cleanest provable PII leak in the codebase, and it defeats the redaction layer by routing
around it rather than failing it.

**Fix:** run `fieldName` through `maskGenericPII` in `sanitizeStepForStorage`; cap proximity-derived
names and prefer returning `null` (which triggers the manual-entry prompt) over a confident guess.

---

## P1 — Correctness

### P1-1 · Undo reverts two operations and persists the wrong state `[VERIFIED]`

`review-standalone.js:446-457`, `:483-486`

`saveToHistory` snapshots *before* mutating and sets `historyIndex = history.length - 1`, so
`history[historyIndex]` is already the correct one-step-back state. `undo()` then calls
`restoreFromHistory(historyIndex - 1)` — one further back.

Delete step 3, delete step 5, press Undo → **both deletions revert**, and `restoreFromHistory`
immediately calls `storage.updateAllSteps()`, writing the wrong state to disk. The first undo looks
correct only because `history[0]` and `history[1]` are duplicates. The redo tail is never truncated,
so later undos walk stale branches.

**Fix:** `restoreFromHistory(historyIndex)` after pushing current state; truncate
`history.length = historyIndex + 1` before each push.

### P1-2 · Iframe capture is armed once and never re-armed after navigation `[VERIFIED]`

`content.js:1160-1164` vs `content.js:1717-1722`

Two comments in one file directly contradict each other:

- `:1160` (FD-2) — *"event capture **must run in every frame** (clicks inside iframes are only visible to the iframe's own listeners)"*
- `:1717` — *"Gate auto-restore to the top frame only — **iframes must not capture events**"*

`_finishStartRecording` attaches the four capture listeners *before* its own top-frame gate, so
sub-frames present at Record time do capture. But the load-time restore path returns early in any
sub-frame, and there is no per-navigation re-broadcast (no `tabs.onUpdated`/`webNavigation` listener
in `src/`). After the first navigation, **every click and keystroke inside any iframe is silently
dropped** while the top-frame panel keeps showing RECORDING. Same for lazy-loaded iframes.

**Fix:** decide which comment is the intent. If iframes should capture, run the listener-attach half
of `_finishStartRecording` in the sub-frame restore path and keep only panel/heartbeat/nav-poll/
auto-screenshot behind the top-frame gate.

### P1-3 · Message listener registered outside the re-injection guard `[VERIFIED]`

`content.js:1600` (column 0; the guard opens at `:46`)

The `var`-at-top-level convention in CLAUDE.md protects the *state* variables; the listener
registration is not inside the guard. The manifest injects the five content scripts statically at
`document_end` **and** `background.js:846` injects them programmatically when the `ping` fails.

Press Record while the page is still loading → ping fails → programmatic inject → `document_end`
fires → manifest injects again. State survives, but a **second message listener** is now registered.
On the next screenshot both run `beforeScreenshot`; the second pass records the already-hidden
`display: 'none'` as the "original" and overwrites `window.__testSnapperHiddenEls`. `afterScreenshot`
restores `display: none`. **The floating panel is gone for the rest of the session** — no Stop, no
Pause — while recording continues invisibly.

**Fix:** move the `addListener` inside the guard, and make `beforeScreenshot` bail when
`__testSnapperHiddenEls` is non-empty.

### P1-4 · Orphan sweep can delete a freshly created session's keys `[REPORTED]`

`background.js:305`, `orphan-cleaner.js:79-121`

`storage.init()` is fire-and-forget at service-worker module scope, and neither `cleanupOrphans` nor
`SchemaMigrator` goes through `_enqueue` — so the write-queue mutex protecting `createSession`/
`addStep` gives no protection. Phase 1 reads every asset of every session (hundreds of MB), making
the window between the `liveSessionIds` snapshot and the `remove()` seconds wide.

If the 7-day gate trips on the cold start caused by clicking Record, `createSession` writes its keys
after the snapshot, phase 2 finds them absent from `liveSessionIds`, and removes them along with
every asset written meanwhile.

**Fix:** re-read the session index immediately before the phase-2 diff; run through `storage._enqueue`;
move off the startup path onto `chrome.alarms`.

### P1-5 · Failed start leaves a red RECORDING badge and an orphan session `[REPORTED]`

`background.js:826-875`

The catch at `:870` resets state but never calls `BadgeManager.clear` or `clearSession`. Recording a
`file://` page without "Allow access to file URLs" throws at `:846`; the popup says "Failed to start"
while the tab keeps a red badge indefinitely and an empty session row persists in
`testsnapper_sessions`, counting against `maxSessions`.

### P1-6 · Live step cache diverges from disk on a failed write `[REPORTED]`

`storage.js:159-163`, `:896-903`, `:977-982`

`_readSteps` returns the cached array **by reference**; `addStep` and `updateStep` mutate it before
`_writeSteps` may reject. At quota exhaustion the write fails but `getSteps()` returns the polluted
cache, so the popup and review page show steps that were never persisted. They vanish on the next
service-worker restart.

**Fix:** return `.slice()`, or roll back in a `catch` before rethrowing.

### P1-7 · `webRequest` API capture dies after ~30s idle and never recovers `[REPORTED]`

`background.js:718-745`, `:400-440`

Listeners registered at runtime are not persisted across MV3 worker termination, and the recovery
block restores state, badge, and content scripts but never calls `ApiCapture.start()`. With API
capture enabled, reading a page for 30 seconds permanently ends API capture for that session, silently.

### P1-8 · Export progress ring renders black — invisible in dark mode `[VERIFIED]`

`review-standalone.html:203`, `review-standalone.js:618`

`stroke="var(--primary)"` — and `--primary` is **defined nowhere** (0 definitions, 2 usages). An
invalid `var()` on a presentation attribute is invalid-at-computed-value-time, so `stroke` falls back
to black. On the dark modal card (`#0f1216`) the only progress indicator during a long export is
invisible.

**Fix:** `var(--accent)` in both places.

### P1-9 · Export looks hung, cannot be cancelled, and can be started twice `[REPORTED]`

`review-standalone.js:1125-1159`, `popup.js:488-511`

Three compounding failures: `showProgressModal()` is **defined and never called**, so the entire
progress modal with its ring and Cancel button is dead UI; actual feedback is a toast that
auto-dismisses after 5s, leaving a silent page for minutes; and `saveExportBtn` is never disabled, so
clicking again launches a second concurrent export. The popup path additionally reads `pct` as a
number while the service emits `{percent, status}` (CONS-23, still unfixed), showing a frozen
`Exporting…` throughout.

---

## P2 — Quality, UI, and hygiene

### P2-1 · The stylesheet is two designs fighting, and light mode lost `[VERIFIED]`

292 `!important` occurrences (popup 206, review 86)

A ~1,600-line brutalist system (clip-path notches, neon glows, scanlines, uppercase mono) is buried
under a ~190-line "Soft Cards v4" block. The reset `[data-theme="dark"] * { clip-path: none }` is
**dark-only**, so in the default light theme `.message`, `.step-item`, `.modal-card` and the delete
button still render notched corners inside 12px-rounded cards. Roughly 113 `font-family` /
`letter-spacing` / `text-transform` declarations are neutralized but not deleted, `.radio-label` is
authored three times, and 30 lines style a `.screenshot-overlay-btn` that exists nowhere.

**Fix:** promote the reset to unthemed, then delete the dead half rather than growing the override layer.

### P2-2 · Nine infinite animations still run, including a jittering "Recording" label `[REPORTED]`

`popup.css:1527-1551`, `review-standalone.css:1288-1296`, `:1313-1321`

`glitchText` translates the `#stateText` element ±2px every 5s — the single most important word in the
product physically twitches, in both themes. `.step-number-badge` runs `badgePulse` infinitely on
`box-shadow`, the most expensive property to animate: a 200-step session is 200 simultaneous infinite
animations. There are **zero** `prefers-reduced-motion` blocks repo-wide.

### P2-3 · Review page does not survive a large session `[REPORTED]`

`review-standalone.css:821-825`

`.screenshot-container img { width: 100% }` with no `max-height`; `object-fit: contain` does nothing
in an unconstrained box. Each card runs ~550px tall, so a 200-step session is roughly **110,000px of
scroll**. Capping at 260px with click-to-expand brings it to ~40,000px.

### P2-4 · Step cards show none of what was captured `[REPORTED]`

`review-standalone.js:596-651`

Each card renders a badge, drag handle, checkbox, one description textarea, screenshot, and delete.
The action type, field name, value, URL and selector are all stored and rendered **nowhere** — while
`#actionFilter` offers eight action types to filter by, so filtering to "Navigate" looks identical to
filtering to "Click". README claims inline editing of "field names, values, selectors, notes"; none of
the four is editable.

### P2-5 · Filled buttons fail AA in both themes `[REPORTED]`

`popup.css:1704`, `review-standalone.css:1389`

White on `--accent` = **4.26:1** light, **3.34:1** dark, at 11–12px (4.5:1 required). White on danger =
3.33:1 dark. Delete-button hover = 3.03:1. Step badge = 3.78:1. An `--accent-contrast` token that fixed
this was **deleted** by the v4 rewrite — `grep` now returns nothing. Separately,
`.btn-secondary/.btn-warning/.btn-success/.btn-info` all collapse to one identical grey, so Pause and
Resume are visually indistinguishable and Save Settings is grey.

### P2-6 · `.docx` picker can silently emit `.doc` `[VERIFIED — narrower than first reported]`

`export-service.js:451-462`, `:838`

`_exportDOCX` tries the bundled `docx` library first and emits real OOXML at `:575`. Only when
`_loadDocx()` fails or the build throws does it fall through to `_exportDOCXHtml` and its `.doc`
filename with an HTML payload. A real mismatch, but conditional — not the unconditional bug first
reported.

### P2-7 · 906 KB of dead vendor code ships to every user `[VERIFIED]`

`libs/html2pdf.bundle.min.js` — `grep -rn "html2pdf" src/` returns **0**. ~25% of package weight, for
nothing. (CONS-20, still unfixed.)

### P2-8 · MIT attribution is not satisfied for two of three bundles `[REPORTED]`

`dist/libs/docx.min.js.LICENSE.txt` (63 bytes) and `html2pdf.bundle.min.js.LICENSE.txt` (77 bytes) are
self-referential stubs pointing at files that do not exist in the package. Neither reproduces a
copyright notice. jsPDF's 16 KB notice is correct.

### P2-9 · jsPDF 2.5.1 is four years old and carries a reachable advisory `[REPORTED]`

CVE-2025-29907 (ReDoS via `addImage`/`html`), fixed in 3.0.1. `addImage` is reached at
`export-service.js:1002`. Input is a self-generated data URL, so practical exploitability is low — but
any SCA scan flags it.

### P2-10 · Standing permissions for default-off features `[REPORTED]`

`manifest.json` vs `background.js:165-172`

`webRequest` is declared unconditionally while `captureApiCalls` defaults `false` — a reviewer
exercising the extension never observes it firing, the textbook profile for a "requests a permission
it does not need" rejection. Likewise the static `content_scripts` block matches `<all_urls>` +
`file:///*` with `all_frames: true`, parsing ~126 KB in every frame of every page whether recording or
not — even though `chrome.scripting.executeScript` already injects the identical list on demand at
`background.js:382` and `:843`.

### P2-11 · `pendingInputs` leaks DOM nodes on two paths `[REPORTED]`

`content.js:892-917` — the Map is keyed by element object, and the duplicate-input and
skipped-modal early returns never delete. Nodes removed by SPA re-renders can never be collected.

### P2-12 · Lowering "Max Sessions to Keep" silently deletes the excess `[REPORTED]`

`background.js:962-977` — every Stop prunes oldest sessions with only a `Logger.warn`. Dropping the
setting from 100 to 10 destroys 90 sessions at the next Stop, no prompt, no undo. The label reads as a
retention hint, not a delete trigger.

---

## Output quality — is the artifact worth having?

Assessed from the position of the target user: a QA engineer deciding whether to attach this to a
ticket. Verdict: **usable as a bug-report attachment, not as a test artifact.** The DOCX/PDF with
inline screenshots is a decent "here's what I clicked", and API-call capture (`background.js:768-793`)
is a real differentiator most recorders lack. But everything that would serve an automation engineer
is either never captured or captured and discarded.

### Q-1 · Only four event listeners exist `[VERIFIED]`

`content.js:1151-1154` — `click`, `input`, `change`, `submit`. That is the whole capture surface.

| Interaction | Captured | Consequence |
|---|---|---|
| Keydown / Enter outside a form | **No** | "Type search term, press Enter" records the typing and nothing else |
| Right-click / context menu | **No** | Context-menu flows invisible |
| Hover / mega-menu | **No** | Hover-revealed menus appear as a click on something that "wasn't there" |
| Drag and drop, slider drag | **No** | Kanban, file-drop, range-slider flows unrecordable |
| Scroll / lazy-load trigger | **No** | The step that caused content to appear is missing |
| Checkbox/radio set programmatically | **No** | `content.js:944-947` returns early; "Select all" vanishes |
| File upload | Mislabeled | Falls to `else` → `action: 'type'`, value `C:\fakepath\invoice.pdf` |
| Rich-text editor | **Empty + flagged sensitive** | `element.value` is `undefined` → masked to `''` → `isSensitive` true |
| New tab / OAuth leg | **No** | See P0-2 |
| Repeated identical click | **2nd+ dropped** | See Q-2 |

### Q-2 · Repeated identical clicks are silently collapsed `[REPORTED]`

`background.js:1038`, `recorder-utils.js:44-52` — clicks carry `value: null`, so identical
action + fieldName + url dedups. Clicking "Next page" three times records **one** step. Pagination,
quantity steppers, and repeated-add flows are all misreported.

### Q-3 · The click target is never normalized to the interactive ancestor `[VERIFIED]`

`content.js:742` — no `closest()` in `handleClick` (the only two `closest()` calls in the file are for
label resolution at `:173` and the panel's own drag guard at `:1482`).

Clicking the icon inside `<button data-testid="save-btn"><svg><path/></svg></button>` makes
`event.target` the `<path>`: no id, no name, no testid, `className.baseVal === ''`. Every attribute
strategy contributes nothing and the winner is an absolute XPath. The perfectly good
`[data-testid="save-btn"]` one node up is never considered. This is the most common click shape in
any icon-button design system.

**Fix:** one line — `event.target.closest('button, a, [role=button], [role=link], label, input, select, textarea, [tabindex]') || event.target`.

### Q-4 · Absolute XPath is awarded a free uniqueness bonus and wins by default `[VERIFIED]`

`selector.js:640-648`, scored at `:903-906`

```js
candidates.push({
  selector: xpath,
  type: 'xpath-absolute',
  isUnique: true,        // unconditional
  isStable: false,       // read by nothing
});
```

`isUnique` is worth `+100`. So the most brittle possible locator scores 110, while candidates honest
about not being unique (`multi-class` 40, `nth-of-type` 25, semantic XPath 48) lose to it. For any
element without a unique attribute, the top-ranked selector is a positional absolute XPath —
presented with no fragility signal, because `isStable` is never read.

### Q-5 · `STATE_CLASS_RE` is unanchored and deletes ordinary semantic classes `[VERIFIED]`

`selector.js:520`

```js
const STATE_CLASS_RE = /(ng-|is-|has-|active|selected|focus|hover|disabled)/i;
```

Unanchored substring matching. `ng-` matches *inside* **booki`ng-`form**, **prici`ng-`card**,
**rati`ng-`stars**, **shippi`ng-`address**, **listi`ng-`item**. `active` matches inside
`interactive-card`. Those classes are stripped from consideration, `classes.length === 0`, and the
strategy falls through to XPath.

**Fix:** anchor it — `/^(ng-|is-|has-)|^(active|selected|focus|hover|disabled)$/`.

### Q-6 · The generated-ID detector accepts the two ID schemes that churn most `[REPORTED]`

`selector.js:257-278` — `radix-:r7:` and `mat-input-3` match none of the eleven patterns, so both
score the engine's maximum of 200. `#radix-\:r7\:` is dead on the next mount. `headlessui-*`,
`downshift-*` and `rc_select_*` fail the same way. Worse, the meaningful-prefix allowlist returns
early at `:262-264` *before* any hash pattern is tested, so `id="input-a1b2c3d4e5f6"` is classified
as human-authored.

`field-name-resolver.js:36-53` already catches all of these. Two divergent definitions of "generated"
ship side by side: the field-name layer refuses to name a field "Radix R7" while the selector layer
happily builds `#radix-:r7:` as its top pick.

### Q-7 · Field names are mangled and over-eager `[REPORTED]`

- **Acronyms destroyed** by `_cleanFieldName` (`field-name-resolver.js:479`, duplicated at
  `selector.js:999`): SSN→**Ssn**, IBAN→**Iban**, VAT ID→**Vat Id**, DOB→**Dob**, `customerPONumber`→**Customer Ponumber**
- **Placeholder outranks the real name**: `<input name="workEmail" placeholder="you@company.com">`
  is named **"You@company.com"**
- **`GENERIC_NAMES` (`:25-33`) rejects the best available name** — `email`, `password`, `date`,
  `search` are blocklisted, so a perfectly serviceable `name="email"` falls through to proximity garbage
- **Proximity text nearly always returns something**, so the manual-entry escape hatch rarely fires
  and bad auto-names silently win

### Q-8 · Redaction gaps that leak in production use `[REPORTED]`

Beyond P0-6: **split card entry** (four `maxlength="4"` boxes) never forms a 13-16 digit run, so the
Luhn gate never fires and all sixteen digits export across four steps; `sensitivePatterns` has
`/credit[_-]?card/i` but not `cardnumber` or `cc-number`; **`autocomplete` is never consulted**
(`redactor.js:97-104`) despite `cc-number`/`cc-csc`/`current-password` being the most reliable signal
in HTML; `/cvv/i` misses `cvc`/`csc`/`securityCode`; unformatted `123456789` and `5551234567` match
nothing; `<input type="date">` yields `1985-03-14`, matching no DOB pattern; and **names and postal
addresses have no pattern at any layer** — by volume the most common customer PII in any business app.

### Q-9 · Export-format specifics `[REPORTED]`

- **DOCX exiles automated screenshots into an appendix** (`export-service.js:553-566`), divorced from
  the steps that produced them. Only manual screenshots stay inline — so the auto-capture feature
  yields context-free images captioned with a time. URLs appear nowhere in the DOCX.
- **CSV filters screenshot steps out** (`:344`), so its numbering silently diverges from the
  DOCX/PDF numbering of the same session.
- **JSON has no selector, no screenshot reference, no element metadata, no frame identity** — there is
  no path from it to Playwright or Selenium beyond guessing `getByLabel("Ssn")`.
- **PDF is the best artifact here** — screenshots inline next to their own step via
  `assetIndex.get(step.id)` (`:979`), URLs under each step. Strictly better ordering than the DOCX.
- **Markdown HTML-escapes the session name** (`:383`), so "Login & Checkout" renders as
  `Login &amp; Checkout` in the `.md`.

### Q-10 · The schema lies about its own shape `[REPORTED]`

`selector.css` frequently holds an XPath string (the absolute-XPath fallback above), so any downstream
consumer doing `page.locator(step.selector.css)` breaks. Moot today because the field is stripped
before export — but it must be fixed before restoring it.

---

## Accessibility — WCAG 2.2

**Verdict: does not meet Level AA. Does not meet Level A either.**

There is real competence here — the popup tablist is a correct ARIA APG roving-tabindex
implementation, the injected field-name modal has `role`/`aria-modal`/`aria-labelledby` and restores
focus, and the Add Step modal has a working focus trap. The failures cluster in status messaging,
focus visibility, and the pointer-alternative gap.

### A-1 · Zero live regions — every status message is silent `[VERIFIED]` · 4.1.3 (AA)

`grep -rn "aria-live|role=\"status\"|role=\"alert\"" src/` returns **0**.

Silent: "Recording started/paused/stopped", export progress 0→100%, the storage-quota warning, the
sensitive-field screenshot refusal, validation errors, and "Deleted 4 steps — **Undo**". A
screen-reader user pressing Start has no way to know whether recording began; they Shift+Tab back to
re-read the state indicator to check.

**Fix:** `role="status" aria-live="polite"` on `#message` in both pages, plus one visually-hidden
`role="alert"` region per page for errors. ~1 hour, and the highest-leverage change in this audit.

### A-2 · No programmatic labels anywhere `[VERIFIED]` · 1.3.1, 3.3.2 (A)

`grep -c 'for='` returns **0** in both `popup.html` and `review-standalone.html`.

Every text input, `<select>`, datetime field, search box and the export-format radio group is
announced "blank". The format radios additionally have no `<fieldset>`/`<legend>` or
`role="radiogroup"`, so the group has no accessible name. **Voice-control users cannot address any of
these controls by name at all** — a constituency the prior review never covered.

### A-3 · Drag-to-reorder has no pointer alternative `[REPORTED]` · 2.5.7 (AA), 2.1.1

`review-standalone.js:609-611`, `:1014-1058`

The only pointer path to reorder steps is `dragstart` → `dragover` → `drop`. There is an undocumented
ArrowUp/Down handler, but **2.5.7 requires a single-pointer alternative specifically** — keyboard does
not discharge it. A mouse, touch, or head-pointer user who cannot drag has no way to reorder. The
injected panel's reposition drag fails the same criterion (`mousedown`/`mousemove` only, no
`touchstart` at all).

**Fix:** add Move up / Move down buttons, extract `moveStep(stepId, delta)`, and route drag, arrows
and buttons through the one path.

### A-4 · The keyboard reorder is index-broken under any filter `[VERIFIED]` · 2.4.3 (A)

`review-standalone.js:756`, `:768-771`

```js
const currentIndex = stepsData.findIndex(s => s.id === stepId);   // index into the FULL list
// ...
setTimeout(() => {
  const handles = document.querySelectorAll('.step-handle');       // only VISIBLE cards
  if (handles[targetIndex]) handles[targetIndex].focus();
}, 50);
```

`targetIndex` indexes `stepsData` while `handles` indexes the filtered DOM. With any search term or
action filter active, focus lands on an unrelated step or drops to `<body>`. The move itself swaps
against hidden neighbours, so the visible order appears not to change. Nothing is announced either way.

**Fix:** re-query by `data-step-id`, never by index; drop the 50 ms `setTimeout` race.

### A-5 · The field-name modal self-destructs after 30 s and discards the step `[VERIFIED]` · 2.2.1 (A)

`content.js:573-578`

```js
state.timeout = setTimeout(function() {
  var typedValue = input ? input.value.trim() : '';
  closeWithRestore(typedValue || null);          // null => step is dropped
}, 30000);
```

The timer resets only on `input` events. A screen-reader user browsing the dialog with the virtual
cursor fires none, so it expires mid-read — the dialog vanishes, the step is discarded, and neither
fact is announced. No warning, no extend, no way to disable.

This is the most severe A-level failure in the codebase because it disproportionately hits slower
users, and it is a **one-line deletion** to fix. Two more 2.2.1 fails compound it: the Undo
affordance expires after 6 s (`review-standalone.js:1191`) and every toast after 3 s
(`popup.js:982`) — including validation errors.

### A-6 · Focus indicators destroyed by the stylesheet's own override `[REPORTED]` · 2.4.7 (AA)

`review-standalone.css:1419-1421`, `popup.css:1724` — `outline: none !important` beats the **correct**
`*:focus-visible` ring that already exists at `review-standalone.css:1187-1194`. The replacement glow
measures ~1.07:1. Step checkboxes and the export-format chips end up with no indicator at all; the
chips draw their ring around a 1×1px hidden radio. (CONS-29, reproduced by the v4 rewrite.)

### A-7 · The export progress modal is not a dialog `[VERIFIED]` · 4.1.2, 2.4.3, 2.1.2 (A)

`review-standalone.html:198`, `review-standalone.js:238`

```html
<div class="modal-overlay" id="progressModal">
  <div class="modal-card" style="max-width: 400px; text-align: center;">
```

No `role="dialog"`, no `aria-modal`, no `aria-labelledby`. Focus never enters — it stays on
`#saveExportBtn` behind the scrim. Escape is scoped `if (e.key === 'Escape' && addStepModal.classList.contains('active'))`,
so it does nothing during export. The background is never `inert`, so Tab walks every step textarea
underneath the overlay. **This is the product's terminal action, and it is not keyboard operable.**
The working pattern already exists twenty lines below in `#addStepModal`.

### A-8 · Modal focus trap leaks during a 100 ms delay `[REPORTED]` · 2.1.2 (A)

`content.js:556`, `:560`, `:595` — the trap is bound to `overlayDiv` rather than `document`, and focus
is set via `setTimeout(..., 100)`. A fast Tab during that window escapes into host content and the
trap never fires again, leaving the dialog unreachable while it still blocks capture
(`isModalOpen` gates every handler). Escape is bound only to the input, so tabbing to Skip disarms it.
The host page is never `inert`, so a virtual cursor browses straight through the dialog.

### A-9 · Target size failures `[REPORTED]` · 2.5.8 (AA)

`.step-handle` is ~20px wide (two `⋮` glyphs plus 8px padding). `.step-checkbox` is forced to
**18×18 by `!important`** at `review-standalone.css:1412-1417`, overriding the inline 22px the JS
author wrote — and these checkboxes gate "Delete Selection", the page's destructive action. Neither
qualifies for the spacing exception.

### A-10 · Popup cannot reflow `[REPORTED]` · 1.4.10, 1.4.12 (AA)

`popup.css:142-153` — `width: 380px` with `overflow-x: hidden` and **zero `@media` queries** in the
file. Anything exceeding 380px is clipped and unreachable: no scrollbar, no pan. Applying the 1.4.12
text-spacing bookmarklet truncates `.stats`, `.button-row`, the `Every [input] seconds` row, and
`.storage-actions`. Extension popups honour browser page zoom, so a user at 200% is a real case.

Separately, `popup.css:156-176` lays a fixed full-viewport scanline overlay at `opacity: 0.5`,
`z-index: 9999` over every glyph in dark mode — decorative, undisableable, and it depresses the
effective contrast of all dark-theme text below whatever the palette measures on its own.

---

## Documentation is describing a different product

Four `// Unified export:` comments deliberately strip the selector from every output path
(`export-service.js:288-291`, `:341`, `:399`, `:963`). The pivot from codegen to documentation was a
real decision. Nothing else was updated to match:

| Claim | Location | Reality |
|---|---|---|
| "locator extraction" | `manifest.json:4` — the store's short description | Emitted by no export path `[VERIFIED]` |
| "JSON Export — integrate with Selenium, Playwright, Cypress" | `README.md:26`, `:284` | Selector destructured out `[VERIFIED]` |
| "CSV: 10 columns … CSS Selector, XPath" | `README.md:144` | Header is 5 columns, no locator `[VERIFIED]` |
| "Inline Editing — field names, values, selectors, notes" | `README.md:110` | None of the four is editable `[REPORTED]` |
| Markdown export | README feature list | Implemented at `:376`, in no UI dropdown `[VERIFIED]` |
| "Undo/Redo" | `README.md:110` | No redo button exists `[REPORTED]` |
| CDN fallback | `README.md:460`, `libs/README.md:43` | Ships in package; asserts an MV3 violation `[VERIFIED]` |
| HIPAA / PCI DSS / SOC 2 / GDPR claims | `README.md:480-483` | Uncertified. "PCI DSS Aligned — card numbers masked" is falsified by the Luhn gate at `redactor.js:71-84`, which masks only a *complete* valid PAN `[REPORTED]` |
| Version badge 1.1.3 | `README.md:5` | Four releases stale |
| "21 patterns" | `README.md:70` | `redactor.js:19-42` has 22 |
| `Ctrl+Shift+U` starts recording | `README.md:236` | `toggle_recording` only pauses/resumes; no start command exists |

---

## Product direction

The strongest strategic read from the run: **as shipped, this competes with Scribe, Tango and Jam.dev
— not Selenium IDE.** Against those it loses on polish and sharing and wins on exactly one axis:
DOCX/PDF as a first-class, offline, no-account, no-cloud artifact. Scribe requires an account and
uploads screenshots to their servers; that is disqualifying for the buyer this product can actually
win — the QA lead at an agency, bank, or regulated shop whose contractual deliverable is a Word
document with timestamped screenshots.

The recommendation is to **commit to documentation and not build codegen.** Playwright codegen is
free, first-party, and has auto-waiting; TestSnapper has no waits at all and keeps only one selector
per step (`selector.js:201-209` computes ranked alternatives and discards all but the top one).

The one feature that would convert this from "a Scribe clone with worse sharing" into a defensible
category of one: **a pass/fail verdict per step.** A document without a verdict is a walkthrough, not
test evidence — and evidence is the only reason the buyer opens Word. Two fields on the step object
plus a control on the card; ~2-3 days.

Ranked shortlist:

1. **Surface Markdown + "Copy repro steps" to clipboard** — half a day, the code already exists
2. **Pass/fail verdict per step** — 2-3 days, unlocks the repositioning
3. **Fix the capture holes** (Enter/Tab keys, checkbox/radio `change`, iframe frame path) — ~3 days
4. **Report header block** (Test ID, build, environment, ticket ref) — ~2 days, makes exports filable
5. **Move field naming from record-time to review-time** — ~1 week, deletes ~200 lines and closes a data-loss path
6. **Screenshot annotation + manual blur** — ~1.5 weeks, makes the compliance pitch demonstrable

Cut candidates: `webRequest`/API capture (scariest permission, one text line of value); the
FileSystem Access layer (`fs-storage.js` + `file-sync.js` ≈ 2,065 LOC, ~15% of the tree, solving a
quota problem better solved by fixing screenshot compression); `html2pdf`; the terminal/scanline theme.

---

## Prior findings confirmed still live on this branch

Verified present by the bug-hunter persona with file:line proof: **CONS-02, 03, 04, 05, 06, 07, 08,
19, 20, 21, 23, 25, 37.**

Confirmed fixed: **CONS-01** (manifest version now matches published), **CONS-13**, **CONS-75**
(review tab now auto-opens on stop, `background.js:995-1001`).

Latent but unreachable: the `cancelExport` message case (`background.js:1276-1286`) still force-resets
state to `idle` and would kill a live recording, but `review-standalone.js:270-273` documents that it
deliberately no longer sends it and no other sender exists. `case 'exportSession'` and the
`new ExportService(storage)` at `background.js:278` are likewise dead.

---

## Corrections made during consolidation

- The `.docx` → `.doc` mismatch was first reported as unconditional; it is a **fallback path only**
  (P2-6). Downgraded.
- An initial `grep -c` suggested 140 `!important`; that counts *lines*. Occurrences are **292**. The
  visual persona's figure was correct.
- The sub-frame finding was initially suspected to contradict an intentional design gate. Checking
  both comments showed the file contradicts *itself* (P1-2) — the finding is stronger, not weaker.
