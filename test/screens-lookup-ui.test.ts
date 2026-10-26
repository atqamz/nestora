import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ItemRow } from "../shared/tables.ts";
import { adopt } from "../src/domain/tmdb.ts";
import type { ScreenHit } from "../src/domain/tmdb.ts";
import { IDLE, followScreen } from "../src/store/lookup.ts";
import type { Lookup, Outcome, Search } from "../src/store/lookup.ts";
import { saveScreen } from "../src/ui/screen-save.ts";
import { text } from "../src/ui/text.ts";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const rule = (css: string, selector: string) =>
  new RegExp(`(?:^|\\n)${selector.replace(/[.>*[\]="():]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

const css = read("views/books.css");

const view = read("ui/screen-lookup.tsx");

const sheet = read("ui/screen-sheet.tsx");

const hit: ScreenHit = { kind: "movie", tmdb: 910001, title: "Pelabuhan Terakhir", original: "Last Harbour", year: 2017, cover: "https://image.tmdb.org/t/p/w342/abc.jpg" };

test("the matches are a labelled list of real buttons that are at least a row tall, with a visible focus ring, and the credit sits under the list", () => {
  assert.match(view, /<ul className="hits" aria-label=\{WORDS\.results\}>/);
  assert.match(view, /<button type="button" className="hit" onClick=\{\(event\) => choose\(event, hit, onPick\)\}>/);
  assert.match(view, /<\/ul>\s*<TmdbCredit \/>/);
  assert.match(rule(css, ".hit"), /min-height:\s*var\(--row-min\)/);
  assert.match(rule(css, ".hit"), /width:\s*100%/);
  assert.doesNotMatch(rule(css, ".hit"), /outline:\s*none/);
  assert.match(rule(css, ".hit .bk-text"), /flex:\s*1 1 8rem/);
  assert.equal(text.screen.lookup.results, "Matches from TMDB");
  assert.doesNotMatch(view, /<a[\s>]/);
});

test("each match shows its poster, title, and original title with the year, and the list stays out of the way when there is nothing to show", () => {
  assert.match(view, /<Cover book=\{\{ id: String\(hit\.tmdb\), title: hit\.title, data: \{ cover: hit\.cover \} \}\} \/>/);
  assert.match(view, /\{sub !== "" && <span className="bk-by">\{sub\}<\/span>\}/);
  assert.match(view, /\{search\.hits\.length > 0 && \(/);
  assert.match(rule(css, ".look-note:empty"), /position:\s*absolute/);
});

test("the status line is one polite live region that exists before it has words", () => {
  assert.equal(view.match(/role="status"/g)?.length, 1);
  assert.match(view, /<p className="hint look-note" role="status">/);
  assert.doesNotMatch(view, /aria-live="assertive"|role="alert"/);
});

test("every state has plain words, the book words where they exist, and each failure tells the user typing goes on", () => {
  const words = text.screen.lookup;
  assert.equal(words.offline, "Offline: type it in.");
  assert.equal(words.empty, "No match. Keep typing.");
  assert.equal(words.searching("movie"), "Searching for the movie");
  assert.equal(words.failed("series"), "The series lookup did not answer. Keep typing.");
  assert.equal(words.slow("movie"), "The movie lookup is slow. Keep typing.");
  assert.equal(words.found(1), "1 match");
  assert.equal(words.found(8), "8 matches");
  assert.equal(words.offline, text.books.lookup.offline);
  assert.equal(words.empty, text.books.lookup.empty);
  assert.equal(text.movies.noun, "movie");
  assert.equal(text.series.noun, "series");
  for (const state of ["busy", "offline", "failed", "slow", "empty", "found"]) assert.match(view, new RegExp(`search\\.state === "${state}"`), state);
});

test("the form searches while no match is picked for the title, from two letters, and the year it passes is the typed one", () => {
  assert.match(sheet, /const settled = heldPick\(picked, title\);/);
  assert.match(sheet, /useScreenSearch\(\{ kind, title, year: typedYear\.ok \? typedYear\.value : null \}, settled === null\)/);
  assert.match(read("hooks/use-lookup.ts"), /const MIN_SCREEN_LETTERS = 2;/);
  assert.match(read("hooks/use-lookup.ts"), /title\.trim\(\)\.length >= MIN_SCREEN_LETTERS/);
});

test("a typed year is not overwritten by a hit, and an empty one is filled", () => {
  assert.match(sheet, /const next = adopt\(\{ year \}, hit\);\s*setTitle\(next\.title\);\s*setYear\(next\.year\);\s*setPicked\(next\.picked\);/);
  assert.equal(adopt({ year: "1999" }, hit).year, "1999");
  assert.equal(adopt({ year: "" }, hit).year, "2017");
});

test("the Add button says 'Add as typed' while matches are on screen and nothing is picked, and 'Add' otherwise", () => {
  assert.equal(text.screen.sheet.asTyped, "Add as typed");
  assert.equal(text.screen.sheet.save, "Add");
  assert.match(sheet, /\{search\.hits\.length > 0 \? text\.screen\.sheet\.asTyped : text\.screen\.sheet\.save\}/);
});

const saved = async (input: Partial<Parameters<typeof saveScreen>[2]>) => {
  const rows: Record<string, unknown>[] = [];
  const create = async (_table: string, row: Record<string, unknown>) => (rows.push(row), { ok: true as const, id: "new" });
  const result = await saveScreen([] as ItemRow[], create as never, { kind: "movie", title: "  Pelabuhan Terakhir ", year: "", status: "want", who: "both", ...input }, "2026-10-26");
  return { result, row: rows[0] };
};

test("Add as typed saves the typed title and year with no TMDB key at all", async () => {
  const { result, row } = await saved({ year: "2017" });
  assert.equal(result.ok, true);
  assert.equal(row.title, "Pelabuhan Terakhir");
  assert.deepEqual(row.data, { year: 2017 });
  assert.deepEqual((await saved({ picked: null })).row.data, {});
  for (const key of ["cover", "tmdb", "tmdb_at", "original_title"]) assert.ok(!(key in ((await saved({ year: "2017" })).row.data as object)), key);
});

test("picking a hit saves the title, original title, year, poster, id and day, and no other TMDB field", async () => {
  const next = adopt({ year: "" }, hit);
  const { row } = await saved({ title: next.title, year: next.year, picked: next.picked });
  assert.equal(row.title, "Pelabuhan Terakhir");
  assert.deepEqual(row.data, { year: 2017, original_title: "Last Harbour", cover: hit.cover, tmdb: 910001, tmdb_at: "2026-10-26" });
  assert.deepEqual(Object.keys(row).sort(), ["data", "kind", "sort", "status", "title", "who"]);
});

test("a typed year stays on the row when the hit has another one, and a watched row gets its day beside the TMDB day", async () => {
  const next = adopt({ year: "1999" }, hit);
  const { row } = await saved({ title: next.title, year: next.year, picked: next.picked, status: "watched" });
  assert.equal((row.data as { year: number }).year, 1999);
  assert.equal(row.done_on, "2026-10-26");
  assert.equal((row.data as { tmdb: number }).tmdb, 910001);
});

test("the sheet hands the save only a pick that still belongs to the title, and drops one the title has left", () => {
  assert.match(sheet, /picked: settled/);
  assert.match(sheet, /if \(picked !== null && settled === null\) setPicked\(null\);/);
});

const stub = (out: Outcome<ScreenHit[]>) => {
  let cancelled = 0;
  const lookup = { screen: async () => out, cancel: () => void cancelled++ } as unknown as Lookup;
  return { lookup, cancelled: () => cancelled };
};

const seen = (lookup: Lookup, ready: boolean) => {
  const states: Search<ScreenHit>[] = [];
  const stop = followScreen(lookup, ready, { kind: "movie", title: "Up", year: null }, (search) => states.push(search));
  return { states, stop };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the search goes busy, then found, empty, offline, failed or slow, and a failure keeps no hits", async () => {
  const cases: [Outcome<ScreenHit[]>, Search<ScreenHit>][] = [
    [{ kind: "ok", value: [hit] }, { state: "found", hits: [hit] }],
    [{ kind: "ok", value: [] }, { state: "empty", hits: [] }],
    [{ kind: "offline" }, { state: "offline", hits: [] }],
    [{ kind: "failed", retry: 0 }, { state: "failed", hits: [] }],
    [{ kind: "slow" }, { state: "slow", hits: [] }],
    [{ kind: "stale" }, IDLE],
  ];
  for (const [out, last] of cases) {
    const run = seen(stub(out).lookup, true);
    await settle();
    assert.deepEqual(run.states, [{ state: "busy", hits: [] }, last], out.kind);
  }
});

test("a search that is not ready is idle and asks nothing, and an answer that arrives after the form moved on is dropped", async () => {
  let asked = 0;
  const idle = seen({ screen: async () => (asked++, { kind: "ok" as const, value: [hit] }), cancel() {} } as unknown as Lookup, false);
  await settle();
  assert.deepEqual(idle.states, [IDLE]);
  assert.equal(asked, 0);
  const late = stub({ kind: "ok", value: [hit] });
  const run = seen(late.lookup, true);
  run.stop();
  await settle();
  assert.deepEqual(run.states, [{ state: "busy", hits: [] }]);
  assert.equal(late.cancelled(), 1);
});

test("a pick made from the keyboard puts focus back on the title, because the button it came from leaves the page", () => {
  assert.match(view, /event\.detail === 0 \? event\.currentTarget\.closest\("dialog"\)\?\.querySelector<HTMLInputElement>\('input\[name="title"\]'\) : null;\s*onPick\(hit\);\s*title\?\.focus\(\);/);
});
