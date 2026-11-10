# Design system: the Nextcloud look

The app copies Nextcloud's interface. If you have used Nextcloud Files you already know the layout: a coloured backdrop, a slim header sitting on top of it, and one big rounded window that holds a navigation list on the left, the main content in the middle and a details sidebar on the right. We keep that structure and Nextcloud's quiet, neutral surfaces, and add our own colour on top: every family of PDF tools has its own accent.

Everything lives in [`design/tokens.css`](../design/tokens.css). A clickable preview is in [`docs/design-preview.html`](design-preview.html), which you can open straight from disk.

## Why Nextcloud's variable names

The tokens use the exact names Nextcloud's theming app defines (`--color-main-background`, `--color-primary-element`, `--border-radius-element` and so on). That buys two things:

- If we ever want the real component library, `@nextcloud/vue`, it reads these same variables and will pick up our values with no glue code.
- Anyone who has written CSS for a Nextcloud app can work on ours without learning a new vocabulary.

The values come from Nextcloud's source (`apps/theming/lib/Themes/DefaultTheme.php` and `DarkTheme.php`). We changed three things on purpose:

1. **Rounder corners.** Stock Nextcloud uses 8px on controls and 16px on the window. We use 12px and 24px, with pill buttons.
2. **Tool colours.** Stock Nextcloud is one blue. We keep that blue for primary actions and add seven family accents for tool icons, navigation dots, selection and progress.
3. **Backdrop choice.** Nextcloud's default backdrop is a blue photo. We use a flat colour (it has to work offline) and let people pick from the family colours in settings.

Nothing here uses Nextcloud's name or logo. The app has its own name and mark.

## Layout

```
+---------------------------------------------------------------------------+
| [logo]  All tools  Recent  Workflows                 [search] [theme] [me] |  header, 50px, on the backdrop
|  +---------------------------------------------------------------------+  |
|  | NAVIGATION 300px  | CONTENT                         | SIDEBAR 300-500 |  |  the window: 8px from the edges,
|  |                   |                                 |                 |  |  24px radius, main background
|  | [+ Upload PDF]    |  All tools > Merge PDF  [grid]  |  Options        |  |
|  |                   |                                 |  Details        |  |
|  | o All tools       |  ( dropzone )                   |                 |  |
|  | v Organize      6 |                                 |  [ options ]    |  |
|  |     Merge PDF     |  [ ] name           pages  size |                 |  |
|  |     Split PDF     |  [x] report.pdf        24  4 MB |                 |  |
|  | > Optimize      3 |  [ ] scan.pdf          12  9 MB |                 |  |
|  | > Convert to PDF  |                                 |                 |  |
|  |   ...             |          [ Merge 2 files ]      |                 |  |
|  |                   |                                 |                 |  |
|  | Settings          |                                 |                 |  |
|  +---------------------------------------------------------------------+  |
+---------------------------------------------------------------------------+
```

- **Backdrop**: `--color-background-plain` fills the whole viewport. Header text and icons use `--color-background-plain-text`.
- **Header**: `--header-height` (50px), transparent, sitting straight on the backdrop. Logo on the left, then the top-level sections as pill-shaped header items (`--header-menu-item-height`, `--border-radius-pill`). The active one gets a translucent white pill behind it. Search, theme toggle and the user menu on the right.
- **Window**: the content container. Margin `--body-container-margin` (8px) on the left, right and bottom, radius `--body-container-radius` (24px), background `--color-main-background`, `--shadow-window`. Height `--body-height`. It never scrolls as a whole; the content area inside it does.
- **Navigation**: `--navigation-width` (300px) on the left, inside the window. Background `--color-main-background-blur` with `--filter-background-blur`, so it looks very slightly frosted against the content, as in Nextcloud.
- **Content**: everything else in the middle. A sticky breadcrumb bar at the top, then the page.
- **Sidebar**: optional, on the right, between `--sidebar-min-width` and `--sidebar-max-width`. Opens when a tool has options or when a file is selected.
- **Under 1024px** (`--breakpoint-mobile`): the navigation turns into an overlay that slides in from the left with a hamburger toggle in the breadcrumb bar, and the sidebar becomes a full-height overlay from the right. Both slide with `--animation-panel`.

## Colour

### Neutrals (Nextcloud defaults)

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--color-main-background` | `#FFFFFF` | `#171717` | Window, cards, sidebar |
| `--color-background-hover` | `#F5F5F5` | `#212121` | Hovered rows and nav items |
| `--color-background-dark` | `#EDEDED` | `#292929` | Wells, input backgrounds, page editor canvas |
| `--color-background-darker` | `#DBDBDB` | `#3B3B3B` | Pressed states, scrollbars |
| `--color-main-text` | `#222222` | `#EBEBEB` | Body text |
| `--color-text-maxcontrast` | `#6B6B6B` | `#999999` | Secondary text. Nextcloud picked it to stay at 4.5:1 on hover backgrounds |
| `--color-border` | `#EDEDED` | `#292929` | Hairlines |
| `--color-border-dark` | `#DBDBDB` | `#3B3B3B` | Card and input borders |
| `--color-border-maxcontrast` | `#7D7D7D` | `#7D7D7D` | Borders that must be visible (checkboxes, focused inputs), 3:1 or better |

### Primary

Nextcloud blue, used for the single main action on a screen, links, focus rings and selected checkboxes.

| Token | Light | Dark |
| --- | --- | --- |
| `--color-primary-element` | `#00679E` | `#5AADEA` |
| `--color-primary-element-text` | `#FFFFFF` | `#001B2B` |
| `--color-primary-element-hover` | `#005A8A` | `#78BDEF` |
| `--color-primary-element-light` | `#E5EFF5` | `#1C2B35` |
| `--color-primary-element-light-text` | `#00507A` | `#A6D4F5` |

The "light" pair is Nextcloud's secondary button and the active navigation item.

### Tool families

The family colour is what keeps this from feeling like a stock Nextcloud install. Use it for the tool icon tile, the dot next to a family in the navigation, selected rows and pages, progress bars and badges. Primary buttons stay blue, so the "do it" button is always in the same place and colour.

Put `data-category` on the tool's wrapper and use the four `--accent-*` tokens inside it. Outside any family the accent falls back to the primary blue.

| Family | `data-category` | Fill (light / dark) | Text (light / dark) | Soft (light / dark) |
| --- | --- | --- | --- | --- |
| Organize | `organize` | `#FF6B3D` / `#FF7A50` | `#B83A12` / `#FFA07E` | `#FFE6DC` / `#3A2018` |
| Optimize | `optimize` | `#8FD14F` / `#9EDB60` | `#3F7310` / `#B4E585` | `#E7F6D5` / `#24301A` |
| Convert to PDF | `convert-to` | `#1FC7A6` / `#33D3B2` | `#00735E` / `#6FE3CA` | `#D3F5EC` / `#123129` |
| Convert from PDF | `convert-from` | `#FFB31F` / `#FFBE3D` | `#8A5200` / `#FFCF6E` | `#FFF0CC` / `#382A10` |
| Edit | `edit` | `#FF5C9A` / `#FF73A8` | `#B8135A` / `#FF9EC3` | `#FFE0EC` / `#3A1826` |
| Security | `security` | `#36A9F2` / `#55B8F5` | `#0A62A0` / `#8DCFF8` | `#DAEFFD` / `#132A3A` |
| Smart tools | `smart` | `#222222` / `#EBEBEB` | same as fill | `#EDEDED` / `#292929` |

| Token | Use |
| --- | --- |
| `--accent-fill` | Icon tiles, nav dots, progress fill, selected page ring |
| `--accent-on` | Icon or text on top of the fill. Always dark, the bright fills are too light for white |
| `--accent-text` | Accent-coloured text on the main background |
| `--accent-soft` | Selected row background, badges, hover on tool cards |

Which tool goes where:

| Family | Tools |
| --- | --- |
| Organize | Merge PDF, Split PDF, Remove pages, Extract pages, Organize PDF, Scan to PDF |
| Optimize | Compress PDF, Repair PDF, OCR PDF |
| Convert to PDF | JPG to PDF, Word to PDF, PowerPoint to PDF, Excel to PDF, HTML to PDF |
| Convert from PDF | PDF to JPG, PDF to Word, PDF to PowerPoint, PDF to Excel, PDF to PDF/A |
| Edit | Edit PDF, Rotate PDF, Add page numbers, Add watermark, Crop PDF |
| Security | Unlock PDF, Protect PDF, Sign PDF, Redact PDF, Compare PDF |
| Smart tools | Summarize PDF, Translate PDF, Workflows |

Nextcloud's own assistant styling uses a purple gradient. We deliberately don't copy that one: the smart tools are plain ink.

### Status

Straight from Nextcloud. Each comes as a pale background, a text colour for that background, and a strong "element" colour for icons and borders.

| | Background | Text | Element |
| --- | --- | --- | --- |
| Error | `--color-error` | `--color-error-text` | `--color-element-error` |
| Warning | `--color-warning` | `--color-warning-text` | `--color-element-warning` |
| Success | `--color-success` | `--color-success-text` | `--color-element-success` |
| Info | `--color-info` | `--color-info-text` | `--color-element-info` |

Always pair status colour with an icon and a word.

### Backdrop

Set `data-backdrop` on `<body>` from the user's settings. The choices are `blue` (default), `tomato`, `jade`, `marigold`, `pink`, `lime` and `ink`. Each sets `--color-background-plain` and the matching header text colour. Show them in settings as a row of round swatches, like Nextcloud's background picker.

Nextcloud's own default blue `#0082C9` only reaches 4.2:1 against white header text, so our default is a touch deeper, `#0071AD` (5.3:1).

### Contrast

`python3 design/check-contrast.py` reads `tokens.css` and checks 93 pairings in light and dark, including every family colour and every backdrop. All pass WCAG 2.2 AA. It exits non-zero on a failure, so it can run in CI.

## Shape

| Token | Ours | Stock Nextcloud | Use |
| --- | --- | --- | --- |
| `--border-radius-page` | 4px | n/a | Rendered PDF pages |
| `--border-radius-small` | 6px | 4px | Checkboxes, badges |
| `--border-radius-element` | 12px | 8px | Inputs, nav items, file rows, menu items |
| `--border-radius-container` | 16px | 12px | Menus, popovers, tool cards |
| `--border-radius-container-large` | 24px | 16px | The window, modals, dropzone |
| `--border-radius-rounded` | 28px | 28px | Large avatars, icon tiles on the done screen |
| `--border-radius-pill` | 100px | 100px | Buttons, search field, chips, header items |

## Type

Nextcloud uses the system font, which also means nothing to download for an offline install.

| Token | Value | Use |
| --- | --- | --- |
| `--font-face` | system-ui stack | Everything |
| `--font-face-mono` | ui-monospace stack | File sizes, page counts, percentages |
| `--default-font-size` | 15px | Body, list rows, buttons |
| `--font-size-small` | 13px | Secondary text, counters, breadcrumbs on mobile |
| `--font-size-large` | 18px | Sidebar title, card titles |
| `--font-size-heading` | 22px | Heading at the top of a tool page |
| `--font-size-display` | 30px | "All tools" heading and empty states |
| `--font-weight-element` | 500 | Buttons, nav items |
| `--font-weight-heading` | 600 | Headings |
| `--default-line-height` | 1.5 | Everything |

Use tabular numbers (`font-variant-numeric: tabular-nums`) for sizes and counts so they don't jump while a job runs.

## Spacing and sizes

Everything is a multiple of `--default-grid-baseline` (4px). The common gaps are 4, 8, 12, 16 and 24px, written as `calc(var(--default-grid-baseline) * n)`.

- `--default-clickable-area` is 34px with a mouse, as in Nextcloud, and goes to 44px on touch screens.
- `--clickable-area-large` (48px) is for the main action button and the dropzone's file button.
- File rows are `--list-row-height` (50px).

## Motion

Nextcloud moves very little, and that's part of its look.

- `--animation-quick` (100ms): hover and colour changes.
- `--animation-slow` (200ms): menus, toggles, checkbox ticks, card lift.
- `--animation-panel` (300ms): the navigation and sidebar sliding in.
- `--ease` for everything, `--ease-spring` only for the tool card lift.
- Animate `transform` and `opacity` only. `prefers-reduced-motion` drops all durations to 1ms in the tokens.

## Components

Class names are suggestions. The tokens are the contract.

### Buttons

Pill shaped (`--border-radius-pill`), `--default-clickable-area` tall, `--font-weight-element`, horizontal padding 16px (12px with an icon).

| Kind | Background | Text | For |
| --- | --- | --- | --- |
| Primary | `--color-primary-element` | `--color-primary-element-text` | The one main action: "Merge PDF", "Download" |
| Secondary | `--color-primary-element-light` | `--color-primary-element-light-text` | "Add more files", "Choose files" |
| Tertiary | transparent, `--color-background-hover` on hover | `--color-main-text` | Toolbar actions, "Cancel" |
| Error | `--color-element-error` | white | Destructive actions, kept away from primary |

Hover swaps to the matching `-hover` token. Focus: `outline: 2px solid var(--color-main-text); outline-offset: 2px` (Nextcloud uses the main text colour so the ring is visible on any background). Disabled is `opacity: 0.5` with `cursor: default`. Loading keeps the width, shows a spinner and sets `aria-busy`.

### Navigation

Nextcloud's app navigation, with tool families as collapsible groups.

- Padding 8px all round. Items are `--default-clickable-area` tall, `--border-radius-element`, icon (20px) then label then an optional counter.
- Top: a primary "Upload PDF" button the full width of the list.
- Then "All tools", "Recent", and one collapsible group per family. The group header has a 10px round dot in `--accent-fill` (set `data-category` on the group) and a chevron. Children are the tools.
- Hover: `--color-background-hover`. Active: `--color-primary-element-light` with `--color-primary-element-light-text`, same as Nextcloud. Inside a family group the active item uses `--accent-soft` with `--color-main-text` and a 3px `--accent-fill` bar on the left edge, so you can see which family you're in.
- Counters (number of tools, number of files in Recent) are small pills in `--color-background-dark` and `--font-size-small`.
- Pinned to the bottom: "Settings", which opens the settings modal.

### Breadcrumb bar

Sticky at the top of the content, 50px tall, `--color-main-background`, a `--color-border` line underneath once content scrolls under it.

- Left: navigation toggle (mobile only), then breadcrumbs: "All tools > Organize > Merge PDF". The last crumb is `--font-weight-heading`.
- Right: view toggle (list/grid) as tertiary icon buttons, and a sidebar toggle.

### All tools (home)

- Heading in `--font-size-display`, one line of muted copy, then a row of family filter chips (pills with the family dot).
- A grid of tool cards: `repeat(auto-fill, minmax(220px, 1fr))`, gap 12px.
- Tool card: `--border-radius-container`, `--color-main-background`, 1px `--color-border-dark` border, padding 16px. A 44px icon tile (`--border-radius-element`, `--accent-fill`, icon in `--accent-on`), the name at `--font-size-large` / 600, a two-line description in `--color-text-maxcontrast`.
- Hover: background `--accent-soft`, border `--accent-fill`, lift 2px with `--ease-spring`, `--shadow-card-hover`. The whole card is one link.

### Dropzone

Top of every tool page.

- `--border-radius-container-large`, 2px dashed `--color-border-maxcontrast`, background `--color-background-hover`, min height 220px, centred content: family icon tile (64px, `--border-radius-rounded`), "Drop PDFs here", a secondary "Choose files" button (real file input behind a label) and a line of muted help text ("Up to 200 MB each, files stay on this server").
- Dragging over: border goes solid `--accent-fill`, background `--accent-soft`. Count drag enter and leave so it doesn't flicker over child elements.
- Rejected file: Nextcloud-style error note under it (`--color-error` background, `--color-error-text`), and the zone resets.
- Paste from the clipboard works too. After files are added, the dropzone shrinks to a 56px bar ("Drop more files or choose") above the file list.

### File list

This is Nextcloud Files' list, and it's where files wait before a tool runs.

- Header row: select-all checkbox, "Name", "Pages", "Size", "Added". Header text is `--color-text-maxcontrast`, `--font-size-small`, sortable columns show an arrow and set `aria-sort`.
- Rows: `--list-row-height` (50px), `--border-radius-element`, checkbox, a 32px first-page thumbnail (`--border-radius-page`), the name (wraps, never silently cut off), then mono numbers. A row actions menu ("…") on the right: preview, rotate, remove, move up/down.
- Hover: `--color-background-hover`. Selected: `--accent-soft`, with the checkbox ticked in `--color-primary-element`.
- Drag to reorder with a drag handle on hover; keyboard: Alt+Up / Alt+Down on a focused row.
- The grid view toggle swaps rows for Nextcloud-style file tiles: a large thumbnail on a `--color-background-dark` tile (`--border-radius-container`) with the name under it.
- Empty list: Nextcloud's empty content pattern, a large icon (64px) in `--color-text-maxcontrast`, a title and one line of help, centred.

### Action bar

Sticky at the bottom of the content, 64px, `--color-main-background-translucent` with the blur filter and a `--color-border` line above. Left: a summary of the chosen options ("3 files, 41 pages, highest compression"). Right: the primary button at `--clickable-area-large`. Leave space under the list so the bar never covers the last row.

### Sidebar (tool options)

Nextcloud's app sidebar.

- Header: the family icon tile, tool name at `--font-size-large`, a one-line description, and a close button.
- Tabs underneath as a row of pill buttons: "Options" and "Details". Active tab uses the primary light pair.
- Options are Nextcloud form controls: checkbox and radio rows (`--default-clickable-area` tall, the whole row clickable), text inputs (`--border-radius-element`, 2px `--color-border-maxcontrast` border, focused border `--color-main-text`), selects, and switches.
- Where a tool has a small set of exclusive choices (compression level, page orientation), show them as option cards: `--border-radius-container`, border `--color-border-dark`, chosen card gets a 2px `--accent-fill` border, `--accent-soft` background and a tick.
- Details tab shows file info for the selected file: page count, size, PDF version, encryption, a big preview.

### Progress and results

- While running, the file list rows get an inline progress bar (4px, `--border-radius-pill`, track `--color-background-dark`, fill `--accent-fill`) and a status line ("Compressing page 12 of 40").
- Done: the content swaps to a centred result card (`--border-radius-container-large`): a large tick in an `--accent-fill` circle, the headline ("Your PDF is 74% smaller"), the numbers in mono, a primary "Download" button and a secondary "Save to Recent".
- Under it, "Continue with" chips for other tools: pills with `--accent-soft` background and `--accent-text`, each scoped to the target tool's family, so the next step shows its colour.
- Errors use Nextcloud's note card (`--color-error`, `--color-error-text`, an icon) with what happened, how to fix it, and a retry button.

### Page editor

Used by Organize, Remove pages, Extract, Split, Rotate and the edit tools. It's the Files grid view applied to pages.

- Content area background is `--color-background-dark` so the white pages stand out. Pages are always rendered white in both themes.
- Page tile: the rendered page with `--border-radius-page` and `--shadow-card`, the page number under it in `--font-size-small` mono.
- Hover: a small floating action pill on the page (rotate, delete, duplicate), 30px round tertiary buttons on `--color-main-background` with `--shadow-menu`.
- Selected: a checkbox in the top-left corner like Files' grid view, plus a 3px `--accent-fill` ring offset 3px. Click selects, Shift+click selects a range, Ctrl/Cmd+click toggles, Ctrl/Cmd+A selects all. A selection bar replaces the breadcrumbs: "6 pages selected" with Rotate, Delete, Extract actions, like Files does when you select files.
- Drag to reorder: the page lifts with `--shadow-card-hover`, a 4px `--accent-fill` pill marks the drop spot. Keyboard: Alt+Left / Alt+Right.
- Split mode draws a dashed `--accent-fill` line between pages that you can toggle, and tints each resulting group with `--accent-soft` so you see the output files first.
- Deleting shows Nextcloud's toast with "Undo" for about 7 seconds.
- A zoom slider in the breadcrumb bar sets the tile size from 100 to 280px. Virtualise once a document passes about 60 pages.

### Menus, modals, toasts

- Action menus: `--border-radius-container`, `--color-main-background`, `--shadow-menu`, 4px padding, items `--default-clickable-area` tall with `--border-radius-element`.
- Modals: `--border-radius-container-large`, `--shadow-modal`, over a dark translucent backdrop. Title, content, buttons bottom right with the primary last. Escape closes, focus is trapped and returned.
- Toasts: bottom right, `--border-radius-container`, `--color-main-background`, `--shadow-menu`, a coloured status bar on the left edge. `role="status"`, gone after 7 seconds unless they hold an Undo.
- Settings modal: Nextcloud's two-column settings dialog. Sections: Appearance (theme, backdrop swatches), Defaults per tool, Storage and cleanup, About.

## Don't

- Don't copy Nextcloud's name, logo or the assistant's purple gradient.
- Don't use gradients or glows anywhere.
- Don't put white text on the bright family fills.
- Don't use `--cat-*` or raw hex in components. Use `--accent-*` or the Nextcloud tokens.
- Don't use colour as the only sign of selection or status.
- Don't round PDF pages beyond `--border-radius-page`.
- Don't remove focus outlines.

## Changing things

Every colour is a hex value in `tokens.css`. Dark values appear twice (once for the OS setting, once for the manual toggle), so change both, then run `python3 design/check-contrast.py`.
