# Whole-app UX research

Written 26 October 2026, against `main` at `01801e1`. Research only: no product code, PRODUCT.md, DESIGN.md, Cloudflare resource, deployment or database was changed while writing it.

> **Privacy.** This repo is public. The two users are **Partner A** and **Partner B**. Every screenshot named here was taken in a scratch copy on a local database with invented rows and deleted after the review. The two real phone screenshots the operator shared are called **OP-1** (Home, Today block) and **OP-2** (Routines list) and are described only by their interface.
>
> **Label.** **[verified]** = I read the code, or ran the probe described in [section 7](#7-appendix-how-the-review-was-done), on 26 October 2026. **[measured]** = a number from a probe against the scratch app. **[assumed]** = inference, or something that needs a real phone. Screenshot ids read `<width>-<text %>-<theme>-<state>`, for example `390-100-light-home` (390 px wide, 100 % text, light theme, Home).

## 1. Summary

Nestora is an Operate product used many times a day on two phones. Its foundation is sound: every control is a real element with a name, the only controls under 44 px are three kinds of small pill ("Open", "Take it", "Mark paid"), which extend their hit area, nothing overflows horizontally at 320 px, dark mode is complete, the detector finds no contrast problem in 28 rendered states, and the offline and sync states are calm and honest. What hurts is **shape, not polish**: the daily screen shows everything at once, finished work never looks finished, and the same job is done in different ways from module to module.

1. **Finished never looks finished** ([UX-01](#ux-01-a-finished-routine-never-looks-finished), [UX-03](#ux-03-counters-ignore-their-target), [UX-07](#ux-07-on-demand-routines-make-all-done-unreachable)). A routine with every item ticked keeps its full card and a large "Start" button (OP-1). Counters keep a filled "+1" at their target and count past it ("3 of 2"). On-demand routines count in "6 of 14", so the day never closes. **Do:** a finished routine collapses to one quiet row with a check and "Done"; tapping it shows the items again, and unticking is the undo; no Start on it; a counter at target shows a check, and "−1" replaces the reset glyph that sits 4 px from "+1"; on-demand routines stop counting.
2. **Home is a catalogue, not a glance** ([UX-02](#ux-02-home-is-a-catalogue-not-a-glance), [UX-06](#ux-06-back-loses-your-place)). With five routines Home is 2,827 px tall at 390 px and 8,158 px at 320 px with 200 % text; a late wedding task starts around y = 2,200, and every Back jumps to the top. **Do:** Today becomes one row per routine with the current one open (the layout `docs/routines.md` §8 already designed), a "Late" line above it, and Back restores the scroll position.
3. **Rows carry buttons that belong one level deeper** ([UX-04](#ux-04-routine-rows-carry-pause-and-duplicate), [UX-09](#ux-09-no-shared-action-system), [UX-12](#ux-12-the-routine-detail-toolbar-gives-four-actions-equal-weight)). Every Routines row has "Pause" and "Duplicate" text buttons (OP-2), on the partner's routines too. To the operator's question: not icons, and not nicer buttons either. **Do:** a row is one link plus its state; Duplicate, Pause and Delete live in a "More" menu on the detail screen; a row may carry at most one quiet next-step pill ("+1", "Take it", "Resume"). The full action system and the rule for icon-only buttons are in UX-09.
4. **One job, several patterns** ([UX-10](#ux-10-adding-is-split-six-ways), [UX-14](#ux-14-three-delete-patterns-and-delete-beside-cancel), [UX-15](#ux-15-detail-screens-mix-instant-controls-and-a-save-form)). Adding has six entry points and the centre "+" cannot add a routine, a movie or a series; deleting a task leaves you on a "deleted" form, deleting a book shows a toast; Back is at the top of some detail screens and the bottom of others. **Do:** "+" preselects the kind from the current tab and covers every kind; one delete pattern (leave, toast, Undo for 12 s); one detail frame (top back link, instant controls, details behind "Edit").
5. **Large text breaks the frame** ([UX-05](#ux-05-large-text-breaks-the-frame)). Bottom-bar labels are capped at 12.5 px whatever the phone's text size (WCAG 1.4.4); at 200 % the capture "Add" stacks its letters and "Routines" breaks as "Routine / s". **Do:** one CSS pass: `overflow-wrap: break-word`, no `vw` caps, a row rule that keeps the check beside its title.
6. **Start mode is good, offered in the wrong places** ([UX-08](#ux-08-start-mode-is-offered-where-it-does-not-help)). Start is a guided one-step-at-a-time screen with timers, a chime and a screen that stays on, and the only place a timer can run. It is offered for packing lists (the routines doc says not to), single-counter routines and finished ones, and its exit drops you on the routine detail instead of Home. **Do:** call it "Step by step", show it only when a routine has a timer or four or more open steps, and return to where it was opened.

Also: the paused state answers each tap with a red error ([UX-13](#ux-13-controls-look-live-when-they-cannot-act)); placeholder covers borrow the partner colours ([UX-16](#ux-16-placeholder-covers-borrow-the-partner-colours)); the app icon is a teal placeholder, and the product's own symbol (the two rings at the end of the route) should replace it ([UX-17](#ux-17-the-app-icon-is-a-placeholder)); the icon set needs a dozen glyphs and three size tokens ([UX-19](#ux-19-the-icon-set-is-consistent-in-stroke-not-in-size-or-meaning)). Fourteen PR-sized tasks are in [section 5](#5-proposed-tasks); five can start today.

## 2. Mode, jobs and principles

**Mode.** Every surface except the sign-in screens is Operate: scanability, consistency and the real usage scene (one hand, a bathroom or a doorway, two to ten seconds) outrank expression. The Marriage journey (countdown, route, the two rings) is the one place the product shows its own character, and it does so well; the daily screens should borrow its symbol, not its size.

**The one job of each screen**, and what must come first:

| Screen | One job | First on screen |
|---|---|---|
| Home | What do I do now, today | The current routine, anything late, the partner's current block |
| Marriage › Journey | How far to the akad, what is late | Countdown, then late and due-soon tasks |
| Marriage › Tasks | Tick and assign wedding tasks | Open tasks by phase |
| Marriage › Money | What is due, what is left | Due payments, then budget lines |
| Marriage › People | Who is invited or booked, how to reach them | The list, with status |
| Routines | Find, create and manage routines | The routine rows by owner and moment |
| Routine detail | One routine: steps, schedule, ticks, management | Steps with ticks; "Step by step" when it helps |
| Start mode | Do a routine hands-busy, one step at a time | The current step and its one action |
| Books | Where is it, what do we read next | Search, then reading now |
| Movies, Series | What do we watch tonight, what did we watch | Watching, then to watch |
| Settings | Names, photos, akad date, look, export, feed | The two of you |
| Sync | Why something did not save | The state in one sentence, the one fix |
| Sign-in, wrong account, connect | Get in | The one button |

**Principles recommended for Nestora.** Short on purpose; every task in section 5 is checked against them.

1. **Today is a to-do, not an archive.** Show what is left; finished things fold away and stay one tap away.
2. **One row, one job.** A row has one primary target (open it, or tick it) and at most one next-step pill. Everything else is one level deeper.
3. **Same job, same control, same word.** Add, edit, delete, back and undo look and read the same in every module.
4. **Thumbs and glances.** Daily actions live in rows and in the bottom bar; the header only carries status.
5. **Loud only when it needs you.** Red is for late and failed. Done, paused and offline are quiet.
6. **Text scales, the layout follows.** No pixel or viewport-capped labels; a 320 px phone at 200 % text is a supported phone.
7. **Two people, one truth, no surveillance.** Show shared state and the partner's timetable, never the partner's private ticks; partner changes arrive silently. (True today: keep it.)
8. **Undo over confirm.** Reversible actions act at once with Undo; only irreversible ones ask first.

## 3. Findings

Ranked by severity, then by how often the two partners meet them. Severity uses the impeccable scale: **P0** blocks a task, **P1** causes real difficulty or breaks WCAG AA, **P2** is an annoyance with a workaround, **P3** is polish. Effort: **S** under a day, **M** one PR of a few days, **L** several PRs. File references are to `main` at `01801e1`.

### Overview

| Id | Finding | Severity | How often | Effort |
|---|---|---|---|---|
| [UX-01](#ux-01-a-finished-routine-never-looks-finished) | A finished routine never looks finished; Start stays on it | P1 | Several times a day, both | M |
| [UX-02](#ux-02-home-is-a-catalogue-not-a-glance) | Home is a catalogue, not a glance | P1 | Every open of the app | M |
| [UX-03](#ux-03-counters-ignore-their-target) | Counters ignore their target; reset sits 4 px from "+1" | P1 | Daily | S |
| [UX-04](#ux-04-routine-rows-carry-pause-and-duplicate) | Routine rows carry Pause and Duplicate | P1 | Every visit to Routines | S |
| [UX-05](#ux-05-large-text-breaks-the-frame) | Large text breaks the frame | P1 (WCAG 1.4.4) | Always, on a large-text phone | S |
| [UX-06](#ux-06-back-loses-your-place) | Back loses your place | P2 | Many times a day | S |
| [UX-07](#ux-07-on-demand-routines-make-all-done-unreachable) | On-demand routines make "All done" unreachable | P2 | Daily | S |
| [UX-08](#ux-08-start-mode-is-offered-where-it-does-not-help) | Start mode is offered where it does not help and exits to the wrong place | P2 | Daily | S |
| [UX-09](#ux-09-no-shared-action-system) | No shared action system (the operator's audit of every control) | P2 | Everywhere | M, spread over tasks |
| [UX-10](#ux-10-adding-is-split-six-ways) | Adding is split six ways; "+" cannot add a routine, movie or series | P2 | Daily | M |
| [UX-11](#ux-11-list-headers-stack-nine-to-eleven-controls) | List headers stack nine to eleven controls before content | P2 | Every visit to Books and People | M |
| [UX-12](#ux-12-the-routine-detail-toolbar-gives-four-actions-equal-weight) | The routine detail toolbar gives four actions equal weight | P2 | Weekly | S |
| [UX-13](#ux-13-controls-look-live-when-they-cannot-act) | Controls look live when they cannot act (paused, "Not today") | P2 | Rare, alarming | S |
| [UX-14](#ux-14-three-delete-patterns-and-delete-beside-cancel) | Three delete patterns; Delete beside Cancel | P2 | Weekly | M |
| [UX-15](#ux-15-detail-screens-mix-instant-controls-and-a-save-form) | Detail screens mix instant controls and a Save form; Back moves around | P2 | Weekly | M |
| [UX-16](#ux-16-placeholder-covers-borrow-the-partner-colours) | Placeholder covers borrow the partner colours | P2 | Every Library visit | S |
| [UX-17](#ux-17-the-app-icon-is-a-placeholder) | The app icon is a placeholder off the palette; wordmark verdict | P2 | Every launch | S |
| [UX-18](#ux-18-the-installed-app-cannot-open-without-signal) | The installed app cannot open without signal | P2 | Whenever offline at launch | L (already planned) |
| [UX-19](#ux-19-the-icon-set-is-consistent-in-stroke-not-in-size-or-meaning) | The icon set is consistent in stroke, not in size or meaning | P3 | Everywhere | S |
| [UX-20](#ux-20-words-that-drifted) | Words that drifted | P3 | Often | S |
| [UX-21](#ux-21-four-option-segmented-controls-wrap-three-plus-one) | Four-option segmented controls wrap three plus one | P3 | Every form | S |
| [UX-22](#ux-22-first-run-has-no-first-step) | First run has no first step; empty states that mislead | P3 | Once per phone | S |
| [UX-23](#ux-23-smaller-findings) | Smaller findings (dashed inputs, strikethrough, laptop width, screen reader names, pause presets, tonight, help text) | P3 | Mixed | S each |

### UX-01 A finished routine never looks finished

- **Where:** Home, Today (`src/views/today.tsx:21`, `:49`, `:68-75`; `src/ui/routine-action.tsx`; `src/ui/ui.css:303-305` is the only done style, a grey title); routine detail (`src/views/routine.tsx:80-85`); Start mode end screen (`src/views/routine-start.tsx:174-189`).
- **Evidence:** OP-1: a routine at "3 of 3" keeps its three ticked rows and a full-width outlined "Start" under them; the operator asked why there is no Done and what Start is for. `390-100-light-home` and `390-100-light-routine-skincare`: the same for a finished three-step routine. `390-100-light-start-skincare-done`: Start on it opens a screen that only says "All done", "Everything on this list is ticked", "Back to the routine", plus a second "Back" in the footer. **[verified]** Start renders whenever `pagesOf(actions).length > 0`, with no progress check; the only "done" state in Today is the whole block collapsing when every routine is done, which UX-07 makes unreachable.
- **Breaks:** H1 visibility of system status; H8 aesthetic and minimalist design; principle 1.
- **Why it hurts two daily users:** the morning list is ticked in a hurry. Afterwards the finished card still fills a screen and offers its biggest button, so the eye re-reads every row to find what is left, and Home never gets shorter as the day goes on. The partner glancing later sees finished and open work at the same weight. The button invites a tap that leads nowhere.
- **Fix, the finished state:**
  ```
  open        Morning care · Morning         1 of 3   [ ▷ Step by step ]   (only if UX-08 allows)
              ┌──────────────────────────────────────────────┐
              │ ✓  Cleanse                                   │
              │ ○  Tone                                      │
              │ ○  Cream                                     │
              └──────────────────────────────────────────────┘

  finished    ┌──────────────────────────────────────────────┐
              │ (✓) Morning care                   Done   ⌄  │   one row, about 56 px, check in --route,
              └──────────────────────────────────────────────┘   title in --ink-2, no button below
  ```
  - At `done === total` the card collapses to that one row about 600 ms after the last tick (so the tick is seen) or when focus leaves it. Focus moves from the last checkbox to the collapsed row; a polite live region announces "Morning care done".
  - Tapping the row expands it; unticking an item is the undo and reopens the card. No toast: ticks are frequent and reversible in place, and `docs/routines.md` §8 rules out completion fanfare. The quiet "Done" is the reward.
  - On the next render (next open, or a day change), finished rows sit in a "Done today" group at the end of Today, collapsed. Never reorder while the user is looking.
  - No Start on a finished routine, on Today or on the detail screen; the detail meta reads "Done today".
  - Counters at target follow UX-03. The whole-day "All done" collapse stays, now reachable (UX-07) and with a visible chevron (today the `<summary>` marker is hidden with no replacement, `src/views/routines.css:108-121`).
- **Effort:** M (state, ordering, focus handling, tests).

### UX-02 Home is a catalogue, not a glance

- **Where:** `src/views/home.tsx:32-44`, `src/views/today.tsx`, `src/views/routines.css`.
- **Evidence:** **[measured]** Home with five routines today is 2,827 px tall at 390 px (3.6 screens) and 8,158 px at 320 px with 200 % text (12.5 screens of 651 px usable height); `390-100-light-home`, `320-200-light-home`. Every item of every routine is expanded, each with a full-width Start. The first late task starts around y = 2,200. `docs/routines.md` §8 designed Today as one row per routine with a progress mark and a chevron. The heading "Home" spends the first 60 px repeating the bottom bar. The partner's timetable ("‹Partner› today") sits below all of one's own routines (`390-100-light-b-home`).
- **Breaks:** H8; cognitive-load checklist: "single focus", "visual hierarchy" and "progressive disclosure" fail (with UX-11's choice counts, four failures: high load); principles 1 and 4.
- **Why it hurts:** the daily question is "what now?". The answer (the current routine, anything late, where the partner is) is either in the first viewport or not seen. With live sync on, the partner's ticks also re-render the long page silently, by design.
- **Fix:** Today becomes a list of routine rows (title, moment, "1 of 3" or "Done", chevron). The current routine (the first with open items whose moment matches the time of day; else the first open one) is expanded; any other row expands on tap. The timetable shows its current and next block only ("Now 09:30-12:00 Deep work · then Lunch"). A one-line "Late · 1" strip sits above Today when something is late and links to it. The page `h1` becomes "Today, Mon 26 Oct" (the "Home" word stays as the nav label and the document title). Together with UX-01 this brings Home at 390 px under two screens by midday.
- **Effort:** M, after UX-01 and UX-08.

### UX-03 Counters ignore their target

- **Where:** `src/ui/routine-action.tsx:88-90` (leading count), `:112-117` (+1 and reset); `src/views/routines.css:54-60` (4 px gap); `shared/routines.ts:112-116` (`mark`).
- **Evidence:** OP-1: "2 of 2 pcs" rows keep a filled "+1" and an active reset glyph. **[measured]** `mark()` on a counter at 2 of 2 returns 3, so one more tap shows "3 of 2 pcs" (node probe, appendix). Reset sits 4 px (`gap: var(--s1)`) from "+1", wipes the whole count and has no undo. The leading number repeats the "2 of 2" under the title. Three filled "+1" squares in one card are three primary buttons (`390-100-light-routine-vitamins`).
- **Breaks:** H5 error prevention (vitamins and supplements are a health record), H1 (target reached is not shown), H3 (no −1, only reset to zero), H8.
- **Why it hurts:** the operator's counters are pills and portions, where "done" matters more than the number. A one-thumb mis-tap either logs an extra dose or erases the count.
- **Fix:** below target, "+1" is a quiet pill (not filled) and reset becomes **"−1"** (undo the last tap) with at least 8 px between them; "Reset count" moves to the detail screen's More menu. At target, the leading slot shows a filled check instead of the numeral, the meta reads "2 of 2 pcs" in `--ink-2`, and "+1" leaves the Today row; the detail screen keeps a quiet "+1" for a deliberate extra, logged as "3 of 2" (open question 1). Keep the number in one place only.
- **Effort:** S.

### UX-04 Routine rows carry Pause and Duplicate

- **Where:** `src/views/routines.tsx:41-61`, `src/views/routines.css:54-70`.
- **Evidence:** OP-2: every row has two outlined text buttons, "Pause" and "Duplicate", taking about half the row; titles wrap to two lines. `390-100-light-routines`: the same on "Shared" and on the partner's routines. `320-200-light-routines`: the buttons stack under the title and rows grow to 400 to 500 px. Each row is three tab stops (keyboard probe). Pause also lives on the detail toolbar and as a field in the edit sheet (`src/ui/routine-sheet.tsx:314`): three homes for one verb.
- **Breaks:** H8, H4, H5 (large targets beside the row link invite mis-taps that open a Pause sheet), principle 2. On the partner's rows it also cuts against `docs/features.md` §1.3 ("show state, not behaviour; no one feels managed").
- **Why it hurts:** the list is visited to find or open a routine; pausing and duplicating happen a few times a month. Twenty identical buttons make the titles, the only thing being scanned, the hardest thing to read.
- **Fix:** the whole row is the link to the detail screen, with a trailing chevron. The status line shows one fact, by priority: "Paused until Sat 31 Oct" > "Done today" > "1 of 3 today" > "Next Sun 1 Nov"; "Only you" for private ones. A paused row may show one quiet "Resume" pill (its own next step). Nothing else on rows, for anyone's routines. Duplicate, Pause and Delete move to the detail screen's More menu (UX-12); "Paused until" leaves the edit sheet. This can ship before the menu exists: the detail toolbar already has both actions.
- **Effort:** S.

### UX-05 Large text breaks the frame

- **Where:** `src/style.css:28` (`body { overflow-wrap: anywhere }`: lets a flex child's minimum width shrink to one character), `:50` (`h1`, same), `:110` (brand `min(1.375rem, 9vw)`), `:202` (tab labels `min(var(--fs-micro), 3.6vw)`), `:235-236` ("+" `min(3.5rem, 16vw)`); `src/ui/ui.css:259` (`.row-b { flex: 1 1 9rem }`, 18 rem at 200 %); `src/views/books.css:250-251` (stars `3.4vw`); `src/ui/sheet.css:210-244` (capture row).
- **Evidence:** **[measured]** with a Chromium profile whose default font size is 32 px (root `rem` read back as 32): the capture "Add" renders as "A / d / d" and check circles sit on their own line above titles (`320-200-light-home`); the heading reads "Routine / s" (`320-200-light-routines`); tab labels stay 11.5 px at 320 px and 12.5 px at 390 px at any text size; the bottom bar is 129 px tall (16.5 % of a 780 px screen). What holds: no horizontal overflow in any of the 266 probed states (`scrollWidth == innerWidth`), and no control under 43.5 px except the "Open", "Take it" and "Mark paid" pills, which extend their hit area with `::after`, and one inline text link.
- **Breaks:** WCAG 1.4.4 Resize Text (AA) for nav labels, brand and stars; H8.
- **Why it hurts:** Android's font-size and display-size settings are the zoom people actually use; at 320 px and large text the daily screen is close to unusable.
- **Fix:** `overflow-wrap: break-word` on `body` and `h1` (wraps long words without collapsing min-content), plus `hyphens: auto`; drop the 125 % stretch on `h1` below a `rem` breakpoint. Remove every `vw` cap and keep `rem` sizes; if nav labels cannot fit, hide them and keep the accessible name rather than shrinking them. `.row-b { flex: 1 1 0; min-width: 12ch }` keeps the check beside its title. Size icons in `rem` (UX-19). If the capture row survives UX-10, stack its button under the input below about 18 rem.
- **Effort:** S (CSS only).

### UX-06 Back loses your place

- **Where:** `src/main.tsx:80-92` (`scrollTo(0, 0)` and `h1` focus on every route change that is not a split-view selection, Back included).
- **Evidence:** **[verified]** in code; Assessment A reproduced it: open a routine from the middle of Home, go back, and Home is at the top. On a 2,800 px Home that is two to three screens of thumb-scrolling per detour.
- **Breaks:** H3 user control, H7 efficiency; Casey (one-handed, interrupted) red flag.
- **Fix:** keep `scrollTo(0, 0)` and `h1` focus for forward navigation only. On Back (the hash returns to the previous entry), restore the stored scroll position for that route and focus the row link that was opened, the same way the split view already restores focus to the selected row (`main.tsx:84-87`).
- **Effort:** S.

### UX-07 On-demand routines make "All done" unreachable

- **Where:** `src/domain/routines.ts:45-58` (`todayBlocks`, `allDone`, `tally`), `src/views/today.tsx:49`.
- **Evidence:** OP-1 ("Today 6 of 14" with "Before going out · On demand · 0 of 2" in it) and `390-100-light-home` ("5 of 16"). **[verified]** `tally` and `allDone` sum every scheduled block, whatever its moment.
- **Breaks:** H2 (on demand means "if needed"), H1.
- **Why it hurts:** on a day at home the count never closes and the collapsed "All done" state the code already has never appears: the list nags by arithmetic, which `docs/features.md` §8.1 rules out.
- **Fix:** exclude `on_demand` routines from `tally` and `allDone`. Show them in a collapsed "When needed" group at the end of Today with their own count. A finished on-demand routine offers "Start over" in its expanded row (clears today's ticks): repeating it is the point, so "Do again" belongs here and nowhere else.
- **Effort:** S.

### UX-08 Start mode is offered where it does not help

- **What Start mode is** **[verified]** (`src/views/routine-start.tsx`, `src/ui/start-page.tsx`, `docs/routines.md` §8): a full-screen guided run of one routine. One action per screen in large type, "Next: …" underneath, position "2 of 4" with dots, a countdown for timer steps that survives a reload, the Screen Wake Lock ("Screen stays on"), a chime and vibration at zero, Back and Skip in the thumb zone, a 300 ms guard against double taps on page change, and screen-reader announcements of each step. It is also **the only place a timer step can run**: on Home and on the detail screen a timer is just the text "5 min". It earns its place for hands-busy or timed sequences: a workout, skincare with a mask that sits for ten minutes, a cooking order.
- **Where it is offered today:** for any routine with a non-block action (`src/domain/routine-start.ts:7-16`, `src/views/today.tsx:68`, `src/views/routine.tsx:80`). That includes packing lists, which `docs/routines.md` §2.2 says get "no Start mode" (`390-100-light-home`, "Office bag": Start turns four ticks into one bigger "Items" page), single-counter routines (`390-100-light-b-home`, "Iron supplement"), and finished routines (UX-01). Exit (× or Escape) always replaces the route with the routine detail (`src/views/routine-start.tsx:64`), so finishing a morning routine started from Home strands the user one level deep. The end screen has "Back to the routine" and a footer "Back"; the last page says "Last one" next to a "Next" button.
- **Breaks:** H2 (the label "Start" does not say what it starts; the operator had to ask), H3 (exit goes somewhere unexpected), H8.
- **Fix:**
  - **Rule:** offer it only when at least one step is still open today **and** the routine has a timer step **or** four or more open steps that are not items or counters. Never for a paused routine. One function beside `pagesOf`.
  - **Label:** "Step by step" with the play icon (accessible name "Step by step: ‹routine›"); "Continue" when some steps are already ticked (Start already resumes at the first open step).
  - **Place:** a compact 44 px button in the routine's header row on Today (no full-width button under any card); the filled primary on the detail screen.
  - **Ending:** the last page's primary reads "Finish"; the end screen keeps "All done" with one primary, "Close", which returns to where Start was opened (`history.back()` when the previous entry is in the app, else the detail) and focuses that routine's row, now collapsed as done. No footer "Back" on the end screen.
- **Effort:** S.

### UX-09 No shared action system

The operator asked whether Pause and Duplicate could be icons, or something better, and to audit every control. The answer is neither icons nor nicer buttons on rows: those verbs belong one level deeper. The inventory first, then the system.

**Inventory** **[verified]** in code and in the `390-100-light-*` and `1280-100-light-*` captures. About 17 visual patterns serve about six intents (open, complete, add, quick verb, manage, destroy):

| Pattern | Look | Where it is used | What is off |
|---|---|---|---|
| Filled button | navy fill, 48 px, 10 px radius (`src/ui/ui.css:81-95`) | capture "Add", quick-add "Add", every counter "+1", "New routine", detail Start, "We got it" on every wish, "Add a book / movie / series", "Create link", "Sync now", sheet footers, Start mode's main button (72 px) | Four to six filled buttons in one Home viewport, so nothing reads as primary |
| Outlined button | ink-2 border (`ui.css:102-107`) | Home Start (full width), row Pause / Resume / Duplicate, detail Edit / Duplicate / Pause, "New timetable", "Places", "Import a list", "Another copy", "Lost it, buy again", "Cancel", "Sign out", Start's Back and Skip, the seven add-step kinds | Used for the daily action (Start) and the rare one (Duplicate) alike |
| Danger outline | red border and text | Delete (task, book, movie), "Delete routine", "Revoke link" | Sits beside Cancel (UX-14) |
| Pill | 32 px capsule, hit area extended with `::after` (`ui.css:361-379`) | "Take it", "Mark paid" / "Undo", "Open" (underlined because `a.pill` lacks `text-decoration: none`), place chooser | Good pattern; the right home for a row's one quick verb |
| Icon button `.ib` | 44 px square on `--surface-2` (`ui.css:753-773`) | counter reset, sheet and Start close, call, WhatsApp, pencil in settings rows and copies, up / down / trash in editors | Reset is the one that fails (reads as refresh, 4 px from "+1") |
| Circular check | 24 px circle in a 44 px label (`ui.css:381-420`) | tasks, routine steps, packing items | Disabled ("Not today") looks identical to live (UX-13) |
| Row link | title and meta are one `<a>` (`ui.css:257-264`), no chevron | tasks, payments, routines, people, books, movies | Nothing says it opens; a chevron on list screens would |
| Trail link | underlined text | "All routines", "All books", "‹ Routines" back, "Back" at the bottom of tasks, "Sync details" | Back is top here, bottom there (UX-15) |
| Segmented control | pills on `--surface-2`, both navigation (`aria-current`) and choice (`aria-pressed`) (`ui.css:577-616`) | Shelf / Wishlist, Guests / Vendors, owner filters, status, owner, theme, Hijri | Four options wrap three plus one (UX-21) |
| Underline tabs | `space-tabs` | Journey / Tasks / Money / People; Books / Movies / Series | Above the `h1` in Library, below it in Marriage |
| Chips, toggle tiles | 44 px capsules, dashed when empty | Add sheet details and kinds, routine day chips | Fine |
| Disclosure | `<details>` | Today (no marker), shelf sections, stages, step "More" | Today's has no chevron |
| FAB | 56 px navy circle "+" | centre of the bottom bar | Cannot add every kind (UX-10) |
| Toast with action | dark capsule above the bar, 12 s with Undo | deletes, moves, imports, "We got it" | The pattern to spread (UX-14) |
| Swipe, long-press | none | | Keep it that way |

The same intent, "mark this done", has four looks: a check circle (task, step), a "Mark paid" pill (payment), a filled "We got it" (wish) and a filled "+1" (counter).

**The system to adopt** (it becomes the action section of DESIGN.md, task T1):

1. **The row is the object.** Tapping its title opens the detail. On list screens (Routines, Tasks, People, Library) a trailing `›` says so; Home rows are for doing and carry no chevron.
2. **One leading state control, one shape for "done".** Binary things (task, step, item, payment, wish) use the circular check: "Mark paid" becomes the payment's leading check (amount stays in the meta), "We got it" becomes the wish's leading check with its existing Undo toast. Counters show the numeral below target and the check at target.
3. **At most one trailing quick verb per row,** only while it applies, always a quiet pill, never filled: "+1" (counter below target), "Take it" (unowned task), "Resume" (paused routine), "Open" (step with a link). Two buttons on one row is a bug.
4. **One filled primary per screen region,** and it is that screen's job: "Step by step" on a routine with open steps, "Add a book", a sheet's submit. Secondary actions are outlined. If two filled buttons are in view, one is wrong.
5. **Management verbs live on the detail screen, behind one More menu.** Pause, Duplicate, Move, Import, Export, Reset count and Delete never sit on list rows. The detail header carries `[Step by step]` (filled, when allowed), `[✎ Edit]` (outlined) and `[⋯ More]` (`aria-haspopup="menu"`, accessible name "More actions for ‹title›"). On a phone the menu is a bottom sheet built on the existing `Modal`; on a laptop a popover. Items are icon plus text; Delete is last, in `--late`, after a divider. One home per verb.
6. **Icon only is acceptable when all four hold:** the glyph is in the app's conventional set (close, back chevron with its destination word, chevron, edit pencil beside a visible label, trash in an editor, call, WhatsApp, reorder up and down, more, search inside its field, the centre "+"); it has an accessible name with verb and object ("Delete Living room shelf", already done well); its target is at least 44 × 44 px with at least 8 px to the next target; and it sits in a predictable position (trailing in rows, top right in sheets), with a `title` tooltip on pointer devices. Pause, duplicate, reset, start and undo fail the first test (a media "pause" reads as "stop the timer", "copy" collides with "Copy link"), so they always carry words.
7. **Text buttons** are for verbs that start a flow or change meaningful state (Step by step, Save, Add task, Pause routine, Sign out). Add a leading icon only when it speeds recognition, and then on every sibling in the group.
8. **Destructive and rare.** Delete is never in a row and never beside Save or Cancel. It acts at once, leaves the screen and shows "Deleted ‹title›" with Undo for 12 s. A confirmation question is used only where Undo is impossible: rotating or revoking the calendar feed link (already so).
9. **No swipe, no long-press.** They are invisible, compete with Android's back gesture and vertical scroll, and would each need a visible twin anyway.

**Concretely, the Routines list:**
```
Morning
┌───────────────────────────────────────────┐
│ Morning care                           ›  │
│ Every day · ✓ Done today                  │
├───────────────────────────────────────────┤
│ Supplements                            ›  │
│ Every day · 1 of 3 today                  │
├───────────────────────────────────────────┤
│ Night reading                 ( Resume )  │   the only row with a verb
│ Paused until Sat, 31 Oct                  │
└───────────────────────────────────────────┘
```
**And a Today card:** see UX-01 (header row with the optional compact "Step by step", item rows with a leading check and at most one pill, nothing below the card).

- **Breaks today:** H4 consistency, cognitive-load "inconsistent pattern".
- **Effort:** M overall, delivered through T1, T5, T6, T9, T10 and T11.

### UX-10 Adding is split six ways

- **Where:** `src/ui/add-sheet.tsx:28` (kinds), `src/ui/capture.tsx`, `src/ui/quick-add.tsx`, `src/views/books.tsx`, `src/views/screens.tsx`, `src/views/routines.tsx:86-95`, `src/views/places.tsx`.
- **Evidence:** six entry points: the centre "+" (task, budget line, payment, guest, vendor, book), the Home capture row (opens the same sheet with the typed text), inline quick-add rows on Tasks, Money, People and Places, "Add a book" / "Add a wish", "Add a movie" / "Add a series", "New routine" / "New timetable". On the Routines tab the big "+" cannot make a routine; on Movies it can add a book but not a movie (`390-100-light-add-sheet`). Adding a movie from Home is Library, Movies, "Add a movie". The capture row and "+" do the same thing 600 px apart; OP-1 shows the capture row half under the sticky header after a small scroll, which is a scroll position, not a layering bug (at the top it is fully visible, `390-100-light-home`).
- **Breaks:** H4, H7 (the fast path depends on where you are), principle 3.
- **Fix:** the centre "+" becomes the one universal entry. It **preselects the kind from the current section** (Routines → Routine, Movies → Movie) and gains Routine, Movie and Series chips; picking one hands the typed text to that kind's existing sheet (the TMDB lookup for movies and series, the routine sheet with the name filled). Inline quick-add rows stay on list screens (typing in context is fast) but become solid inputs. The Home capture row goes (open question 3), which gives Today its top slot back. The per-screen "Add a …" buttons can then become outlined or go.
- **Effort:** M. Waits for PR #58 (`src/ui/shell.tsx`, `src/ui/screen-sheet.tsx`).

### UX-11 List headers stack nine to eleven controls

- **Where:** `src/views/books.tsx:47-79`, `src/views/people.tsx:110-133`.
- **Evidence:** `390-100-light-books`: Library tabs (3), Books `h1`, Shelf / Wishlist (2), "Add a book", "Places", "Import a list", search: the first book starts at y ≈ 480 of 780. `390-100-light-guests`: Marriage tabs (4), Guests / Vendors (2), quick-add input, side select, "Add", Everyone / A / B filter (3): the first guest at y ≈ 510. Settings › Your data is a flat list of eleven export links.
- **Breaks:** H8; cognitive load "minimal choices" (more than four options at one decision point).
- **Fix:** Books: keep "Add a book" (or rely on "+" after UX-10); move Places and Import into the More menu on the Shelf / Wishlist row. Guests: the owner filter moves into the section header ("Family · 13 people · Everyone ▾"); the side select folds into the Add sheet's "Which side?". Exports: "Everything (JSON)" plus one "Export a list" disclosure.
- **Effort:** M.

### UX-12 The routine detail toolbar gives four actions equal weight

- **Where:** `src/views/routine.tsx:79-102`, `src/views/routines.css:8-12`.
- **Evidence:** `390-100-light-routine-vitamins`, `390-100-light-routine-skincare`: "Start", "Edit", "Duplicate" on one line and "Pause" alone on a second full-width line; Start shows on a finished routine; Start and Edit have icons, Duplicate and Pause do not. On a laptop, rows shift when "Resume" replaces "Pause" (different widths).
- **Breaks:** H8, H4, principle 2.
- **Fix:** the header pattern of UX-09 rule 5: "Step by step" (filled, only when UX-08's rule allows), "Edit" (outlined), "More" (Duplicate, Pause or Resume, Reset counts, Delete). Toolbar items `flex: 0 1 auto` so nothing is orphaned.
- **Effort:** S, with T5's menu.

### UX-13 Controls look live when they cannot act

- **Where:** `src/ui/failure.ts`, `src/ui/routine-action.tsx` (error under the row), `src/ui/sync-badge.tsx`, `src/domain/status.ts`, `src/ui/shell.tsx:61-65`, `src/ui/ui.css:390-419` (`.check input` has no `:disabled` style).
- **Evidence:** `390-100-light-state-paused-home`, `390-100-light-state-paused-tick`: after a known phone reloads without reaching the server, the banner says "Sign-in not confirmed yet. Changes are paused." while the badge says "Offline"; every checkbox and "+1" stays enabled; a tap prints the same sentence in red under the row it touched. Steps marked "Not today" are disabled but drawn like live ones.
- **Breaks:** H1 (two names for one state), H5, principle 5 (red for a state that is nobody's error).
- **Fix:** while paused, write controls get `aria-disabled="true"` and a muted style but stay focusable; a tap focuses the single banner instead of printing per-row errors; the badge reads "Paused" and links to Sync. Disabled checks get a dashed ring at reduced opacity. The rule itself (read-only until the sign-in is confirmed) stays: it is what keeps typed work from being lost.
- **Effort:** S. Waits for PR #57 (store).

### UX-14 Three delete patterns, and Delete beside Cancel

- **Where:** `src/ui/item-form.tsx:169-184`, `src/views/generic-item.tsx` (task, payment, guest, vendor); `src/ui/book-flows.ts`, `src/ui/routine-flows.ts:52`, `src/ui/screen-save.ts` (books, copies, places, routines, movies, series); `src/views/book.tsx:122` (lost it).
- **Evidence:** deleting a task, payment, guest or vendor keeps the user on a form that now reads "This item was deleted. What you typed is still here." with an inline Undo; deleting a book, copy, place, routine, movie or series leaves the screen and shows a toast with Undo for 12 s; "Lost it" and the feed link ask inline first. `390-100-light-task-detail`, `390-100-light-movie-detail`: "Save", "Cancel" and "Delete" in one row, Delete the size of Cancel.
- **Breaks:** H4, H5 (a mis-tap at the wrong end deletes), H3.
- **Fix:** one pattern, the toast one (UX-09 rule 8). Delete moves to the More menu or to the end of the edit sheet, alone, after a divider. Keep the inline question only for the feed link.
- **Effort:** M. The screens family waits for PR #60 (`src/views/screen.tsx`).

### UX-15 Detail screens mix instant controls and a Save form

- **Where:** `src/views/screen.tsx`, `src/views/book.tsx`, `src/views/generic-item.tsx:44-46`, `src/views/person.tsx`, `src/views/money-line.tsx`.
- **Evidence:** `390-100-light-movie-detail`: Status and Ratings save on tap; below them "Edit details" is a form with Save, Cancel and Delete, with no boundary saying which part is saved already. `390-100-light-book-detail`: every field always open. `390-100-light-task-detail`: the detail screen is the edit form; its `h1` repeats the Name field and the only Back link is at the very bottom. Routine, book, movie and series details put "‹ Routines" or "‹ Movies" at the top.
- **Breaks:** H4, H6 (is this saved yet?), cognitive-load "progressive disclosure", principle 3.
- **Fix:** one frame for every detail: a top back link with the destination word, the title, the instant controls (status, owner, rating, place, tick), then the details read-only with "Edit" opening the item's sheet (as routines already do), and More for the rare verbs. Tasks, payments, guests and vendors get a read view.
- **Effort:** M per family; the screens family waits for PRs #58 and #60.

### UX-16 Placeholder covers borrow the partner colours

- **Where:** `src/domain/cover.ts:1-6` (tone from a hash of the id), `src/views/books.css:156-183` (`--tint-a`, `--tint-b`).
- **Evidence:** `390-100-light-movies`, `390-100-light-books`, `390-100-light-wishlist`: blue and pink initials tiles next to blue and pink avatars. Everywhere else blue means Partner A and pink means Partner B.
- **Breaks:** H4, H2: a pink tile reads as "Partner B's pick" when it is chance.
- **Fix:** neutral tiles (`--surface-2` with `--ink-2` initials), or tint by the row's real `who` and neutral when it is both or unset.
- **Effort:** S.

### UX-17 The app icon is a placeholder

- **Where:** `public/icon-192.png`, `public/icon-512.png`, `public/apple-touch-icon.png`, `public/manifest.webmanifest`, `index.html`.
- **Evidence:** **[verified]** the icon is a teal square with a smaller white square, a colour the palette never uses (navy `--hero`, rose `--signal`); the manifest has no `maskable` or `monochrome` purpose, so Android shrinks it onto a white plate and themed icons cannot use it.
- **Breaks:** H4 with the rest of the product; it is the first thing both partners touch every day.
- **Fix, direction:** use the product's own symbol, which today appears only on Marriage and the sign-in screen: the two linked rings at the end of the route (`src/views/journey.css:195-228`, `src/views/entry.tsx:28-34`). White rings on a full-bleed navy `--hero` (the manifest's `theme_color` already), one small rose `--signal` dot on a short route stroke entering from the left ("you are here"); at 48 dp drop the route, keep rings and dot; ring stroke at least 8 % of the width. Files: `icon-192.png` and `icon-512.png` (`any`), `icon-maskable-512.png` with the mark inside the central 80 % (ideally 60 %), `icon-monochrome-512.png` (white on transparent, `monochrome`, for Android 13 themed icons), an opaque 180 px `apple-touch-icon.png`, and `favicon.svg`. Keep `background_color` light (`#f5f7fb`), since the app opens on a light screen.
- **Wordmark:** "Nestora" in Mona Sans 800 at 125 % width (`src/style.css:103-114`) is legible and fine for an Operate header: keep it, drop its `9vw` cap (UX-05), keep it out of the icon (unreadable at 48 px), and do not turn its "o" into rings. The detector flags Mona Sans as an overused face; at 125 % width and 800 weight it reads distinct, and changing it would be a redesign, not a fix.
- **Effort:** S, plus one round of operator feedback on the drawing.

### UX-18 The installed app cannot open without signal

- **Where:** no service worker (`docs/features.md` and `docs/infra.md` §5.7 already record it as not built).
- **Evidence:** **[verified]** no `serviceWorker` registration in `src/`; the data is offline-first (IndexedDB and an outbox) but the page itself is fetched on each launch. **[measured]** the shell is one 524 kB JavaScript chunk (163 kB gzip) plus 133 kB of fonts. **[assumed]** on a phone with no signal an installed launch shows the browser's offline page unless the HTTP cache still holds every file.
- **Why it hurts:** "open the bag checklist in the lift" is exactly the offline moment the rest of the design was built for.
- **Fix:** the planned shell service worker (precache the built assets, network only for `/api`). Outside this UX split; listed so it is weighed against it.
- **Effort:** L (planned).

### UX-19 The icon set is consistent in stroke, not in size or meaning

- **Where:** `src/ui/icons.tsx` (33 authored icons: 24 grid, 2 px stroke, round caps and joins, no fill, `aria-hidden`).
- **Evidence:** **[verified]** the drawing grammar is one family, the same as Lucide and Tabler. Rendered sizes are not: eleven different sizes from 0.875 rem (capped by `3.4vw`) to 2.25 rem, and strokes bumped ad hoc (2.2 in meta, 2.4 for the active tab and "+", 3 for checks); at 0.9375 rem a 2 px stroke renders about 1.25 px, so meta icons look thinner than button icons. Meaning collisions: the house is both Home and Places; play is both Start and "To watch"; the back chevron is the icon of "Lost it, buy again"; download means both Export and Import; receipt is the payment kind and the amount chip; the reset arc reads as refresh or sync (OP-1). Missing: more (⋯), pause, copy, minus, undo, chevron right, external link (the step's "Open"), timer, map pin or shelf (Places), upload (Import), bookmark (To watch). Outside the set: "+1" is a text label (right), CSS-drawn chevrons on `<summary>` while `icons.tsx` has `up` and `down`, CSS status dots and rings (`ui.css:702-742`, a coherent mini-system: keep).
- **Fix:** keep authored SVG: 33 icons in one file, no dependency, no font or sprite to fetch, works offline. Add the dozen missing glyphs by copying Lucide paths (ISC licence, the same 24 / 2 px grammar) with Lucide's ISC notice in the licence notes; do not add a package for a dozen glyphs (if one is ever wanted, `lucide-react` tree-shakes; Tabler, MIT, is the alternative; avoid icon fonts such as Material Symbols, a large file to cache and a different grammar; never mix sets). Three size tokens in `rem`: `--icon-s: 1rem` (stroke 2.25, meta), `--icon-m: 1.25rem` (stroke 2, rows, buttons, chips), `--icon-l: 1.5rem` (stroke 1.85, nav and "+"); checks keep 3. Resolve each collision above (map pin for Places, bookmark for "To watch", upload for Import, minus for −1).
- **Effort:** S.

### UX-20 Words that drifted

- **Where:** `src/ui/text.ts`.
- **Evidence:** "This plan is private", "cannot open this plan", "has not loaded your plan yet" (`text.ts:422`, `:428`, `:956`): Nestora is a household app now. "Undo" is both the toast action and "mark this payment unpaid" (`:53`). Edit is "Edit", "Edit details", "Details" and "Edit the line" in four modules. "Start" (UX-08). "New routine" and "New timetable" beside "Add a book" and "Add a movie". "Timetable" offered as a "When" beside Morning and Evening, although it has its own button. Builder words in the step editor ("Day label", "Time block"). The avatar fallback initials "Yo" and "Pa" (`390-100-light-empty-home`).
- **Breaks:** H2, H4.
- **Fix:** one words pass: "This is private to the two of you"; "Mark unpaid"; "Edit" everywhere (object in the accessible name); "Step by step"; "Add" for records and "New" only for the two things you configure (routine, timetable); hide "Timetable" from "When" in a sheet opened by "New routine"; a person glyph instead of "Yo" and "Pa" until a nickname exists.
- **Effort:** S, after PRs #57, #58 and #60, which all touch `text.ts`.

### UX-21 Four-option segmented controls wrap three plus one

- **Where:** `src/ui/ui.css:134-141` (`auto-fit, minmax(5.5rem, 1fr)`).
- **Evidence:** `390-100-light-task-detail`, `390-100-light-movie-detail`, `390-100-light-add-sheet` (owner: "Both" or "Nobody yet" alone on line two), `390-100-light-routine-new`, `390-100-light-routine-edit` ("Timetable", "Every 4 weeks" alone).
- **Fix:** four options: two columns below 26 rem, four above; three options: three columns; a longer list becomes a select.
- **Effort:** S.

### UX-22 First run has no first step

- **Where:** `src/views/home.tsx`, `src/views/today.tsx:35-43`, `src/ui/avatar.tsx`, `src/views/money.tsx:162-171`, `src/views/connect.tsx`.
- **Evidence:** `390-100-light-empty-home`: an empty phone shows "Home", the capture row, "No routines yet. Create a routine" and "Nothing is due in the next 7 days"; the photos read "Yo" and "Pa"; nothing suggests the nicknames, photos and akad date that every other screen depends on (the Marriage hero's "Set the akad date" link is the one good cue). `390-100-light-empty-money`: "To pay 0 / Nothing left to pay." before any budget line exists. `390-100-light-state-connect`: the connect screen drops the brand treatment the sign-in and wrong-account screens have.
- **Fix:** a one-time card at the top of Home until nicknames and the akad date are set ("Set your names and photos", "Set the akad date", each a link to its Settings row); it disappears when both are done; no tour. Empty Today offers one starter ("Add a morning routine") in line with the templates principle of `docs/features.md`. Hide "To pay" until a line exists. Give the connect screen the entry layout.
- **Effort:** S.

### UX-23 Smaller findings

- **Dashed inputs.** The capture row, search fields and quick-add inputs have a 1.5 px dashed border (`src/ui/sheet.css:217`, `src/ui/ui.css:210-218`); dashed means "add" on Home and Tasks but "search" on Books and Movies, and reads as an empty slot. Solid, like every other input. P3, S.
- **Strikethrough on the partner's past blocks.** "‹Partner› today" strikes through finished timetable blocks (`src/views/routines.css:243-250`, `390-100-light-b-home`); strikethrough reads as cancelled and is not announced. Dim them, keep the existing "Finished" text, fold them under "Earlier"; add a "Free now" line between blocks. P3, S.
- **Laptop width.** At 1280 px Home and Routines are one 530 px column with half the screen empty, and Routines has no list-and-detail split although People and Money do (`1280-100-light-home`, `1280-100-light-routines`). Use the existing `Split` for Routines; give Home a second column for "Due soon" and "Next up". P3, M.
- **Screen reader paths.** **[verified]** with a keyboard probe on Home: 22 Tab stops reach only the third routine (each counter is two stops); a tick's visually hidden name is read twice in browse mode ("Mark Cleanse as done", then the text "Mark Cleanse as done Cleanse"); each Today `h3` reads "Morning care Morning 3 of 3" because the moment and progress sit inside the heading; routine row links read "Mo Tu We Th Fr" as words; "+1"'s name "Add one: Fish oil" does not contain its visible label (WCAG 2.5.3). Use `aria-labelledby` on the title, move progress out of the heading, give day names in full to assistive tech, name the button "+1 Fish oil". P3, S.
- **Pause sheet.** Only a date field (`390-100-light-routine-pause`); the common cases are "for a week" and "until I resume". Presets: Tomorrow, One week, Two weeks, Pick a date. P3, S.
- **Tonight.** "To watch" rows show title and year only (`390-100-light-movies`); the "what do we watch tonight" decision also needs whose pick it is and, for a franchise, the order. Show the picker's photo now; collection order waits for the collections work the operator asked for. P3, S.
- **Help text measure.** Detector: `.hint` paragraphs run about 101 characters per line in Settings at 1280 px (`src/ui/ui.css:25-29`, `src/views/settings.css:1-3`) and leave a one-word last line at 390 px; the calendar-feed help is about 400 px of always-open text. Cap `.hint` at `65ch`, add `text-wrap: pretty` (the house pattern), fold the Google and Apple steps into `<details>`. P3, S.
- **Owner default drift.** The Add sheet defaults "Who does it?" to the person adding (`src/ui/add-sheet.tsx:102`), while `docs/features.md` §1.3 principle 3 says new items start unassigned. One of them should change (open question 11). P3, S.
- **Lately and Due soon placement.** "Lately" (on Marriage) lists the partner's movie and book additions beside wedding payments; "Due soon and late" renders on both Home and Marriage. Scope Lately to Marriage kinds. P3, S.
- **Native file input** on Import books is unstyled (`390-100-light-book-import`). P3, S.

## 4. Quick wins, structural changes, and what not to change

**Quick wins.** Each is S, low risk, and needs no other task first (except where noted):

| Win | Finding | Why it is quick |
|---|---|---|
| Remove Pause and Duplicate from routine rows; show the status line and a Resume pill | UX-04 | The detail screen already has both actions |
| Stop counting on-demand routines in the Today tally | UX-07 | One filter in `todayBlocks` callers |
| Hide Start on finished, items-only, counter-only and paused routines; exit to where it was opened | UX-08 | One rule beside `pagesOf`, one exit change |
| Counter at target: check instead of numeral; "−1" instead of reset, 8 px apart | UX-03 | View and CSS |
| `overflow-wrap: break-word`, no `vw` caps, `.row-b` flex rule, 2 × 2 segmented controls | UX-05, UX-21 | CSS only |
| Restore scroll and focus on Back | UX-06 | One effect in `main.tsx` |
| Neutral cover tiles | UX-16 | One function |
| `.hint` measure and `text-wrap: pretty`; dim, not strike, the partner's past blocks; solid inputs | UX-23 | CSS only |
| New icon files once the drawing is approved | UX-17 | Assets and manifest |

**Structural changes.** Each changes how a screen is organised and needs its own review:

- **Today as a list of routine rows** with a finished state and the current routine open (UX-01, UX-02).
- **The action system** applied module by module: a More menu, one detail frame, one delete pattern, quieter list headers (UX-09, UX-11, UX-12, UX-14, UX-15).
- **One Add**: a context-aware centre "+" that covers every kind, and the Home capture row gone (UX-10).
- **The shell service worker**, so the installed app opens without signal (UX-18; planned in `docs/infra.md` §5.7).

**What not to change**, and why:

- **Start mode's mechanics.** One step per screen, 72 px primaries, Back and Skip in the thumb zone, timers counted from a stored end time, the wake lock with an honest "Screen stays on", a chime unlocked by touch, the 300 ms settle guard, step announcements. Only its entry rule, its label and its ending change.
- **The journey system.** Countdown, route spine, "You are here", the two rings, carried from Marriage to the sign-in screen in two colours. It is the product's most specific design; spread its symbol (icon, done check), do not redesign it.
- **Capture parsing in the Add sheet.** One line with read-back chips, kept drafts, Undo. UX-10 moves the entry point, not the sheet.
- **The live-sync and privacy rules.** Partner changes arrive silently with no toast (a toast would push out the 12 s Undo); the badge is invisible when synced; changes are read-only until the sign-in is confirmed (UX-13 changes only how that looks); per-person ticks; the partner's timetable but never their private routines on Home.
- **The 12 s Undo toast.** It is the delete and move pattern to spread, not to replace.
- **Tokens and dark mode.** The detector found no contrast or tiny-text problem in 28 rendered states, light and dark, and a planted canary proved those rules were live. Off-scale literal spacing is a handful of hairlines.
- **Real controls and focus.** Ticks are real checkboxes, sheets are `<dialog>`, the 2.5 px focus ring is visible everywhere, navigation focuses the `h1`, icon buttons carry verb-plus-object names. Targets are 44 px everywhere except three pills that extend their hit area.
- **Error copy.** Messages name the cause and the fix ("Free some space or allow site data, then try again") and keep what was typed.
- **The bottom bar's 4 + 1 layout and the wordmark.** Good reach, clear labels (once they scale), a distinct but quiet header.
- **Fonts.** The detector lists Mona Sans as an overused face; at 125 % width and weight 800 it reads distinct, and replacing it would be a redesign the operator has not asked for.

## 5. Proposed tasks

Fourteen PR-sized tasks in recommended order, plus one already-planned piece outside this split. "Measure" means: at 320 and 390 px, at 100 % and 200 % text (a Chromium profile with `webkit.webprefs.default_font_size: 32`, root `rem` read back as 32), light and dark, with the scratch layout probe (`scrollWidth == innerWidth`, no visible control under 44 px).

Blocker classes, as used below: **data loss**, **wrong-side writes**, **lost update**, **focus loss**, **runaway requests**, **a11y regression**, **layout regression**.

Open PRs on the same screens, as of `01801e1`: **#57** live sync polling (`src/store/*`, `src/ui/text.ts`), **#58** Movies and Series expiry and Find posters (`src/ui/shell.tsx`, `src/ui/screen-sheet.tsx`, `src/views/screens.tsx`, `src/views/books.css`, `src/ui/text.ts`), **#60** editable watched date (`src/views/screen.tsx`, `src/views/books.css`, `src/ui/text.ts`). The collections work for movies (chronological and collection order) has no branch yet. Every open PR touches `src/ui/text.ts`: tasks that change copy rebase after them.

### T1. PRODUCT.md and DESIGN.md

- **Goal:** write down section 2's principles, the action system (UX-09) and the icon rules (UX-19) as the reference every later PR is reviewed against. Run impeccable's `init` and `document` with the operator, so the launcher stops reporting "no PRODUCT.md".
- **Files:** `PRODUCT.md`, `DESIGN.md` (location: open question 10).
- **Acceptance:** from DESIGN.md alone a reviewer can answer: where Pause lives, when an icon may stand alone, how Delete behaves, which tokens size icons, how many filled buttons a screen may show. `impeccable context` in a checkout finds both files.
- **Blockers:** none (documents).
- **Depends on:** nothing. **Parallel:** with everything.

### T2. Today: the finished state, counters, on-demand

- **Goal:** UX-01, UX-03, UX-07.
- **Files:** `src/views/today.tsx`, `src/ui/routine-action.tsx`, `src/domain/routines.ts`, `src/views/routines.css`, `src/ui/text.ts`, tests beside the existing routine and render tests.
- **Acceptance:**
  - Tick the last open step of a three-step routine: within 1 s the card is one row, at most 64 px tall at 100 % (128 px at 200 %), with a check and "Done", and contains no Start link.
  - Keyboard: after the last tick, `document.activeElement` is the collapsed row, not `body`; Enter expands it; unticking reopens it. A screen reader hears "‹title› done" once.
  - A counter at target shows a check and no "+1" in the Today row. Below target, "−1" exists at least 8 px from "+1" (bounding boxes). "−1" on a "Both" routine changes only the tapper's value (`value_a` or `value_b` in the local D1).
  - An on-demand routine is not in the Today tally; with every scheduled routine done, Today shows "All done" while the on-demand one is still open.
  - With Partner B ticking a shared routine while Partner A's Today is open, the card changes state without moving A's focus.
- **Blockers:** wrong-side writes, lost update, focus loss, a11y regression, layout regression.
- **Depends on:** PR #57 merged (Today re-renders under polling; `text.ts`). **Parallel:** with T1, T4, T6, T7, T13.

### T3. Start mode: when it shows and how it ends

- **Goal:** UX-08.
- **Files:** `src/domain/routine-start.ts`, `src/views/today.tsx`, `src/views/routine.tsx`, `src/views/routine-start.tsx`, `src/ui/start-page.tsx`, `src/ui/text.ts`, tests.
- **Acceptance:**
  - No Start on an items-only routine, a single-counter routine, a finished routine or a paused one. Start present on a routine with a timer and on one with four open steps. Label "Step by step", or "Continue" when a step is already ticked.
  - From Home: open Start, then × or Escape: the hash is `#/`, the scroll position is restored and focus is on that routine's row. From the detail screen: back on the detail screen.
  - The last page's primary reads "Finish"; the end screen has one primary, "Close", and no footer "Back". Step announcements still fire. The wake lock is released on exit.
- **Blockers:** focus loss, a11y regression.
- **Depends on:** T2 (same lines in `today.tsx`), T7 (scroll restore). **Parallel:** with T4, T6, T13.

### T4. Large text and narrow phones

- **Goal:** UX-05, UX-21.
- **Files:** `src/style.css`, `src/ui/ui.css`, `src/ui/sheet.css`, `src/views/books.css`, `src/views/routines.css`.
- **Acceptance:**
  - Every screen, both themes, 320 and 390 px, 100 and 200 %: no horizontal overflow; no heading breaks inside a word ("Routines" on one line at 320 px, 200 %); the capture button's text on one line.
  - Tab labels compute to `0.78125rem` (25 px at 200 %), or are hidden with the link's accessible name intact when they cannot fit.
  - Every check's bounding box overlaps its title's vertically. Four-option segmented controls are two by two below 26 rem.
  - No control under 44 px; dark mode screenshots otherwise unchanged.
- **Blockers:** layout regression, a11y regression.
- **Depends on:** nothing; rebase over #58 and #60 in `books.css`. **Parallel:** with T1, T2, T6, T7, T13.

### T5. Icons, the More menu, and the routine detail header

- **Goal:** UX-09 rules 5 and 6, UX-12, UX-19; the menu's first caller is the routine detail screen.
- **Files:** `src/ui/icons.tsx`, `src/tokens.css` (icon size tokens), a new menu component on the existing `Modal` (bottom sheet on phones, popover on laptops), `src/ui/ui.css`, `src/views/routine.tsx`, `src/views/routines.css`, `src/ui/routine-sheet.tsx` (drop "Paused until"), `src/ui/text.ts`, `LICENSE` (Lucide's ISC notice for copied paths).
- **Acceptance:**
  - Routine detail at 390 px, 100 %: at most one filled button, no orphaned toolbar line.
  - More opens with Enter or Space, focus lands on the first item, arrow keys move, Escape closes and returns focus to More. A screen reader announces "More actions for ‹title›, menu button". Items are at least 44 px tall.
  - Duplicate opens the duplicate sheet; on close focus returns to More. Pause and Resume write `paused_until` on the routine shown and nothing else. Delete shows the 12 s Undo toast, and Undo restores the steps with the routine.
  - Places uses a map pin, "To watch" a bookmark, Import an upload arrow; icons render at the three size tokens.
- **Blockers:** focus loss, a11y regression, data loss, wrong-side writes.
- **Depends on:** T3 (same toolbar lines), T1 for the rules. **Parallel:** with T6, T7, T12, T13.

### T6. Routine list rows

- **Goal:** UX-04.
- **Files:** `src/views/routines.tsx`, `src/views/routines.css`, `src/ui/text.ts`, tests.
- **Acceptance:** at 390 px, 100 %: each row is one Tab stop (two when paused: the link and Resume); a 28-character title fits on one line; rows are at most 72 px tall. At 320 px, 200 %: no row taller than 220 px. The status line shows exactly one fact (Paused until, Done today, n of m today, Next ‹day›). The partner's rows have the same shape.
- **Blockers:** layout regression, a11y regression.
- **Depends on:** nothing (the detail screen already has Pause and Duplicate). **Parallel:** with everything; the best first PR.

### T7. Back keeps your place

- **Goal:** UX-06.
- **Files:** `src/main.tsx`, a small per-route scroll store, tests.
- **Acceptance:** Home scrolled to y = 1,500, open a routine, press Back: `scrollY` within 10 px of 1,500 and focus on the routine link that was opened. Forward navigation still lands at the top with focus on the `h1`. The split views of People and Money at 1280 px behave as before.
- **Blockers:** focus loss, a11y regression.
- **Depends on:** nothing. **Parallel:** with everything.

### T8. Compact Today and Home order

- **Goal:** UX-02.
- **Files:** `src/views/home.tsx`, `src/views/today.tsx`, `src/views/them.tsx`, `src/views/week.tsx`, `src/views/routines.css`, `src/ui/text.ts`, tests.
- **Acceptance:** with the scratch seed (five routines today, one late task) at 390 px, 100 %, after the morning routines are ticked: Home is at most 1,560 px tall (two screens) and the late line and the current routine are in the first viewport; at 320 px, 200 %: at most four screens. One routine is expanded at a time. The `h1` reads "Today, Mon 26 Oct" and takes focus on navigation; the heading outline has no skipped level. The partner's timetable shows the current and next block. Tab reaches the first open step in six stops or fewer.
- **Blockers:** focus loss, lost update, a11y regression, layout regression.
- **Depends on:** T2, T3, T4, T7.

### T9. One Add

- **Goal:** UX-10.
- **Files:** `src/ui/add-sheet.tsx`, `src/ui/shell.tsx`, `src/ui/capture.tsx` and `src/views/home.tsx` (capture row removed), `src/ui/screen-sheet.tsx` and `src/ui/routine-sheet.tsx` (accept a seeded title), `src/ui/quick-add.tsx` (solid inputs), `src/ui/text.ts`, tests.
- **Acceptance:** on Routines, "+" opens with Routine selected; on Movies with Movie. Type "Dune", pick Movie: the TMDB sheet opens with "Dune" in Title. Escape closes and focus returns to "+". Offline, the hand-off still opens the sheet with "Offline: type it in." The draft survives switching kinds. The lookup fires no more requests than today's debounce allows.
- **Blockers:** data loss (typed text), focus loss, wrong-side writes (owner default), runaway requests.
- **Depends on:** PR #58 merged, T8.

### T10. One detail frame and one delete pattern: tasks, payments, guests, vendors

- **Goal:** UX-14, UX-15 for the Marriage items.
- **Files:** `src/views/generic-item.tsx`, `src/ui/item-form.tsx`, `src/views/person.tsx`, `src/views/money-line.tsx`, `src/ui/text.ts`, tests.
- **Acceptance:** the first link in `main` on each detail screen is the top back link. The screen opens as a read view; "Edit" opens a sheet. Delete is in More or at the end of the sheet, at least 48 px from any other button. Deleting a task returns to Tasks with "Deleted ‹title›" and Undo for 12 s; Undo restores it (`deleted_at` null in the local D1). A partner's live update while the sheet is open keeps the typed text (the rules of PRs #52 and #54).
- **Blockers:** data loss, lost update, focus loss, a11y regression.
- **Depends on:** T5 (menu). **Parallel:** with T8, T9, T11.

### T11. Library and People: headers, covers, detail frame

- **Goal:** UX-11, UX-15 for books, movies and series, UX-16.
- **Files:** `src/views/books.tsx`, `src/views/book.tsx`, `src/views/screens.tsx`, `src/views/screen.tsx`, `src/views/people.tsx`, `src/domain/cover.ts`, `src/views/books.css`, `src/ui/text.ts`, tests.
- **Acceptance:** at 390 px, 100 %, the first content row starts at or above y = 300 on Books, Movies and Guests. No blue or pink tile unless the row has that owner. Movie detail: status and rating first, details read-only with an Edit sheet, Delete in More with the Undo toast; the watched date from PR #60 still edits.
- **Blockers:** data loss, lost update, layout regression.
- **Depends on:** PRs #58 and #60 merged, T5.

### T12. Paused and disabled states

- **Goal:** UX-13.
- **Files:** `src/ui/shell.tsx`, `src/ui/sync-badge.tsx`, `src/domain/status.ts`, `src/ui/routine-action.tsx`, `src/ui/ui.css`, `src/ui/text.ts`, tests.
- **Acceptance:** a known phone reloaded with `/api/**` aborted shows the banner and a "Paused" badge. Tapping a checkbox or "+1" changes nothing, prints no per-row error and moves focus to the banner. Controls stay in the Tab order with `aria-disabled="true"`. "Not today" checks look different from live ones in light and dark. When the sign-in confirms, the controls come alive without a reload.
- **Blockers:** a11y regression, focus loss.
- **Depends on:** PR #57 merged. **Parallel:** with T3 to T7.

### T13. App icon

- **Goal:** UX-17.
- **Files:** `public/icon-192.png`, `public/icon-512.png`, `public/icon-maskable-512.png`, `public/icon-monochrome-512.png`, `public/apple-touch-icon.png`, `public/favicon.svg`, `public/manifest.webmanifest`, `index.html`.
- **Acceptance:** Chrome DevTools › Application › Manifest lists `any`, `maskable` and `monochrome` icons with no warnings; the maskable preview at its minimum safe zone keeps both rings whole; the mark is legible at 48 px; `npm run check` still passes.
- **Blockers:** none of the data classes.
- **Depends on:** the operator's approval of the drawing (open question 8). **Parallel:** with everything.

### T14. Words, small fixes, first run

- **Goal:** UX-20, UX-22, UX-23.
- **Files:** `src/ui/text.ts`, `src/views/home.tsx` (first-run card), `src/ui/avatar.tsx`, `src/views/money.tsx`, `src/views/connect.tsx`, `src/ui/ui.css`, `src/views/routines.css`, `src/ui/sheet.css`, `src/ui/routine-action.tsx` (screen reader names).
- **Acceptance:** no user-facing string calls the app a "plan"; one "Edit" label; a person glyph instead of "Yo" and "Pa"; an empty phone shows the first-run card until both nicknames and the akad date exist; "To pay" hidden before any budget line; a tick's name is read once; rerunning `impeccable detect` on Settings gives no `line-length` or `straggler`.
- **Blockers:** a11y regression.
- **Depends on:** PRs #57, #58 and #60 merged (`text.ts`), T8 (`home.tsx`).

### Outside this split: the shell service worker

UX-18. Already planned in `docs/infra.md` §5.7 and not a UX task, but it decides whether the installed app opens in a lift. Weigh it against T8 to T11.

### Order and parallel work

| Wave | Tasks | Starts when |
|---|---|---|
| 1 | T6, T7, T4, T1, T13 | Now; independent of each other and of the open PRs |
| 2 | T2, T12 | PR #57 is merged |
| 3 | T3, then T5, then T10 | T2 merged; T3 merged; T5 merged |
| 4 | T8, T11 | T2, T3, T4, T7 merged; T5 and PRs #58, #60 merged |
| 5 | T9, T14 | T8 and PR #58 merged; all three open PRs and T8 merged |

## 6. Open questions for the operator

Each has a default, so no task waits on an answer.

1. **May a counter go past its target?** Default: on Today, no ("+1" leaves the row at the target); the detail screen keeps a quiet "+1" for a deliberate extra, logged as "3 of 2". "−1" replaces reset.
2. **What should Start be called?** Default: "Step by step" ("Continue" once a step is ticked).
3. **Keep the "Add something" row on Home?** Default: remove it; the centre "+" opens the same sheet with the keyboard up, and Today gets the top of the screen.
4. **Where do on-demand routines go?** Default: a collapsed "When needed" group at the end of Today that does not count toward the tally, with "Start over" once finished.
5. **May one partner pause, duplicate or edit the other's routines?** Default: yes, from the routine's detail screen only (you enter routines for each other); never from the list.
6. **One delete pattern everywhere (leave the screen, toast, Undo for 12 s), tasks and payments included?** Default: yes.
7. **Icons: keep drawing our own, or add a package?** Default: keep authored SVG and copy the dozen missing paths from Lucide (ISC notice), no package.
8. **App icon direction?** Default: the two rings and the rose dot from the route, white on navy, with maskable and monochrome versions; one drawing round with you before it ships.
9. **Which routine opens on the compact Today?** Default: the first with open steps whose moment matches the time of day (morning until noon, evening from 17:00), else the first open one.
10. **Where do PRODUCT.md and DESIGN.md live?** Default: the repo root on `main` through a normal PR, because the design tooling reads them from the project root; they are documents about the product, not plans.
11. **New items: unassigned or the person adding?** `docs/features.md` §1.3 says unassigned; the Add sheet defaults to the person adding. Default: keep the current behaviour and correct the document.
12. **"Lately" on Marriage shows movie and book additions too. Keep?** Default: scope it to Marriage items.
13. **Movies: show whose pick on "To watch" rows now, and order by collection later?** Default: yes to the photo now; collection order with the collections work.

## 7. Appendix: how the review was done

### 7.1 Setup

- A scratch copy of `main` at `01801e1` (`git archive`), `npm ci` once, outside the repository. Two scratch-only patches, never committed: the dev authenticator reads an `x-dev-who` header (two identities on one dev server), and `vite.config.ts` pins the inspector port. A local D1 with invented rows: eleven routines (steps, counters, items, timers, a timetable, a paused one, a shared one, two for Partner B), six tasks, three budget lines and three payments, two vendors, four guests, one place, five books, three movies, two series. A second, empty D1 for first-run states. Dev servers on 127.0.0.1 ports 8211 and 8212 only; no wrangler command reached a real account; the production site was not opened.
- Browser: headless Chromium 1243 through Playwright, every non-127.0.0.1 host aborted, reduced motion, touch on phone widths. 200 % text through a profile with `default_font_size: 32` (root `rem` read back as 32 px).
- The impeccable context loader ran in the scratch copy. It reported no PRODUCT.md and no DESIGN.md, so the review used the README, `docs/` on the `docs` branch and the code as the authority, and drafted neither file (proposed as T1). Discovery questions were answered from the repository and the operator's notes, as instructed, instead of waiting for answers; the questions are in section 6.

### 7.2 impeccable commands and what they returned

- **`impeccable context`**: `NO_PRODUCT_MD`, `EXISTING_VISUAL_SYSTEM`; refinement and evaluation may proceed on the incumbent code.
- **`critique`**, dual-agent as the command requires: Assessment A (design review) and Assessment B (detector and browser evidence) ran as two isolated sub-agents; A finished before B's results were read; the synthesis is this document. The snapshot was written only in the scratch copy (`.impeccable/critique/`), first run, no trend.
  - **Design specificity:** split. The Marriage journey (countdown, route, "You are here", the two rings) and the sign-in screen are authored for this couple; Home, Routines, Library and Settings are category-generic rows and buttons. The bans hold (no beige, no serif on cream, no gradients, no glass). The main fault is a loud action vocabulary, not blandness.
  - **Heuristics, whole app: 27 / 40, Acceptable** (top of band). 1 Visibility of status 2 (no done state; paused controls look live) · 2 Match 3 ("Start" unexplained, builder words) · 3 Control 3 (Undo toasts good; no −1; Start and Back lose place) · 4 Consistency 2 (Start filled and outlined, Back top and bottom, four looks for "done") · 5 Error prevention 3 (counter past target, reset beside "+1") · 6 Recognition 3 · 7 Efficiency 3 (capture parsing good; "+" context-blind) · 8 Minimalism 2 (Home length, row buttons) · 9 Recovery 3 · 10 Help 3. Per surface: Home 23, nav and Add sheet 28, Marriage 30, Routines 21, Start mode 30, Books 25, Movies and Series 29, Settings and Sync 27, entry and states 31.
  - **Cognitive load:** four checklist failures (single focus, visual hierarchy, minimal choices, progressive disclosure): high. Decision points over four options: Add sheet 14, People header 11, Settings exports 11, Books header 9, add-step kinds 7, running timer 6.
  - **Emotional journey:** peaks at the Marriage hero and the timer's end in Start mode; every ending is flat (a finished routine changes nothing, Start ends on the detail screen, the day never closes). Fix the endings.
  - **Personas:** Casey (one hand): scroll reset on Back, reset 4 px from "+1", Pause sheet without presets. Sam (screen reader, 200 %): broken words, fixed-size nav labels, disabled ticks that look live, progress read inside every Today heading. Jordan (first-timer): "Start" unexplained, two "New" buttons, Settings only behind the photos. The partner checking the other's day: the partner's timetable below one's own routines, past blocks struck through, Pause buttons on the partner's rows.
- **`detect`** (CLI over `src` and `index.html`, then 28 rendered states: Home, Routines, a routine, Books, Movies, Marriage and Settings at 390 and 1280 px, light and dark, through CDP on 127.0.0.1): `overused-font` ×1 (Mona Sans; kept, see section 4), `line-length` ×2 and `straggler` ×2 (Settings help text; UX-23), `monotonous-spacing` ×28 and `flat-type-hierarchy` ×2 (both false positives: the spacing comes from a nine-step token scale and the Marriage `h1` wraps a 120 px numeral). No `low-contrast`, `tiny-text`, overflow, heading-order or broken-image hit in any state; a planted 1.7 : 1, 9 px canary was caught, so those rules were live.
- **`audit`** (technical, by the coordinating pass): **14 / 20, Good.** Accessibility 3 (real controls, names, focus ring, 44 px targets; WCAG 1.4.4 fails for nav labels, brand and stars; label-in-name on "+1"; disabled ticks look live). Performance 3 (one 524 kB chunk, 163 kB gzip, plus 133 kB of fonts; no layout thrash seen; no service worker). Theming 3 (full token set, dark mode complete; a few off-scale literals; partner tints reused for covers). Responsive 2 (no horizontal overflow and good targets, but 200 % text breaks words and rows, `vw` caps, a half-empty laptop layout). Implementation integrity 3 (one coherent system with about 17 control patterns for six intents).
- **Not run, on purpose:** `init`, `document`, `extract`, `polish`, `live`, hooks. They write PRODUCT.md, DESIGN.md or code into the project.

### 7.3 Probes and measurements

- **Layout probe** on each of the 266 states the capture script took: root `rem`, `scrollWidth − innerWidth`, page height, every visible `a`, `button`, `summary`, `input` and `[role=button]` under 43.5 px in either axis (checkboxes measured by their label), and the visible button labels. Result: zero horizontal overflow in all 266 probed states; under 44 px only the "Open", "Take it" and "Mark paid" pills (all extend their hit area with `::after`) and the inline "Set the akad date" link on an empty phone; Home 2,827 px at 390 px and 8,158 px at 320 px with 200 % text; the bottom bar 69 px at 100 % and 129 px at 200 %.
- **Counter probe:** `mark()` from `shared/routines.ts` imported under Node 26 with a counter at 2 of 2 returns a count of 3.
- **Keyboard and accessibility-tree probe** on Home and Routines: Tab order (22 stops reach only the third routine), accessible names (ticks, "+1", reset, Start), the Today heading text.
- **States:** sign-in (an unknown identity), wrong account (`?access=denied`), connect (first load offline), paused (a known phone reloaded with `/api/**` aborted, before and after a tap), offline and expired (in session), a second account on the same browser, an empty database.
- **Build:** `vite build` of the scratch copy for the bundle sizes above.

### 7.4 What was verified and what was not

- **Verified:** the code references were read on `main` at `01801e1` (Assessment A's were spot-checked line by line); every screenshot cited in a finding was looked at, and the rest were covered by the layout probe; the measurements above were taken in the scratch app.
- **Not verified:** a real phone (Android Chrome, the installed PWA, its splash and icon masking, the system font-size setting, the wake lock and chime); TalkBack or VoiceOver output (the accessibility tree was read, no screen reader was run); real touch gestures (only taps were synthesised); the offline launch of an installed app (UX-18 is an inference from the missing service worker); perceived speed on a mid-range phone; the "Signed in as someone else" banner (a second account on the same browser opened its own partition, by design, so the banner did not appear); the open PRs' branches (reviewed against `main` only).

### 7.5 Scratch screenshots (ids only, all deleted)

- Seven configurations, `390-100-light`, `320-100-light`, `320-200-light`, `390-200-light`, `390-100-dark`, `1280-100-light`, `1280-100-dark`, each with these states: `home`, `home-scrolled`, `add-sheet`, `marriage`, `tasks`, `task-detail`, `money`, `payments`, `people`, `guests`, `vendors`, `routines`, `routine-new`, `routine-pause`, `routine-skincare`, `routine-vitamins`, `routine-edit`, `routine-bag`, `routine-work`, `start-workout`, `start-skincare-done`, `books`, `wishlist`, `places`, `book-detail`, `wish-detail`, `book-import`, `movies`, `movie-detail`, `series`, `series-detail`, `movie-add`, `settings`, `sync`, `offline-home`, `expired-home` (for example `320-200-light-routines`).
- States: `390-100-light-state-signin`, `-state-denied`, `-state-connect`, `-state-paused-home`, `-state-paused-tick`, `-state-mismatch`.
- Partner B: `390-100-light-b-home`, `390-100-light-b-routines`.
- Empty database: `390-100-light-empty-home`, `-empty-add-sheet`, `-empty-marriage`, `-empty-tasks`, `-empty-money`, `-empty-people`, `-empty-routines`, `-empty-books`, `-empty-wishlist`, `-empty-movies`, `-empty-series`, `-empty-settings`.
- Assessment A's own captures: `a-1280-light-home`, `a-1280-light-marriage`, `a-1280-light-people`, `a-1280-light-routines`, `a-1280-light-vitamins`, `a-390-light-home`, `a-390-light-routines`, `a-390-light-shared`, `a-390-light-start-bag`, `a-390-light-start-vitamins`, `b-390-light-home`, `b-390-light-routines`.
- Assessment B's detector captures: 28, one per rendered state in 7.2.
