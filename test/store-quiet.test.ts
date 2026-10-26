import { test } from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../src/store/api.ts";
import { memoryPersistence } from "../src/store/memory.ts";
import type { Persistence, Write } from "../src/store/persistence.ts";
import { createStore } from "../src/store/store.ts";
import type { Side } from "../shared/api.ts";
import { createServer } from "./store-server.ts";
import type { Server } from "./store-server.ts";
import { client, idOf, task, titles } from "./store-client.ts";
import type { Fetch } from "../src/store/api.ts";

const spied = () => {
  const real = memoryPersistence();
  const writes: Write[] = [];
  const persistence: Persistence = {
    load: () => real.load(),
    reset: (expected, meta) => real.reset(expected, meta),
    adopt: (from) => real.adopt(from),
    write: async (write) => {
      writes.push(write);
      return real.write(write);
    },
  };
  return { real, writes, persistence };
};

const counted = (store: ReturnType<typeof client>["store"]) => {
  const calls = { n: 0 };
  store.subscribe(() => void calls.n++);
  return calls;
};

const seeded = async () => {
  const server = createServer();
  const a = client(server, "a");
  await a.store.open();
  idOf(await a.store.create("items", task("first")));
  idOf(await a.store.create("budget_entries", { entry_type: "planned", title: "Venue", group_key: "reception", amount: 100 }));
  idOf(await a.store.create("settings", { key: "greeting", value: "hello" }));
  await a.store.sync();
  const spy = spied();
  const b = createStore({ persistence: spy.persistence, api: createApi(server.as("b"), "b") });
  await b.open();
  await b.sync();
  return { server, a, b, spy };
};

test("a pull with nothing new notifies nobody, keeps the snapshot and writes nothing", async () => {
  const { b, spy } = await seeded();
  const before = b.getSnapshot();
  const calls = counted(b);
  const writes = spy.writes.length;
  for (let n = 0; n < 3; n++) await b.sync();
  assert.equal(calls.n, 0);
  assert.equal(b.getSnapshot(), before);
  assert.equal(spy.writes.length, writes);
});

test("one partner row replaces only the arrays of the tables it touches", async () => {
  const { a, b } = await seeded();
  const before = b.getSnapshot();
  const calls = counted(b);
  idOf(await a.store.create("items", task("second")));
  await a.store.sync();
  await b.sync();
  const after = b.getSnapshot();
  assert.equal(calls.n, 1);
  assert.deepEqual(titles(after.rows.items), ["first", "second"]);
  assert.notEqual(after.rows.items, before.rows.items);
  assert.equal(after.rows.budget_entries, before.rows.budget_entries);
  assert.equal(after.rows.settings, before.rows.settings);
});

test("a table with several unchanged rows keeps its array when only another table changes", async () => {
  const { a, b } = await seeded();
  idOf(await a.store.create("items", task("second")));
  idOf(await a.store.create("items", task("third")));
  await a.store.sync();
  await b.sync();
  const before = b.getSnapshot();
  assert.equal(before.rows.items.length, 3);
  idOf(await a.store.create("budget_entries", { entry_type: "planned", title: "Cake", group_key: "reception", amount: 5 }));
  await a.store.sync();
  await b.sync();
  const after = b.getSnapshot();
  assert.notEqual(after.rows.budget_entries, before.rows.budget_entries);
  assert.equal(after.rows.items, before.rows.items);
});

test("a quiet pull keeps a pending local patch on screen and replaces nothing", async () => {
  const { server } = await seeded();
  const held = { pull: null as Promise<void> | null, push: null as Promise<void> | null };
  const reached = { pull: () => {}, push: () => {} };
  const gated: Fetch = async (url, init) => {
    const gate = init.method === "POST" ? held.push : held.pull;
    if (gate) {
      (init.method === "POST" ? reached.push : reached.pull)();
      await gate;
    }
    return server.as("b")(url, init);
  };
  const b = createStore({ persistence: memoryPersistence(), api: createApi(gated, "b") });
  await b.open();
  const id = b.getSnapshot().rows.items[0].id;
  let release = () => {};
  let releasePush = () => {};
  held.pull = new Promise<void>((resolve) => (release = resolve));
  held.push = new Promise<void>((resolve) => (releasePush = resolve));
  const arrived = new Promise<void>((resolve) => (reached.pull = resolve));
  const calls = counted(b);
  const pulling = b.sync();
  await arrived;
  idOf(await b.update("items", id, { title: "typed locally" }));
  const typed = b.getSnapshot();
  assert.equal(calls.n, 1);
  assert.deepEqual([typed.pending, titles(typed.rows.items)], [1, ["typed locally"]]);
  const pushed = new Promise<void>((resolve) => (reached.push = resolve));
  held.pull = null;
  release();
  await pushed;
  assert.equal(calls.n, 1);
  assert.equal(b.getSnapshot(), typed);
  releasePush();
  await pulling;
  assert.equal(b.getSnapshot().pending, 0);
  assert.deepEqual(titles(b.getSnapshot().rows.items), ["typed locally"]);
  assert.equal((server.rows("items")[0] as { title: string }).title, "typed locally");
});

test("a changed or removed row always replaces its table array", async () => {
  const { server, a, b } = await seeded();
  const id = idOf(await a.store.create("items", task("second")));
  await a.store.sync();
  await b.sync();
  let before = b.getSnapshot().rows.items;
  idOf(await a.store.update("items", id, { title: "renamed" }));
  await a.store.sync();
  await b.sync();
  assert.notEqual(b.getSnapshot().rows.items, before);
  assert.deepEqual(titles(b.getSnapshot().rows.items), ["first", "renamed"]);
  before = b.getSnapshot().rows.items;
  idOf(await a.store.remove("items", id));
  await a.store.sync();
  await b.sync();
  assert.notEqual(b.getSnapshot().rows.items, before);
  assert.deepEqual(titles(b.getSnapshot().rows.items), ["first"]);
  assert.equal(server.rows("items").length, 2);
});

test("a partner's private write moves the stored revision without a notification", async () => {
  const { server, a, b, spy } = await seeded();
  const before = b.getSnapshot();
  const calls = counted(b);
  const revision = server.rev;
  idOf(await a.store.create("items", { kind: "routine", title: "Evening wind-down", who: "a", data: { private: true } }));
  await a.store.sync();
  assert.equal(server.rev, revision + 1);
  await b.sync();
  assert.equal(calls.n, 0);
  assert.equal(b.getSnapshot(), before);
  assert.equal((await spy.real.load()).meta.rev, server.rev);
  const reopened = createStore({ persistence: spy.persistence, api: createApi(server.as("b"), "b") });
  await reopened.open();
  assert.equal(server.seen.filter((request) => request.method === "GET").at(-1)?.since, server.rev);
});

test("a pull with rows notifies exactly once", async () => {
  const { a, b } = await seeded();
  const calls = counted(b);
  idOf(await a.store.create("items", task("second")));
  idOf(await a.store.create("budget_entries", { entry_type: "planned", title: "Cake", group_key: "reception", amount: 5 }));
  await a.store.sync();
  await b.sync();
  assert.equal(calls.n, 1);
});

test("going offline and coming back notifies, and a second failed pull while offline does not", async () => {
  const { server, b } = await seeded();
  const calls = counted(b);
  server.control.down = true;
  await b.sync();
  assert.deepEqual([calls.n, b.getSnapshot().link], [1, "offline"]);
  const offline = b.getSnapshot();
  await b.sync();
  await b.sync();
  assert.equal(calls.n, 1);
  assert.equal(b.getSnapshot(), offline);
  server.control.down = false;
  await b.sync();
  assert.deepEqual([calls.n, b.getSnapshot().link], [2, "online"]);
  assert.equal(b.getSnapshot().rows.items.length, 1);
});

test("a changed side notifies even when no row came", async () => {
  const server = createServer();
  let who: Side = "a";
  const store = createStore({ persistence: memoryPersistence(), api: createApi((url, init) => server.as(who)(url, init)) });
  await store.open();
  assert.equal(store.getSnapshot().me, "a");
  const calls = counted(store);
  who = "b";
  await store.sync();
  assert.deepEqual([calls.n, store.getSnapshot().me], [1, "b"]);
});

test("a new epoch notifies", async () => {
  const { server, b } = await seeded();
  const calls = counted(b);
  server.wipe();
  await b.sync();
  assert.ok(calls.n >= 1);
  assert.equal(b.getSnapshot().rows.items.length, 0);
});

test("a pull with nothing new still clears a storage failure", async () => {
  const server = createServer();
  const real = memoryPersistence();
  const control = { failing: false };
  const persistence: Persistence = {
    load: () => real.load(),
    reset: (expected, meta) => real.reset(expected, meta),
    adopt: (from) => real.adopt(from),
    write: async (write) => {
      if (control.failing) throw new Error("QuotaExceededError");
      return real.write(write);
    },
  };
  const store = createStore({ persistence, api: createApi(server.as("a"), "a") });
  await store.open();
  await store.sync();
  control.failing = true;
  assert.equal((await store.create("items", task("lost"))).ok, false);
  assert.equal(store.getSnapshot().storage, "failed");
  control.failing = false;
  await store.sync();
  assert.equal(store.getSnapshot().storage, "ok");
});
