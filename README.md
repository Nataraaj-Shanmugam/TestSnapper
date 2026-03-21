# TestSnapper - Enterprise Test Automation Recorder

> Professional browser extension for automated test recording, documentation, and compliance

[![Version](https://img.shields.io/badge/version-1.1.3-blue.svg)](https://github.com/testsnapper/testsnapper)
[![Chrome](https://img.shields.io/badge/chrome-88%2B-brightgreen.svg)](https://www.google.com/chrome/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Build](https://img.shields.io/badge/build-passing-success.svg)](https://github.com/testsnapper/testsnapper/actions)

TestSnapper is an enterprise-grade Chrome extension that automatically captures user interactions, generates intelligent field names and selectors, captures high-quality screenshots, and exports comprehensive test documentation in multiple formats. Built for QA teams, developers, and compliance officers who need reliable, secure, and professional test documentation.

---

## 🌟 Why TestSnapper?

### For QA Teams
- **Zero Manual Documentation** - Automatically capture every interaction
- **Professional Reports** - Export to DOCX, PDF, CSV for stakeholders
- **Screenshot Evidence** - High-quality visual documentation of every step
- **Smart Field Detection** - Automatically identify form fields and buttons
- **Drag & Drop Editing** - Easily reorganize and refine test steps

### For Developers
- **Intelligent Selectors** - CSS, XPath, and framework-specific generation
- **JSON Export** - Integrate with Selenium, Playwright, Cypress
- **Session Recovery** - Continue recording after page refresh
- **Data Compression** - GZIP compression for efficient storage
- **Developer-Friendly** - Clean code structure, comprehensive API

### For Compliance & Documentation
- **Enhanced Privacy Protection** - 21 sensitive field patterns automatically redacted
- **Data Redaction** - SSN, credit cards, DOB, PINs, routing numbers
- **Audit Trail** - Complete session history with timestamps
- **Secure Storage** - CSP-protected, sanitized data handling
- **Archive-Ready** - Export to PDF for long-term compliance storage

---

## ✨ Key Features

### 🎬 Advanced Recording Engine
- **Lifecycle Control** - Start, Pause, Resume, Stop with keyboard shortcuts
- **Real-Time Capture** - Instant step recording with sub-second accuracy
- **Session Recovery** - Automatic session restoration after browser restart
- **Smart Deduplication** - Prevents duplicate interaction capture
- **Navigation Tracking** - Automatically captures page transitions
- **Modal Queue System** - Handles multiple field name prompts sequentially
- **Rate Limiting** - Prevents capture flooding (1s debounce, manual bypass)

### 🧠 Intelligent Selector Engine
- **Multi-Strategy CSS Selectors** - ID, class, attribute, semantic-based
- **XPath Generation** - Reliable fallback with position-based strategies
- **Framework Detection** - React, Vue, Angular, Svelte, Solid component recognition
- **Selector Scoring** - Chooses the most stable and maintainable selector
- **Text & ARIA Fallbacks** - Accessibility-first approach
- **Auto-ID Detection** - Recognizes meaningful auto-generated IDs

### 🏷️ Smart Field Name Extraction
Automatically extracts field names from:
- `<label>` associations (for/id matching)
- `aria-label` and `aria-labelledby` attributes
- `placeholder` text
- `name` and `id` attributes
- Parent element context (fieldset legends, table headers)
- **Manual Entry Modal** - Beautiful UI for manual field name input when auto-detection fails

### 🔒 Enterprise-Grade Security & Privacy

#### Enhanced Data Redaction (v1.1.3)
Protects **21 types of sensitive information**:
- **Financial**: Credit cards (16 digits), routing numbers, account numbers, CVV, bank details
- **Personal**: SSN (9 digits), DOB (multiple formats), driver's license, passport, tax ID/EIN
- **Authentication**: Passwords, PINs (4-6 digits), tokens, API keys, security codes
- **Contact**: Emails (partial masking: u***@domain.com), phone numbers (10 digits)

**Redaction Patterns:**
- Credit Cards: `•••• •••• •••• 1234` (last 4 visible)
- SSN: `•••-••-••••` (fully masked)
- DOB: `••/••/••••` (fully masked)
- Passwords: `••••••••` (fully masked)
- Emails: `u***@example.com` (first char + domain visible)

#### Security Hardening
- ✅ **Content Security Policy (CSP)** - Prevents XSS attacks on all extension pages
- ✅ **Input Sanitization** - Session names cleaned of control characters
- ✅ **Data Validation** - Settings, screenshots, filenames validated before storage
- ✅ **Subresource Integrity (SRI)** - Infrastructure ready for CDN libraries with integrity hashes
- ✅ **Secure Storage** - Chrome storage API with quota management, no external servers
- ✅ **GZIP Compression** - Step data compressed using native CompressionStream API

### 📸 Screenshot Management
- **Auto-Capture** - Configurable interval (5-60 seconds)
- **Manual Capture** - On-demand screenshots with button/keyboard shortcut (Ctrl+Shift+S)
- **Navigation Capture** - Automatic screenshot before page navigation
- **High-Quality** - JPEG 95% quality, optimized for documentation
- **Smart Compression** - OffscreenCanvas with fallback (1200x900 for exports)
- **Rate Limiting** - 1 second debounce on auto-screenshots (manual bypass)
- **Storage Optimization** - Images compressed at capture time

### 📝 Professional Review & Editing
- **Rich Standalone UI** - Full-screen card-based editor with refined theme
- **Expanded Screenshots** - Always-on high-quality preview
- **Drag & Drop Reordering** - Visual step reorganization with undo support
- **Inline Editing** - Modify field names, values, selectors, notes
- **Bulk Operations** - Multi-select delete, filter by action type (click, type, navigate)
- **Manual Step Addition** - Insert custom steps with description and screenshot
- **Advanced Search** - Filter steps by action, field name, or value
- **Theme Toggle** - Professional light mode / nerdy dark terminal mode
- **Session Management** - Rename, delete, clear all sessions
- **Undo/Redo** - Revert accidental deletions or changes

### 🎨 Refined Professional Theme (v1.1.3)
- **Light Mode**: Sophisticated, age-friendly interface with clear structure
  - Refined blue accent (#4f7cbb) - comfortable for all ages
  - 2-3px borders for clear definition
  - Colored left accents on cards
  - High contrast (WCAG AAA)
  - Perfect for 50+ year old users

- **Dark Mode**: Bold terminal-precision aesthetic
  - Neon cyan accent (#00ffcc)
  - Sharp geometric corners
  - Scanline CRT overlay
  - Glowing neon effects
  - Perfect for developer enthusiasts

### 📤 Multi-Format Export

#### DOCX (Microsoft Word)
- Professional document layout with full-width screenshots
- Metadata header (session name, date, step count, duration)
- Structured step-by-step format with numbered sections
- Compatible with Word 2016+, Google Docs, LibreOffice
- CDN fallback with manual ZIP generation if library unavailable

#### PDF (Portable Document)
- Print-ready professional layout
- Optimized for archival and compliance
- 0.5" margins, US letter format (8.5" x 11")
- High-quality embedded images (92% JPEG quality)
- Font: Helvetica for universal compatibility

#### CSV (Excel Compatible)
- **10 columns**: Step, Timestamp, Action, Field Name, CSS Selector, XPath, Text, Value, URL, Notes
- Import into Excel, Google Sheets, or test management tools (TestRail, Zephyr, qTest)
- Perfect for bulk analysis and reporting
- Escaped commas and quotes for reliability

#### JSON (Developer Format)
- Complete session data with metadata
- All selectors (CSS, XPath, text, role, data attributes)
- Timestamp precision (ISO 8601 format)
- API-ready structure for test automation frameworks
- Selenium/Playwright/Cypress integration

#### Markdown (Text Summary)
- Human-readable step summary
- Code blocks for selectors
- Quick documentation format
- GitHub-flavored markdown

### 💾 Advanced Storage Management
- **Chrome Storage API** - Reliable local storage (chrome.storage.local)
- **Split-Key Architecture** - Sessions, steps, assets stored separately for performance
- **Quota Monitoring** - Real-time storage usage indicator (80% warning, 95% critical)
- **UnlimitedStorage Permission** - Up to 1GB quota, 10MB fallback without permission
- **Automatic Cleanup** - Orphaned screenshots removed every 7 days
- **Session Limits** - Configurable max sessions (default: 25, range: 10-100)
- **GZIP Compression** - Step data compressed using native CompressionStream API (v1.1.3)
- **Image Compression** - OffscreenCanvas with fallback to standard canvas
- **Schema Migration** - Automatic data structure upgrades (v1 → v2)
- **Batch Operations** - `batchUpdateSteps()`, `batchDeleteSteps()` for performance

### ⚙️ Configurable Settings
- **Screenshot Interval** - 5-60 seconds for auto-capture
- **Image Quality** - 85-95% JPEG compression (default: 92%)
- **Max Sessions** - 10-100 session limit (default: 25)
- **Auto-Save** - Automatic session persistence (enabled by default)
- **Smart Deduplication** - Prevent duplicate captures (enabled by default)
- **Navigation Screenshots** - Capture before page changes (enabled by default)
- **Export Format Preference** - Persists last selected format
- **Backup/Restore** - Export all sessions to JSON backup file

### ⌨️ Keyboard Shortcuts
- **Ctrl+Shift+S** (Cmd+Shift+S on Mac) - Capture screenshot
- **Ctrl+Shift+U** (Cmd+Shift+U on Mac) - Pause/Resume recording
- **Ctrl+Shift+E** (Cmd+Shift+E on Mac) - Stop recording

---

## 🔧 Installation

### Option 1: Chrome Web Store (Recommended)
1. Visit [TestSnapper on Chrome Web Store](https://chromewebstore.google.com/detail/testsnapper/bmfadpkojaocmadfomifleaghfnipala) *(Coming Soon)*
2. Click "Add to Chrome"
3. Grant required permissions
4. Click the TestSnapper icon in toolbar to start

### Option 2: Developer Mode (Latest Version)

#### Prerequisites
- Chrome 88+ or Edge 88+
- Node.js 16+ and npm (for building from source)

#### Build from Source
```bash
# Clone repository
git clone https://github.com/Nataraaj-Shanmugam/TestSnapper
cd testsnapper

# Install dependencies
npm install

# Download required libraries (docx, html2pdf)
npm run setup-libs

# Build extension
npm run build

# Output will be in dist/ folder
```

#### Load in Chrome
1. Open Chrome and navigate to `chrome://extensions`
2. Enable "Developer mode" (top-right toggle)
3. Click "Load unpacked"
4. Select the `dist/` folder from the build output
5. TestSnapper icon will appear in your toolbar

---

## 📖 Quick Start

### 1. Start Recording
- Click TestSnapper icon in toolbar
- Click "Start" button (or press Ctrl+Shift+U)
- Navigate and interact with your web application
- TestSnapper captures all clicks, typing, navigation

### 2. Capture Screenshots
- **Automatic**: Enable in Settings → "Auto-Capture Screenshots" (5-60s interval)
- **Manual**: Click "Capture Screenshot" button (or press Ctrl+Shift+S)
- **On Navigation**: Automatic screenshot before page changes (enabled by default)

### 3. Stop & Review
- Click "Stop" button (or press Ctrl+Shift+E)
- Click "View Steps" to open Review page
- **Edit**: Click any field to modify
- **Reorder**: Drag steps up/down
- **Delete**: Select multiple steps and click "Delete Selection"
- **Add**: Click "+ Add Manual Step" to insert custom steps

### 4. Export Documentation
- Select export format: DOCX, PDF, CSV, or JSON
- Click "Export Documentation"
- File downloads automatically with session name and timestamp

---

## 📚 Use Cases

### QA & Test Documentation
1. **Manual Test Case Creation**
   - Record user flow
   - Add manual steps for assertions/verifications
   - Export to DOCX for test case documentation
   - Share with team or upload to test management tool

2. **Bug Reproduction Steps**
   - Record bug scenario
   - Capture screenshots of error states
   - Export to PDF for bug ticket attachment
   - Developers can see exact steps + screenshots

3. **User Acceptance Testing (UAT)**
   - Record UAT sessions
   - Document all test scenarios
   - Export to CSV for reporting
   - Track coverage and completion

### Developer Workflows
1. **Test Automation Script Generation**
   - Record user flow
   - Export to JSON
   - Use selectors (CSS/XPath) in Selenium/Playwright scripts
   - Accelerate test automation development

2. **API Documentation**
   - Record interactions that trigger API calls
   - Capture request/response in notes
   - Export to Markdown for API docs
   - Document workflows with screenshots

3. **Code Review & Debugging**
   - Record steps to reproduce issue
   - Share JSON with developers
   - Exact selectors for debugging
   - Visual proof of problem

### Compliance & Audit
1. **SOC 2 / ISO 27001 Evidence**
   - Record security testing procedures
   - Export to PDF for audit evidence
   - Timestamped audit trail
   - Privacy redaction ensures no sensitive data leakage

2. **Regulatory Compliance Testing**
   - Document compliance verification steps
   - Export to DOCX for compliance reports
   - Screenshot evidence of controls
   - Archive-ready documentation

3. **Training & Onboarding**
   - Record system workflows
   - Export to PDF for training materials
   - Visual step-by-step guides
   - Reduce onboarding time

---

## 🏗️ Architecture

### Technology Stack
- **Manifest**: V3 (Chrome Extensions)
- **Background**: Service Worker (ES modules, bundled by Webpack)
- **Content Scripts**: Vanilla JavaScript (injected at document_end, all frames)
- **UI**: HTML/CSS/JavaScript (no frameworks for minimal footprint)
- **Build**: Webpack 5 + Babel (targets Chrome 88+)
- **Storage**: chrome.storage.local (split-key architecture with 40-60% compression)
- **Compression**: Native CompressionStream API (GZIP)
- **File System**: File System Access API (Manifest V3)
- **Export Libraries**: docx.js 7.8.2, html2pdf.js 0.10.1 (CDN with local fallback, SRI integrity)
- **Documentation**: JSDoc (150+ methods documented, ~95% coverage)

### File Structure
```
testsnapper-extension/
├── manifest.json                 # Extension manifest (V3)
├── src/
│   ├── background/
│   │   └── background.js         # Service worker (bundled by webpack)
│   ├── content/
│   │   ├── selector.js           # Selector generation engine (13+ strategies, fully documented)
│   │   ├── redactor.js           # Privacy/redaction module (21 sensitive patterns)
│   │   ├── field-name-resolver.js # Field name extraction (9+ strategies)
│   │   └── content.js            # Event capture + floating panel + modals
│   ├── core/
│   │   ├── storage.js            # StorageManager (28+ documented methods)
│   │   ├── export-service.js     # Export orchestration (13+ documented methods)
│   │   ├── fs-storage.js         # Hybrid storage with Proxy pattern (35+ methods)
│   │   ├── file-sync.js          # FileSystem Access API wrapper (25+ methods)
│   │   ├── image-processor.js    # Unified image processing (NEW)
│   │   ├── orphan-cleaner.js     # Orphaned asset cleanup (NEW, extracted from StorageManager)
│   │   ├── quota-monitor.js      # Storage quota tracking (NEW, extracted from StorageManager)
│   │   ├── schema-migrator.js    # Schema versioning (NEW, extracted from StorageManager)
│   │   ├── logger.js             # Configurable logging (NEW)
│   │   ├── dom-utils.js          # DOM-dependent utilities (NEW, split from utils.js)
│   │   ├── flush-utils.js        # Shared flush coordination (NEW)
│   │   ├── utils.js              # Pure shared utilities (refactored)
│   │   └── compression.js        # GZIP compression
│   ├── ui/
│   │   ├── popup/                # Extension popup
│   │   │   ├── popup.html
│   │   │   ├── popup.css
│   │   │   └── popup.js
│   │   ├── review/               # Review page
│   │   │   ├── review-standalone.html
│   │   │   ├── review-standalone.css
│   │   │   └── review-standalone.js
│   │   └── theme.js              # Shared theme logic (NEW)
│   └── assets/icons/             # Extension icons (16, 48, 128)
├── libs/                         # Third-party libraries (downloaded)
│   ├── docx.min.js
│   └── html2pdf.bundle.min.js
├── webpack.config.js             # Build configuration
├── package.json                  # NPM dependencies
├── onboard.md                    # Developer onboarding guide
├── CONTRIBUTING.md               # Contribution guidelines
├── API.md                        # API reference
└── TODO.md                       # Architecture refactoring completion summary
```

### Key Modules

#### Selector Engine (`src/content/selector.js`)
Generates selectors using 13+ strategies with intelligent scoring:
1. ID (100 points) - Stable, unique identifiers
2. data-testid (95 points) - QA-specific attributes
3. name attribute (90 points) - Form field names
4. ARIA attributes (85 points) - Accessibility-first
5. Framework-specific (80 points) - React/Vue components
6. Class-based (70 points) - Semantic classes
7. Text content (60 points) - Fallback
8. XPath (50 points) - Position-based fallback
9. WeakMap caching for performance
10. Strategy deduplication

**Fully documented:** 30+ methods with JSDoc, examples

#### Storage Architecture (`src/core/storage.js`)
Split-key architecture with extracted responsibilities:
- `testsnapper_sessions` - Session metadata
- `testsnapper_steps_{sessionId}` - Step data per session (GZIP compressed)
- `testsnapper_assets_{sessionId}` - Screenshots per session (JPEG compressed)
- `testsnapper_meta` - Global metadata, schema version, cleanup timestamp

**Key Components** (v1.1.3+):
- **StorageManager** - Core CRUD operations (28+ documented methods)
- **QuotaMonitor** - 80% warning, 95% critical thresholds (extracted)
- **SchemaMigrator** - v1 → v2 migration (extracted)
- **OrphanCleaner** - Weekly asset cleanup (extracted)
- **ImageProcessor** - Unified image handling (extracted, centralized)
- **CompressionStream** - GZIP compression via native API
- **FSStorageManager** - Hybrid storage (chrome.storage + filesystem)

**Compression** (v1.1.3):
- Step data: GZIP via CompressionStream (40-60% savings)
- Screenshots: JPEG 92% quality, OffscreenCanvas with DOM fallback
- Total storage reduction: 40-60%

#### Export Service (`src/core/export-service.js`)
Orchestrates export operations with performance optimization:
- Chunked processing (100 steps at a time)
- Progress tracking (0-100%)
- Cancellation support mid-export
- Screenshot processing with `ImageProcessor`
- CDN fallback for DOCX/PDF libraries with SRI integrity
- Manual ZIP generation fallback for DOCX
- 13+ fully documented methods

#### Image Processor (`src/core/image-processor.js`) - NEW
Unified image processing eliminates duplication:
- Canvas/OffscreenCanvas abstraction
- Format auto-detection with edge density analysis
- Supports both Blob and dataURL inputs
- Step-down scaling, quality tuning
- Used by both StorageManager and ExportService

#### Orphan Cleaner (`src/core/orphan-cleaner.js`) - NEW
Extracted from StorageManager for better cohesion:
- Finds assets referencing non-existent steps
- Removes orphaned assets
- Runs automatically weekly
- Updates metadata timestamps

#### Logger (`src/core/logger.js`) - NEW
Configurable logging abstraction:
- Log levels: debug, info, warn, error
- Production/development mode detection
- Consistent logging across all modules
- Replaces 180+ console calls throughout codebase

---

## 🔐 Security & Privacy

### Data Handling
- ✅ **Local-Only Storage** - All data stored in chrome.storage.local, never sent to external servers
- ✅ **No Analytics** - Zero tracking, no telemetry, no data collection
- ✅ **No External Connections** - Except CDN fallback for export libraries (user-initiated)
- ✅ **Sensitive Data Redaction** - Automatic masking of 21 types of sensitive information
- ✅ **Content Security Policy** - XSS protection on all extension pages

### Permissions Explained
| Permission | Purpose | Required |
|------------|---------|----------|
| `tabs` | Get tab information (URL, title) for session context | Yes |
| `activeTab` | Access current tab for interaction capture | Yes |
| `storage` | Save sessions and settings locally | Yes |
| `downloads` | Export documentation files | Yes |
| `scripting` | Inject content scripts for event capture | Yes |
| `unlimitedStorage` | Store large screenshot datasets (up to 1GB) | Yes |
| `notifications` | Session recovery alerts | Yes |
| `<all_urls>` | Record interactions on any website | Yes |

**Note:** `file:///*` access requires manual opt-in in chrome://extensions

### Compliance
- **GDPR Ready** - No personal data sent externally, user controls all data
- **HIPAA Compatible** - Sensitive health information redacted automatically
- **PCI DSS Aligned** - Credit card numbers masked
- **SOC 2** - Secure data handling practices

---

## 🛠️ Development

### Prerequisites
- Node.js 16+ and npm
- Chrome 88+ or Edge 88+
- Git

### Development Setup
```bash
# Clone repository
git clone https://github.com/Nataraaj-Shanmugam/TestSnapper
cd testsnapper

# Install dependencies
npm install

# Download libraries
npm run setup-libs

# Development build (with source maps)
npm run build:dev

# Watch mode (auto-rebuild on changes)
npm run dev

# Production build
npm run build

# Clean dist folder
npm run clean
```

### Project Scripts
- `npm run build` - Production build (minified, optimized)
- `npm run build:dev` - Development build (source maps, not minified)
- `npm run dev` - Watch mode (auto-rebuild on file changes)
- `npm run clean` - Remove dist/ folder
- `npm run setup-libs` - Download third-party libraries
- `npm run setup` - Complete setup (install + download + build)

### Testing
```bash
# Load extension in Chrome
1. npm run build
2. chrome://extensions
3. Enable Developer Mode
4. Load unpacked → select dist/

# Test workflow
1. Start recording on a test site
2. Perform interactions (click, type, navigate)
3. Stop recording
4. Review steps
5. Export to all formats
6. Verify exported files
```

### Documentation
- **JSDoc Coverage**: ~95% (150+ methods with full parameter and return documentation)
- **Code Examples**: All major modules include usage examples
- **Onboarding Guide**: `onboard.md` — Complete guide for new developers
- **API Reference**: `API.md` — Full API documentation with examples
- **Contributing Guide**: `CONTRIBUTING.md` — Code style, patterns, and PR process
- **Architecture**: `arch-review.md` — Complete architecture audit and refactoring summary

### Code Quality
- **Documentation**: JSDoc with @param, @returns, @throws, @example tags
- **Chrome DevTools** - Debugging service worker and content scripts
- **Module Organization** - Clear separation of concerns with single-responsibility modules
- **Type Safety** - JSDoc type annotations for better IDE support

---

## 🐛 Troubleshooting

### Extension Not Working
**Issue:** Extension icon grayed out or not responding
**Fix:**
1. Check Chrome version is 88+
2. Refresh extension: chrome://extensions → Reload
3. Check browser console for errors (F12 → Console)
4. Try restarting Chrome

### Screenshots Not Capturing
**Issue:** Screenshots are missing or blank
**Fix:**
1. Check "Auto-Capture Screenshots" is enabled in Settings
2. Ensure tab has focus (chrome API requires active tab)
3. Check storage quota: chrome://extensions → Details → Storage
4. Try manual capture (Ctrl+Shift+S)

### Export Failing
**Issue:** Export button does nothing or shows error
**Fix:**
1. Check downloads permission granted
2. Verify session has steps (can't export empty session)
3. For DOCX/PDF: ensure libraries downloaded (`npm run setup-libs`)
4. Check browser console for errors
5. Try CSV/JSON export (no libraries required)

### Storage Full
**Issue:** "Storage quota exceeded" error
**Fix:**
1. Delete old sessions: Export Tab → Storage Management → Clear All
2. Reduce screenshot frequency: Settings → Auto-Capture interval
3. Lower image quality: Settings → Image Quality → 85%
4. Check chrome://quota-internals/ for actual usage

### File:// Access Not Working
**Issue:** Extension doesn't work on local HTML files
**Fix:**
1. Go to chrome://extensions
2. Find TestSnapper
3. Click "Details"
4. Enable "Allow access to file URLs"

---

## 📊 Version History

### v1.1.5 (2026-03-21) - Architecture Refactoring & Full Documentation
**Architecture Improvements:**
- ✅ Resolved all 12 high/medium severity architectural issues (arch-review)
- 🏗️ Extracted ImageProcessor for unified image handling (HIGH-001)
- 🏗️ Decomposed StorageManager into focused modules:
  - QuotaMonitor (quota tracking)
  - SchemaMigrator (schema versioning)
  - OrphanCleaner (asset cleanup)
- 🏗️ Implemented Proxy pattern for FSStorageManager (MED-005)
- 🏗️ Split utils into pure/DOM utilities (MED-006)
- 🏗️ Consolidated flush coordination (HIGH-003)
- 🏗️ Extracted shared theme logic (MED-007)
- 🏗️ Added logger abstraction (MED-008)

**Documentation (Phase 5 Complete):**
- 📚 95% JSDoc coverage (150+ methods documented)
- 📚 200+ JSDoc blocks added to 7 core modules
- 📚 Comprehensive onboarding guide for developers
- 📚 Complete API reference documentation
- 📚 Contribution guidelines and code style

**Code Quality:**
- ✅ No breaking changes to public APIs
- ✅ Build successful with 0 errors
- ✅ All modules have clear, single responsibilities
- ✅ Reduced code duplication significantly
- ✅ 8 new focused, well-documented modules

### v1.1.3 (2026-02-08)
**Major Features:**
- GZIP compression for step data (40-60% storage savings)
- Refined professional light theme (age-friendly, WCAG AAA)
- Bold dark terminal theme (developer-focused)
- Enhanced privacy redaction (21 patterns)
- Backup/Restore functionality
- Undo/Redo support in review page
- Advanced search and filtering

### v1.1.2 (2026-01-28)
- UI revamp with modern design system
- Floating panel improvements
- Modal system enhancements
- Theme toggle support

### v1.1.0 (2025-12-15)
- Session recovery after browser restart
- Enhanced selector scoring
- CSV export improvements
- Storage quota monitoring

### v1.0.0 (2025-11-30) - Initial Release
- Core recording functionality
- Multi-format export (DOCX, PDF, JSON, CSV)
- Screenshot capture
- Basic privacy redaction

---

## 🤝 Contributing

We welcome contributions! Please see [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) for:
- Code style guidelines
- Pull request process
- Testing requirements
- Architecture documentation

---

## 📄 License

MIT License - See [LICENSE](LICENSE) file for details

---

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/Nataraaj-Shanmugam/TestSnapper/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Nataraaj-Shanmugam/TestSnapper/discussions)

---

## 🙏 Acknowledgments

- **docx.js** - Microsoft Word document generation
- **html2pdf.js** - PDF export functionality
- **Chrome Extensions Team** - Excellent documentation and APIs

---

## 🔮 Roadmap

### v1.2.0 (Q2 2026)
- [ ] Cloud sync (optional, encrypted)
- [ ] Team collaboration features
- [ ] Playwright/Selenium script generation
- [ ] API testing support
- [ ] Custom assertions

### v1.3.0 (Q3 2026)
- [ ] Firefox support
- [ ] Safari support
- [ ] Mobile recording (Chrome Android)
- [ ] Video recording
- [ ] AI-powered test suggestions

---

**Made with ❤️ for QA professionals, developers, and testers worldwide**

*TestSnapper - Because testing documentation shouldn't be a test of patience*
