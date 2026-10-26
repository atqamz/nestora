import { test } from "node:test";
import assert from "node:assert/strict";
import type { Side } from "../shared/api.ts";
import { createApi } from "../src/store/api.ts";
import type { Fetch } from "../src/store/api.ts";
import { memoryPersistence } from "../src/store/memory.ts";
import { createStore } from "../src/store/store.ts";
import { createServer } from "./store-server.ts";
import { client, idOf, task, titles } from "./store-client.ts";

const pair = async () => {
  const server = createServer();
  const a = client(server, "a");
  const b = client(server, "b");
  await a.store.open();
  await b.store.open();
  const calls = { n: 0, links: [] as string[] };
  b.store.subscribe(() => {
    calls.n++;
    calls.links.push(b.store.getSnapshot().link);
  });
  return { server, a, b, calls };
};

test("a poll brings the other partner's row once and then nothing", async () => {
  const { a, b, calls } = await pair();
  idOf(await a.store.create("items", task("from a")));
  await a.store.sync();
  assert.equal(await b.store.poll(), true);
  assert.deepEqual([titles(b.store.getSnapshot().rows.items), calls.n], [["from a"], 1]);
  assert.equal(await b.store.poll(), true);
  assert.equal(calls.n, 1);
});

test("the first failed poll while online is quiet, the second in a row flips to offline, a success clears it", async () => {
  const { server, b, calls } = await pair();
  server.control.down = true;
  assert.equal(await b.store.poll(), false);
  assert.deepEqual([b.store.getSnapshot().link, calls.n], ["online", 0]);
  assert.equal(await b.store.poll(), false);
  assert.deepEqual([b.store.getSnapshot().link, calls.links], ["offline", ["offline"]]);
  assert.equal(await b.store.poll(), false);
  assert.equal(calls.n, 1);
  server.control.down = false;
  assert.equal(await b.store.poll(), true);
  assert.deepEqual([b.store.getSnapshot().link, calls.links], ["online", ["offline", "online"]]);
  server.control.down = true;
  await b.store.poll();
  assert.deepEqual([b.store.getSnapshot().link, calls.n], ["online", 2]);
});

test("a success between two failures resets the count", async () => {
  const { server, b, calls } = await pair();
  server.control.down = true;
  await b.store.poll();
  server.control.down = false;
  await b.store.poll();
  server.control.down = true;
  await b.store.poll();
  assert.deepEqual([b.store.getSnapshot().link, calls.n], ["online", 0]);
});

test("a server error is quiet once too", async () => {
  const { server, b, calls } = await pair();
  server.control.fail.push(500, 502);
  await b.store.poll();
  assert.deepEqual([b.store.getSnapshot().link, calls.n], ["online", 0]);
  await b.store.poll();
  assert.equal(b.store.getSnapshot().link, "offline");
});

test("an expired login is never quiet", async () => {
  const { server, b } = await pair();
  server.control.session = "unauthorized";
  assert.equal(await b.store.poll(), false);
  assert.equal(b.store.getSnapshot().link, "expired");
});

test("a user-triggered sync that fails flips at once", async () => {
  const { server, b } = await pair();
  server.control.down = true;
  await b.store.sync();
  assert.equal(b.store.getSnapshot().link, "offline");
});

test("a user sync that lands on a quiet poll in flight is not quieted", async () => {
  const server = createServer();
  let release!: () => void;
  let gate: Promise<void> | null = null;
  const fetcher: Fetch = async (url, init) => {
    await gate;
    return server.as("b")(url, init);
  };
  const store = createStore({ persistence: memoryPersistence(), api: createApi(fetcher, "b") });
  await store.open();
  gate = new Promise<void>((resolve) => (release = resolve));
  const quiet = store.poll();
  const loud = store.sync();
  server.control.down = true;
  release();
  await Promise.all([quiet, loud]);
  assert.equal(store.getSnapshot().link, "offline");
});

test("quiet failures lose no row: both partners' rows are there after the recovery", async () => {
  const { server, a, b } = await pair();
  idOf(await b.store.create("items", task("from b")));
  await b.store.sync();
  idOf(await a.store.create("items", task("from a")));
  await a.store.sync();
  server.control.down = true;
  await b.store.poll();
  await b.store.poll();
  server.control.down = false;
  await b.store.poll();
  assert.deepEqual(titles(b.store.getSnapshot().rows.items), ["from a", "from b"]);
  assert.equal(b.store.getSnapshot().pending, 0);
});

test("a poll that finds the tab signed in as someone else is false, and so is the next one", async () => {
  const server = createServer();
  const world = { who: "b" as Side };
  const store = createStore({ persistence: memoryPersistence(), api: createApi((url, init) => server.as(world.who)(url, init), "b") });
  await store.open();
  assert.equal(await store.poll(), true);
  world.who = "a";
  assert.equal(await store.poll(), false);
  assert.equal(store.getSnapshot().link, "mismatch");
  assert.equal(await store.poll(), false);
});

test("a poll that fails on a link that is not online is not quiet", async () => {
  const { server, b } = await pair();
  server.control.session = "unauthorized";
  await b.store.poll();
  assert.equal(b.store.getSnapshot().link, "expired");
  server.control.session = "ok";
  server.control.down = true;
  await b.store.poll();
  assert.equal(b.store.getSnapshot().link, "offline");
});
