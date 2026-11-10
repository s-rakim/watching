# Riso: the design system for the PDF toolkit

This is the look for the app. The tokens live in [`design/tokens.css`](../design/tokens.css). Import that one file and everything below is available as CSS custom properties. Nothing here depends on a framework, so it works the same in React, Svelte, Vue or plain HTML.

A live preview of every token and component sits in [`docs/design-preview.html`](design-preview.html). Open it in a browser, no build step needed.

## The idea

Most PDF tools look the same: white page, one red or blue brand colour, grey cards with a faint shadow. The other common look is the one everyone now recognises from generated sites, with indigo-to-purple gradients, default Tailwind blue buttons and cards that glow. This system avoids both on purpose.

The reference point is risograph printing. A riso print is warm off-white paper, dark ink, and a handful of loud flat inks laid down side by side. That maps neatly onto a PDF app:

- **Paper** is the background. Warm cream in light mode, warm charcoal in dark mode. Never pure white, never pure black, never cool slate.
- **Ink** is text and the primary action. Primary buttons are solid ink, not a brand colour, which keeps the bright colours free to mean something.
- **Seven inks**, one per family of tools. The colour tells you where you are. Merge and Split are tomato orange, the converters are jade and marigold, signing and protecting is sky blue, and so on.
- **Soft, chunky shapes.** Big radii everywhere except the PDF pages themselves, which stay close to square because they represent paper. Hover states lift the element and show a solid offset shadow in the tool's colour, like a misregistered print. No glows, no blur halos, no gradients.

The choices come out of the ui-ux-pro-max guidance. For a productivity tool it points to flat design plus micro-interactions, fast 150ms feedback, keyboard shortcuts and clear functional colour. For "creative tools, fun-focused" products it suggests claymorphism with 16 to 24px radii and soft bounce easing. Riso takes the flat, fast, functional base from the first and borrows the roundness and the spring from the second, then drops the parts of claymorphism (pastel washes, inner shadows) that would make a work tool feel like a toy. Its rules on contrast, focus rings, 44px targets, reduced motion and colour-never-alone are followed throughout.

## Using it

```css
@import "../design/tokens.css";

body {
  background: var(--paper);
  color: var(--ink);
  font: var(--weight-regular) var(--text-md) / var(--leading-body) var(--font-body);
}
```

Theme follows the OS. To give people a toggle, set `data-theme="light"` or `data-theme="dark"` on `<html>` and save their choice. Remove the attribute to go back to following the OS.

Tool colour comes from a `data-category` attribute on any wrapper. Inside it, use the four `--accent-*` tokens and never the raw `--cat-*` ones:

```html
<main data-category="organize">  <!-- Merge PDF page -->
  ...everything in here is tomato...
</main>
```

| Token | Use it for |
| --- | --- |
| `--accent-fill` | Large colour areas: icon tiles, the dropzone border while dragging, progress bars, the selected tab |
| `--accent-on` | Text and icons placed on top of `--accent-fill` |
| `--accent-text` | Accent-coloured text, links and icons sitting on paper or surface |
| `--accent-soft` | Tinted backgrounds: hover rows, selected page frames, badges |

Outside any category, the accent falls back to ink, so shared screens (settings, the home page header) still look finished.

## Colour

### Paper and ink

| Token | Light | Dark | Role |
| --- | --- | --- | --- |
| `--paper` | `#FBF6EE` | `#15120E` | Page background |
| `--surface` | `#FFFFFF` | `#1F1B16` | Cards, panels, dialogs |
| `--surface-sunk` | `#F3ECE0` | `#100D0A` | Inputs, wells, the editor canvas behind pages |
| `--surface-raised` | `#FFFFFF` | `#29241E` | Menus and popovers |
| `--ink` | `#1F1A14` | `#F6EFE4` | Body text, primary buttons |
| `--ink-muted` | `#62584C` | `#B3A796` | Secondary text and captions |
| `--ink-faint` | `#8F8475` | `#7D7366` | Placeholders and disabled labels only |
| `--line` | `#E4D9C7` | `#3A332A` | Card borders, hairlines |
| `--line-strong` | `#CBBDA6` | `#544A3E` | Input borders and dividers that need to be seen |
| `--on-ink` | `#FBF6EE` | `#15120E` | Text on an ink fill |

`--ink-faint` doesn't reach 4.5:1 and isn't meant to. Don't use it for anything a person has to read to get their work done.

### Tool families

Each family has a bright fill that carries dark text, a deeper "text" shade that is safe for small text on paper, and a soft tint. In dark mode the fill gets a touch lighter, the text shade becomes a pale tint and the soft background becomes a dark wash of the same hue.

| Family | `data-category` | Fill (light / dark) | Text (light / dark) | Soft (light / dark) |
| --- | --- | --- | --- | --- |
| Organize | `organize` | `#FF6B3D` / `#FF7A50` tomato | `#B83A12` / `#FFA07E` | `#FFE6DC` / `#3A2018` |
| Optimize | `optimize` | `#8FD14F` / `#9EDB60` lime | `#3F7310` / `#B4E585` | `#E7F6D5` / `#24301A` |
| Convert to PDF | `convert-to` | `#1FC7A6` / `#33D3B2` jade | `#00735E` / `#6FE3CA` | `#D3F5EC` / `#123129` |
| Convert from PDF | `convert-from` | `#FFB31F` / `#FFBE3D` marigold | `#8A5200` / `#FFCF6E` | `#FFF0CC` / `#382A10` |
| Edit | `edit` | `#FF5C9A` / `#FF73A8` bubblegum | `#B8135A` / `#FF9EC3` | `#FFE0EC` / `#3A1826` |
| Security | `security` | `#36A9F2` / `#55B8F5` sky | `#0A62A0` / `#8DCFF8` | `#DAEFFD` / `#132A3A` |
| Smart tools | `smart` | `#1F1A14` / `#F6EFE4` ink | `#1F1A14` / `#F6EFE4` | `#EDE5D8` / `#2A251F` |

Text on a fill is always ink-dark (`--accent-on`), in both themes. That is what makes the colours feel printed instead of neon: bright ink, dark type on top. White text on these fills would fail contrast on half of them anyway.

The smart family is plain ink on purpose. It covers the newer assistant style tools, and giving them a purple or a gradient would be exactly the look this system is trying to get away from. They get a small marigold spark in the icon instead.

### Which tool goes where

| Family | Tools |
| --- | --- |
| Organize | Merge PDF, Split PDF, Remove pages, Extract pages, Organize PDF, Scan to PDF |
| Optimize | Compress PDF, Repair PDF, OCR PDF |
| Convert to PDF | JPG to PDF, Word to PDF, PowerPoint to PDF, Excel to PDF, HTML to PDF |
| Convert from PDF | PDF to JPG, PDF to Word, PDF to PowerPoint, PDF to Excel, PDF to PDF/A |
| Edit | Edit PDF, Rotate PDF, Add page numbers, Add watermark, Crop PDF |
| Security | Unlock PDF, Protect PDF, Sign PDF, Redact PDF, Compare PDF |
| Smart tools | Summarize PDF, Translate PDF, Workflows (chaining tools) |

If a new tool shows up, put it in the family whose verb fits best. Don't add an eighth colour without checking it against the other seven, because past seven the hues start to blur together.

### Status colours

| Token set | Light fill / text | Dark fill / text |
| --- | --- | --- |
| `--danger-*` | `#C9252B` / `#B0141C` (white text on fill) | `#FF5A5F` / `#FF8A8D` |
| `--success-*` | `#2FB463` / `#17733A` | `#4CCB7E` / `#7FDDA3` |
| `--warning-*` | `#FFB31F` / `#8A5200` | `#FFBE3D` / `#FFCF6E` |

Each has `-fill`, `-on`, `-text` and `-soft` like the families do. Status colour always comes with an icon and a word ("Failed", "Done"), never on its own. Danger red is deeper and cooler than the tomato used for Organize so a failed merge doesn't look like a normal merge.

### Contrast

Every pairing above has been checked against WCAG 2.2 AA: 4.5:1 for text, 7:1 for body text on paper and soft tints, 3:1 for the focus ring. All 104 combinations pass in both themes. The lowest is tomato `on` on `fill` in light mode at 6.1:1.

Run the check yourself after changing any colour:

```sh
python3 design/check-contrast.py
```

It reads `tokens.css` directly and exits with an error if anything drops below the line, so it can go in CI.

## Shape

Generous radius is the main thing that makes this feel friendly. The rule is simple: the closer something is to a page of the user's document, the squarer it gets.

| Token | Value | Use |
| --- | --- | --- |
| `--radius-page` | 6px | Rendered PDF page thumbnails |
| `--radius-xs` | 8px | Checkboxes, page-number badges |
| `--radius-sm` | 12px | Inputs, small buttons, menu items |
| `--radius-md` | 16px | Icon tiles, toasts, popovers |
| `--radius-lg` | 22px | Panels, sidebars, file rows |
| `--radius-xl` | 28px | Tool cards, dialogs |
| `--radius-2xl` | 36px | Dropzone, hero blocks |
| `--radius-pill` | 999px | Buttons, toolbars, tabs, badges, segmented controls |

When you nest rounded things, the inner radius should be the outer radius minus the padding between them. A 28px card with 12px padding holds a 16px tile.

Borders are `--border-width` (1.5px) normally and `--border-width-thick` (2.5px) for the dropzone, the selected page and the chunky secondary button.

## Type

| Role | Font | Why |
| --- | --- | --- |
| Display: logo, page titles, tool names on cards | Fredoka, weights 500 and 600 | Rounded terminals that match the radii. Only used at 18px and up so it never gets childish |
| Body and UI | Plus Jakarta Sans, 400 to 700 | Friendly but plain enough for settings screens and long option lists |
| Numbers: file sizes, page counts, compression % | JetBrains Mono, 500 | Tabular figures so numbers don't jiggle while a job runs |

All three are open-licence Google fonts. The app is self-hosted and should work with no internet, so **ship the font files with the app** rather than linking to Google. Either install `@fontsource/fredoka`, `@fontsource/plus-jakarta-sans` and `@fontsource/jetbrains-mono`, or drop the woff2 files into a `fonts/` folder with `@font-face` rules and `font-display: swap`. The stacks fall back to the system UI font if the files are missing.

Scale (1.25 ratio, 16px body):

| Token | Size | Use |
| --- | --- | --- |
| `--text-2xs` | 11px | Page numbers on thumbnails only |
| `--text-xs` | 12px | Badges, file meta |
| `--text-sm` | 14px | Secondary text, toolbar labels, card descriptions |
| `--text-md` | 16px | Body, inputs, buttons |
| `--text-lg` | 18px | Card titles, lead text |
| `--text-xl` | 22px | Section titles, panel headings |
| `--text-2xl` | 28px | Tool page title on phones |
| `--text-3xl` | 36px | Tool page title |
| `--text-4xl` | 40 to 60px, fluid | Home page headline |

Line heights: `--leading-tight` (1.15) for display, `--leading-snug` (1.3) for card titles, `--leading-body` (1.55) for everything else. Display text gets `--tracking-display`. Small caps labels get `--tracking-caps`.

## Spacing

A 4px grid: `--space-1` is 4px, `--space-2` is 8px, up through `--space-24` at 96px. In practice most layouts only need 8, 12, 16, 24, 32 and 48.

- Tool grid gap: `--space-4` on phones, `--space-6` from 768px.
- Card padding: `--space-5` on phones, `--space-6` on desktop.
- Between sections on the home page: `--space-16`.
- Side gutters: `--page-gutter`, which runs from 16px on phones to 40px on wide screens.
- Interactive things are at least `--tap-target` (44px) tall, with at least 8px between neighbours.

## Elevation

Shadows are tinted warm brown, so they read as a shadow on paper rather than a grey smudge. In dark mode they become plain black and do less work; borders carry more of the structure there.

| Token | Use |
| --- | --- |
| `--shadow-xs` | Inputs, segmented controls |
| `--shadow-sm` | Resting cards and file rows |
| `--shadow-md` | Floating toolbar, sticky action bar |
| `--shadow-lg` | Menus, popovers, dragged page |
| `--shadow-xl` | Dialogs |
| `--shadow-pop` | Hover and focus on tool cards: a solid 6px offset in the accent colour |
| `--shadow-pop-sm` | Hover on small accent things |
| `--shadow-pop-ink` | The chunky secondary button |

`--shadow-pop` is the signature move. Use it on things you can pick, not on things that just sit there.

## Motion

| Token | Value | For |
| --- | --- | --- |
| `--duration-instant` | 90ms | Press feedback |
| `--duration-fast` | 150ms | Hover, colour changes |
| `--duration-base` | 220ms | Menus, toggles, card lift |
| `--duration-slow` | 360ms | Dialogs, side panels, page reorder |
| `--duration-slower` | 560ms | The file-landed moment, the job-done moment |

Easing: `--ease-out` for things arriving, `--ease-in` for things leaving (and make exits about two thirds the length of the entrance), `--ease-spring` for lifts and pops, `--ease-linear` only for progress bars and spinners.

Rules that keep it lively without getting tiring:

- Animate `transform` and `opacity` only. Never width, height, top or left.
- One or two things move per interaction. A card lifts; its neighbours stay put.
- Grids of tool cards can stagger in on first load, 30ms apart, max about 12 cards. After that everything appears at once.
- Nothing blocks input. If someone clicks while a dialog is still opening, the click wins.
- `prefers-reduced-motion` is handled in the tokens: durations drop to 1ms, the spring turns into a plain curve and lift/press amounts go to zero. Components get this for free as long as they use the tokens instead of hard-coded values.

## Components

These describe the look and the behaviour. Class names are suggestions; the token names are the contract.

### Buttons

Three kinds, all pill shaped, at least 44px tall, `--text-md` at weight 600.

**Primary** is the one main action on a screen ("Merge PDF", "Download"). There should be one per screen.

```css
.btn-primary {
  min-height: 52px;
  padding: 0 var(--space-8);
  border-radius: var(--radius-pill);
  background: var(--ink);
  color: var(--on-ink);
  box-shadow: var(--shadow-pop-sm);   /* the tool colour peeks out underneath */
  transition: transform var(--duration-base) var(--ease-spring),
              box-shadow var(--duration-base) var(--ease-spring);
}
.btn-primary:hover  { transform: translateY(var(--hover-lift)); box-shadow: var(--shadow-pop); }
.btn-primary:active { transform: translateY(0) scale(var(--press-scale)); box-shadow: none;
                      transition-duration: var(--duration-instant); }
```

**Accent** is for the actions inside a tool that carry its colour (add more files, apply to all pages). Fill `--accent-fill`, text `--accent-on`, same lift.

**Secondary** is the chunky outlined button: `--surface` background, `--border-width-thick` border in `--ink`, and `--shadow-pop-ink` on hover.

**Ghost** is for toolbar and low-priority actions: no border, `--ink-muted` text, `--accent-soft` background on hover.

**Danger** uses `--danger-fill` and `--danger-on` and is kept physically apart from the primary button, never next to it.

All buttons:

- Focus: `outline: var(--focus-ring-width) solid var(--focus-ring); outline-offset: var(--focus-ring-offset);` Keep the outline, never remove it.
- Loading: keep the width, swap the label for a spinner plus "Merging…", and set `aria-busy="true"` and `disabled`.
- Disabled: `opacity: 0.45`, no shadow, no lift, `cursor: not-allowed`.
- Icon-only buttons need an `aria-label` and a tooltip.

### Tool cards

The home page is a grid of these, grouped by family, with a filter row of pill tabs on top ("All", "Organize", "Optimize", "Convert", "Edit", "Security", "Smart").

```
+-----------------------------------------+   radius-xl, surface, line border
|  [ tile ]                               |   tile: 56px, radius-md, accent-fill
|                                         |         icon 28px in accent-on
|  Merge PDF                              |   Fredoka 600, text-lg
|  Combine several PDFs into one, in the  |   Jakarta 400, text-sm, ink-muted,
|  order you want.                        |   two lines max
+-----------------------------------------+
```

- Grid: `repeat(auto-fill, minmax(220px, 1fr))`, gap `--space-4` to `--space-6`.
- Resting: `--surface`, `--border-width` in `--line`, `--shadow-sm`.
- Hover and keyboard focus: lift by `--hover-lift`, border turns `--ink`, shadow becomes `--shadow-pop`. The coloured offset shadow appearing under the card is the moment of delight; don't add anything else.
- Press: `scale(var(--press-scale))`.
- The whole card is one link (`<a>`), so it is one tab stop and the full area is clickable.
- Optional corner badge ("New", "Offline") as a pill in `--accent-soft` with `--accent-text`.
- Icons: one outline set at 2px stroke with rounded caps, such as Lucide or Phosphor. No emoji.

### Dropzone

The first thing on every tool page and the biggest object on it.

```
+=================================================+   radius-2xl
:                                                 :   2.5px dashed line-strong
:              [  big accent tile  ]              :   background surface
:                                                 :
:          Drop PDFs here or  [ Choose files ]    :   btn-primary
:          Up to 200 MB each. Nothing leaves      :   text-sm, ink-muted
:          this machine.                          :
+=================================================+
```

- Minimum height 280px on desktop, 200px on phones.
- **Idle**: dashed `--line-strong` border, `--surface` background. The accent tile sits in the middle with the tool icon.
- **Dragging over**: border goes solid `--accent-fill`, background becomes `--accent-soft`, the tile scales up to 1.08 with `--ease-spring`, and the copy changes to "Let go to add 3 files". Use `dragenter` / `dragleave` with a counter so it doesn't flicker over child elements.
- **File landed**: each file drops into a file row underneath with a short slide up (`--duration-slower`, `--ease-out`).
- **Rejected** (wrong type, too big): border and copy in `--danger-text`, a one-line reason, and the zone resets after about 4 seconds.
- The "Choose files" button is a real `<input type="file">` behind a label, so it works with the keyboard and screen readers. Dragging is never the only way in. Paste from the clipboard should work too.
- Mention that processing is local. For a self-hosted tool that is the main reason to use it.

### File rows and the action bar

Once files are added, they show as rows (or a thumbnail grid for page tools).

- Row: `--radius-lg`, `--surface`, `--shadow-sm`, 64px tall. First-page thumbnail at `--radius-page`, filename (wraps with `overflow-wrap: anywhere`, never cuts off silently), size and page count in `--font-mono`.
- Drag handle on the left, remove button on the right. Reordering also works with keyboard: focus a row, then Alt+Up / Alt+Down.
- A sticky action bar at the bottom of the viewport holds the tool's options summary and the one primary button. `--radius-pill` if it floats, `--shadow-md`, `--z-sticky`. Leave space below the content so the bar never covers the last row.

### Progress and results

- Progress bar: 10px tall, `--radius-pill`, track `--accent-soft`, fill `--accent-fill`, `--ease-linear`. Show a real percentage in mono next to it when the server reports one.
- For jobs over a second, show what is happening in words ("Compressing page 12 of 40").
- Done screen: the accent tile turns into a check with a single spring pop (`--duration-slower`), the result details in mono ("4.2 MB to 1.1 MB, 74% smaller"), a big Download primary button and a row of "Continue with" chips that hand the file to another tool. Those chips are pills tinted with the target tool's family colour, which is a nice way to show off the palette.
- Errors say what went wrong and what to do ("This PDF is password protected. Unlock it first, or enter the password."), with a retry.

### Toolbars

Used in the page editor and in Edit PDF.

- A floating pill: `--radius-pill`, `--surface-raised`, `--border-width` in `--line`, `--shadow-md`, height `--toolbar-height` (56px), `--z-toolbar`.
- Groups of icon buttons separated by a 1px `--line` divider with `--space-2` either side.
- Each button is 40px round, ghost style. The active tool is filled `--accent-fill` with `--accent-on` icon, so the active state is obvious at a glance and matches the tool family.
- Every button has a tooltip with its name and shortcut ("Rotate, R").
- On phones the toolbar docks to the bottom edge, full width, respecting the safe area, and scrolls sideways if it has to rather than shrinking icons below 40px.

### Page editor

This is where Organize, Remove pages, Rotate, Extract, Split and the edit tools spend most of their time. It is a grid of page thumbnails on a sunk canvas.

```
+-- header ------------------------------------------------------+
| <- Back    report.pdf  ·  24 pages              [ Apply ]      |
+----------------------------------------------------------------+
|  canvas: surface-sunk                       | side panel       |
|                                             | radius-lg        |
|   +----+  +----+  +----+  +----+            | options for the  |
|   |    |  |####|  |    |  |    |            | tool, e.g. split |
|   |    |  |####|  |    |  |    |            | ranges           |
|   +----+  +----+  +----+  +----+            |                  |
|     1       2       3       4               |                  |
|                                             |                  |
|        ( floating pill toolbar )            |                  |
+----------------------------------------------------------------+
```

- Canvas is `--surface-sunk` so the white pages stand out. Pages are rendered white in both themes, because that is what the document actually looks like. Do not invert them in dark mode.
- Page thumbnail: `--radius-page`, `--shadow-sm`, page number underneath in a small `--radius-xs` badge using `--text-2xs` mono.
- Hover: `--shadow-md` and a small hover toolbar on the page itself (rotate, delete, duplicate), 32px round buttons on a `--surface-raised` pill.
- Selected: 3px ring in `--accent-fill` offset 3px from the page, `--accent-soft` behind the number badge, and a check in the corner. Colour is never the only sign of selection.
- Multi-select: click, Shift+click for ranges, Ctrl/Cmd+click to toggle, Ctrl/Cmd+A for all. Show a count in the header ("6 selected") in an `aria-live="polite"` region.
- Dragging a page: it lifts with `--shadow-lg` and a slight 2deg tilt, the others slide out of the way with `--duration-slow` and `--ease-out`, and a 4px `--accent-fill` pill shows the insertion point. Keyboard alternative: Alt+Left / Alt+Right moves the focused page.
- Rotated pages animate the turn (`--duration-base`, `--ease-spring`) so it's obvious which ones changed.
- Deleted pages fade and shrink, and an "Undo" toast appears for about 5 seconds.
- Split mode draws a dashed `--accent-fill` cut line between pages, which you can click to toggle, and tints each resulting group with alternating `--accent-soft` backgrounds so you can see the output files before you commit.
- Zoom slider in the header changes the thumbnail size (100px to 280px wide). Virtualise the grid once a document passes about 60 pages.
- The side panel is 320px (`--sidebar-width`), `--radius-lg`, `--surface`. On phones it becomes a bottom sheet with a grab handle and a 28px top radius.

### Inputs and options

- Text inputs: 48px tall, `--radius-sm`, `--surface-sunk`, `--border-width` in `--line-strong`. On focus the border turns `--ink` and the focus ring appears. Labels always sit above the field, never as placeholder only.
- Option choices (compression level, page size, orientation) are big selectable cards rather than dropdowns when there are five or fewer: `--radius-lg`, and when chosen a `--border-width-thick` border in `--accent-fill` with `--accent-soft` background and a check.
- Segmented controls and tabs are pills, with the active segment in `--ink` and `--on-ink` text.
- Toggles: 28px tall pill track, `--line-strong` when off, `--accent-fill` when on, with a spring on the thumb.

### Header and navigation

- 68px header (`--header-height`) on `--paper`, no bottom border until the page scrolls, then a `--line` hairline.
- Logo set in Fredoka 600. A small mark made of three overlapping round squares in tomato, jade and marigold works well and reuses the palette.
- A "Tools" menu opens a mega panel grouped by family, each group headed with a little coloured dot and the family name, so the colours are taught from the first click.
- Theme toggle and settings on the right.
- On the tool page, the header shows the tool's tile and name, and a back link to all tools.

### Toasts and dialogs

- Toasts: `--radius-md`, `--surface-raised`, `--shadow-lg`, bottom centre, a coloured status icon on the left. `role="status"`, gone after 4 to 5 seconds, never steal focus.
- Dialogs: `--radius-xl`, `--shadow-xl`, max 480px wide, over `--scrim`. Open with a scale from 0.96 and fade (`--duration-slow`, `--ease-out`), close faster with `--ease-in`. Escape closes, focus is trapped inside and returns to the trigger on close. Ask before anything destructive, and offer undo instead where you can.

### Empty, loading and offline

- Skeletons for anything that takes over 300ms: `--surface-sunk` blocks with the real radii, gently pulsing between 60% and 100% opacity. No shimmer gradient.
- Empty states get the family tile, one sentence and a button. Keep it short.
- If the processing backend is down, say so in a banner at the top in `--warning-soft` with `--warning-text`.

## Layout

- Max content width `--container-max` (1240px), centred, with `--page-gutter` on the sides.
- Breakpoints: 480, 768, 1024, 1440. Tool grid runs one column under 480, two to three on tablets, four to five on desktop.
- The home page: a short headline in `--text-4xl` Fredoka, one line of copy, the filter pills, then the grid. No hero image. The colours of the cards are the hero.
- Never let the page scroll sideways at 360px wide.

## Don't

- Don't use gradients, glows, glassy blur, neon or purple. If something feels flat, use a stronger accent fill or a pop shadow, not an effect.
- Don't use grey shadows or cool grey neutrals. Everything neutral leans warm.
- Don't put white text on the bright family fills. Dark ink on bright ink is the look.
- Don't reach for raw hex values or `--cat-*` tokens in components. Use `--accent-*` so a component works in every family.
- Don't use colour as the only signal for selection, status or family. Pair it with an icon, a check or a label.
- Don't round the PDF pages themselves past `--radius-page`. They're paper.
- Don't remove focus outlines.

## Changing things

The whole palette is about forty lines at the top of `tokens.css`. To retune a family, change its four values in both the light block and the two dark blocks (they are duplicated so dark mode works whether it comes from the OS or the toggle), then run `python3 design/check-contrast.py`. The preview page picks the change up on refresh.
