# TestSnapper â€” Remaining Fix TODO

8 items remaining after the V1.1.6 fix pass. All Critical and High severity issues resolved.
For the full original 58-item list see git history. For reasoning/snippets behind any item, open `Observations/<ID>-*.md`.

## Severity rollup
| Severity | Remaining |
|----------|-----------|
| Medium   | 6         |
| Low      | 2         |

---

## src/background/background.js

- [x] **[MED][SEC-002]** Screenshots capture on-screen secrets/PII despite text redaction â€” `background.js` 509-615; also `redactor.js` 79-145, `content.js` 957-960, 1005-1014.
  - Problem: `redactor.maskValue` masks only the recorded text `value` of sensitive fields; `captureVisibleTab` records whatever is rendered (tokens/SSNs/cards in `type=text`, OTP, "show password" reveals, PII already on the page), stored verbatim and embedded into `session.json` and DOCX/PDF.
  - Impact: recordings/backups/exports can leak plaintext images of credentials and PII even when the field value was redacted.
  - Fix: document clearly (UI + PRIVACY_POLICY) that screenshots are not redacted. Suppress auto-screenshot while `document.activeElement` matches `redactor.shouldIgnoreField`. Add a setting to disable screenshots on sensitive pages/fields and/or region-mask matching elements before capture.

---

## src/content/content.js

- [x] **[MED][UX-011]** Field-name modal discards typed input after 30s and has no dialog semantics/focus trap â€” `content.js` 336-350, 363-412, 441-445, 482-487.
  - Problem: a 30s `setTimeout` calls `closeModalById(modalId, null)` and is never reset on typing; the overlay has no `role="dialog"`/`aria-modal`/`aria-labelledby`; focus is set on a timer but never restored.
  - Impact: users lose typed field names with no warning; screen-reader users aren't told a modal opened; keyboard focus escapes behind the overlay into a page the extension thinks is paused.
  - Fix: reset the timeout on `input` (or show a visible countdown) and on timeout submit the typed value instead of `null`; add `role="dialog"`, `aria-modal="true"`, `aria-labelledby`; trap Tab within inputâ†’Skipâ†’Confirm and restore focus to the element captured before opening.

---

## src/ui/review/review-standalone.js

- [x] **[MED][SEC-001]** Review page renders screenshot `src` and `step.id` into HTML unescaped (reachable via malicious imported backup) â€” `review-standalone.js` 431-538; also `storage.js` 332-370.
  - Problem: the description is escaped, but `screenshotData` (from `resolveScreenshotUrl`, no `data:image` validation) and `step.id` are interpolated raw into `img src` and `data-*` attributes. `importData` only checks shapes, not `asset.dataUrl`/`step.id` content. (Script is blocked by CSP â€” this is HTML injection in an extension-origin page, defense-in-depth.)
  - Impact: a crafted "Restore" backup can inject non-script HTML (spoofed UI, hidden iframes, off-origin image beacons) into the privileged review page; any future CSP relaxation makes it stored XSS.
  - Fix: escape every interpolated attribute (`Utils.escapeHtml(step.id)` in `data-before-step-id`/`data-step-id`/checkbox). In `resolveScreenshotUrl`, only return strings matching `^data:image\/(png|jpeg|jpg|webp);base64,` else null. In `storage.importData` (+ `importAllData` handler), validate `asset.dataUrl`/`data` as `data:image/...` and constrain `step.id` to a UUID/charset allowlist before persisting.

- [x] **[LOW][PERF-018]** Undo history keeps up to 50 full deep copies of the step array, persisting every restore â€” `review-standalone.js` 36-38, 372-412.
  - Problem: every mutation snapshots `stepsData` via `JSON.parse(JSON.stringify(...))` and retains up to MAX_HISTORY=50; `restoreFromHistory` deep-copies again and triggers a full persist + re-render.
  - Impact: tens of MB retained on a 500-step session (estimate); double-serialization per edit; undo latency dominated by the full persist/re-render it triggers.
  - Fix: use `structuredClone(stepsData)` and/or store diffs (action + affected ids) instead of full snapshots; reuse the snapshot reference in `restoreFromHistory` instead of re-copying; optionally lower MAX_HISTORY adaptively above ~200 steps.

---

## src/ui/popup/popup.js (+ popup.html)

- [x] **[MED][PERF-016]** Backup/restore round-trips the entire store (all screenshots) through one runtime message (~64MB limit) â€” `background.js` 1132-1144; also `storage.js` 301-322, `fs-storage.js` 794-816, `file-sync.js` 495-509.
  - Problem: `exportAllData` builds one object with every session/step/screenshot and returns it via `sendResponse`; beyond ~64MB the message throws and backup fails. `importAllData` is the same in reverse. The payload exists as ~4-5Ã— copies across SW + popup.
  - Impact: backup/restore fails for exactly the large data sets users most want to back up; multi-hundred-MB transient heap (estimate).
  - Fix: when filesystem storage is ready, do backup entirely in the window context (`fsStorage.exportAllData()`) â€” never message the payload. For the buffer path, chunk by session (one message per session). Stream sessions one at a time into the output file via `FileSystemWritableFileStream`.

---

## src/ui/popup/popup.css (+ review-standalone.css)

- [x] **[MED][UX-005]** Onboarding + re-auth banners use undefined `--surface` â€” backgrounds never render â€” `popup.css` 1450, 1472.
  - Problem: `color-mix(in srgb, var(--accent) 10%, var(--surface))` references `--surface`, which is defined nowhere and has no fallback â€” the whole `background` is invalid, so the first-run onboarding CTA and re-auth warning render with transparent backgrounds.
  - Impact: the single most important first-run prompt blends into the page instead of standing out.
  - Fix: replace `var(--surface)` with the existing `var(--bg-card)` (or `var(--surface, var(--bg-card))`) at both lines; verify the 10% tint shows in light and dark.

- [x] **[LOW][UX-014]** 9px text in format cards and session metadata is below readable size â€” `popup.css` 982-987, 1073-1079, 1153-1159.
  - Problem: `.format-desc`, `.session-meta`, `.item-meta` hardcode 9px (below the 10px `--text-overline` token) in low-emphasis `--text-muted`, carrying real info (format descriptions, step-count + date).
  - Impact: step counts/dates that differentiate sessions are effectively illegible in the picker.
  - Fix: raise `.format-desc` to >=10px (preferably 11px `--text-caption`); raise `.session-meta`/`.item-meta` to 11px; if space-constrained, trim the date detail rather than the font.
