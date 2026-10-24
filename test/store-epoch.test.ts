import { test } from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../src/store/api.ts";
import { memoryPersistence } from "../src/store/memory.ts";
import type { Persistence } from "../src/store/persistence.ts";
import { createStore } from "../src/store/store.ts";
import { createServer } from "./store-server.ts";
import type { Server } from "./store-server.ts";
import { idOf, task, titles } from "./store-client.ts";

const recording = (real: Persistence) => {
  const control = { failing: false, resets: 0 };
  const persistence: Persistence = {
    load: () => real.load(),
    write: (write) => real.write(write),
    adopt: (from) => real.adopt(from),
    reset: async (expected, meta) => {
      if (control.failing) throw new Error("QuotaExceededError");
      const applied = await real.reset(expected, meta);
      if (applied !== null) control.resets += 1;
      return applied;
    },
  };
  return { control, persistence };
};

const posts = (server: Server) => server.seen.filter((request) => request.method === "POST");

const phone = async (server: Server, real = memoryPersistence()) => {
  const { control, persistence } = recording(real);
  const store = createStore({ persistence, api: createApi(server.as("a")) });
  await store.open();
  return { store, control, persistence, real };
};

const reopen = async (server: Server, real: Persistence) => {
  const store = createStore({ persistence: real, api: createApi(server.as("a")) });
  await store.open();
  return store;
};

const synced = async (server: Server, count = 2) => {
  const p = await phone(server);
  for (let n = 1; n <= count; n++) idOf(await p.store.create("items", task(`task ${n}`)));
  await p.store.sync();
  assert.equal(p.store.getSnapshot().pending, 0);
  return p;
};

const restart = async (p: Awaited<ReturnType<typeof phone>>, server: Server) => {
  server.control.down = false;
  const store = createStore({ persistence: p.persistence, api: createApi(server.as("a")) });
  await store.open();
  return store;
};

const writeOn = async (server: Server, count: number) => {
  server.control.down = false;
  const other = createStore({ persistence: memoryPersistence(), api: createApi(server.as("b")) });
  await other.open();
  for (let n = 1; n <= count; n++) {
    idOf(await other.create("items", task(`server ${n}`)));
    await other.sync();
  }
};

const offlineWrites = async (p: Awaited<ReturnType<typeof phone>>, server: Server, count: number) => {
  server.control.down = true;
  for (let n = 1; n <= count; n++) idOf(await p.store.create("items", task(`offline ${n}`)));
  assert.equal(p.store.getSnapshot().pending, count);
};

test("a new epoch resets this phone to the server, drops the outbox and says how many changes were lost", async () => {
  const server = createServer();
  const p = await synced(server);
  await offlineWrites(p, server, 3);
  server.wipe();
  const before = posts(server).length;
  const store = await restart(p, server);
  const snap = store.getSnapshot();
  assert.deepEqual(snap.notice, { discarded: 3 });
  assert.deepEqual([snap.pending, snap.link, snap.storage], [0, "online", "ok"]);
  assert.deepEqual(titles(snap.rows.items), []);
  assert.equal(posts(server).length, before);
  const saved = await p.real.load();
  assert.deepEqual([saved.outbox.length, saved.meta.epoch, saved.meta.rev, saved.rows.items.length], [0, server.epoch, 0, 0]);
});

test("the stale outbox is never sent to a database it did not come from", async () => {
  const server = createServer();
  const p = await synced(server);
  await offlineWrites(p, server, 2);
  server.wipe();
  const before = posts(server).length;
  await restart(p, server);
  assert.equal(server.rev, 0);
  assert.equal(posts(server).length, before);
});

test("after a reset the phone shows what the server has, from revision 0", async () => {
  const server = createServer();
  const p = await synced(server);
  server.wipe();
  const other = createStore({ persistence: memoryPersistence(), api: createApi(server.as("b")) });
  await other.open();
  idOf(await other.create("items", task("fresh one")));
  await other.sync();
  await p.store.sync();
  assert.deepEqual(titles(p.store.getSnapshot().rows.items), ["fresh one"]);
  assert.equal(server.seen.filter((request) => request.method === "GET").at(-1)?.since, 0);
  assert.equal((await p.real.load()).meta.rev, server.rev);
});

test("a stored phone from before epochs, with data and no epoch, is reset", async () => {
  const server = createServer();
  const old = memoryPersistence();
  const stale = { ...(await (await synced(createServer(), 1)).real.load()).rows.items[0] };
  await old.write({
    rows: { items: [stale] },
    outbox: { put: [{ id: crypto.randomUUID(), table: "items", op: "create", row_id: stale.id, patch: { ...stale }, at: stale.created_at, seq: 1 }] },
    meta: { rev: 5, me: "a" },
  });
  assert.equal((await old.load()).meta.epoch, null);
  const p = await phone(server, old);
  const snap = p.store.getSnapshot();
  assert.deepEqual(snap.notice, { discarded: 1 });
  assert.deepEqual([titles(snap.rows.items), snap.pending, snap.link], [[], 0, "online"]);
  const saved = await old.load();
  assert.deepEqual([saved.meta.epoch, saved.meta.rev, saved.rows.items.length, saved.outbox.length], [server.epoch, 0, 0, 0]);
});

test("a phone from before epochs is reset even when the server revision is not behind its cursor", async () => {
  const server = createServer();
  await writeOn(server, 3);
  const old = memoryPersistence();
  const stale = (await (await synced(createServer(), 1)).real.load()).rows.items[0];
  await old.write({ rows: { items: [stale] }, meta: { rev: 1, me: "a" } });
  assert.ok(server.rev >= 1);
  const p = await phone(server, old);
  assert.deepEqual(p.store.getSnapshot().notice, { discarded: 0 });
  assert.deepEqual(titles(p.store.getSnapshot().rows.items), ["server 1", "server 2", "server 3"]);
  assert.equal((await old.load()).meta.epoch, server.epoch);
});

test("a server revision lower than the cursor is a foreign history even with the same epoch", async () => {
  const server = createServer();
  const p = await synced(server, 3);
  assert.ok(server.rev >= 1);
  const sameEpoch = server.epoch;
  server.rewind(0);
  assert.equal(server.epoch, sameEpoch);
  await p.store.sync();
  assert.deepEqual(p.store.getSnapshot().notice, { discarded: 0 });
  assert.deepEqual(titles(p.store.getSnapshot().rows.items), []);
  assert.equal((await p.real.load()).meta.rev, 0);
});

test("the same epoch and a revision at or above the cursor never resets", async () => {
  const server = createServer();
  const p = await synced(server);
  await p.store.sync();
  await p.store.sync();
  assert.equal(p.store.getSnapshot().notice, null);
  assert.equal(p.control.resets, 0);
  const other = createStore({ persistence: memoryPersistence(), api: createApi(server.as("b")) });
  await other.open();
  idOf(await other.create("items", task("from the other phone")));
  await other.sync();
  idOf(await p.store.create("items", task("from this phone")));
  await p.store.sync();
  assert.equal(p.store.getSnapshot().notice, null);
  assert.equal(p.control.resets, 0);
  assert.deepEqual(titles(p.store.getSnapshot().rows.items), ["from the other phone", "from this phone", "task 1", "task 2"]);
  const reopened = await reopen(server, p.real);
  assert.equal(reopened.getSnapshot().notice, null);
  assert.deepEqual(titles(reopened.getSnapshot().rows.items), ["from the other phone", "from this phone", "task 1", "task 2"]);
});

test("a reset with nothing waiting reports zero lost changes", async () => {
  const server = createServer();
  const p = await synced(server);
  server.wipe();
  await p.store.sync();
  assert.deepEqual(p.store.getSnapshot().notice, { discarded: 0 });
});

test("an empty phone adopts the epoch without a notice and without a reset", async () => {
  const server = createServer();
  const p = await phone(server);
  assert.equal(p.store.getSnapshot().notice, null);
  assert.equal(p.control.resets, 0);
  assert.equal((await p.real.load()).meta.epoch, server.epoch);
  server.wipe();
  await p.store.sync();
  assert.equal(p.store.getSnapshot().notice, null);
  assert.equal((await p.real.load()).meta.epoch, server.epoch);
});

test("a phone that never synced keeps its first offline writes and sends them", async () => {
  const server = createServer();
  server.control.down = true;
  const p = await phone(server);
  idOf(await p.store.create("items", task("written before the first sync")));
  server.control.down = false;
  await p.store.sync();
  const snap = p.store.getSnapshot();
  assert.equal(snap.notice, null);
  assert.equal(p.control.resets, 0);
  assert.deepEqual([titles(snap.rows.items), snap.pending], [["written before the first sync"], 0]);
  assert.equal((await p.real.load()).meta.epoch, server.epoch);
});

test("a failed clear reports a storage problem, adopts nothing and resets on the next try", async () => {
  const server = createServer();
  const p = await synced(server);
  await offlineWrites(p, server, 2);
  server.wipe();
  await writeOn(server, 4);
  const epoch = (await p.real.load()).meta.epoch;
  p.control.failing = true;
  const store = await restart(p, server);
  const snap = store.getSnapshot();
  assert.deepEqual([snap.storage, snap.notice, snap.pending], ["failed", null, 2]);
  assert.deepEqual(titles(snap.rows.items), ["offline 1", "offline 2", "task 1", "task 2"]);
  assert.ok(server.rev >= (await p.real.load()).meta.rev);
  const saved = await p.real.load();
  assert.deepEqual([saved.meta.epoch, saved.outbox.length, saved.rows.items.length], [epoch, 2, 2]);
  assert.notEqual(epoch, server.epoch);

  p.control.failing = false;
  await store.sync();
  const after = store.getSnapshot();
  assert.deepEqual([after.storage, after.notice, after.pending], ["ok", { discarded: 2 }, 0]);
  assert.deepEqual(titles(after.rows.items), ["server 1", "server 2", "server 3", "server 4"]);
  assert.equal(p.control.resets, 1);
  assert.equal((await p.real.load()).meta.epoch, server.epoch);
});

test("a crash right after the clear leaves a clean phone that catches up on the next start", async () => {
  const server = createServer();
  const p = await synced(server);
  server.wipe();
  const other = createStore({ persistence: memoryPersistence(), api: createApi(server.as("b")) });
  await other.open();
  idOf(await other.create("items", task("kept on the server")));
  await other.sync();

  const real = server.as("a");
  let gets = 0;
  const dying = createStore({
    persistence: p.persistence,
    api: createApi(async (url, init) => {
      if (init.method === "GET" && ++gets === 2) throw new TypeError("the app was killed");
      return real(url, init);
    }),
  });
  await dying.open();
  const midway = await p.real.load();
  assert.deepEqual([midway.meta.epoch, midway.meta.rev, midway.rows.items.length, midway.outbox.length], [server.epoch, 0, 0, 0]);

  const next = await reopen(server, p.real);
  assert.equal(next.getSnapshot().notice, null);
  assert.deepEqual(titles(next.getSnapshot().rows.items), ["kept on the server"]);
  assert.equal(next.getSnapshot().link, "online");
});

test("one mismatch resets once, however often the phone syncs, and a dismissed notice stays dismissed", async () => {
  const server = createServer();
  const p = await synced(server);
  await offlineWrites(p, server, 1);
  server.wipe();
  const store = await restart(p, server);
  await store.sync();
  await Promise.all([store.sync(), store.sync()]);
  assert.equal(p.control.resets, 1);
  assert.deepEqual(store.getSnapshot().notice, { discarded: 1 });
  store.dismissNotice();
  assert.equal(store.getSnapshot().notice, null);
  await store.sync();
  assert.equal(store.getSnapshot().notice, null);
  const reopened = await reopen(server, p.real);
  assert.equal(reopened.getSnapshot().notice, null);
  assert.equal(p.control.resets, 1);
});

test("a new epoch seen in a push result resets the phone and does not call the batch that landed lost", async () => {
  const server = createServer();
  const p = await synced(server);
  server.wipe();
  idOf(await p.store.create("items", task("written after the wipe")));
  await p.store.sync();
  const snap = p.store.getSnapshot();
  assert.deepEqual(snap.notice, { discarded: 0 });
  assert.equal(p.control.resets, 1);
  assert.equal((await p.real.load()).meta.epoch, server.epoch);
  assert.deepEqual([snap.pending, snap.link], [0, "online"]);
  assert.deepEqual(titles(snap.rows.items), ["written after the wipe"]);
  assert.equal(server.row("items", snap.rows.items[0].id)?.title, "written after the wipe");
});

test("only the changes that were really discarded are counted when a push result reveals the reset", async () => {
  const server = createServer();
  const p = await synced(server);
  await offlineWrites(p, server, 25);
  server.wipe();
  server.control.down = false;
  await p.store.sync();
  const snap = p.store.getSnapshot();
  assert.deepEqual(snap.notice, { discarded: 5 });
  assert.equal(p.control.resets, 1);
  assert.equal(snap.rows.items.length, 20);
  assert.equal(snap.pending, 0);
});

test("a response without an epoch is retry-later, never a reset", async () => {
  const server = createServer();
  const p = await synced(server);
  const bare = async () => Response.json({ rev: 0, me: "a", changes: { items: [], budget_entries: [], settings: [] } });
  const store = createStore({ persistence: p.persistence, api: createApi(bare) });
  await store.open();
  assert.deepEqual([store.getSnapshot().link, store.getSnapshot().notice, titles(store.getSnapshot().rows.items)], ["offline", null, ["task 1", "task 2"]]);
});

test("a push result without an epoch is retry-later, never a reset", async () => {
  const server = createServer();
  const p = await synced(server);
  await offlineWrites(p, server, 1);
  server.control.down = false;
  const real = server.as("a");
  const bare = async (url: string, init: RequestInit) =>
    init.method === "POST" ? Response.json({ rev: 99, rows: { items: [], budget_entries: [], settings: [] } }) : real(url, init);
  const store = createStore({ persistence: p.persistence, api: createApi(bare) });
  await store.open();
  const snap = store.getSnapshot();
  assert.deepEqual([snap.link, snap.notice, snap.pending, p.control.resets], ["offline", null, 1, 0]);
  assert.deepEqual(titles(snap.rows.items), ["offline 1", "task 1", "task 2"]);
  const saved = await p.real.load();
  assert.deepEqual([saved.outbox.length, saved.rows.items.length, saved.meta.epoch], [1, 2, server.epoch]);
});

const twoTabs = async (server: Server) => {
  const real = memoryPersistence();
  const { control, persistence } = recording(real);
  const direct = server.as("a");
  const link = { down: false };
  const tab1 = createStore({
    persistence,
    api: createApi(async (url, init) => {
      if (link.down) throw new TypeError("fetch failed");
      return direct(url, init);
    }),
  });
  const tab2 = createStore({ persistence, api: createApi(server.as("a")) });
  await tab1.open();
  idOf(await tab1.create("items", task("shared before")));
  await tab1.sync();
  await tab2.open();
  assert.deepEqual(titles(tab2.getSnapshot().rows.items), ["shared before"]);
  return { tab1, tab2, real, control, link };
};

test("a stale second tab adopts another tab's reset, its rows and its epoch, and never erases that tab's unsent writes", async () => {
  const server = createServer();
  const { tab1, tab2, real, control, link } = await twoTabs(server);
  server.wipe();
  await writeOn(server, 2);
  await tab1.sync();
  assert.deepEqual(tab1.getSnapshot().notice, { discarded: 0 });
  assert.deepEqual(titles(tab1.getSnapshot().rows.items), ["server 1", "server 2"]);
  assert.equal(control.resets, 1);

  link.down = true;
  const kept = idOf(await tab1.create("items", task("tab1 pending")));
  assert.equal((await real.load()).outbox.length, 1);

  await tab2.sync();
  const adopted = tab2.getSnapshot();
  assert.equal(control.resets, 1);
  assert.deepEqual(adopted.notice, { discarded: 0 });
  assert.deepEqual([adopted.storage, adopted.link, adopted.pending], ["ok", "online", 1]);
  assert.deepEqual(titles(adopted.rows.items), ["server 1", "server 2", "tab1 pending"]);
  assert.deepEqual((await real.load()).outbox.map((entry) => entry.row_id), [kept]);
  assert.equal((await real.load()).meta.epoch, server.epoch);

  await tab2.sync();
  await tab2.sync();
  assert.deepEqual([tab2.getSnapshot().link, tab2.getSnapshot().storage, control.resets], ["online", "ok", 1]);
  assert.equal(server.row("items", kept)?.title, "tab1 pending");

  link.down = false;
  await tab1.sync();
  const reopened = await reopen(server, real);
  assert.deepEqual(titles(reopened.getSnapshot().rows.items), ["server 1", "server 2", "tab1 pending"]);
  assert.equal(reopened.getSnapshot().notice, null);
  assert.equal(control.resets, 1);
});

test("a rollback to a lower revision under the same epoch is reset once, and a stale second tab does not reset it again", async () => {
  const server = createServer();
  const { tab1, tab2, real, control, link } = await twoTabs(server);
  const epoch = server.epoch;
  server.rewind(0);
  assert.equal(server.epoch, epoch);
  await tab1.sync();
  assert.deepEqual(tab1.getSnapshot().notice, { discarded: 0 });
  assert.equal(control.resets, 1);

  link.down = true;
  const kept = idOf(await tab1.create("items", task("a pending after rollback")));
  assert.deepEqual((await real.load()).outbox.map((entry) => entry.row_id), [kept]);

  await tab2.sync();
  assert.equal(control.resets, 1);
  assert.deepEqual((await real.load()).outbox.map((entry) => entry.row_id), [kept]);
  assert.deepEqual([tab2.getSnapshot().link, tab2.getSnapshot().storage], ["online", "ok"]);
  assert.deepEqual(titles(tab2.getSnapshot().rows.items), ["a pending after rollback"]);

  link.down = false;
  await tab1.sync();
  assert.equal(server.row("items", kept)?.title, "a pending after rollback");
  const reopened = await reopen(server, real);
  assert.deepEqual(titles(reopened.getSnapshot().rows.items), ["a pending after rollback"]);
  assert.equal(control.resets, 1);
});

test("a phone that reset once resets again for a later mismatch, also after a restart", async () => {
  const server = createServer();
  const p = await synced(server);
  server.wipe();
  await p.store.sync();
  assert.equal(p.control.resets, 1);
  await writeOn(server, 1);
  await p.store.sync();
  server.wipe();
  await p.store.sync();
  assert.equal(p.control.resets, 2);
  assert.equal(p.store.getSnapshot().link, "online");
  assert.deepEqual(p.store.getSnapshot().notice, { discarded: 0 });
  assert.equal((await p.real.load()).meta.epoch, server.epoch);

  const restarted = await restart(p, server);
  server.wipe();
  await restarted.sync();
  assert.equal(p.control.resets, 3);
  assert.equal(restarted.getSnapshot().link, "online");
  assert.equal((await p.real.load()).meta.epoch, server.epoch);
});

test("a stale tab that adopted another tab's reset resets again when the server changes again", async () => {
  const server = createServer();
  const { tab1, tab2, real, control } = await twoTabs(server);
  server.wipe();
  await tab1.sync();
  await tab2.sync();
  assert.equal(control.resets, 1);
  server.wipe();
  await writeOn(server, 2);
  await tab2.sync();
  assert.equal(control.resets, 2);
  assert.deepEqual(titles(tab2.getSnapshot().rows.items), ["server 1", "server 2"]);
  assert.equal(tab2.getSnapshot().link, "online");
  assert.equal((await real.load()).meta.epoch, server.epoch);
});
