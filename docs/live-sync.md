# Live sync: plan

Written 26 October 2026, against `main` at `6e1997b`. Plan only: no product code, Cloudflare resource, deployment or database was changed while writing it.

> **Privacy.** This repo is public. The two users are **Partner A** and **Partner B**. No account, zone, database or namespace IDs, no emails, no tokens appear here.
>
> **Label.** **[verified]** = I read the code or the official page named, or ran the probe described in [section 8](#8-evidence), on 26 October 2026. **[measured]** = a number from a probe I ran against the repository's own code. **[assumed]** = inference, or something that cannot be checked without a real Worker or a phone. Cloudflare numbers carry the "last updated" date of the page they come from.

## Summary

Goal: when one partner changes something, the other partner's open app shows it without a reload.

1. **Transport: short polling of the existing pull** (`GET /api/sync?since=<rev>`) while the app is visible. No new endpoint, no Durable Object, no service worker. Every option fits the Free plan by a wide margin, so the choice is made by complexity and failure modes, not by quota ([section 2](#2-transport)).
2. **Schedule:** 10 s while the user is active, 30 s after 60 s without input, 60 s after 10 minutes without input, nothing while hidden, doubling to at most 60 s after failures. An immediate pull on `visibilitychange`, `pageshow`, `focus` and `online`; the pull after the app's own push already exists. Worst case with two phones open and active around the clock: 17,280 Worker requests a day, 17% of the Free quota.
3. **Correctness:** the data path does not change. The live pull is the existing pull, so the outbox overlay, field-level patches, the side header, the 409 and the read-only state all apply as they do today. What does change: a pull that brings nothing must become a no-op (today it re-renders everything and writes IndexedDB), an open form must stop reading live values, and a row deleted under an open form must not take the typed text with it ([section 3](#3-correctness)).
4. **UI:** silent updates, no toast, no new badge state, no new motion. The badge stays invisible while data is live and shows "Offline" only after the second failed poll in a row ([section 4](#4-ui)).
5. **Slices:** (1) a quiet store: a no-change pull notifies nobody and writes nothing; (2) open editors survive a live update; (3) turn the polling on. Nothing talks to the network more than today until slice 3 ([section 5](#5-slices)).
6. **Before and after slice 3:** read D1 rows read and Worker CPU time per request in the Cloudflare dashboard; the local runtime cannot report either ([section 6](#6-measurements)). Open questions, each with a default, are in [section 7](#7-risks-and-open-questions).

## Decision table

| # | Question | Choice | What the alternatives cost |
|---|---|---|---|
| 1 | Transport | **(a) Polling the existing pull**, visible tabs only | **(b) SSE:** a stateless Worker cannot hear the other partner's write, so it must poll D1 itself, and a Free invocation may run only 50 D1 queries: the stream restarts every few minutes and the 10 ms CPU cap may end it sooner (unmeasurable locally). Same D1 reads as polling, new code, no status codes in `EventSource`. **(c) WebSocket through a Durable Object:** sub-second, fits the Free plan, but adds a class, a migration, an upgrade path through Access, a heartbeat and a reconnect loop, and still needs a slow poll as the safety net because deploys disconnect every socket. **(d) Push or background sync:** wakes a closed app with a visible alert on the iPhone; the wrong problem, and Nestora has no service worker |
| 2 | Cadence | 10 s active, 30 s idle, 60 s very idle, none hidden; doubling on failure; immediate on four events | A flat 5 s doubles the requests (ceiling 34.6% of the quota) for 2.5 s less average delay; a flat 60 s makes "live" feel like "refresh" |
| 3 | Merge | Keep the existing outbox overlay and snapshot diffs; make idle pulls silent; freeze open forms | Merging live values into open forms needs a conflict prompt per field: a feature, not a fix |
| 4 | Partner change in the UI | Silent; no toast | A toast shares one slot with the 12 s Undo toast and would displace it |
| 5 | Indicator | Reuse the sync badge: invisible when live, "Offline" after two failures in a row | A permanent dot is noise in a design whose point is calm |
| 6 | Slices | Quiet store, then editor guards, then the timer | One PR would mix a refactor, a behaviour change and the first background traffic |

---

## 1. Where sync stands today

### 1.1 The flow [verified]

- **Pull.** `GET /api/sync?since=<rev>` (`worker/sync.ts:209-216`, `pull` at `49-56`): one D1 batch of three `SELECT ... WHERE rev > ?` (one per table, items through the private-row `gate`) and `SELECT rev, epoch FROM sync_state`. The `rev` is one global counter: a write batch bumps `sync_state.rev` once and stamps every row it writes with it, in the same batch (`worker/sync.ts:204`). A row's `rev` is therefore never above `sync_state.rev`, and a pull is a consistent snapshot.
- **Push.** `POST /api/sync`, at most 20 mutations, field-level patches the server merges with `differences` (an unchanged field writes nothing).
- **Client pull.** `catchUp` (`src/store/store.ts:158-183`): pull since the stored `rev`, `reconcile` (epoch and revision checks), keep rows whose `rev` is above the known one (`newer`, `src/store/outbox.ts:41`), persist, apply, advance the cursor, `emit()`.
- **Client cycle.** `cycle` (`store.ts:185-219`) pushes the outbox in batches and then **always** runs `catchUp()` (`store.ts:218`). So "pull right after the app's own push" exists. A push result's rows are applied but never move the cursor, so another partner's rows in between cannot be skipped (`test/store-sync.test.ts`, "the pull cursor follows pulls only").
- **What triggers a sync.** App open; every write (`append`, `fold`); `visibilitychange` to visible and `online` (`src/store/browser.ts:27-31`). The session's own probe retries (5 s, 15 s, 60 s, then every 60 s) run only while the side is unconfirmed (`src/store/partition.ts:12`, `114-117`). There is no timer, no `focus` and no `pageshow`: **an open, visible, idle app never pulls.**
- **Session and partitions.** `createSession` (`partition.ts`) owns one `Store` per side, bound to that side's IndexedDB and to an `Api` that sends `X-Wp-Side`. `session.sync()` runs the open store's cycle, or the probe while unconfirmed.
- **View.** `emit()` (`store.ts:70`) builds `overlay(base, outbox)` and a new snapshot; components read it through `useSyncExternalStore` (`src/hooks/use-store.ts`).

### 1.2 What blocks polling as the code stands

| # | Finding | Evidence | Effect at one pull every 10 s |
|---|---|---|---|
| B1 | **`catchUp` always emits, and `emit` always builds new arrays.** `emit` replaces the snapshot and `live()` builds a new array for every table (`store.ts:70-85`, `outbox.ts:36`). | [measured] with the repo's own fake server and store: 3 `sync()` calls with nothing to pull gave 3 listener calls, a new snapshot, and new `items`, `budget_entries` and `settings` arrays each time. One partner row arriving also replaced the arrays of the two tables it did not touch. | Every component under `useSnapshot` or `useTable` re-renders, every `useMemo` keyed on a table array recomputes, `Shell` re-runs `sweepUndone` (`src/ui/shell.tsx:36`), and `ItemForm` rebuilds its controls. A render storm with nothing new on screen. |
| B2 | **`catchUp` always writes IndexedDB** (`store.ts:168`): a read-write transaction over every store, even with no rows and the same `rev` and side. | [verified] by reading `persistence.write` (`src/store/db.ts`). | Disk and battery use every 10 s, and a lock a second tab on the same partition can feel. |
| B3 | **One failed pull flips the badge to "Offline" and emits** (`failed`, `store.ts:87`; `call` maps 5xx, a 15 s timeout and non-JSON answers to offline, `src/store/api.ts`). | [verified] by reading. | A weak phone connection shows an "Offline" pill every few minutes, announced by the badge's polite live region. |

Not blockers, so they stay as they are: the side header and the 409 (`worker/index.ts:62-65`), `held` and the probe, the outbox ordering and the `again` flag that never loses a trigger landing as a cycle ends (`test/store-sync.test.ts`), the three-way diffs on the edit surfaces ([section 3.2](#32-merging-with-unsaved-edits-and-the-outbox)).

---

## 2. Transport

### 2.1 Limits used

| Limit | Value | Source (page last updated) |
|---|---|---|
| Workers requests, Free | 100,000 a day, reset 00:00 UTC; error 1027 beyond | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) (12 October 2026) |
| CPU time per HTTP request, Free | 10 ms; waiting on D1 or `fetch` is not CPU | same |
| HTTP request duration | no limit while the client stays connected | same |
| Subrequests per invocation, Free | 50; to internal services 1,000 | same |
| D1 queries per Worker invocation, Free | 50; a `db.batch()` counts as one | [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) (24 October 2026) |
| D1 daily, Free | 5 million rows read, 100,000 rows written; "rows read" is rows scanned, and an index lowers it | [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) (21 April 2026) |
| D1 concurrency | a database processes one query at a time | D1 limits |
| Static assets | requests are free and unlimited; paths in `run_worker_first` (here `/api/*`) answer 429 once the Worker quota is spent | [Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) (23 April 2026) |
| Durable Objects, Free | only the SQLite storage backend; 100,000 requests a day (HTTP, RPC, WebSocket messages at 20 to 1, alarms); 13,000 GB-s of duration a day | [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) (18 October 2026) |
| WebSocket billing | the upgrade is one request; outgoing messages are free; `setWebSocketAutoResponse` replies are not charged; an idle object that can hibernate is not billed for duration | same |
| Hibernation | after 10 s with no event and no timer or outbound I/O | [Lifecycle](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/) (15 October 2026) |
| WebSockets and deploys | "Code updates disconnect all WebSockets" | [WebSockets in Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) (30 September 2026) |
| WebSocket idle timeout | Cloudflare closes an idle socket after a period the page does not state and advises a client heartbeat | [WebSockets](https://developers.cloudflare.com/network/websockets/) (14 August 2026) |
| Worker WebSocket billing | the upgrade is one Worker request; messages through a Worker are not requests | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) (2 October 2026) |

### 2.2 The cost of "has anything changed"

| Check | Statements | Rows read | Response |
|---|---|---|---|
| The existing pull with nothing new | 4 in one batch | about **9**: `settings` is scanned in full because it has no `rev` index (`migrations/0001_init.sql` indexes only `items` and `budget_entries`) and holds a handful of keys (`settingKeys` defines 8), plus the `sync_state` row; the two `rev` index ranges are empty | **120 bytes** [measured] |
| The same pull with one item changed | 4 | the 9 above, plus the changed row, plus one pass over the routine rows for the private-row filter (8 in the sample) | 261 bytes [measured] |
| A bare `SELECT rev FROM sync_state WHERE id = 1` | 1 | **1** (primary key) | about 40 bytes |

[measured] means SQLite's `EXPLAIN QUERY PLAN` and a counting probe over a copy of the schema with 300 items, 8 settings and 8 routines, run with the repository's own `worker/sync.ts` and `worker/private.ts`: `SCAN settings`, `SEARCH items USING INDEX items_rev (rev>?)`, `SEARCH budget_entries USING INDEX budget_entries_rev (rev>?)`, and the private-row subquery runs **0 times** on an idle pull (the planner builds it lazily) and once, over every routine row, when any item row matches. D1's own `rows_read` is not available locally: `wrangler d1 execute --local --json` returned only `duration` in `meta` (wrangler 4.151.2). The real figure is measurement M1.

The cheapest check is 9 times cheaper than the existing pull, and neither matters at this size (below). So the plan reuses the existing pull unchanged and keeps a one-row short-circuit as a later option with a trigger ([section 6](#6-measurements)). Because every row's `rev` is at most `sync_state.rev`, a pull with `since >= sync_state.rev` returns nothing, so that short-circuit would be exactly equivalent.

### 2.3 Quota arithmetic

Schedule: 10 s active (360 polls an hour), 30 s idle (120), 60 s very idle (60). Two partners; 40 trigger pulls (visible, focus, online) a day per phone; the app's own push-then-pull pairs already exist and are not counted.

| Scenario | Polls a day | Worker requests | Share of 100,000 | D1 rows read at 9 per poll | Share of 5,000,000 |
|---|---|---|---|---|---|
| **Typical:** each phone visible 3 h (0.5 h active, 1 h idle, 1.5 h very idle) | 2 x (180 + 120 + 90 + 40) | **860** | 0.9% | 7,740 | 0.15% |
| **Heavy:** each phone visible 8 h, always active | 2 x (2,880 + 40) | **5,840** | 5.8% | 52,560 | 1.1% |
| **Heavy, both hosts open** during the 30-day soak of the old host | 2 x 5,840 | 11,680 | 11.7% | 105,120 | 2.1% |
| **Ceiling:** both phones visible and active 24 h | 2 x 24 x 360 | **17,280** | 17.3% | 155,520 | 3.1% |

- Polls write nothing: 0 of the 100,000 rows written.
- The ceiling reaches the D1 read quota only above **289 rows read per idle poll** (5,000,000 / 17,280); the estimate is 9.
- Today's load is about 200 requests a day (`docs/infra.md` §2.5). The Worker quota is shared with every Worker in the account (**[assumed]** none busy; `docs/infra.md` §2.5).
- When the quota is spent, `/api/*` answers 429 or a Cloudflare error page, which `call` already reads as offline (`api.ts`): the app keeps working from IndexedDB, and polling backs off to once a minute.
- Wire data **[assumed]**: about 2 KB a poll (request headers with the Access cookie dominate; the 120-byte body is measured). Typical: 430 polls x 2 KB = 0.9 MB a day, about 26 MB a month per phone. Heavy: 2,920 x 2 KB = 5.8 MB a day, about 175 MB a month. Measurement M4.

### 2.4 The options

| | **(a) Poll the existing pull** | **(b) Server-Sent Events** | **(c) WebSocket through a Durable Object** | **(d) Web Push or background sync** |
|---|---|---|---|---|
| **Latency** | Mean half the interval, worst the interval plus a request: 5 s and 10 s while active, 15 s and 30 s idle, 30 s and 60 s very idle. Under 2 s after the app becomes visible. | Mean 2.5 s, worst 5 s at a 5 s server tick. | Under 1 s **[assumed]**: D1 commit, one Durable Object call, one frame, one pull. | Seconds; reaches a closed app. |
| **Worker requests a day (heavy)** | 5,840 | about 230 (a stream lasts at most 50 ticks of 5 s, about 4 min, because of the 50-query cap) | about 1,040: 80 upgrades plus a 60 s safety-net poll of 960 (and about 180 Durable Object requests) | about 200 pushes |
| **D1 rows read a day (heavy)** | 52,560 | 11,520 (one-row check every 5 s) | about 10,000: the safety net's 960 polls at 9 rows, plus a pull per notification | a pull per push |
| **Durable Object use** | none | none | about 180 requests of 100,000; about 1 GB-s of 13,000 (a wake of 50 ms at 128 MB is 0.006 GB-s; idle hibernation is unbilled) | none |
| **Phone cost** | radio wakes every 10 s while the screen is on and the app is used; hidden means zero; about 26 to 175 MB a month. Battery drain: measurement M6 | one open connection; the radio stays up | one open connection plus a heartbeat; deploys and idle closes force reconnects | a visible notification per change on the iPhone |
| **Offline** | the first failed poll is quiet, the second in a row turns the badge to Offline; polls continue at 60 s as the recovery path; reads and writes use IndexedDB as today | `EventSource` retries by itself; cannot tell a login redirect from a network error | the socket closes; reconnect with back-off, then one pull | not applicable |
| **Complexity** | about 80 lines in `src/store/live.ts` and `browser.ts`, no Worker change, no config | a streaming handler with a D1 loop, `?side=` instead of the header (`EventSource` sets no headers), a visibility close and reopen | a Durable Object class, a binding and migration (also under `env.dev`), an `Origin` check on the upgrade (the existing check covers only POST and DELETE), `ctx.waitUntil` in `fetch`, tests with a stand-in for the object | a service worker, VAPID keys as secrets, a subscription table, push encryption, a Home Screen install |
| **New failure modes** | one: a bug that polls without delay. Bounded by the 10 s minimum delay, single flight and the ceiling above | the CPU cap ends a long stream (**[assumed]**, unmeasurable locally); a stream can outlive a login | a missed notification after a failed call, a deploy that drops every socket, a silent idle close, an upgrade through Access that nobody has tested here | revoked permission, duplicate alerts, a closed app that shows stale data anyway |
| **Verdict** | **Chosen** | Rejected | Later, only if 5 s average delay feels slow (design in [2.6](#26-the-upgrade-if-it-is-ever-needed)) | Rejected: separate plan |

Notes on (d), because it is the one people reach for first:

- **Background Sync API.** It defers the app's own outgoing work until the network returns; it does not wake the app for the other partner's changes. MDN marks it "Limited availability" and service-worker only ([page](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API)).
- **Periodic Background Sync.** In Chrome it is granted "only to an installed web app", gated by an engagement score, with no stated minimum interval ([page](https://developer.mozilla.org/en-US/docs/Web/API/Web_Periodic_Background_Synchronization_API)). One partner uses an iPhone (`docs/infra.md` §9.2).
- **Web Push.** On the iPhone it needs iOS 16.4, a Home Screen install and a permission asked from a tap ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)), and every push must show a notification (`docs/routines.md` §4.5). It serves reminders for a locked phone; for an open app it would add an alert per change. Nestora has no service worker (`grep -rn serviceWorker src` finds nothing, [verified]).

### 2.5 Recommendation: (a), and how it runs

- **One path.** The timer calls `session.sync()`, never `fetch`. A poll is therefore an ordinary cycle: it pushes the outbox first if there is one, then pulls, through the open partition's store and an `Api` that sends `X-Wp-Side`. `npm run check` already forbids `fetch` in `src/views`, `src/ui` and `src/hooks`.
- **A timer chain, not an interval.** `setTimeout` re-armed after each cycle completes; `sync()` already coalesces overlapping calls into one more cycle.
- **Eligible when** the page is visible, `navigator.onLine` is not `false`, the snapshot is not `paused` (the session's own probe back-off owns that state), and `link` is `online` or `offline`. Not for `expired` or `mismatch`.
- **Delay:** `base = idle < 60 s ? 10 s : idle < 10 min ? 30 s : 60 s`; `delay = min(base x 2^failures, 60 s)`. "Idle" is the time since the last `pointerdown` or `keydown`, kept by two passive listeners. No jitter: two phones need none.
- **Immediate pull** on `visibilitychange` to visible, `pageshow` (back-forward cache), `focus` and `online`, skipped if a pull started less than 2 s ago, because `visibilitychange` and `focus` arrive together.
- **Hidden:** the timer is cleared. No request until visible again.
- **Other tabs.** Two visible tabs of one partner poll twice. Not worth a `BroadcastChannel` for two people.
- **Two hosts.** During the soak (`docs/rename-nestora.md`) each origin has its own IndexedDB and polls on its own; the table above counts it.

### 2.6 The upgrade, if it is ever needed

Only if the operator finds 5 s average delay too slow after a week. Keep (a) as the safety net at 60 s and add a number-only channel:

- One Durable Object named for the household, SQLite-backed, no tables, the Hibernation API, `setWebSocketAutoResponse` for the heartbeat. A socket attachment holds the side.
- The Worker authenticates the upgrade exactly as `/api/sync` (Access JWT, side check, plus an `Origin` check) and forwards it.
- After `postSync`'s batch commits, `ctx.waitUntil(object.poke(rev))`; the object sends `{"rev": n}` to every socket, **skipping a batch that wrote only private rows**, which would also remove the timing signal of [3.5](#35-private-rows-and-the-rev). Clients answer with `session.sync()`.
- **D1 stays the only source of truth.** The channel carries a number; every row still travels through `pull` and its `gate`. So no row, private or not, can reach a socket, and no row can reach the wrong partition.
- A failed `poke` costs at most one safety-net interval. A deploy disconnects every socket; clients reconnect with back-off and pull once.

---

## 3. Correctness

### 3.1 The rule

**The live pull is the existing pull, run more often.** It carries data; nothing else does. So everything the sync tests pin today holds for it: epoch and revision reconciliation, `newer` by `rev`, the cursor following pulls only, the private-row `gate`, the side header and the 409.

### 3.2 Merging with unsaved edits and the outbox

The store separates what the server said (`base`) from what the user did (`outbox`). The view is `overlay(base, outbox)` (`outbox.ts:66`): pending patches are re-applied on top of every new base. So a pull that brings the partner's change to a row the user has a pending patch on shows the partner's other fields and keeps the user's. Nothing is lost, and nothing flickers, because the user's value never leaves the view. After the push, the server applies field by field (`differences`), so the partner's untouched fields survive there too; the same field is last write wins in arrival order, as today.

The edit surfaces, one by one:

| Surface | What holds the user's text today | What a live update does today | Change |
|---|---|---|---|
| **Item form** (task, payment, guest, vendor, book details; `src/ui/item-form.tsx`) | `initial` is the row at mount (line 37). Fields are uncontrolled, with `defaultValue` from the **live** `row` (lines 53, 63; `src/ui/field.tsx:47`). Save sends only fields that differ from `initial` (line 98). Controls are keyed by name, so nothing remounts. | **[assumed]** React forwards a changed `defaultValue` to the DOM default: a field the user has edited ignores it, a field they have not touched shows the partner's value. No focus loss, no remount. But the form is half snapshot, half live. | Read `value` from `initial`, not `row` (two lines). The open form is a snapshot: nothing moves under the user, save still sends only what they changed, and the partner's other fields stay intact. |
| **Row deleted while its form is open** (`src/views/generic-item.tsx`) | `GenericItem` renders `Gone` when the row disappears, which unmounts the form. | Typed text is dropped. Saving an edit to a tombstone would be ignored by the server without an error (`worker/sync.ts:154-155`). | Keep the form mounted from the last row, show one line saying the partner deleted it and the edits are still here, with the existing Restore, and disable Save until the row is back. About 25 lines; details in slice 2. |
| **Single-field settings row** (`src/ui/setting-row.tsx`) | A controlled `draft`. | None. | None. |
| **Add sheet, book sheet** (create) | Local drafts; there is no row yet. The book sheet reads `items` only for places and owner defaults. | None beyond a recompute. | None; check focus in the browser run. |
| **Routine sheet** (edit; `src/ui/routine-sheet.tsx:147`, `src/domain/routine-draft.ts:214`) | `opened` is the snapshot at open. `planOf(draft, opened, live)` diffs the draft against `opened`, so the patch holds only what the user changed; an action deleted meanwhile, with edits, is refused with a `gone` list. | Built for it. | None. |
| **Route stages** (`src/ui/stage-editor.tsx:71`) | The whole `stages` setting is one JSON value saved at once. | A partner's concurrent stage edit is overwritten. | None: whole-value last write wins, as today (open question 3). |

Two further rules:

- **Epoch reset.** If the epoch changes (a restore of the database), the next poll resets the partition and shows the existing notice (`reconcile`, `store.ts:112`). Polling makes that visible within seconds, mid-edit. A restore is an operator action, rare; accepted.
- **Data moves no focus.** The `focus()` calls in `src/` run after a user action, on a route change (`src/main.tsx`, effect on `[route]`) or when a sheet opens. The one a row change can reach is Start's (`src/views/routine-start.tsx:86`), when a partner deletes the step on screen (3.6). The live path adds none.

### 3.3 A pull with nothing new must do nothing

Slice 1. A pull that returns no rows, with the same `me` and `link` already `online`:

- does not call `emit()` and does not replace the snapshot;
- does not write IndexedDB, except `meta.rev` when only the `rev` moved (3.5);
- and when it does emit, keeps the array of every table whose rows are all the same objects as before (`===` per row; length first). The view of a table nobody touched keeps its identity, so its `useMemo`s and effects stay still.

It must still emit when `link` changes (offline to online), when `me` changes, on a reset and on the first answer, because `ready` depends on them.

### 3.4 Partitions, side mismatch, read-only

- **No second path.** The timer holds no store. Each tick reads `session.getSnapshot()` and calls `session.sync()`, which always goes to the open partition's store and its `Api`. After the probe moves the app to the other partner's partition (`enter`, `partition.ts`), the next tick talks to the new store. A pull still in flight for the old store lands in that store's own partition, written with its own `persistence`, never in the new one.
- **Every poll carries the header.** The Worker answers `409 side_mismatch` and does no read (`worker/index.ts:62-65`); `api.pull` also compares `me` with the side it was made for. A tab in `mismatch` stops polling, keeps its partition untouched and parks nothing, exactly as today.
- **Read-only stays read-only.** The timer does not run while the snapshot is `paused`; the probe back-off owns that state. `expired` stops it too; "Log in again" and the probe are the way back.
- **Tests:** extend the pattern of `test/partition.test.ts` under a fake clock: switch partition mid-run and assert that the old partition's rows, outbox and meta are byte-identical afterwards.

### 3.5 Private rows and the rev

`README.md` pins this: a private routine write moves the global `rev` that the other partner's pull reports, with no row behind it; the other partner "can tell that some write happened and when, never what or in which routine"; a `rev` per side was rejected; `test/routines-private.test.ts` pins it.

What the live pull shows for it: **nothing.** The poll returns the new `rev` and empty `changes`. The client persists the new cursor and does not emit, because nothing in the view changed (3.3). No toast, no badge change, no render.

Does that leak a signal? Not beyond the one the README accepts. The partner's device already learns the bare counter on every pull; polling raises the resolution from "when they next open the app" to at most one poll interval, and a person watching the network tab could correlate the moment of a private write with their partner's activity. There is still no content, kind, title or routine. Three rules keep it that way:

1. **"Something changed" comes from rows, never from the `rev`.** Any future toast or highlight must be driven by rows in `changes`; a `rev` move alone must not draw anything.
2. **No dummy traffic to mask it.** Fake writes would spend the 100,000-row write quota and break the cursor reasoning the README rejects.
3. **Row visibility stays in the one place it lives:** the `gate` in `pull` and the push-side `hides`. A live path adds no second implementation.

Tests: a client-side pin next to the server-side one: a partner's private write changes the persisted `rev`, calls no listener, and leaves the snapshot object unchanged.

### 3.6 Start mode

The Start screen (`src/views/routine-start.tsx`) already derives its pages from live rows (`useRoutines`, `pagesOf`) and repositions with `follow` (line 58) whenever they change, because the user's own ticks change the same rows. Running timers live outside React, in `sessionStorage`, as an absolute end instant (`src/store/timers.ts`), and are swept by `timers.keep` (line 82). So a live pull cannot restart a timer or move a page unless the partner changes the structure of the routine in use.

- A partner's tick on a shared routine writes the partner's own keys (`done_b`, `value_b`, `KEYS` in `shared/routines.ts`). Progress, `isOpen` and `position` read the user's own side, so nothing on the screen moves.
- A partner **deleting or editing the step on screen** moves the user to the next page through `follow`, as the user's own delete would, and `timers.keep` drops only the timer of a step that is gone. Accepted: it is rare, and what the screen shows is true.
- While a timer runs, a 1 s tick (`useNow`, `src/ui/start-page.tsx:37`) already re-renders the page; a poll adds one render per change and none when idle (3.3).
- The poll does not need a special case for Start: the screen taps often, so the schedule stays at 10 s, which is the right cadence for a shared routine.

Tests, as pins that pass on today's code and fail if `follow`, `keep` or the overlay change: a pull that sets only the partner's done key on the displayed action leaves `place`, the screen kind and the running timer key as they were; a pull that deletes the displayed step moves to the next page and removes only that step's timer key.

### 3.7 Two devices of the same partner

Same side, so one partition each (`wp-a` on both phones), each with its own outbox. Device 2's poll brings what device 1 pushed, as rows with `updated_by` set to the same side. The overlay keeps device 2's pending patches on top; the server merges field by field in arrival order; `differences` drops a field that already equals the stored value, so a stale resend writes nothing. Whole-value settings (`stages`) are last write wins. Polling shortens the stale window from "until someone reopens the app" to a few seconds, so it can only reduce conflicts. A device offline for days takes the existing path: a pull from its old cursor, the same epoch checks.

---

## 4. UI

- **Partner changes arrive silently.** A list changes; nothing announces it. Home's "Lately" already says who did what (`src/domain/lately.ts`).
- **No toast.** One toast slot is shared with the Undo toast, which lives 12 s and which `overlay.announce` replaces (`src/ui/overlay.ts`): a partner toast could displace an Undo the user is about to press. Where a message matters it is inline: the "deleted by your partner" line under an open form (slice 2), a polite `role="status"` paragraph that reads once.
- **The badge says nothing while data is live.** `synced` renders a visually hidden "All saved" (`src/ui/sync-badge.tsx:20`), and that stays. A permanent glyph would be noise. The truthful "not live" signals already exist: **Offline** (with the dot) when polls fail, **Log in again** when the login expires. Their live region speaks only when the state changes, so quiet polls announce nothing.
- **One failed poll stays quiet.** The first failure of a background pull while `link` is `online` does not change the badge; the second in a row does; the first success clears it (slice 3). Without this, B3 shows an Offline pill on every weak signal.
- **Copy.** The Sync page says "Connected. Changes are sent as soon as you make them." (`text.sync.onlineBody`); add "and your partner's arrive while the app is open." One line in `src/ui/text.ts`.
- **Reduced motion.** The live path adds no animation. The only transitions in the app are state colours inside `@media (prefers-reduced-motion: no-preference)`, and `--dur-state` is `0ms` under `reduce` (`src/style.css:390`, `src/tokens.css:132`). A row that arrives simply appears.
- **No layout jump from the chrome.** The badge changes size only on a state change, never on a poll. A row arriving above the viewport shifts content below it; Chromium and Firefox keep scroll position through `overflow-anchor`, and Safari does not **[assumed, not checked]**, so an iPhone can jump once in a while. Accepted for two people and a few arrivals a day; to be looked at in the on-phone test (open question 4).
- **Accessibility.** No live region is written by a quiet update; the badge and the toast are the only ones that react, and both are polite. Data moves no focus, except the Start case in 3.6 (3.2).

---

## 5. Slices

Order: **quiet store, editor guards, polling.** Nothing talks to the network more than today until slice 3, so each earlier slice is useful alone: slice 1 stops wasted renders and IndexedDB writes on today's triggers, slice 2 closes a race that exists today with the manual pull, and slice 3 is the only one that adds background requests, which keeps the quota review to one PR. Sizes are **[assumed]**.

Blocker classes a reviewer should hold each slice against: **private data exposure, wrong-side writes, data loss, lost update, focus loss, runaway requests or quota burn, secrets.** The plan adds no endpoint, no secret and no new data on the wire, so private data exposure and secrets reduce to "diff touches no `worker/` file and no `wrangler.jsonc`".

### Slice 1: a pull with nothing new does nothing

About 60 lines in `src/store/store.ts` and `src/store/outbox.ts`, plus `test/store-quiet.test.ts`.

- `catchUp`: when `newer()` returns nothing, `link` is already `online` and `me` is unchanged, skip `emit()`; persist `meta` only if the `rev` moved.
- `emit`: reuse the previous array of a table whose rows are all `===` the previous ones.
- `failed(kind)`: do not emit when `link` is already `kind`, so a poll that keeps failing while offline does not re-render once a minute.

**Tests that fail without it** (all fail on `main`, [measured] for the first two):

1. Three `sync()` calls with nothing to pull: zero listener calls, the same snapshot object.
2. The same: zero `persistence.write` calls (a spy over `memoryPersistence`).
3. One partner row in `items` arrives: one listener call; `rows.settings` and `rows.budget_entries` are the same arrays as before.
4. A partner's private write (the fake server bumps `rev` with no row): no listener call, the persisted `rev` advanced, a reload resumes from it.
5. Guards against over-quieting: offline then online notifies; a second failed pull while offline does not; a changed `me` notifies; a reset notifies; a row that changes the view always notifies once.

**Acceptance a reviewer can run:** `npm run check`; `node --test test/store-quiet.test.ts` is green, and red on a `git archive origin/main` copy with only the test file added. Blockers: data loss (the persist skip must never skip a row), lost update (the cursor must still advance), focus loss (fewer renders only).

### Slice 2: an open editor survives a live update

About 50 lines in `src/ui/item-form.tsx`, `src/views/generic-item.tsx` and a pure `src/domain/open-row.ts`, plus tests.

- `ItemForm` reads `value` from `initial` (3.2).
- `openRow(initial, live)` returns `{ row, gone }`: the last row to show and whether the live row is missing or tombstoned. `GenericItem` keeps `ItemForm` mounted when `gone`, renders the one-line "deleted by your partner" notice with Restore (the existing `undo`), and disables Save until the row is back. The restore uses the revive-only patch the server accepts (`worker/sync.ts:154`).
- The Start pins of 3.6, added to `test/routine-start.test.ts`.

**Tests that fail without it:** `test/open-row.test.ts` (a live row that vanishes or gets `deleted_at` reports `gone` and still returns the last row; a live row that changes keeps returning the snapshot). The Start pins pass on today's code by design; they fail if `follow` or `keep` change.

**Acceptance (scratch Playwright, two contexts; see "How to run two identities at once" in slice 3):**

1. B opens a task's form and types into Title with the caret in the middle. A changes the same row's note and title. Within 12 s (after slice 3; before it, with `store.sync()`) B's Title input keeps its text, its selection range, `document.activeElement` and its DOM node (a property set on the node before is still there).
2. B saves: the server row has A's note and B's title.
3. A deletes the row while B's form is open with typed text: B's form is still mounted with the text, the line shows, Save is disabled; Restore brings the row back and Save then stores the edit.

Blockers: data loss, lost update, focus loss.

### Slice 3: turn the polling on

About 80 lines: `src/store/live.ts` (the pure delay and a `createLive` that takes `sync`, `read`, `now`, `later` and `visible` as arguments, like `createSession` takes `later`, so it needs no clock and no DOM), wiring in `src/store/browser.ts`, a `quiet` argument through `sync` in `store.ts` and `partition.ts`, one copy line, and a `README.md` bullet.

**Tests that fail without it** (`test/live.test.ts`, fake clock):

1. The delay table: active 10 s, idle 30 s, very idle 60 s, doubling to the 60 s cap.
2. Single flight: a cycle that takes 25 s never overlaps the next; the next is armed after it ends.
3. Hidden: zero calls over one fake hour. Visible again: one call at once.
4. The runaway bound: one fake hour of failures makes at most 65 calls; one fake hour of success at 10 s makes at most 360.
5. Not eligible: `expired`, `mismatch`, `paused` and `navigator.onLine === false` make no call.
6. A trigger within 2 s of a pull is skipped; one after is not.
7. A partition switch mid-run: the next tick syncs the new store and the old partition is untouched (3.4).
8. One failed background pull leaves the badge `synced`; two in a row show `offline`; one success clears it.

**Acceptance (scratch two-context run on the dev Worker):**

1. A creates a task; it appears in B within **12 s** (the 10 s interval plus the request) in each of 20 trials; median about 5 s. After B's tab is brought back to visible: within 2 s.
2. B idle: with `page.clock`, the number of `GET /api/sync` over 10 fake minutes with no input after the first matches the table (6 in the first minute at 10 s, then 18 at 30 s: about 24). Hidden (override `document.visibilityState`, dispatch `visibilitychange`): zero.
3. `context.route("**/api/**", abort)`: the badge stays quiet after one failed poll, shows Offline after the second, and is quiet again within one interval after the route is restored. No row lost.
4. A creates a private routine: B's snapshot object is unchanged, B's persisted `rev` advanced, B's DOM is unchanged.
5. Wrong side: with B's tab open and polling, switch that context's `x-dev-who` header to Partner A: the next poll answers 409, the tab stops polling, shows the mismatch notice, and B's partition holds the same bytes.
6. `npm run check`.

**How to run two identities at once.** The dev Worker takes one identity from `DEV_WHO` (`worker/auth.ts`). In a scratch copy of the repo, not in product code, make the authenticator read an `x-dev-who` header, and add that header per context with `context.route("**/api/**")`: one server, two identities, separate IndexedDB per context. If that is unwanted, two dev servers on two ports sharing one persist directory also work, but concurrent writers on one SQLite file are **[assumed]** safe for a test this small.

Blockers: runaway requests or quota burn (tests 2 and 4, acceptance 2), wrong-side writes (7, acceptance 5), data loss and lost update (the poll uses the existing cycle; acceptance 3), focus loss (acceptance of slice 2 re-run with polling on).

After merge, on the docs branch: add a line about live sync to `docs/infra.md` §5.6.

---

## 6. Measurements

None of these blocks slices 1 and 2. M1 and M2 gate turning slice 3 on for good.

| # | What | How, and where | Decision it feeds |
|---|---|---|---|
| M1 | **D1 rows read** per idle pull and per pull with a change | The local runtime cannot report it (`meta` holds only `duration`). Read the D1 dashboard's Row Metrics for a day before slice 3 and a day after, and divide by the request count. Estimate to confirm: about 9 idle | If the daily total goes above 250,000 (5% of the quota), add the one-row short-circuit: read `rev` first and return the empty answer when `since >= rev` (equivalent, 3 lines in `pull`) |
| M2 | **Worker CPU time per request** for `GET /api/sync`, p50 and p99 (JWT check, four statements, JSON) | The Workers dashboard (CPU time), a day after slice 3. Workerd locally does not enforce the 10 ms Free cap, so this needs the real deployment | If p99 is above 8 ms, add the short-circuit before keeping 10 s; if above 10 ms, the Free cap is at risk and the interval goes up |
| M3 | **Delay from A's write to B's screen**, 20 trials | The two-context run on the dev Worker, real time | If the median is above what the operator accepts, the active interval goes to 5 s (about double the requests; ceiling 34.6%) before any WebSocket |
| M4 | **Bytes on the wire** per idle poll, with the Access cookie | DevTools Network, "transferred", on the live site (the dev Worker has no Access cookie, so it gives a lower bound) | Confirms the 2 KB estimate and the monthly figures in 2.3 |
| M5 | **Renders per idle poll**: zero, and one per change | A subscriber counter through `import("/src/store/browser.ts")` in `page.evaluate`, on the dev Worker | Confirms slice 1 in a real browser |
| M6 | **Battery**: 30 minutes of foreground idle with polling on and off | On each partner's phone (the on-phone test, `docs/infra.md` M9), battery settings | If the drain is visible, the very-idle step moves to 3 minutes |
| M7 | **Access with a WebSocket or a stream** | Only relevant if (b) or (c) is ever built; cannot be checked locally | Gate for the upgrade in 2.6 |

---

## 7. Risks and open questions

**Risks**

1. **A bug that polls without delay.** The one new failure mode of (a). Bounded by the 10 s minimum delay, single flight and `test/live.test.ts` test 4; the account quota is the backstop (the ceiling is 17%).
2. **Re-render cost if slice 1 is skipped.** Turning polling on without it re-renders every screen every 10 s. Hence the order.
3. **Soft deletes under an open form.** Rare, covered by slice 2; the same race exists today with the manual pull.
4. **An epoch reset mid-edit.** Visible within seconds instead of at the next open. A restore is rare and deliberate; accepted.
5. **Quota shared with the account** (`docs/infra.md` §2.5): not measurable from here; the ceiling leaves 83%.

**Open questions for the operator** (each with the default I will follow, so no work is blocked)

1. **Is 5 s average delay (10 s worst) live enough?** Default: yes. If not, the active interval goes to 5 s first (M3); a WebSocket only after that.
2. **A visible "live" indicator?** Default: none; the badge speaks only when something is wrong.
3. **Two partners editing the same field, or the route stages, at the same time.** Default: last write wins by field as today; stages by whole value. A prompt "your partner changed Amount while you edited" would be a feature of its own.
4. **A row inserted above the viewport on an iPhone may shift the page.** Default: accept; look at it in the on-phone test.
5. **Freshness of a closed app.** Default: out of scope; the app pulls at once when it opens or becomes visible, as today. A notification for a closed app belongs to the reminders plan (`docs/routines.md` §4.5).

---

## 8. Evidence

**Read:** `README.md`, `shared/api.ts`, `shared/routines.ts`, `worker/sync.ts`, `worker/index.ts`, `worker/private.ts`, `worker/auth.ts`, `migrations/0001_init.sql`, `src/store/*.ts`, `src/hooks/*.ts`, the edit surfaces named in 3.2, `src/views/routine-start.tsx`, `src/domain/routine-start.ts`, `src/ui/sync-badge.tsx`, `src/ui/shell.tsx`, `src/ui/overlay.ts`, and the sync tests listed by name (`test/store-*.test.ts`, `test/partition.test.ts`, `test/routines-private.test.ts`). On the docs branch: `docs/infra.md` §2.5, §5.6, §5.7, §9; `docs/routines.md` §4; `docs/rename-nestora.md`.

**Probes, in a scratch directory outside the repository (deleted afterwards):**

- A Node script over an in-memory SQLite with the repository's migrations and 300 items, 8 settings and 8 routines: `EXPLAIN QUERY PLAN` for each pull statement; the response size of an idle pull (120 bytes) and of a one-row pull (261 bytes) through the repository's own `pull`; a counting function substituted into the private-row predicate, which ran 0 times on an idle pull, 9 times for one changed row and 308 times for a full pull.
- A Node script over `createStore` with the repository's fake server (`test/store-server.ts`): listener calls and array identity across idle and changing pulls (B1).
- `wrangler d1 execute --local --json` on a scratch persist directory (wrangler 4.151.2, no account): `meta` carries `duration` only, so `rows_read` is not measurable locally.
- Cloudflare pages fetched as Markdown from `developers.cloudflare.com` on 26 October 2026 and read for the numbers in 2.1; MDN and WebKit pages read for (d).

**Not verified:** D1's real `rows_read` for these queries (M1); Worker CPU per poll (M2); whether React forwards a changed `defaultValue` to a pristine uncontrolled field as assumed in 3.2 (slice 2 removes the dependence); the browser behaviours marked **[assumed]**; anything on a phone; Access with a WebSocket or a stream.
