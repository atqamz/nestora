import { test } from "node:test";
import assert from "node:assert/strict";
import { tables } from "../shared/tables.ts";
import { YEAR_MAX, YEAR_MIN, validateChange, validateCreate } from "../shared/validate.ts";
import { text } from "../src/ui/text.ts";
import { CLIENT_STAMP, id } from "./sync-db.ts";

type Obj = Record<string, unknown>;

const stamps = { created_at: CLIENT_STAMP, updated_at: CLIENT_STAMP };

const screen = (kind: "movie" | "series", extra: Obj = {}) => ({ id: id(1), kind, title: kind === "movie" ? "Inception" : "Breaking Bad", status: "want", ...stamps, ...extra });

const kinds = ["movie", "series"] as const;

for (const kind of kinds) {
  test(`a full ${kind} passes the validator, and a minimal one too`, () => {
    assert.deepEqual(validateCreate("items", screen(kind)), []);
    assert.deepEqual(
      validateCreate("items", screen(kind, { status: "watched", who: "both", done_on: "2026-10-17", note: "Lights on", data: { original_title: "Origin", year: 2010, rating_a: "4", rating_b: "3" } })),
      [],
    );
  });

  test(`a ${kind} is refused for what the kind does not hold`, () => {
    const problems = (extra: Obj) => validateCreate("items", screen(kind, extra)).join("\n");
    assert.match(problems({ parent_id: id(2) }), /parent_id: not used by kind/);
    assert.match(problems({ data: { poster: "x" } }), /data\.poster: unknown key/);
    assert.match(problems({ data: { rating_a: "6" } }), /data\.rating_a: must be one of 1, 2, 3, 4, 5/);
    assert.match(problems({ data: { rating_b: 4 } }), /data\.rating_b: must be one of/);
    assert.match(problems({ data: { year: 99999 } }), /data\.year: must be a year from 1880 to 2200/);
    assert.match(problems({ data: { year: -1 } }), /data\.year: must be a year from 1880 to 2200/);
    assert.match(problems({ done_on: "2026-10-17" }), /done_on: only allowed when status is watched/);
    assert.match(problems({ status: "owned" }), /status: must be one of want, watching, watched/);
    assert.match(problems({ status: undefined }), /status: required for kind/);
    assert.match(problems({ who: "c" }), /who: must be one of a, b, both/);
    assert.match(problems({ amount: 5 }), /amount: not used by kind/);
    assert.match(problems({ due_on: "2026-11-01" }), /due_on: not used by kind/);
  });

  test(`leaving watched must clear done_on on a ${kind}, and entering it may set it`, () => {
    const watched = { ...screen(kind, { status: "watched", done_on: "2026-10-17" }), rev: 1, deleted_at: null, updated_by: "a" };
    assert.deepEqual(validateChange("items", watched, { status: "want", done_on: null }), []);
    assert.match(validateChange("items", watched, { status: "want" }).join("\n"), /done_on: only allowed when status is watched/);
    const want = { ...screen(kind), rev: 1, deleted_at: null, updated_by: "a" };
    assert.deepEqual(validateChange("items", want, { status: "watched", done_on: "2026-10-17" }), []);
  });
}

for (const kind of kinds) {
  test(`a ${kind} holds a rating of 1 to 5 for either partner, and nothing else`, () => {
    for (const side of ["rating_a", "rating_b"]) {
      for (const stars of ["1", "2", "3", "4", "5"]) assert.deepEqual(validateCreate("items", screen(kind, { data: { [side]: stars } })), [], `${side} ${stars}`);
      for (const stars of ["0", "6", "", "x", 5, null]) assert.notDeepEqual(validateCreate("items", screen(kind, { data: { [side]: stars } })), [], `${side} ${String(stars)}`);
    }
  });

  test(`a ${kind} year is a whole year from 1880 to 2200 on create, on a patch and through validateChange`, () => {
    const stored = { ...screen(kind, { data: { year: 2010 } }), rev: 1, deleted_at: null, updated_by: "a" };
    for (const year of [1880, 1999, 2200]) {
      assert.deepEqual(validateCreate("items", screen(kind, { data: { year } })), [], String(year));
      assert.deepEqual(validateChange("items", stored, { data: { year } }), [], String(year));
    }
    for (const year of [0, 5, 1700, 1879, 2201, 99999, -1, 2010.5, "2010", true]) {
      assert.match(validateCreate("items", screen(kind, { data: { year } })).join("\n"), /data\.year: must be a year from 1880 to 2200/, String(year));
      assert.match(validateChange("items", stored, { data: { year } }).join("\n"), /data\.year: must be a year from 1880 to 2200/, String(year));
    }
    assert.deepEqual(validateChange("items", stored, { data: { year: null } }), []);
  });
}

test("the year bounds are one pair of constants that the add sheet, the edit form and the registry all read", () => {
  assert.deepEqual([YEAR_MIN, YEAR_MAX], [1880, 2200]);
  assert.equal(tables.items.variants.movie.data.year, "year");
  assert.deepEqual(tables.items.variants.movie.caps, { "data.collection": 60 });
  assert.match(text.invalid.year, new RegExp(`${YEAR_MIN} to ${YEAR_MAX}`));
});

test("movie and series share one field set, so the registry cannot drift between them", () => {
  assert.deepEqual(tables.items.variants.movie, tables.items.variants.series);
  assert.deepEqual(Object.keys(tables.items.variants.movie.data), ["original_title", "year", "rating_a", "rating_b", "cover", "tmdb", "tmdb_at", "collection", "order"]);
  assert.deepEqual([tables.items.variants.movie.data.cover, tables.items.variants.movie.data.tmdb, tables.items.variants.movie.data.tmdb_at], ["cover", "tmdb", "date"]);
});

const POSTER = "https://image.tmdb.org/t/p/w342/abcDEF123_-xyz.jpg";

for (const kind of kinds) {
  test(`a ${kind} holds a TMDB poster, id and day together, and a patch may clear all three`, () => {
    const data = { cover: POSTER, tmdb: 910001, tmdb_at: "2026-10-26" };
    assert.deepEqual(validateCreate("items", screen(kind, { data })), []);
    const stored = { ...screen(kind, { data }), rev: 1, deleted_at: null, updated_by: "a" };
    assert.deepEqual(validateChange("items", stored, { data: { cover: null, tmdb: null, tmdb_at: null } }), []);
    assert.deepEqual(validateChange("items", stored, { data: { tmdb: 910002, tmdb_at: "2026-10-27" } }), []);
  });

  test(`a ${kind} refuses a cover that is not on a known cover host, in the TMDB shape or not`, () => {
    for (const cover of ["https://evil.example/a.jpg", "https://image.tmdb.org.evil.example/t/p/w342/a.jpg", "http://image.tmdb.org/t/p/w342/a.jpg", "https://image.tmdb.org/t/p/original/a.jpg", "https://image.tmdb.org/t/p/w342/a.jpg?x=1", "javascript:alert(1)", 5, ""]) {
      assert.match(validateCreate("items", screen(kind, { data: { cover } })).join("\n"), /data\.cover: must be an https URL on/, String(cover));
    }
  });

  test(`a ${kind} refuses a tmdb id that is not a positive safe integer`, () => {
    for (const tmdb of [0, -1, 1.5, "5", "", true, 2 ** 53, Number.NaN, Infinity]) {
      assert.match(validateCreate("items", screen(kind, { data: { tmdb } })).join("\n"), /data\.tmdb: must be a positive integer/, String(tmdb));
    }
    assert.match(validateCreate("items", screen(kind, { data: { tmdb: null } })).join("\n"), /data\.tmdb: must not be null/);
    for (const tmdb of [1, 910001, Number.MAX_SAFE_INTEGER]) assert.deepEqual(validateCreate("items", screen(kind, { data: { tmdb } })), [], String(tmdb));
  });

  test(`a ${kind} refuses a tmdb_at that is not a real day`, () => {
    for (const tmdb_at of ["2026-13-01", "2026-02-30", "26-10-26", "2026-10-26T00:00:00Z", 20261026, ""]) {
      assert.match(validateCreate("items", screen(kind, { data: { tmdb_at } })).join("\n"), /data\.tmdb_at: must be a date/, String(tmdb_at));
    }
  });
}
