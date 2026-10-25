# Bootstrap runbook: the manual steps before the first deploy

Written 6 October 2026 and updated the same day, after the steps were run; updated again on 7 October 2026 for the path destinations of the Access application, the public app shell and the design pages. This is the checklist for steps M1 to M8 of [infra §8.2](infra.md#82-bootstrap-checklist), kept as a record and for recovery. You can follow it without reading the rest of the docs; the design reasons live in [infra.md](infra.md), and each step links to the section that decided it. Each step has an **Outcome** paragraph with what actually happened, from the supervisor's report. The instructions themselves come from the linked official pages, which I fetched on 6 October 2026, or from the source of wrangler 4.147.0 downloaded from npm (named where used); the wrangler claims were checked against the real first deploy only where an Outcome paragraph says so.

> **Privacy.** This repo is public. Every account name, email, ID, team name, token and secret in this file is a placeholder. Real values go in your password manager, never in the repo, a commit message, an issue, a PR, a CI log or a screenshot. The domains `atqamz.com` and `wp.atqamz.com` are not personal and stay as they are.
>
> **Label.** **unverified** = I could not confirm it in an official page or in the wrangler source; test it as the step says and fix this file. Time estimates are my guesses, not measurements.

## Overview

| Step | What | Who | Time (estimate) | Blocks | Done |
|---|---|---|---|---|---|
| [M1](#m1-find-the-cloudflare-account) | Find the account that holds `atqamz.com`, and who else is in it | Supervisor, via `npx cf` | 20 min | Everything: it decided the account for M2 to M8 and [infra §2.6](infra.md#26-boundary-recommendation) | [x] |
| [M2](#m2-zero-trust-free-onboarding) | Zero Trust Free onboarding (team name, plan, payment details) | Supervisor, via `npx cf` | 10 min | M3 (team name is in the redirect URI), M6, M7 | [x] (the organisation already existed) |
| [M3](#m3-google-oauth-client) | Google Cloud project, consent screen, Web OAuth client, `google` identity provider | Operator (owner of the Google Cloud project), then supervisor | 30 min | The Google option of the Access application | [x] (done after the first deploy; a Google login is not yet confirmed by the operator) |
| [M4](#m4-cloudflare-api-tokens) | Create the deploy token `wp-ci` (and optionally `wp-access-setup`) | Supervisor, via `npx cf` | 20 min | M5, M7, M8 | [x] (`wp-ci` only) |
| [M5](#m5-create-the-d1-database) | `wrangler d1 create wp`, copy `database_id` into `wrangler.jsonc` | Supervisor, via `npx cf` | 10 min | The CI migration step (A2) | [x] |
| [M6](#m6-create-the-access-app-and-note-the-aud) | Create the Access app and policy, note the AUD | Supervisor, via `npx cf` | 20 min | M7 (needs the AUD) | [x] |
| [M7](#m7-set-the-three-worker-secrets) | Set the three Worker secrets | Supervisor, via `npx cf` | 10 min | The first deploy (`secrets.required`) | [x] (by the first deploy, run by hand) |
| [M8](#m8-set-the-github-actions-secrets) | Set the two GitHub Actions secrets | Supervisor, via `npx cf` | 5 min | The first deploy from CI | [x] |
| [Adding the Google sign-in](#adding-the-google-sign-in) | The console steps for the Google client, how Google reached the Access application, and the last step (Google only) | Operator, then supervisor | | Retiring One-time PIN as the everyday login | [x] |
| [Design pages](#design-pages) | The KV namespace behind `/design/*`, and how a page is put in and taken out | Supervisor, via `npx cf` | 10 min per page | Nothing | [x] (the namespace exists; pages are uploaded as needed) |

**Status, 7 October 2026** (the hostnames in it are those of that day; see the update below). The operator delegated all Cloudflare work to the supervisor, who ran it with `npx cf` (the Cloudflare CLI, logged in as the operator through OAuth). M1 to M8 are done; what happened is under each step. `wp.atqamz.com` serves the full app, deployed by CI. Since pull request 15 the app shell is public: `/` and every path except two answer without any login, and the Access application covers only `wp.atqamz.com/api/*` and `wp.atqamz.com/design/*`, with the custom deny URL `https://wp.atqamz.com/?access=denied`. Access allows only the Google identity provider, with auto redirect on; One-time PIN is no longer offered; the policy still includes exactly two allowed emails. The production database was wiped and re-migrated once on day one (migration 0001 was rewritten in place when the Project concept was removed; see [infra §8.2](infra.md#82-bootstrap-checklist)), and the two nicknames (`partner_a_label`, `partner_b_label`) were seeded as private data: the values are not in the repository or in these documents. What remains is M9, the on-phone test ([infra §8.2](infra.md#82-bootstrap-checklist)), which now includes the first visit with no session ([M6, Verify](#m6-create-the-access-app-and-note-the-aud)).

**Update, 25 October 2026.** The product is called Nestora and is served at `https://nestora.atqamz.com`. `wp.atqamz.com` still serves the same Worker during a 30-day soak. The repository is `atqamz/nestora`. The Access application is named `nestora` with the policy `nestora allowed`, covers `/api/*` and `/design/*` on both hosts, and its custom deny URL is `https://nestora.atqamz.com/?access=denied`. The Google display names are Nestora (project "nestora atqamz auth", consent screen "Nestora", OAuth client "Nestora", API key "nestora books lookup"); the project id did not change. The steps below name the new host; the plan and the reasons are in the [rename plan](rename-nestora.md).

Out of scope here: M0 (scaffold the app) is code work and is done; M9 (test on two phones) needs a person with two phones; M10 is done (see [infra §7.5](infra.md#75-adding-wp-to-atqamzgithub-later)).

**Order.** M1, then M2. After M2, M3 and M4 are independent. M5 needs the `wp-ci` token from M4. M6 needs M2 (and M3 for the Google option) and a way to call the Access API. M7 needs the AUD from M6 and the `wp-ci` token. M8 needs the `wp-ci` token.

**What happened with the first deploy.** The first push to `main` that contains `.github/workflows/ci.yml` runs the deploy job ([infra §7.2](infra.md#72-workflow)), so M5 and M8 were finished first. The first deploy of the Worker was done by hand with `wrangler deploy --secrets-file` (M7), not by CI: wrangler refuses a first deploy of a Worker that does not exist yet when `secrets.required` is set and no secrets file is given, and CI has no secrets file. Later deploys keep the secrets. The first CI deploy then ran green.

## Conventions

| Placeholder | Meaning |
|---|---|
| `<account-id>` | Cloudflare account ID found in M1 |
| `<account-name>` | Display name of that account (as shown in the dashboard) |
| `<zone-id>` | Zone ID of `atqamz.com` |
| `<team-name>` | Zero Trust team name chosen in M2; the team domain is `<team-name>.cloudflareaccess.com` |
| `<partner-a-email>`, `<partner-b-email>` | The two allowed Google accounts, in this order: position 1 becomes `a`, position 2 becomes `b` ([infra §6.3](infra.md#63-where-the-two-emails-are-stored)). Write them lowercase |
| `<owner-google-email>` | The Google account that owns the Google Cloud project |
| `<google-client-id>`, `<google-client-secret>` | The OAuth client values from M3 |
| `<idp-id>` | ID of the `google` identity provider in Zero Trust |
| `<d1-database-id>` | UUID printed by `wrangler d1 create` |
| `<aud>` | Application Audience tag of the Access app |

**Where to record.** One folder `wp` in your password manager, with one entry per row of this table. Entry names: `wp / cloudflare account`, `wp / zero trust`, `wp / google oauth client`, `wp / token wp-ci`, `wp / token wp-access-setup`, `wp / access app`, `wp / emails`. Each step says what goes in which entry. A token or secret is shown once at creation: copy it into the password manager before you close the page.

**Typing secrets into a shell.** Commands below read secrets with `read -rs` so the value is not echoed and does not land in shell history or in the process list. Close the terminal when you finish, or run `unset CLOUDFLARE_API_TOKEN` and the other variables the step exported.

```sh
read -rs CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN
```

The command above waits silently: paste the value and press Enter.

---

## M1. Find the Cloudflare account

**Why.** Custom Domain needs an active zone in the same account as the Worker ([Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/), 29 September 2026). Three of your zones use three different nameserver pairs, which points to three accounts but does not prove it ([infra §2.3](infra.md#23-is-it-one-cloudflare-account)). If another person or organisation shares the account, quota, the Zero Trust organisation (a per-account singleton), tokens and the login page are shared too ([infra §2.4](infra.md#24-what-can-go-wrong)). This step decides which of the two scenarios in [infra §2.6](infra.md#26-boundary-recommendation) you are in.

**Prerequisites.** Login to the Cloudflare dashboard with the account you use for `atqamz.com`. To see the member list in the dashboard you probably need a role that can read it; managing members needs Super Administrator and a verified email ([Manage members](https://developers.cloudflare.com/fundamentals/manage-members/manage/), 20 April 2026). Whether a lower role can open the Members page is **unverified**.

Use at least two of the four methods. Each answers a different question, and none should be trusted alone.

### Method A: dashboard (authoritative)

1. [ ] Log in at `https://dash.cloudflare.com`. If you belong to several accounts, an account switcher lists them (its exact position in today's UI is **unverified**; the docs only say "select your account", [Account API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/), 28 September 2026). Write down the number of accounts and their names.
2. [ ] For each account, open **Domains** and look for `atqamz.com`. The account that lists it is the one you want. Write down `<account-name>`.
3. [ ] Open the `atqamz.com` **Overview** page and scroll to the **API** section: it shows **Zone ID** and **Account ID** ([Find account and zone IDs](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/), 3 August 2026). Record `<zone-id>` and `<account-id>` in `wp / cloudflare account`.
4. [ ] Open the **Members** page of that account (**Manage account** > **Members**, link pattern `https://dash.cloudflare.com/?to=/:account/members`). List every row: status, role. Rows with a pending invitation count as members-to-be. Compare each address with the people you know, without copying addresses anywhere public.
5. [ ] Open **Workers & Pages**. Note how many Workers exist, who they belong to (names you recognise?), and the state of the **Protect all Workers** card ([Workers + Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/)). Note the **Account Details** > **Account ID** here too, it must match step 3.
6. [ ] Check whether a Zero Trust organisation already exists: the team name is under **Zero Trust** > **Settings** ([Get started](https://developers.cloudflare.com/cloudflare-one/setup/), 17 April 2026). **Look only.** If **Zero Trust** shows an onboarding screen instead, close it: completing onboarding is M2, and you want to make that choice on purpose.

A Cloudflare Organization is "a top-level container ... for managing multiple accounts" that lets administrators "govern accounts, members, and resources from a single location" ([Organizations](https://developers.cloudflare.com/fundamentals/organizations/), 27 August 2026), and the dashboard has an Organization-aware account switcher. It is not the same as a shared account, but if your account sits inside one, people at organisation level may reach it without being listed on the Members page: treat that as scenario B. Where the dashboard shows this is **unverified**.

### Method B: public DNS (a hint, not proof)

1. [ ] Read the nameservers of the zone and of your other zones. No tool installs needed:

   ```sh
   dig +short NS atqamz.com
   curl -s -H 'accept: application/dns-json' 'https://cloudflare-dns.com/dns-query?name=atqamz.com&type=NS'
   ```

   On 6 October 2026 the second command returned the pair `chloe.ns.cloudflare.com` and `ray.ns.cloudflare.com`; the first command needs `dig` (package `bind` or `dnsutils`), which was not installed on the machine I used, so I did not run it. If you get `*.ns.cloudflare.com` names, the zone is on Cloudflare DNS.
2. [ ] Do the same for your other zones. **How to read it:** Cloudflare "favor[s] consistent nameserver names across all zones within an account", but "[s]ince a conflict can be caused by anyone adding the same zone to any other Cloudflare account, the likelihood of your new zone being assigned different nameserver names than your previously existing zones is higher" ([Nameserver assignment](https://developers.cloudflare.com/dns/zone-setups/reference/nameserver-assignment/), 28 August 2026). So: same pair means probably the same account; different pairs mean nothing certain. Only methods A and C answer "which account".
3. [ ] Confirm that `wp.atqamz.com` is free. `curl -s -H 'accept: application/dns-json' 'https://cloudflare-dns.com/dns-query?name=wp.atqamz.com&type=A'` returned `"Status":3` (no such name) on 6 October 2026. Custom Domain cannot be created on a hostname that already has a CNAME ([Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)). Also: in a non-interactive run (CI), wrangler 4.147.0 sets `override_existing_origin` and `override_existing_dns_record` to true (source of the npm package, `wrangler-dist/cli.js`, function `publishCustomDomains`), so CI would replace an existing record on that hostname. Make sure nothing you want to keep lives on `wp.atqamz.com`.

### Method C: API with a read-only token (authoritative, scriptable)

1. [ ] Create a **user** token: **My Profile** > **API Tokens** > **Create Token** > custom ([Create API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/), 20 April 2026). A user token sees every account you belong to, an account token sees one. Name it `wp-m1-readonly`. Permissions, all read-only (names from [API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/), 1 October 2026):

   | Scope | Permission | Used for |
   |---|---|---|
   | Account | Account Settings Read | `GET /accounts/{account_id}/members`: the list endpoint accepts "Account Settings Read" ([API](https://developers.cloudflare.com/api/resources/accounts/subresources/members/methods/list/)) |
   | Zone | Zone Read | `GET /zones`: accepts "Zone Zone Read" ([API](https://developers.cloudflare.com/api/resources/zones/methods/list/)) |
   | User | Memberships Read | `GET /memberships`: accepts "Memberships Read" ([API](https://developers.cloudflare.com/api/resources/memberships/methods/list/)) |

   Resources: all accounts and all zones, since the point is to see across them. Under **TTL** set an end date of tomorrow ([Create API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/), step 8).
2. [ ] Run the checks. Output contains emails and IDs: read it on screen, do not paste it anywhere.

   ```sh
   API=https://api.cloudflare.com/client/v4
   read -rs CF_TOKEN
   H=(-H "Authorization: Bearer $CF_TOKEN")
   curl -sS "${H[@]}" $API/user/tokens/verify | jq '.result.status'
   curl -sS "${H[@]}" "$API/zones?name=atqamz.com" | jq '.result[] | {name, status, account, name_servers}'
   curl -sS "${H[@]}" $API/memberships | jq '.result[] | {account: .account.name, status, roles}'
   curl -sS "${H[@]}" $API/accounts/<account-id>/members | jq -r '.result[] | [.status, .email] | @tsv'
   ```

   `jq` is assumed to be installed. The token verify endpoint is documented in [Create API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/); the `account` object `{id, name}` is in the zone model ([API](https://developers.cloudflare.com/api/resources/zones/methods/list/)); the member list has `email`, `status` ("accepted" or "pending"), `policies` and `roles` ([API](https://developers.cloudflare.com/api/resources/accounts/subresources/members/methods/list/)). The field names `.account.name`, `.status` and `.roles` in `/memberships` are **unverified**: adjust the `jq` filter to what comes back.
3. [ ] **How to read it:** `zones?name=atqamz.com` returning one zone with `status` `active` and an `account.id` is the proof of which account holds the zone. An empty result means the zone is not in any account your token can see: the zone is in an account you do not belong to, or the name is not on Cloudflare. The member count of that account answers "who else".
4. [ ] When done, delete the token (**My Profile** > **API Tokens**) and `unset CF_TOKEN`.

### Method D: `wrangler whoami`

1. [ ] Locally, in any folder with Node installed:

   ```sh
   npx wrangler login
   npx wrangler whoami
   npx wrangler whoami --account <account-id>
   ```

   `whoami` lists the accounts your login can reach (name and ID) and the token permissions; `--account` adds your own membership roles in that account ([General commands](https://developers.cloudflare.com/workers/wrangler/commands/general/), 2 September 2026; behaviour confirmed in the wrangler 4.147.0 source). It does **not** list the other members of the account. A missing `User->Memberships->Read` permission gives a hint in the output (wrangler source).
2. [ ] Do not run `whoami` in CI: it prints your email and account names into a public log ([infra §7.2](infra.md#72-workflow)). Run `npx wrangler logout` afterwards if you do not want the login to stay on this machine.

### Decide

| What you found | Meaning | What to do (infra §2.6) |
|---|---|---|
| `atqamz.com` is in an account where you are the only member, with only your own Workers and no other organisation's zones | Scenario A | Continue to M2, no extra caution |
| The account has other members, or its Workers and zones belong to someone else (another organisation's zones or Workers are visible) | Scenario B | Before deploying: check the **Protect all Workers** card and never turn it on from Nestora. Pin `allowed_idps` in the Access app (M6 does). Send one message to the account owner about the `wp-*` tokens. The other option, a new personal account, also needs the zone in that account; moving a zone between accounts is **unverified** ([infra §2.6](infra.md#26-boundary-recommendation)) |
| You belong to several accounts and the zone is in only one | Scenario A or B per member list, plus the "wrong account" risk | Always set `CLOUDFLARE_ACCOUNT_ID` ([infra §2.4](infra.md#24-what-can-go-wrong) risk 6); `wp-ci` is limited to this one account in M4 |
| The zone is in no account you can see, or its nameservers are not `*.ns.cloudflare.com` | Decision #1 of the [decision table](infra.md#decision-table) does not hold | Stop. Do not continue to M2. Ask the owner of the zone for access, or add the zone to an account you control (not covered in the docs read for this runbook) and repeat M1 |
| Nameservers differ from the pair above | The zone moved since 6 October 2026 | Repeat methods A and C before continuing |

**Verify.** Two methods (A and C, or A and D) name the same `<account-id>`, and you can say who the members are.

**Record.** In `wp / cloudflare account`: `<account-name>`, `<account-id>`, `<zone-id>`, scenario A or B, the number of members, whether a Zero Trust organisation already exists and its team name. The answer is recorded in [infra §9.2](infra.md#92-open-questions-for-you) (answered).

**Outcome (done).** `atqamz.com` is active on the Free plan in an account with one member, so no other organisation shares it: scenario A. The supervisor checked this through the API with the logged-in CLI (the equivalent of methods A and C). No ids are recorded here.

**If it fails.**
- No account lists `atqamz.com`: you are probably logged in with the wrong login. Try the other logins you own.
- Methods disagree (Domains page says account X, API says account Y): trust the API zone object, then redo method A inside account Y.
- You cannot open **Members**: you lack the role. Ask the account owner to look at the list for you, or use method C with an account that can.
- You cannot reach any account that holds the zone: contact the owner. Only Cloudflare support can help with an account whose owner you cannot reach; the docs I read do not cover that process.

---

## M2. Zero Trust Free onboarding

**Why.** Access lives in the Zero Trust organisation of the account. Without it there is no identity provider, no Access app, no `cloudflareaccess.com` team domain, and the Worker has nothing to verify ([infra §6.2](infra.md#62-setup-steps) step 1, decision #16).

**Prerequisites.** M1 finished: you know `<account-id>`. If M1 found an existing organisation, you can skip the onboarding steps, record its team name, and go to Verify. A payment method (card) you are willing to enter: see below. Two-factor authentication on your Cloudflare login is a prerequisite in the docs ([Get started](https://developers.cloudflare.com/cloudflare-one/setup/), 17 April 2026).

**Steps.**
1. [ ] In the dashboard, select the account from M1. Check the name before you go on.
2. [ ] Select **Zero Trust**.
3. [ ] On the onboarding screen, enter a **team name** `<team-name>`. It "is a unique, internal identifier for your Zero Trust organization", used when users enroll devices manually and as "the subdomain for your App Launcher" ([Get started](https://developers.cloudflare.com/cloudflare-one/setup/)). In Nestora it also becomes your login host `<team-name>.cloudflareaccess.com` and the Google redirect URI in M3. Pick a neutral name: it appears in URLs that Partner A and Partner B see. Whether you can rename it later is **not stated** in the docs I read: assume you cannot, because changing it would also change the M3 redirect URI and the `ACCESS_TEAM_DOMAIN` secret.
4. [ ] Select the **Zero Trust Free** plan, then enter payment details. The docs say: "If you chose the **Zero Trust Free plan**, this step is still needed but you will not be charged" ([Get started](https://developers.cloudflare.com/cloudflare-one/setup/)). Free covers "up to 50 users" ([Cloudflare reference architecture: SASE](https://developers.cloudflare.com/reference-architecture/architectures/sase/)); a user takes a seat when they perform an authentication event, and when seats run out additional users are blocked ([Seat management](https://developers.cloudflare.com/cloudflare-one/team-and-resources/users/seat-management/), 1 May 2026). Two users use two seats. Check the order summary for any paid item before you confirm.
5. [ ] Complete onboarding. Cloudflare adds the **Cloudflare** identity provider as the default login method automatically ([Get started](https://developers.cloudflare.com/cloudflare-one/setup/)). Nestora does not use it: the Access app in M6 allows only the `google` provider.

**Verify.** **Zero Trust** > **Settings** shows `<team-name>` ([Get started](https://developers.cloudflare.com/cloudflare-one/setup/)). **Zero Trust** > **Integrations** > **Identity providers** opens ([Google IdP](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/), 30 April 2026). The plan reads Zero Trust Free; where it is displayed in the dashboard is **unverified**.

**Record.** `wp / zero trust`: `<team-name>`, `<team-name>.cloudflareaccess.com`, the plan, the date. Do not store the card number.

**Outcome (done).** The account already had a Zero Trust organisation, so no onboarding and no payment details were needed. Its only identity provider was One-time PIN and there were no Access applications. The team name is not written in this repo.

**If it fails.**
- Team name taken: choose another. It is unique per organisation.
- Payment details declined: you cannot finish onboarding. Without payment details Plan B (device-key, [brainstorm §4](brainstorm.md)) would replace Access and [infra §6](infra.md#6-auth) would change. Do not continue with M3 to M7 until the operator decides. This did not happen: see the outcome.
- You onboarded the wrong account: how to remove a Zero Trust organisation is **not covered** in the docs I read. Ask Cloudflare support, and do not create objects in the organisation.

---

## M3. Google OAuth client

**Why.** Access needs a Google OAuth client to use Google as identity provider. The client ID and secret are the credentials Cloudflare uses to talk to Google ([Google IdP](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/), 30 April 2026). No gcloud command and no API creates a Web OAuth client for signing in Gmail accounts, so this step is manual in the console; the sources are in [Adding the Google sign-in](#adding-the-google-sign-in) ([infra §6.2](infra.md#62-setup-steps) step 2).

**Outcome (done, after the first deploy).** The operator made the Web client in the Google Cloud console following the steps below. The supervisor created the Google identity provider in Zero Trust from that client and added it to the Access application next to One-time PIN, then made it the only provider; the client file was consumed and deleted, and no value from it is recorded here or anywhere in the repo. The application now allows only Google, with `auto_redirect_to_identity` on; its single policy includes exactly the two allowed emails and nothing else (no email domain, no "everyone"). The first deploy had pinned One-time PIN only, because Google did not exist yet ([Adding the Google sign-in](#adding-the-google-sign-in)). M9 still covers the login on both phones.

**Prerequisites.** `<team-name>` from M2. A Google account that will own the project, `<owner-google-email>`. `<partner-a-email>` and `<partner-b-email>` must be real Google accounts, or they cannot sign in. You do not need a Google Workspace account ([Google IdP](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/)).

**Steps.**
1. [ ] Open the [Google Cloud console](https://console.cloud.google.com/). Create a project: **Menu** > **IAM & Admin** > **Create a Project**, enter a name such as `nestora atqamz auth` (the live display name; the project id was fixed at creation and cannot change), leave the location as it is, **Create** ([Create a Google Cloud project](https://developers.google.com/workspace/guides/create-project), 3 September 2026). The page makes billing optional, so a project for Nestora should not need it; I did not see that said for this exact use, so treat it as **unverified** and stop if the console demands billing.
2. [ ] Select the project. Open **Menu** > **Google Auth platform** (the page where the consent screen lives; [Configure OAuth consent](https://developers.google.com/workspace/guides/configure-oauth-consent), 3 September 2026). On first use select **Get started**. The Cloudflare guide reaches the same place through **APIs & Services** > **Credentials** > **Configure Consent Screen** ([Google IdP](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/)).
3. [ ] Fill in **App name** (`Nestora`) and **User support email**. The support email must be your own address or a Google Group ([Google: configure consent](https://support.google.com/cloud/answer/15549049)). Choose **External** as the audience. Enter a **Contact information** email, accept the user data policy, **Continue**, **Create**.
4. [ ] Open **Audience**. Check the **Publishing status** and the **User type**. Decide Testing or In production with the table below. Whichever you choose, under **Test users** select **Add users**, add `<partner-a-email>` and `<partner-b-email>` (and `<owner-google-email>` if it is a third person), **Save** ([Configure OAuth consent](https://developers.google.com/workspace/guides/configure-oauth-consent)). While the status is Testing, only these users can sign in.
5. [ ] Leave **Data Access** (scopes) at the defaults. Do not add scopes: Google's 7-day exception below only applies while an app asks for no more than `openid`, `email` and `profile`.
6. [ ] Open **Clients** > **Create client** ([Manage OAuth clients](https://support.google.com/cloud/answer/15549257)). Application type **Web application**, name `Nestora`.
7. [ ] Under **Authorized JavaScript origins**, add `https://<team-name>.cloudflareaccess.com`. Under **Authorized redirect URIs**, add exactly `https://<team-name>.cloudflareaccess.com/cdn-cgi/access/callback` ([Google IdP](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/)). Redirect URIs must use HTTPS ([Manage OAuth clients](https://support.google.com/cloud/answer/15549257)). **Create**.
8. [ ] Copy the **Client ID** and the **Client secret** into your password manager now. Google says "client secrets for OAuth 2.0 clients are only visible and downloadable from the Google Cloud Console at the time of their creation", afterwards only the last four characters show, and you must rotate to get a new one ([Manage OAuth clients](https://support.google.com/cloud/answer/15549257)). The Cloudflare guide says you can select the client and see the secret; follow Google, who own the console.
9. [ ] In Cloudflare, create the identity provider so you can test it (the supervisor did this with the CLI from the client file; the dashboard path is): **Zero Trust** > **Integrations** > **Identity providers** > **Add new identity provider** > **Google**. Enter the Client ID in **App ID** and the secret in **Client Secret**. PKCE is optional ("PKCE will be performed on all login attempts" if enabled); leave it off unless you want it, it is not part of the infra decisions. **Save** ([Google IdP](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/)). Name the provider `wp-google` if the form asks for a name. M6 reads this provider's ID through the API, so it does not create it again. Hand the client ID and secret to whoever creates the provider out of band, never through the repo, an issue or a chat log.

**Testing or In production.**

| | Testing | In production |
|---|---|---|
| Who can sign in at Google | Only the listed test users, at most 100 | "any user with a Google Account" ([Google: app audience](https://support.google.com/cloud/answer/15549945)) |
| Who can reach Nestora | Also limited by the Access policy (two emails) | Only the Access policy (two emails) limits it; Google lets anyone log in ([infra §6.1](infra.md#61-google-idp-vs-one-time-pin)) |
| Authorization lifetime | "Authorizations by a test user will expire seven days from the time of consent", except when the app requests only `userinfo.email`, `userinfo.profile` and `openid` (or their OpenID Connect equivalents), which "will not expire after 7 days" ([Google: app audience](https://support.google.com/cloud/answer/15549945)); the same exception is in [OAuth 2.0 for Google APIs](https://developers.google.com/identity/protocols/oauth2) | No 7-day limit |
| What Nestora requests | Cloudflare's Google page does not list the scopes it requests: **unverified**. If it asks only for basic scopes, the 7-day rule should not apply to Nestora, which would make [infra §6.2](infra.md#62-setup-steps) step 4 and §9.1 risk 4 too pessimistic | same |
| Verification | Not needed | "If your app utilizes only non-sensitive scopes, it is not mandatory for your app to complete the app verification process" ([Google: verification](https://support.google.com/cloud/answer/13463073)). The "unverified app" screen is defined for apps that "request authorization of scopes considered sensitive or restricted" ([Google: app audience](https://support.google.com/cloud/answer/15549945)), so I do not expect it for Nestora: **unverified in practice** |
| Test-user list | You must add every person who signs in | Not used |
| Switching | **Audience** > **Publish app** moves to In production ([Google: app audience](https://support.google.com/cloud/answer/15549945)) | Whether you can go back to Testing: not stated in the page I read |

What this means for the operator: Testing is the safe start and is reversible by publishing. The Access session itself is a Cloudflare cookie of up to 720h ([infra §6.2](infra.md#62-setup-steps) step 6), so you meet Google only when that session ends. [infra §9.2](infra.md#92-open-questions-for-you) item 1 stays open: this runbook does not choose, and the operator's choice is not recorded.

**Verify.**
1. [ ] **Zero Trust** > **Integrations** > **Identity providers**, **Test** next to Google ([Google IdP](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/)). Sign in with `<partner-a-email>` (or `<owner-google-email>`), a test user. A successful run returns you to Cloudflare without an error page.
2. [ ] Repeat with `<partner-b-email>`, from the other partner's phone if you can.

**Record.** `wp / google oauth client`: the project name, `<google-client-id>`, `<google-client-secret>`, the publishing status, the test-user list, the date.

**If it fails.**
- `Error 401: deleted_client`: the OAuth client was deleted in Google (or expired). Create a new client (steps 6 to 8) and update the identity provider in Cloudflare with the new ID and secret ([Google IdP](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/), troubleshooting). Google keeps a deleted client for 30 days ([Manage OAuth clients](https://support.google.com/cloud/answer/15549257)).
- Google shows an error about the redirect URI, or says access is blocked for a user not on the list: recheck the redirect URI character by character, and that the signing-in account is in the test-user list (typical Google error names `redirect_uri_mismatch` and `access_denied`: **unverified** here).
- Lost the secret: rotate it in **Clients**, then enter the new secret in Cloudflare.
- Console demands billing, or the client type is missing: stop; the pages above are what I could check, and the console UI may differ.

---

## M4. Cloudflare API tokens

**Why.** CI needs one token to run migrations and deploy. The one-time Access setup could use a second, short-lived one with different powers, so that a leaked GitHub secret cannot change the Access policy ([infra §7.3](infra.md#73-tokens-and-secrets)).

**Outcome (done for `wp-ci`).** One account-scoped token named `wp-ci` was created with Workers Scripts Write and D1 Write on the account and Zone Read on the one zone; it is stored as the GitHub secret `CLOUDFLARE_API_TOKEN` (M8). `wp-access-setup` was not created: the supervisor did the Access and identity-provider work through the Cloudflare CLI, already logged in as the operator. The recipe for it stays below in case the CLI route is not available.

**Prerequisites.** M1: `<account-id>`. M2 for `wp-access-setup` (the Access API needs the organisation). To create account API tokens you need API Token Provisioning capabilities or Super Administrator status ([Account API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/), 28 September 2026).

**Which kind.** Use **Account API tokens**: they belong to the account, not to you, and the compatibility matrix marks Access, D1 and Workers as supported ([Account API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/)). Wrangler accepts them (wrangler source: auth type "Account API Token").

**Permissions.** In the dashboard a permission has the level **Edit**; in the API reference and the permission-group list the same level is called **Write**. The permissions page lists both tables ([API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/), 1 October 2026). I use the dashboard names.

`wp-ci` (deploy; lives in GitHub Actions and in your password manager):

| Scope | Permission | Why | Source |
|---|---|---|---|
| Account | **Workers Scripts: Edit** | Upload the Worker, set secrets, attach the Custom Domain | Upload: "Workers Scripts Write" on the [update script](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/) and [secrets](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/secrets/methods/update/) endpoints. Custom Domain: "Workers Scripts Write" on [`PUT /accounts/{account_id}/workers/domains`](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/) |
| Account | **D1: Edit** | `wrangler d1 create` and `wrangler d1 migrations apply wp --remote` | `D1 Write` on [create database](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/create/); [query](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/) accepts `D1 Read` or `D1 Write`, and migrations write |

Resources: **Account Resources** > **Include** > the single account `<account-name>`; never "All accounts" ([GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/), 18 September 2026: "restrict the generated API token to only the account on which you will be deploying"). **Zone Resources** appear once you add a zone permission; the only one is the Zone Read of the next paragraph.

What I left out of Cloudflare's own "Edit Cloudflare Workers" template ([API token templates](https://developers.cloudflare.com/fundamentals/api/reference/template/)): Workers KV Storage Write, Workers R2 Storage Write, Workers Tail Read, Account Settings Read, User Details Read, User Memberships Read, and the zone permission Workers Routes Write. Nestora uses no R2, and its one KV namespace (`nestora-design`, [Design pages](#design-pages)) is written by the supervisor's own login, not by CI; whether the CI deploy needs Workers KV Storage Write to bind that namespace is not recorded here (**unverified**). Nestora runs `wrangler` without `tail`, and sets `CLOUDFLARE_ACCOUNT_ID` so wrangler does not need to list accounts (the memberships lookup is skipped when the account ID is given: wrangler source, **unverified in docs**).

**The Custom Domain question is answered: no DNS or routes permission is needed.** The only permission any official page names for attaching a Custom Domain through the API is Workers Scripts Write ([Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)), and no page says whether Cloudflare also checks zone permissions when it creates the DNS record and the certificate. The first deploy, run by hand with a one-hour token ([M7](#m7-set-the-three-worker-secrets)), attached `wp.atqamz.com`; that token had DNS Write and Workers Routes Write, so it proves nothing about `wp-ci`. The CI deploys that followed ran green with exactly the permissions of the table plus **Zone** > **Zone Read** on the one `atqamz.com` zone (below), but they had no domain to attach. Whether `wp-ci` alone can attach a new Custom Domain was not tested; whether Zone Read is itself needed, or only harmless, was not tested either.

| Scope | Permission | Why | Source |
|---|---|---|---|
| Zone | **Zone: Read** | Part of the token as created; lets wrangler look up the zone of the custom domain (inferred, not tested) | [API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/) |

Zone resources: **Include** > **Specific zone** > `atqamz.com`.

`wp-access-setup` (optional, **not created**; temporary; only on your machine; not in GitHub):

| Scope | Permission | Why | Source |
|---|---|---|---|
| Account | **Access: Apps and Policies: Edit** | Create the Access app with its inline policy | `Access: Apps and Policies Write` on [create application](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/methods/create/) |
| Account | **Access: Organizations, Identity Providers, and Groups: Edit** | Read the `google` identity provider's ID (and create it, if you skip the dashboard in M3) | `Access: Organizations, Identity Providers, and Groups Write` on [create identity provider](https://developers.cloudflare.com/api/resources/zero_trust/subresources/identity_providers/methods/create/); `...Read` or `...Write` on [list](https://developers.cloudflare.com/api/resources/zero_trust/subresources/identity_providers/methods/list/) |

Resources: the same single account. Expiry: set an end date two days out (**TTL**, [Create API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/), step 8; the account-token page calls it an "optional expiration date"). "Edit" is full create, read, update, delete and list access ([Create API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/), step 6), so the second row covers listing.

[infra §7.3](infra.md#73-tokens-and-secrets) names the second permission "Access: Identity Providers Edit". That group exists in the permission list, but the API reference for creating an identity provider names only the combined "Organizations, Identity Providers, and Groups" group, so use that one.

**Steps.**
1. [ ] Open **Manage account** > **Account API tokens** ([Account API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/)).
2. [ ] **Create Token**, choose a custom token (not a template), name it `wp-ci`. Add the two account permissions above and the Zone Read permission of the Custom Domain paragraph. Set **Account Resources** to your account and **Zone Resources** to the one zone. Add no IP filter unless you know your CI addresses (GitHub-hosted runners change). Leave the expiry empty or set one you will remember; a recurring reminder is your call.
3. [ ] **Continue to summary**. Check that the summary lists exactly three permissions, one account and one zone. **Create Token**.
4. [ ] Copy the token value into `wp / token wp-ci` now. It is shown once ([Create API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/)).
5. [ ] Optional, not done: repeat steps 2 to 4 for `wp-access-setup` with its two permissions and the two-day expiry.

**Verify.**
1. [ ] Each token is active. For account tokens the endpoint is `GET /accounts/{account_id}/tokens/verify`, returning `status` of `active`, `disabled` or `expired` ([API](https://developers.cloudflare.com/api/resources/accounts/subresources/tokens/methods/verify/)):

   ```sh
   read -rs CF_TOKEN
   curl -sS -H "Authorization: Bearer $CF_TOKEN" https://api.cloudflare.com/client/v4/accounts/<account-id>/tokens/verify | jq '.result.status'
   ```

   Expect `"active"`. (The page of the Create token docs shows `/user/tokens/verify`: that endpoint is for user tokens.)
2. [ ] Negative check on `wp-ci`: a call that needs a power the token lacks, for example listing DNS records of the zone (`GET /zones/<zone-id>/dns_records`), must fail with a permission error, since the token has Zone Read only. The exact error body is **unverified**; any permission error is the expected answer.
3. [ ] The real test of `wp-ci` is a `wrangler deploy` in CI, which ran green. If an API call reports a missing permission, the error names it: add that permission only, and record it.

**Record.** `wp / token wp-ci` and `wp / token wp-access-setup`: the value, the token name, the permissions list, the account scope, the expiry, the creation date.

**If it fails.**
- A permission name is not in the dropdown: the UI and the docs drifted. Open [List permission groups](https://developers.cloudflare.com/api/resources/user/subresources/tokens/subresources/permission_groups/methods/list/) (linked from the permissions page) and match by name; remember Edit = Write.
- **Account API tokens** does not offer **Create Token** to you: you lack API Token Provisioning and Super Administrator. Ask the account owner. If you must use a user token meanwhile (**My Profile** > **API Tokens**), it acts as you and inherits your access: revoke it as soon as the account token exists.
- Token verify says `disabled` or `expired`: create it again.
- You pasted a token anywhere public: revoke it now in **Account API tokens**, create a new one, and treat anything it could reach as exposed. New account tokens use the scannable prefix `cfat_` ([Account API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/)), so secret scanners can flag them.

---

## M5. Create the D1 database

**Why.** The Worker's `DB` binding needs a database ID in `wrangler.jsonc`. Create it by hand so the ID lands in the repo: a database that a deploy provisions through the dashboard or Git "will not be written back" to the repo ([Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/#automatic-provisioning), as quoted in [infra §8.2](infra.md#82-bootstrap-checklist)). The ID is a UUID, not a credential ([infra §5.3](infra.md#53-worker-structure-and-dev-auth)).

**Prerequisites.** `wp-ci` from M4. The repository checked out with `wrangler.jsonc` ([infra §5.2](infra.md#52-frontend-build-a-vite-react-spa-on-the-worker)) and `npm ci` done. `<account-id>` from M1.

**Steps.**
1. [ ] In the repo root:

   ```sh
   export CLOUDFLARE_ACCOUNT_ID=<account-id>
   read -rs CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN
   npx wrangler d1 create wp
   ```

   `d1 create <NAME>` "provides the binding and UUID that you will put in your config file" ([D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/), 21 April 2026). Wrangler reads the token from `CLOUDFLARE_API_TOKEN` ([General commands](https://developers.cloudflare.com/workers/wrangler/commands/general/)). Optional flag: `--location <hint>` (`weur`, `eeur`, `apac`, `oc`, `wnam`, `enam`) for the primary location; the infra docs make no choice, so the default stays unless you decide otherwise, and whether the location can be changed later is **unverified** ([D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)).
2. [ ] If wrangler asks **Would you like Wrangler to add it on your behalf?**, answer **no**. Left to itself it writes one `d1_databases` entry and rewrites the file through its own patcher, while Nestora wants the entry kept as it is and only the top-level `database_id` changed (wrangler source, `createdResourceConfig`; the `--update-config` flag skips the question, [D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)).
3. [ ] Copy the printed UUID `<d1-database-id>` into the `database_id` of the top-level `d1_databases[0]` of `wrangler.jsonc` **only**. The `env.dev` entry keeps its all-zero placeholder, because the local D1 does not need the real id and the dev build must never point at production ([infra §5.2](infra.md#52-frontend-build-a-vite-react-spa-on-the-worker)).
4. [ ] `unset CLOUDFLARE_API_TOKEN`.

**Verify.**
1. [ ] `npx wrangler d1 list` (with the token set again) shows `wp` and the same UUID ([D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)).
2. [ ] `grep -c '<d1-database-id>' wrangler.jsonc` prints `1`, and the `env.dev` entry still reads `00000000-0000-0000-0000-000000000000`.
3. [ ] Optional, writes nothing: `npx wrangler d1 migrations list wp --remote` runs against the new database. The apply step is for CI (A2); apply asks for confirmation and takes a backup after it runs, and a failed migration is rolled back ([D1 Wrangler commands](https://developers.cloudflare.com/d1/wrangler-commands/)).

**Record.** `wp / cloudflare account`: `<d1-database-id>`, creation date, location hint if any. Commit the config change through a PR, as usual.

**Outcome (done).** The database `wp` exists with migration 0001 applied; its id is the top-level `database_id` in `wrangler.jsonc` on `main` (a UUID, not a credential). `env.dev` keeps the placeholder. Migration 0001 is `migrations/0001_init.sql`, identical to [brainstorm §7.2](brainstorm.md#72-schema). It was rewritten in place on day one (the Project concept was removed and `sync_state.epoch` added), so the production database was wiped and migrated again from the new file. After any later restore, rotate the epoch ([brainstorm §5.3](brainstorm.md#53-conflicts-between-two-phones)).

**If it fails.**
- An authentication error: the token is missing `D1: Edit`, is for another account, or `CLOUDFLARE_ACCOUNT_ID` is wrong. Run the M4 verify.
- The name is taken: you already created it. Use `npx wrangler d1 list` to find the ID instead of creating a second one.
- D1 limits on the Free plan: 10 databases and 5 GB per account ([infra §2.5](infra.md#25-quotas-shared-per-account)).

---

## M6. Create the Access app and note the AUD

**Outcome (done).** The supervisor created the Access application through the Cloudflare CLI: self-hosted, first for the whole host `wp.atqamz.com` and, since pull request 15 (7 October 2026), for the two path destinations `wp.atqamz.com/api/*` and `wp.atqamz.com/design/*` with the custom deny URL `https://wp.atqamz.com/?access=denied`; a 30-day session, SameSite `lax` cookie, one inline allow policy that includes exactly the two allowed emails. It was first created with One-time PIN, the only identity provider that existed then; Google was added later ([Adding the Google sign-in](#adding-the-google-sign-in)), and the application now allows only Google with `auto_redirect_to_identity` on. The AUD was recorded for M7 and is not written here. No `wp-access-setup` token and no script were used. On 25 October 2026 the application was renamed `nestora`, its policy `nestora allowed`, the two `nestora.atqamz.com` destinations were added beside the old ones and the deny URL moved to the new host; the AUD did not change.

**Why.** The Access app puts a login (Google, the only method) and the two-email allow policy in front of `nestora.atqamz.com/api/*` and `nestora.atqamz.com/design/*`. The rest of the host, the app shell, stays public on purpose: the app shows its own sign-in screen, and the deny URL brings a refused Google account back to a screen of the app ([infra §6](infra.md#6-auth)). The Worker verifies the `Cf-Access-Jwt-Assertion` token against the app's `aud` claim ([infra §6.4](infra.md#64-jwt-verification-in-the-worker)), so you need the AUD tag for M7.

**Prerequisites.** M2 (organisation), an identity provider to allow (One-time PIN from M2, and the Google one from M3 if it exists), a way to call the Access API (the logged-in Cloudflare CLI, or `wp-access-setup` from M4), `<team-name>`, `<account-id>`. The hostname `nestora.atqamz.com` need not exist yet: the dashboard flow says domains "must belong to an active zone in your Cloudflare account", not that a record must exist ([Self-hosted public application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/), 4 September 2026). Whether the API accepts the app before the first deploy is **unverified**: if it refuses, finish this step after the first deploy and rerun M7 for `ACCESS_AUD`.

`scripts/access.sh` was planned and not written; this runbook gives the calls by hand, and they were run through the CLI. The body below is the shape of the application as it runs today (Google only, auto redirect, two path destinations, the deny URL). The names `destinations` (a list of `{ type: "public", uri }`) and `custom_deny_url` are from the create-application API reference ([API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/methods/create/)) as I remember it and were not re-read in this pass, and whether `domain` must be left out when `destinations` is given is not stated here: **unverified**. The live application is the source of truth.

**Steps (API).**
1. [ ] Set up the shell (read secrets silently; the emails come from your password manager):

   ```sh
   API=https://api.cloudflare.com/client/v4
   ACC=<account-id>
   read -rs CF_TOKEN
   read -rp 'partner a email: ' EMAIL_A
   read -rp 'partner b email: ' EMAIL_B
   AUTH=(-H "Authorization: Bearer $CF_TOKEN" -H 'Content-Type: application/json')
   ```

2. [ ] Find the ID of the Google identity provider ([list identity providers](https://developers.cloudflare.com/api/resources/zero_trust/subresources/identity_providers/methods/list/), `GET /accounts/{account_id}/access/identity_providers`):

   ```sh
   curl -sS "${AUTH[@]}" $API/accounts/$ACC/access/identity_providers | jq '.result[] | {id, name, type}'
   IDP=<idp-id>
   ```

   Pick the one with `type` `google`.
3. [ ] Create the app ([create application](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/methods/create/), `POST /accounts/{account_id}/access/apps`). Values from [infra §6.2](infra.md#62-setup-steps) step 6: self-hosted, the two path destinations, the deny URL, one allowed identity provider with instant auth, a 30-day session, one **inline** policy with two `email` rules. Inline and reusable policies are mutually exclusive in this API, so Nestora creates no account-level policy object:

   ```sh
   jq -n --arg idp "$IDP" --arg a "$EMAIL_A" --arg b "$EMAIL_B" '{
     type: "self_hosted",
     name: "nestora",
     destinations: [
       {type: "public", uri: "nestora.atqamz.com/api/*"},
       {type: "public", uri: "nestora.atqamz.com/design/*"}
     ],
     custom_deny_url: "https://nestora.atqamz.com/?access=denied",
     allowed_idps: [$idp],
     auto_redirect_to_identity: true,
     session_duration: "720h",
     policies: [{
       name: "nestora allowed",
       decision: "allow",
       include: [{email: {email: $a}}, {email: {email: $b}}]
     }]
   }' | curl -sS "${AUTH[@]}" -X POST $API/accounts/$ACC/access/apps --data @- | jq '{success, aud: .result.aud, errors}'
   ```

   Field names are from the API reference (`destinations` and `custom_deny_url` excepted, see the note above): `type`, `allowed_idps`, `auto_redirect_to_identity` ("You must specify only one identity provider in allowed_idps"), `session_duration` (a duration such as `2h45m`), inline `policies` with `decision`, `include` and `name`, the `email` rule `{email: {email: "..."}}`, and `aud` in the response. The `name` of the inline policy is my choice. Instant auth is the dashboard's **Apply instant authentication**; the Cloudflare docs recommend it when there is one identity provider ([Self-hosted public application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)). Sessions can last up to "one month"; 720h is 30 days ([Session management](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)).
4. [ ] Copy `<aud>` from the output into `wp / access app`. Nothing was written to disk: the body went through a pipe, and the output shows only `success`, `aud` and `errors`.

**Steps (dashboard, if you prefer).** **Zero Trust** > **Access controls** > **Applications** > **Create new application** > **Self-hosted and private** > **Add public hostname**; choose the domain `atqamz.com`, the subdomain `nestora` and the path `api/*`, then add a second public hostname with the path `design/*`; set the custom deny URL to `https://nestora.atqamz.com/?access=denied` (where the dashboard puts these fields is **unverified**); add an **Allow** policy that includes the two emails; select only the `wp-google` identity provider and turn on **Apply instant authentication**; set **Session Duration** to 30 days; **Create** ([Self-hosted public application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)). Copy the AUD: **Zero Trust** > **Access controls** > **Applications** > **Configure** > **Additional settings** > **Application Audience (AUD) Tag**; the tag "will never change unless you delete or recreate the Access application" ([Validate JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/), 6 May 2026). Check the session duration field accepts 30 days in the UI: the docs give "one month" as the maximum, the UI wording is **unverified**.

**Then revoke the setup token.**
5. [ ] **Manage account** > **Account API tokens** > `wp-access-setup` > delete or roll ([Account API tokens](https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/)). Remove its entry's value from the password manager and `unset CF_TOKEN EMAIL_A EMAIL_B`.

**Verify.**
1. [ ] **Applications** lists `nestora` with the two destinations `nestora.atqamz.com/api/*` and `nestora.atqamz.com/design/*` (and, during the 30-day soak, the same two paths on `wp.atqamz.com`) and nothing else, the deny URL `https://nestora.atqamz.com/?access=denied`, only `wp-google` as identity provider and one Allow policy of two emails, named `nestora allowed`.
2. [ ] `<aud>` matches the dashboard's **Additional settings** value.
3. [ ] Scenario B only ([M1](#m1-find-the-cloudflare-account)): no other Access app is changed, and the **Protect all Workers** card is still as you found it.
4. [ ] **First visit, no login needed** (the same three requests as the CI smoke test, [infra §7.2](infra.md#72-workflow)). After a deploy:

   ```sh
   for p in / /api/health /design/round2/; do curl -sS -o /dev/null -w "$p %{http_code} %{content_type} %{redirect_url}\n" "https://nestora.atqamz.com$p"; done
   ```

   `/` must answer `200` with `text/html`. `/api/health` and `/design/round2/` must answer a redirect (301 to 308) to `<team-name>.cloudflareaccess.com`, or a 401 or a 403. Then open `https://nestora.atqamz.com/` in a private browser window: the app's own sign-in screen appears with no redirect first, and "Continue with Google" goes straight to Google (no chooser) and back into the app.
5. [ ] **Wrong account.** In a private window, sign in with a Google account that the policy does not allow: Access refuses, the browser lands on `https://nestora.atqamz.com/?access=denied`, and the app shows the wrong-account screen with the parameter already gone from the address bar. What Google offers when "Try another account" is tapped is **unverified**.
6. [ ] The real end-to-end test is [M9](infra.md#82-bootstrap-checklist), on two phones, after the first deploy.

**Record.** `wp / access app`: the app name, the destinations, the deny URL, `<aud>`, the identity provider ID, the session duration, the date. `wp / emails`: the exact `ALLOWED_EMAILS` string (`<partner-a-email>,<partner-b-email>`, lowercase), as typed in M7.

**If it fails.**
- `403` or an authentication error: `wp-access-setup` lacks a permission or belongs to another account. Run the M4 verify, then check both permission rows.
- An error about `allowed_idps` or the identity provider ID: list the providers again and copy the `id`, not the name.
- An error that the domain is not in an active zone, or that the app cannot be created before the Worker: see the prerequisites note above; the API behaviour is **unverified**. Try the dashboard path.
- `/` answers a redirect or a 403 in the first-visit check: a destination covers more than the two paths (for example the whole host). Fix the destinations; the CI smoke test fails the deploy in the same way.
- Another Access app already covers `nestora.atqamz.com`, or the all-Workers policy is on (scenario B): do not edit it. Report it to the account owner ([infra §2.4](infra.md#24-what-can-go-wrong) risks 3 and 4).
- You lost the AUD: it is in **Additional settings**. If you delete and recreate the app, it changes, and M7's `ACCESS_AUD` must be set again.

---

## M7. Set the three Worker secrets

**Outcome (done).** The Worker `wp` exists with the three secrets `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` and `ALLOWED_EMAILS`, set by the first deploy as described under "As done" below. Values are not recorded here.

**Why.** The Worker reads `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` and `ALLOWED_EMAILS` ([infra §6.4](infra.md#64-jwt-verification-in-the-worker)). `wrangler.jsonc` lists them in `secrets.required`, so `wrangler deploy` "will fail with a clear error if any required secrets are not configured on the Worker" ([Secrets](https://developers.cloudflare.com/workers/configuration/secrets/), 3 July 2026). They must therefore exist **before the first deploy**. They stay across deploys, and the deploy workflow does not touch them ([infra §6.3](infra.md#63-where-the-two-emails-are-stored)).

**Prerequisites.** An account token with Workers Scripts Write (it covers the secrets endpoint and the first deploy), plus the zone permissions that attaching the custom domain needs; use a short-lived token for the first deploy and delete it afterwards (`wp-ci` is the long-lived CI token and is enough for later deploys). `<team-name>` (M2), `<aud>` (M6), the two emails.

**Values.**

| Secret | Value |
|---|---|
| `ACCESS_TEAM_DOMAIN` | `<team-name>.cloudflareaccess.com`: the host only, **no** `https://`, because the Worker builds `https://${ACCESS_TEAM_DOMAIN}` itself ([infra §6.4](infra.md#64-jwt-verification-in-the-worker)) |
| `ACCESS_AUD` | `<aud>` |
| `ALLOWED_EMAILS` | `<partner-a-email>,<partner-b-email>`: lowercase, comma, exactly two entries, the order decides who is `a` and who is `b` ([infra §6.3](infra.md#63-where-the-two-emails-are-stored)). Set the order **before the first data**: swapping it later swaps who is who |

**Steps.**
1. [ ] In the repo root:

   ```sh
   export CLOUDFLARE_ACCOUNT_ID=<account-id>
   read -rs CLOUDFLARE_API_TOKEN && export CLOUDFLARE_API_TOKEN
   npx wrangler secret put ACCESS_TEAM_DOMAIN --name wp
   npx wrangler secret put ACCESS_AUD --name wp
   npx wrangler secret put ALLOWED_EMAILS --name wp
   ```

   Each command prompts for the value; paste it and press Enter ([Wrangler commands: secret put](https://developers.cloudflare.com/workers/wrangler/commands/workers/), 22 September 2026; the `--name` flag names the Worker).
2. [ ] The Worker does not exist yet. Wrangler 4.147.0 then asks: "There doesn't seem to be a Worker called "wp". Do you want to create a new Worker with that name and add secrets to it?" and creates an empty Worker if you answer yes (wrangler source, `createDraftWorker`; the docs I read do not describe this, so it is **unverified in docs**). Answer **yes**. Every `secret put` "creates a new version of the Worker and deploys it immediately" ([Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)): harmless for an empty Worker, and nothing is routed to it yet because the Custom Domain comes with the first deploy.
3. [ ] `unset CLOUDFLARE_API_TOKEN`.

**As done: the first deploy by hand with a secrets file.** The secrets were not set with `secret put`. Wrangler refuses a first deploy of a Worker that does not exist yet when `secrets.required` is set and no secrets are supplied, and CI has no secrets file, so the first deploy was run by hand: `npx wrangler deploy --secrets-file <file>`, with a one-hour account token in the environment (Workers Scripts Write and D1 Write on the account, Zone Read, DNS Write and Workers Routes Write on the one zone; created for this deploy and deleted right after it, so `wp-ci` was not used), after `npm run build`. The file takes JSON or `.env` format ([Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)); it was kept outside the repo, mode `600`, and deleted afterwards, and `.env*` is in `.gitignore`. Deploys from CI after that keep the secrets. The `secret put` route above remains the way to change one secret later; `secret put` on a Worker that does not exist yet is **unverified** in practice here, because it was not used.

**Verify.** `npx wrangler secret list --name wp` (token set) lists the three names, not the values ([Wrangler commands: secret list](https://developers.cloudflare.com/workers/wrangler/commands/workers/)). The real check is the first deploy: `secrets.required` fails it if one is missing, and the error lists which ([Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)).

**Record.** `wp / emails`: the exact string you typed for `ALLOWED_EMAILS`; `wp / zero trust`: the team domain; `wp / access app`: `<aud>`. These are the source of truth ([infra §6.3](infra.md#63-where-the-two-emails-are-stored)); the Worker only keeps a copy.

**If it fails.**
- An authentication or permission error: `wp-ci` is wrong or belongs to another account. Run the M4 verify.
- A secret has a typo: run `secret put` again for that name, it overwrites. Do not delete it first.
- `ALLOWED_EMAILS` with a space, an uppercase letter or a third address: the Worker "rejects everything if the list doesn't have exactly two entries" ([infra §6.3](infra.md#63-where-the-two-emails-are-stored)); fix it with `secret put` again.
- You recreated the Access app: `ACCESS_AUD` is stale. Set it again.

---

## M8. Set the GitHub Actions secrets

**Outcome (done).** The GitHub secrets `CLOUDFLARE_API_TOKEN` (the account-scoped `wp-ci`) and `CLOUDFLARE_ACCOUNT_ID` exist on the repository. The first CI deploy ran green with them. The workflow gives them to the migration and deploy steps only ([infra §7.2](infra.md#72-workflow)).

**Why.** The deploy job reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from GitHub secrets ([infra §7.2](infra.md#72-workflow)). Cloudflare's docs say to store the token and the account ID as secrets ([GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)). The Worker secrets of M7 are **not** copied to GitHub.

**Prerequisites.** `wp-ci` and `<account-id>`. The GitHub CLI (`gh`) logged in with a login that may write secrets on the repo. The repo exists with secret scanning and push protection already on ([infra §7.5](infra.md#75-adding-wp-to-atqamzgithub-later)). Set the secrets with `gh secret set`, not through Pulumi: values would land in state ([infra §7.5](infra.md#75-adding-wp-to-atqamzgithub-later)).

**Steps.**
1. [ ] Run each command and paste the value at the prompt (with no `--body`, `gh` asks for it, so it is not in your shell history; [gh secret set](https://cli.github.com/manual/gh_secret_set)):

   ```sh
   gh secret set CLOUDFLARE_API_TOKEN --repo atqamz/nestora
   gh secret set CLOUDFLARE_ACCOUNT_ID --repo atqamz/nestora
   ```

   The first value is `wp-ci`, the second is `<account-id>`. The command is `gh secret set <secret-name>`, with `-R, --repo` to pick the repo and an interactive prompt when no value is given ([gh secret set](https://cli.github.com/manual/gh_secret_set)). Repository-level secrets are the default; `--env` would make them environment secrets, which the workflow does not use.

**Verify.** `gh secret list --repo atqamz/nestora` lists secrets on the repository level ([gh secret list](https://cli.github.com/manual/gh_secret_list)); both names must appear. Whether it prints an update time is **unverified**; it does not print values. The real test is the first push to `main`: the deploy job's migration step authenticates with them.

**Record.** In `wp / token wp-ci`: "stored in GitHub secret `CLOUDFLARE_API_TOKEN` on <date>". Nothing else.

**If it fails.**
- `gh` says you lack permission: the login needs write access to secrets on that repo. Ask the repo owner.
- A typo in a value: rerun `gh secret set` with the same name; it overwrites.
- You rotated `wp-ci`: set `CLOUDFLARE_API_TOKEN` again.
- Public repo and forks: GitHub does not pass secrets to workflows triggered by pull requests from forks ([infra §7.1](infra.md#71-github-actions-vs-workers-builds)); the PR workflow does not use any anyway.

---

## Adding the Google sign-in

**Status: done.** The Google identity provider exists in Zero Trust, created by the supervisor from a Web client the operator made in the Google Cloud console; the client file was consumed and deleted, and no value from it is in this repo. The Access application allows only Google, with `auto_redirect_to_identity` on, and One-time PIN is no longer offered; its single policy includes exactly the two allowed emails and nothing else (no email domain, no "everyone"). One-time PIN remains available as a fallback that is restored with one Cloudflare CLI command (re-adding it to the application's allowed identity providers). The Worker verifies the same Access JWT whichever provider signed the user in, so no code or secret changes at any of these steps (expected; confirm in M9).

The rest of this section is kept as a record and for recovery (a deleted or expired client, a lost secret, rebuilding in another account).

**Why a person does the Google part.** No gcloud command and no API creates the OAuth client that signs in ordinary Gmail accounts:

- The IAP OAuth Admin API, the only documented programmatic way to create a client, was deprecated on 22 January 2025; Google discontinued support for it on 19 January 2026 and announced its permanent shutdown for 19 March 2026. Google's pages say new clients are created in the Google Cloud console ([Migrate from the IAP OAuth Admin API](https://docs.cloud.google.com/iap/docs/deprecations/migrate-oauth-client)). Those pages describe the IAP OAuth Admin API only; that no other API exists for Google Auth Platform clients is my finding from not having found one, so it is **unverified** as a universal statement.
- `gcloud iam oauth-clients` (the `projects.locations.oauthClients` API) creates clients for **Workforce Identity Federation**. Google: "These steps and the `projects.locations.oauthClients` API are only for Workforce Identity Federation. To create and manage standard OAuth 2.0 client IDs ... go to the Google Cloud console" ([Manage OAuth application](https://docs.cloud.google.com/iam/docs/workforce-manage-oauth-app)). Those clients belong to a workforce identity pool, so they cannot be used as the "Sign in with Google" client for Gmail accounts (my reading of that page).
- Managing standard clients, including their secrets, is described for the console ([Manage OAuth clients](https://support.google.com/cloud/answer/15549257)).

**What the operator does** (Google Cloud console; the same steps as [M3](#m3-google-oauth-client), shortened):

1. [ ] In a Google Cloud project, open **Google Auth Platform** and fill in **Branding**: app name and user support email ([Google: consent screen fields](https://support.google.com/cloud/answer/15549049)).
2. [ ] **Audience**: choose **External**. While the publishing status is Testing, add the two allowed Google accounts under **Test users** ([Google: app audience](https://support.google.com/cloud/answer/15549945)). Do not add scopes.
3. [ ] **Clients** > **Create client** > **Web application**. Authorized JavaScript origin `https://<team-name>.cloudflareaccess.com`; authorized redirect URI `https://<team-name>.cloudflareaccess.com/cdn-cgi/access/callback` ([Cloudflare: Google IdP](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/)).
4. [ ] Copy the **Client ID** and **Client secret** once (Google shows the secret only at creation, [Manage OAuth clients](https://support.google.com/cloud/answer/15549257)) and hand them to the supervisor out of band: a password manager or a local file that is deleted after use, never the repo, an issue, a PR or a chat.
5. [ ] In Zero Trust, **Settings** > **Authentication** > add a new login method, **Google**, with that ID and secret ([Cloudflare: Google IdP](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/), which calls the same place **Integrations** > **Identity providers**; the menu names differ between dashboard versions: unverified for today's dashboard). In this setup the supervisor does this step with the Cloudflare CLI.

**What the supervisor does:** create the Google identity provider from the client values, add it to the Access application's allowed identity providers (done, together with One-time PIN), and then replace the allowed list with Google alone and turn auto redirect on (done). Inline policies are untouched by these changes.

**Verify.** On a phone and a laptop, open `https://nestora.atqamz.com`: the app shows its own sign-in screen (the shell is public, so there is no redirect yet); tap "Continue with Google" (a link to `/api/login`): there is no chooser, the browser goes straight to Google; Google signs in the allowed account and returns to the app, and a third Google account is refused by the policy and ends on the app's wrong-account screen ([M6, Verify](#m6-create-the-access-app-and-note-the-aud)). This is part of M9 and has not been done yet.

---

## Design pages

**Outcome (done).** The Worker serves `/design/<name>/` from the Workers KV namespace `nestora-design` (titled `wp-design` until 25 October 2026), bound as `DESIGN` in `wrangler.jsonc` (pull request 12). The namespace id is committed there next to the D1 id; it is an identifier, not a credential (the same judgement as for the D1 id, [infra §5.3](infra.md#53-worker-structure-and-dev-auth)). The pages themselves are never committed.

**Why.** To look at a design on a phone, behind the same login as the app, without committing it to a public repository and without a deploy per page. The Access application covers `/design/*` and the Worker checks the same token again ([infra §5.3](infra.md#53-worker-structure-and-dev-auth) says what the Worker returns and how).

**Steps** (the supervisor, with the Cloudflare CLI logged in as the operator; CI never touches KV):
1. [ ] **Once (done):** create the namespace with the title `nestora-design` (`wp-design` until 25 October 2026; `wrangler kv namespace create` is the wrangler command for it) and put its id in the top-level `kv_namespaces` entry of `wrangler.jsonc`; the `env.dev` entry keeps its all-zero placeholder.
2. [ ] **Put a page in:** write the page as one self-contained HTML file (no links to other files: a deeper path is a 404) with made-up data only, and store it under its name with `wrangler kv key put`, against the remote namespace of the `DESIGN` binding. The name is lowercase letters, digits and hyphens, at most 40 characters, starting with a letter or a digit; the page is then at `https://nestora.atqamz.com/design/<name>/`.
3. [ ] **Take a page out:** `wrangler kv key delete` with the same name and namespace. `wrangler kv key list` shows what is there.
4. [ ] **Check:** without a session, `curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://nestora.atqamz.com/design/<name>/` must answer a redirect to `<team-name>.cloudflareaccess.com`, a 401 or a 403, never the page; in a signed-in browser the page shows. A new or changed page can take up to a minute to appear everywhere (KV is eventually consistent, [how KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/)).

The command names are wrangler's ([KV commands](https://developers.cloudflare.com/workers/wrangler/commands/kv/)); that page was not fetched in this pass, so their flags are **unverified**, in particular how to choose the remote rather than the local namespace. The supervisor's own CLI (`npx cf`) has its own KV commands, which these documents do not name.

**If it fails.**
- The page 404s as JSON right after an upload: wait a minute, then check the name against the rule in step 2.
- The page shows the app instead of the page: the path did not reach the Worker; check `run_worker_first` in `wrangler.jsonc` ([infra §5.2](infra.md#52-frontend-build-a-vite-react-spa-on-the-worker)).
- A page answers without a login: stop and check the Access destinations ([M6](#m6-create-the-access-app-and-note-the-aud), Verify).

---

## Sources

Every page below was fetched on 6 October 2026. Dates are the "last updated" shown on the page.

| Topic | URL | Date |
|---|---|---|
| Zero Trust onboarding | https://developers.cloudflare.com/cloudflare-one/setup/ | 17 Apr 2026 |
| Seat management | https://developers.cloudflare.com/cloudflare-one/team-and-resources/users/seat-management/ | 1 May 2026 |
| Free for up to 50 users | https://developers.cloudflare.com/reference-architecture/architectures/sase/ | none shown |
| Google IdP (Cloudflare) | https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/google/ | 30 Apr 2026 |
| Self-hosted application | https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/ | 4 Sep 2026 |
| Session management | https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/ | none shown |
| Validate Access JWTs, AUD tag | https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/ | 6 May 2026 |
| Workers + Access, Protect all Workers | https://developers.cloudflare.com/workers/configuration/cloudflare-access/ | none shown |
| Manage members | https://developers.cloudflare.com/fundamentals/manage-members/manage/ | 20 Apr 2026 |
| Organizations | https://developers.cloudflare.com/fundamentals/organizations/ | 27 Aug 2026 |
| Find account and zone IDs | https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/ | 3 Aug 2026 |
| Nameserver assignment | https://developers.cloudflare.com/dns/zone-setups/reference/nameserver-assignment/ | 28 Aug 2026 |
| Custom Domains | https://developers.cloudflare.com/workers/configuration/routing/custom-domains/ | 29 Sep 2026 |
| API token permissions | https://developers.cloudflare.com/fundamentals/api/reference/permissions/ | 1 Oct 2026 |
| API token templates | https://developers.cloudflare.com/fundamentals/api/reference/template/ | none shown |
| Create API token | https://developers.cloudflare.com/fundamentals/api/get-started/create-token/ | 20 Apr 2026 |
| Account API tokens | https://developers.cloudflare.com/fundamentals/api/get-started/account-owned-tokens/ | 28 Sep 2026 |
| GitHub Actions for Workers | https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/ | 18 Sep 2026 |
| Secrets | https://developers.cloudflare.com/workers/configuration/secrets/ | 3 Jul 2026 |
| Wrangler general commands | https://developers.cloudflare.com/workers/wrangler/commands/general/ | 2 Sep 2026 |
| Wrangler Workers commands | https://developers.cloudflare.com/workers/wrangler/commands/workers/ | 22 Sep 2026 |
| Wrangler D1 commands | https://developers.cloudflare.com/d1/wrangler-commands/ | 21 Apr 2026 |
| API: list members | https://developers.cloudflare.com/api/resources/accounts/subresources/members/methods/list/ | n/a |
| API: list zones | https://developers.cloudflare.com/api/resources/zones/methods/list/ | n/a |
| API: list memberships | https://developers.cloudflare.com/api/resources/memberships/methods/list/ | n/a |
| API: verify account token | https://developers.cloudflare.com/api/resources/accounts/subresources/tokens/methods/verify/ | n/a |
| API: Workers domains, scripts, secrets | https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update/ , https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/update/ , https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/secrets/methods/update/ | n/a |
| API: D1 create and query | https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/create/ , https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/query/ | n/a |
| API: Access app and identity provider | https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/subresources/applications/methods/create/ , https://developers.cloudflare.com/api/resources/zero_trust/subresources/identity_providers/methods/create/ , https://developers.cloudflare.com/api/resources/zero_trust/subresources/identity_providers/methods/list/ | n/a |
| Google: create a project | https://developers.google.com/workspace/guides/create-project | 3 Sep 2026 |
| Google: configure OAuth consent | https://developers.google.com/workspace/guides/configure-oauth-consent | 3 Sep 2026 |
| Google: consent screen fields | https://support.google.com/cloud/answer/15549049 | none shown |
| Google: app audience, Testing vs In production | https://support.google.com/cloud/answer/15549945 | none shown |
| Google: manage OAuth clients | https://support.google.com/cloud/answer/15549257 | none shown |
| Google: verification requirements | https://support.google.com/cloud/answer/13463073 | none shown |
| Google: refresh token expiry | https://developers.google.com/identity/protocols/oauth2 | none shown |
| Google: IAP OAuth Admin API deprecation | https://docs.cloud.google.com/iap/docs/deprecations/migrate-oauth-client | none shown |
| Google: IAM OAuth clients are for Workforce Identity Federation | https://docs.cloud.google.com/iam/docs/workforce-manage-oauth-app | none shown |
| GitHub: `GITHUB_TOKEN` does not start workflow runs, except `workflow_dispatch` and `repository_dispatch` | https://docs.github.com/en/actions/concepts/security/github_token | none shown |
| GitHub CLI: `gh secret set` | https://cli.github.com/manual/gh_secret_set | none shown |
| Wrangler 4.147.0 source (`wrangler-dist/cli.js` from `npm pack wrangler`) | https://www.npmjs.com/package/wrangler | 4.147.0 |

Added on 7 October 2026 and not fetched in that pass: Wrangler KV commands, https://developers.cloudflare.com/workers/wrangler/commands/kv/ (the design pages, **unverified**); the KV page quoted above, https://developers.cloudflare.com/kv/concepts/how-kv-works/ (read on 6 October 2026 for brainstorm §3.2); the create-application API page already listed, for the `destinations` and `custom_deny_url` fields (not re-read).

The Google Workspace page on creating credentials said "client secrets aren't used for Web applications"; it contradicts the Google Cloud console help and Cloudflare's guide, which both use a client secret for this setup, so I followed those two.
