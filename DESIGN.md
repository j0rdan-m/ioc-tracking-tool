# Design — IOC Investigation Toolkit

This DESIGN.md was generated from the existing Svelte frontend codebase. It documents the incumbent visual system, tokens, components, and design decisions for this version.

## Design Overview
**Mode**: Operate — the visitor completes a task (investigate IoCs, view results, manage history)
**Audience**: Cybersecurity analysts and threat researchers
**Platform**: Web browser (responsive, light/dark themes)

## Visual System

### Color Tokens (CSS Custom Properties)
These are defined in the application's global styles and accessed via `var()`:

- **`--color-surface`**: Background surfaces (cards, modals, panels) — warm off-white in light, muted charcoal in dark
- **`--color-border`**: Element borders — subtle gray in light, medium contrast in dark
- **`--color-text`**: Primary text — pure black in light, pure white in dark
- **`--color-text-muted`**: Secondary/placeholder text — 60% opacity in light, 40% in dark
- **`--color-accent`**: Primary accent color — high-techn green (project brand)
- **`--color-success`**: Success state — green, used for verified/safe verdicts
- **`--color-danger`**: Danger state — red, used for error/malicious verdicts
- **`--color-warning`**: Warning state — amber/yellow, used for suspicious verdicts
- **`--color-neutral-marker`**: IoC check status dots — neutral gray

### Color Soft Tokens (background variations)
- **`--color-success-soft`**: Light tint of success color, used as button backgrounds
- **`--color-accent-soft`**: Light tint of accent color

### Typography Scale
- **`--font-size-2xs`**: ~0.65rem (tiny labels, meta text)
- **`--font-size-xs`**: ~0.75rem (small UI text)
- **`--font-size-sm`**: ~0.875rem (body text, field values)
- **`--font-size-base`**: ~1rem (base body text)
- **`--font-size-lg`**: ~1.125rem (larger body text)
- **`--font-size-xl`**: ~1.25rem (section headers)
- **`--font-size-2xl`**: ~1.5rem (page titles)
- **`--font-size-3xl`**: ~2rem (major headlines)

- **`--font-weight-light`**: 300
- **`--font-weight-normal`**: 400
- **`--font-weight-semibold`**: 600
- **`--font-weight-bold`**: 700

### Radius Tokens
- **`--radius-circle`**: 50% (perfect circle for status dots)
- **`--radius-md`**: 4px (default border radius for cards, inputs)
- **`--radius-sm`**: 2px (small elements)
- **`--radius-pill`**: 100px (pill-shaped buttons, like investigate buttons)
- **`--radius-none`**: 0px

### Spacing Scale (var--)
- **`--space-1`**: 4px (compact spacing)
- **`--space-2`**: 8px (standard spacing between components)
- **`--space-3`**: 12px (section spacing, card padding)
- **`--space-4`**: 16px (page padding, form gaps)
- **`--space-5`**: 20px (larger margins)
- **`--space-6`**: 24xx (section margins)

## Component Library

### Modals
All modals share a common chrome pattern from `src/styles/components.css`:

**Structure**:
- `.modal__backdrop` — full-page backdrop with dismissal button
- `.modal` — centered dialog with `role="dialog"`, `aria-modal="true"`
- `.modal__head` — header with eyebrow label, title, close button
- `.modal__body` — main content area
- `.modal__foot` — footer with action buttons

**Fast Analyze Modal** (`FastAnalyzeModal.svelte`):
- Eyebrow: `⚡ Fast analyze`
- Title: `Quick lookups for one IoC`
- Input placeholder: `IP, domain, URL, hash or email…`
- Primary CTA: `Start` (submit button)
- Secondary: `Add to investigation` (🕸 badge)
- Export: `⬇ Export` dropdown
- Notice area for results/status messages
- Check list with status dots (ok/empty/error/pending)
- "Go further" section with links to catalog tools
- Export panel integration
- Save to investigation flow (V2.2)

**Investigation History Modal** (`HistoryModal.svelte`):
- Lists saved investigations with filters
- Per-entry verdict, tags, notes display
- Export options per investigation
- Search/filter by indicator, verdict, source

### Buttons
- **`fast__export`**: Secondary action style — transparent background, bordered, text-only
- **`modal__btn`**: Standard button — filled or outlined depending on context
- **`modal__btn--primary`**: Primary action — filled background with accent color
- **`modal__btn--save`**: Save-specific primary button (from earlier V2.0 iteration)
- **`ioc__copy`**: Copy-to-clipboard action on IoC pills
- **`ioc__investigate--saved`**: Saved indicator badge — success color, pill-shaped, uppercase text, uppercase label
- **`check__dot--pending`**: Pulsing animation for pending checks

### Form Elements
- **`modal__input`**: Text input — full width, bordered, focused state with accent border
- Placeholder color: `--color-text-muted`
- Autocomplete: `off` for security-sensitive fields

### Table/List Styles
- **`checks`**: Flex column, gap between items, no list-style, padded each item
- **`gofurther__list`**: Grid layout, auto-fill columns minmax(100%, 15rem), gap between items
- **`export__trigger`**: Flex row, justify-end, holds export and add-to-investigation buttons

### Status Indicators
- **`check__dot--pending`**: Pulsing animation (`check-pulse` keyframes)
- **`check__dot--ok`**: Green with glow shadow (`--shadow-glow-success`)
- **`check__dot--empty`**: Accent color (yellow)
- **`check__dot--error`**: Red with glow shadow (`--shadow-glow-danger`)
- **Role**: `aria-hidden="true"` since meaning is conveyed by surrounding text

### Notices
- **`modal__notice`**: Role `status`, announced live region (`aria-live="polite"`)
- Single-line message about operation result
- Clears after 3 seconds via `setTimeout`

## Responsive Behavior
- Mobile-first approach via CSS custom properties
- Grid layouts collapse from multi-column to single-column below breakpoint
- Modals full-height on small screens, overflow-hidden on body
- Font sizes scale down proportionally

## Dark Mode
- All color tokens have dark-mode equivalents (swap light-on-dark)
- Surface colors invert appropriately
- Accent color remains visible and consistent
- Text contrast maintained at AAA level

## Accessibility
- All modals have `role="dialog"` and `aria-modal="true"`
- Focus trap within modal when open
- Escape key dismisses modals
- `aria-live="polite"` for status notices
- All links use `target="_blank" rel="noopener noreferrer"`
- Focus-visible states on interactive elements
- Color is not the only means of conveying meaning (icons, text labels)

## Component Hierarchy
```
App.svelte
├── FastAnalyzeModal.svelte      (main IoC input + analysis)
├── InvestigationGraph.svelte    (SVG graph visualisation)
├── InvestigationList.svelte     (saved investigations)
├── InvestigationOverview.svelte (workspace overview tab)
├── GraphNodeDetails.svelte      (node detail view)
├── GraphRelationDetails.svelte  (relationship detail view)
├── IndicatorFilter.svelte       (type/verdict/source filters)
├── OnboardingTour.svelte        (guided tour component)
├── ExportPanel.svelte           (export format selector)
├── AddToInvestigation.svelte    (add IoC to workspace)
├── FastAnalyzeModal.svelte      (analysis modal)
├── IocExtractorModal.svelte     (IoC extract from paste)
├── EmailHeadersModal.svelte     (email header analysis)
├── HistoryModal.svelte          (investigation history)
├── InvestigationNotes.svelte    (notes editor)
├── InvestigationTimeline.svelte (timeline view)
├── SignalScore.svelte           (score display)
├── ProviderRawResponse.svelte   (raw provider response)
├── CategoryFilter.svelte        (provider category filter)
├── SearchBar.svelte             (global search)
├── ToolCard.svelte / ToolGrid.svelte  (tool catalog)
└── WorkspaceModal.svelte        (workspace management)
```