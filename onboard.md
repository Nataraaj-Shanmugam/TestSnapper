# Onboarding Guide: TestSnapper

**Project type**: Chrome Extension (Manifest V3)
**Primary language**: JavaScript
**Date generated**: 2026-03-21

---

## Project Overview

TestSnapper is a Chrome browser extension that records UI test sessions with automated field name detection, multi-strategy CSS/XPath selector generation, screenshot capture, and export to JSON, CSV, Markdown, DOCX, and PDF. The architecture is split across three isolated JavaScript environments — a service worker (background), content scripts (page context), and extension UI pages (popup/review) — each with different capabilities dictated by Chrome's security sandbox rules. Recording state is persisted to `chrome.storage.local` during a session, then optionally flushed to disk via the File System Access API when recording stops.

---

## First Day Checklist

- [ ] `git clone https://github.com/Nataraaj-Shanmugam/TestSnapper && cd TestSnapper`
- [ ] `npm run setup` — installs deps, downloads vendored libs into `libs/`, builds to `dist/`
- [ ] Open `chrome://extensions`, enable Developer Mode, click "Load unpacked", select `dist/`
- [ ] Verify the TestSnapper icon appears in the Chrome toolbar
- [ ] Read `manifest.json` — understand permissions, CSP (`script-src 'self'`), and content script injection order
- [ ] Read `src/background/background.js` — the orchestration hub for all recording actions
- [ ] Read `src/content/content.js` — event capture, modal queue, floating panel (note: uses `var`, not `let`)
- [ ] Read `src/core/storage.js` — split-key storage architecture and why it exists
- [ ] Read `src/core/fs-storage.js` — the storage proxy used by popup and review page
- [ ] Run `npm test` — all unit tests should pass
- [ ] Start watch mode: `npm run dev`, make a small change in `src/`, reload extension at `chrome://extensions`

---

## Environment Setup

### Prerequisites

| Tool | Version | Why | How to install |
|------|---------|-----|----------------|
| Node.js | >= 18 (LTS recommended) | Runs webpack, babel, vitest, download scripts | https://nodejs.org or `brew install node` |
| npm | >= 9 (bundled with Node 18+) | Package management and all script commands | Bundled with Node.js |
| Google Chrome | >= 88 | Required to load and test the extension; minimum version set in `manifest.json` | https://www.google.com/chrome |
| zip (CLI) | Any | Used by `create-release-zip.sh` to package for Chrome Web Store | Pre-installed on macOS; `sudo apt install zip` on Ubuntu |
| git | Any | Version control | `brew install git` or https://git-scm.com |

No Docker, no databases, no cloud accounts, and no environment variables are required.

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/Nataraaj-Shanmugam/TestSnapper
cd TestSnapper

# 2. One-command setup: installs deps, downloads vendored libs, and builds to dist/
npm run setup

# --- OR step by step ---

# 2a. Install npm dependencies
npm install

# 2b. Download third-party libs (docx 7.8.2 and html2pdf.js 0.10.1) into libs/
#     libs/ is gitignored — must be run on every fresh clone
npm run setup-libs

# 2c. Production build → dist/
npm run build

# 3. Load the extension in Chrome
#    - Open chrome://extensions
#    - Enable "Developer mode" (toggle top-right)
#    - Click "Load unpacked"
#    - Select the dist/ folder
#    - TestSnapper icon will appear in your toolbar

# 4. (Optional) Install Playwright browsers for e2e tests
npx playwright install chromium
```

### Environment Variables

No environment variables are required. The only variable used at build time is `NODE_ENV`, set automatically via `cross-env` in every npm script.

---

## Architecture & Structure

### Architecture Pattern

**Manifest V3 Chrome Extension with a split execution context design.** The codebase is divided into three isolated JavaScript environments, each with different capabilities enforced by Chrome's security sandbox:

| Context | Files | Capabilities | Restrictions |
|---------|-------|-------------|--------------|
| Service worker (background) | `src/background/background.js` | Privileged chrome APIs (`chrome.tabs.captureVisibleTab`, `chrome.downloads`), ES `import` | No DOM access |
| Content scripts (page context) | `src/content/*.js` | DOM access, shares page JS context | Cannot use ES `import`; must use `window.*` globals; `var` only at top-level |
| Extension UI pages | `src/ui/popup/`, `src/ui/review/` | ES `import`, same-origin DOM | Strict CSP blocks CDN scripts — vendored libs required |

### Directory Map

| Directory | Purpose | Key Files |
|-----------|---------|-----------|
| `src/background/` | Service worker — recording orchestration, chrome API calls, session recovery | `background.js` |
| `src/content/` | Scripts injected into every recorded web page; use globals, not ES imports | `content.js`, `selector.js`, `field-name-resolver.js`, `redactor.js` |
| `src/core/` | Shared business logic; can use ES modules; imported by background and UI pages (not content scripts) | `storage.js`, `fs-storage.js`, `export-service.js`, `file-sync.js`, `image-processor.js`, `compression.js`, `utils.js`, `dom-utils.js`, `logger.js`, `quota-monitor.js`, `schema-migrator.js`, `flush-utils.js`, `step-utils.js` |
| `src/ui/popup/` | Small popup that appears on extension icon click — start/stop/pause controls | `popup.js`, `popup.html` |
| `src/ui/review/` | Full browser tab opened after recording stops — step editing, reordering, export | `review-standalone.js`, `review-standalone.html` |
| `src/ui/` | Shared UI helpers | `theme.js` |
| `libs/` | Vendored `docx.min.js` and `html2pdf.bundle.min.js` — required because CSP blocks CDN on extension pages | `docx.min.js`, `html2pdf.bundle.min.js` |
| `scripts/` | Build-time helper that downloads vendored libs from unpkg | `download-libs.js` |
| `dist/` | Build output — load this folder in Chrome; not committed to git | — |
| `tests/` | Unit tests (`content/`, `core/`, `export/`, `ui/`) and e2e tests (`e2e/`) | — |

### Entry Points

| File | Role | What it initializes |
|------|------|---------------------|
| `src/background/background.js` | Service worker — registered in `manifest.json` | `StorageManager`, `ExportService`, `RecordingStateManager`, `SettingsManager`; all `chrome.runtime.onMessage` handlers; session recovery on startup |
| `src/content/content.js` | Content script injected into every tab at `document_end` | DOM event listeners (click/input/select), floating recording panel, modal queue for field name entry |
| `src/ui/popup/popup.html` | Extension popup (`default_popup` in manifest) | Loads `popup.js` — wires UI controls, sends messages to service worker |
| `src/ui/review/review-standalone.html` | Full-page review UI — opened programmatically by `background.js` after stop | Loads `review-standalone.js` — fetches session data, renders step cards |

### Data Flow

**Scenario 1 — User clicks a button on a recorded page:**

```
DOM click event
  └─> src/content/content.js (captureEvent handler)
        ├─> src/content/selector.js       → { primary, alternatives, css, xpath }
        ├─> src/content/field-name-resolver.js → "Submit Button"
        ├─> src/content/redactor.js        → masks PII
        ├─> Opens modal → user confirms/edits field name
        └─> chrome.runtime.sendMessage({ action: 'addStep', stepData })
              └─> src/background/background.js (addStep handler)
                    ├─> RecordingStateManager.incrementStepCount() (sequence lock)
                    ├─> _isConsecutiveDuplicate() check
                    ├─> src/core/storage.js → chrome.storage.local.set({ testsnapper_steps_{id} })
                    └─> persistActiveRecording()
```

**Scenario 2 — User stops recording and exports to DOCX:**

```
Popup → { action: 'stopRecording' }
  └─> src/background/background.js (stopRecording)
        ├─> content.js removes event listeners, hides floating panel
        ├─> broadcastSessionChange(sessionId, 'created')
        ├─> chrome.tabs.create({ url: review-standalone.html?sessionId=... })
        └─> FSStorageManager flushes buffer → src/core/file-sync.js writes to disk

Review page loads
  └─> src/ui/review/review-standalone.js
        ├─> FSStorageManager.getSession() + getSteps() (reads from disk via FileSync)
        ├─> Renders step cards with screenshots
        └─> User clicks Export → { format: 'docx' }
              └─> src/core/export-service.js
                    ├─> Reads asset.dataUrl (NOT asset.blob — Blobs don't survive storage)
                    ├─> src/core/image-processor.js — processes screenshots
                    ├─> Loads libs/docx.min.js (local; CDN blocked on extension pages)
                    └─> chrome.runtime.sendMessage → background.js calls chrome.downloads.download()
```

**Scenario 3 — Service worker restarts mid-recording:**

```
Chrome restarts the service worker
  └─> src/background/background.js (startup IIFE)
        ├─> chrome.storage.local.get('activeRecording')
        ├─> Validates session data and tab existence (chrome.tabs.get)
        ├─> If tab still exists → re-injects content scripts via chrome.scripting.executeScript
        └─> If tab is gone → marks session incomplete + chrome.notifications.create(...)
```

---

## Development Workflow

### Running Locally

This is not a web app — there is no dev server. The loop is:

1. Start the file watcher: `npm run dev`
2. Edit source files under `src/` — webpack rebuilds `dist/` automatically on every save
3. In Chrome, go to `chrome://extensions`, find TestSnapper, click the **reload** icon (circular arrow) — this is always a manual step; there is no hot reload
4. Click the TestSnapper icon to test your change
5. For popup/UI changes, close and reopen the popup after reloading the extension
6. Run unit tests before committing: `npm test`

### Available Commands

| Command | What it does | When to use |
|---------|-------------|-------------|
| `npm run setup` | `npm install` + `npm run setup-libs` + `npm run build` | First-time setup on a fresh clone |
| `npm run build` | Minified production build to `dist/` | Before loading/reloading extension for testing or release |
| `npm run build:dev` | Unminified build with source maps to `dist/` | One-off dev builds when you need readable output |
| `npm run dev` | Watch mode — rebuilds `dist/` on every file save | Active development session |
| `npm run clean` | Deletes `dist/` entirely | Clean slate before rebuilding |
| `npm run setup-libs` | Downloads `docx.min.js` and `html2pdf.bundle.min.js` into `libs/` | After a fresh clone, or if `libs/` is deleted |
| `npm test` | Runs all unit tests once and exits | Pre-commit checks, CI |
| `npm run test:watch` | Runs unit tests in watch mode | Active TDD development |
| `npm run test:coverage` | Runs unit tests with v8 coverage report | Reviewing test coverage |
| `npm run test:e2e` | Runs Playwright e2e tests against the built extension in Chrome | Integration testing after a build |
| `npm run test:e2e:report` | Opens the HTML report from the last Playwright run | Reviewing e2e test results |
| `bash create-release-zip.sh` | Verifies `dist/` and zips it into `testsnapper-v{version}-{timestamp}.zip` | Packaging a release for Chrome Web Store |

### Testing

| Aspect | Details |
|--------|---------|
| Unit test framework | Vitest 3.x |
| Unit test environment | jsdom (DOM simulation — no real browser needed) |
| Run all unit tests | `npm test` |
| Watch mode | `npm run test:watch` |
| Run single test file | `npx vitest run tests/core/utils.test.js` |
| Coverage | `npm run test:coverage` (v8 provider, covers `src/**/*.js`) |
| Unit test locations | `tests/content/`, `tests/core/`, `tests/export/`, `tests/ui/` |
| E2e framework | Playwright 1.58+ |
| E2e environment | Real Chrome with extension loaded from `dist/` (non-headless, 1 worker) |
| Run e2e tests | `npm run build && npm run test:e2e` |
| E2e test location | `tests/e2e/` |

### CI/CD

No CI/CD configuration is present. There are no `.github/workflows/`, `.gitlab-ci.yml`, or equivalent pipeline files.

### Deployment

```bash
# 1. Bump version — both files must match exactly
#    manifest.json  → "version": "X.Y.Z"
#    package.json   → "version": "X.Y.Z"

# 2. Production build
npm run build

# 3. Package for Chrome Web Store
bash create-release-zip.sh
# Outputs: testsnapper-vX.Y.Z-YYYYMMDD-HHMMSS.zip in project root

# 4. Upload at https://chrome.google.com/webstore/devconsole
```

---

## Conventions & Patterns

### Naming Conventions

| What | Convention | Example |
|------|-----------|---------|
| Files | kebab-case | `export-service.js`, `field-name-resolver.js` |
| Classes | PascalCase | `StorageManager`, `SelectorEngine`, `RecordingStateManager` |
| Singleton instances | camelCase | `storageManager`, `exportService`, `stateManager` |
| Constants | SCREAMING_SNAKE_CASE | `META_KEY`, `SESSIONS_KEY`, `COMPRESSION_PREFIX`, `MAX_HISTORY` |
| Private methods | `_` prefix | `_readMeta()`, `_writeSteps()`, `_isGeneratedId()` |
| Storage keys | `testsnapper_` prefix | `testsnapper_meta`, `testsnapper_sessions`, `testsnapper_steps_{id}` |
| Chrome message actions | camelCase strings | `'startRecording'`, `'addStep'`, `'captureScreenshot'` |
| Window globals (content scripts) | PascalCase on `window` | `window.SelectorEngine`, `window.Redactor`, `window.FieldNameResolver` |
| Content script top-level vars | `var` only — never `let`/`const` | see `src/content/content.js` |
| Bug fix references in comments | `BUG-NNN` / `BG-NNN` / `STR-NNN` | `// BUG FIX: BG-002` |

### Code Patterns

**Error handling:** All async functions return `{ success: true, ... }` or `{ success: false, error: message }` — never throw across the message boundary. Storage operations use a 3-attempt retry with exponential backoff via `_retryOperation(fn, operationName, retries = 3)` in `src/core/storage.js`. Fire-and-forget broadcasts use `.catch(() => {})` to suppress "no listeners" errors.

**Data validation:** Settings are validated on both save and load (`SettingsManager.get()` / `SettingsManager.save()` in `background.js`). Numeric fields are clamped with `Math.max`/`Math.min`. Screenshot `dataUrl` is validated with `dataUrl.startsWith('data:image/')` plus a regex before storage.

**Logging:** `console.log/warn/error` calls throughout `background.js` and content scripts use emoji prefixes: ✅ success, ❌ error, ⚠️ warning, 📸 screenshot, 📄 export, 🧹 cleanup, 🔄 recovery. `src/core/logger.js` exports a `Logger` class with `{ setLevel, debug, info, warn, error }` and `[TestSnapper]` prefix — auto-set to `'warn'` in production. The Logger is not yet universally adopted; direct `console.*` calls coexist.

**Theme:** Theme state is tracked via `document.body.dataset.theme` — NOT `classList`. The canonical check is `document.body.dataset.theme === 'dark'`. CSS uses `[data-theme="dark"]` attribute selectors.

**State machine:** Recording lifecycle states: `'idle'` → `'recording'` → `'paused'` → `'idle'` (or `'exporting'`). Step sequencing uses a promise-chain lock (`sequenceLock`) in `RecordingStateManager` to prevent race conditions.

### Key Abstractions

| Abstraction | What it does | Defined in |
|-------------|-------------|-----------|
| `StorageManager` | All CRUD for sessions/steps/assets via `chrome.storage.local`; compression, retry, quota, migration | `src/core/storage.js` |
| `FSStorageManager` | Proxy that routes calls to buffer or FileSync; same API as `StorageManager` — used by popup and review page | `src/core/fs-storage.js` |
| `ExportService` | Multi-format export (JSON, CSV, DOCX, PDF) with progress callbacks and cancellation | `src/core/export-service.js` |
| `SelectorEngine` | Generates and scores CSS/XPath selectors via 13 strategies; WeakMap cache | `src/content/selector.js` |
| `FieldNameResolver` | Resolves human-readable label for a DOM element via 9 ordered strategies | `src/content/field-name-resolver.js` |
| `Redactor` | Detects sensitive fields and masks PII before recording | `src/content/redactor.js` |
| `RecordingStateManager` | In-memory state machine for recording lifecycle with step sequencing lock | `background.js` (local class) |
| `Utils` | Shared helpers available as ES module export and `window.TestSnapperUtils` | `src/core/utils.js` |
| `ImageProcessor` | Compresses screenshots using OffscreenCanvas (service worker) or DOM canvas (window) | `src/core/image-processor.js` |
| `compress` / `decompress` | GZIP compress/decompress step arrays; auto-detects `COMPRESSED::GZIP::` prefix | `src/core/compression.js` |
| `QuotaMonitor` | Fires listeners at 80% (warning) and 95% (error) of `chrome.storage.local` usage | `src/core/quota-monitor.js` |
| `FileSync` | File System Access API wrapper — window contexts only, never import in `background.js` | `src/core/file-sync.js` |
| `deduplicateConsecutiveSteps` | Pure function removing consecutive duplicate steps before display or export | `src/core/step-utils.js` |
| `Logger` | Configurable log levels with `[TestSnapper]` prefix; silences debug/info in production | `src/core/logger.js` |

### Chrome Runtime Message API

**Popup → Background:**

| Action | Payload | Response |
|--------|---------|----------|
| `startRecording` | `{ tabInfo }` | `{ success, sessionId }` |
| `pauseRecording` | — | `{ success }` |
| `resumeRecording` | — | `{ success }` |
| `stopRecording` | — | `{ success, sessionId }` |
| `captureScreenshot` | — | `{ success, stepId }` |
| `getState` | — | `{ state, session, stepCount }` |
| `exportSession` | `{ sessionId, format }` | `{ success, filename }` |
| `getAllSessions` | — | `{ success, sessions[] }` |
| `deleteSession` | `{ sessionId }` | `{ success }` |
| `getSettings` / `saveSettings` | `{ settings }` | `{ success }` |
| `getStorageUsage` | — | `{ success, usage }` |
| `exportAllData` / `importAllData` | `{ data }` | `{ success }` |

**Background → UI broadcasts (no response):**

| Action | When sent |
|--------|-----------|
| `sessionDataChanged` | CRUD operations |
| `exportProgress` | During export |
| `storageQuotaWarning` | 80%+ threshold hit |
| `flushRecordingBuffer` | After recording stops |

---

## Domain Concepts

| Concept | What it is | Where in code | Relationships |
|---------|-----------|---------------|---------------|
| Session | A single recorded test run with metadata (URL, viewport, timestamps) | `testsnapper_sessions` key in `src/core/storage.js` | Has many Steps, has many Assets |
| Step | A single recorded user action (click, type, select, screenshot, navigate) | `testsnapper_steps_{sessionId}` in storage | Belongs to a Session; may have Assets |
| Asset | A screenshot stored as a `dataUrl` string tied to a Step | `testsnapper_assets_{sessionId}` in storage | Belongs to a Step — linked by `stepId` |
| Selector | `{ primary, alternatives[], all[], element: {tag, text, role, path} }` for locating a DOM element | `src/content/selector.js` | Used in Steps; `selector.css` is the primary locator |
| FieldName | Human-readable label for the interacted element (e.g. "Email Address") | Resolved by `FieldNameResolver` | Stored on Step as `step.fieldName` |
| Recording State | Lifecycle of a recording: idle → recording → paused → idle (or exporting) | `RecordingStateManager` in `background.js` | Controls badge, content script notifications, `activeRecording` persistence |
| Active Recording | Persisted snapshot of in-progress recording for crash recovery | `chrome.storage.local` key `'activeRecording'` | Written after every state change; read on service worker startup |
| Pending Flush | List of sessionIds recorded but not yet flushed to filesystem | `chrome.storage.local` key `'testsnapper_pendingFlush'`; `src/core/flush-utils.js` | Written on stop; consumed by popup/review to trigger FileSync flush |
| Modal Queue | Serialized queue of field-name entry dialogs injected into the page | `modalQueue` in `content.js` | Prevents race condition when multiple interactions need manual field name entry |
| Duplicate Detection | Two-layer dedup — at capture time (background) and display time (review page) | `_isConsecutiveDuplicate` in `background.js`; `src/core/step-utils.js` | `screenshot` and `navigate` actions are never deduplicated |
| Sequence | Monotonically increasing integer assigned to each step under a `sequenceLock` | `stateManager.stepSequence` in `background.js` | Used to re-sort steps after storage round-trips |

---

## Key Dependencies

| Package | Purpose |
|---------|---------|
| `webpack 5` + `babel-loader` | Bundles `background.js` so the service worker can use ES `import`. Only background is bundled; all other files are copied verbatim to `dist/`. |
| `copy-webpack-plugin` | Copies `src/content/`, `src/ui/`, `src/core/`, `libs/`, `docs/` into `dist/` unchanged. |
| `cross-env` | Makes `NODE_ENV=production` work on Windows, macOS, and Linux in npm scripts. |
| `libs/docx.min.js` (vendored) | Generates `.docx` files in the browser. Must be local — extension CSP blocks CDN scripts. Downloaded via `npm run setup-libs`. |
| `libs/html2pdf.bundle.min.js` (vendored) | Generates PDF files from HTML in the browser. Same CSP constraint. |
| `vitest` + `jsdom` | Unit test runner for `src/core/` utilities. Does not test chrome API interactions. |
| `@playwright/test` | End-to-end tests against the real extension in Chrome. |

---

## Common Pitfalls

1. **Using `let` or `const` at the top level of content scripts causes a silent SyntaxError on re-injection.** Content scripts can be injected multiple times. Always use `var` for top-level declarations in `src/content/`.

2. **Never import `dom-utils.js` in `background.js`.** `DomUtils.downloadFile` and `DomUtils.showMessage` both reference `document`, which does not exist in the service worker. This throws at module evaluation time.

3. **Screenshot assets must be stored as `dataUrl` strings, never as `Blob` objects.** `Blob` objects do not survive `chrome.storage.local` JSON serialization — they come back as `{}`. Always write `{ dataUrl: '...' }` to storage.

4. **Never store a regex with the `/g` flag on an instance property.** In `src/content/redactor.js`, PII patterns are stored without `/g`. Use `new RegExp(pattern.source, 'g')` inline — storing `/g` on a reused regex causes `lastIndex` to advance, producing false negatives on every second call.

5. **CDN fallback for DOCX and PDF libraries only works on regular web pages, not extension pages.** CSP blocks external scripts on extension pages. If `libs/docx.min.js` is missing from `dist/libs/`, the CDN fallback will silently fail. Always run `npm run setup-libs` before loading the extension.

6. **Content scripts load in injection order and `content.js` must come last.** The manifest declares: `selector.js` → `field-name-resolver.js` → `redactor.js` → `content.js`. `content.js` calls `new window.SelectorEngine()` etc. in `initModules()`. New content script dependencies must appear before `content.js` in the manifest.

7. **The extension loads from `dist/`, not `src/`.** Editing files in `src/` has no effect until you rebuild. Run `npm run dev` for watch mode or `npm run build:dev` for a one-off dev build.

8. **Never call `new StorageManager()` outside of `storage.js`.** Use the exported `storageManager` singleton in `background.js`, or `FSStorageManager` in popup/review page.

9. **Consecutive duplicate detection runs in two separate places.** `_isConsecutiveDuplicate` in `background.js` suppresses duplicates at capture time; `deduplicateConsecutiveSteps` in `src/core/step-utils.js` runs at display time. `screenshot` and `navigate` actions are excluded from deduplication in both layers.

10. **Theme state uses `document.body.dataset.theme`, not `classList`.** Checking `classList.contains('dark-mode')` will produce invisible UI bugs. The canonical check is `document.body.dataset.theme === 'dark'`.

---

## Recommended Reading Order

| # | File | Why read it |
|---|------|-------------|
| 1 | `manifest.json` | Source of truth for permissions, CSP, content script injection order — explains why many patterns exist |
| 2 | `src/background/background.js` | The "brain" — all recording orchestration, every message handler, session recovery |
| 3 | `src/content/content.js` | Most complex content script — event capture, modal queue, floating panel; demonstrates `var` and `window.*` patterns |
| 4 | `src/core/storage.js` | Split-key storage architecture; why 5 MB per-key quota forces the design |
| 5 | `src/core/fs-storage.js` | Storage proxy used by popup and review page — the "storage bridge" |
| 6 | `src/core/file-sync.js` | File System Access API wrapper; explains the dual-storage design (chrome.storage.local during recording, disk after stop) |
| 7 | `src/core/export-service.js` | Export orchestration across 5 formats; contains the `asset.dataUrl` vs `asset.blob` fix |
| 8 | `src/content/selector.js` | 13-strategy selector engine with scoring (ID=95, data-testid=90, XPath-absolute=10) |
| 9 | `src/content/field-name-resolver.js` | 9-strategy field name extractor; proximity scoring via `getBoundingClientRect` |
| 10 | `webpack.config.js` | Why only `background.js` is bundled; how `CopyPlugin` keeps `dist/` in sync with `src/` |
