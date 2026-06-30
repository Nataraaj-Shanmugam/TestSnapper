# TestSnapper - Chrome Extension for UI Test Recording

## Project Overview
TestSnapper is a Chrome browser extension (Manifest V3) that records UI test sessions with automated field name detection, multi-strategy selector generation, screenshot capture, and export to multiple formats (JSON, CSV, Markdown, DOCX, PDF).

## Build & Run
- **Install:** `npm install`
- **Setup (first time):** `npm run setup` (installs deps, downloads libs, builds)
- **Build (production):** `npm run build` — outputs to `dist/`
- **Build (dev):** `npm run build:dev`
- **Watch mode:** `npm run dev`
- **Clean:** `npm run clean`
- **Download libs:** `npm run setup-libs`
- **Load in Chrome:** `chrome://extensions` > "Load unpacked" > select `dist/` folder

## Architecture

### Manifest V3 Extension
- **Background:** Service worker (`src/background/background.js`) — ES module, handles recording state, screenshots, exports, session recovery
- **Content Scripts:** Injected into all pages at `document_end`, all frames
  - `src/content/selector.js` — Multi-strategy selector engine (CSS, XPath, framework-specific) with JSDoc
  - `src/content/redactor.js` — Privacy redaction for sensitive data (21 patterns)
  - `src/content/field-name-resolver.js` — Advanced field name extraction with 9 strategies
  - `src/content/content.js` — Event capture, floating panel, modal system
- **Popup UI:** `src/ui/popup/popup.js` — Extension popup with recording controls
- **Review UI:** `src/ui/review/review-standalone.js` — Full session review page with drag-and-drop reordering
- **Theme UI:** `src/ui/theme.js` — Shared theme management (light/dark modes)
- **Core Modules:**
  - `src/core/storage.js` — StorageManager with split-key architecture, quota monitoring, schema migration
  - `src/core/export-service.js` — Export orchestration with chunking, cancellation, screenshot processing
  - `src/core/image-processor.js` — Unified image processing (compression, format detection)
  - `src/core/orphan-cleaner.js` — Orphaned asset cleanup (weekly automatic)
  - `src/core/quota-monitor.js` — Storage quota monitoring with warnings
  - `src/core/schema-migrator.js` — Schema versioning and migration (v1 → v2)
  - `src/core/file-sync.js` — FileSystem Access API wrapper for file operations
  - `src/core/fs-storage.js` — Hybrid storage abstraction (chrome.storage + filesystem) with Proxy pattern
  - `src/core/logger.js` — Configurable logging with levels (debug, info, warn, error)
  - `src/core/compression.js` — GZIP compression via CompressionStream
  - `src/core/utils.js` — Shared pure utilities (UUID, escapeHtml, blobToDataURL)
  - `src/core/dom-utils.js` — DOM-dependent utilities (downloadFile, showMessage)
  - `src/core/flush-utils.js` — Shared flush coordination between storage and filesystem

### Build System
- Webpack 5 + Babel (targets Chrome 88+)
- `cross-env` for Windows/macOS/Linux compatibility
- CopyPlugin copies non-bundled source files to `dist/`
- Only background.js is bundled; content scripts and UI are copied as-is

## Key Patterns

### Storage
- Split-key architecture: `testsnapper_sessions`, `testsnapper_steps_{sessionId}`, `testsnapper_assets_{sessionId}`, `testsnapper_meta`
- `unlimitedStorage` permission for screenshot data (up to 1GB)
- Image compression via `ImageProcessor` (unified, centralized)
  - OffscreenCanvas for service worker context
  - DOM canvas fallback for window contexts
  - Edge detection for PNG/JPEG auto-selection
- GZIP compression for step data via `CompressionStream`
- Schema migration from v1 to v2 on init (delegated to `SchemaMigrator`)
- Quota monitoring with 80% warning and 95% critical thresholds (delegated to `QuotaMonitor`)
- Orphan cleanup runs weekly (delegated to `OrphanCleaner`)
- Batch operations: `batchUpdateSteps()`, `batchDeleteSteps()`
- Filesystem sync via `FSStorageManager` and `FileSync` (Manifest V3 File System Access API)
- Flush coordination across buffer and filesystem (via `flush-utils.js`)

### Content Scripts
- Use `var` (not `let`) for top-level declarations to avoid SyntaxError on re-injection
- AbortController for event listener cleanup
- Modal queue system for field name entry
- Toast notification system via `showToastNotification()`
- Navigation detection via polling interval (cleared on stop)

### Selector Engine
- Strategies: ID, data-testid, name, ARIA, placeholder, framework-specific (React, Vue, Angular, Svelte, Solid), class-based, XPath
- Auto-generated ID detection with allowlist for common meaningful prefixes
- SVG className handling (SVGAnimatedString.baseVal)
- WeakMap cache (auto-cleans on GC)
- Strategy scoring system with comprehensive score map

### Theme
- Uses `document.body.dataset.theme` for state tracking (not classList)
- Both `dark-mode` and `light-mode` CSS classes managed
- Pattern consistent between popup.js and review-standalone.js

### Export
- CDN fallback for docx and html2pdf libraries with SRI integrity hashes
- Local libs tried first (`libs/docx.min.js`, `libs/html2pdf.bundle.min.js`)
- DOCX fallback builds valid ZIP manually (no library needed)
- CSP on extension pages: `script-src 'self'` — CDN fallback only works on non-extension contexts

## Git Branching
- **Main branch:** `master`
- **Current version:** 1.1.5 (see `package.json`)
- **Branch naming:** `fix/` or feature prefixes (e.g., `fix/v1.1.6-parallel-fixes`)
- Versions are single-sourced from `package.json` and injected into `manifest.json` at build time

## Architecture Review & Refactoring
- `arch-review.md` — Comprehensive architecture audit (12 high/medium issues identified and resolved)
- `TODO.md` — Completion summary of all architectural fixes
- **All 12 high/medium severity issues resolved:**
  - HIGH-001: Image compression logic unified (ImageProcessor)
  - HIGH-002: Utility functions deduplicated (Utils, dom-utils)
  - HIGH-003: Storage layer inconsistency resolved (flush-utils)
  - HIGH-004: Content script global coupling protected (defensive guards)
  - MED-001: Orphan export.js removed
  - MED-002: StorageManager decomposed (quota-monitor, schema-migrator, orphan-cleaner)
  - MED-003: ExportService image logic extracted (ImageProcessor)
  - MED-004: storage.js moved to core/
  - MED-005: FSStorageManager boilerplate eliminated (Proxy pattern)
  - MED-006: Utils fan-in reduced (split into utils + dom-utils)
  - MED-007: Theme duplication resolved (theme.js)
  - MED-008: Console logging abstraction added (Logger)

## Documentation
- **Inline JSDoc Coverage:** ~95% (150+ methods documented across 7 core files)
- **Project Documentation:**
  - `README.md` — Main project documentation with features, installation, usage
  - `CLAUDE.md` — Developer project instructions and architecture (this file)
  - `onboard.md` — Comprehensive onboarding guide for new developers (generated)
  - `CONTRIBUTING.md` — Contribution guidelines and code style (generated)
  - `API.md` — Complete API reference with examples (generated)
  - `DEVELOPER_GUIDE.md` — Detailed development setup and workflow
- **Documentation Format:** JSDoc with @param, @returns, @throws, @example tags
- **Code Examples:** All major modules include usage examples

## Important Notes
- Never commit `node_modules/` changes
- Extension pages have strict CSP — external scripts won't load on extension pages
- Screenshots are stored as data URLs in chrome.storage.local
- Rate limiting: 1 second debounce on auto-screenshots; manual screenshots bypass rate limit
- Session recovery persists `activeRecording` state; cleans up on success/failure
- `notifications` permission used for recovery failure alerts
