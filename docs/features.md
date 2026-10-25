# Feature research: wedding and household hub (Nestora)

Discussion material, not a final decision. Research as of 6 October 2026. A companion to `docs/brainstorm.md` (the spreadsheet, the data model, offline and sync) and `docs/infra.md` (the stack decisions: Cloudflare, auth, React + TypeScript + Vite, CI). This document covers **features**: what is worth building, what should be left to other apps, and what data is needed.

> **Privacy.** This repo is public. This document contains no real name, phone number, address, amount, date or document detail of anyone. The couple is written as **Partner A** and **Partner B**. Example amounts use a placeholder (`Rp X`). The figures that do appear are public facts about products, regulations or surveys, with their sources.

## How to read

- **Effort:** `S` = about one working day (one list configuration and one screen, no new platform component). `M` = two to four days. `L` = more than a week, or needs a new platform component.
- **Platform need** (only a note so it fits the stack in `docs/infra.md`; this document makes no stack recommendation): `client` = runs in the browser without a server; `D1` = relational database; `R2` = file storage; `cron` = scheduled task; `push` = native notifications; `email` = sending email; `realtime` = live sync between phones; `static` = static files are enough.
- **Evidence:** inline links. `[UNVERIFIED]` = could not be confirmed from a source that opened successfully (only a search snippet, a doubtful secondary source, or a page that failed to load). `(tested locally)` = the author's experiment on Node v26.10.0 / ICU 78.3, not a quote.
- **Decided** = an answer from the couple, recorded on 2026-10-06 in §8.4 and carried through the sections. Where a section says "decided #n", it means that row of the Decided table.
- **The scores in §7** are the author's judgement, not data. The formula is written there so it can be challenged.
- **"This week"** is the name of feature W3 throughout this document. In the built app it is not a screen of its own: it is the "Late", "Due soon" and "No date yet" lists of the Home screen, which is called "Our journey" (§7.3).

**Method and limits.**
- Pages were read through a fetch tool that summarises the content, so the quotes and figures this document leans on were rechecked directly at the source. PMA 30/2024 (Minister of Religious Affairs Regulation No. 30 of 2024) was read from its full text.
- The WebSearch quota ran out in the middle of the research. As a result some areas are thin and are marked in the Gap section (mainly: how Indonesian couples use spreadsheets/Notion/WhatsApp, the latest MABIMS criteria, and the number of the 2026 holiday SKB, the joint ministerial decree).
- Reviews on Trustpilot and app stores lean toward registry, shipping and vendor problems, not planning tools. Many comparison articles are written by competitors. Both are labelled.
- Wikipedia and blogs are used only when there is no primary source, and are labelled as secondary.

## Summary

1. **Market.** Foreign planners (The Knot, Zola, Joy, Bridebook) are free for couples because the money comes from vendors or registries. The Indonesian products found are vendor marketplaces (Bridestory, Weddingku) and digital invitation platforms. Paid planning tools are tucked away (Wevitation). In this research **no** product was found that models the *KUA* (Office of Religious Affairs, the marriage registry) process, a vendor book + payment schedule, and an *amplop* (wedding-gift envelope) ledger in one private app. That is not proof such a product doesn't exist.
2. **The strongest lessons from the behavioural research:** capture has to be fast, two people are equal, default items are unassigned, nudges are rare and specific, no scores or streaks, and data can be taken away (export).
3. **Suggested core:** one generic `items` model (plus a separate table for the budget and its payments) + a "This week" screen + tasks from a template, a budget with a payment schedule, a vendor book, and a guest list. JSON/CSV export from day one.
4. **Household (after the wedding):** worth building small: recurring bills and renewals (vehicle tax, *STNK* (vehicle registration), *BPJS* (national health insurance), insurance), savings goals, an *amplop* ledger and family occasions. Better left to other apps: shopping lists, a shared calendar, a vault of document scans, a *KPR* (home mortgage) calculator, trip itineraries.
5. **Reminders:** the "This week" screen and an "Add to calendar" button (`.ics`, for Google Calendar) first, then a WhatsApp share and a Gmail digest, the channels the couple actually look at (decided #6). Push isn't needed yet.
6. **Sensitive documents:** don't store scans of the *KTP*/*KK* (national ID card/family card) or *NIK* (national ID number) in the app. Store the ready status, the date, and the location of the document.
7. **Money:** store whole rupiah as an integer plus a currency code. This deliberately departs from ISO 4217 (§5.7, §6).

---

## 1. Product principles

### 1.1 Who, on what device, at what moment

**Users:** two equal adults (Partner A and Partner B), one phone each, access only through two Google accounts. Everything is visible to both (decided #4). Extra readers (parents, *WO* (wedding organizer)) get nothing for now; a read-only link (W19) stays a later option only (decided #5).

**Devices:**
- Android is about 79% and iOS about 21% of Indonesia's mobile web traffic in September 2026 ([StatCounter](https://gs.statcounter.com/os-market-share/mobile/indonesia): Android 79.16%, iOS 20.79%). That is web traffic, not phone ownership. The app has to be comfortable on Android Chrome and on iOS Safari as an installed PWA.
- One partner uses Android and the other an iPhone (decided #2). Both are first-class: no feature may work on one platform only. On iOS, installing to the Home Screen is required for push ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)) and for long-lived storage (§5.6). That needs one short hint, shown only when the app runs in an iOS browser tab, not a tour (principle 6). How the app detects an installed state (`display-mode: standalone` or `navigator.standalone`) was not checked: `[UNVERIFIED]`.
- The StatCounter page for the desktop vs mobile ratio in Indonesia shows desktop at 55.83% ([source](https://gs.statcounter.com/platform-market-share/desktop-mobile-tablet/indonesia)), which contradicts the mobile-first picture and can't be reconciled. That figure is ignored. The mobile-first decision comes from the habits of you two.
- Connectivity: 230 million internet users, 80.5% penetration ([DataReportal Digital 2026: Indonesia](https://datareportal.com/reports/digital-2026-indonesia), October 2025 data).

**WhatsApp** is almost certainly the main sharing channel, but there is no clean Indonesian figure. DataReportal doesn't publish a WhatsApp figure for Indonesia, and the Reuters Institute only measures use for news: up 13 percentage points to 56% ([DNR 2026 Indonesia](https://reutersinstitute.politics.ox.ac.uk/digital-news-report/2026/indonesia)). The 93% (MEF) and 65% (Statista) figures are only search snippets: `[UNVERIFIED]`. This document doesn't quote a WhatsApp percentage.

**Moments of use** (derived from the research in §1.2 and the Indonesian vendor patterns in §2):

| Moment | Device | What is needed within seconds | Related features |
|---|---|---|---|
| On the sofa, the weekly session for two | Phone, sometimes a laptop | See "This week", decide what's hanging, update the budget | W3, W2, W13 |
| Meeting with a vendor | Phone, signal not necessarily good | Open the vendor notes, record the quoted price and the down payment, call or WhatsApp | W11, W12, W13 |
| Shopping for *seserahan* (ceremonial gifts) or supplies | Phone | Add an item, price, link; see the total | W9 |
| Wedding day | The coordinator's phone, not the couple's | A run sheet that opens without signal, vendor contacts | W20, W21 |
| Household routine | Phone | "Remember, motorbike tax next month", mark as paid | H3, H4 |

On the wedding day: in the study by [Massimi et al. (CSCW 2014)](https://www.microsoft.com/en-us/research/wp-content/uploads/2020/03/Real-but-Glossy.pdf), 15 couples recruited mainly in south-east England, many brides left their phones because everyone they needed to contact was there. So "wedding-day mode" is aimed at the person coordinating, not at the couple. The sample is small and doesn't cover an extended-family Indonesian wedding.

### 1.2 Why shared apps are used or abandoned: the evidence

| # | Finding | Source | What it means for Nestora |
|---|---|---|---|
| 1 | Households coordinate tasks through location and availability, and forget low-priority tasks. One person usually becomes the "coordinator". 8 households, 241 tasks | [Sohn et al., CSCW 2012](https://static.googleusercontent.com/media/research.google.com/en//pubs/archive/38230.pdf) | The best moment is "I'm out" or "I just remembered". Adding an item must be one step, with no required fields |
| 2 | 70.5% of 44 families use more than one calendar; 80% have an "awareness" calendar in a place they pass (the fridge). An online calendar for personal use can disrupt family coordination routines | [Neustaedter et al., ToCHI 2009](https://grouplab.cpsc.ucalgary.ca/grouplab/uploads/Publications/Publications/2009-CalendarCrucial.TOCHI.pdf) | The real opponents are WhatsApp, fridge notes, Google Calendar. A second app loses unless it's somewhere you pass. Don't be the source of truth for everything |
| 3 | Couples plan the wedding with spreadsheets, documents, to-dos, email, and want to involve people outside the couple (parents, siblings) | [Massimi et al., CSCW 2014](https://www.microsoft.com/en-us/research/wp-content/uploads/2020/03/Real-but-Glossy.pdf) | The real competitor is the spreadsheet. Give export and a read-only link, not a third account |
| 4 | Personal trackers get abandoned because of forgetting, the hassle of maintaining, skipping, or suspending. Within 3 months, 26% of users of financial tools quit, vs 44-45% for activity and location tools | [Epstein et al., UbiComp 2015](https://my.eng.utah.edu/~cs5540/au16/readings/PersonalInformatics-Epstein2015.pdf) | Money tracking lasts if the benefit is clear, but dies if input is a hassle. The data model must be small |
| 5 | Reminders support repetition but hinder habit formation; event-based cues help | [Stawarz et al., CHI 2015](https://research-information.bris.ac.uk/en/publications/beyond-self-tracking-and-reminders-designing-smartphone-apps-that/) | Tie use to events that already exist: the weekly session, finishing a call with a vendor. No streaks and badges |
| 6 | Household cognitive load: anticipating and monitoring tend to get stuck with one partner; deciding is more often done together | [Daminger, ASR 2019](https://inequality.hks.harvard.edu/publications/cognitive-dimension-household-labor) (finding from a search result summary because the page returned 403: `[UNVERIFIED]` against the main text) | A checkbox only supports "doing". What's expensive is remembering what has to be done. Templates and the "This week" screen answer that |
| 7 | Couples share data but expect privacy; ambiguity makes sharing feel natural | [Griggio et al., CHI 2019](https://www.cs.ubc.ca/labs/edapt/papers/griggio2019_2.pdf) | Show the state of the item ("paid Wednesday"), not people's behaviour ("last opened the app 3 days ago") |
| 8 | Chore-management apps get installed when overwhelmed, and fail when seen as the sole solution; notifications about inequality provoke defensiveness | [Petriglieri, MIT SMR 2019](https://sloanreview.mit.edu/article/hacking-inequality-at-home) and [MIT Technology Review 2022](https://www.technologyreview.com/2022/05/10/1051954/chore-apps/) (practitioner and journalistic writing, not a controlled study) | The adoption trigger (the wedding) already exists. The risk is one partner feeling "managed". Don't assign with notifications |
| 9 | Repeated notifications for the same thing make people turn off all notifications | [Apple HIG: Notifications](https://developer.apple.com/design/human-interface-guidelines/notifications) | At most one rare, specific nudge |
| 10 | Onboarding tutorials don't improve task performance; users rarely change defaults | [NN/g onboarding](https://www.nngroup.com/articles/mobile-app-onboarding/), [NN/g defaults](https://www.nngroup.com/articles/the-power-of-defaults/) | No tour and no wizard. The first open already contains templates that can be deleted |
| 11 | Habit formation takes 18 to 254 days, very variable | [Lally et al., 2010](https://api.crossref.org/works/10.1002/ejsp.674) | Enthusiasm from the third to the eighth week will drop. The app has to be useful without a daily habit |

What was **not** found (don't treat as fact): a study comparing "assign vs claim" in couple apps; a study of a "who changed what" feed; a study of Indonesian couples on wedding technology. Principles in §1.3 that rest on those are inference, and are marked as such. The popular statistic "25% of apps are used once" has no primary source found: `[UNVERIFIED]`.

### 1.3 Principles

1. **Capture is the product.** One input on the first screen, one tap to save, no required fields. (Evidence 1, 4)
2. **Two equal people.** Both can add, change, complete. No admin. (Evidence 6; [Frampton et al., CHI 2026](https://orca.cardiff.ac.uk/id/eprint/185455): most family management tools are oriented to a single user, `[UNVERIFIED]` because it's only from a search summary)
3. **Default items are unassigned.** Anyone can "take" one with one tap. No assignment notification. Agreed as the default (decided #3). Inference from evidence 6 and 8. The Carlson 2025 study saying per-task sharing feels fairer is `[UNVERIFIED]` (unpublished, reported by health media) and isn't used as a basis.
4. **Show state, not behaviour.** "Paid by Partner B, Tuesday" is fine. "Partner B hasn't opened this" is not. Everything is visible to both partners; there are no private items (decided #4). (Evidence 7)
5. **Nudges that are rare, specific, and tied to events.** Priority: the "This week" screen, then the "Add to calendar" button, then one weekly digest. Sharing to WhatsApp is triggered by the user, not sent automatically. The channels follow what the couple look at: WhatsApp, Gmail, Google Calendar and Google Keep (decided #6; §5.1, §6.3). (Evidence 5, 9)
6. **No onboarding.** Task templates are already filled in and can be deleted. (Evidence 10)
7. **Own little, interoperate for the rest.** Calendar, shopping list, vault: hand them off, connect through `.ics`, links, CSV. (Evidence 2, 3)
8. **Undo everywhere.** Soft delete and a "recently deleted" screen, because two people edit the same data. ([NN/g 10 heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/): users often perform actions by mistake and need a clear way out; [Apple HIG undo](https://developer.apple.com/tutorials/data/design/human-interface-guidelines/undo-and-redo.json))
9. **Data can be taken away.** JSON and CSV export from day one. Too many couple and household apps die or change owners (§5.4).
10. **Indonesia-first, English UI.** Whole rupiah, date `6 Oct 2026`, Hijri as an approximate display and WhatsApp for sharing; the interface text itself is English (§5.7).

### 1.4 Weekly-use test

Every recommended feature must pass one of three:

- **Weekly:** there is a real reason to touch it every week (e.g. budget, "This week", bills).
- **Dense-temporary:** touched almost every week within a clear 4 to 8 week window (e.g. the KUA process, the rundown approaching the wedding day).
- **High-value redemption:** rarely used, but when needed there is no replacement (e.g. the *amplop* ledger when invited to a *kondangan* (a wedding you attend as a guest)).

Features that don't pass go on the "not built" list (§8). The tables in §3 and §4 list the trigger in the Value column.

---

## 2. Landscape

### 2.1 International wedding planners

All the big products are free for couples. The money comes from vendors (ads, leads) and registry/stationery, so the couple is the product.

| Product | What | Money model | Collaboration and export | Source |
|---|---|---|---|---|
| The Knot | US marketplace with free tools: checklist, budget, guest list/RSVP, vendors, website, registry | Vendors and registry; the Knot group is owned by Permira and Spectrum Equity | CSV export exists but "needs cleaning up" (competitor source); no public API found | [App Store](https://apps.apple.com/app/id457941553), [Wikipedia: The Knot Worldwide](https://en.wikipedia.org/wiki/The_Knot_Worldwide), [Paperlust](https://paperlust.co/blog/wedding-website-builders-compared/) (a stationery seller, biased) |
| WeddingWire | US vendor directory + free tools | Vendors pay for listings; owned by Knot Worldwide | No public API; according to a third-party audit all WeddingWire "APIs" are unofficial scrapers | [weddingwire.com](https://www.weddingwire.com/), [Supergood](https://supergood.ai/api-report-card/weddingwire) |
| Hitched | UK planner with a supplier marketplace | Bought by Knot Worldwide from Immediate Media on 3 February 2020 | Not found | [Knot Worldwide press release](https://www.theknotww.com/press-releases/theknotworldwide-hitched-acquisition) |
| Zola | Registry-first, plus website, guest list, budget, checklist | Registry commerce, stationery. Core planning is free | One couple per account: the partner only has "view access"; only the account holder can move the cash fund. Spreadsheet import exists | [Zola FAQ](https://www.zola.com/faq/115002422171), [Zola planning](https://www.zola.com/wedding-planning), [Zola import](https://www.zola.com/faq/360038289992-How-do-I-add-guests-from-a-spreadsheet-to-my-guest-list-) |
| Joy | Website-first, free | "We make money when guests purchase items couples add to their registry that Joy sells" | Free includes "multiple editor accounts". Guest list CSV import and export documented | [Joy pricing](https://withjoy.com/pricing/), [Joy export](https://withjoy.com/help/en/articles/8309207-importing-and-exporting-your-guest-list) |
| Bridebook | UK app: checklist, budget, guest list, venue search | "every couple can use Bridebook completely free"; suppliers pay for packages | Invite your partner through a link | [Bridebook help](https://support.bridebook.com/en/support/how-much-does-bridebook-cost), [partner invite](https://support.bridebook.com/en/support/invite-your-partner-to-join-your-wedding-planning) |
| Aisle Planner | Software for event professionals (clients, proposals, invoices), not for couples | Subscription from $49.99/month | n/a | [aisleplanner.com/pricing](https://www.aisleplanner.com/pricing) |
| Appy Couple | Website and native app + RSVP + guest photos | Price not stated | n/a | [appycouple.com](https://appycouple.com/) |

Structural notes:
- Of all the couple-facing products, only Joy is verified to have a full CSV export for the guest list. None exposes a public API for couples. Budget export is hardly documented (only a 2019 WeddingWire forum mentions a "Download" button: [thread](https://www.weddingwire.com/wedding-forums/printing-my-invite-list-and-budget/b685bfcf5c413105.html), possibly outdated).
- Vendor controversy: a US senator accused The Knot of charging vendors for fake leads, and The Knot denied it and said it is "reducing spam and ghosting" ([AOL, 29 October 2025](https://www.aol.com/articles/republican-senator-wants-investigation-popular-145815916.html), [follow-up release 13 May 2026](https://capitolreleases.com/releases/899033c7-10e9-4436-9139-0ff5bf1b6782)). This is an allegation, not a ruling.
- The only "offline" claim found, from WeddingHappy ("No network connection required for almost everything"), is `[UNVERIFIED]` (the store page failed to load).

### 2.2 Spreadsheet templates, Notion, Trello, Airtable

| Template | Contents | Source |
|---|---|---|
| Notion "Big Day, Big Plans" (10 templates) | Guest list, seating, budget, wedding-day timeline, vendors, RSVP | [Notion](https://www.notion.com/en-gb/templates/collections/big-day-big-plans) |
| Trello, 5 official boards | To-dos per lead time, wedding-day timeline, wedding party, seating, thank-you | [Atlassian](https://www.atlassian.com/blog/trello/guide-to-planning-a-wedding-with-trello) |
| Airtable "Wedding planning" | 5 tables: guests, seating, vendors, supplies/costs, venue; calendar and timeline | [Airtable](https://www.airtable.com/templates/wedding-planning/expxNBai7rjuqdJ06) |
| Paid Notion (Contra, $27) | 19 sections including a payment tracker, a 12-month checklist | [Contra](https://contra.com/products/uZSPwsLK-notion-wedding-planner-template-or-budget-timeline-and-checklist) |
| Paid Notion (notioneverything, $20) | Budget, guests, vendors, countdown, night-before checklist | [notioneverything](https://www.notioneverything.com/templates/wedding-planner-template) |
| Free Google Sheets/Excel, 10 tabs | Budget, guests, vendors, checklist, wedding-day schedule, stationery | [weddingplanningspreadsheet.com](https://weddingplanningspreadsheet.com/) |

**The same pattern in all templates:** budget, guest list/RSVP, vendors, checklist per lead time, wedding-day timeline, seating, payments. Additions that often show up: playlist, invitation tracker, thank-you tracker, the night before.

**One person's experience planning a wedding with a spreadsheet:** the app was "fine" but abandoned within a week; the spreadsheet suits "a lot of moving parts, a fixed deadline, and real money on the line" ([Spreadsheet Point](https://spreadsheetpoint.com/i-planned-my-entire-wedding-with-spreadsheets/), the author may sell spreadsheet content). One person, not data.

### 2.3 Indonesian products

| Product | What | Serves | Money model | Source |
|---|---|---|---|---|
| Bridestory | Vendor marketplace + app; Bridestory Pay (instalments); since September 2025 "SayYes RSVP" (RSVP, QR check-in) | Couples and vendors | Vendors on Silver/Gold subscriptions; bought by Tokopedia in 2019 | [App Store](https://apps.apple.com/id/app/bridestory-wedding-app-hilda/id1067262519), [version 3.17.3](https://apps.apple.com/id/app/bridestory/id1067262519), [KrASIA](https://amp.kr-asia.com/bridestory-and-life-after-tokopedias-acquisition-startup-stories), [vendor plans](https://business.bridestory.com/id/blog/mengenal-vendor-subscription-plan-di-bridestory) |
| Weddingku | Vendor directory + content, since 2002 | Couples (browsing) and vendors | Vendors pay for the Gold package Rp13,320,000/year, Diamond Rp27,750,000/year; ads | [weddingku.com](https://www.weddingku.com), [partner.weddingku.com](https://partner.weddingku.com). Checklist/budget tools not found on the pages opened |
| Wevitation | Digital invitations + an "Event Planner" module (Budget Planner, To-Do, Vendors, Timeline), guest QR, digital gifts | Couples and guests | Free (limited); Premium Rp69K and Business Rp99K one-time payment. The planner module is only in the paid plans | [wevitation.com](https://wevitation.com) |
| invi.id | Invitations, digital envelopes, guest book, PDF/Excel export of guest messages | Couples, resellers | Rp99K and Rp149K per year | [invi.id](https://invi.id) |
| SebarUndangan, Menica, Ze Guest Management, Pentamoo, Digitation | Invitations + WhatsApp RSVP + QR check-in + digital guest book | Couples and organisers | Varies; Ze starts at Rp300,000 | [SebarUndangan](https://sebarundangan.id), [Menica](https://menica.pro), [Ze](https://zeinvitation.com), [Pentamoo](https://pentamoo.id), [Digitation](https://one.digitation.id/) |

Findings:
- An Indonesian App Store search for "wedding planner indonesia" shows no Indonesian developer in the top 9 results ([query](https://itunes.apple.com/search?term=wedding%20planner%20indonesia&country=id&entity=software&limit=15), a single query). Indonesian media articles recommend foreign apps: [Kumparan, 17 April 2026](https://kumparan.com/how-to-tekno/5-aplikasi-wedding-planner-untuk-memudahkan-persiapan-acara-27E12z0bbmC), [Beautynesia 2021](https://www.beautynesia.id/life/8-aplikasi-populer-yang-wajib-didownload-untuk-bantu-persiapan-pernikahan/b-211274).
- Digital invitations, WhatsApp RSVP, QR check-in and digital envelopes are already well served by dedicated platforms. Building them ourselves has no strong reason (see §8).
- No tool was found that records **incoming and outgoing *amplop* as a reciprocal ledger**, even though the practice is real (§3, W25).
- No Indonesian source was found about using Google Sheets, Notion or WhatsApp groups for planning (see Gap).

### 2.4 What users like and complain about

Warning: reviews lean toward registry, shipping and vendors. Couples discussing pure planning tools are rare.

| Product | Like/Complaint | Theme | Source | Content |
|---|---|---|---|---|
| Joy | Like | No upsell, simple | [Trustpilot Joy](https://www.trustpilot.com/review/withjoy.com) | "The website is quite robust, and doesn't push a million products on you" (September 2026) |
| Joy | Like | Guest list and RSVP can be tuned | [Trustpilot Joy](https://www.trustpilot.com/review/withjoy.com) | "I love the guest list management and RSVP form customization" (August 2026) |
| The Knot | Like | Everything in one place | [App Store](https://apps.apple.com/app/id457941553) | A reviewer calls it "an all-in-one planning tool" |
| The Knot | Complaint | Guest data lost | [Trustpilot Knot](https://www.trustpilot.com/review/theknot.com?stars=1) | "Lost all menu choice guest data right before the wedding" (August 2026) |
| The Knot / WeddingWire | Complaint | Lead spam (vendor side) | [AOL](https://www.aol.com/articles/republican-senator-wants-investigation-popular-145815916.html), [Trustpilot WeddingWire](https://www.trustpilot.com/review/weddingwire.com) | Vendors claim fake leads from bots |
| WeddingWire | Complaint | Couples blocked for sending to many vendors | [forum](https://www.weddingwire.com/wedding-forums/ww-spam-blocked-me/bbdd14f7e14540be.html) | A 2019 thread; outdated |
| Zola | Complaint | Rigid guest groups | [App Store](https://apps.apple.com/us/app/zola-wedding-planner/id852691916) | Couples are always invited together (paraphrase) |
| Joy | Complaint | Thin budget/checklist | [App Store](https://apps.apple.com/us/app/joy-wedding-app-website/id994411720) | One negative review theme (contradicts Joy's material, depth `[UNVERIFIED]`) |
| Bridestory (iOS) | Like | Inspiration, vendor reach | [Apple review feed](https://itunes.apple.com/id/rss/customerreviews/id=1067262519/sortBy=mostRecent/json) | "This app is very complete, easy to use and very useful" (July 2023, translated from Indonesian) |
| Bridestory (iOS) | Complaint | Crashes, slow, login fails | same | The most frequent theme in the 46 latest reviews (the researcher's count, the sample leans toward old reviews, not representative): "The app is SLOW, just keeps loading and ends in ERROR" (2021, translated from Indonesian) |
| Bridestory (iOS) | Complaint | No checklist/budget | same | "No wedding checklist, no budgeting etc...vendors are expensive" (August 2020) |
| Honeydue | Like | Reminders better than a shared note | [App Store](https://apps.apple.com/app/id1157633945) | "huge step up from sharing a note in my iPhone because we get reminders" |
| Honeydue | Complaint | Transaction sync, support gone | same | "the support team seems to have gone completely dark" |
| Splitwise | Complaint | Daily limit on the free tier without notice | [Trustpilot](https://www.trustpilot.com/review/splitwise.com?page=2) | Reviews from December 2023 to July 2024: a daily entry limit, a 10-second delay. No official announcement found |
| Money Lover | Complaint | Export is hard even after paying for premium | [Apple ID review feed](https://itunes.apple.com/id/rss/customerreviews/id=486312413/sortBy=mostRecent/json) | "useless premium can't export to google sheet" (May 2026) |
| Money Lover | Complaint | No link to BCA | same | "Please connect it to BCA (bank cetral asia) indonesia" (July 2025) |
| Google Keep | Complaint | Sync and data loss in shared lists | [App Store](https://apps.apple.com/us/app/google-keep-notes-and-lists/id1029207872) | Collaborator updates don't show up; notes duplicate or disappear |
| Wanderlog | Complaint | Forced trial | [Trustpilot](https://www.trustpilot.com/review/wanderlog.com) | "Forced free trial which I'm not interested in." (August 2026); 51 reviews, a small sample |
| Chore apps | Complaint | Adds work for the manager, feels like parenting your partner | [MIT Tech Review](https://www.technologyreview.com/2022/05/10/1051954/chore-apps/) | "It doesn't solve the problem: that you're nagging someone else or parenting your partner." |
| Tody | Like | Reduces decision fatigue | [App Store](https://apps.apple.com/us/app/tody-easy-house-cleaning/id595339588) | "It has helped me to only focus on what's right in front of me." |

**Recurring themes:**
- **Like:** one place for everything; simple without upsell; specific reminders; control over guests/RSVP; a "last done/coming due" view.
- **Complaint:** upsell and paywalls; data loss and broken sync; locked export; vendor spam; crashes and failed login; forcing one partner to be the manager.

### 2.5 Complaints of Indonesian couples

Jakpat, 26-30 June 2025, 798 respondents planning to marry ([Katadata](https://databoks.katadata.co.id/en/demographics/statistics/689acb7c92057/budgeting-the-hardest-part-of-wedding-planning)): budget is the hardest thing for 64%, balancing family obligations 55%, family/friend pressure 45%, administrative and legal matters 32%, communication with the partner 30%. Source of funds (Jakpat, [Katadata](https://databoks.katadata.co.id/en/demographics/statistics/689bf39a83b02/ideal-wedding-budget-according-to-indonesian-youth)): 45% personal savings, 40% joint savings.

Other points from Indonesian articles:
- **Spending drifts off:** a 2017 Bridestory survey found only 49.1% of respondents managed to keep to the budget ([report](https://business.bridestory.com/blog/2017-indonesia-wedding-industry-report-by-bridestory1520393557); the respondent base was Bridestory users).
- **Extra guests and portions:** one invitation can become 2-4 people; catering rules vary, some suggest 2x the invited guests ([Antara, 29 July 2024](https://www.antaranews.com/berita/4224291/cara-hitung-biaya-katering-resepsi-pernikahan)), some 2.5x ([Mojok, 2021](https://mojok.co/terminal/makanan-catering-adalah-tolok-ukur-kesuksesan-hajatanmu-jangan-disepelekan/)). So the multiplier has to be adjustable by the couple themselves.
- **Family interference:** common advice is to align with your partner first, open the budget to those who help pay, split invitation slots per family, and write down the agreement ([IDN Times](https://www.idntimes.com/life/relationship/cara-hadapi-keluarga-terlalu-ikut-campur-persiapan-nikah-c1c2-01-zn5b2-d3brgs)).
- **Arguments:** an uneven division of tasks is named as one trigger ([Popbela, 17 February 2026](https://www.popbela.com/relationship/married/kenapa-pasangan-sering-bertengkar-saat-persiapan-pernikahan-00-ck827-w0vs7y)).
- **WO fraud:** a consumer body calls problematic WO cases an "iceberg phenomenon" because victims don't know where to report ([Kontan, 9 December 2025](https://nasional.kontan.co.id/news/ylki-soroti-lemahnya-perlindungan-konsumen-dalam-kasus-wedding-organizer-bermasalah)). A strong reason to keep contracts, payment proof and the schedule.
- **Amplop as social debt:** reciprocal wedding contributions feel like a "social debt" ([Mojok](https://mojok.co/liputan/harian/sumbangan-pernikahan-di-jogja-bikin-nelangsa-dan-menderita/)); named envelopes form an informal "social ledger" ([Hipwee](https://www.hipwee.com/feature/7-filosofi-di-balik-tradisi-ngamplop-di-indonesia-biar-nggak-pusing-lagi-kalau-mau-kondangan/)). No tool was found that records it.
- **Price first:** according to Bridestory's internal data for the first half of 2026, "70.13% of business leads come from viewing or asking for price information" ([Bridestory Business Insight](https://business.bridestory.com/id/blog/bridestory-business-insight-januari-juni-2026)). That is vendor-side data, but consistent with the need to compare quotes.

**Sample warning:** the Bridestory survey represents its own users (2025: 94.3% Greater Jakarta). They report a typical budget of Rp250-500 million, while Jakpat's national panel shows Rp50-100 million ([Bridestory 2025](https://business.bridestory.com/id/blog/bridestory-wedding-trend-survey-report-2025), [Katadata](https://databoks.katadata.co.id/en/demographics/statistics/689bf39a83b02/ideal-wedding-budget-according-to-indonesian-youth)). Don't use one figure as "normal".

### 2.6 Couple and household apps (brief, detail in §4)

| Category | Verified examples |
|---|---|
| Shared money | Honeydue (syncs via Plaid; not on the Indonesian App Store), Splitwise, YNAB, Monarch, Goodbudget |
| Savings | Bank Jago Kantong Bersama, blu bluGether |
| Shopping lists | AnyList, OurGroceries, Bring!, Google Keep |
| Household chores | Tody, Sweepy, Cozi |
| Calendar | Google Calendar, Apple Calendar, TimeTree, Cozi |
| Documents | Bitwarden (encrypted attachments, emergency access), Google Inactive Account Manager |
| Home and mortgage | Rumah123 and BCA mortgage simulations, HomeZada |
| Travel | Wanderlog, TripIt |
| Memories and relationships | Day One, Between, Paired, Gottman Card Decks |

Evidence and sources per category are in §4.

### 2.7 Plausible gaps (inference)

- **One private place for two people** that combines tasks, vendors, payment schedule, guests and rundown. The tools above split this across 3-4 apps, or lock it in paid plans.
- **The KUA process as a conditional checklist with deadlines counted back from the *akad* (marriage contract ceremony) day.** No product found that does it. A weak reason: one may exist and just be out of this search's reach.
- **The *amplop* ledger and family occasions** as a reciprocal ledger.
- **Self-owned data:** full export, no paywall, no daily limit.

All these gaps should be treated as hypotheses to check with you two (§8), not as market findings.

---

## 3. Wedding feature catalogue by phase

All deadlines are counted back or forward from **H** = the *akad* day. Working days (HK) are written `HK`. The **Value** column names the trigger for use (see the test in §1.4). The `kind` names in the Data column refer to the model in §7. Effort and Platform use the legend in the "How to read" section.

### 3.1 Phase 0: Basics (H-12 months and onward)

| ID | Feature | Value (trigger) | Effort | Data | Platform |
|---|---|---|---|---|---|
| W1 | **H-day and countdown.** The *akad* date, time zone, countdown, the approximate Hijri date next to it | One number that makes every deadline relative. Visible every time the app opens | S | `settings`: *akad* date (`YYYY-MM-DD`), IANA zone, Partner A/B labels | client |
| W2 | **Task timeline from a template** with offsets from H. Tasks can be changed or deleted. One tap for "I'll take it". A "needs a decision" flag | Weekly. An app that remembers what has to be done reduces the load of anticipating (§1.2 #6) | M | `task`: title, `due_on`, `done_on`, `who` (empty = anyone), `group_key` (phase), note, decision flag | D1 + static template file |
| W3 | **The "This week" screen.** Tasks due or late, payments in the next 7 days, hanging decisions, document renewals | The anchor of the weekly sofa session. The only "reminder" that needs no infrastructure | S | Queries over `task` and `doc` items and the `payment` rows of `budget_entries` | client |
| W4 | **Agreement notes.** Important decisions: what, who agreed, when, the reason | Common advice for family conflict is to write down the agreement ([IDN Times](https://www.idntimes.com/life/relationship/cara-hadapi-keluarga-terlalu-ikut-campur-persiapan-nikah-c1c2-01-zn5b2-d3brgs)). Used when there's a "what did we say back then" argument | S | `note`: title, body, date, `who` | D1 |

### 3.2 Phase 1: Marriage administration (roughly H-3 months to H+7 HK)

Applies to Muslim couples who marry through the KUA. The civil route (non-Muslim) is recorded at Dukcapil (the civil registry) and reported at the latest 60 days after the marriage ([Law 23/2006 Article 34(1)](https://pasal.id/peraturan/uu/uu-no-23-tahun-2006), text from a third-party site; [Detik, 31 March 2026](https://news.detik.com/berita/d-8423682/syarat-dan-cara-urus-akta-kelahiran-akta-perkawinan-dan-akta-kematian) repeats that rule). The civil route is not modelled here.

| ID | Feature | Value (trigger) | Effort | Data | Platform |
|---|---|---|---|---|---|
| W5 | **Conditional KUA checklist.** The list of steps and documents from §3.8, deadlines counted back from H. Extra documents show up depending on conditions (age, the *akad* location selected in W27, divorced/widowed, military/police, foreign nationals). Items whose rules differ between KUAs are marked "ask the KUA" with a notes column | Dense-temporary: two full months of activity, with deadlines that have real consequences | M | `task` from a template with rules (reading the W27 `settings` keys); ready status (bool), date, note. **No NIK number, no scans** | D1 + static template file |
| W6 | **Working-day calendar** to compute "10 HK before the *akad*". The list of national holidays and collective leave can be edited. Buffer warning: 10 HK is the legal minimum, not a realistic schedule | the definition of "working day" in the PMA and the treatment of collective leave were not found (§3.8). Holidays are set through the joint decree of 3 ministers (SKB) every year ([SKB 2026, Setneg](https://setneg.go.id/baca/index/inilah_skb_3_menteri_libur_nasional_dan_cuti_bersama_2026)) | S | `settings`: list of holiday dates (seeded yearly, filled in by hand) | static + client |
| W7 | **Prenuptial agreement route (optional).** Four tasks: decide, find a notary, sign, tell the KUA so it's recorded in the Deed and the *Buku Nikah* (marriage book) | The Constitutional Court allows an agreement to be made before, at, or during the marriage ([Decision 69/PUU-XIII/2015](https://www.mkri.id/public/content/persidangan/putusan/69_PUU-XIII_2015.pdf)); for Muslims it is made before a notary and recorded by the KUA ([PMA 30/2024 Articles 39-40](https://desakarangwuni.gunungkidulkab.go.id/assets/files/dokumen/PERMENAG-30-2024.pdf)). Not legal advice. In scope (decided #11); each of the four tasks can be hidden if the couple decide against it | S | `task` (4 items) | D1 |
| W27 | **Selectable *akad* location.** Two selectors, both starting as "not decided": **venue** = at the KUA or outside the KUA; **place** = the home sub-district of Partner A, of Partner B, or elsewhere (*numpang nikah*, marrying at a KUA away from home). A yes/no "we live in the same sub-district" is asked once. The selection drives (1) which items W5 shows (§3.8 step 3: the recommendation letter), (2) a seeded `planned` budget row for the registration fee in W13, and (3) the fee text (§3.8 step 10). While undecided, W5 shows each branch as "pending decision" and the fee row has no amount. The selection can be changed any time; the dependent items follow without losing ticks already made | Dense-temporary with a deadline: §3.8 step 1 says to decide early, and a wrong assumption either hides a required letter or misses the fee. The couple have not decided (decided #1), so the app must not assume | S | `settings`: `akad_venue` (`kua`/`outside`/empty), `akad_place` (`a_home`/`b_home`/`elsewhere`/empty), `same_subdistrict` (bool/empty). The fee row is a `budget_entries` `planned` row. Rule per selection: see the note below the table | client + D1 |

**W27 rules** (from §3.8; the fee is an editable seed). Fee: Rp0 for an *akad* at the KUA in working hours, Rp600,000 outside the KUA or outside working hours (§3.8 step 10); *numpang nikah* at a KUA does not change the fee rule as read there, an inference from the same step `[UNVERIFIED]`. Other costs of an *akad* outside the KUA (venue, and travel or lodging for *numpang nikah*) are not estimable from a source and stay empty for the couple to fill. Recommendation letter: PMA Article 17(2) requires a letter from the KUA of each partner's residence when the *akad* is held outside the domicile of the groom-to-be and bride-to-be, and Article 17(3) says one letter is enough when both live in the same sub-district (text read from the [PDF copy](https://desakarangwuni.gunungkidulkab.go.id/assets/files/dokumen/PERMENAG-30-2024.pdf)). So: place = elsewhere gives "letter from each residence's KUA, or one if `same_subdistrict`"; place = the home sub-district of one partner and the partners live apart is **ambiguous in the text** (does the other partner's KUA still issue a letter?), so W5 shows "ask the KUA" for it; both partners in the same sub-district and the *akad* there needs no letter.

### 3.3 Phase 2: *Lamaran* (formal engagement visit), *seserahan*, traditional ceremonies

| ID | Feature | Value (trigger) | Effort | Data | Platform |
|---|---|---|---|---|---|
| W8 | **Events** as a group: *lamaran*, *siraman* (pre-wedding bathing ritual), *midodareni* (Javanese eve-of-wedding ritual), *pengajian* (Quran recital gathering), *akad*, *resepsi* (wedding reception), *ngunduh mantu* (groom's family reception for the new bride), *tasyakuran* (thanksgiving gathering). A template that can be edited and deleted. Used as the `group_key` in tasks, budget, rundown | The structure of the budget and rundown follows the events. Which ones are used differs per family and region (*ngunduh mantu* is optional: [Popbela](https://www.popbela.com/relationship/married/perbedaan-resepsi-dan-ngunduh-mantu-00-925lr-2j6wk6)) | S | `settings`: list of events (name, optional date, zone) | client |
| W9 | **The *seserahan*/*hantaran* (a related term for the gift offering) list.** Name, price, purchase link, category, status (not yet/in progress/done), total | Weekly while hunting for items; used in the shop. From the original sheet (brainstorm §1.6) | S | `bridal_gift` item: title, `amount`, `data.url`, `group_key`, `status`, `who` | D1 |

*Mahar* (the groom's wedding payment) is not a separate feature: record it as a budget item or a note. PMA 30/2024 doesn't mention *mahar* ([PDF](https://desakarangwuni.gunungkidulkab.go.id/assets/files/dokumen/PERMENAG-30-2024.pdf), searched by grep by the researcher). The legal difference between *mahar* and *seserahan* could not be verified: `[UNVERIFIED]`.

### 3.4 Phase 3: Vendors and money (H-12 months to H-1 month)

| ID | Feature | Value (trigger) | Effort | Data | Platform |
|---|---|---|---|---|---|
| W11 | **Vendor book.** Category, status (option/confirmed/cancelled), contact, PIC, taps to call and WhatsApp, key contract facts (extra charges outside the contract, cancellation rules, emergency contact) | Vendor meetings and the wedding day. WO fraud rarely leads anywhere ([Kontan](https://nasional.kontan.co.id/news/ylki-soroti-lemahnya-perlindungan-konsumen-dalam-kasus-wedding-organizer-bermasalah)), so contracts and contacts must be easy to find. Mandatory questions to a WO: extra charges outside the contract, a backup plan ([Popbela](https://www.popbela.com/relationship/married/pertanyaan-wedding-organizer-00-vmqqn-l796gq)) | S | `vendor`: name, `group_key` (category), `status`, E.164 phone, PIC, `amount` (quoted price), contract link, note | D1 |
| W12 | **Quote comparison per category.** Several option vendors side by side, price first | Price is the entry point: 70.13% of Bridestory vendor leads come from viewing or asking for a price ([Bridestory](https://business.bridestory.com/id/blog/bridestory-business-insight-januari-juni-2026)); budget is the hardest thing for 64% of respondents ([Katadata](https://databoks.katadata.co.id/en/demographics/statistics/689acb7c92057/budgeting-the-hardest-part-of-wedding-planning)) | S | A view over `vendor` (grouped by `group_key`) | client |
| W13 | **Budget and payments.** Budget items per event (planned vs spent), payment rows (down payment, instalments, final settlement) with a due date and a payment date, remainder, "late" mark, a "next 7 days" list. Bridestory 2017 survey result: only 49.1% kept to the budget, so the gap between plan and actual needs to be visible | Weekly. Vendor payments are real money and real deadlines. The original sheet has no due date (brainstorm §1.4). The *akad* registration fee row is seeded from the W27 selection | M | `budget_entries` rows of type `planned` (title, `group_key` = event, planned `amount`, optional `vendor_id`) and `payment` (`budget_id` = the planned row, `status`, `amount`, `due_on`, `done_on`, `who` = payer) | D1 |
| W14 | **Wedding fund.** Target, deposits per person or source (Partner A, Partner B, parents, others), progress, "need to save Rp X per month" = (target minus collected) divided by months left | Weekly to monthly. 45% of Jakpat respondents fund from personal savings and 40% from joint savings ([Katadata](https://databoks.katadata.co.id/en/demographics/statistics/689bf39a83b02/ideal-wedding-budget-according-to-indonesian-youth)), so recording per source is meaningful. Each partner holds money in several banks and one investment app, partly outside Nestora (decided #10), so the app only records contributions by hand and never reads a balance or names an account | S | `saving` (target, deadline) and `contribution` (`parent_id`, `amount`, `done_on`, `who`, `data.source` as free text) items | D1 |
| W15 | **Payment proof as a link** to Drive/Photos, not an upload. Upload to `R2` only later (see W15b in §7) | The trail for WO fraud and disputes. A link is cheap; upload needs R2 (§5.3) | S | `payment.data.link` | D1 |

### 3.5 Phase 4: Guests and invitations

| ID | Feature | Value (trigger) | Effort | Data | Platform |
|---|---|---|---|---|---|
| W16 | **One-table guest list.** Side (Partner A/B), category, name, number of people (pax), phone number, invitation status, note. Totals per side and category. **An adjustable catering portion multiplier** (the 2x or 2.5x rule differs between sources: [Antara](https://www.antaranews.com/berita/4224291/cara-hitung-biaya-katering-resepsi-pernikahan), [Mojok](https://mojok.co/terminal/makanan-catering-adalah-tolok-ukur-kesuksesan-hajatanmu-jangan-disepelekan/)). CSV import and export | Weekly in the invitation phase; the total drives the catering budget, which can be 40-60% of the reception budget ([Detik, 2020](https://finance.detik.com/perencanaan-keuangan/d-4892336/hitung-hitung-biaya-kawinan-apa-sih-yang-bikin-boros)). Digital invitation services and print are both supported (decided #8), so each guest carries an invitation channel (digital, print or both) that can be filtered and exported for a print vendor. No postal address field for now (open Q5 in §8.4) | M | `guest`: name, `who` (side), `group_key` (category), `qty` (pax), `data.phone` (whether guest numbers are stored at all is open, Q2 in §8.4), `data.channel`, `status`, note | D1 + client (CSV) |
| W17 | **Invitation tracker** with a "send via WhatsApp" button per guest (`wa.me/<number>?text=...`, [official format](https://faq.whatsapp.com/general/chats/how-to-use-click-to-chat/)) and a sent marker | Weekly while sending; the message is sent manually by the user, not automatically. For print invitations the same status is set by hand ("sent" = handed over or posted). If guest phone numbers are not stored (open Q2), the button opens WhatsApp's chooser (`wa.me/?text=`) and the user picks the contact | S | `guest.status` ("not yet/sent/confirmed/not coming") | client |
| W18 | **RSVP CSV import.** Results from a digital invitation service (or a form) come in as a CSV file. Flow: pick the file; the client reads it (UTF-8 with or without BOM; delimiter `,` or `;` detected); map columns (name, phone, status, confirmed pax, note; the mapping is remembered); **preview** matched, new and conflicting rows; apply. Match by normalised phone (E.164) when both sides have one, else by case-folded name within the same side. Sets `status` and `data.rsvp_qty`; never deletes a guest and never overwrites a note. Unmatched rows become new guests flagged "from import". Every row created or changed carries `data.import_batch`, so one import can be undone, and importing the same file twice changes nothing. Excel files are saved as CSV first (no spreadsheet library). Many services offer an export, e.g. invi.id ([page](https://invi.id)); the columns of the service the couple choose are not known yet (open Q5), hence the column mapping | Dense-temporary: the RSVP weeks, when re-typing every answer is the alternative. Decided #8. Confirmed pax (`rsvp_qty`) feeds the catering total in W16 next to the invited pax | M | `guest.status`, `guest.data.rsvp_qty`, `guest.data.import_batch`. Shares the CSV reader with X7 (§5.5) | client |

Whether Excel in an Indonesian regional setting saves CSV with `;` as the delimiter was not verified: `[UNVERIFIED]`; the detection covers both.
| W19 | **Read-only link** for parents or the WO: rundown, guest total, vendor contacts. A random token per link, revocable | Couples want to involve people outside themselves ([Massimi et al.](https://www.microsoft.com/en-us/research/wp-content/uploads/2020/03/Real-but-Glossy.pdf)). A privacy risk, so it's postponed and kept narrow. **Later option only** (decided #5): not built now | M | Token table (hash), scope per link | D1 + public endpoint |

### 3.6 Phase 5: Wedding day

| ID | Feature | Value (trigger) | Effort | Data | Platform |
|---|---|---|---|---|---|
| W20 | **Rundown per event.** Start and end time, activity, PIC, note, tick-off, "now/next" highlight. Opens **without signal** | Dense-temporary: opened repeatedly in the last two weeks and on the wedding day. For the coordinator, not the couple (§1.1) | M | `rundown`: `group_key` = event, `due_on` (date), `data` (start/end time), title, PIC, note, `done_on` | D1 + `client` (offline cache) |
| W21 | **Share the rundown and vendor contacts** as WhatsApp text (`wa.me/?text=`) or print. The text is already URL-encoded | The cheapest way to give the run sheet to the coordinator without a third account | S | A view over `rundown` and `vendor` | client |
| W22 | **Song list per moment** (entrance, *akad*, meal, closing) | Single-use but cheap. From the original sheet (brainstorm §1.11) | S | `song`: title, singer, `group_key` (moment) | D1 |
| W23 | **Night-before checklist** and things to bring | Static template | S | `task` from a template | D1 + static |

### 3.7 Phase 6: After the wedding (H+1 to roughly H+90)

| ID | Feature | Value (trigger) | Effort | Data | Platform |
|---|---|---|---|---|---|
| W24 | **Post-wedding admin checklist.** New KK, status change on the *KTP-el* (electronic ID card), BPJS (add spouse), tax status, bank/insurance/passport/STNK. Separated into **mandatory vs optional vs unclear** (§3.9) | Dense-temporary; continues into household | S | `task` from a template | D1 + static |
| W25 | ***Amplop* ledger, incoming.** Who gave, how much, at which event, notes. When invited to a *kondangan* later, see what they once gave (continues to H12) | High-value redemption. The practice is documented as reciprocal ([Goodnews from Indonesia](https://www.goodnewsfromindonesia.id/2021/11/24/fenomena-sosial-dan-eksistensi-tradisi-buwuhan-dalam-hajatan), [Hipwee](https://www.hipwee.com/feature/7-filosofi-di-balik-tradisi-ngamplop-di-indonesia-biar-nggak-pusing-lagi-kalau-mau-kondangan/)), and no dedicated tool was found. **Demand not yet validated; not a priority now** (decided #9), kept as an option for later | S | `gift`: giver name, `group_key` = event, `amount`, `done_on`, direction (incoming/outgoing) in `data`, note | D1 |
| W26 | **Closing out.** Remaining vendor bills, thank-you list, archive export (JSON + CSV + `.ics`) | Ends the wedding neatly and keeps a copy outside the app | S | A view over `payment`, `guest` | client |

### 3.8 Detail: the KUA process (basis of W5 and W6)

Legal basis: Minister of Religious Affairs Regulation (PMA) 30/2024 on Marriage Registration, issued 24 December 2024, in force 30 December 2024, revoking PMA 22/2024 ([BPK](https://peraturan.bpk.go.id/Details/321787)). The full text was read from a [PDF copy](https://desakarangwuni.gunungkidulkab.go.id/assets/files/dokumen/PERMENAG-30-2024.pdf). No replacement was found as of August-September 2026 ([Detik, 9 September 2026](https://www.detik.com/hikmah/khazanah/d-8656003/syarat-dan-alur-pendaftaran-nikah-terbaru-kemenag-2026), [Kemenag Kebumen, 3 September 2026](https://kebumen.kemenag.go.id/mau-menikah-ini-syarat-dan-tahapan-pendaftaran-nikah-di-kua-sesuai-pma-30-tahun-2024/)). This is not legal advice.

| Step | When | Documents/items | Source | Status |
|---|---|---|---|---|
| 1. Choose the KUA and the *akad* date; decide whether at the KUA or outside (the selectable fields of W27; undecided for now) | Early. The author's suggestion: three months or more before H (not a rule) | – | PMA Article 16 | Rule verified; timing is a suggestion |
| 2. Marriage cover letter from the *kelurahan*/*desa* (village office) | Before registering | Article 4(1)(a). The form codes N1-N4 are a local name, the PMA doesn't mention the codes | PMA; [SIMKAH](https://simkah4.kemenag.go.id/) mentions "N1-N4" | Verified. The RT/RW (neighbourhood heads) step is `[UNVERIFIED]` |
| 3. Marriage recommendation letter, if the *akad* is outside the home sub-district | Before registering at the KUA of the *akad* | Articles 4(1)(e), 17. One recommendation from the KUA of each residence; if both are in the same sub-district, one is enough. Which case applies follows the W27 selection; the case of an *akad* in one partner's own sub-district is ambiguous in Article 17(2) (rules under W27) | PMA | Verified; lead time `[UNVERIFIED]`; ask the KUA for the ambiguous case |
| 4. Health certificate from a health facility | Before registering. The Ministry of Health suggests an examination about 3 months before ([Ayo Sehat, 2018](https://ayosehat.kemkes.go.id/pentingnya-pemeriksaan-kesehatan-pra-nikah)) | Permenkes 2/2025 (Minister of Health Regulation) Article 28 ([PDF](https://jdih.kemkes.go.id/storage/documents/pdfs/2025permenkes002.pdf)). TT immunisation isn't mentioned in the current article; whether the KUA asks for a TT card `[UNVERIFIED]` | PMA 4(1)(f), Permenkes | Verified |
| 5. Register the intent to marry at the KUA or online through SIMKAH | At the latest **10 HK before the *akad***. Less than that: a sub-district head's dispensation letter or a stamped statement | Article 3 | PMA | Verified (full text) |
| 6. Come to the KUA after registering online | The SIMKAH page says at the latest 15 HK; the PMA text doesn't contain that rule | – | [SIMKAH](https://simkah4.kemenag.go.id/), [Kompas, 5 May 2026](https://cahaya.kompas.com/aktual/26E05112754390/cara-daftar-nikah-di-kua-2026-alur-online-offline-dan-biaya-resminya) | **Contradictory**, ask the KUA |
| 7. Marriage guidance (*bimwin*) | Mandatory for prospective couples (*catin*) who have registered; the certificate is a requirement for the marriage examination | Articles 5, 6(2)(d). Duration and schedule `[UNVERIFIED]` | PMA | Mandatory, verified |
| 8. Marriage examination | After *bimwin*; the groom-to-be, the bride-to-be, and the marriage guardian (*wali*) attend | Article 6 | PMA | Verified |
| 9. Complete missing documents | At the latest 1 HK before the *akad* | Article 7(2) | PMA | Verified |
| 10. Fee | Rp0 at the KUA on working days and hours. Rp600,000 if outside the KUA or outside working hours | PP 59/2018 (Government Regulation) Article 5 ([BPK](https://peraturan.bpk.go.id/Details/99855/pp-no-59-tahun-2018)); the amount is in an image appendix, so the figure is taken from Kemenag pages ([Purbalingga, August 2026](https://purbalingga.kemenag.go.id/dari-rumah-bisa-ini-alur-pendaftaran-nikah-melalui-simkah/), [SIMKAH](https://simkah4.kemenag.go.id/)) | PP, Kemenag | Verified; confirm with the KUA |
| 11. *Akad*; *Buku Nikah* and marriage card | Given right after the *akad*; if not possible, at the latest 7 HK | Article 38 | PMA | Verified (full text) |

**Conditional documents (Article 4(1)):** parent/guardian permission if under 21; a dispensation from the Court if under 19 on the *akad* day; a divorce or death certificate for divorced or widowed persons; permission from a superior for military/police; a polygamy permit decision; a separate list for foreign nationals (Article 4(2)-(3)).

**Not on the national list:** diploma, passport photo, *mahar*, NPWP (tax ID number). The photo requirement is a local practice (one Kemenag office mentions 4x6 cm and 2x3 cm, blue background: [Purbalingga](https://purbalingga.kemenag.go.id/mau-nikah-pahami-dulu-persyaratan-pendaftaran-nikahnya/)).

**Elsimil (BKKBN) is not a national requirement.** Not in the Article 4 list; BKKBN once asked local governments to make it mandatory for the cover letter ([Antara, 26 March 2024](https://www.antaranews.com/berita/4029018/bkkbn-minta-sertifikat-elsimil-jadi-syarat-surat-pengantar-menikah)); Kemendukbangga and Kemenag agreed to strengthen its use without a mandate ([Antara, 5 May 2026](https://www.antaranews.com/berita/5556837/kemendukbangga-kemenag-perkuat-elsimil-guna-cegah-perceraian)). Some blogs call it "mandatory" in 2026: contradictory, `[UNVERIFIED]`, treat as a local practice.

**SIMKAH:** the official online registration site is `simkah4.kemenag.go.id` (system name: Marriage Management Information System). Flow: create an account with email and OTP, choose "Register Marriage", fill in the data, upload documents, print the proof ([Kontan, 29 May 2023](https://nasional.kontan.co.id/news/cara-daftar-nikah-online-di-simkah4kemenaggoid-hubungi-nomor-ini-jika-terkendala), may have changed). Channel for complaints about unofficial charges: `simdumas.kemenag.go.id` ([Kompas](https://cahaya.kompas.com/aktual/26E05112754390/cara-daftar-nikah-di-kua-2026-alur-online-offline-dan-biaya-resminya)).

**Design implications (the author's suggestion, not fact):** keep "ask the KUA" as an item with a notes column, not a hard rule; conditional documents as simple rules in the template, reading the W27 selection and treating "not decided" as "show both branches"; all dates derived from H and editable; don't store document numbers or scans.

### 3.9 Detail: admin after the wedding (basis of W24)

| Item | Mandatory or optional | Deadline | Source | Status |
|---|---|---|---|---|
| *Buku Nikah* in hand | Prerequisite for all other items | Right after the *akad*, at the latest 7 HK | PMA Article 38 | Verified |
| New KK (new family) | Practically mandatory for BPJS, banks, etc. | No national deadline found; "30 days" only from one blog `[UNVERIFIED]` ([ITERA blog](https://blog.itera.ac.id/?p=8862)) | Dukcapil: [new KK](https://dukcapil.kemendagri.go.id/page/read/penerbitan-kartu-keluarga-baru-karena-membentuk-keluarga-baru) (photocopy of the marriage book, form F-1.02) | Requirements verified |
| Status change on the KTP-el | Data changes are recorded at the *Dinas* (local office) | Not found | Dukcapil: [KTP-el](https://dukcapil.kemendagri.go.id/page/read/penerbitan-ktp-el-baru-karena-pindah-perubahan-data-rusak-dan-hilang-untuk-wni) | Requirements verified |
| BPJS Kesehatan: add spouse | The spouse is a family member ([Perpres 82/2018 (Presidential Regulation) Article 5(1)](https://pasal.id/peraturan/perpres/perpres-no-82-tahun-2018), copy from a third-party site) | The deadline to add a spouse was not found (28 days there is for newborns, not spouses) | Perpres | Relationship verified; deadline `[UNVERIFIED]` |
| Tax: status K/0, K/1 | Handled through HR or DJP (tax office) | Timing rule `[UNVERIFIED]` | [PMK 101/2016 (Minister of Finance Regulation) with status "In force"](https://peraturan.bpk.go.id/Details/121096/pmk-no-101pmk0102016) at BPK | Regulation status verified; the rest is not |
| BPJS Ketenagakerjaan (heirs), passport, bank/insurance (beneficiaries), STNK, HR forms | Optional or per contract | Not found | – | All `[UNVERIFIED]` |
| SIAK-SIMKAH data integration | When active, the marital status at Dukcapil is updated automatically | Target completion November 2026, pilot at 2-3 KUAs in December 2026; until then KK and KTP-el are handled separately | [Dukcapil, 22 September 2026](https://dukcapil.kemendagri.go.id/blog/read/mencegah-fraud-identitas-interkoneksi-data-siak-dan-simkah-ditargetkan-tuntas-november-2026) | Target, not yet active |

Design suggestion: make this template tasks that can be hidden one by one, especially the KK and KTP-el items once the SIAK-SIMKAH integration is running.

---

## 4. Household feature catalogue (after marriage)

The question answered for each category: is it worth building in a private two-person app, or better handed off to an existing app. The criteria: passes the §1.4 test, existing apps are already good or free, privacy risk, and whether the hardest part (instant sync, bank integration, maps) can be done by a small app.

**A fact that decides many choices: US-style bank sync isn't available in Indonesia.**
- Plaid doesn't list Indonesia in its Link country list ([Plaid docs](https://plaid.com/docs/api/link/)); its institution coverage is the US and Canada ([Plaid institutions](https://plaid.com/docs/institutions/)). The absence of Indonesia is an absence from the list, not an explicit statement.
- Honeydue syncs through Plaid and is read-only ([CNBC Select, 26 March 2026](https://www.cnbc.com/select/honeydue-budgeting-app-review/)); an Apple search for its app id in the Indonesian storefront returned zero results on 6 October 2026 ([lookup](https://itunes.apple.com/lookup?id=1157633945&country=id)). Availability on Android in Indonesia was not checked.
- SNAP, Bank Indonesia's open API standard since 2022 (managed by ASPI since 1 September 2023), is a payment standard: transfers, balance checks, transaction history ([BI](https://www.bi.go.id/id/layanan/Standar/SNAP/default.aspx), [ASPI portal](https://apidevportal.aspi-indonesia.or.id/)). Whether an individual or an unlicensed app can call it is unclear: `[UNVERIFIED]`. Aggregators like Brankas sell APIs to developers and companies ([brankas.com](https://www.brankas.com/)).
- Local apps work around it with uploading statements, e-wallet screenshots, or logging through WhatsApp: [Finku](https://apps.apple.com/id/app/finku-budget-money-manager/id1587320325), [Sribuu](https://apps.apple.com/id/app/sribuu-budget-money-manager/id1542637665). Money Lover reviewers still ask for BCA integration (see §2.4).
- Consequence: a small app isn't behind on sync. The realistic routes are manual entry, CSV/statement import, or screenshot OCR.

### 4.1 Decision summary

| ID | Feature | Decision | One-line reason | Effort | Platform |
|---|---|---|---|---|---|
| H1 | Shared expenses (thin ledger) | **Maybe**, after H3/H2 | No bank sync; the highest risk of quitting because input is manual | M | D1, client (CSV) |
| H2 | Savings goal | **Build** (reuse W14) | The money is in the bank; the app only records progress | S | D1 |
| H3 | Recurring bills and obligations | **Build, small** | Payment happens in the official app; the gap is in the reminder | M | D1; cron or `.ics` for reminders |
| H4 | Document and vehicle renewals | **Build** (a variant of H3) | Annual tax, STNK every 5 years, driver's licence (*SIM*), passport, insurance | S | D1 |
| H5 | Shopping list | **Hand off** | Mature apps, free, instant sync | – | – |
| H6 | Meal plan | **No** | No evidence of an unserved weekly need | – | – |
| H7 | Recurring chores | **Maybe, small** | "Last done / due", no assigning | S (on top of H3) | D1 |
| H8 | Shared calendar | **Hand off** + `.ics` feed | Google Calendar is free and granular | S (feed) | D1 + public endpoint |
| H9 | Document vault | **Hand off the scans**; **build an index** | KTP/KK scans are the riskiest data | S (index) | D1 |
| H10 | Home, renovation, KPR | **Hand off** KPR; **reuse** the budget for renovation | Mortgage calculators already exist | S | D1 |
| H11 | Travel | **Hand off**; grouping for it is to be designed later | Wanderlog and Maps | S | D1 |
| H12 | People and occasions: birthdays, *kondangan*/outgoing *amplop*, *Lebaran* (Eid al-Fitr)/*mudik* (annual homecoming travel) | **Build, small, after validation** | No tool for reciprocal *amplop* found | S | D1 |
| H13 | Journal and memories | **Maybe**: a text timeline | The evidence points to data ownership, not a feature | S | D1 |
| H14 | Others (vehicle servicing, health, pets) | Servicing: fold into H3; the rest **no** | Not enough evidence of need | S | D1 |

### 4.2 Evidence per category

**H1 Shared expenses.**
- Splitwise: reviewers report a daily entry limit and delay on the free tier since December 2023 ([Trustpilot](https://www.trustpilot.com/review/splitwise.com?page=2)); no official announcement found. Honeydue: reviews mention transactions not refreshing and support gone "dark" ([App Store](https://apps.apple.com/app/id1157633945)).
- Zeta (a couple finance app): Acorns announced an asset acquisition on 24 June 2025 ([Acorns](https://acorns.com/learn/acorns-zeta-acquisition/)); the closing date of 9 May 2025 is only from a competitor blog `[UNVERIFIED]` ([Pocket Clear](https://pocketclear.app/blog/zeta-app-alternative-couples.html)).
- Goodbudget: manual entry and envelopes ([CNBC Select](https://www.cnbc.com/select/goodbudget-app-review/)).
- Epstein et al. (UbiComp 2015): financial tools last longer than activity tools, but manual upkeep is the main killer (§1.2 #4).
- **Suggestion:** start from "actual total this month per category" and "who paid what" for big shared expenses, not recording every coffee. Prepare CSV import/export. Don't chase bank sync; with several banks per partner (decided #10) it would be even less worth it.

**H2 Savings goal.** Bank Jago "Kantong Bersama" (shared pocket): invite another Jago user into one Kantong (pocket) with a goal; access roles "Can View, Can Use, or Can View and Use"; both people must have a Jago account ([Jago product summary](https://assets.jago.com/web-assets/public/riplay-umum-kantong-jago-new-logo.pdf)). At the end of December 2025 there were 40 million Kantong and Kantong Bersama grew 87% in a year ([BCA Sekuritas, 30 January 2026](https://bcasekuritas.co.id/en/latest-news/news/bank-jago-catat-adopsi-fitur-kantong-aplikasi-banking-capai-40-juta)). blu by BCA Digital has bluGether; Republika calls it saving "without having to open a joint account", Selular calls it a joint account, so its legal form is contradictory between sources ([Republika](https://ekonomi.republika.co.id/berita/tin053349/blu-by-bca-digital-menabung-kini-jadi-aktivitas-kolaboratif), [Selular, February 2026](https://selular.id/2026/02/blu-by-bca-digital-dorong-couple-budgeting-lewat-blusaving-dan-blugether/)). **Suggestion:** the app records progress (name, target, deadline, contributions, "need Rp X per month"). The money stays in the banks and the investment app the partners already use; Nestora records progress by hand and never reads balances (decided #10).

**H3-H4 Bills and renewals.** Honeydue reviewers like reminders compared with a shared note (§2.4). Payment is dominated by official apps with large user bases: PLN Mobile (4.8 from 178,385 ratings on the Indonesian App Store), Mobile JKN (4.78 from 388,838) ([PLN Mobile](https://apps.apple.com/id/app/pln-mobile/id1299581030), [Mobile JKN](https://apps.apple.com/id/app/mobile-jkn/id1237601115), snapshot 6 October 2026). Standalone bill-reminder apps on the Indonesian App Store have 0-1 ratings ([search](https://itunes.apple.com/search?term=tagihan+pengingat+jatuh+tempo&entity=software&country=id)): that could mean no demand or no distribution. The SIGNAL app (Samsat Digital Nasional, the national digital vehicle registration service) has 1.78 stars from 10,317 reviews ([search](https://itunes.apple.com/search?term=pajak+kendaraan+samsat&entity=software&country=id)). The STNK validity is five years ([Wikipedia](https://id.wikipedia.org/wiki/Surat_Tanda_Nomor_Kendaraan), secondary). **Suggestion:** a recurring table (name, amount, period or due date, who pays, "paid this period", next due). Don't detect subscriptions from transactions (needs bank aggregation).

**H5-H6 Shopping and meals.** AnyList (free core, Complete $9.99/year individual or $14.99 household: [App Store](https://apps.apple.com/us/app/anylist-grocery-shopping-list/id522167641)), OurGroceries ([App Store](https://apps.apple.com/us/app/our-groceries-shopping-list/id325851015)), and Bring! are already mature. Google Keep complaints about sync and missing items ([App Store](https://apps.apple.com/us/app/google-keep-notes-and-lists/id1029207872)) show how hard instant sync is. Losing an item in a shop aisle is costly. Mealime closes on 21 October 2026 and deletes personal data ([Mealime](https://www.mealime.com/closing)): an example of the risk of dependence. **Suggestion:** hand off; pick one app that has export.

**H7 Chores.** Tody uses an urgency-based "needs doing" model and is reviewed as reducing decision fatigue ([App Store](https://apps.apple.com/us/app/tody-easy-house-cleaning/id595339588)). Studies and coverage on chore apps: delegation adds work for the person who already manages, and feels like parenting your partner ([MIT Technology Review](https://www.technologyreview.com/2022/05/10/1051954/chore-apps/)). **Suggestion:** if built, only an H3 variant with "last done by, when" and the next due date. No points, rankings, or assigning with notifications. If it isn't maintained, hand off to Tody.

**H8 Calendar.** Google Calendar shares for free with five permission levels ([Google](https://support.google.com/calendar/answer/37082)). Facts for the `.ics` feed: Google can only add a calendar from a URL through a computer browser, not through the Android/iPhone/iPad app ([Google](https://support.google.com/calendar/answer/37100?hl=en)); the refresh interval is not published by Google (the "12-24 hours" figure is only from third-party blogs: `[UNVERIFIED]`). **Suggestion:** don't build a calendar UI. Provide a read-only feed (§6).

**H9 Document vault.** Bitwarden Premium: $1.65/month, 5 GB attachments, emergency access ([pricing](https://bitwarden.com/pricing/), [emergency access](https://bitwarden.com/help/emergency-access/)). Google Inactive Account Manager: up to 10 trusted contacts receive selected data after the account goes inactive ([Google](https://support.google.com/accounts/answer/3036546)). OWASP: file upload needs authorisation, random file names, storage outside the web root, signature validation ([cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)). The Director General of Dukcapil once asked the public not to upload population documents to social media ([Medcom, 10 May 2021](https://www.medcom.id/nasional/peristiwa/GbmqQ5Pb-jaga-kerahasiaan-dokumen-kependudukan-tak-perlu-diunggah-ke-medsos)); the claim of a 10-year penalty is only in a search snippet: `[UNVERIFIED]`. **Suggestion:** document scans in the vault you already have. The app stores an **index**: document name, physical location or vault, expiry date, who holds it, emergency phone number. No identity numbers.

**H10 Home, renovation, KPR.** Mortgage calculators already exist at [Rumah123](https://www.rumah123.com/kpr/simulasi-kpr/) and [BCA rumahsaya](https://www.bca.co.id/en/informasi/edukatips/2023/08/01/06/13/simulasi-kpr-dengan-mudah-di-rumahsaya). Rumah123 states the bank instalment limit as 30% of net salary: "Kemampuan Cicilan = (Gaji Bersih x 30%) - Cicilan Lain" ([Rumah123](https://www.rumah123.com/kpr/kemampuan-kpr/)). Renovation overrun is real in UK data: 38% of homeowners exceed the initial budget ([Houzz UK 2026 via InteriorDaily](https://www.interiordaily.com/article/9855002/uk-homeowners-cut-renovation-budgets-by-nearly-30/)); not Indonesian data and no source on Indonesian RAB (renovation budget plan) habits was found: `[UNVERIFIED]`. HomeZada is a big US-style suite ([homezada.com](https://www.homezada.com/)). **Suggestion:** hand off the mortgage calculator. Renovation or moving would reuse the budget and payment module from W13 in the one shared space, with almost no new code (§7); how its rows are grouped apart from the wedding is not designed yet (no project concept exists). Applies only when there's really a renovation.

**H11 Travel.** Wanderlog (free core; Trustpilot reviews 1.9 from 51 reviews, a small sample: [Trustpilot](https://www.trustpilot.com/review/wanderlog.com)). Google Trips was discontinued on 5 August 2019 ([MobileSyrup](https://mobilesyrup.com/2019/06/04/google-trips-shutdown-august-5-2019/)). **Suggestion:** hand off. Tasks and a budget for a trip are fine in the same space once it feels useful; grouping is to be designed later.

**H12 People and occasions.** Gift wishlists are handled by Giftster, Giftful, GoWish (free and mature: example [Giftster](https://apps.apple.com/us/app/giftster-the-family-wish-list/id478126039)). What wasn't found is a reciprocal *amplop* recorder: one app from a foreign developer, KnotNote, tried this niche and has 0 ratings ([App Store](https://apps.apple.com/id/app/knotnote-gift-money-diary/id6784234386)), and Arisan Ceria, which only draws winners, 2.13 from 8 reviews ([App Store](https://apps.apple.com/id/app/arisan-ceria/id6742703765)). *Arisan* itself is a rotating savings group ([Wikipedia](https://en.wikipedia.org/wiki/Arisan)), and Jago already has Kantong Arisan. No source was found confirming that Indonesian couples find it hard to track *kondangan* or *arisan*: `[UNVERIFIED]`. **Suggestion:** one small "people and occasions" table (who, event, date, amount in/out, note) plus birthday and wedding anniversary reminders. *Arisan* is handed off to a WhatsApp group or Kantong Arisan unless you two actually run one. **Validate with you two first** before building.

**H13 Journal and memories.** Day One has encryption and export ([dayoneapp.com](https://dayoneapp.com/)). Between changed owners: acquired by SoCar in 2018 ([The Bridge](https://thebridge.jp/2018/07/socar-acquires-vcnc)); according to Asiae, after entering Krafton and being merged into Thingsflow, its privacy policy changed and user messages were collected for AI research ([Asiae, 2022](https://view.asiae.co.kr/en/article/2022051815010915714), claim as per the article). Relationship content (daily questions, exercises) is already served by Paired ([paired.com](https://www.paired.com/)) and Gottman Card Decks, which a therapist calls "Genuinely useful. Free" as a complement ([practice blog](https://www.southdenvertherapy.com/blog/do-relationship-apps-work-therapist-review)). **Suggestion:** hand off the relationship content. Photos in a Google Photos or iCloud album. One text timeline ("us") with export is a few hours of work if wanted.

**H14 Others.** Vehicle servicing folds into H3 with one kilometre column (example app: [CARFAX Car Care](https://apps.apple.com/us/app/carfax-car-care/id552472249), US-focused). Health appointment and pet management: only telehealth apps found, no evidence of a shared need: `[UNVERIFIED]`. Annual *PBB* (property tax) was not researched: `[UNVERIFIED]`.

### 4.3 Worth a private two-person app vs better in an existing app

| Category | Verdict | Notes |
|---|---|---|
| Bills/renewals, savings goal, people and occasions, document index | **Private app** | Small tables, clear triggers, no integration needed |
| Shared expenses | **Maybe** | After the two above are stable; high risk of quitting |
| Chores | **Maybe, small** | A variant of recurring bills |
| Renovation or travel budget | **Reuse the budget module** | No new code if the model is generic (§7) |
| Shopping list, shared calendar, scan vault, mortgage calculator, itinerary, relationship content, wishlist | **Existing app** | Connect through links, `.ics`, or CSV |

---

## 5. Cross-feature needs

### 5.1 Reminders and notifications

A ladder from the cheapest. Climb a rung only if the previous one proved insufficient. The couple look at WhatsApp, Gmail, Google Calendar and Google Keep (decided #6); the verdicts below follow that. Order of use: (1) the "This week" screen, (2) `.ics` for Google Calendar, (3) a user-triggered WhatsApp share, (4) a weekly Gmail digest, (5) Google Keep only through the phone's share sheet. Telegram and push drop to the bottom because the couple do not look at them.

| # | Channel | Infrastructure | Platform facts | Verdict |
|---|---|---|---|---|
| 1 | The "This week" screen (W3) | None | – | **Start here; built** as part of the Home screen: the lists "Late", "Due soon" and "No date yet" of "Our journey" (§7.3). The weekly session becomes the anchor (§1.2 #5) |
| 2 | "Add to calendar" button per item (`.ics` generated on the client, with a `VALARM` alarm) | None on the server | `VEVENT`/`VTODO` and `VALARM` are defined in [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html). The phone's calendar handles the reminder | **Second.** The cheapest replacement for push (brainstorm, backlog 1). Matches Google Calendar, a channel in use. The same on Android and iPhone because Google Calendar syncs per Google account |
| 3 | Subscribed `.ics` feed | Read-only endpoint | Google only accepts URL subscriptions through a computer browser; the refresh interval isn't published ([Google](https://support.google.com/calendar/answer/37100?hl=en)). Apple Calendar on Mac has an Auto-refresh menu ([Apple](https://support.apple.com/en-au/guide/calendar/icl1022/16.0/mac/26)); subscribed calendars are read-only | Later (§6). Don't promise instant sync |
| 4 | Share to WhatsApp (button, user-triggered) | None | The `wa.me/<number>?text=` format from the [WhatsApp FAQ](https://faq.whatsapp.com/general/chats/how-to-use-click-to-chat/). The text is filled in the chat; whether it is sent automatically is not confirmed (the FAQ is truncated): `[UNVERIFIED]`, test on a phone | A channel in use. Good for sharing the rundown and summaries, not for automatic reminders. W3 gets a "share this week as text" button, which also lets either partner send it to Google Keep through the share sheet (not tested; Keep as a share target on both phones `[UNVERIFIED]`) |
| 5 | Telegram bot from cron | Cron + secret | Bot messages are free; in a single chat avoid more than one message per second ([Telegram FAQ](https://core.telegram.org/bots/faq)). The user has to start a chat with the bot (inference; not checked in a document) | Not a channel the couple use (decided #6): dropped from the plan |
| 6 | Email digest | Cron + email | Sending to verified destination addresses is free on the free account on all plans; sending to arbitrary addresses is Paid only; Email Service is still Beta ([Email Routing](https://developers.cloudflare.com/email-routing/), [Email Service pricing](https://developers.cloudflare.com/email-service/platform/pricing/)). Whether the domain must be on Cloudflare: `[UNVERIFIED]` | A cheap option for a weekly digest, and Gmail is a channel in use (decided #6): the first digest channel. Both partners' addresses must be verified destinations. Whether those addresses are Gmail was not stated; the digest goes to the sign-in addresses either way |
| 7 | Web Push | Cron + VAPID + payload encryption | On iOS only for web apps added to the Home Screen, and permission is requested through a user interaction ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)). VAPID: [RFC 8292](https://www.rfc-editor.org/rfc/rfc8292.html); encryption: [RFC 8291](https://www.rfc-editor.org/rfc/rfc8291.html); the primitives are in Workers WebCrypto ([docs](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)) | Later, only if 1 to 6 fall short. Effort M. On the iPhone it works only after installing to the Home Screen, on Android also from the browser, so the two partners would get different behaviour |

**Cron limits on the free plan:** 5 Cron Triggers per account (counted together with other Workers in the same account), CPU 10 ms per run, runs in UTC ([limits](https://developers.cloudflare.com/workers/platform/limits/), [cron](https://developers.cloudflare.com/workers/configuration/cron-triggers/)). One weekly cron is enough for the digest. The day and time follow the weekly session, which is not decided yet (open Q1 in §8.4); as an example, Sunday 20:00 WIB (Western Indonesia Time) = 13:00 UTC.

**The nudge rule** (§1.3): at most one specific reminder tied to an event. Don't send a notification that only says "open the app". Apple HIG warns that users turn off all notifications if they are too frequent ([HIG](https://developer.apple.com/design/human-interface-guidelines/notifications)).

### 5.2 Search

One search box over all `items`, filtered on the client (`includes`, no search engine). The amount of data is only thousands of rows. Avoiding server-side search also avoids the D1 export limit: virtual tables like FTS5 aren't supported by `wrangler d1 export` and have to be dropped first ([D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)).
Effort S. Platform: client.

### 5.3 Attachments and photos

- **Start with a link column** to Drive/Photos (W15). Cheap, no new platform.
- **Upload needs R2.** Free: 10 GB-month, 1 million Class A and 10 million Class B operations per month, free egress ([R2 pricing](https://developers.cloudflare.com/r2/pricing/)). Enabling it goes through the "R2 subscription" checkout ([R2 get started](https://developers.cloudflare.com/r2/get-started/)). Whether a payment method is required isn't stated in the docs: `[UNVERIFIED]`. Brainstorm §3.2 concludes it is. Confirm with the account owner before depending on it (`docs/infra.md` §9.2).
- **Don't store files in D1.** The limit for one row, string, or blob is 2 MB ([D1 limits](https://developers.cloudflare.com/d1/platform/limits/)).
- **Shared album photos:** since 31 March 2025 the Google Photos Library API only accesses items created by the app itself ([Google](https://developers.google.com/photos/support/updates)). Picking the user's photos goes through the Picker API with a session and `pickerUri` ([guide](https://developers.google.com/photos/picker/guides/get-started-picker)). So photo albums stay in Google Photos/iCloud, the app only stores the link.
- **If upload is added one day** (payment proof, contracts): compress on the client, random file names, authorisation before access ([OWASP](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)), the `item` metadata holds SHA-256, mime, size. Effort L because it touches R2, signed access, and sync. This is what makes W15b (upload) postponed (§7).

### 5.4 Export and backup

**Reason:** couple and household products often shut down or change hands, with notice of roughly two to five months, sometimes without an export button.

| Product | What happened | Source |
|---|---|---|
| Mealime | Closes 21 October 2026; "All personal data will be deleted when the Mealime application is shut down." One third-party source says there is no export | [Mealime](https://www.mealime.com/closing), [Pann](https://www.pann-app.com/blog/is-mealime-shutting-down) |
| Zeta | Acorns announced an asset acquisition on 24 June 2025; the closing date of 9 May 2025 is only from a competitor blog `[UNVERIFIED]` | [Acorns](https://acorns.com/learn/acorns-zeta-acquisition/), [Pocket Clear](https://pocketclear.app/blog/zeta-app-alternative-couples.html) |
| Mint | Intuit shut down Mint and pointed to Credit Karma; announced 1 November 2023, closing pushed to 23 March 2024. The claim that budgets didn't carry over is only from a snippet: `[UNVERIFIED]` | [Wikipedia](https://en.wikipedia.org/wiki/Mint.com) |
| Google Trips | Discontinued 5 August 2019, replaced by Google Travel and Maps | [MobileSyrup](https://mobilesyrup.com/2019/06/04/google-trips-shutdown-august-5-2019/) |
| Wunderlist | Announced 6 December 2019, closed 6 May 2020, import to Microsoft To Do | [Wikipedia](https://en.wikipedia.org/wiki/Wunderlist) |
| Tuned (Meta) | Users were asked to download their data before 19 September 2022 | [Slashdot](https://tech.slashdot.org/story/22/07/25/2049239/meta-is-shutting-down-tuned-its-social-app-for-couples) |
| Couple (formerly Pair) | Inactive since 22 April 2019 | [Wikipedia](https://en.wikipedia.org/wiki/Couple_(app)) |
| OurHome | Discontinued; "The mobile apps are unavailable, and the website is not secure anymore." | [AlternativeTo](https://alternativeto.net/software/ourhome/about/) |
| Between | Changed owners in 2018, 2021, 2022; privacy policy changed according to Asiae | [The Bridge](https://thebridge.jp/2018/07/socar-acquires-vcnc), [Asiae](https://view.asiae.co.kr/en/article/2022051815010915714) |

**What the app provides** (built in stages; the first is S):
1. A "Download backup" button: **built** as links in Settings to the Worker's `GET /api/export` (the server reads all rows, so the download is complete and does not depend on what one phone has pulled): `export.json` (lossless) and one CSV per built kind and entry type. Effort S.
2. `calendar.ics` for dated items and `contacts.vcf` for vendors (§6). Effort S.
3. `database.sql` from `wrangler d1 export` as a disaster-recovery copy. This is a CLI command, not an API a Worker can call; while the export runs, other requests are blocked; numeric values are subject to JavaScript's 52-bit precision ([D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)).
4. As a safety net: D1 Time Travel restores the database up to 7 days on the Free plan and 30 days on Paid ([Cloudflare](https://developers.cloudflare.com/d1/reference/time-travel/)). Seven days isn't enough as an archive.
5. Keep one copy **outside Cloudflare** (a laptop or a personal Drive). Schedule it as a recurring "monthly backup" task in H3, so the app uses its own feature.

A model users already trust: Google Takeout can be scheduled every two months for a year ([Google](https://support.google.com/accounts/answer/3024190)).

### 5.5 Import

- **One-time from the old spreadsheet:** a script that reads the ODS and produces SQL; the data and its output are kept outside the public repo (brainstorm §7). This is not a product feature.
- **Generic CSV import:** one column mapping → `items` for the guest list (Joy and Zola offer something similar: [Joy](https://withjoy.com/help/en/articles/8309207-importing-and-exporting-your-guest-list), [Zola](https://www.zola.com/faq/360038289992-How-do-I-add-guests-from-a-spreadsheet-to-my-guest-list-)) and, later, expenses. The RSVP import (W18) is its first user. Normalise phone numbers to `+62...` (numbers are stored as numbers in the old sheet: brainstorm §1.8). Deduplicate by ID or a composite key. Effort S to M.
- **Bank statements:** BCA provides e-statements through myBCA, myBCA web, and KlikBCA ([BCA, 18 December 2025](https://www.bca.co.id/id/informasi/news-and-features/2025/12/18/09/09/Akses-Mutasi-Rekening-Kini-Lebih-Praktis-dan-Mudah)). The format for individual customers isn't stated, and other banks weren't checked: `[UNVERIFIED]`. Don't build a parser before there are real sample files.
- **Import from Splitwise, YNAB, Money Manager:** CSV export documentation wasn't found: `[UNVERIFIED]`. Splitwise and YNAB have APIs ([Splitwise](https://dev.splitwise.com/), [YNAB](https://api.ynab.com/)) but that is integration, not import. Not built.

### 5.6 Offline

The sync and offline design is in brainstorm §5 (a shell with a Service Worker, IndexedDB as the UI's data source, an `outbox` queue, IDs created on the client, `rev`-based pull). Here only the needs per feature:

| Needs offline reading | Needs offline writing |
|---|---|
| Rundown (W20), vendor book (W11), KUA checklist (W5), "This week" (W3), guest list (W16) | Quick capture: tasks (W2), payments ticked (W13), bills ticked (H3), the *amplop* ledger during the event (W25) |

The IndexedDB store and the outbox that give offline reading and writing are built; the service worker that lets the page itself open without signal is not (`docs/infra.md` §5.7), so offline start is not yet delivered. iOS facts that affect the design (verified in the brainstorm, not here): Home Screen web app data isn't deleted by the 7-day ITP rule ([WebKit](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/)); Background Sync isn't supported in Safari and Firefox ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API)), so the outbox is only sent while the app is open. Both phones must work equally (decided #2): the iPhone partner has to install the app to the Home Screen, because that is what keeps storage from being cleared by the 7-day rule and what enables push; the Android partner is unaffected. The total effort is on the platform side, not in the features.

### 5.7 Language, dates, money, and Hijri

The UI is English; this section only covers how Indonesian-context values are written. The results below were tested locally (Node v26.10.0, ICU 78.3). Target browsers may differ, so retest in Chrome Android and Safari iOS.

| Topic | Result / rule | Notes |
|---|---|---|
| UI language | English only. Every UI string is English, kept in one TypeScript file (no i18n library, no second language). Indonesian terms that have no English equivalent (*KUA*, *seserahan*, *amplop*, *akad*) stay as proper nouns, with a gloss on first use | The operator's decision. This is separate from the `Intl` locale below, which controls only how numbers and dates are written |
| Rupiah (the only currency for now, decided #10) | `new Intl.NumberFormat("id-ID",{style:"currency",currency:"IDR"}).format(600000)` produces `Rp 600.000` with a non-breaking space; no decimals. **Built** in `src/ui/format.ts` with the locale `en-ID` and `maximumFractionDigits: 0` (set explicitly, so the result does not depend on the ISO digits) | The compact format rounds (`59 jt` for 58,500,000), don't use it for money |
| ISO conflict | The ISO 4217 list (SIX, published 17 September 2026) lists IDR with **minor unit 2** ([list-one.xml](https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml)). MDN: currency formatting uses the ISO digits by default ([MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat/NumberFormat)). But the local test shows 0 decimals for IDR in `id-ID` | Don't guess the cause. The storage decision is in §6 |
| Date | `id-ID`: `6 Okt 2026` (medium), `6 Oktober 2026` (long), `Selasa, 06 Oktober 2026` (full), `06/10/2026`. `en-ID` (tested locally): `6 Oct 2026` (medium), `Tuesday, 6 October 2026` (full) | Official writing is usually day-month name-year or dd/mm/yyyy; the official rule wasn't found: `[UNVERIFIED]`. With an English UI, use `en-ID` so month and day names are English while the day-month-year order stays |
| Time | `12.00` with a period as the separator (`id-ID` and `en-ID`) | |
| Time zone | WIB (Western Indonesia Time) UTC+7, WITA (Central Indonesia Time) UTC+8, WIT (Eastern Indonesia Time) UTC+9, no DST ([Wikipedia](https://id.wikipedia.org/wiki/Waktu_di_Indonesia), secondary) | Store the IANA name (`Asia/Jakarta`, `Asia/Makassar`, `Asia/Jayapura`), not the abbreviation; abbreviations depend on the locale: `12.00 WIB`, `13.00 WITA`, `14.00 WIT` for the same instant |
| Hijri | Five Islamic calendars in the test runtime. For 6 Oct 2026: `islamic` 25, `islamic-umalqura` 25, `islamic-civil` 23, `islamic-tbla` 24, `islamic-rgsa` 25 *Rabiulakhir* (Rabi' al-thani) 1448 | A difference of up to 2 days for the same date. MDN lists `islamic-civil`, `islamic-tbla`, `islamic-umalqura` ([MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/supportedValuesOf)) but not `islamic-rgsa` |
| Start of Ramadan 1447 | `islamic-umalqura`, `-civil`, `-rgsa`, `islamic`: 18 Feb 2026; `islamic-tbla`: 17 Feb 2026 | A comparison of algorithms, not the official Indonesian date |
| Official Hijri months | Kemenag sets them through the *sidang isbat* (the moon-sighting session) ([Wikipedia](https://id.wikipedia.org/wiki/Sidang_isbat), secondary). The latest MABIMS criteria (3 degrees height, 6.4 degrees elongation) couldn't be sourced: `[UNVERIFIED]` | The algorithm in the browser can be off by one day from Kemenag's decision |
| National holidays | A joint decree of 3 ministers every year; 2026: 17 national holidays and 8 collective leave days ([Setneg](https://setneg.go.id/baca/index/inilah_skb_3_menteri_libur_nasional_dan_cuti_bersama_2026)). No official open dataset found. The unofficial repo [APIHariLibur_V2](https://github.com/guangrei/APIHariLibur_V2) is sourced from Google Calendar, GPL-3.0 licence | A manual seed per year that can be edited. Don't depend on an unofficial API |
| *Weton*/auspicious days | An optional Javanese practice (*weton* is the Javanese birth-day calendar cycle) ([Wikipedia](https://id.wikipedia.org/wiki/Weton), secondary) | An optional note per date, not a constraint on the schedule |

**Locale choice for an English UI (tested locally, same runtime):** `en-ID` gives `Rp 600.000`, `6 Oct 2026`, `12.00` and, with `-u-ca-islamic-umalqura`, `25 Rabiʻ II 1448 AH`; `en-GB` and `en-US` give `IDR 600,000`, so they are not used for money. Whether `en-ID` is present in the ICU data of Chrome Android and Safari iOS is `[UNVERIFIED]`. **Built:** `src/ui/format.ts` decides once, at load, with `new Intl.DateTimeFormat("en-ID").resolvedOptions().locale === "en-ID"`: `resolvedOptions().locale` reports the locale the formatter will actually use, which is what has to be known, whereas `Intl.DateTimeFormat.supportedLocalesOf` is not used for this check. If the check fails, dates use `en-GB` and money is a hand-written `Rp ` prefix on `id-ID` grouping (`Rp 600.000`). Dates are formatted in UTC from the stored `YYYY-MM-DD`, so the phone's zone never shifts a day, and "today" is computed in the saved zone from `settings.timezone` (default `Asia/Jakarta`). **The Hijri display is built** (`src/domain/hijri.ts`): Settings shows the Hijri date under the akad date and Home shows it beside the countdown, through `Intl.DateTimeFormat("en-u-ca-islamic-umalqura", { day, month: "long", year })` in UTC, which gives the form `25 Rabiʻ II 1448` (day, month name, year; no era). The calendar is always `islamic-umalqura`: the `hijri_calendar` setting is validated but not read. When the browser does not support that calendar the date is not shown, and Settings says so. The offset is the setting `hijri_offset_days`, validated as -2 to 2; Settings offers "A day earlier", "As calculated" and "A day later", and the stored value if it is outside those three. The note beside it reads "Umm al-Qura calendar. It can differ by a day from local announcements, so adjust it here if yours does." `test/domain-format.test.ts` covers the Node result only; `test/domain-hijri.test.ts` covers the Hijri function (Node only; it was not run in a browser). The Hijri table above lists the Indonesian month names only as test results; the UI shows the English forms.

**Verdict:** Hijri is only shown next to the date, with a manual offset of ±1-2 days (built: a fixed calendar, `islamic-umalqura`, and the offset; a calendar choice is not built, and the display carries a note that it can differ by a day, not the word "approximate"). **Not used to compute legal deadlines.** Effort S, one `Intl` call.

### 5.8 Privacy and sensitive documents

A public repo and two people's data. Two layers: what is stored, and how to protect it.

**Law (not legal advice).** Law 27/2022 on Personal Data Protection, issued 17 October 2022 ([BPK](https://peraturan.bpk.go.id/Details/229798/uu-no-27-tahun-2022)). Article 2 paragraph (2): "This Law does not apply to the processing of Personal Data by individuals in the course of personal or household activities" (translated from Indonesian). Article 4 paragraph (2) classifies health, biometric, genetic data, criminal records, children's data, and personal financial data as "specific" ([text, pasal.id](https://pasal.id/peraturan/uu/uu-no-27-tahun-2022), a third-party site). The author's reading: two people storing data for their own wedding and household appear to fall under that exception. This interpretation is `[UNVERIFIED]` against enforcement. No implementing regulation found. No official guidance on storing NIK.

**Default policy:**

| Class | Contents | Verdict |
|---|---|---|
| Green | Dates, document ready status, vendor names and business contacts, prices, payment schedule, notes | Store |
| Yellow | Vendor phone numbers (needed for tap-to-call), guest phone numbers (only if stored: open Q2 in §8.4), guest names, amounts of *amplop* and savings | Store, but not in the repo and not in test data |
| Red | NIK, scans of KTP/KK/passport/*Buku Nikah*, health examination or Elsimil results, children's data, personal bank account numbers and PINs | **Don't store in the app.** Use a boolean "ready", a date, a physical location |

Note: the KK contains data of family members including children, and health examination results count as "specific" (the author's reading).

**If one day scans are to be stored** (an option, not a recommendation):

| Option | Gives | Cost |
|---|---|---|
| Server-side encryption (built into R2 and D1: AES-256 at rest: [R2](https://developers.cloudflare.com/r2/reference/data-security/), [D1](https://developers.cloudflare.com/d1/reference/data-security/)) | No effort | Cloudflare holds the key. A breached account opens the contents |
| An existing vault (Bitwarden: 5 GB encrypted attachments, emergency access, $1.65/month: [pricing](https://bitwarden.com/pricing/)) | Mature, has emergency access | A small cost; outside the app |
| Client-side encryption: AES-GCM with a PBKDF2-derived key ([AES-GCM](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt), [PBKDF2](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey); OWASP recommends 600,000 PBKDF2-HMAC-SHA256 iterations: [cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)) | The server never sees the contents | **A lost passphrase means lost data.** Argon2 isn't in WebCrypto (only a WICG draft: [draft](https://wicg.github.io/webcrypto-modern-algos/)); can't be searched or OCRed on the server |
| Two copies of the data key (one per partner, or passphrase + passkey) | Survives the loss of one secret | More moving parts; the printed recovery code has to be stored safely |
| WebAuthn re-auth before opening the vault (`userVerification: "required"`: [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API)) | A stolen unlocked phone doesn't open the vault | An app-level gate only; not encryption. Support for the `prf` extension per browser wasn't checked: `[UNVERIFIED]` |

Rule of thumb: encryption and re-auth are different layers. The WebAuthn gate decides who opens the UI; only client-side encryption decides who reads the stored bytes. A Cloudflare Access session (if used at the entry layer) can be set between 15 minutes and one month, default 24 hours ([docs](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)).

**Visibility between partners: decided, everything is visible to both (decided #4).** There are no "private to me" items (X6 is not built). A study shows couples share data but expect privacy for certain kinds of content ([Jacobs et al., GROUP 2016](https://dl.eusset.eu/items/5aee07df-e566-4a00-99da-15cb6e0b986d/full), abstract), so the consequence is stated: a surprise (a gift, a honeymoon plan) must be kept outside Nestora, or written without detail. In return the design is simpler: no visibility column, no server-side row filtering, and an export that holds everything. If one partner later asks for private items, the cost is a visibility column, server-side filtering for sync, export and the `.ics` feed, which is why it is not built "just in case" (§8.1).

---

## 6. Integration-ready design

No integration is built. What is decided now is only what's expensive to change later.

### 6.1 Decisions taken now

| # | Decision | Suggested choice | Reason | Source |
|---|---|---|---|---|
| 1 | **ID** | Created on the client, opaque text. Use `crypto.randomUUID()` (UUID v4) | An item has an ID before the first sync; resending doesn't duplicate rows; re-imports can be deduplicated. RFC 9562 recommends UUIDv7 over v1/v6 because v4 has poor index locality, but at thousands of rows it isn't noticeable; because the ID is opaque, a new format may be mixed in later. Secret tokens (the `.ics` feed) must be random: v4 or random bytes | [RFC 9562](https://www.rfc-editor.org/rfc/rfc9562.html), [MDN randomUUID](https://developer.mozilla.org/en-US/docs/Web/API/Crypto/randomUUID) (v4 only) |
| 2 | **Time** | Instant: RFC 3339 UTC with `Z`. Date only: `YYYY-MM-DD`. Local time: a pair (local time, IANA zone name) only where local meaning matters | Matches `DTSTAMP`, `LAST-MODIFIED`, and other export formats | [RFC 3339](https://www.rfc-editor.org/rfc/rfc3339.html), [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html) |
| 3 | **Money** | Whole-rupiah integer + a currency code per row (default `IDR`), never float | The whole UI uses whole rupiah. Departs from ISO 4217 which gives IDR minor unit 2: ISO-based integrations (e.g. payment APIs that use minor units) need a ×100 conversion. The alternative: store `amount_minor` ×100 (ISO-faithful, the same shape as the Stripe API: [Stripe](https://docs.stripe.com/currencies)); more complicated for a single-currency household. IDR is the only currency for now (decided #10), so the code is a constant in practice: it stays in the schema because the operator already decided it and it is one column, but no feature converts or sums across currencies. Whichever is chosen, write it in the export schema | [ISO 4217 (SIX)](https://www.six-group.com/dam/download/financial-information/data-center/iso-currrency/lists/list-one.xml); the safe integer limit 2^53-1 is far above the need ([MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/MAX_SAFE_INTEGER)) |
| 4 | **Phone** | `+<country code><digits>` (E.164). Drop the `+` only when building the `wa.me` link | The same format for `tel:`, `wa.me`, vCard | [ITU E.164](https://www.itu.int/rec/T-REC-E.164/en); the 15-digit limit couldn't be confirmed from a primary source: `[UNVERIFIED]` |
| 5 | **Change feed** | Per row: an ever-increasing `rev`, `updated_at`, `updated_by`, `deleted_at` (tombstone), like the brainstorm sync design. That is already a change feed that any consumer can pull (`WHERE rev > ?`). An **append-only `events` table** (a shape aligned with CloudEvents: `id`, `source`, `type`, `time`, `subject`, `data`) has its shape decided now, and is created when the first consumer appears | History before there's a consumer has low value (YAGNI). The outbox pattern: write the message in the same transaction as the data change; consumers must be idempotent by tracking IDs | [CloudEvents](https://github.com/cloudevents/spec/blob/main/cloudevents/spec.md), [outbox pattern](https://microservices.io/patterns/data/transactional-outbox.html) |
| 6 | **Export format** | `export.json` holds `format_version` and `$schema` (JSON Schema 2020-12); one CSV per item kind and one for `budget_entries`, with the same column names as the JSON; `calendar.ics`; `contacts.vcf`. Build JSON and CSV first (S). **Built so far** (`GET /api/export`, linked from Settings): the JSON has `format_version`, `exported_at`, `rev` and the three tables including tombstones, with no `$schema` yet; the CSV is one file per `kind` or `entry_type`, live rows only, with the columns of that variant and `data.<key>` columns, and a leading `'` on cells that would read as spreadsheet formulas; no `.ics` and no `.vcf` | JSON is lossless; CSV is convenient. RFC 4180: CSV uses CRLF and double quotes for fields containing commas, quotes, or newlines | [JSON Schema](https://json-schema.org/specification), [RFC 4180](https://www.rfc-editor.org/rfc/rfc4180.html) |
| 7 | **Calendar feed** | UID = item ID; SEQUENCE from `rev`; LAST-MODIFIED from `updated_at`; items without a time as date-only (all-day); tasks as `VTODO` with `DUE`; read-only; a stable URL with a random token in the path | UID is a global and persistent identifier; SEQUENCE is a revision counter | [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html). For the calendar as a whole, RFC 7986 adds `REFRESH-INTERVAL` which is only a hint ([RFC 7986](https://www.rfc-editor.org/rfc/rfc7986.html)) |
| 8 | **Vendor vCard** | UID = item ID; `KIND:org` for companies | `VERSION:4.0` and `FN` are mandatory | [RFC 6350](https://www.rfc-editor.org/rfc/rfc6350.html) |
| 9 | **Webhook shape** (not built) | HMAC-SHA256 signature over `msg_id.timestamp.payload`, headers `webhook-id`, `webhook-timestamp`, `webhook-signature`; payload `type`, `timestamp`, `data` | Aligned with an existing specification, no redesign | [Standard Webhooks](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md) |
| 10 | **Attachments** | An item refers to a file by ID, SHA-256, mime, size. A client-encrypted blob stays opaque | Export and import can check integrity | – |
| 11 | **Integration secrets** | Third-party tokens aren't stored as plain text in D1 | Export and backup must not carry credentials | – |

Not added now: an `external_refs` column or an integrations table. Adding a column later is cheap; what's expensive is changing the meaning of ID, time, and money, and that has been decided above.

### 6.2 Google facts that limit integration

- An OAuth app in Testing status: up to 100 test users, authorisation from test users expires in 7 days ([Google Cloud Help](https://support.google.com/cloud/answer/15549945)); refresh tokens live 7 days ([Google Identity](https://developers.google.com/identity/protocols/oauth2)). Production without verification shows a warning screen when scopes are sensitive.
- The Drive scopes `drive.file` and `drive.appdata` are not sensitive; `drive` and `drive.readonly` are restricted ([Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)). The classification of Calendar scopes wasn't verified well: `[UNVERIFIED]` ([Calendar auth](https://developers.google.com/workspace/calendar/api/auth)).
- This means: a Google integration beyond login needs a weekly re-login or a warning screen. This is a platform fact, not a recommendation. The login decision is in `docs/infra.md` §6 (Cloudflare Access with a Google identity provider).

### 6.3 Future integration candidates: feasibility only

Scale: **cheap**, **medium**, **hard**, **not feasible** (for a private two-person app on the free plan).

**Ranking for the channels the couple look at (decided #6):** 1. Google Calendar `.ics` (cheap; X2 first, X3 later); 2. WhatsApp click-to-chat (cheap, user-triggered); 3. Email digest to Gmail (cheap); 4. Google Keep: no integration, only the share sheet (see the Keep row); 5. Google Sheets CSV view (cheap, not a stated channel). Telegram, Web Push, Notion and the Google APIs are ranked below because no answer points to them.

| Integration | Gives | How | Obstacle | Verdict | Source |
|---|---|---|---|---|---|
| Google Calendar: `.ics` subscription | Deadlines show up in both phones' calendars, read-only | A `text/calendar` feed at a secret URL | Google refuses subscriptions from the mobile app; refresh isn't published (§5.1) | **Cheap** | [Google](https://support.google.com/calendar/answer/37100?hl=en) |
| Google Calendar: API | Two-way, instant | REST + OAuth | Testing/unverified app (§6.2); push needs an HTTPS endpoint and manual channel renewal | Medium | [Calendar API](https://developers.google.com/workspace/calendar/api/auth) |
| Google Sheets | A CSV view or backup | `IMPORTDATA(url)` from a secret CSV URL; API for writing | The CSV URL must be accessible without login; the API needs OAuth | **Cheap** (CSV), medium (API) | [Sheets](https://developers.google.com/workspace/sheets/api/limits) (stated limits: 300 reads and 300 writes per minute per project, 60 per minute per user) |
| Google Contacts (People API) | Vendor contact sync | `people.connections.list` | OAuth; an alternative without an API: vCard export/import | Medium | [People API](https://developers.google.com/people/api/rest/v1/people.connections/list) |
| Google Photos | Attaching selected photos | Picker API | The Library API only has app-created items since 31 March 2025 (§5.3) | Medium (picking), **not feasible** (browsing the library) | [Google](https://developers.google.com/photos/support/updates) |
| Google Drive | Backup target | Drive API with `drive.file` | OAuth token management | Medium | [Drive](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) |
| Notion | Mirror notes or tasks | REST + internal token | Pages must be shared manually with the integration; a limit of 180 requests per minute on non-Business plans | Medium | [Notion](https://developers.notion.com/reference/request-limits) |
| Telegram | Free notifications to two phones | `sendMessage` via HTTPS from cron | Both must use Telegram, which is not among the channels the couple look at (decided #6); the token is secret | **Cheap**, but no audience: not planned | [Telegram](https://core.telegram.org/bots/faq) |
| WhatsApp: click-to-chat link | Opens a chat with filled-in text | `wa.me` | Only opens the chat | **Cheap** | [WhatsApp](https://faq.whatsapp.com/general/chats/how-to-use-click-to-chat/) |
| WhatsApp Business Platform | Automatic messages | Cloud API | Per-message pricing since 1 July 2025, a number already used on WhatsApp must be removed first, opt-in is mandatory, needs a business portfolio and templates | **Hard**, not realistic for personal use | [Pricing](https://developers.facebook.com/docs/whatsapp/pricing/), [numbers](https://developers.facebook.com/docs/whatsapp/cloud-api/phone-numbers), [policy](https://whatsappbusiness.com/id/policy/). A "business only" clause: `[UNVERIFIED]` |
| Email from a Worker | A digest to two addresses | `send_email` | The destination address must be verified; Email Service is Beta | **Cheap** | [Email Service](https://developers.cloudflare.com/email-service/platform/pricing/) |
| Web Push | Native notifications | Push API + VAPID | On iOS only from the Home Screen; the Worker has to do the encryption | Medium | [WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) |
| Google Keep | Notes and lists the couple look at | No API for personal accounts: the Keep API is for Google Workspace admins and admin-enabled apps ([Google](https://workspaceupdates.googleblog.com/2021/05/keep-audit-logs-and-api.html)) | Not available to personal Google accounts; whether the couple use Workspace accounts is not known. The phone's share sheet is the only path (W3 "share as text") | **Not feasible** as an integration; share sheet only |
| Web Share Target | Share to the app from WhatsApp, etc. | `share_target` in the manifest | Chrome 76+ Android and 89+ desktop and must be installed; WebKit bug 194593 is still open | **Cheap** on Android, **not feasible** on iOS. With one Android and one iPhone (decided #2), no feature may depend on it | [Chrome](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target), [WebKit bug](https://bugs.webkit.org/show_bug.cgi?id=194593) |
| Indonesian bank data | Automatic transaction import | SNAP, an aggregator, or statement files | Consumer access to SNAP isn't apparent; Plaid doesn't list Indonesia (§4) | **Not feasible** automatically; manual file import medium to hard | [ASPI](https://apidevportal.aspi-indonesia.or.id/), [Plaid](https://plaid.com/docs/institutions/) |
| QRIS | No personal data | – | A payment QR code standard, not a feed of the payer's transactions (inference; the BI page returned 404 so `[UNVERIFIED]`) | **Not feasible** | [EMVCo](https://www.emvco.com/emv-technologies/qrcodes/) |
| National holidays | Working-day calculation | A yearly seed from the SKB | No official API | **Cheap** (manual seed) | [Setneg](https://setneg.go.id/baca/index/inilah_skb_3_menteri_libur_nasional_dan_cuti_bersama_2026) |
| Home Assistant, IFTTT | Triggers home automation | HTTP webhook | HA: local network only by default; IFTTT: webhooks need Pro ($2.99/month) | HA medium; IFTTT not free | [Home Assistant](https://www.home-assistant.io/docs/automation/trigger/#webhook-trigger), [IFTTT](https://ifttt.com/plans) |
| Receipt OCR | Extract text from a photo | Workers AI vision model | 10,000 neurons per day on the free plan; no dedicated OCR model identified; accuracy not tested | Medium | [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [models](https://developers.cloudflare.com/workers-ai/models/) |
| Splitwise/YNAB import | Old expenses | API or CSV | An API exists; CSV documentation wasn't found | Cheap if CSV exists, otherwise medium | [Splitwise](https://dev.splitwise.com/), [YNAB](https://api.ynab.com/) |

### 6.4 Platform needs per feature class

Only facts to match against the stack decisions in `docs/infra.md` (free plan, checked 6 October 2026).

| Feature class | Storage | Push | Files | Cron | Realtime |
|---|---|---|---|---|---|
| Lists, tasks, notes | D1 | optional | no | no | optional |
| Reminders | D1 | Web Push (iOS: installed) or Telegram/email | no | yes (5 slots per account) | no |
| Budget, payments, expenses | D1 (integer) | optional | R2 for payment proof | monthly digest | no |
| Documents | D1 for the index | no | R2 + client encryption if scans | no | no |
| Calendar feed | D1 | no | no | optional | no |
| Live co-editing | D1 + Durable Object | no | no | no | yes (WebSocket) |

| Capability | Free plan limit | Source |
|---|---|---|
| Workers | 100,000 requests per day; CPU 10 ms per request and per cron; 5 crons per account | [limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Static assets | Static asset requests are free and unlimited; 20,000 files per version, 25 MiB per file | [static assets](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) |
| D1 | 5 million rows read per day; 100,000 rows written per day; 5 GB total; 500 MB per database; 50 queries per invocation; 2 MB per row/string/blob | [pricing](https://developers.cloudflare.com/d1/platform/pricing/), [limits](https://developers.cloudflare.com/d1/platform/limits/) |
| D1 Time Travel | 7 days (Free), 30 days (Paid) | [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) |
| R2 | 10 GB-month; 1 million Class A and 10 million Class B per month; free egress; needs the "R2 subscription" checkout | [pricing](https://developers.cloudflare.com/r2/pricing/), [get started](https://developers.cloudflare.com/r2/get-started/) |
| Durable Objects | SQLite-backed only on Free; 100,000 requests per day; WebSocket Hibernation | [pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/) |
| Queues | Available on Free; 10,000 operations per day | [pricing](https://developers.cloudflare.com/queues/platform/pricing/) |
| KV | 1,000 writes per day | [pricing](https://developers.cloudflare.com/kv/platform/pricing/) |
| Workers AI | 10,000 neurons per day | [pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) |
| Email | Sending to verified destination addresses is free; arbitrary addresses Paid only | [Email Service](https://developers.cloudflare.com/email-service/platform/pricing/) |

---

## 7. Prioritised roadmap

### 7.1 How to score

Each feature is scored by the author with three numbers. This is a judgement, not data, so challenge it if you disagree.

- **V (value) 1-5:** how strong the trigger for use is (weekly, dense-temporary, high-value redemption: §1.4) and how big the problem solved is according to the evidence in §2 and §4.
- **E (effort):** S = 1, M = 2, L = 3.
- **R (risk) 1-3:** 1 low; 2 medium (rules can go stale, money accuracy, risk of quitting); 3 high (privacy, platform dependence, big risk of quitting).
- **Score = 2V − E − R.** Maximum 8.
- **Tier:** score ≥ 6 = **Tier 1** (build first); 4-5 = **Tier 2**; 1-3 = **Tier 3** (postpone, build if requested); ≤ 0 = **Hand off or not built**.
- **Exception because of deadlines:** features with a wedding-day deadline (W5, W6, W20, W27) are scheduled by the calendar, not by score.

| ID | Feature | V | E | R | Score | Tier |
|---|---|---|---|---|---|---|
| W3 | "This week" screen | 5 | S | 1 | 8 | 1 |
| W11 | Vendor book | 5 | S | 1 | 8 | 1 |
| H3 | Recurring bills and obligations | 5 | M | 1 | 7 | 1 (after the wedding) |
| W16 | Guest list | 5 | M | 1 | 7 | 1 |
| W1 | H-day and countdown | 4 | S | 1 | 6 | 1 |
| W2 | Task timeline from a template | 5 | M | 2 | 6 | 1 |
| W8 | Events as a group | 4 | S | 1 | 6 | 1 |
| W12 | Quote comparison | 4 | S | 1 | 6 | 1 |
| W13 | Budget and payments | 5 | M | 2 | 6 | 1 |
| W14 | Wedding fund | 4 | S | 1 | 6 | 1 |
| W24 | Post-wedding checklist | 4 | S | 1 | 6 | 1 (after the wedding) |
| X1 | JSON and CSV export | 4 | S | 1 | 6 | 1 |
| X2 | "Add to calendar" button (`.ics`) | 4 | S | 1 | 6 | 1 |
| H2 | Savings goal (reuse W14) | 4 | S | 1 | 6 | 1 (after the wedding) |
| H4 | Document and vehicle renewals | 4 | S | 1 | 6 | 1 (after the wedding) |
| W18 | RSVP CSV import | 4 | M | 1 | 5 | 2 |
| W4 | Agreement notes | 3 | S | 1 | 4 | 2 |
| W27 | Selectable *akad* location | 4 | S | 1 | 6 | 1, **time-bound** (together with W5) |
| W5 | Conditional KUA checklist | 4 | M | 2 | 4 | 2, **time-bound** |
| W9 | *Seserahan* | 3 | S | 1 | 4 | 2 |
| W15 | Payment proof as a link | 3 | S | 1 | 4 | 2 |
| W17 | Invitation tracker + WhatsApp | 3 | S | 1 | 4 | 2 |
| W20 | Offline rundown | 4 | M | 2 | 4 | 2, **time-bound** |
| W21 | Share rundown/contacts | 3 | S | 1 | 4 | 2 |
| W26 | Closing out and archive | 3 | S | 1 | 4 | 2 |
| X4 | Client-side search | 3 | S | 1 | 4 | 2 |
| H9 | Document index (no scans) | 3 | S | 1 | 4 | 2 |
| H10 | Renovation (reuse of the budget module) | 3 | S | 1 | 4 | 2 (if there's a renovation) |
| W6 | Working-day calendar | 3 | S | 2 | 3 | 3, **time-bound** (together with W5) |
| W25 | *Amplop* ledger, incoming | 3 | S | 2 | 3 | 3 (not a priority now, decided #9; validate first) |
| H7 | Recurring chores | 3 | S | 2 | 3 | 3 |
| H12 | People and occasions (birthdays, outgoing *kondangan*) | 3 | S | 2 | 3 | 3 (validate first) |
| X7 | Generic CSV import | 3 | M | 1 | 3 | 3 |
| W7 | Prenuptial route | 2 | S | 1 | 2 | 3 (in scope, decided #11) |
| W22 | Song list | 2 | S | 1 | 2 | 3 |
| W23 | Night-before checklist | 2 | S | 1 | 2 | 3 |
| H11 | Travel (tasks and budget, grouping later) | 2 | S | 1 | 2 | 3 |
| H13 | "Us" timeline | 2 | S | 1 | 2 | 3 |
| X3 | Subscribed `.ics` feed | 3 | M | 2 | 2 | 3 |
| X5 | Weekly digest (email/Telegram/push) | 3 | M | 2 | 2 | 3 |
| H1 | Shared expenses | 3 | M | 3 | 1 | 3 (high risk of quitting) |
| W15b | Upload payment proof to R2 | 3 | L | 3 | 0 | Hand off (use a link) |
| H9b | Document scan vault | 3 | L | 3 | 0 | Hand off |
| H8 | Own calendar UI | 2 | L | 2 | −1 | Hand off |
| W19 | Read-only link for family/WO | 2 | M | 3 | −1 | Later option only (decided #5) |
| H5 | Own shopping list | 2 | L | 3 | −2 | Hand off |

Cross-cutting (`X`) features that appear in the table, with their effort and platform:

| ID | Feature | Effort | Platform | Section |
|---|---|---|---|---|
| X1 | JSON and CSV export | S | client | §5.4 |
| X2 | `.ics` per item | S | client | §5.1 |
| X3 | Subscribed `.ics` feed | M | D1 + read-only endpoint | §5.1, §6.1 |
| X4 | Client-side search | S | client | §5.2 |
| X5 | Weekly digest | M | cron + email, Telegram, or push | §5.1 |
| X6 | "Private to me" items | – | Not built (decided #4) | §5.8, §8.1 |
| X7 | Generic CSV import | M | client (its reader is built first for W18) | §5.5 |

### 7.2 The smallest data model for wedding and household

**Decided (operator, final): one generic `items` table for everything that is list-shaped, plus one separate table, `budget_entries`, only for the budget and its payments.** This section holds the rationale and the `kind` registry; the SQL, the formats and the import mapping are in [brainstorm §7](brainstorm.md#7-data-model-d1). The two must agree: change one, change the other. Formats (ID, time, money, phone) are the decisions in §6.1.

**The two options that were compared.**

| | One generic model (`items`) | A table per feature |
|---|---|---|
| Example | One `items` table with a `kind` column, a few typed columns for what is summed or sorted, and one JSON `data` column for the rest | A table per feature: `tasks`, `vendors`, `guests`, `rundown_items`, and so on, and a new table for each household feature (an earlier sketch had 12) |
| New feature | Configuration: column list, labels, totals, grouping. No migration | A new migration, a new whitelist in the Worker, new sync code, new export code |
| Sync | One `rev` index, one table to pull | One `rev` index per table |
| Export, import, integration | Uniform: one row shape, one change feed | One per table |
| SQL constraints | Weak per `kind`: `CHECK` only for what applies generally (`amount >= 0`, date format, `who`). Per-`kind` validation is done in code through a registry | Strong: typed columns, `NOT NULL`, `CHECK` per table, real foreign keys |
| Queries | Needs an index on `(kind, due_on)`; the contents of `data` can't be indexed cheaply | Plain, clear SQL; simple aggregation |
| Risk | A typo in `kind` or JSON contents silently slips through without a registry | Lots of repeated code; adding a feature feels expensive so small features don't get built |
| Switching direction later | Moving one `kind` to its own table = one `INSERT ... SELECT` per `kind` (the author's inference) | Merging tables into a generic one = more work (the author's inference) |

**Decision: generic, with one exception and one exit rule.** All the lists, checklists and notebooks in §3 and §4 are rows with a few fields, a status, and a total, so they share `items`. The exception is the budget and its payments, which get their own table, `budget_entries`: that is where money accuracy matters most, and it is the one place that needs real constraints (a payment must belong to a budget line, an unpaid payment has no payment date, a budget line has no due date) and real foreign keys. The exit rule below covers every other `kind`.

**`items`, column by column.** The exact types and constraints are in brainstorm §7.2.

| Columns | Meaning |
|---|---|
| `id`, `kind`, `parent_id` | Client-created ID; which `kind` of row it is (registry below); an optional parent (a contribution's saving) |
| `title`, `status`, `group_key`, `note` | The name; a status from the `kind`'s own list; the group (category, phase, event, moment); free text |
| `due_on`, `done_on` | Dates only (`YYYY-MM-DD`), see §6.1 decision 2 |
| `amount`, `currency`, `qty` | Whole rupiah and a currency code (default `IDR`), see §6.1 decision 3; a count (pax) |
| `who` | `a`, `b` or `both`. The Worker derives `a` and `b` from the verified Access email (an ordered pair in a Worker secret, `docs/infra.md` §6.4), so no email is stored in D1; the nicknames are in `settings` and never go into the repo. The UI never shows the words "Partner A" or "Partner B": it shows the nickname, or "You" or "Them" by who is signed in, or "Nobody yet" for an unassigned row. `who` is about doing and paying, never about visibility: every row is visible to both (decided #4), so there is no visibility column |
| `data` | JSON for what the `kind` needs beyond the columns (phone, PIC, links, start and end time) |
| `sort` | A fractional index (`REAL`) for manual order |
| `rev`, `created_at`, `updated_at`, `updated_by`, `deleted_at` | Sync and audit: the server counter, RFC 3339 instants, who changed it, the tombstone (§6.1 decision 5) |

There is one shared space and no project concept: no `project` kind, no `project_id` column and no `projects` table. Grouping for a later household (renovation, trip) is not designed. `settings` is a small key/value table with the same sync columns (keys in brainstorm §7.3; W27 adds `akad_venue`, `akad_place` and `same_subdistrict`, which brainstorm §7.3 does not list yet). `sync_state` is a one-row table holding the revision counter and the `epoch`, a random id created with the database that lets a phone notice a wiped or restored database (brainstorm §5.2). A settings row is never deleted and its value cannot be empty, so "unset" is not a state: a key that means "not decided" needs an explicit value of its own (the validator rejects an empty or invisible value, and the sync contract rejects a `delete` on `settings`). The settings screen reflects that: it saves only non-empty values and cannot clear one that was set. Settings values are validated per key (a date, an IANA zone, a choice, a JSON list of dates, a decimal, and the list of route stages, `stages`: 1 to 12 stages with unique keys and names and a month range relative to the akad month; brainstorm §7.3).

**The `kind` registry** (one object in code, `shared/tables.ts`, used by the client and the Worker for validation, building list screens, and totals). **Built on `main` today:** `task`, `vendor` and `guest` here, and the entry types `planned` and `payment` below; the other rows are plan, each added as a registry entry when its screen is built. The built `data` keys are `task`: `start_on`, `decision`, `rules`; `vendor`: `phone`, `pic`, `contract_url`, `facts`; `guest`: `phone`, `channel`, `rsvp_qty`, `import_batch`; `payment`: `proof_url`; `planned` has none. A `guest`'s `who` is `a` or `b` only.

| `kind` | Used by | Meaningful columns | Contents of `data` |
|---|---|---|---|
| `task` | W2, W5, W7, W23, W24, H7 | `status` (todo/done), `due_on`, `done_on`, `who`, `group_key` (phase; `kua` for the KUA checklist), `amount`, `qty`, `note` | `start_on`, decision flag, template rules (W5 rules read the W27 keys in `settings`) |
| `vendor` | W11, W12 | `group_key` (category), `status` (option/confirmed/cancelled), `amount` (quote) | `phone` (E.164), `pic`, contract link, key facts |
| `guest` | W16, W17, W18 | `who` (side: `a` or `b`), `group_key` (category), `qty` (pax), `status` (todo/sent/confirmed/declined) | `phone` (optional), `channel` (digital/print/both), `rsvp_qty`, `import_batch` (W18) |
| `bridal_gift` | W9 | `group_key` (category), `amount` (price), `status` (todo/in_progress/done), `who` | `url` (purchase link) |
| `rundown` | W20 | `group_key` (event: `engagement` or `wedding`), `due_on` (date), `status` (todo/done), `done_on`, `sort` | `start_time`, `end_time` (local time, zone in `settings`), `pic`, `highlights` |
| `song` | W22 | `group_key` (moment), `sort` | `singer` |
| `note` | W4, H13 | `note`, `due_on` | – |
| `saving` | W14, H2 | the target in `amount`, the deadline in `due_on` | – |
| `contribution` | W14, H2 | `parent_id` (the saving), `amount`, `done_on`, `who` | source of funds |
| `cash_gift` | W25, H12 | `group_key` (event), `amount`, `done_on` | direction (incoming/outgoing) |
| `recurring` | H3, H4, H7 | `amount`, `due_on` (next due), `done_on` (last), `who` | period, recurring date |
| `doc` | H9 | `due_on` (expiry) | physical location, holder |
| `expense` | H1 | `amount`, `done_on`, `who` (payer), `group_key` (category) | split |

**`budget_entries`** holds two row types in one table, so one `rev` pull and one export shape serve both:

| `entry_type` | Used by | Meaningful columns | Contents of `data` |
|---|---|---|---|
| `planned` | W13, H10, W27 | `title`, `group_key` (event: `engagement`, `ceremony`, `reception`, or an area of a household budget), `amount` (planned), `vendor_id` (optional vendor item). W27 keeps one seeded row for the *akad* registration fee, amount empty while the location is undecided | – |
| `payment` | W13 | `budget_id` (the planned row), `status` (due/paid), `amount`, `due_on`, `done_on`, `who` (payer) | proof link |

Remaining amounts, totals per event and "late" marks are calculated, never stored.

**Exit rule:** move a `kind` to its own table only if it (a) needs relational integrity beyond `parent_id`, (b) needs a per-kind `CHECK` that matters for money, (c) scans thousands of rows per query, or (d) has a different retention or privacy rule (e.g. `doc` if one day it stores scans). The budget and payments already took (a) and (b). Today no other `kind` qualifies.

**D1 load:** rows read are counted by rows scanned ([D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)), so the `rev` and `(kind, due_on)` indexes on `items` and the `(entry_type, due_on)` index on `budget_entries` matter. At thousands of rows and a limit of 5 million reads per day, there's no problem as long as there's no polling or repeated scanning.

**What the generic model costs:** the database can't tell a task from a guest, so the registry and the Worker's validation carry that; and the contents of `data` can't be indexed cheaply, so anything that is sorted, summed or filtered must be a typed column. The driver for choosing generic is the extension to household: every new table brings a migration, a whitelist, sync, and export, and that's what makes small features like H4 or W22 feel not worth it.

### 7.3 The core that gets built first

**Core = one model, five areas of work (This week, tasks, budget and fund, vendors, guests), one export button:** (status in the list below and in the stage table). The built app shows the areas on three destinations, Home, Money and People (guests and vendors as two lists), with Tasks one tap from Home and Settings behind the avatar pair in the header (an item of the sidebar on a wide screen); the "five screens" of the plan are not five screens in the navigation.

1. The `items` + `budget_entries` + `settings` model + sync (SQL in brainstorm §7; stack in `docs/infra.md`).
2. A generic list screen configured through the registry.
3. "This week" (W3).
4. Tasks from a template (W2) with H-day (W1).
5. Budget + payments + due dates (W13) and the wedding fund (W14).
6. Vendor book (W11) and guest list (W16).
7. JSON and CSV export (X1), `.ics` per item (X2).

**What the code delivers on 7 October 2026:** item 1 is built (the Worker, the store and the three tables, with detection of a wiped or restored database, brainstorm §5.2); item 2 is built for `task`, `vendor` and `guest` (the Add sheet with the quick-add parser of brainstorm §5.2, a detail form, undo of a delete, tap-to-call and WhatsApp links on a phone number); item 3 is built inside Home (W3: late, due in seven days and undated tasks, payments due in the next seven days among the dated entries, and "Take it" for an unassigned task); item 4 is half built (the H-day countdown W1 from `settings.ceremony_date`, shown in days with the Hijri date beside it; a route of stages with the tasks of each stage, whose stages can be edited in Settings; no task templates W2 yet); item 5 is half built (Money: budget lines grouped by event with planned, paid, remaining and over-budget totals, payments with a due date and a paid date W13; the wedding fund W14 is not built); item 6 is built in its basic form (People: vendor status and quote, guest side, status and headcount per side, with an owner filter on guests); item 7 is half built (JSON and CSV export X1, from the links in Settings; no `.ics` X2). Not built: the one-time import, search (X4), the service worker, and everything in tiers 2 and 3. Tasks are not seeded: the app opens empty, which departs from "templates already filled in" (§1.3 #6) until W2 lands.

The reason: those are the five things that drive the weekly session (§1.2), all scoring Tier 1, and the rest is configuration on top of the same model.

**Stages.** The wedding day is about a year away; the following targets are relative to H and can shift.

| Stage | When (relative to H) | Contents | Done when |
|---|---|---|---|
| M0: spike | first week | Login, sync, one `kind` end to end (see `docs/infra.md` §8.2) | Two phones see the same data, with an offline edit. **Built and deployed** (login, sync and the first four kinds); the two-phone test (M9) remains |
| M1: core | H-11 months | Items 1-7 above (mostly built, see above), plus the one-time import from the old spreadsheet | You two use the "This week" screen three weeks in a row (measure: both sides touch that week's list) |
| M2: administration and vendors | done before H-6 months | W27, W5 and W6 (*akad* location selector, KUA checklist, working days), W8, W9, W12, W4, the W24 template, search (X4) | The KUA checklist is filled in and reviewed in the weekly session |
| M3: wedding day | done before H-3 months | W20 (offline rundown), W21, W17, W18 (RSVP CSV import, with its CSV reader), W22, W23; the monthly backup routine | Wedding-day rehearsal at H-2 weeks: the rundown opens in airplane mode |
| M4: after the event | H to H+3 months | W26, W24 active; the export archive | All vendor payments settled and an export copy exists outside Cloudflare |
| M5: household v1 | after M4 | H3, H4, H2, then H12 if validated; H7, H1, H10 if requested | Real bills and renewals are in the app and show up in "This week" |
| Later | undated | W25 *amplop* ledger (not a priority now, decided #9), X3 subscribed feed, X5 digest (Gmail first), W19 family link (later option only, decided #5), X7 generic CSV import beyond RSVPs | Only if there's a real reason |

**Not a deliverable:** UI and view components, the framework choice and IaC. They are not researched here; the decisions are in `docs/infra.md` §3 and §5 (React + TypeScript + Vite, wrangler only).

### 7.4 Main risks

| Risk | Mitigation |
|---|---|
| The app is abandoned in the third to eighth week (§1.2 #11) | A small core; the weekly session as a cue; useful without a daily habit; measure "both sides touch this week" |
| One partner feels like the manager (§1.2 #8) | Default unassigned and agreed (decided #3); no assignment notifications; the partner who did not choose the app also takes part in choosing features (decided #3) |
| Too much gets built | Tiers and the not-built list (§8); every feature passes the §1.4 test |
| KUA rules change or differ between offices | Templates carry a verification date; "ask the KUA" items with a notes column; no hard rules |
| Data lost or locked | Export from M1; a copy outside Cloudflare; Time Travel is only 7 days |
| Personal data leaking through the public repo | The green/yellow/red policy (§5.8); fake test data; no NIK and no scans |
| iOS quirks (Home Screen, no Background Sync) with one Android and one iPhone (decided #2) | Test on an iPhone installed to the Home Screen and on Android from M0; both first-class; don't depend on push or Web Share Target |

---

## 8. The not-built list and open questions

### 8.1 Not built

| Not built | Reason | Reconsider if |
|---|---|---|
| A public site, RSVP, or digital invitation | Digital services and print are both supported through W16-W18 (decided #8): Nestora tracks and imports, it does not send. Already served by many platforms (§2.3); a public page exposes guest data and has to be guarded against enumeration (brainstorm §4). One article suggests sending printed invitations to elderly guests ([Good News from Indonesia](https://www.goodnewsfromindonesia.id/2022/11/22/mengenal-apa-itu-undangan-digital-trending-di-media-sosial)) | A service the couple use shuts down or has no usable export |
| A vendor marketplace or recommendations | A vendor-advertising business model; the fake-lead allegation on The Knot's side (§2.1) | No |
| A registry or gift wishlist | The *ngamplop* (giving gift envelopes) and *buwuhan* (traditional wedding contribution) traditions (§2.5); wishlists are handled by Giftster/Giftful/GoWish | No |
| A seating chart | Fails the weekly test; single use | A reception with numbered tables and many guests |
| Moodboard and inspiration | Pinterest is the most used inspiration platform ([Knot 2026](https://www.theknotww.com/press-releases/the-knot-worldwide-unveils-2026-real-weddings-study)) | No |
| Chat inside the app | WhatsApp already exists | No |
| Points, streaks, rankings | Reminders hinder habit and positive reinforcement isn't effective ([Stawarz et al.](https://research-information.bris.ac.uk/en/publications/beyond-self-tracking-and-reminders-designing-smartphone-apps-that/)); chore apps feel like parenting your partner ([MIT TR](https://www.technologyreview.com/2022/05/10/1051954/chore-apps/)) | No |
| Assigning with notifications; a "partner hasn't opened it" view | See §1.3 #3 and #4 | No |
| "Private to me" items (X6) | Decided: everything is visible to both (decided #4); no visibility column, no server-side filtering (§5.8) | Either partner asks later |
| Read-only link for parents or the WO (W19) | Not for now (decided #5); a privacy risk | Either of you asks |
| Currencies other than rupiah | IDR only for now (decided #10); the currency code column stays but nothing converts | A foreign-currency cost must be tracked |
| Automatic bank sync; subscription detection | Not feasible in Indonesia (§4, §6.3) | A proven consumer aggregator appears |
| Own shopping list and calendar UI | Handed off (H5, H8) | The app in use shuts down |
| A vault for KTP/KK/passport scans | The riskiest data; Bitwarden already exists (§4.2 H9) | There's a real need and you two are ready to bear client-side encryption and recovery keys |
| AI features | Only 36% of US couples use AI for planning ([Knot 2026](https://www.theknotww.com/press-releases/the-knot-worldwide-unveils-2026-real-weddings-study)); no clear weekly problem; Workers AI is free for 10,000 neurons per day and no dedicated OCR model was identified (§6.3) | There's repeated work that can be shown to use AI |
| A wedding-day mode for the couple | Couples leave their phones ([Massimi et al.](https://www.microsoft.com/en-us/research/wp-content/uploads/2020/03/Real-but-Glossy.pdf)); instead, a run sheet for the coordinator (W20, W21) | No |
| Real-time co-editing | Two people rarely edit exactly the same row at exactly the same time; brainstorm §3.2 lists it as an option | Sync conflicts actually happen |
| Multi-couple, onboarding wizard, multiple languages | No need | No |
| WhatsApp Business API automation | Hard and unrealistic for personal use (§6.3) | No |
| Photo albums and guest photos | Google Photos/iCloud; the app only stores the link | No |
| Mortgage calculator and relationship content | BCA, Rumah123, Paired, Gottman (§4.2) | No |
| Automatic *weton* calculation | An optional and varied practice; an optional note is enough (§5.7) | You ask for it |
| Push as the core loop | iOS only for installed apps; reminders hinder habit (§1.2 #5, §5.1) | The "This week" screen and `.ics` prove insufficient |

### 8.2 The five most decisive decisions (for the operator)

1. **Data model** (§7.2). **Decided by the operator:** one generic `items` table plus a separate `budget_entries` table only for the budget and its payments. This keeps small household features cheap.
2. **Core scope** (§7.3). **Decided by the operator:** model + "This week" + tasks + budget/payments + vendors + guests + export. Everything else waits.
3. **Money representation** (§6.1 #3). **Decided by the operator:** whole rupiah as an integer plus a currency code (the ×100 alternative to match ISO 4217 was dropped). It is written in the export schema before the first data.
4. **Reminder strategy** (§5.1). Recommendation, matched to the channels the couple look at (decided #6): the "This week" screen + `.ics` per item (Google Calendar) first; a WhatsApp share of the week; one weekly Gmail digest later; push only if proven necessary.
5. **Sensitive document policy** (§5.8). Recommendation: no NIK and no scans; a document index only; scans in Bitwarden or Drive.

### 8.3 Questions for the operator

1. The estimated *akad* date, or its time window? (Decides the templates and the M1-M3 schedule.)
2. Can the stack in `docs/infra.md` guarantee offline writes, or do some features have to be cut? (Decides W20 and offline capture.)
3. Is R2 allowed (the "R2 subscription" checkout and possibly a payment method, §5.3)? If not, attachments stay links forever.
4. How long is the old spreadsheet run in parallel, and which data is real (brainstorm §9)?
5. Who maintains the app after the event, and when is it archived or shut down (brainstorm §9 #8)?

### 8.4 Questions for you two

**Decided** (the couple's answers, recorded 2026-10-06):

| # | Decision | Date | Sections affected |
|---|---|---|---|
| 1 | The *akad* location is not decided. It is a selectable field (at the KUA or outside it; the home sub-district of Partner A, of Partner B, or elsewhere), and the checklist and the cost estimate follow the selection (new feature W27) | 2026-10-06 | §3.2 (W5, W27), §3.4 (W13), §3.8, §7.1, §7.2, §7.3, Appendix A |
| 2 | One partner uses Android, the other an iPhone. Both are first-class; on iOS, installing to the Home Screen is required for push and long-lived storage | 2026-10-06 | §1.1, §5.1, §5.6, §6.3, §7.4 |
| 3 | Items are unassigned by default, taken with one tap. The partner who did not choose the app also takes part in choosing features | 2026-10-06 | §1.3, §7.4 |
| 4 | Everything is visible to both partners; no "private to me" items (X6 not built) | 2026-10-06 | §1.1, §1.3, §5.8, §7.1, §7.2, §8.1 |
| 5 | No read-only access for parents or the wedding organiser for now; W19 stays a later option only | 2026-10-06 | §1.1, §3.5 (W19), §7.1, §7.3, §8.1 |
| 6 | The reminder channels the couple look at are WhatsApp, Gmail, Google Calendar and Google Keep | 2026-10-06 | Summary, §1.3, §5.1, §6.3, §8.2 |
| 7 | The day and time of the weekly session are not decided (its status as a fixed ritual is open: Q1). The cron time is an example only | 2026-10-06 | §5.1 |
| 8 | Invitations: both digital services and print are supported, plus a CSV import of RSVP results (W18) | 2026-10-06 | §3.5 (W16, W17, W18), §5.5, §7.1, §7.2, §7.3, §8.1 |
| 9 | The *amplop* and *kondangan* ledger is not a priority now; kept open for later (W25 moved to Tier 3 and "Later") | 2026-10-06 | §3.7 (W25), §7.1, §7.3 |
| 10 | Each partner uses several banks and one investment app; savings and investment tracking lives partly outside wp. Currency is IDR only for now | 2026-10-06 | §3.4 (W14), §4.2 (H1, H2), §5.7, §6.1, §8.1 |
| 11 | The prenuptial agreement stays in scope (W7) | 2026-10-06 | §3.2 (W7), §7.1 |
| 12 | Whether guests' phone numbers are stored in the app stays open for later (Q2); until then the features work with and without them | 2026-10-06 | §3.5 (W16, W17, W18), §5.8 |

**Still open:**

1. **Weekly session:** the day and time, and whether it is a fixed ritual. (An event-based cue: §1.2 #5. Decides the digest time in §5.1.)
2. **Guests' phone numbers in the app:** stored or not. (If stored they fall in the yellow class in §5.8. If not, W17 opens WhatsApp's chooser and W18 matches by name.)
3. ***Amplop* and *kondangan*:** is recording incoming and outgoing *amplop* really a need? How often do you attend *kondangan*, and is there an *arisan* you run? (Demand not yet validated: W25, H12.)
4. **After the wedding, which comes first:** bills and vehicle tax, savings goals, shared expenses, or something else? (Decides the order inside M5. Decision #10 only says that part of the money lives outside Nestora.)
5. **Invitations in detail:** which digital service, and do you want a postal-address field for print invitations? (The service decides the CSV columns of W18, which maps columns so it works with any service; an address is personal data and would join the yellow class in §5.8.)
6. **The *akad* location itself:** venue and place are still to be chosen in W27. (It has to be settled before the KUA registration window in §3.8, and it fixes the fee and the letters.)

---

## Appendix A: Unverified items and research gaps

- **How Indonesian couples use Sheets/Notion/WhatsApp for planning:** no Indonesian source found; the search quota ran out. Needs follow-up (Reddit, Kaskus, Hipwee, Brilio, the Bridestory/Weddingku blogs).
- **Play Store reviews** of Bridestory, Weddingku, Wevitation: only the rating and the number of reviews could be read. The review themes of Weddingku and Wevitation are unverified. Bridestory's iOS reviews come from the Apple feed, which only exposes about the latest 50 reviews.
- **theknot.com, Hitched, Etsy, Reddit, Brides, Cosmopolitan, NYT/Wirecutter** couldn't be opened. No Wirecutter or NYT quotes. A study ranking which features couples use most wasn't found (only channel adoption).
- **Popular retention and habit statistics** ("25% of apps are used once", "66-day median") have no primary source found.
- **WhatsApp figures in Indonesia:** no clean figure (§1.1).
- **The KUA process:** the duration and schedule of *bimwin*; whether Director General Decision 373/2017 is still in force; the RT/RW step; the "15 HK" rule after online registration (contradictory); whether Elsimil is mandatory at particular KUAs; TT; the PP 59/2018 appendix being an image; the PMA text was read from a PDF copy on a village government site and matched only against BPK metadata.
- **After the wedding:** the deadlines for KK, KTP-el, BPJS Kesehatan (spouse), BPJS Ketenagakerjaan, passport, bank, insurance, STNK, HR; the PTKP (non-taxable income threshold) figures.
- **Hijri:** the new MABIMS criteria; an official open holiday dataset.
- **The PDP Law (UU PDP):** the article text was read from a third-party site; the implementing regulation and the supervisory body weren't found; no official guidance on storing NIK; the interpretation of the household exception is the author's reading, not legal advice.
- **Indonesian money apps:** member limits and export of Jago/blu; Finansialku; Sribuu; other banks; Indonesian bank support in Wallet.
- **Integration:** the `.ics` refresh interval of Google; whether Google honours `REFRESH-INTERVAL`; whether R2 needs a payment method; whether verified email needs a domain; the WhatsApp "business only" clause; Firefox `share_target` support; WebAuthn `prf` support per browser; export documentation for Splitwise/YNAB/Money Manager; the classification of Calendar scopes; QRIS on the BI page.
- **Decisions of 2026-10-06:** the reading of PMA Article 17 for an *akad* in one partner's own sub-district; whether *numpang nikah* at a KUA changes the fee; whether Excel in an Indonesian regional setting writes `;`; how to detect an installed iOS web app; Google Keep as a share target on both phones; whether the couple's Google accounts are Workspace accounts (decides if the Keep API applies); the columns exported by the invitation service the couple will choose.
- **Review quotes** were read through a summarising fetch tool; the quotes and figures this document leans on were rechecked on the source pages, and the rest are marked according to their level of verification.
- **Review and rating figures** are a snapshot of 6 October 2026 and change every day.
