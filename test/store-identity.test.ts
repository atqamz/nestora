import { test } from "node:test";
import assert from "node:assert/strict";
import type { Side } from "../shared/api.ts";
import { memoryPersistence } from "../src/store/memory.ts";
import type { Snapshot } from "../src/store/store.ts";
import { createServer } from "./store-server.ts";
import type { Server } from "./store-server.ts";
import { client, idOf, task, titles } from "./store-client.ts";

const MARK = (side: Side) => `Partner ${side.toUpperCase()} private routine`;

const secret = (side: Side) => ({ kind: "routine", title: MARK(side), who: side, data: { private: true } });

const leaks = (snapshot: Snapshot, side: Side) => JSON.stringify([snapshot.rows, snapshot.rejected]).includes(MARK(side));

const watched = (store: ReturnType<typeof client>["store"]) => {
  const seen: Snapshot[] = [];
  store.subscribe(() => seen.push(store.getSnapshot()));
  return seen;
};

const signedInAs = async (server: Server, side: Side, persistence = memoryPersistence()) => {
  const c = client(server, side, persistence);
  await c.store.open();
  idOf(await c.store.create("items", task(`Shared by ${side}`)));
  const routine = idOf(await c.store.create("items", secret(side)));
  idOf(await c.store.create("items", { kind: "step", title: `${MARK(side)} step`, parent_id: routine }));
  await c.store.sync();
  assert.equal(c.store.getSnapshot().pending, 0);
  return c;
};

const persistedText = async (persistence: ReturnType<typeof memoryPersistence>) => JSON.stringify(await persistence.load());

test("Partner B on Partner A's browser profile never sees Partner A's private rows, on first paint or after", async () => {
  const server = createServer();
  const a = await signedInAs(server, "a");
  const b = client(server, "b", a.persistence);
  const seen = watched(b.store);
  await b.store.open();
  assert.ok(seen.length > 0);
  for (const snapshot of seen) assert.equal(leaks(snapshot, "a"), false);
  const snap = b.store.getSnapshot();
  assert.equal(snap.me, "b");
  assert.deepEqual(titles(snap.rows.items), ["Shared by a"]);
  assert.equal((await persistedText(a.persistence)).includes(MARK("a")), false);
});

test("Partner B offline on Partner A's cache sees no private row and the cache stays Partner A's", async () => {
  const server = createServer();
  const a = await signedInAs(server, "a");
  server.control.down = true;
  const b = client(server, "b", a.persistence);
  const seen = watched(b.store);
  await b.store.open();
  assert.equal(b.store.getSnapshot().link, "offline");
  for (const snapshot of seen) assert.equal(leaks(snapshot, "a"), false);
  assert.equal(leaks(b.store.getSnapshot(), "a"), false);
  assert.deepEqual(titles(b.store.getSnapshot().rows.items), ["Shared by a"]);
});

test("a private routine and its action reappear for their owner once the server has confirmed the side", async () => {
  const server = createServer();
  const a = await signedInAs(server, "a");
  server.control.down = true;
  const again = client(server, "a", a.persistence);
  await again.store.open();
  assert.deepEqual(titles(again.store.getSnapshot().rows.items), ["Shared by a"]);
  server.control.down = false;
  await again.store.sync();
  assert.deepEqual(titles(again.store.getSnapshot().rows.items), ["Shared by a", MARK("a"), `${MARK("a")} step`].sort());
});

test("Partner A's unsent private routine never goes out under Partner B and is not parked as rejected", async () => {
  const server = createServer();
  const a = client(server, "a");
  await a.store.open();
  await a.store.sync();
  server.control.down = true;
  idOf(await a.store.create("items", secret("a")));
  assert.equal(a.store.getSnapshot().pending, 1);
  server.control.down = false;
  const b = client(server, "b", a.persistence);
  const seen = watched(b.store);
  await b.store.open();
  for (const snapshot of seen) assert.equal(leaks(snapshot, "a"), false);
  const snap = b.store.getSnapshot();
  assert.deepEqual([snap.pending, snap.rejected.length, snap.notice], [0, 0, null]);
  assert.deepEqual(server.seen.filter((request) => request.method === "POST"), []);
  assert.equal(server.rows("items").length, 0);
  assert.equal((await a.persistence.load()).outbox.length, 0);
});

test("switching back to Partner A restores Partner A's rows without duplicates and without Partner B's private rows", async () => {
  const server = createServer();
  const a = await signedInAs(server, "a");
  const b = await signedInAs(server, "b", a.persistence);
  assert.equal(leaks(b.store.getSnapshot(), "a"), false);
  assert.equal(titles(b.store.getSnapshot().rows.items).includes(MARK("b")), true);
  const back = client(server, "a", a.persistence);
  const seen = watched(back.store);
  await back.store.open();
  for (const snapshot of seen) assert.equal(leaks(snapshot, "b"), false);
  const snap = back.store.getSnapshot();
  assert.equal(snap.me, "a");
  assert.deepEqual(titles(snap.rows.items), ["Shared by a", "Shared by b", MARK("a"), `${MARK("a")} step`].sort());
  assert.equal(snap.rows.items.filter((row) => row.title === MARK("a")).length, 1);
  assert.equal((await persistedText(a.persistence)).includes(MARK("b")), false);
});

test("the same identity keeps its unsent outbox across a reopen", async () => {
  const server = createServer();
  const a = await signedInAs(server, "a");
  server.control.down = true;
  idOf(await a.store.create("items", task("Offline by a")));
  const again = client(server, "a", a.persistence);
  await again.store.open();
  assert.equal(again.store.getSnapshot().pending, 1);
  server.control.down = false;
  await again.store.sync();
  assert.deepEqual([again.store.getSnapshot().pending, server.rows("items").filter((row) => row.title === "Offline by a").length], [0, 1]);
});

test("a changed identity and a new epoch together still reset the cache", async () => {
  const server = createServer();
  const a = await signedInAs(server, "a");
  server.wipe();
  const b = client(server, "b", a.persistence);
  await b.store.open();
  idOf(await b.store.create("items", task("Fresh")));
  await b.store.sync();
  const snap = b.store.getSnapshot();
  assert.deepEqual(titles(snap.rows.items), ["Fresh"]);
  assert.equal(snap.me, "b");
  assert.equal((await persistedText(a.persistence)).includes("Shared by a"), false);
});

test("a new epoch for the same identity still says how many changes were lost", async () => {
  const server = createServer();
  const a = await signedInAs(server, "a");
  server.control.down = true;
  idOf(await a.store.create("items", task("Offline by a")));
  server.wipe();
  server.control.down = false;
  const again = client(server, "a", a.persistence);
  await again.store.open();
  assert.deepEqual(again.store.getSnapshot().notice, { discarded: 1 });
  assert.equal(leaks(again.store.getSnapshot(), "a"), false);
});

test("a new epoch counts the unsent changes of a phone that never held server rows", async () => {
  const server = createServer();
  const a = client(server, "a");
  await a.store.open();
  await a.store.sync();
  server.control.down = true;
  idOf(await a.store.create("items", task("Offline by a")));
  server.wipe();
  server.control.down = false;
  const again = client(server, "a", a.persistence);
  await again.store.open();
  assert.deepEqual(again.store.getSnapshot().notice, { discarded: 1 });
  assert.equal(again.store.getSnapshot().pending, 0);
});
