import { test } from "node:test";
import assert from "node:assert/strict";
import { validateChange } from "../shared/validate.ts";
import { coverOf } from "../src/domain/cover.ts";
import { reorder, sortAfter } from "../src/domain/order.ts";
import { copiesAt, lastPlace, moveCopy, moverOf, placesOf, restoreMove } from "../src/domain/places.ts";
import { ratingPatch, readersNow, readingNow, readingOf, readingPatch } from "../src/domain/reading.ts";
import { item } from "./domain-rows.ts";

const place = (title: string, sort: number) => item({ kind: "place", title, status: null, sort });
const book = (title: string, data: Record<string, unknown> | null = null) => item({ kind: "book", title, status: "shelf", data });
const copy = (parent: { id: string }, fields = {}) => item({ kind: "copy", parent_id: parent.id, status: "here", who: "both", ...fields });

const homeA = place("Home A", 1);
const homeB = place("Home B", 2);
const laskar = book("Laskar Pelangi");

test("places come in their manual order, then creation order", () => {
  const same = place("Same", 2);
  assert.deepEqual(placesOf([homeB, same, homeA, laskar]).map((row) => row.title), ["Home A", "Home B", "Same"]);
});

test("copiesAt lists every copy of a place, gone ones included, and nothing else", () => {
  const here = copy(laskar, { group_key: homeA.id });
  const gone = copy(laskar, { group_key: homeA.id, status: "gone" });
  const elsewhere = copy(laskar, { group_key: homeB.id });
  assert.deepEqual(copiesAt([homeA, here, gone, elsewhere, laskar], homeA.id), [here, gone]);
  assert.deepEqual(copiesAt([homeA, here], homeB.id), []);
});

test("a move records the place left and the day, and is valid for the server", () => {
  const here = copy(laskar, { group_key: homeA.id });
  const patch = moveCopy(here, homeB.id, "2026-10-19", "b");
  assert.deepEqual(patch, { group_key: homeB.id, data: { was_at: homeA.id, moved_on: "2026-10-19", moved_by: "b" } });
  assert.deepEqual(validateChange("items", here, patch!), []);
});

test("moving to where the copy already is does nothing, and a copy with no place leaves no previous place", () => {
  const here = copy(laskar, { group_key: homeA.id });
  assert.equal(moveCopy(here, homeA.id, "2026-10-19", "a"), null);
  const loose = copy(laskar, { group_key: null });
  assert.deepEqual(moveCopy(loose, homeA.id, "2026-10-19", "a"), { group_key: homeA.id, data: { was_at: null, moved_on: "2026-10-19", moved_by: "a" } });
  assert.deepEqual(moveCopy(here, null, "2026-10-19", null), { group_key: null, data: { was_at: homeA.id, moved_on: "2026-10-19", moved_by: null } });
});

test("undoing a move puts back the place, the previous place and the date the copy had", () => {
  const before = copy(laskar, { group_key: homeA.id, data: { format: "print", was_at: homeB.id, moved_on: "2026-09-01", moved_by: "b" } });
  assert.deepEqual(restoreMove(before), { group_key: homeA.id, data: { was_at: homeB.id, moved_on: "2026-09-01", moved_by: "b" } });
  const fresh = copy(laskar, { group_key: homeA.id });
  assert.deepEqual(restoreMove(fresh), { group_key: homeA.id, data: { was_at: null, moved_on: null, moved_by: null } });
  assert.deepEqual(validateChange("items", fresh, restoreMove(fresh)), []);
});

test("the last-used place is where a copy was touched last, then the first place, then none", () => {
  const old = copy(laskar, { group_key: homeA.id, updated_at: "2026-10-01T00:00:00Z" });
  const recent = copy(laskar, { group_key: homeB.id, updated_at: "2026-10-05T00:00:00Z" });
  const gone = copy(laskar, { group_key: homeA.id, updated_at: "2026-10-09T00:00:00Z", status: "gone" });
  assert.equal(lastPlace([homeA, homeB, old, recent, gone]), homeB.id);
  assert.equal(lastPlace([homeB, homeA]), homeA.id);
  assert.equal(lastPlace([laskar]), null);
  assert.equal(lastPlace([homeA, copy(laskar, { group_key: "00000000-0000-4000-8000-0000000000ff" })]), homeA.id);
});

test("a new row goes after the last one, and reordering renumbers only the rows that move", () => {
  assert.equal(sortAfter([]), 0);
  assert.equal(sortAfter([homeA, homeB]), 3);
  const first = place("First", 0);
  const second = place("Second", 1);
  const third = place("Third", 2);
  assert.deepEqual(reorder([third, first, second], second.id, -1), [
    { id: second.id, sort: 0 },
    { id: first.id, sort: 1 },
  ]);
  const tied = [place("Tied 1", 0), place("Tied 2", 0), place("Tied 3", 0)];
  assert.deepEqual(reorder(tied, tied[2].id, -1), [
    { id: tied[2].id, sort: 1 },
    { id: tied[1].id, sort: 2 },
  ]);
  assert.deepEqual(reorder([homeA, homeB], homeA.id, -1), []);
  assert.deepEqual(reorder([homeA, homeB], homeB.id, 1), []);
  assert.deepEqual(reorder([homeA, homeB], "missing", 1), []);
  assert.deepEqual(reorder([homeA, homeB], homeA.id, 1), [{ id: homeB.id, sort: 0 }]);
});

test("each partner reads their own keys, and bad values read as nothing", () => {
  const read = book("Read", { reading_a: "read", rating_a: "5", finished_a: "2026-03-12", reading_b: "reading", rating_b: "9" });
  assert.deepEqual(readingOf(read, "a"), { state: "read", rating: 5, finished: "2026-03-12" });
  assert.deepEqual(readingOf(read, "b"), { state: "reading", rating: null, finished: null });
  assert.deepEqual(readingOf(book("Plain"), "a"), { state: null, rating: null, finished: null });
  assert.deepEqual(readingOf(book("Odd", { reading_a: "done", rating_a: "x" }), "a"), { state: null, rating: null, finished: null });
});

test("picking a state writes only that side, stamps the day for Read, and picking it again clears the lot", () => {
  const plain = book("Plain");
  assert.deepEqual(readingPatch(plain, "b", "reading", "2026-10-19"), { data: { reading_b: "reading", finished_b: null } });
  assert.deepEqual(readingPatch(plain, "a", "read", "2026-10-19"), { data: { reading_a: "read", finished_a: "2026-10-19" } });
  const read = book("Read", { reading_a: "read", rating_a: "4", finished_a: "2026-03-12" });
  assert.deepEqual(readingPatch(read, "a", "read", "2026-10-19"), { data: { reading_a: null, rating_a: null, finished_a: null } });
  assert.deepEqual(readingPatch(read, "a", "dnf", "2026-10-19"), { data: { reading_a: "dnf", finished_a: null } });
  for (const patch of [readingPatch(plain, "a", "read", "2026-10-19"), readingPatch(read, "a", "read", "2026-10-19"), ratingPatch(read, "a", 2)]) {
    assert.deepEqual(validateChange("items", read, patch), []);
  }
});

test("a star sets the rating as text, and the same star again clears it", () => {
  const rated = book("Rated", { reading_b: "read", rating_b: "3" });
  assert.deepEqual(ratingPatch(rated, "b", 5), { data: { rating_b: "5" } });
  assert.deepEqual(ratingPatch(rated, "b", 3), { data: { rating_b: null } });
  assert.deepEqual(ratingPatch(book("Plain"), "a", 1), { data: { rating_a: "1" } });
});

test("reading now lists shelf books either partner is reading, with who, and skips wishes", () => {
  const both = book("Both", { reading_a: "reading", reading_b: "reading" });
  const mine = item({ kind: "book", title: "Mine", status: "shelf", sort: -1, data: { reading_a: "reading" } });
  const wish = item({ kind: "book", title: "Wish", status: "wish", data: { reading_a: "reading" } });
  assert.deepEqual(readersNow(both), ["a", "b"]);
  assert.deepEqual(readersNow(mine), ["a"]);
  assert.deepEqual(readersNow(book("Idle", { reading_a: "read" })), []);
  assert.deepEqual(readingNow([wish, mine, both, laskar, homeA]).map((row) => row.title), ["Mine", "Both"]);
});

test("a generated cover takes initials from the first two words, or the first two letters of one word", () => {
  assert.equal(coverOf({ id: "x", title: "Pangeran Kecil" }).initials, "PK");
  assert.equal(coverOf({ id: "x", title: "Laskar" }).initials, "LA");
  assert.equal(coverOf({ id: "x", title: "  “Le Petit Prince”" }).initials, "LP");
  assert.equal(coverOf({ id: "x", title: "Émile" }).initials, "ÉM");
  assert.equal(coverOf({ id: "x", title: "!!!" }).initials, "?");
  assert.equal(coverOf({ id: "x", title: "Averyveryveryverylongtitlewithnospaces60" }).initials, "AV");
});

test("a cover tone depends only on the row id and uses both tints across ids", () => {
  const tones = [...Array(40).keys()].map((n) => coverOf({ id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, title: "T" }).tone);
  assert.deepEqual([...new Set(tones)].sort(), ["a", "b"]);
  assert.equal(coverOf({ id: "same", title: "One" }).tone, coverOf({ id: "same", title: "Another" }).tone);
});

test("the mover is the one who moved the copy, not whoever edited it last, and a copy without the mark has none", () => {
  const moved = copy(laskar, { group_key: homeA.id, updated_by: "b", data: { moved_on: "2026-10-02", moved_by: "a" } });
  assert.equal(moverOf(moved), "a");
  assert.equal(moverOf(copy(laskar, { updated_by: "b", data: { moved_on: "2026-10-02" } })), null);
  assert.equal(moverOf(copy(laskar, { data: { moved_by: null } })), null);
  assert.equal(moverOf(copy(laskar, { data: { moved_by: "x" } })), null);
  assert.equal(moverOf(copy(laskar)), null);
  assert.equal(moveCopy(moved, homeB.id, "2026-10-19", "b")!.data!.moved_by, "b");
});
