# TestSnapper — Export Image Quality & Positioning

All 58 items from the prior full-repo review are resolved (see git history:
`8501579` V1.1.6, `9ea9518` V1.1.7). This TODO covers the next focused work:
**making screenshots in exports as high-quality and correctly-positioned as the
product needs.**

## Why this matters (product nature)
TestSnapper produces **QA/audit evidence documents**. The screenshots are
text- and UI-heavy (forms, tables, error toasts) and are the actual proof a
step happened. So the bar is:
- **Readability over file size** — a blurry/artifacted screenshot of an error
  message is worthless evidence. Text edges must stay crisp.
- **Reliable embedding** — images must *actually appear* in Word/PDF across
  versions, every time, offline.
- **CSP-safe & offline** — extension CSP is `script-src 'self'`; only bundled
  local libs (`libs/docx.min.js`, `libs/jspdf.umd.min.js`), no CDN.
- **Memory-disciplined** — exports already stream one asset at a time
  (PERF-003); any change must preserve that.

## Status
**Phase 1 + Phase 2 complete** (EXP-IMG-001..005) — implemented in
`export-service.js`, 207 tests passing, build clean. DOCX now builds a true
OOXML `.docx` via the bundled `docx` library (binary `ImageRun`, EMU sizing)
with the legacy HTML `.doc` retained as an automatic fallback. Also fixed a
latent bug: DOCX/PDF returned `objectUrl`, which neither caller consumed —
both now return a `Blob` (popup/background both handle `result.blob`).

Only EXP-IMG-006 (optional full-page/HiDPI capture) remains.

## Severity rollup
| Severity | Remaining |
|----------|-----------|
| Low      | 1         |

---

## Recommended approach (best fit for the product)

**Goal: lossless, correctly-sized screenshots in both DOCX and PDF, using the
libraries already bundled, with no quality-destroying re-encode.**

Implement in two phases. Phase 1 is the high-impact, low-risk core; Phase 2 is
the reliability upgrade.

### Phase 1 — Stop destroying quality + embed in PDF  *(do first)*
1. **Wire the existing `ImageProcessor.processForExport`** (`image-processor.js`)
   into `export-service.js`, replacing the crude `_resizeImageForExport`. Use
   `format:'auto'` (keeps PNG for text-heavy screenshots), `quality:0.92`, and a
   higher pixel cap (~1920 wide). This reuses code already in the repo and
   already memory-safe (OffscreenCanvas in the SW).
2. **Embed screenshots in PDF** via jsPDF `addImage` — currently PDF has *no*
   images at all. Embed PNG losslessly, fit-to-`contentWidth` preserving aspect
   ratio, `doc.addPage()` when an image won't fit.

### Phase 2 — Reliable DOCX via the bundled `docx` library  *(do second)*
3. **Replace the hand-rolled HTML `.doc`** with a true `.docx` built from the
   bundled `docx` library using `ImageRun`. Sizing is in **EMUs (914400/inch)**
   — pixel-perfect and deterministic — and images embed as binary parts, so the
   data-URL/mixed-unit/page-break problems below all disappear at once.

If Phase 2 is deferred, apply the EXP-IMG-004 sizing fixes to the HTML path so
the current `.doc` at least positions images correctly in the meantime.

---

## src/core/export-service.js

- [x] **[HIGH][EXP-IMG-001]** PDF export embeds no screenshots at all — `export-service.js` 742-859.
  - Problem: `_exportPDF` writes only text/selector/URL; `addImage` is never called, so manual + automated screenshots are silently dropped from every PDF.
  - Impact: PDF — a primary evidence format — contains no visual proof of any step. Users exporting to PDF get a text outline only.
  - Fix: after each step's text, load its asset, fit the image to `contentWidth` (preserve aspect ratio), `doc.addPage()` if it won't fit on the remaining page height, then `doc.addImage(pngDataUrl, 'PNG', x, y, w, h, undefined, 'SLOW')`. Embed PNG losslessly; keep the one-asset-at-a-time streaming (PERF-003).

- [x] **[HIGH][EXP-IMG-002]** DOCX downscales to 1280×720 and re-encodes lossless PNG → JPEG 0.85 — `export-service.js` 370-455 (`_resizeImageForExport`), called at 610, 680.
  - Problem: every screenshot is forced through JPEG quality 0.85 at ≤1280px, the worst-case transform for text/edge-heavy UI captures.
  - Impact: error messages, form labels, and table text become blurry/artifacted in the exported document — the evidence is degraded.
  - Fix: route through `ImageProcessor.processForExport` with `format:'auto'`, `quality:0.92`, cap ~1920 wide so PNG screenshots stay lossless and high-res. Only downscale when larger than the target; never JPEG-ify text content.

- [x] **[MED][EXP-IMG-003]** `ImageProcessor.processForExport` is dead code — `image-processor.js` 78-127; not referenced anywhere.
  - Problem: the content-aware (PNG-vs-JPEG), step-down-scaled, quality-0.92 export pipeline exists but is wired to nothing; exports use the cruder `_resizeImageForExport` instead.
  - Impact: maintained, tested code that would fix EXP-IMG-002 sits unused; two divergent image paths to maintain.
  - Fix: make `processForExport` the single export image path (resolves with EXP-IMG-002); delete or collapse `_resizeImageForExport` once callers migrate.

- [x] **[MED][EXP-IMG-004]** DOCX `<img>` mixes px width attrs with inch CSS and allows page splits — `export-service.js` 520-537, 611, 684.
  - Problem: `<img width="1280" height="...">` (px) plus CSS `max-width:7.29in; max-height:4.11in` is interpreted inconsistently by Word (it favors the px attribute), so images can overflow margins or render at the wrong scale; no `page-break-inside:avoid`, so an image can split across two pages.
  - Impact: inconsistent image sizing and images cut in half at page boundaries — poor-looking evidence docs.
  - Fix (if staying on HTML `.doc`): emit **one unit only** — set `width` to the intended *display* px (not the 1280 source px) and **omit `height`** so aspect ratio follows; add `page-break-inside:avoid` to `.screenshot-img` and `.auto-screenshot`. (Superseded entirely by EXP-IMG-005 / Phase 2.)

- [x] **[LOW][EXP-IMG-005]** HTML-as-`.doc` with base64 data-URLs is version-fragile — `export-service.js` 497-728.
  - Problem: Word's support for `<img src="data:...">` varies by version/config (strict setups historically need MHTML/Content-Location embedding); the `.doc` is HTML, not real OOXML.
  - Impact: on some Word installs images may not render or the file warns about format mismatch.
  - Fix (Phase 2, recommended): build a true `.docx` with the bundled `docx` library + `ImageRun` (EMU sizing, binary-embedded images) — eliminates EXP-IMG-004 and this item together, within the export context already in use.

---

## src/background/background.js  (optional, future)

- [ ] **[LOW][EXP-IMG-006]** Capture is viewport-only at the current DPR — `background.js` 610-621.
  - Problem: `chrome.tabs.captureVisibleTab` has no scale parameter and grabs only the visible viewport; long pages and HiDPI detail are not captured at higher fidelity.
  - Impact: on standard-DPI displays, screenshots are only viewport-resolution; content below the fold is missing.
  - Fix (only if users report it): use the Debugger protocol `Page.captureScreenshot` with `captureBeyondViewport:true` and a device scale factor for full-page HiDPI capture. Adds the `debugger` permission and attach/detach handling — larger change, weigh against demand.
