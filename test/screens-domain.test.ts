import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPatch } from "../shared/api.ts";
import type { ItemRow } from "../shared/tables.ts";
import { validateChange } from "../shared/validate.ts";
import { originalOf, parseYear, ratingOf, ratingPatch, screenSections, searchScreens, statusPatch, watchOf } from "../src/domain/screen.ts";
import { item } from "./domain-rows.ts";

const movie = (fields: Partial<ItemRow>) => item({ kind: "movie", status: "want", ...fields });

test("sections hold one kind each: watching, to watch by sort, watched newest first", () => {
  const rows = [
    movie({ title: "w2", sort: 2 }),
    movie({ title: "w1", sort: 1 }),
    movie({ title: "now", status: "watching" }),
    movie({ title: "old", status: "watched", done_on: "2026-01-02" }),
    movie({ title: "new", status: "watched", done_on: "2026-10-02" }),
    item({ kind: "series", title: "other kind", status: "watching" }),
    item({ kind: "book", title: "a book", status: "shelf" }),
  ];
  const sections = screenSections(rows, "movie");
  assert.deepEqual(sections.watching.map((row) => row.title), ["now"]);
  assert.deepEqual(sections.want.map((row) => row.title), ["w1", "w2"]);
  assert.deepEqual(sections.watched.map((row) => row.title), ["new", "old"]);
  assert.deepEqual(screenSections(rows, "series").watching.map((row) => row.title), ["other kind"]);
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
