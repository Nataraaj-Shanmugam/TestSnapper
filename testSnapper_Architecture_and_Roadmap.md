# testSnapper — Target Architecture & Feature Roadmap
_Last updated: 2025-10-29 15:02_

## 1) Product Vision (Techno Product Spec)
**Goal:** Turn ad‑hoc UI actions into clean, editable, exportable step-by-step documentation (with optional AI summaries) that QA, PMs, and designers trust.

**Primary Jobs-to-be-Done**
- **QA:** Record reproducible bug steps with screenshots and environment context.
- **PM/Design:** Capture happy-path flows for release notes & onboarding.
- **Support:** Generate “how‑to” guides from real clicks for customers.

---

## 2) Target System Architecture (Chrome Extension, MV3)

```mermaid
flowchart LR
  subgraph Popup/UI
    P1[Action Controls<br/>Start • Pause • Stop • Export]
    P2[Live Step List<br/>Editable Notes]
    P3[Settings<br/>Privacy & Templates]
  end

  subgraph Background Controller
    B1[State Machine<br/>Idle→Recording→Paused→Exporting→Idle]
    B2[Event Buffer & De‑dupe]
    B3[Telemetry & Error Bus]
    B4[Storage: IndexedDB]
  end

  subgraph Content & Page
    C1[Recorder (content.js)<br/>click/input/change/keydown]
    C2[Selector Engine<br/>robust CSS + text + role]
    C3[Redactor/Privacy Filter<br/>passwords • tokens • emails]
    C4[Overlay/Highlighter<br/>visual feedback]
    C5[Screenshot Service<br/>captureVisibleTab + crop]
  end

  subgraph Export & AI
    E1[Normalizer → Step Model]
    E2[Template Engine<br/>DOCX • HTML • Markdown • PDF]
    E3[Asset Store<br/>screenshots + metadata]
    E4[AI Summarizer (webllm-service.js)<br/>Step → prose]
  end

  P1 -->|Commands| B1
  P2 -->|Edits| B4
  P3 -->|Settings| B4

  C1 -->|Events| B2
  C2 --> C1
  C3 --> C1
  C4 --> C1
  C5 --> B2

  B1 -->|State| P1
  B2 -->|Normalized Steps| B4
  B4 -->|Read| P2

  B4 --> E1 --> E2 -->|Blob| P1
  E3 --> E2
  B3 -. errors .-> P1
```

### Key Design Tenets
- **Single source of truth:** Background controls **state & storage**; popup & content are clients.
- **Privacy by default:** Redact sensitive data at **capture time**; never store raw secrets.
- **Deterministic selectors:** Prefer **stable CSS + heuristics** (id, text, role, nth-of-type); keep XPaths as fallback.
- **Idempotent export:** Export can be re-run from stored step model + assets.
- **Resilient messaging:** `chrome.runtime.sendMessage` with **ack + retry + timeouts**.

---

## 3) Data Model (Step & Session)

```json
{
  "sessionId": "uuid",
  "createdAt": "ISO",
  "env": {
    "url": "https://app.example.com/path",
    "title": "Page Title",
    "ua": "Chrome/...",
    "viewport": {"w": 1440, "h": 900}
  },
  "steps": [
    {
      "id": "uuid",
      "t": 1730188800000,
      "action": "click|type|select|navigate|scroll|submit",
      "selector": { "css": "#save", "text": "Save", "role": "button" },
      "targetLabel": "Save",
      "value": "•••",
      "url": "https://app.example.com/edit",
      "screenshotId": "uuid-or-null",
      "notes": "optional user note",
      "meta": { "domPath": "...", "frame": "top" }
    }
  ]
}
```

**Redaction rules:** ignore inputs with `type=password`, `data-sensitive`, `name=token|password|secret`, and mask emails/numbers by default.

---

## 4) State Machine (happy path)

```
Idle
 └─ Start → Recording
Recording
 ├─ Pause → Paused
 ├─ Stop  → Exporting → Idle
 └─ Error → ErrorShown → Idle
Paused
 ├─ Resume → Recording
 └─ Stop   → Exporting → Idle
```

**Guardrails:** deny “Start” if already recording; prevent “Export” when buffer empty; throttle screenshots.

---

## 5) MVP → GA Feature Roadmap

### Phase 0.1 — **Reliability & Privacy Hardening** (1–2 sprints)
- Centralize state & steps in **background** (IndexedDB).
- Build **ack/retry** wrapper for messaging.
- Implement **redaction** & field-ignore list (+ unit tests).
- Minimal **recording indicator** (badge + small overlay).
- **KPI:** Crash‑free sessions > 99%, P0 bugs < 3.

### Phase 0.2 — **UX Polish & Trust** (1 sprint)
- Popup shows **live step count**, state, and **undo last**.
- Visual **element highlighter** on capture.
- Basic **toasts/notifications** for success/failure.
- **KPI:** Task success 90% in 5‑user usability test.

### Phase 0.3 — **Export v2** (2 sprints)
- **Templates**: DOCX (company style), Markdown, HTML.
- Step numbering + timestamps + environment header.
- **Screenshot per key step** (click/submit/navigate).
- **KPI:** 80% exports accepted without manual edits.

### Phase 0.4 — **AI Assistance** (1–2 sprints)
- Local `webllm-service.js` summarization to **prose**:
  - “Convert steps → readable test case.”
  - “Generate bug repro steps.”
- Inline **rewrite** (“make concise”, “formal tone”).
- **KPI:** Documentation creation time ↓ 50%.

### Phase 0.5 — **Collaboration & Sharing** (2 sprints)
- Export **bundle** (HTML+assets zip) and sharable link.
- Import/edit previous sessions.
- **KPI:** Repeat usage (W2 retention) ≥ 30%.

### Phase 0.6 — **Coverage & Compliance** (2 sprints)
- Firefox (MV3 polyfill), Edge support.
- Basic **telemetry** (opt‑in): errors, step counts only.
- **KPI:** Cross‑browser pass rate ≥ 95%.

### Phase 1.0 — **GA Readiness**
- Permissions minimization review, privacy audit.
- Docs, onboarding, sample templates.
- **KPI:** Support tickets < 2% of MAU.

---

## 6) Concrete Work Items (Engineering Backlog)

**Recording & Capture**
- [ ] Content: unified listener (click, input, change, keydown).
- [ ] Selector Engine: CSS + text + role, fallback XPath; score & store.
- [ ] Overlay: hover/flash target; badge step number.
- [ ] Screenshot: `captureVisibleTab` + crop to target bounds.

**Background & Storage**
- [ ] State machine + event buffer (dedupe, coalesce fast inputs).
- [ ] IndexedDB schema (`sessions`, `steps`, `assets`).
- [ ] Messaging wrapper with ack/retry/timeout.

**Export**
- [ ] Normalizer → Step model.
- [ ] Template engine; DOCX via `docx` + Markdown + HTML.
- [ ] Asset embed (images resized; alt text from selector/label).
- [ ] Idempotent re-export from session id.

**AI**
- [ ] webLLM integration; prompt templates (test case, repro, guide).
- [ ] On‑device model fallback or graceful disable.
- [ ] Safety: never include redacted values in prompts.

**UI/UX**
- [ ] Popup React mini‑app; state via `chrome.storage.session`.
- [ ] Live list with inline notes and delete/reorder.
- [ ] Settings: redaction rules, screenshot cadence, export template.

**Security & Privacy**
- [ ] Permission audit (avoid `*://*/*` when feasible).
- [ ] Mask/ignore sensitive fields at source; configurable allowlist.
- [ ] CSP & dependency review; no eval/dynamic code.

---

## 7) Risks & Mitigations
- **Fragile selectors on SPAs** → Use **role/text** and retry strategies; consider DOM mutation observers to re‑resolve.
- **Large screenshots** → Resize/compress, cap per step, user‑configurable cadence.
- **Org privacy constraints** → Default **local‑only** processing; explicit opt‑in telemetry.
- **MV3 limitations** → Avoid heavy work in service worker; offload to tabs via messaging.

---

## 8) Folder Structure (Proposed)
```
src/
  background/
    controller.ts
    storage.ts
    messaging.ts
  content/
    recorder.ts
    selector.ts
    overlay.ts
    redactor.ts
    screenshot.ts
  export/
    normalize.ts
    templates/
      docx.ts
      markdown.ts
      html.ts
  popup/
    App.tsx
    state.ts
  ai/
    summarizer.ts (webllm)
  types/
    models.ts
```

---

## 9) Acceptance Scenarios (Examples)
- **As a QA**, I can record a bug repro, see live step count, and export a DOCX with numbered steps + screenshots.
- **As a PM**, I can edit the step titles in‑popup and export a clean Markdown checklist.
- **As a Security reviewer**, I can verify no secrets leave the machine and redaction works via a sample form.

---

## 10) KPIs to Watch
- Time to first useful export
- % Exports accepted without manual edits
- Crash‑free sessions
- Weekly retention (creation → export)

---

## 11) Example Template Snippet (Markdown)

```markdown
# Test Case: {title}
**Env:** {url} — {ua} — {viewport.w}x{viewport.h} — {createdAt}

{#each steps}
**Step {@index+1} — {this.action}:** {this.targetLabel}  
Selector: `{this.selector.css}`  
{#if this.screenshotId}![Step {@index+1}](./assets/{this.screenshotId}.png){/if}
{/each}
```
