# Movies and Series: the Library gains two screens

Research and design as of 26 October 2026. A decision document, no code. Every claim carries **[verified]** (a page, a file, the code or a public download was read, or a measurement was run, on that date), **[assumed]** (reasoning or an unconfirmed source) or **[unverified]** (it needs the TMDB token, so only the first acceptance measurement in §4.4 can settle it).

> **Privacy.** This repo is public. The two users are **Partner A** and **Partner B**. The only titles named here are famous public ones, used to check coverage (§4). No watch list of the operator was read or is needed. No TMDB payload was recorded: the tests in §5 use invented fixtures. No secret, account or Cloudflare identifier appears.

## Summary

1. **Data:** no migration. Two kinds in the generic `items` table, `movie` and `series`, sharing one field set: a shared `status` (`want`, `watching`, `watched`), `who` (whose pick, default both), `done_on` (the day watched), `note`, a rating per partner (`rating_a`, `rating_b`, 1 to 5, as books do), `original_title`, `year`, and three TMDB keys: `tmdb` (the id), `cover` (the poster URL) and `tmdb_at` (the day they were fetched). No seasons or episodes.
2. **What TMDB's terms change:** free for non-commercial use with attribution, and "Cache, for longer than 6 months, any information obtained through or from TMDB". So `tmdb` and `cover` carry a stamp, a refresh is offered at 120 days and both are cleared at 170 days. Overview, genres, cast, ratings and popularity are never stored. Poster images are never copied, proxied or resized.
3. **Route:** a new `GET /api/lookup/screen`, not an extension of `/api/lookup`. Query forms: `kind` plus `title` (plus an optional `year`), or `kind` plus `id`. It calls `/search/movie` or `/search/tv`, never `/search/multi`.
4. **Language:** `id-ID` first, `en-US` only when the first pass has no hit, and the original title is always returned and shown when it differs.
5. **Cache and errors:** the Workers Cache API for 24 hours (TMDB's ceiling is six months), stamp-checked, only definite answers. Errors are never cached. The token travels only in the `Authorization` header.
6. **UI:** the Library gets tabs Books, Movies, Series. Each kind has one screen with Watching, To watch and Watched, and no combined wishlist. The TMDB credit (logo and the sentence the terms require) shows under the lookup list, at the foot of both screens and in a Credits section in Settings.
7. **Import:** later. **Find posters:** yes, in slice 3, as a button on the screen, with the same one-second pacing as books.
8. **Coverage:** all 20 sample titles exist in TMDB's catalogue under their original title **[verified]**, from the public daily id exports. How well typed titles are found, how Indonesian titles come back and how many posters exist is **[unverified]**. The first acceptance measurement is in §4.4.
9. **Slices:** three PRs. Slice 1 is the screens with no TMDB. Slice 2 is the Worker route and the client calls, with no UI. Slice 3 is the lookup list, posters, attribution, expiry and Find posters.

---

## Starting point (the code this builds on)

Read on `main` at `6e1997b` **[verified]**.

- **Registry.** `shared/tables.ts` holds one `items` table with variants chosen by `kind`; `shared/validate.ts` validates every column and `data` key against it; `worker/export.ts` exports any variant as CSV; the Settings export list is built from `views` in `src/ui/registry.ts`.
- **Covers.** The `cover` type is an allow-list of hosts (`isCover`, `COVER_SHAPE`). The `Cover` component draws the image lazily, with `referrerPolicy="no-referrer"`, and falls back to a generated cover on error.
- **Lookup.** `worker/lookup.ts` serves `/api/lookup` for books. `src/store/lookup.ts` (`createLookup`) holds the client side: an in-memory cache, an 8 s timeout, `Outcome` kinds `offline`, `failed`, `slow`, `stale`, and `retry` from `Retry-After`. `src/store/details.ts` holds the paced "Find covers and details" batch (`GAP_MS` 1,000 ms, back-off, at most 3 busy answers).
- **Nav.** `Library` is a nav item that opens `#/books`. `marriageTabs` and `MarriageTabs` are the only space tabs. `worker/index.ts` switches on the exact path; `SIDED` lists `/api/sync`, `/api/export` and `/api/feed`.
- **Home.** `src/domain/lately.ts` turns every `items` row into an activity line except places, routines and some copies.
- **Checks.** `npm run check` forbids `fetch(` in `src/views`, `src/ui` and `src/hooks`, so client requests live in `src/store`. `test/heading-outline.test.ts` pins that no screen skips a heading level.
- **Names that stay** (`docs/rename-nestora.md` §4). Nothing new uses `wp`: the Worker's user agent names `nestora.atqamz.com`, the secret is `TMDB_TOKEN`, no new browser storage key is added, `X-Wp-Side` is untouched.

---

## TMDB terms: quoted, and what each means for us

Read on 26 October 2026 from the API Terms of Use (last updated 20 October 2023), the FAQ and the rate-limiting page of the developer docs **[verified]**. The terms say TMDB may change them "at any time" (§10.H), so slice 3's reviewer re-reads them before merging.

| # | Requirement (quoted) | Where | What it means for us |
|---|---|---|---|
| T1 | "Our API is free to use for non-commercial purposes as long as you attribute TMDB as the source of the data and/or images." "Your project is considered commercial if the primary purpose is to create revenue for the benefit of the owner." | FAQ | Nestora is a private two-person app behind a login, with no revenue: non-commercial. If it is ever opened to others or charged for, §2 of the terms ("Commercial Use Requires a Commercial Agreement") applies and this feature must go or get an agreement |
| T2 | "You must use the TMDB logo to identify Your use of TMDB, the TMDB APIs, or TMDB Content." | §3 | The logo appears wherever TMDB data or posters are shown (§3.3) |
| T3 | "Any use of any TMDB logos in Your Application must be less prominent than the logos or marks that primarily describe or identify Your Application and must make it clear that use of any TMDB logos does not imply any endorsement, certification, or other approval by TMDB." | §3 | The logo is 12 px tall at the default text size, against 31 px for the Nestora wordmark, and sits next to the not-endorsed sentence |
| T4 | "You must place the following notice prominently in or on Your Application: 'This [website, program, service, application, product] uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.'" | §3 | We print: "This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB." The FAQ quotes an older sentence, "This product uses the TMDB API but is not endorsed or certified by TMDB."; the terms are the contract and the longer sentence, so it wins |
| T5 | "When attributing TMDB, the attribution must be within your application's 'About' or 'Credits' type section." | FAQ | A Credits section in Settings carries the logo and the sentence. The lookup list and the two screens carry them too, so a reader meets them where the data is |
| T6 | "Our logo should not be modified in color, aspect ratio, flipped or rotated except where otherwise noted." "When using a TMDB logo, we require you to use one of our approved logos." | FAQ | One approved logo, the "short" SVG, served unmodified from `public/tmdb.svg` (2,065 bytes, ratio 7.7 to 1). A test pins its hash. Self-hosting means opening the app makes no request to TMDB for the logo |
| T7 | "When referring to TMDB, you should use either the acronym 'TMDB' or the full name 'The Movie Database'. Any other name is not acceptable." | FAQ | UI strings say "TMDB" and nothing else |
| T8 | "Cache, for longer than 6 months, any information obtained through or from TMDB or the TMDB APIs." | §1.C | The rule that shapes the data model (§1.5): everything we keep that only TMDB can supply expires. The Worker's cache is far shorter (§2.5) |
| T9 | "If TMDB terminates Your license ... you must promptly delete or otherwise purge all TMDB Content, including any cached content." and "TMDB may terminate the license at any time for any reason." | §1.D | The app must work with no TMDB at all: typed rows keep working, a missing poster draws the generated cover, and a failed lookup says "type it in". Purging is one data patch (§1.5) |
| T10 | "Use TMDB as an image hosting service for banner advertisements, graphics, etc." and "Make derivatives of the TMDB APIs or TMDB Content." | §1.C | We link the poster from TMDB's CDN and never copy, proxy, resize or re-encode it. Scaling it inside the cover box in CSS is display, not a derivative **[assumed]** |
| T11 | "Attempt to cloak or conceal Your identity, or the identity of any ... application ... that accesses TMDB or the TMDB APIs" | §1.C | The Worker sends `User-Agent: Nestora/1.0 (+https://nestora.atqamz.com)`, the same agent it sends Open Library |
| T12 | "uses an excessive amount of bandwidth" and "They sit somewhere in the 40 requests per second range. This limit could change at any time so be respectful of the service we have built and respect the 429 if you receive one." The error table lists HTTP 429, code 25: "Your request count (#) is over the allowed limit of (40)." | §1.C; rate-limiting page; errors page | Two people never come near 40 a second. We still pace the batch, cache answers and answer 429 as `busy` with a wait. The docs do not say whether the limit counts per key or per address, and mention no `Retry-After` header **[unverified]** |
| T13 | "Use the TMDB APIs or TMDB Content in connection with, including for training, a machine learning (ML) or artificial intelligence (AI) based Application." | §1.C | Nestora has no model. TMDB content never goes to one, and the test fixtures are invented, not recorded (a recorded payload in a public repo would be a permanent copy, against T8) |
| T14 | "The default method to authenticate is with your access token ... expected to be sent along as an Authorization header." and "Version 3 is controlled by either a single query parameter, api_key, or by using your access token as a Bearer token." | Authentication page | Header only. A query-string key would land in URLs, cache keys and logs, so the code never builds one |
| T15 | "TMDB reserves the right to ... change, suspend, or discontinue any aspect of the TMDB APIs at any time" | §5 | Same answer as T9 |

---

## 1. Data model

### 1.1 Decision: two kinds, one shared field set

**`movie` and `series` are two variants of `items`, built from one shared constant.** No migration, no new table: the exit rule in `docs/features.md` §7.2 is not met (no relational integrity beyond what a row holds, no money, a few hundred rows at most, the same privacy as the rest). A movie is one row. Books needed a `copy` child because a book is an object on a shelf; a film has no place and no lending, so nothing is added for that.

| | A. Two kinds `movie`, `series` | B. One kind `screen` with `data.media` | C. Reuse `book` |
|---|---|---|---|
| TMDB id | Unique inside a kind: `tmdb` alone | Unique only with the media type: two keys | n/a |
| Screens and queries | `kind = 'movie'`, no filtering of `data` | Every list filters on `data.media` | Books lists would show films |
| Export | One CSV per kind | One mixed CSV | n/a |
| Cost | Two registry entries (one constant, spread twice), two `views` entries | One entry, a filter in every view and test | Wrong shelf, wrong statuses |

*Trade-off:* the second variant is about six registry lines and one `views` entry. A single `screen` kind saves those and pays in a `media` filter everywhere.

### 1.2 Registry entries (`shared/tables.ts`)

Same shape as the existing variants **[verified, read `shared/tables.ts`]**. Every type used already exists. `doneOnStatus` is the mechanism `copy` (`gone`) already uses.

```ts
const screen = {
  original_title: "text",
  year: "int",
  rating_a: ["1", "2", "3", "4", "5"],
  rating_b: ["1", "2", "3", "4", "5"],
  cover: "cover",
  tmdb: "int",
  tmdb_at: "date",
} as const;

movie: {
  columns: ["status", "who", "done_on", "note"],
  required: ["status"],
  status: ["want", "watching", "watched"],
  doneOnStatus: "watched",
  caps: { "data.year": 2200 },
  data: screen,
},
series: {
  columns: ["status", "who", "done_on", "note"],
  required: ["status"],
  status: ["want", "watching", "watched"],
  doneOnStatus: "watched",
  caps: { "data.year": 2200 },
  data: screen,
},
```

Slice 1 declares the first four `data` keys. `cover`, `tmdb` and `tmdb_at` arrive in slice 3, so slice 1 has no TMDB data at all. **Validation** is the registry: `shared/validate.ts` checks every column and key from it, so the kinds need no validator code. The one change there is the poster allow-list in `isCover` (slice 2): exactly `https://image.tmdb.org/t/p/w342/` plus a file name of letters, digits, `_` or `-` and `.jpg`, so look-alike hosts, another size, a query string or `http:` are refused.

| Column or key | Meaning |
|---|---|
| `title` | The title the couple use. Copied once from a lookup hit, then theirs to edit |
| `status` | `want` ("To watch"), `watching`, `watched`. Both kinds use all three, so there is one code path. A film left half-seen is `watching` |
| `who` | Whose pick it is: `a`, `b` or `both`. Optional, shown as an avatar when it is one partner, default `both`. It is the only way to say "Partner B's suggestion" |
| `done_on` | The day it was watched. Set to today when the status becomes `watched`, cleared when it leaves it (the validator rejects `done_on` on any other status) |
| `note` | Free text: why, where to watch, and where a series is up to. This replaces season and episode fields |
| `data.original_title` | Shown under the title when it differs. Typed or copied from a hit, then the couple's own text |
| `data.year` | The release year (first air year for a series), an integer |
| `data.rating_a`, `data.rating_b` | Each partner's own 1 to 5, as books do. Shown and settable only when the row is `watched`. Separate keys mean two phones merge cleanly through `json_patch` |
| `data.cover`, `data.tmdb`, `data.tmdb_at` | The poster URL, the TMDB id and the day both were fetched. Slice 3. The only keys that expire (§1.5) |

**Status semantics.** The status belongs to the couple, not to each partner: the common case is watching together. If one partner has already seen it, the row stays `want` and the note says so. Per-partner states (`seen_a`, `seen_b`, as books keep `reading_a`) would double the state keys and the UI for a case this household rarely has; they can be added later with no migration (open question 2).

**Series progress: none.** "Seasons progress" is not justified yet. It needs either two typed integers or TMDB's season counts (a details call per series, a second endpoint to cache and expire). The note already holds "S2, episode 5" at the cost of nothing. Trigger to add `data.season` and `data.episode` as plain integers: a partner asks for them.

### 1.3 Ratings and notes, the way books do

`rating_a` and `rating_b` follow `reading.ts`: tap a star to set it, tap the same star to clear it, patch only `rating_${me}`. Notes are the `note` column, edited through the same `ItemForm` as every other item. No TMDB or other public rating is fetched or stored: no screen needs one, it would expire under T8, and the books design decided the same.

### 1.4 What is stored, and what never is

| TMDB gives | We keep | Why |
|---|---|---|
| `id` | `data.tmdb`, expires | The one reference that makes "refresh the poster" exact |
| `title` or `name` (localised) | `title`, the couple's own | Without a title the row has no meaning. We treat the text the couple accepted as their entry, like a typed note. This is our reading of T8, not TMDB's wording: risk R2 |
| `original_title` or `original_name` | `data.original_title`, the couple's own | Same footing as the title. Never stored when it only repeats the title |
| `release_date` or `first_air_date` | `data.year` (four digits), the couple's own | A fact shown beside the title |
| `poster_path` | `data.cover`, the full URL `https://image.tmdb.org/t/p/w342/<file>.jpg`, expires | Reuses `Cover` and `isCover` unchanged |
| `overview` | Never | A synopsis is TMDB's text and a long one. "Open on TMDB" (§3.2) answers "what is it about" with a plain link and no copy |
| `genre_ids`, `backdrop_path`, `popularity`, `vote_average`, `vote_count`, `original_language`, `adult`, `video`, `origin_country` | Never | No screen shows them |
| Runtime, seasons, episodes, networks (details endpoints) | Never | No screen shows them |
| Image bytes | Never | Never copied, proxied or resized (T10). No R2 and no Cloudflare Images |

The Worker drops every other field before anything is cached or sent, as it drops Google's description for books. The Cache API entry holds only the six normalised hit fields (§2.4).

Posters load from TMDB's CDN in the browser, so TMDB sees the phone's IP address and which posters are on screen; §3.5 has the sentence the README repeats, like the Google one for books.

*Alternatives for the poster.* Storing the path alone and building the URL at render time lets one size change in one place, but needs a change in `Cover` and a second validator. Copying the image into R2 needs a payment method and makes a derivative (T10). A full URL costs 55 characters a row.

**Image size.** TMDB's `/configuration` example lists poster sizes `w92`, `w154`, `w185`, `w342`, `w500`, `w780`, `original` and the secure base `https://image.tmdb.org/t/p/` **[verified from the reference's example response, not a live call]**. The row stores `w342`: a 2:3 poster at 342 px wide is sharp in the 44 px list cover at three times the pixel density and in the detail header. Reading `/configuration` at run time would cost a request and a cache for a constant that has not changed in years **[assumed]**. A test pins the host and size; if TMDB ever changes them the image fails and the generated cover shows.

### 1.5 Expiry of TMDB data (T8)

`data.tmdb_at` (a `date`, written in the same patch as `tmdb` or `cover`) starts the clock.

| Age of `tmdb_at` | What happens |
|---|---|
| under 120 days | nothing |
| 120 to 169 days | the row counts as "needs details": Find posters (§3.7) refreshes it by id, and the screen shows "N posters need a refresh" the way books show their remaining count |
| 170 days or more, or missing | a small sweep, run in `Shell` beside `sweepUndone`, sends one patch per row that sets `cover`, `tmdb` and `tmdb_at` to `null`. It touches nothing else: not the title, rating, status, note, year or original title |

170 days is about 5.6 months, leaving 12 days of margin under T8's six months for a phone left closed (the sweep runs when a client opens the app). A row whose id was deleted at TMDB (404 on refresh) is purged the same way and shows the generated cover until Find posters searches it again by title and year.

*Alternatives.* Never purging is the simplest and breaks T8 as written. Refreshing automatically when a row is opened writes without the couple asking, and still needs a purge for rows nobody opens. A stricter reading (T8 covers the accepted title, year and original title too) would also clear those on expiry and leave empty rows: open question 1, with the cost stated.

**Home noise.** The sweep and a refresh are writes by a partner, so `lately` would show "changed" lines. The rule is one line in `src/domain/lately.ts`: `movie` and `series` rows produce `added` and never `changed`. A `watched` verb can be added later if the couple want it.

### 1.6 Sync, sides and export

- **Sync.** No `parent_id`, so `worker/sync.ts` `refs` is untouched. Both partners read and write every `movie` and `series` row; nothing in them is private, and `hides()` (routines only) is unaffected. They reach both partners by design.
- **Per-side rules.** The browser databases `wp-a` and `wp-b`, the `X-Wp-Side` check and the paused state while the side is unconfirmed are unchanged: screens write through the same `actions`. The server does not stop a client from writing the other partner's `rating_x` key (it does not for books either), so the UI writes only `rating_${me}` and shows no rating control while `me` is null. A test pins both.
- **Export.** `worker/export.ts` accepts any variant, so `kind=movie` and `kind=series` CSV need no Worker code. The Settings links come from the two new `views` entries and two strings in `text.export`. The JSON dump includes the rows, with their TMDB keys while they live.
- **Example rows.** Fictional, in the shipped schema, shortened. `rev`, `updated_by` and the timestamps are written by the Worker as for every row.

```sql
INSERT INTO items (id, kind, title, status, who, done_on, note, data, rev, created_at, updated_at, updated_by)
VALUES ('m-1', 'movie', 'Pengabdi Setan', 'watched', 'both', '2026-10-17', 'Lights on, both of us',
  '{"original_title":"Pengabdi Setan","year":2017,"rating_a":"4","rating_b":"3",
    "cover":"https://image.tmdb.org/t/p/w342/<file>.jpg","tmdb":<tmdb id>,"tmdb_at":"2026-10-17"}',
  57, '2026-10-17T14:00:00Z', '2026-10-17T14:02:00Z', 'a');

INSERT INTO items (id, kind, title, status, who, note, data, rev, created_at, updated_at, updated_by)
VALUES ('s-1', 'series', 'Gadis Kretek', 'watching', 'b', 'Episode 3 next',
  '{"year":2023}', 58, '2026-10-18T10:00:00Z', '2026-10-18T10:00:00Z', 'b');
```

---

## 2. Worker lookup route

### 2.1 Decision: a new route, `GET /api/lookup/screen`

| | A. New `/api/lookup/screen` | B. Extend `/api/lookup` with `kind` |
|---|---|---|
| `worker/index.ts` | One more `case` (the switch matches the exact path) | None |
| Books code | Untouched: its provider chain (Google, then Open Library), its 8-hit shape and its tests stay as they are | `queryOf`, `cacheKey`, `lookupBooks` and `parseLookup` all grow a second meaning; a TMDB bug can break book lookups |
| Cache and errors | Its own cache prefix and error map | One map serving two providers whose failures mean different things (TMDB has no fallback source) |
| Cost | A new file `worker/screen.ts`, and five helpers exported from `worker/lookup.ts` (`body`, `waitOf`, `refuse`, `recall`, `remember`, the last two made generic over the payload): no behaviour change, books tests unchanged | The tests of both providers entangle |

**Decision: A.** The route is under `/api/*`, so Cloudflare Access and the Worker's own JWT check run first, before any validation or upstream call. It is read-only and carries no per-partner data, so it is not in `SIDED`; like `/api/lookup` and `/api/me` it answers whichever partner is signed in, whatever `X-Wp-Side` says.

### 2.2 Query forms

`GET /api/lookup/screen?kind=movie|series&title=<2 to 200 characters>[&year=<4 digits>]`, or `?kind=…&id=<positive integer>`. The two forms never mix; anything else is `400 {"error":"bad_query"}`. The title is folded like the books title (NFC, control characters to spaces, whitespace collapsed, lower-cased), so "Pengabdi  Setan" and "pengabdi setan" share a cache entry. A year is 1880 to 2200. The id form is for refreshing a row that has a `tmdb`.

Screens accept two-letter titles ("Up", "It"); the client's three-letter minimum for book searches does not apply.

### 2.3 Which TMDB endpoints, and the language strategy

| Call | Used for |
|---|---|
| `GET /3/search/movie` with `query`, `language`, `include_adult=false`, `page=1`, and `primary_release_year` when a year was typed | `kind=movie`, title form |
| `GET /3/search/tv` with the same, and `first_air_date_year` | `kind=series`, title form |
| `GET /3/movie/{id}` and `GET /3/tv/{id}` with `language` | id form |

Parameters verified in the reference's OpenAPI definitions **[verified]**: `query` is required, `language` defaults to `en-US`, `include_adult` to `false`. The reference describes the movie search as "Search for movies by their original, translated and alternative titles", the TV search as "Search for TV shows by their original, translated and also known as names", and the Finding Data guide says text search "takes into account all original, translated, alternative names and titles".

Headers on every call: `Authorization: Bearer <TMDB_TOKEN>`, `accept: application/json` and the identifying `user-agent` (T11, T14). `redirect: "manual"`, so a redirect can never carry the token anywhere.

**Not used, with the reason.** `/search/multi` also returns people and has no year filter, and the UI always knows the kind because the partner opened Movies or Series. `/find/{external_id}` (IMDb ids) has no flow yet; it becomes the import's lookup if import is built (§3.6). `/configuration` (§1.4) and `append_to_response` cost requests for nothing shown.

**Language.**
1. Ask with `language=id-ID`. Because search matches original, translated and alternative titles whatever the language, an English or Indonesian title typed by the couple should find the work in the first pass **[documented; unverified for `id-ID`]**. `language` mostly decides how `title` and the poster come back.
2. Only when pass 1 has no usable hit, ask once more with `language=en-US`. Two passes at most, 3 seconds each, 6 seconds in all, under the client's 8 second limit. An error in pass 1 stops there and is never taken for an empty answer.
3. If a hit's localised `title` is empty, show `original_title` or `original_name` instead; if both are empty the hit is dropped. The original title is returned as `original` only when it differs from `title` after folding, so an Indonesian film shows one line and a Japanese film shows "Spirited Away" with its Japanese title under it.

Whether `id-ID` is accepted, how TMDB fills untranslated fields and whether pass 2 ever changes an outcome are **[unverified]**. The §4.4 measurement answers all three. If pass 2 never changes an outcome in 30 queries, delete it and keep one request.

### 2.4 Result shape

```json
{"hits":[{"kind":"movie","tmdb":123,"title":"Pengabdi Setan","original":null,"year":2017,
          "cover":"https://image.tmdb.org/t/p/w342/<file>.jpg"}]}
```

At most 8 hits, in TMDB's order. `original`, `year` and `cover` are `null` when absent. The Worker keeps a hit only if the id is a positive safe integer, the title is non-empty after cleaning and `adult` is not `true`; `cover` passes `isCover` or becomes `null` (a `poster_path` that is not a plain `.jpg` becomes `null`). Text is cleaned of control characters and capped (title 200, original 200) before it is cached or sent. The client parses the answer again with the same rules, as `parseLookup` does for books. An error body never holds the upstream URL.

### 2.5 Cache

The Workers Cache API (`caches.default`), as books use it:

- **Key.** A synthetic URL, `https://lookup.invalid/screen/v1?kind=…&title=…&year=…` (or `&id=`), built from the folded query. No token in it, and a prefix that cannot collide with the books keys.
- **Period: 24 hours** (`max-age=86400`). TMDB's ceiling is six months (T8). A day is long enough to cover a session and a Find posters rerun, short enough that a correction at TMDB shows up the next day. The client's in-memory cache (1 hour, 50 entries) is shorter still.
- **What is kept.** Every definite answer from TMDB: a list, or a definite empty list (both passes answered 200 with nothing). Not kept: any error, an oddity, an answer to a token-less call.
- **Stamp check.** Each entry carries its own timestamp. One older than the period, stamped in the future, with no stamp or with a bad one is not served, even if the cache still holds it. The client sees `Cache-Control: no-store`. A cache that fails is skipped, never an error. The Cache API is per data center.

### 2.6 Errors and partial failure

Same spirit as books, the same `busy`/`failed` bodies, so `createLookup` needs no new outcome.

| TMDB answers | Route answers | Cached |
|---|---|---|
| 200 with at least one usable hit | `200 {"hits":[…]}` | 24 h |
| 200 and empty in `id-ID`, then 200 with hits in `en-US` | `200` with those hits | 24 h |
| 200 and empty in both passes | `200 {"hits":[]}` | 24 h |
| id form, 404 (codes 6 and 34) | `200 {"hits":[]}` | no |
| 429 (code 25) | `429 {"error":"busy","retry":n}` and `Retry-After: n`, where n is TMDB's header as a whole number from 1 to 3600 and 30 when it is absent or bad | no |
| 5xx (for example codes 9, 11, 24, 43, 46) | `503 {"error":"busy","retry":30}` | no |
| pass 1 empty, pass 2 fails | the failure above, never an empty list | no |
| 401 (codes 3, 7, 10, 14, 35), 403, 422, other 4xx | `502 {"error":"failed"}` | no |
| timeout, network error, bad JSON, status other than 200, body over the cap | `502 {"error":"failed"}` | no |
| `TMDB_TOKEN` missing or blank | `502 {"error":"failed"}`, no upstream call | no |

A missing secret answers `failed`, not a new code: the client already says "type it in" and keeps going, and the rest of the app does not depend on the secret, so `wrangler.jsonc` `secrets.required` stays as it is. An invalid or suspended token looks the same to the user. The error table is from TMDB's errors page **[verified]**.

### 2.7 The token, size and time

- The secret is `TMDB_TOKEN` (an API Read Access Token, bearer). The code reads it only in `worker/screen.ts` and sends it only in the `Authorization` header of calls to `api.themoviedb.org`. It is in no URL, query string, response, header sent to a client, log line, cache key or cache entry, and the Worker logs nothing from this route, not even the query (the global handler logs only an error name). `.dev.vars.example` gets an empty `TMDB_TOKEN=` line; `.dev.vars` is git-ignored. The implementer never sees the real value: the acceptance measurement runs with a token the operator puts in their own `.dev.vars`.
- **Size.** The body is read as a stream and cancelled past 256 KiB, with or without a length header, as `body()` does for books at 1 MB. A page of 20 results is about 10 to 25 KB in the reference's example **[assumed from the example payload]**, so 256 KiB leaves ten times the room.
- **Time.** 3 seconds per TMDB call, through `AbortSignal.timeout`.
- **Rate limit on our side.** One lookup costs at most two Worker subrequests; a cache hit costs none. The client (`createLookup`) already waits 400 ms after typing and aborts a search that is replaced.

### 2.8 Client

`createLookup` gains `screen(input)` and `screenById(kind, id)`, which reuse its private `get()` with `own = true`: the in-memory cache, the 8 second limit, `credentials: "same-origin"`, `redirect: "manual"`, the check that a 429/502/503 answer is our JSON (anything else, such as an Access login page, counts as offline), `Retry-After` into `retry`, and `stale` on abort. There is no direct call to TMDB from the browser: it would need the token. Offline shows "Offline: type it in."

---

## 3. UI

### 3.1 Where it lives

- **Tabs.** The Library nav item keeps opening `#/books`. List screens get tabs **Books · Movies · Series** (`<nav className="space-tabs" aria-label="Library">`). `MarriageTabs` becomes a one-line wrapper over a new `SpaceTabs({ tabs, label, screen })`, so no marriage view changes. The Library item's `screens` becomes `["books", "movies", "series"]`, so it stays current on all three. Detail pages carry no tabs, as marriage details do; they have a trail link back.
- **Routes.** New words `movies` and `series` (`#/movies`, `#/movies/<id>`, `#/series`, `#/series/<id>`), and two `Screen` values. The route table stays a static table.
- **No combined wishlist.** "To watch" is a section of each screen. A merged "what shall we watch tonight" list across both kinds costs a third screen and mixes two tab meanings; it is a client-side filter if the couple ask (open question 4). Books keep their own Shelf and Wishlist.
- **Global add chips (changed by UX T9).** The global + sheet has Movie and Series chips that close it and open the screen's own sheet with the typed text as the title, and + on the Movies or Series screen preselects that kind. Each screen keeps its own "Add a movie" or "Add a series" button.
- **Home** is unchanged.

### 3.2 The screens

```
┌──────────────────────────────────────┐
│ nestora               ✓     (A)(B)   │
│ Books    [Movies]    Series          │   ← Library tabs
│                                      │
│ Movies                               │   ← the one h1
│ ( + Add a movie )                    │
│ ⌕ Search movies                      │
│                                      │
│ Watching now                         │   ← h2, only when there is one
│ ┌──┐ Pengabdi Setan                  │
│ │▓▓│ 2017                            │
│ └──┘ (B)                             │
│                                      │
│ To watch  3                          │   ← h2
│ ┌──┐ Spirited Away                   │
│ │▓▓│ 千と千尋の神隠し · 2001            │
│ └──┘                                 │
│ …                                    │
│ ▸ Watched  12                        │   ← a details, open when 30 or fewer rows
│ ┌─ TMDB ────────────────────────────┐│
│ │ This application uses TMDB and …  ││   ← credit, only when a poster shows
├──────────────────────────────────────┤
│ Home  Marriage  ( + )  Routines  Library
└──────────────────────────────────────┘
```

- **Sections.** Watching now, To watch (the manual `sort` order, new rows on top as books do), Watched (newest `done_on` first, each row showing both partners' stars). Section titles are `h2`; the Watched `summary` is not a heading. Search is the same fold as books, over title and original title, and appears once there is a row.
- **Detail** (`#/movies/<id>`): the poster, title, original title, year; a three-way status control; ratings for both partners (yours settable, theirs read only) once watched; notes; "Open on TMDB" (a plain link to `https://www.themoviedb.org/movie/<id>` or `/tv/<id>` **[assumed URL pattern]**, shown only while `tmdb` is set, 44 px, new tab, no opener, no referrer); the generic edit form; remove with the same undo as books. Headings: the title is `h1`, the sections are `h2`.
- **Add sheet** (`ScreenSheet`, not an extension of `BookSheet`, which is tied to ISBNs, places and scanning; it shares `Modal`, `Field`, `Cover` and `useBusy`): Title (required), Year (optional, numeric), chips To watch or Watched, a "For" choice (both by default). Under the title, from two letters and 400 ms after the last keystroke, a lookup list; "Add as typed" always works.

```
┌──────────────────────────────────────┐
│ Add a movie                       ✕  │
│ ( To watch ) ( Watched )             │
│ Title  [ spirited aw          ]      │
│ Year   [      ]                      │
│ ┌──────────────────────────────────┐ │
│ │┌──┐ Spirited Away                 │ │
│ ││▓▓│ 千と千尋の神隠し · 2001          │ │
│ │└──┘                               │ │
│ │┌──┐ …                             │ │
│ └──────────────────────────────────┘ │
│ [TMDB]                               │
│ This application uses TMDB and the   │
│ TMDB APIs but is not endorsed, …     │
│ For  ( Both ) ( A ) ( B )            │
│ [ Save ]                             │
└──────────────────────────────────────┘
```

Picking a hit fills title, original title, year, poster, id and `tmdb_at`; a typed year is never overwritten by a hit. The states and their words copy books: searching, "Offline: type it in.", "No match. Keep typing.", failed and slow lines that end "Keep typing.".

### 3.3 Attribution and layout, measured

One `TmdbCredit` component: the unmodified logo (`<img src="/tmdb.svg" alt="TMDB">`, 12 px tall, `width: auto`) above the sentence from T4 as plain text, in the existing `.credit` flex block (wraps, `overflow-wrap: anywhere`). It renders (a) under the lookup list, (b) at the foot of the Movies and Series screens whenever a row shows a poster or an id, and (c) in a Credits `h2` in Settings. The credit's link target is `https://www.themoviedb.org`, opened without opener or referrer.

I built a static mock from the repo's own CSS on `main` (the same `.hit`, `.cover`, `.credit` and sheet rules, the real fonts) and measured it in Chromium, with a persistent profile at 200 percent text, one sheet with four hits, one of them with a 49-character title and the same text as its original **[verified, measured on the mock, not the product]**:

| Viewport | Text | Horizontal overflow | Hit rows | Credit in the sheet | Credit on the screen | Logo |
|---|---|---|---|---|---|---|
| 320 px | 100% | none | 82 to 121 px | 3 lines | 3 lines | 92 × 12 px |
| 390 px | 100% | none | 82 to 100 px | 3 lines | 2 lines | 92 × 12 px |
| 320 px | 200% | none | 306 to 634 px | 9 lines | 8 lines | 185 × 24 px |
| 390 px | 200% | none | 264 to 511 px | 6 lines | 5 lines | 185 × 24 px |

What this says: nothing overflows sideways and the logo always fits. At 200 percent on a 320 px phone a hit is nearly the height of the visible sheet, because the cover and the text stack; that is how the book hits already behave. The sentence is nine lines there and the sheet scrolls, which costs a scroll and nothing else. With the logo above the sentence the credit is two lines shorter at the default text size than with the logo beside it, and the same at 200 percent, so the layout is `flex: 1 1 100%` on the sentence. The logo is 12 px tall against the Nestora wordmark's 31 px at the default size; at 200 percent text it is 185 px wide against the wordmark's 124 px on a 320 px phone (the wordmark shrinks with the viewport), shorter but wider, so a test pins the height, and R4 says to look again if TMDB objects.

Every hit is a real `button` of at least `--row-min` (60 px), the credit link and "Open on TMDB" are at least `--target-min` (44 px), long titles wrap (`min-width: 0`, `overflow-wrap: anywhere`), and the original title line is left out when it only repeats the title.

### 3.4 Headings, empty states, words

- No screen skips a level: `h1` (the title), `h2` for sections, never `h4` before `h3`. `test/heading-outline.test.ts` gets `movies`, `series` and the Credits section of Settings.
- **Empty states.** No rows: "No movies yet. Add one you want to watch." with the add button above it. Everything watched: "Nothing left to watch. Add another movie." No search match: "No match." No poster, a failed image or an expired one: the generated cover with initials. Lookup unavailable (no token, TMDB down, offline): "Offline: type it in." or the failed line, and typing still saves.

### 3.5 Posters and privacy

Posters load straight from TMDB's CDN, `image.tmdb.org`, in the browser, without a referrer, so TMDB sees the phone's IP address and which posters are on screen; the Worker hides only the search, as for Google's covers. They are lazy, sized by their box and never copied, proxied or resized. A lookup sends only the typed title, the kind and an optional year to the Worker and from it to TMDB: never a partner's name, a note, a rating or who picked it. The logo is self-hosted, so it adds no request.

### 3.6 Import: later

A list import for movies makes sense only with a source list, and none is known. The existing importer is built for books (`import-text.ts`, `import-csv.ts`, `import-plan.ts`, the `ImportBooks` view, `import_batch` undo). Generalising it before there is a list is guessing at columns. If the operator has an IMDb or Letterboxd export, that is the trigger: both give a title and a year, and an IMDb id would go through `/find` (`external_source=imdb_id`), the one place `/find` earns its keep. Default: no import (open question 3).

### 3.7 Find posters: yes, in slice 3

Rows typed by hand have no poster or id, and rows past 120 days need a refresh (§1.5). So the screen has a "Find posters" button, shown when any row needs details, with the same sequential loop as books: one request about every second (`paced`, `GAP_MS`), back-off on `busy`, a stop at three busy answers, abortable, with a tally. TMDB would allow far faster (T12); one second keeps one pace for the app, and 150 rows take about two and a half minutes. It lives on the screen, not on an import screen, because there is no import.

It fills only what is empty and never writes a title. A row with an id is refreshed by id. A row without one is searched by title and year, and written only when exactly one hit has a title or original title equal to the row's after folding and, if the row has a year, the same year; two candidates or none is counted "unsure" and nothing is written. That is the wrong-item rule for the batch. Reusing `findDetails` means passing it the attempt as a callback instead of hard-wiring ISBNs; that refactor is part of slice 3.

---

## 4. Coverage check

### 4.1 What was and was not done

- **No call to the TMDB API.** There is no token here and none was sought.
- **Read:** the API Terms of Use, the FAQ, the authentication, languages, rate-limiting, errors, images, search, finding-data and daily-export pages, and the OpenAPI definitions of the search, details, find and configuration endpoints.
- **Downloaded:** TMDB's public daily id exports dated 25 October 2026 (`movie_ids` 28 MB, `tv_series_ids` 5 MB, one request each). The page says "There is currently no authentication on these files". Each line holds an id, the original title, a popularity number and flags; no year, no translation, no poster. They were kept in scratch and deleted with it. The exports hold 1,264,168 movie lines and 235,044 series lines.
- **Not done:** any scraping of TMDB's website, any search by typed title, any `id-ID` request, any poster fetch.

### 4.2 The 20 titles

Picked to be famous and public: 7 Indonesian films, 5 Indonesian series, 8 international (4 films, 4 series). "Found" means the export holds an entry whose original title equals the title in the table after folding case and accents, or, where the table says "as", the original-language title given there (a public fact, not something the export says) **[verified]**. "Same-title entries" counts how many entries share that exact original title, which is how ambiguous a bare title is. Popularity is TMDB's number on 25 October 2026.

| # | Title (as typed) | Kind | Group | Found | Same-title entries | Top popularity | Note |
|---|---|---|---|---|---|---|---|
| 1 | Laskar Pelangi | movie | Indonesian film | yes | 1 | 1.2 | |
| 2 | Ada Apa dengan Cinta? | movie | Indonesian film | yes | 1 | 1.8 | The question mark is part of the title; a typed "aadc" is a separate test |
| 3 | Pengabdi Setan | movie | Indonesian film | yes | 2 | 5.2 and 1.8 | Two films share the title (an older film and the 2017 one **[assumed from general knowledge, the export has no year]**): the year decides |
| 4 | The Raid | movie | Indonesian film | yes, as "Serbuan Maut" | 1 under that title | 8.4 | "The Raid" is the original title of 5 other entries (top 2.0): found only if alternative-title matching works **[unverified]** |
| 5 | KKN di Desa Penari | movie | Indonesian film | yes | 1 | 2.2 | |
| 6 | Agak Laen | movie | Indonesian film | yes | 1 | 1.4 | |
| 7 | Dilan 1990 | movie | Indonesian film | yes | 1 | 1.4 | |
| 8 | Gadis Kretek | series | Indonesian series | yes | 1 | 5.2 | |
| 9 | Layangan Putus | series | Indonesian series | yes | 1 | 3.3 | |
| 10 | Ikatan Cinta | series | Indonesian series | yes | 1 | 2.6 | A long-running soap: poster and year are the doubt |
| 11 | Si Doel Anak Sekolahan | series | Indonesian series | yes | 1 | 2.1 | An older series |
| 12 | Kisah untuk Geri | series | Indonesian series | yes | 1 | 1.8 | |
| 13 | Parasite | movie | International | yes, as "기생충" | 1 under that title | 43.0 | "Parasite" is the original title of 10 other entries (top 6.2): a bare English title is noisy unless the year is typed |
| 14 | Spirited Away | movie | International | yes, as "千と千尋の神隠し" | 1 | 58.6 | |
| 15 | Inception | movie | International | yes | 1 | 69.7 | |
| 16 | Amélie | movie | International | yes, as "Le Fabuleux Destin d'Amélie Poulain" | 1 | 25.6 | "Amélie" alone is a different entry (0.5) |
| 17 | Breaking Bad | series | International | yes | 1 | 1,365.8 | |
| 18 | Squid Game | series | International | yes, as "오징어 게임" | 1 | 97.9 | |
| 19 | Money Heist | series | International | yes, as "La casa de papel" | 1 | 30.9 | |
| 20 | Attack on Titan | series | International | yes, as "進撃の巨人" | 1 | 60.1 | |

### 4.3 What to expect, and what is unverified

**Verified.** All 20 exist in TMDB's catalogue **[verified]**, so existence is not the risk for well-known titles. The Indonesian entries sit at popularity 1.2 to 8.4 against 25 to 1,366 for the international ones, so a popular namesake can outrank an Indonesian title on a bare English query (rows 4 and 13) if TMDB ranks by popularity. TMDB says only that it returns "the closest match", so that is **[unverified]**.

**Documented, so likely.** An Indonesian title typed as written should match directly, because search includes original titles. An English title that is only an alternative title (rows 4, 14, 18, 19, 20) should match if alternative titles are indexed, as the reference says.

**Unverified (needs the token).**
1. Whether `id-ID` is accepted and what comes back for a title with no Indonesian translation (an empty `title`, the English one, the original).
2. How often a typed title finds the expected work in the first three hits, with and without a year.
3. How many of the 20 have a poster, and what file extension poster paths have (the validator accepts `.jpg` only, §2.4).
4. Whether pass 2 (`en-US`) ever changes an outcome.
5. Whether TMDB answers requests from Cloudflare's egress addresses in production (the dev Worker runs locally and proves only that the code works), and per-key against per-address limits.

**Expectation, stated as a guess [assumed].** Indonesian films and current streaming series are likely well covered; long-running soaps and older series are likely thin on posters and years; typed abbreviations such as "aadc" are likely to fail. Typing stays the first-class path, and a lookup is a suggestion.

### 4.4 The first acceptance measurement (slice 2 gate)

Run by the implementer, or by the operator, on the dev Worker with the token in their own `.dev.vars`, through the route (not the API directly), one request about every second, as a scratch script that is not committed:

1. The 20 titles above, each twice: as typed in the table, and with the year added. Then 10 "as people type" variants: `aadc`, `the raid redemption`, `laskar pelangi film`, `squid game`, `money heist`, `satans slaves`, `parasite 2019`, `up`, `it`, `gadis kretek netflix`.
2. For every query record: hit count, the rank of the expected work (judged by original title and year), whether `cover` is present and its extension, whether `original` was shown, whether pass 2 ran and whether it changed the result, the wait on any `busy`, and latency.
3. Check once: the answer has none of the dropped fields and is under 10 KB; a repeat is a cache hit (no upstream call); a bogus token gives `502 failed` with no token text anywhere.

**Proposed pass marks:** the expected work is in the first three hits for at least 18 of the 20 queries with a year and 15 of 20 without; at least 14 of 20 have a poster; no status other than 200 from a valid token; p95 latency under 2.5 s. **What each result changes:** under 12 of 20 without a year makes the sheet show the Year field before the lookup list and makes Find posters skip a row that has no year; pass 2 changing nothing in 30 queries deletes pass 2; fewer than 10 of 20 posters for the Indonesian series is written into the README as "posters are best effort"; latency over 2.5 s lowers the two timeouts. The PR carries the counts, never the payloads (T8, T13).

Then, after the deploy, one real lookup on `nestora.atqamz.com`: a `502 failed` with a valid token means TMDB refuses Cloudflare's egress, and the feature stays typing-only.

---

## 5. Slices

Three PRs. Slices 1 and 2 are independent and can run in parallel; slice 3 needs both. The blocker classes are the reviewer's list: private data exposure (**P**), wrong-side writes (**S**), data loss (**D**), wrong-item writes (**W**), key leaking (**K**), TMDB terms (**T**), page freeze (**F**).

### Slice 1: Movies and Series in the Library, with no TMDB (medium)

- **Content:** the two kinds; the screens, detail and add sheet by typing; the Library tabs and routes; statuses, `done_on` and ratings; search; the `lately` rule; export.
- **Files:** `shared/tables.ts`, `src/ui/registry.ts`, `src/ui/routes.ts`, `src/ui/nav.ts`, `src/ui/marriage-tabs.tsx` (to `space-tabs.tsx`, with the wrapper), `src/ui/text.ts`, `src/domain/screen.ts` (sections, `statusPatch`, `ratingPatch`, search, save), `src/domain/lately.ts`, `src/views/screens.tsx`, `src/views/screen.tsx`, `src/views/books.tsx` (adds the tabs), `src/main.tsx` (the route to the view), `src/ui/screen-row.tsx`, `src/ui/screen-sheet.tsx`, `src/ui/screen-save.ts`.
- **Tests that fail without it:** `test/screens-data.test.ts` (a valid movie and series pass; `parent_id`, an unknown key, a rating "6", a year 99999, `done_on` on a `want` row, a status outside the three all fail); `test/screens-domain.test.ts` (sections order; `statusPatch` sets `done_on` on `watched` and nulls it on leaving, so the merged row passes `validateChange`; `ratingPatch` writes only the given side's key and clears on the same star; search folds accents); `test/store-screens.test.ts` (two identities: B pulls A's row; B's rating never changes `rating_a`); `test/nav.test.ts` (route words, the Library item current on `movies/<id>`, the three tabs); `test/heading-outline.test.ts` (`movies`, `series`); `test/screens-ui.test.ts` (tabs markup, no `fetch(`, no rating control while `me` is null, 44 px and wrap rules for the new classes); `test/domain-lately.test.ts` (a changed movie row is not listed, an added one is); `test/export.test.ts` (`kind=movie` CSV has `data.year`, `data.rating_a` and escapes a title that starts with `=`).
- **Reviewer runs:** `npm run check`; `npm run dev`, then add a movie by typing, mark it watched, rate it as Partner A, restart as Partner B (`DEV_WHO=b` in `.dev.vars`) and see A's stars and set B's own; open `/api/export?format=csv&table=items&kind=movie`; Playwright at 320 and 390 px at 200 percent text: no horizontal overflow, every target at least 44 px.
- **Blockers that apply:** **D** (status and rating patches, the `done_on` clear), **S** (rating keys follow `me`), **W** (patches address the row opened, and rows of the other kind never show), **F** (lists of a few hundred rows), **P** (both partners see every row, by design: confirm nothing private is added).

### Slice 2: the Worker route and the client calls, no UI (medium)

- **Content:** `GET /api/lookup/screen`, its cache and errors, the `TMDB_TOKEN` secret, the client methods, the poster allow-list, the README section.
- **Files:** `worker/screen.ts` (new: the upstream URLs, the TMDB response parsing, the two passes, the cache and the errors), `worker/lookup.ts` (five helpers exported, `recall` and `remember` generic), `worker/index.ts` (one `case`, `ScreenEnv` in `Bindings`), `shared/validate.ts` (`isCover` also accepts exactly `https://image.tmdb.org/t/p/w342/<[A-Za-z0-9_-]{1,64}>.jpg`, plus the message), `src/domain/tmdb.ts` (only what the browser may know: the query rules and folding, our own route URL, the cache key and the parse of our own hit shape), `src/store/lookup.ts` (`screen`, `screenById`), `.dev.vars.example` (`TMDB_TOKEN=`), `README.md` ("Movies and series lookup": route, secret, cache, terms), `test/fixtures/tmdb/*.json` (invented payloads in the documented shape: invented titles and poster paths, never recorded). Keeping the upstream host and URLs out of `src/domain` is deliberate: the books design keeps `googleapis.com` in a shared `src/domain` file, and a test has to pick which client files to scan; here a plain grep over `src` is enough.
- **Tests that fail without it:** `test/worker-screen.test.ts`, mirroring `test/worker-lookup.test.ts`:
  - the exact upstream path and parameters for movie, series and id; `year` only when given; `include_adult=false`;
  - `Authorization: Bearer <token>` exactly, no `api_key`, the identifying agent, `redirect: "manual"`;
  - `en-US` only after an empty `id-ID`, and an error in pass 1 never becomes an empty answer;
  - every cached answer kept for at most 86,400 s under a key without the token; stale, future-stamped, unstamped and badly stamped entries are not served; errors are never cached;
  - 429 to `busy` with the wait (1 to 3600, default 30); 5xx to `503 busy`; 401, 403, 422 to `502 failed` with no token text;
  - a body of exactly 256 KiB is read and one byte more is refused and cancelled; hostile fields come out bounded and plain; `adult: true` hits and non-`.jpg` posters are dropped;
  - GET only; signed-in only, before validation or any upstream call; a missing or blank token makes no upstream call;
  - a broken Cache API never breaks a lookup; the token is in no response body, header, `console` call or cache entry even when every call fails; `TMDB_TOKEN` and `api.themoviedb.org` appear nowhere under `src`, and `worker/screen.ts` has no `console.`;
  - `test/domain-tmdb.test.ts` (query validation, spelling-stable cache key, hit parsing and the dropped fields); `test/store-lookup-screen.test.ts` (offline, failed, slow, busy with `retry`, stale on abort); `test/validate-cover.test.ts` (the TMDB poster host is accepted; `image.tmdb.org.evil.example`, `http:`, a query string, another size and another extension are rejected); `test/worker-side.test.ts` (the route is not in `SIDED`).
- **Reviewer runs:** `npm test`; `git grep -n "TMDB_TOKEN\|api.themoviedb.org"` lists only `worker/screen.ts`, the README, `.dev.vars.example` and tests, and nothing under `src`; start `npm run dev` with a fake token and a stub upstream and `curl` the three query forms and a `bad_query`; the **§4.4 measurement with the real token**, with its counts pasted in the PR.
- **Blockers that apply:** **K** (the core of this slice), **T** (cache period, agent, no `api_key`, no recorded payloads), **F** (size, 3 s timeouts, abort), **P** (only title, kind and year leave).

### Slice 3: lookup in the sheet, posters, attribution, expiry, Find posters (large)

- **Content:** `cover`, `tmdb` and `tmdb_at` in the registry; the lookup list in the add sheet; posters in rows and detail; `TmdbCredit` in three places with `public/tmdb.svg`; "Open on TMDB"; the expiry sweep; Find posters and its refresh by id. If the diff passes about 800 lines it splits into 3a (the first four) and 3b (expiry and Find posters); then 3b must merge before 3a's data is 120 days old, a dated note in 3a's PR.
- **Files:** `shared/tables.ts`, `src/domain/tmdb.ts` (accept to patch, `expiry`), `src/domain/screen.ts`, `src/store/details.ts` (the attempt as a callback), `src/hooks/use-details.ts`, `src/hooks/use-lookup.ts` (`useScreenSearch`), `src/ui/screen-lookup.tsx`, `src/ui/tmdb-credit.tsx`, `public/tmdb.svg`, `src/views/screens.tsx`, `src/views/screen.tsx`, `src/views/settings.tsx` (Credits), `src/ui/screen-sheet.tsx`, `src/ui/shell.tsx` (the sweep next to `sweepUndone`), `src/ui/text.ts`, `src/views/books.css` or a small `screens.css` (`.tmdb`), `README.md`.
- **Tests that fail without it:**
  - `test/tmdb-credit.test.ts` (the sentence equals T4's with "application"; `public/tmdb.svg` has the pinned SHA-256 and the logo is not given a width, a transform or a filter; the credit exists in the lookup list, on both screens and in Settings; the logo CSS height is `0.75rem`; `referrerPolicy="no-referrer"` on the credit link and the posters);
  - `test/screens-expiry.test.ts` (days 119, 120, 169, 170 and a missing stamp; the sweep patch sets exactly `cover`, `tmdb`, `tmdb_at` to `null` and nothing else; two clients sweeping at once leave one result; no write while the side is unconfirmed);
  - `test/screens-details.test.ts` (fills only empty keys, never a title; a row with an id is refreshed by id and a 404 purges; two candidates, none, a different year all write nothing; back-off, stop at three busy answers, abort, and an `offline` stop);
  - `test/screens-lookup-ui.test.ts` (labelled list of real buttons at least `--row-min`; the credit sits under the list; polite live regions; a typed year is not overwritten by a hit; "Add as typed" saves with no TMDB key); `test/validate-cover.test.ts` and `test/heading-outline.test.ts` extended.
- **Reviewer runs:** `npm run check`; Playwright at 320 and 390 px at 200 percent text on the add sheet and both screens (no sideways overflow, targets at least 44 px, the credit visible); stub upstream: add a movie from a hit, then move the stored `tmdb_at` back 171 days in the scratch D1 and open the app: only the three keys are cleared; re-read the terms page and compare T4's sentence.
- **Blockers that apply:** **T** (attribution, expiry, unmodified posters), **W** (the batch's match rule), **D** (the sweep touches three keys only), **F** (an abortable batch, lazy images, one pace), **K** (no token or TMDB host in the bundle), **P** (the poster request exposes IP and viewed posters: stated in the README and §3.5).

---

## 6. Risks and open questions

### Risks

1. **R1: TMDB can end the licence or change the terms at any time** (T9, T15). The feature degrades to typing; nothing else depends on it.
2. **R2: the six-month clause is read narrowly.** We purge `cover` and `tmdb`, and treat the accepted title, original title and year as the couple's own entry (§1.4). A strict reading would purge those as well. The cost of the wider reading is empty rows after 170 days; the cost of the narrower is a dispute with a provider we depend on for posters. Question 1.
3. **R3: Indonesian coverage is unmeasured** (§4.3). Typing and "Add as typed" come first.
4. **R4: logo prominence at large text.** At 200 percent on a 320 px phone the logo is wider than the wordmark, though shorter. If TMDB objects, drop to a 10 px logo or the square one.
5. **R5: Poster requests expose the phone's IP and the posters on screen to TMDB's CDN** (§3.5), as Google covers do.
6. **R6: Language behaviour is unverified** (§2.3, §4.3). Pass 2 is cheap and deletable.
7. **R7: Production egress.** The dev Worker proves the code, not that TMDB answers Cloudflare's addresses (§4.4).
8. **R8: The logo asset can change.** A hash test fails when someone edits the file, not when TMDB updates theirs; the reviewer of slice 3 compares it once.
9. **R9: Purge writes.** The `lately` rule hides them from Home; a client closed for seven months purges on its next open.

### Questions for the operator (each with its default)

1. **Does TMDB's "cache for longer than 6 months" cover the title, original title and year you accepted into a row?** *Default:* no, only the poster URL and id expire (§1.5). *If yes:* the sweep also clears `data.original_title` and `data.year`, and Find posters must run every five months or rows lose them.
2. **Is "watched" one state for the two of you, or does each partner have their own?** *Default:* one shared state, each partner's own stars; when only one of you has seen it, it stays "To watch" and the note says so.
3. **Do you have a list to import (an IMDb or Letterboxd export, or notes)?** *Default:* no; import is not built (§3.6).
4. **Do you want one "what shall we watch" list across Movies and Series?** *Default:* no, one section per kind.
5. **Does the TMDB account's API application say "Nestora" at `nestora.atqamz.com`, for personal, non-commercial use?** *Default:* assumed. The terms' identity clause (T11) is easier to defend if the registration and the user agent agree.

### What in the existing code blocks the plan

Nothing blocks it. Five things must change first, each inside a slice and with no behaviour change for books:

- `worker/lookup.ts` keeps its helpers private and `recall`/`remember` typed to books (slice 2).
- `isCover` is a fixed host list (slice 2).
- `MarriageTabs` is marriage-only (slice 1).
- `findDetails` is hard-wired to ISBNs and `ol`/`gb` (slice 3).
- `lately.ts` has no rule for kinds that rewrite themselves (slice 1).

`secrets.required` in `wrangler.jsonc` and the generated `worker-configuration.d.ts` need no edit: like `GOOGLE_BOOKS_KEY`, the secret is optional and typed in `worker/screen.ts`.

---

## Appendix: sources read on 26 October 2026

- TMDB: [API Terms of Use](https://www.themoviedb.org/api-terms-of-use) (last updated 20 October 2023), [Logos and attribution](https://www.themoviedb.org/about/logos-attribution), [FAQ](https://developer.themoviedb.org/docs/faq), [Authentication: Application](https://developer.themoviedb.org/docs/authentication-application), [Languages](https://developer.themoviedb.org/docs/languages), [Rate limiting](https://developer.themoviedb.org/docs/rate-limiting), [Errors](https://developer.themoviedb.org/docs/errors), [Image basics](https://developer.themoviedb.org/docs/image-basics), [Finding data](https://developer.themoviedb.org/docs/finding-data), [Search and query for details](https://developer.themoviedb.org/docs/search-and-query-for-details), [Daily ID exports](https://developer.themoviedb.org/docs/daily-id-exports); API reference (OpenAPI definitions): [search movie](https://developer.themoviedb.org/reference/search-movie), [search tv](https://developer.themoviedb.org/reference/search-tv), [search multi](https://developer.themoviedb.org/reference/search-multi), [movie details](https://developer.themoviedb.org/reference/movie-details), [tv details](https://developer.themoviedb.org/reference/tv-series-details), [find by id](https://developer.themoviedb.org/reference/find-by-id), [configuration](https://developer.themoviedb.org/reference/configuration-details).
- Public downloads: `movie_ids` and `tv_series_ids` daily exports of 25 October 2026 (28,380,117 and 5,146,707 bytes), and the five approved logo SVGs (the "short" one is 2,065 bytes, viewBox 273.42 × 35.52).
- Measured: a static mock from the repo's own CSS on `main`, in Chromium at 320 and 390 px, 100 and 200 percent text.
- This repo, on `main` at `6e1997b`: `README.md`, `shared/tables.ts`, `shared/validate.ts`, `worker/index.ts`, `worker/lookup.ts`, `worker/sync.ts`, `worker/export.ts`, `src/domain/*` (lookup, googlebooks, openlibrary, reading, shelf, wish, search, lately, cover), `src/store/lookup.ts`, `src/store/details.ts`, `src/hooks/*`, `src/ui/*` (nav, routes, registry, shell, marriage-tabs, book-lookup, book-bits, book-sheet, book-import, modal), `src/views/*` (books, book, settings, import), `src/views/books.css`, `test/worker-lookup.test.ts`, `test/books-layout.test.ts`, `test/books-lookup-ui.test.ts`, `test/heading-outline.test.ts`, `test/nav.test.ts`, `package.json`, `wrangler.jsonc`; on the `docs` branch: `docs/books.md`, `docs/features.md` and `docs/rename-nestora.md`.
