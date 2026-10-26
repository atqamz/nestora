import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Side } from "../shared/api.ts";
import { createApi } from "../src/store/api.ts";
import type { Fetch } from "../src/store/api.ts";
import { memoryPersistence } from "../src/store/memory.ts";
import { createStore } from "../src/store/store.ts";
import { overlay } from "../src/ui/overlay.ts";
import { removeScreen } from "../src/ui/screen-save.ts";
import { revivePatch } from "../src/domain/tmdb.ts";
import { client, idOf } from "./store-client.ts";
import { createWorkerServer } from "./store-worker.ts";
import type { WorkerServer } from "./store-worker.ts";
import { createServer } from "./store-server.ts";

const POSTER = "https://image.tmdb.org/t/p/w342/invPoster0001.jpg";

const KEYS = { cover: POSTER, tmdb: 910001, tmdb_at: "2027-03-01" };

const KEPT = { original_title: "Last Harbour", year: 2017, rating_a: "4" };

const rig = () => {
  const server = createWorkerServer();
  let down = false;
  const dial = (side: Side): Fetch => (url, init) => (down ? Promise.reject(new TypeError("fetch failed")) : server.as(side)(url, init));
  const open = (side: Side) => {
    const persistence = memoryPersistence();
    return { persistence, store: createStore({ persistence, api: createApi(dial(side), side) }) };
  };
  return { server, open, offline: (value: boolean) => void (down = value) };
};

const dataOf = (server: WorkerServer, id: string) => JSON.parse((server.sqlite.prepare("SELECT data FROM items WHERE id = ?").get(id) as { data: string }).data) as Record<string, unknown>;

const stored = (server: WorkerServer, id: string) => server.sqlite.prepare("SELECT deleted_at, rev FROM items WHERE id = ?").get(id) as { deleted_at: string | null; rev: number };

const exported = async (server: WorkerServer) => JSON.stringify(await (await server.as("a")("/api/export?format=json", { method: "GET" })).json());

const settle = async (...stores: { sync(): Promise<void> }[]) => {
  for (let round = 0; round < 2; round++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const store of stores) await store.sync();
  }
};

const seeded = async () => {
  const { server, open, offline } = rig();
  const a = open("a");
  const b = open("b");
  await a.store.open();
  await b.store.open();
  const make = async (kind: string, title: string, data: Record<string, unknown> = { ...KEPT, ...KEYS }) =>
    idOf(await a.store.create("items", { kind, title, status: kind === "book" ? "shelf" : "watched", data } as never));
  const ids = { movie: await make("movie", "Pelabuhan Terakhir"), series: await make("series", "Menara Sunyi"), book: await make("book", "Buku Lama", { cover: POSTER }), other: await make("movie", "Tetap Hidup") };
  await settle(a.store, b.store);
  return { server, a, b, ids, offline };
};

test("deleting a movie or a series clears cover, tmdb and tmdb_at in D1 in the same write and keeps the rest of its data", async () => {
  const { server, a, ids } = await seeded();
  idOf(await a.store.remove("items", ids.movie));
  idOf(await a.store.remove("items", ids.series));
  await settle(a.store);
  for (const id of [ids.movie, ids.series]) {
    assert.deepEqual(dataOf(server, id), KEPT, id);
    assert.notEqual(stored(server, id).deleted_at, null, id);
  }
  assert.deepEqual(dataOf(server, ids.other), { ...KEPT, ...KEYS });
});

test("deleting a book keeps its cover: only movies and series lose it", async () => {
  const { server, a, ids } = await seeded();
  idOf(await a.store.remove("items", ids.book));
  await settle(a.store);
  assert.notEqual(stored(server, ids.book).deleted_at, null);
  assert.deepEqual(dataOf(server, ids.book), { cover: POSTER });
});

test("a deleted row is in the JSON export without the three keys, and the live row beside it keeps them", async () => {
  const { server, a, ids } = await seeded();
  assert.match(await exported(server), /invPoster0001/);
  idOf(await a.store.remove("items", ids.movie));
  idOf(await a.store.remove("items", ids.series));
  idOf(await a.store.remove("items", ids.book));
  await settle(a.store);
  const body = JSON.parse(await exported(server)) as { tables: { items: { id: string; deleted_at: string | null; data: Record<string, unknown> }[] } };
  const rows = new Map(body.tables.items.map((row) => [row.id, row]));
  for (const id of [ids.movie, ids.series]) {
    assert.notEqual(rows.get(id)!.deleted_at, null);
    assert.deepEqual(Object.keys(rows.get(id)!.data).filter((key) => key in KEYS), []);
  }
  assert.equal(rows.get(ids.other)!.data.tmdb, 910001);
  assert.equal(rows.get(ids.book)!.data.cover, POSTER);
});

test("the partner pulls the tombstone without the keys, in the store and on disk, and never sees the row", async () => {
  const { a, b, ids } = await seeded();
  idOf(await a.store.remove("items", ids.movie));
  await settle(a.store, b.store);
  assert.equal(b.store.getSnapshot().rows.items.some((row) => row.id === ids.movie), false);
  const kept = (await b.persistence.load()).rows.items.find((row) => row.id === ids.movie)!;
  assert.notEqual(kept.deleted_at, null);
  assert.deepEqual(kept.data, KEPT);
});

test("the delete toast's Undo within the window brings the row back with its poster, id and day, here and on the partner's phone", async () => {
  const { server, a, b, ids } = await seeded();
  const row = a.store.getSnapshot().rows.items.find((entry) => entry.id === ids.movie)!;
  idOf(await removeScreen({ actions: a.store, go: () => undefined }, row, "movie"));
  await settle(a.store, b.store);
  assert.deepEqual(dataOf(server, ids.movie), KEPT);
  overlay.getSnapshot().toast!.action!.run();
  overlay.dismissToast();
  await settle(a.store, b.store);
  assert.equal(stored(server, ids.movie).deleted_at, null);
  assert.deepEqual(dataOf(server, ids.movie), { ...KEPT, ...KEYS });
  for (const side of [a, b]) {
    const back = side.store.getSnapshot().rows.items.find((entry) => entry.id === ids.movie)!;
    assert.equal(back.title, "Pelabuhan Terakhir");
    assert.deepEqual(back.data, { ...KEPT, ...KEYS });
  }
  assert.deepEqual([...a.store.getSnapshot().rejected, ...b.store.getSnapshot().rejected], []);
});

test("an Undo queued behind a delete that has not reached the server yet still keeps the poster", async () => {
  const { server, a, b, ids, offline } = await seeded();
  const row = a.store.getSnapshot().rows.items.find((entry) => entry.id === ids.series)!;
  offline(true);
  idOf(await removeScreen({ actions: a.store, go: () => undefined }, row, "series"));
  overlay.getSnapshot().toast!.action!.run();
  overlay.dismissToast();
  await new Promise((resolve) => setTimeout(resolve, 0));
  offline(false);
  await settle(a.store, b.store);
  assert.equal(stored(server, ids.series).deleted_at, null);
  assert.deepEqual(dataOf(server, ids.series), { ...KEPT, ...KEYS });
  assert.deepEqual(b.store.getSnapshot().rows.items.find((entry) => entry.id === ids.series)!.data, { ...KEPT, ...KEYS });
});

test("a delete the partner has already pulled is undone with the keys too, and the partner holds none of them in between", async () => {
  const { a, b, ids } = await seeded();
  const row = a.store.getSnapshot().rows.items.find((entry) => entry.id === ids.movie)!;
  idOf(await a.store.remove("items", ids.movie));
  await settle(a.store, b.store);
  assert.deepEqual((await b.persistence.load()).rows.items.find((entry) => entry.id === ids.movie)!.data, KEPT);
  idOf(await a.store.update("items", ids.movie, revivePatch(row)));
  await settle(a.store, b.store);
  assert.deepEqual(b.store.getSnapshot().rows.items.find((entry) => entry.id === ids.movie)!.data, { ...KEPT, ...KEYS });
});

test("the store's own restore, as the form's Undo uses it for other rows, revives a deleted movie as before, with its title and status", async () => {
  const { server, a, b, ids } = await seeded();
  idOf(await a.store.remove("items", ids.movie));
  await settle(a.store, b.store);
  idOf(await a.store.restore(ids.movie));
  await settle(a.store, b.store);
  assert.equal(stored(server, ids.movie).deleted_at, null);
  const back = b.store.getSnapshot().rows.items.find((entry) => entry.id === ids.movie)!;
  assert.deepEqual([back.title, back.status, back.data], ["Pelabuhan Terakhir", "watched", KEPT]);
});

test("a revive may carry only the three keys, and only on a movie or a series: anything else stays a no-op on a deleted row", async () => {
  const { server, a, ids } = await seeded();
  idOf(await a.store.remove("items", ids.movie));
  idOf(await a.store.remove("items", ids.book));
  await settle(a.store);
  const post = async (row_id: string, patch: Record<string, unknown>) =>
    server.as("a")("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mutations: [{ id: crypto.randomUUID(), table: "items", op: "update", row_id, patch }] }) });
  await post(ids.movie, { deleted_at: null, data: { year: 1999 } });
  await post(ids.movie, { deleted_at: null, title: "Renamed" });
  await post(ids.movie, { data: KEYS });
  await post(ids.book, { deleted_at: null, data: { cover: POSTER } });
  await post(ids.movie, { deleted_at: null, data: { ...KEYS, year: 1999 } });
  assert.equal((await post(ids.movie, { deleted_at: null, data: null })).status, 200);
  assert.notEqual(stored(server, ids.movie).deleted_at, null);
  assert.deepEqual(dataOf(server, ids.movie), KEPT);
  assert.notEqual(stored(server, ids.book).deleted_at, null);
  assert.equal((await post(ids.movie, { deleted_at: null, data: { cover: "https://example.test/x.jpg" } })).status, 400);
  assert.equal((await post(ids.movie, { deleted_at: null, data: KEYS })).status, 200);
  assert.deepEqual(dataOf(server, ids.movie), { ...KEPT, ...KEYS });
});

test("a delete a second time, or of a row that holds no keys, bumps nothing", async () => {
  const { server, a, ids } = await seeded();
  idOf(await a.store.remove("items", ids.movie));
  await settle(a.store);
  const before = stored(server, ids.movie).rev;
  await server.as("a")("/api/sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mutations: [{ id: crypto.randomUUID(), table: "items", op: "delete", row_id: ids.movie, patch: {} }] }) });
  assert.equal(stored(server, ids.movie).rev, before);
});

test("the fake server the other store tests use clears the keys on a delete the way the Worker does", async () => {
  const fake = createServer();
  const a = client(fake, "a").store;
  await a.open();
  const id = idOf(await a.create("items", { kind: "movie", title: "Pelabuhan Terakhir", status: "want", data: { year: 2017, ...KEYS } } as never));
  idOf(await a.remove("items", id));
  await a.sync();
  assert.deepEqual(fake.row("items", id)!.data, { year: 2017 });
});

const migrations = (names: string[]) => names.map((name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));

const BEFORE = ["0001_init.sql", "0002_feed.sql"];

const PURGE = "0003_purge_deleted_posters.sql";

const old = () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const sql of migrations(BEFORE)) sqlite.exec(sql);
  sqlite.exec("UPDATE sync_state SET rev = 40");
  const put = (id: string, kind: string, deleted: boolean, data: unknown) =>
    sqlite
      .prepare("INSERT INTO items (id, kind, title, status, data, rev, created_at, updated_at, deleted_at) VALUES (?, ?, ?, 'want', ?, 7, '2026-10-26T00:00:00Z', '2026-10-26T00:00:00Z', ?)")
      .run(id, kind, id, data === null ? null : JSON.stringify(data), deleted ? "2026-10-27T00:00:00Z" : null);
  return { sqlite, put };
};

const read = (sqlite: DatabaseSync, id: string) => sqlite.prepare("SELECT data, rev, deleted_at FROM items WHERE id = ?").get(id) as { data: string | null; rev: number; deleted_at: string | null };

const revOf = (sqlite: DatabaseSync) => (sqlite.prepare("SELECT rev FROM sync_state").get() as { rev: number }).rev;

test("the numbered migration strips the three keys from tombstones that exist, bumps the revision once and touches nothing else", () => {
  const { sqlite, put } = old();
  put("gone-movie", "movie", true, { ...KEPT, ...KEYS });
  put("gone-series", "series", true, { tmdb: 5 });
  put("gone-stamp", "movie", true, { tmdb_at: "2027-01-01", year: 2001 });
  put("gone-bare", "movie", true, { year: 2017 });
  put("gone-null", "movie", true, null);
  put("live-movie", "movie", false, { ...KEPT, ...KEYS });
  put("gone-book", "book", true, { cover: POSTER });
  put("gone-task", "task", true, { cover: POSTER });
  sqlite.exec(migrations([PURGE])[0]);
  assert.equal(revOf(sqlite), 41);
  assert.deepEqual(JSON.parse(read(sqlite, "gone-movie").data!), KEPT);
  assert.deepEqual(JSON.parse(read(sqlite, "gone-series").data!), {});
  assert.deepEqual(JSON.parse(read(sqlite, "gone-stamp").data!), { year: 2001 });
  for (const id of ["gone-movie", "gone-series", "gone-stamp"]) assert.deepEqual([read(sqlite, id).rev, read(sqlite, id).deleted_at], [41, "2026-10-27T00:00:00Z"], id);
  for (const id of ["gone-bare", "gone-null", "live-movie", "gone-book", "gone-task"]) assert.equal(read(sqlite, id).rev, 7, id);
  assert.deepEqual(JSON.parse(read(sqlite, "gone-bare").data!), { year: 2017 });
  assert.equal(read(sqlite, "gone-null").data, null);
  assert.deepEqual(JSON.parse(read(sqlite, "live-movie").data!), { ...KEPT, ...KEYS });
  assert.deepEqual(JSON.parse(read(sqlite, "gone-book").data!), { cover: POSTER });
  assert.deepEqual(JSON.parse(read(sqlite, "gone-task").data!), { cover: POSTER });
});

test("the migration changes nothing, not even the revision, when no tombstone holds a key, and a second run is the same", () => {
  const { sqlite, put } = old();
  put("gone-bare", "movie", true, { year: 2017 });
  put("live-movie", "movie", false, { ...KEPT, ...KEYS });
  const sql = migrations([PURGE])[0];
  sqlite.exec(sql);
  assert.equal(revOf(sqlite), 40);
  assert.equal(read(sqlite, "gone-bare").rev, 7);
  put("gone-late", "series", true, KEYS);
  sqlite.exec(sql);
  sqlite.exec(sql);
  assert.equal(revOf(sqlite), 41);
});

test("a phone that last synced before the migration pulls the cleaned tombstone, and so does the export", async () => {
  const { server, a, b, ids } = await seeded();
  server.sqlite.exec("UPDATE sync_state SET rev = rev + 1");
  server.sqlite.prepare("UPDATE items SET deleted_at = '2026-10-27T00:00:00Z', rev = (SELECT rev FROM sync_state) WHERE id = ?").run(ids.movie);
  await settle(a.store, b.store);
  const held = async () => (await b.persistence.load()).rows.items.find((row) => row.id === ids.movie)!.data;
  assert.deepEqual(await held(), { ...KEPT, ...KEYS });
  assert.equal((await exported(server)).match(/invPoster0001/g)?.length, 4);
  server.sqlite.exec(migrations([PURGE])[0]);
  await settle(a.store, b.store);
  assert.deepEqual(await held(), KEPT);
  assert.deepEqual(dataOf(server, ids.movie), KEPT);
  assert.equal((await exported(server)).match(/invPoster0001/g)?.length, 3);
});

const interleaved = (server: WorkerServer, once: () => Promise<void>, marker = "deleted_at = ?") => {
  const real = server.db.batch.bind(server.db);
  let armed = true;
  server.db.batch = async (statements) => {
    if (armed && (statements as unknown as { sql: string }[]).some((item) => item.sql.includes(marker))) {
      armed = false;
      await once();
    }
    return real(statements);
  };
};

test("a poster write that lands between the Worker's read and its batch does not survive on the tombstone", async () => {
  const { server, open } = rig();
  const a = open("a");
  const b = open("b");
  await a.store.open();
  await b.store.open();
  const id = idOf(await a.store.create("items", { kind: "movie", title: "Pelabuhan Terakhir", status: "watched", data: { year: 1999 } } as never));
  await settle(a.store, b.store);
  idOf(await a.store.remove("items", id));
  interleaved(server, async () => {
    idOf(await b.store.update("items", id, { data: KEYS } as never));
    await b.store.sync();
  });
  await a.store.sync();
  assert.notEqual(stored(server, id).deleted_at, null);
  assert.deepEqual(dataOf(server, id), { year: 1999 });
  await settle(a.store, b.store);
  assert.deepEqual(dataOf(server, id), { year: 1999 });
});

test("a delete made by the old Worker between the migration and the deploy is purged by the step after the deploy, which bumps the revision once and then never", () => {
  const { sqlite, put } = old();
  sqlite.exec(migrations([PURGE])[0]);
  put("late-movie", "movie", true, { ...KEPT, ...KEYS });
  put("late-series", "series", true, KEYS);
  put("late-book", "book", true, { cover: POSTER });
  put("live-movie", "movie", false, { ...KEPT, ...KEYS });
  const before = revOf(sqlite);
  const sql = migrations([PURGE])[0];
  sqlite.exec(sql);
  assert.equal(revOf(sqlite), before + 1);
  assert.deepEqual(JSON.parse(read(sqlite, "late-movie").data!), KEPT);
  assert.deepEqual(JSON.parse(read(sqlite, "late-series").data!), {});
  for (const id of ["late-movie", "late-series"]) assert.equal(read(sqlite, id).rev, before + 1, id);
  assert.equal(read(sqlite, "late-book").rev, 7);
  assert.deepEqual(JSON.parse(read(sqlite, "late-book").data!), { cover: POSTER });
  assert.deepEqual(JSON.parse(read(sqlite, "live-movie").data!), { ...KEPT, ...KEYS });
  const stamped = sqlite.prepare("SELECT id, rev, updated_at FROM items ORDER BY id").all();
  sqlite.exec(sql);
  sqlite.exec(sql);
  assert.equal(revOf(sqlite), before + 1);
  assert.deepEqual(sqlite.prepare("SELECT id, rev, updated_at FROM items ORDER BY id").all(), stamped);
});

test("the deploy job re-runs the purge after wrangler deploy, with the same credentials and the file of the migration", () => {
  const steps = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8").split("\n      - ");
  const at = (needle: string) => steps.findIndex((step) => step.includes(needle));
  const purge = at(`wrangler d1 execute wp --remote --file migrations/${PURGE}`);
  assert.ok(at("wrangler d1 migrations apply wp --remote") < at("npx wrangler deploy"));
  assert.ok(at("npx wrangler deploy") < purge);
  assert.equal(at("npx wrangler deploy") + 1, purge);
  assert.match(steps[purge], /CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}\n\s+CLOUDFLARE_ACCOUNT_ID: \$\{\{ secrets\.CLOUDFLARE_ACCOUNT_ID \}\}/);
});

test("a poster write that read the row live and commits after the partner's delete leaves no keys on the tombstone", async () => {
  const { server, open } = rig();
  const a = open("a");
  const b = open("b");
  await a.store.open();
  await b.store.open();
  const id = idOf(await a.store.create("items", { kind: "movie", title: "Pelabuhan Terakhir", status: "watched", data: { year: 1999 } } as never));
  await settle(a.store, b.store);
  interleaved(
    server,
    async () => {
      idOf(await a.store.remove("items", id));
      await a.store.sync();
    },
    "json_patch(",
  );
  idOf(await b.store.update("items", id, { data: KEYS } as never));
  await b.store.sync();
  assert.notEqual(stored(server, id).deleted_at, null);
  assert.deepEqual(dataOf(server, id), { year: 1999 });
  await settle(a.store, b.store);
  assert.deepEqual(dataOf(server, id), { year: 1999 });
});
