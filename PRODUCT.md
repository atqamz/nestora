# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two adults, Partner A and Partner B, who share one household and one app, each on their own phone: one Android, one iPhone, both first-class. They sign in with their own Google account through Cloudflare Access; nobody else has access. They use it many times a day in short, one-handed moments (a doorway, a bathroom, a shop, the sofa session for two) and sometimes on a laptop. Time zone Asia/Jakarta; interface copy is English.

Jobs, in daily order:
- Do today's routines and see what is late (Home).
- Plan and track the wedding together: journey and countdown to the akad, tasks, money, people (Marriage).
- Keep track of books, movies and series: where it is, what is next, what to watch tonight (Library).
- Agree who does what without managing each other.

## Product Purpose

Nestora keeps a household's planning in one place that works without signal and stays in sync between two phones. Success is a glance that answers "what now?" in two to ten seconds, input that never loses typed work, and two people who feel equal, not monitored.

## Positioning

A private two-person app, not a team tool or a marketplace. Routines are personal, shared or private; the other partner sees shared state and a read-only timetable, never private routines and never the other's ticks.

## Operating Context

- Mobile-first PWA: React and TypeScript on a Cloudflare Worker with D1. IndexedDB per side with an outbox, so reads and writes work offline and sync when back online. Partner changes arrive silently.
- The routine day starts at 04:00 (UTC+7).
- Start mode runs timers on the phone only; the screen stays awake while it is open.
- Calendar feed (.ics) for a partner's own routines.
- This repository is public: the two people appear only as Partner A and Partner B, and no real name, amount, date, email or title is committed.

## Capabilities and Constraints

- Offline-first; writes are read-only until the signed-in side is confirmed, so nothing is queued under the wrong partner.
- Add-by-lookup for books (Google Books, Open Library) and movies and series (TMDB, with its attribution shown).
- JSON export of everything; no streaks, scores, badges or completion fanfare.
- No analytics. No documents of identity are stored.
- Undecided: the installed app opening with no signal (a shell service worker is planned, not built).

## Brand Commitments

- Name: Nestora (internal identifiers keep the old name `wp`; see README).
- The wordmark is "Nestora" in Mona Sans 800 at 125 % width.
- The product's own symbol is the two linked rings at the end of the Marriage route, shown in the Journey and on the sign-in screens.
- Tone: calm, specific, plain words; red is for late and failed only; errors name the cause and the fix and keep what was typed.

## Evidence on Hand

- `docs` branch: `docs/features.md`, `docs/routines.md`, `docs/live-sync.md`, `docs/ux-research.md` (the whole-app review that proposed these two files and the fourteen follow-up tasks).
- No user testing, analytics or real-phone measurement exists; the review was made against a local scratch app with invented rows.

## Product Principles

1. Today is a to-do, not an archive: show what is left; finished things fold away and stay one tap away.
2. One row, one job: a row opens its object, with at most one next-step pill; everything else is one level deeper.
3. Same job, same control, same word, in every module.
4. Thumbs and glances: daily actions live in rows and the bottom bar; the header carries status only.
5. Loud only when it needs you: done, paused and offline are quiet.
6. Text scales, the layout follows: a 320 px phone at 200 % text is a supported phone.
7. Two people, one truth, no surveillance: show shared state, never the partner's private ticks.
8. Undo over confirm: reversible actions act at once with Undo; only irreversible ones ask first.

## Accessibility & Inclusion

- WCAG 2.2 AA is the floor: contrast, 44 px targets, visible focus, text resize to 200 % without loss, no information by colour alone, reduced motion respected.
- Android's font-size and display-size settings are the zoom people actually use; both themes (light and dark) must be complete.
- Screen reader names carry verb and object ("Delete Living room shelf").
