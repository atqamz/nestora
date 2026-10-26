import { test } from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../src/store/api.ts";
import { memoryPersistence } from "../src/store/memory.ts";
import { createStore, paused } from "../src/store/store.ts";
import { idOf, task } from "./store-client.ts";
import { createServer } from "./store-server.ts";

const held = (persistence = memoryPersistence()) => {
  const server = createServer();
  return { persistence, server, store: createStore({ persistence, api: { ...createApi(server.as("a"), "a"), pull: async () => ({ kind: "offline" as const }) }, held: true }) };
};

const every = async (store: ReturnType<typeof held>["store"]) => [
  await store.create("items", task("One")),
  await store.update("items", "missing", { title: "Two" }),
  await store.remove("items", "missing"),
  await store.many([{ op: "create", table: "items", id: crypto.randomUUID(), draft: task("Three") }]),
  await store.setSetting("timezone", "Asia/Jakarta"),
  await store.discard(1),
];

test("a held store starts paused and refuses every write, before and after it is loaded, and touches nothing", async () => {
  const { persistence, server, store } = held();
  const empty = await persistence.load();
  assert.deepEqual(store.getSnapshot(), { ready: false, me: null, rows: { items: [], budget_entries: [], settings: [] }, pending: 0, rejected: [], link: "online", storage: "ok", notice: null, paused: true, dated: false });
  assert.deepEqual(await every(store), Array(6).fill(paused));
  await store.open();
  assert.equal(store.getSnapshot().paused, true);
  assert.deepEqual(await every(store), Array(6).fill(paused));
  assert.deepEqual(await persistence.load(), empty);
  assert.equal(server.seen.filter((request) => request.method === "POST").length, 0);
});

test("an open store that is not held refuses writes only until it is loaded", async () => {
  const server = createServer();
  const persistence = memoryPersistence();
  const empty = await persistence.load();
  const store = createStore({ persistence, api: createApi(server.as("a"), "a") });
  assert.deepEqual(await every(store), Array(6).fill(paused));
  assert.deepEqual(await persistence.load(), empty);
  await store.open();
  idOf(await store.create("items", task("Loaded")));
});

test("releasing a held store tells its listeners and lets writes through", async () => {
  const { persistence, store } = held();
  await store.open();
  const seen: boolean[] = [];
  store.subscribe(() => seen.push(store.getSnapshot().paused));
  store.release();
  assert.deepEqual(seen, [false]);
  const id = idOf(await store.create("items", task("After the release")));
  assert.ok(id);
  assert.equal((await persistence.load()).outbox.length, 1);
});
