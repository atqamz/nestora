import { test } from "node:test";
import assert from "node:assert/strict";
import { STALE_MS, depth, empty, enter, leave, parse, privateRoute, replay, returning, scrub } from "../src/domain/place.ts";
import type { Memory } from "../src/domain/place.ts";

const home = { key: "k1", route: "/" };
const routine = { key: "k2", route: "/routines/r1" };
const NOW = 1_700_000_000_000;
const place = (y: number, ...open: boolean[]) => ({ y, open });
const stamped = (y: number, ...open: boolean[]) => ({ ...place(y, ...open), at: NOW });

const visited = (): Memory => {
  let memory = enter(empty(), home, null, NOW);
  memory = leave(memory, home, place(1500, false, true), NOW);
  return enter(memory, routine, "/", NOW);
};

test("leaving an entry remembers where it was, by entry and by route", () => {
  const memory = leave(enter(empty(), home, null, NOW), home, place(1500, true), NOW);
  assert.deepEqual(memory.entries.k1, { y: 1500, open: [true], at: NOW, route: "/", from: null });
  assert.deepEqual(memory.routes["/"], stamped(1500, true));
});

test("a known history entry on the same route replays its place", () => {
  assert.deepEqual(replay(visited(), "k1", "/"), { y: 1500, open: [false, true], at: NOW, route: "/", from: null });
});

test("an entry with no key, an unknown key or another route replays nothing", () => {
  const memory = visited();
  assert.equal(replay(memory, null, "/"), null);
  assert.equal(replay(memory, "gone", "/"), null);
  assert.equal(replay(memory, "k1", "/routines"), null);
});

test("a fresh entry starts at the top", () => {
  assert.deepEqual(enter(empty(), home, null, NOW).entries.k1, { y: 0, open: [], at: NOW, route: "/", from: null });
});

test("a link back to the route the entry came from returns to where that route was left", () => {
  const memory = leave(visited(), routine, place(40), NOW);
  assert.deepEqual(returning(memory, routine, "/", false), stamped(1500, false, true));
});

test("a link to any other route lands at the top", () => {
  const memory = leave(visited(), routine, place(40), NOW);
  assert.equal(returning(memory, routine, "/routines", false), null);
  assert.equal(returning(memory, routine, "/books", false), null);
});

test("a tab link returns to the tab's last place whatever came before", () => {
  const memory = leave(visited(), routine, place(40), NOW);
  assert.deepEqual(returning(memory, routine, "/", true), stamped(1500, false, true));
  assert.equal(returning(memory, routine, "/books", true), null);
});

test("a tab link returns to the tab's last place even when the entry came from somewhere else", () => {
  let memory = leave(enter(empty(), home, null, NOW), home, place(1500), NOW);
  memory = enter(memory, { key: "k2", route: "/books" }, "/", NOW);
  memory = leave(memory, { key: "k2", route: "/books" }, place(80), NOW);
  memory = enter(memory, { key: "k3", route: "/routines" }, "/books", NOW);
  assert.deepEqual(returning(memory, { key: "k3", route: "/routines" }, "/", true), stamped(1500));
  assert.equal(returning(memory, { key: "k3", route: "/routines" }, "/", false), null);
});

test("the entry that was left last wins when a route is visited twice", () => {
  const again = { key: "k3", route: "/" };
  let memory = leave(visited(), routine, place(40), NOW);
  memory = enter(memory, again, "/routines/r1", NOW);
  memory = leave(memory, again, place(200), NOW);
  assert.equal(replay(memory, "k1", "/")?.y, 1500);
  assert.equal(memory.routes["/"].y, 200);
});

test("only the most recent entries and routes are kept", () => {
  let memory = empty();
  for (let index = 0; index < 100; index++) memory = leave(memory, { key: `k${index}`, route: `/r${index}` }, place(index), NOW);
  assert.equal(Object.keys(memory.entries).length, 80);
  assert.equal(Object.keys(memory.routes).length, 80);
  assert.equal(memory.entries.k99.y, 99);
  assert.equal(memory.entries.k19, undefined);
  assert.equal(memory.entries.k20.y, 20);
});

test("leaving an entry again moves it to the newest slot instead of duplicating it", () => {
  let memory = leave(enter(empty(), home, null, NOW), home, place(1), NOW);
  memory = leave(memory, routine, place(2), NOW);
  memory = leave(memory, home, place(3), NOW);
  assert.deepEqual(Object.keys(memory.entries), ["k2", "k1"]);
});

test("a stored memory survives a round trip", () => {
  const memory = leave(visited(), routine, place(40), NOW);
  assert.deepEqual(parse(JSON.stringify(memory), NOW), memory);
});

test("a missing, broken or foreign stored memory reads as empty", () => {
  assert.deepEqual(parse(null, NOW), empty());
  assert.deepEqual(parse("{", NOW), empty());
  assert.deepEqual(parse("[]", NOW), empty());
  assert.deepEqual(parse('"x"', NOW), empty());
  assert.deepEqual(parse("null", NOW), empty());
  assert.deepEqual(parse('{"entries":1,"routes":2}', NOW), empty());
});

test("stored places that are not places are dropped", () => {
  const bad = {
    entries: { a: { y: -1, open: [], at: NOW, route: "/", from: null }, b: { y: "5", open: [], at: NOW, route: "/", from: null }, c: { y: 5, open: [1], at: NOW, route: "/", from: null }, d: { y: 5, open: [], at: NOW, route: 1, from: null }, e: { y: 5, open: [], at: NOW, route: "/", from: 3 }, f: { y: 5, open: [true], at: NOW, route: "/", from: "/x" }, g: null, h: { y: 5, open: [], route: "/", from: null }, i: { y: 5, open: [], at: "x", route: "/", from: null } },
    routes: { "/": { y: Number.POSITIVE_INFINITY, open: [], at: NOW }, "/a": { y: 7, open: [], at: NOW }, "/b": { y: 7, at: NOW }, "/c": { y: 7, open: [] } },
  };
  const memory = parse(JSON.stringify(bad), NOW);
  assert.deepEqual(Object.keys(memory.entries), ["f"]);
  assert.deepEqual(Object.keys(memory.routes), ["/a"]);
});

test("a place at the very top is a valid stored place", () => {
  const top = { entries: { a: { y: 0, open: [], at: NOW, route: "/", from: null } }, routes: { "/": { y: 0, open: [], at: NOW } } };
  assert.deepEqual(parse(JSON.stringify(top), NOW), top);
});

test("a stored memory is cut to the newest 80 of each kind", () => {
  const stored = { entries: {} as Record<string, unknown>, routes: {} as Record<string, unknown> };
  for (let index = 0; index < 120; index++) {
    stored.entries[`k${index}`] = { y: 1, open: [], at: NOW, route: "/", from: null };
    stored.routes[`/r${index}`] = { y: 1, open: [], at: NOW };
  }
  const memory = parse(JSON.stringify(stored), NOW);
  assert.equal(Object.keys(memory.entries).length, 80);
  assert.equal(Object.keys(memory.routes).length, 80);
  assert.ok("k119" in memory.entries && !("k39" in memory.entries));
});

test("a stored place older than the stale limit is dropped on parse, and one at the limit is kept", () => {
  const stored = { entries: { old: { y: 5, open: [], at: NOW - STALE_MS - 1, route: "/", from: null }, edge: { y: 5, open: [], at: NOW - STALE_MS, route: "/", from: null } }, routes: { "/old": { y: 5, open: [], at: NOW - STALE_MS - 1 }, "/edge": { y: 5, open: [], at: NOW - STALE_MS } } };
  const memory = parse(JSON.stringify(stored), NOW);
  assert.deepEqual(Object.keys(memory.entries), ["edge"]);
  assert.deepEqual(Object.keys(memory.routes), ["/edge"]);
});

test("a routine route is private when the row is flagged, and unknown while the rows have not loaded", () => {
  const items = [
    { id: "r1", kind: "routine", data: { private: true } },
    { id: "r2", kind: "routine", data: null },
  ];
  assert.equal(privateRoute("/routines/r1", true, items), true);
  assert.equal(privateRoute("/routines/r1/start", true, items), true);
  assert.equal(privateRoute("/routines/r2", true, items), false);
  assert.equal(privateRoute("/routines/r9", true, items), false);
  assert.equal(privateRoute("/routines/r2", false, []), true);
  assert.equal(privateRoute("/routines", false, []), false);
  assert.equal(privateRoute("/", false, []), false);
  assert.equal(privateRoute("/books/r1", true, items), false);
});

test("scrubbing drops the entries and routes of hidden routes and forgets a hidden route an entry came from", () => {
  const priv = { key: "k3", route: "/routines/r1/start" };
  let memory = leave(visited(), routine, place(40), NOW);
  memory = enter(memory, priv, "/routines/r1", NOW);
  memory = leave(memory, priv, place(9), NOW);
  memory = enter(memory, { key: "k4", route: "/routines" }, "/routines/r1", NOW);
  const clean = scrub(memory, (route) => route.startsWith("/routines/"));
  assert.deepEqual(Object.keys(clean.entries), ["k1", "k4"]);
  assert.equal(clean.entries.k4.from, null);
  assert.deepEqual(Object.keys(clean.routes), ["/"]);
  assert.deepEqual(scrub(memory, () => false), memory);
});

test("depth counts the segments of a route", () => {
  assert.deepEqual(["/", "/routines", "/routines/r1", "/routines/r1/start", "//a//"].map(depth), [0, 1, 2, 3, 1]);
});
