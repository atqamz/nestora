import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPatch } from "../shared/api.ts";
import type { ItemRow } from "../shared/tables.ts";
import { validateChange } from "../shared/validate.ts";
import { OPEN_ALL, START, WATCH, originalOf, parseYear, ratingOf, ratingPatch, ratingRows, restoreStatus, screenDetail, screenFacts, screenList, screenSections, searchScreens, statusPatch, watchOf, yearOf } from "../src/domain/screen.ts";
import { parseField } from "../src/domain/field.ts";
import { fieldType } from "../src/ui/registry.ts";
import { splitErrors } from "../src/ui/failure.ts";
import { text } from "../src/ui/text.ts";
import { item } from "./domain-rows.ts";

const movie = (fields: Partial<ItemRow>) => item({ kind: "movie", status: "want", ...fields });

test("sections hold one kind each: watching and to watch by sort, watched newest first, whatever the input order", () => {
  const rows = [
    movie({ title: "w2", sort: 2 }),
    movie({ title: "w1", sort: 1 }),
    movie({ title: "w3", sort: 3 }),
    movie({ title: "n2", status: "watching", sort: 2 }),
    movie({ title: "n1", status: "watching", sort: 1 }),
    movie({ title: "n3", status: "watching", sort: 3 }),
    movie({ title: "mid", status: "watched", done_on: "2026-05-02", sort: 1 }),
    movie({ title: "new", status: "watched", done_on: "2026-10-02", sort: 3 }),
    movie({ title: "old", status: "watched", done_on: "2026-01-02", sort: 2 }),
    item({ kind: "series", title: "other kind", status: "watching" }),
    item({ kind: "book", title: "a book", status: "shelf" }),
  ];
  const sections = screenSections(rows, "movie");
  assert.deepEqual(sections.watching.map((row) => row.title), ["n1", "n2", "n3"]);
  assert.deepEqual(sections.want.map((row) => row.title), ["w1", "w2", "w3"]);
  assert.deepEqual(sections.watched.map((row) => row.title), ["new", "mid", "old"]);
  assert.deepEqual(screenSections(rows, "series").watching.map((row) => row.title), ["other kind"]);
});

test("watched rows with the same day, or with no day, fall back to the manual sort, and a dated row precedes an undated one", () => {
  const rows = [
    movie({ title: "undated b", status: "watched", done_on: null, sort: 2 }),
    movie({ title: "same b", status: "watched", done_on: "2026-03-03", sort: 2 }),
    movie({ title: "undated a", status: "watched", done_on: null, sort: 1 }),
    movie({ title: "dated", status: "watched", done_on: "2026-01-01", sort: 9 }),
    movie({ title: "same a", status: "watched", done_on: "2026-03-03", sort: 1 }),
  ];
  assert.deepEqual(screenSections(rows, "movie").watched.map((row) => row.title), ["same a", "same b", "dated", "undated a", "undated b"]);
});

test("a row with a status outside the three lands in To watch rather than vanishing", () => {
  assert.equal(watchOf(movie({ status: "odd" as never })), "want");
  assert.deepEqual(screenSections([movie({ title: "odd", status: null })], "movie").want.map((row) => row.title), ["odd"]);
});

test("statusPatch stamps done_on on watched, clears it on leaving, and does nothing for the same status", () => {
  const want = movie({});
  assert.deepEqual(statusPatch(want, "watched", "2026-10-17"), { status: "watched", done_on: "2026-10-17" });
  assert.deepEqual(statusPatch(want, "watching", "2026-10-17"), { status: "watching", done_on: null });
  const watched = movie({ status: "watched", done_on: "2026-10-17" });
  assert.deepEqual(statusPatch(watched, "want", "2026-10-18"), { status: "want", done_on: null });
  assert.equal(statusPatch(watched, "watched", "2026-10-18"), null);
});

test("every status move yields a merged row that passes validateChange, in all nine directions", () => {
  for (const from of ["want", "watching", "watched"] as const) {
    for (const to of ["want", "watching", "watched"] as const) {
      const row = movie({ status: from, done_on: from === "watched" ? "2026-10-01" : null });
      const patch = statusPatch(row, to, "2026-10-17");
      if (patch === null) continue;
      assert.deepEqual(validateChange("items", row, patch), [], `${from} to ${to}`);
      const merged = applyPatch(row as never, patch as never) as ItemRow;
      assert.equal(merged.done_on, to === "watched" ? "2026-10-17" : null, `${from} to ${to}`);
    }
  }
});

test("ratingPatch writes only the given side's key, as a string, and clears on the same star", () => {
  const row = movie({ status: "watched", data: { rating_b: "2", year: 2010 } });
  assert.deepEqual(ratingPatch(row, "a", 4), { data: { rating_a: "4" } });
  assert.deepEqual(ratingPatch(row, "b", 5), { data: { rating_b: "5" } });
  assert.deepEqual(ratingPatch(row, "b", 2), { data: { rating_b: null } });
  assert.deepEqual(validateChange("items", row, ratingPatch(row, "a", 4)), []);
});

test("ratingOf reads one side and ignores anything that is not 1 to 5", () => {
  const row = movie({ data: { rating_a: "3", rating_b: "9" } });
  assert.equal(ratingOf(row, "a"), 3);
  assert.equal(ratingOf(row, "b"), null);
  assert.equal(ratingOf(movie({ data: null }), "a"), null);
});

test("search folds accents and case, matches title and original title by word prefix, and keeps section order", () => {
  const rows = [
    movie({ title: "Spirited Away", data: { original_title: "千と千尋の神隠し" }, sort: 1 }),
    movie({ title: "Amélie", data: { original_title: "Le Fabuleux Destin d'Amélie Poulain" }, sort: 2 }),
    movie({ title: "Seen it", status: "watched", done_on: "2026-01-01", data: { original_title: "Amelie again" } }),
    item({ kind: "series", title: "Amelie the series" }),
  ];
  const titles = (query: string) => searchScreens(query, rows, "movie").map((row) => row.title);
  assert.deepEqual(titles("amelie"), ["Amélie", "Seen it"]);
  assert.deepEqual(titles("AMÉLIE poul"), ["Amélie"]);
  assert.deepEqual(titles("fabuleux"), ["Amélie"]);
  assert.deepEqual(titles("千と"), ["Spirited Away"]);
  assert.deepEqual(titles("spir awa"), ["Spirited Away"]);
  assert.deepEqual(titles("nothing"), []);
  assert.deepEqual(searchScreens("amelie", rows, "series").map((row) => row.title), ["Amelie the series"]);
});

test("the original title shows only when it differs from the title after folding", () => {
  assert.equal(originalOf(movie({ title: "Amélie", data: { original_title: "amelie" } })), null);
  assert.equal(originalOf(movie({ title: "Parasite", data: { original_title: "기생충" } })), "기생충");
  assert.equal(originalOf(movie({ data: null })), null);
});

test("a year is empty or four digits from 1880 to 2200", () => {
  assert.deepEqual(parseYear(" "), { ok: true, value: null });
  assert.deepEqual(parseYear(" 2017 "), { ok: true, value: 2017 });
  for (const bad of ["99", "20017", "1879", "2201", "2e3", "-2017", "20 17", "2017.0"]) assert.deepEqual(parseYear(bad), { ok: false }, bad);
  assert.deepEqual(parseYear("1880"), { ok: true, value: 1880 });
  assert.deepEqual(parseYear("2200"), { ok: true, value: 2200 });
});

test("the three statuses are To watch, Watching and Watched in that order, and the add sheet offers the first and last", () => {
  assert.deepEqual([...WATCH], ["want", "watching", "watched"]);
  assert.deepEqual([...START], ["want", "watched"]);
  assert.deepEqual(WATCH.map((pick) => text.screen.pick[pick]), ["To watch", "Watching", "Watched"]);
});

test("Watching now keeps the manual order, then the older row first", () => {
  const rows = [
    movie({ title: "third", status: "watching", sort: 5 }),
    movie({ title: "first", status: "watching", sort: 1 }),
    movie({ title: "second b", status: "watching", sort: 2, created_at: "2026-10-02T00:00:00Z" }),
    movie({ title: "second a", status: "watching", sort: 2, created_at: "2026-10-01T00:00:00Z" }),
  ];
  assert.deepEqual(screenSections(rows, "movie").watching.map((row) => row.title), ["first", "second a", "second b", "third"]);
});

test("a rating is a whole number from 1 to 5, so one star counts and clears on the same star", () => {
  for (const [stored, read] of [["1", 1], ["2", 2], ["5", 5], ["0", null], ["6", null], ["1.5", null], ["", null], ["x", null]] as const) {
    assert.equal(ratingOf(movie({ data: { rating_a: stored } }), "a"), read, stored);
  }
  assert.equal(ratingOf(movie({ data: { rating_b: 3 } }), "b"), 3);
  assert.equal(ratingOf(movie({}), "a"), null);
  const rated = movie({ status: "watched", data: { rating_a: "1" } });
  assert.deepEqual(ratingPatch(rated, "a", 1), { data: { rating_a: null } });
  assert.deepEqual(ratingPatch(rated, "a", 2), { data: { rating_a: "2" } });
  assert.deepEqual(ratingPatch(movie({ status: "watched" }), "b", 1), { data: { rating_b: "1" } });
});

test("yearOf reads a number and nothing else", () => {
  assert.equal(yearOf(movie({ data: { year: 2010 } })), 2010);
  for (const data of [null, {}, { year: "2010" }, { year: null }, { year: true }]) assert.equal(yearOf(movie({ data })), null, JSON.stringify(data));
});

test("search matches the start of a word, never the middle", () => {
  const rows = [movie({ title: "Spirited Away" })];
  assert.deepEqual(searchScreens("irit", rows, "movie"), []);
  assert.deepEqual(searchScreens("way", rows, "movie"), []);
  assert.deepEqual(searchScreens("aw", rows, "movie").length, 1);
});

test("restoreStatus puts back the earlier status and date, from every start to every move", () => {
  for (const from of WATCH) {
    for (const to of WATCH) {
      const row = movie({ status: from, done_on: from === "watched" ? "2026-10-01" : null, note: "keep", who: "a" });
      const patch = statusPatch(row, to, "2026-10-17");
      if (patch === null) continue;
      const moved = applyPatch(row as never, patch as never) as ItemRow;
      const back = restoreStatus(row);
      assert.deepEqual(validateChange("items", moved, back), [], `${from} to ${to}`);
      const restored = applyPatch(moved as never, back as never) as ItemRow;
      assert.deepEqual([restored.status, restored.done_on, restored.note, restored.who], [row.status, row.done_on, "keep", "a"], `${from} to ${to}`);
    }
  }
  assert.deepEqual(restoreStatus(movie({ status: "odd" as never })), { status: "want", done_on: null });
});

test("ratingRows lists the signed-in partner first and marks only that side editable, and none while the side is unknown", () => {
  const row = movie({ status: "watched", data: { rating_a: "4", rating_b: "2" } });
  assert.deepEqual(ratingRows(row, "a"), [{ side: "a", stars: 4, mine: true }, { side: "b", stars: 2, mine: false }]);
  assert.deepEqual(ratingRows(row, "b"), [{ side: "b", stars: 2, mine: true }, { side: "a", stars: 4, mine: false }]);
  assert.deepEqual(ratingRows(row, null), [{ side: "a", stars: 4, mine: false }, { side: "b", stars: 2, mine: false }]);
  assert.deepEqual(ratingRows(movie({}), "b"), [{ side: "b", stars: null, mine: true }, { side: "a", stars: null, mine: false }]);
});

test("a star tap writes only the signed-in partner's key and leaves the other side to the other phone", () => {
  const row = movie({ status: "watched", data: { rating_a: "4" } });
  for (const me of ["a", "b"] as const) {
    for (const { side, mine } of ratingRows(row, me)) {
      if (!mine) continue;
      const patch = ratingPatch(row, side, 3);
      assert.deepEqual(Object.keys(patch.data as object), [`rating_${me}`]);
      assert.deepEqual(validateChange("items", row, patch), []);
    }
  }
});

test("the row facts: subtitle, owner, watched date and the stars each partner gave, mine first", () => {
  const watched = movie({ title: "Parasite", status: "watched", done_on: "2026-10-17", who: "b", data: { original_title: "기생충", year: 2019, rating_a: "1", rating_b: "5" } });
  assert.deepEqual(screenFacts(watched, "b"), {
    original: "기생충",
    year: 2019,
    sub: "기생충 · 2019",
    side: "b",
    watched: true,
    watchedOn: "2026-10-17",
    rated: [{ side: "b", stars: 5 }, { side: "a", stars: 1 }],
  });
  assert.deepEqual(screenFacts(watched, "a").rated, [{ side: "a", stars: 1 }, { side: "b", stars: 5 }]);
  assert.deepEqual(screenFacts(watched, null).rated, [{ side: "a", stars: 1 }, { side: "b", stars: 5 }]);
  assert.deepEqual(screenFacts(movie({ status: "watched", done_on: "2026-10-17", data: { rating_b: "2" } }), "a").rated, [{ side: "b", stars: 2 }]);
});

test("the row facts hide what a row does not have: no subtitle, no owner for both, no date or stars before it is watched", () => {
  const plain = screenFacts(movie({ who: "both", data: { rating_a: "3" } }), "a");
  assert.deepEqual(plain, { original: null, year: null, sub: "", side: null, watched: false, watchedOn: null, rated: [] });
  assert.equal(screenFacts(movie({ who: null }), "a").side, null);
  assert.equal(screenFacts(movie({ who: "a" }), "a").side, "a");
  assert.equal(screenFacts(movie({ data: { year: 2010 } }), "a").sub, "2010");
  assert.equal(screenFacts(movie({ data: { original_title: "Origin" } }), "a").sub, "Origin");
  assert.equal(screenFacts(movie({ status: "watching", done_on: "2026-10-17" }), "a").watchedOn, null);
  assert.equal(screenFacts(movie({ status: "watched", done_on: null }), "a").watchedOn, null);
});

test("a detail id opens only under its own kind: a movie never opens as a series and the reverse", () => {
  const film = movie({ title: "Inception" });
  const show = item({ kind: "series", title: "Breaking Bad", status: "want" });
  const book = item({ kind: "book", title: "A book", status: "shelf" });
  const rows = [film, show, book];
  assert.deepEqual(screenDetail(rows, "movie", film.id), { row: film, elsewhere: false });
  assert.deepEqual(screenDetail(rows, "series", show.id), { row: show, elsewhere: false });
  assert.deepEqual(screenDetail(rows, "series", film.id), { row: null, elsewhere: true });
  assert.deepEqual(screenDetail(rows, "movie", show.id), { row: null, elsewhere: true });
  assert.deepEqual(screenDetail(rows, "movie", book.id), { row: null, elsewhere: true });
  assert.deepEqual(screenDetail(rows, "movie", "00000000-0000-4000-8000-ffffffffffff"), { row: null, elsewhere: false });
  assert.deepEqual(screenDetail([], "movie", film.id), { row: null, elsewhere: false });
});

test("the list is empty, found or in sections, and the search runs only when there is something to search", () => {
  const rows = [
    movie({ title: "Inception", sort: 1 }),
    movie({ title: "Heat", status: "watched", done_on: "2026-10-01" }),
    item({ kind: "series", title: "Inception the series" }),
  ];
  assert.deepEqual(screenList([], "movie", ""), { mode: "empty" });
  assert.deepEqual(screenList([], "movie", "heat"), { mode: "empty" });
  assert.deepEqual(screenList([item({ kind: "series" })], "movie", ""), { mode: "empty" });
  const found = screenList(rows, "movie", " ince ");
  assert.equal(found.mode, "found");
  assert.deepEqual(found.mode === "found" ? found.found.map((row) => row.title) : null, ["Inception"]);
  const none = screenList(rows, "movie", "zzz");
  assert.deepEqual(none.mode === "found" ? none.found : null, []);
  for (const blank of ["", "  "]) assert.equal(screenList(rows, "movie", blank).mode, "sections", JSON.stringify(blank));
});

test("the sections say when everything is watched, and keep Watched open up to 30 rows", () => {
  const some = (n: number, status: string) => Array.from({ length: n }, (_, i) => movie({ title: `${status} ${i}`, status, done_on: status === "watched" ? "2026-10-01" : null, sort: i }));
  const sections = (rows: ItemRow[]) => {
    const shown = screenList(rows, "movie", "");
    if (shown.mode !== "sections") throw new Error(shown.mode);
    return shown;
  };
  assert.equal(OPEN_ALL, 30);
  assert.equal(sections([...some(2, "want"), ...some(1, "watched")]).allWatched, false);
  assert.equal(sections([...some(2, "watching"), ...some(1, "watched")]).allWatched, false);
  assert.equal(sections(some(3, "watched")).allWatched, true);
  assert.equal(sections(some(30, "watched")).openWatched, true);
  assert.equal(sections(some(31, "watched")).openWatched, false);
  assert.equal(sections(some(1, "watched")).openWatched, true);
  assert.deepEqual(sections([...some(1, "watching"), ...some(2, "want"), ...some(3, "watched")]).watched.length, 3);
});

test("the edit form's year: empty clears, a four-digit year from 1880 to 2200 is kept, anything else is refused with the year message", () => {
  assert.equal(fieldType("movie", "data.year"), "year");
  assert.equal(fieldType("series", "data.year"), "year");
  assert.deepEqual(parseField("year", ""), { ok: true, value: null });
  assert.deepEqual(parseField("year", " 2017 "), { ok: true, value: 2017 });
  assert.deepEqual(parseField("year", "1880"), { ok: true, value: 1880 });
  assert.deepEqual(parseField("year", "2200"), { ok: true, value: 2200 });
  for (const bad of ["5", "0", "1700", "1879", "2201", "99999", "-3", "abc", "2.017", "2017.0"]) assert.deepEqual(parseField("year", bad), { ok: false }, bad);
  assert.deepEqual(parseField("int", "2.017"), { ok: true, value: 2017 });
  assert.equal(text.invalid.year, "Enter a year from 1880 to 2200, or leave it empty.");
  assert.doesNotMatch(text.invalid.year, /2500000|2\.500\.000/);
});

test("a year the Worker refuses reaches the edit form's Year field as the year message, not the money one", () => {
  const stored = { ...movie({ data: { year: 2010 } }), rev: 1 };
  const errors = validateChange("items", stored, { data: { year: 5 } });
  const { fields, rest } = splitErrors(errors, ["title", "data.original_title", "data.year", "who", "note"]);
  assert.deepEqual(Object.keys(fields), ["data.year"]);
  assert.deepEqual(rest, []);
  assert.equal((text.invalid as Record<string, string>)[fieldType("movie", "data.year") as string], text.invalid.year);
});
