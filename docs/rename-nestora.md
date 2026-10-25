# Rename plan: wp to Nestora

Written 25 October 2026. Read-only investigation and plan: nothing was renamed, created, deleted, deployed or pushed while writing it.

> **Privacy.** This repo is public. The two users are **Partner A** and **Partner B**. No account, zone, database or namespace IDs, no emails, no team domain, no token or secret values appear here: resources are described by kind and name only. The Zero Trust team domain is written `<team>.cloudflareaccess.com`.
>
> **Label.** **[verified]** = I ran the command, read the file or read the official page in this session (the source is named). **[assumed]** = inference, general web-platform behaviour I did not test, or something that cannot be checked read-only. The commands I ran are listed in the [evidence](#10-evidence) section.

## Summary

1. **Rename now:** product text and title, the hostname, the GitHub repository, and the display names in Cloudflare (Access application and policy, KV title) and Google (project, consent screen, OAuth client, API key). **Leave:** the Worker script `wp`, the D1 database `wp`, the browser storage names (`wp-a`, `wp-b`, `wp`, `wp-side`, `wp-theme`, `wp.timer.*`), the `X-Wp-Side` header, the feed `UID` suffix and the Google project ID.
2. **Hostname:** attach `nestora.atqamz.com` to the same Worker and add its two paths to the same Access application, next to `wp.atqamz.com`. One Worker, one Access application, so `ACCESS_AUD`, the four Worker secrets and D1 stay untouched. Expected downtime: none.
3. **The app is already host-agnostic [verified]:** the Worker compares `Origin` with the request's own origin (`worker/index.ts:25-30`) and never emits CORS headers. The only hard-coded host strings are the CI smoke test (`ci.yml:79,92`), the route pin in `test/feed.test.ts:411` and the feed `UID` suffix (`shared/ics.ts:10`).
4. **Order:** Access destinations first, then the Custom Domain, then the code PR. The Worker fails closed (401 without an Access token), so even the wrong order would not leak data, but this order never leaves `/api/*` without the Access layer.
5. **Old host:** keeps serving everything for a 30-day soak. After both partners have moved, the shell and `/design/*` answer a 302 to the new host. `/api/*` and `/feed/*` are never redirected: the app treats any 3xx as "expired" (`src/store/api.ts:42-46`) and calendar clients hold the old feed URL.
6. **Cannot be made seamless:** installed PWAs (reinstall on each phone), an unsent outbox on the old origin (open the old app online first), one Google sign-in per device on the new host, and the saved light/dark choice.
7. **Data cost is tiny [verified]:** the D1 database is 120 KB in 6 tables. A phone on a new origin does one `GET /api/sync?since=0` (`worker/sync.ts:49-56`, no pagination).
8. **Cloudflare renames:** the Access application, its policy name and the KV title rename in place, and the CI token name can be edited. The D1 database name cannot be changed at all (the API accepts only the replication mode). A Worker can be renamed through the beta REST API (no `cf` command), but whether its custom-domain binding follows is undocumented, so leave it.
9. **GitHub:** the rename is safe (web and git redirect, no Actions refs, no Pages, webhooks or environments). The dangerous step is `atqamz/github`: the Pulumi logical name is the repo name (`main.go:63`) and the row is protected, so editing the row in place plans a delete plus a create. Use `pulumi state remove --force --target-dependents` and adopt again, behind a preview gate (0 deletes, 0 replaces).
10. **Google:** the project ID is permanent, display names are editable. The OAuth redirect URI is on the Zero Trust team domain [verified], so the hostname change needs no Google change. The console itself was not reachable; [section 5](#5-google-cloud-what-the-supervisor-checks) is the checklist.
11. **Plan:** six phases ([section 7](#7-the-plan)): 0 backups, 1 two code PRs, 2 Cloudflare, 3 GitHub and local, 4 Google, 5 cleanup after the soak. Every step has a rollback; the only step with no rollback is deleting the old Custom Domain at the very end.
12. **Open questions:** five, with defaults, in [section 9](#9-open-questions-for-the-operator). Not verifiable read-only: the Google console, whether Google Calendar follows a feed redirect, iOS Home Screen behaviour, and a Pulumi `preview` (not run).

---

## 1. Inventory of the name

### 1.1 Main branch (`75e97b1`)

**User-visible** (changes with the product name):

| Where | What |
|---|---|
| `index.html:9` | `<title>WP</title>` |
| `public/manifest.webmanifest:2-3` | `name` and `short_name` are `WP`. No `id`, no `scope`; `start_url` is `/` |
| `src/ui/text.ts:4` | `appName: "WP"`. It feeds the header wordmark (`src/ui/shell.tsx:42-44`), the sign-in screen brand (`src/views/entry.tsx:36`) and every document title (`src/main.tsx:95`, `src/ui/recovery-screen.tsx:8`, `src/views/entry.tsx:22`) |
| `src/ui/text.ts:9, 353, 408, 412` | Prose: "so WP cannot start", "a change in wp can take that long", "wp never sees your password", "the account you use for wp" |
| `shared/ics.ts:173` | `X-WR-CALNAME:wp` (the calendar's display name in Google Calendar) and `PRODID:-//wp//feed//EN` |
| `README.md:1` | `# WP` (also lines 16, 23 and 25 carry identifiers, below) |
| Wordmark CSS | `src/style.css:114` and `src/views/entry.css:66` set `text-transform: lowercase`, so today's wordmark renders as "wp" |

**Identifiers that must stay stable** (or need a conscious migration):

| Where | Identifier | Why it stays |
|---|---|---|
| `wrangler.jsonc:2` | Worker script `wp` | See [section 2](#2-cloudflare-resources). Secrets and the custom-domain binding hang on the script name |
| `wrangler.jsonc:10`, `ci.yml:66` | D1 `database_name: "wp"` and `migrations apply wp` | The database name cannot be changed |
| `package.json:12` | `dist/wp/wrangler.json` in `npm run check` | The Vite output folder is named after the Worker, so it follows the Worker name |
| `src/store/db.ts:85, 100` | IndexedDB `wp` (legacy) and `wp-a`, `wp-b` | Renaming strands the data and the outbox of every installed copy that is still served by this build |
| `src/store/partition.ts:10` | localStorage `wp-side` | Same reason |
| `src/ui/theme.ts:5`, `index.html:8` | localStorage `wp-theme` | Same reason (loses only a theme choice) |
| `src/domain/routine-timer.ts:15,17` | sessionStorage prefix `wp.timer.` | Pinned by `test/routine-timers.test.ts` and `test/partition.test.ts` |
| `shared/api.ts:47` | header `x-wp-side` | Wire contract between the SPA and the Worker; every cached tab sends it |
| `shared/ics.ts:10, 111` | `HOST` and `UID:<id>@wp.atqamz.com` | A changed `UID` makes calendar clients treat every event as new |
| `.gitignore:12` | `wp-private/` | Keep the pattern: it hides a local private folder. Add a new pattern rather than replace it |

**Free to rename:**

| Where | What |
|---|---|
| `package.json:2`, `package-lock.json:2,7` | npm package name (`private: true`, never published) |
| `ci.yml:54` | concurrency group `wp-deploy` |
| `ci.yml:79, 92` | smoke-test host (must change with the hostname, see [3e](#3-the-hostname-change)) |
| `vite.config.ts:5`, `test/sync-integration.test.ts:13` | env var `WP_PERSIST_TO` (local dev only) |
| `test/feed.test.ts:411` | pins `routes` to exactly `[wp.atqamz.com]`; must change when a second route is added |
| 24 files `test/fixtures/feed/*.ics` | carry `PRODID` and `X-WR-CALNAME` lines (3 header lines each); the `UID` lines stay |
| Tests with sample host `wp.example.test` | `test/access.test.ts`, `auth.test.ts`, `export.test.ts`, `feed*.test.ts`, `domain-import-csv.test.ts`; temp prefix `wp-check-` |
| README prose | title, the `d1 migrations apply wp` command (stays correct while the D1 name stays) |

Not present on main **[verified, `git grep`]:** no hostname in `src/`, `worker/` (except `shared/ics.ts`), no cookie names set by the Worker (it only reads `CF_Authorization`, `worker/me.ts:19`), no `uses: atqamz/wp` in the workflow, no repo name in `dependabot.yml`, no name in `LICENSE`.

### 1.2 `docs` branch (orphan, 6 files, 4,899 lines)

**[verified, `grep`]** `wp.atqamz.com` appears 57 times: `bootstrap.md` 30, `infra.md` 16, `brainstorm.md` 7, `routines.md` 3 (one is the planned reminder link `https://wp.atqamz.com/#/routines/<id>`), `books.md` 1, `features.md` 0. Identifier tokens: `wp-ci` (about 29), `wp-access-setup` (about 15), `wp-design` (about 11), `wp-google`, `wp-cloudflare-access`, `wp-private`, `wp-deploy`, `wp-theme`, `wp-a`/`wp-b`. Two statements are already stale and are fixed in the docs sync (step 3.7): `books.md:41` says `atqamz/github` does not manage wp (the row exists, `repos.go:100`), and `infra.md` §7.3 says CI attached the Custom Domain while `bootstrap.md` M7 says a short-lived token did.

### 1.3 `atqamz/github` (Pulumi + Go)

**[verified]** `repos.go:99-102` declares the row `Name: "wp"`, `Description: "Mobile-first wedding and household planner PWA on Cloudflare Workers"`, no `Homepage`, no topics, no `RequirePR`, no `RulesetID`. `main.go:63` creates the repository with the logical name `s.Name`; the alert switch, the workflow-permissions, the dependabot-security-updates and the ruleset are children of it (`main.go:68, 85, 96, 113`) with logical names `<name>-alerts`, `<name>-workflow-permissions`, `<name>-dependabot-security-updates`, `<name>-default-branch`. The repository carries `pulumi.Protect(true)` (`main.go:37`) and `ArchiveOnDestroy: true` (`main.go:60`). The repo's rules file says: "Removing a row from `repos` archives that repo ... only after a deliberate `pulumi state unprotect`. Never unprotect to make a preview clean" and "Never run `pulumi up` unattended". The project is `github-config`, stack `prod` (`Pulumi.yaml`, `Pulumi.prod.yaml`).

### 1.4 GitHub repository settings (`gh api` GET, names only)

| Setting | Value |
|---|---|
| Name, visibility, default branch | `atqamz/wp`, public, `main` |
| Description / homepage / topics | "Mobile-first wedding and household planner PWA on Cloudflare Workers" / empty / none |
| Actions secrets (names) | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`. No variables, no Dependabot secrets, no environments |
| Rulesets / branch protection | One ruleset `main guard` (active, rules `deletion` and `non_fast_forward`, no bypass actors). No classic branch protection (404) |
| Webhooks, deploy keys, Pages, releases, tags, deployments | None |
| Actions | Enabled, all actions allowed; default workflow permission `read`. Workflows: `ci`, `Dependabot Updates` |
| Open PRs, branches | 0 open PRs; branches `main` and `docs` |
| Security | Secret scanning and push protection enabled; Dependabot security updates enabled; code scanning not configured |
| Name `atqamz/nestora` | Free (404) |

### 1.5 Local machine

- The local clone sits in a folder named `wp`; its `origin` is `https://github.com/atqamz/wp.git`. Five git worktrees of it exist besides the clone, so moving the folder needs `git worktree repair` **[verified, `git worktree list`]**.
- The supervisor's project registry has one entry named `wp` that points at the clone **[verified]**; its CLI offers `add`, `list` and `trust` only (no rename seen).
- A per-project notes folder used by local tooling is keyed by the clone's path (the path with `wp` as its last part) **[verified, `ls`]**; moving the clone starts a fresh, empty folder unless the old one is moved too.
- The supervisor's own notes mention the name on about 30 lines (hostnames, `wp-ci`, the Google project, the API key) **[verified, `grep`]**.
- The untracked folder `.cloudflare/` in the local clone was listed, not opened, and is not part of the rename.

---

## 2. Cloudflare resources

Everything below is in one personal account with one zone **[verified, `cf accounts list`, `cf zones list`]**. The account also holds one unrelated Worker, an unrelated D1 database, unrelated DNS records, one unrelated redirect rule and three unrelated tokens; none of them is touched.

| Resource | Name today | Rename in place? | How | What depends on the name | Decision |
|---|---|---|---|---|---|
| Worker script | `wp` | **Possible, not recommended.** The beta Workers REST API takes `name` on `PATCH` and `PUT` of a Worker (stable UUID, mutable name; the changelog says renames no longer need a new Worker) **[verified, API reference and changelog]** | A raw API call. `cf workers` has only `check`, `delete`, `deployments`, `get`, `list`, `scripts`, `secrets`, `triggers`, `types`, `versions` **[verified]** | `wrangler.jsonc:2`; the custom-domain binding stores `service` = the script **name** (API reference) **[verified]**, and whether it follows a rename is not documented **[assumed unknown]**; `npm run check` reads `dist/wp/wrangler.json`; a deploy under another name targets another Worker, and with `secrets.required` a first deploy of a missing Worker is refused (bootstrap M7) | Leave. Optional rehearsal on a throwaway Worker in phase 5 |
| Worker versions and deployments | 10 deployments listed, newest 24 October 2026 | No | Follow the script | Rollback history | Leave |
| Worker secrets | `ACCESS_AUD`, `ACCESS_TEAM_DOMAIN`, `ALLOWED_EMAILS`, `GOOGLE_BOOKS_KEY` (all `secret_text`) **[verified, `cf workers secrets list`]** | Names are not renamed | Values cannot be read back | Bound to the script | Leave. Sources in [section 4](#4-what-not-to-rename) |
| Custom Domain | `wp.atqamz.com`, listed in the Worker's `references.domains` **[verified]** | **No.** A hostname is the key. Attach the new one, detach the old one later | Dashboard (Workers & Pages, the Worker, Settings, Domains & Routes), `PUT /accounts/{id}/workers/domains`, or a second `routes` entry in `wrangler.jsonc` | The DNS record and certificate are created and owned by the binding | Add `nestora.atqamz.com` now; keep the old one for the soak |
| DNS record for the host | `AAAA wp` → `100::`, proxied, `meta.read_only: true`, `origin_worker_id` set **[verified]** | No (read-only, managed) | Created when the domain is attached, removed when it is detached (**[assumed]**, not tested) | Nothing else | The new record appears by itself |
| Certificates | Advanced pack for `wp.atqamz.com`, its wildcard and the apex; Universal pack for `atqamz.com` and `*.atqamz.com` **[verified, `cf ssl certificate-packs list`]** | n/a | Docs: a Custom Domain generates an Advanced Certificate; deleting the domain does **not** delete it **[verified, Custom Domains page]** | Universal already covers `nestora.atqamz.com`, so TLS works at once | Delete the leftover advanced pack by hand at retirement (optional, free) |
| Two Custom Domains on one Worker | n/a | n/a | "You can add multiple Custom Domains" and `routes` takes a list **[verified, same page]**. Custom Domains need an exact hostname and cannot sit on a name with an existing CNAME; `nestora` has no record **[verified: the zone's DNS record list, and a public DNS query answers NXDOMAIN]** | n/a | Supported |
| D1 database | `wp` (id in `wrangler.jsonc:10`) | **No.** `cf d1 update` and `cf d1 edit` accept only `read-replication-mode` **[verified, `cf schema`]**. 120 KB, 6 tables, region APAC **[verified, `cf d1 get`]** | Rename means create, export, import, rotate the epoch (infra §8.2) | The Worker binds by `database_id`; the config `database_name` is "a human-readable name ... set when you first create the database" **[verified, wrangler docs]**; CI runs `d1 migrations apply wp` | Leave |
| KV namespace | `wp-design` (one key, `round2`) **[verified]** | **Yes.** `PUT .../storage/kv/namespaces/{id}` changes the title only; "the namespace ID and stored key-value pairs are unchanged" **[verified, API reference]** | `cf kv namespaces update <id> --title nestora-design` (flag name **[assumed]**; the body field is `title`) | The binding uses the id only (`wrangler.jsonc:12`) | Rename (optional, no risk) |
| Access application | `wp`; destinations `wp.atqamz.com/api/*` and `wp.atqamz.com/design/*`; custom deny URL `https://wp.atqamz.com/?access=denied`; session 720 h; SameSite lax; one policy `wp allowed` (two email rules) **[verified, `cf zero-trust access applications list`]** | **Yes**, name and destinations. `update` is a full `PUT`; `--body` and `--dry-run` exist **[verified]** | Get, edit with `jq`, `--dry-run`, update, get again | The AUD "will never change unless you delete or recreate the Access application" **[verified, Cloudflare docs]**; it is the Worker secret `ACCESS_AUD`, and `worker/auth.ts:18-22` accepts exactly one audience | Edit this application. Never create a second one (a second AUD would need a code change) |
| Access: other objects | It is the only Access application in the account, and there are no reusable policies (the policy is inline) **[verified, `cf zero-trust access policies list`]** | n/a | n/a | No "all Workers" application and no shared policy interfere | n/a |
| Identity providers | One-time PIN (unused here) and `Google (OIDC)` (generic OIDC) **[verified]**; the OIDC `redirect_url` is on the team domain **[verified]**; no `wp` in either | Display name only | `cf zero-trust identity-providers update` | Google console redirect URI | Leave |
| Zero Trust organisation | Team domain has no `wp` in it; `login_design` is empty **[verified, checked without printing the value]** | Renaming the team name would break `ACCESS_TEAM_DOMAIN` and the Google redirect URI | n/a | Secret and Google client | **Never rename** |
| API token | `wp-ci` (Zone Read; D1 Write and Workers Scripts Write; used 24 October) **[verified]** | `PUT .../tokens/{id}` takes `name`, `policies`, `status`; "roll" is a separate endpoint **[verified, schema]** | Dashboard rename of the name only | GitHub secret `CLOUDFLARE_API_TOKEN` holds the value; a rename should not change it **[assumed]** | Optional, last; no benefit beyond tidiness |
| Zone rulesets | One zone redirect ruleset (the single entry point of that phase) with one unrelated rule **[verified]** | n/a | A rule for the old host is **appended** with `cf rulesets rules create <ruleset-id>`; `rules delete` removes it **[verified, `cf schema`]** | Other rules must not be edited | Used in step 2.8 |
| `workers.dev`, previews, Email Routing | Both `workers.dev` and previews disabled; Email Routing is off (`enabled: false`) and the zone has no MX or TXT records **[verified]** | n/a | n/a | Nothing tied to the hostname | None |

**What a second hostname does to the Worker [verified, Custom Domains page and `worker/index.ts`]:** a Custom Domain sends every path of the exact hostname to the Worker as its origin, so both hostnames reach the same code and the same data. Zone rules (redirects) run before the origin, so a redirect rule beats the Worker for the old host (Single Redirects are first in the documented execution order).

---

## 3. The hostname change

`wp.atqamz.com` to `nestora.atqamz.com`. Both names sit under `atqamz.com`, so they are the same site but different origins.

### (a) Browser origin, storage and the installed app

- **Storage is per origin [assumed, web-platform behaviour]**: IndexedDB (`wp-a`, `wp-b`, legacy `wp`), localStorage (`wp-side`, `wp-theme`) and sessionStorage (`wp.timer.*`) start empty on the new origin. `books.md:40` already says so.
- **What a phone does on its first load of the new origin [verified, code]:** the shell loads with no login (it is public). The store sends a probe without a side, `GET /api/sync?since=9007199254740991`, with a 4 s timeout (`src/store/partition.ts:92`). Access answers with a redirect, which `src/store/api.ts:42-46` reads as "expired"; with no `wp-side` hint the app shows its own sign-in screen. "Continue with Google" is a link to `/api/login`; after sign-in the Worker answers 302 to `/` (`worker/index.ts:69`), the probe now succeeds, the partition `wp-<side>` opens, `adoptLegacy` finds no legacy database (`partition.ts:47-54`) and `catchUp` pulls from revision 0 (`store.ts`).
- **Size and limits:** the pull has no pagination and no row limit (`worker/sync.ts:49-56`: one `SELECT * ... WHERE rev > ?` per table). The production database is 120 KB **[verified]**, so a full pull is one small response. It grows linearly with data and stays small for a two-user planner. The 1 MiB and 20-mutation limits apply to pushes only (`shared/api.ts`).
- **Unsent outbox on the old origin is lost unless it syncs first.** It stays in that origin's IndexedDB until the old app runs online (sync fires on `visibilitychange` to visible and on `online`, `src/store/browser.ts:27-31`). It is lost if the old install is removed, or if the old origin stops serving the app, before that sync. Parked "rejected" entries are lost the same way.
- **Installed PWA:** `start_url` is `/`, with no `id` and no `scope`, so an installed copy is tied to the old origin and the new host needs a new install **[verified, manifest; origin binding assumed]**. On iPhone a Home Screen icon is bound to its origin **[assumed]**; the old icon keeps working while the old host serves the shell.
- **Chrome can migrate an installed PWA between same-site origins** (Chrome 150): the new manifest carries `id` and `migrate_from`, and the old origin serves `/.well-known/web-app-origin-association` with `allow_migration`; it migrates the install, not the data **[verified, Chrome's "Seamless PWA origin migration" post]**. Both names share `atqamz.com`, so they qualify. Optional, only worth it for Chrome installs; not tested here **[assumed]**.
- **Access cookies and the JWT audience:** Access keeps a global session on the team domain (single sign-on for all applications, default 24 h) and an application token per protected hostname **[verified, Session management page]**. The new host therefore gets its own `CF_Authorization` cookie, issued without another Google screen while the global session lives, and with one Google step otherwise (instant auth). The `aud` claim names the application, so tokens from either host verify against the same `ACCESS_AUD` **[verified, Cloudflare docs and `worker/auth.ts:18-22`]**. Sign-out is per host (`<host>/cdn-cgi/access/logout` clears that host's cookie).
- **`wp-side` hint** is empty on the new origin, so the app probes without a side and opens the side the server reports; there is no wrong-side risk **[verified, `partition.ts:92`]**. The saved theme (`wp-theme`) resets to the system default.

### (b) Feed subscriptions

- Calendar clients hold `https://wp.atqamz.com/feed/<token>.ics`. Only the SHA-256 of the token is stored (`worker/feed.ts:15`), so the URL cannot be re-issued; the token is shown once.
- **The Worker serves `/feed/*` on any host that reaches it and never checks the host** (`worker/index.ts:53`), so the same URL works on both hostnames while the old Custom Domain stays **[verified]**. Today an unknown token answers `404 {"error":"not_found"}` on the old host **[verified, `curl`]**.
- **Whether Google Calendar follows a 301 or 308 for a subscribed feed is not documented**; searches found only anecdotes (one plugin that did not follow a 301, one forum post where Google followed a redirect). Treat it as unknown **[assumed]**. I could not test it: a test would need a token, and rotating replaces the partner's real one.
- **Therefore: never redirect `/feed/*`.** Keep serving it from the old host for as long as a subscription may use it. A partner who wants the new URL makes a new link in Settings (the old link stops), and subscribes with it.
- **`UID:<id>@wp.atqamz.com`** (`shared/ics.ts:111`): calendar clients match events by `UID`, so changing the suffix makes every event look new on the next refresh **[assumed, iCalendar behaviour]**. Keep it. The suffix is an opaque id; the host does not need to resolve.
- **`X-WR-CALNAME:wp`** is the visible calendar name. Changing it to `Nestora` renames new subscriptions; existing ones may keep showing `wp` until renamed in the calendar **[assumed]**. Google refreshes on its own schedule, "usually every few hours and sometimes only once a day" (the app's own copy, `src/ui/text.ts:353`).

### (c) The Worker's own checks

**[verified]** `refuseUnsafe(request, url.origin)` (`worker/index.ts:25-30`) accepts a `POST` whose `Origin` is absent or equals the request's own origin and whose `Sec-Fetch-Site` is absent, `same-origin` or `none`. It is per request host, so each hostname checks against itself. The Worker emits no CORS headers and sets no cookies (`grep` for `access-control` and `set-cookie` in `worker/` finds nothing). `GET /api/login` answers a relative 302 to `/` (`worker/index.ts:69`). The identity call goes to the team domain with the request's `CF_Authorization` cookie (`worker/me.ts:18-27`). **Nothing in the Worker needs to change.**

### (d) Access and Google

- **Destinations:** add `nestora.atqamz.com/api/*` and `nestora.atqamz.com/design/*` to the existing application. The Access application was created at 13:03 and the Worker at 13:32 on the same day **[verified, `created_at` and `created_on`]**, so Access accepts destinations on a hostname that does not exist yet.
- **Custom deny URL** is a single string for the whole application **[verified, JSON]**: a wrong-account login on either host lands on whichever host the URL names. Point it at the new host once the new host is live.
- **Google:** the OIDC identity provider's redirect URL is on the team domain **[verified]**, and the setup records list only `https://<team>.cloudflareaccess.com` as authorised origin and `.../cdn-cgi/access/callback` as redirect URI (bootstrap M3, step 7) **[verified]**. The hostname change needs **no** Google change. The consent screen's own "App domain" links and "Authorized domains" are a separate check ([section 5](#5-google-cloud-what-the-supervisor-checks)).
- **Zero Trust team domain:** unrelated to the hostname and contains no `wp`; it must not change.

### (e) CI and config

`wrangler.jsonc:7` becomes two routes (`custom_domain: true` each). `ci.yml:79` and `ci.yml:92` (the smoke test of `/`, `/api/health`, `/design/round2/` and the unknown-feed-token check) loop over both hosts. `test/feed.test.ts:411` pins `routes` and must list both. `wp-ci` has Workers Scripts Write, which is the permission the attach API names **[verified, API reference]**, so CI should be able to attach the domain; the repo's own docs disagree about whether CI ever did (`infra.md` §7.3 versus `bootstrap.md` M7), so step 2.2 attaches the domain by hand first and the PR then matches it **[assumed for CI]**.

### (f) Design pages

`/design/<name>/` is served from KV by name, with no host in the key (`worker/index.ts:16-47`). The one page, `round2`, answers on both hosts once Access covers both. Links people hold keep working on the old host and are redirected in step 2.8.

### (g) Bookmarks, shared links, README

Hash routes (`/#/routines/<id>`) survive a redirect: when the `Location` URL has no fragment, the request's fragment is carried over **[verified, WHATWG Fetch, "location URL" steps]**. The README holds no hostname. The docs branch does (57 mentions) and is synced in step 3.7.

### Migration strategy (least risk)

One Worker, one Access application, two hostnames, a soak, then a partial redirect.

1. **Access first:** add the two new destinations to the existing application. Nothing changes yet (the host has no record).
2. **Attach `nestora.atqamz.com`** to the Worker. Universal SSL covers it at once **[verified]**; Access already protects it.
3. **Ship the code** (PR A: second route, CI loop, route pin; PR B: product name).
4. **Switch the deny URL** to the new host.
5. **Soak 30 days.** Both hosts work in full; partners move when ready. Thirty days equals the 720 h application session.
6. **302 redirect** of the shell and `/design/*` on the old host (not `/api/*`, not `/feed/*`, not `/cdn-cgi/*`). Use 302, not 301: browsers cache a 301 for a long time, and 302 is trivial to undo. Use `preserve_query_string: true`.
7. **Decide retirement at about day 90** ([step 5.1](#phase-5-cleanup-after-the-soak)).

What exactly is redirected on the old host:

| Path | During the soak | After step 2.8 | After retirement |
|---|---|---|---|
| `/` and static files (`/assets/*`, manifest, icons, `/#/...`) | Served | **302** to the new host, same path and query, fragment kept | Host removed or still redirecting |
| `/api/*` | Served; Access destinations for the old host stay | **Served, never redirected.** A page already open on the old origin calls `/api/sync` with `redirect: "manual"` and reads any 3xx as "expired" (`src/store/api.ts:42-46`); a cross-origin redirect would also need CORS, which the Worker never sends | Removed with the old Access destinations; the Worker then answers 401 because no Access token reaches it (`worker/auth.ts:20`) |
| `/feed/*` | Served | **Served, never redirected** (client behaviour unknown) | Served while any subscription uses it |
| `/design/*` | Served (Access covers both hosts) | **302** | n/a |

**Reversibility, downtime and what cannot be seamless.** Every step up to step 2.8 is reversible in minutes ([section 7](#7-the-plan)). Downtime is zero: the Worker never stops serving the old host, and the Access edit and the redirect rule are atomic. Not seamless: reinstalling the PWA on each phone; an outbox that is not flushed before the old install is removed; one Google step per device on the new host; the theme choice; a calendar that keeps showing the old name. **A 301 or 308 on the shell, applied before the phones moved, would strand an unflushed outbox:** the old origin's page would never load again, so its sync could never run. That is why the shell redirect comes last.

---

## 4. What not to rename

| Item | Recommendation | Cost to rename later |
|---|---|---|
| Worker script `wp` | Leave | A rename is possible through the beta API, but needs a rehearsal first (domain binding, `wrangler.jsonc` name, `dist/wp/` in `npm run check`). Same cost later |
| D1 `wp` | Leave | New database, export and import, rotate the epoch (clients reset on a changed epoch, `store.ts` `reconcile`), switch the id in `wrangler.jsonc`. High effort for no user benefit |
| Worker secrets | Names unchanged, nothing to re-enter | If the Worker were ever recreated, re-supply: `ACCESS_TEAM_DOMAIN` from the Zero Trust organisation record (`cf zero-trust organization get`, the team domain, host only), `ACCESS_AUD` from the Access application (`cf zero-trust access applications get`, the `aud` field), `ALLOWED_EMAILS` from the password store entry `wp / emails` (the order decides who is `a` and who is `b`; the Access policy lists the same two addresses), `GOOGLE_BOOKS_KEY` from the Google console, Credentials, "Show key" (only place it can be read again). None can be read back from the Worker |
| Google project ID | Cannot change: "After project creation, the project ID is permanent" and a used ID cannot be reused, even from a deleted project **[verified, Google docs]** | Only a new project plus a new OAuth client, a new identity provider secret and a new key |
| Zero Trust team name | Never | Breaks `ACCESS_TEAM_DOMAIN` and the Google redirect URI |
| Browser storage names, `X-Wp-Side`, `wp-theme` | Leave | A rename needs adopt-style migration code (like `adoptLegacy`) and a period where both builds are served; per-origin data on the old origin would be abandoned otherwise. Cheapest only after the old host is gone |
| Feed `UID` suffix | Leave | Every event is re-created in every subscribed calendar once; harmless for a read-only subscription but pointless |
| GitHub old URL | GitHub redirects web and git; "operations against the old location ... continue to function"; Actions calls into a renamed repo are not redirected; creating a new repository with the old name ends the redirects **[verified, GitHub docs]**. The docs give no redirect lifetime and do not say others can claim the name; only the owner can create repositories under the owner's account **[assumed]**. Nothing here uses `atqamz/wp` as an action, Pages site, badge or webhook **[verified]** | n/a. Never create a repository named `wp` again |
| `atqamz/github` Pulumi state | Do not let the rename run through a plain row edit | [Step 3.5](#phase-3-github-and-the-local-machine) |
| npm package name, `concurrency` group, `WP_PERSIST_TO` | Rename in PR B (free) | n/a |
| Git history | Untouched | n/a |

**Recommendation.** Rename the user-visible names now (product text, title, manifest, hostname, repository, Access application and policy names, KV title, Google display names) and leave the internal ids. Renaming an internal id later costs what it costs today, except for the browser storage names, which become cheaper once the old host is gone. The next features (a service worker, Web Push, the planned reminder sender in `routines.md`) bind to the origin, so **moving the origin now, with no service worker built, no push subscriptions and 120 KB of data, is the cheapest moment there will be.** The planned sender's link should take its host from configuration, not from the string `wp.atqamz.com` in `routines.md`.

---

## 5. Google Cloud: what the supervisor checks

The console was not reachable from here. The supervisor opens it through the operator's browser and records, for each item, the current value (never an email, a client secret or a key value). Expectation in the third column; nothing below is **[verified]** except Google's own pages.

| # | Where | Check | Expected |
|---|---|---|---|
| 1 | Project settings | Display name (the brief calls it `wp atqamz auth`) and the project ID (starts with `wp-`) | Display name editable "at any time" and not used by any Google API; the ID is permanent **[verified, Google docs]**. Rename the display name only |
| 2 | Google Auth Platform, Branding | App name (expected `wp`), support email, logo, "App domain" links (home page, privacy, terms), "Authorized domains", developer contact | App name is the text users see on Google's sign-in screen, so it is user-visible. Edit the app name. Check whether any link or authorised domain names `wp.atqamz.com`; if so, replace it with the new host (and keep `atqamz.com` authorised) |
| 3 | Audience | User type (External), publishing status (Testing or In production), number of test users | Google says changing a **verified** brand's name, logo or URLs "may need verification again" **[verified, Google help page]**. With only `openid`, `email`, `profile` the app should not be verified; confirm "verification not required" first and stop if the console warns about re-verification |
| 4 | Clients | The Web client's display name (the runbook suggested `wp-cloudflare-access`; confirm), its authorised JavaScript origins and redirect URIs, the number of secrets | Display name is editable, and client ID and secret do not change with it **[assumed]**. Origins and URIs should list only the team domain and its `/cdn-cgi/access/callback`; report any `wp.atqamz.com` entry (not expected) |
| 5 | Credentials, API keys | The key `wp books lookup`: name, API restriction (expected Books API only), application restriction (expected none) | Name editable without changing the key value **[assumed]**. A referrer restriction naming the old host would break a browser-side use; the key is used by the Worker, so none is expected |
| 6 | APIs and services | The Books API is enabled | Unaffected by names |
| 7 | Billing and organisation | No billing account and no organisation (personal project) | Unaffected |

---

## 6. The product name inside the app

| Surface | Today | Change |
|---|---|---|
| Header wordmark | `text.appName` in `.brand`, display font 800, lowercase by CSS | Text, not an image: nothing to redraw. Decide the casing (open question 1) |
| Sign-in and wrong-account screens | `.entry-brand`, 2.75 rem, lowercase | Same; plus the copy at `text.ts:408, 412` |
| `<title>` and document titles | `WP` and `<heading> · WP` | `index.html:9` and `text.appName` |
| Manifest | `name`, `short_name` `WP` | `Nestora` for both. Installed copies refresh the name on a manifest update (**[assumed]**, platform dependent) |
| Settings copy, toasts, errors | Only the four prose lines above use the name | Edit `text.ts:9, 353, 408, 412` |
| Feed | `X-WR-CALNAME:wp`, `PRODID:-//wp//feed//EN` | `Nestora` and `-//Nestora//feed//EN`; 24 fixtures |
| README | `# WP`, the docs pointer | Title and prose |
| App icons | `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | **[verified, rendered]**: a green square with a white square, no letters. Nothing to redraw because of the name; a Nestora mark is a separate design task |
| Design tokens and design pages | No name in `src/tokens.css`; the KV page `round2` is a design exploration | None |

**Risk to check in PR B:** "Nestora" is 7 letters against 2. The header is a flex row (`.bar`, `src/style.css:82-92`) with the wordmark (`.brand`, line 103, `flex: none`), the sync badge (`.sync`, lines 117-120, `min-width: 0`, pushed right) and the avatar. Check 320 px width and 200 % root text size for overflow and truncation, the rule earlier review rounds already apply to every UI PR **[assumed: not rendered here]**.

---

## 7. The plan

Legend: **Who:** S = supervisor (`npx cf` or the operator's browser), I = implementer through a PR, O = the operator by hand. **Risk** is the risk of the step done as written. Commands that change state are for the later execution, not run during this investigation.

### Phase 0: prerequisites and backups

**0.1 Tag main.** `git tag pre-nestora <sha of main>` and push the tag. Who: S, with the operator's authorisation for the push. Verify: `git ls-remote --tags origin pre-nestora`. Rollback: delete the tag. Risk: low. Needs: nothing.

**0.2 D1 restore point and a durable export.** `npx cf d1 time-travel get-bookmark <database-id>` (GET; I ran it, it works). Keep the bookmark; the window is 30 days on the Workers Paid plan and 7 days on Free **[verified, Time Travel page]**; which plan the account is on is **[assumed Free]**, so also take a durable copy: the app's own `GET /api/export` from a signed-in browser (JSON; `export-*.json` is git-ignored), stored in the password store, not the repo. Who: S for the bookmark, O or S for the export. Rollback: none needed. Risk: low.

**0.3 KV.** `npx cf kv keys list --namespace-id <id>` (one key, `round2`) and save the value privately (the page holds private text). Who: S. Risk: low.

**0.4 Access and DNS.** Save `npx cf zero-trust access applications get <app-id>`, `... identity-providers list` and `npx cf dns records list -z atqamz.com` to a private folder (the application JSON holds the two policy emails: never commit). Who: S. Risk: low.

**0.5 Secrets inventory by name.** The four names and their sources are in [section 4](#4-what-not-to-rename). Nothing is exported. Who: S.

**0.6 Pulumi baseline.** In the `atqamz/github` clone, in an attended session: `pulumi stack export --file <private file>` (state backup, kept outside the repo) and `pulumi preview`. Record today's diff for the `wp` row. I found one unrelated drift **[verified]**: GitHub has `allow_merge_commit: false` on `wp`, while `main.go:53` sets `AllowMergeCommit(true)` for every repo, so today's preview already plans an update on this row. Do not apply it as part of this work. Who: operator with S. Risk: low (preview reads).

**0.7 Quiet window.** No pending Dependabot merge, no running CI, no other implementer pushing. Dependabot auto-merges minor and patch PRs and each merge deploys; a deploy in the middle is harmless but muddies the checks. Who: S.

**0.8 Answer the open questions** of [section 9](#9-open-questions-for-the-operator).

### Phase 1: code (two PRs)

**1.1 PR A, second hostname.** Who: I. Changes:
- `wrangler.jsonc:7`: `routes` lists `wp.atqamz.com` and `nestora.atqamz.com`, both with `custom_domain: true`.
- `ci.yml:79` and `ci.yml:92`: run the existing loops once per host (`for host in nestora.atqamz.com wp.atqamz.com`).
- `test/feed.test.ts:411`: expect both routes.
- No change to `worker/` or `src/`: they are host-agnostic ([3c](#c-the-workers-own-checks)). `HOST` in `shared/ics.ts:10` stays.

Verify: `npm run check`. Rollback: revert the PR (a removed route may not detach the domain by itself, **[assumed]**, so also use 2.2's rollback). Risk: low. Needs: step 2.1 done before it merges.

**1.2 PR B, product name.** Who: I. Changes:
- `src/ui/text.ts:4, 9, 353, 408, 412`, `index.html:9`, `public/manifest.webmanifest:2-3`, `README.md:1`.
- `shared/ics.ts:173` and the 3 header lines of the 24 fixtures (not the `UID` lines).
- `package.json:2`, `package-lock.json:2,7`, `ci.yml:54` (`nestora-deploy`), `vite.config.ts:5` and `test/sync-integration.test.ts:13` (`NESTORA_PERSIST_TO`).
- Wordmark casing per question 1 (`src/style.css:114`, `src/views/entry.css:66`).
- Optional: `"id": "/"` in the manifest (the derived id today **[assumed]**) for Chrome's origin migration.
- **Not changed:** every identifier in the "stable" table, `.gitignore`'s `wp-private/`, the D1 and Worker names, `dist/wp/`.

Verify: `npm run check`; render the header and sign-in screen at 320 px and 200 % text. Rollback: revert. Risk: low. Needs: nothing (can ship before or after PR A).

### Phase 2: Cloudflare

**2.1 Access: add the two destinations (and later the names).** Who: S.
```sh
npx cf zero-trust access applications get <app-id> > app.json            # private folder
jq 'del(.id,.uid,.aud,.created_at,.updated_at,.domain,.self_hosted_domains)
    | .destinations += [{"type":"public","uri":"nestora.atqamz.com/api/*"},
                        {"type":"public","uri":"nestora.atqamz.com/design/*"}]' app.json > body.json
npx cf zero-trust access applications update <app-id> --body "$(cat body.json)" --dry-run
npx cf zero-trust access applications update <app-id> --body "$(cat body.json)"
```
`update` is a full `PUT` (**[verified]**), so the body must carry every field that matters: policies (with their ids, so the inline policy updates in place), `allowed_idps`, `auto_redirect_to_identity`, `session_duration`, `same_site_cookie_attribute`, `custom_deny_url`. Which read-only fields the API rejects is **[assumed]**; `--dry-run` shows it. Verify: get the application again and diff it against `app.json`: only `destinations` differs and `aud` is the same; `curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://wp.atqamz.com/api/health` still gives a 302 to the team domain. Rollback: `update` with the saved `app.json` body. Risk: **medium** (a full-replace on the only gate; a mistake fails closed, because the Worker answers 401 without a token). Needs: 0.4.

**2.2 Attach the Custom Domain.** Who: S or O. Dashboard: Workers & Pages, the Worker, Settings, Domains & Routes, Add, Custom Domain, `nestora.atqamz.com`. Or `PUT /accounts/{id}/workers/domains` with `hostname`, `service` (the Worker name), `zone_name`, using a short-lived account token with Workers Scripts Write (the `cf` CLI has no command for it, **[verified]**; bootstrap M7 did the same on day one). Verify: the Worker's `references.domains` (`npx cf workers get <worker-id>`) lists both; `npx cf dns records list -z atqamz.com` shows a new read-only `AAAA nestora`; `curl -sI https://nestora.atqamz.com/` gives 200 `text/html`; `/api/health` and `/design/round2/` give a 302 to the team domain; `/feed/<64 zeros>.ics` gives `404 {"error":"not_found"}`. Rollback: delete the domain in the dashboard or `DELETE /accounts/{id}/workers/domains/{domain-id}` (needs Workers Scripts Write), then delete its advanced certificate pack (not removed automatically **[verified]**). Risk: low. Needs: 2.1.

**2.3 Merge PR A.** The CI deploy repeats the attach (idempotent, **[assumed]**) and its smoke test now checks both hosts. If `wp-ci` is refused on the domain call, nothing breaks: fix the token or leave 2.2's manual attach as the source of truth. Who: S. Verify: CI green; the same `curl` checks. Rollback: revert and redeploy. Risk: low. Needs: 1.1, 2.2.

**2.4 Sign-in on the new host, two identities.** Who: O (Partner A and Partner B), S watching. Verify: [test plan](#8-test-plan-and-operator-note). Risk: low. Needs: 2.3.

**2.5 Move the custom deny URL** to `https://nestora.atqamz.com/?access=denied` (same get, `jq`, `--dry-run`, `update`; diff shows only `custom_deny_url`). Verify: sign in with a third Google account; the browser lands on the new host and the app shows the wrong-account screen. Rollback: put the old URL back. Risk: low. Needs: 2.3.

**2.6 Display names.** Who: S. The Access application `name` and the inline policy `name` (`wp allowed`) in the same `update` as 2.5 (**[assumed]** the policy keeps its id when sent with it); `npx cf kv namespaces update <namespace-id> --title nestora-design`; optionally rename `wp-ci` in the dashboard. Verify: `applications list` and `kv namespaces list` show the names, `aud` unchanged, a CI run still deploys, `/design/round2/` still answers behind login. Rollback: set the old names. Risk: low. Needs: 2.5.

**2.7 Soak (30 days) and phone migration.** Who: O. See the operator note. Exit when both partners have the new app installed, show their data, and have synced the old app to zero pending. Needs: 2.3.

**2.8 Redirect the old host's shell and `/design/*` (302).** Who: S. Append one rule to the existing zone redirect ruleset (`npx cf rulesets rules create <ruleset-id> --body ... --dry-run`, then for real), shaped like the existing rule: action `redirect`, `status_code` 302, `preserve_query_string: true`, expression
`(http.host eq "wp.atqamz.com" and not starts_with(http.request.uri.path, "/api/") and not starts_with(http.request.uri.path, "/feed/") and not starts_with(http.request.uri.path, "/cdn-cgi/"))`
and a dynamic target `concat("https://nestora.atqamz.com", http.request.uri.path)` (the function names and the `target_url.expression` field are **[assumed]**, from the Rules language and the redirect-settings page; `--dry-run` validates). Verify: `curl -sI https://wp.atqamz.com/` gives 302 with the new host and `/#/` survives in a browser; `https://wp.atqamz.com/api/health` still gives the Access 302; the feed check still gives 404 JSON. Rollback: `npx cf rulesets rules delete <rule-id>`. Risk: medium (a wrong expression could catch `/api/*` and make every old install show "Log in again"). Needs: 2.7.

### Phase 3: GitHub and the local machine

**3.1 Pre-check.** 0 open PRs **[verified]**, no CI running, secrets present by name (`gh api repos/atqamz/wp/actions/secrets`). Who: S.

**3.2 Rename the repository.** `gh repo rename nestora --repo atqamz/wp --yes` (or `gh api -X PATCH repos/atqamz/wp -f name=nestora`). Who: S, with the operator's explicit go (this is an outward change). Verify: `gh api repos/atqamz/nestora --jq .full_name`; `git ls-remote https://github.com/atqamz/wp.git` still answers; the `main guard` ruleset is still active; `gh api repos/atqamz/nestora/actions/secrets` lists both names (secrets and rulesets should stay with the repository: **[assumed]**); `gh workflow run ci.yml --ref main` runs green and deploys. Rollback: `gh repo rename wp --repo atqamz/nestora --yes`, as long as nobody created a repository named `wp` meanwhile. Risk: low. Needs: nothing technical; do 3.5 straight after, and **run no `pulumi up` in between** (see 3.5).

**3.3 Local clone.** `git remote set-url origin https://github.com/atqamz/nestora.git` once (worktrees share the config). Who: S.

**3.4 Description and homepage** come from Pulumi in 3.5 (`Description`, `Homepage: "https://nestora.atqamz.com"`), not from `gh repo edit`, so state and GitHub do not drift apart.

**3.5 `atqamz/github` (the dangerous one).** Who: operator-attended, with S. What the rename does to Pulumi (**[verified]** in the provider source at the commit pinned by pulumi-github 6.14.1 and in `main.go`; the parts that depend on GitHub's redirect for the old name are marked **[assumed]**):
- Pulumi is not told. State keeps `name` and the resource id `wp`.
- The repository's `name` is **not** `ForceNew` in the provider (the schema at that commit has no `ForceNew` on it, and the Pulumi schema has no `replaceOnChanges`). An update runs `Repositories.Edit` on the stored id with the configured name and re-sets the id to the returned name, with the source comment "it's possible that `repo.GetName()` is different from `repoName` if the repository is renamed". The provider handles an in-place rename.
- **Consequence 1:** after step 3.2 and before the row changes, a `pulumi up --refresh` would read the new name (GET through the redirect, **[assumed]**), then see `Name: "wp"` in code and **rename the repository back to `wp`**. Run no `up` in that window.
- **Consequence 2:** editing the row to `Name: "nestora"` changes the **logical name** too (`main.go:63`), so the plan is "create `nestora`, delete `wp`". The delete of the protected repository is refused, and a create of an existing repository fails: nothing is lost, but the stack is left half-planned. If someone then removed the protection, the delete would archive (`ArchiveOnDestroy`) the live repository. The repo's rules file forbids unprotecting to clean a preview.
- **Consequence 3:** even with aliases or `pulumi state rename`, `RepositoryVulnerabilityAlerts` and `RepositoryDependabotSecurityUpdates` have `repository` marked `ForceNew` in the provider (verified in the upstream source), so a changed `repository` replaces them, and the delete half calls GitHub with the **old** name (`DisableVulnerabilityAlerts(owner, <old name>)`). Whether GitHub's redirect would turn that into disabling alerts on the renamed repository is **[assumed unknown]**. Avoid the path.
- The operator's earlier adopt run found the same thing: adopting a name that is already in state plans a replace of its alerts, which the protected row refuses.

**Procedure (state remove, then adopt under the new name; no call is made with the old name):**
1. `pulumi stack --show-urns` to read the five URNs of the `wp` row; `pulumi stack export` backup from 0.6.
2. After 3.2, edit the row in `repos.go`: `Name: "nestora"`, the new `Description`, `Homepage`, and `RulesetID: "<id from gh api repos/atqamz/nestora/rulesets>"` (without it the adopt run creates a **second** `main guard` ruleset).
3. `pulumi state remove --force --target-dependents '<URN of the repository wp>'`. Local help for this command **[verified]**: protected resources need `--force`; resources with dependents or children are refused without `--target-dependents`. This edits state only; it calls nothing on GitHub.
4. `pulumi config set adopt nestora`, then `pulumi preview`. **Gate:** the preview must show imports for the repository, the alert switch and the ruleset, creates for the workflow-permissions and the dependabot-security-updates (idempotent: they set the same values), **zero deletes and zero replaces**, and for the repository only description, homepage and the known `allowMergeCommit` drift. Any delete or replace: stop, restore the state backup (`pulumi stack import`).
5. Attended `pulumi up`, then `pulumi config rm adopt`, then commit the row change through a PR in `atqamz/github` (its own flow).

Verify: `gh api repos/atqamz/nestora --jq '{name,description,homepage}'`; `gh api repos/atqamz/nestora/vulnerability-alerts -i` answers 204; `gh api repos/atqamz/nestora/rulesets` lists exactly one `main guard`; a later `pulumi preview` is clean. Rollback: state import from the backup, and `gh repo rename` back. Risk: **high if improvised, low as written**. Needs: 3.2.

**3.6 Local folder, project registry and memory (last, optional).** Only when no worktree is in use: move the folder (`mv ... nestora`), run `git worktree repair` for the five worktrees, register the new path in the supervisor's project registry, move the per-project notes folder to the new path key so the notes carry over, and update the supervisor's own notes (about 30 lines). Keeping the folder name `wp` costs nothing and avoids all of this. Who: S. Rollback: move back, repair again. Risk: medium (silent loss of the per-project notes if the folder is not moved with it).

**3.7 Docs branch.** Add this file as `docs/rename-nestora.md`; replace live-state statements (hostnames, "live at", product name in prose) in `bootstrap.md`, `infra.md`, `brainstorm.md`, `routines.md`, `books.md`, `features.md`; keep identifiers (`wp-ci`, `wp-design`, `wp-a`, ...) and fix the two stale statements of [1.2](#12-docs-branch-orphan-6-files-4899-lines). The privacy note of `bootstrap.md` stays. Who: S, as a docs-only commit. Rollback: revert the commit. Risk: low.

### Phase 4: Google display names

**4.1** The supervisor does the checks of [section 5](#5-google-cloud-what-the-supervisor-checks) first (read only), then edits, one at a time: project display name, consent screen app name, OAuth client display name, API key name. Verify: sign in on a phone and on a laptop (the Google screen shows the new app name; the login still completes); the Worker still holds `GOOGLE_BOOKS_KEY` and, where a Books lookup is deployed by then, one lookup still returns results (the key value did not change). Rollback: set the old names. Risk: low, with one exception: stop if the console announces re-verification. Needs: nothing technical; do it after 2.4 so a failed login can be told apart from a hostname problem.

### Phase 5: cleanup after the soak

**5.1 Decide the old host at about day 90.** Default: keep `wp.atqamz.com` attached as the feed and API host; it costs nothing. If both partners made new feed links on the new host (Settings, "new link", which revokes the old one), then retire it: remove the old two destinations from the Access application, detach the Custom Domain, delete its advanced certificate pack, delete the redirect rule, and remove the old host from the CI loop. **This is the one step without a rollback in the sense that old PWA installs, an unflushed outbox and any calendar still on the old URL stop for good**; re-attaching the domain restores the host, not them. Who: S, with the operator's explicit go. Risk: medium.

**5.2 Optional rehearsal of a Worker rename** on a throwaway Worker with a throwaway Custom Domain (does the domain binding follow, does `wrangler deploy` still find it, are secrets kept). Only if the operator wants the script renamed. Who: S. Risk: low on the throwaway.

---

## 8. Test plan and operator note

**From the outside (`curl`), after each of 2.1, 2.2, 2.3, 2.8, and for both hosts until 2.8:**
```sh
for host in wp.atqamz.com nestora.atqamz.com; do
  for p in / /api/health /design/round2/; do
    curl -sS -o /dev/null -w "$host$p %{http_code} %{content_type} %{redirect_url}\n" "https://$host$p"
  done
  curl -sS -w " $host feed %{http_code} %{content_type}\n" "https://$host/feed/$(printf '%064d' 0).ics"
done
```
Expected: `/` gives 200 `text/html` (302 to the new host for the old host after 2.8); `/api/health` and `/design/round2/` give a 302 whose target is `<team>.cloudflareaccess.com` (or 401, 403); the feed gives `404 application/json {"error":"not_found"}`; after 2.8 `/api/health` and the feed on the old host still answer as before. That is also what the CI smoke test checks (`ci.yml:79-92`).

**From a phone, two identities, new host:**
1. Partner A, fresh browser profile: open the new host, the sign-in screen appears with no redirect, "Continue with Google" goes to Google without a chooser and back; the header and every list show Partner A's data; the sync badge is quiet.
2. Partner B on another device or profile: the same, and the data belongs to side `b` (the sync badge and the "mine" filters match).
3. One browser, Partner A signed in, then Partner B signs in on the same host: the app opens Partner B's own partition and never shows or sends Partner A's rows; a tab that was loaded as Partner A shows "Signed in as someone else. Reload this page." (README, per-side databases).
4. A third Google account: Access refuses, the browser lands on `https://nestora.atqamz.com/?access=denied`, the wrong-account screen shows, and "Try another account" works.
5. Offline: airplane mode after the pull; the app opens read-only on its local data and queues writes; back online it syncs (this proves the outbox on the new origin).
6. Write a task on the old origin and open the new one: the change arrives (shared server state).
7. Calendar: `HEAD` or `GET` of the feed link from Settings answers `text/calendar` on both hosts; the calendar shows events and, after a refresh, the new name for new subscriptions.

**Operator note, per device.**
1. Before the cutover day, open the **old** app on each phone with signal and wait until the sync badge is quiet (nothing pending).
2. Open `https://nestora.atqamz.com` in the browser, tap "Continue with Google", and check that your data is there.
3. Install it: Android Chrome menu, Install app; iPhone Safari, Share, Add to Home Screen. Then remove the old icon (after step 1 on that phone).
4. Pick the light or dark theme again if you had chosen one; nothing else is lost.
5. Calendar: nothing to do. Google Calendar keeps the old feed URL working. If it still shows the name `wp`, rename it in the calendar's own settings. To switch to the new link anyway, make a new link in Settings, subscribe with it, and remove the old subscription (the old link stops working at that moment).
6. Old bookmarks and chat links keep working; after 2.8 they redirect to the new host.

---

## 9. Open questions for the operator

1. **Casing of the wordmark.** Show "Nestora" with a capital N, or keep today's all-lowercase look ("nestora")? *Default: "Nestora" everywhere (text, title, manifest, wordmark): drop `text-transform: lowercase` from `.brand` and `.entry-brand`.*
2. **How long does `wp.atqamz.com` stay?** *Default: 30-day soak, then redirect the shell and design pages (302); keep serving `/api/*` and `/feed/*` there; decide retirement at day 90, and keep it if either partner still has the old calendar link.*
3. **Rename internal ids too (Worker `wp`, D1 `wp`, local folder, `wp-ci`)?** *Default: no for the Worker and D1; yes for the Access application and policy and the KV title; the token only if the dashboard rename is trivial; the local folder last, or never.*
4. **Feed `UID` suffix.** *Default: keep `@wp.atqamz.com`; changing it re-creates every event in subscribed calendars once.*
5. **Which phones do the partners use (Android Chrome, iPhone, both)?** *Default: assume both and reinstall by hand; add `id` and `migrate_from` to the manifest (Chrome 150 migration) only if there are Chrome installs worth the extra file.*

---

## 10. Evidence

**Not verified, and why:** the Google console (not reachable); whether Google Calendar and other clients follow a 301 or 308 on a feed (no safe way to test: the partner's real token is the only one, and rotating replaces it); iOS Home Screen storage and install behaviour (no device, no Apple page read); whether `wp-ci` can attach a Custom Domain in practice (API reference says Workers Scripts Write suffices, the repo docs disagree about history); what wrangler does when a route disappears from the config; whether a Worker rename keeps its custom-domain binding; the exact output of a Pulumi `preview` (not run: it reads state, outside the allowed commands); GitHub's redirect lifetime for a renamed repository (not stated); rendering of the seven-letter wordmark at 320 px and 200 % text; trademark, domain-name and store collisions for the name "Nestora" (not searched).

**Commands run (read-only), all in this session:**
- Git: `git show origin/docs:docs/<file>` (six files), `git grep`, `git ls-tree`, `git worktree list`, `git log`.
- GitHub (GET only): `gh api repos/atqamz/wp` (repository, `actions/secrets` names, `actions/variables`, `environments`, `rulesets` and its detail, `hooks`, `keys`, `pages`, `releases`, `tags`, `branches`, `branches/main/protection`, `actions/permissions`, `actions/workflows`, `actions/runs`, `dependabot/secrets`, `pulls`, `deployments`, `interaction-limits`, `code-scanning/default-setup`), `gh api repos/atqamz/nestora` (404), `gh api` raw contents of the upstream provider source at the commit pinned by pulumi-github 6.14.1, and `gh search code`.
- Cloudflare (`npx cf`, GET only, each checked with `cf schema` first): `accounts list`, `zones list`, `dns records list`, `workers scripts search`, `workers list`, `workers get`, `workers secrets list`, `workers deployments list`, `d1 list`, `d1 get`, `d1 time-travel get-bookmark`, `kv namespaces list`, `kv keys list`, `zero-trust access applications list`, `zero-trust identity-providers list`, `zero-trust organization get`, `zero-trust access policies list`, `accounts tokens list`, `rulesets list`, `rulesets get`, `ssl certificate-packs list`, `email-routing settings get`; `cf cli search` and `cf docs search` for discovery; Cloudflare docs pages fetched as Markdown (Custom Domains, Wrangler configuration, D1 commands, KV namespaces, the KV rename and Workers domains and Workers update API references, Session management, Validate JWTs, Single Redirects, Redirects, Time Travel, Workers infrastructure-as-code, the new Workers API changelog).
- Public: `curl` of the old host (`/`, `/api/health`, `/design/round2/`, an unknown feed token), a DNS-over-HTTPS query for `nestora.atqamz.com` (NXDOMAIN), GitHub's "Renaming a repository" page, Google's project and consent-screen pages, Chrome's PWA origin migration post, the WHATWG Fetch text, MDN pages on redirects.
- Local: `pulumi state remove --help`, `pulumi version`, reading the sibling repo files and the supervisor's notes, listing (not opening) the local clone's untracked folder, rendering the three app icons.
