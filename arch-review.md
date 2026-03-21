# Architecture Review — TestSnapper

**Date:** 2026-03-21
**Scope:** `src/` — 14 JS source files
**Project type:** Chrome Extension (Manifest V3)
**Verdict:** **NEEDS WORK** — structural debt accumulating

---

## Executive Summary

TestSnapper's dependency graph is clean (no cycles, reasonable layering), but the codebase has accumulated significant structural debt through code duplication and bloated modules. Two classes exceed 850 lines each (StorageManager at 914, ExportService at 858), a legacy export module sits unused in the build, and identical utility functions are implemented up to three times across different files. The content script layer has inherent Manifest V3 constraints but handles them adequately. No critical security or correctness issues were found — all issues are maintainability and modularity concerns.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    ENTRY POINTS                         │
│                                                         │
│  background.js        popup.js       review-standalone  │
│  (service worker)     (popup UI)     (review UI)        │
│                                                         │
│  content.js ──→ selector.js                             │
│             ──→ redactor.js         (window globals)    │
│             ──→ field-name-resolver.js                  │
└────────┬──────────┬──────────┬──────────────────────────┘
         │          │          │
    ┌────▼────┐  ┌──▼──────────▼──┐
    │StorageM.│  │ FSStorageManager│ ← popup + review use this
    │(direct) │  │  ┌─StorageM.─┐ │
    └────┬────┘  │  └──────┬────┘ │
         │       │  ┌──FileSync─┐ │
         │       │  └───────────┘ │
         │       └────────────────┘
    ┌────▼────────────────┐
    │   compression.js    │  (GZIP via CompressionStream)
    └─────────────────────┘

    ┌──────────────────────┐
    │   ExportService      │ ← background, popup, review
    │   ┌──Utils──┐        │
    │   └─────────┘        │
    └──────────────────────┘

    ┌──────────────────────┐
    │   export.js          │ ← ORPHANED (no runtime importer)
    │   (Exporter class)   │
    └──────────────────────┘
```

---

## Issues by Severity

### Critical (0)

No critical issues found. The dependency graph is cycle-free and the architecture is fundamentally sound.

---

### High (4)

#### HIGH-001: Duplicated Image Compression Logic (3 Implementations)

| | |
|---|---|
| **Files** | `src/storage.js` (_compressImage), `src/core/export-service.js` (_compressImage, _processImageForExport) |
| **Category** | Duplication / Divergence |

Three separate image compression implementations exist with divergent behavior:
1. **StorageManager._compressImage** — resizes to 1920×1080, JPEG at 0.95, works with data URLs
2. **ExportService._compressImage** — configurable maxWidth, step-down scaling, works with Blobs
3. **ExportService._processImageForExport** — full pipeline with edge-detection auto PNG/JPEG selection

A bug fix in one will not propagate to the others.

**Recommendation:** Extract a single `ImageProcessor` module accepting both Blob and dataURL inputs.

---

#### HIGH-002: Duplicated Utility Functions Across Modules

| | |
|---|---|
| **Files** | `src/core/utils.js`, `src/core/export-service.js`, `src/ui/popup/popup.js` |
| **Category** | Duplication |

- `escapeHtml` exists in 3 places (Utils, ExportService, popup.js)
- `blobToDataURL` exists in 2 places (Utils, ExportService)
- ExportService already imports Utils but re-implements these as private methods

**Recommendation:** Remove duplicates. Use `Utils.escapeHtml()` everywhere. Add `popup.js` import of Utils.

---

#### HIGH-003: Inconsistent Storage Layer Usage

| | |
|---|---|
| **Files** | `src/background/background.js`, `src/core/fs-storage.js` |
| **Category** | Layer violation / Duplication |

`background.js` uses `StorageManager` directly while UI files use `FSStorageManager`. Both files independently define `PENDING_FLUSH_KEY` and implement flush helpers. This creates data consistency risk and duplicated logic.

**Recommendation:** Either have background.js use FSStorageManager (which already detects service worker context) or extract flush coordination into a shared module.

---

#### HIGH-004: Content Scripts Rely on Implicit Global Coupling

| | |
|---|---|
| **Files** | `src/content/content.js`, `src/content/selector.js`, `src/content/redactor.js`, `src/content/field-name-resolver.js` |
| **Category** | Fragile coupling |

Content scripts communicate through `window` globals with load order enforced only by manifest declaration order. `initModules()` checks for `SelectorEngine` and `Redactor` but not `FieldNameResolver` in the outer guard. A manifest reorder silently breaks the extension.

**Recommendation:** Add defensive guards for all expected globals. Consider bundling content scripts with webpack (background.js is already bundled).

---

### Medium (8)

#### MED-001: Orphan Module — `export.js` Unused at Runtime

| | |
|---|---|
| **Files** | `src/export.js` |
| **Category** | Dead code |

The `Exporter` class is never imported by any runtime source file. It was superseded by `ExportService` but never removed. Confusingly, `Exporter` has the superior DOCX implementation (real Office Open XML with ZIP), while `ExportService` generates HTML saved as `.doc`.

**Recommendation:** Merge `Exporter`'s DOCX/ZIP implementation into `ExportService`, then remove `export.js`.

---

#### MED-002: StorageManager is a God Class (914 Lines, 7+ Responsibilities)

| | |
|---|---|
| **Files** | `src/storage.js` |
| **Category** | Cohesion violation |

Single class handles: CRUD, image compression, quota monitoring, schema migration, orphan cleanup, backup/restore, batch operations, retry logic, and GZIP integration.

**Recommendation:** Extract focused modules: storage engine, session repository, image compressor, quota monitor, schema migrator, orphan cleaner.

---

#### MED-003: ExportService Mixes Image Processing with Document Generation (858 Lines)

| | |
|---|---|
| **Files** | `src/core/export-service.js` |
| **Category** | Cohesion violation |

~250 lines of image processing (edge detection, OffscreenCanvas, step-down scaling, format auto-detection) embedded alongside document generation for 4 formats.

**Recommendation:** Extract image processing into `src/core/image-processor.js`.

---

#### MED-004: `storage.js` and `export.js` Placed at Root Instead of `core/`

| | |
|---|---|
| **Files** | `src/storage.js`, `src/export.js` |
| **Category** | Inconsistent organization |

These are infrastructure modules that belong in `src/core/` alongside their peers (compression.js, utils.js, fs-storage.js).

---

#### MED-005: FSStorageManager Duplicates Every StorageManager Method

| | |
|---|---|
| **Files** | `src/core/fs-storage.js` (727 lines) |
| **Category** | Boilerplate / OCP violation |

Every public method contains a 3-way routing branch. Adding a method to StorageManager requires a corresponding wrapper.

**Recommendation:** Use a Proxy pattern or interface-based approach instead of manual delegation.

---

#### MED-006: High Fan-In on `utils.js` — Coupling Hotspot

| | |
|---|---|
| **Files** | `src/core/utils.js` |
| **Category** | Coupling |

4 direct importers. Module mixes pure functions (UUID, escapeHtml) with DOM-dependent functions (downloadFile, showMessage) that would fail in the service worker.

**Recommendation:** Split into `utils.js` (pure) and `dom-utils.js` (DOM-dependent).

---

#### MED-007: Inconsistent Theme Implementation Across UI Files

| | |
|---|---|
| **Files** | `src/ui/popup/popup.js`, `src/ui/review/review-standalone.js` |
| **Category** | Pattern inconsistency |

Both files implement nearly identical theme toggle logic (~25 lines each) using `document.body.dataset.theme`. The logic is duplicated rather than shared.

**Recommendation:** Extract theme toggle logic into a shared `ui-utils.js` module.

---

#### MED-008: Excessive Console Logging (180 Occurrences Across 13 Files)

| | |
|---|---|
| **Files** | All source files |
| **Category** | Pattern inconsistency |

180 console.log/warn/error calls with emoji-prefixed messages. No logging abstraction, no log levels, no way to disable in production.

**Recommendation:** Introduce a simple logger utility with configurable log levels that can be silenced in production builds.

---

### Low (5)

| ID | Title | Files |
|---|---|---|
| LOW-001 | `injected.js` has no static reference from source | `src/injected.js` |
| LOW-002 | Background bypasses FSStorageManager (justified) | `src/background/background.js` |
| LOW-003 | ExportService directly accesses chrome.storage.local for settings | `src/core/export-service.js:608` |
| LOW-004 | Deprecated `_resizeImageForExport` kept without removal | `src/core/export-service.js:537` |
| LOW-005 | Mixed module patterns: ES modules + window globals + `export` keyword inconsistency | Various |

---

## Module Health Summary

| Module | Lines | Responsibilities | Health |
|---|---|---|---|
| `background.js` | ~600 | Recording state, messaging, screenshots, exports | Fair — multiple classes help organize |
| `storage.js` | 914 | CRUD + compression + quota + migration + cleanup + backup | Poor — God class |
| `export-service.js` | 858 | Export orchestration + image processing + 4 format generators | Poor — needs extraction |
| `fs-storage.js` | 727 | Delegation routing + flush management | Fair — boilerplate-heavy |
| `export.js` | 642 | Duplicate export system (dead code) | Dead — remove |
| `content.js` | ~600 | Event capture, UI panels, modals | Fair — complex but focused |
| `selector.js` | ~400 | Multi-strategy selector generation | Good — single responsibility |
| `popup.js` | ~850 | Popup UI logic | Fair — expected for UI controller |
| `review-standalone.js` | ~800 | Review page UI logic | Fair — expected for UI controller |
| `utils.js` | 176 | Shared utilities | Good — small, leaf dependency |
| `compression.js` | ~100 | GZIP compression | Good — single responsibility |
| `file-sync.js` | ~200 | File System Access API wrapper | Good — single responsibility |
| `step-utils.js` | ~50 | Step deduplication | Good — single responsibility |
| `redactor.js` | ~100 | Privacy redaction | Good — single responsibility |

---

## Dependency Graph Summary

- **Cycles:** None detected — clean DAG
- **Highest fan-in:** `utils.js` (4 importers)
- **Highest fan-out:** `export-service.js` (3 dependents, 1 import + constructor injection)
- **Orphaned modules:** `export.js` (no runtime importer)
- **Layer violations:** `background.js` → `StorageManager` directly (justified but undocumented)

---

## Positive Findings

1. **No dependency cycles** — the import graph is a clean DAG
2. **Constructor injection** for storage in ExportService — good for testability
3. **Consistent theme pattern** — both UI files use `dataset.theme` consistently
4. **Content script re-injection guard** — proper use of `var` and `window.testSnapperInitialized`
5. **Error boundaries** — try/catch with fallback throughout export pipeline
6. **Cancellation support** — ExportService supports mid-export cancellation

---

## Recommended Priority Order

1. **Remove `export.js`** — merge its DOCX/ZIP implementation into ExportService first (MED-001)
2. **Deduplicate utilities** — consolidate escapeHtml, blobToDataURL (HIGH-002)
3. **Extract ImageProcessor** — single implementation for all image operations (HIGH-001)
4. **Consolidate flush logic** — eliminate duplicated PENDING_FLUSH_KEY (HIGH-003)
5. **Move storage.js to core/** — align with directory conventions (MED-004)
6. **Incrementally decompose StorageManager** — start with quota monitor extraction (MED-002)
7. **Add defensive guards to content scripts** — check all globals (HIGH-004)
