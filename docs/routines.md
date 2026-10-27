# Routines: repeatable lists, a timetable, a training tracker and reminders in Nestora

Research and design as of 24 October 2026. A decision document, no code. Every claim carries **[verified]** (an official page, a repository, an API description or this repo's code was read on that date) or **[assumed]** (reasoning, a third-party source, or a page that could not be opened).

> **Privacy.** This repo is public. The two users are **Partner A** and **Partner B**; places are **Place A** and **Place B**. Every routine, item, time and quantity in this document is invented and neutral. Nothing here describes the operator's own routines, products, medicines, diet or training, and nothing like that may appear in code, fixtures, tests or commit messages. The real entries are typed into the app at runtime and live only in D1 (§9).

## Summary

1. **Shape:** Routines are a new area inside the existing app (one Worker, one D1, one Access app). No new bottom-bar slot: a "Today" block on Home and a `#/routines` screen reached from it, like Tasks.
2. **Open core:** a routine is a named list of actions with an owner and a schedule rule. An action has an open `kind` (`step`, `timer`, `pack`, `block`, `day_type`, `counter`, `text`, and later ones) with validated parameters. Each kind is one registry entry plus one renderer, in the existing `items` table: no migration.
3. **Completions:** per person, per day, stored as two date keys on the action row (`done_a`, `done_b`). A list "resets" because yesterday's date no longer equals today; nothing runs at midnight. No history is kept. A history (a `completions` table) is the documented exit, built only when someone asks for one.
4. **Occurrences are computed, never stored.** One shared function decides whether a routine or action happens on a date (weekdays, every N weeks, from/until, paused until, national holidays). The SPA, the reminder planner and the calendar feed all call it.
5. **Integrator layer:** the core knows no vendor. Five tiny capabilities (`Notifier`, `CalendarSink`, `ChecklistSink`, `TrackerSource`, `Exporter`), one adapter per vendor, configured per person in a settings key, secrets in Worker secrets or an encrypted server-only table. Reminders flow through one outbox table drained by a once-a-minute cron, or pulled by an external sender.
6. **Honest cost:** the layer adds about 8 files, 2 server-only tables and 1 Cron Trigger. Slice 1 needs none of it. With a single channel the "layer" is one interface and one adapter; anything more is built only when a second adapter is.
7. **Reminders:** first the in-app Today view and a calendar feed (zero risk). Then Web Push from the Worker (free, but iOS only for the app installed to the Home Screen). WhatsApp: the official Cloud API costs about Rp357 per reminder and needs a business number; the free linked-device route breaks WhatsApp's terms and risks the account. Neither is recommended for the personal number (§4).
8. **Google:** Calendar via a read-only `.ics` feed first; the Calendar API with a narrow app-created-calendar scope only if the feed's delay or missing alarms hurt (§5). Keep has no API for personal accounts; a checklist stays in Nestora (§6).
9. **Training:** a day-type tracker (Lower, Upper, Rest plus a few daily items) is plain data in the same model and ships in slice 1. Hevy's API is for Hevy Pro only; the recommendation is no integration, a manual tick and a link to the training app (§7).
10. **Phasing:** slice 1 (core, Today, check-offs, timetable, tracker, local timers, no adapters) is 4 PRs; slice 2 (the `.ics` feed, the outbox and dispatcher, Web Push) is 3 PRs plus an optional WhatsApp-sender endpoint; slice 3 (Google Calendar API, a tracker source) is 0 to 2 PRs, each only on demand.

---

## 1. Same product or a second app

| | A. An area in Nestora | B. A second app in the repo | C. A separate repo |
|---|---|---|---|
| Worker, D1, Access | The same; the SPA gains 2 routes, the Worker gains a `scheduled` handler later | A second Worker, Access app, domain | All of it twice |
| Shared code | Store, outbox, sync, export, validators, tokens and shell are reused as they are | Needs `src/store`, `shared/` and `worker/auth.ts` extracted into packages first | Copied and left to drift |
| Users | The same two accounts, the same `a` and `b` | The same, configured twice | The same, configured twice |
| Cost | The registry entries, the screens and later the dispatcher | Plus a monorepo refactor of 2 to 3 PRs (`docs/books.md` §1) | Plus a full bootstrap |

**Decision: A, an area in Nestora.** Routines are household data for the same two people, behind the same login, synced and exported by the same code. Books took the same decision a week ago **[verified, `docs/books.md` §1]**.
*Trade-off:* Nestora drifts further from "wedding planner". The visible name did change, on 25 October 2026 ([rename plan](rename-nestora.md)); every internal `wp` identifier stays.

**Navigation.** The bottom bar is full: Home, Money, (+), People, Books **[verified, `src/ui/nav.ts`]**.
- **Decision: no sixth slot.** Home gains a "Today" block under the countdown hero: the routines that apply today, each with its progress, and today's timetable blocks. "All routines" opens `#/routines`, the way "All tasks" opens `#/tasks` today **[verified, `src/views/home.tsx`]**. The Home nav item then covers `home`, `tasks` and `routines` **[verified, the `screens` list in `src/ui/nav.ts`]**.
- **Why Home:** routines are the one daily-use area. Opening Nestora every morning for the checklist also keeps the wedding's "This week" in sight, which helps the weekly-use goal of `docs/features.md` §1.4 **[assumed]**.
- *Trade-off:* Home gets longer. After the wedding, Money or People can give up their slot; that is the moment to reconsider a Routines tab.
- **The (+) sheet** has a Routine chip (UX T9): it closes the Add sheet and opens the new-routine sheet with the typed text as the name. This replaces the first decision, no routine chip.

---

## 2. The open Routine core

### 2.1 What is generic and what belongs to a kind

A **routine** is a named list of **actions**, with an **owner** and a **schedule rule**. An **action** has a **kind** and the parameters of that kind. That is the whole model.

| Generic (every routine or action, one code path) | Per kind (one registry entry plus one renderer) |
|---|---|
| **Identity:** `id`, `kind`, `title`, the sync columns, tombstones, undo | **Parameters:** validated `data` keys (`minutes`, `start_time`, `unit`, …) |
| **Owner:** `who` on the routine (`a`, `b` or `both`) | **Rendering:** a row, a timer, a time block, a header, a counter |
| **Schedule rule:** on the routine, plus an optional `days` filter on any action | **Completion:** a tick, a count that reaches a target, or none (a block, a header, a note) |
| **Ordering:** `sort` (fractional, as everywhere) and an optional heading (`group_key`) | **Behaviour in "Start" mode:** a timer counts down, a step waits for "Done" |
| **Completion record:** `done_a`, `done_b` (the routine day of the last tick) | |

**A new kind is a new variant in `shared/tables.ts` and a component in the routine renderer map. No table, no migration, no new sync code** **[verified, that is how `book`, `copy` and `place` were added: `shared/tables.ts`, `worker/sync.ts`]**. There is no plugin system: kinds ship in the code, reviewed like everything else.

### 2.2 Kinds and registry entries

Actions are ordinary `items` rows whose `parent_id` is the routine. The variants follow the existing shape **[verified, `shared/tables.ts`]**:

```ts
const days = { days: "days" } as const;
const marks = { done_a: "date", done_b: "date" } as const;
const action = ["parent_id", "group_key", "note"] as const;

routine: {
  columns: ["who", "group_key", "note"],
  required: ["who"],
  data: {
    ...days, every_weeks: ["1", "2", "3", "4"], from: "date", until: "date", paused_until: "date",
    start_time: "time", holidays: "bool", private: "bool", remind: "bool", calendar: "bool",
  },
},
step:     { columns: action, required: ["parent_id"], data: { ...days, ...marks, url: "url" } },
timer:    { columns: action, required: ["parent_id"], data: { ...days, ...marks, minutes: "int" } },
pack:     { columns: action, required: ["parent_id"], data: { ...days, ...marks } },
block:    { columns: action, required: ["parent_id"], data: { ...days, start_time: "time", end_time: "time", where: "text" } },
day_type: { columns: action, required: ["parent_id"], data: { ...days } },
counter:  { columns: [...action, "qty"], required: ["parent_id"], data: { ...days, ...marks, unit: "text", value_a: "int", value_b: "int" } },
text:     { columns: action, required: ["parent_id"], data: { ...days } },
```

| Kind | Meaning | Completes by | Renders as |
|---|---|---|---|
| `routine` | The container. `group_key` is the moment or section: `morning`, `evening`, `on_demand`, or any text the couple type (suggestions from used values, like a vendor category) | The share of its actions done today | A row with "2 of 5" on Today; the detail list |
| `step` | Something to do. `note` holds how-to lines; `url` an "Open" link (a training app, a recipe) | A tick | A checkable row |
| `timer` | Do or wait for N `minutes` | A tick (the timer only counts; it never ticks for you) | A row with a ⏱ button; a countdown in Start mode |
| `pack` | An item to have with you | A tick | A compact two-column checklist, no Start mode |
| `block` | A time block: `start_time`, optional `end_time` (absent = open end, shown "18:30–…"), `where` | Nothing | A timetable line |
| `day_type` | The label of the day ("Lower", "Rest") | Nothing | The routine's header for that day |
| `counter` | Count up to a target: `qty` is the target, `unit` the label | `value_x` reaches `qty`; each tap adds 1 | "1 of 2 portions" with a + button |
| `text` | A line of guidance | Nothing | Plain text |

**What the validator gains** (`shared/validate.ts`):
- Two types: `time` (`HH:MM`, 00:00 to 23:59) and `days` (distinct weekday codes in order, `MO,TU,WE,TH,FR,SA,SU`, for example `MO,TH`). The codes are the iCalendar `BYDAY` codes, so the feed and the Calendar API need no mapping **[verified, RFC 5545 §3.3.10]**. About 15 lines with tests.
- **Per-kind references.** Today `refs.items` allows one parent kind, `book` **[verified, `worker/sync.ts`]**. It becomes a map by child kind: `copy` → `book`, every action kind → `routine`. The books document predicted exactly this change **[verified, `docs/books.md` §2.7]**.
- `data.private` may be set only when the routine is created (one check in the Worker; §9).
- Required parameters (`minutes` on a timer, `start_time` on a block) are enforced by the forms. The Worker accepts their absence, which only means "no timer" or "no time yet" **[assumed acceptable; the registry's `required` covers columns, not `data` keys, `shared/tables.ts`]**.

### 2.3 The schedule rule and how occurrences are computed

A routine happens on a local date when all of these hold:
1. The weekday is in `days` (absent means every day).
2. `from` ≤ date ≤ `until`, where each is given.
3. The date is not before `paused_until`. Pausing until a date covers a holiday week or a term break in one field.
4. With `every_weeks` = n, the number of whole weeks between the week of `from` and the week of the date is a multiple of n. Every 2 weeks is "biweekly"; every 4 weeks stands in for "monthly".
5. With `holidays` on, the date is not in `settings.holidays`, the list the app already validates as a JSON array of dates **[verified, `shared/tables.ts`]**.

An action shows on a day when its routine does and its own `days` (if any) include that weekday.

**Decision: occurrences are computed on read, never stored.** The rule is one pure function in `shared/routines.ts`, unit-tested with `node --test`, and called by the Today view, the reminder planner (§3.5) and the calendar feed (§5). Nothing is generated ahead, so editing a routine changes the future at once and leaves nothing to clean up.

- **Time zone.** Dates and times are local, read with `settings.timezone` **[verified, `docs/brainstorm.md` §7.3]**. `Asia/Jakarta` is UTC+7 with no daylight saving time **[assumed, IANA tzdata]**, so a local time maps to one UTC instant every day.
- **Not modelled:** monthly by date ("the first Saturday"), moving one occurrence ("this Thursday's block is on Friday"), and one-off skips other than pausing. Each is an edit or a pause today, and a later `data` key if it is asked for twice.

### 2.4 Completions: per person, per day, without a table

**The routine day.** The local date, where the day starts at 04:00, so an evening routine finished at 00:30 still counts for the evening it belongs to. One constant in `shared/routines.ts`.

**Ticking.** A tick writes the routine day into `done_a` or `done_b` on the action row; unticking writes `null`, which `json_patch` removes **[verified, the merge-patch behaviour in `docs/brainstorm.md` §7.2]**.
- On a routine owned by one partner, the owner's key is written, whoever taps.
- On a `both` routine, the tapper's key is written, and the row shows both partners' state.
- A counter writes `value_x` together with `done_x`; the count belongs to the day in `done_x`.

**The reset is free.** An action is done today when `done_x` equals today's routine day. Yesterday's tick simply stops matching. No cron, no job, no midnight write.

**Why this is safe on two phones.** Each partner writes only their own key, and the Worker merges `data` keys one by one **[verified, `docs/brainstorm.md` §5.3]**. The same partner ticking on two devices writes the same value. A tick is one `update` mutation, about 3 to 5 rows written **[verified, `docs/brainstorm.md` §7.2]**; 40 ticks a day is about 200 of the 100,000 daily writes **[verified limit, D1 pricing page]**.

**Decision: no completions table now.** The operator suggested a small table for completions per day per person. Measured against the repo's own exit rule (`docs/features.md` §7.2: a kind moves out only for integrity beyond `parent_id`, money, large scans, or a different retention or privacy rule) **[verified]**, the last-day marks need none of those, and they keep the reset free.
*Trade-off:* there is no history. "Did I pack the umbrella last Tuesday?" and "how many training days this month?" cannot be answered. That matches "no streaks, no scores" (`docs/features.md` §8.1) **[verified]**.

**The exit, when a history is asked for.** A `completions` table, the one place where the shape truly differs, because it needs a uniqueness rule that the generic table cannot express:

```sql
CREATE TABLE completions (
  id TEXT PRIMARY KEY,
  action_id TEXT NOT NULL REFERENCES items (id),
  day TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  who TEXT NOT NULL CHECK (who IN ('a', 'b')),
  value INTEGER CHECK (value IS NULL OR value >= 0),
  -- plus the five sync columns, as on every synced table
  UNIQUE (action_id, day, who)
);
```

It costs a migration, a third entry in the sync loader (which lists each table's query by hand, `worker/sync.ts` **[verified]**), an export shape, and about 10,000 rows a year at 25 ticks a day, all pulled to both phones **[assumed estimate]**. Build it only when a history question is asked twice.

### 2.5 The four examples, as data

All invented; none is the operator's.

**A routine with weekday variants and timers.** Three evening variants are three routines that share the moment `evening`, so Today shows only the one for today. A biweekly one shares the same moment.

| Routine (`group_key` `evening`, owner A) | `days`, cadence | Actions in order |
|---|---|---|
| Evening · laundry | `MO,TH` | step "Load the washer"; timer 45 "Wash cycle"; step "Hang the laundry" |
| Evening · kitchen | `TU,SA` | step "Soak the pans"; timer 15 "Soak"; step "Wipe the counters" |
| Evening · light | `WE,FR,SU` | step "Tidy the living room" |
| Deep clean | `SU`, `every_weeks` 2, `from` a Sunday | heading "Kettle": step "Fill with descaler"; timer 60 "Descaler works"; step "Rinse twice" |

Sub-steps are flat steps under a `group_key` heading ("Kettle"), never nested rows. A one-line difference between variants can also be an action-level `days` filter instead of a second routine; the model allows both, and the editor offers "Duplicate for other days".

**A daily checklist that resets.** "Bag" (owner A, `on_demand`, every weekday `MO,TU,WE,TH,FR`): pack "Keys", pack "Wallet", pack "Umbrella", pack "Water bottle", pack "Notebook". Tomorrow it is unticked again (§2.4).

**A weekly timetable.** "Weekly timetable" (owner B, `group_key` `timetable`, `from` the term start, `until` the term end, `holidays` on): block "Class" `MO` 09:00–12:00 at Place A; block "Work" `WE` 13:00–17:00 at Place B; block "Meeting" `FR` 18:30–… at Place B. A holiday week is `paused_until` on the routine, one edit for all blocks.

**A training day-type tracker.** "Training" (owner A, every day, `private` on):

| Action | `days` | Shows |
|---|---|---|
| day_type "Lower" | `MO,TH` | "Training · Lower" on Monday and Thursday |
| day_type "Upper" | `TU,FR` | "Training · Upper" |
| day_type "Rest" | `WE,SA,SU` | "Training · Rest" |
| step "Workout logged in the training app", `url` to the app | `MO,TU,TH,FR` | A tick and an "Open" link |
| step "protein item, 300 g" | `MO,TH` | A tick |
| counter "protein item", `qty` 2, `unit` "portions" | `TU,FR` | "0 of 2 portions" with + |
| step "supplement" | every day | A tick |

The weekly pattern (Mon Lower, Tue Upper, …) is computed from the `day_type` actions and drawn as a seven-day strip on the routine. No new kind beyond `day_type` and `counter`, both of which serve other routines too.

### 2.6 Where the model strains

- **Anything with a growing history:** workout logs, measurements, "progress". The marks keep one day. History is the `completions` exit (§2.4) for ticks, and an external app for everything richer (§7).
- **Exceptions per occurrence:** one moved block, one cancelled evening. Not modelled (§2.3).
- **Shared steps across variants:** the same line in three evening routines is three rows; editing one does not change the others. Duplicate-and-edit is the price of not nesting.
- **Deep parameters:** a kind with ten parameters (a full workout program) is a sign that the data belongs in a dedicated app.
- **More than two people:** `a`, `b` and `both` assume the two accounts, as everywhere in Nestora.

### 2.7 What else changes

- **Lately on Home** shows every changed `items` row **[verified, `src/domain/lately.ts`]**. Routines and actions are left out: ticks would flood it, and a feed of a partner's ticks is the "has the partner opened it" view that `docs/features.md` §8.1 rules out **[verified]**.
- **Export.** The CSV export writes any registry variant with its `data.<key>` columns, and the JSON dump includes every row **[verified, `worker/export.ts`]**. Private routines are filtered there too (§9).
- **"This week" on Home** stays as it is: routines are daily, not due dates **[verified, `src/domain/week.ts` shows tasks and payments only]**.
- **Size.** Ten routines of six actions plus a fifteen-block timetable is under 100 rows, nothing next to the books module's estimated 640 **[assumed estimate]**.

---

## 3. The integrator layer

### 3.1 The rule

The core (`items`, the registry, the Today view, sync) knows no vendor. A routine says only **what** should happen ("remind the owner at the start time", "mirror my blocks to my calendar"). **Which** service does it is the person's setting, carried out by an adapter on the Worker. Data flows one way per adapter.

### 3.2 Capabilities

Five interfaces, each tiny. They live in `worker/integrations/types.ts`.

```ts
type Side = "a" | "b";
type Result = { ok: true } | { ok: false; retry: boolean; error: string };

type Reminder = { id: string; to: Side; title: string; url: string; at: string };
type Block = { uid: string; title: string; rrule: string; start: string; end: string | null; where: string | null; exdates: string[] };
type Checklist = { id: string; title: string; lines: { id: string; title: string; done: boolean }[] };
type Activity = { day: string; label: string };

interface Notifier { send(reminder: Reminder): Promise<Result> }
interface CalendarSink { publish(to: Side, blocks: Block[]): Promise<Result> }
interface ChecklistSink { mirror(to: Side, list: Checklist): Promise<Result> }
interface TrackerSource { activity(of: Side, day: string): Promise<Activity[] | Result> }
interface Exporter { render(rows: readonly ItemRow[], to: Side): Response }
```

- **`Notifier`** sends one reminder to one person. The `title` is the routine's title and the `url` opens it in Nestora; no action detail ever leaves the app (§9).
- **`CalendarSink`** replaces the whole set of wp-owned events in a calendar that Nestora owns. Full replace is idempotent and needs no stored mapping.
- **`ChecklistSink`** mirrors one checklist to an external list app. It is defined so the shape is settled; no adapter is recommended (§6).
- **`TrackerSource`** reads an external tracker's activity for a day, so an action bound to it can be ticked automatically. It never writes to the tracker.
- **`Exporter`** turns rows into a file or a feed (`.ics`, CSV). The CSV and JSON export exist already **[verified, `worker/export.ts`]**; the `.ics` feed is the first new one (§5).

**An adapter** is one implementation of one capability for one vendor: `webpush` (Notifier), `telegram` (Notifier), `email` (Notifier), `whatsapp_cloud` (Notifier), `sender` (Notifier, pulled by an external process), `ics` (Exporter), `google_calendar` (CalendarSink), `google_tasks` (ChecklistSink), a tracker (TrackerSource). The registry is a plain object from adapter type to `{ capability, make(config, secret) }` in `worker/integrations/index.ts`.

### 3.3 Configuration per person, and where secrets live

- **Configuration** is one settings key per partner, `integrations_a` and `integrations_b`, each a JSON list of `{ id, type, enabled, config }`, validated per type in `shared/`. Each partner edits only their own key, so the whole-value last-write-wins of settings never loses the other partner's edit **[verified that a settings value is replaced as a whole, `docs/books.md` §2.6]**. `config` holds only non-secret values: a device label, a Telegram chat id, a calendar id, a tracker's base URL. The Worker accepts a write to `integrations_a` only from Partner A, and to `integrations_b` only from Partner B. Each device with Web Push is its own entry.
- **Static secrets**, the same for both partners, are Worker secrets set with `wrangler secret put`: `VAPID_PRIVATE_KEY`, `TELEGRAM_BOT_TOKEN`, `SENDER_TOKEN_HASH`, a Google OAuth client secret, `SECRETS_KEY` **[verified, the Worker already requires secrets this way: `wrangler.jsonc` `secrets.required`]**.
- **Runtime secrets**, created per person while using the app (a push subscription, a Google refresh token, a tracker API key typed in Settings), go to a server-only table `secrets`, encrypted with AES-GCM under `SECRETS_KEY` **[verified, AES-GCM is in Workers WebCrypto]**. They arrive through a dedicated endpoint (`PUT /api/integrations/<id>/secret`), never through `/api/sync`, so they are never pulled to the other phone and never exported. This honours "third-party tokens aren't stored as plain text in D1" and "export and backup must not carry credentials" **[verified, `docs/features.md` §6.1 #11]**.
- **Never in the repo:** no token, key, phone number or chat id in code, fixtures or `.dev.vars.example`.

### 3.4 Binding a routine to a capability

A routine carries only vendor-neutral flags:
- `remind: true` means "remind the owner at `start_time` through every Notifier they have enabled". A `both` routine reminds both partners.
- `calendar: true` means "publish this routine's blocks (or its start time) through my CalendarSink or feed".
- A step with `url` and the tracker binding `track: true` (a later `data` key) means "tick me when my TrackerSource reports activity today".

The person decides the channel once in Settings ("Remind me by: Web Push ✓, Telegram ✗"). Changing channel never touches a routine.

### 3.5 Delivery: the outbox and the dispatcher

Two server-only tables, not synced and not exported, in one migration:

```sql
CREATE TABLE deliveries (
  id TEXT PRIMARY KEY,                  -- sha-256 of source_id | fire_at | who | adapter
  who TEXT NOT NULL CHECK (who IN ('a', 'b')),
  adapter TEXT NOT NULL,                -- the adapter id from integrations_a or integrations_b
  source_id TEXT NOT NULL,              -- the routine or action
  fire_at TEXT NOT NULL,                -- RFC 3339 UTC
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'claimed', 'sent', 'failed', 'dropped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at TEXT NOT NULL,                -- next attempt, or the end of a claim
  error TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE INDEX deliveries_due ON deliveries (status, next_at);

CREATE TABLE secrets (
  id TEXT PRIMARY KEY,                  -- the adapter id
  who TEXT NOT NULL CHECK (who IN ('a', 'b')),
  iv TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

**Why tables and not `items` kinds:** they hold credentials and per-device delivery state that must never reach the other phone or the export. That is the "different privacy rule" of the exit rule **[verified, `docs/features.md` §7.2]**.

**The dispatcher** is the Worker's `scheduled` handler on one Cron Trigger, `* * * * *` (every minute, in UTC) **[verified, Cron Triggers run on UTC; the docs give `* * * * *` as an example and state no other minimum]**.
1. **Plan** (every minute): find routines with `remind` whose occurrence falls in the next 20 minutes (the shared rule of §2.3), and insert one delivery per enabled Notifier of each person, with `INSERT OR IGNORE`. The id is a hash of source, time, person and adapter, so planning the same minute twice does nothing. A pending delivery whose routine no longer occurs at that time (edited, paused, deleted) becomes `dropped`.
2. **Drain:** take up to 10 rows with `status = 'pending' AND next_at <= now`. For a push-mode adapter, call `send`.
   - `ok` → `sent`.
   - `retry` → `attempts + 1`, `next_at` after 1, 5 then 15 minutes; after 3 attempts → `failed`.
   - Not retryable (a push subscription answering 410) → `failed`, and the adapter is marked "needs attention" in Settings **[verified, 410 means the subscription is gone: web.dev push protocol article]**.
   - Older than its staleness window (30 minutes for a routine, 5 for a timer) → `dropped`. A 07:00 reminder at 09:00 is noise.
3. **Pull-mode adapters** (an external sender, §4.4) are skipped by the drain. The sender claims its rows over HTTPS.

**Timers.** Starting a timer in the app calls `POST /api/timers` (`{ action_id, minutes }`), which inserts deliveries for the caller's enabled Notifiers at now plus the minutes; stopping it calls `DELETE /api/timers/<action_id>` (pending rows become `dropped`). The local countdown runs as well. Timers need the network to reach the outbox; offline, only the local countdown works.

**Idempotency and retries.** Delivery is at least once: the id is stable, a claimed row returns to `pending` when its claim expires, and a sender that reports twice changes nothing. Duplicates are possible only when a vendor accepted a message but the answer was lost; for reminders that is acceptable.

**Failure never blocks the app.** The SPA never waits on an adapter: everything a reminder points to is already on the phone through sync. Settings shows each adapter's last success and last error from `deliveries`. A dead adapter means no reminder, never a missing checklist.

**One way only.**
- Sinks write and never read back.
- Sources read and write only completion marks in Nestora, at most once per action per day (they record that they ticked, so a manual untick is not undone at the next poll).
- No adapter edits a routine. There is no two-way sync to reconcile, by design.

**Testing without the vendor.**
- A `fakeNotifier` that records reminders and can be told to fail (retryable or not), and a fake clock.
- The dispatcher runs against the in-memory SQLite database the tests already use for sync **[verified, `test/sync-db.ts` runs the migrations on `node:sqlite`]**.
- Each real adapter gets one test of the request it builds, against a recorded fixture, as the Open Library client does **[verified, `test/fixtures/openlibrary/`]**. No test calls a vendor.

**Free-plan budget.**
- 1,440 cron runs a day. Whether they count toward the 100,000 daily requests is not stated; the pricing example counts an hourly cron as 720 requests a month **[verified example, Workers pricing page]**, so assume they count: 1.4 % of the allowance.
- Each run reads the `routine` rows through the `(kind, due_on)` index (about 20 rows) and the due deliveries through their own index. About 30,000 rows read a day, against 5 million **[assumed estimate; limit verified]**.
- CPU is the tight one: 10 ms per cron run on Free **[verified, Workers limits page]**. Encrypting and signing one Web Push message must fit. Measure it in the Web Push PR; at worst send one push per run, or hand the sends to a Queue.
- 50 subrequests per invocation **[verified]**: 10 sends per run is far inside.

### 3.6 The data flow

```
                         Nestora Worker (Cloudflare, Free)
          ┌────────────────────────────────────────────────────────────┐
 phones ──┼─► /api/sync ──► D1 items: routines, actions, done marks    │
 (SPA)    │                     │                                      │
          │                     │ shared rule: occursOn(routine, day)  │
          │   cron * * * * * ───┤                                      │
          │                     ▼                                      │
 timer ───┼─► /api/timers ──► D1 deliveries (outbox) ◄── plan          │
          │                     │                                      │
          │       drain ────────┼──► Notifier: webpush ───────────────────► push service ──► phone
          │                     │    Notifier: telegram ──────────────────► Telegram ──► phone
          │                     │                                      │
          │   /sender/claim, /sender/result ◄──────────────────────────────── sender (pull) ──► WhatsApp
          │                                                            │
          │   /feed/<token>.ics  (Exporter)  ◄──────────────────────────── Google Calendar polls
          │   GET /api/tracker ──► TrackerSource ──► done marks        ◄──── tracker API (read only)
          │   D1 secrets (AES-GCM) ◄── PUT /api/integrations/<id>/secret   │
          └────────────────────────────────────────────────────────────┘
```

### 3.7 One reminder, end to end

The "Bag" checklist (owner B, `MO,TU,WE,TH,FR`, `start_time` 07:15, `remind` on). Partner B has enabled two Notifiers: `webpush` on the phone, and a pulled `sender` for a second channel.

1. **Monday 00:00 UTC (07:00 in Jakarta), plan.** The occurrence 07:15 is inside the 20-minute window. Two rows are inserted: `d1` (adapter `webpush`) and `d2` (adapter `sender`), both `fire_at` 00:15Z, `pending`.
2. **00:15 UTC, drain.** `d1`: the `webpush` adapter loads B's subscription from `secrets`, encrypts the payload `{ title: "Bag", url: "/#/routines/<id>" }`, signs the VAPID token and posts it with `Urgency: high` and a short TTL. The push service answers 201: `d1` → `sent`. `d2` is skipped by the drain.
3. **00:15:40 UTC, the sender polls.** `POST /sender/claim` with its bearer token returns `d2` and marks it `claimed` for 2 minutes. The sender sends "Bag · nestora.atqamz.com/#/routines/<id>" and reports `POST /sender/result { id: "d2", ok: true }`: `d2` → `sent`.
4. **If the sender's machine was off,** `d2` stays `pending` and becomes `dropped` at 00:45Z. B already had the push, and the checklist was on Home all along.
5. **If B uninstalled the app,** the push service answers 410: `d1` → `failed`, the subscription is deleted, and Settings shows "Web Push needs to be enabled again on this phone".

### 3.8 The cost of the abstraction, honestly

| Adds | Count |
|---|---|
| Files | About 8: `shared/routines.ts` (needed anyway), `worker/dispatch.ts`, `worker/integrations/types.ts`, `index.ts`, one per adapter, `worker/feed.ts`, `worker/secrets.ts` |
| Tables | 2 server-only (`deliveries`, `secrets`), 1 migration |
| Settings keys | 2 (`integrations_a`, `integrations_b`) |
| Endpoints | `/api/timers`, `/api/integrations/<id>/secret`, `/api/integrations/status`, `/feed/<token>.ics`; plus `/sender/claim` and `/sender/result` only with a pulled sender |
| Cloudflare | 1 of the account's 5 Cron Triggers **[verified, 5 per account on Free]** |

- **Slice 1 needs none of it:** the Today view, the check-offs, the timetable, local timers and the tracker work with the registry entries alone.
- **The 90 % design:** Today view, local timers with the screen kept awake (§8), and the `.ics` feed. It gives the daily lists, the timetable in Google Calendar and calendar notifications for fixed times, and has no outbox, no cron and no secrets beyond the feed token. What it lacks: a reminder for a timer when the phone is locked, and any reminder outside the calendar.
- **When it is overkill:** with one channel, the "layer" is one `Notifier` interface and one adapter, and should stay that way. The capability types cost a few lines; a registry of adapters, the claim endpoints and the per-type configuration are built only with the second adapter.

### 3.9 Adapter candidates

The research behind each verdict is in §4 to §7.

| Adapter | Capability | Verdict | Deciding facts |
|---|---|---|---|
| `ics` feed | Exporter | **Build first** (slice 2) | Free; subscribing works only from a computer browser **[verified]**; refresh takes hours **[assumed]**; feed alarms are probably ignored **[assumed]** (§5) |
| `webpush` | Notifier | **Build first** (slice 2) | Free and official; the only channel for a timer on a locked phone; iPhone only from the Home Screen, iOS 16.4+ **[verified]**; the 10 ms CPU limit to measure **[verified limit]** (§4.5) |
| `google_calendar` | CalendarSink (and possibly a timer Notifier) | Optional (slice 3) | `calendar.app.created`; "In production" unverified for a few known users; Testing would expire tokens in 7 days **[verified]** (§5.2) |
| Hevy | TrackerSource | Optional, only with Hevy Pro | The API is Pro-only, version 0.0.1, "use it at your own risk" **[verified]** (§7.2) |
| wger.de | TrackerSource | Optional, only if the log moves to wger | Free token API, apps on both phones **[verified]**; the public instance runs a development build **[verified]** (§7.3) |
| `sender` (WhatsApp linked device) | Notifier, pulled | Optional, behind a flag, spare number only | The terms forbid auto-messaging; the library is an RC with stalled merges **[verified]** (§4.4) |
| `email` | Notifier | Not now; later a weekly digest | Free only to verified addresses; sending in beta **[verified]** (§4.6) |
| `telegram` | Notifier | Not built | Free and simple **[verified]**, but the couple do not use Telegram (decided #6) |
| `whatsapp_cloud` | Notifier | Not built | About Rp357 a reminder, a second SIM, a business portfolio, template review **[verified]** (§4.3) |
| `google_tasks` | ChecklistSink | Not built | `due` keeps only the date; no timed alert from the API **[verified]** (§6) |
| Keep through `gkeepapi` | ChecklistSink | **Never** | A master token with full access to the Google account, on a private API **[verified]** (§6) |
| LiftLog backup hook | TrackerSource, pushed | Not built unless the log moves to LiftLog | The signal is "the app was opened after a change" **[assumed]** (§7.3) |

**Recommendation:** build slice 1 with no integration code. Add the `.ics` Exporter next (it is the 90 % design). Build the outbox, the dispatcher and exactly one Notifier (Web Push) only if the couple miss timer reminders after living with slice 1.

---

## 4. Reminder channels

### 4.1 Which timers need the server

| Situation | Where it runs | Why |
|---|---|---|
| A timer while the routine is open on screen | The phone | The countdown is computed from a stored end time, so it survives a re-render or a reload. The Screen Wake Lock API keeps the screen on: supported in Safari on iOS from 16.4 and in Chrome for Android **[verified, caniuse]**, and in Home Screen web apps on iOS from 18.4 ("The Screen Wake Lock API now works in Home Screen Web Apps on iOS and iPadOS 18.4", a WebKit team comment on bug 254545, resolved fixed **[verified]**). A sound plays at zero (the Start tap counts as the user gesture audio needs **[assumed]**) |
| A timer while the phone is locked or the app is in the background | The server | No web API can schedule a future local notification: "The development of Notification Triggers API … has ended" **[verified, developer.chrome.com]**. A `setTimeout` in a suspended iOS web app cannot be relied on **[assumed; no WebKit statement found]** |
| A fixed-time reminder ("07:15, Bag") | The server, or the calendar | Nothing on the phone runs at 07:15 unless the calendar app or a push wakes it |

So every reminder that must reach a phone that is not looking at Nestora needs either a calendar (§5) or a push from the server (§3.5). The lazy middle ground for a long wait is the phone's own clock timer, set by hand **[assumed acceptable]**.

### 4.2 Scheduling on the Cloudflare Free plan

| Tool | On Free | Limits that matter | Fit |
|---|---|---|---|
| **Cron Triggers** | Yes | 5 per account; UTC; every minute works (`* * * * *` is the documented example; no minimum stated); 10 ms CPU per run; changes "may take several minutes (up to 15 minutes) to propagate" **[verified, Cron Triggers and limits pages]** | **Chosen.** One trigger plans and drains the outbox; delay up to about a minute |
| **Queues** | Yes, since 4 February 2026 | 10,000 operations a day, 3 per message (about 3,300 messages); `delaySeconds` up to 24 hours; 24-hour retention on Free **[verified, changelog and limits pages]** | Not needed: the cron already gives minute precision. A fallback if CPU per cron run proves too tight |
| **Durable Objects alarms** | SQLite-backed objects are on Free (100,000 requests a day) **[verified]**. Alarms on Free are not stated; each `setAlarm()` "is billed as a single row written" **[verified footnote; availability assumed]** | One alarm per object at a time; at-least-once, retried with backoff **[verified]** | Exact to the second, but a new class and binding for a precision nobody needs |
| **Workflows** | Yes, `step.sleep` up to 365 days; 3,000 steps a day **[verified]** | Requests shared with the Worker's 100,000 | Overkill for a reminder |
| **D1** | 5 million rows read and 100,000 written a day; 500 MB per database **[verified]** | The outbox adds a few hundred rows a day | Fine |

### 4.3 WhatsApp through the official Cloud API

All **[verified]** on Meta's developer documentation on 24 October 2026 unless marked.

- **What it takes.** A business portfolio, a WhatsApp account, a Meta business app, a display name, and a payment method before business-initiated messages go out in production.
- **The number.** A registered number "cannot be used with WhatsApp Messenger", and "numbers already in use with WhatsApp cannot be registered unless they are deleted first". So the bot needs its own number (a second SIM), never either partner's own. Using one number in the WhatsApp Business app and the API at once is only possible through a Solution Partner or Tech Provider.
- **Templates and the window.** A free-form ("service") message is allowed only within 24 hours of the user's last message to the business. Anything else is an approved template in the marketing, utility or authentication category, and approval "can take up to 24 hours". A reminder is utility only if Meta agrees it is "non-promotional" and "specific to or requested by the user" **[assumed that a routine reminder qualifies]**.
- **Price, per delivered message** (Indonesia rate card effective 1 October 2026): utility Rp356.65 (US$0.025), marketing Rp586.33, service Rp356.65. Since 1 October 2026, utility templates sent inside an open window are charged again, and service messages are free only for the first 1,000 a month per number.
- **What that costs here.** 5 to 15 reminders a day for two people is 150 to 450 a month: about Rp53,000 to Rp160,000 a month as utility templates **[assumed arithmetic on the verified rate]**.
- **Opt-in.** Consent may be general, naming the business; a website form is enough.
- **From a Worker.** One `POST https://graph.facebook.com/v26.0/<PHONE_NUMBER_ID>/messages` with a bearer token: an ordinary `fetch` **[verified shape; assumed to work from a Worker]**. A permanent system-user token would be the Worker secret. Meta allows "1 message every 6 seconds to the same WhatsApp user".
- **The test number.** Meta creates a free test number that sends templates without a payment method **[verified]**, to a small list of recipients (5 according to a retired page **[assumed]**). It is a development tool, not a channel to build on **[assumed]**.

**Verdict:** it works and it is clean, but it is a business product with a monthly bill, a second SIM, template reviews and a Meta business account, for two people. `docs/features.md` reached the same verdict ("hard, not realistic for personal use") **[verified, §6.3]**.

### 4.4 WhatsApp through the free linked-device route

This is how self-hosted assistants such as OpenClaw and Hermes Agent talk on WhatsApp for free. All **[verified]** on their current documentation and repositories on 24 October 2026 unless marked.

**How they connect.**
- **OpenClaw** (release v2026.10.6, 22 October 2026): "production-ready via WhatsApp Web (Baileys). The gateway owns the linked session(s)". Pairing is "QR-only". "A separate WhatsApp number is recommended … but personal-number/self-chat setups are fully supported." Session keys sit in `~/.openclaw/credentials/whatsapp/<accountId>/creds.json`. Its WhatsApp page carries no ban warning.
- **Hermes Agent** by Nous Research (release v0.22.5, 23 October 2026): "a built-in bridge based on Baileys … emulating a WhatsApp Web session — not through the official WhatsApp Business API". It warns that "using a third-party bridge carries a small risk of account restrictions", recommends "a dedicated phone number for the bot (not your personal number)", calls personal self-chat a setup for "testing", and says the session folder "grants full access to the WhatsApp account". It also ships a Cloud API adapter, described as "no account ban risk, but requires a Meta Business account and a public webhook URL".
- **Both** are a Node.js process that holds a WhatsApp Web session as a "linked device" of a phone, paired once by QR code, and must stay running. WhatsApp allows "your phone and up to four other nonphone devices" **[verified, Meta engineering blog]**; the primary phone must come online about every 14 days to keep linked devices connected **[assumed, a search excerpt of WhatsApp's help page, which loads by script]**.

**What it costs.** No fee to anyone **[verified, there is no price in either project or in Baileys]**. The real costs are a machine that is always on, a second number if the advice above is followed (a prepaid SIM in a spare phone, which must stay active **[assumed]**), and maintenance.

**When the machine is off.** OpenClaw: "Outbound sends require an active WhatsApp listener … sends fail fast otherwise." A reminder due while the machine sleeps is lost, unless the caller keeps it and retries. In Nestora the outbox does exactly that (§3.5): an undelivered row waits, then is dropped as stale.

**The risk, with evidence.**
- **WhatsApp's terms** (the non-EU terms that apply in Indonesia): users must not send "bulk messaging, auto-messaging, auto-dialing, and the like" or make "any non-personal use of our Services unless otherwise authorized by us", nor access the service "through automated or other means … in impermissible or unauthorized manners"; WhatsApp "may take action with respect to your account, including disabling or suspending your account" **[verified]**. A self-reminder bot is personal use but it is auto-messaging through an unofficial client.
- **WhatsApp's help pages** call unofficial apps a violation of the terms and describe temporary bans that can become permanent **[assumed, search excerpts; the pages load by script]**.
- **Baileys' own README:** "Do not spam people with this. We discourage any stalkerware, bulk or automated messaging usage."
- **What triggers bans in practice** (open issues, 2026): bulk sending blocked by anti-spam (#2850, 7 October); "Error 463 (Reachout Timelock) Causing Account Bans" when messaging people not contacted before (#2707, 14 July); "Instant Account Restriction (Banned) upon QR Scan" for verified business accounts (#2805, 7 September) **[verified, the issue titles and dates]**. A few messages a day to two people who have chatted with the number before is far from all three patterns, so the risk is lower, not zero **[assumed]**.
- **Breakage after protocol changes:** repeated "405 (client_too_old)" disconnects "once Meta bumped the expected client revision" (#2733, closed 29 July); "Stream Errored (ack) every 50 min" (#2858, open, 14 October); the last commit on the main branch, on 4 August, was itself a fix for a retired web platform **[verified]**.
- **Maintenance state:** the latest Baileys release is v7.0.0-rc14 (29 July 2026), a release candidate tagged `latest` on npm; no pull request has been merged since 5 August while 58 were opened after 1 September **[verified, GitHub]**. whatsapp-web.js (moved to `wwebjs/whatsapp-web.js`) last released v1.34.7 on 24 April 2026, runs a headless Chromium through Puppeteer, and says "it is not guaranteed you will not be blocked" **[verified]**.
- **Self-chat on one's own number** puts the account both partners use every day at risk, and it is not documented whether a message sent by one's own linked device into "Message yourself" even notifies one's own phone **[assumed: probably not, since it is one's own message; not found anywhere]**. So self-chat is the worst of both: the risk lands on the personal account, and the reminder may stay silent.

**Where it could run at zero cost.**

| Host | Cost and catches | Fit |
|---|---|---|
| A Cloudflare Worker or Durable Object | Not possible: "Outgoing WebSockets do not hibernate", an open outbound socket prevents eviction "for up to 15 minutes", and runtime updates give connections "up to 20 minutes to finish" **[verified, Workers and Durable Objects docs]**. Baileys' Node dependencies on the Workers runtime were not checked **[assumed incompatible]** | No |
| Oracle Cloud Always Free | Two AMD micro VMs (1/8 OCPU, 1 GB) or Ampere A1 up to 2 OCPUs and 12 GB **[verified]**. A credit card is required ("we do not accept … virtual, single-use, or prepaid cards"). Instances are reclaimed when, over 7 days, the 95th-percentile CPU, the network and (on A1) memory all stay under 20 % **[verified]**, which an idle reminder bot does **[assumed]** | Free on paper, reclaimable in practice |
| Google Cloud e2-micro | One VM in three US regions only, and a public IPv4 is free for one hour a month, then US$0.005 an hour (about US$3.60 a month) **[verified price; assumed arithmetic]**. A card is required | Not free |
| A small always-on machine at home (a home server, a Raspberry Pi class board) | No fee; runs while home power and internet are up **[assumed]** | **The only honest zero-cost host** |
| A laptop, only while awake | No fee; a 07:15 reminder is lost whenever the lid was closed overnight | Not for morning reminders |

**Verdict:** free in money, not in risk. Running it on either partner's own number is a **bad idea**: it breaks the terms with the account the couple live on, and self-chat may not even ring. On a dedicated prepaid number, from a home machine, it is a tolerable experiment whose failure costs only that spare number; never a foundation.

**If it is tried, this is the shape** (a pulled `sender` Notifier, §3.5). The sender lives outside this repo (it runs elsewhere, with its own dependency and lifecycle) and Nestora never learns anything about WhatsApp:

```
 Nestora Worker (Cloudflare, Free)         home machine, always on              WhatsApp
┌─────────────────────────────┐  HTTPS   ┌─────────────────────────────┐  WA Web  ┌──────────────┐
│ deliveries (outbox)         │◄─────────┤ sender: Node + a WA Web lib │─────────►│ bot number   │──► Partner A
│ POST /sender/claim          │─────────►│ session files (local only)  │          │ (spare SIM)  │──► Partner B
│ POST /sender/result         │◄─────────┤ SENDER_TOKEN, a→number,     │          └──────────────┘
└─────────────────────────────┘ every 60s│ b→number (local env only)   │
                                          └─────────────────────────────┘
 sender down → rows stay pending → dropped after 30 min; the app and Web Push are unaffected
```

- **Secrets.** A random 32-byte `SENDER_TOKEN` lives only in the sender's environment; the Worker holds only its SHA-256 as the secret `SENDER_TOKEN_HASH`. The WhatsApp session folder never leaves the sender. The two phone numbers live only in the sender's configuration: the outbox says `to: "a"`, never a number, so D1 and the repo hold none.
- **Why `/sender/*` sits outside Access:** a headless process cannot do the Google login. The two routes check the bearer token against the hash and do nothing else. Access service tokens are the alternative if a second lock is wanted **[assumed available; not checked]**.
- **The whole contract:**

```http
POST /sender/claim
Authorization: Bearer <SENDER_TOKEN>
{"adapter": "wa-1", "limit": 10}

200 {"deliveries": [{"id": "d2", "to": "b", "title": "Bag", "url": "https://nestora.atqamz.com/#/routines/<id>", "fire_at": "2026-10-26T00:15:00Z"}]}

POST /sender/result
Authorization: Bearer <SENDER_TOKEN>
{"id": "d2", "ok": true}            or   {"id": "d2", "ok": false, "retry": true, "error": "not connected"}

204
```

A claim holds rows for 120 seconds; the sender remembers the ids it sent, so a repeated claim after a lost result is not sent twice. Polling every minute is 1,440 Worker requests a day **[assumed estimate; 100,000 allowed, verified]**.

### 4.5 Web Push from the Worker

- **Protocol.** VAPID signatures use ECDSA on P-256 (RFC 8292), and payloads are encrypted with ECDH on P-256, HKDF-SHA-256 and AES-128-GCM (RFC 8291) **[verified, the RFCs]**. Workers WebCrypto lists ECDSA, ECDH, HKDF and AES-GCM **[verified]**; the page does not name the P-256 curve, which is part of the WebCrypto standard **[assumed supported; one call in `wrangler dev` settles it]**. No library is needed.
- **iPhone.** Web Push works only for web apps added to the Home Screen, from iOS and iPadOS 16.4; permission must be asked "in response to direct user interaction"; every push must show a notification, or "Safari revokes the push notification permission" **[verified, webkit.org and Apple's documentation]**. From iOS 18.4, Declarative Web Push shows a notification from the payload alone, "without requiring an installed" service worker **[verified, webkit.org]**. A push reaches a closed Home Screen app **[assumed; Apple says delivery is attempted when the device is next online]**.
- **Android.** Chrome receives pushes while the browser is closed; the OS wakes it **[verified, web.dev push FAQ]**. Chrome requires a service worker and `userVisibleOnly: true` **[verified, MDN]**.
- **What Nestora lacks.** Nestora has no service worker yet **[verified, no `serviceWorker` reference in `src/`]**. A minimal one with only `push` and `notificationclick` handlers is enough for push; the offline cache of `docs/infra.md` §5.7 is separate work.
- **Push services.** Apple's keeps a message "for 30 days or fewer" while a device is offline, caps the payload at 4 KB, answers 410 when a subscription has expired and 429 when one device gets too many; it publishes no numeric quota **[verified, Apple's documentation]**. A timer reminder is sent with `Urgency: high` and a short TTL, so a late one expires instead of arriving an hour later **[verified, RFC 8030 header semantics]**.
- **Cost.** Free; one subrequest per message **[verified, 50 subrequests per invocation on Free]**.

**Verdict:** the only free, official channel that can deliver "the 10 minutes are over" to a locked phone. Its price is the Home Screen install on the iPhone, a small service worker, and the CPU check in §3.5.

### 4.6 Telegram, email and the calendar feed

- **Telegram bot.** Free for users and developers; `sendMessage` over HTTPS with the bot token; in one chat "avoid sending more than one message per second"; a user must message the bot first **[verified, core.telegram.org]**. Technically the cheapest server channel. The couple do not use Telegram **[verified, decided #6 in `docs/features.md` §8.4]**.
- **Email.** Cloudflare Email Service sends free to verified destination addresses on every plan; arbitrary recipients need Workers Paid; sending is in beta; the sender address must be on a domain onboarded to Email Service **[verified, developers.cloudflare.com]**. Gmail is a channel the couple read (decided #6), but a 07:15 email is a weak alarm **[assumed]**. Good for a weekly digest, not for timers.
- **The `.ics` feed.** Zero risk, zero cost, and Google Calendar's own notifications then do the reminding, subject to the feed's limits (§5).

### 4.7 Comparison for two people and 5 to 15 reminders a day

| | WhatsApp Cloud API | WhatsApp linked device (free route) | Web Push | Telegram bot | `.ics` feed |
|---|---|---|---|---|---|
| Money | About Rp53,000 to 160,000 a month **[verified rate, assumed volume]** | Free, plus a spare SIM and a home machine | Free **[verified]** | Free **[verified]** | Free |
| Setup | Business portfolio, second SIM, display name, payment method, template approval **[verified]** | A spare number on a spare phone, QR pairing, an always-on Node process **[verified]** | VAPID keys, a small service worker, "Add to Home Screen" on the iPhone **[verified]** | A bot token; each partner starts the bot once **[verified]** | A feed URL, added once from a computer browser (§5) |
| 24-hour window | Templates outside it, charged inside it too since 1 October 2026 **[verified]** | None | None | None | None |
| Account risk | None | Against the terms ("auto-messaging"); bans reported for bulk and cold messaging **[verified]**; lower for a few messages to known contacts **[assumed]** | None | None | None |
| Uptime depends on | Meta | The home machine, its internet, and the library keeping up with WhatsApp | The push services and the cron | Telegram and the cron | Google's refresh (hours, §5) |
| Timer when the phone is locked | Yes | Yes, while the sender runs | Yes (iPhone: Home Screen app only) | Yes | No |
| Couple read it (decided #6) | Yes | Yes | Not a stated channel | No | Yes |
| Maintenance | Low; templates rarely change | High: an RC library with stalled merges and protocol breaks in 2026 **[verified]** | Low | Low | None |

### 4.8 Recommendation and the staged plan

**Should a two-person app do WhatsApp at all?** Not automatically. WhatsApp is where the couple read messages (decided #6), but both WhatsApp routes cost something real: money and a business setup, or the account. The existing user-triggered "share to WhatsApp" link stays the WhatsApp feature **[verified, `docs/features.md` §5.1]**.

**Decision: a staged plan, each stage useful alone.**
1. **Slice 1, no channel.** The Today view and local timers. Many routines need no reminder once they are on Home every morning **[assumed]**.
2. **The `.ics` feed** (an Exporter): fixed times and the timetable in Google Calendar, with Google's own notifications. Zero risk (§5).
3. **Web Push** (the first Notifier) through the outbox, for timers on a locked phone and exact fixed-time reminders. Free and official. On the iPhone it needs the app on the Home Screen.
4. **Optional, behind a flag: a WhatsApp sender** on a dedicated spare number, on a home machine, pulling from the outbox (above). Only if the operator accepts that the spare number can be banned at any time and that the terms forbid it. **Never on either partner's own number.**
5. **Not built:** the WhatsApp Cloud API (a business product with a monthly bill for two people), Telegram (not read by the couple), and email as a reminder channel (fine later for a weekly digest).

*Trade-off:* the channel the couple read most, WhatsApp, comes last and is optional. In exchange nothing in Nestora depends on a library that breaks with WhatsApp's protocol, and nobody's account is at stake.

---

## 5. Google Calendar

### 5.1 The two options

| | A. A read-only `.ics` feed (an Exporter) | B. The Calendar API (a CalendarSink) |
|---|---|---|
| How | The Worker serves `/feed/<token>.ics`; each partner subscribes once | The Worker creates a "Nestora" calendar in each partner's account and keeps its events equal to Nestora's |
| Adding it | "To subscribe to a new calendar, you must use a computer web browser. You can't subscribe … in the Google Calendar app for Android, iPhone, or iPad" **[verified, Google Calendar Help]** | Each partner signs in to Google once from Settings and passes the unverified-app screen (below) |
| Delay after an edit | Not published by Google **[verified: absent from the help pages]**; third parties report 8 to 24 hours, sometimes 48 **[assumed]** | Seconds; one API call per change **[assumed]** |
| Alerts | Alarms (`VALARM`) inside a subscribed feed are reported as ignored **[assumed: third-party docs and a Google community thread; nothing official]**. Notification settings are personal and "your calendar-level settings determine your notifications for new events" **[verified]**, so each partner sets the subscribed calendar's default alert once **[assumed possible for a subscribed calendar]** | Per-event popup or email reminders, at most 5 overrides, 0 to 40,320 minutes before **[verified]**. "Reminders are private information, specific to an authenticated user" **[verified]**, so each partner's own token writes their own events |
| Tasks (`VTODO`) | Not shown by Google Calendar **[assumed: no official statement; third-party docs say unsupported]**. The feed emits only `VEVENT`s | Not applicable |
| Exposure | The feed URL is a secret link; whoever has it reads the titles. It must sit outside Access because Google's servers fetch it **[assumed]**. Private routines are left out (§9) | Events live in each partner's Google account |
| Cost | One route, one token per partner, no Google project | OAuth client, consent screen, encrypted refresh tokens, a refresh and re-consent path |

### 5.2 OAuth facts for option B

All **[verified]** on Google's documentation on 24 October 2026 unless marked.
- **Scope.** `https://www.googleapis.com/auth/calendar.app.created`: "Make secondary Google calendars, and see, create, change, and delete events on them." `calendars.insert` and `events.insert` accept it. It cannot read or change any other calendar. Sharing the app's calendar through `acl.insert` needs a broader scope, so each partner gets their own "Nestora" calendar (or shares it by hand).
- **Sensitivity.** No Calendar scope is restricted; Google names "reading events stored in Google Calendar" as an example of a sensitive scope. Whether `calendar.app.created` is classed as sensitive is not stated **[assumed sensitive; a forum post says the console picker does not list it]**.
- **Testing status is useless here:** an external app "with a publishing status of "Testing" is issued a refresh token expiring in 7 days", unless it asks only for name, email and profile.
- **The personal-use path:** "if you are the only user of your app or if your app is used by only a few users, all of whom are known personally to you", publish the app "In production" without verification, and each user advances "through the unverified app screen", with a cap of 100 new users. Refresh tokens are then not limited to 7 days **[assumed, derived: the 7-day rule is stated only for Testing]**; they still die after 6 months unused **[verified]**.
- **Access cannot be reused.** Cloudflare Access passes the Worker a JWT with the email and identity claims; no Google API token is listed among them **[verified, the Access application-token page]**. Access logins ask only for sign-in scopes, so they stay unaffected **[assumed]**. A Calendar connection is therefore its own consent flow: `GET /api/integrations/google/start` and a callback under `/api/*`, which Access already protects.
- **Quota and price.** 600 requests per minute per user; "All standard use of the Google Calendar API is available at no additional cost", with charges for exceeding quotas "planned … later in 2026".

### 5.3 Mapping routines and the timetable to iCalendar

Both options produce the same events, from the shared rule of §2.3.

| Nestora | iCalendar (`.ics`) and the API's `recurrence[]` |
|---|---|
| Item id | `UID` (`<id>@wp.atqamz.com`); `SEQUENCE` from `rev`; `LAST-MODIFIED` from `updated_at`, as already decided **[verified, `docs/features.md` §6.1 #7]** |
| A `block` `MO` 09:00–12:00 at Place A | `DTSTART;TZID=Asia/Jakarta:20261026T090000`, `DTEND;TZID=Asia/Jakarta:20261026T120000`, `RRULE:FREQ=WEEKLY;BYDAY=MO`, `LOCATION:Place A` |
| An open end ("18:30–…") | No `DTEND`: "the event ends on the same calendar date and time of day specified by the "DTSTART" property" **[verified, RFC 5545 §3.6.1]**, and "open end" in the description |
| A routine with `start_time` 07:15, `days` `MO,TU,WE,TH,FR` | One event, `DURATION:PT15M`, `RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR`. A routine without `start_time` is not in the calendar |
| `every_weeks` 2 from a given Sunday | `RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU;WKST=MO`, with `DTSTART` on the first occurrence. `WKST` matters "when a WEEKLY RRULE has an interval greater than 1" and defaults to `MO` **[verified, RFC 5545]**; it is written out so the calendar counts weeks as the shared rule does |
| `until` | `UNTIL` in UTC, because with a `TZID` start "the UNTIL rule part MUST be specified as a date with UTC time" **[verified, RFC 5545]** |
| `paused_until`, holidays | `EXDATE;TZID=Asia/Jakarta:` for each occurrence inside the pause or on a holiday, within the feed's horizon. In the API an `EXDATE` "must point to a valid instance generated by the recurrence rule" **[verified]** |
| The time zone | A `VTIMEZONE` for `Asia/Jakarta` with one `STANDARD` part at +0700, since one "MUST be specified for each unique TZID" **[verified, RFC 5545]**; in the API, `start.timeZone`, which "for recurring events … is required" **[verified]**. No daylight saving time, so no transitions **[assumed, tzdata]** |

The feed carries the last 7 days and the next 90; series are cut there with `UNTIL` **[assumed horizon, enough for a calendar view]**.

### 5.4 Decision

**Decision: option A, the `.ics` feed, in slice 2.** It puts the timetable and the fixed-time routines into the calendar the couple already read, with zero accounts, zero tokens beyond the feed link and zero lock-in. A timetable changes once a term, so a delay of hours does not matter.
*Trade-off:* hours of delay after an edit, and alarms that probably depend on each partner's default alert for the subscribed calendar.

**Option B, only if** a partner misses edits or exact alerts, with the minimum scope `calendar.app.created`, published "In production" unverified under the personal-use path, one "Nestora" calendar per partner, one-way. The same adapter could also act as a `Notifier` for timers (a one-off event with a 0-minute popup in the Nestora calendar), which would reach both phones through the Google Calendar app without a Home Screen install **[assumed: the speed of Google's sync to the phone is not documented]**.

---

## 6. Google Keep, Google Tasks and checklists

**Google Keep.** The Keep API is "used to create apps allowing enterprise administrators to manage Google Keep notes", through "domain-wide delegation using a service account or an OAuth client ID" granted "in the Google Workspace Admin console by a super administrator account" **[verified, developers.google.com/workspace/keep]**. No page says in so many words that personal Gmail accounts are excluded **[assumed excluded: every path needs a Workspace admin]**.

**Unofficial Keep access.** `gkeepapi` "uses the (private) mobile Google Keep API" through `gpsoauth`, which "poses as a Google app" and needs a master token, so called "because they have full access to your account"; "Google occasionally ramps up changes to the Keep data format" **[verified, gkeepapi documentation and gpsoauth README]**. A token with full access to a Google account would have to sit in the Worker, for a private API in Python. **Not an option.**

**Google Tasks.** Available to personal accounts; scopes `tasks` and `tasks.readonly`; a courtesy limit of 50,000 queries a day **[verified]**. Two facts rule it out for Nestora's checklists:
- On `due`, "only date information is recorded; the time portion of the timestamp is discarded" **[verified, the Task resource reference]**, and Tasks notifies only when "you add a date and time to your task" **[verified, Tasks Help]**. So a task created through the API cannot ring at 07:15 **[assumed, derived]**.
- A list shared between two personal accounts is not a documented feature; shared tasks exist only in Workspace spaces and documents **[assumed from the help page's silence]**.

**What is left.**
- **The checklist stays in Nestora.** That is the core of slice 1, with a daily reset no external list app offers for free.
- **A Keep link.** `keep.new` creates a new note **[verified, Google Registry's `.new` list]**. Prefilling its text is not documented **[assumed unsupported]**.
- **Copy or share as text.** A "Share" button on a checklist sends its lines through the phone's share sheet into Keep, WhatsApp or anywhere, user-triggered, the route `docs/features.md` §5.1 already chose for Keep **[verified]**.
- **An `.ics` `VTODO`** is not shown by Google Calendar (§5.1), so it is no route either.

**Decision: no `ChecklistSink` adapter.** The interface is defined (§3.2) so the shape is settled, but nothing implements it. Keep remains a place the couple can paste a list into.

---

## 7. The training tracker and the training app

### 7.1 What Nestora keeps

Only the light tracker of §2.5: a day type per weekday (Lower, Upper, Rest) and a few daily items, ticked like any checklist. It is plain data in the open core and ships in slice 1. Exercises, sets, reps, weights and history stay in a training app. No per-set logs, rest timers or progress history are designed here.

**Out of scope, and reasons to leave Nestora:** body measurements, health metrics, nutrition logs and anything medical. They grow a history, they are health data with their own privacy rules, and dedicated apps already do them well. If the couple ever want them in one place, that is a separate, private app, never the public-repo household hub **[assumed judgement]**.

### 7.2 Hevy: what is free and what is paid

- **The API is for Hevy Pro only.** The official API description says: "Currently, this API is only available to Hevy Pro users. You can get your key on our web app at https://hevy.com/settings?developer." It also says: "we make no guarantees that we won't completely change the structure or abandon the project entirely so use it at your own risk." Version `0.0.1` **[verified, the OpenAPI description served at api.hevyapp.com/docs]**.
- **Authentication:** an `api-key` header carrying a UUID. No OAuth flow is published **[verified, same description]**.
- **Endpoints:** workouts (list, `count`, `events` since a date, get, create, update), routines, routine folders, exercise templates, exercise history, body measurements and user info. Workouts come 10 per page at most. The description asks clients not to poll "exactly at xx:00" and states no rate limit **[verified]**.
- **Webhooks:** none in the official description. A third-party SDK documents a webhook subscription that posts when a workout is created **[assumed, not in the official spec read]**.
- **Free versus Pro:** the free plan allows 4 routines, 7 custom exercises and 3 months of history; Pro removes those limits **[assumed: a search excerpt of Hevy's help page; the page returned a bot challenge to a direct read]**. Pro costs about US$2.99 a month, US$23.99 a year or US$74.99 once **[assumed, third-party reviews]**.
- **Export:** Profile, Settings, "Export & Import Data", "Export Data", then workouts or measurements, as CSV **[assumed: the same help-centre excerpt]**. No Pro requirement is mentioned for it **[assumed]**. A manual CSV is no live signal for a daily tick.
- **Terms for the API:** none found beyond the description's disclaimer **[verified absence in the description]**.

**What Nestora would do with it, if a partner has Pro:** a `TrackerSource` that calls `GET https://api.hevyapp.com/v1/workouts/events?since=<the routine day's start in UTC>&page=1&pageSize=10` and, when an updated workout starts on the routine day, ticks the step bound to it ("Workout logged in the training app"). It runs when the Today view opens (one subrequest through a small Worker route) rather than on a cron, so nothing polls while nobody looks. The key is a runtime secret, encrypted in the `secrets` table (§3.3). The body-measurement endpoints are never called.

### 7.3 Open-source trackers instead

Checked on 24 October 2026 through public repository metadata (GitHub and Codeberg APIs), READMEs, documentation and app-store listings **[verified unless marked]**:

| Project | License | Latest release; last commit | Stars | Phones | Day types or weekday plans | API or export | State |
|---|---|---|---|---|---|---|---|
| **wger** (server and Flutter app) | AGPL-3.0 | server 2.7 (3 Sep), app 2.1.1 (3 Oct); 23 Oct | 7,177 and 989 | Android and iPhone (App Store, free, iOS 15+); offline mode since app 2.0.0 | Training days with a name and a rest-day flag; routines can be fitted into a week **[weekday mapping assumed from the setting's name]** | REST with a personal `Token` key, free on the public wger.de **[account free: assumed]**; CORS `*` | Active |
| **LiftLog** | AGPL-3.0 | 4.24.1 (19 Oct); 23 Oct | 598 | Android and iPhone; data on the device | Plans as lists of days, no weekday field **[assumed from its format]** | No API; can POST its own backup to a URL with an `X-API-Key`; CSV and JSON export | Active |
| **Liftosaur** | AGPL-3.0 | no GitHub releases (iOS build 124, 13 Oct); 23 Oct | 758 | Web app with store wrappers | Yes | REST, **premium only** | Active, but paywalled like Hevy |
| **Flexify** | MIT | 2.2.36 (23 Oct); 23 Oct | 451 | Android and web; **no iPhone app** found | Plans tied to weekdays | CSV and database export | Active |
| **Ryot** | GPL-3.0 | v10.5.0 (22 Aug); 18 Oct | 3,647 | Self-hosted web only | Yes | GraphQL, self-host only; imports Hevy | Active |
| **Workout Tracker** (jovandeginste) | MIT | v2.10.1 (15 Oct); 15 Oct | 1,250 | Self-hosted web | Weak | REST with an API key, self-host only | Active |
| **FitTrackee** | AGPL-3.0 | v1.3.6 (11 Oct); 21 Oct | 1,174 | Self-hosted web | No (GPS activities) | REST, OAuth2 | Active, wrong fit |
| **FitoTrack** | GPL-3.0-or-later | v16.3 (22 Aug); 15 Oct | 434 | Android only | No (cardio) | File export | Active, wrong fit |
| **OpenTracks** | Apache-2.0 | v4.29.0 (28 Sep); 21 Oct | 145 | Android only | No (cardio) | An Android intent API | Active, wrong fit |

**Must not be chosen:** Massive (Flexify's predecessor, archived, last push 29 August 2025) and `jessedelira/gym-tracker` (archived, 23 July 2025) are dead; FitNotes is closed source; Liftosaur's API is paywalled; Flexify has no iPhone app, and one partner uses an iPhone (decided #2); FitoTrack, OpenTracks and FitTrackee track cardio or GPS, not gym days; Ryot and Workout Tracker need a self-hosted server and have no native iPhone app **[verified facts; the verdicts are judgement]**.

**The integration shape for the two viable ones.**
- **wger on wger.de (pull):** `GET https://wger.de/api/v2/workoutsession/?datetime_start__date=<day>&limit=1` with `Authorization: Token <key>`; `count > 0` means a session was logged that day **[verified, the live OpenAPI schema; unauthenticated calls return 403]**. One key per partner, stored as a runtime secret. Caveat: wger.de runs `2.8.0-dev.1`, a development build, so field names may move; the date filter's time zone was not tested **[assumed]**.
- **LiftLog (push):** the app posts its backup to a Worker URL (outside Access, like the feed) with the partner's key when it opens after a change. The Worker would record only "backup received at" per partner, never the file **[assumed: parsing a SQLite backup inside 10 ms of CPU is unrealistic]**. The signal means "the app was opened after a change", which is weaker than "a workout today".

(Method: read-only GET requests to public pages, repository APIs and the wger.de schema, one unauthenticated GET to a wger.de list endpoint (answered 403), and two CORS preflight requests, `OPTIONS` with no body, to wger.de and liftosaur.com to read their CORS headers. No account, key or data was sent.)

### 7.4 Decision

**Decision: no integration. Nestora keeps the day type and a manual tick with an "Open" link to whichever training app a partner uses** (Hevy's free plan included).
- **Benefit lost:** one tap a day.
- **What an integration would cost:** a paid plan (Hevy Pro, Liftosaur premium) or a move of the training log to another app (wger), a key per partner, a source adapter, and an API that says it may change or vanish (Hevy) or runs a development build (wger.de).
- **If a partner already pays for Hevy Pro and wants the auto-tick:** the Hevy `TrackerSource` of §7.2 is one small PR in slice 3. **If they would switch apps for it:** wger on wger.de, the only free, maintained option with phone apps on both platforms and a documented API.

| Option | Effort | Fragility | Benefit to two people |
|---|---|---|---|
| **Manual tick and an "Open" link** | None beyond slice 1 | None | Works with any app, Hevy's free plan included |
| Hevy `TrackerSource` | 1 PR, plus Hevy Pro for each partner who wants it | An API that "may … abandon the project entirely" **[verified]** | Saves one tap a day |
| wger.de `TrackerSource` | 1 PR, plus moving the training log to wger | A development build on the public instance **[verified]** | Saves one tap a day; free |
| LiftLog backup hook | 1 PR, plus moving the log to LiftLog | A weak signal **[assumed]** | "Opened the app today", not "trained today" |

*Trade-off:* the tracker cannot know on its own that a workout happened. For a two-person household that ticks a checklist anyway, that is a fair price for zero secrets and zero fragility.

---

## 8. UX direction

**Where routines live.** A "Today" block on Home, under the countdown hero and above "Due soon and late"; `#/routines` for the full list ("Yours", "Shared", "Theirs"), the timetable and editing; `#/routines/<id>` for one routine. No new tab (§1).

**Tokens.** Only existing ones **[verified, `src/tokens.css`]**: rows of at least `--row-min`, targets of at least `--target-min`; progress arcs and the running timer in `--signal` (the rose) on `--surface-2`; a finished routine's row in `--ink-2` with a check; time blocks with `--tint-a` for the partner's and `--tint-b` for one's own; `--font-display` at `--stretch-display` for the timer digits. No new colour.

**Today on Home**
```
┌──────────────────────────────────────┐
│ nestora               ✓     (A)(B)   │
│ ╭──────────────────────────────────╮ │
│ │  the countdown hero, unchanged   │ │
│ ╰──────────────────────────────────╯ │
│ Today · Mon 26 Oct                   │
│ Morning                              │
│ ◕ Morning routine         3 of 4   › │
│ Training · Lower                     │
│ ◑ Training                2 of 4   › │
│ On demand                            │
│ ○ Bag                     0 of 5   › │
│ Evening                              │
│ ○ Evening · laundry       0 of 3   › │
│ Them today                           │
│   09:00–12:00  Class · Place A       │
│                      All routines ›  │
│                                      │
│ Due soon and late                    │
│ …                                    │
├──────────────────────────────────────┤
│ Home   Money   ( + )   People  Books │
└──────────────────────────────────────┘
```

**A routine, with ticks and a timer**
```
┌──────────────────────────────────────┐
│ ‹ Today                          ⋯   │
│ Evening · laundry                    │
│ Mon · Thu · Evening · You            │
│                                      │
│ ☑ Load the washer                    │
│ ☐ Wash cycle               ⏱ 45 min  │
│ ☐ Hang the laundry                   │
│                                      │
│ [ Start ]                            │
│ Last done Thu                  Edit  │
└──────────────────────────────────────┘
```

**Start mode on a phone.** One action per screen, large type, the next one named underneath. A timer counts down from its end time and keeps the screen awake. "Done" ticks and moves on; "+5 min" extends; leaving the app keeps the timer, and with a Notifier enabled the server reminds at zero (§4.1).
```
┌──────────────────────────────────────┐
│ Evening · laundry          2 of 3  ✕ │
│                                      │
│ Wash cycle                           │
│                                      │
│               38:12                  │
│      ━━━━━━━━━━━━━━━━━━━━━━━━━       │
│                                      │
│ Next: Hang the laundry               │
│                                      │
│ [ +5 min ]   [ Pause ]   [ Done ✓ ]  │
│ Screen stays on                      │
│ Remind me if I leave the app   ( ● ) │
└──────────────────────────────────────┘
```

**The weekly timetable**
```
┌──────────────────────────────────────┐
│ ‹ Routines                       ⋯   │
│ Weekly timetable · Them              │
│ Until 19 Dec · skips holidays        │
│  Mo  Tu  We  Th  Fr  Sa  Su          │
│  ▮       ▮       ▮                   │
│ Monday                               │
│ 09:00–12:00   Class        Place A   │
│ Wednesday                            │
│ 13:00–17:00   Work         Place B   │
│ Friday                               │
│ 18:30–…       Meeting      Place B   │
│ + Add a block                        │
│ Pause until…                         │
└──────────────────────────────────────┘
```

**The edit sheet**
```
┌──────────────────────────────────────┐
│ Edit routine                      ✕  │
│ Name  [ Evening · laundry          ] │
│ Whose ( You ) ( Them ) ( Both )      │
│ When  ( Morning )(●Evening)( Other ) │
│ Days  [M][T][W][T][F][S][S]          │
│ Every (●1 week)( 2 )( 4 weeks )      │
│ Starts at [ 20:30 ]  Remind me ( ○ ) │
│ Only me ( ○ )   (set once, §9)       │
│                                      │
│ ≡ Load the washer            step  ✕ │
│ ≡ Wash cycle       ⏱ 45     timer  ✕ │
│ ≡ Hang the laundry           step  ✕ │
│ + Step   + Timer   + Item   + More   │
│                                      │
│ [ Duplicate for other days ]         │
└──────────────────────────────────────┘
```

**How the reset feels.** Nothing happens at midnight on screen. The next morning a list is simply fresh, with a quiet "Last done Thu" under it, derived from the marks. There is no "you missed yesterday".

**The tracker** shows "Training · Lower" as its header on Today, and a seven-day strip on its detail (Mo Lower, Tu Upper, We Rest, …) computed from the `day_type` actions, with today highlighted. Ticks are the same as any routine.

**What stays out.** Streaks, points, badges, confetti, completion percentages over time, "you missed", repeated nagging, and any view of what the partner has or has not ticked beyond the shared routines. These are the patterns `docs/features.md` §8.1 rules out **[verified]**.

---

## 9. Privacy and the public repo

- **No people, places or health detail in the repo.** Code, fixtures, tests, docs and commit messages use only Partner A and Partner B, Place A and Place B, and invented neutral routines like those in §2.5. No product or brand names of any kind, no quantities or plans taken from real life, no medical words.
- **The operator's routines are typed into the app at runtime** and travel only through `POST /api/sync` into D1. A pasted list kept as a file lives outside the repo (for example `~/wp-private/`). `.gitignore` ignores `wp-private/`, `*.csv` and `export-*.json` but not `*.txt` or `*.md` **[verified, `.gitignore`]**, so a note saved inside the worktree shows up in `git status`.
- **Diet, training and personal care are private even inside the app.** Nestora decided that everything is visible to both partners and built no "private to me" items (decided #4, X6), with "either partner asks later" as the reason to reconsider **[verified, `docs/features.md` §8.1]**. A routine's `private` flag reopens that narrowly:
  - The Worker filters a private routine and its actions out of `GET /api/sync` and the export for the other partner: the row is skipped when it, or its parent, is private and owned by the other side (a primary-key lookup per changed row) **[assumed cost, small]**.
  - The Worker rejects any mutation by the other partner on those rows.
  - `private` is set only at creation. Turning a shared routine private later cannot pull its rows back from the other phone; "make private" is "duplicate as private, delete the shared one".
  - A UI-only filter would not be privacy: every row would still sit in the other phone's IndexedDB and export.
  - The Cloudflare account owner can still read D1 in the dashboard. Private means private between the two app users.
  - **Shipped in PR 33 (what the filter does not hide, accepted).** A partner's private write moves the global `rev` that the other partner's pull, push response and export report, with no row behind it: the other partner can tell that some write happened and when, never what or in which routine. A per-side `rev` was rejected: it changes the cursor meaning of all sync and a client with an old cursor can lose rows. A create on the id of a hidden row answers 404 while a create on an absent id succeeds; telling them apart needs the other partner's random UUID. The routine day is fixed to UTC+7 with a 04:00 cut-off.
  - **Shipped in PR 33 (the browser).** The server filter is not enough on a browser profile that both partners use, because the local cache would still hold the other partner's rows. The client keeps one local database per side (`wp-a`, `wp-b`), opened only after the server confirms the side; the Worker rejects a request whose side header (or export `side=`) differs from the signed-in side with a 409 before touching the database; an unconfirmed or mismatched tab is read-only. Details and the trade-offs are in the README, "Sync and privacy limits".
- **Recommended default:** the training tracker and any personal-care routine private; the bag checklist and the timetable shared. Each routine chooses once, at creation (open question 1).
- **What leaves the app.** A reminder carries the routine's title and a link, never its actions. A private routine sends a neutral title ("A routine is due") to any external channel, and is left out of the calendar feed. A WhatsApp or Telegram message, a push payload and a calendar event are all copies held by a third party.
- **No secrets in the repo or the bundle.** Tokens and keys are Worker secrets or encrypted rows (§3.3), never `VITE_` variables and never in `.dev.vars.example`.

---

## 10. Phasing

| Slice | PR | Content | Size |
|---|---|---|---|
| **1. The open core, no adapters** | 1 | Registry: `routine` and the seven action kinds; the `time` and `days` types; per-kind `refs`; `shared/routines.ts` (`occursOn`, the routine day, tick rules) with `node --test`; the `private` flag enforced in the Worker's pull, push and export, with tests | M |
| | 2 | `#/routines` and `#/routines/<id>`: ticks and counters, the edit sheet with the kinds, Duplicate, Pause until; the Today block on Home; routines left out of Lately | M to L |
| | 3 | Start mode: one action per screen, countdown from an end time, Screen Wake Lock, a sound; the tracker's seven-day strip | S to M |
| | 4 | Timetable: editing `block`s, the week view, "Them today" on Home | S to M |
| **2. The first Exporter, the dispatcher, the first Notifier** | 5 | The `.ics` feed at `/feed/<token>.ics`: `run_worker_first` gains `/feed/*` (today `/api/*` and `/design/*` **[verified, `wrangler.jsonc`]**), a token per partner created and rotated in Settings, `VTIMEZONE`, the RRULE mapping tested against fixture files | S to M |
| | 6 | Migration `0002` (`deliveries`, `secrets`); the capability types; the planner and the drain in `scheduled`; a fake Notifier; `/api/timers`; Settings "Reminders" with each adapter's status; the Cron Trigger | M |
| | 7 | Web Push: the VAPID key as a Worker secret, a minimal service worker (push and click only), subscribing from a tap, the declarative payload on iOS 18.4 and later, cleanup on 410, a CPU measurement | M |
| | (7b) | Optional, behind a flag: `/sender/claim` and `/sender/result` for a WhatsApp sender that lives outside this repo | S |
| **3. Calendar and tracker adapters, each on demand** | 8 | Google Calendar `CalendarSink`: the OAuth start and callback, `calendar.app.created`, the encrypted refresh token, full-replace publishing, re-consent when a token dies. Only if the feed falls short | M |
| | 9 | A `TrackerSource` (Hevy for a Pro user, or wger.de) behind the "Open" step; only if the manual tick annoys | S to M |

Slices 1 and 2 are 7 PRs; slice 3 adds 0 to 2. No slice needs a paid plan. Slice 2 uses one more Cron Trigger and one migration; slice 3 a Google Cloud project.

**Risks, most important first.**
1. **Reminders that do not fire on the iPhone.** Push needs iOS 16.4 or later, the app on the Home Screen and permission from a tap **[verified]**; Focus modes and per-app notification settings can still silence it **[assumed]**. The Wake Lock in the installed app needs iOS 18.4 **[verified]**. Mitigation: everything is on Today anyway, and the calendar feed does not depend on Nestora at all.
2. **CPU per cron run.** 10 ms on Free **[verified]**, and a push needs ECDH, HKDF, AES-GCM and an ECDSA signature. Measured in PR 7; at worst one push per run, or a Queue.
3. **The private filter is new server logic.** A bug would put a private routine on the partner's phone. It ships with its own tests in PR 1.
4. **Google OAuth.** The unverified-app screen, tokens that die after 6 months unused, an undocumented sensitivity for the narrow scope, and charges for exceeding quotas planned for later in 2026 **[verified facts]**. Only slice 3 is exposed.
5. **WhatsApp policy.** The terms forbid auto-messaging, the library breaks with protocol changes, and a ban would hit the number used **[verified]**. Only the optional flag is exposed, and never a personal number.
6. **Nagging.** Reminders can hinder habit forming **[verified as cited in `docs/features.md` §8.1]**. Every reminder is opt-in per routine; nothing reminds about the partner.

**What would make a separate app or repo the better call.**
- **Health data grows:** measurements, nutrition, symptoms. A different privacy and retention rule, better served by a dedicated private app than by a public-repo household hub.
- **Exact alarms become essential** (something that must ring at the minute, every time): a native app, because a web app cannot schedule a local notification (§4.1).
- **More people:** someone beyond the two partners needs routines of their own; `a`, `b` and `both` assume two.
- **The WhatsApp sender**, if built, already lives in its own repo: it runs on another machine, with a dependency Nestora must not carry.

---

## 11. Open questions for the operator

Each has a default, so the work can go on unanswered.

1. **Should training, diet and personal-care routines be private to their owner** (enforced by the Worker, set once at creation), reopening decided #4 for routines only? *Default:* yes for those; the bag checklist and the timetable are shared.
2. **After slice 1, which reminder channel:** only the calendar feed, or Web Push too, which means installing Nestora on the iPhone's Home Screen? *Default:* the feed in slice 2; Web Push built only if timer reminders are missed after two weeks with slice 1.
3. **WhatsApp:** accept no automatic WhatsApp, or try the sender on a spare number from a home machine, knowing that the terms forbid it and the number may be banned? *Default:* no automatic WhatsApp, the share link stays, and never a personal number.
4. **The training app:** a manual tick plus an "Open" link, or an auto-tick that needs Hevy Pro (or moving the log to wger)? *Default:* manual tick and link, no integration.
5. **Is a history of ticks wanted** ("how many training days this month")? *Default:* no; the marks reset daily and the `completions` table of §2.4 waits until the question is asked twice.

---

## Appendix: sources checked on 24 October 2026

- **Cloudflare:** [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [subrequests changelog](https://developers.cloudflare.com/changelog/post/2026-02-11-subrequests-limit/), [Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/), [Queues on Free](https://developers.cloudflare.com/changelog/post/2026-02-04-queues-free-plan/), [Queues limits](https://developers.cloudflare.com/queues/platform/limits/), [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/), [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [alarms](https://developers.cloudflare.com/durable-objects/api/alarms/), [WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/), [Workflows pricing](https://developers.cloudflare.com/workflows/reference/pricing/) and [limits](https://developers.cloudflare.com/workflows/reference/limits/), [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and [limits](https://developers.cloudflare.com/d1/platform/limits/), [Email Service](https://developers.cloudflare.com/email-service/), [its pricing](https://developers.cloudflare.com/email-service/platform/pricing/) and [send bindings](https://developers.cloudflare.com/email-service/configuration/send-bindings/), [Access application token](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/), [Access with Google](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/).
- **Web Push and timers:** [RFC 8030](https://www.rfc-editor.org/rfc/rfc8030.html), [RFC 8291](https://www.rfc-editor.org/rfc/rfc8291.html), [RFC 8292](https://www.rfc-editor.org/rfc/rfc8292.html); WebKit: [Web Push on iOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [Meet Web Push](https://webkit.org/blog/12945/meet-web-push/), [Safari 18.4](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/), [Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/), [bug 254545](https://bugs.webkit.org/show_bug.cgi?id=254545); [Apple: sending web push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers); [web.dev push FAQ](https://web.dev/articles/push-notifications-faq) and [protocol](https://web.dev/articles/push-notifications-web-push-protocol); [MDN PushManager.subscribe](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe); [Notification Triggers](https://developer.chrome.com/docs/web-platform/notification-triggers); [caniuse: Wake Lock](https://caniuse.com/wake-lock).
- **WhatsApp, official:** Meta developer documentation: [about the platform](https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform), [phone numbers](https://developers.facebook.com/documentation/business-messaging/whatsapp/business-phone-numbers/phone-numbers), [business app users](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users), [display names](https://developers.facebook.com/documentation/business-messaging/whatsapp/display-names), [messaging limits](https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits), [pricing](https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing) with its Indonesia rate cards, [template review](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-review), [opt-in](https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in), [sending messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages).
- **WhatsApp, unofficial:** [WhatsApp Terms of Service](https://www.whatsapp.com/legal/terms-of-service); WhatsApp help pages on [bans](https://faq.whatsapp.com/1848531392146538/), [unofficial apps](https://faq.whatsapp.com/520312452657376/), [restricted accounts](https://faq.whatsapp.com/717472490411581/), [message yourself](https://faq.whatsapp.com/1785465805163404/) and [linked devices](https://faq.whatsapp.com/1317564962315842/) (search excerpts only); [multi-device](https://engineering.fb.com/2021/07/14/security/whatsapp-multi-device/); [OpenClaw](https://github.com/openclaw/openclaw) and [its WhatsApp docs](https://docs.openclaw.ai/channels/whatsapp); [Hermes Agent](https://github.com/NousResearch/hermes-agent) and [its WhatsApp docs](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/whatsapp); [Baileys](https://github.com/WhiskeySockets/Baileys) and issues [#2707](https://github.com/WhiskeySockets/Baileys/issues/2707), [#2733](https://github.com/WhiskeySockets/Baileys/issues/2733), [#2805](https://github.com/WhiskeySockets/Baileys/issues/2805), [#2850](https://github.com/WhiskeySockets/Baileys/issues/2850), [#2858](https://github.com/WhiskeySockets/Baileys/issues/2858); [whatsapp-web.js](https://github.com/wwebjs/whatsapp-web.js).
- **Hosting:** [Oracle Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) and [FAQ](https://www.oracle.com/cloud/free/faq/); [Google Cloud free tier](https://cloud.google.com/free/docs/free-cloud-features) and [VPC pricing](https://cloud.google.com/vpc/network-pricing).
- **Telegram:** [bots](https://core.telegram.org/bots), [FAQ](https://core.telegram.org/bots/faq), [Bot API](https://core.telegram.org/bots/api).
- **Google:** Calendar Help [37100](https://support.google.com/calendar/answer/37100), [37118](https://support.google.com/calendar/answer/37118), [37242](https://support.google.com/calendar/answer/37242); Calendar API [scopes](https://developers.google.com/workspace/calendar/api/auth), [events](https://developers.google.com/workspace/calendar/api/v3/reference/events), [events and calendars](https://developers.google.com/workspace/calendar/api/concepts/events-calendars), [reminders](https://developers.google.com/workspace/calendar/api/concepts/reminders), [recurring events](https://developers.google.com/workspace/calendar/api/guides/recurringevents), [quota](https://developers.google.com/workspace/calendar/api/guides/quota); [OAuth 2.0](https://developers.google.com/identity/protocols/oauth2), [sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification), Cloud Help [15549945](https://support.google.com/cloud/answer/15549945), [7454865](https://support.google.com/cloud/answer/7454865), [13464325](https://support.google.com/cloud/answer/13464325); [Keep API](https://developers.google.com/workspace/keep/api/guides); [gkeepapi](https://github.com/kiwiz/gkeepapi) and [its docs](https://gkeepapi.readthedocs.io/en/latest/); Tasks [scopes](https://developers.google.com/workspace/tasks/auth), [limits](https://developers.google.com/workspace/tasks/limits), [Task resource](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks), Tasks Help [13486720](https://support.google.com/tasks/answer/13486720) and [11549608](https://support.google.com/tasks/answer/11549608); [`.new` shortcuts](https://whats.new/shortcuts/); third-party reports on feed refresh and alarms: [Cheqroom](https://knowledge.cheqroom.com/helpcenter/how-often-does-google-update-its-calendar-feeds), [Timetastic](https://help.timetastic.co.uk/hc/en-us/articles/203174832), [OneUptime](https://oneuptime.com/docs/en/on-call/calendar-feeds), [community thread](https://support.google.com/calendar/thread/9627602).
- **iCalendar:** [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.txt) §3.3.10 (RRULE, UNTIL, WKST), §3.6.1 (VEVENT end), §3.6.5 (VTIMEZONE).
- **Training:** [Hevy API description](https://api.hevyapp.com/docs/); Hevy help centre (search excerpts only; a direct read returned a bot challenge); [hevy-py](https://github.com/ewright3/hevy-py) (webhooks, third party); [wger](https://github.com/wger-project/wger), [wger app](https://github.com/wger-project/flutter), [wger.de API schema](https://wger.de/api/v2/schema); [LiftLog](https://github.com/LiamMorrow/LiftLog) and [its remote backup](https://github.com/LiamMorrow/LiftLog/blob/main/docs/RemoteBackup.md); [Liftosaur](https://github.com/astashov/liftosaur) and [its API](https://www.liftosaur.com/doc/api); [Flexify](https://github.com/brandonp2412/Flexify); [Ryot](https://github.com/IgnisDa/ryot); [Workout Tracker](https://github.com/jovandeginste/workout-tracker); [FitTrackee](https://codeberg.org/FitTrackee/FitTrackee); [FitoTrack](https://codeberg.org/jannis/FitoTrack); [OpenTracks](https://codeberg.org/OpenTracksApp/OpenTracks).
- **This repo:** `shared/tables.ts`, `shared/validate.ts`, `worker/index.ts`, `worker/sync.ts`, `worker/export.ts`, `src/ui/nav.ts`, `src/ui/routes.ts`, `src/views/home.tsx`, `src/domain/lately.ts`, `src/domain/week.ts`, `src/tokens.css`, `public/manifest.webmanifest`, `wrangler.jsonc`, `.gitignore`, `test/sync-db.ts`; on the `docs` branch: `docs/brainstorm.md`, `docs/infra.md`, `docs/features.md`, `docs/books.md`.
