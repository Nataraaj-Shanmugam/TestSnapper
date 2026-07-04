# TestSnapper — Security & Data-Leak Audit (2026-07-04)

> ## Fix status (security batch — 2026-07-04)
> **FIXED:**
> - **SEC-1** — new canonical `src/core/privacy-utils.js#sanitizeUrl`. URLs are now sanitized at **capture time** server-side (`background.js#sanitizeStepForStorage`, applied in `addStep`, `captureScreenshot`, and `ApiCapture`), so tokens never reach storage. Backups also sanitized: `storage.exportAllData` and both `fs-storage.exportAllData` paths strip sensitive params from already-stored (legacy) data. `ExportService._sanitizeUrl` now delegates to the shared function (no divergence). Sensitive query **and fragment** keys covered (OAuth implicit flow).
> - **SEC-2** — dead `Redactor.redactStep()` removed; replaced by a real server-side backstop `privacy-utils#maskGenericPII` applied to `step.value`/`step.targetLabel` on every step before persistence.
> - **SEC-3** — PII patterns broadened (mirrored in `privacy-utils.js` and `content/redactor.js`): phones now match parenthesized/international/space formats; cards match 13–16 digits (Amex 15 included) **gated by a Luhn check** so order ids aren't corrupted.
> - **SEC-6** — API-capture request URLs sanitized at capture (same path as SEC-1).
> **Verified:** 420/420 unit tests (11 new across `privacy-utils.test.js` + redactor SEC-3 cases), production build, e2e re-run.
> **Still open (need a UX decision, not yet done):** SEC-4 (screenshot on-screen PII — needs a redaction-selector feature), SEC-5 (backup should warn it contains unredacted screenshots), SEC-7 (mask length oracle), SEC-8 (make `webRequest` an optional permission), SEC-9 (`mode:'closed'` shadow roots).

Threat model: a browser extension with `<all_urls>` host access that records user interactions (including on authenticated/sensitive pages), stores them locally, and exports/backs them up. Primary risks are (a) **capturing PII the user didn't intend**, (b) **XSS on extension pages** via attacker-controlled page content flowing into the review/popup UI, and (c) **over-broad permissions / egress**.

Good news first — verified **clean**:
- **No network egress.** No `fetch`/`XHR`/`sendBeacon`/`WebSocket` to any server anywhere in `src/`. All processing is local. (The only `fetch` references are comments in image-processor.js explaining they *avoid* it.)
- **No dynamic code.** No `eval`, no `new Function`, no `innerHTML` from unescaped step data in the hot paths (all use `Utils.escapeHtml`).
- **No `externally_connectable` / `onMessageExternal`.** Web pages cannot message the extension. The runtime message handler rejects any sender whose `id !== chrome.runtime.id`.
- **CSP is strict** on extension pages (`script-src 'self'`) and the HTML pages add their own `connect-src 'self'`.
- **Export sinks are hardened:** CSV formula-injection neutralized (`_csvSafeCell`), image data-URLs allowlisted with `SAFE_DATA_URL_RE`, export filenames stripped of path/control chars.

Severity: **SEC-P0** = active leak or exploitable · **P1** = realistic leak/weakness · **P2** = hardening.

---

## SEC-P0 — Data leaks

### SEC-1: Sensitive URL query params are stored in plaintext; only stripped at EXPORT
`step.url` is captured as raw `window.location.href` ([content.js:775,902,969,1005,1044](src/content/content.js)) and `navigate` steps store the full URL in `step.value`. `ExportService._sanitizeUrl()` strips `token`, `access_token`, `code`, `password`, `sig`, `jwt`, `otp`, … — **but only during export** (grep confirms `_sanitizeUrl` is called nowhere outside export-service.js). Therefore:
- `chrome.storage.local` and the on-disk `session.json` hold **raw URLs including OAuth codes, magic-link tokens, password-reset tokens, session ids in query strings** — indefinitely.
- **JSON backup** (`handleBackupAll`) serializes `exportAllData()` with **no URL sanitization at all** (only the docx/pdf/csv/md/json *step* exporters sanitize). A backup file is a plaintext dump of every raw URL.
- The review page renders and persists these raw URLs.
**Fix:** sanitize URLs at **capture time** (in the content script, before the step leaves the page) so nothing sensitive is ever written to disk, and apply `_sanitizeUrl` inside `exportAllData()` too.

### SEC-2: `redactStep()` is dead code — the "redact stored steps" safety net never runs
`Redactor.redactStep()` ([redactor.js:169](src/content/redactor.js:169)) exists but is **called from nowhere** (grep: only the definition). Redaction of recorded `value` depends *entirely* on `maskValue()` being invoked in `handleInput`/`handleChange`. That covers typed inputs, but any step created by a path that doesn't call `maskValue` (e.g. programmatic values, future step types) is stored unredacted with no backstop. The presence of the unused function gives a false sense of defense-in-depth.
**Fix:** either wire `redactStep()` into the background `addStep()` as a final server-side masking pass over `value`/`targetLabel`, or delete it and document that masking is capture-time only.

### SEC-3: Redactor misses common PII formats (verified leaking)
Ran the live patterns against realistic samples — these **pass through unmasked**:
| Sample | Type | Result |
|---|---|---|
| `(555) 123-4567` | phone (parens) | **LEAKED** |
| `+1 555 123 4567` | phone (intl/space) | **LEAKED** |
| `378282246310005` | Amex 15-digit card | **LEAKED** (pattern only matches 16-digit 4-4-4-4) |
| `123456789` | SSN without dashes | **LEAKED** (only `\d{3}-\d{2}-\d{4}` matched; 9-digit masking is gated to "financial" fields) |
The credit-card regex assumes 4×4 grouping (misses Amex 15-digit and unformatted 15/16-digit strings); the phone regex misses parenthesized area codes and international/space formats. These are the exact formats users type into checkout/support forms.
**Fix:** broaden the CC pattern to 13–16 contiguous/spaced digits with a Luhn check to avoid false positives; add parenthesized/international phone variants; consider masking bare 9-digit SSN in fields labeled ssn/tax.

---

## SEC-P1 — Realistic leaks & weaknesses

### SEC-4: Screenshots capture on-screen PII with zero masking
`captureVisibleTab` grabs the full viewport bitmap; redaction only touches recorded *values*, never pixels. Any PII visible on screen (a displayed SSN, another person's data, a bank balance) is stored as a plaintext data-URL and embedded in exports/backups. This is acknowledged in a code comment but is the single largest data-at-rest exposure. FD-1 (auto-capture of the wrong tab) is already fixed; the on-screen-PII exposure remains by design.
**Mitigation to consider:** the extension already hides `[id^="testsnapper-"]` before capture — extend that to a user-configurable redaction selector list (blur/black-box elements matching `[data-sensitive]`, `input[type=password]`, etc.) before `captureVisibleTab`.

### SEC-5: No encryption at rest; backups are plaintext JSON
`chrome.storage.local` and the File System Access files are unencrypted (expected for a local tool), but the **backup export** is a plaintext `.json` the user may email/upload/sync — carrying raw URLs (SEC-1), unmasked screenshot bitmaps (SEC-4), and any PII the redactor missed (SEC-3). At minimum the backup should warn the user it contains unredacted screenshots and URLs, and ideally offer an option to exclude screenshots or sanitize URLs on backup.

### SEC-6: `webRequest` API-capture stores full URLs of every XHR/fetch on the recorded tab
When API capture is enabled, `ApiCapture._maybeRecord` stores `details.url` (full, with query string) for every matching request ([background.js](src/background/background.js)). Auth tokens and ids commonly ride in API query strings; these are stored raw and, again, only sanitized at export for *some* formats. The display string strips the query (`_stripQuery`) but the stored `step.url` keeps it.
**Fix:** apply the same capture-time URL sanitization (SEC-1) to `ApiCapture` steps.

### SEC-7: `redactStep` uses `•`×8 but `maskValue` truncates to `value.length` — length oracle
Minor: masked values reveal the original length (`maskValue` returns dots equal to `min(len,8)`; DOB mask reveals year length). For short secrets (PINs) this leaks length. Low impact, worth normalizing to a fixed-width mask.

---

## SEC-P2 — Hardening / posture

### SEC-8: Permissions are broad (justifiable, but audit for store review)
`<all_urls>` host access + `tabs` + `webRequest` + `scripting` is a lot of surface. It's consistent with the feature set (record anywhere), but:
- `tabs` gives URL/title of **all** tabs, not just the recorded one — `activeTab` + `scripting` may cover most needs.
- `webRequest` is only used when API capture is on (a non-default opt-in). Consider making it an **optional permission** requested at the moment the user enables API capture, shrinking the default install's warning + attack surface.
- The `web_accessible_resources` block (`matches: ["chrome-extension://*/*"]`) is ineffective and should be removed (also noted in the readiness audit).

### SEC-9: Shadow DOM panels use `mode: 'open'`
The recording panel/modal/toast attach with `attachShadow({mode:'open'})` ([content.js:450,834,1334](src/content/content.js)), so the host page's JS can reach into `.shadowRoot` and read/alter the panel. Low risk (the panel holds no secrets), but `mode:'closed'` denies the page any handle to extension-injected UI. Cheap hardening.

### SEC-10: Selector/label text can embed page-controlled strings into stored data
`targetLabel`/`selector.text` now (post P0-4 fix) exclude typed values, but still capture arbitrary page text (button labels, nearby text). This is rendered with `escapeHtml` everywhere I checked (no XSS), but note that a malicious page *can* seed arbitrary attacker strings into a session; the defense is the consistent output-escaping in popup.js/review-standalone.js — keep any new render path escaped. Confirmed current sinks (`badgeNum` is numeric; `safeId`, `safeDescription`, session names, values all go through `escapeHtml`).

---

## Priority

1. **SEC-1** (sanitize URLs at capture + in backups) and **SEC-2** (wire or remove redactStep) — these are the concrete "tokens written to disk" leaks.
2. **SEC-3** (broaden PII patterns) — small change, closes real gaps.
3. **SEC-6** (API-capture URL sanitization) — same fix family as SEC-1.
4. **SEC-4 / SEC-5** (screenshot PII + backup warning) — needs a small UX decision.
5. **SEC-8 / SEC-9** — posture hardening for store review.

No exploitable XSS or egress found; the leaks are all "sensitive data written to local storage/backups in the clear," dominated by unsanitized URLs (SEC-1) and screenshot pixels (SEC-4).
