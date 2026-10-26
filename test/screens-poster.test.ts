import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createApi } from "../src/store/api.ts";
import { memoryPersistence } from "../src/store/memory.ts";
import { createStore, paused } from "../src/store/store.ts";
import { overlay } from "../src/ui/overlay.ts";
import { removePoster } from "../src/ui/screen-save.ts";
import { client, idOf } from "./store-client.ts";
import { createServer } from "./store-server.ts";
import { createWorkerServer } from "./store-worker.ts";

const POSTER = "https://image.tmdb.org/t/p/w342/invPoster0001.jpg";

const KEPT = { original_title: "Last Harbour", year: 2017, rating_a: "4" };

const KEYS = { cover: POSTER, tmdb: 910001, tmdb_at: "2027-03-01" };

const seeded = async (data: Record<string, unknown> = { ...KEPT, ...KEYS }) => {
  const server = createServer();
  const a = client(server, "a").store;
  const b = client(server, "b").store;
  await a.open();
  await b.open();
  const id = idOf(await a.create("items", { kind: "movie", title: "Pelabuhan Terakhir", status: "watched", data } as never));
  await a.sync();
  await b.sync();
  const row = () => a.getSnapshot().rows.items.find((entry) => entry.id === id)!;
  return { server, a, b, id, row };
};

const toast = () => {
  const shown = overlay.getSnapshot().toast;
  overlay.dismissToast();
  return shown;
};

test("Remove poster clears exactly cover, tmdb and tmdb_at, keeps every other field, and tells the partner", async () => {
  const { server, a, b, id, row } = await seeded();
  const before = structuredClone(row());
  idOf(await removePoster(a, row()));
  await a.sync();
  await b.sync();
  const after = server.row("items", id)!;
  assert.deepEqual(after.data, KEPT);
  for (const column of ["title", "status", "who", "done_on", "note", "kind", "sort"]) assert.equal(after[column], (before as Record<string, unknown>)[column], column);
  assert.deepEqual(b.getSnapshot().rows.items.find((entry) => entry.id === id)!.data, KEPT);
  assert.equal(toast()!.message, "Poster removed: Pelabuhan Terakhir");
});

test("the toast's Undo puts back what the row held, and only that", async () => {
  const { server, a, b, id, row } = await seeded();
  idOf(await removePoster(a, row()));
  await a.sync();
  assert.deepEqual(server.row("items", id)!.data, KEPT);
  const shown = toast()!;
  assert.equal(shown.action!.label, "Undo");
  shown.action!.run();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await a.sync();
  await b.sync();
  assert.deepEqual(server.row("items", id)!.data, { ...KEPT, ...KEYS });
  assert.deepEqual(b.getSnapshot().rows.items.find((entry) => entry.id === id)!.data, { ...KEPT, ...KEYS });
  const partial = await seeded({ ...KEPT, tmdb: 5 });
  idOf(await removePoster(partial.a, partial.row()));
  await partial.a.sync();
  toast()!.action!.run();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await partial.a.sync();
  assert.deepEqual(partial.server.row("items", partial.id)!.data, { ...KEPT, tmdb: 5 });
});

test("a row with another cover host cannot be edited until Remove poster clears it", async () => {
  const server = createWorkerServer();
  server.sqlite.exec("UPDATE sync_state SET rev = 1");
  server.sqlite.exec(
    `INSERT INTO items (id, kind, title, status, data, rev, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000001', 'movie', 'Pelabuhan Terakhir', 'want', '{"year":2017,"cover":"https://example.test/other.jpg"}', 1, '2026-10-26T00:00:00Z', '2026-10-26T00:00:00Z')`,
  );
  const a = createStore({ persistence: memoryPersistence(), api: createApi(server.as("a"), "a") });
  await a.open();
  const id = "00000000-0000-4000-8000-000000000001";
  const row = () => a.getSnapshot().rows.items.find((entry) => entry.id === id)!;
  assert.equal((await a.update("items", id, { title: "Renamed" })).ok, false);
  idOf(await removePoster(a, row()));
  toast();
  idOf(await a.update("items", id, { title: "Renamed" }));
  await a.sync();
  const stored = server.sqlite.prepare("SELECT title, data FROM items WHERE id = ?").get(id) as { title: string; data: string };
  assert.deepEqual([stored.title, JSON.parse(stored.data)], ["Renamed", { year: 2017 }]);
});

test("a refused write shows no toast and clears nothing", async () => {
  const { a, row } = await seeded();
  toast();
  const result = await removePoster({ update: async () => paused }, row());
  assert.equal(result.ok, false);
  assert.equal(toast(), null);
  assert.equal((row().data as { tmdb: number }).tmdb, 910001);
  void a;
});

test("the pass reads each row from the store's own snapshot, and leaving the screen aborts what is in flight", () => {
  const hook = readFileSync(new URL("../src/hooks/use-details.ts", import.meta.url), "utf8");
  assert.match(hook, /read: \(id\) => readItems\(\)\.find\(\(book\) => book\.id === id\)/);
  assert.match(hook, /useEffect\(\(\) => \(\) => control\.current\?\.abort\(\), \[\]\);/);
});
