import { test } from "node:test";
import assert from "node:assert/strict";
import { STALE_MS, depth, empty, enter, hiddenRoute, leave, parse, replay, returning, scrub } from "../src/domain/place.ts";
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

const ID = "aaaaaaaa-0000-4000-8000-000000000001";
const SHARED = "bbbbbbbb-0000-4000-8000-000000000002";
const rows = [
  { id: ID, kind: "routine", who: "a", data: { private: true } },
  { id: SHARED, kind: "routine", who: "shared", data: null },
  { id: "cccccccc-0000-4000-8000-000000000003", kind: "step", parent_id: SHARED, data: {} },
];

test("a routine route is written only when its row is loaded, a routine and not private", () => {
  for (const tail of ["", "/start", "/", "/start/", "?x=1", "#top", "/start?x=1#top", "/anything/else"]) {
    assert.equal(hiddenRoute(`/routines/${SHARED}${tail}`, true, rows), false, tail);
    assert.equal(hiddenRoute(`/routines/${ID}${tail}`, true, rows), true, tail);
  }
});

test("a routine route is hidden when the row is unknown, the rows are not ready, the row is gone or the id is not a routine", () => {
  assert.equal(hiddenRoute(`/routines/${SHARED}`, false, rows), true);
  assert.equal(hiddenRoute(`/routines/${SHARED}`, true, []), true);
  assert.equal(hiddenRoute(`/routines/${SHARED}/start`, true, []), true);
  assert.equal(hiddenRoute("/routines/dddddddd-0000-4000-8000-000000000004", true, rows), true);
  assert.equal(hiddenRoute("/routines/cccccccc-0000-4000-8000-000000000003", true, rows), true);
  assert.equal(hiddenRoute(`/routines/${SHARED}`, true, rows.filter((row) => row.id !== SHARED)), true);
});

test("case, percent-encoding and extra slashes do not get past the rule", () => {
  const upper = ID.toUpperCase();
  const encoded = [...ID].map((char) => `%${char.charCodeAt(0).toString(16)}`).join("");
  for (const route of [`/routines/${upper}`, `/ROUTINES/${ID}`, `/Routines/${upper}/start`, `/routines/${encoded}`, `/%72outines/${ID}`, `/routines%2F${ID}`, `/routines/${ID}%3Fx=1`, `/routines/${ID}%23top`, `//routines//${ID}//`, `/%2572outines/${ID}`, `/routines/${encodeURIComponent(encoded)}`]) {
    assert.equal(hiddenRoute(route, true, rows), true, route);
  }
  assert.equal(hiddenRoute(`/routines/${SHARED.toUpperCase()}`, true, rows), false);
  assert.equal(hiddenRoute(`/routines/${SHARED.replace("-", "%2D")}`, true, rows), false);
});

test("a route that cannot be decoded to the end, or keeps decoding, is hidden", () => {
  assert.equal(hiddenRoute("/books/%E0%A4%A", true, rows), true);
  assert.equal(hiddenRoute("/routines/%", true, rows), true);
  assert.equal(hiddenRoute(`/routines/${ID}%25252525`, true, rows), true);
  assert.equal(hiddenRoute("/books/100%25", true, rows), true);
  assert.equal(hiddenRoute("/%2572outines/x%25zz", true, rows), true);
  assert.equal(hiddenRoute("/books/a%2520b", true, rows), false);
});

test("a row id that differs from the route only in case is judged together with the other row of that id", () => {
  const twins = [
    { id: "Ab", kind: "routine", data: null },
    { id: "aB", kind: "routine", data: { private: true } },
  ];
  assert.equal(hiddenRoute("/routines/ab", true, twins), true);
  assert.equal(hiddenRoute("/routines/ab", true, twins.slice(0, 1)), false);
});

test("a route that is not under routines is never hidden by the rule", () => {
  for (const route of ["/", "/routines", "/routines/", "/books/r1", `/books/${ID}`, "/tasks", "/routinesx/r1", "/x/routines/r1"]) {
    assert.equal(hiddenRoute(route, false, []), false, route);
    assert.equal(hiddenRoute(route, true, rows), false, route);
  }
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
