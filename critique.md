# TestSnapper — Open Critique Items

Severity: 🔴 critical · 🟠 high · 🟡 medium · 🔵 low/nit.

> Resolved items were removed on 2026-07-01 (fixed on branch `fix/v1.1.6-parallel-fixes`, verified by tests + build). What remains below is **not yet implemented**. Implemented & verified: FieldNameResolver wiring, redactor PIN/routing/email, duplicate `cleanFieldName`, dead modal code, CSV formula-injection, import metadata sanitize, `markSessionIncomplete` index bloat, `getSession` null guard, `getPendingFlush` single-index, `exportAllData` size guard, `_stepsCache` cap, `unlimitedStorage` + `QuotaMonitor.checkQuota`/listener methods, manifest version + declarative `field-name-resolver.js`, `.gitignore`, and new tests for `StorageManager` / `image-processor` / CSV.

## 1. Dead / unwired subsystems
- 🟠 **`Logger` is imported nowhere.** [core/logger.js](src/core/logger.js) is the MED-008 "logging abstraction," but every file still uses raw `console.log`/`warn` with emojis, so the production log-silencing it promises never happens. **Fix:** replace `console.*` in background/content/storage with `Logger.*`, or drop the module.

## 2. Privacy & security
- 🟠 **Screenshots are never redacted.** Redaction only touches typed *values*. `captureVisibleTab` ([background.js](src/background/background.js)) captures whatever is on screen — visible tokens, PII, autofilled data. SEC-002 only suppresses *auto* screenshots while a sensitive field is *focused*; manual screenshots and any visible PII are captured in full. **Fix:** document the limitation prominently; optionally blur/redact known-sensitive element rectangles before capture, or offer a "manual screenshots only" privacy mode.
- 🟡 **Very broad permissions.** `<all_urls>` host permissions + `tabs` + `webRequest` + `file:///*` + `all_frames` ([manifest.json](manifest.json)) is a heavy footprint that complicates Web Store review and increases attack surface. **Fix:** prefer `activeTab` + on-demand `scripting` where possible; justify `webRequest` (currently observation-only) or move to `declarativeNetRequest`.
- 🔵 **Uninstall pings Google Forms; placeholder URLs.** [background.js](src/background/background.js) `setUninstallURL('https://forms.gle/...')` is silent telemetry on uninstall; `homepage_url` is still the placeholder `yourusername`. **Fix:** disclose in privacy policy; fix placeholder URLs.

## 3. Architecture
- 🟠 **Dual storage stack is complex and partly bypassed.** `FSStorageManager` ([core/fs-storage.js](src/core/fs-storage.js)) wraps `StorageManager` behind a Proxy that auto-routes unknown methods to `_buffer` only — `_fileSync`-only methods silently won't route. Background uses `StorageManager` directly, so the filesystem path runs only in window contexts. **Fix:** document the routing contract explicitly and add tests for the Proxy fall-through; consider unifying behind one interface with a pluggable backend.

## 4. Build / docs housekeeping
- 🟡 **Single source of truth for version.** `manifest.json` is now `1.1.5`, but it's still hand-maintained and `CLAUDE.md` still references dev branch `V1.1.3`. **Fix:** derive the manifest version from `package.json` at build time and reconcile `CLAUDE.md`.
- 🔵 **Comment archaeology.** Files are dense with historical fix IDs (`FUNC-003`, `PERF-005`, …) that document *history*, not current behavior. **Fix:** move to `CHANGELOG.md`; keep comments describing present-day intent.

## 5. Testing gaps (remaining)
- 🟡 **No tests for `quota-monitor`, `schema-migrator`, `orphan-cleaner`.** (`StorageManager` and `image-processor` are now covered.)
- 🟡 **No isolated tests for background logic:** `_isConsecutiveDuplicate`, `ApiCapture._shouldRecord`, `SettingsManager` validation clamping. These live inside `background.js` and aren't exported — extracting them to a testable module would also improve structure.
- 🔵 **Duplicated `CompressionStream` polyfill** between `tests/core/compression.test.js` and `tests/test_compression.mjs`; move to `tests/helpers/`.

## 6. Enhancements (nice-to-have)
- Replace 1 s navigation polling + 15 s heartbeat + auto-screenshot timers ([content.js](src/content/content.js)) with the Navigation API / `popstate` where available to cut idle work.
- Re-attach `webRequest` API-capture listeners after a cold SW restart mid-recording (limitation noted in `background.js` `ApiCapture`).
- Add a settings UI toggle surfacing the screenshot-privacy tradeoff (section 2).
- Theme detection defaults to `light` for transparent / `color-scheme`-driven dark pages ([content.js](src/content/content.js)); consider honoring `prefers-color-scheme`.
