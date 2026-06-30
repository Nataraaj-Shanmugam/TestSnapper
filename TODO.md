# TestSnapper — Open Work Items

Derived from `critique.md`. Each **Group** owns a non-overlapping file set — spawn one Haiku agent per group for parallel execution.

**Status:** ✅ **ALL 23 ITEMS COMPLETE** — 407 tests passing

**Completion summary:**
- ✅ Group A (4/4): version SoT, homepage, permissions, Logger global (commit `577673a`)
- ✅ Group B (5/5): extract logic, Logger wiring, privacy note, disclosure, archaeology (commit `63c91c9`)
- ✅ Group C (3/3): Logger wiring, Proxy docs, archaeology (commit `92d4ebd`)
- ✅ Group D (3/3): Logger wiring, prefers-color-scheme, archaeology (commit `995fac7`)
- ✅ Group E (6/6): quota-monitor/schema/orphan/Proxy/recorder-utils tests, polyfill dedup (commits `82a25fd`, `1b117e4`)
- **407 tests passing** across 17 test files (added 96 new tests total)

Severities: 🟠 high · 🟡 medium · 🔵 low

---

## Group A — Build & Manifest
**Files owned:** `manifest.json`, `package.json`, `webpack.config.js`

- [x] 🟡 **A-1 Version single source of truth.**
  In `webpack.config.js`, read `version` from `package.json` (`require('./package.json').version`) and inject it into the copied `manifest.json` via `CopyPlugin`'s `transform` option (string-replace `"version": ".*?"` with the package version). Source `manifest.json` can keep a placeholder `"0.0.0"` thereafter. Also update `CLAUDE.md` "Git Branching" section — it still references dev branch `V1.1.3`; update to reflect current branching convention.

- [x] 🔵 **A-2 Fix `homepage_url` placeholder.**
  Change `"https://github.com/yourusername/testsnapper"` in `manifest.json` to the real repo URL, or remove the field if not yet published.

- [x] 🟡 **A-3 Permissions audit.**
  `webRequest` in `manifest.json` is currently observation-only (API capture in `background.js`). Either add a comment in `manifest.json` explaining why `declarativeNetRequest` is insufficient, or replace it. Verify no other permission can be dropped after the review.

- [x] 🔵 **A-4 Expose `Logger` to content scripts.**
  At the bottom of `src/core/logger.js`, append `if (typeof window !== 'undefined') window.Logger = Logger;` so the class is available as a page-context global. Then prepend `"src/core/logger.js"` to `content_scripts[0].js` in `manifest.json` (before `selector.js`) so it loads first.

---

## Group B — Background Service Worker
**Files owned:** `src/background/background.js`, `src/core/recorder-utils.js` *(new)*

- [x] 🟠 **B-1 Extract testable logic to `src/core/recorder-utils.js`.**
  Move the following out of `background.js` and into a new ES-module file with named exports:
  - `_isConsecutiveDuplicate(stepData, lastStep)` (line 993)
  - `ApiCapture._shouldRecord(ok)` filter predicate (line 745) — extract as `shouldRecordRequest(details, filter)`
  - `SettingsManager.validateSettings(raw)` clamping — extract as `validateSettings(raw)`

  Update `background.js` to import all three from `'../core/recorder-utils.js'`.

- [x] 🟠 **B-2 Wire `Logger` into `background.js`.**
  `import { Logger } from '../core/logger.js'` at the top of `background.js`. Replace all 54 `console.log/warn/error/info` calls with `Logger.debug/info/warn/error`. Near the service-worker init block, call `Logger.setLevel('warn')` in production so debug/info are silenced.

- [x] 🟠 **B-3 Screenshot privacy JSDoc note.**
  In `captureScreenshot()` in `background.js`, add a single `@note` line to the JSDoc: "Captures the full visible viewport; redaction applies to recorded values only — on-screen PII in screenshots is not masked."

- [x] 🔵 **B-4 `setUninstallURL` disclosure comment.**
  Add one comment line above `chrome.runtime.setUninstallURL(...)` in `background.js`: `// Opens a voluntary feedback form on uninstall — no data is sent automatically.`

- [x] 🔵 **B-5 Comment archaeology in `background.js`.**
  Remove inline historical fix-ID comments (`// FUNC-003`, `// PERF-005`, `// SEC-002`, etc.) from `background.js`. Retain only comments explaining non-obvious present-day behavior.

---

## Group C — Core Modules
**Files owned:** `src/core/storage.js`, `src/core/quota-monitor.js`, `src/core/export-service.js`, `src/core/flush-utils.js`, `src/core/image-processor.js`, `src/core/compression.js`, `src/core/fs-storage.js`, `src/core/schema-migrator.js`, `src/core/orphan-cleaner.js`, `src/core/file-sync.js`

- [x] 🟠 **C-1 Wire `Logger` into all core modules.**
  In each of the ten core files, add `import { Logger } from './logger.js';` and replace every `console.log/warn/error/info` call with `Logger.debug/info/warn/error`. (Total across core: ~63 calls.)

- [x] 🟠 **C-2 Document `FSStorageManager` Proxy routing contract.**
  In `fs-storage.js`, add a JSDoc block directly above the `new Proxy(...)` call explaining:
  - Unknown method calls fall through to `this._buffer` (StorageManager).
  - `_fileSync`-only methods must be called explicitly on `this._fileSync`.
  - `background.js` uses `StorageManager` directly; the filesystem path is window-context only.

- [x] 🔵 **C-3 Comment archaeology in core files.**
  Remove historical fix-ID inline comments (`// HIGH-001`, `// MED-005`, `// PERF-014`, etc.) from all core files. Keep only comments explaining non-obvious present-day intent.

---

## Group D — Content Scripts
**Files owned:** `src/content/content.js`, `src/content/redactor.js`, `src/content/selector.js`, `src/content/field-name-resolver.js`

*Note: D-1 depends on A-4 (Logger global injection) landing first, or can be done simultaneously if the guard `if (window.Logger)` is used.*

- [x] 🟠 **D-1 Wire `Logger` into content scripts.**
  In all four content-script files, replace `console.log/warn/error` with `window.Logger?.debug/info/warn/error(...)`. The optional-chaining guard keeps scripts working even if logger.js fails to inject. (Total: ~48 calls.)

- [x] 🔵 **D-2 `prefers-color-scheme` initial theme.**
  In `content.js`, in the initial theme-detection block, check `window.matchMedia('(prefers-color-scheme: dark)').matches` and default to `dark` when true, instead of always defaulting to `light`. Keep existing stored-preference override logic.

- [x] 🔵 **D-3 Comment archaeology in content scripts.**
  Remove historical fix-ID comments from all four content-script files.

---

## Group E — Tests
**Files owned:** `tests/core/quota-monitor.test.js` *(new)*, `tests/core/schema-migrator.test.js` *(new)*, `tests/core/orphan-cleaner.test.js` *(new)*, `tests/core/fs-storage-proxy.test.js` *(new)*, `tests/background/recorder-utils.test.js` *(new)*, `tests/helpers/compression-polyfill.js` *(new)*, `tests/core/compression.test.js`, `tests/test_compression.mjs`

- [x] 🟡 **E-1 `quota-monitor` tests.**
  Create `tests/core/quota-monitor.test.js`. Stub `chrome.storage.local.getBytesInUse`. Test:
  - `getStorageUsage` percentage at 0%, 79%, 80% (warning boundary), 95% (critical boundary), 100%
  - `checkQuota` returns usage object under 95%; throws `StorageQuotaExceeded` (name check) at ≥95%
  - `onQuotaWarning` registers listener; `offQuotaWarning` deregisters
  - `_notifyQuotaWarning` calls all listeners and isolates a throwing listener

- [x] 🟡 **E-2 `schema-migrator` tests.**
  Create `tests/core/schema-migrator.test.js`. Stub `chrome.storage.local`. Test:
  - v1→v2 migration moves step keys to the correct split-key layout
  - Idempotency: running migration twice produces identical storage state
  - Already-v2 data is untouched (migration no-ops cleanly)

- [x] 🟡 **E-3 `orphan-cleaner` tests.**
  Create `tests/core/orphan-cleaner.test.js`. Stub `chrome.storage.local` with sessions + orphaned asset keys. Test:
  - `cleanOrphans` deletes asset keys with no matching session ID
  - Weekly-guard: second call within 7 days is skipped
  - No-op when there are no orphaned keys

- [x] 🔵 **E-4 `recorder-utils` tests** *(depends on B-1).*
  Create `tests/background/recorder-utils.test.js`. Import from `src/core/recorder-utils.js`. Test:
  - `_isConsecutiveDuplicate`: same selector+field → true; different selector → false; different field → false
  - `shouldRecordRequest`: passes/blocks by URL pattern and method filter
  - `validateSettings`: clamps out-of-range numbers to min/max; preserves valid values; fills defaults for missing keys

- [x] 🟡 **E-6 `FSStorageManager` Proxy fall-through tests.**
  Create `tests/core/fs-storage-proxy.test.js`. Stub both `StorageManager` and `FileSync`. Test:
  - A call to an unknown method (e.g. `getSession`) on the `FSStorageManager` proxy routes to `_buffer`, not `_fileSync`
  - A `_fileSync`-specific method called directly reaches `_fileSync` (not `_buffer`)
  - The proxy does not swallow thrown errors from `_buffer`

- [x] 🔵 **E-5 Deduplicate `CompressionStream` polyfill.**
  Extract the Node.js `zlib`-based `CompressionStream`/`DecompressionStream` polyfill from `tests/core/compression.test.js` into `tests/helpers/compression-polyfill.js` as a named export `installCompressionPolyfill()`. Update `tests/core/compression.test.js` to import and call it in `beforeAll`. Check `tests/test_compression.mjs` — if it uses the same polyfill, update it too.

---

## Enhancements (optional / backlog)
*(Implement individually as time permits — no agent group assigned)*

- [ ] **NAV-001** Replace 1s polling + 15s heartbeat + auto-screenshot timers in `content.js` with Navigation API / `popstate` where supported.
- [ ] **SW-001** Re-attach `webRequest` API-capture listeners after a cold service-worker restart mid-recording.
- [ ] **UI-001** Add a settings UI toggle exposing the screenshot-privacy limitation (§2 of critique).
- [ ] **EXP-IMG-006** Full-page/HiDPI capture via Debugger protocol `Page.captureScreenshot` with `captureBeyondViewport: true` — only if users report the viewport-only limitation.
