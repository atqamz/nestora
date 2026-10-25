# Brainstorm: Nestora, first a Wedding Planner PWA (`nestora.atqamz.com`)

Discussion document, not a final decision. Research as of 6 October 2026; every docs page cited was checked on that date.

> **Privacy.** This repo is public. This document only covers the *structure* of the spreadsheet (sheet names, columns, types, formulas, dropdowns). No real names, phone numbers, addresses, guest names, vendor names, amounts or dates. Examples use made-up placeholders like `Name A`, `+62 8xx-xxxx-xxxx`, `Rp X`.

In short: one Cloudflare Worker that serves static assets, `/api/*` and private design pages (`/design/*`, from KV), data in D1, login through Cloudflare Access with Google only (Access protects `/api/*` and `/design/*`; the app shell is public and shows its own sign-in screen), a React + TypeScript + Vite single-page app (English UI) with a data layer kept separate from the views. Data is stored locally in IndexedDB so it works offline, then synced to D1. Details and reasons below.

> **Status.** This document is the discussion record; `docs/infra.md` holds the stack decisions and wins where they differ. Sections that `docs/infra.md` superseded are marked **Superseded** where they start, and its §9.4 lists every section's status. Section 6 was rewritten when the frontend changed from "no build step" to React + TypeScript + Vite; the earlier framework matrix is gone. **Built and live (7 October 2026):** the Worker, the data layer, the Home screen ("Our journey": the days to the akad, a route of stages, what is due soon and late, recent changes), Money (the budget with payments), People (guests and vendors, with a detail pane), Tasks (reached from Home), the Add sheet with the quick-add parser, Settings (the day with its Hijri date, nicknames, look, your data, sign out, the stage editor), a sync screen, the export links, the sign-in and wrong-account screens, and the private design pages are on `main` and deployed at `wp.atqamz.com`. Access protects `/api/*` and `/design/*`; the app shell is public. Not built: the service worker, the other kinds of the generic list, the wedding-day rundown and the import. Statements below describe the code where it exists and are marked **plan** where it does not.
>
> **Name, 25 October 2026.** The product is called Nestora and is served at `nestora.atqamz.com`; `wp.atqamz.com` serves the same Worker during a 30-day soak ([rename plan](rename-nestora.md)). The text below keeps the early "wp" and "Wedding Planner" wording where it records the discussion; the Worker `wp`, the D1 database `wp` and the other internal identifiers keep their names on purpose.

---

## 1. Sheet inventory

### General findings

- **This file is an export of a Google Sheets template.** Evidence: the `FILTER` formula in the Kontak Vendor (vendor contacts) sheet is stored as `__xludf.dummyfunction(...)` with a cached value, and there is a template note telling you to do "File > Make a Copy". As a result that `FILTER` formula is **frozen** in the ODS: opened in LibreOffice, its contents don't update.
- **There is not a single cross-sheet formula.** Every sheet stands on its own. The only links between them:
  - the hyperlink menu in column B of every sheet (11 internal links to cell `A1` of each sheet);
  - two charts whose data source is the sheet itself;
  - *conceptual* relationships filled in by hand (see the [dependency summary](#dependency-summary)).
- **The layout is a "form", not a table.** Headers are in rows 4–7, data starts at column F, and some sheets have 2–12 table blocks side by side. So the import script has to read by cell coordinates, not "first row = header".
- **There are broken template leftovers:** 10 named expressions point to `#REF!`, and some conditional formats use `#ref!`. Safe to ignore.
- **Some sheets seem to still hold sample data from the template, or test data** (for example vendor entries that look randomly typed). Before import, we need to sort out which data is real.

### 1.1 DASHBOARD

- **Purpose:** front page. It holds the menu, the couple's name label, the wedding date, a countdown and the template notes.
- **Fields:** couple label (string); wedding date (date).
- **Formula:** countdown `=[.F10]-TODAY() & " Days"`. The result is a string, not a number.
- **Validation:** `val1` (value must be a date) is applied to block `E10:E18` and the date cell.
- **Other:** 11 menu hyperlinks and a "Catatan Penting" (important notes) block with template text.

### 1.2 Timeline

- **Purpose:** preparation checklist plus an 8-week Gantt grid.
- **Header:**
  - `Tanggal Dimulai` (start date) (date);
  - `Tampilkan Minggu` (show week) (integer, the week offset shown by the grid);
  - wedding label (string, the couple's name retyped; duplicate of DASHBOARD).
- **Task table** (rows 8–52, 45 slots):

  | Column | Type | Contents / formula |
  |---|---|---|
  | E (no) | number | `=IF([.F8]<>"";ROW([.D1]);"")` |
  | `Persiapan` (preparation) | string | task name |
  | `Start Date` | date | validation `val2` (must be a date) |
  | `End Date` | date | validation `val2` |
  | duration | number | `=IF([.H8]="";""; DATEDIF([.G8];[.H8];"d"))`, displayed as "N Hari" (N days) |
  | `Status` | string | `=IF([.F8]="";""; IF([.K8]=1;"Selesai";"Proses"))` |
  | K | boolean | done checkbox |

- **Total days:** `=SUM(H8:H52)-SUM(G8:G52)+1`.
- **Gantt grid `L:BO`** (56 day columns):
  - header rows: "Minggu N" (week N), date, and day abbreviation via `INDEX({"Sen"|…|"Mgg"};WEEKDAY(…;2))`;
  - grid start date: `=G4-WEEKDAY(G4;1)+2+7*(J4-1)`.
- **Conditional formatting:** highlight today; bar between start and end; progress bar `checkbox × duration`; colours for Selesai (done) / Proses (in progress) status.
- **Task contents:** generic template (*lamaran* (formal engagement proposal), *KUA* (Office of Religious Affairs, the marriage registry) paperwork, vendor/*WO* (wedding organizer), *seserahan* (ceremonial gift exchange), invitations, fitting, honeymoon, and so on).

### 1.3 Skenario Budget (budget scenarios)

- **Purpose:** static reference. There are 6 scenario tables with different total budgets.
- **Columns of each table:** `NO` (number), `LIST PERSIAPAN` (string), `BIAYA` (currency). 10 items per scenario.
- **Formula:** `Total = SUM(BIAYA)` per table.
- **Not referenced by other sheets.**

### 1.4 Anggaran Pernikahan (wedding budget)

- **Purpose:** bills and payments per event.
- **Three event tables:** `ANGGARAN LAMARAN` (10 slots), `ANGGARAN AKAD` (5 slots), `ANGGARAN RESEPSI` (10 slots). (*Akad* is the marriage contract ceremony, *resepsi* is the wedding reception.)
- **Columns:**

  | Column | Type | Formula |
  |---|---|---|
  | `No` | number | – |
  | `Kegiatan` (event) | string | – |
  | `Tagihan (Awal)` (bill, initial) | number | – |
  | `DP/Lunas`, `Termin 1`, `Termin 2` | number | – |
  | `Total Dibayar` (total paid) | number | `=IF([.G18]="";"";SUM([.I18:.K18]))` |
  | `Tagihan (Sisa)` (bill, remaining) | number | `=IF([.L18]="";"";[.H18]-[.L18])` |

  Each table ends with a `Total` row = `SUM` per column.
- **Summary matrix:**
  - rows: Tagihan (Awal), DP/Lunas, Termin 1, Termin 2, Total Dibayar, Tagihan (Sisa);
  - columns: LAMARAN, AKAD, RESEPSI, SUBTOTAL KEGIATAN;
  - the contents are `SUM`s of the tables below.
- **Bugs in the sheet:**
  - The `Subtotal Kategori` row = `SUM` of all six summary rows. That adds bills, payments and remainders into one number (double counting), so the figure is meaningless.
  - The AKAD × Termin 1 cell in the summary is filled with the text `---`, not a formula.
- **Chart (Object 1):** bar chart of Total Dibayar vs Tagihan (Sisa) (subtotal column).
- **Limitation:** payments are fixed at 3 columns (DP, T1, T2). There is no due date and no payment date.

### 1.5 Target Tabungan (savings target)

- **Dropdowns:** year (`val3`, a list of 5 years) and month (`val4`, Januari–Desember, 14 row slots).
- **Columns:** month (string from the dropdown), `Masuk` (deposit) for the groom-to-be (number), `Masuk` for the bride-to-be (number).
- **Formula:** `TARGET` is a typed-in constant; `TERKUMPUL = SUM(G6:G19)+SUM(H6:H19)`.
- **Chart (Object 2):** TARGET vs TERKUMPUL (collected).
- **Not there:** remaining shortfall, monthly target, or projection.

### 1.6 List Seserahan (*seserahan* list)

- **Columns:**
  - `Kebutuhan` (need) (string);
  - `Link Pembelian` (purchase link) (marketplace short-link URL);
  - `Harga (Rp)` (price) (number);
  - `Kategori` (dropdown `val5`: Perangkat Alat Solat (prayer set), Make Up & Skin Care, Peralatan Mandi (toiletries), Pakaian Dalam (underwear), Pakaian Luar (outerwear), Kebutuhan Lain (other needs));
  - `Status` (dropdown `val6`: Selesai (done), On Proses (in progress), Belum Selesai (not done)).
- **Formula:** `ESTIMASI BIAYA = SUM(Harga)` (cost estimate).
- **Size:** about 37 filled rows, slots up to row 50.

### 1.7 List Administrasi (paperwork list)

- **Columns:**
  - `No`;
  - `Dokumen Pernikahan` (wedding document) (string);
  - `Nominal`, `Detail`, `Jumlah` (all empty);
  - `Status` (dropdown `val7`: Selesai (done), Belum (not yet)).
- **Contents:** documents for the KUA, for example registration, photocopies of the couple's and their parents' IDs, health certificate, vaccination, neighbourhood-office cover letter, passport photos, stamp duty and the *mahar* (the groom's wedding payment) for the application.
- **`CATATAN` (notes) block:** a long text on the process of getting a marriage certificate: *RT/RW* (neighbourhood heads) → *kelurahan* (village office; forms N1/N2/N4) → home KUA (recommendation to marry elsewhere, *numpang nikah*) → destination KUA.
- **Formula:** none.

### 1.8 Kontak Vendor (vendor contacts)

- **Left table `LIST RENCANA VENDOR` (vendor plan list):**
  - `Ops Vendor` (dropdown `val8`: Venue, Decoration, Wedding Organizer, MUA, Catering, Photography, Attire, Hand Bouquet, MC, Entertaiment; the typo is from the source);
  - `Nama Vendor` (vendor name) (string);
  - `No Tlp` (phone no.): stored as a **number**. Leading zero and `+62` are lost, so it has to be normalised on import;
  - `PIC` (string);
  - `Action` (dropdown `val9` with one option: `FIX`).
- **Right table `FIX KERJASAMA VENDOR` (confirmed vendors):**
  - columns: `No` (`=IF([.O5]<>"";ROW(...);"")`), `Vendor`, `Nama Vendor`, `No Tpl`, `Catatan` (notes);
  - the contents are the Google Sheets version of `FILTER(F5:I37,(J5:J37="FIX"))`, which in the ODS became a frozen cached value.
  - The 4th column header on the right (`Catatan`) differs from the left column (`PIC`), so the labels don't match.

### 1.9 List Tamu (guest list)

- **Structure:** two sides, `LIST TAMU MEMPELAI LAKI-LAKI` (groom's guest list, columns F–Q) and `LIST TAMU MEMPELAI PEREMPUAN` (bride's guest list, columns U–AF).
- **Each side has 6 categories:** Teman (friends), Kolega (colleagues), Keluarga (family), Tetangga (neighbours), Teman Orang Tua (parents' friends), VIP.
- **Each category = 2 columns:** name (string) and count (number, probably the number of people per invitation).
- **Formula:** the count column header = `SUM` of rows 5–36 (32 slots).
- **Currently empty.**
- The shape is *wide* (12 blocks). In the app it becomes *long*: one row per guest.

### 1.10 Rundown Acara (event rundown)

- **Two tables:** `RUNDOWN ACARA LAMARAN` and `RUNDOWN RESEPSI DAN PERNIKAHAN` (*akad* and *resepsi* combined).
- **Columns:**
  - checkbox (boolean, filled by the formula `TRUE()`/`FALSE()`);
  - `No`;
  - `Waktu` (time): a **string** range `HH.MM - HH.MM`, not a time type;
  - `Acara` (event), `PIC`, `Keterangan` (remarks);
  - only in the *lamaran* table: `Highlights` (multi-line text).
- **Conditional formatting:** the row is highlighted when the checkbox is ticked; the number is highlighted when `Acara` is empty.

### 1.11 List Lagu (song list)

- **Columns:** `No`, `Judul` (title), `Penyanyi` (singer).
- **Formula:** none.
- **Not there:** a moment column (for example "bride's entrance").

### Dependency summary

**Formulas inside a sheet** (none cross sheets):

- **Budget:** summary ← the three event tables.
- **Savings:** TERKUMPUL ← monthly entries.
- **Seserahan:** ESTIMASI ← price column.
- **Guests:** category header ← count columns.
- **Vendors:** FIX table ← plan table (through `FILTER`, frozen in the ODS).
- **Dashboard:** countdown ← wedding date.

**Conceptual dependencies** (filled in by hand, prone to mismatched numbers):

```
Skenario Budget ──reference──▶ Anggaran Pernikahan ◀──"Seserahan" row── List Seserahan (estimate)
                                   ▲    ▲
             FIX vendors ──────────┘    └──── KUA fees / mahar ──── List Administrasi
Dashboard (date, name) ◀──retyped──▶ Timeline (wedding label)
Timeline (tasks) ──mentions──▶ seserahan, administration/KUA, vendors, invitations, guests, rundown
Target Tabungan ──compared by hand──▶ Anggaran total
```

---

## 2. Feature map and MVP cut

### Sheet → app mapping

| Sheet | In the app | Status |
|---|---|---|
| DASHBOARD | Home: countdown, budget summary, savings progress, 5 nearest tasks/payments | MVP |
| Timeline | Task list (start, end, done), sorted by date, "late" badge. Gantt grid **dropped** | MVP (simplified) |
| Skenario Budget | Dropped. If needed, it later becomes a "preset" at initial setup | Drop |
| Anggaran Pernikahan | Budget items per event (*lamaran*/*akad*/*resepsi*) + **payment rows** (DP/instalments become free-form rows, with a due date) | MVP |
| Target Tabungan | Deposit entries per month per person + progress toward the target | MVP |
| List Seserahan | Generic list (price, link, category, status, total) | MVP |
| List Administrasi | Generic checklist (document, amount, detail, quantity, done). The KUA process notes become static text | MVP |
| Kontak Vendor | One vendor list with status `option`/`confirmed` (the FIX table becomes a filter) + call/WhatsApp buttons | MVP (merge) |
| List Tamu | One guest list (side, category, name, number of people) + total per side/category | MVP (merge) |
| Rundown Acara | Rundown per event + **wedding-day mode** (offline, highlights "now/next", tick-off) | MVP |
| List Lagu | Generic list (title, singer, note) | MVP |

**Dropped:**

- the Gantt grid and `Tampilkan Minggu`;
- the hyperlink menu (replaced by a bottom nav);
- charts (replaced by native `<progress>`, see [MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/progress));
- Skenario Budget;
- the template notes text.

**Merged:**

- the couple's date and name (DASHBOARD + Timeline label) → the `settings` table;
- vendor plan + FIX → one `vendor` kind in `items`;
- DP/Termin 1/Termin 2 → `payment` rows in `budget_entries`;
- 12 guest blocks → one `guest` kind in `items`.

### The laziest way: one generic list screen

Seven of the eleven sheets have the same shape: rows with a few fields, a status/checkbox, and one total. That is exactly what the generic `items` table is for (§7): build **one** list+form component configured per `kind` (fields, input type, columns to sum, group by), instead of seven separate screens.

Only three dedicated screens:

1. Dashboard (built as the Home screen, "Our journey": the countdown in days, a route of stages from `src/domain/stages.ts` with the tasks of each stage, due soon and late tasks and payments, undated tasks, and the recent changes).
2. Money (the budget, payments nested under the line; built, formerly "Budget").
3. Rundown wedding-day mode (plan).

The generic list screen is built for the kinds `task`, `vendor` and `guest`: Tasks is reached from Home, and People holds the guest and vendor lists, each with a detail pane beside the list on a wide screen; the other kinds of §7.4 get a registry entry when their turn comes.

Input types use native elements:

- `<input type="date">` and `<input type="time">`;
- `<input type="month">` for savings. Supported in Chrome Android and iOS Safari, but **not** in desktop Safari/Firefox according to [MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/month) and [browser-compat-data](https://github.com/mdn/browser-compat-data). It's mobile-first, so that's fine;
- `<datalist>` for category suggestions, so categories stay free-form but there are choices.

### MVP definition: "the spreadsheet can be retired"

1. You two can log in, and the data syncs across two phones.
2. All data from the sheets can be viewed, added, edited and deleted, including offline.
3. The dashboard shows the countdown, total billed/paid/remaining, savings progress, and what's nearest.
4. The wedding-day rundown opens without signal.
5. One-time import from the ODS.

### Cheap extras that ship with the MVP

All of them are just client-side calculations or one link:

- **Countdown:** from `settings.ceremony_date`, shown as a number of days on Home.
- **Payment due date:** an "overdue" badge and a "next 7 days" list.
- **Savings progress:** plus "need to save `Rp X`/month" = (target − collected) / months left until the wedding day.
- **Tap-to-call and WhatsApp:**
  - phone: `tel:+628xxxxxxxxxx`;
  - WhatsApp: `https://wa.me/628xxxxxxxxxx` (official click-to-chat format, [WhatsApp FAQ](https://faq.whatsapp.com/5913398998672934)).

  Both need a number already normalised to international format.
- **Offline rundown:** the data is already in IndexedDB, so only the view is left.

### Backlog (in priority order)

1. **"Add to calendar"** for payment due dates and tasks. It's an `.ics` file generated on the client, then the phone's calendar handles the reminder. Zero server code. This is the cheapest replacement for push.
2. **CSV export** per `kind` (`docs/features.md` §5.4), for backup and archive after the event. D1 Time Travel is only 7 days on the free plan, see [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).
3. **Extra guest fields:** phone number, invitation sent, attendance status, and a WhatsApp invitation link.
4. **Share rundown** to WhatsApp as text (`https://wa.me/?text=…`, text URL-encoded; [WhatsApp FAQ](https://faq.whatsapp.com/5913398998672934)).
5. **Web Push reminder.** Only if `.ics` turns out to be not enough, see §5.6.
6. **Public RSVP page.** Only if truly needed, see its privacy cost in §4.
7. **Attachments** (receipt photos, moodboard) in R2. Needs an R2 subscription with checkout, see §3.
8. **Realtime** (Durable Objects + WebSocket). Most likely never needed for two people.

### Indonesian wedding specifics implied by the sheet

- **Three events:** *lamaran* (engagement), *akad* (the marriage contract ceremony), *resepsi* (reception). So the `event` enum in the budget (`engagement`, `ceremony`, `reception`), and the grouping of the rundown (the sheet combines *akad* + *resepsi* in one rundown, so the rundown uses `engagement` and `wedding`).
- **Seserahan:** categories exactly like the sheet's dropdown; there is a total estimate and a purchase link.
- **Paperwork:** KUA document checklist and process notes on the N1/N2/N4 forms and *numpang nikah* (getting married at another KUA).
- **Mahar:** appears in the budget and in the paperwork.
- **Guests:** split by the groom's/bride's side.

---

## 3. Architecture on the Cloudflare free plan

### 3.1 Hosting: Workers static assets vs Pages

| | Workers + static assets | Pages |
|---|---|---|
| Requests for static files | "free and unlimited", not counted against the Worker quota ([docs](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)) | static is free; requests to Pages Functions count against the Workers quota ([docs](https://developers.cloudflare.com/pages/platform/limits/)) |
| API | The same Worker (`/api/*`) | Pages Functions (still the Workers runtime) |
| Features | Cron Triggers, Workers Logs, Gradual Deployments are in Workers, not in Pages ([migration matrix](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)) | fewer |
| File limits | 20,000 files/version, 25 MiB/file ([docs](https://developers.cloudflare.com/workers/platform/limits/)) | 20,000 files, 25 MiB/file, 500 builds/month ([docs](https://developers.cloudflare.com/pages/platform/limits/)) |
| Custom domain | Custom Domain needs an active Cloudflare zone ([docs](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)). The `atqamz.com` zone is already on Cloudflare, see §8 | a subdomain can go through CNAME without a zone ([docs](https://developers.cloudflare.com/pages/configuration/custom-domains/)). This advantage isn't relevant here |

**Choose Workers + static assets:** one deploy unit, free unlimited static files, and extra features (cron for reminders) are available if we need them later.

### 3.2 Storage: D1 vs KV vs R2 vs Durable Objects

- **D1 (chosen).**
  - Real SQL, fits the tabular shape of the data.
  - Batch statements run as a SQL transaction ([docs](https://developers.cloudflare.com/d1/worker-api/d1-database/)).
  - There's `wrangler d1 export`, migrations, and 7-day Time Travel on the free plan as a safety net if data gets overwritten ([limits](https://developers.cloudflare.com/d1/platform/limits/), [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)).
- **KV (no, for the app's data).** Nestora does bind one KV namespace, `nestora-design`, for the private design pages (`docs/infra.md` §5.3): a few HTML documents written by hand and read by name, so none of the limits below matters for them.
  - The free plan is only 1,000 writes/day ([pricing](https://developers.cloudflare.com/kv/platform/pricing/)) and 1 write/second per key ([limits](https://developers.cloudflare.com/kv/platform/limits/)).
  - Eventually consistent: a change can take "up to 60 seconds or more" to show up in other locations ([how KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/)).
  - Bad for two people editing the same list.
- **R2 (not yet).**
  - For files/attachments, not row data.
  - Needs "an R2 subscription" through checkout ([get started](https://developers.cloudflare.com/r2/get-started/)), which means adding a payment method even on the free tier.
  - Put it in the backlog.
- **Durable Objects (an alternative, not chosen).**
  - The free plan only allows SQLite-backed ([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)). The quota is similar to D1 and there's WebSocket for realtime.
  - But it needs a class, bindings, DO migrations, and routing to an instance. More code for consistency that D1 already gives well enough (one database, one primary).
  - Keep it as an option if realtime is truly needed.

A super-lazy alternative we deliberately **didn't** pick: a single table `items(kind, data JSON)`. Fewer migrations, but it loses SQL constraints and makes import/aggregation messier.

### 3.3 API: one Worker, two data endpoints

A manual router with a `switch` on `pathname`, no framework. Every route needs a verified Access identity (401 otherwise); a wrong method is a 405. A path that is neither under `/api/` nor under `/design/` is a 404 before any identity check. The contract:

```
GET  /api/sync?since=<rev>   → { rev, epoch, me: "a"|"b", changes: { <table>: [rows...] } }
POST /api/sync               ← { mutations: [{ id, table, op: "create"|"update"|"delete", row_id, patch }] }
                             → { rev, epoch, rows: { <table>: [rows after applied] } }
GET  /api/login              → 302 to "/" (only used to trigger the Access login, see §5.5)
GET  /api/health             → { ok: true }
GET  /api/export?format=json → the dump of all three tables; ?format=csv&table=<items|budget_entries>&<kind|entry_type>=<value> → one CSV (§3.7)
GET  /design/<name>/         → the HTML page stored in KV under <name> (also HEAD; infra §5.3)
```

`epoch` is a random 32-character hex id created with the database (§7.2); every success response of both sync routes carries it, and the SPA uses it to detect a database that is not the one it synced with (§5.2). The three tables (`items`, `budget_entries`, `settings`), their columns and the `kind` registry are whitelisted in the Worker. Sync details are in §5.

### 3.4 Overview

```
Partner A's phone / Partner B's phone (PWA: React SPA + Service Worker + IndexedDB)
        │  HTTPS nestora.atqamz.com
        ▼
Cloudflare edge
  ├─ every other path, / included ─────────────► Worker "wp": static assets (dist/client, built by Vite)
  │                                               public, free, doesn't use request quota
  └─ /api/* and /design/* ─► Cloudflare Access (Google IdP only) ──reject unless it's one of those 2 emails
                                 ▼
                             Worker "wp" (verifies the JWT again)
                               ├─ /api/sync, /api/export, /api/login, /api/health → D1 "wp"
                               └─ /design/<name>/ → KV "nestora-design"
```

### 3.5 Free plan limits (checked 6 October 2026)

| Service | Free limit | When hit | Source |
|---|---|---|---|
| Workers requests | 100,000/day per account, resets at midnight UTC (7 am Western Indonesia Time, WIB) | Error 1027. "Fail open" routes bypass the Worker; "fail closed" shows the 1027 page. For this app that means the API is down until the reset | https://developers.cloudflare.com/workers/platform/limits/ |
| Static assets | requests "free and unlimited". Paths in `run_worker_first` still call the Worker | `run_worker_first` paths get 429 when the quota runs out | https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/ |
| Workers CPU | 10 ms per HTTP request and per Cron Trigger | Error 1102 "Worker exceeded resource limits" | https://developers.cloudflare.com/workers/platform/limits/ |
| Other Workers limits | memory 128 MB; subrequests 50/request; Worker size 64 MiB; 100 Workers; **5 Cron Triggers per account**; 20,000 asset files/version; 25 MiB/file | deploy rejected / error | https://developers.cloudflare.com/workers/platform/limits/ |
| D1 rows read | 5 million / day (counts rows *scanned*, not rows returned) | D1 queries error until the 00:00 UTC reset | https://developers.cloudflare.com/d1/platform/pricing/ |
| D1 rows written | 100,000 / day (an index adds 1 row written per index hit) | D1 queries error until the reset | https://developers.cloudflare.com/d1/platform/pricing/ |
| D1 storage | 5 GB total per account; 500 MB per database; 10 databases; 50 queries per invocation; Time Travel 7 days | must delete data before you can insert/alter again | https://developers.cloudflare.com/d1/platform/limits/ |
| KV | 100,000 reads/day; 1,000 writes/day; 1,000 deletes/day; 1,000 lists/day; 1 GB; 1 write/second per key | operations of that kind error until 00:00 UTC | https://developers.cloudflare.com/kv/platform/pricing/ · https://developers.cloudflare.com/kv/platform/limits/ |
| R2 | 10 GB-month/month; Class A 1 million/month; Class B 10 million/month; free egress; Standard storage only | an R2 subscription via checkout is required. Above the free tier you're billed at the pricing page rates. **Unverified** whether a hard cap can be set | https://developers.cloudflare.com/r2/pricing/ · https://developers.cloudflare.com/r2/get-started/ |
| Durable Objects | SQLite-backed only; 100,000 requests/day; 13,000 GB-s/day; 5 million rows read/day; 100,000 rows written/day; 5 GB | operations error until 00:00 UTC; storage full → `SQLITE_FULL` | https://developers.cloudflare.com/durable-objects/platform/pricing/ · https://developers.cloudflare.com/durable-objects/platform/limits/ |
| Access (Zero Trust Free) | free "for up to 50 users". A seat is used when a user authenticates | the 51st user can't be added. **Unverified** in the official docs what exactly happens | https://developers.cloudflare.com/reference-architecture/architectures/sase/ · https://developers.cloudflare.com/cloudflare-one/team-and-resources/users/seat-management/ |
| Access onboarding | payment details must be filled in when setting up Zero Trust. For the Free plan "you will not be charged" | – | https://developers.cloudflare.com/cloudflare-one/setup/ |
| Access session | from expiring immediately up to one month; global and application default 24 hours | the user has to log in again (the login flow is in `docs/infra.md` §6) | https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/ |
| Workers Builds (CI) | 3,000 build minutes/month; 1 concurrent build; 20 minute timeout | builds queue / fail | https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/ |

### 3.6 Usage estimate and what breaks first

Rough assumption: every app open = 1 pull + a few pushes.

- **Workers requests:** 2 people × 30 opens × 3 requests ≈ 180 requests/day, under 0.2% of 100,000.
- **D1 rows read:** total data is roughly thousands of rows. Pull uses the `rev` index, so only changed rows are read. Even a full pull of 1,000 rows × 60 times/day = 60 thousand rows read, about 1.2% of 5 million.
- **D1 rows written:** 1 edit ≈ 1 table row + 1 `rev` index row + 1 `sync_state` row, plus another index only when its column changed, so about 3 to 5. So 300 edits/day is at most about 1,500, under 2% of 100,000.

For two people, nothing breaks **unless there's a bug**. Risks in order:

1. **A polling or retry loop.** Polling 1×/second = 86,400 requests/day per phone. Two phones already pass 100,000. The rule: **never poll.** Sync only when the app opens or gets focus, after a change, and on the `online` event.
2. **Repeated full scans.** `SELECT *` without an index inside a loop can burn 5 million rows read. Use the `rev` index.
3. **Shared quota.** The Workers quota is counted per account, and the 5 Cron Triggers are per account too. If the same account is used by other projects, the quota is split. **Unverified:** whether there are other Workers on your account.
4. **KV if used for sessions/counters.** 1,000 writes/day runs out fast. Don't use KV.
5. **10 ms CPU.** Don't parse the ODS in the Worker; do the import offline (§7). JWT verification uses native WebCrypto, so it's safe.

### 3.7 Checks the Worker owns

The shared validators (`shared/validate.ts`) see one row, or one stored row plus one patch. Everything that needs another row, the stored state or the request as a whole belongs to the Worker. These checks are part of the contract; the SPA relies on them.

**Order of work for `POST /api/sync`.** Authenticate (Access JWT, 401 on failure), parse and size-check the body, validate every mutation, then apply everything in one `batch()`.

- **Request limits.** At most `MAX_MUTATIONS` (20) mutations and a body of at most `MAX_BODY_BYTES` (1 MiB). The client stops adding mutations to a request once the body would pass 512 KB (`BATCH_BYTES`; always at least one), and a valid mutation is small: the largest one the validator accepts (a task with every text field at its limit: title and group 500 characters each, note 10,000, `data.rules` 2,000) is 13,583 bytes of ASCII, or about 40 KB if every character takes three bytes in UTF-8. A full request of 20 such mutations stays under the 1 MiB cap, and one mutation always fits. `MAX_MUTATIONS` is 20 also because D1 allows 100 bound parameters per query: `test/sync.test.ts` builds the worst case of 20 mutations and checks that the read queries stay under it. Malformed JSON, an unknown top-level field or a bigger request is a 4xx `Rejection` with no `index`; an unknown field inside a mutation carries that mutation's `index`.
- **Query budget.** D1 allows 50 queries per invocation. Read every validation target of the request (existence, kind, tombstone) with at most one `IN (...)` query per table, never one query per mutation, and send all writes in one `batch()`.
- **Envelope.** `validateMutation` for each mutation. For `delete`, the patch is empty.
- **Validate against state plus earlier mutations.** Mutations apply in array order, and a later one may refer to a row created by an earlier one in the same request (a payment right after its budget line). Validate with the stored rows plus an in-memory overlay of the earlier mutations, then write everything in one `batch()`. Parents come first; the client sends in outbox order.
- **Update and delete.** The target must exist; a missing row is a rejection. An update or a delete aimed at a tombstone is a successful no-op, so a replayed `[update X, delete X]` or a replayed lone delete does not fail and "delete wins" (§5.3) holds. The one exception is undo, an update whose only change is `deleted_at: null` (not counting `updated_at`, which the client may also send), which clears the tombstone. The stored row's `kind` or `entry_type` is the variant, and `data` is parsed from its JSON text before `validateChange` runs. Updates go through `validateChange` (patch, merge, then validate the merged row).
- **Create.** `patch.id` (or `patch.key`) equals `row_id` (checked by `validateMutation`). A create whose id already exists is ignored and counts as success: replays after a lost acknowledgement are safe, and the client converges on the next pull. The exception is `settings`, where the key is the id and the value is single: a create on an existing key is an update of `value` (last write wins), otherwise the second phone's choice would vanish silently. Settings are never deleted: `validateMutation` rejects `delete` on `settings`, and a value that is "not decided" is stored as a value, so a settings row never becomes a tombstone and no revive case exists. Updates are patches, so replays are idempotent. The mutation `id` is bookkeeping for the client's outbox; the Worker does not store it.
- **Settings values.** The shared validators check a settings value against the type of its key (`shared/tables.ts`): a date, a time zone, a choice, a list of dates, a decimal and, for `stages`, the stage list (1 to 12 stages, each with a unique key and a unique name of at most 40 characters and a month range from -36 to 12 that starts after the stage before; `stageProblems` in `shared/validate.ts`). Both the SPA and the Worker run them, and the Worker owns nothing extra for any key.
- **References.** `vendor_id` (on `planned` rows) points at a live `items` row of kind `vendor`. `budget_id` (on `payment` rows) points at a live `budget_entries` row with `entry_type = 'planned'`. `parent_id` points at a live `items` row of the kind the child kind expects (no core kind uses it yet). No row refers to itself. A payment's `currency` equals its planned row's `currency`. References are checked on create and whenever a patch changes a reference column (`vendor_id`, `budget_id`, `parent_id`); a new reference must point at a live row, and an unrelated update of a row whose target was tombstoned later is not rejected. The database enforces only that the target exists; it cannot check kind or tombstone, so the Worker must. No core kind uses `parent_id` yet: whoever adds the first kind that does must add a cycle check.
- **Revisions.** Bump `sync_state.rev` only if the request writes at least one row; a request in which every mutation is a no-op leaves `rev` unchanged.
- **Server-owned columns.** The Worker writes `rev`, `updated_by` (`a` or `b` from the verified identity; `import` is reserved for the import script), `created_at` (on insert), `updated_at` and `deleted_at` (server clock, one stamp for the whole request). The client cannot set `rev`, `updated_by` or `deleted_at`: a create carrying `deleted_at` is rejected and a patch may only clear it (undo). The contract does let the client send `created_at` and `updated_at` (both required on create; `created_at` is immutable, `updated_at` is allowed in a patch) because the local copy needs timestamps before the round trip; the Worker ignores both and writes the server stamp of the request, and the next pull replaces the local values.
- **Delete.** `delete` sets `deleted_at` and bumps `rev`; nothing is removed and nothing cascades. Children stay and the UI hides them with their parent. Undo is an update that clears `deleted_at`.
- **Rejection.** Any failure rejects the whole request and writes nothing: a 4xx `Rejection` with `errors` and the `index` of the first failing mutation. The client parks that mutation (marks it rejected, shows it on the sync screen with the server's reasons, and lets the user discard it) and sends the others; a rejection with no `index` (an oversized or malformed body) parks the whole batch. A 5xx, a timeout or a network error means retry at the next trigger, never in a loop (§3.6); a redirect, a 401 or a 403 means the session expired (§5.5).
- **Response.** `rev`, `epoch` and the rows touched, read back from D1 after the batch. `epoch` is read in the same `batch()` as `rev` (`SELECT rev, epoch FROM sync_state`), is present on every success response of both routes, and is not writable by any request: no mutation can name `sync_state`, and no statement of the Worker updates `epoch`.
- **Cross-origin writes (CSRF).** The Access cookie is sent to the Worker, and sibling subdomains of the same registrable domain are same-site, so a state-changing request must prove it comes from the app: `POST /api/sync` requires `Content-Type: application/json` (415 otherwise), an `Origin` header, when present, must equal the request's own origin (403), and a `Sec-Fetch-Site` header, when present, must be `same-origin` or `none` (403). The Worker never emits CORS headers, so no other origin can read a response either.
- **Accepted limits.** Validation reads happen before the write batch, so two phones posting at the same instant can each pass checks the other invalidates (for example a payment created against a planned row that the other phone tombstones in the same moment); the foreign keys still hold, kind and tombstone checks may not, and the next pull converges the data. Changing a planned row's `currency` does not re-validate the payments that already point at it (references are checked on create and when the row's own reference columns change). Both are accepted for two users; revisit if either shows up in real use.
- **Response shapes.** Authentication, routing and server errors use `{ "error": "<code>" }`; sync rejections use the `Rejection` shape. Export differs from the design in two places: no `$schema` document is emitted yet, and the CSV export is one file per `kind` or `entry_type`, live rows only; tombstones appear only in the JSON dump.
- **Pull.** `GET /api/sync?since=<rev>` returns `rev`, `epoch`, rows with `rev > since`, tombstones included, for all three tables, and `me` derived from the verified identity. `since` is a non-negative integer (default 0); anything else is a 400.

---

## 4. Auth for two people

> **Superseded.** The recommendation below (email OTP, Worker-level Access) was replaced by Cloudflare Access with a Google identity provider, an app with path destinations and an inline policy; see `docs/infra.md` §6. The option table and the traps are kept as the record of the comparison; the traps are rechecked in `docs/infra.md` §6.5. What runs today is Access with a self-hosted application whose destinations are `/api/*` and `/design/*` (the app shell is public), an inline two-email policy and one identity provider, **Google**, with auto redirect; the first deploy pinned One-time PIN, Google was added after it and then became the only one. One-time PIN can be re-attached as a fallback.

| Option | Code to write | UX on the phone | Cost | Notes |
|---|---|---|---|---|
| **Cloudflare Access + email one-time PIN** | ±0 (dashboard configuration) + JWT validation | type email → code in the email (valid 10 minutes) → in. Repeat each time the session expires (max 1 month) | free up to 50 users, but onboarding asks for payment details | email identity is available in the JWT. [OTP docs](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/) |
| Access + identity provider (e.g. Google) | same | tap "Login with Google". Faster if both have Google | same | need to create an OAuth client in Google |
| Self-made magic link in Workers | token table, send email, session cookie, expiry, CSRF | click the link in the email | free. Sending to *verified destination addresses* is free on all plans ([Email Service](https://developers.cloudflare.com/email-service/)), but needs Email Routing enabled on the zone | our own security code |
| Passkey (WebAuthn) in Workers | registration + assertion + store challenge + COSE verification | nicest (Face ID/fingerprint) | free | the most code. `@simplewebauthn/server` only mentions Node and Deno ([docs](https://simplewebauthn.dev/docs/packages/server)); Workers support is **unverified** |
| "Device key" cookie (simplest) | ±20 lines: `/setup?key=…` checks a secret → sets a signed HttpOnly cookie | open the setup link once per phone, done | free, no card | the setup link = a credential. Leak = access. Revoke by changing the secret |
| HTTP Basic Auth | ±10 lines | behaviour in an iOS standalone PWA is **unverified** (the prompt may show up repeatedly) | free | not recommended |

### Recommendation: Cloudflare Access with email OTP

Reason: zero auth code to write, managed by Cloudflare, and revoking is just editing the policy.

**Setup:**

1. Put Access at the **Worker level**. This mode automatically protects the Custom Domain, `workers.dev` and preview URLs at once ([Workers + Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)).
2. Create an Allow policy with an Include of exactly 2 email addresses ([policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)).
3. Set the session to the maximum of 1 month so logins are rare.

**Traps to handle:**

- **`ctx.access` isn't available.** A Worker with static assets runs behind an internal router, and that router "does not pass `ctx.access` to the user Worker" ([docs](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)). So validate the `Cf-Access-Jwt-Assertion` header ourselves using the JWKS at `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs` ([docs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)). The `jose` library supports Cloudflare Workers ([README](https://github.com/panva/jose)). This is a dependency worth having because it's security-related. The side (`a` or `b`) derived from the JWT email is used for the `updated_by` column, never the email itself (`docs/infra.md` §6.4).
- **Manifest.** A manifest that needs credentials must use `crossorigin="use-credentials"`, "even if the manifest file is in the same origin" ([MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest)). Without it, the manifest hits the login redirect and install can fail. This applied while Access was in front of the whole host; the manifest is public now, so the link has no `crossorigin` attribute (`docs/infra.md` §6.5).
- **Session expiring inside the PWA.** API requests get redirected to the login page. How to handle it is in §5.5.
- **Zero Trust onboarding asks for payment details** even on Free ([setup](https://developers.cloudflare.com/cloudflare-one/setup/)). If that's not acceptable, use **Plan B: the device-key cookie**: the least code, no third party, and offline-friendly.
- **The iOS PWA cookie jar is separate.** On iOS, the cookies of a Home Screen web app are separate from Safari, so login has to be done *inside* the PWA. This is **unverified** in the official Apple docs, so it needs testing on day one.

### The public part and its privacy cost

The sheet has no RSVP column, so the MVP has **no public data at all**. (The app shell, meaning code, icons and the manifest, has been public since pull request 15, and holds no data; `/api/*` and `/design/*` stay behind Access.) If we want RSVP later:

**Privacy cost:**

- Anyone holding the link can see guest names, the date, and the event location.
- The invitation link will definitely be forwarded in WhatsApp groups.
- A public endpoint can be enumerated or spammed.

**Minimal mitigations:**

- Split it onto another hostname (e.g. `rsvp.atqamz.com`), or create a separate Access application for one path with the **Bypass** action ([policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)). Access can be applied per path, for example `example.com/login` ([docs](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)).
- One random token per guest. The endpoint only returns that guest's row, with no listing.
- Writes are limited to the RSVP fields only.

**Advice:** don't build it unless truly needed. Also make sure `workers.dev` and preview URLs aren't publicly open: set `workers_dev: false`, `preview_urls: false`, or protect them through Worker-level Access ([wrangler config](https://developers.cloudflare.com/workers/wrangler/configuration/), [workers.dev](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)).

---

## 5. Offline and sync

### 5.1 Service Worker strategy

**Status: plan, not built.** `main` has no service worker, no `src/pwa.ts` and no build plugin (`docs/infra.md` §5.7), so the app shell does not yet open without signal. The design below is what gets built.

- **App shell** (`/`, the hashed JS, CSS and font files in `assets/`, the manifest, the icons) is *precached* under a cache name that changes on every build, then served cache-first. The list of files is generated at build time by a small Vite plugin ([infra §5.7](infra.md#57-pwa-and-service-worker)), because the file names carry content hashes.
- **Navigation:** every navigation is answered with the cached `/` (the SPA entry), so the app still opens without signal.
- **`/api/*` and `/design/*`:** **network-only**, the service worker doesn't touch them and they never go into the Cache API. Data lives in IndexedDB. The design pages must be left out because they are navigations: a service worker that answered every navigation with the cached `/` would show the app shell instead of the page.
- **Update:** the build writes a new cache name and file list into `sw.js`, so the file changes byte for byte and the browser installs the new worker, which waits. The page shows a "New version, reload" banner; tapping it posts `skipWaiting`, and `controllerchange` reloads the page. There is no `clients.claim()`, so on the very first visit the page is only controlled from the next load.
- **No Workbox.** About 25 lines (`src/sw.js`; the build prepends `self.WP = { cache, files }`). The build output of this design was verified in a scratch project; behaviour in a browser is **not yet verified** (checklist M9 in `docs/infra.md` §8.2):

```js
const { cache, files } = self.WP;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(cache).then((c) => c.addAll(files)));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== cache).map((k) => caches.delete(k)))),
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "skipWaiting") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const { request } = e;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/design/")) return;
  const key = request.mode === "navigate" ? "/" : request;
  e.respondWith(caches.match(key).then((hit) => hit ?? fetch(request)));
});
```

Registration and the update prompt, `src/pwa.ts` (a sketch, not run):

```ts
export function registerServiceWorker(onUpdate: (apply: () => void) => void): void {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").then((reg) => {
    const offer = () => {
      const waiting = reg.waiting;
      if (waiting) onUpdate(() => waiting.postMessage("skipWaiting"));
    };
    offer();
    reg.addEventListener("updatefound", () => reg.installing?.addEventListener("statechange", offer));
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => location.reload());
}
```

### 5.2 Reading and writing offline

- **IndexedDB** ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API)) is the source of data for the UI.
  - One object store per D1 table (`items`, `budget_entries`, `settings`), plus an `outbox` store and a `meta` store (which holds the last pulled `rev`, `me`, the server's `epoch` and the phone's own `generation`, below). The database is `wp`, version 1.
  - A hand-written promise wrapper of about 50 lines (`src/store/db.ts`), typed by the table spec in `shared/` (decision in `docs/infra.md` §5.6). The `idb` wrapper (about 3.4 KB gzip, measured from `build/index.js` of version 8.0.3) is the drop-in; Dexie (about 31 KB gzip) is overkill for this need.
- **The Add sheet and quick add** (**built**: `src/ui/add-sheet.tsx`, `src/domain/draft.ts`). The plus button (bottom bar on a phone, sidebar on a wide screen) and the capture field on Home open one sheet with one text box, chips for the kind (task, budget line, payment, guest, vendor) and chips for what was read from the text; a chip opens a small editor. The text is read by a pure, deterministic function with no model and no network. It reads: a due date (`2026-10-20`, `20 Oct`, `Oct 20`, `20/10`, `today`, `tomorrow`, a weekday, `next fri`; a day and month without a year mean the next such day from today); **an amount only when it comes with a word, `Rp` or a grouped form** (`15jt`, `2.5 juta`, `150rb`, `Rp 1.500.000`, `1.500.000`), so a bare run of digits such as the `20` in "20 chairs" is never an amount; a phone number by the Indonesian grammar (`+62`, `62` and `08` forms, local runs and landlines); an owner (a nickname, `me`, `mine`, `them`, `theirs`, `both`); and a budget line that the text names (with an amount, the draft becomes a payment on that line). Text inside a URL or an e-mail address is left alone, and a field that the chosen kind does not store stays in the title. What was read is removed from the title and shown as a chip that the user can change or put back as plain text. **The exit check:** `lossless` verifies that every letter and digit of the input is in the title or in something that was read; if not, the draft falls back to a plain task titled with the whole input. Save validates, then writes through the store like any other write. An unsaved draft is kept in memory when the sheet is closed and is gone after a reload. The grammar's edge cases are in `test/domain-draft*.test.ts`.
- **Write:**
  1. Validate with `shared/validate.ts` (an invalid write is refused and never queued; an update sends only the fields that changed, and a `data` patch only the changed keys, `null` removing one).
  2. Add a mutation `{ id: crypto.randomUUID(), table, op, row_id, patch }` to `outbox` (stored with a `seq` order number and the time it was made) and save it to IndexedDB. The UI shows the pending mutations laid over the last server rows, so a write is visible at once and survives a reload. If saving fails, the write is rolled back and the sync badge says storage failed; it is never shown as up to date.
  3. Try to flush.
- **When to flush:** after writing (unless the session is known to have expired), when the app opens, on `visibilitychange` to visible, and on the `online` event. One cycle at a time; a trigger that lands during a cycle runs another cycle right after.
- **Don't rely on Background Sync.** `SyncManager` isn't supported in Safari or Firefox (data from [browser-compat-data](https://github.com/mdn/browser-compat-data), see also [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API)). The outbox only gets sent while the app is open, and that's enough.
- **Limit the batch size.** Flush at most 20 mutations per request (`MAX_MUTATIONS`) and at most 512 KB of body (§3.7), because the free plan limits D1 to 50 queries per invocation ([limits](https://developers.cloudflare.com/d1/platform/limits/)). Whether one `batch()` counts as 1 or N queries is **unverified**, so play it safe. A longer outbox goes out in several requests, in order.
- **Read:** `GET /api/sync?since=<rev>`, then merge into IndexedDB and store the new `rev`. A sync cycle is: push the outbox until it is empty or stuck, then pull once. **The cursor follows pulls only:** the `rev` in the answer to a `POST` is never stored as the cursor, because the other phone's changes between the old cursor and that `rev` would be skipped; the rows of a push answer are merged only if newer than the local copy (by their own `rev`), and the following pull moves the cursor. The cursor never moves back, except through the reset below.
- **First run is gated on one successful pull.** The app shows a loading screen until the store has loaded and one sync attempt has finished. A phone that has never heard from the server creates nothing and shows one of two screens: the sign-in screen when the first pull is answered by an Access redirect, a 401 or a 403 (the link is "expired"), or the "connect" screen (retry only) when the server cannot be reached; a phone that already holds an identity opens the app on its stored data in either case. After one successful pull it opens to the app, which is simply empty when the server holds nothing. The gate only keeps creation off until one pull has completed, so a fresh phone cannot create rows against a server it has not seen while offline or logged out.
- **IDs are created on the client** (`crypto.randomUUID()`, supported in Safari 15.4+ according to [browser-compat-data](https://github.com/mdn/browser-compat-data)), so rows created offline don't collide.
- **A database that is not the one this phone synced with.** The `rev` cursor only makes sense against the history it came from. A wiped database, a restore or a stale browser makes `rev` and the local rows meaningless, and an outbox written against the old history must not be sent to the new one. Two values tell the phone:
  - **`epoch`:** a random 32-character hex id in `sync_state`, created with the database (§7.2) and returned by every pull and push response (§3.3). The phone keeps the last one it saw in `meta`.
  - **`generation`:** a random token (`crypto.randomUUID()`) that the phone writes to `meta` each time it resets. It exists only for the compare-and-set below.
- **Three triggers.** After every pull or push response the store compares the response with its own state and resets when any of these holds: (1) the stored `epoch` is missing and the phone holds server data (`rev > 0` or any stored row), which is every phone from before epochs existed; (2) the stored `epoch` differs from the served one; (3) the served `rev` is lower than the cursor, with the same `epoch`, which is a rollback or a stale browser. A phone that has never synced and holds nothing (no `epoch`, `rev` 0, no rows) just stores the `epoch` and carries on, with no reset and no notice; its outbox is kept.
- **The reset** (`persistence.reset(generation, next)`) is one IndexedDB `readwrite` transaction over the three row stores, `outbox` and `meta`. It reads `generation` from `meta` and goes on only if it equals the value this tab last saw (a phone that never reset has none, and matches only a caller that saw none). If so it clears all five stores, writes the new `epoch`, `rev` 0 and `me`, and writes a new `generation`. If it does not (another tab of the same phone reset first), it clears nothing and the store reloads the other tab's state from IndexedDB. Then the pull starts again from `since=0`; the retry is bounded (two attempts, then the link shows offline), so a server that changes `epoch` on every call cannot loop it.
- **Pull before push.** The outbox of a phone that has not verified the `epoch` in this session (no successful pull since the page loaded) is not sent first: the cycle pulls, and the reset, if any, drops the outbox before anything is posted. After a successful pull the session is verified and later cycles push first as before. A push response is checked as well: if its `epoch` or `rev` shows a foreign history, the phone resets, and the batch that has just been applied counts as landed, not lost.
- **The notice.** After a reset that discarded something (the phone held server data, or the outbox had changes that were not sent), the app shows one dismissible notice: "The data on the server was reset, so this phone was reset to match.", plus the number of changes made on this phone that could not be kept. It is state in the store, not saved, so a reload clears it. A silent adoption of the first `epoch` shows nothing.

### 5.3 Conflicts between two phones

For two people, this strategy is enough without CRDTs:

- **`rev` from the server.** One global counter in `sync_state`. Every write request bumps that counter inside one `batch()` (a transaction), and all rows written get that `rev`. Pull uses `WHERE rev > ?`. This cursor doesn't depend on the phone's clock.
- **Last-write-wins per field.** The client only sends the fields that changed (`patch`). So if Partner A changes the price and Partner B changes the status on the same row, both survive. If it's the same field, whichever reaches the server last wins.
- **See who changed it.** The `updated_by` (`a` or `b`, shown as the partner's label from `settings`) and `updated_at` columns come with every row. **Built:** the "Lately" list on Home shows the five latest changes with who made them (the nickname, an avatar), the verb (added, ticked off, paid, changed), the title and the time (`src/domain/lately.ts`). **Plan, not built:** if a pull overwrites a field that was just edited locally, show a toast "changed by Partner B just now".
- **Delete = tombstone** (`deleted_at`). If one person deletes and the other edits, the delete wins. Undo is just clearing `deleted_at`.
- **List order** uses `sort REAL`. Built: a row added through quick-add gets `sort` = one below the lowest in its list, so new rows go to the top, and a list is shown by the order of the kind's statuses (for a task, `todo` before `done`) and then by `sort`, `created_at` and `id`, so equal values never reorder between phones. **Plan:** moving a row between two others (a fractional index: insert between two numbers) is not built; it would write only that one row, so there's no renumber conflict.
- **Leftover case:** if an ack is lost and the mutation is resent late, someone else's edit on the same field can get overwritten. This risk is accepted. The safety nets are `updated_by` and 7-day D1 Time Travel.
- **After a database restore, rotate the epoch.** A restore (D1 Time Travel, `wrangler d1 execute --file`, an import of a dump) brings back an old `rev` and may keep the old `epoch`; phones with the same `epoch` and a cursor at or below the restored `rev` would then accept the restored history as a continuation of their own and keep rows that no longer exist on the server. Run once after every restore, with the database name, not the binding (`docs/infra.md` §5.2):

  ```
  npx wrangler d1 execute wp --remote --command "UPDATE sync_state SET epoch = lower(hex(randomblob(16)))"
  ```

  Every phone then resets on its next pull. The command form is the one already used for the import in §7.4; it is **unverified** against a real restore.
- **Known limits of the reset.** (1) A tab still running older code (an installed copy that has not yet updated) next to a new tab of the same phone can wipe a pending write after a rollback with the same `epoch`. The mechanism is **unverified**; the old code has no `generation` to compare. (2) A database wipe while the app stays open applies one pending batch before the reset: the phone only learns of the new `epoch` from the push response, so that one batch lands in the new database (and the phone does not count it as lost), and the phone resets right after. Both are accepted for two users.
- **A parked mutation does not block the others.** A mutation the Worker rejects is kept in the outbox, marked rejected, and not sent again; later mutations go out without it (they may fail in turn if they depend on it, and are parked in turn). The user sees it on the sync screen and discards it.

Example write in the Worker (applied in one `env.DB.batch([...])`): a changed typed column is set directly, and a changed key inside `data` is merged with `json_patch`, so two phones editing different keys of one row both survive (columns and keys come from the `kind` registry, never from the request):

```sql
UPDATE sync_state SET rev = rev + 1 WHERE id = 1;
UPDATE items
   SET status = ?1,
       data = json_patch(coalesce(data, '{}'), ?2),
       rev = (SELECT rev FROM sync_state WHERE id = 1), updated_at = ?3, updated_by = ?4
 WHERE id = ?5;
```

### 5.4 Installing on Android and iOS

**Android (Chrome):**

- Install criteria: a manifest with `name`/`short_name`, 192 px and 512 px icons, `start_url`, standalone `display` (or similar), and HTTPS.
- There's also an engagement heuristic: at least one tap and ±30 seconds on the page ([web.dev](https://web.dev/articles/install-criteria)).
- The `beforeinstallprompt` event only exists in Chromium ([browser-compat-data](https://github.com/mdn/browser-compat-data)). It can be used for our own "Install" button.

**iOS/iPadOS:**

- There's no `beforeinstallprompt`. Install is manual through Share → Add to Home Screen ([web.dev](https://web.dev/learn/pwa/installation-prompt)). Since iOS 16.4, third-party browsers may also offer Add to Home Screen from the Share menu ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)), but Safari is still the most reliable route.
- Since Safari 26, "every website added to the Home Screen opens as a web app" by default, and a manifest is no longer required ([WebKit](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)).
- Show an instruction banner just once for iOS Safari.

**Why we must install to the Home Screen (especially on iOS):**

- **7-day deletion.** The ITP rule that deletes storage after 7 days without interaction doesn't apply to Home Screen web apps: "We do not expect the first-party in such a web application to have its website data deleted" ([WebKit](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)).
- **Persistent storage.** `navigator.storage.persist()` is granted by WebKit based on heuristics "like whether the website is opened as a Home Screen Web App" ([WebKit](https://webkit.org/blog/14403/updates-to-storage-policy/)).
- **Quota.** The quota for a Home Screen web app is the same as for a browser app, up to 60% of disk.
- D1 is still the source of truth. IndexedDB is only a cache that can be rebuilt.

### 5.5 Access + offline

- **Offline:** the app shell from the cache and the data from IndexedDB keep working even if the Access session has expired. Writes go into the outbox queue.
- **Online but the session expired:** API requests get redirected to the login. Built in `src/store/api.ts`: every call is made with `redirect: "manual"`; a redirect (`opaqueredirect`), a 401, a 403, or a 2xx answer that is not JSON counts as "expired" (the sync badge turns to "log in"), while a 5xx, a timeout of 15 seconds or a network error counts as "offline". The outbox is kept in both cases and sent after the next successful login.

- **The way back in is `/api/login`.** The "Log in again" button of the sync badge navigates to it (`actions.logIn`, a `location.assign`), and the sign-in screen's "Continue with Google" and the wrong-account screen's "Try another account" are plain links to it (`LOGIN_URL` in `src/store/api.ts`). `/` is public and never reaches Access, with or without a service worker, so navigating to `/` cannot start a login. Access intercepts `/api/login` (the service worker skips `/api/*`), the user logs in, and then the Worker redirects to `/`.
- **Which screen a phone shows.** A phone that holds an identity opens the app, and the badge says "Log in again" when the session has expired. A phone with no identity shows the sign-in screen when the link is "expired" and the "connect" screen when it is offline (§5.2). When Access refuses a Google account it sends the browser to the deny URL `https://nestora.atqamz.com/?access=denied`; the shell takes the parameter off the address and shows the wrong-account screen. **Sign out** in Settings is a link to `/cdn-cgi/access/logout`; whether that endpoint answers with path destinations only is **unverified**.
- **Unverified:** whether Access answers a non-navigation fetch with 302 or 401. The client handles both. **Test on a real phone.** One consequence of the mapping: the Worker's own 403 for a cross-origin write (§3.7) also shows as "expired".

### 5.6 Web Push for reminders: realistic?

**Platforms:**

- **Android Chrome:** works.
- **iOS:**
  - From iOS/iPadOS 16.4, and only for web apps that have been *added to the Home Screen*.
  - Permission must be requested from a direct user interaction, and the manifest needs `display` standalone/fullscreen ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)).
  - `PushManager` is in Safari iOS since 16.4 ([browser-compat-data](https://github.com/mdn/browser-compat-data)).

**Free plan:**

- **Scheduler:** Cron Trigger (5 per account, CPU 10 ms per run; [limits](https://developers.cloudflare.com/workers/platform/limits/), [cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/)). Cron runs in UTC.
- **Sending push:**
  - Needs a VAPID ES256 signature ([RFC 8292](https://datatracker.ietf.org/doc/html/rfc8292)).
  - The payload must be encrypted ([RFC 8291](https://datatracker.ietf.org/doc/html/rfc8291): ECDH + HKDF + AES-GCM).
  - All those algorithms are in Workers WebCrypto ([docs](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)).
- **The lazy trick:** send push **without a payload** (no encryption needed). In the `push` event, the SW fetches `/api/reminders` and then calls `showNotification`. If the Access session has expired, show generic text.

**Conclusion:** it works, but it's not MVP. Cheaper options:

1. **`.ics` "Add to calendar"** for every due date. Zero server, and the phone's calendar handles the reminder.
2. **A daily email digest** through Cron + `send_email` to the two verified addresses. Free on all plans ([Email Service](https://developers.cloudflare.com/email-service/)), but needs Email Routing on the zone. Right now `atqamz.com` has no MX record (checked via DNS, see §8).

---

## 6. Frontend: React, TypeScript, Vite

The operator chose React + TypeScript + Vite, replacing the earlier no-build-step plan (native ES modules, an import map and vendored libraries). It is a working choice that may be revised, so this section is about keeping the UI layer replaceable. The decisions, versions and sources (router, state, validation, shared types, tests, PWA tooling, build and deploy) are in `docs/infra.md` §5; they aren't repeated here.

### 6.1 Principles and layers

- A React 19 single-page app built by Vite and served by the same Worker as static assets. The UI text is English.
- The layers (only the frontend and its neighbours):

```
index.html              <link rel="manifest"> (no crossorigin: the shell is public), the inline script that applies the saved theme
public/                 manifest.webmanifest, icons (copied as is)
shared/                 tables.ts (the three table specs and the `kind` registry: the SQL whitelist), validate.ts, api.ts (the sync contract): used by the SPA and the Worker
src/
  main.tsx              boot, route switch, the loading, sign-in, wrong-account and connect screens (service worker registration: plan, not built)
  router.ts             hash router hook (#/money, #/people, #/tasks/<id>, …)
  tokens.css, style.css design tokens (colours, type, spacing), the two self-hosted fonts, base rules
  domain/               pure functions: budget totals, due soon and late, the stage route, recent changes, dates in the saved zone, the Hijri date, guest headcount, the quick-add parser, phone and rupiah parsing, screen and badge state, ordering, settings
  store/                persistence.ts (interface), db.ts (IndexedDB), memory.ts (tests), outbox.ts (batching, overlay), api.ts (fetch + login detection), store.ts (snapshot, writes, sync cycle), browser.ts (wiring and triggers)
  hooks/                use-store.ts: the only bridge between the store and React; use-plan.ts, use-busy.ts, use-room.ts
  views/                one file per screen: home, money (+ money-line), people (+ person), tasks, generic-item, settings, sync, connect, entry (sign-in and wrong-account). Replaced if React is ever replaced
  ui/                   shell and navigation (shell.tsx, nav.ts, routes.ts), the Add sheet and quick add, the edit form, the stage editor, small components, registry.ts (which fields each list shows), text.ts (all UI strings), theme.ts, Rupiah and date formatting through Intl (format.ts)
  (sw.js, pwa.ts)       plan: service worker source and its registration; not on `main`
worker/                 index.ts, auth.ts, sync.ts, export.ts: the API
migrations/0001_init.sql
wrangler.jsonc
```

**Rules that keep the UI layer replaceable:**

1. `views/` must not `fetch` or touch IndexedDB. A view only uses `store` through hooks (`useSnapshot()`, `useTable(table)`, and the `actions` of `src/hooks/use-store.ts`: `create`, `update`, `remove`, `setSetting`, `discard`, `dismissNotice`, `sync`, `logIn`) and `domain` functions.
2. `domain/` is pure (input → output, no DOM, no React), tested with `node --test` with no dependencies.
3. The store keeps an immutable snapshot and a `subscribe` function. React reads it through [`useSyncExternalStore`](https://react.dev/reference/react/useSyncExternalStore); any other framework can subscribe the same way (Vue through `ref`, Svelte through stores).
4. Routing uses the hash: zero server configuration, safe with the service worker, and framework routers generally have a hash mode. The Navigation API is only in Safari 26.2 and URLPattern in Safari 26 ([browser-compat-data](https://github.com/mdn/browser-compat-data)). Too new, skip for now.
5. React escapes text by default. Never use `dangerouslySetInnerHTML` with user text.
6. All UI strings are English and live in one file, `src/ui/text.ts`. There is no i18n library (no second language is planned). Numbers and dates are written through `Intl` (locale choice in `docs/features.md` §5.7; built in `src/ui/format.ts`).
7. `npm run check` fails if `src/domain`, `src/store`, `shared` or `worker` imports React, or if `src/views`, `src/ui` or `src/hooks` call `fetch` or use IndexedDB, `XMLHttpRequest` or `sendBeacon`, so rules 1 to 3 can't drift silently.

**Exit path:** if React is dropped, `store/`, `domain/`, `shared/`, the Worker and the D1 schema don't change. Only `views/`, `ui/`, `hooks/` and `main.tsx` are rewritten.

### 6.2 Where each decision lives

| Topic | Decision | Section in `docs/infra.md` |
|---|---|---|
| Build and serving | Vite 8 + `@cloudflare/vite-plugin`, SPA mode, one Worker | §5.2 |
| Router | None; hash routing in about 10 lines, plus the route table in `src/ui/routes.ts` | §5.1 |
| Data and state | `store/` + `domain/`, `useSyncExternalStore`, no state library | §5.6 |
| Validation | Hand-written, from the table spec | §5.1, §5.5 |
| Sharing types with the Worker | A `shared/` folder, three `tsconfig` files | §5.5 |
| Tests | `node --test` for pure code; no component tests | §5.1 |
| PWA and service worker | Hand-written service worker + a small Vite plugin; not `vite-plugin-pwa` (plan, not built) | §5.7 |
| CI and deploy | `npm run check`, then migrations, `vite build`, `wrangler deploy`, a smoke test | §7.2 |

---

## 7. Data model (D1)

**Decided (operator, final):** one generic `items` table for every list-shaped thing, one separate table `budget_entries` only for the budget and its payments, a `settings` table, and a one-row `sync_state` counter. The rationale (why generic, the exit rule, which columns each `kind` uses and what goes into `data`) is in `docs/features.md` §7.2; this section holds the SQL, the formats and the import mapping. The two must agree: change one, change the other. The earlier sketch of 12 per-feature tables is gone.

### 7.1 Conventions

These follow the decisions in `docs/features.md` §6.1:

- **id:** opaque `TEXT`, created on the client with `crypto.randomUUID()` (UUID v4);
- **instants** (`created_at`, `updated_at`, `deleted_at`): `TEXT`, RFC 3339 in UTC with `Z`, for example `2026-10-06T05:00:00Z`. They sort as text;
- **date only** (`due_on`, `done_on`): `TEXT 'YYYY-MM-DD'`. **Time of day** is only stored where local meaning matters (the rundown): `"HH:MM"` inside `data`, read together with the IANA zone in `settings.timezone`;
- **money:** `INTEGER` whole rupiah plus `currency TEXT` (default `IDR`) on every row that has an amount, never float. This departs from ISO 4217's minor unit 2 for IDR on purpose (`docs/features.md` §6.1 decision 3);
- **phone:** E.164, `+628…`, kept in `data.phone`; the `+` is dropped only when building a `wa.me` link;
- **identifiers are English** (tables, columns, enum values, `kind` values). Indonesian words stay only in italic prose with a gloss and as quoted spreadsheet labels in the import mapping. `a` and `b` name the two partners: that matches Partner A and Partner B in these docs and `who` in `docs/features.md`, and it doesn't record which partner is the groom; the private import script maps the sheet's groom's and bride's sides onto `a` and `b`;
- **status values** are per `kind` and listed in the registry in `docs/features.md` §7.2: `todo`/`done` (tasks, rundown), `option`/`confirmed`/`cancelled` (vendors), `todo`/`sent`/`confirmed`/`declined` (guests), `todo`/`in_progress`/`done` (bridal gifts), `due`/`paid` (payments);
- **sync columns on every synced table:** `rev` (the server counter, §5.3), `created_at`, `updated_at`, `updated_by` (`a` or `b`, derived by the Worker from the verified Access email, or `import`; **never an email**, and a `CHECK` enforces it), `deleted_at` (tombstone). Rows are never hard-deleted, which is also what keeps the foreign keys safe;
- **not created:** the append-only `events` table (its shape is decided in `docs/features.md` §6.1 decision 5; it is created when the first consumer appears), attachments (R2, backlog), full-text search (FTS5 virtual tables aren't supported by `wrangler d1 export`, `docs/features.md` §5.2: search runs on the client), and the secret for a calendar feed (not stored as plain text in D1).

### 7.2 Schema

This is `migrations/0001_init.sql`, byte for byte. It is applied to the production database, `test/migration.test.ts` runs it in SQLite, and an earlier scratch run on a local D1 (wrangler 4.147.0) rejected a deliberately bad row for each constraint (**verified locally**; behaviour of the constraints on the Cloudflare edge is unverified):

```sql
CREATE TABLE sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  rev INTEGER NOT NULL,
  epoch TEXT NOT NULL
);
INSERT INTO sync_state (id, rev, epoch) VALUES (1, 0, lower(hex(randomblob(16))));

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  rev INTEGER NOT NULL,
  created_at TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  updated_by TEXT CHECK (updated_by IS NULL OR updated_by IN ('a', 'b', 'import')),
  deleted_at TEXT CHECK (deleted_at IS NULL OR deleted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z')
);

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  parent_id TEXT REFERENCES items (id),
  title TEXT NOT NULL,
  status TEXT,
  group_key TEXT,
  due_on TEXT CHECK (due_on IS NULL OR due_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  done_on TEXT CHECK (done_on IS NULL OR done_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  amount INTEGER CHECK (amount IS NULL OR amount >= 0),
  currency TEXT NOT NULL DEFAULT 'IDR' CHECK (length(currency) = 3),
  qty INTEGER CHECK (qty IS NULL OR qty >= 0),
  who TEXT CHECK (who IS NULL OR who IN ('a', 'b', 'both')),
  note TEXT,
  data TEXT CHECK (data IS NULL OR json_valid(data)),
  sort REAL NOT NULL DEFAULT 0,
  rev INTEGER NOT NULL,
  created_at TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  updated_by TEXT CHECK (updated_by IS NULL OR updated_by IN ('a', 'b', 'import')),
  deleted_at TEXT CHECK (deleted_at IS NULL OR deleted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z')
);
CREATE INDEX items_rev ON items (rev);
CREATE INDEX items_kind_due ON items (kind, due_on);
CREATE INDEX items_parent ON items (parent_id);

CREATE TABLE budget_entries (
  id TEXT PRIMARY KEY,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('planned', 'payment')),
  budget_id TEXT REFERENCES budget_entries (id),
  vendor_id TEXT REFERENCES items (id),
  title TEXT NOT NULL,
  group_key TEXT,
  status TEXT CHECK (status IS NULL OR status IN ('due', 'paid')),
  amount INTEGER CHECK (amount IS NULL OR amount >= 0),
  currency TEXT NOT NULL DEFAULT 'IDR' CHECK (length(currency) = 3),
  due_on TEXT CHECK (due_on IS NULL OR due_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  done_on TEXT CHECK (done_on IS NULL OR done_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  who TEXT CHECK (who IS NULL OR who IN ('a', 'b', 'both')),
  note TEXT,
  data TEXT CHECK (data IS NULL OR json_valid(data)),
  sort REAL NOT NULL DEFAULT 0,
  rev INTEGER NOT NULL,
  created_at TEXT NOT NULL CHECK (created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  updated_at TEXT NOT NULL CHECK (updated_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  updated_by TEXT CHECK (updated_by IS NULL OR updated_by IN ('a', 'b', 'import')),
  deleted_at TEXT CHECK (deleted_at IS NULL OR deleted_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T*Z'),
  CHECK (
    (entry_type = 'planned' AND budget_id IS NULL AND group_key IS NOT NULL AND status IS NULL AND due_on IS NULL AND done_on IS NULL)
    OR
    (entry_type = 'payment' AND budget_id IS NOT NULL AND vendor_id IS NULL AND status IS NOT NULL AND amount IS NOT NULL AND (done_on IS NULL OR status = 'paid'))
  )
);
CREATE INDEX budget_entries_rev ON budget_entries (rev);
CREATE INDEX budget_entries_budget ON budget_entries (budget_id);
CREATE INDEX budget_entries_due ON budget_entries (entry_type, due_on);
```

How to read it:

- **`items`** is the table of `docs/features.md` §7.2 plus `currency` and `created_at` (money and time formats from §6.1). One row per task, vendor, guest, bridal gift, rundown line, song, saving, contribution, note, and so on; `kind` says which. `parent_id` links a contribution to its saving. `qty` is the number of people for a guest (`pax`). Everything a `kind` needs beyond the typed columns lives in `data` (JSON), for example `data.phone`, `data.pic`, `data.url`, `data.singer`, `data.start_time`.
- **`budget_entries`** is the only separate table, because it is where money accuracy matters most. One table holds both row types: a `planned` row is a budget line (`group_key` = the event, `amount` = planned cost, optional `vendor_id` pointing at a vendor item), a `payment` row belongs to a planned row through `budget_id` (`status` `due` or `paid`, `due_on`, `done_on`, `who` = payer). The table-level `CHECK` makes the two shapes mutually exclusive and forbids a payment date on an unpaid payment; the self-reference and `vendor_id` are real foreign keys. `amount` may be empty only on a `planned` row (the estimate is not known yet, for example the seeded *akad* fee row before the location is chosen); a `payment` row requires it. Zero is a real value, not "unset": an *akad* at the KUA costs nothing. Remaining amounts and totals are **calculated**, never stored. One table (not two) keeps a single `rev` pull and a single export shape.
- **What the database does not enforce:** which `kind` values exist, which statuses and columns belong to a `kind`, the shape of `data`, and that a payment's `currency` equals its planned row's. The `kind` registry in `shared/tables.ts` and the validation in `shared/validate.ts` enforce those, in the SPA and again in the Worker (`docs/infra.md` §5.5).
- **D1 limit that shaped the SQL:** a `LIKE` or `GLOB` pattern may be at most 50 bytes ([D1 limits](https://developers.cloudflare.com/d1/platform/limits/), 21 April 2026). A full instant pattern (`…T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*Z`) is longer and failed with "LIKE or GLOB pattern too complex" (**verified locally**), so the instant checks only test the date, the `T` and the `Z`.
- **Foreign keys** are enforced by D1 by default, "identical to the behaviour you would observe when setting `PRAGMA foreign_keys = on`" ([D1 foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/), 21 April 2026); the local D1 rejected a dangling `parent_id` and a payment pointing at a missing planned row (**verified locally**). So the Worker applies a batch in outbox order, parents first, and the client never sends a child before its parent. `PRAGMA defer_foreign_keys = on` exists for the opposite case and isn't needed.
- **JSON patches:** the Worker merges a changed `data` key without touching the others, with `json_patch` (RFC 7396 merge patch; a `null` value removes a key). D1 supports `json_patch`, `json_valid` and the other JSON functions ([D1 JSON](https://developers.cloudflare.com/d1/sql-api/query-json/), 21 April 2026), and a patch that sets one key and removes another worked on the local D1 (**verified locally**).
- **Rows written per edit** (the free plan counts index rows): the row, the `rev` index, the `sync_state` row, and a further index only when its column changed, so about 3 to 5. 300 edits a day is at most about 1,500 of the 100,000 daily writes (an estimate).

### 7.3 Settings keys

`settings` is key/value. The keys known so far (more can be added without a migration). `shared/tables.ts` validates the value of each key listed here (a date, a zone, a choice, a JSON list of dates, a decimal, the stage list) and accepts any other lowercase key with a plain text value. The app reads and edits `ceremony_date`, `timezone`, `partner_a_label`, `partner_b_label`, `stages` and `hijri_offset_days`; it does not read `hijri_calendar`, `holidays` or `portion_multiplier` yet. In the store, changing the same setting several times before the outbox is sent leaves one outbox entry with the last value. A settings row is never deleted and a value must not be empty, so clearing a value is not possible: "not decided" needs an explicit value of its own (for example `hijri_offset_days` is `0`, not absent):

| Key | Value | Used by |
|---|---|---|
| `ceremony_date` | `YYYY-MM-DD` | countdown and "H-day" offsets (`docs/features.md` W1) |
| `timezone` | IANA zone, for example `Asia/Jakarta` | reading `data.start_time` and `data.end_time` |
| `partner_a_label`, `partner_b_label` | nicknames | shown instead of `a` and `b`; Settings asks "Your nickname" and "Their nickname"; seeded privately in production, never in the repo. The words "Partner A" and "Partner B" never appear in the UI: a missing nickname shows "You" or "Them" by who is signed in, and an unassigned row shows "Nobody yet" |
| `hijri_calendar` | one of `islamic`, `islamic-umalqura`, `islamic-civil`, `islamic-tbla`, `islamic-rgsa` | validated, **not read**: the display always uses `islamic-umalqura` (`docs/features.md` §5.7) |
| `hijri_offset_days` | `-2`, `-1`, `0`, `1` or `2`, as text | the approximate Hijri date, moved by that many days (`docs/features.md` §5.7). Settings offers "A day earlier", "As calculated" and "A day later", and also shows a stored value of two days either way |
| `stages` | JSON list of `{ key, name, from, to }`: 1 to 12 stages, `from` and `to` are months relative to the akad month (-36 to 12), each stage starts after the one before | the route on Home and the group choices of the Add sheet; edited in Settings by the stage editor (add, remove, move, rename, set the months, reset to the default list). When the key is missing or invalid the app uses its built-in default list (`src/domain/stages.ts`) |
| `holidays` | JSON array of dates | working-day count (W6) |
| `portion_multiplier` | number | catering estimate (W16) |

**No email is stored in D1, in `settings` or anywhere else.** The login emails live only in the Worker secret `ALLOWED_EMAILS` (and the Access policy and the password store). It is an ordered pair: position 1 is `a`, position 2 is `b`. After the Worker verifies the Access JWT, it compares the `email` claim with the pair and derives the side (`docs/infra.md` §6.3 and §6.4). That side is what the Worker writes to `updated_by`, what it returns to the client as `me` (so the client can default `who` to `me` for "I'll take it" and show "changed by"), and what a `who` value of `a` or `b` means. The labels are display names, which are personal data: they live in D1 only, never in the repo.

### 7.4 Sheet → table mapping

"Labels" below are the sheet's own words, quoted; the values written to D1 are English. **The registry on `main` knows the kinds `task`, `vendor` and `guest` only:** the kinds `bridal_gift`, `rundown`, `song`, `saving` and `contribution` used below must be added to `shared/tables.ts` (with their statuses and `data` keys) before the import, because the SQL import bypasses the Worker, but the validators in the SPA and the Worker reject an unknown `kind` on every later edit and no screen lists it. The `who` of a guest is limited to `a` or `b` there.

| Sheet | Becomes | Mapping notes |
|---|---|---|
| DASHBOARD | `settings` | The wedding date → `ceremony_date`. The couple label is a name, so it is **not** imported; set `partner_a_label` and `partner_b_label` privately or in the app |
| Timeline (header, Gantt grid) | – | `Tanggal Dimulai`, `Tampilkan Minggu` and the Gantt grid are not imported |
| Timeline (tasks) | `items`, `kind = 'task'` | `Persiapan` → `title`; `End Date` → `due_on`; `Start Date` → `data.start_on`; the checkbox → `status` `done` or `todo`, with `done_on` empty (the sheet doesn't record when) |
| Anggaran Pernikahan (3 tables) | `budget_entries` | Each filled `Kegiatan` row → a `planned` row: `title`, `amount` = `Tagihan (Awal)`, `group_key` = the event of its table (`ANGGARAN LAMARAN` → `engagement`, `ANGGARAN AKAD` → `ceremony`, `ANGGARAN RESEPSI` → `reception`). Each filled `DP/Lunas`, `Termin 1`, `Termin 2` → a `payment` row (`budget_id` → the planned row, `title` "Down payment or full payment", "Instalment 1", "Instalment 2", `status = 'paid'`, `done_on` and `due_on` empty). `Total Dibayar` and `Tagihan (Sisa)` are **not stored**, they're calculated; the broken `Subtotal Kategori` row is ignored |
| Target Tabungan | `items`, `kind = 'saving'` and `'contribution'` | `TARGET` → one `saving` row (`title` "Wedding fund", `amount` = the target). Each filled month and `Masuk` column → a `contribution` (`parent_id` → the saving, `amount`, `done_on` = the first day of that month, `who` = `a` or `b` by column; the private import script says which column is which) |
| List Seserahan | `items`, `kind = 'bridal_gift'` | `Kebutuhan` → `title`; `Harga (Rp)` → `amount`; `Link Pembelian` → `data.url`; `Kategori` → `group_key`, translated (Perangkat Alat Solat → "Prayer set", Make Up & Skin Care → "Make-up and skincare", Peralatan Mandi → "Toiletries", Pakaian Dalam → "Underwear", Pakaian Luar → "Outerwear", Kebutuhan Lain → "Other"); `Status`: Selesai → `done`, On Proses → `in_progress`, Belum Selesai → `todo` |
| List Administrasi | `items`, `kind = 'task'`, `group_key = 'kua'` | `Dokumen Pernikahan` → `title`; `Nominal` → `amount`; `Detail` → `note`; `Jumlah` → `qty`; `Status`: Selesai → `done`, Belum → `todo`. The `CATATAN` text becomes static text in the app |
| Kontak Vendor (left table) | `items`, `kind = 'vendor'` | `Nama Vendor` → `title`; `Ops Vendor` → `group_key` (`Entertaiment` is imported as "Entertainment"); `No Tlp` → `data.phone`, normalised to `+62…`; `PIC` → `data.pic`; `Action` `FIX` → `status = 'confirmed'`, otherwise `'option'`. The right table (`FIX KERJASAMA VENDOR`) is **ignored** (a frozen derivative) |
| List Tamu (12 blocks) | `items`, `kind = 'guest'` | One row per filled guest line: the name → `title`; the left blocks (`LIST TAMU MEMPELAI LAKI-LAKI`) and right blocks (`LIST TAMU MEMPELAI PEREMPUAN`) → `who = 'a'` or `'b'`; the block title → `group_key`, translated (Teman → friends, Kolega → colleagues, Keluarga → family, Tetangga → neighbours, Teman Orang Tua → parents' friends, VIP → VIP); the count column → `qty`; `status = 'todo'` |
| Rundown Acara (2 tables) | `items`, `kind = 'rundown'` | `Acara` → `title`; the table (`RUNDOWN ACARA LAMARAN` → `engagement`, `RUNDOWN RESEPSI DAN PERNIKAHAN` → `wedding`) → `group_key`; `Waktu` "HH.MM - HH.MM" → `data.start_time` and `data.end_time` "HH:MM"; `PIC` → `data.pic`; `Keterangan` → `note`; `Highlights` → `data.highlights`; the row order → `sort`; the checkbox → `status` `done` or `todo` |
| List Lagu | `items`, `kind = 'song'` | `Judul` → `title`; `Penyanyi` → `data.singer`; the row order → `sort` |
| Skenario Budget | – | not imported |

### One-time import path

Personal data **must not** go into the repo.

1. **Sort out first** which data is real and which is template sample data.
2. **Read the ODS directly** with a Python stdlib script (`zipfile` + `xml.etree`) from `content.xml`. Take the `office:value`, `office:date-value` and `office:boolean-value` attributes, not the display text, so dates and numbers don't get broken by local formatting. Cell coordinates per sheet are hardcoded according to §1.
   - Alternative: export all sheets to CSV with LibreOffice. The 12th token of the CSV filter, `-1`, exports each sheet to its own file ([LibreOffice help](https://help.libreoffice.org/latest/en-US/text/shared/guide/csv_params.html)). But CSV loses data types (dates, currency "Rp."), so it's less recommended.
3. **The script produces `import.sql`** following the mapping above: `items` first, then the `planned` rows of `budget_entries`, then their `payment` rows (parents before children, because of the foreign keys). Every row gets a fresh UUID, `rev = 1`, `created_at` and `updated_at` set to the import time in RFC 3339 UTC, and `updated_by = 'import'`; the script ends with `UPDATE sync_state SET rev = 1;`.
   - The script itself may live in the repo (only coordinates and structure, no data).
   - Its input and output are kept **outside the repo** (e.g. `~/wp-private/`) or in a `.gitignore`d folder.
4. **Remove `BEGIN TRANSACTION`/`COMMIT`** if present ([D1 import](https://developers.cloudflare.com/d1/best-practices/import-export-data/)).
5. **Run the import:**
   ```
   npx wrangler d1 migrations apply wp --remote
   npx wrangler d1 execute wp --remote --file=../wp-private/import.sql
   ```
   The import file limit is 5 GiB, far above what we need.
6. **Match** the row counts and totals (budget, bridal gifts, savings) against the spreadsheet locally. Don't paste the numbers in an issue or PR.
7. **Delete `import.sql`.** The spreadsheet is archived, not deleted.

---

## 8. Domain and deployment

### State on 6 October 2026

Checked before the first deploy (public DNS queries via DoH `cloudflare-dns.com`, read-only), then updated after it:

- NS of `atqamz.com` = `chloe.ns.cloudflare.com`, `ray.ns.cloudflare.com`. That means the zone uses Cloudflare nameservers (full setup).
- The apex `atqamz.com` resolves to a Cloudflare IP, so it's already proxied.
- `wp.atqamz.com` was free (NXDOMAIN) before the first deploy and became the Worker's Custom Domain. Since 25 October 2026 the product is served at `nestora.atqamz.com`, and `wp.atqamz.com` serves the same Worker during a 30-day soak. On 7 October 2026 the full app was served like this: `/` and the other static paths are public, `/api/*` and `/design/*` are behind Cloudflare Access.
- There was no MX record when checked. This only matters if we later use Email Routing (the magic link option or the email digest).
- The `atqamz/nestora` repo (`atqamz/wp` until 25 October 2026) is public. It is no longer empty: `main` holds the app, the migration, the Worker and the CI workflow, and the `docs` branch is an orphan branch holding only these documents. The repository's default branch is `main`.

### Was unverified, now answered or still open

- **Answered:** the `atqamz.com` zone is in the same Cloudflare account as the Worker, and its status is active (a Custom Domain requires "An active Cloudflare zone", [docs](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)); the account has one member and no other organisation shares it.
- **Answered:** the hostname `wp` had no CNAME, and the first deploy created the Custom Domain.
- **Open:** whether there are other Workers in the account that share the 100,000/day and 5 cron quota (the account has one member, so any are the operator's own).

### How `wp.atqamz.com` is served

Use a Worker **Custom Domain**. Cloudflare creates the DNS record and certificate itself, and all paths are routed to the Worker ([docs](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)). `wrangler.jsonc` sketch ([config reference](https://developers.cloudflare.com/workers/wrangler/configuration/)):

The `wrangler.jsonc` (Worker entry, `assets` with SPA mode and `run_worker_first`, the D1 binding, the KV binding `DESIGN`, `secrets.required`, the dev-only `env.dev` block, whose `database_id` and KV `id` are placeholders while the production ids are at the top level only) is in `docs/infra.md` §5.2. The earlier sketch here (`main: src/worker.js`, `assets.directory: ./public`) is superseded: with the Vite plugin the assets directory is generated, and the Worker is `worker/index.ts`.

Notes:

- With the Vite plugin, `vite build` writes `dist/client` (assets) and `dist/wp` (Worker plus a generated `wrangler.json`), and `wrangler deploy` follows `.wrangler/deploy/config.json` to it (`docs/infra.md` §5.2).
- SPA mode is on (`not_found_handling: "single-page-application"`), and `run_worker_first: ["/api/*", "/design/*"]` keeps `/api/login` and the design pages reaching the Worker: in SPA mode, a browser navigation to such a path gets served HTML ([docs](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)).

### Deploy flow

> **Superseded.** The earlier advice here was Workers Builds. `docs/infra.md` §7 reversed it: GitHub Actions calling `npx` for `vite` and `wrangler` directly, with an account-owned token, because Workers Builds only accepts user-owned tokens and a second CI system would be needed for the checks. The deploy sequence is migrations, `vite build`, `wrangler deploy`, then a smoke test, on every push to `main` and every dispatch of `main` (§7.2 there).

Still valid from the earlier version:

- **Preview builds:** "Preview URLs are public by default", and D1 is only isolated "when you bind the Preview to a separate resource" ([Previews](https://developers.cloudflare.com/workers/previews/)). That means that, without extra settings, a preview from a branch can read the real DB through a public URL. `docs/infra.md` §7.4 settles it: previews are off (`preview_urls: false`).
- **`.gitignore`** (public repo): `main` has `.wrangler/`, `dist/`, `node_modules/`, `.dev.vars*` (but not `.dev.vars.example`) and `.env*`. It also ignores `*.ods`, `*.xlsx`, `*.xls`, `*.csv`, `import*.sql`, `wp-private/` and `export-*.json`, so an import or export file cannot be committed by accident.
- **Local dev:** `npm run dev` (the Vite dev server running the Worker locally, with a local D1; the migration is applied with `wrangler d1 migrations apply wp --local --env dev`). There is nothing to seed: the app opens empty, and any seed added later must hold **fake data** only.

---

## 9. Risks and open questions (most important first)

1. **Time left until the wedding day.** If it's only a matter of weeks, the MVP has to be cut down again to three things: budget + payments, offline rundown, and vendors with call/WhatsApp buttons. The rest stays in the spreadsheet.
2. **Personal data leaking through the public repo.** The paths could be an import file, a seed, test fixtures, screenshots in a PR, or an open preview URL. Mitigation: `.gitignore` from the first commit, fake data for dev, previews turned off or protected, and `workers_dev: false`.
3. **Access + PWA friction.**
   - Redirect when the session expires (the client treats a redirect, 401 and 403 as "log in again"; 302 versus 401 is still unverified).
   - The manifest used to need `crossorigin="use-credentials"`; it is public now, and `npm run check` fails if that attribute comes back.
   - A separate cookie jar in the iOS PWA.
   - `ctx.access` isn't available together with static assets (the Worker verifies the JWT itself).

   Test on two real phones (M9, still to do). If it's annoying, move to Plan B (device-key cookie).
4. **Data overwritten by conflicts.** Mitigation: per-field patches, `updated_by` shown, tombstones, and 7-day D1 Time Travel. Add a periodic CSV export.
5. **iOS quirks.**
   - The app must be installed to the Home Screen so storage is safe and push is possible.
   - No Background Sync, so the outbox is only sent while the app is open.
6. **Account quota shared** with other Workers, or a polling bug. Mitigation: don't poll, and check the usage dashboard after a week.
7. **Data quality from the template:**
   - sample data mixed with real data;
   - phone numbers stored as numbers;
   - frozen `FILTER` formula;
   - the "Subtotal Kategori" row that miscalculates.

   The import has to validate, not copy raw.
8. **After the event.** Who maintains it, and do we want to archive the data (export) and then shut down the Worker?

**Open questions for you two:**

- How long until the wedding day?
- Which data in the spreadsheet is real?
- Do we need a public RSVP? Or just use another service for the digital invitation?
- Do both of you have full access to all the data? (Assumption: yes.)
- Do you want to keep Skenario Budget as a reference?

---

## 10. Recommendation

**Concrete next step (one evening):**

1. **Decide first:** the time left until the wedding day. Auth is decided and live (Access with the Google IdP only; the device-key Plan B was not needed) and so is the framework: React + TypeScript + Vite (`docs/infra.md`).
2. **End-to-end spike on `wp.atqamz.com`** with just the budget (`budget_entries`: planned lines and their payments):
   - Worker + Vite-built static assets + D1 + Access on `/api/*`;
   - IndexedDB outbox, `GET/POST /api/sync`, SW app shell;
   - React views over the `store/` and `domain/` layers.
3. **Test on two real phones** (Android and iOS):
   - install to the Home Screen;
   - Google login inside the PWA;
   - edit offline on both phones then go online at the same time (conflict);
   - session expires → log in again button.
4. **If it passes:** add the generic list screen for the other 7 sheets, then the wedding-day rundown, then run the one-time import (§7). The spreadsheet is officially retired.
5. **After the MVP works:** if React is ever to be replaced, the migration is only `views/`, `ui/`, `hooks/` and `main.tsx` (§6.1).

**Status, 7 October 2026:** step 2 is largely built and deployed, beyond the budget alone: the Worker, the Vite-built assets, D1, Access on `/api/*` and `/design/*` with a public shell and its own sign-in screen, the IndexedDB outbox with `GET/POST /api/sync`, and React views for Home ("Our journey"), Money, People (guests and vendors), tasks, the Add sheet, settings with the stage editor, and sync. The service worker (app shell) and step 3 (two real phones) are not done; steps 4 and 5 are open.
