import { test } from "node:test";
import assert from "node:assert/strict";
import { ORDER_MAX } from "../shared/tables.ts";
import type { ItemRow } from "../shared/tables.ts";
import { collectionName, collectionNames, collections, joinPatch, leavePatch, moveOrders, nameTaken, parseCollection, renameTargets, restoreCollection, restoreName, restoreOrder } from "../src/domain/collection.ts";
import { lately } from "../src/domain/lately.ts";
import { screenList, screenSections, searchScreens } from "../src/domain/screen.ts";
import { item } from "./domain-rows.ts";

const film = (title: string, fields: Partial<ItemRow> = {}, data: Record<string, unknown> = {}) =>
  item({ kind: "movie", status: "want", title, ...fields, data: { ...data } });

const mark = (row: ItemRow, status: string) => void ((row as { status: string }).status = status);

const hannibal = (name = "Hannibal") => [
  film("Hannibal Rising", { created_at: "2026-10-04T00:00:00Z" }, { collection: name, order: 0 }),
  film("Red Dragon", { created_at: "2026-10-03T00:00:00Z" }, { collection: name, order: 1 }),
  film("The Silence of the Lambs", { created_at: "2026-10-01T00:00:00Z" }, { collection: name, order: 2 }),
  film("Hannibal", { created_at: "2026-10-02T00:00:00Z" }, { collection: name, order: 3 }),
];

const titles = (rows: readonly ItemRow[]) => rows.map((row) => row.title);

test("a collection lists its members in the order the couple set, not release order, whatever the input order", () => {
  const rows = hannibal();
  const [group] = collections([...rows].reverse(), "movie");
  assert.deepEqual(titles(group.rows), ["Hannibal Rising", "Red Dragon", "The Silence of the Lambs", "Hannibal"]);
  assert.equal(group.name, "Hannibal");
});

test("names group case-insensitively and ignoring outer and inner spaces, and the oldest member's spelling is shown", () => {
  const rows = [
    film("b", { created_at: "2026-10-02T00:00:00Z" }, { collection: "hannibal ", order: 1 }),
    film("a", { created_at: "2026-10-01T00:00:00Z" }, { collection: " Hannibal", order: 0 }),
    film("c", { created_at: "2026-10-03T00:00:00Z" }, { collection: "HANNIBAL  ", order: 2 }),
  ];
  const groups = collections(rows, "movie");
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, "Hannibal");
  assert.deepEqual(titles(groups[0].rows), ["a", "b", "c"]);
});

test("empty, whitespace, non-text and punctuation-only names mean no collection, so the row stays loose", () => {
  for (const collection of ["", "   ", "\t", "???", 5, null, undefined, {}, ["Hannibal"]]) {
    const row = film("Loose", {}, { collection });
    assert.equal(collectionName(row), null, JSON.stringify(collection));
    assert.deepEqual(collections([row], "movie"), []);
    assert.deepEqual(titles(screenSections([row], "movie").want), ["Loose"]);
  }
  assert.equal(collectionName(item({ kind: "movie", data: null })), null);
});

test("parseCollection trims, turns empty into none, and refuses punctuation-only and over-long names", () => {
  assert.deepEqual(parseCollection("  Hannibal "), { ok: true, value: "Hannibal" });
  assert.deepEqual(parseCollection(""), { ok: true, value: null });
  assert.deepEqual(parseCollection("   "), { ok: true, value: null });
  assert.deepEqual(parseCollection("!!!"), { ok: false });
  assert.deepEqual(parseCollection("x".repeat(60)), { ok: true, value: "x".repeat(60) });
  assert.deepEqual(parseCollection("x".repeat(61)), { ok: false });
});

test("a collection of one member is still a collection, with that member next up", () => {
  const [group] = collections([film("Alien", {}, { collection: "Alien", order: 0 })], "movie");
  assert.equal(group.rows.length, 1);
  assert.equal(group.next, group.rows[0].id);
});

test("only members of the asked kind count, and a series collection never mixes with a movie one", () => {
  const rows = [film("Movie", {}, { collection: "X", order: 0 }), item({ kind: "series", title: "Show", status: "want", data: { collection: "X", order: 0 } }), item({ kind: "book", title: "Book", data: { collection: "X" } })];
  assert.deepEqual(titles(collections(rows, "movie")[0].rows), ["Movie"]);
  assert.deepEqual(titles(collections(rows, "series")[0].rows), ["Show"]);
});

test("ties and missing order keys fall back to created_at then id, and a missing key sorts after every set one", () => {
  const rows = [
    film("missing old", { created_at: "2026-10-01T00:00:00Z" }, { collection: "X" }),
    film("tie late", { created_at: "2026-10-03T00:00:00Z" }, { collection: "X", order: 1 }),
    film("tie early b", { id: "00000000-0000-4000-8000-0000000000bb", created_at: "2026-10-02T00:00:00Z" }, { collection: "X", order: 1 }),
    film("tie early a", { id: "00000000-0000-4000-8000-0000000000aa", created_at: "2026-10-02T00:00:00Z" }, { collection: "X", order: 1 }),
    film("first", { created_at: "2026-10-09T00:00:00Z" }, { collection: "X", order: -5 }),
    film("junk", { created_at: "2026-10-08T00:00:00Z" }, { collection: "X", order: "3" }),
    film("huge", { created_at: "2026-10-07T00:00:00Z" }, { collection: "X", order: ORDER_MAX * 3 }),
  ];
  assert.deepEqual(titles(collections(rows, "movie")[0].rows), ["first", "tie early a", "tie early b", "tie late", "missing old", "huge", "junk"]);
});

test("next up is the first member in watch order that is not watched, and a finished collection has none", () => {
  const rows = hannibal();
  mark(rows[0], "watched");
  mark(rows[1], "watching");
  assert.equal(collections(rows, "movie")[0].next, rows[1].id);
  mark(rows[1], "watched");
  assert.equal(collections(rows, "movie")[0].next, rows[2].id);
  mark(rows[2], "watched");
  mark(rows[3], "watched");
  assert.equal(collections(rows, "movie")[0].next, null);
  mark(rows[0], "odd");
  assert.equal(collections(rows, "movie")[0].next, rows[0].id);
});

test("unfinished collections come before finished ones, each by name", () => {
  const done = (name: string) => film(`${name} 1`, { status: "watched" }, { collection: name, order: 0 });
  const open = (name: string) => film(`${name} 1`, {}, { collection: name, order: 0 });
  const rows = [done("Alien"), open("Zodiac"), open("Matrix"), done("Batman")];
  assert.deepEqual(collections(rows, "movie").map(({ name }) => name), ["Matrix", "Zodiac", "Alien", "Batman"]);
});

test("members leave the status sections and loose rows stay where they were", () => {
  const rows = [...hannibal(), film("Loose want", { sort: 1 }), film("Loose watching", { status: "watching" }), film("Loose seen", { status: "watched", done_on: "2026-10-01" })];
  const sections = screenSections(rows, "movie");
  assert.deepEqual(titles(sections.want), ["Loose want"]);
  assert.deepEqual(titles(sections.watching), ["Loose watching"]);
  assert.deepEqual(titles(sections.watched), ["Loose seen"]);
  const list = screenList(rows, "movie", "");
  assert.equal(list.mode, "sections");
  if (list.mode === "sections") assert.equal(list.groups.length, 1);
});

test("a screen with only collection members is not empty, and 'nothing left' needs every collection finished", () => {
  const rows = hannibal();
  const open = screenList(rows, "movie", "");
  assert.equal(open.mode === "sections" && open.allWatched, false);
  for (const row of rows) mark(row, "watched");
  const finished = screenList(rows, "movie", "");
  assert.equal(finished.mode === "sections" && finished.allWatched, true);
  assert.equal(screenList([], "movie", "").mode, "empty");
});

test("search still finds a member by title, in any status, without grouping it twice", () => {
  const rows = hannibal();
  mark(rows[1], "watched");
  assert.deepEqual(titles(searchScreens("red dragon", rows, "movie")), ["Red Dragon"]);
  assert.equal(screenList(rows, "movie", "hannibal").mode, "found");
});

test("collectionNames lists each collection once, for the suggestions", () => {
  const rows = [...hannibal(), ...hannibal("hannibal "), film("Alien", {}, { collection: "Alien", order: 0 })];
  assert.deepEqual(collectionNames(rows, "movie"), ["Alien", "Hannibal"]);
});

test("joining puts the row after the last member with the existing spelling, and a new name starts at 0", () => {
  const rows = hannibal();
  assert.deepEqual(joinPatch(rows, "movie", "HANNIBAL ").data, { collection: "Hannibal", order: 4 });
  assert.deepEqual(joinPatch(rows, "movie", "Alien").data, { collection: "Alien", order: 0 });
  assert.deepEqual(joinPatch([film("a", {}, { collection: "X", order: -7 })], "movie", "x").data, { collection: "X", order: 0 });
  assert.deepEqual(joinPatch([film("a", {}, { collection: "X" })], "movie", "x").data, { collection: "X", order: 0 });
});

test("leaving clears both keys, and the restore patches put back only what they name", () => {
  assert.deepEqual(leavePatch, { data: { collection: null, order: null } });
  const member = film("a", {}, { collection: "X", order: 2.5, year: 1999 });
  assert.deepEqual(restoreCollection(member), { data: { collection: "X", order: 2.5 } });
  assert.deepEqual(restoreName(member), { data: { collection: "X" } });
  assert.deepEqual(restoreOrder(member), { data: { order: 2.5 } });
  const loose = film("b");
  assert.deepEqual(restoreCollection(loose), { data: { collection: null, order: null } });
  assert.deepEqual(restoreOrder(loose), { data: { order: null } });
});

test("moving one step patches only the moved row, to a key between its new neighbours", () => {
  const rows = hannibal();
  assert.deepEqual(moveOrders(rows, rows[2].id, -1), [{ id: rows[2].id, order: 0.5 }]);
  assert.deepEqual(moveOrders(rows, rows[1].id, 1), [{ id: rows[1].id, order: 2.5 }]);
  assert.deepEqual(moveOrders(rows, rows[0].id, 1), [{ id: rows[0].id, order: 1.5 }]);
});

test("moving to the ends uses a key one past the end, and moving past an end does nothing", () => {
  const rows = hannibal();
  assert.deepEqual(moveOrders(rows, rows[1].id, -1), [{ id: rows[1].id, order: -1 }]);
  assert.deepEqual(moveOrders(rows, rows[2].id, 1), [{ id: rows[2].id, order: 4 }]);
  assert.deepEqual(moveOrders(rows, rows[0].id, -1), []);
  assert.deepEqual(moveOrders(rows, rows[3].id, 1), []);
  assert.deepEqual(moveOrders(rows, "nope", 1), []);
  assert.deepEqual(moveOrders([rows[0]], rows[0].id, 1), []);
});

test("when two neighbours share a key or have none, the move renumbers instead of producing an ambiguous key", () => {
  const tied = [film("a", { created_at: "2026-10-01T00:00:00Z" }, { collection: "X", order: 1 }), film("b", { created_at: "2026-10-02T00:00:00Z" }, { collection: "X", order: 1 }), film("c", { created_at: "2026-10-03T00:00:00Z" }, { collection: "X", order: 1 })];
  const moves = moveOrders(tied, tied[2].id, -1);
  const after = tied.map((row) => ({ ...row, data: { ...row.data, ...(moves.find((move) => move.id === row.id) ? { order: moves.find((move) => move.id === row.id)!.order } : {}) } }));
  assert.deepEqual(titles(collections(after, "movie")[0].rows), ["a", "c", "b"]);
  const bare = [film("a", { created_at: "2026-10-01T00:00:00Z" }, { collection: "X" }), film("b", { created_at: "2026-10-02T00:00:00Z" }, { collection: "X" })];
  const swapped = moveOrders(bare, bare[1].id, -1);
  assert.deepEqual(swapped.map(({ id }) => id).sort(), bare.map(({ id }) => id).sort());
  assert.ok(swapped.every(({ order }) => Number.isInteger(order) && Math.abs(order) <= ORDER_MAX));
});

test("when the gap between neighbours is used up, the move renumbers and every key stays in range", () => {
  const a = film("a", { created_at: "2026-10-01T00:00:00Z" }, { collection: "X", order: 1 });
  const b = film("b", { created_at: "2026-10-02T00:00:00Z" }, { collection: "X", order: 1 + Number.EPSILON });
  const c = film("c", { created_at: "2026-10-03T00:00:00Z" }, { collection: "X", order: 2 });
  const moves = moveOrders([a, b, c], c.id, -1);
  assert.ok(moves.length >= 1);
  assert.ok(moves.every(({ order }) => Math.abs(order) <= ORDER_MAX));
  const keyed = [a, b, c].map((row) => ({ ...row, data: { ...row.data, order: moves.find((move) => move.id === row.id)?.order ?? row.data!.order } }));
  assert.deepEqual(titles(collections(keyed, "movie")[0].rows), ["a", "c", "b"]);
});

test("a key at the range limit is never produced: the move renumbers instead", () => {
  const rows = [film("a", { created_at: "2026-10-01T00:00:00Z" }, { collection: "X", order: ORDER_MAX }), film("b", { created_at: "2026-10-02T00:00:00Z" }, { collection: "X", order: ORDER_MAX })];
  const moves = moveOrders(rows, rows[0].id, 1);
  assert.ok(moves.length > 0 && moves.every(({ order }) => order <= ORDER_MAX));
  const top = [film("a", {}, { collection: "X", order: ORDER_MAX }), film("b", { created_at: "2026-10-02T00:00:00Z" }, { collection: "X", order: ORDER_MAX - 1 })];
  assert.ok(moveOrders(top, top[1].id, 1).every(({ order }) => order <= ORDER_MAX));
});

test("a long run of moves keeps the order right and never leaves the range", () => {
  let rows = hannibal();
  const order = () => titles(collections(rows, "movie")[0].rows);
  let expected = order();
  for (let turn = 0; turn < 400; turn += 1) {
    const at = turn % 4;
    const step = turn % 7 < 3 ? -1 : 1;
    const target = expected[at];
    const row = rows.find((candidate) => candidate.title === target)!;
    const to = at + step;
    const moves = moveOrders(collections(rows, "movie")[0].rows, row.id, step);
    if (to >= 0 && to < 4) {
      expected = [...expected];
      expected.splice(to, 0, ...expected.splice(at, 1));
    }
    rows = rows.map((candidate) => {
      const move = moves.find(({ id }) => id === candidate.id);
      return move ? { ...candidate, data: { ...candidate.data, order: move.order } } : candidate;
    });
    assert.deepEqual(order(), expected, `turn ${turn}`);
    assert.ok(rows.every((candidate) => Math.abs(candidate.data!.order as number) <= ORDER_MAX));
  }
});

test("rename targets every member whose spelling differs, nothing for another collection, and respects case-only changes", () => {
  const rows = [...hannibal("hannibal "), film("Other", {}, { collection: "Alien", order: 0 }), film("Loose")];
  assert.equal(renameTargets(rows, "movie", "hannibal", "Hannibal Lecter").length, 4);
  assert.equal(renameTargets(rows, "movie", "hannibal", "hannibal").length, 0);
  assert.equal(renameTargets(rows, "movie", "HANNIBAL", "Hannibal").length, 4);
  assert.deepEqual(renameTargets(rows, "series", "hannibal", "X"), []);
});

test("a rename may change case of its own name but never take another collection's", () => {
  const rows = [...hannibal(), film("Other", {}, { collection: "Alien", order: 0 })];
  assert.equal(nameTaken(rows, "movie", "Hannibal", "hannibal"), false);
  assert.equal(nameTaken(rows, "movie", "Hannibal", "ALIEN "), true);
  assert.equal(nameTaken(rows, "movie", "Hannibal", "Fresh"), false);
  assert.equal(nameTaken(rows, "series", "Hannibal", "Alien"), false);
});

test("Lately still shows a collection film as added only: a move, a rename or a join never makes a changed line", () => {
  const stamp = { updated_by: "a" as const, created_at: "2026-10-05T04:00:00Z" };
  const added = film("Red Dragon", { ...stamp, updated_at: "2026-10-05T04:00:00Z" }, { collection: "Hannibal", order: 1 });
  const moved = film("Hannibal", { ...stamp, updated_at: "2026-10-05T09:00:00Z" }, { collection: "Hannibal", order: 0.5 });
  const renamed = item({ kind: "series", title: "Hannibal (TV)", status: "want", ...stamp, updated_at: "2026-10-05T10:00:00Z", data: { collection: "Hannibal", order: 0 } });
  assert.deepEqual(lately([added, moved, renamed], []).map((activity) => [activity.title, activity.verb]), [["Red Dragon", "added"]]);
});
