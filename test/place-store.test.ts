import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { STALE_MS, empty, enter, hiddenText, leave } from "../src/domain/place.ts";
import { placeStore } from "../src/store/places.ts";
import type { Memory } from "../src/domain/place.ts";
import type { Held } from "../src/store/timers.ts";

const NOW = 1_700_000_000_000;

const fake = (): Held & { all: () => string[]; raw: Map<string, string> } => {
  const raw = new Map<string, string>();
  return {
    raw,
    all: () => [...raw.keys()].sort(),
    get length() {
      return raw.size;
    },
    key: (at) => [...raw.keys()][at] ?? null,
    getItem: (key) => raw.get(key) ?? null,
    setItem: (key, value) => void raw.set(key, value),
    removeItem: (key) => void raw.delete(key),
  };
};

const shown = () => false;

const visit = (route: string, at = NOW) => leave(enter(empty(), { key: "k1", route }, null, at), { key: "k1", route }, { y: 300, open: [] }, at);

test("the memory is stored under the side that is known, and the other side reads nothing of it", () => {
  const storage = fake();
  const first = placeStore(storage, () => "a", () => NOW);
  first.save(visit("/routines/r6"), shown);
  assert.deepEqual(storage.all(), ["wp.place.a"]);
  assert.deepEqual(first.load(), visit("/routines/r6"));
  assert.deepEqual(placeStore(storage, () => "b", () => NOW).load(), empty());
});

test("confirming the other side deletes the first side's memory, and what is written after goes under the new side", () => {
  const storage = fake();
  const tab = placeStore(storage, () => "a", () => NOW);
  tab.save(visit("/routines/r6/start"), shown);
  tab.purge("b");
  assert.deepEqual(storage.all(), []);
  assert.equal(tab.side(), "b");
  tab.save(visit("/tasks"), shown);
  assert.deepEqual(storage.all(), ["wp.place.b"]);
  assert.doesNotMatch(storage.raw.get("wp.place.b")!, /r6/);
});

test("a probe that confirms a side deletes keys without a side, malformed sided keys and the other side's, and nothing else", () => {
  const storage = fake();
  const memory = JSON.stringify(visit("/routines/r6"));
  for (const key of ["wp.place", "wp.place.a", "wp.place.b", "wp.place.c", "wp.place.a.x", "wp.place."]) storage.setItem(key, memory);
  for (const key of ["wp.placeholder", "wp.timer.a.r1.x1", "wp-theme", "nestora.place"]) storage.setItem(key, "keep");
  placeStore(storage, () => null, () => NOW).purge("b");
  assert.deepEqual(storage.all(), ["nestora.place", "wp-theme", "wp.place.b", "wp.placeholder", "wp.timer.a.r1.x1"]);
  placeStore(storage, () => null, () => NOW).purge("a");
  assert.deepEqual(storage.all(), ["nestora.place", "wp-theme", "wp.placeholder", "wp.timer.a.r1.x1"]);
});

test("with no side known nothing is written and nothing is read", () => {
  const storage = fake();
  storage.setItem("wp.place.a", JSON.stringify(visit("/")));
  storage.setItem("wp.place", JSON.stringify(visit("/")));
  const unknown = placeStore(storage, () => null, () => NOW);
  assert.deepEqual(unknown.load(), empty());
  unknown.save(visit("/routines/r6"), shown);
  assert.doesNotMatch(JSON.stringify([...storage.raw]), /r6/);
  unknown.purge("a");
  unknown.save(visit("/routines/r6"), shown);
  assert.match(storage.raw.get("wp.place.a")!, /r6/);
});

test("entries past the stale limit are dropped when read and when a side is confirmed, and an emptied key is removed", () => {
  const storage = fake();
  let now = NOW;
  const tab = placeStore(storage, () => "a", () => now);
  const old = visit("/old", NOW);
  const fresh = visit("/fresh", NOW + STALE_MS);
  tab.save({ entries: { ...old.entries, k2: fresh.entries.k1 }, routes: { ...old.routes, ...fresh.routes } }, shown);
  now = NOW + STALE_MS + 1;
  assert.deepEqual(Object.values(tab.load().entries).map((entry) => entry.route), ["/fresh"]);
  tab.purge("a");
  assert.deepEqual(Object.keys(JSON.parse(storage.raw.get("wp.place.a")!).routes), ["/fresh"]);
  now = NOW + 2 * STALE_MS + 2;
  tab.purge("a");
  assert.deepEqual(storage.all(), []);
});

test("a purge keeps a side's memory that holds only entries or only routes", () => {
  const storage = fake();
  const memory = visit("/books");
  storage.setItem("wp.place.a", JSON.stringify({ ...memory, routes: {} }));
  placeStore(storage, () => "a", () => NOW).purge("a");
  assert.deepEqual(storage.all(), ["wp.place.a"]);
  storage.setItem("wp.place.a", JSON.stringify({ ...memory, entries: {} }));
  placeStore(storage, () => "a", () => NOW).purge("a");
  assert.deepEqual(storage.all(), ["wp.place.a"]);
  storage.setItem("wp.place.a", JSON.stringify(empty()));
  placeStore(storage, () => "a", () => NOW).purge("a");
  assert.deepEqual(storage.all(), []);
});

test("a broken value reads as empty and is deleted by a purge", () => {
  const storage = fake();
  storage.setItem("wp.place.a", "{");
  const tab = placeStore(storage, () => "a", () => NOW);
  assert.deepEqual(tab.load(), empty());
  tab.purge("a");
  assert.deepEqual(storage.all(), []);
});

test("a storage that is missing or throws never makes a call throw", () => {
  const blocked = () => {
    throw new Error("blocked");
  };
  const broken: Held = { length: 1, key: blocked, getItem: blocked, setItem: blocked, removeItem: blocked };
  for (const tab of [placeStore(null, () => "a"), placeStore(broken, () => "a")]) {
    assert.deepEqual(tab.load(), empty());
    assert.equal(tab.save(visit("/"), shown), undefined);
    assert.equal(tab.purge("b"), undefined);
    assert.equal(tab.side(), "b");
  }
});

test("the place memory is named by side in one file, purged by the session's one purge hook, and described in the README", () => {
  const files = (dir: string): string[] => readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]));
  const sources = ["src", "shared", "worker"].flatMap(files).filter((file) => /\.tsx?$/.test(file));
  const reading = (pattern: RegExp) => sources.filter((file) => pattern.test(readFileSync(new URL(`../${file}`, import.meta.url), "utf8")));
  assert.deepEqual(reading(/wp\.place/), ["src/store/places.ts"]);
  assert.deepEqual(reading(/nestora\.place/), []);
  const browser = readFileSync(new URL("../src/store/browser.ts", import.meta.url), "utf8");
  assert.match(browser, /purge: \(side\) => \{\s*timers\.purge\(side\);\s*places\.purge\(side\);\s*\}/);
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  assert.match(readme, /`wp\.place\.<side>`/);
  assert.match(readme, /`history\.state`/);
  assert.match(readme, /places\.purge/);
  assert.doesNotMatch(readme, /the one routine id in a store/);
});

test("saving drops what holds a hidden id before it reaches the storage, wherever it sits", () => {
  const id = "aaaaaaaa-0000-4000-8000-000000000001";
  const storage = fake();
  const tab = placeStore(storage, () => "a", () => NOW);
  const entry = { y: 1, open: [], at: NOW, route: "/books", from: null };
  const memory = {
    entries: {
      ok: entry,
      from: { ...entry, from: `/routines/${id}` },
      route: { ...entry, route: `/routines/${id.toUpperCase()}` },
      nested: { ...entry, extra: { deep: [{ note: id }] } },
      unknown: { ...entry, [id]: 1 },
      [`key-${id}`]: entry,
    },
    routes: { "/books": { y: 1, open: [], at: NOW, from: `/routines/${id}` }, [`/routines/${id}`]: { y: 1, open: [], at: NOW }, "/tasks": { y: 1, open: [], at: NOW, deep: [id] } },
    leak: id,
  } as unknown as Memory;
  tab.save(memory, (text) => hiddenText(text, true, [{ id, kind: "routine", who: "a", data: { private: true } }]));
  const raw = storage.raw.get("wp.place.a")!;
  assert.equal(raw.toLowerCase().includes(id), false);
  assert.deepEqual(Object.keys(tab.load().entries), ["ok", "from", "nested", "unknown"]);
  assert.deepEqual(Object.keys(tab.load().routes), ["/books", "/tasks"]);
});
