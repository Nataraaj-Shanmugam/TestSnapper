# TestSnapper — Feature Revamps Tracking
**Started:** 2026-04-10
**Baseline:** v1.1.5
**Branch:** claude/practical-mclaren

---

## Progress Overview

| ID | Name | Priority | Complexity | Status |
|----|------|----------|------------|--------|
| R-005 | Floating Panel Control Center | P1 | M | ✅ Done |
| R-006 | Session Management Workspace | P1 | M | ✅ Done |
| R-010 | Screenshot Event-Triggered + Smart Dedup | P1 | L | ✅ Done |
| R-002 | Selector Inspector | P1 | M | ✅ Done |
| R-001 | Review UI Table View Toggle | P0 | L | ✅ Done |
| R-008 | Field Name Learning | P1 | L | ✅ Done |
| R-003 | Privacy Rules Engine | P1 | L | ✅ Done |
| R-004 | Export Studio | P1 | L | ✅ Done |
| R-007 | Settings Profiles | P2 | M | ✅ Done |
| R-009 | Storage Proactive Management | P2 | M | ✅ Done |

**Legend:** ⬜ Pending · 🔄 In Progress · ✅ Done

---

## R-005: Floating Panel Control Center
**Files:** `src/content/content.js`, `src/background/background.js`

### What changes
- [ ] Add `#last-step-preview` line below controls (shows last recorded action + field name)
- [ ] Add `#screenshot-mode-indicator` showing "Auto: 5s" or "Manual only"
- [ ] Add `#btn-note` quick-note button (pencil icon) — inline input on click, saves note to last step
- [ ] Sticky panel position: save to `chrome.storage.local` on drag-end, restore on load
- [ ] `updateLastStepPreview(action, fieldName)` triggered by new `stepRecorded` message from background
- [ ] Background: broadcast `{ action: 'stepRecorded', step }` after each step is stored
- [ ] Background: new `addNoteToLastStep` message handler

---

## R-006: Session Management Workspace
**Files:** `src/ui/popup/popup.html`, `src/ui/popup/popup.js`, `src/ui/popup/popup.css`

### What changes
- [ ] Session search input above dropdown (`#sessionSearch`)
- [ ] Session items: size badge (KB/MB) + archive button (⊘, reveals on hover)
- [ ] Archived sessions collapsible section at bottom of dropdown
- [ ] `loadSessions()` splits active vs archived (`session.archived === true`)
- [ ] `filterSessionsDropdown(query)` for live search
- [ ] `handleArchiveSession(sessionId)` — sets `archived: true` via `updateSession()`
- [ ] `calculateSessionSize(sessionId)` — sums asset dataUrl lengths, formats

---

## R-010: Screenshot Event-Triggered + Smart Dedup
**Files:** `src/content/content.js`, `src/background/background.js`, `src/ui/popup/popup.html`, `src/ui/popup/popup.js`, `src/ui/review/review-standalone.html`, `src/ui/review/review-standalone.js`

### What changes
- [ ] New setting `screenshotMode`: `'interval' | 'events' | 'both'` (default: `'interval'`)
- [ ] `MutationObserver` in content.js for `role="dialog"` / `.modal` element detection → auto-capture
- [ ] `handleSubmit()` triggers screenshot before step recording
- [ ] `modalObserver.disconnect()` on stop recording
- [ ] Smart dedup in background: skip save if `simpleHash(dataUrl)` matches last hash (auto-captures only)
- [ ] `asset.trigger` field: `'interval' | 'form-submit' | 'modal-open' | 'navigation' | 'manual'`
- [ ] Review UI: "↺ Retake" button per step card → re-captures and replaces screenshot
- [ ] Settings UI: `<select id="screenshotMode">` in popup settings tab

---

## R-002: Selector Inspector
**Files:** `src/ui/review/review-standalone.js`, `src/ui/review/review-standalone.css`

### What changes
- [ ] `getSelectorStability(selector)` → `{ label, color, reason }` based on heuristics
- [ ] Expandable "Selector Inspector ▸" panel on each step card
- [ ] Shows CSS + XPath with stability badge and copy buttons
- [ ] CSS styles for inspector panel, stability badge, copy buttons

---

## R-001: Review UI Table View Toggle
**Files:** `src/ui/review/review-standalone.html`, `src/ui/review/review-standalone.js`, `src/ui/review/review-standalone.css`

### What changes
- [ ] "☰ Cards / ⊞ Table" toggle buttons in toolbar
- [ ] `renderTableView(steps)` — full `<table>` with inline-editable fieldName, value, notes cells
- [ ] `handleTableCellEdit(e)` — auto-saves on blur via `fsStorage.updateStep()`
- [ ] `switchView(view)` — toggles containers, persists to `localStorage`
- [ ] `renderSteps()` respects `currentView` — routes to table or cards

---

## R-008: Field Name Learning
**Files:** `src/content/content.js`, `src/background/background.js`, `src/ui/review/review-standalone.js`

### What changes
- [ ] `_getFieldFingerprint(element)` — stable key: `tag:id:name:type:class@hostname`
- [ ] After manual modal confirm → `saveFieldNameMemory` message to background
- [ ] Before modal prompt → `getFieldNameMemory` check; skip modal if match found
- [ ] Background: `testsnapper_fieldname_memory` storage key, two message handlers
- [ ] Review UI: "Remember All Field Names" button → bulk saves all step fieldNames to memory

---

## R-003: Privacy Rules Engine
**Files:** `src/content/redactor.js`, `src/content/content.js`, `src/ui/popup/popup.html`, `src/ui/popup/popup.js`, `src/ui/review/review-standalone.html`, `src/ui/review/review-standalone.js`

### What changes
- [ ] New settings keys: `customRedactionPatterns[]`, `redactUrlParams`, `urlParamDenylist[]`
- [ ] `redactor.js`: `loadCustomPatterns(patterns)` method, applies in `shouldIgnoreField()`
- [ ] `content.js`: `redactUrl(url)` strips denylist params from captured URLs
- [ ] Popup Settings: "Privacy Rules" section with textarea + checkbox + denylist input
- [ ] Review UI: "Privacy Audit" button → modal report of sensitive fields, redacted values

---

## R-004: Export Studio
**Files:** `src/ui/review/review-standalone.html`, `src/ui/review/review-standalone.js`, `src/ui/review/review-standalone.css`, `src/core/export-service.js`

### What changes
- [ ] `<details>` "Configure Export" panel in sidebar: column toggles, step filter, screenshot size
- [ ] "Preview (first 5)" button → renders simplified read-only preview in modal
- [ ] `readExportConfig()` reads UI state, persists to `localStorage`
- [ ] `handleSaveAndExport()` passes options to `exportService.exportSession()`
- [ ] `exportSession()` gains optional 4th `options` param — filters steps, skips screenshots/selectors

---

## R-007: Settings Profiles
**Files:** `src/ui/popup/popup.html`, `src/ui/popup/popup.js`

### What changes
- [ ] Profile selector (Custom / Fast Mode / Documentation Mode) at top of Settings tab
- [ ] `applyProfileToForm(preset)` fills form fields from preset without saving
- [ ] Export Settings button → downloads `testsnapper-settings.json`
- [ ] Import Settings button → loads JSON, validates, fills form

---

## R-009: Storage Proactive Management
**Files:** `src/ui/popup/popup.html`, `src/ui/popup/popup.js`, `src/ui/popup/popup.css`, `src/core/storage.js`

### What changes
- [ ] `StorageManager.getStorageBreakdown()` — per-session sizes (steps + assets)
- [ ] Popup storage tab: top-5 sessions breakdown with bar chart rows
- [ ] "Smart Cleanup" button — identifies old sessions, shows confirmation with size savings
- [ ] On popup init, if quota > 85%: show storage warning banner

---

## Build Verification
After all revamps:
```
npm run build   # Must succeed, zero errors
```
Then load `dist/` in `chrome://extensions` and verify each revamp manually.
