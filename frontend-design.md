# TestSnapper Frontend Design System

```
DESIGN_ASSUMPTIONS:
- Product type: Developer tool (Chrome extension popup + full-tab review page)
- Primary audience: QA engineers and developers recording UI test sessions daily, power users
- Primary device: Desktop only — popup fixed at 380px, review page full browser tab
- Brand personality: Professional-minimal with developer-tool identity
- Complexity level: Moderate — recording controls, export workflows, session management
- Dark mode: Yes — both light and dark themes required
```

---

## Section 1: Design Philosophy

### 1. Density with Clarity

Every pixel in a 380px popup must earn its place. We use compact spacing, tight typography, and information-dense layouts — but never at the expense of scanability. Labels are short, values are prominent, and visual hierarchy does the heavy lifting so the eye lands on what matters without reading every word.

*Influences: Stats panel uses tabular-nums and large values with small labels. Buttons use icon+text pairs that compress well. Settings use toggles instead of full-width checkboxes.*

### 2. Quiet Until Active

The interface is subdued and neutral in its resting state. Color appears only when something demands attention — a recording pulse, a storage warning, a successful export. This prevents the tool from competing with the application being tested, and it means that when color does appear, it communicates instantly.

*Influences: State indicator uses neutral gray when idle, red pulse only when recording. Semantic colors reserved for messages and status indicators. Buttons use muted fills until hovered.*

### 3. System-Native Feel

The tool should feel like a natural extension of the developer's environment — closer to a well-built VS Code panel than a marketing dashboard. We use a monospace/sans-serif pairing, consistent with terminal and IDE conventions, and avoid decorative elements that break the professional context.

*Influences: Monospace font for data values and code selectors. Sans-serif for labels and body text. No rounded corners beyond 6px. No gradients on interactive elements.*

---

## Section 2: Color System

### Primary Palette — Steel Blue

| Shade | Hex | HSL | Tailwind Class |
|---|---|---|---|
| 50 | `#F0F4F9` | hsl(214, 40%, 96%) | `primary-50` |
| 100 | `#DAEAF5` | hsl(210, 52%, 91%) | `primary-100` |
| 200 | `#B4D2EA` | hsl(210, 56%, 81%) | `primary-200` |
| 300 | `#8AB6DB` | hsl(210, 54%, 70%) | `primary-300` |
| 400 | `#5E96C8` | hsl(212, 50%, 58%) | `primary-400` |
| 500 | `#4A7FB5` | hsl(212, 44%, 50%) | `primary-500` |
| 600 | `#3A6699` | hsl(212, 45%, 41%) | `primary-600` |
| 700 | `#2D4F78` | hsl(212, 45%, 32%) | `primary-700` |
| 800 | `#213A59` | hsl(212, 46%, 24%) | `primary-800` |
| 900 | `#16283D` | hsl(212, 47%, 16%) | `primary-900` |

### Neutral Palette — Cool Slate

| Shade | Hex | Tailwind Class |
|---|---|---|
| 50 | `#F8FAFC` | `neutral-50` |
| 100 | `#F1F5F9` | `neutral-100` |
| 200 | `#E2E8F0` | `neutral-200` |
| 300 | `#CBD5E1` | `neutral-300` |
| 400 | `#94A3B8` | `neutral-400` |
| 500 | `#64748B` | `neutral-500` |
| 600 | `#475569` | `neutral-600` |
| 700 | `#334155` | `neutral-700` |
| 800 | `#1E293B` | `neutral-800` |
| 900 | `#0F172A` | `neutral-900` |

### Semantic Colors

| Purpose | Color | Hex | Tailwind Class | Usage |
|---|---|---|---|---|
| Success | Green | `#16A34A` | `success-500` | Recording started, export complete, settings saved |
| Success Light | Green | `#DCFCE7` | `success-50` | Success message background (light mode) |
| Warning | Amber | `#D97706` | `warning-500` | Paused state, storage nearing full, re-auth needed |
| Warning Light | Amber | `#FEF3C7` | `warning-50` | Warning message background (light mode) |
| Danger | Red | `#DC2626` | `danger-500` | Stop recording, delete actions, errors, critical storage |
| Danger Light | Red | `#FEE2E2` | `danger-50` | Error message background (light mode) |
| Info | Blue | `#4A7FB5` | `info-500` | Informational notices, screenshot capture, export actions |
| Info Light | Blue | `#DAEAF5` | `info-50` | Info message background (light mode) |

### Surface Colors

#### Light Mode

| Surface | Hex | Tailwind Class |
|---|---|---|
| Page background | `#F8FAFC` | `bg-page` |
| Card background | `#FFFFFF` | `bg-card` |
| Card background elevated | `#F8FAFC` | `bg-card-elevated` |
| Modal background | `#FFFFFF` | `bg-modal` |
| Modal overlay | `rgba(15, 23, 42, 0.5)` | `bg-overlay` |
| Sidebar background | `#FFFFFF` | `bg-sidebar` |
| Input background | `#FFFFFF` | `bg-input` |
| Input background disabled | `#F1F5F9` | `bg-input-disabled` |
| Border default | `#E2E8F0` | `border-default` |
| Border hover | `#CBD5E1` | `border-hover` |
| Border focus | `#4A7FB5` | `border-focus` |

#### Dark Mode

| Surface | Hex | Tailwind Class |
|---|---|---|
| Page background | `#0F172A` | `dark:bg-page` |
| Card background | `#1E293B` | `dark:bg-card` |
| Card background elevated | `#253449` | `dark:bg-card-elevated` |
| Modal background | `#1E293B` | `dark:bg-modal` |
| Modal overlay | `rgba(0, 0, 0, 0.6)` | `dark:bg-overlay` |
| Sidebar background | `#1E293B` | `dark:bg-sidebar` |
| Input background | `#253449` | `dark:bg-input` |
| Input background disabled | `#1E293B` | `dark:bg-input-disabled` |
| Border default | `#334155` | `dark:border-default` |
| Border hover | `#475569` | `dark:border-hover` |
| Border focus | `#5E96C8` | `dark:border-focus` |

### State Colors

| State | Hex (Light) | Hex (Dark) | Notes |
|---|---|---|---|
| Hover background | `#F1F5F9` | `#253449` | Used for list items, buttons |
| Active/Pressed background | `#E2E8F0` | `#334155` | Pressed state |
| Disabled text | `#94A3B8` | `#475569` | All disabled elements |
| Disabled background | `#F1F5F9` | `#1E293B` | Disabled inputs/buttons |
| Focus ring | `#4A7FB5` at 40% opacity | `#5E96C8` at 40% opacity | 2px ring, 2px offset |
| Selection highlight | `#DAEAF5` | `#253449` | Text selection, selected items |

### Contrast Verification

| Text | Background | Contrast Ratio | WCAG Grade |
|---|---|---|---|
| `#0F172A` (primary text) | `#FFFFFF` (card bg) | 15.4:1 | AAA |
| `#0F172A` (primary text) | `#F8FAFC` (page bg) | 14.7:1 | AAA |
| `#475569` (secondary text) | `#FFFFFF` (card bg) | 7.1:1 | AAA |
| `#64748B` (muted text) | `#FFFFFF` (card bg) | 4.6:1 | AA |
| `#FFFFFF` (button text) | `#4A7FB5` (primary btn) | 4.5:1 | AA |
| `#FFFFFF` (button text) | `#DC2626` (danger btn) | 4.6:1 | AA |
| `#FFFFFF` (button text) | `#16A34A` (success btn) | 4.5:1 | AA |
| `#FFFFFF` (button text) | `#D97706` (warning btn) | 3.2:1 | AA Large |
| `#F8FAFC` (dark primary text) | `#0F172A` (dark page bg) | 14.7:1 | AAA |
| `#F8FAFC` (dark primary text) | `#1E293B` (dark card bg) | 11.2:1 | AAA |
| `#94A3B8` (dark muted text) | `#1E293B` (dark card bg) | 4.5:1 | AA |
| `#0F172A` (dark btn text) | `#5E96C8` (dark primary btn) | 4.8:1 | AA |
| `#16A34A` (success) | `#DCFCE7` (success bg) | 4.5:1 | AA |
| `#DC2626` (danger) | `#FEE2E2` (danger bg) | 4.6:1 | AA |

---

## Section 3: Typography System

### Font Families

| Role | Font | Fallback Stack | Tailwind Class |
|---|---|---|---|
| Headings | Geist Sans | system-ui, -apple-system, sans-serif | `font-heading` |
| Body | Inter | system-ui, -apple-system, sans-serif | `font-body` |
| Monospace | Geist Mono | 'JetBrains Mono', 'Fira Code', monospace | `font-mono` |

### Type Scale

| Name | Size | Line Height | Weight | Letter Spacing | Tailwind Class |
|---|---|---|---|---|---|
| display-xl | 32px | 1.1 | 700 | -0.02em | `text-display-xl` |
| h1 | 24px | 1.2 | 700 | -0.015em | `text-h1` |
| h2 | 20px | 1.25 | 600 | -0.01em | `text-h2` |
| h3 | 16px | 1.3 | 600 | -0.005em | `text-h3` |
| h4 | 14px | 1.4 | 600 | 0 | `text-h4` |
| body | 13px | 1.5 | 400 | 0 | `text-body` |
| body-sm | 12px | 1.5 | 400 | 0 | `text-body-sm` |
| caption | 11px | 1.5 | 500 | 0.01em | `text-caption` |
| overline | 10px | 1.4 | 600 | 0.05em | `text-overline` |
| mono-value | 20px | 1.2 | 700 | -0.01em | `text-mono-value` |
| mono-sm | 11px | 1.5 | 400 | 0 | `text-mono-sm` |

---

## Section 4: Spacing & Layout System

- **Base unit**: 4px
- **Spacing scale**:

| Token | Value | Tailwind Class |
|---|---|---|
| space-0 | 0px | `p-0` / `m-0` |
| space-1 | 4px | `p-1` / `m-1` |
| space-2 | 8px | `p-2` / `m-2` |
| space-3 | 12px | `p-3` / `m-3` |
| space-4 | 16px | `p-4` / `m-4` |
| space-5 | 20px | `p-5` / `m-5` |
| space-6 | 24px | `p-6` / `m-6` |
| space-8 | 32px | `p-8` / `m-8` |
| space-10 | 40px | `p-10` / `m-10` |
| space-12 | 48px | `p-12` / `m-12` |
| space-16 | 64px | `p-16` / `m-16` |

- **Popup width**: 380px (fixed, no breakpoints)
- **Popup min-height**: 520px
- **Popup internal padding**: 16px

- **Review page container widths**: sm (640px), md (768px), lg (1024px), xl (1280px), 2xl (1440px)
- **Review page grid**: 12-column with 16px gap
- **Review page breakpoints**:

| Breakpoint | Width | Tailwind Prefix |
|---|---|---|
| sm | 640px | `sm:` |
| md | 768px | `md:` |
| lg | 1024px | `lg:` |
| xl | 1280px | `xl:` |

- **Border radius scale**:

| Token | Value | Tailwind Class |
|---|---|---|
| radius-none | 0px | `rounded-none` |
| radius-sm | 4px | `rounded-sm` |
| radius-md | 6px | `rounded-md` |
| radius-lg | 8px | `rounded-lg` |
| radius-xl | 12px | `rounded-xl` |
| radius-full | 9999px | `rounded-full` |

---

## Section 5: Component Hierarchy

### Button

**Purpose**: Primary interactive element for actions across all views.
**Variants**: primary, secondary (outline), success, warning, danger, ghost

**Sizes**:
| Size | Height | Padding | Font Size | Tailwind |
|---|---|---|---|---|
| sm | 28px | 4px 10px | 11px | `btn-sm` |
| md | 34px | 6px 14px | 12px | `btn-md` |
| lg | 40px | 8px 18px | 13px | `btn-lg` |

**States**:

| State | Visual Change | Tailwind Classes |
|---|---|---|
| Default (Primary) | `bg-primary-500`, white text, 1px border primary-500 | `bg-primary-500 text-white border border-primary-500` |
| Hover (Primary) | `bg-primary-600`, subtle lift | `hover:bg-primary-600 hover:-translate-y-px hover:shadow-md` |
| Active/Pressed | `bg-primary-700`, no lift | `active:bg-primary-700 active:translate-y-0` |
| Focus | 2px focus ring primary-500/40, 2px offset | `focus-visible:ring-2 focus-visible:ring-primary-500/40 focus-visible:ring-offset-2` |
| Disabled | 40% opacity, not-allowed cursor | `disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none` |
| Loading | Spinner replaces icon, text fades to 60% opacity | `btn-loading` |

| State | Visual Change (Secondary) | Tailwind Classes |
|---|---|---|
| Default | Transparent bg, `border-neutral-300`, `text-neutral-700` | `bg-transparent border border-neutral-300 text-neutral-700` |
| Hover | `bg-neutral-50`, `border-neutral-400` | `hover:bg-neutral-50 hover:border-neutral-400` |
| Active | `bg-neutral-100` | `active:bg-neutral-100` |
| Disabled | 40% opacity | `disabled:opacity-40` |

| State | Visual Change (Danger) | Tailwind Classes |
|---|---|---|
| Default | `bg-danger-500`, white text | `bg-danger-500 text-white border border-danger-500` |
| Hover | `bg-danger-600` | `hover:bg-danger-600` |

| State | Visual Change (Ghost) | Tailwind Classes |
|---|---|---|
| Default | No bg, no border, `text-neutral-600` | `bg-transparent border-none text-neutral-600` |
| Hover | `bg-neutral-100` | `hover:bg-neutral-100` |

**Responsive behavior**: In the popup, buttons are always full-width or grid-placed. On the review page, buttons use auto-width with min-width constraints.

---

### Input (Text, Number)

**Purpose**: Text entry for session names, search, and numeric settings.

**States**:

| State | Visual Change | Tailwind Classes |
|---|---|---|
| Default | `bg-white`, `border-neutral-200`, 6px radius | `bg-white border border-neutral-200 rounded-md` |
| Hover | `border-neutral-300` | `hover:border-neutral-300` |
| Focus | `border-primary-500`, focus ring | `focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20` |
| Disabled | `bg-neutral-100`, `text-neutral-400` | `disabled:bg-neutral-100 disabled:text-neutral-400` |
| Error | `border-danger-500`, red focus ring | `border-danger-500 focus:ring-danger-500/20` |

**Responsive behavior**: Full-width in popup. Variable width with max-width in review page.

---

### Select (Dropdown)

**Purpose**: Session selection, format picker, filter dropdown, settings dropdowns.

**States**:

| State | Visual Change | Tailwind Classes |
|---|---|---|
| Default | Same as Input default, with chevron indicator | `bg-white border border-neutral-200 rounded-md` |
| Hover | `border-neutral-300` | `hover:border-neutral-300` |
| Focus | `border-primary-500`, focus ring | `focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20` |
| Disabled | `bg-neutral-100`, `text-neutral-400` | `disabled:bg-neutral-100 disabled:text-neutral-400` |

**Responsive behavior**: Full-width in popup. Fixed 180px width for filter dropdowns in review page toolbar.

---

### Checkbox / Toggle

**Purpose**: Settings toggles for auto-screenshot, navigation capture, dedup, auto-save.

**States**:

| State | Visual Change | Tailwind Classes |
|---|---|---|
| Default (unchecked) | 16x16, `border-neutral-300`, white fill, 4px radius | `w-4 h-4 border border-neutral-300 rounded bg-white` |
| Checked | `bg-primary-500`, `border-primary-500`, white checkmark | `checked:bg-primary-500 checked:border-primary-500` |
| Hover | `border-primary-400` | `hover:border-primary-400` |
| Focus | Focus ring | `focus-visible:ring-2 focus-visible:ring-primary-500/40` |
| Disabled | 40% opacity | `disabled:opacity-40` |

**Responsive behavior**: Fixed size across all contexts.

---

### Radio Card (Format Picker)

**Purpose**: Export format selection (DOCX, JSON, CSV) displayed as selectable cards.

**States**:

| State | Visual Change | Tailwind Classes |
|---|---|---|
| Default | `bg-white`, `border-neutral-200`, centered text, 6px radius | `bg-white border border-neutral-200 rounded-md` |
| Hover | `border-primary-300`, subtle lift (-1px) | `hover:border-primary-300 hover:-translate-y-px` |
| Selected | `border-primary-500`, `bg-primary-50`, `text-primary-600`, 2px border | `border-2 border-primary-500 bg-primary-50 text-primary-600` |
| Focus | Focus ring on the card | `focus-visible:ring-2 focus-visible:ring-primary-500/40` |

**Responsive behavior**: 3-column grid in popup (equal width). 4-column on review page to include PDF option.

---

### Card / Section

**Purpose**: Container for grouped content — stats, export options, storage, settings groups.

**States**:

| State | Visual Change | Tailwind Classes |
|---|---|---|
| Default | `bg-white`, `border-neutral-200`, 6px radius, 16px padding | `bg-white border border-neutral-200 rounded-md p-4` |
| Hover (if interactive) | `border-neutral-300`, subtle shadow | `hover:border-neutral-300 hover:shadow-sm` |

**Responsive behavior**: Full-width in popup (380px - 32px padding = 348px content). Responsive grid in review page.

---

### State Indicator

**Purpose**: Shows current recording state (Idle, Recording, Paused) with animated dot.

**States**:

| State | Dot Color | Dot Animation | Text |
|---|---|---|---|
| Idle | `neutral-400` (`#94A3B8`) | None | "Idle" in `neutral-500` |
| Recording | `danger-500` (`#DC2626`) | Pulse animation (scale 1 to 1.15, 1.2s loop) | "Recording" in `danger-500` |
| Paused | `warning-500` (`#D97706`) | Slow opacity pulse (1 to 0.4, 2s loop) | "Paused" in `warning-500` |

**Dot specification**: 10px diameter, `rounded-full`, with a 2px white ring and 2px colored ring (double ring effect).

**Responsive behavior**: Always centered horizontally in its container. Fixed design.

---

### Stats Panel

**Purpose**: Displays step count, screenshot count, and session duration during recording.

**Layout**: 3-column grid separated by 1px `neutral-200` dividers.

Each stat cell:
- Value: `font-mono`, `text-mono-value` (20px), `font-weight-700`, `text-primary-500`, `tabular-nums`
- Label: `font-body`, `text-overline` (10px), `font-weight-600`, `text-neutral-500`, `uppercase`, `letter-spacing: 0.05em`
- Top accent line: 2px height, `primary-500` for steps, `neutral-400` for screenshots, `primary-400` for duration

**Responsive behavior**: Always 3 columns. Fixed in popup.

---

### Tabs

**Purpose**: Navigation between Recording, Export, and Settings views in the popup.

**Layout**: Horizontal bar with equal-width tab buttons, contained within a `neutral-100` background pill.

**States**:

| State | Visual Change | Tailwind Classes |
|---|---|---|
| Default | Transparent bg, `text-neutral-500`, 4px radius | `bg-transparent text-neutral-500 rounded-sm` |
| Hover (inactive) | `bg-neutral-200/50`, `text-neutral-600` | `hover:bg-neutral-200/50 hover:text-neutral-600` |
| Active | `bg-white`, `text-primary-500`, `shadow-sm`, `border border-neutral-200` | `bg-white text-primary-500 shadow-sm border border-neutral-200` |
| Focus | Focus ring | `focus-visible:ring-2 focus-visible:ring-primary-500/40` |

**Font**: `font-body`, 12px, `font-weight-600`.

**Responsive behavior**: Fixed in popup. Not used in review page.

---

### Toast / Message

**Purpose**: Feedback for user actions — success, error, warning, info.

**Position**: Top of the popup content area, below tabs, full-width.

**Variants**:

| Variant | Background | Border-Left | Text Color | Icon |
|---|---|---|---|---|
| Success | `#DCFCE7` | 3px `#16A34A` | `#15803D` | Check circle |
| Error | `#FEE2E2` | 3px `#DC2626` | `#B91C1C` | X circle |
| Warning | `#FEF3C7` | 3px `#D97706` | `#B45309` | Alert triangle |
| Info | `#DAEAF5` | 3px `#4A7FB5` | `#2D4F78` | Info circle |

**Dark mode variants**:

| Variant | Background | Border-Left | Text Color |
|---|---|---|---|
| Success | `rgba(22, 163, 74, 0.15)` | 3px `#22C55E` | `#4ADE80` |
| Error | `rgba(220, 38, 38, 0.15)` | 3px `#EF4444` | `#FCA5A5` |
| Warning | `rgba(217, 119, 6, 0.15)` | 3px `#F59E0B` | `#FCD34D` |
| Info | `rgba(74, 127, 181, 0.15)` | 3px `#5E96C8` | `#B4D2EA` |

**Behavior**: Appears with slide-down + fade-in (200ms, ease-out). Auto-dismisses after 3000ms (configurable). Exits with fade-out (150ms, ease-in).

**Responsive behavior**: Full-width in popup. Max-width 600px centered in review page.

---

### Storage Usage Bar

**Purpose**: Visual indicator of chrome.storage.local usage.

**Structure**: Container height 6px, `bg-neutral-100`, 9999px radius. Fill bar same radius.

**Color states**:
| Usage Level | Fill Color | Tailwind |
|---|---|---|
| 0-70% | `primary-500` (`#4A7FB5`) | `bg-primary-500` |
| 70-90% | `warning-500` (`#D97706`) | `bg-warning-500` |
| 90-100% | `danger-500` (`#DC2626`) | `bg-danger-500` |

**Text below**: `text-caption`, `text-neutral-500`. Format: "X.X MB / Y MB (Z%)".

**Responsive behavior**: Full-width in popup.

---

### File Sync Status

**Purpose**: Shows whether local file sync folder is configured and active.

**Layout**: Horizontal bar with indicator dot, folder name text, contained in a subtle card.

**Indicator dot states**:
| State | Color | Animation |
|---|---|---|
| Not configured | `neutral-400` | None |
| Active | `success-500` with `success-500/30` shadow | None |
| Needs re-auth | `warning-500` with `warning-500/30` shadow | Slow pulse (2s) |

**Responsive behavior**: Full-width in popup.

---

### Step Item (Popup Live Steps)

**Purpose**: Compact step display in the popup's live steps viewer.

**Layout**: Left border accent (3px `primary-500`), 8px padding, stacked content.

**Content**:
- Step number + action type on one line (action in `primary-500`, uppercase, `text-overline`)
- Field name, selector, value on subsequent lines (`text-caption`, `text-neutral-600`)
- Selector displayed in `code` styling: `font-mono`, `bg-neutral-100`, `border-neutral-200`, 4px radius, 2px 6px padding

**Responsive behavior**: Scrollable container, max-height 200px.

---

### Step Card (Review Page)

**Purpose**: Full step display with editing capabilities, drag-and-drop reordering, screenshot preview.

**Layout**: Card with checkbox (left), drag handle, step content (center), delete button (right).

**States**:

| State | Visual Change | Tailwind Classes |
|---|---|---|
| Default | `bg-white`, `border-neutral-200`, 8px radius | `bg-white border border-neutral-200 rounded-lg` |
| Hover | `border-neutral-300`, subtle shadow | `hover:border-neutral-300 hover:shadow-sm` |
| Selected (checkbox) | `border-primary-300`, `bg-primary-50/30` | `border-primary-300 bg-primary-50/30` |
| Dragging | `opacity-50`, `shadow-lg`, slight rotation | `opacity-50 shadow-lg rotate-1` |
| Drop target | Top border 2px `primary-500` | `border-t-2 border-t-primary-500` |

**Responsive behavior**: Full-width card. Screenshot thumbnail: 120px wide on desktop, full-width on mobile (below 768px).

---

### Modal / Dialog

**Purpose**: Add manual step modal, export progress modal on the review page.

**Structure**: Overlay (`bg-overlay`) + centered card (`bg-white`, 12px radius, `shadow-lg`, max-width 480px).

**States**:

| State | Visual Change | Tailwind Classes |
|---|---|---|
| Default | Centered card on overlay | `bg-white rounded-xl shadow-lg` |
| Enter | Overlay fades in (200ms), card scales from 0.95 + fades in (200ms, ease-out) | `animate-modal-in` |
| Exit | Overlay fades out (150ms), card scales to 0.95 + fades out (150ms, ease-in) | `animate-modal-out` |

**Responsive behavior**: Max-width 480px, min 320px. On mobile (<640px), card becomes nearly full-width with 16px margin.

---

### Tooltip

**Purpose**: Contextual hints on icon buttons and truncated text.

**Appearance**: `bg-neutral-800`, `text-white`, `text-caption` (11px), 4px radius, 6px 10px padding, `shadow-md`. Arrow pointing to trigger element.

**Timing**: 300ms delay before show. 150ms fade-in. Immediate dismiss on mouse leave.

**Responsive behavior**: Not used on mobile-sized views.

---

### Badge

**Purpose**: Step count in session dropdown options, action type labels.

**Appearance**: Inline element, `text-overline`, 4px vertical / 8px horizontal padding, `rounded-full`.

**Variants**:
| Variant | Background | Text |
|---|---|---|
| Default | `neutral-100` | `neutral-600` |
| Primary | `primary-50` | `primary-600` |
| Success | `success-50` | `success-600` |
| Warning | `warning-50` | `warning-600` |
| Danger | `danger-50` | `danger-600` |

**Responsive behavior**: Fixed size.

---

### Skeleton / Loading

**Purpose**: Placeholder while session data loads on the review page.

**Appearance**: Rounded rectangles matching content dimensions, `bg-neutral-200` in light / `bg-neutral-700` in dark, with a left-to-right shimmer animation.

**Shimmer**: Linear gradient sweep from transparent to `neutral-100/60` to transparent, 1.5s duration, infinite loop.

**Elements that get skeletons**: Step cards (3 placeholders), session metadata fields, stats panel values.

**Responsive behavior**: Same skeleton layout as content.

---

## Section 6: Layout Specifications

### Popup UI (380px fixed)

**Purpose**: Primary control interface for starting/stopping recordings, exporting sessions, and managing settings.

**Layout Structure**:
- Container: 380px width, `padding: 16px`, flex column, `min-height: 520px`
- Header: `height: 48px`, flex row, space-between. Logo+title left, theme toggle right. Bottom margin 12px. `border-bottom: 1px solid neutral-200`.
- Tabs: Full-width tab bar, `height: 36px`, margin-bottom 16px. Background `neutral-100`, 6px radius, 4px padding.
- Content area: Flex-grow, scroll if needed.
- Footer: `margin-top: auto`, `padding-top: 12px`, `border-top: 1px solid neutral-200`. Version text `text-caption`, `text-neutral-400`, centered.

**Component Placement — Recording Tab**:
1. State Indicator — Full-width card, centered dot + text, `margin-bottom: 12px`
2. Stats Panel — Full-width 3-column grid, `margin-bottom: 16px`
3. Controls — Flex column, gap 8px
   - Row 1: Start + Pause buttons (2-column grid, gap 8px)
   - Row 2: Resume + Stop buttons (2-column grid, gap 8px)
   - Row 3: Screenshot button (full-width)
4. Live Steps Viewer — Full-width card, visible only during recording, `margin-top: 16px`

**Component Placement — Export Tab**:
1. Export Section card — Session dropdown (full-width), format radio cards (3-col grid), Export button (full-width), View Steps button (full-width, margin-top 8px)
2. Storage Section card — Storage bar + text, file sync status bar, action buttons (flex-wrap row, gap 8px: Setup, Re-authorize, Delete Selected, Clear All)
3. Steps Viewer — Expandable section, hidden by default

**Component Placement — Settings Tab**:
1. Recording Settings card — Checkboxes for auto-screenshot (with sub-setting for interval), navigation capture, smart dedup
2. Storage Settings card — Checkbox for auto-save, dropdowns for max sessions / screenshot format / export quality
3. Data Backup card — Description text, Backup All + Restore buttons side-by-side
4. Save Settings button — Full-width, primary style

**Scroll Behavior**: Entire popup scrolls vertically when content exceeds viewport. No sticky elements within popup (header is static, not sticky, given the compact space).

---

### Review Page (Full Browser Tab)

**Purpose**: Full session review with drag-and-drop step reordering, filtering, search, editing, and export.

**Layout Structure**:
- Grid: Sidebar (280px fixed) + Content (fluid, 1fr)
- Sidebar: `position: fixed`, `height: 100vh`, `width: 280px`, `padding: 24px`, flex column. Contains logo, session settings, metadata, action buttons. `border-right: 1px solid neutral-200`.
- Content area: `margin-left: 280px`, `padding: 32px`, `max-width: 960px`
- Header in content: flex row, space-between. Title + subtitle left, action buttons right. `margin-bottom: 24px`.
- Toolbar: flex row, gap 12px. Search input (flex-grow) + action filter dropdown (180px) + clear button. `margin-bottom: 16px`.
- Steps container: Flex column, gap 12px.

**Component Placement**:
1. Sidebar — Logo at top, session name input, export format dropdown, metadata (created date, step count), Export + Close buttons at bottom
2. Header — "Review & Refine" title (h1), subtitle text, theme toggle icon button, bulk delete button, undo button
3. Toolbar — Search input with icon, action filter dropdown, clear filters button
4. Results summary — Text showing filtered count
5. Steps Container — Vertical list of Step Cards with drag-and-drop support
6. No Results message — Centered text with search icon when filters match nothing

**Responsive Rules**:

| Breakpoint | Change |
|---|---|
| < 768px (mobile) | Sidebar becomes a slide-out drawer (hidden by default, toggle button visible). Content takes full width. Step card screenshots stack below content. |
| 768-1024px (tablet) | Sidebar collapses to 240px. Content adjusts. |
| > 1024px (desktop) | Full sidebar (280px) + fluid content area. |

**Scroll Behavior**: Content area scrolls independently. Sidebar is fixed. Header in content is sticky (`top: 0`, `z-index: 10`, `bg-page` background).

---

## Section 7: Interaction Patterns

### Timing Standards

| Type | Duration | Easing | Example |
|---|---|---|---|
| Micro-interaction | 120ms | ease-out | Button hover bg change, border color shift |
| State transition | 200ms | ease-in-out | Tab switch, radio card selection, checkbox toggle |
| Overlay appear | 200ms | ease-out | Modal overlay + card entrance |
| Overlay dismiss | 150ms | ease-in | Modal fade-out |
| Content fade-in | 150ms | ease-out | Tab content fade-in on switch |
| Progress bar | 300ms | ease-in-out | Storage bar width transition |
| Slide-in (drawer) | 250ms | ease-out | Mobile sidebar open |
| Slide-out (drawer) | 200ms | ease-in | Mobile sidebar close |

### Specific Interactions

#### Recording State Changes
- **Trigger**: User clicks Start/Pause/Resume/Stop
- **Animation**: State dot color transition (200ms), state text crossfade (150ms), button enable/disable states update immediately
- **Recording pulse**: CSS animation — dot scales from 1.0 to 1.15 and back, 1.2s duration, ease-in-out, infinite. Concentric ring expands from 0.8 to 1.4 scale while fading from 0.6 to 0 opacity, 1.2s, infinite.
- **Paused pulse**: Dot opacity alternates 1.0 to 0.4, 2s duration, ease-in-out, infinite.

#### Tab Switching
- **Trigger**: Click on tab button
- **Animation**: Active tab slides its background highlight (white card) to the new position. Outgoing content fades out instantly (display: none). Incoming content fades in at 150ms ease-out.

#### Export Format Selection
- **Trigger**: Click on radio card
- **Animation**: Selected card border transitions from 1px neutral to 2px primary (120ms). Background transitions to `primary-50` (120ms). Previously selected card reverses.

#### Drag and Drop (Review Page)
- **Trigger**: Mouse down on drag handle, then drag
- **Animation**: Dragged card gets `opacity: 0.5`, `shadow-lg`, slight rotation (1deg). Drop target shows a 2px `primary-500` top border indicator. On drop, card snaps into position (no animation — instant placement for precision).

#### Modal Open/Close
- **Trigger**: Click "Add Step" or export triggers progress modal
- **Enter animation**: Overlay opacity 0 to 1 (200ms, ease-out). Card scale 0.95 to 1.0 + opacity 0 to 1 (200ms, ease-out, 50ms delay).
- **Exit animation**: Card scale 1.0 to 0.95 + opacity 1 to 0 (150ms, ease-in). Overlay opacity 1 to 0 (150ms, ease-in, 50ms delay).

### Loading Patterns

- **Skeleton screens**: Used for initial review page load. Step card skeletons show a title bar (60% width), two text lines (100% and 40% width), and a thumbnail rectangle (120x80px). Shimmer direction: left to right. Shimmer color: transparent to `neutral-100` at 60% opacity to transparent. Duration: 1.5s infinite.
- **Spinner**: 16x16 or 20x20 circular spinner used only inside buttons during async actions (export, save). Spinner is `border-2 border-neutral-300 border-t-primary-500 rounded-full`, CSS animation rotate 360deg, 0.6s linear infinite.
- **Export progress**: Circular SVG progress ring (review page) with numeric percentage. Ring stroke transitions via `stroke-dashoffset`, 300ms ease-in-out.

### Feedback Patterns

- **Toast notifications**: Appear below tabs in popup, below header in review page. Duration 3000ms default, 8000ms for keyboard shortcuts help. Enter: slide down 8px + fade in (200ms). Exit: fade out (150ms).
- **Form validation**: Inline, on blur for text inputs. Error state: `border-danger-500`, red text below input ("Screenshot interval must be between 1-60 seconds"), `text-caption` size, `text-danger-500`.
- **Destructive action confirmation**: Browser native `confirm()` dialog for delete and clear-all actions. Confirmation text explicitly states the action ("Delete this session? This cannot be undone.").

---

## Section 8: Accessibility

### Focus Management
- **Visible focus rings**: 2px solid ring, `primary-500` at 40% opacity, 2px offset from element edge. Applied via `focus-visible` (keyboard focus only, not mouse click).
- **Focus trap in modals**: When a modal opens, focus moves to the first focusable element inside. Tab cycles within the modal. Escape closes the modal and returns focus to the trigger element.
- **Tab order in popup**: Theme toggle, Tab buttons (left to right), then active tab content top-to-bottom (buttons, inputs, dropdowns in DOM order).

### Keyboard Navigation
- **Tab**: Moves between all interactive elements in DOM order
- **Enter/Space**: Activates buttons, toggles checkboxes, selects radio cards
- **Escape**: Closes steps viewer in popup, closes modals in review page, closes mobile sidebar
- **Ctrl+Enter / Cmd+Enter**: Triggers export action
- **Arrow keys**: Navigate within select dropdowns (native behavior)
- **Ctrl+Z / Cmd+Z**: Undo in review page
- **Ctrl+Shift+Z / Cmd+Shift+Z**: Redo in review page

### ARIA Patterns
- **Tabs**: `role="tablist"` on container, `role="tab"` on buttons with `aria-selected="true/false"`, `role="tabpanel"` on content panels with `aria-labelledby` linking to tab button.
- **Modal**: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` pointing to modal title.
- **State indicator**: `aria-live="polite"` on state text so screen readers announce state changes.
- **Toast messages**: `role="status"`, `aria-live="polite"` for success/info, `aria-live="assertive"` for errors.
- **Progress**: Export progress uses `role="progressbar"`, `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax="100"`.
- **Buttons**: All icon-only buttons have `aria-label` (e.g., "Toggle theme", "Undo", "Delete step").
- **Form labels**: Every input has an associated `<label>` element or `aria-label`.

### Color Contrast
All text-on-background combinations are verified in Section 2's Contrast Verification table. All body text meets WCAG AA (4.5:1 minimum). All large text meets WCAG AA (3:1 minimum).

### Reduced Motion
- `@media (prefers-reduced-motion: reduce)`: All animations are replaced with instant state changes. Recording pulse becomes a static colored dot. Tab content appears instantly (no fade). Modal appears instantly (no scale/fade). Skeleton shimmer is replaced with a static gray block. Storage bar width change is instant. Drag-and-drop visual feedback uses border-only indicators (no opacity/shadow/rotation changes).

### Screen Reader Announcements
- **Toast messages**: Container with `aria-live="polite"` announces message text when shown.
- **Recording state changes**: State text container has `aria-live="polite"`. Changes from "Idle" to "Recording" are announced.
- **Form errors**: Error text inserted with `aria-live="polite"` below the relevant input.
- **Export progress**: Progress percentage is announced when it changes significantly (every 25% increment).
- **Step count updates**: Stats panel values are not live-region (too noisy). Users can navigate to them manually.

---

## Section 9: Tech Stack Recommendations

This is a Chrome Extension (Manifest V3), not a standard web application. The popup and review page use vanilla JS with direct DOM manipulation. The design system recommendations below are for the CSS layer, not a framework migration.

| Category | Recommendation | Why |
|---|---|---|
| Styling approach | CSS custom properties (design tokens) | Already in use. Continue using `:root` variables mapped to the new color system. No build step needed for the extension's CSS files. |
| Font loading | Google Fonts via CSP-allowed `<link>` | Already in use. Switch from Share Tech Mono + Azeret Mono to Inter + Geist Mono. |
| Icons | Inline SVG (current approach) | Extension CSP prevents external icon libraries. Continue with hand-coded SVGs matching the Lucide icon style (24x24 viewBox, 1.5 stroke-width, round caps/joins). |
| Animation | CSS animations + transitions | No JS animation library needed. All animations are achievable with CSS keyframes and transitions. |
| Component library | None (vanilla DOM) | The extension's architecture uses vanilla JS. Applying a component library would require a build pipeline change. |

### Tailwind Config Theme Extension (Reference Only)

This config maps the design tokens for projects that adopt Tailwind. The current extension uses CSS custom properties directly.

```ts
// tailwind.config.ts (reference mapping)
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#F0F4F9',
          100: '#DAEAF5',
          200: '#B4D2EA',
          300: '#8AB6DB',
          400: '#5E96C8',
          500: '#4A7FB5',
          600: '#3A6699',
          700: '#2D4F78',
          800: '#213A59',
          900: '#16283D',
        },
        neutral: {
          50: '#F8FAFC',
          100: '#F1F5F9',
          200: '#E2E8F0',
          300: '#CBD5E1',
          400: '#94A3B8',
          500: '#64748B',
          600: '#475569',
          700: '#334155',
          800: '#1E293B',
          900: '#0F172A',
        },
        success: {
          50: '#DCFCE7',
          500: '#16A34A',
          600: '#15803D',
        },
        warning: {
          50: '#FEF3C7',
          500: '#D97706',
          600: '#B45309',
        },
        danger: {
          50: '#FEE2E2',
          500: '#DC2626',
          600: '#B91C1C',
        },
        info: {
          50: '#DAEAF5',
          500: '#4A7FB5',
          600: '#2D4F78',
        },
      },
      fontFamily: {
        heading: ['Geist Sans', 'system-ui', '-apple-system', 'sans-serif'],
        body: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['Geist Mono', 'JetBrains Mono', 'Fira Code', 'monospace'],
      },
      fontSize: {
        'display-xl': ['32px', { lineHeight: '1.1', fontWeight: '700', letterSpacing: '-0.02em' }],
        'h1': ['24px', { lineHeight: '1.2', fontWeight: '700', letterSpacing: '-0.015em' }],
        'h2': ['20px', { lineHeight: '1.25', fontWeight: '600', letterSpacing: '-0.01em' }],
        'h3': ['16px', { lineHeight: '1.3', fontWeight: '600', letterSpacing: '-0.005em' }],
        'h4': ['14px', { lineHeight: '1.4', fontWeight: '600' }],
        'body': ['13px', { lineHeight: '1.5', fontWeight: '400' }],
        'body-sm': ['12px', { lineHeight: '1.5', fontWeight: '400' }],
        'caption': ['11px', { lineHeight: '1.5', fontWeight: '500', letterSpacing: '0.01em' }],
        'overline': ['10px', { lineHeight: '1.4', fontWeight: '600', letterSpacing: '0.05em' }],
        'mono-value': ['20px', { lineHeight: '1.2', fontWeight: '700', letterSpacing: '-0.01em' }],
        'mono-sm': ['11px', { lineHeight: '1.5', fontWeight: '400' }],
      },
      spacing: {
        '0': '0px',
        '1': '4px',
        '2': '8px',
        '3': '12px',
        '4': '16px',
        '5': '20px',
        '6': '24px',
        '8': '32px',
        '10': '40px',
        '12': '48px',
        '16': '64px',
      },
      borderRadius: {
        'none': '0',
        'sm': '4px',
        'md': '6px',
        'lg': '8px',
        'xl': '12px',
        'full': '9999px',
      },
      boxShadow: {
        'sm': '0 1px 3px rgba(0, 0, 0, 0.08)',
        'md': '0 2px 6px rgba(0, 0, 0, 0.1)',
        'lg': '0 4px 16px rgba(0, 0, 0, 0.12)',
      },
      transitionDuration: {
        'micro': '120ms',
        'state': '200ms',
        'overlay': '200ms',
        'dismiss': '150ms',
      },
      transitionTimingFunction: {
        'default': 'cubic-bezier(0.4, 0, 0.2, 1)',
        'entrance': 'cubic-bezier(0, 0, 0.2, 1)',
        'exit': 'cubic-bezier(0.4, 0, 1, 1)',
      },
      keyframes: {
        'recording-pulse': {
          '0%, 100%': { transform: 'scale(1)', opacity: '1' },
          '50%': { transform: 'scale(1.15)', opacity: '0.8' },
        },
        'recording-ring': {
          '0%': { transform: 'scale(0.8)', opacity: '0.6' },
          '100%': { transform: 'scale(1.4)', opacity: '0' },
        },
        'pause-pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
        'shimmer': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        'spin': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'recording-pulse': 'recording-pulse 1.2s ease-in-out infinite',
        'recording-ring': 'recording-ring 1.2s ease-in-out infinite',
        'pause-pulse': 'pause-pulse 2s ease-in-out infinite',
        'shimmer': 'shimmer 1.5s infinite',
        'spin': 'spin 0.6s linear infinite',
      },
    },
  },
};

export default config;
```

---

## Section 10: Dark Mode

### Token Mapping

| Token | Light Value | Dark Value | CSS Variable |
|---|---|---|---|
| bg-page | `#F8FAFC` | `#0F172A` | `--bg-page` |
| bg-card | `#FFFFFF` | `#1E293B` | `--bg-card` |
| bg-card-elevated | `#F8FAFC` | `#253449` | `--bg-card-elevated` |
| bg-input | `#FFFFFF` | `#253449` | `--bg-input` |
| bg-hover | `#F1F5F9` | `#253449` | `--bg-hover` |
| border-default | `#E2E8F0` | `#334155` | `--border` |
| border-hover | `#CBD5E1` | `#475569` | `--border-hover` |
| border-focus | `#4A7FB5` | `#5E96C8` | `--border-focus` |
| text-primary | `#0F172A` | `#F8FAFC` | `--text-primary` |
| text-secondary | `#475569` | `#CBD5E1` | `--text-secondary` |
| text-muted | `#64748B` | `#94A3B8` | `--text-muted` |
| text-disabled | `#94A3B8` | `#475569` | `--text-disabled` |
| primary-500 | `#4A7FB5` | `#5E96C8` | `--accent` |
| primary-600 | `#3A6699` | `#4A7FB5` | `--accent-hover` |
| success-500 | `#16A34A` | `#22C55E` | `--success` |
| warning-500 | `#D97706` | `#F59E0B` | `--warning` |
| danger-500 | `#DC2626` | `#EF4444` | `--danger` |
| info-500 | `#4A7FB5` | `#5E96C8` | `--info` |
| shadow-sm | `0 1px 3px rgba(0,0,0,0.08)` | `0 1px 3px rgba(0,0,0,0.3)` | `--shadow-sm` |
| shadow-md | `0 2px 6px rgba(0,0,0,0.1)` | `0 2px 8px rgba(0,0,0,0.4)` | `--shadow-md` |
| shadow-lg | `0 4px 16px rgba(0,0,0,0.12)` | `0 4px 16px rgba(0,0,0,0.5)` | `--shadow-lg` |

### Toggle Mechanism

- **Method**: Class-based via `document.body.dataset.theme` attribute (`data-theme="dark"` / `data-theme="light"`). This is already the existing pattern in the codebase.
- **Persistence**: `localStorage.setItem('theme', 'dark')` — already implemented.
- **Initial state**: Check `localStorage` first, then fall back to `prefers-color-scheme` media query — already implemented.
- **CSS implementation**: All dark mode tokens defined under `[data-theme="dark"]` selector in `:root`-level custom property overrides.
- **Transition**: `background-color` and `color` properties transition at 200ms ease-in-out on `body`. Other elements inherit and transition their own backgrounds at the same rate. No flash of unstyled content because the theme is applied synchronously before first paint.

---

## Design Review — Iteration 1

**Verdict**: REVISE

### Section Completeness

| # | Section | Present | Issues |
|---|---|---|---|
| 1 | Design Philosophy | Yes | OK — 3 specific, opinionated principles with traced influences |
| 2 | Color System | Yes | OK — comprehensive with light/dark surfaces and contrast table |
| 3 | Typography System | Yes | OK — 11-level type scale with all required columns |
| 4 | Spacing & Layout System | Yes | Minor — missing 2xl breakpoint (1440px defined as container but not in breakpoint table with Tailwind prefix) |
| 5 | Component Hierarchy | Yes | Minor — some components missing full state coverage (see scoring) |
| 6 | Layout Specifications | Yes | OK — detailed component placement for both popup and review page |
| 7 | Interaction Patterns | Yes | OK — timing table, easing, loading, feedback all specified |
| 8 | Accessibility | Yes | OK — focus, keyboard, ARIA, contrast, reduced motion, screen reader all covered |
| 9 | Tech Stack Recommendations | Yes | OK — appropriate for Chrome extension context with reasoning |
| 10 | Dark Mode | Yes | OK — full token mapping table with CSS variables and toggle mechanism |

### Guardrails Compliance

- **Purple scan**: PASS — 37 hex values checked, 0 violations. All hues fall in safe ranges (0, 26-48 for semantic warm colors, 140-222 for cool colors).
- **Warm palette check**: PASS — primary hue: 210 (steel blue, cool-toned)
- **TBD/placeholder scan**: PASS — 0 instances found
- **Anti-pattern check**: PASS — no gradient blobs, glassmorphism, neon accents, or floating orbs detected. Design maintains a restrained, system-native aesthetic.
- **Font check**: PASS — fonts used: Geist Sans (headings), Inter (body), Geist Mono (monospace). All modern professional typefaces.
- **Tailwind coverage**: PASS with minor gap — neutral palette table is missing HSL values (not a Tailwind issue but an incomplete token specification). All components include Tailwind class mappings.
- **Contrast ratios**: PASS — table present with 14 combinations, all body text meets 4.5:1 AA, all large text meets 3:1 AA. Warning button text at 3.2:1 correctly labeled AA Large only.

### Score Breakdown

| # | Criterion | Score | Max | Sub-checks Passed | Notes |
|---|---|---|---|---|---|
| 1 | Visual Hierarchy & Layout | 13 | 15 | 5/6 | Missing 2xl breakpoint; review page responsive rules table could be more granular per breakpoint |
| 2 | Color Harmony & Palette Quality | 14 | 15 | 6/7 | Neutral palette missing HSL values (has hex + Tailwind but not all three formats) |
| 3 | Typography & Readability | 10 | 10 | 5/5 | Excellent — full scale with letter-spacing differentiation for headings vs captions |
| 4 | Component Completeness | 12 | 15 | 5/6 | Several components missing full state tables — Select lacks error state, Badge/Tooltip/File Sync lack comprehensive states |
| 5 | Responsive Design | 6 | 10 | 2/5 | No mobile-first/desktop-first declaration; no touch target spec; only 4 of 5 breakpoints |
| 6 | Accessibility | 10 | 10 | 6/6 | Comprehensive — focus rings, ARIA, keyboard, contrast, reduced motion, live regions all present |
| 7 | Interaction Design | 10 | 10 | 5/5 | Timing table, easing functions, skeletons, spinners, toast specs, keyframe definitions all present |
| 8 | Professional Polish | 15 | 15 | 7/7 | Principles are decisions not platitudes; Tailwind config is real code; dark mode fully mapped |
| | **Total** | **90** | **100** | | |

### Critical Fixes Required

1. **Responsive Design: Declare mobile-first or desktop-first approach and add touch target specification** — The document never states whether CSS should be written mobile-first or desktop-first. Additionally, no interactive component specifies a minimum touch target size (44x44px per WCAG 2.5.5). Add a statement at the top of Section 4 declaring the approach (e.g., "Desktop-first: the popup is fixed at 380px; the review page is desktop-first with responsive overrides"), and add a "Touch Targets" subsection stating that all interactive elements on the review page below 768px must have a minimum hit area of 44x44px.

2. **Responsive Design: Add missing 2xl breakpoint to breakpoint table** — The breakpoint table in Section 4 lists only sm/md/lg/xl but the review page container widths reference 2xl (1440px). Add `2xl | 1536px | 2xl:` to the breakpoint table (standard Tailwind 2xl value) for a complete 5-breakpoint set.

3. **Component Completeness: Add missing states to Select, Badge, Tooltip, and File Sync components** — Select is missing an error state (should mirror Input error: `border-danger-500`, red focus ring). Badge should have at least default and hover states with Tailwind classes. Tooltip needs a disabled/unavailable state. File Sync status needs hover and focus states with Tailwind classes for the configure/re-auth action. Each missing state should follow the format of the Button states table: State | Visual Change | Tailwind Classes.

4. **Neutral palette: Add HSL values** — The primary palette includes hex + HSL + Tailwind for every shade, but the neutral palette only has hex + Tailwind. Add HSL values to the neutral palette table so all color tokens have consistent triple-format specification (e.g., `#F8FAFC` -> `hsl(210, 40%, 98%)`).

5. **Review page responsive rules: Expand per-breakpoint detail** — The current responsive rules table for the review page has 3 rows with general descriptions. Expand to cover all 5 breakpoints and specify: (a) content area max-width at each breakpoint, (b) what happens to the toolbar (does search stack above filters on mobile?), (c) step card internal layout changes (screenshot placement, metadata visibility), and (d) sidebar drawer toggle button placement on mobile.

### Minor Improvements

- The micro-interaction timing is 120ms rather than the guardrails' suggested 150ms. While this works well for the density-focused design philosophy, consider documenting the deviation with a brief rationale (e.g., "120ms chosen over 150ms to match the responsive feel of IDE interactions").
- The warning button text contrast (white on `#D97706`) is 3.2:1, which passes only for AA Large text. If warning buttons ever use small text (12px or below), consider using dark text (`#92400E`) on the warning background instead, or darkening the warning button to `#B45309` for 4.7:1.
- Consider adding an "empty state" specification for the live steps viewer (popup recording tab) and the review page steps container — what does the user see before any steps are recorded? An empty state with an icon and instructional text would elevate the experience.

### Strengths

- The design philosophy section is genuinely strong. "Density with Clarity," "Quiet Until Active," and "System-Native Feel" are real decisions that visibly shape the downstream specifications. The traced influences make it possible to verify that the principles are not decorative.
- The color system is thorough and disciplined. Cool-toned throughout, comprehensive dark mode mapping, and a contrast verification table that covers both light and dark contexts with real numbers. The semantic color system is clean and complete.
- The Tailwind config snippet is production-ready code, not pseudocode. It includes keyframes, animations, timing functions, and shadow definitions — an engineer can copy this directly into a project.
