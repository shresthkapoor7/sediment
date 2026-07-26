# Sediment — UI Redesign Spec

> Target: minimal, modern, boxy. Notion's restraint + exa.ai's structure. Built for researchers.
> This document is the single source of truth for the restyle. It is written to be executed by
> another model (Opus/Sonnet/Claude Design) with no additional context.

---

## 1. Direction

The current UI reads "AI-generated" because of a specific combination: Instrument Serif italic
display type, rust-orange accent, cream/parchment backgrounds, grain texture, and decorative
orbiting ellipses. All of these go.

The new direction is **an instrument, not an artifact**: one neutral grotesque sans, near-neutral
paper backgrounds, a single cobalt-ink accent, hairline borders, small radii, almost no shadows,
fast subtle motion. The canvas and the data (papers, years, edges) are the visual interest —
the chrome disappears around them.

Reference points:
- **exa.ai** — boxy cards, cobalt accent on warm paper-white, mono for metadata, tight grids
- **Notion** — neutral grays, quiet hover states, typography does the hierarchy
- **Ink on paper** — the accent is "ink blue"; fitting for a tool about the scholarly record

### Non-negotiables (do NOT change)

- **The dock** (floating pill header: `.app-header-landing .app-header-actions`,
  `.app-header-shared`, `.app-header-graph .app-header-actions`, and the changelog dock).
  Keep its layout, sizing, `0.875rem` radius, backdrop blur, compact-collapse behavior, and all
  transitions exactly as they are. It inherits the new color tokens automatically — that is the
  only way it changes.
- All layout, information architecture, and interaction logic. This is a **restyle**, not a rebuild.
- The existing CSS variable names in `globals.css`. Swap values, keep names — most of the app
  restyles itself through the tokens.
- CSS conventions from CLAUDE.md: rem everywhere, 4px grid, SVG attributes stay unitless.

---

## 2. Typography

### Families

| Role | Font | Replaces | Loading |
|---|---|---|---|
| Everything: UI, body, headings, hero | **Inter** (variable) | DM Sans + Instrument Serif | Google Fonts |
| Metadata: years, labels, IDs, eyebrows | **Geist Mono** (400, 500) | JetBrains Mono | Google Fonts |
| Long-form reading only (paper abstracts / reader modal body) | **Source Serif 4** (optional, 400 + italic) | — | Google Fonts |

There is **no display serif anymore**. Headings are Inter with heavier weight and tight tracking —
this is the single biggest de-"vibe-coding" move. Source Serif 4 is allowed *only* inside the paper
reader modal body text (scholarly reading comfort); never in UI chrome or headings.

New font link (replace the existing one in `layout.tsx`):

```
https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,400..700;1,14..32,400..700&family=Geist+Mono:wght@400;500&family=Source+Serif+4:ital,opsz@0,8..60;1,8..60&display=swap
```

Update `body` font stack, `.font-mono`, and every inline `'DM Sans'` / `'JetBrains Mono'` /
`'Instrument Serif'` occurrence (they appear inline throughout `page.tsx`, `SearchInput.tsx`,
`TimelineNode.tsx`, `TimelineNote.tsx`, `GlobalChatPanel.tsx`, `PaperReaderModal.tsx`, etc.):

```css
body      { font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
.font-mono { font-family: 'Geist Mono', 'SF Mono', monospace; }
.font-display is deleted (grep and replace usages with the heading styles below)
```

Enable Inter's alternates for a slightly more designed look (on `body`):

```css
font-feature-settings: "cv05", "cv11", "ss01";
```

### Scale

| Token | Size | Weight | Tracking | Line-height | Used for |
|---|---|---|---|---|---|
| Hero | `clamp(2.5rem, 5vw, 4.25rem)` | 600 | `-0.03em` | 1.05 | Landing H1 |
| Section | `clamp(1.75rem, 3.5vw, 2.75rem)` | 600 | `-0.02em` | 1.1 | Demo-scene H2, final CTA H2 |
| Title | `1.125rem` | 600 | `-0.01em` | 1.3 | Detail panel title, modal titles |
| Body | `0.9375rem` | 400 | `-0.006em` | 1.6 | Descriptions, chat, reader |
| UI | `0.8125rem` | 500 | `-0.006em` | 1.4 | Buttons, inputs, node titles |
| Small | `0.75rem` | 400–500 | `0` | 1.45 | Card summaries, secondary UI |
| Meta | `0.6875rem` mono | 500 | `0.08em`, uppercase | 1 | Eyebrows, year badges, section labels |
| Micro | `0.625rem` mono | 500 | `0.06em`, uppercase | 1 | SEED tag, note-kind tags, changelog tags |

Rules:
- Hero and section headings: **no italics, no accent-colored words rendered in serif**. If a word
  needs emphasis, keep it the same font and color it `var(--accent)` — plain, not italic.
- Uppercase + letterspacing is reserved for mono metadata only. Never uppercase Inter.

---

## 3. Color

Two fully neutral themes with one cobalt accent. Kill every warm/rustic value. Light mode is the
flagship (exa-style paper white); dark mode is graphite, not brown.

### Light theme (`:root`)

```css
--bg-primary:   #FAFAF8;   /* page — paper white, barely warm */
--bg-secondary: #F4F4F1;   /* inputs, panels, chips */
--bg-tertiary:  #EBEBE7;   /* hover fills, pressed states */
--bg-canvas:    #F7F7F4;   /* graph canvas */

--text-primary:   #1A1A18; /* near-black, warm-neutral */
--text-secondary: #55554F;
--text-tertiary:  #8A8A82; /* decorative/meta only, not essential text */

--border:       #E3E3DE;   /* hairlines everywhere */
--border-hover: #C8C8C1;

--accent:       #2946E4;   /* cobalt ink */
--accent-hover: #1E36BE;
--accent-soft:  rgba(41, 70, 228, 0.08);
--accent-glow:  rgba(41, 70, 228, 0.14);

--node-bg:      #FFFFFF;
--node-border:  #E3E3DE;
--node-shadow:       0 0.0625rem 0.125rem rgba(26, 26, 24, 0.04);
--node-shadow-hover: 0 0.25rem 0.75rem rgba(26, 26, 24, 0.07);

--edge-color:        #D5D5CF;
--edge-color-active: #2946E4;

--canvas-dot:   #DEDED8;

--grain-opacity: 0;        /* grain is dead — see §7 */
```

### Dark theme (`[data-theme="dark"]`)

```css
--bg-primary:   #131314;
--bg-secondary: #1A1A1C;
--bg-tertiary:  #232326;
--bg-canvas:    #0F0F10;

--text-primary:   #EDEDEB;
--text-secondary: #A6A6A1;
--text-tertiary:  #737370;

--border:       #2A2A2D;
--border-hover: #3C3C40;

--accent:       #7A8CFF;   /* lifted cobalt for dark contrast */
--accent-hover: #96A4FF;
--accent-soft:  rgba(122, 140, 255, 0.12);
--accent-glow:  rgba(122, 140, 255, 0.16);

--node-bg:      #1A1A1C;
--node-border:  #2A2A2D;
--node-shadow:       0 0.0625rem 0.25rem rgba(0, 0, 0, 0.35);
--node-shadow-hover: 0 0.375rem 1rem rgba(0, 0, 0, 0.45);

--edge-color:        #2E2E32;
--edge-color-active: #7A8CFF;

--canvas-dot:   #202023;

--grain-opacity: 0;
```

### Categorical set (node borders, notes, changelog tags)

Recalibrate the ad-hoc Tailwind-ish colors (`node-style.ts`, `note-style.ts`,
`changelog/page.tsx` TAG_COLORS) to one muted set that sits with cobalt:

| Key | Light | Dark | Used for |
|---|---|---|---|
| accent | `var(--accent)` | `var(--accent)` | default highlight |
| blue | `#3E7BD6` | `#6CA5F0` | node border / note / "Style" tag |
| green | `#2F8A57` | `#5DBB84` | node border / note / "Bug Fix" tag |
| purple | `#7A5CC9` | `#A78BE8` | node border / note / "Chores" tag |
| amber | `#B87A1E` | `#D9A24A` | node border / note |
| rose | `#C94F63` | `#E58295` | node border / note / delete affordances |
| gray | `#8A8A82` | `#737370` | "Docs" tag, disabled |

Note backgrounds (`note-style.ts`): keep the `color-mix(... , var(--bg-secondary))` pattern but at
lower strength (10–12% color) so notes read as tinted paper, not sticky notes. The "paper" note
color loses its `#f4ead7`/`#d7bd8a` warm mix — replace with plain
`var(--bg-secondary)` background + `var(--border)` border.

### Contrast requirements

- `--text-primary` on `--bg-primary`: ≥ 12:1 both themes (values above satisfy this)
- `--text-secondary` on `--bg-secondary`: ≥ 4.5:1
- `--accent` on `--bg-primary`: ≥ 4.5:1 (buttons with white text: light accent passes; in dark
  theme, accent-filled buttons use `#131314` text, not white)
- `--text-tertiary` is decorative-only; never sole carrier of information

---

## 4. Shape: radius, borders, shadows

Boxy. The radius scale shrinks across the board:

| Token | Value | Used for |
|---|---|---|
| `r-xs` | `0.125rem` (2px) | tags, badges (year, SEED, NEW, note-kind, changelog) |
| `r-sm` | `0.25rem` (4px) | buttons, chips, inputs, menu items, kbd |
| `r-md` | `0.375rem` (6px) | cards, timeline nodes, notes, dropdowns |
| `r-lg` | `0.5rem` (8px) | modals, side panels, demo-scene frames |
| dock | `0.875rem` | **unchanged, dock only** |
| pill | `999px` | only for genuinely round things: color swatch dots, spinner, the circular node-edit button. All pill-shaped *buttons* (e.g. `.demo-final-button`) become `r-sm` |

Borders: `0.0625rem solid var(--border)` everywhere. Focus/active states change border color, not
width (no layout shift). Remove all `color-mix(...transparent)` border softening on cards — borders
are crisp hairlines now (translucent borders may remain on the dock only).

Shadows: near-elimination. Cards and nodes use `--node-shadow` (a whisper). Only floating layers
(dropdowns, modals, dock, hover-lifted nodes) get a real shadow:
`0 0.5rem 1.5rem rgba(0,0,0,0.10)` light / `0 0.5rem 1.5rem rgba(0,0,0,0.45)` dark.
Delete all `inset 0 0.0625rem 0 rgba(255,255,255,0.06)` faux-emboss highlights.

---

## 5. Motion

Motion gets faster and rarer. Framer-motion stays as the engine.

| Purpose | Duration | Easing |
|---|---|---|
| Hover / color / border transitions | `120ms` | `ease` |
| Enter (fade + 8px rise), dropdowns, menus | `180ms` | `cubic-bezier(0.16, 1, 0.3, 1)` |
| Panels sliding (detail panel, chat) | `240ms` | `cubic-bezier(0.16, 1, 0.3, 1)` |
| Node stagger on timeline render | `300ms` per node, `40ms` stagger | `cubic-bezier(0.16, 1, 0.3, 1)` |

Rules:
- **No infinite/looping animation** except: the search spinner and the streaming/typing indicator.
  Delete `subtle-pulse`, the `landing-scroll-line-glow` accent sweep (scroll-hint lines become
  static, low-opacity), and the pulsing "mentioned node" ring (replace with a static
  2px accent ring + `--accent-soft` halo).
- **Delete the animated SVG border-draw** on search focus (`SearchInput.tsx` path animation).
  Focus is now instant: `border-color: var(--accent)` + `box-shadow: 0 0 0 3px var(--accent-soft)`.
- Hover lift on cards shrinks from `-0.125rem` to `-0.0625rem`; chips/buttons don't lift at all,
  they change background (`--bg-tertiary`) and border (`--border-hover`).
- Respect the existing `prefers-reduced-motion` blocks; extend them to any animation kept.

---

## 6. Core components

### Buttons

- **Primary**: `background: var(--accent)`, text `#FFFFFF` (light theme) / `#131314` (dark theme),
  `r-sm`, height `2.25rem`, padding `0 1rem`, UI type style. Hover: `--accent-hover`. No shadow.
- **Secondary**: transparent background, `1px var(--border)`, text `--text-primary`.
  Hover: `background: var(--bg-tertiary)`, `border-color: var(--border-hover)`. (Accent-colored
  text/border on hover is removed — hover is neutral; accent means *selected*, not *hovered*.)
- **Ghost/icon**: no border, hover `--bg-tertiary`. (This is what dock items already do — good.)
- **Destructive**: ghost with rose text from the categorical set.

### Inputs & search field

- `background: var(--bg-secondary)` on page backgrounds, `#FFFFFF`/`--bg-primary` when inside
  panels. `1px var(--border)`, `r-sm` (the big landing search field may use `r-md`), no inner
  shadow. Placeholder `--text-tertiary`.
- Focus: `border-color: var(--accent)` + `0 0 0 3px var(--accent-soft)`. 120ms.
- Landing search: keep `min-height: 4rem`, search icon left in `--text-tertiary`, submit button is
  a `r-sm` accent square. Spinner unchanged.

### Chips (example queries, trace-mode)

`r-sm`, `--bg-secondary` bg, `1px var(--border)`, `0.75rem`/500 text in `--text-secondary`.
Hover: neutral (`--bg-tertiary` + `--border-hover` + `--text-primary`) — no accent tint, no accent
arrows. The little ↗ arrow icons change from accent to `--text-tertiary`. Deep-trace selected
state: `1px var(--accent)` border + accent text (selected = accent).

### Tags / badges (year, SEED, NEW, note kinds, changelog)

`r-xs`, Micro mono style, `--accent-soft` bg + `--accent` text (or categorical equivalent at
10–12% opacity bg). SEED badge: solid `--accent` bg with theme-appropriate contrast text.

### Dropdown menus (trace-mode menu, node edit menu, dock menus)

`r-md`, `--bg-primary` bg at 98% opacity + `blur(12px)`, `1px var(--border)`, floating shadow.
Menu items `r-sm`, hover `--bg-tertiary`, selected `--accent-soft` bg + accent text.
Replace the `⌁`/`⌕` glyph icons in the trace-mode menu with the existing stroke SVG icons.

### Modals (Clarification, Paper Reader, Settings)

`r-lg`, `--bg-primary` bg, `1px var(--border)`, floating shadow, overlay
`rgba(10,10,10,0.4)` light / `rgba(0,0,0,0.6)` dark with `blur(4px)`. Title row uses Title type;
close button is a ghost icon button. Reader modal body may use Source Serif 4 at `1rem/1.7`.

### Scrollbars, selection, focus

Keep the thin scrollbar. `::selection` becomes `--accent-soft`. Focus-visible ring: keep
`2px solid var(--accent)` outline at `2px` offset.

---

## 7. Delete list (global)

These elements are the "vibe-coded" signature and are removed outright:

1. **Grain overlay** — remove `.grain::after` and the `--grain-opacity` usage (leave the var at 0
   or delete usages entirely).
2. **Instrument Serif** — all usages, including `.font-display`, hero, demo H2s, detail-panel
   titles, apple-icon if applicable.
3. **Hero strata ellipses** (`.landing-hero-strata`) and **helix particles**
   (`.landing-helix-particles`, desktop + mobile) — see §8 for the replacement.
4. **Animated search border draw** (SVG paths in `SearchInput.tsx`).
5. **Italic accent words** in headings (`.landing-hero-title em`, `.demo-scene-copy h2 em`).
6. **Warm color-mixes** — `#17100b`, `#f4ead7`, `#d7bd8a`, `#c2703e`, `#e0894d` (settings slider
   thumbs become `var(--accent)`), `#f28b7c` (use rose token).
7. **Pill CTA buttons** (`.demo-final-button` radius 999 → `r-sm`).
8. **Looping glow/pulse animations** (§5).

---

## 8. Page-by-page

### 8.1 Landing (`/`) — hero

Structure unchanged (eyebrow → H1 → description → search → chips → ledger → scroll hint).

- **Background**: keep `.landing-hero-grid` (the faint square grid) as the *only* decoration —
  neutral `--border` lines at the existing low opacity, same mask. In place of strata/particles,
  add one quiet, on-brand element: a horizontal **timeline rule** — a `1px var(--border)` line
  across the hero's lower third with small mono year ticks (`1943 · 1986 · 2017 · now`) in
  `--text-tertiary`, static, `~0.4` opacity. It hints at the product without decoration for its
  own sake. (If in doubt, ship with grid only — restraint wins.)
- **Eyebrow**: keep mono-uppercase "Research lineage explorer", but as a bordered tag: `r-xs`,
  `1px var(--border)`, no accent dashes flanking it.
- **H1**: Hero type (Inter 600, tight). Two lines max. Accent word plain-colored, not italic.
  Current copy "Follow the work beneath the work." can stay.
- **Description**: Body type, `--text-secondary`, max-width unchanged.
- **Search + chips**: per §6.
- **Ledger** (bottom-right 01/02/03 list): keep; numbers in mono `--text-tertiary` (not accent),
  hairline top borders stay.
- **Scroll hint**: static lines per §5.
- **Dock**: untouched.

### 8.2 Landing — demo scenes (scrollytelling)

Keep the sticky-scroll mechanics and all four scenes. Restyle only:

- Scene frames (`.demo-scene-visual`, `.demo-final-graph`): `r-lg`, flat `--bg-secondary`
  (kill the gradient + inset highlight), `1px var(--border)`, dot grid stays.
- Step labels (`01 — TRACE`): mono meta, number `--text-tertiary` (accent only on the active
  scene's number, if trivially known).
- H2s: Section type. Paper cards, chat bubbles, detail mock: inherit component styles (§6, §8.3).
- Chat bubbles: user = `--accent-soft` bg + `1px` accent-mixed border (keep), AI = `--bg-primary`
  bg + `1px var(--border)`. Radius `r-md`.
- Final CTA buttons: primary + secondary per §6.

### 8.3 Graph view (post-search, same route)

- **Canvas**: `--bg-canvas` + dot grid. No grain.
- **Timeline nodes** (`TimelineNode.tsx`): `r-md`, `--node-bg`, `1px` border. Year badge per §6
  tags. Title = UI type, summary = Small in `--text-tertiary`.
  - Hover: border `--border-hover` (NOT accent), shadow `--node-shadow-hover`, lift `-0.0625rem`.
  - Selected/active: border `--accent` + `0 0 0 3px var(--accent-soft)`. Accent = selected.
  - Mentioned-by-chat: static accent ring per §5.
  - Expanded indicator dot: keep, `--accent` at 0.6.
  - Edit button + menu: per §6 (menu items lose the uppercase-mono styling → UI type,
    sentence case, `r-sm`; "Delete node" in rose).
- **Edges** (`TimelineEdge.tsx`): `--edge-color`, active path `--edge-color-active`. Remove any
  glow filter on active edges — color + slightly thicker stroke (1.5 → 2) is enough.
- **Notes** (`TimelineNote.tsx`): tinted paper per §3, `r-md`, kind tag per §6.
- **Detail panel**: `--bg-primary` (not secondary) with `1px var(--border)` left hairline, slides
  per §5. Title in Title type (Inter — was serif), authors Small `--text-secondary`, stats row in
  mono meta with hairline divider, body in Body type.
- **Chat panel / ConversationNavigator**: same surface treatment as detail panel; bubbles per
  §8.2; input per §6; suggestion chips per §6.
- **Header/dock, credit indicator, graph title input**: untouched (title input underline color
  inherits the new accent automatically).

### 8.4 Shared view (`/s/[share_id]`)

No structural changes; everything inherits. Verify the frosted shared-dock still reads well on the
new neutral backgrounds in both themes (it will — tokens only).

### 8.5 Changelog (`/changelog`)

- Page bg `--bg-primary`; entries keep the timeline-dot layout.
- Title in Section type (Inter, not serif). Dates in mono meta, `--text-tertiary`.
- Tags: `r-xs`, categorical set from §3 (replace the hardcoded rgb() TAG_COLORS).
- Markdown body: Body type; links `--accent` with underline on hover.
- Changelog dock: untouched.

### 8.6 System pages / details

- `apple-icon.tsx` / favicon: regenerate with new accent if the current one bakes in orange.
- `<meta name="theme-color">`: set to `--bg-primary` per theme if present.
- Settings sliders: track `--bg-tertiary`, fill/thumb `--accent`.
- Empty/loading states: mono meta labels + spinner; never skeleton-shimmer.

---

## 9. Implementation notes for the executing model

1. **Order of work**: (1) `globals.css` tokens + fonts + delete-list, (2) `layout.tsx` font link,
   (3) inline-style sweep — grep for `'DM Sans'`, `'JetBrains Mono'`, `'Instrument Serif'`,
   `Georgia`, and every hex from §7's warm list, (4) radius sweep — grep `borderRadius` and
   `border-radius`, map to §4 scale (leave dock + true circles), (5) per-page passes in §8 order,
   (6) both themes screenshot-checked at the end of each step.
2. Most styling lives in **inline style objects** in `page.tsx` (~5000 lines),
   `TimelineNode.tsx`, `TimelineNote.tsx`, `SearchInput.tsx`, `GlobalChatPanel.tsx`,
   `PaperReaderModal.tsx`, `ClarificationModal.tsx` — not only in `globals.css`.
3. `node-style.ts`, `note-style.ts`, and changelog `TAG_COLORS` hold the categorical colors —
   update them from §3's table (light/dark via CSS vars or `color-mix` where a single value must
   serve both themes; prefer defining them as CSS variables `--cat-blue` etc. in `globals.css`).
4. Do not touch: dock CSS blocks, layout math (`NODE_DIMENSIONS`, note layout, timeline-builder),
   API code, or copy (except removing `<em>` wrappers).
5. Keep every `prefers-reduced-motion` block working after the motion changes.
6. Definition of done: no `Instrument Serif`/`DM Sans`/`JetBrains Mono` strings left; no grain; no
   warm hexes from §7; light + dark verified on landing, graph, shared, changelog; dock visually
   identical apart from token-inherited colors.
