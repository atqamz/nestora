---
name: Nestora
description: A calm, tidy two-person household app; navy ink on cool paper with one rose signal.
colors:
  bg: "oklch(97.6% 0.006 265)"
  surface: "oklch(99.6% 0.002 265)"
  surface-2: "oklch(94.2% 0.012 265)"
  line: "oklch(88.5% 0.016 265)"
  ink: "oklch(22% 0.045 268)"
  ink-2: "oklch(44% 0.035 268)"
  route: "oklch(26% 0.085 268)"
  hero: "oklch(26% 0.085 268)"
  accent: "oklch(30% 0.1 268)"
  on-accent: "oklch(98% 0.008 268)"
  signal: "oklch(75% 0.13 355)"
  late: "oklch(50% 0.19 27)"
  late-bg: "oklch(94% 0.03 27)"
  focus: "oklch(30% 0.06 268)"
typography:
  display:
    fontFamily: "Mona Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.8rem"
    fontWeight: 800
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.45
  meta:
    fontFamily: "Hanken Grotesk, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
rounded:
  control: "0.625rem"
  group: "1rem"
spacing:
  s1: "0.25rem"
  s2: "0.5rem"
  s3: "0.75rem"
  s4: "1rem"
  s5: "1.25rem"
  s6: "1.5rem"
  s7: "2rem"
  s8: "2.5rem"
  s9: "3.5rem"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    rounded: "{rounded.control}"
    height: "3rem"
    padding: "0 1rem"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: "3rem"
  button-danger:
    backgroundColor: "transparent"
    textColor: "{colors.late}"
    rounded: "{rounded.control}"
    height: "3rem"
  pill:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "999px"
    height: "2rem"
  row-group:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.group}"
---

# Design System: Nestora

Authority: PRODUCT.md holds who and why; this file holds how it looks and behaves. Token values above are the light theme and are checked against `src/tokens.css` by `test/design-doc.test.ts`; dark values live only in `src/tokens.css`. Rules marked **Target** are the agreed system that later work moves the code toward (`docs/ux-research.md` on the `docs` branch, UX-09); everything else describes the code today.

## Overview

**Creative North Star: "The Route"**

An Operate product used in two-to-ten-second moments. Cool paper, navy ink, flat rows grouped in quiet cards, and one rose signal that means "you are here". Character is carried by the Marriage journey (countdown, route spine, the two linked rings) and by the wordmark; daily screens borrow the route's symbol and its calm, not its size.

**Key Characteristics:**
- Flat by default; depth from a 1 px line, not shadow.
- Navy is the only action colour; red is for late and failed; rose is the signal and never a button.
- Everything sizes in `rem` and scales with the phone's text size.
- No beige, no gradients, no glass, no serif.

## Colors

One cool hue family (hue 265 to 268) in two complete themes, light and dark, switched by `prefers-color-scheme` or `data-theme` on the root.

### Primary
- **Route Navy** (`--accent`, `--route`, `--hero`; `oklch(30% 0.1 268)` and `oklch(26% 0.085 268)`): filled buttons, links, the route spine, checked checks, the Marriage hero and its bar. In dark, `--accent` and `--route` become light so they still read as the action colour.

### Secondary
- **Signal Rose** (`--signal`, `oklch(75% 0.13 355)`, with `--on-signal`): "you are here" on the journey and the current block. Never a button fill.

### Neutral
- **Cool Paper** (`--bg`), **Card White** (`--surface`), **Wash** (`--surface-2`, segmented control tracks and icon buttons), **Hairline** (`--line`), **Ink** (`--ink`) and **Soft Ink** (`--ink-2`, meta, borders of inputs, placeholders).
- **Late Red** (`--late`, on `--late-bg`): late, rejected and storage-full states only.
- **Focus** (`--focus`): the focus ring colour; `--on-hero` on the hero bar.
- Partner tints `--tint-a` (blue) and `--tint-b` (pink) mean Partner A and Partner B only, with `--on-tint` for their text.

### Named Rules
**The One Action Colour Rule.** Navy acts, red warns, rose points, blue and pink name a partner. A colour never takes a second meaning.
**The Quiet States Rule.** Done, paused and offline use `--ink-2` or a muted surface, never red.

## Typography

**Display Font:** Mona Sans (variable, weight 800, `font-stretch: var(--stretch-display)` = 125 %) for the wordmark and `h1`.
**Body Font:** Hanken Grotesk (variable) for everything else.

**Character:** the wide heavy display face is the product's voice; the body face stays out of the way.

### Hierarchy
- **Display** (`--fs-title` 1.8rem, 800, 1.1): `h1`, one per screen; takes focus on navigation.
- **Title** (`--fs-station` 1.125rem and `--fs-current` 1.425rem): journey stations, the current step, sheet titles.
- **Body** (`--fs-body` 1rem, 400, 1.45): `h2` and `h3` at 700; rows and forms.
- **Meta** (`--fs-meta` 0.875rem, 600): sync badge, hints, toast text.
- **Micro** (`--fs-micro` 0.78125rem, 600): bottom-bar labels and small captions.
- **Count** (`--fs-count` 7rem, `--fs-count-wide` 7.5rem): the akad countdown numeral.

### Named Rules
**The Text Scales Rule.** Sizes are `rem` tokens. No `vw` or `px` caps on text (**Target**: the countdown numeral still carries a `vw` cap); a label that cannot fit is hidden with its accessible name kept, never shrunk. Long words wrap; they never collapse a flex child to one letter.
**The Heading Order Rule.** One `h1` per screen, then `h2`, then `h3`; no level is skipped.

## Layout

Phone first. A sticky top bar (wordmark, sync badge, the two avatars), a fixed bottom bar of four tabs and a centre "+" (`--tabs` 4.25rem), and one column in `main`, at most 40rem wide (52rem from 62.5rem up). From 62.5rem the bottom bar becomes a left rail (`--sidebar`) and People and Money use a list-and-detail split. Safe-area insets (`--safe-t|r|b|l`) pad every edge.

Spacing is the nine-step scale `--s1` to `--s9` (0.25rem to 3.5rem). Rows are at least `--row-min` (3.75rem) tall. The Marriage Journey is full-bleed.

**Layout floor.** At 320 px and 200 % text (root `rem` 32 px) there is no horizontal scroll and nothing is clipped; at any width a screen shows no heading skip.

## Elevation & Depth

Flat. Row groups sit on `--surface` with a 1 px `--line` ring and 1 px inset dividers. Few things lift: the centre "+" (a soft shadow), the toast (`--ink` capsule with a shadow) and sheets (`<dialog>`). State changes are a colour fade of `--dur-state` (200 ms), 0 ms under `prefers-reduced-motion`.

## Shapes

Controls are gently rounded (`--r-control` 0.625rem); groups and cards 1rem (`--r-group`); pills, avatars, the FAB and checks are circular or capsule. Borders are 1 px; focus is a 2.5 px outline with 2 px offset, in `--focus`. Dashed borders mean "empty slot" (empty chips; the capture, search and quick-add inputs use them today, which **Target** replaces with solid).

## Components

### Buttons
- **Primary (filled):** `--accent` fill, `--on-accent` text, 3rem tall, 44 px minimum width, weight 650.
- **Secondary (outlined):** transparent with a `--ink-2` border.
- **Danger:** transparent with `--late` border and text.
- **Disabled:** 60 % opacity; a control that cannot act today stays focusable with `aria-disabled`.
- **Pill:** a 2rem capsule whose hit area is extended to 44 px; the one quick verb on a row.

### Row (`.row` in `.rows`)
The title and meta are one link to the object. A leading state control, then the body, then at most one trailing control. Row groups are `--r-group` cards.

### Check
A 24 px circle in a 44 px target, filled `--route` when done. The one shape for "done" on binary things.

### Segmented control (`.seg`)
Pills on `--surface-2`; `aria-current` when it navigates, `aria-pressed` when it chooses.

### Toast
A dark capsule above the bottom bar; with an Undo action it stays 12 s.

### Navigation
Bottom bar: four labelled tabs and a centre 56 px "+"; active tab in `--ink` with a dot. Current page via `aria-current="page"`.

### Icons
Authored inline SVG in `src/ui/icons.tsx`: 24 grid, 2 px stroke, round caps and joins, no fill, `aria-hidden`. No icon package, no icon font, never mix sets; new glyphs are copied from Lucide (ISC) with its notice. **Target:** three size tokens in `rem`, `--icon-s` 1rem (meta), `--icon-m` 1.25rem (rows, buttons, chips), `--icon-l` 1.5rem (navigation and "+"); they do not exist in `src/tokens.css` yet.

## The action system

**Target** system, applied module by module by later work: routine rows still carry Pause and Duplicate, Delete still sits beside Cancel on some forms and no More menu exists yet. These rules decide where an action lives; a change that breaks one needs a reason in its PR.

1. **The row is the object.** Tapping the title opens the detail. List screens show a trailing chevron; Home rows are for doing and have none.
2. **One shape for "done".** Binary things use the circular check. Counters show the numeral below target and a check at target.
3. **At most one trailing quick verb per row,** only while it applies, always a pill and never filled: "+1", "Take it", "Resume", "Open". Two buttons on a row is a bug.
4. **One filled button per screen region,** and it is that screen's job (a routine's "Step by step", "Add a book", a sheet's submit). Two filled buttons in view means one is wrong.
5. **Management verbs live on the detail screen behind one "More" menu:** Pause, Duplicate, Move, Import, Export, Reset count, Delete. Never on a list row, for anyone's routines. Pause lives in More on the routine detail, nowhere else. The detail header holds the filled primary, an outlined "Edit" and "More" (`aria-haspopup="menu"`, name "More actions for ‹title›"); a bottom sheet on phones, a popover on laptops; Delete last, in `--late`, after a divider.
6. **Icon only is allowed when all four hold:** the glyph is conventional (close, back chevron with its destination word, chevron, edit pencil beside a label, trash in an editor, call, WhatsApp, reorder, more, search inside its field, the centre "+"); it has an accessible name with verb and object; its target is at least 44 × 44 px with at least 8 px to the next target; it sits in a predictable place (trailing in rows, top right in sheets). Pause, duplicate, reset, start and undo never qualify: they carry words.
7. **Text buttons** are for verbs that start a flow or change meaningful state. A leading icon only when it speeds recognition, then on every sibling.
8. **Delete is rare and never beside Save or Cancel.** It acts at once, leaves the screen and shows "Deleted ‹title›" with Undo for 12 s. A confirmation question is used only where Undo is impossible (rotating or revoking the calendar feed link).
9. **No swipe, no long-press:** they are invisible and compete with Android's back gesture.

## Accessibility floor

- Every control is a real element with a name; ticks are checkboxes; sheets are `<dialog>`.
- Targets are at least `--target-min` (44 px) with no overlap; a smaller visual (pills, 24 px checks) extends its hit area.
- Navigation moves focus to the `h1`; Back restores place (**Target**).
- Reduced motion: no animation beyond colour changes, none at all under `prefers-reduced-motion`.
- Contrast is AA in both themes; state is never colour alone.
- Verify at 320 and 390 px, 100 and 200 % text, light and dark.

## Do's and Don'ts

### Do:
- **Do** use tokens (`--s*`, `--fs-*`, `--r-*`, `--target-min`) and `rem`; add a token before a second literal.
- **Do** keep typed work on every error and say the cause and the fix.
- **Do** let finished work fold away and stay one tap away (**Target**).
- **Do** show shared state and the partner's timetable, never the partner's private ticks or routines.

### Don't:
- **Don't** put Pause, Duplicate or Delete on a list row.
- **Don't** use red for a state that is nobody's error (paused, offline, done).
- **Don't** cap text with `vw`, hide the focus ring, or use the blue and pink tints for anything but a partner.
- **Don't** add streaks, scores, badges, confetti or per-row error text.
