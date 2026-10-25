# Infra and stack: Nestora on Cloudflare

Research and decisions as of 6 October 2026. **Status, 6 October 2026:** the design below was approved and built the same day: the scaffold, the shared contract, the Worker, the SPA core and the deployment are on `main` and live at `nestora.atqamz.com` (first on `wp.atqamz.com`, which still serves the same Worker during a 30-day soak, see the [rename plan](rename-nestora.md)). Sections say what is built and what is still plan (the service worker, the on-phone test M9). **Updated on 7 October 2026:** the Worker also serves private design pages from a KV namespace ([§5.3](#53-worker-structure-and-dev-auth)); the app shell is public and Access protects only `/api/*` and `/design/*`, while the app shows its own sign-in screen ([§6](#6-auth)); and the UI was rebuilt in three stages (pull requests 13 to 16, [§5.6](#56-data-and-state-layer)). **Revised on 6 October 2026:** the frontend is now a React + TypeScript + Vite single-page app served by the same Worker, replacing the earlier plan of plain HTML, CSS and JS with no build step. React is a working choice that may be revised, so the design keeps the UI layer replaceable ([brainstorm §6.1](brainstorm.md#61-principles-and-layers)). What this revision supersedes is listed in [§9.3](#93-what-this-revision-supersedes) (this document) and [§9.4](#94-parts-of-docsbrainstormmd-that-are-superseded) (`docs/brainstorm.md`, updated in the same pass).

> **Privacy.** This repo is public. No real emails or first names here: the two users are **Partner A** and **Partner B**, and addresses are written as `<email-partner-a>` and `<email-partner-b>`. Findings from private repos are written generically ("other org's repo", "office repo"), with no code, hostnames, IDs, secret names or people's names. The `atqamz/github` repo is public, so it can be quoted.
>
> **Label.** **unverified** = I can't prove it from the repo, docs or public DNS. **verified locally** = I built or ran it in a throwaway scratch project on 6 October 2026 (Node v26.10.0, wrangler 4.147.0, Vite 8.3.2); that shows how the tools behave, not how browsers or the Cloudflare edge behave. **built** = present on `main` and checked by reading the code and running `npm run check` on a clean checkout on 6 October 2026 (62 packages, Node v26.10.0). What pull requests 12 to 16 added (7 October 2026) is labelled **built** after reading `main` at commit `e9a3e39`; `npm run check` was not run again for it. The author of the research had no Cloudflare, Google or GitHub write credentials; the supervisor ran the Cloudflare and GitHub steps ([bootstrap](bootstrap.md)). All versions and dates were checked on 6 October 2026 through npm, the GitHub API, the Go proxy and the linked docs pages; the version of each npm package is linked in [§5.4](#54-each-dependency-and-why) or [§5.7](#57-pwa-and-service-worker).

## Decision table

| # | Area | Choice | One-line reason |
|---|---|---|---|
| 1 | Cloudflare account | The account that holds the `atqamz.com` zone, with its own Zero Trust org. **Checked (M1):** the account has one member and no other organisation shares it | Custom Domain needs an active zone in the same account |
| 2 | IaC for Worker, D1, domain | `wrangler.jsonc` only, deployed from CI | wrangler already declares everything; any other IaC still needs wrangler for code, assets and migrations |
| 3 | IaC for Access | One-time manual setup: the Google OAuth client (console only) and the Access application and policy, created once through the Cloudflare CLI or API with the calls in [bootstrap M6](bootstrap.md#m6-create-the-access-app-and-note-the-aud), and the Google identity provider created from the console-made client ([bootstrap](bootstrap.md#adding-the-google-sign-in)). No script in the repo (`scripts/access.sh` was not written) | Only 3 objects; a state backend is heavier than the work |
| 4 | Pulumi, OpenTofu, Alchemy | Not yet. If later: Pulumi Go, in a separate repo | Consistent with `atqamz/github`; trigger is in §3.4 |
| 5 | Effect | **No** (later only with the trigger in §4) | Two users and ±3 endpoints; Alchemy v2 forces Effect, so choosing it means choosing both |
| 6 | Language | TypeScript for the Worker, the SPA and the shared code, checked by `tsc -b` | One language end to end; Partner B already works in TypeScript |
| 7 | Frontend | React 19 SPA built by Vite 8, served by the same Worker through `@cloudflare/vite-plugin`, `assets.not_found_handling = "single-page-application"` | The operator's choice; the plugin builds the Worker and the assets in one `vite build` and generates the deploy config (§5.2) |
| 8 | Router | No library: hash routing, 8 lines in `src/router.ts`; the table of route words and screens is `src/ui/routes.ts` | A handful of screens; plain `<a href="#/...">` links need no click handling (§5.6) |
| 9 | Data and state | `src/store/` (IndexedDB, outbox, the sync cycle) and `src/domain/` (pure functions), connected to React by `useSyncExternalStore`. No state library | The store is the offline source of truth; a server-state cache would be a second cache (§5.6) |
| 10 | Validation | Hand-written from the table specs and the `kind` registry (also the SQL whitelist), in `shared/` | One source of truth, zero dependencies, runs in the SPA and in the Worker |
| 11 | Sharing types | A `shared/` folder imported by relative path from `src/` and `worker/`; three `tsconfig` files | No package, no codegen (§5.5) |
| 12 | D1 access | `prepare().bind()` and `batch()`, no ORM | Small queries, already written in brainstorm §5.3 |
| 13 | Migrations | SQL files + `wrangler d1 migrations apply`, run in CI before the build and deploy | Built into D1; a failed migration is rolled back automatically |
| 14 | Tests | `node --test` (TypeScript directly, newest Node) over `test/`: `shared/`, `src/domain/`, the store (in-memory persistence and a fake server), the Worker (against a SQLite stand-in for D1) and the migration; one integration test against `CLOUDFLARE_ENV=dev vite`; a few tests that read the CSS and the copy as text (tokens, layout, scrollbars, wording). No component tests | Zero test framework; `vitest` only when views gain logic (§5.1) |
| 15 | PWA and service worker | **Not built yet.** Plan: a hand-written service worker (about 25 lines) + a 20-line Vite plugin that stamps its precache list. Not `vite-plugin-pwa` | 0 extra packages instead of +329; trigger to switch in §5.7 |
| 16 | Auth | Access, a self-hosted app with the path destinations `/api/*` and `/design/*` (the app shell is public), allow policy for two emails; the Worker verifies the JWT with `jose`. **Google is the only identity provider**, with auto redirect on; One-time PIN is no longer offered ([bootstrap](bootstrap.md#adding-the-google-sign-in)); each change is a change of the app's identity providers only | What you asked for, and zero login code |
| 17 | The two emails | Local password store (source), Worker secret, and the Access policy. Not in the repo, not in GitHub secrets, **not in D1** (the Worker turns the verified email into `a` or `b`) | Fewer copies, smaller chance of a leak |
| 18 | CI/CD | GitHub Actions calls `npx` for `vite` and `wrangler` directly; not Workers Builds | One CI system for checks + migrations + build + deploy; Workers Builds only accepts user-owned tokens |
| 19 | Environment | A single `production`, no preview. Staging later if there's a trigger | Preview URLs are public by default and share D1 unless separated |
| 20 | Repo settings | A row for this repository in `repos.go` of `atqamz/github` (**done**, §7.5); CI secrets stay `gh secret set` | That repo's own rule: settings there, workflow and dependabot in each repo |
| 21 | Dependencies | 5 runtime (`react`, `react-dom`, `jose` and the two fontsource variable font packages) + 8 dev (`vite`, `@vitejs/plugin-react`, `@cloudflare/vite-plugin`, `wrangler`, `typescript`, `@types/react`, `@types/react-dom`, `@types/node`) | Each one is justified in §5.4 |

---

## 1. Findings from three repos

Read read-only from clones in the scratchpad (already deleted). The contents of private repos are summarised as patterns.

### 1.1 `atqamz/github` (public, your personal IaC repo)

Sources: [README](https://github.com/atqamz/github), `AGENTS.md`, `main.go`, `repos.go`, `go.mod` in that repo (read on 6 October 2026).

| Aspect | Finding |
|---|---|
| Tool | Pulumi + Go (`go 1.26`, `pulumi-github` SDK v6.14.1, `pulumi` SDK v3.255.0). The project is named `github-config`, not `github`, so config keys don't clash with the provider namespace |
| State backend | Pulumi Cloud (mentioned in the README), one `prod` stack |
| Secrets | No secrets in the repo. `GITHUB_TOKEN` is taken from `gh auth token` at run time |
| CI | No workflow of its own (only the built-in Dependabot). You run `pulumi up` manually; `AGENTS.md` forbids running it unattended |
| Environment | One `prod` stack |
| DNS and zones | Doesn't touch Cloudflare at all |
| Access | None |
| Conventions | One `repos` table in `repos.go`, a uniform baseline in `main.go`, `Protect(true)` on every repo, an `adopt` flag to import existing repos, Nix devshell + direnv + treefmt, `AGENTS.md` with "don't fix this without reading the reason" rules. Things deliberately **not** managed (required status checks, required signatures, labels, secret scanning, interaction limits) are documented along with the reasons |

### 1.2 Other org's repo (private, GitOps for one server)

| Aspect | Finding |
|---|---|
| Tool | OpenTofu 1.11.x (pinned through `mise`) + Cloudflare provider `~> 5.17`. Cloudflare scope is **only DNS records in one zone** (six records, one of them a DNS-only wildcard). Pages, R2 and email records are marked "managed in the dashboard, not here" in code comments. The server is managed by Ansible, out of scope |
| State backend | A SOPS-encrypted state file **committed to git**. CI decrypts, applies, re-encrypts, then pushes to the main branch with `[skip ci]`. No native locking; an ADR sets a trigger for moving to an S3-compatible backend (R2) with `use_lockfile` |
| Secrets | SOPS + GPG with several recipients. The Cloudflare token and zone ID are in encrypted tfvars. CI imports the GPG private key from an Actions secret |
| CI | One workflow: plan on PR, apply on push to the main branch, a `concurrency` group without cancel. Actions pinned to commit SHAs, weekly Dependabot for Actions. Tied to one GitHub Environment |
| Environment | One state, one environment |
| DNS and zones | The zone ID is a single variable; this repo is the sole writer of the records it declares |
| Access | Not in this repo |
| Conventions | An ADR per decision, `mise`, pre-commit hooks. An explicit rule for workloads delegated to another repo: **don't make two repos writers of one host resource** |

### 1.3 Office repo (private, broader IaC)

| Aspect | Finding |
|---|---|
| Tool | Pulumi **TypeScript** (`@pulumi/cloudflare` 6.21.0, Pulumi CLI 3.267 through `mise`, Node 22). Moved from OpenTofu in mid-2026 through an ADR. One project, one `prod` stack, flat modules per concern |
| Cloudflare scope | Zone settings, DNS, redirect rules, Access (app, reusable policy, service token), Pages, R2, KV, D1 **creation**, account API tokens (an inventory with minimum scope per token), and the Worker's **route + workers.dev subdomain**. The Worker script itself is **not** in the IaC |
| State backend | A DIY S3-compatible backend in an R2 bucket (`region=auto`), `passphrase` secrets provider (only values marked secret are encrypted), state credentials kept separate from the admin token and only allowed to read/write objects. Locking is best-effort, so the `concurrency` group in CI is what guarantees serialisation |
| Secrets | SOPS + age (one shared key; GPG before). One encrypted env file holding the provider token, passphrase and state credentials; run through `sops exec-env ... pulumi ...`. The stack config holds no secrets |
| CI | Push to the main branch for `pulumi/**` runs `up`. PR gates: typecheck, lint, Trivy scan, `preview` + policy pack (CrossGuard). A daily `preview --refresh` job opens an issue if there's drift. Written rule: **all IaC runs in CI, never on a laptop** |
| DNS and zones | IaC is the sole writer for one zone; zone ID in the stack config, account ID derived from the zone lookup |
| Access | App and policy are code. **The Google Workspace IdP is created manually in the dashboard, then looked up by type** (the IaC doesn't create the IdP). `email domain` policy, 24-hour session. One JWT audience per app, and the Worker verifies the JWT itself again. The Access org (team domain, login page) isn't in code. The repo notes a limit of 5 hostnames per app (I haven't verified that in the docs) |
| Conventions | **Import-first** for live objects (forgetting to import once produced a duplicate policy). **IaC holds the edge binding, the app repo holds the code**: the Worker script is deployed from the app repo through `wrangler` in GitHub Actions with an account-owned token; putting the script in two places once overwrote a live revision. Workers Builds is avoided because it only accepts user-owned tokens (matches the [Cloudflare docs](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#api-token), page updated 22 September 2026). Release Please, no branch protection |

### 1.4 Patterns I reuse for wp

1. **One writer per resource.** If wrangler holds the `wp` script, no other IaC may declare it.
2. **Code is deployed by the app through wrangler from GitHub Actions**, not from IaC.
3. **Account-owned tokens with minimum scope**, clearly named and split per task.
4. **One `concurrency` group** for deploys.
5. **Actions pinned to SHAs** with Dependabot bumping them.
6. **No secrets in the stack config or repo**; values arrive at run time.
7. **Things deliberately not managed are written down with the reason**, like the `atqamz/github` README.

---

## 2. Collision analysis

### 2.1 Who manages what

| Resource class | Other org's repo | Office repo | What Nestora needs |
|---|---|---|---|
| Account | None | Account tokens, Pages, R2, KV, D1 creation | One token of its own, one Worker, one D1 |
| Zone | One zone, DNS records only | One zone: settings, DNS, redirect rules, routes | Only the `atqamz.com` zone |
| DNS records | Six explicit records including one wildcard | Many, one zone | One record, created automatically by Custom Domain |
| Access org | Not managed | App/policy/token in code; **org, team domain, IdP created manually** | One Google IdP and one app |
| Workers | None | Only routes and subdomain; script from the app repo | The `wp` script deployed by wrangler |
| D1 / KV | None | Created by IaC, schema in the app repo | D1 `wp` created once through `wrangler d1 create`; one KV namespace `nestora-design` for the private design pages ([§5.3](#53-worker-structure-and-dev-auth)) |

### 2.2 Is the `atqamz.com` zone in their state?

**According to the configuration: no.** Reasons:

- Searching for `atqamz.com` in both private repos found nothing.
- Both programs use **one** zone ID as a variable/config and don't enumerate zones in the account.
- No DNS or Access resource is parameterised per zone beyond that.

**What I can't verify:**

- The other org's repo state is SOPS-encrypted and I didn't decrypt it (and don't have the key).
- The office repo's state is in an R2 bucket I can't access.
- The zone ID value is in encrypted tfvars, so it can't be compared with the `atqamz.com` zone ID without the Cloudflare API.

### 2.3 Is it one Cloudflare account?

Evidence from public DNS (DoH `cloudflare-dns.com`, 6 October 2026): the `atqamz.com` zone uses `chloe.ns.cloudflare.com` and `ray.ns.cloudflare.com`. The zone from the other org's repo and the zone from the office repo each use a different pair, and all three pairs differ from each other.

Cloudflare writes that the default assignment method will "favor consistent nameserver names across all zones within an account", but also "in case there are conflicts, you may get different nameserver names, even for domains that are within the same account" ([docs](https://developers.cloudflare.com/dns/zone-setups/reference/nameserver-assignment/), checked 6 October 2026). So three different pairs **point to** three accounts, but are **not proof**.

**Answered (M1, 6 October 2026):** `atqamz.com` is active on the Free plan in an account with one member; no other organisation shares it, so scenario A below applies and scenario B does not. The check was: open the Cloudflare dashboard, look at the account list at the top left, and see which account `atqamz.com` is in. If that account also holds another org's zones or Workers, scenario B below applies. The full procedure, with four independent checks, is [M1 in the bootstrap runbook](bootstrap.md#m1-find-the-cloudflare-account).

### 2.4 What can go wrong

| # | Risk | Mechanism | Mitigation |
|---|---|---|---|
| 1 | Two writers for one object | If a Nestora resource (route, Access app) is someday imported into another IaC, their `apply` can overwrite or delete it. The office repo records one incident: a script declared in two places overwrote each other | All Nestora objects carry the prefix `wp` (Worker, D1, tokens) or `nestora` (Access app, KV title). Never imported into another repo. The "one writer" rule is written in this repo |
| 2 | Token swept | An account API token is visible to account admins, and the office repo keeps a token inventory in IaC. A token that isn't listed risks being revoked in a sweep | Token names are prefixed `wp-`. Scoped to one account and one zone. On a shared account, tell the inventory owner |
| 3 | Access org is a per-account singleton | The team domain, login page, IdP list, global session duration and the "Protect all Workers" application apply across the whole account. If `all_workers` is on, the Nestora Worker gets that policy too ([docs](https://developers.cloudflare.com/workers/configuration/cloudflare-access/), 18 August 2026) | Check the **Protect all Workers** card in Workers & Pages before deploying. Never turn it on from wp |
| 4 | A new IdP shows up in another app | Adding an IdP to a shared org can add login options to apps that don't pin an IdP. The default behaviour of an app without `allowed_idps` is **unverified** | Only relevant in scenario B. Pin `allowed_idps` in the Nestora app and ask the other org's owner to pin too |
| 5 | Shared quota | See §2.5 | Watch the usage dashboard |
| 6 | Wrong account | Member of several accounts: `wrangler login` gives access to any account, and the `account_id` config says "You might have more than one account" ([docs](https://developers.cloudflare.com/workers/wrangler/configuration/), 5 October 2026) | Always set `CLOUDFLARE_ACCOUNT_ID`, and create a token limited to one account as the [CI docs](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) recommend |
| 7 | Account plan changed by someone else | Free vs Paid limits change without Nestora doing anything | **unverified**: which account plan is used |
| 8 | Unknown records deleted | State-based IaC only changes objects in its own state ([OpenTofu state](https://opentofu.org/docs/language/state/)). The two Cloudflare repos I read have no mass-deletion loop | A real risk only if `atqamz.com` was ever put into that state; the current configuration doesn't do that |
| 9 | Certificate obstacle | Custom Domain creates a certificate automatically. The `atqamz.com` apex has no CAA, MX or TXT (DoH 6 October 2026), so nothing blocks it | No action needed |

### 2.5 Quotas shared per account

| Resource | Free limit | Source |
|---|---|---|
| Workers requests | 100,000/day **per account**, reset 00:00 UTC; error 1027 when it runs out | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) (5 September 2026) |
| Workers per account | 100; Cron Triggers 5 per account | same |
| Static assets | Requests to assets are free and unlimited; `run_worker_first` paths get 429 when the quota runs out | [Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) (23 April 2026) |
| D1 | 10 databases per account, 5 GB total, 500 MB per database, Time Travel 7 days | [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) (21 April 2026) |
| D1 daily | 5 million rows read and 100,000 rows written per day | [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) (21 April 2026) |
| Workers Builds | 3,000 minutes/month, 1 concurrent build **across an account** | [Builds limits](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/) (29 May 2026) |
| Zero Trust Free | A seat is consumed by every user who performs an authentication event; Free "for up to 50 users" | [Seat management](https://developers.cloudflare.com/cloudflare-one/team-and-resources/users/seat-management/) (1 May 2026), [reference architecture](https://developers.cloudflare.com/reference-architecture/architectures/sase/) |

Nestora usage: ±200 requests/day, 1 database, 2 seats. **Unverified:** how much the other org's Worker already uses in the same account, and whether that account is on the Free plan.

### 2.6 Boundary recommendation

**Scenario A (separate accounts): this is the case (answered in M1).** Everything below applies, with no extra caution.

**Scenario B (same account as another org):** add the "Protect all Workers" card check, pin `allowed_idps`, and send one message to the account owner about the `wp-*` tokens. Or move Nestora to a new personal account (a free Cloudflare account), but Custom Domain needs the `atqamz.com` zone in that account too, and how to move a zone between accounts is **unverified**.

| Owned by Nestora | Stays owned by others / don't touch |
|---|---|
| Worker `wp` (script, versions, secrets, assets) | All other Workers and their routes |
| D1 `wp` and its contents | Other databases |
| KV namespace `nestora-design` and its keys | Other namespaces |
| Custom Domains `nestora.atqamz.com` and, during the soak, `wp.atqamz.com` (one DNS record + one certificate each) | Other records in `atqamz.com`, zone settings, zone-wide rules |
| One Access app `nestora` (path destinations `/api/*` and `/design/*`, inline policy) | Other Access applications, reusable policies, the `all_workers` application |
| One Google IdP (the only account-level object; **live**) | The Access org (team domain, login page, global duration), other IdPs |
| Token `wp-ci` (deploy; `wp-access-setup` was not needed, §7.3) | Other tokens and their inventory |

**Smallest footprint:** Worker, D1, one KV namespace, Custom Domain, Access app, IdP, two tokens. The policy is created **inline** in the app (not reusable), so Nestora doesn't add an account-level policy object: the API says "Reusable and inline policies are mutually exclusive" ([API reference](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/methods/create/)).

---

## 3. IaC comparison

### 3.1 Versions (checked 6 October 2026)

| Tool | Version | Date | Source |
|---|---|---|---|
| wrangler | 4.147.0 | 2 October 2026 | [npm](https://www.npmjs.com/package/wrangler) |
| Alchemy | 2.0.0-beta.81 (npm `latest` tag is still beta); previous line 0.94.0 | 5 October 2026; 1 August 2026 | [npm](https://www.npmjs.com/package/alchemy), [repo](https://github.com/alchemy-run/alchemy) |
| Effect | 4.0.1 (4.0.0 released 1 October 2026) | 4 October 2026 | [npm](https://www.npmjs.com/package/effect) |
| Pulumi CLI | 3.267.0 | 1 October 2026 | [releases](https://github.com/pulumi/pulumi/releases) |
| Pulumi Cloudflare (Go and TS) | v6.21.0 | 18 September 2026 | [Go proxy](https://proxy.golang.org/github.com/pulumi/pulumi-cloudflare/sdk/v6/@latest), [npm](https://www.npmjs.com/package/@pulumi/cloudflare) |
| Terraform Cloudflare provider | 5.27.0 | 3 October 2026 | [releases](https://github.com/cloudflare/terraform-provider-cloudflare/releases) |
| OpenTofu | 1.13.1 | 1 October 2026 | [releases](https://github.com/opentofu/opentofu/releases) |
| Terraform | 1.16.5 | 2 October 2026 | [releases](https://github.com/hashicorp/terraform/releases) |
| `cloudflare/wrangler-action` | v4.1.3 | 24 September 2026 | [releases](https://github.com/cloudflare/wrangler-action/releases) |

Alchemy v2 started its beta on 13 April 2026 and has had 81 beta releases in ±25 weeks (npm version history). The `latest` tag points to a beta.

### 3.2 What has to be done whatever the tool

The scope: one Worker with static assets, one D1, one Custom Domain, one Access app, one IdP.

- **Worker code and assets have to go through wrangler or the upload API.** The `WorkersScript` resource in Pulumi has an `assets.jwt` field (a token from an upload session), not a directory ([Pulumi docs](https://www.pulumi.com/registry/packages/cloudflare/api-docs/workersscript/)); I infer the provider doesn't upload the folder itself (an inference from the schema, unverified). The office repo even moved the script out of IaC after two copies overwrote each other.
- **D1 migrations are not a provider resource.** The Terraform provider only has `d1_database` ([resource list](https://github.com/cloudflare/terraform-provider-cloudflare/tree/main/docs/resources)). Migrations stay `wrangler d1 migrations apply`.
- **What's left for IaC: Access (3 objects)** and, if wanted, Custom Domain.

### 3.3 Comparison table

| Criterion | Alchemy v2 | Pulumi (Go / TS) | OpenTofu / Terraform | wrangler + one script |
|---|---|---|---|---|
| Simplicity (line counts are my estimates) | An Effect program, `alchemy.run.ts`, rolldown bundler; needs `effect@^4` as a peer dep | Program + CLI + state account + provider; ±100 lines of Go for 3 objects | HCL ±40 lines + state backend + provider | One config file + ±50 lines of bash |
| Free plan fit | Uses D1 and Worker, but the default state store adds a Worker with a Durable Object and Secrets Store to the account | Pulumi Cloud Free: 1 user, unlimited projects and stacks ([pricing](https://www.pulumi.com/pricing/)) | Free; state in R2 needs an R2 subscription through checkout ([R2 get-started](https://developers.cloudflare.com/r2/get-started/)) | No extra cost |
| State storage | Local `.alchemy/` (gitignored) or `Cloudflare.state()`: a Worker + DO SQLite + Secrets Store in your account, reused by all stacks ([docs](https://alchemy.run/state-store/)). The Secrets Store status on Free is **unverified** (its docs say "open beta") | Pulumi Cloud (like `atqamz/github`) or a DIY backend | Local backend, encrypted git, or S3-compatible in R2 with `use_lockfile` ([docs](https://opentofu.org/docs/language/settings/backends/s3/)) | None. State = Cloudflare itself |
| Secrets | A separate secret provider, state key in Secrets Store | `pulumi config set --secret`; the value goes into state | `TF_VAR_*`; sensitive values go into state, so you need [state encryption](https://opentofu.org/docs/language/state/encryption/) (PBKDF2) | Worker secrets + local password store; no state holds secrets |
| Consistency with your repos | None | **Go** same as `atqamz/github`; **TS** same as the office repo | Same as the other org's repo | wrangler same as how the Worker in the office repo is deployed |
| Maturity | Beta, 81 releases in ±25 weeks | Provider v6.21.0; the office repo records import friction (a pre-check rejects hand-written programs, some R2 resources can't be imported) | The v5 provider has 223 open issues and PRs ([repo](https://github.com/cloudflare/terraform-provider-cloudflare), API count 6 October 2026) | wrangler 4.147.0, very frequent releases |
| Access with Google IdP | Yes: `Access/IdentityProvider` (type `google`), `Application`, `Policy` ([code](https://github.com/alchemy-run/alchemy/tree/main/packages/alchemy/src/Cloudflare/Access), commit 5 October 2026) | `ZeroTrustAccessIdentityProvider`, `ZeroTrustAccessApplication` ([docs](https://www.pulumi.com/registry/packages/cloudflare/api-docs/zerotrustaccessapplication/)) | `cloudflare_zero_trust_access_identity_provider`, `..._application` ([docs](https://github.com/cloudflare/terraform-provider-cloudflare/tree/main/docs/resources)) | Direct API; the fields `allowed_idps`, `client_id`, `client_secret`, `session_duration` are in the API reference |
| D1 migrations | `D1.ApplyMigrations` ([code](https://github.com/alchemy-run/alchemy/tree/main/packages/alchemy/src/Cloudflare/D1)) | None, use wrangler | None, use wrangler | Native |
| Preview environment | A stage per PR (`staging-{number}`), destroyed when the PR closes through the [built-in GitHub Action](https://alchemy.run/environments/ci/) | A stack per PR, manual wiring | A workspace per PR, manual wiring | `wrangler preview` (wrangler ≥ 4.135, `previews` block) or `env.<name>`; D1 is isolated only if bound to a separate database ([Previews](https://developers.cloudflare.com/workers/previews/), 24 September 2026) |
| Collision risk in a shared account | Adds a state-store Worker to the account | Safe if token scope and name prefix are kept | Safe if `zero_trust_organization` is never used | Smallest: no inventory that could delete the wrong thing |

### 3.4 Honest recommendation

**wrangler alone is enough for the Worker, assets, D1, migrations, Custom Domain and secrets.** Access is set once and hardly ever changes; one script is enough there.

Reasons:

1. Once code, assets and migrations are in wrangler, IaC would only hold 3 Access objects. That isn't worth a state backend, extra tokens and a program to maintain.
2. No state, so no state that can clash with another org's IaC.
3. `secrets.required` in wrangler makes the deploy fail if a secret isn't set yet ([docs](https://developers.cloudflare.com/workers/wrangler/configuration/#secrets-configuration-property)).

**The Access script (`scripts/access.sh`)** was the part you could skip, and it was skipped: it was not written. The Access application was created once through the Cloudflare CLI with the calls in [bootstrap M6](bootstrap.md#m6-create-the-access-app-and-note-the-aud), which also serve as the runnable checklist, with the two emails coming from the environment, not typed into a file; since pull request 15 (7 October 2026) the application has the two path destinations instead of the whole host. Nothing about Access is part of CI, except that the smoke test of [§7.2](#72-workflow) checks that the two protected paths still answer with a login redirect, a 401 or a 403.

**Why not the others now:**

- **Alchemy v2:** beta, forces Effect (§4), and the default state store adds a Worker and Secrets Store to an account that may be shared. Its features are complete (Access, D1 migrations, stage per PR), so it's worth another look once it's stable.
- **OpenTofu/Terraform:** consistent with the other org's repo, not with yours; state needs R2 (a card) or an encrypted file in git; the end result still needs wrangler for code.
- **Pulumi now:** consistent with your Go, but a program, CI and state for 3 objects is heavier than one script.

**Triggers to move to Pulumi Go** (if any one happens):

1. Nestora needs a third Cloudflare resource type besides Worker, D1 and Access (e.g. R2, a queue, a second hostname, or a permanent staging environment).
2. You want Cloudflare settings reviewed through diffs like GitHub settings.
3. A second person needs to change the Access policy without the dashboard.

If that happens: a **separate repo** (e.g. `atqamz/cloudflare`, same shape as `atqamz/github`: one table, `Protect(true)`, an `adopt` flag), not inside Nestora, because account-level objects (IdP, tokens, Access org) span projects. The split "IaC holds the edge and account, the app repo holds the code through wrangler" is exactly the office repo's pattern.

---

## 4. Effect: is it needed for a two-user app?

**Answer: no.** Later only with the triggers below.

Assessment:

- **What Effect solves:** errors as types, composable retry/timeout, resource scopes and structured concurrency. That's useful for complex async orchestration, not for a Worker with three endpoints and one D1 `batch()`.
- **Learning cost:** `Effect.gen` generators, `Layer`, tagged errors and the runtime model. Partner B also has to be able to read the code. The SPA and the Worker now share TypeScript ([§5.5](#55-sharing-types-and-code-between-the-worker-and-the-spa)), so Effect could technically be shared, but nothing in the app needs it.
- **Maturity:** stable 4.0.0 only came out on 1 October 2026 and 4.0.1 on 4 October 2026 ([npm](https://www.npmjs.com/package/effect)); the docs site still shows v3 docs by default with a version picker to v4 ([effect.website](https://effect.website/docs/getting-started/introduction/)), so the docs and ecosystem are still shifting.
- **Coupling with IaC:** Alchemy v2 is built on Effect (`effect@^4` peer dependency, the README says "Infrastructure-as-Effects"), so choosing Alchemy means choosing Effect. By choosing wrangler, the two come apart.

**"Later" triggers:**

1. The Worker gets real async orchestration: retry with backoff to third-party APIs, Workflows or Queues with partial failure.
2. You decide on Alchemy for other reasons and are ready to accept Effect.
3. You want to learn Effect for its own sake: do it in an experiment repo, not in Nestora.

---

## 5. Application stack

### 5.1 Decisions

| Aspect | Choice | Notes |
|---|---|---|
| Language | TypeScript everywhere (Worker, SPA, shared code) | wrangler and Vite bundle TS with no extra config; TS is [first-class on Workers](https://developers.cloudflare.com/workers/languages/typescript/) (3 July 2026). `typescript` 7.0.2, `tsc -b` ([§5.5](#55-sharing-types-and-code-between-the-worker-and-the-spa)) |
| Frontend | React 19.3.0 + Vite 8.3.3 + `@vitejs/plugin-react` 6.1.2 | The operator's choice, and it is the layout of Cloudflare's own [React guide](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/) (5 September 2026). Details in [§5.2](#52-frontend-build-a-vite-react-spa-on-the-worker) |
| Serving | One Worker: static assets from `dist/client` + `/api/*` + `/design/*` | `@cloudflare/vite-plugin` (version in [§5.4](#54-each-dependency-and-why)); `assets.not_found_handling = "single-page-application"`, `assets.run_worker_first = ["/api/*", "/design/*"]` |
| Worker structure | One `fetch` handler with a `switch` on the path and the method, four files (`worker/index.ts`, `worker/auth.ts`, `worker/sync.ts`, `worker/export.ts`); `/design/<name>/` is read from KV in `worker/index.ts` | See [§5.3](#53-worker-structure-and-dev-auth) |
| Router | No library; hash routing (`#/money`, `#/people`) with an 8-line `useSyncExternalStore` hook in `src/router.ts` and the table of route words and screens in `src/ui/routes.ts` (seven screens, ten route words: the old `#/budget` still opens Money, and `#/guests` and `#/vendors` open the two lists of People) | Hash links are plain `<a>` tags, so no click interception and no history code; the service worker (not built yet) will see navigations to `/` and to `/design/<name>/`, and has to leave the second to the network ([§5.7](#57-pwa-and-service-worker)). Trigger for [`wouter`](https://www.npmjs.com/package/wouter) (3.13.0, 30 September 2026; peer `react >=16.8`, ships a hash-location hook in its package, `wouter/use-hash-location`; depends on `regexparam` and `use-sync-external-store`): path URLs are wanted (shareable deep links) or more than about 8 routes. Not `react-router` (8.4.0, 15 September 2026): a framework-sized API for a handful of screens |
| Data and state | `src/store/` + `src/domain/`, bridged by `useSyncExternalStore` | See [§5.6](#56-data-and-state-layer). No TanStack Query, Redux or Zustand |
| Validation | A hand-written function in `shared/validate.ts`, driven by the table specs and the `kind` registry in `shared/tables.ts`, which are also the SQL whitelist | Trigger: payload shape grows beyond a per-table patch → `valibot` ([1.5.0](https://www.npmjs.com/package/valibot), 9 September 2026) or `zod` ([4.6.5](https://www.npmjs.com/package/zod), 13 September 2026) |
| D1 access | `env.DB.prepare(sql).bind(...)` and `env.DB.batch([...])`; SQL only from the whitelist | Trigger: many dynamic queries → Kysely (0.29.6). Drizzle is supported by wrangler through `migrations_pattern` ([docs](https://developers.cloudflare.com/d1/reference/migrations/)) but adds a toolchain |
| Migrations | `migrations/NNNN_*.sql`, `wrangler d1 migrations apply wp --remote` in CI | Use the database name, not the binding name, so it doesn't hit the wrong target ([docs](https://developers.cloudflare.com/d1/reference/migrations/), 8 June 2026). In CI the confirmation is skipped, a backup is still taken, and a failed migration is rolled back ([docs](https://developers.cloudflare.com/workers/wrangler/commands/d1/)). `0001_init.sql` creates `sync_state`, `settings`, `items` and `budget_entries` (SQL in `docs/brainstorm.md` §7.2, identical to the file); it is applied to the production database, which was wiped and migrated again once on day one after the file was rewritten in place (Project removed, `sync_state.epoch` added), and `test/migration.test.ts` runs it in SQLite and checks the tables, the revision counter, the random `epoch`, the foreign keys, the `updated_by` check and the two shapes of `budget_entries`. D1 rejects `GLOB` patterns over 50 bytes ([limits](https://developers.cloudflare.com/d1/platform/limits/), 21 April 2026), which is why the instant checks in that SQL are short. Adding a kind of list later needs no migration; adding a column to `items` does The generated deploy config keeps `migrations_dir` pointing at the source folder (verified locally: `../../migrations` in `dist/wp/wrangler.json`; also in the [plugin changelog](https://newreleases.io/project/github/cloudflare/workers-sdk/release/@cloudflare%2Fvite-plugin@1.42.4), PR 14490) |
| Tests | `node --test` (the `test` script, no path argument) over `test/`: `shared/`, `src/domain/`, the store, the Worker's auth, sync and export, and the migration. The Worker tests run against a `node:sqlite` stand-in for D1 (`test/sync-db.ts`) that rejects more than 100 bound parameters. One integration test (`test/sync-integration.test.ts`) applies the migrations to a local D1, starts `CLOUDFLARE_ENV=dev vite` and calls the API; it is part of `npm test`. Browser checks (not part of `npm test`, not a dependency in `package.json`) run Playwright through `npx --yes playwright@latest` | Node runs `.ts` directly: type stripping is stable since v24.12.0 and is on in every newer line, needs `.ts` extensions in imports and `import type`, and doesn't run `.tsx` ([Node docs](https://nodejs.org/docs/latest/api/typescript.html)), so `domain/` and `shared/` contain no JSX. **verified locally:** a `node --test` file importing `src/domain/*.ts`, which imports a type from `shared/*.ts`, passes. No component tests; trigger for `vitest` ([5.0.3](https://www.npmjs.com/package/vitest), 30 September 2026) + Testing Library: views gain logic that isn't in `domain/`. `@cloudflare/vitest-plugin` ([1.3.6](https://www.npmjs.com/package/@cloudflare/vitest-plugin), 2 October 2026) peers `vitest ^4.1.0`, so vitest would have to be pinned to 4.x; it is only worth it for per-test D1 isolation inside workerd |
| PWA | Hand-written service worker + a small Vite plugin | [§5.7](#57-pwa-and-service-worker) |
| Look | **Built.** Design tokens in `src/tokens.css` (the Ink and rose palette in OKLCH, light and dark, spacing, type scale); two self-hosted variable fonts from fontsource, Mona Sans for display and Hanken Grotesk for text, loaded by `@font-face` rules in the same file; per-device theme (Match this device, Light, Dark) kept in `localStorage` under `wp-theme` and applied before first paint by a small inline script in `index.html`; scrollbars are thin and tokenised, and hidden under `@media (pointer: coarse)` in `src/style.css`; every width condition is in `rem`; the shell is a header and a bottom bar on a phone and a sidebar from 62.5 rem (1000 px at the default text size) | `test/tokens.test.ts` computes contrast ratios from the OKLCH tokens, `test/scrollbars.test.ts` and `test/layout.test.ts` read the CSS as text. No CSS framework and no font host: the public shell makes no request to a third party. How the screens look in a browser is not part of `npm test` |
| Design pages | **Built.** `/design/<name>/` is served by the Worker from the KV namespace `nestora-design` (binding `DESIGN`), after the same Access JWT check as the API | Pages are uploaded by hand and never committed; see [§5.3](#53-worker-structure-and-dev-auth) |
| Local dev | `npm run dev` = `CLOUDFLARE_ENV=dev vite`: HMR for the SPA, the Worker runs in workerd, D1 is local. There is no seed script and nothing to seed (the app opens empty), and any seed added later must contain **fake data only** | Local D1 comes from `wrangler d1 migrations apply wp --local --env dev`, which `npm run dev` does not run: a fresh `.wrangler` needs it once, and `.wrangler` must be deleted and the migration applied again after any edit to `0001_init.sql` (it is rewritten in place); without it `/api/sync` returns 500 (README); **verified locally** that the Vite dev server reads that database. Dev auth is described in [§5.3](#53-worker-structure-and-dev-auth) |
| Worker types | `wrangler types` generates `worker-configuration.d.ts` (committed) | No need for `@cloudflare/workers-types`. **verified locally:** it includes the dev-only vars (`AUTH_MODE?`, `DEV_WHO?`) and lists the three secrets as optional `string`, so `authenticate` must treat them as possibly missing (fail closed) |

### 5.2 Frontend build: a Vite React SPA on the Worker

Sources: [Vite plugin overview](https://developers.cloudflare.com/workers/vite-plugin/) (30 September 2026), [React SPA with an API tutorial](https://developers.cloudflare.com/workers/vite-plugin/tutorial/) (5 September 2026), [static assets in the plugin](https://developers.cloudflare.com/workers/vite-plugin/reference/static-assets/) (18 August 2026), [SPA mode](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/) (25 August 2026). Requirements from npm: Vite 8.3.2 needs Node `^20.19.0 || >=22.12.0` ([npm](https://www.npmjs.com/package/vite), 1 October 2026); `@cloudflare/vite-plugin` 1.62.5 peers `vite ^6.1.0 || ^7.0.0 || ^8.0.0` and `wrangler ^4.147.0` ([npm](https://www.npmjs.com/package/@cloudflare/vite-plugin), 2 October 2026); `@vitejs/plugin-react` 6.1.2 peers `vite ^8.0.0` ([npm](https://www.npmjs.com/package/@vitejs/plugin-react), 5 October 2026).

`vite.config.ts` (built; the service worker plugin of [§5.7](#57-pwa-and-service-worker) is not in it yet):

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

const persist = process.env.WP_PERSIST_TO;

export default defineConfig({ plugins: [react(), cloudflare(persist ? { persistState: { path: persist } } : {})] });
```

When `WP_PERSIST_TO` is set, the dev server keeps the local D1 and KV state in that folder instead of `.wrangler` (read from the code; the plugin option is `persistState`, and its docs page was not re-read in this pass: unverified).

`wrangler.jsonc` (built; `assets.directory` is deliberately absent because the plugin fills it in, per the static-assets page above). The production `database_id` and the production KV namespace `id` appear at the top level only; `env.dev` keeps all-zero placeholders, because the local D1 and the local KV do not need the real ids and the dev build must never point at production:

```jsonc
{
  "name": "wp",
  "main": "worker/index.ts",
  "compatibility_date": "2026-10-06",
  "workers_dev": false,
  "preview_urls": false,
  "routes": [
    { "pattern": "wp.atqamz.com", "custom_domain": true },
    { "pattern": "nestora.atqamz.com", "custom_domain": true }
  ],
  "assets": { "not_found_handling": "single-page-application", "run_worker_first": ["/api/*", "/design/*"] },
  "d1_databases": [
    { "binding": "DB", "database_name": "wp", "database_id": "783df04a-8254-4586-b705-8d73d0d54ec6", "migrations_dir": "migrations" }
  ],
  "kv_namespaces": [{ "binding": "DESIGN", "id": "ca244314e31b4b03b76cde03ae99ad8b" }],
  "secrets": { "required": ["ACCESS_TEAM_DOMAIN", "ACCESS_AUD", "ALLOWED_EMAILS"] },
  "env": {
    "dev": {
      "routes": [],
      "d1_databases": [
        { "binding": "DB", "database_name": "wp", "database_id": "00000000-0000-0000-0000-000000000000", "migrations_dir": "migrations" }
      ],
      "kv_namespaces": [{ "binding": "DESIGN", "id": "00000000000000000000000000000000" }],
      "vars": { "AUTH_MODE": "dev", "DEV_WHO": "a" }
    }
  }
}
```

**Build output** (**built**: `npm run build` on a clean checkout of `main`, 6 October 2026):

```
dist/
  client/                 the static assets
    index.html
    manifest.webmanifest  copied as is from public/
    apple-touch-icon.png, icon-192.png, icon-512.png   copied as is from public/
    assets/index-<hash>.js, assets/index-<hash>.css, and the font files the CSS refers to
    .assetsignore
  wp/                     the Worker
    index.js
    .vite/manifest.json
    wrangler.json         generated: main = index.js, assets.directory = ../client,
                          migrations_dir = ../../migrations, no env.dev, empty vars
.wrangler/deploy/config.json   points at dist/wp/wrangler.json
```

There is no `sw.js` yet ([§5.7](#57-pwa-and-service-worker)). The font files in `assets/` come from reading the `@font-face` rules in `src/tokens.css`; the build was not run again after they were added (unverified). `wrangler deploy` follows `.wrangler/deploy/config.json` to `dist/wp/wrangler.json` and the static files in `dist/client` (it printed "Using redirected Wrangler configuration" in a dry run, and the CI deploy job works this way). The [plugin docs](https://developers.cloudflare.com/workers/vite-plugin/reference/static-assets/) say the same: "an output `wrangler.json` configuration file is generated as part of the build output". So the deploy steps are `npm run build` (which is `vite build`) and then `npx wrangler deploy`, not a bare `wrangler deploy`.

**Why `run_worker_first: ["/api/*", "/design/*"]` stays.** In SPA mode an unmatched navigation returns `index.html` with 200, and the docs warn: "if you navigate to `/api/date` in your browser, you will be served an HTML file" ([SPA mode](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)). `/api/login` is a navigation that must reach the Worker ([§6.5](#65-manifest-and-service-worker-with-a-public-shell-rechecking-the-caveats)), and so is `/design/<name>/`, which has to get the page from KV and not `index.html`. **verified locally** in `vite dev`: a request with `Sec-Fetch-Mode: navigate` to `/api/login` returned the Worker's response and one to `/budget/x` returned the HTML. Navigations are otherwise answered by the asset layer without invoking the Worker, because the `assets_navigation_prefers_asset_serving` flag is on by default from compatibility date 2025-04-01 ([flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/)); this one is covered by the 2026-10-06 date above. With hash routing ([§5.1](#51-decisions)) SPA mode is not needed to make deep links work; it is kept because the operator chose it, it makes stray paths return the app instead of a bare 404, and path routing needs it. The two paths in `run_worker_first` are also the two destinations of the Access application ([§6](#6-auth)); every other path, `/` included, is answered by the asset layer and is public. The live check of the CI smoke test ([§7.2](#72-workflow)) asks for `/` (200 HTML) and for `/api/health` and `/design/round2/` (protected).

`package.json` scripts (built):

```json
{
  "scripts": {
    "dev": "CLOUDFLARE_ENV=dev vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b",
    "test": "node --test",
    "check": "npm run typecheck && npm test && npm run build && test -s dist/wp/wrangler.json && ! grep -q AUTH_MODE dist/wp/wrangler.json && grep -q 'rel=\"manifest\"' dist/client/index.html && ! grep -q 'use-credentials' dist/client/index.html && test -d worker && test -d shared && (grep -rEq \"(from|import)[ (]*[\\\"']react\" worker shared src/domain src/store; test $? = 1) && (grep -rEq \"fetch *\\(|indexedDB|XMLHttpRequest|sendBeacon\" src/views src/ui src/hooks; test $? = 1)"
  }
}
```

`check` therefore runs the type check, the tests and the build, then guards the output: a non-empty production config without `AUTH_MODE`, a `rel="manifest"` link in the built `index.html` that does not contain `use-credentials` (the manifest is public, [§6.5](#65-manifest-and-service-worker-with-a-public-shell-rechecking-the-caveats)), and the layer rules of [brainstorm §6.1](brainstorm.md#61-principles-and-layers) (no React import in `worker/`, `shared/`, `src/domain/` and `src/store/`; no `fetch`, IndexedDB, XMLHttpRequest or `sendBeacon` in `src/views/`, `src/ui/` and `src/hooks/`). The two `test -d` guards make a grep over a missing folder fail instead of pass.

The `CLOUDFLARE_ENV=dev` prefix needs a POSIX shell (Windows is **unverified**; add `cross-env` only if Partner B needs it).

### 5.3 Worker structure and dev auth

The `fetch` flow:

1. Only `/api/*` and `/design/*` reach the Worker (`assets.run_worker_first: ["/api/*", "/design/*"]`); static files are served by the platform and free. A path outside both that reaches the Worker anyway gets a 404 JSON, before any authentication.
2. `authenticate(request, env)` returns `"a"`, `"b"` or `null`, never an email; `null` means a 401 JSON. The side is what the Worker writes to `updated_by` and returns to the client (`me`, brainstorm §3.3). Every `/api/*` and `/design/*` route, `/api/health` included, is behind it.
3. A path under `/design/` goes to the design handler below. Any other path is a `switch` on the path, then on the method (a wrong method is a 405 with an `allow` header): `GET /api/health` (`{ "ok": true }`), `GET /api/login` (302 to `/`, `cache-control: no-store`), `GET /api/export` (JSON dump, or one CSV per `kind` or `entry_type`, `worker/export.ts`), `GET /api/sync` and `POST /api/sync` (contract in brainstorm §3.3). An unknown `/api/` path is a 404.
4. `POST /api/sync` first passes the cross-origin check of [§6.4](#64-jwt-verification-in-the-worker), then the body is parsed and applied (`worker/sync.ts`, brainstorm §3.7).
5. Errors return generic JSON (`{ "error": "<code>" }`, or the `Rejection` shape for sync); an unhandled exception logs only its error name and returns 500. No stack traces or emails in responses or logs.

**Design pages** (**built**, pull request 12). `GET` or `HEAD` on `/design/<name>` or `/design/<name>/`, where `<name>` matches `^[a-z0-9][a-z0-9-]{0,39}$`, returns the text stored under the key `<name>` in the KV namespace `nestora-design`, as `text/html; charset=utf-8` with `cache-control: private, no-store`, `x-robots-tag: noindex, nofollow` and `x-content-type-options: nosniff`. Any other method is a 405 with `allow: GET, HEAD`; a name that does not match, a missing key or a deeper path is a 404 JSON. The authentication of step 2 runs first, so no valid JWT means no page, and the Access application protects the same path before the Worker is reached ([§6](#6-auth)). The namespace is bound as `DESIGN` in `wrangler.jsonc`: the namespace id is at the top level, `env.dev` keeps an all-zero placeholder. A page is one self-contained HTML document: the Worker sends the stored text unchanged, and a relative link to another file would be a deeper path, which is a 404. Pages are never committed to the repository. The supervisor uploads and removes them with the Cloudflare CLI; the wrangler commands for the same work are `wrangler kv key put` and `wrangler kv key delete` ([KV commands](https://developers.cloudflare.com/workers/wrangler/commands/kv/); this page was not fetched in this pass, so their exact flags are **unverified**). The steps are in [bootstrap, Design pages](bootstrap.md#design-pages). KV is eventually consistent: a change can take "up to 60 seconds or more" to show in other locations ([how KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/), quoted in brainstorm §3.2), so a 404 right after an upload does not prove the key is missing.

**Dev mode without Access.** The earlier plan used `wrangler dev --var AUTH_MODE:dev ...`; the Vite dev server doesn't take that flag, so the dev-only variables live in the `env.dev` block of `wrangler.jsonc` ([§5.2](#52-frontend-build-a-vite-react-spa-on-the-worker)) and `npm run dev` selects it with `CLOUDFLARE_ENV=dev`. The plugin applies `CLOUDFLARE_ENV` to `vite dev` and `vite build`, and "specifying `CLOUDFLARE_ENV` when running `vite preview` or `wrangler deploy` will have no effect" ([docs](https://developers.cloudflare.com/workers/vite-plugin/reference/cloudflare-environments/), 23 April 2026). Production fails closed because the production build never selects that environment: **verified locally**, `dist/wp/wrangler.json` from a plain `vite build` has empty `vars`, and from `CLOUDFLARE_ENV=dev vite build` it has `AUTH_MODE` and the worker name `wp-dev`. `npm run check` greps the production output for `AUTH_MODE` ([§5.2](#52-frontend-build-a-vite-react-spa-on-the-worker)). Details:

- Bindings are not inherited by an environment, so `env.dev` repeats the `d1_databases` entry; without it `env.DB` is `undefined` in dev (**verified locally**). The `kv_namespaces` entry is repeated the same way, with a placeholder id (**unverified**: not run for the KV binding). The repeated entry keeps the all-zero placeholder `database_id`: a local D1 does not need the real id (`test/sync-integration.test.ts` applies the migrations to it and runs the dev server), and the production id exists only at the top level. `"routes": []` stops wrangler warning that the environment inherits the custom domain.
- `.dev.vars` is not an alternative: with `secrets.required` defined, only the three registered keys are loaded from it (**verified locally**: `AUTH_MODE` set in `.dev.vars` was not visible to the Worker; the same rule is in the [secrets docs](https://developers.cloudflare.com/workers/configuration/secrets/)). `.dev.vars` is only needed to give the three secrets placeholder values when you run `vite preview` on the production build (**unverified**, not run); `.dev.vars.example` holds those placeholders. In dev mode `authenticate` accepts only `DEV_WHO` equal to `a` or `b`, and the committed value is `a`.
- `database_id` is a UUID, not a credential (useless without a token); that's my judgement, not a docs claim, and it is why the production id is committed in `wrangler.jsonc`. The KV namespace id is treated the same way, by the same judgement. `workers_dev` and `preview_urls` are turned off explicitly: `workers_dev` defaults to `false` when there are `routes`, and for `preview_urls` "If omitted, Wrangler does not change an existing setting" ([config docs](https://developers.cloudflare.com/workers/wrangler/configuration/)).

### 5.4 Each dependency and why

Versions and publish dates are from the npm registry on 6 October 2026. The versions in this table are a snapshot of 6 October 2026, and they matched `package.json` on `main` at that date; `package.json` and the lockfile are the source of truth, the policy is the latest version of everything, and daily Dependabot keeps them current, so they drift: on 7 October 2026 `package.json` has `@cloudflare/vite-plugin` 1.63.0 and `wrangler` 4.148.0, and the two rows below still show the earlier versions. `npm ci --ignore-scripts` of the lockfile of 6 October (all eleven packages that existed then, `jose` included) resolved to **62 packages and 301 MB** in `node_modules` (mostly `workerd` and `wrangler`), **built**. The two font packages were added after that measurement and it was not repeated (unverified).

| Package | Kind | Reason | Rejected alternatives |
|---|---|---|---|
| [`react`](https://www.npmjs.com/package/react) 19.3.0 (9 September 2026), [`react-dom`](https://www.npmjs.com/package/react-dom) 19.3.0 (9 September 2026) | runtime (browser) | The UI, the operator's choice. React supplies `useSyncExternalStore` itself, so no state library is needed | |
| [`@fontsource-variable/mona-sans`](https://www.npmjs.com/package/@fontsource-variable/mona-sans) 5.3.0, [`@fontsource-variable/hanken-grotesk`](https://www.npmjs.com/package/@fontsource-variable/hanken-grotesk) 5.3.0 (publish dates not checked) | runtime (`dependencies`, but only font files that the CSS bundles) | Self-hosted variable fonts for the display and text type, so the public shell asks no font host for anything. `src/tokens.css` points its `@font-face` rules at the packages' `latin` `.woff2` files. The lockfile lists both under OFL-1.1 (**verified locally**, read from `package-lock.json`) | A `<link>` to a font host (a third-party request on a public page); system fonts only (no chosen type) |
| [`jose`](https://www.npmjs.com/package/jose) 6.2.12 (5 September 2026) | runtime (Worker) | Access JWT verification: signature, `iss`, `aud`, `exp`, remote JWKS with caching and key rotation. A security path, don't write it yourself. The [Cloudflare docs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/) give a Workers example with `jose` | Manual WebCrypto (±40 lines, but key rotation and subtle mistakes become your burden); `hono/jwk` (pulls in Hono) |
| [`vite`](https://www.npmjs.com/package/vite) 8.3.3 (6 October 2026) | dev | Dev server with HMR and the production build, for both the SPA and the Worker | Bundling by hand: no |
| [`@cloudflare/vite-plugin`](https://www.npmjs.com/package/@cloudflare/vite-plugin) 1.62.5 (2 October 2026) | dev | Runs the Worker in workerd inside the Vite dev server, builds Worker and assets together, writes the deploy config ([§5.2](#52-frontend-build-a-vite-react-spa-on-the-worker)). Its npm dependencies include an alpha `miniflare` 5.x | Two toolchains (Vite for the SPA, plain `wrangler dev` for the Worker): two dev servers and no shared build |
| [`wrangler`](https://www.npmjs.com/package/wrangler) 4.147.0 (2 October 2026) | dev | Deploy, D1 and migrations, `wrangler types`; a peer dependency of the plugin | |
| [`@vitejs/plugin-react`](https://www.npmjs.com/package/@vitejs/plugin-react) 6.1.2 (5 October 2026) | dev | React Fast Refresh in dev. **verified locally** that `vite build` works without it (Vite compiles JSX itself); it is kept for the dev experience and because Cloudflare's React guide uses it. Drop it if you don't care about state-preserving reloads | |
| [`typescript`](https://www.npmjs.com/package/typescript) 7.0.2 (8 July 2026) | dev | `tsc -b` checks the SPA, the Worker and the shared code | No type check: no |
| [`@types/react`](https://www.npmjs.com/package/@types/react) 19.3.0, [`@types/react-dom`](https://www.npmjs.com/package/@types/react-dom) 19.3.0 (both 9 September 2026) | dev | Types for React | |
| [`@types/node`](https://www.npmjs.com/package/@types/node) 26.6.4 (1 October 2026) | dev | Types for `node:test`, `node:assert` and `vite.config.ts`. It tracks the newest Node major, because `.node-version` is `latest` (Node 26.10.0 on 21 September 2026, [index](https://nodejs.org/dist/index.json)); Dependabot opens the major bump when Node 27 arrives | Write tests in JS: lose the types |

Deliberately absent (and absent from `package.json`): Hono, zod/valibot, ORM, a router library, TanStack Query, Redux/Zustand, `idb`, Workbox and `vite-plugin-pwa` ([§5.7](#57-pwa-and-service-worker)), vitest, `@cloudflare/workers-types`, `wrangler-action`, a linter and a formatter (none was asked for yet; `npm run check` is the only gate).

### 5.5 Sharing types and code between the Worker and the SPA

One `shared/` folder, plain TypeScript, imported by relative path from `src/` and from `worker/`. Vite bundles it into both outputs (**verified locally**: a `shared/*.ts` type and a `src/domain` function used by the SPA, and a `shared/` type used by the Worker, build and typecheck). There is no package, no codegen and no path alias.

- **`shared/tables.ts`:** the specs of the three synced tables (`items`, `budget_entries`, `settings`) and the `kind` registry of `items` (which statuses and `data` keys each kind has), as `const` objects. The row types, the `Mutation` contract and the API request and response types are derived from them. It is the SQL whitelist on the server and the generic list screen's configuration on the client. Built today: the kinds `task`, `vendor` and `guest` and the entry types `planned` and `payment`; the other kinds of `docs/features.md` §7.2 are added as registry entries when their screens are built. The data model itself (SQL in `docs/brainstorm.md` §7, rationale in `docs/features.md` §7.2) is one generic `items` table plus one `budget_entries` table, so this file stays small and a new kind of list is a registry entry, not a migration. Its contents are a public spec, not data.
- **`shared/api.ts`:** the sync contract (`Mutation`, `SyncResponse`, `SyncResult`, `Rejection`; both success responses carry `epoch`), the limits `MAX_MUTATIONS` (20) and `MAX_BODY_BYTES` (1 MiB), and the `applyPatch` that both sides use to merge a patch into a row.
- **`shared/validate.ts`:** the validation function. The SPA runs it before queueing a mutation; the Worker runs it again at the trust boundary and is the authority. It checks a settings value against the type of its key, and the type `stages` has its own rules in `stageProblems` (1 to 12 stages, each with a unique key and a unique name of at most 40 characters, a month range from -36 to 12 relative to the akad month, every stage starting after the one before); the stage editor calls the same function to show the problems before saving, so the screen and the Worker cannot disagree.
- **Rules for `shared/`:** no DOM globals, no Workers globals, no JSX, so it compiles in both projects and runs under `node --test`. Imports use the `.ts` extension and `import type` for types; `erasableSyntaxOnly` forbids syntax Node can't strip (such as `enum`).

Three TypeScript projects, referenced from a root `tsconfig.json` with `"files": []`, as in Cloudflare's [React SPA tutorial](https://developers.cloudflare.com/workers/vite-plugin/tutorial/) (which adds a separate `tsconfig.worker.json`):

| File | Includes | Library and types |
|---|---|---|
| `tsconfig.app.json` | `src`, `shared` | `lib` ES2023 + DOM + DOM.Iterable, `jsx: react-jsx`, `types: ["vite/client"]` |
| `tsconfig.worker.json` | `worker`, `shared`, `worker-configuration.d.ts` | `lib` ES2023 only, `types: []` (the Workers types come from `wrangler types`) |
| `tsconfig.node.json` | `vite.config.ts`, `test`, `src/domain`, `shared` | `lib` ES2023 + DOM, `types: ["node"]` |

All three set `strict`, `noEmit`, `moduleResolution: "bundler"`, `allowImportingTsExtensions`, `verbatimModuleSyntax` and `erasableSyntaxOnly`. **verified locally:** `tsc -b` with TypeScript 7.0.2 passes on a scratch project with this layout. Separate DOM and Workers projects are my choice for keeping each global type set out of the other's code; I did not test what a single combined project would do.

### 5.6 Data and state layer

The `store/` and `domain/` split from brainstorm §6.1 carries over unchanged; only the bridge to the view layer is now concrete. All of it is **built**.

- **`src/domain/`:** pure functions, one file per concern: `budget.ts` (totals per line and per event, what is due in 30 days), `week.ts` (what is late, due in the next seven days or undated), `stages.ts` (the route to the akad: the default stages, the stage state for today, and add, remove and move for the editor), `lately.ts` (the five latest changes with who made them), `dates.ts` (date arithmetic in the saved time zone, `settings.timezone`, `Asia/Jakarta` when missing or unsupported), `hijri.ts` (the Hijri date through `Intl`), `guests.ts` (headcount), `draft.ts` (the quick-add parser, [brainstorm §5.2](brainstorm.md#52-reading-and-writing-offline)), `phone.ts` and `money.ts` (phone and rupiah parsing), `status.ts` (the screen and badge state, including the sign-in screen), `access.ts` (the `?access=denied` marker of the Access deny URL), `order.ts`, `groups.ts`, `owner.ts` and `names.ts` (ordering, sections, the owner filter, nicknames), `field.ts` and `changes.ts` (form values and field diffs), `viewport.ts` (the keyboard inset for the Add sheet), `once.ts` (runs one action at a time, so a double tap does not write twice) and `settings.ts` (the settings reader and its keys). No DOM, no React, tested with `node --test`. Savings progress is not built yet.
- **`src/store/`:** `persistence.ts` (the storage interface and its types), `db.ts` (a hand-written promise wrapper over IndexedDB, about 50 lines: one object store per table, plus `outbox` and `meta`; `meta` holds `rev`, `me`, `epoch` and `generation`, and `reset` clears every store in one transaction that is a compare-and-set on `generation`, brainstorm §5.2), `memory.ts` (the same interface in memory, used by the tests), `outbox.ts` (the pure parts: batching, the overlay of pending mutations on the server rows, field diffs), `api.ts` (`fetch` with `redirect: "manual"` and the login detection of brainstorm §5.5), `store.ts` (the immutable snapshot, `subscribe`, the writes, one outbox entry per setting however often it is changed before the push, the sync cycle: push the outbox, then pull, with a pull first when the session has not verified the epoch, and the reset when the epoch or the revision shows another history) and `browser.ts` (wires the store to IndexedDB and `fetch`, and triggers a sync on `visibilitychange` to visible and on `online`). There is no `sync.ts`. No React import.
- **`src/hooks/use-store.ts`:** the only adapter (with the store's actions), `useSyncExternalStore(store.subscribe, store.getSnapshot)` ([React docs](https://react.dev/reference/react/useSyncExternalStore)). The docs require that "while the store has not changed, repeated calls to `getSnapshot` must return the same value" and that the snapshot is immutable, which is why the store replaces its snapshot object on change instead of mutating it.
- **No state library.** The IndexedDB store plus outbox is already the source of truth for the UI; a server-state cache such as TanStack Query would be a second cache that disagrees with it about what is pending.
- **No `idb`.** The wrapper is about 50 lines; [`idb`](https://www.npmjs.com/package/idb) 8.0.3 (7 May 2025, 3.4 KB gzip measured earlier) is the drop-in if Partner B prefers it.
- **Routing:** `src/router.ts` is a `useSyncExternalStore` hook over `hashchange` returning the current hash path, plus a `switch` in `main.tsx`; links are `<a href="#/money">`; the word-to-screen table is `src/ui/routes.ts`, and a screen's detail is the second segment (`#/tasks/<id>`, `#/guests/<id>`).

`npm run check` fails if anything under `src/domain`, `src/store`, `shared` or `worker` imports React, or if `src/views`, `src/ui` or `src/hooks` call `fetch` or touch IndexedDB (the `grep` guards in [§5.2](#52-frontend-build-a-vite-react-spa-on-the-worker)). That is what keeps a later framework change limited to `views/`, `ui/`, `hooks/` and `main.tsx`.

### 5.7 PWA and service worker

**Status: the service worker is not built.** `main` has no `src/sw.js`, no `src/pwa.ts` and no build plugin: `vite.config.ts` has only the React and Cloudflare plugins, `src/main.tsx` registers nothing and `dist/client` has no `sw.js`. What exists is the manifest (`public/manifest.webmanifest`, `display: standalone`, 192 and 512 px icons), `apple-touch-icon.png` and the `<link rel="manifest" href="/manifest.webmanifest">` in `index.html` (no `crossorigin` attribute: the manifest is public, [§6.5](#65-manifest-and-service-worker-with-a-public-shell-rechecking-the-caveats)), so the app is installable by the manifest alone. Without a service worker the shell does not open offline: the data is in IndexedDB and the outbox works while the page is loaded, but a cold start with no signal fails. The decision, the plugin and the sketch below are the plan; they stay as the design to build next, before M9 can test offline start.

**Decision: a hand-written service worker plus a small Vite plugin, not `vite-plugin-pwa`.**

| | Hand-written | [`vite-plugin-pwa`](https://www.npmjs.com/package/vite-plugin-pwa) 2.0.0 (3 October 2026) |
|---|---|---|
| Extra packages | 0 | **+329**: `npm ls --all` went from 62 to 391 packages and `node_modules` from 298 to 375 MB (**verified locally**; it depends on `workbox-build` 7.4.1 and `workbox-window` 7.4.1, 4 May 2026, and peers `vite` up to `^8.0.0`) |
| Code you own (planned) | `src/sw.js` (about 25 lines), the plugin in `vite.config.ts` (about 20 lines), `src/pwa.ts` (about 12 lines) | Config only (a few lines) |
| Precache with versioned revisions, old-cache cleanup, update prompt | To be written by hand ([brainstorm §5.1](brainstorm.md#51-service-worker-strategy)); the cache name changes on every build, so `sw.js` changes byte for byte and the browser sees an update | Built in |
| Works with `@cloudflare/vite-plugin` | Yes (**verified locally**: `dist/client/sw.js` lists `/`, the hashed bundle and `manifest.webmanifest`) | Yes, with a wart (**verified locally**): it also writes `registerSW.js` and `manifest.webmanifest` into the Worker output, and `wrangler deploy --dry-run` then reported "Attaching additional modules: registerSW.js" (0.13 KiB, harmless) |
| Manifest `crossorigin` | Your own `<link>` in `index.html`, with no `crossorigin` now that the manifest is public (the earlier `use-credentials` test, **verified locally**, is no longer needed) | Injects its own `<link rel="manifest">` into `index.html` ([guide](https://vite-pwa-org.netlify.app/guide/)); the option `useCredentials: true` is in its type definitions and, with it, the build output carries `crossorigin="use-credentials"` (**verified locally**), which the check of [§5.2](#52-frontend-build-a-vite-react-spa-on-the-worker) now rejects, so it would stay off. A hand-written link next to it gives two link tags, so you would drop yours |
| Maturity | Your own code, tested only by M9 | Mature library, but major version 2.0.0 is 3 days old as of 6 October 2026 |
| Offline correctness (the app's core promise) | **unverified** until tested on two phones ([§8.2](#82-bootstrap-checklist) M9) | Better trodden, also **unverified** in this setup |

Why hand-written: the earlier decision was "No Workbox", the service worker caches one fixed shell, and 329 build-time packages is a large supply-chain surface for 25 lines of logic. **The weak point is yours to own:** a `sw.js` that never changes never updates. The plugin below prevents that by stamping the file on every build.

**The plugin** (planned, not in `vite.config.ts` yet) is a `serviceWorker` function, which was verified in a scratch build and is this:

```ts
import { readdirSync, readFileSync } from "node:fs";
import type { Plugin } from "vite";

const serviceWorker = (): Plugin => ({
  name: "wp-service-worker",
  apply: "build",
  applyToEnvironment: (env) => env.name === "client",
  generateBundle(_, bundle) {
    const files = [
      "/",
      ...Object.keys(bundle).filter((f) => !f.endsWith(".map") && !f.startsWith(".")).map((f) => `/${f}`),
      ...readdirSync("public").filter((f) => !f.startsWith(".")).map((f) => `/${f}`),
    ];
    const wp = { cache: `wp-${Date.now().toString(36)}`, files };
    this.emitFile({
      type: "asset",
      fileName: "sw.js",
      source: `self.WP=${JSON.stringify(wp)};\n${readFileSync("src/sw.js", "utf8")}`,
    });
  },
});
```

It is added to the `plugins` array next to `react()` and `cloudflare()`. It runs only for the `client` environment, so the Worker build is untouched. It writes `sw.js` as `self.WP = { cache, files }` followed by `src/sw.js`, which is plain JavaScript (the one file outside the TypeScript projects, because the plugin prepends it as text), where `files` = `/` + every file Vite emitted (all chunks, so lazy-loaded chunks are covered; I assume old hashed files vanish from the server after a deploy, **unverified**, which is why the whole set is precached) + every non-dot file in `public/` (manifest, icons). The service worker itself is in [brainstorm §5.1](brainstorm.md#51-service-worker-strategy). Because every navigation is answered with the cached `/`, it has to leave `/api/*` and also `/design/*` to the network; a design page is a navigation to `/design/<name>/`, and a service worker that answered it from the cache would show the app shell instead (a consequence of the plan and of pull request 12, not tested).

**Triggers to switch to `vite-plugin-pwa`:** `src/sw.js` grows past about 60 lines, you need runtime caching strategies beyond the fixed shell, you want generated icons, or M9 finds a stale or broken-offline bug that Workbox's precache would not have.

**Not verified in a browser:** install, the update prompt, offline start, and behaviour with an expired Access session. All of it is on the M9 checklist, and the offline and update items cannot be tested until the service worker is built.

---

## 6. Auth

A short answer to your question: **yes, Cloudflare can do it**. Access + a Google identity provider + an `allow` policy containing exactly two emails. Google only proves who logged in; what restricts it to two accounts is the Access policy.

**Status, 7 October 2026:** Access is live on `wp.atqamz.com` as a self-hosted application (30-day session, SameSite `lax` cookie) whose destinations are the two paths `wp.atqamz.com/api/*` and `wp.atqamz.com/design/*`, with the custom deny URL `https://wp.atqamz.com/?access=denied` (pull request 15; before it the application covered the whole host, and every path answered 302 to the Cloudflare Access login). Every other path, `/` included, is public: it is the app shell (code, icons, manifest), with no data in it. The **Google identity provider is live**: the operator made the Web client in the Google Cloud console and the supervisor created the identity provider from it ([bootstrap, Adding the Google sign-in](bootstrap.md#adding-the-google-sign-in)). The application allows **only the Google identity provider**, with `auto_redirect_to_identity` on, so there is no chooser and One-time PIN is no longer offered; its single policy includes exactly the two allowed emails and nothing else (no email domain, no "everyone"). One-time PIN can be restored as a fallback with one Cloudflare CLI command. The Worker verifies the same Access JWT whichever provider signed the user in, so none of this changes code (expected; confirm in M9). **Updated 25 October 2026:** the application is named `nestora` (policy `nestora allowed`), covers the same two paths on `nestora.atqamz.com` as well, and its custom deny URL is `https://nestora.atqamz.com/?access=denied`; the old destinations stay during the soak.

**What a visitor sees** (the code is **built**; none of it has been tried on a phone, M9):

| Visitor | What happens |
|---|---|
| Opens `https://nestora.atqamz.com/` with no session and nothing stored on the device | The shell loads without any login redirect. The first `GET /api/sync` is answered by Access with a redirect, which `src/store/api.ts` reads as "expired", and the app shows its own sign-in screen ("Continue with Google", a link to `/api/login`). Access then sends the browser to Google, and the Worker answers `/api/login` with a 302 to `/` |
| Opens it on a phone that already holds data | The app opens on that data. If the session has expired, the sync badge says "Log in again" (also a navigation to `/api/login`) and nothing is lost |
| Cannot reach the server and holds nothing | The "connect" screen: retry only. It appears when the first pull fails for any reason other than an expired session |
| Signs in with a Google account that the policy does not allow | Access refuses and sends the browser to the deny URL, `/?access=denied`. The shell loads, `src/domain/access.ts` removes the parameter from the address (`history.replaceState`) and the app shows the wrong-account screen, whose button ("Try another account") is again a link to `/api/login`. Whether Google offers a chooser on that second attempt is **unverified** |
| Taps "Sign out" in Settings | A link to `/cdn-cgi/access/logout`, which ends the Access session on that device; data already synced to the phone stays readable. Whether that endpoint answers on a host whose Access application has only path destinations is **unverified** ([session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/), which was not re-read for this) |
| Asks for `/api/*` or `/design/*` without a session, with a script rather than a browser | Access answers first (a redirect, 401 or 403); if it were missing, the Worker answers 401 itself |

### 6.1 Google IdP vs one-time PIN

| | Access + Google IdP | Access + email OTP |
|---|---|---|
| UX on the phone | Tap the Google account (instant auth, no picker page) | Type the email, open the email app, copy a 10-minute code ([docs](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)); in an iOS standalone PWA, switching apps may get in the way (a guess, unverified) |
| Setup | Needs a Google OAuth client (manual) | Zero: just the email in the policy |
| Who is allowed | Google lets anyone with a Google account *log in*; the **Access policy** is what restricts it to two emails ([Google IdP docs](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/)) | Cloudflare only sends a code if the email is allowed by the policy |
| Failure | A wrong OAuth configuration breaks login | The code gets caught by an email filter |

**Recommendation: Google IdP**, as you asked. It is the only method now, with auto redirect; OTP is not offered, and one command can re-attach it to the same app as an emergency path (the cost of attaching both is a chooser page instead of one button).

### 6.2 Setup steps

**M** = manual, **C** = can be coded (script or wrangler).

| # | Step | Kind | Detail |
|---|---|---|---|
| 1 | Decide the account, then Zero Trust onboarding (team name, Free plan). **Done:** the account already had an organisation | M | Onboarding asks for payment details even on Free: "you will not be charged" ([docs](https://developers.cloudflare.com/cloudflare-one/setup/)). The team name is unique per organisation and becomes the `cloudflareaccess.com` subdomain |
| 2 | Google Cloud: create a project, a consent screen of type **External**, an OAuth client of type Web. **Done (operator, console)** | M | The Cloudflare docs use External so a regular Gmail account can log in ([docs](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/)). No API creates this client: the IAP OAuth Admin API, the only documented programmatic route, was deprecated on 22 January 2025 and its support discontinued on 19 January 2026 ([Google](https://docs.cloud.google.com/iap/docs/deprecations/migrate-oauth-client)), and `gcloud iam oauth-clients` makes Workforce Identity Federation clients only ([Google](https://docs.cloud.google.com/iam/docs/workforce-manage-oauth-app)). Steps, kept as a record and for recovery, in [bootstrap](bootstrap.md#adding-the-google-sign-in) |
| 3 | Fill in the Authorized JavaScript origin `https://<team>.cloudflareaccess.com` and the redirect URI `https://<team>.cloudflareaccess.com/cdn-cgi/access/callback`. **Done** | M | Exactly as in the Cloudflare docs above |
| 4 | Consent screen status **Testing**, add `<email-partner-a>` and `<email-partner-b>` as test users. **Done** | M | Testing is limited to 100 test users and "authorizations by a test user will expire seven days from the time of consent" ([Google](https://support.google.com/cloud/answer/15549945)), **except** when the app requests only the `openid`, `email` and `profile` scopes. The Cloudflare Google page does not list the scopes it requests, so whether you will be asked to consent every week is **unverified**. The alternative is "Publish app"; Google says verification is not mandatory for non-sensitive scopes ([Google](https://support.google.com/cloud/answer/13463073)). Details in [bootstrap M3](bootstrap.md#m3-google-oauth-client) |
| 5 | Create the `google` IdP in Zero Trust (`client_id`, `client_secret`, optional PKCE). **Done (supervisor)** from the console-made client; the client file was consumed and deleted | C | The Cloudflare CLI or the dashboard (no script exists). The fields are in the [API reference](https://developers.cloudflare.com/api/resources/zero_trust/subresources/identity_providers/methods/create/) |
| 6 | Create a `self_hosted` Access app named `nestora` whose destinations are `nestora.atqamz.com/api/*` and `nestora.atqamz.com/design/*` (and, during the soak, the same two paths on `wp.atqamz.com`), with the custom deny URL `https://nestora.atqamz.com/?access=denied`, `session_duration` = `720h`, an inline `allow` policy with two `email` rules, and the allowed identity providers. **Done:** created for the whole host with One-time PIN, then Google added, then `allowed_idps` = Google only with `auto_redirect_to_identity` = true, then (pull request 15) the destinations and the deny URL on `wp.atqamz.com`, then (25 October 2026) the same on `nestora.atqamz.com`, the name `nestora` and the policy name `nestora allowed` | C | Created once through the Cloudflare CLI ([bootstrap M6](bootstrap.md#m6-create-the-access-app-and-note-the-aud); the destinations and deny URL fields are in the [API reference](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/methods/create/), which was not re-read in this pass: **unverified**). The app session can go up to "one month" ([docs](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)); 720h = 30 days. Instant auth is recommended when there's only one IdP ([docs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)) |
| 7 | Note the app's AUD tag. **Done** | C | The creation response carries it (it's also in the dashboard: Applications → Additional settings) |
| 8 | Set three Worker secrets: `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ALLOWED_EMAILS`. **Done** by the first deploy, run by hand with `wrangler deploy --secrets-file <file>` ([docs](https://developers.cloudflare.com/workers/configuration/secrets/)) | M, once | `secrets.required` makes a deploy fail if any is missing, and wrangler refuses a first deploy of a Worker that does not exist yet when `secrets.required` is set and no secrets file is given, which is why CI could not do the first deploy; later deploys keep the secrets |
| 9 | Custom Domains `nestora.atqamz.com` and, during the soak, `wp.atqamz.com`. **Done** | C | The `routes` block in `wrangler.jsonc`, deployed by CI with a token that has no DNS or routes permission ([§7.3](#73-tokens-and-secrets)). Wrangler creates the DNS record and certificate; it can't be done on a hostname that already has a CNAME ([docs](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), 29 September 2026) |
| 10 | Turn off `workers.dev` and preview URLs. **Done** | C | `wrangler.jsonc` (above) |
| 11 | Test on two phones. **Pending (M9)** | M | See §6.5 |

**The Access app has path destinations on one hostname, not Worker-level.** The [Workers + Access docs](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) describe two paths. Worker-level (destination `worker` + `worker_id`) protects all the Worker's domains at once, but is tied to the Worker ID and only offers a basic policy in the dashboard. A self-hosted application with public destinations protects exactly the URLs it lists. I chose a hostname because `workers.dev` and preview are already turned off in the config. The application first covered the whole host; pull request 15 narrowed it to `/api/*` and `/design/*` so that the app can show its own sign-in screen on `/` instead of Access's login page, and so that the shell, the service worker script and the manifest are fetched with no login redirect. The cost is that anyone can read the shell: static code, icons and a manifest, with no data (the repository is public anyway). The Worker still verifies the JWT itself on every `/api/*` and `/design/*` request as a second layer.

### 6.3 Where the two emails are stored

The emails **never** go into the repo and **never into D1**: not in `wrangler.jsonc` (`vars` is forbidden for sensitive data, [docs](https://developers.cloudflare.com/workers/configuration/secrets/)), not in test fixtures, not in docs, not in CI logs.

| Place | Mechanism | Role |
|---|---|---|
| The personal password store you already use | Source of truth, read manually | Typed or injected when creating the Access application and when setting the secrets |
| Access policy (in Cloudflare) | Set by the script or the dashboard | The main gate |
| Worker secret `ALLOWED_EMAILS` | The first deploy's secrets file, later `wrangler secret put` | Second layer, and the only place the app learns which email is which partner. An **ordered pair**, comma-separated and compared lowercase: position 1 is `a` (Partner A), position 2 is `b` (Partner B). The Worker rejects an email that isn't in the list even if the Access policy is misconfigured, and rejects everything if the list doesn't have exactly two entries |

**How `a` and `b` are derived:** after `jwtVerify` succeeds ([§6.4](#64-jwt-verification-in-the-worker)), the Worker compares the verified `email` claim with the two entries of `ALLOWED_EMAILS` and maps position 1 to `a` and position 2 to `b`. Everything stored in D1 (`updated_by`, the default of `who`) uses `a`, `b` or `import`; the SQL has a `CHECK` that rejects any other `updated_by` value, so an email can't end up there by mistake (**verified locally**). The display names (`partner_a_label`, `partner_b_label`) are in `settings`; they are not emails. Swapping the order of the secret swaps who is `a`; do it before the first data, not after.

Deliberately **not** copied into GitHub Actions secrets: the deploy workflow doesn't need them ("Wrangler will not delete your secrets unless you run `wrangler secret delete`", [docs](https://developers.cloudflare.com/workers/wrangler/configuration/); `secrets.required` only checks existence). Tests and fixtures use made-up addresses on the reserved `example.test` domain (two entries in `ALLOWED_EMAILS` order). The `.gitignore` on `main` holds `node_modules/`, `dist/`, `.wrangler/`, `.dev.vars*` (with `!.dev.vars.example`), `.env*` and the data patterns of brainstorm §8: `*.ods`, `*.xlsx`, `*.xls`, `*.csv`, `import*.sql`, `wp-private/` and `export-*.json`.

### 6.4 JWT verification in the Worker

Per the [docs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/): validate the `Cf-Access-Jwt-Assertion` header (not the cookie; the cookie "is not guaranteed to be passed"), fetch the keys from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, check `aud` against the app's AUD, `iss` against the team domain, `exp`, then read `email`. Keys rotate every 6 weeks and the old key stays valid for 7 days, so match by `kid`; `createRemoteJWKSet` from `jose` does that.

`worker/auth.ts` (built, as on `main`):

```ts
import { createRemoteJWKSet, customFetch, jwtVerify } from "jose";
import type { JWTVerifyGetKey } from "jose";
import type { Side } from "../shared/api.ts";

export type AuthEnv = {
  AUTH_MODE?: string;
  DEV_WHO?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ALLOWED_EMAILS?: string;
};

export const createAuthenticator = (fetcher?: typeof fetch) => {
  const keys = new Map<string, JWTVerifyGetKey>();
  return async (request: Request, env: AuthEnv): Promise<Side | null> => {
    if (env.AUTH_MODE === "dev") return env.DEV_WHO === "a" || env.DEV_WHO === "b" ? env.DEV_WHO : null;
    const token = request.headers.get("Cf-Access-Jwt-Assertion");
    const { ACCESS_TEAM_DOMAIN: domain, ACCESS_AUD: audience } = env;
    const pair = (env.ALLOWED_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase());
    if (!token || !domain || !audience || pair.length !== 2 || pair.some((email) => email === "")) return null;
    try {
      const issuer = `https://${domain}`;
      let getKey = keys.get(issuer);
      if (!getKey) {
        getKey = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`), fetcher ? { [customFetch]: fetcher } : {});
        keys.set(issuer, getKey);
      }
      const { payload } = await jwtVerify(token, getKey, { issuer, audience, algorithms: ["RS256"], requiredClaims: ["exp"] });
      const position = typeof payload.email === "string" ? pair.indexOf(payload.email.toLowerCase()) : -1;
      return position === 0 ? "a" : position === 1 ? "b" : null;
    } catch {
      return null;
    }
  };
};
```

Notes: `ctx.access` is **not available** to a Worker with static assets: "the router does not pass `ctx.access` to the user Worker" ([docs](https://developers.cloudflare.com/workers/configuration/cloudflare-access/), 18 August 2026), and the Vite plugin's [static assets page](https://developers.cloudflare.com/workers/vite-plugin/reference/static-assets/) (18 August 2026) repeats that Workers with static assets won't receive `ctx.access`. Manual verification is needed.

- **Secret formats.** `ACCESS_TEAM_DOMAIN` is the host only, `<team-name>.cloudflareaccess.com`, with no scheme (the Worker prepends `https://`). `ACCESS_AUD` is the application's audience tag. `ALLOWED_EMAILS` is `<email-partner-a>,<email-partner-b>`: exactly two entries, compared after trimming and lowercasing; position 1 is `a`, position 2 is `b`.
- **Fails closed.** A missing token header, a missing or empty secret, a pair that is not exactly two non-empty entries, a bad signature, issuer, audience or expiry, an algorithm other than `RS256`, a token without `exp`, or an email outside the pair all return `null` (401). The `ACCESS_*` values are typed as optional by `wrangler types` ([§5.1](#51-decisions)). The key set is created once per issuer and kept for the life of the isolate; `createRemoteJWKSet` fetches and rotates keys by `kid`.
- **`RS256` is unverified against a live token.** The tests sign tokens with a generated RS256 key (`test/auth.test.ts`); that Access signs with `RS256` is the value this code assumes, and the first real login (M9) is its check.
- **Dev mode.** If `AUTH_MODE` is `dev` (set only by `env.dev`, [§5.3](#53-worker-structure-and-dev-auth)), `authenticate` returns `DEV_WHO` when it is `a` or `b` and `null` otherwise, with no JWT check. The production build never selects `env.dev`, and `npm run check` greps the production config for `AUTH_MODE`.
- **Cross-origin writes (CSRF).** Access's cookie is `SameSite=lax` and sibling subdomains of `atqamz.com` are same-site, so `POST /api/sync` (the only state-changing route) refuses what does not look like the app, after authentication: a `Content-Type` other than `application/json` is a 415, an `Origin` header that is present and differs from the request's own origin is a 403, and a `Sec-Fetch-Site` header that is present and is not `same-origin` or `none` is a 403. The Worker never emits CORS headers. The client treats a 401, a 403 and a redirect alike as "log in again" (`src/store/api.ts`), so a refused write shows as an expired session rather than as a rule violation.
- The static files (frontend code, no data) are public by design. If the Access application is missing or misconfigured for `/api/*` or `/design/*`, the Worker still answers 401 without a valid token. That's intentional, and the smoke test of [§7.2](#72-workflow) checks the Access side after each deploy.

### 6.5 Manifest and service worker with a public shell: rechecking the caveats

The old caveats were written for a hand-written `public/` folder. They were rechecked against the Vite build output of [§5.2](#52-frontend-build-a-vite-react-spa-on-the-worker); "verified locally" means a scratch build, not a browser. The rows about the service worker describe the plan: the service worker is not built ([§5.7](#57-pwa-and-service-worker)). Nothing in this table has been tested on a phone yet (M9). The table was written while Access covered the whole host; since pull request 15 (7 October 2026) the shell, the manifest and any service worker script are public and only `/api/*` and `/design/*` are behind Access, so the rows that depended on Access in front of the shell now say so.

| Caveat | Status 7 October 2026 | Action |
|---|---|---|
| The manifest needs `crossorigin="use-credentials"` | **No longer applies; kept as the record.** It held while Access was in front of the shell. MDN: "If the manifest requires credentials to fetch, the `crossorigin` attribute must be set to `use-credentials`, even if the manifest file is in the same origin as the current page" ([MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest)). **verified locally:** a `<link rel="manifest" ... crossorigin="use-credentials">` in the root `index.html` is kept as is in `dist/client/index.html`, and `public/manifest.webmanifest` is copied unchanged. The manifest is public now, so `index.html` has `<link rel="manifest" href="/manifest.webmanifest">` with no `crossorigin` (**built**) | Keep the link without the attribute; `npm run check` greps the built file for the link and fails if `use-credentials` is in it ([§5.2](#52-frontend-build-a-vite-react-spa-on-the-worker)). Why the guard rejects the attribute rather than ignoring it is not recorded here |
| **NEW:** Vite adds `crossorigin` to the module script and preload tags | `<script type="module" crossorigin src="/assets/index-<hash>.js">` (**verified locally**). A plain `crossorigin` means `anonymous`, which still sends credentials for same-origin requests: "no exchange of user credentials ... unless destination is the same origin" ([MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/crossorigin)) | None: the bundle is public and needs no cookie. For the `/api/*` requests the cookie is sent because they are same-origin |
| `ctx.access` isn't there with static assets | **Confirmed**, and now also stated on the Vite plugin's static-assets page (§6.4) | Manual JWT verification in `worker/auth.ts` |
| **NEW:** `/api/login` must reach the Worker although the app is an SPA | In SPA mode, a browser navigation to an unmatched path gets `index.html` ([docs](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)). **verified locally** in `vite dev`: with `run_worker_first: ["/api/*"]` a navigation to `/api/login` reached the Worker and a navigation to `/budget/x` got the HTML. Pull request 12 added `"/design/*"` to the list for the same reason | Keep `run_worker_first: ["/api/*", "/design/*"]` ([§5.2](#52-frontend-build-a-vite-react-spa-on-the-worker)). The production edge behaviour is **unverified** until M9 |
| Navigation is served by the SW from the cache, never reaching Access | **Moot for `/`:** `/` is public and never reaches Access, with or without a service worker. It still applies to the way back in, and to `/design/*`: the planned hand-written SW answers every navigation with the cached `/` (brainstorm §5.1) | The sign-in screen's "Continue with Google" and the badge's "Log in again" navigate to `/api/login`; the `/api/*` and `/design/*` paths are skipped by the SW |
| Session expires during a `fetch` to the API | Access answers with a redirect to the team domain (cross-origin). Whether a browser `fetch` gets a 302 or a 401 is **unverified**: the 401 toggle in the docs is only for the Cloudflare One Client and service auth ([docs](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)). With the default `fetch` (follow), the redirect to the team domain probably ends up as a network error that's hard to tell apart from offline (inference; [Access CORS docs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/cors/), 25 August 2026, which only covers cross-origin requests *to* the Access domain) | **Built** in `src/store/api.ts`: every call uses `redirect: "manual"`; a redirect, a 401 or a 403, or a 2xx answer that is not JSON, becomes "expired" (the badge asks to log in again); a 5xx, a timeout (15 s) or a network error becomes "offline". **Test on a real phone** |
| Service worker script fetch when the session has expired | **Closed by the public shell.** Once built, `sw.js` will be a file in `dist/client`, served by the asset layer outside the two Access destinations, so Access never redirects it. The SW spec sets redirect mode `error` for fetching the SW script ([W3C](https://w3c.github.io/ServiceWorker/)); that only matters if a redirect happens, which the path destinations avoid (inference, **unverified** in a browser) | Nothing to build. Keep `sw.js` out of `/api/*` and `/design/*`, which it is by its path |
| **NEW:** the SW install fetches the whole precache list (planned) | `install` calls `cache.addAll(files)` for `/`, the hashed bundle, the fonts and the manifest. Every file on that list is public now, so an expired session no longer redirects them to the team domain and `addAll` no longer fails for that reason (inference from the Fetch and SW specs, **unverified** in a browser). The list must never contain `/api/*` or `/design/*` | Nothing to build; test in M9 by letting the session expire, then deploying a new version |
| The iOS PWA cookie jar is separate from Safari | A secondary source says Home Screen app storage is isolated from Safari ([MagicBell](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)); **unverified** from Apple's docs. The Access login also leaves the app's origin (the team domain), now only when the user taps "Continue with Google" or "Log in again" (a navigation to `/api/login`), and the behaviour of redirects out of and back into scope in iOS standalone is **unverified** | This is risk #1 in §9.1. Test on day one, before writing features |
| Default 24-hour session | Up to "one month" ([docs](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)) | **Done:** the live application has a 30-day session |
| CORS and OPTIONS | The app is same-origin, so not needed. But if the frontend is opened from another origin (e.g. `localhost` calling the production API), the preflight gets a 403 ([docs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/cors/)) | Partner B develops against the local Worker that runs inside the Vite dev server (`npm run dev`), not against production |
| `workers.dev` and preview URLs open | The Access application only protects the destinations on `nestora.atqamz.com` and, during the soak, `wp.atqamz.com` ([docs](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)); preview URLs are "public by default" ([Previews](https://developers.cloudflare.com/workers/previews/)) | Both are turned off in the config |

---

## 7. CI/CD and environments

### 7.1 GitHub Actions vs Workers Builds

| | GitHub Actions + `npx vite` and `npx wrangler` | Workers Builds |
|---|---|---|
| Token | An account API token that you scope yourself ([docs](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/), 18 September 2026) | "Currently, only user tokens are supported, with account-owned token support coming soon". Default token: Account Settings read, Workers Scripts edit, KV edit, R2 edit, Workers Routes edit for all zones; D1 isn't included, so it has to be added ([docs](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#api-token), 22 September 2026) |
| Tests and type check | One workflow: `check` first, `deploy` after | Needs a separate GitHub workflow for PRs too, so two CI systems |
| Preview | None (see §7.4) | If preview builds are enabled, non-production branches run `wrangler preview` by default ([docs](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/), 22 September 2026); preview URLs are public by default ([Previews](https://developers.cloudflare.com/workers/previews/)) |
| Secrets | GitHub Actions secrets. Public repo: secrets aren't passed to workflows from forks ([GitHub](https://docs.github.com/en/actions/how-tos/security-for-github-actions/security-guides/using-secrets-in-github-actions)) | Build variables and secrets in the Cloudflare dashboard |
| Free limit | Actions minutes for a public repo | 3,000 minutes/month, 1 concurrent build, 20-minute timeout |
| Migrations | An explicit step before deploy | Has to be put in the deploy command |
| Consistency | The office repo's pattern: wrangler from GitHub Actions, not Workers Builds | Opposite to that pattern |

**Recommendation: GitHub Actions**, calling `npx vite build` and `npx wrangler` directly from the lockfile (not using `cloudflare/wrangler-action`, one fewer third party; that action is optional according to the Cloudflare docs). The main reasons: one system for checks, migrations, build and deploy, and a token whose scope you control. Workers Builds could also run `npm run build`; that doesn't change the token reasoning above.

### 7.2 Workflow

One file `.github/workflows/ci.yml` (built; the `<sha>` and `<version>` placeholders stand for the commit SHA of each action and the release it was pinned at, which Dependabot changes):

```yaml
name: ci
on:
  pull_request:
  workflow_dispatch:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha> # <version>
      - uses: actions/setup-node@<sha> # <version>
        with:
          node-version-file: .node-version
          cache: npm
      - run: npm ci
      - run: npm run check
  dependabot-metadata:
    if: github.event_name == 'pull_request' && github.actor == 'dependabot[bot]'
    runs-on: ubuntu-latest
    permissions:
      pull-requests: read
    outputs:
      update-type: ${{ steps.metadata.outputs.update-type }}
    steps:
      - id: metadata
        uses: dependabot/fetch-metadata@<sha> # <version>
  dependabot-merge:
    needs: [check, dependabot-metadata]
    if: github.event_name == 'pull_request' && github.actor == 'dependabot[bot]' && (needs.dependabot-metadata.outputs.update-type == 'version-update:semver-minor' || needs.dependabot-metadata.outputs.update-type == 'version-update:semver-patch')
    runs-on: ubuntu-latest
    permissions:
      actions: write
      contents: write
      pull-requests: write
    steps:
      - run: gh pr merge --squash --match-head-commit "$HEAD_SHA" "$PR_URL"
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          PR_URL: ${{ github.event.pull_request.html_url }}
          HEAD_SHA: ${{ github.event.pull_request.head.sha }}
      - run: gh workflow run ci.yml --ref main
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          GH_REPO: ${{ github.repository }}
  deploy:
    needs: check
    if: github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'workflow_dispatch')
    runs-on: ubuntu-latest
    timeout-minutes: 15
    concurrency:
      group: nestora-deploy
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@<sha> # <version>
        with:
          persist-credentials: false
      - run: test "$(git ls-remote origin refs/heads/main | cut -f1)" = "$GITHUB_SHA" || { echo "main moved past $GITHUB_SHA"; exit 1; }
      - uses: actions/setup-node@<sha> # <version>
        with:
          node-version-file: .node-version
          cache: npm
      - run: npm ci --ignore-scripts
      - run: npx wrangler d1 migrations apply wp --remote
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      - run: npm run build
      - run: npx wrangler deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      - run: |
          for host in nestora.atqamz.com wp.atqamz.com; do
            for path in / /api/health /design/round2/; do
              ok=
              for _ in 1 2 3 4 5 6 7 8 9 10; do
                res=$(curl -sS -o /dev/null -w '%{http_code} %{content_type} %{redirect_url}' --max-time 20 "https://$host$path" 2>/dev/null) || res=
                case "$path:$res" in
                  /:200\ text/html*) ok=1; break ;;
                  /:*) ;;
                  *:30[1-8]\ *\ https://*.cloudflareaccess.com/* | *:401\ * | *:403\ *) ok=1; break ;;
                esac
                sleep 10
              done
              test -n "$ok" || { echo "unprotected or unreachable: $host$path"; exit 1; }
            done
          done
```

How it works:

- **Triggers.** `pull_request` runs `check` only. A `push` to `main` and a `workflow_dispatch` run `check` and then `deploy`; `deploy` is guarded by `github.ref == 'refs/heads/main'`, so a dispatch on another branch deploys nothing.
- **`npm run check`** = `tsc -b`, `node --test`, `vite build` and the output and layer guards of [§5.2](#52-frontend-build-a-vite-react-spa-on-the-worker). The deploy job builds again instead of passing the `check` output along, so no build artifact is uploaded. A public repo means **public logs**: no `wrangler whoami`, no `echo` of values, and **don't upload a D1 export as an artifact** (artifacts of a public repo can be downloaded by anyone).
- **Secrets are scoped per step.** `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set in the `env` of the migration step and of the deploy step only, so `npm ci`, the build and the smoke test never see them. The checkout uses `persist-credentials: false` (no repository token is left in `.git`), and the install is `npm ci --ignore-scripts`, so no dependency install script runs in the job that goes on to hold the Cloudflare token. The job has a 15 minute timeout and a `wp-deploy` concurrency group with `cancel-in-progress: false`, so deploys queue and none is cancelled half way.
- **Head-of-main guard.** The second step of `deploy` compares `git ls-remote origin refs/heads/main` with `$GITHUB_SHA` and fails if `main` has moved on. Because deploys queue, an older run that wakes up after a newer merge stops instead of deploying older code over newer code.
- **Order.** Migrations run before the build so a fresh checkout reads the root `wrangler.jsonc`; the build then writes `.wrangler/deploy/config.json`, which `wrangler deploy` follows (**built**: the deploy job runs this way). `vite build` prints a "Missing required secrets" warning when the three secrets aren't in the CI environment and still exits 0 (**built**: it is in the `check` log); the real check is `secrets.required` at deploy, which holds because the Worker already has its secrets from the first deploy (§7.3). Whether `wrangler d1 migrations apply` follows the redirect after a build is **unverified**; the generated config keeps `migrations_dir` pointing at the source folder either way.
- **Smoke test.** After the deploy, `/`, `/api/health` and `/design/round2/` on `nestora.atqamz.com` and on `wp.atqamz.com` are requested up to ten times each, ten seconds apart. `/` passes only on a 200 answer whose content type starts with `text/html`: the public shell. `/api/health` and `/design/round2/` pass only on a redirect (301 to 308) to a `cloudflareaccess.com` URL, a 401 or a 403. A path that never passes fails the step with "unprotected or unreachable" and its name, whichever of the two ways it failed, so a `/` that is still behind a login redirect also reads "unprotected". The check on `/design/round2/` holds whether or not a page of that name exists, because Access (or, failing that, the Worker's 401) answers before KV is read (my reading of the Worker code). It proves the shell is public and the two protected paths are protected after each deploy; it does not log in, so it says nothing about whether the app works, and it does not see a change made in the Access dashboard between deploys.
- **Dependabot.** `dependabot-metadata` (only for a Dependabot pull request) reads the update type with `dependabot/fetch-metadata`. `dependabot-merge` runs after `check` and `dependabot-metadata` and squash-merges only `version-update:semver-minor` and `version-update:semver-patch` updates, with `--match-head-commit` so the merge is of the commit that `check` tested; major updates stay open for the supervisor to review. A merge made with `GITHUB_TOKEN` does not start the `push` workflow, except that `workflow_dispatch` and `repository_dispatch` events do start one ([GitHub docs](https://docs.github.com/en/actions/concepts/security/github_token)), so the same job then runs `gh workflow run ci.yml --ref main` (the job has `actions: write` for that), and the dispatch deploys the merged `main`.
- The pattern from the other two repos: actions pinned to SHAs, with Dependabot bumping them (daily, minor and patch updates grouped per ecosystem, `.github/dependabot.yml`).

### 7.3 Tokens and secrets

| Name | Place | Contents / scope | Notes |
|---|---|---|---|
| `CLOUDFLARE_API_TOKEN` | GitHub Actions secret | Account API token `wp-ci`: Account **Workers Scripts Write** and **D1 Write** ("Edit" in the dashboard), limited to one account, plus **Zone Read** on the one `atqamz.com` zone | **No zone DNS or routes permission was needed for deploys:** the first deploy, which attached the Custom Domain, was run by hand with a one-hour token that had them ([bootstrap M7](bootstrap.md#m7-set-the-three-worker-secrets)); the CI deploys with these permissions then ran green. Whether `wp-ci` alone can attach a new Custom Domain was not tested. Zone Read is part of the token; whether wrangler needs it to look the zone up is not stated in a page I read. Permission group names are in the [permission list](https://developers.cloudflare.com/fundamentals/api/reference/permissions/). The token has no Workers KV permission. Whether `wrangler deploy` needs one to bind the existing namespace `nestora-design` is not recorded in these documents (**unverified**); the design pages themselves are uploaded by the supervisor with the Cloudflare CLI, not by CI |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions secret | The account ID | The Cloudflare docs say to store it as a secret; whether the account ID is secret isn't stated in the docs I read, so it is treated as a secret and kept out of the repo |
| Token `wp-access-setup` | **Not** in GitHub; local, temporary | Account: **Access: Apps and Policies Edit** and **Access: Organizations, Identity Providers, and Groups Edit** (the API reference for creating an identity provider names this combined group, not "Identity Providers Edit") | **Not needed so far:** the Access application was created through the Cloudflare CLI logged in as the operator. Should a token be made for the Google switch, keep it separate from the deploy token so a leaked GitHub secret doesn't give the power to change the Access policy, and revoke it afterwards |
| Worker secrets (3) | Cloudflare | See §6.2 step 8 | Set by the first deploy (by hand, with a secrets file); they survive later deploys |

### 7.4 Environments and preview

- **One environment: `production`.** Deploy only from `main`: a push, or a `workflow_dispatch` of `main` (the one the Dependabot merge job triggers, [§7.2](#72-workflow)). The deploy job refuses any other ref and a `main` that has moved past the commit it was started for.
- **No preview.** PRs only run `check`, which has no secrets. `workers_dev` and `preview_urls` are false.
- **Local dev** is enough for the frontend and Worker (local D1, fake data).
- **Trigger for staging:** Partner B wants to test the frontend against a real backend without touching production, or a risky migration. Then use `wrangler preview` with the `previews` block (needs wrangler ≥ 4.135): previews "do not inherit production settings", and D1 is only isolated "when you bind the Preview to a separate resource" ([docs](https://developers.cloudflare.com/workers/previews/), [resources](https://developers.cloudflare.com/workers/previews/resources/)). A preview would need its own hostname and its own Access, so that's extra work, not free.

### 7.5 Adding wp to `atqamz/github` later

**Status: done.** The `wp` row was merged into `atqamz/github` and applied (the repository is now `atqamz/nestora`, renamed on 25 October 2026; the sketch below is the original, see the [rename plan](rename-nestora.md), step 3.5); secret scanning and push protection are already enabled on the repo. What follows is kept as the record of how and why.

Per that repo's README and `AGENTS.md`, the change was to the `repos` **table** in `repos.go`, not a new resource:

```go
{
	Name:        "wp",
	Description: "Wedding planner PWA",
	RequirePR:   true,
},
```

- `wp` already exists on GitHub, so run **adopt**: `pulumi config set adopt true`, `pulumi preview`, `pulumi up`, then `pulumi config rm adopt` (README section "Adopting a repo that already exists"). Don't run it unattended.
- Automatic baseline: no rebase merge, delete branch on merge, vulnerability alerts, default workflow permission `read`, dependabot security updates, and the `main guard` ruleset (blocks deletion and force-push).
- `RequirePR: true` makes sense for Nestora: `main` deploys to production, so changes should go through a PR. **Required status checks are deliberately not managed** by that repo (the reason is in the README: direct-push deadlock), so the CI gate depends on your discipline, not GitHub. This is your decision.
- Manual per the README: secret scanning and push protection (the `gh api` snippet in the README, required for public repos; **done**), and interaction limits (they expire every six months; still the operator's to renew).
- **Don't** put CI secret values in Pulumi (they'd go into state): `gh secret set CLOUDFLARE_API_TOKEN --repo atqamz/nestora` and `CLOUDFLARE_ACCOUNT_ID` (both are set, M8).
- `dependabot.yml` for `npm` and `github-actions` lives in the Nestora repo, not in `atqamz/github` (a rule in that repo's `AGENTS.md`).

---

## 8. Repo layout and bootstrap checklist

### 8.1 Layout

```
wp/
  .github/
    workflows/
      ci.yml
    dependabot.yml
  migrations/
    0001_init.sql
  public/
    apple-touch-icon.png
    icon-192.png
    icon-512.png
    manifest.webmanifest
  shared/
    api.ts
    tables.ts
    validate.ts
  src/
    domain/
      access.ts
      budget.ts
      changes.ts
      dates.ts
      draft.ts
      field.ts
      groups.ts
      guests.ts
      hijri.ts
      lately.ts
      money.ts
      names.ts
      once.ts
      order.ts
      owner.ts
      phone.ts
      settings.ts
      stages.ts
      status.ts
      viewport.ts
      week.ts
    hooks/
      use-busy.ts
      use-plan.ts
      use-room.ts
      use-store.ts
    store/
      api.ts
      browser.ts
      db.ts
      memory.ts
      outbox.ts
      persistence.ts
      store.ts
    ui/
      add-sheet.tsx
      avatar.tsx
      capture.tsx
      contact.tsx
      due.tsx
      error-boundary.tsx
      failure.ts
      field.tsx
      format.ts
      icons.tsx
      item-form.tsx
      item-line.tsx
      labels.ts
      money.tsx
      nav.ts
      overlay.ts
      owner-filter.tsx
      payment-line.tsx
      quick-add.tsx
      recovery-screen.tsx
      recovery.ts
      registry.ts
      routes.ts
      setting-row.tsx
      sheet.css
      shell.tsx
      split.tsx
      stage-editor.tsx
      sync-badge.tsx
      text.ts
      theme-color.ts
      theme.ts
      title.tsx
      ui.css
    views/
      connect.tsx
      entry.css
      entry.tsx
      generic-item.tsx
      home.css
      home.tsx
      money-line.tsx
      money.css
      money.tsx
      people.css
      people.tsx
      person.tsx
      settings.css
      settings.tsx
      sync.tsx
      tasks.tsx
    main.tsx
    router.ts
    style.css
    tokens.css
  test/
    access.test.ts
    auth.test.ts
    check-script.test.ts
    copy.test.ts
    domain-budget.test.ts
    domain-draft-limits.test.ts
    domain-draft-net.test.ts
    domain-draft.test.ts
    domain-format.test.ts
    domain-hijri.test.ts
    domain-lately.test.ts
    domain-lists.test.ts
    domain-misc.test.ts
    domain-names.test.ts
    domain-phone.test.ts
    domain-rows.ts
    domain-stages.test.ts
    domain-status.test.ts
    domain-viewport.test.ts
    domain-week.test.ts
    entry-source.test.ts
    export.test.ts
    format-zone.test.ts
    layout.test.ts
    migration.test.ts
    nav.test.ts
    oklch.ts
    scrollbars.test.ts
    settings-copy.test.ts
    shared.test.ts
    sheet-chips.test.ts
    sheet-draft.test.ts
    stages-contract.test.ts
    store-client.ts
    store-epoch.test.ts
    store-failure.test.ts
    store-fold-order.test.ts
    store-indexeddb.test.ts
    store-lately.test.ts
    store-persistence.test.ts
    store-rows.test.ts
    store-server.ts
    store-settings-model.test.ts
    store-settings.test.ts
    store-sync.test.ts
    store-write.test.ts
    sync-db.ts
    sync-integration.test.ts
    sync-lately.test.ts
    sync.test.ts
    theme-color.test.ts
    theme.test.ts
    tokens.test.ts
    worker.test.ts
    zone-fallback.test.ts
  worker/
    auth.ts
    export.ts
    index.ts
    sync.ts
  .dev.vars.example
  .gitignore
  .node-version
  README.md
  index.html
  package-lock.json
  package.json
  tsconfig.app.json
  tsconfig.json
  tsconfig.node.json
  tsconfig.worker.json
  vite.config.ts
  worker-configuration.d.ts
  wrangler.jsonc
```

`docs/` is not in this tree: the four documents live on the orphan `docs` branch, which holds only them, and `main` holds none (the README points to `git show docs:docs/infra.md`). Notes: `dist/` and `.wrangler/` are build and dev output and are gitignored, so they are not in the tree. `index.html` sits in the project root (Vite's entry) and holds `<link rel="manifest" href="/manifest.webmanifest">` (no `crossorigin`, [§6.5](#65-manifest-and-service-worker-with-a-public-shell-rechecking-the-caveats)) and the inline script that applies the saved theme before the first paint. `src/tokens.css` holds the design tokens and the font faces ([§5.1](#51-decisions), Look). The tree above was regenerated from `git ls-files` on `main` at commit `e9a3e39`. `public/` is copied as is into `dist/client`. The planned `src/sw.js` will not be in `public/`, because the build will stamp it ([§5.7](#57-pwa-and-service-worker)); `src/sw.js`, `src/pwa.ts`, `scripts/` (`access.sh`, `seed.sql`) and `test/domain.test.ts` of the earlier layout do not exist, and `tsc -b` covers the tests through `tsconfig.node.json`. `src/domain/`, `src/store/` and `shared/` import nothing from React. `.dev.vars.example` holds placeholders for the three secrets (`example.test`); it is only used for `vite preview` of the production build. `README.md` agrees with `wrangler.jsonc`: the top level holds the real `database_id` and the placeholder is only in `env.dev`. A Nix flake + direnv like `atqamz/github` is deliberately **deferred**: Partner B needs to run locally with `npm ci`, and Nix could be an obstacle. Add it later if you want full consistency. The earlier layout (`public/app/`, `public/vendor/`, `public/shared/`, `src/worker.ts`) is gone.

### 8.2 Bootstrap checklist

**Manual** (once). Each step M1 to M8 is written out, with verification, what to record and what to do on failure, in [`docs/bootstrap.md`](bootstrap.md); this table only keeps the list, the order and the outcome. **Status, 7 October 2026: M0 to M8 are done, M10 is done, and M9 (the on-phone test) remains.** The Google sign-in is described in [bootstrap, Adding the Google sign-in](bootstrap.md#adding-the-google-sign-in); Google is the only provider. The Access application has the path destinations of §6 since pull request 15, and the design pages have their own steps in [bootstrap, Design pages](bootstrap.md#design-pages).

| # | Step | Status and notes |
|---|---|---|
| M0 | Scaffold the app, reshaped to the layout in §8.1 and the packages in §5.4 | **Done** (§5.2, §5.4; `main`) |
| M1 | Check the account | **Done:** one member, no other organisation, Free plan ([Runbook M1](bootstrap.md#m1-find-the-cloudflare-account); §2.3, decision #1) |
| M2 | Zero Trust onboarding | **Done:** the account already had an organisation; only One-time PIN existed as identity provider ([Runbook M2](bootstrap.md#m2-zero-trust-free-onboarding)) |
| M3 | Google Cloud: project, External consent screen, test users, Web OAuth client, origin and redirect URI | **Done** after the first deploy: the operator made the client in the console, the supervisor created the Google identity provider and added it to the Access application ([Runbook M3](bootstrap.md#m3-google-oauth-client), [Adding the Google sign-in](bootstrap.md#adding-the-google-sign-in)); §6.2 steps 2 to 5. Google is now the only provider |
| M4 | Create the deploy token `wp-ci` | **Done:** Workers Scripts Write, D1 Write and Zone Read ([Runbook M4](bootstrap.md#m4-cloudflare-api-tokens); §7.3). `wp-access-setup` was not needed |
| M5 | `wrangler d1 create wp`, copy `database_id` into `wrangler.jsonc` | **Done:** the id is at the top level only; `env.dev` keeps the placeholder; the database was wiped and migrated again once on day one ([Runbook M5](bootstrap.md#m5-create-the-d1-database)) |
| M6 | Create the Access app and policy, note the AUD | **Done** through the Cloudflare CLI (first with One-time PIN, then Google added, then Google only, then the path destinations `/api/*` and `/design/*` with the deny URL) ([Runbook M6](bootstrap.md#m6-create-the-access-app-and-note-the-aud)) |
| M7 | Set the three Worker secrets | **Done** by the first deploy, run by hand with `wrangler deploy --secrets-file` ([Runbook M7](bootstrap.md#m7-set-the-three-worker-secrets)) |
| M8 | `gh secret set` for `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` | **Done** ([Runbook M8](bootstrap.md#m8-set-the-github-actions-secrets)) |
| M9 | Test on Android and iPhone: install, the first visit with no session (the sign-in screen, then Google, then back in the app), the wrong-account screen with a third Google account, sign out, login, offline start (airplane mode), offline edit, session expiry, the log in again button, and a service-worker update (deploy a second version, see the update prompt, apply it; once more with an expired session) | **Remains.** The offline start and the update prompt need the service worker, which is not built (§5.7); the rest can be tested now; §6.5; risk #1 |
| M10 | ~~Add the `wp` row to `atqamz/github`, enable secret scanning and push protection~~ | **Done** (the row is merged and applied; secret scanning and push protection are enabled), §7.5 |

**Automatic** (CI, every push to `main` and every dispatch of `main`):

| # | Step |
|---|---|
| A1 | `npm ci`, then `npm run check`: `tsc -b`, `node --test`, `vite build`, the output and layer guards (§5.2) |
| A2 | After `check`, on `main` only: `npm ci --ignore-scripts`, then `wrangler d1 migrations apply wp --remote` (before the build) |
| A3 | `npm run build`, then `wrangler deploy`: Worker, static assets from `dist/client`, Custom Domain (DNS record + certificate), `secrets.required` validation; then the smoke test (§7.2) |
| A4 | Daily Dependabot for `npm` and `github-actions`: minor and patch updates grouped per ecosystem, merged automatically after `check` passes (`dependabot-merge`, pinned to the tested commit) and deployed through a `workflow_dispatch` of `main`; majors stay open as pull requests for the supervisor (§7.2) |

---

## 9. Risks, open questions, and what is superseded

### 9.1 Risks (most important first)

1. **Access login inside the iOS PWA** (and Android). A separate cookie jar and a redirect to the team domain outside the app's scope (§6.5); since pull request 15 that redirect only happens when the user taps "Continue with Google" or "Log in again" (a navigation to `/api/login`), because the shell itself is public. Open: nothing has been tested on a phone yet (M9). Mitigation: test on two phones before building more features; if it's annoying, move to the brainstorm's Plan B (device-key cookie), or keep OTP attached to the same app.
2. **Leaks through the public repo**: emails in fixtures, CI logs, artifacts, `.dev.vars`, D1 exports, screenshots. Mitigation: secret scanning and push protection (on), fake data, no data artifacts. The data patterns (`*.ods`, `*.csv`, `import*.sql`, `wp-private/`, `export-*.json`) are in `.gitignore` (§6.3). Open: the design pages are uploaded by hand and never pass through git, so nothing but the supervisor's care keeps real data out of them.
3. **A leaked deploy token** gives the power to deploy code to a Worker connected to D1. Mitigation: `wp-ci` has the minimum scope (§7.3), the Cloudflare token is visible only to the migration and deploy steps (§7.2), only first-party and Dependabot-maintained actions pinned to SHAs, 7-day D1 Time Travel ([docs](https://developers.cloudflare.com/d1/reference/time-travel/)).
4. **A Google consent in Testing status may expire every 7 days** (Google exempts apps that request only `openid`, `email` and `profile`; whether Cloudflare's Google integration stays within those is unverified, [bootstrap M3](bootstrap.md#m3-google-oauth-client)). Friction, not a failure; it matters now that Google is the only sign-in, and One-time PIN is not attached any more (one command re-adds it). The earlier risk of Zero Trust onboarding asking for a card is closed: the account already had an organisation.
5. **The dev `AUTH_MODE` leaks into production.** Mitigation: the variable lives only in `env.dev`, which the production build never selects, and `npm run check` fails if the production config contains `AUTH_MODE`.
6. **Account quota** (§2.5): a polling bug or another Worker in the same account.
7. **Toolchain churn and unattended deploys:** the policy is the latest version of everything, so a new release can turn a build red without a repo change, and a green minor or patch update is merged and deployed to production without a human review. wrangler 4.x releases very often; `@cloudflare/vite-plugin` pulls in an alpha `miniflare` 5.x ([npm](https://www.npmjs.com/package/@cloudflare/vite-plugin)); Vite is on major 8 and TypeScript on major 7; CI installs the newest Node on every run (`.node-version` is `latest`). Mitigation: the lockfile, `check` before every merge, the smoke test after every deploy, and major updates left open for the supervisor.
8. **The temptation of excessive IaC/Effect.** Mitigation: the triggers in §3.4 and §4.
9. **The offline promise is not delivered yet, and the hand-written service worker may serve a stale or broken shell once built.** Today the service worker does not exist (§5.7), so a cold start without signal fails. The cost of a bad one is the wedding-day offline rundown. Mitigation: the cache name is stamped on every build, the M9 checklist tests offline start and update, and the switch triggers to `vite-plugin-pwa` are in §5.7.
10. **React turns out to be the wrong choice.** Mitigation: the layer rules in brainstorm §6.1, enforced by the greps in `npm run check`; only `views/`, `ui/`, `hooks/` and `main.tsx` would change.
11. **After the event:** who maintains it, and whether the Worker is shut down after exporting the data. Unchanged from the brainstorm.
12. **The Access destinations are two path patterns, so a typo or an edit in the dashboard can leave `/api/*` or `/design/*` open at the Access layer without any deploy.** The Worker's own JWT check still answers 401 (§6.4), and the smoke test (§7.2) only runs after a deploy. Mitigation: the second layer; check the application's destinations in the dashboard after any change to it. Open: nothing watches them between deploys. Also new with the public shell: anyone can read the shell's code (no data in it) and can see that the app exists.

### 9.2 Open questions for you

1. Google consent screen: stay on **Testing** (consent again every week, unless the basic-scope exception applies) or **Publish app**? Which one the operator chose is not recorded in these documents.
2. Is a 30-day Access session enough, or do you want it shorter given the personal data? (30 days is what is live.)
3. `RequirePR` for `wp` in `atqamz/github`, given that status checks can't be enforced from there? (The `wp` row exists; whether it sets `RequirePR` is not recorded in these documents.)
4. Nix flake now or later, considering Partner B?
5. Do we need periodic D1 exports? If yes, where to (not a public repo artifact)? (`GET /api/export` exists, [§5.3](#53-worker-structure-and-dev-auth); the place for the copy is open.)

**Answered on 6 October 2026:** `atqamz.com` is in an account with one member, no other organisation shares it (scenario A); the account already had a Zero Trust organisation, so no onboarding was needed and Plan B (device-key) is not needed; one partner uses Android and the other an iPhone (the M9 test order is therefore free).

**Settled by the operator (no longer open):** hand-written service worker (§5.7); hash routing (§5.1); `en-ID` for `Intl`, checked through `resolvedOptions().locale` with the `en-GB` fallback of `docs/features.md` §5.7, built in `src/ui/format.ts`; every identifier in the D1 schema is English; the data model is one generic `items` table plus one `budget_entries` table (`docs/brainstorm.md` §7, `docs/features.md` §7.2).

### 9.3 What this revision supersedes

Statements from the earlier version of this document, removed or rewritten in place (no old text is kept next to the new):

| Earlier statement | Now |
|---|---|
| Decision #6: "plain JS + JSDoc for the frontend; `tsc --noEmit` as the type check", "the frontend stays build-free" | TypeScript everywhere, `tsc -b` over three projects (§5.5) |
| Decision #7 / §5.1: "Router: None, a `switch`", 3 routes | Hash routing with an 8-line hook, a handful of screens (§5.1) |
| Decision #8 / §5.1: hand-written validation from `public/shared/tables.js` | Same idea, in `shared/tables.ts` (table specs and the `kind` registry) and `shared/validate.ts` (§5.5) |
| Decision #11 / §5.1: tests run through `wrangler dev` | `node --test` plus an optional test against `CLOUDFLARE_ENV=dev vite` (§5.1) |
| Decision #17 / §5.3: 1 runtime + 3 dev dependencies; "Deliberately absent: ... Workbox, Vite" | 3 runtime + 8 dev; Vite is now in, Workbox stays out (§5.4) |
| §5.2: "With hash routing, SPA mode isn't needed" | SPA mode is on (operator's decision) and `run_worker_first: ["/api/*"]` keeps `/api/login` reachable (§5.2) |
| §5.2: `wrangler.jsonc` with `main: src/worker.ts` and `assets.directory: ./public` | `main: worker/index.ts`, no `assets.directory`, plus an `env.dev` block (§5.2) |
| §5.2: dev auth through `wrangler dev --var AUTH_MODE:dev` | `CLOUDFLARE_ENV=dev vite` and the `env.dev` block (§5.3) |
| §5.4: `src/types.d.ts` with JSDoc `@typedef import(...)`, `allowJs`, `checkJs`, optional `AUTH_MODE` declared by hand | A `shared/` TypeScript folder; `wrangler types` already emits the optional dev vars (§5.5) |
| §6.4: `src/auth.ts` | `worker/auth.ts` |
| §6.5: "Keep it in `index.html`" (for `public/index.html`), "Partner B develops the frontend against the local Worker (`wrangler dev`)" | Rechecked against the build output (§6.5) |
| §7.2: deploy = migrations then `wrangler deploy` | migrations, `vite build`, then `wrangler deploy` (§7.2) |
| §8.1: layout with `public/app/`, `public/vendor/`, `public/shared/`, `src/worker.ts` | New layout (§8.1) |
| §8.2: A1 `tsc --noEmit` | `npm run check` (§8.2) |
| Decision #16, §6 status, §6.2 step 6 and §6.5 (7 October 2026): "hostname-based app", "every path answers 302 to the login", the manifest needs `use-credentials` | An application with the destinations `/api/*` and `/design/*` and a deny URL; `/` and the rest are public; the manifest has no `crossorigin` (§6) |
| §5.2 and §5.3 (7 October 2026): `run_worker_first: ["/api/*"]`, "only `/api/*` reaches the Worker", the smoke test of `/` and `/api/health` behind a login redirect | `["/api/*", "/design/*"]`, design pages from KV, a smoke test of a public `/` and two protected paths (§5.3, §7.2) |
| §5.4 and decision #21 (7 October 2026): 3 runtime dependencies | 5, with two self-hosted font packages (§5.4) |
| §6.3 and §9.1 risk 2 (7 October 2026): the data patterns are not in `.gitignore` yet | They are, with `export-*.json` (§6.3) |

### 9.4 Parts of `docs/brainstorm.md` that are superseded

`docs/brainstorm.md` was updated in the same pass; this table says what happened to each section.

| Brainstorm section | Status |
|---|---|
| Summary paragraph at the top | **Rewritten:** React + TypeScript + Vite, Google IdP |
| §3.3 API: one Worker, manual router | **Stays**, plus the `run_worker_first` detail and the file structure (§5.3) |
| §3.4 Architecture overview | **Rewritten:** Access with Google IdP in front of `/api/*` and `/design/*` only, public assets from the Vite build |
| §3.5 Free plan limits | **Stays**, re-verified in §2.5 (Worker size: "There is no compressed size limit", only 64 MiB uncompressed, [docs](https://developers.cloudflare.com/workers/platform/limits/)) |
| §4 Auth (OTP recommendation and the "Worker-level" Access setup) | **Marked superseded** at the top of the section; the replacement is §6 here (Google IdP, an application with path destinations, inline policy, JWT verification on `/api/*` and `/design/*`). The text of the OTP comparison is kept as the record of the options |
| §5.1 Service Worker strategy | **Rewritten:** the precache list is generated at build time; the service worker sketch is updated (§5.7 here); the service worker itself is not built yet |
| §5.2 Reading and writing offline | **Updated:** own IndexedDB wrapper instead of `idb`, file locations |
| §5.5 Access + offline | **Partly replaced:** 302-vs-401 is still unverified; adds the SW update (§6.5) and the 720h session |
| §6 Frontend without a build step | **Replaced** by "Frontend: React, TypeScript, Vite"; the framework matrix (vanilla, Lit, Preact + htm, Alpine, Vue, HTMX, petite-vue) is removed |
| §8 "How `wp.atqamz.com` is served" (`wrangler.jsonc` sketch) | **Replaced** by the sketch in §5.2 here |
| §8 "Deploy flow" (Workers Builds recommendation) | **Reversed:** GitHub Actions (§7.1), with a build step (§7.2) |
| §8 "Preview builds" paragraph | **Replaced** by §7.4: the new `wrangler preview` mechanism, and Nestora doesn't use preview for now |
| §9 Risks (the numbering of that revision: #3, #6, #7, #9) | **Reordered** in §9.1; the framework debate is closed and removed from the brainstorm list, as is the answered Zero Trust payment risk |
| §10 Recommendation steps 1, 2, 5 | **Updated** (React from the start; no framework discussion step) |
| §2 "Merged" list and generic-screen paragraph, §3.3, §3.6, §5.2, §5.3 | **Updated** for the three-table model (per-`kind` screens, the table whitelist, rows written per edit, object stores, the example write with `json_patch`) |
| §7 Data model sketch | **Replaced** by "Data model (D1)": one generic `items` table + `budget_entries` + `settings` + `sync_state`, English identifiers, formats from features §6.1, the import mapping rewritten for it. The 12-table sketch is removed |
| §1, §5.4, §5.6 | **Untouched** |
