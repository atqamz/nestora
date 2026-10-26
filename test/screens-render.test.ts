import { after, before, mock, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import type { ItemRow } from "../shared/tables.ts";
import { addDays } from "../src/domain/dates.ts";
import { text } from "../src/ui/text.ts";
import { item } from "./domain-rows.ts";
import { markupOf } from "./render.ts";
import { stage } from "./render-store.ts";

const TODAY = "2027-03-01";

before(() => mock.timers.enable({ apis: ["Date"], now: new Date(`${TODAY}T05:00:00Z`) }));

after(() => {
  mock.timers.reset();
  stage([]);
});

const POSTER = "https://image.tmdb.org/t/p/w342/invPoster0001.jpg";

const CREDIT = `<p class="hint credit tmdb"><a class="tmdb-logo" href="https://www.themoviedb.org" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><img src="/tmdb.svg" alt="TMDB" decoding="async"/></a><span>${text.tmdb.credit}</span></p>`;

const plain = (html: string) => html.replace(/<link rel="preload"[^>]*\/>/g, "");

const typed = (title: string, kind = "movie", status = "want") => item({ kind, status, title, data: { year: 2001 } });

const fetched = (title: string, days: number | null, kind = "movie", extra: Record<string, unknown> = {}) =>
  item({ kind, status: "want", title, data: { cover: POSTER, tmdb: 910001, ...(days === null ? {} : { tmdb_at: addDays(TODAY, -days) }), ...extra } });

const page = async (rows: ItemRow[], kind: "movie" | "series" = "movie", id?: string) => {
  stage(rows);
  return plain(await markupOf("views/screens.tsx", ({ Screens }) => createElement(Screens, { kind, id })));
};

const posters = (html: string) => /<div class="posters">(.*?)<\/div><\/div>/.exec(html)?.[0] ?? "";

test("a list with a row typed by hand offers Find posters with the count, in one polite status line, between the add button and the search", async () => {
  const html = await page([typed("Pengabdi Setan")]);
  assert.equal(posters(html), '<div class="posters"><p class="hint imp-progress" role="status">1 poster needs a refresh</p><div class="imp-acts"><button type="button" class="secondary">Find posters</button></div></div>');
  assert.ok(html.indexOf('class="bk-tools"') < html.indexOf('class="posters"'));
  assert.ok(html.indexOf('class="posters"') < html.indexOf('role="search"'));
  assert.equal(html.match(/role="status"/g)?.length, 1);
});

test("the count follows the rows of this screen only, and says posters from two on", async () => {
  const rows = [typed("One"), typed("Two"), fetched("Old", 130), typed("A series", "series"), fetched("Fresh", 10)];
  assert.match(await page(rows), />3 posters need a refresh</);
  assert.match(await page(rows, "series"), />1 poster needs a refresh</);
  assert.match(await page([typed("Only")]), />1 poster needs a refresh</);
});

test("a row is offered a refresh from day 120 and not before, and a fresh or poster-less row with an id is never offered one", async () => {
  for (const days of [0, 119]) assert.equal(posters(await page([fetched("Seen", days)])), "", String(days));
  for (const days of [120, 169, 170]) assert.match(await page([fetched("Seen", days)]), /<p class="hint imp-progress" role="status">1 poster needs a refresh<\/p>/, String(days));
  assert.equal(posters(await page([fetched("No poster", 10, "movie", { cover: null })])), "");
  assert.match(await page([fetched("No stamp", null)]), /1 poster needs a refresh/);
});

test("an empty list, and a list where every row is fresh, has no Find posters block", async () => {
  assert.equal(posters(await page([])), "");
  assert.equal(posters(await page([fetched("A", 5), fetched("B", 100)])), "");
});

test("the TMDB credit closes a list that shows a poster or an id and is absent from one that does not", async () => {
  const withPoster = await page([fetched("Seen", 5), typed("Typed")]);
  assert.ok(withPoster.endsWith(CREDIT), "last on the page");
  assert.equal(withPoster.split(CREDIT).length, 2);
  assert.ok(withPoster.indexOf(CREDIT) > withPoster.lastIndexOf("</section>"));
  assert.doesNotMatch(await page([typed("Typed")]), /credit|TMDB/);
  assert.doesNotMatch(await page([fetched("Seen", 5)], "series"), /credit/);
});

test("a detail page links to TMDB for a row with an id: new tab, no opener, no referrer, the movie or the tv path", async () => {
  const movie = fetched("Seen", 5);
  const html = await page([movie], "movie", movie.id);
  assert.match(html, /<p><a class="button secondary" href="https:\/\/www\.themoviedb\.org\/movie\/910001" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open on TMDB<\/a><\/p>/);
  assert.ok(html.endsWith(CREDIT));
  const show = fetched("Show", 5, "series");
  assert.match(await page([show], "series", show.id), /href="https:\/\/www\.themoviedb\.org\/tv\/910001"/);
});

test("a detail page of a row with no id has no TMDB link and no credit, even with a leftover day", async () => {
  for (const data of [{ year: 2001 }, { tmdb_at: addDays(TODAY, -3) }, { cover: null, tmdb: null }]) {
    const row = item({ kind: "movie", status: "want", title: "Typed", data });
    const html = await page([row], "movie", row.id);
    assert.doesNotMatch(html, /themoviedb|credit|Open on TMDB/, JSON.stringify(data));
  }
});

test("the poster-only detail shows the credit but no link, because there is no id to open", async () => {
  const row = item({ kind: "movie", status: "want", title: "Poster only", data: { cover: POSTER } });
  const html = await page([row], "movie", row.id);
  assert.doesNotMatch(html, /Open on TMDB/);
  assert.ok(html.endsWith(CREDIT));
});

test("Settings ends with a Credits section: its heading, then the credit", async () => {
  stage([]);
  const html = plain(await markupOf("views/settings.tsx", ({ Settings }) => createElement(Settings, {})));
  assert.ok(html.endsWith(`<h2>Credits</h2>${CREDIT}</div>`));
  assert.equal(html.split(CREDIT).length, 2);
});

const done = { filled: 0, empty: 0, failed: 0, unsure: 0 };

let postersLine: (state: { phase: never; done: number; total: number; tally: typeof done }, remaining: number, kind: "movie" | "series") => string;

const line = (phase: string, extra: Partial<typeof done> = {}, remaining = 0, kind: "movie" | "series" = "movie", counts: [number, number] = [2, 5]) =>
  postersLine({ phase: phase as never, done: counts[0], total: counts[1], tally: { ...done, ...extra } }, remaining, kind);

test("every phase of Find posters has its own words, and a finished pass counts failures as no match", async () => {
  await markupOf("ui/screen-posters.tsx", (loaded) => ((postersLine = loaded.postersLine), createElement("p")));
  assert.equal(line("idle", {}, 3), "3 posters need a refresh");
  assert.equal(line("idle", {}, 1), "1 poster needs a refresh");
  assert.equal(line("idle", {}, 0), "");
  assert.equal(line("running"), "2 of 5");
  assert.equal(line("running", { unsure: 1 }), "2 of 5, 1 skipped (not sure)");
  assert.equal(line("stopping"), "Stopping");
  assert.equal(line("stopped"), "Stopped. Resume when you like. 2 of 5");
  assert.equal(line("offline"), "Offline. Connect and resume.");
  assert.equal(line("busy", {}, 0, "movie"), "The movie lookup is busy right now. Resume in a few minutes.");
  assert.equal(line("busy", {}, 0, "series"), "The series lookup is busy right now. Resume in a few minutes.");
  assert.equal(line("finished", { filled: 3, empty: 1, failed: 1, unsure: 0 }), "Done. 3 updated, 2 had no match.");
  assert.equal(line("finished", { unsure: 1 }), "Done. 0 updated, 0 had no match. 1 was skipped (not sure).");
  assert.equal(line("finished", { unsure: 2 }), "Done. 0 updated, 0 had no match. 2 were skipped (not sure).");
  assert.equal(line("finished", { filled: 1 }, 4), "Done. 1 updated, 0 had no match.");
});
