import { test } from "node:test";
import assert from "node:assert/strict";
import { empty, enter, leave, parse, replay, returning } from "../src/domain/place.ts";
import type { Memory } from "../src/domain/place.ts";

const home = { key: "k1", route: "/" };
const routine = { key: "k2", route: "/routines/r1" };
const place = (y: number, ...open: boolean[]) => ({ y, open });

const visited = (): Memory => {
  let memory = enter(empty(), home, null);
  memory = leave(memory, home, place(1500, false, true));
  return enter(memory, routine, "/");
};

test("leaving an entry remembers where it was, by entry and by route", () => {
  const memory = leave(enter(empty(), home, null), home, place(1500, true));
  assert.deepEqual(memory.entries.k1, { y: 1500, open: [true], route: "/", from: null });
  assert.deepEqual(memory.routes["/"], place(1500, true));
});

test("a known history entry on the same route replays its place", () => {
  assert.deepEqual(replay(visited(), "k1", "/"), { y: 1500, open: [false, true], route: "/", from: null });
});

test("an entry with no key, an unknown key or another route replays nothing", () => {
  const memory = visited();
  assert.equal(replay(memory, null, "/"), null);
  assert.equal(replay(memory, "gone", "/"), null);
  assert.equal(replay(memory, "k1", "/routines"), null);
});

test("a fresh entry starts at the top", () => {
  assert.deepEqual(enter(empty(), home, null).entries.k1, { y: 0, open: [], route: "/", from: null });
});

test("a link back to the route the entry came from returns to where that route was left", () => {
  const memory = leave(visited(), routine, place(40));
  assert.deepEqual(returning(memory, routine, "/", false), place(1500, false, true));
});

test("a link to any other route lands at the top", () => {
  const memory = leave(visited(), routine, place(40));
  assert.equal(returning(memory, routine, "/routines", false), null);
  assert.equal(returning(memory, routine, "/books", false), null);
});

test("a tab link returns to the tab's last place whatever came before", () => {
  const memory = leave(visited(), routine, place(40));
  assert.deepEqual(returning(memory, routine, "/", true), place(1500, false, true));
  assert.equal(returning(memory, routine, "/books", true), null);
});

test("a tab link returns to the tab's last place even when the entry came from somewhere else", () => {
  let memory = leave(enter(empty(), home, null), home, place(1500));
  memory = enter(memory, { key: "k2", route: "/books" }, "/");
  memory = leave(memory, { key: "k2", route: "/books" }, place(80));
  memory = enter(memory, { key: "k3", route: "/routines" }, "/books");
  assert.deepEqual(returning(memory, { key: "k3", route: "/routines" }, "/", true), place(1500));
  assert.equal(returning(memory, { key: "k3", route: "/routines" }, "/", false), null);
});

test("the entry that was left last wins when a route is visited twice", () => {
  const again = { key: "k3", route: "/" };
  let memory = leave(visited(), routine, place(40));
  memory = enter(memory, again, "/routines/r1");
  memory = leave(memory, again, place(200));
  assert.equal(replay(memory, "k1", "/")?.y, 1500);
  assert.equal(memory.routes["/"].y, 200);
});

test("only the most recent entries and routes are kept", () => {
  let memory = empty();
  for (let index = 0; index < 100; index++) memory = leave(memory, { key: `k${index}`, route: `/r${index}` }, place(index));
  assert.equal(Object.keys(memory.entries).length, 80);
  assert.equal(Object.keys(memory.routes).length, 80);
  assert.equal(memory.entries.k99.y, 99);
  assert.equal(memory.entries.k19, undefined);
  assert.equal(memory.entries.k20.y, 20);
});

test("leaving an entry again moves it to the newest slot instead of duplicating it", () => {
  let memory = leave(enter(empty(), home, null), home, place(1));
  memory = leave(memory, routine, place(2));
  memory = leave(memory, home, place(3));
  assert.deepEqual(Object.keys(memory.entries), ["k2", "k1"]);
});

test("a stored memory survives a round trip", () => {
  const memory = leave(visited(), routine, place(40));
  assert.deepEqual(parse(JSON.stringify(memory)), memory);
});

test("a missing, broken or foreign stored memory reads as empty", () => {
  assert.deepEqual(parse(null), empty());
  assert.deepEqual(parse("{"), empty());
  assert.deepEqual(parse("[]"), empty());
  assert.deepEqual(parse('"x"'), empty());
  assert.deepEqual(parse("null"), empty());
  assert.deepEqual(parse('{"entries":1,"routes":2}'), empty());
});

test("stored places that are not places are dropped", () => {
  const bad = {
    entries: { a: { y: -1, open: [], route: "/", from: null }, b: { y: "5", open: [], route: "/", from: null }, c: { y: 5, open: [1], route: "/", from: null }, d: { y: 5, open: [], route: 1, from: null }, e: { y: 5, open: [], route: "/", from: 3 }, f: { y: 5, open: [true], route: "/", from: "/x" }, g: null },
    routes: { "/": { y: Number.POSITIVE_INFINITY, open: [] }, "/a": { y: 7, open: [] }, "/b": { y: 7 } },
  };
  const memory = parse(JSON.stringify(bad));
  assert.deepEqual(Object.keys(memory.entries), ["f"]);
  assert.deepEqual(Object.keys(memory.routes), ["/a"]);
});

test("a place at the very top is a valid stored place", () => {
  const top = { entries: { a: { y: 0, open: [], route: "/", from: null } }, routes: { "/": { y: 0, open: [] } } };
  assert.deepEqual(parse(JSON.stringify(top)), top);
});

test("a stored memory is cut to the newest 80 of each kind", () => {
  const stored = { entries: {} as Record<string, unknown>, routes: {} as Record<string, unknown> };
  for (let index = 0; index < 120; index++) {
    stored.entries[`k${index}`] = { y: 1, open: [], route: "/", from: null };
    stored.routes[`/r${index}`] = { y: 1, open: [] };
  }
  const memory = parse(JSON.stringify(stored));
  assert.equal(Object.keys(memory.entries).length, 80);
  assert.equal(Object.keys(memory.routes).length, 80);
  assert.ok("k119" in memory.entries && !("k39" in memory.entries));
});
