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
  - `src/content/selector.js` — Multi-strategy selector engine (CSS, XPath, framework-specific)
  - `src/content/redactor.js` — Privacy redaction for sensitive data
  - `src/content/content.js` — Event capture, floating panel, modal system
- **Popup UI:** `src/ui/popup/popup.js` — Extension popup with recording controls
- **Review UI:** `src/ui/review/review-standalone.js` — Full session review page with drag-and-drop reordering
- **Storage:** `src/storage.js` — Split-key architecture using chrome.storage.local with quota monitoring
- **Export:** `src/export.js` — JSON, CSV, Markdown, DOCX (with ZIP fallback), PDF export
- **Export Service:** `src/core/export-service.js` — Orchestrator with chunking, cancellation, screenshot processing
- **Utils:** `src/core/utils.js` — Shared utilities (UUID, escapeHtml, blobToDataURL)

### Build System
- Webpack 5 + Babel (targets Chrome 88+)
- `cross-env` for Windows/macOS/Linux compatibility
- CopyPlugin copies non-bundled source files to `dist/`
- Only background.js is bundled; content scripts and UI are copied as-is

## Key Patterns

### Storage
- Split-key architecture: `testsnapper_sessions`, `testsnapper_steps_{sessionId}`, `testsnapper_assets_{sessionId}`, `testsnapper_meta`
- `unlimitedStorage` permission for screenshot data
- Image compression via OffscreenCanvas with standard canvas fallback
- Schema migration from v1 to v2 on init
- Orphan cleanup runs weekly
- Batch operations available: `batchUpdateSteps()`, `batchDeleteSteps()`

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
- **Current dev branch:** `V1.1.3`
- Branch naming: `V{major}.{minor}.{patch}`

## Bug Tracking
- `BUG_ENHANCEMENT_REPORT.md` — Comprehensive bug & enhancement report with status
- `BUG_FIX_TRACKER.md` — Concise tracker of remaining issues
- All Critical, High, and Security bugs are fixed as of v1.1.3
- 1 Medium remains: STR-MED-001 (step data compression — deferred)
- 20 Low enhancements deferred to v1.2.0+

## Important Notes
- Never commit `node_modules/` changes
- Extension pages have strict CSP — external scripts won't load on extension pages
- Screenshots are stored as data URLs in chrome.storage.local
- Rate limiting: 1 second debounce on auto-screenshots; manual screenshots bypass rate limit
- Session recovery persists `activeRecording` state; cleans up on success/failure
- `notifications` permission used for recovery failure alerts
