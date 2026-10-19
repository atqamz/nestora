# Books: the family's book collection in wp

Research and design as of 19 October 2026. A decision document, no code. Every claim carries **[verified]** (an endpoint was probed, a page or the code was read on that date) or **[assumed]** (reasoning or an unconfirmed source).

> **Privacy.** This repo is public. The two users are **Partner A** and **Partner B**; places are generic labels (**Home A**, **Home B**, **Sibling's room**). The only book titles named here are three well-known public ones: *Laskar Pelangi*, *Bumi Manusia* and *The Little Prince* (*Le Petit Prince*, *Pangeran Kecil* in Indonesian). The operator's own list was used only in the probe, is reported by group, never by title, and is imported later at runtime.

## Summary

1. **Shape:** Books is a new area inside the existing app: one Worker, one D1, one Access app, one deploy. The repo stays; renaming it later is cheap because GitHub redirects it.
2. **Data:** no new table. Three new `kind`s in `items`: `book` (the work as the couple know it, plus wishlist fields and each partner's reading state), `copy` (a print copy, ebook or borrowed copy, with its ISBN, owner, place and lending state; `parent_id` points to the book), and `place` (the list of locations the couple edit).
3. **Moves:** moving a copy is two taps (chip, then place) and one row update. The copy keeps its previous place and the move date. There is no move history until someone asks for it.
4. **Flows:** add by typing, where-is-it search, move, lend, mark read, wish to shelf, and import all work offline once the app is loaded. Lookup and the metadata part of scanning need the network.
5. **Metadata:** the browser calls Open Library (no key, CORS `*`). An accepted result is copied into the row, so the row is the cache. Google Books is added only through a small Worker route, and only if the operator creates a free key: every keyless Google Books call returned 429 with a quota of 0.
6. **Measured coverage:** by the title as written, Open Library found 5 of 11 wishlist titles, and 1 of 6 Indonesian-titled translations. Allowing the original title as well, it found 9 of 11 at work level (one of them partial). It knew 2 of 7 Indonesian ISBNs (0 of 5 from Gramedia), and Google's catalogue knew 6 of 7. So typing stays the main way in.
7. **Ratings:** each partner gives a 1 to 5 rating of their own. The operator's Goodreads numbers are imported as typed. No rating is ever fetched (the Goodreads API is closed, and Open Library ratings are sparse).
8. **Scanning:** the native `BarcodeDetector` where supported (yes on Android Chrome; off by default on iOS Safari up to 27.2), and a typed ISBN elsewhere. A WASM decoder (417 KB gzip) is added only if an iPhone user wants it.
9. **UI:** Books becomes a fifth slot in the bottom bar (Home, Money, +, People, Books), with Shelf and Wishlist lists, a location chip on every book, and a generated cover in the existing ink and rose tokens when there is no image.
10. **Phasing:** slice 1 (places, add by typing, where-is-it, wishlist) is 2 to 3 PRs. Slice 2 (lookup, scan, import) is 3 PRs. Slice 3 (lending, stats, series) is 2 to 3 PRs. No slice adds a Cloudflare product.

---

## 1. Scope and shape

| | A. A new area in the existing app | B. A second app in the same repo | C. A separate repo |
|---|---|---|---|
| Workers | The one `wp` Worker; the SPA gains routes, the API gains at most one route | Two Workers, two `wrangler.jsonc`, two custom domains | Two Workers in two repos |
| D1 | The same `wp` database and the same `items` table; one `rev`, one `epoch`, one sync | A second database (a second sync history) or one database bound to two Workers **[assumed possible]** with two apps writing one `rev` | A second database |
| Access | Unchanged: `/api/*` and `/design/*` are already protected and the shell is public **[verified, `wrangler.jsonc` and `docs/infra.md` §6]** | A second Access app or destination per hostname | A second Access app, a second Google sign-in setup |
| Deploy and CI | Unchanged: the one `ci.yml` job runs `npm run check`, the migrations and `wrangler deploy` **[verified, `.github/workflows/ci.yml`]** | Two deploy jobs, workspaces, a shared package for the store, tokens and auth that does not exist yet | A second pipeline; the store, sync, auth and tokens copied and left to drift |
| Shared code | Free: store, outbox, sync, export, validators, tokens, shell | Needs extracting `src/store`, `shared/`, `worker/auth.ts` and `src/tokens.css` into packages first | Copy and paste |
| Rename later | Rename the visible name (manifest, `text.appName`, `<title>`) and the GitHub repo; keep every internal `wp` identifier | The same, twice | Nothing to rename, but two products to keep alive |
| Size | 7 to 9 PRs in total (§8) | The same plus a monorepo refactor of 2 to 3 PRs | The same plus a second bootstrap (M1 to M8 of `docs/bootstrap.md`) |

**Decision: A, a new area in the existing app.** The two users, the login, the offline store and the export are the same, so the books module costs only its own kinds and screens.
*Trade-off:* the app is no longer only about the wedding: Home, the "Lately" list and the export now carry book rows, and the product name "wp" fits less. B or C buy separation that two people sharing one login do not need.

**Rename costs, if the product grows into a household app.**
- **The GitHub repo:** "all existing information, with the exception of project site URLs, is automatically redirected", including git operations **[verified, GitHub docs]**. The exceptions do not apply: there is no GitHub Pages site, and no other workflow uses an action from this repo **[assumed]**. The one rule: never create a new repo under the old name, or the redirects stop **[verified]**.
- **Keep internal names:** the Worker `wp`, the D1 database `wp`, the KV namespace `wp-design`, the IndexedDB database `wp` and the `wp-theme` key in `localStorage` all stay. Renaming them buys nothing and would cost a migration **[assumed]**.
- **The domain:** a new hostname means a second custom domain route and the same paths in Access. The deploy check in `ci.yml` hard-codes `wp.atqamz.com` **[verified]**. A phone on the new origin starts with an empty IndexedDB and pulls everything again; only an unsent outbox on the old origin would be lost, so sync on the old origin before switching **[assumed]**.
- `atqamz/github` (the IaC repo) does not manage wp yet (`docs/infra.md` §7.5), so nothing there needs renaming **[verified, read the section]**.

---

## 2. Data model

### 2.1 Why the generic `items` table is enough

The exit rule in `docs/features.md` §7.2 moves a `kind` to its own table only if it needs relational integrity beyond `parent_id`, a money `CHECK`, scans of thousands of rows per query, or a different retention or privacy rule **[verified, read]**. Books meet none of these:
- A copy belongs to one book, which is exactly `parent_id`.
- A price seen is informational, with no payments attached.
- Even a large household shelf is well under 2,000 rows (§2.7).
- Book data has the same privacy footing as the rest of the household data.

So there is **no migration**, and the operator's decision ("one generic `items` table plus a separate table only for budget and payments") holds as it is.

### 2.2 Work, edition and copy

| Concept | Where it lives | Why |
|---|---|---|
| **Work** (the story: author, original title, series and volume, genre, synopsis) | `book` row | Reading state and the wishlist belong to the story, not to a printing. If one partner read the English edition, the Indonesian copy is not "unread" |
| **Edition** (ISBN, language, edition title, publisher, year) | On the `copy` row. A `book` row also keeps one `isbn` and `language`: the edition it was looked up from, or the one wanted | Only editions the couple own or want matter. A separate edition entity is a catalogue's job, not a household's |
| **Copy** (the object on a shelf, or an ebook, or someone else's book borrowed in) | `copy` row, child of the book | Two copies of one work (one in each partner's home, or print plus ebook) are common when two collections merge **[assumed]** |

- **Titles.** `book.title` is the title the couple use (the operator writes the Indonesian title with the original in brackets). `data.original_title` holds the original, and `copy.title` the title printed on that edition. Search matches all three.
- **ISBN.** Only ISBN-13 is stored, as 13 digits with no hyphens. An ISBN-10 that is typed or scanned is turned into ISBN-13 (prefix `978`, new check digit), so one form is ever compared. The ISBN-10 can be derived again for the `978` range **[assumed, standard arithmetic]**.
- **Series.** `data.series` (text) and `data.series_no` (an integer volume) go on the book.
- **Edge case.** A wish for another edition of a book already on the shelf (the English edition of an Indonesian copy, for example) is a second `book` row with status `wish`. This is rare enough not to model **[assumed]**.

### 2.3 Registry entries (`shared/tables.ts`)

This follows the shape of the existing variants **[verified, read `shared/tables.ts`]**. One new `Type`, `isbn` (13 digits with a valid check digit), is added; every other type exists already. Numbers that are picked from a short list are string enums, like `hijri_offset_days`.

```ts
book: {
  columns: ["status", "group_key", "who", "amount", "note"],
  required: ["status"],
  status: ["wish", "shelf"],
  data: {
    author: "text", original_title: "text", series: "text", series_no: "int",
    isbn: "isbn", language: ["id", "en", "other"], cover: "url", blurb: "longtext",
    ol: "text", gb: "text", public_rating: "decimal",
    priority: ["high", "low"], gift: "bool", shop: "text", shop_url: "url",
    reading_a: ["want", "reading", "read", "dnf"], rating_a: ["1", "2", "3", "4", "5"], finished_a: "date",
    reading_b: ["want", "reading", "read", "dnf"], rating_b: ["1", "2", "3", "4", "5"], finished_b: "date",
    import_batch: "text",
  },
},
copy: {
  columns: ["parent_id", "status", "group_key", "who", "due_on", "done_on", "note"],
  required: ["parent_id", "status"],
  status: ["here", "lent", "borrowed", "gone"],
  doneOnStatus: "gone",
  data: {
    isbn: "isbn", language: ["id", "en", "other"], format: ["print", "ebook", "audio"],
    publisher: "text", year: "int", lent_to: "text", lent_on: "date", from: "text",
    moved_on: "date", was_at: "id", import_batch: "text",
  },
},
place: {
  columns: ["note"],
  required: [],
  data: {},
},
```

### 2.4 Column by column

| Kind | Column or key | Meaning |
|---|---|---|
| `book` | `title` | The title the couple use |
| | `status` | `wish` (on the wishlist, not ours yet) or `shelf` (in our catalogue: owned, borrowed or read, whether or not a copy is with us now) |
| | `group_key` | The genre, as free text with suggestions from the values already used (like a vendor's category). A single genre stands in for tags until several are needed |
| | `who` | Whose wish it is: `a`, `b` or `both`. A wish of Partner B is a gift idea for Partner A. Empty on shelf books (ownership is per copy) |
| | `amount`, `currency` | The price seen, in whole rupiah (the money convention of `docs/features.md` §6.1) |
| | `note` | Why we want it, or our own notes (multiline) |
| | `sort` | Manual order, as everywhere else |
| | `data.author` | The display string, for example "Pramoedya Ananta Toer". Several authors are written "A; B" |
| | `data.original_title`, `data.series`, `data.series_no` | §2.2 |
| | `data.isbn`, `data.language` | The edition looked up or wanted. "We got it" copies them to the new copy |
| | `data.cover` | An https URL, preferably `https://covers.openlibrary.org/b/id/<cover id>-M.jpg`, because access by cover ID is not rate-limited (§4.1) |
| | `data.blurb` | A short synopsis, up to 2,000 characters (the `longtext` limit) **[verified, `shared/validate.ts`]** |
| | `data.ol`, `data.gb` | The Open Library work key and the Google Books volume ID, so "Refresh details" and "Open in …" links work |
| | `data.public_rating` | A rating seen elsewhere, as typed or imported (for example `4.1`). Never fetched (§4.4) |
| | `data.priority`, `data.gift`, `data.shop`, `data.shop_url` | Wishlist: `high` or `low` (absent means normal), gift idea, where to buy, a link |
| | `data.reading_a` … `data.finished_b` | Each partner's state (`want`, `reading`, `read`, `dnf`), their own rating (1 to 5) and the latest finish date. Separate keys mean two phones editing their own state merge cleanly through `json_patch` **[verified, `docs/brainstorm.md` §5.3]**. A re-read overwrites the date; if stats ever need every read, add a `read` child kind |
| `copy` | `title` | The title printed on this edition (it defaults to the book's title) |
| | `parent_id` | The book |
| | `status` | `here` (with us, at `group_key`), `lent` (away; `group_key` is where it comes back to), `borrowed` (someone else's copy that we hold), `gone` (given away, sold, lost, or a borrowed copy returned; `done_on` is the date) |
| | `group_key` | The `id` of a `place` row (§2.6) |
| | `who` | Owner: `a`, `b` or `both`. Defaults to `both` (shared); empty for a borrowed copy |
| | `due_on` | The return date for `lent` or `borrowed`. It can later appear in "This week" on Home |
| | `data.format` | `print`, `ebook` or `audio`. An ebook has no place; it shows "Ebook" instead of a chip |
| | `data.lent_to`, `data.lent_on`, `data.from` | Who has it and since when; who lent it to us |
| | `data.was_at`, `data.moved_on` | The previous place and the date of the last move (§2.6) |
| `place` | `title`, `sort`, `note` | "Home A", "Home B", "Sibling's room". Renaming is one row update, and deleting one is a tombstone with undo |

### 2.5 Example rows

These are fictional rows in the shipped schema (`migrations/0001_init.sql`), shortened. `rev`, `updated_by`, `created_at` and `updated_at` are written by the Worker as for every row **[verified, `docs/brainstorm.md` §3.7]**.

```sql
INSERT INTO items (id, kind, title, sort, rev, created_at, updated_at, updated_by)
VALUES ('p-1', 'place', 'Home A', 0, 41, '2026-10-19T03:00:00Z', '2026-10-19T03:00:00Z', 'a');

INSERT INTO items (id, kind, title, status, group_key, data, rev, created_at, updated_at, updated_by)
VALUES ('b-1', 'book', 'Pangeran Kecil', 'shelf', 'Classics',
  '{"author":"Antoine de Saint-Exupéry","original_title":"Le Petit Prince","language":"id",
    "cover":"https://covers.openlibrary.org/b/id/<cover id>-M.jpg",
    "reading_a":"read","rating_a":"5","finished_a":"2026-03-12","reading_b":"want"}',
  42, '2026-10-19T03:01:00Z', '2026-10-19T03:01:00Z', 'a');

INSERT INTO items (id, kind, parent_id, title, status, group_key, who, data, rev, created_at, updated_at, updated_by)
VALUES ('c-1', 'copy', 'b-1', 'Pangeran Kecil', 'here', 'p-1', 'both',
  '{"format":"print","language":"id"}', 42, '2026-10-19T03:01:00Z', '2026-10-19T03:01:00Z', 'a');
```

### 2.6 How a move is recorded

**Decision: the current place plus the previous one, on the copy. No history rows.** A move is one `update` mutation that the Worker applies like any other patch **[verified, the pattern in `docs/brainstorm.md` §5.3]**:

```sql
UPDATE items
   SET group_key = ?1,
       data = json_patch(coalesce(data, '{}'), ?2),
       rev = (SELECT rev FROM sync_state WHERE id = 1), updated_at = ?3, updated_by = ?4
 WHERE id = ?5;
-- ?1 = 'p-2', ?2 = '{"was_at":"p-1","moved_on":"2026-10-19"}'
```

The detail screen says "Moved to Home B by <nickname>, 19 Oct", using `updated_by` and `data.moved_on`. The toast's Undo moves the copy back to `was_at`.
*Trade-off:* "where was it in March?" cannot be answered. A `move` kind (a child row of the copy with the place and date) adds that later without a migration, at one extra row per move. Build it only when that question is actually asked.

Places are `place` rows, not a `settings` list like `stages`, for three reasons. A settings value is last-write-wins on the whole list, so two phones editing places at once would lose one edit. Rows get undo and "Lately" for free. And the generic list and item form already edit rows **[verified, `docs/brainstorm.md` §7.3 and `src/ui/item-form.tsx`]**. What is given up: `group_key` is not a foreign key, so a copy whose place was deleted shows the tombstoned place's name, dimmed, until it is moved. Deleting a place that still holds copies asks for a new place first.

### 2.7 What else changes, and the cost

- **Worker references.** Today `refs.items` is empty and no kind uses `parent_id` **[verified, `worker/sync.ts`]**. Add `parent_id: ["items", "book"]`. That is correct while `copy` is the only child kind, and no cycle is possible because `book` has no `parent_id` in its variant. When `contribution` lands, `refs` must become per kind. The client already sends parents before children (outbox order).
- **Validators.** A new `isbn` type: 13 digits and the mod-10 check, about 5 lines in `shared/validate.ts`. Everything else is configuration.
- **Export.** The Worker's CSV export accepts any registry variant and writes `data.<key>` columns **[verified, `worker/export.ts`]**. So `book`, `copy` and `place` CSVs need no Worker code; the links in Settings come from the view entries in `src/ui/registry.ts`, which the new screens add anyway **[verified]**. The JSON dump includes them automatically.
- **Lately on Home.** `src/domain/lately.ts` shows every `items` row **[verified]**. Add a `moved` verb for copies, and leave out rows that carry `data.import_batch`, so an import does not flood Home with "added" lines.
- **Size.** 300 books with about 330 copies and 10 places is about 640 rows. Every row is pulled to each phone, which is nothing next to the 5 million rows read per day **[assumed estimate; limits verified in `docs/brainstorm.md` §3.5]**. An import of that size is about 640 mutations: 32 requests of 20, and at most about 3,200 of the 100,000 rows written per day **[assumed, using the 3 to 5 rows per edit of `docs/brainstorm.md` §7.2]**.

---

## 3. Core flows on two phones

The store is the source of truth, and writes queue in the outbox while offline **[verified, `docs/brainstorm.md` §5.2]**. **Caveat for every row marked offline below:** a cold start with no signal fails until the service worker is built, because the shell is not cached **[verified, `docs/infra.md` §5.7]**.

| Flow | Steps | Writes | Offline |
|---|---|---|---|
| **Add by typing** | Books, then +, type "title author", choose Wishlist or Shelf (with a place), Save. The global + sheet gets a `book` chip that saves straight to the wishlist (capture is the product, `docs/features.md` §1.3) | 1 book (+1 copy for Shelf) | Yes |
| **Add by search** | In the same sheet, results appear under the field while online; tap Add on one. Its title, author, original title, cover, ISBN, language and work key are copied into the row | 1 to 2 | Search no; "Add as typed" yes |
| **Add by scan** | The scan button (shown only where it works, §5), point at the barcode, then the ISBN lookup fills the sheet. With no result, the ISBN is kept and the user types the title | 1 to 2 | Decoding yes (on the device); lookup no; the book is saved with its ISBN and "Fill details" runs later |
| **Move** | Tap the location chip on a book (in a list, a search result or the detail), then tap a place. A toast offers Undo. "New place" sits at the end of the picker | 1 copy update | Yes |
| **Lend / return** | Lend: to whom (suggestions from earlier names), today's date, optional return date. Return: one tap, which clears those fields | 1 | Yes |
| **Mark read** | On the detail, your row: Want, Reading, Read or Stopped (DNF). Read asks for stars, with today as the date | 1 data patch | Yes |
| **Where is this book?** | The search field at the top of Books. It folds case and diacritics, and matches title, original title, author, series, copy titles and ISBN digits. Results show the chip ("Home A", "Lent to … since 2 Oct", "Ebook") | none | Yes (client-side over IndexedDB; no FTS on the server, `docs/brainstorm.md` §7.1) |
| **Wish to shelf** | "We got it" on a wish: the book becomes `shelf` and a copy is created at the last-used place, owned by both, with the wished ISBN and language. Undo reverses both | 2, in one outbox flush | Yes |
| **Import** | Wishlist, then "Import a list": paste text or pick a CSV, see a preview (new, already there, unreadable), untick rows, then Import. Every row gets `data.import_batch`, so the import can be undone in one step | 1 per book (+1 per copy) | Parsing and saving yes. "Find covers and details" afterwards needs the network |

**The pasted free-text format** (what the operator keeps today):
- One book per line, with fields separated by `|`: `Title (Original title) | Author | ~4.1 | note`.
- A trailing `(…)` in the first field becomes `original_title`.
- `~4.1` becomes `public_rating` `4.1`.
- The last field goes to `note`.
- A line with no `|` is a title only.
- **Synopses:** blocks separated by a blank line. The first line of a block is the book line, and the rest is its `blurb`. Without blank lines, every line is a book.
- The preview is where non-book lines (a heading, for example) are unticked.

**CSV** uses a header row mapped to `title`, `author`, `original_title`, `isbn`, `rating`, `note`, `synopsis`, `status` and `place`. It shares the CSV reader already planned for the RSVP import (W18, `docs/features.md` §3.5).

**Matching after import is by hand.** Automatic matching on translated titles fails too often (§4.3). "Find covers and details" therefore walks the imported rows one by one at no more than 1 request per second, shows the best match next to the row, and the user accepts or skips it.

---

## 4. Free metadata sources

### 4.1 What each source offers

| Source | Key or account | Limits and terms | Cover | Description | Language | Series | Rating |
|---|---|---|---|---|---|---|---|
| **Open Library** | None **[verified]** | 1 request/s unidentified, 3/s with a `User-Agent` naming the app and a contact. "Please do not use our APIs to bulk download metadata" **[verified, developers page]**. Covers: lookups by ISBN, OCLC or LCCN are limited to 100 per IP per 5 minutes, by cover ID or OLID are not; "do not crawl", "use a src URL that points to covers.openlibrary.org" **[verified, covers page]**. CORS `*` on search and covers **[verified, response headers]** | Yes (work and edition) | On the work record (an extra request) **[assumed]** | Yes, per edition and as a list per work **[verified]** | Sometimes: one hit carried `series: ["Tetralogi Buru #1"]` **[verified]** | `ratings_average` and `ratings_count`, sparse (§4.3) **[verified]** |
| **Google Books API** | Keyless calls failed: 429 with `quota_limit_value: "0"` on every call **[verified, 24 calls]**. A free key comes from a Google Cloud project (Credentials, then Create credentials, then API key; restrict it to the Books API) **[verified, docs]** | About 1,000 queries/day by default, according to user reports **[assumed]**. Branding: "powered by Google" next to results, a link to the Google Books page for every result, and "You may not reorder or otherwise alter the results" **[verified, branding page]**. Content alleged to infringe must be removed on request **[verified, terms]**. No caching clause found **[verified, terms]** | `imageLinks` | `description` | `language` | Field not documented on the page read **[verified]** | `averageRating`, `ratingsCount` **[verified, docs example]** |
| **Google Books Dynamic Links** (legacy, keyless) | None | Answers as JSONP, `cb({...})`, which a page can only use by injecting a script **[verified]** | Thumbnail on 3 of 7 Indonesian ISBNs **[verified]** | No | No | No | No |
| **ISBNdb** | Paid only: Basic US$14.99/month (5,000 searches/day, 1 call/s) with a 7-day trial. A free account has "No API access" **[verified, pricing page]** | Paid | Thumbnail **[verified]** | Synopsis **[verified]** | Yes **[verified]** | No **[assumed]** | No **[assumed]** |
| **WorldCat (OCLC)** | Requires a library's OCLC Cataloging and Metadata subscription plus FirstSearch or WorldCat Discovery; no individual tier is mentioned **[verified, OCLC page]** | Not available to us | | | | | |
| **Library of Congress** (`loc.gov` JSON) | None on paper | The JSON request got a bot challenge page (403) **[verified]** | | | | | |
| **Perpusnas ISBN** (Indonesia) | No public API. The site's search sits behind reCAPTCHA **[verified, page source]** | Not usable from code | | | | | |
| **Wikidata** | None; SPARQL endpoint | Query-time limits per client **[assumed]**; data CC0 **[assumed]** | Rarely | No | Labels | Yes, for famous works **[assumed]** | No |
| **Goodreads** | `goodreads.com/api` now redirects to the home page **[verified, 302]**. New keys stopped on 8 December 2020 **[verified, contemporary reports]** | Scraping is against its terms **[assumed, terms not read]** | | | | | Not obtainable |
| **StoryGraph** | No public API: the roadmap item has been "Long-term" since March 2021 **[verified, search of the roadmap page]** | | | | | | Not obtainable |
| **Hardcover** | A personal token from account settings; the API is in beta and tokens "may be reset without notice" **[verified from a search excerpt of the docs page, which returned 403 to a direct fetch]** | Throttling returns 429; no number is published **[verified]**. Not usable without an account, which this task rules out | Yes **[assumed]** | Yes **[assumed]** | | Yes **[assumed]** | Yes **[assumed]** |

### 4.2 How the probe was run

- **What was queried:**
  - 11 titles from the operator's wishlist, as written there, plus the original title for the 5 translated titles that have one: 16 Open Library searches (`search.json?q=<title> <author>`) and 16 Google Books searches (`intitle:` and `inauthor:`).
  - 7 Indonesian ISBNs taken from Indonesian library catalogues and bookshop listings, so the APIs could not bias the choice. Each was looked up in Open Library (`/isbn/<isbn>.json`), Google Books (`q=isbn:`), the Google Dynamic Links endpoint (one request for all 7) and Wikidata (one SPARQL request for P212).
- **Volume and pacing:** about 60 GET requests in all, at least 1.5 s apart for the API calls, with an identifying `User-Agent` and no contact address. No account, no key.
- **Kept out of the repo:** the scripts and raw answers are in the session's scratch area.
- **Latency:** Open Library search answered in a median of 734 ms (max 1,177 ms, 23 calls) **[verified]**.

### 4.3 Results

**Titles (Open Library; Google Books returned 429 on all 16 calls).** Grouped, not named.

| Group | n | Found by the title as written | Found by the original title | Cover on the hit | Indonesian edition listed on the work | Rating on the hit |
|---|---|---|---|---|---|---|
| Indonesian-titled translations | 6 | **1** (the most widely translated novel in the set; 5 got `numFound: 0`) | **4 of 5**, plus 1 partial: for one series, a fielded query ranked volumes 2 and 3 above volume 1, and the plain query found only a box set | 5 of 5 hits | 1 | 480 ratings (avg 3.81) on the famous one; 1 to 6 ratings on the others |
| English-titled translations from Japanese | 3 | **3** (two only under records with Japanese-script author names) | – | 3 (one only on the Japanese-language record) | 0 | 1 rating or none |
| Indonesian originals | 2 | **1** (an Indonesian-language record with no cover and no rating; the 2021 Gramedia novel was not found) | – | 0 | 1 | none |
| **All** | 11 | **5 of 11** | | | | |

At work level, using whichever title form worked, 9 of 11 were found (one of them partial) **[verified]**. Two quirks showed up: duplicate work records (the original-title query for the famous novel hit a second record with 5 ratings instead of 480), and author names in original scripts, which defeat naive matching **[verified]**.

**Indonesian ISBNs.**

| ISBN | Open Library `/isbn` | Google Books API (keyless) | Google Dynamic Links (keyless) | Wikidata P212 |
|---|---|---|---|---|
| *Laskar Pelangi*, Bentang, 9789793062792 | Hit: Indonesian, cover, linked to its work | 429 | Known, thumbnail | An edition item (no label) linked to the work |
| *Bumi Manusia*, Lentera Dipantara 2019, 9789799731234 | Hit: Indonesian, cover, series "Tetralogi Buru #1"; `search.json?isbn=` also returns the author name and the edition's own cover in one call | 429 | Known, thumbnail | None |
| 5 Gramedia ISBNs, printings from 2015 to 2025 (one `978-979-22`, four `978-602-06`) | **0 of 5** (404) | 429 | **4 of 5** known (the 2024–25 title is missing), 1 thumbnail | 0 of 5 |
| **Total** | **2 of 7** | 0 of 7 (quota 0) | **6 of 7** known, 3 thumbnails | 1 of 7 |

All rows **[verified, 19 October 2026]**. Dynamic Links returns no title or author, so it shows only that Google's catalogue holds the ISBN. That the keyed Books API would return full metadata for those 6 is **[assumed]**.

**What this means:** recent Indonesian editions are the weak spot of every free, keyless source. Open Library is good for the work behind a translation, through the original title. Google is the only source that knows recent Gramedia ISBNs, and it needs a key. So typing is a first-class path, a scan always keeps the ISBN even when no metadata comes back, and a lookup is a suggestion, never a requirement.

### 4.4 Decisions

**Where the API is called: Open Library from the browser, Google Books through the Worker only with a key, and no cache table.**
- **Open Library from the browser.** It is keyless with CORS `*` **[verified]**, the rate limit counts against each phone's own IP **[assumed: the docs give a rate, not its unit]**, and it costs no Worker requests. The code lives in `src/store/lookup.ts`, because `npm run check` forbids `fetch` in `src/views`, `src/ui` and `src/hooks` **[verified, `package.json`]**. A Worker proxy would send every lookup from Cloudflare's shared egress addresses, where other tenants' traffic counts against the same per-IP limit **[assumed]**.
- **Google Books through the Worker, only with a key.** A route `GET /api/lookup?isbn=…|q=…` adds the key from a Worker secret (`GOOGLE_BOOKS_KEY`), asks for a `fields`-filtered response, and returns a small normalised list. It answers `404 not_configured` when the secret is absent, and the SPA then hides Google. It sits under `/api/*`, so Access already protects it, and it times out like `/api/me` does **[verified, `worker/me.ts`]**. Google results are shown as their own block, in Google's order, with "powered by Google" and a link per result (branding rules, §4.1).
- **No D1 or KV cache.** An accepted result is copied into the `book` and `copy` rows, so the row is the cache and a lookup runs once per book. KV would add a binding for no gain, with a free limit of 1,000 writes per day **[verified, `docs/brainstorm.md` §3.5]**.

*Trade-off:* two code paths, one for each source. That is still smaller than a proxy for both, and Google stays optional.

**What is stored locally, so the app still works if an API disappears:** everything shown. Title, author, original title, series, ISBN, language, a synopsis of at most 2,000 characters, and the cover **URL**. The external IDs (`ol`, `gb`) are only for "Refresh details" and outbound links. When a cover URL fails or there is no cover, the app draws a **generated cover**: the title and author set in the display font on a tint picked from the row's ID. It works offline and needs no storage. Real cover images are not copied into Cloudflare (next paragraph).

**Ratings: no external rating is fetched.**
- Goodreads has no API and scraping it is not an option. StoryGraph has no API. Hardcover needs an account token. Open Library's ratings are too thin to show (1 to 6 ratings on most hits) **[verified]**.
- What the app shows: each partner's own stars (the feature that matters to two readers), and `public_rating` only where it was typed or imported, labelled "rated elsewhere".
- An "Open on Goodreads" link built from the ISBN or the title (a plain link, no request) **[assumed URL pattern]** gives the community rating to anyone who wants it.

**Cloudflare free-plan impact: nothing new.**
- **D1:** about 640 rows and a few writes per edit (§2.7), against limits of 500 MB per database and 100,000 rows written per day **[verified, `docs/brainstorm.md` §3.5]**.
- **Workers:** the browser-side Open Library calls cost no Worker requests. A Google lookup costs 1 Worker request and 1 subrequest **[assumed]**.
- **R2 (not used):** it needs "an R2 subscription" through checkout, that is, a payment method **[verified, `docs/brainstorm.md` §3.5]**.
- **Cloudflare Images (not used):** its free plan allows 5,000 unique transformations a month, and "storage in Images is available only with an Images Paid plan" **[verified, Images pricing page]**. Hotlinked cover URLs plus the generated cover cover the need.

---

## 5. Barcode scanning

| Platform | `BarcodeDetector` | Source |
|---|---|---|
| Chrome for Android | Supported (155) | caniuse **[verified]** |
| Samsung Internet | Supported from 13 | caniuse **[verified]** |
| Safari on iOS | "Disabled by default" from 17.0 through 27.2 (a feature flag), not supported before that | caniuse **[verified]** |
| Firefox for Android | Not supported | caniuse **[verified]** |
| Desktop Chrome | Partial: only where the OS supplies a detector (macOS, ChromeOS); not on Windows or Linux | caniuse "partial" **[verified]**; the platform list from MDN data and a polyfill README **[assumed]** |

The API is experimental, needs a secure context and also works in workers **[verified, MDN]**. `BarcodeDetector.getSupportedFormats()` reports the formats at runtime **[verified, MDN]**, so the app checks for `ean_13` (the ISBN barcode) before showing the button.

**Fallbacks.**
1. **Typed ISBN** in an `inputmode="numeric"` field, with the check digit verified as the user types. No cost.
2. **iOS Live Text.** "Scan Text" in any text field reads the digits printed above the barcode into the field (iOS 15 or later, A12 chip or later) **[assumed, third-party guides from the iOS 15 era]**. No cost.
3. **A WASM decoder:**
   - [`barcode-detector`](https://www.npmjs.com/package/barcode-detector) 3.2.2 (MIT): a `BarcodeDetector` ponyfill over `zxing-wasm` 3.1.x **[verified, npm]**.
   - Measured from the npm tarballs: about 44 KB of JS plus `zxing_reader.wasm` at 966,895 bytes, 417,135 bytes with `gzip -9` **[verified]**.
   - By default it fetches the `.wasm` from jsDelivr. For offline use, and to keep a third-party script host out, the file must be self-hosted through `prepareZXingModule` **[verified, README]**.
   - The planned service worker precaches every emitted file (`docs/infra.md` §5.7), so the wasm would have to be left out of the precache list or every install pays about 1 MB **[assumed]**.

**Decision:** show the scan button only when `BarcodeDetector` exists and supports `ean_13`. Everywhere else, offer the typed ISBN, where Live Text works on iPhones. Add the WASM ponyfill, lazy-loaded and self-hosted, only if a partner on an iPhone finds that too slow (open question 1).
*Trade-off:* on iOS, scanning is "type or Live Text" rather than a live camera, in exchange for no new dependency and no 417 KB download.

---

## 6. UI direction

**Where Books lives.**
- **Bottom bar:** today it is Home, Money, (+), People **[verified, `src/ui/nav.ts`]**. Books becomes the fifth slot: Home, Money, (+), People, Books. On a wide screen, Books joins the sidebar above Settings.
- **Routes:** `#/books` (Shelf), `#/wishlist` (the second list of the Books screen, the way `#/guests` and `#/vendors` open the two lists of People) and `#/books/<id>` (detail). The places list is reached from the place picker ("Edit places", `#/places`).
- **Router:** this brings the route table to 13 words for 9 screens. The router trigger in `docs/infra.md` (path URLs, or more than about 8 routes) is reached, but a static table still suffices because none of the new routes needs path URLs **[assumed]**.
- **Home** ("Our journey") is unchanged in slice 1: books add no station to the route. In slice 3, "due back" dates of lent and borrowed copies join "This week".

**Tokens.** Only existing tokens are used **[verified, `src/tokens.css`]**:
- Rows of at least `--row-min`, targets of at least `--target-min`.
- The location chip uses `--surface-2` with `--ink` text and `--r-control`.
- "Reading now" and "for Them" marks use `--signal` (the rose).
- A return date that has passed uses `--late` on `--late-bg`.
- The generated cover alternates `--tint-a` and `--tint-b` by row ID, with the title in `--font-display` at `--stretch-display`.
- The one new constant is the cover ratio, 2:3. No new colour, no serif, no paper texture (the redesign's banned looks).

**What makes it feel like reading, not a spreadsheet** (all cheap): covers on every row, "Reading now" at the top of the Shelf, each partner's stars side by side on the detail, a "Moved to Home B · Undo" toast instead of a form, and the wishlist's "We got it" as the one big button.

**Shelf** (`#/books`)
```
┌──────────────────────────────────────┐
│ wp                    ✓     (A)(B)   │
│                                      │
│ Books                                │
│ ╭─────────╮╭──────────────╮          │
│ │ Shelf   ││ Wishlist  12 │          │
│ ╰─────────╯╰──────────────╯          │
│ ┌──────────────────────────────────┐ │
│ │ ⌕  Where is…  title, author, ISBN│ │
│ └──────────────────────────────────┘ │
│                                      │
│ Reading now                          │
│ ┌──┐ Bumi Manusia            ● You   │
│ │▓▓│ Pramoedya Ananta Toer           │
│ └──┘ ( ⌂ Home A )                    │
│                                      │
│ Home A  31                           │
│ ┌──┐ Pangeran Kecil                  │
│ │PK│ Antoine de Saint-Exupéry        │
│ └──┘ You ★★★★★ · Them: want to read  │
│ ┌──┐ …                               │
│                                      │
│ Sibling's room  6                  › │
│ Lent out  2                        › │
│ Not with us  3                     › │
├──────────────────────────────────────┤
│ Home   Money   ( + )   People  Books │
└──────────────────────────────────────┘
```

**Book detail** (`#/books/<id>`), with the place picker that the chip opens
```
┌──────────────────────────────────────┐
│ ‹ Books                          ⋯   │
│ ┌──────┐  Pangeran Kecil             │
│ │      │  Le Petit Prince            │
│ │ cover│  Antoine de Saint-Exupéry   │
│ │      │  Classics                   │
│ └──────┘                             │
│ Where                                │
│ ( ⌂ Home A ▾ )   Print · Indonesian  │
│ Shared · moved by Them, 2 Oct        │
│ [ Lend ]        [ + Another copy ]   │
│                                      │
│ Reading                              │
│ You   Want ·[Reading]· Read · Stopped│
│ Them  Read 12 Mar 2026   ★★★★★       │
│                                      │
│ About                                │
│ A pilot stranded in the desert meets │
│ a small visitor from…          more  │
│ ╭──────────────────────────────────╮ │
│ │ Move to                          │ │
│ │ ◉ Home A                         │ │
│ │ ○ Home B                         │ │
│ │ ○ Sibling's room                 │ │
│ │ + New place        Edit places   │ │
│ ╰──────────────────────────────────╯ │
└──────────────────────────────────────┘
```

**Wishlist** (`#/wishlist`)
```
┌──────────────────────────────────────┐
│ Books                                │
│ ╭─────────╮╭──────────────╮          │
│ │ Shelf   ││ Wishlist  12 │          │
│ ╰─────────╯╰──────────────╯          │
│ ⌕  Search the wishlist               │
│                                      │
│ Next up                              │
│ ┌──┐ Laskar Pelangi        Rp 98.000 │
│ │▓▓│ Andrea Hirata                   │
│ └──┘ For Them · gift idea            │
│      "The film made us curious"      │
│      Bookshop, city centre           │
│      [ We got it ]                   │
│                                      │
│ Someday  11                          │
│ ┌──┐ …                               │
│                                      │
│ Import a list                        │
└──────────────────────────────────────┘
```

**Add book** (a sheet, like the existing Add sheet)
```
┌──────────────────────────────────────┐
│ Add a book                        ✕  │
│ ┌────────────────────────────┐ ┌───┐ │
│ │ pangeran kecil             │ │ ▥ │ │  ← scan, only where supported
│ └────────────────────────────┘ └───┘ │
│ ( Wishlist ) ( Shelf · Home A ▾ )    │
│                                      │
│ Open Library                         │
│ ┌──┐ Le Petit Prince                 │
│ │▓▓│ Antoine de Saint-Exupéry · 1943 │
│ └──┘ Indonesian edition known  [Add] │
│ ┌──┐ …                               │
│ Google Books        powered by Google│  ← only with a key
│ ┌──┐ …                         [Add] │
│                                      │
│ [ Add "pangeran kecil" as typed ]    │
│ Offline: it is saved as typed, and   │
│ the details can be filled in later.  │
└──────────────────────────────────────┘
```

**Design pages.** Mock-ups for a design round go into the private `/design/books/` page through the KV namespace, as before **[verified, `worker/index.ts`]**. Fixtures there follow §7.

---

## 7. Privacy and public-repo rules

- **No people in the repo.** No real names anywhere in code, fixtures, tests, docs or commit messages: **Partner A** and **Partner B** only, and the UI shows the nicknames from `settings` (`docs/brainstorm.md` §7.3). Borrowers' names (`lent_to`, `from`) are data in D1 only, on the same footing as guest names (`docs/features.md` §5.8).
- **No real places.** Fixtures and tests use "Home A", "Home B" and "Sibling's room": no addresses, cities, campuses or boarding houses.
- **Example books.** Fixtures use the three titles of this document and nothing from the operator's list.
- **The operator's list never touches the repo.** It is pasted into the in-app import at runtime and travels only through `POST /api/sync` into D1. If it is kept as a file, it lives outside the repo (for example `~/wp-private/`). `.gitignore` already ignores `*.csv`, `import*.sql` and `wp-private/` **[verified]**, but not `*.txt`, so a pasted list saved inside the worktree would show up in `git status`.
- **What lookups send out.** A lookup sends a title, an author or an ISBN to Open Library or Google, from the phone's IP or the Worker. By design, the lookup takes only the search text, so it never sends a place, a nickname or a borrower.
- **No secrets in the bundle.** The optional Google key is a Worker secret, never a `VITE_` variable.

---

## 8. Phasing

| Slice | PRs | Content | Size |
|---|---|---|---|
| **1. Useful on day one** | 1 | Registry kinds `book`, `copy`, `place`; the `isbn` type; `refs.items.parent_id`; domain functions (shelf grouping by place, search folding, "We got it", ISBN-10 to ISBN-13) with `node --test` | S to M |
| | 2 | The Books screen (Shelf, Wishlist, search), book detail with the location chip and place picker, the places list, the add sheet by typing, the nav slot and routes | M to L |
| | 3 | The `book` chip in the global Add sheet; the `moved` verb and the import filter in Lately | S |
| **2. Faster input** | 4 | `src/store/lookup.ts` (Open Library), search results in the add sheet, "Fill details" from an ISBN, generated covers; `/api/lookup` for Google only if the key exists | M |
| | 5 | Scanning with native `BarcodeDetector`, plus the typed ISBN with live check-digit validation | S to M |
| | 6 | Import: the free-text and CSV parsers, preview, `import_batch` undo, the one-by-one "Find covers and details" | M |
| **3. Delight** | 7 | Lending and borrowing sheets, due-back dates in "This week" on Home | S to M |
| | 8 | Stats: read this year per partner, read by both, from the `finished_*` keys | S |
| | 9 | Series: a series view ("you have 1 and 2 of 4"), "Add the next one to the wishlist" | S |

**Risks, most important first.**
1. **Indonesian metadata coverage** is poor in the keyless sources (§4.3). If typing feels like work, the module will not be used. Mitigation: typing and import come first; lookup is optional.
2. **No offline cold start** until the service worker exists (`docs/infra.md` §5.7). The books shelf is a "where is it?" tool used in other people's houses, where the signal may be weak.
3. **The Google key and its terms:** the quota, the attribution rules and the rule against reordering results.
4. **The iPhone scanning gap** (§5).
5. **Scope creep towards a Goodreads clone:** feeds, social features, recommendations. These stay out.
6. **Home and Lately mixing wedding and books.** This matters until the wedding is over, and the import filter limits it.

**What would make a separate repo, or at least a separate app, the better call:**
- **More people:** someone beyond the two partners needs to see or edit the shelf (a sibling looking up what is in their room, for example). Access and the `a`/`b` sides assume exactly two accounts.
- **A different privacy rule:** a public "our library" page.
- **A different lifetime:** the wedding app is to be retired or wiped after the wedding while the books continue.
- **A native app** is wanted for the camera.

The first two would point to a second app in this repo with shared packages first; a separate repo only if the owners differ.

---

## 9. Open questions for the operator

Each has a default, so the work can go on unanswered.

1. **Which phones do you two use, and is typing the ISBN (or Live Text) acceptable on an iPhone?** *Default:* native scanning where it works, typed ISBN elsewhere, no WASM decoder.
2. **Will you create a free Google Books API key** (a Google Cloud project with the Books API enabled and an API key restricted to it, saved with `wrangler secret put GOOGLE_BOOKS_KEY`)? It is the only free source that knows recent Gramedia ISBNs. *Default:* no key; Open Library only, and typing for recent Indonesian editions.
3. **Is Books a fifth slot in the bottom bar** (Home, Money, +, People, Books)? *Default:* yes. After the wedding, Money and People can be reconsidered.
4. **Is "current place plus previous place" enough, or do you want a full move history** ("where was it in March")? *Default:* current plus previous; history only on request.
5. **Should the Goodreads numbers in your list be kept as "rated elsewhere"?** *Default:* keep them as typed and never fetch any; your own stars are the main rating.

---

## Appendix: sources checked on 19 October 2026

- Open Library: [developers API](https://openlibrary.org/developers/api), [Covers API](https://openlibrary.org/dev/docs/api/covers), [search](https://openlibrary.org/dev/docs/api/search); live: `search.json`, `/isbn/<isbn>.json`, `covers.openlibrary.org/b/isbn/…?default=false`.
- Google Books: [using the API](https://developers.google.com/books/docs/v1/using), [branding](https://developers.google.com/books/branding), [terms](https://developers.google.com/books/terms); live: `www.googleapis.com/books/v1/volumes` (429) and `books.google.com/books?jscmd=viewapi`.
- [ISBNdb pricing](https://isbndb.com/isbn-database); [OCLC WorldCat Search API](https://www.oclc.org/developer/api/oclc-apis/worldcat-search-api.en.html); `www.loc.gov/books/?fo=json` (challenge page); [Perpusnas ISBN](https://isbn.perpusnas.go.id/) (page source); `query.wikidata.org/sparql`.
- Goodreads: `www.goodreads.com/api` (302 to the home page); [Goodreads developer discussion](https://www.goodreads.com/topic/show/21788520-api-deprecation). [StoryGraph roadmap: an API](https://roadmap.thestorygraph.com/features/posts/an-api). [Hardcover API getting started](https://docs.hardcover.app/api/getting-started).
- [caniuse: BarcodeDetector](https://caniuse.com/mdn-api_barcodedetector); [MDN: BarcodeDetector](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector); npm `barcode-detector` 3.2.2 and `zxing-wasm` 3.1.5 tarballs.
- [Cloudflare Images pricing](https://developers.cloudflare.com/images/pricing/); [GitHub: renaming a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository).
- This repo: `migrations/0001_init.sql`, `shared/tables.ts`, `shared/validate.ts`, `worker/index.ts`, `worker/sync.ts`, `worker/me.ts`, `src/ui/nav.ts`, `src/ui/routes.ts`, `src/tokens.css`, `src/domain/lately.ts`, `package.json`, `.gitignore`, `.github/workflows/ci.yml`; on the `docs` branch: `docs/brainstorm.md`, `docs/infra.md` and `docs/features.md`.
