# WP

Mobile-first PWA that tracks a household's planning in one place.
React + TypeScript SPA served by a Cloudflare Worker with D1.

## Run locally

CI uses the newest Node release: `.node-version` is `latest`, and `actions/setup-node` resolves it from nodejs.org on every run. mise ignores `.node-version` by default; run `mise settings add idiomatic_version_file_enable_tools node` to read it, or `mise use node@latest`. `latest` means the newest installed version, so run `mise install node@latest` to move it forward; a local machine can lag CI until you do.

```sh
npm ci
npm run dev
npm run check
```

`npm run dev` serves the SPA and `/api/health` with a local D1. `npm run preview` serves the production build. The local D1 state lives in `.wrangler`. `npm run dev` does not apply the migration: on a fresh `.wrangler`, run `npx wrangler d1 migrations apply wp --local --env dev` once, otherwise `/api/sync` returns 500. After a change to `migrations/0001_init.sql` (it is the initial schema and is edited in place) delete `.wrangler` and apply the migration again.

## Sync and privacy limits

- A private routine and its actions never reach the other partner. The global `rev` is the one thing that does: a private write moves the `rev` that the other partner's pull, push response and JSON export report, with no row behind it. The other partner can tell that some write happened and when, never what or in which routine. Accepted because it is a bare counter between two household members. Rejected: a `rev` per side. It changes the cursor meaning of all sync, needs a cursor reset on every client, and a client with an old cursor can lose rows. `test/routines-private.test.ts` pins this.
- A create on the id of a hidden row answers `404 row_id: no such row`, while a create on an absent id succeeds. Telling the two apart needs the other partner's random UUID. Pinned in the same file. Revisit it if a routine id is ever stored where the other partner can read it, such as an order list or a link.
- The routine day is fixed to UTC+7 with a 04:00 cut-off (`shared/routines.ts`) and ignores `settings.timezone`. The default zone is Asia/Jakarta, which has no daylight saving time. `test/routines-schedule.test.ts` pins the cut-off.
- The browser keeps one database per side, `wp-a` and `wp-b`, and nothing is cleared when the signed-in side changes: the app opens only the partition of the side the server reports, so the other side's rows, unsent changes and rejections are not in the database it has open. A start sends a probe with no side (`GET /api/sync?since=9007199254740991`, which returns no rows), opens the partition of the `me` in the answer, and shows and sends nothing before that. Every `/api/sync` and `/api/export` request carries the side it was made for (`X-Wp-Side`; an export link carries `side=` in its query because a link cannot set a header). When it differs from the signed-in side the Worker answers `409 side_mismatch` and does no read and no write. A tab that gets it stops syncing, keeps its partition untouched, parks nothing as rejected and shows "Signed in as someone else. Reload this page.", so a tab loaded as one partner cannot write under the other. A request without the header is served as before. The one trade-off: when the probe fails (no network, a probe that gets no answer within 4 s, an expired login) the app opens the partition of the last confirmed side, a hint in `localStorage`, read-only, without waiting longer. That is the device's own last state, but another partner who signs in on the same device sees it until the first answer, which switches to their own partition. While the side is unconfirmed every write (create, update, remove, import, settings, discarding a parked entry) is refused with "Sign-in not confirmed yet. Changes are paused. Try again when you are back online." and nothing is queued or written, so no entry can end up in the other partner's partition. The probe is retried after 5 s, 15 s, 60 s and then every 60 s, and on `online` and `visibilitychange`; the answer lifts the pause on the same side or opens the other side's partition, with no reload. An expired login with a hint keeps the read-only state and offers "Log in again". A tab in `mismatch` renders no rows. With no hint and no network nothing opens. The database that predates the partitions (`wp`) is copied once into the first side the server confirms, if that side or nobody used it last, and is kept as it was apart from a marker. `test/partition.test.ts` and `test/worker-side.test.ts` pin this.

## Bootstrap

The top-level D1 binding in `wrangler.jsonc` holds the real production `database_id`. Only `env.dev` keeps the all-zero placeholder, which must never reach production. The bootstrap that created the database is in section 8 of `docs/infra.md` on the `docs` branch (`git show docs:docs/infra.md`).
