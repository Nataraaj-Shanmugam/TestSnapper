# TestSnapper

[![Version](https://img.shields.io/badge/version-1.1.9-blue.svg)](https://github.com/Nataraaj-Shanmugam/TestSnapper/releases)
[![Chrome](https://img.shields.io/badge/chrome-105%2B-brightgreen.svg)](https://chromewebstore.google.com/detail/testsnapper/bmfadpkojaocmadfomifleaghfnipala)
[![Manifest](https://img.shields.io/badge/manifest-v3-informational.svg)](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

A Chrome extension that records what you do on a web page — clicks, typing, navigation and screenshots — and turns it into step-by-step test documentation you can export to Word, PDF, CSV, JSON or Markdown.

Each recorded step gets a human-readable field name and (optionally) a screenshot. Sensitive values such as passwords, card numbers and SSNs are masked before they are stored. Everything stays on your machine.

**Who it's for:** QA engineers writing manual test cases or bug reports, and developers who want a structured record of a test run.

---

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Features](#features)
- [Privacy and permissions](#privacy-and-permissions)
- [Development](#development)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Version history](#version-history)
- [Further documentation](#further-documentation)
- [License](#license)

---

## Install

### From the Chrome Web Store

Install [TestSnapper from the Chrome Web Store](https://chromewebstore.google.com/detail/testsnapper/bmfadpkojaocmadfomifleaghfnipala), then pin it to the toolbar.

### From source

Requires Chrome 105+ (or another Chromium browser), Node.js 18+ and npm.

```bash
git clone https://github.com/Nataraaj-Shanmugam/TestSnapper.git
cd TestSnapper
npm install
npm run build
```

Then load it:

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select the `dist/` folder.

To record on local `file://` pages, open the extension's **Details** page and turn on **Allow access to file URLs**.

---

## Quick start

1. **Record** — Open the page you want to test, click the TestSnapper icon and press **Start**. Interact with the page as normal; each action appears under **Live Steps**.
2. **Screenshot** — Press `Ctrl+Shift+S` (`⌘⇧S` on Mac) for a manual screenshot, or turn on auto-capture in **Settings**.
3. **Pause / stop** — `Ctrl+Shift+U` pauses and resumes; `Ctrl+Shift+E` stops.
4. **Review** — Click **View Steps** in the popup to open the review page. There you can rename steps, edit values, reorder by drag and drop, delete, add manual steps, and undo changes.
5. **Export** — Pick a format in **Session details and export**, choose a screenshot size, and export. The file is named after the session.

If TestSnapper can't work out a field's name, it asks you. Skipping the prompt keeps the step as "Unnamed field".

For a guided walkthrough, see [QUICK_START.md](QUICK_START.md).

---

## Features

### Recording

- Captures clicks, typing, selects, checkboxes, form submits, key presses and page navigation, in all frames.
- Works across page reloads and navigations within the same tab; an interrupted session is flagged for recovery rather than lost.
- Smart duplicate detection collapses accidental double events while keeping deliberate repeated clicks (for example "Next page").
- Optional **API call capture** records XHR/fetch requests on the recorded tab as steps — method, URL and status only, never request or response bodies. Choose all requests or failures only (HTTP ≥ 400 / network errors).

### Field names

- Field names come from labels, ARIA attributes, placeholders, `name`/`id`, and surrounding context (legends, table headers); you are prompted only when none is found.
- Internally, each element is also identified by a scored CSS/XPath selector (ID, `data-testid`, `name`, ARIA, framework hints, classes), which drives duplicate detection. Since 1.1.6 selectors are not shown on the review page or included in exports.

### Screenshots

- Manual (shortcut or button), on navigation, or automatic every 1–60 seconds.
- PNG (lossless) or high-quality JPEG capture.
- Screenshots are skipped while a password or payment field has focus.

### Review page

- Card and table views, filtering by action type, and search.
- Inline editing, drag-and-drop reordering, bulk delete, manual steps and undo.
- **Privacy Audit** report showing what was redacted.
- Export preview of the first five steps.

### Export formats

| Format | Contents |
|---|---|
| **Word (.docx)** | Session details (name, author, start/end time) and numbered steps with embedded screenshots. Falls back to an HTML-based `.doc` if the bundled library can't load. |
| **PDF** | Same layout as Word, A4 portrait. |
| **CSV** | Columns: Step, Action, Field Name, Value, URL. Screenshot-only steps are omitted. |
| **JSON** | Full session and step data (action, field, value, URL, timings, environment) for scripts and imports. |
| **Markdown** | Plain-text step list. |

Screenshots in Word/PDF exports can be full size, 800 px or 400 px wide, at Auto, High or Standard image quality.

### Settings and storage

- Profiles (**Fast** — fewest screenshots, **Documentation** — most evidence, or **Custom**), with settings export and import.
- Keep or discard recordings after stopping; keep the newest 10, 25, 50 or 100 sessions.
- Storage breakdown, clean-up of sessions older than 30 days, and full backup / restore to a JSON file.
- **File Sync**: optionally save sessions to a folder you choose (File System Access API).
- Light and dark themes.

### Keyboard shortcuts

| Action | Windows / Linux | Mac |
|---|---|---|
| Capture screenshot | `Ctrl+Shift+S` | `⌘⇧S` |
| Pause / resume recording | `Ctrl+Shift+U` | `⌘⇧U` |
| Stop recording | `Ctrl+Shift+E` | `⌘⇧E` |

Change them at `chrome://extensions/shortcuts`.

---

## Privacy and permissions

- **Local only.** Sessions, steps and screenshots are kept in `chrome.storage.local` (and your chosen sync folder, if enabled). Nothing is sent to a server, and there is no analytics or telemetry.
- **No remote code.** The DOCX and PDF libraries are bundled in `libs/` and verified by SHA-384 hash.
- **Redaction.** Values typed into sensitive fields (passwords, PINs, card numbers, CVC, SSN, date of birth, account and routing numbers, tokens and similar) are masked at capture time. Emails, phone numbers, card numbers, SSNs and dates of birth are also masked when they appear in other text.

See [PRIVACY_POLICY.md](PRIVACY_POLICY.md) for the full policy.

| Permission | Why it's needed |
|---|---|
| `tabs`, `activeTab` | Read the recorded tab's URL and title, and capture its screenshots |
| `scripting` | Inject the recorder into pages |
| `storage`, `unlimitedStorage` | Store sessions and screenshots locally |
| `downloads` | Save exported files |
| `notifications` | Tell you if a session couldn't be recovered |
| `webRequest` | Optional API call capture (off by default) |
| `<all_urls>` | Record on any site you choose to test |

---

## Development

```bash
npm install          # install dev dependencies
npm run build:dev    # development build with source maps → dist/
npm run dev          # rebuild on change
npm run build        # production build → dist/
```

After a rebuild, click **Reload** on the extension in `chrome://extensions`.

| Script | Purpose |
|---|---|
| `npm run build` / `build:dev` / `dev` | Production build, development build, watch mode |
| `npm run clean` | Delete `dist/` |
| `npm run setup-libs` | Verify the bundled libraries in `libs/` against their SHA-384 hashes, downloading any that are missing |
| `npm run setup` | `npm install` + `setup-libs` + `build` |
| `npm test` | Unit tests (Vitest + jsdom) |
| `npm run test:watch` / `test:coverage` | Unit tests in watch mode / with coverage |
| `npm run test:e2e` | End-to-end tests (Playwright, loads the built extension) |
| `npm run test:e2e:report` | Open the last Playwright report |
| `npm run site:screens` | Re-capture the GitHub Pages walkthrough screenshots and sample exports from `dist/` |

Build `dist/` before running the end-to-end tests or `site:screens`. The website in `docs/` plays the screenshots and samples listed in `docs/site-data.js`; re-run `npm run build && npm run site:screens` after UI changes so the site matches the extension. For release packaging, see [release/RELEASE_GUIDE.md](release/RELEASE_GUIDE.md).

### How it fits together

- **Background service worker** (`src/background/background.js`, the only file bundled by webpack) owns recording state, screenshots, API call capture, exports and session recovery.
- **Content scripts** (`src/content/`) are injected into every frame at `document_end`. They capture events, resolve field names, build selectors, redact values and show the in-page panel and prompts. They are plain scripts that use `var` at top level so re-injection doesn't throw.
- **Popup and review page** (`src/ui/`) are plain HTML/CSS/JS under a strict `script-src 'self'` CSP.
- **Core modules** (`src/core/`) are shared by the service worker and the UI.

Storage uses split keys — `testsnapper_sessions`, `testsnapper_steps_{sessionId}` (GZIP-compressed), `testsnapper_assets_{sessionId}` (screenshots) and `testsnapper_meta` — with schema migration on start-up, quota warnings at 80% and 95%, and a weekly orphaned-asset clean-up.

---

## Project structure

```
├── manifest.json
├── src/
│   ├── background/background.js     # Service worker
│   ├── content/
│   │   ├── content.js               # Event capture, floating panel, prompts
│   │   ├── selector.js              # Selector generation and scoring
│   │   ├── field-name-resolver.js   # Field name extraction
│   │   ├── redactor.js              # Sensitive-value masking
│   │   └── logger.js                # Logger for content scripts
│   ├── core/
│   │   ├── storage.js               # StorageManager (split-key storage)
│   │   ├── fs-storage.js            # chrome.storage + folder sync
│   │   ├── file-sync.js             # File System Access API wrapper
│   │   ├── flush-utils.js           # Write-flush coordination
│   │   ├── export-service.js        # DOCX / PDF / CSV / JSON / Markdown export
│   │   ├── image-processor.js       # Screenshot compression and resizing
│   │   ├── compression.js           # GZIP via CompressionStream
│   │   ├── schema-migrator.js       # Storage schema migration
│   │   ├── quota-monitor.js         # Storage quota warnings
│   │   ├── orphan-cleaner.js        # Weekly orphaned-asset clean-up
│   │   ├── privacy-utils.js         # URL and value sanitising
│   │   ├── recorder-utils.js        # Recording helpers (dedup, API call rules)
│   │   ├── step-utils.js            # Step helpers
│   │   ├── logger.js                # Logger
│   │   └── utils.js                 # Shared utilities
│   ├── ui/
│   │   ├── popup/                   # Toolbar popup
│   │   ├── review/                  # Review & export page
│   │   ├── theme.js, theme-init.js  # Light/dark theme
│   └── assets/icons/
├── libs/                            # Bundled docx.js 7.8.2 and jsPDF 2.5.1
├── scripts/download-libs.js         # Library verify/download (npm run setup-libs)
├── scripts/capture-site-screens.js  # Site screenshots + samples (npm run site:screens)
├── tests/                           # Vitest unit tests; tests/e2e/ Playwright
├── release/                         # Packaging scripts and release guide
├── docs/                            # GitHub Pages site: index.html, img/, samples/, site-data.js
├── webpack.config.js, vitest.config.js, playwright.config.js
```

---

## Troubleshooting

**Nothing is recorded on a page.** Pages that were open before the extension was installed or reloaded need a refresh. Chrome doesn't allow extensions on `chrome://` pages or the Chrome Web Store. For `file://` pages, enable **Allow access to file URLs**.

**A screenshot is missing.** Screenshots are skipped while a password or payment field has focus, and Chrome can only capture the visible, focused tab.

**Word or PDF export fails.** Check that `libs/docx.min.js` and `libs/jspdf.umd.min.js` exist in the build (`npm run setup-libs`, then rebuild). CSV, JSON and Markdown don't need them.

**Storage is nearly full.** Use **Clean up > 30 days** or delete sessions in the **Export** tab, lower the session limit, or switch screenshots to JPEG.

**Debugging.** Inspect the service worker from `chrome://extensions` → TestSnapper → **service worker**; content-script logs appear in the page's DevTools console.

---

## Version history

### 1.1.9 — 2026-10-24
- Buttons and links are named by their own text: clicking "Sign in" after a username and password is no longer recorded as 'Click "Password"', and form submits are named after the button that sent them instead of every label in the form.
- An unlabelled field no longer borrows the label of the field before it; you're asked to name it instead.
- Stopping while the field-name prompt is open keeps that step (and any queued behind it) as "Unnamed field" instead of dropping it.
- `npm install` works on a clean checkout, `package-lock.json` is committed, and `npm run setup-libs` passes its integrity check.

### 1.1.8 — 2026-09-26
- Popup and review page moved to the v1.2 design (light and dark), with session search, a summary card, settings profiles, settings export/import and a storage breakdown.
- Recording fixes: text typed just before stopping is kept, Enter in a search box is recorded after its text, deliberate repeated clicks are each recorded, and skipping the field-name prompt keeps the step.
- Screenshots are skipped while a password or payment field has focus; more card, CVC, birth-date and phone formats are redacted.
- Interrupted sessions are flagged instead of renamed; old "[INCOMPLETE] …" names are cleaned up.
- Accessibility: dialogs take focus, errors stay visible and are announced, export progress is exposed to screen readers.
- Restores the v1.1.6 refactor that the 1.1.7 sync had reverted.

### 1.1.7 — 2026-09-05
- Source synced with the package published on the Chrome Web Store.

### 1.1.6 — 2026-07-11
- Fixes for production bugs and data-leak issues found in a security audit.
- Unified export formats; Word export embeds screenshots correctly; exports use the session name and include author and start/end time.
- Refreshed light and dark UI, redesigned settings panel and better drag-and-drop on the review page.

### 1.1.5 — 2026-03-21
- Architecture refactor: storage split into focused modules (quota monitor, schema migrator, orphan cleaner), shared image processor, logger and theme module.

### 1.1.3 — 2026-02-08
- GZIP compression for step data, expanded redaction, backup/restore, undo on the review page, search and filtering.

### 1.1.0 — 2025-12-15
- Session recovery, better selector scoring, storage quota monitoring.

### 1.0.0 — 2025-11-30
- First release: recording, screenshots, export to DOCX, PDF, CSV and JSON, basic redaction.

---

## Further documentation

| Document | What's in it |
|---|---|
| [QUICK_START.md](QUICK_START.md) | Step-by-step first recording |
| [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) | Architecture and development workflow |
| [onboard.md](onboard.md) | Onboarding guide for new contributors |
| [release/RELEASE_GUIDE.md](release/RELEASE_GUIDE.md) | Packaging and publishing |
| [PRIVACY_POLICY.md](PRIVACY_POLICY.md) | Privacy policy |

Bug reports and questions: [GitHub Issues](https://github.com/Nataraaj-Shanmugam/TestSnapper/issues).


---

## License

TestSnapper is released under the [MIT License](LICENSE).

It bundles [docx](https://github.com/dolanmiu/docx) 7.8.2 and [jsPDF](https://github.com/parallax/jsPDF) 2.5.1, both MIT licensed. Their notices are in `libs/*.LICENSE.txt`; see [libs/README.md](libs/README.md).
