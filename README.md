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
- The routine day is fixed to UTC+7 with a 04:00 cut-off (`shared/routines.ts`) and ignores `settings.timezone`. Both partners are in Asia/Jakarta, which has no daylight saving time. `test/routines-schedule.test.ts` pins the cut-off.
- The browser cache is reset when the server reports a side other than the cached one. Until the server confirms the side in a session, private rows and parked rejections are not shown. The unsent changes of the earlier identity are dropped without a notice, since a notice would tell the new identity how much the other one wrote. `test/store-identity.test.ts` pins this.

## Bootstrap

The top-level D1 binding in `wrangler.jsonc` holds the real production `database_id`. Only `env.dev` keeps the all-zero placeholder, which must never reach production. The bootstrap that created the database is in section 8 of `docs/infra.md` on the `docs` branch (`git show docs:docs/infra.md`).
