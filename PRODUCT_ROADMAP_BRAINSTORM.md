# TestSnapper — Product Roadmap Brainstorm
**Date:** 2026-04-09
**Version baseline:** v1.1.5
**Purpose:** Deep product analysis — new features, revamp candidates, prioritized by impact

---

## How to Read This Document

| Field | Values |
|-------|--------|
| **Priority** | P0 = Must Have · P1 = High · P2 = Medium · P3 = Nice to Have |
| **Complexity** | S = 1-3 days · M = 1-2 weeks · L = 2-4 weeks · XL = 1-3 months |
| **Need Type** | Core = Primary use case · Growth = Drives adoption · Retention = Keeps users · Differentiator = Competitive edge |

---

## Executive Summary

TestSnapper currently records UI sessions and exports documentation. Its strongest gap: **it stops at docs but users actually need runnable code**. The highest leverage investments are:

1. **Test script generation** (Playwright/Cypress) — converts documentation tool into automation tool
2. **Recording completeness** (hover, drag, keyboard, multi-tab) — closes gaps that break real-world recordings
3. **Review UI overhaul** — the editing experience is the daily driver; it's functional but not powerful
4. **AI-assisted assertions** — the step after capturing "what happened" is knowing "what to assert"

---

## Part 1: New Features

### 1.1 Test Script Code Generation

#### F-001 — Playwright Script Export
**Priority:** P0 | **Complexity:** L | **Need:** Core

Generate runnable Playwright TypeScript/JavaScript from recorded sessions. This is the single biggest missing capability — users record flows to create test automation, not just documents.

**What it covers:**
- `page.click()`, `page.fill()`, `page.goto()` from recorded steps
- Smart selector priority: prefer `data-testid` > ARIA > CSS > XPath
- Auto-inserts `await page.waitForLoadState()` after navigations
- Groups into `test('session name', async ({page}) => { ... })`
- Generates a complete test file with imports and `describe` block

**Acceptance criteria:**
- Generated script runs without manual editing on the recorded URL
- Selector fallback chain included as comments
- User can toggle TypeScript vs JavaScript output

---

#### F-002 — Cypress Script Export
**Priority:** P0 | **Complexity:** L | **Need:** Core

Same as F-001 but for Cypress syntax. `cy.visit()`, `cy.get()`, `cy.type()`, `cy.click()`.

**Why separate from F-001:** Cypress and Playwright have fundamentally different selector strategies, assertion patterns, and async models. Sharing generation logic leads to bad output.

---

#### F-003 — Selenium/WebDriver Script Export
**Priority:** P1 | **Complexity:** M | **Need:** Core

Python and Java flavors. Lower complexity than Playwright because the selector strategy is simpler (CSS + XPath already captured), but lower priority because the ecosystem is moving toward Playwright/Cypress.

---

#### F-004 — Cucumber/Gherkin BDD Export
**Priority:** P1 | **Complexity:** M | **Need:** Differentiator

Convert steps into `Given/When/Then` syntax. Each recorded action maps to a step definition stub.

```gherkin
Given I navigate to "https://app.example.com/login"
When I fill in "Email" with "user@example.com"
And I click "Sign In"
Then I should be on the dashboard
```

Auto-generates step definition files (JavaScript or Python) alongside the `.feature` file.

---

#### F-005 — WebdriverIO / Puppeteer Export
**Priority:** P2 | **Complexity:** M | **Need:** Growth

Covers niche segments. WebdriverIO is popular in enterprise Java shops. Puppeteer for Node-native teams.

---

### 1.2 Recording Completeness

#### F-006 — Hover Event Recording
**Priority:** P0 | **Complexity:** M | **Need:** Core

Currently missing. Hover events are required for:
- Dropdown menus that appear on hover
- Tooltip-triggered UI validation
- Hover states that gate other elements

**Implementation approach:**
- `mouseenter` listener with 300ms debounce to filter accidental hovers
- Only capture hovers that precede a user action (click, keyboard) within 2s
- Store as `action: "hover"` step with selector

**Why P0:** Without this, dropdown menus cannot be recorded — this breaks virtually all navigation-heavy SaaS apps.

---

#### F-007 — Drag-and-Drop Recording
**Priority:** P1 | **Complexity:** L | **Need:** Core

Captures `dragstart`, `dragover`, `drop` events as a compound step: "Drag [source] to [target]". Needed for:
- Kanban boards (Jira, Trello-style apps)
- Sortable lists
- File uploads via drag

---

#### F-008 — Keyboard Shortcut Recording
**Priority:** P1 | **Complexity:** M | **Need:** Core

Capture `keydown` events for non-character keys: Enter, Tab, Escape, arrow keys, and modifier combos (Ctrl+Z, Ctrl+A, etc.). Store as `action: "keypress"` with `value: "Enter"`.

**Why needed:** Many flows use keyboard navigation — Tab through form fields, Enter to submit, Escape to close modals. Without this, recorded scripts miss critical interactions.

---

#### F-009 — Scroll Position Recording
**Priority:** P1 | **Complexity:** S | **Need:** Core

Record scroll events as steps when scroll position changes significantly (> 200px threshold). Needed for:
- Infinite scroll testing
- Lazy-loaded content testing
- Scroll-triggered animations

---

#### F-010 — Right-Click / Context Menu Recording
**Priority:** P2 | **Complexity:** M | **Need:** Core

Capture `contextmenu` events and subsequent item clicks. Needed for apps with rich right-click menus (file managers, canvas-based editors, etc.).

---

#### F-011 — Multi-Tab Recording
**Priority:** P1 | **Complexity:** XL | **Need:** Growth

Record user flows that span multiple browser tabs. Currently each tab records independently. Multi-tab would:
- Tag each step with tab ID + title
- Merge steps in chronological order
- Export as a single unified test session

**Why XL:** Requires background service worker coordination across multiple content script instances. Significant architecture change.

---

#### F-012 — Browser Console Error Capture
**Priority:** P2 | **Complexity:** M | **Need:** Retention

Capture JavaScript errors and network failures that occur during a session. Store as `action: "error"` steps alongside interaction steps.

**Value:** QA teams often need to document "this error appeared during this step" — currently they have to manually add a note.

---

#### F-013 — Network Request Capture (XHR/Fetch)
**Priority:** P2 | **Complexity:** L | **Need:** Differentiator

Intercept XHR/fetch requests using `chrome.debugger` API. Capture:
- API endpoint called, HTTP method, status code
- Optional: request/response body (with redaction)

**Value:** Enables API test generation alongside UI tests. Major differentiator against basic recording tools.

---

#### F-014 — Custom Assertion Recording
**Priority:** P1 | **Complexity:** L | **Need:** Core

Let users click-to-mark elements for assertion during recording. A user hovers an element, presses a shortcut (e.g., Ctrl+Shift+A), and the extension captures:
- Element selector
- Current text/value
- Assertion type: `toBeVisible`, `toHaveText`, `toHaveValue`, etc.

Generates assertion code in the output scripts (F-001/F-002).

---

#### F-015 — Video Recording
**Priority:** P2 | **Complexity:** XL | **Need:** Growth

Full screen capture using `chrome.tabCapture` API alongside step-by-step screenshots. Produces an MP4 alongside the session export.

**Use case:** Bug reports, accessibility reviews, onboarding documentation.

---

### 1.3 AI-Powered Intelligence

#### F-016 — AI Assertion Suggestions
**Priority:** P0 | **Complexity:** L | **Need:** Differentiator

After recording, analyze steps and suggest what assertions should be added. Examples:
- After a form submit: suggest asserting the success message text
- After navigation: suggest asserting the new URL
- After a type: suggest asserting the field value

Uses heuristic rules first (no LLM dependency), with optional AI enhancement.

---

#### F-017 — AI Step Description Improvement
**Priority:** P1 | **Complexity:** M | **Need:** Retention

Auto-improve auto-generated step descriptions. Instead of "click on input#email-23f4", produce "Enter email address in login form". Runs locally using the existing field-name resolver + contextual rules, optionally enhanced with a small on-device model.

---

#### F-018 — Smart Test Smell Detection
**Priority:** P2 | **Complexity:** M | **Need:** Retention

Flag common test issues in recorded sessions:
- Fragile selectors (numeric IDs, long CSS chains)
- Missing assertions
- Steps that depend on dynamic data (timestamps, auto-incremented IDs)
- Overly long sessions that should be split

Surface these as warnings in the review UI.

---

#### F-019 — AI Session Naming
**Priority:** P2 | **Complexity:** S | **Need:** Growth

Auto-suggest a meaningful session name based on the URLs visited and actions taken. Instead of "Session 2026-04-09", suggest "Login flow — Happy path" or "Checkout with coupon code".

---

#### F-020 — Duplicate Flow Detection Across Sessions
**Priority:** P2 | **Complexity:** M | **Need:** Retention

Detect when a new recording substantially overlaps with an existing session. Prompt user: "This looks similar to 'Login Test v1'. Create a new session or update the existing one?"

---

### 1.4 Collaboration & Organization

#### F-021 — Session Tags and Folders
**Priority:** P1 | **Complexity:** M | **Need:** Retention

Organize sessions with:
- Tags (e.g., `#smoke`, `#regression`, `#sprint-42`)
- Folders/groups (e.g., "Checkout flows", "Auth")
- Filter/search by tags in session list

---

#### F-022 — Session Export as Shareable Bundle
**Priority:** P1 | **Complexity:** M | **Need:** Growth

Export a session as a self-contained `.testsnapper` bundle (ZIP) that another user can import. Enables sharing between team members without a server.

---

#### F-023 — Inline Step Annotations / Comments
**Priority:** P1 | **Complexity:** S | **Need:** Retention

Add free-text annotations to steps that are visible in exports but not part of the test automation code. Like comments in code — "This step takes 3-5s in prod".

Currently `notes` field exists but is not prominently surfaced or differentiated from step data.

---

#### F-024 — Session Versioning / History
**Priority:** P2 | **Complexity:** L | **Need:** Retention

Track changes to a session over time. Let users see diff between session versions — which steps were added, removed, or modified. "Updated selector for step 4 because the app was refactored."

---

#### F-025 — Bulk Export (Multiple Sessions)
**Priority:** P1 | **Complexity:** M | **Need:** Core

Currently users must export one session at a time. Add bulk export:
- Select multiple sessions
- Choose format
- Download as a ZIP containing individual files

---

### 1.5 Integrations

#### F-026 — TestRail / Zephyr / qTest Direct Push
**Priority:** P2 | **Complexity:** L | **Need:** Growth

API integration to push exported test cases directly to test management tools. User enters API key and project ID in settings; TestSnapper formats the export to match the target tool's schema.

---

#### F-027 — GitHub / GitLab Integration
**Priority:** P1 | **Complexity:** L | **Need:** Growth

Commit generated test scripts directly to a repo. User authorizes OAuth, selects repo + branch, TestSnapper opens a PR with the generated `.spec.ts` file.

---

#### F-028 — Jira Issue Attachment
**Priority:** P2 | **Complexity:** M | **Need:** Growth

One-click attach current session (as PDF/DOCX) to a Jira issue. User enters issue key; TestSnapper uploads via Jira REST API.

---

#### F-029 — Webhook / CI Trigger
**Priority:** P2 | **Complexity:** M | **Need:** Growth

After recording, trigger a webhook (configurable URL) to kick off a CI pipeline. Useful for teams that want to immediately verify the recorded test runs in CI.

---

### 1.6 UX & Onboarding

#### F-030 — First-Run Onboarding Wizard
**Priority:** P1 | **Complexity:** M | **Need:** Growth

Interactive setup flow on first install:
1. Record a short sample interaction
2. Show the generated selectors + field names
3. Export to a chosen format
4. Prompt to configure screenshot interval + privacy settings

**Why:** Current onboarding is documentation only. Users who don't read docs are lost.

---

#### F-031 — Session Templates
**Priority:** P2 | **Complexity:** M | **Need:** Growth

Pre-built session starters for common flows:
- "Login flow" — placeholder steps: navigate, fill email, fill password, submit
- "Checkout flow"
- "Form validation"

User starts from a template and records over the placeholders.

---

#### F-032 — Command Palette (Quick Actions)
**Priority:** P2 | **Complexity:** M | **Need:** Retention

Keyboard-driven command palette (Ctrl+K / Cmd+K) for power users:
- "New session", "Export as JSON", "Toggle theme", "Open settings"
- Searchable, keyboard navigable

---

#### F-033 — Notifications / Activity Feed
**Priority:** P2 | **Complexity:** S | **Need:** Retention

Activity feed in the popup showing recent actions:
- "Session 'Login test' exported as PDF 2 hours ago"
- "5 sessions auto-cleaned (storage at 80%)"
- "Selector fragility warning in 3 steps"

---

### 1.7 Platform Expansion

#### F-034 — Firefox Extension Port
**Priority:** P2 | **Complexity:** L | **Need:** Growth

Port to Firefox using WebExtensions API. Most code is compatible; key differences are `chrome.*` → `browser.*` and Manifest V3 compatibility gaps.

---

#### F-035 — Safari Extension Port
**Priority:** P3 | **Complexity:** XL | **Need:** Growth

Requires Apple Developer account and Safari Web Extension wrapper. Significant effort for niche segment.

---

#### F-036 — Playwright Trace Viewer Integration
**Priority:** P2 | **Complexity:** L | **Need:** Differentiator

Generate Playwright trace files (`.zip` format) that load directly in `playwright show-trace`. Gives visual replay capability without building a custom player.

---

---

## Part 2: Existing Features Needing Revamp

### R-001 — Review UI: From Card Viewer to Test Editor
**Priority:** P0 | **Complexity:** L | **Need:** Core

**Current state:** Vertical card stack, inline editing, drag-and-drop. Functional but slow for large sessions.

**Pain points:**
- 100+ step sessions become an infinite scroll nightmare
- No table/spreadsheet view for bulk editing
- Can't compare two sessions side by side
- Step editing requires clicking into each card individually
- No way to split or merge sessions

**Revamp to:**
- **Table view toggle** — spreadsheet-style editing for bulk edits (field names, selectors, notes in cells)
- **Split/merge sessions** — cut a session in half at a step, or merge two sessions sequentially
- **Mini-map / step timeline** — visual scrubber for navigating large sessions
- **Batch field name edit** — "Rename all steps with field name 'input-23' to 'Email'"
- **Column visibility toggle** — show/hide selector columns, value column, etc.

---

### R-002 — Selector Strategy: From Black Box to Debuggable
**Priority:** P1 | **Complexity:** M | **Need:** Retention

**Current state:** Multiple selectors are captured silently. Users see the best one but have no visibility into why it was chosen or how stable it is.

**Pain points:**
- No indication that a selector might be fragile
- Can't see all generated selectors for a step (only the "winner")
- No way to test if a selector still works on the current page
- No selector health score visible to user

**Revamp to:**
- **Selector inspector panel** — expand a step to see all 13 strategies and their scores
- **Stability badge** — icon indicating selector fragility (stable/fragile/dynamic)
- **Test selector live** — button to highlight the element on the current page using stored selector
- **Selector rank explanation** — tooltip "ID selected because it's unique and non-auto-generated"

---

### R-003 — Privacy & Redaction: From Pattern List to Rules Engine
**Priority:** P1 | **Complexity:** L | **Need:** Core

**Current state:** 21 hardcoded patterns, limited user control. URL query parameters not redacted. No custom patterns.

**Pain points:**
- Teams have custom sensitive fields (employee IDs, internal account codes) not in the default list
- URL tokens/session IDs leak into `url` field of steps
- No way to audit what was/wasn't redacted in a session
- Pattern failures are silent — no warning when sensitive data may have slipped through

**Revamp to:**
- **Custom redaction rules UI** — add field name patterns, CSS selectors, or regex patterns
- **URL parameter redaction** — allowlist/denylist for query param names (e.g., always redact `?token=`, `?session=`)
- **Redaction audit panel** — in review UI, show a scan report: "3 fields redacted, 0 warnings"
- **Per-site rules** — configure different redaction rules for different domains
- **Screenshot blur regions** — mark screen areas to auto-blur in screenshots (e.g., user avatar, account balance)

---

### R-004 — Export: From File Download to Export Studio
**Priority:** P1 | **Complexity:** L | **Need:** Retention

**Current state:** Select format, download file. No preview, no customization, no branding.

**Pain points:**
- No preview before committing to a 50MB DOCX export
- Cannot customize the DOCX/PDF template (company logo, header, colors)
- Large sessions hit memory limits during PDF generation
- No progress granularity (just "exporting...")
- Can't exclude certain steps or columns from export

**Revamp to:**
- **Export preview** — render first 5 steps in the chosen format before full export
- **Export configuration panel** — per-format options (columns to include, screenshot size, include/exclude notes)
- **Template customization** — custom header/footer, company logo upload for DOCX/PDF
- **Export filters** — export only steps matching a filter (e.g., only `click` steps, only steps tagged `#regression`)
- **Streaming export** — show step-by-step progress with cancel at any point
- **Export history** — log of recent exports with download links (in-session)

---

### R-005 — Floating Recording Panel: From Status Bar to Control Center
**Priority:** P1 | **Complexity:** M | **Need:** Retention

**Current state:** Small floating panel with Start/Pause/Stop, step counter, timer, screenshot button. Auto-hides after 5 seconds.

**Pain points:**
- Can't see last recorded step without opening popup
- No way to annotate or add a note from the panel
- Panel position resets on each recording
- Auto-hide means users lose their recording status
- No visual indicator of screenshot capture mode (manual vs auto)

**Revamp to:**
- **Last step preview** — show the last recorded step (action + field name) in the panel
- **Quick note button** — press to add a freetext annotation without interrupting recording
- **Sticky position** — remember panel position across sessions and page navigations
- **Screenshot mode indicator** — show current interval, when next auto-screenshot fires
- **Mini timeline** — horizontal dots showing recent steps, clickable to open review
- **Annotation shortcut** — dedicated button for "mark this as assertion point" (F-014)

---

### R-006 — Session Management: From Flat List to Workspace
**Priority:** P1 | **Complexity:** M | **Need:** Retention

**Current state:** Dropdown list of sessions, basic create/delete/clear operations.

**Pain points:**
- No search within sessions list
- Sessions have no metadata beyond name/date/step count
- Can't see session size (storage usage per session)
- No way to archive sessions without deleting
- Duplicate session names are allowed (confusing)

**Revamp to:**
- **Session search & filter** — search by name, date range, tag, URL
- **Session cards in popup** — show thumbnail of first screenshot, step count, duration, size
- **Archive mode** — move sessions to archived state (still exportable but not in active list)
- **Duplicate detection** — warn when creating a session with the same name
- **Session storage breakdown** — "3.2MB screenshots, 0.4MB steps" per session
- **Quick duplicate** — clone a session as a new template

---

### R-007 — Settings: From Flat Config to Profiles
**Priority:** P2 | **Complexity:** M | **Need:** Retention

**Current state:** Single flat settings panel: interval, quality, max sessions, toggles.

**Pain points:**
- Same settings apply to all sites (some sites need different screenshot intervals)
- No way to quickly switch between "high quality" and "fast/lightweight" modes
- Settings are hard to discover (buried in popup tabs)
- No import/export of settings for team standardization

**Revamp to:**
- **Per-domain settings** — override screenshot interval and quality for specific URLs
- **Setting profiles** — "Fast mode" (15s interval, 85% quality) vs "Documentation mode" (5s, 95% quality)
- **Settings import/export** — share team-standard config as a JSON file
- **Contextual settings prompt** — first time recording a new domain, prompt to configure

---

### R-008 — Field Name Resolver: From Single-Shot to Learning
**Priority:** P1 | **Complexity:** L | **Need:** Retention

**Current state:** 9 strategies run in priority order. If they all fail, user gets a manual entry modal. There's no memory of what the user entered.

**Pain points:**
- Same unlabeled input triggers a manual prompt every single recording
- No learning from user corrections ("this was labeled 'username' last time")
- Framework-generated IDs frequently fail, triggering unnecessary prompts
- Non-English label text may not resolve correctly

**Revamp to:**
- **Field name memory** — store user-entered field names indexed by selector fingerprint; auto-apply on future recordings
- **Site-specific field mappings** — user can pre-configure "this selector always means X field"
- **Bulk field name training** — in review UI, bulk-assign field names and "remember for future"
- **Confidence scoring in UI** — show a confidence badge on field names (high/medium/low)

---

### R-009 — Storage Management: From Reactive to Proactive
**Priority:** P2 | **Complexity:** M | **Need:** Retention

**Current state:** Storage usage indicator, 80%/95% warnings, manual backup/restore.

**Pain points:**
- Users don't know what's taking up space (is it screenshots? steps? which session?)
- Warning appears but user doesn't know which sessions to delete
- Backup is a single JSON blob — no selective restore
- No auto-export before deletion (sessions just disappear)

**Revamp to:**
- **Storage breakdown visualization** — bar chart: per-session, per-type (screenshots vs steps)
- **Smart cleanup suggestions** — "Sessions older than 30 days with 0 exports take 400MB. Archive?"
- **Auto-export before delete** — when storage is critical, prompt "Export and delete oldest 3 sessions?"
- **Selective restore** — pick individual sessions from a backup file to restore
- **Storage health score** — overall health indicator with actionable recommendations

---

### R-010 — Screenshot Capture: From Interval-Based to Intent-Based
**Priority:** P1 | **Complexity:** L | **Need:** Core

**Current state:** Auto-capture at fixed interval (5-60s) + manual capture. Navigation triggers a capture. Simple 1s debounce.

**Pain points:**
- Fixed interval misses important moments (form submission) and wastes storage on unchanged screens
- 1s debounce blocks legitimate rapid captures
- Screenshots have no context label (what step triggered this?)
- High-DPI screens produce oversized captures that are then downscaled
- No way to retake a bad screenshot without deleting the step

**Revamp to:**
- **Event-triggered capture** — capture screenshot on significant events: form submit, modal open/close, navigation, error
- **Smart deduplication for screenshots** — skip if screen hasn't changed significantly (pixel diff threshold)
- **Screenshot labels** — auto-tag each screenshot with the preceding action ("Captured after clicking Submit")
- **Retake screenshot** — in review UI, button to recapture screenshot for a step on the current page
- **Viewport-aware capture** — capture at native DPI but with smart downscaling only for export

---

---

## Part 3: Priority Summary Matrix

### P0 — Must Have (Ship in v1.2.0)

| ID | Feature | Type | Complexity | Need |
|----|---------|------|-----------|------|
| F-001 | Playwright Script Export | New | L | Core |
| F-002 | Cypress Script Export | New | L | Core |
| F-006 | Hover Event Recording | New | M | Core |
| F-016 | AI Assertion Suggestions | New | L | Differentiator |
| R-001 | Review UI: Table View + Bulk Edit | Revamp | L | Core |

### P1 — High Priority (Ship in v1.3.0)

| ID | Feature | Type | Complexity | Need |
|----|---------|------|-----------|------|
| F-003 | Selenium/WebDriver Export | New | M | Core |
| F-004 | Cucumber/Gherkin BDD Export | New | M | Differentiator |
| F-007 | Drag-and-Drop Recording | New | L | Core |
| F-008 | Keyboard Shortcut Recording | New | M | Core |
| F-009 | Scroll Position Recording | New | S | Core |
| F-011 | Multi-Tab Recording | New | XL | Growth |
| F-014 | Custom Assertion Recording | New | L | Core |
| F-017 | AI Step Description Improvement | New | M | Retention |
| F-021 | Session Tags and Folders | New | M | Retention |
| F-022 | Session Export as Shareable Bundle | New | M | Growth |
| F-023 | Inline Step Annotations / Comments | New | S | Retention |
| F-025 | Bulk Export (Multiple Sessions) | New | M | Core |
| F-027 | GitHub / GitLab Integration | New | L | Growth |
| F-030 | First-Run Onboarding Wizard | New | M | Growth |
| R-002 | Selector Strategy: Inspector + Stability | Revamp | M | Retention |
| R-003 | Privacy: Rules Engine + URL Redaction | Revamp | L | Core |
| R-004 | Export Studio: Preview + Templates | Revamp | L | Retention |
| R-005 | Floating Panel: Control Center | Revamp | M | Retention |
| R-006 | Session Management: Workspace | Revamp | M | Retention |
| R-008 | Field Name Resolver: Learning | Revamp | L | Retention |
| R-010 | Screenshot: Event-Triggered + Smart Dedup | Revamp | L | Core |

### P2 — Medium Priority (v1.4.0+)

| ID | Feature | Type | Complexity | Need |
|----|---------|------|-----------|------|
| F-005 | WebdriverIO / Puppeteer Export | New | M | Growth |
| F-010 | Right-Click / Context Menu Recording | New | M | Core |
| F-012 | Browser Console Error Capture | New | M | Retention |
| F-013 | Network Request Capture | New | L | Differentiator |
| F-015 | Video Recording | New | XL | Growth |
| F-018 | Smart Test Smell Detection | New | M | Retention |
| F-019 | AI Session Naming | New | S | Growth |
| F-020 | Duplicate Flow Detection | New | M | Retention |
| F-024 | Session Versioning / History | New | L | Retention |
| F-026 | TestRail / Zephyr / qTest Push | New | L | Growth |
| F-028 | Jira Issue Attachment | New | M | Growth |
| F-029 | Webhook / CI Trigger | New | M | Growth |
| F-031 | Session Templates | New | M | Growth |
| F-032 | Command Palette (Quick Actions) | New | M | Retention |
| F-033 | Notifications / Activity Feed | New | S | Retention |
| F-034 | Firefox Extension Port | New | L | Growth |
| F-036 | Playwright Trace Viewer Integration | New | L | Differentiator |
| R-007 | Settings: Profiles + Per-Domain | Revamp | M | Retention |
| R-009 | Storage: Proactive Management | Revamp | M | Retention |

### P3 — Nice to Have (Future)

| ID | Feature | Type | Complexity | Need |
|----|---------|------|-----------|------|
| F-035 | Safari Extension Port | New | XL | Growth |

---

## Part 4: Strategic Bets

### Bet 1: "Record Once, Run Everywhere"
The product's north star should be **test automation generation**, not documentation generation. The core loop:
1. Record → 2. Review/annotate → 3. Export runnable script → 4. Run in CI

Every feature decision should be evaluated against this loop. P0 features (F-001, F-002, F-006, F-014, F-016) all serve this bet.

---

### Bet 2: "Smart Enough to Trust"
Automation tools fail when the generated output requires heavy manual fixing. The product needs intelligence layers:
- Stable selector selection (R-002)
- Field name memory (R-008)
- Assertion suggestions (F-016)
- Test smell warnings (F-018)

Users who trust the output become daily users. Users who must manually fix every export churn.

---

### Bet 3: "Team-Ready, Not Just Solo"
Currently the product is a solo tool. Team features (F-021, F-022, F-027, F-026) move it from "a tool I use" to "a tool my team uses". This is the path to stickiness and eventually pricing leverage.

---

## Part 5: Open Questions

1. **Who is the primary user today?** Solo QA engineer, or team lead coordinating test coverage? The answer determines whether collaboration features (F-021, F-022, F-027) are P1 or P2.

2. **Is the target test automation framework Playwright or Cypress?** Playwright is growing faster in new projects; Cypress has larger installed base. If only one can ship first, pick based on user research.

3. **AI features: LLM-dependent or rule-based?** F-016 and F-017 can be useful with pure heuristic rules. Adding LLM dependency increases latency, privacy risk, and infrastructure requirements. Start rule-based, add AI enhancement as optional.

4. **What is the distribution channel?** Chrome Web Store limits what metadata is collected. If this is enterprise-sold, team features become P0 not P2.

5. **Screenshot storage is the #1 quota consumer** — is the right answer to compress more aggressively, or to move screenshots to external storage (cloud, local filesystem)? The current filesystem sync exists but is optional.

---

*Document generated: 2026-04-09*
*Product version analyzed: TestSnapper v1.1.5*
