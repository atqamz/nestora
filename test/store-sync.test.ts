import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_MUTATIONS } from "../shared/api.ts";
import { createApi } from "../src/store/api.ts";
import { memoryPersistence } from "../src/store/memory.ts";
import { BATCH_BYTES, takeBatch } from "../src/store/outbox.ts";
import type { Pending } from "../src/store/persistence.ts";
import { createStore } from "../src/store/store.ts";
import { createServer } from "./store-server.ts";
import type { Server } from "./store-server.ts";
import { client, idOf, task, titles } from "./store-client.ts";

const started = async (server: Server, side: "a" | "b" = "a") => {
  const c = client(server, side);
  await c.store.open();
  await c.store.sync();
  return c;
};

const posts = (server: Server) => server.seen.filter((request) => request.method === "POST");

test("offline writes flush once the server is back, with server-owned columns filled in", async () => {
  const server = createServer();
  server.control.down = true;
  const { store, persistence } = client(server, "b");
  await store.open();
  const id = idOf(await store.create("items", task("Book a hall")));
  await store.sync();
  assert.equal(store.getSnapshot().link, "offline");
  assert.equal(store.getSnapshot().pending, 1);
  assert.equal(server.rev, 0);

  server.control.down = false;
  await store.sync();
  const snap = store.getSnapshot();
  assert.deepEqual([snap.pending, snap.link, snap.me], [0, "online", "b"]);
  const row = snap.rows.items.find((item) => item.id === id)!;
  assert.deepEqual([row.rev, row.updated_by], [1, "b"]);
  assert.equal(server.row("items", id)?.title, "Book a hall");
  const saved = await persistence.load();
  assert.deepEqual([saved.outbox.length, saved.meta], [0, { rev: 1, me: "b", epoch: server.epoch, generation: null, adopted: null }]);
  assert.equal(saved.rows.items.length, 1);
});

test("the outbox goes out in write order, parents first", async () => {
  const server = createServer();
  server.control.down = true;
  const { store } = client(server, "a");
  await store.open();
  const line = idOf(await store.create("budget_entries", { entry_type: "planned", title: "Venue", group_key: "reception", amount: 100 }));
  idOf(await store.create("budget_entries", { entry_type: "payment", title: "Deposit", budget_id: line, status: "due", amount: 50 }));
  server.control.down = false;
  await store.sync();
  assert.equal(store.getSnapshot().rejected.length, 0);
  assert.deepEqual(posts(server).map((request) => request.mutations), [2]);
  assert.equal(store.getSnapshot().rows.budget_entries.length, 2);
});

test("a rejected mutation is parked with its errors, the rest still goes out, nothing is retried blindly", async () => {
  const server = createServer();
  const { store, persistence } = await started(server);
  server.control.down = true;
  idOf(await store.create("items", task("first")));
  const ghost = "00000000-0000-4000-8000-0000000000aa";
  idOf(await store.create("budget_entries", { entry_type: "payment", title: "orphan", budget_id: ghost, status: "due", amount: 1 }));
  idOf(await store.create("items", task("third")));
  server.control.down = false;
  const before = posts(server).length;
  await store.sync();
  const snap = store.getSnapshot();
  assert.equal(snap.pending, 0);
  assert.equal(snap.rejected.length, 1);
  assert.equal(snap.rejected[0].patch.title, "orphan");
  assert.match(snap.rejected[0].rejected!.join(), /budget_id/);
  assert.deepEqual(titles(snap.rows.items), ["first", "third"]);
  assert.deepEqual(posts(server).slice(before).map((request) => request.mutations), [3, 2]);
  assert.equal(server.row("budget_entries", snap.rejected[0].row_id), undefined);

  await store.sync();
  await store.sync();
  assert.equal(posts(server).length, before + 2);

  const reopened = client(server, "a", persistence);
  await reopened.store.open();
  assert.equal(reopened.store.getSnapshot().rejected.length, 1);
  await reopened.store.discard(snap.rejected[0].seq);
  assert.equal(reopened.store.getSnapshot().rejected.length, 0);
  assert.equal((await persistence.load()).outbox.length, 0);
});

test("a rejection without an index parks the head of the request", async () => {
  const server = createServer();
  const real = server.as("a");
  let refused = false;
  const fetcher: typeof real = async (url, init) => {
    if (init.method === "POST" && !refused) {
      refused = true;
      return Response.json({ status: 400, errors: ["body: malformed"] }, { status: 400 });
    }
    return real(url, init);
  };
  const persistence = memoryPersistence();
  const store = createStore({ persistence, api: createApi(fetcher) });
  await store.open();
  const created = idOf(await store.create("items", task("head")));
  await store.sync();
  assert.deepEqual(store.getSnapshot().rejected.map((entry) => entry.row_id), [created]);
  assert.equal(store.getSnapshot().pending, 0);
});

test("a 5xx or a network failure keeps the outbox and waits for the next trigger", async () => {
  const server = createServer();
  const { store } = await started(server);
  idOf(await store.create("items", task("later")));
  await store.sync();

  server.control.fail = [500, 502, 503];
  idOf(await store.create("items", task("one")));
  await store.sync();
  assert.deepEqual([store.getSnapshot().link, store.getSnapshot().pending, store.getSnapshot().rejected.length], ["offline", 1, 0]);
  const left = server.control.fail.length;
  await store.sync();
  assert.equal(server.control.fail.length, left - 1);

  server.control.fail = [];
  server.control.down = true;
  await store.sync();
  assert.deepEqual([store.getSnapshot().link, store.getSnapshot().pending], ["offline", 1]);

  server.control.down = false;
  await store.sync();
  assert.deepEqual([store.getSnapshot().link, store.getSnapshot().pending], ["online", 0]);
  assert.equal(titles(store.getSnapshot().rows.items).includes("one"), true);
});

for (const session of ["redirect", "html", "unauthorized"] as const) {
  test(`an expired session (${session}) stops flushing, asks for a login and keeps the outbox`, async () => {
    const server = createServer();
    const { store, persistence } = await started(server);
    server.control.session = session;
    idOf(await store.create("items", task("while expired")));
    await store.sync();
    assert.deepEqual([store.getSnapshot().link, store.getSnapshot().pending, store.getSnapshot().rejected.length], ["expired", 1, 0]);
    assert.equal((await persistence.load()).outbox.length, 1);

    server.control.session = "ok";
    const requests = server.seen.length;
    idOf(await store.create("items", task("no request while the login is pending")));
    assert.equal(server.seen.length, requests);
    assert.equal(store.getSnapshot().link, "expired");

    await store.sync();
    assert.deepEqual([store.getSnapshot().link, store.getSnapshot().pending], ["online", 0]);
    assert.equal(titles(store.getSnapshot().rows.items).length, 2);
  });
}

test("an expired pull keeps the local rows and the login state", async () => {
  const server = createServer();
  const { store } = await started(server);
  idOf(await store.create("items", task("kept")));
  await store.sync();
  server.control.session = "html";
  await store.sync();
  assert.equal(store.getSnapshot().link, "expired");
  assert.deepEqual(titles(store.getSnapshot().rows.items), ["kept"]);
  assert.equal(store.getSnapshot().ready, true);
});

const pending = (n: number, size = 10): Pending[] =>
  Array.from({ length: n }, (_, seq) => ({
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    table: "items",
    op: "update",
    row_id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    patch: { note: "x".repeat(size) },
    seq,
    at: "2026-10-06T00:00:00Z",
  }));

test("a batch holds at most MAX_MUTATIONS", () => {
  assert.equal(takeBatch(pending(MAX_MUTATIONS + 5)).length, MAX_MUTATIONS);
  assert.equal(takeBatch(pending(3)).length, 3);
  assert.equal(takeBatch([]).length, 0);
});

test("a batch stops before the body passes the size cap, but always holds one", () => {
  const entry = 100_000;
  const batch = takeBatch(pending(12, entry));
  assert.equal(batch.length, Math.floor(BATCH_BYTES / (entry + 200)));
  assert.equal(takeBatch(pending(3, BATCH_BYTES + 1)).length, 1);
  const bytes = new TextEncoder().encode(JSON.stringify({ mutations: batch.map(({ id, table, op, row_id, patch }) => ({ id, table, op, row_id, patch })) })).length;
  assert.equal(bytes <= BATCH_BYTES, true);
});

test("a long outbox goes out in requests of at most MAX_MUTATIONS", async () => {
  const server = createServer();
  const { store } = await started(server);
  server.control.down = true;
  for (let n = 0; n < 45; n++) idOf(await store.create("items", task(`task ${n}`)));
  server.control.down = false;
  const before = posts(server).length;
  await store.sync();
  assert.deepEqual(posts(server).slice(before).map((request) => request.mutations), [20, 20, 5]);
  assert.equal(store.getSnapshot().pending, 0);
  assert.equal(server.row("items", store.getSnapshot().rows.items[0].id) !== undefined, true);
});

test("oversized pending mutations are split by the size cap and sent in order", async () => {
  const bodies: string[] = [];
  const reply = (body: unknown) => Response.json(body);
  const fetcher = async (_url: string, init: RequestInit) => {
    if (init.method === "POST") {
      bodies.push(String(init.body));
      return reply({ rev: bodies.length, epoch: "e", rows: { items: [], budget_entries: [], settings: [] } });
    }
    return reply({ rev: bodies.length, epoch: "e", me: "a", changes: { items: [], budget_entries: [], settings: [] } });
  };
  const persistence = memoryPersistence();
  await persistence.write({ outbox: { put: pending(12, 100_000) } });
  const store = createStore({ persistence, api: createApi(fetcher) });
  await store.open();
  const counts = bodies.map((body) => (JSON.parse(body) as { mutations: unknown[] }).mutations.length);
  assert.deepEqual(counts, [5, 5, 2]);
  assert.equal(bodies.every((body) => new TextEncoder().encode(body).length <= BATCH_BYTES), true);
  assert.equal(store.getSnapshot().pending, 0);
});

test("two phones converge: creates, field-level edits, delete wins, undo", async () => {
  const server = createServer();
  const a = await started(server, "a");
  const b = client(server, "b");
  await b.store.open();
  const id = idOf(await a.store.create("items", task("Book a hall")));
  await a.store.sync();
  await b.store.sync();
  assert.deepEqual(titles(b.store.getSnapshot().rows.items), ["Book a hall"]);
  assert.equal(b.store.getSnapshot().me, "b");

  server.control.down = true;
  idOf(await a.store.update("items", id, { amount: 750_000 }));
  idOf(await b.store.update("items", id, { status: "done", done_on: "2026-10-06" }));
  server.control.down = false;
  await a.store.sync();
  await b.store.sync();
  await a.store.sync();
  for (const side of [a, b]) {
    const row = side.store.getSnapshot().rows.items.find((item) => item.id === id)!;
    assert.deepEqual([row.amount, row.status], [750_000, "done"]);
  }

  server.control.down = true;
  idOf(await a.store.update("items", id, { title: "from a" }));
  idOf(await b.store.update("items", id, { title: "from b" }));
  server.control.down = false;
  await a.store.sync();
  await b.store.sync();
  await a.store.sync();
  assert.equal(a.store.getSnapshot().rows.items.find((item) => item.id === id)?.title, "from b");

  server.control.down = true;
  idOf(await a.store.remove("items", id));
  idOf(await b.store.update("items", id, { note: "late edit" }));
  server.control.down = false;
  await b.store.sync();
  await a.store.sync();
  await b.store.sync();
  for (const side of [a, b]) assert.deepEqual(titles(side.store.getSnapshot().rows.items), []);

  idOf(await b.store.update("items", id, { deleted_at: null }));
  await b.store.sync();
  await a.store.sync();
  for (const side of [a, b]) assert.deepEqual(titles(side.store.getSnapshot().rows.items), ["from b"]);
});

test("a tombstone from the server hides the row but stays stored", async () => {
  const server = createServer();
  const a = await started(server, "a");
  const b = client(server, "b");
  await b.store.open();
  const id = idOf(await a.store.create("items", task("gone")));
  await a.store.sync();
  await b.store.sync();
  idOf(await a.store.remove("items", id));
  await a.store.sync();
  await b.store.sync();
  assert.deepEqual(titles(b.store.getSnapshot().rows.items), []);
  const stored = (await b.persistence.load()).rows.items.find((row) => row.id === id);
  assert.equal(typeof stored?.deleted_at, "string");
  assert.equal(server.row("items", id)?.deleted_at !== null, true);
  const reopened = client(server, "b", b.persistence);
  await reopened.store.open();
  assert.deepEqual(titles(reopened.store.getSnapshot().rows.items), []);
});

test("the pull cursor follows pulls only: a push result must not skip another phone's writes", async () => {
  const server = createServer();
  const a = await started(server, "a");
  const b = client(server, "b");
  await b.store.open();
  await b.store.sync();
  idOf(await b.store.create("items", task("from b")));
  await b.store.sync();
  idOf(await a.store.create("items", task("from a")));
  await a.store.sync();
  assert.deepEqual(titles(a.store.getSnapshot().rows.items), ["from a", "from b"]);
  assert.equal((await a.persistence.load()).meta.rev, server.rev);
});

test("pulls start from the stored rev and apply rows by rev only", async () => {
  const server = createServer();
  const a = await started(server, "a");
  const id = idOf(await a.store.create("items", task("v1")));
  await a.store.sync();
  idOf(await a.store.update("items", id, { title: "v2" }));
  await a.store.sync();
  const known = (await a.persistence.load()).meta.rev;
  const reopened = client(server, "a", a.persistence);
  await reopened.store.open();
  assert.equal(server.seen.at(-1)?.since, known);

  const stale = { ...(await a.persistence.load()).rows.items.find((row) => row.id === id)!, title: "old", rev: 1 };
  const fetcher = async (_url: string, init: RequestInit) =>
    Response.json(
      init.method === "POST"
        ? { rev: 9, epoch: server.epoch, rows: { items: [], budget_entries: [], settings: [] } }
        : { rev: known, epoch: server.epoch, me: "a", changes: { items: [stale], budget_entries: [], settings: [] } },
    );
  const lagging = createStore({ persistence: a.persistence, api: createApi(fetcher) });
  await lagging.open();
  assert.equal(lagging.getSnapshot().rows.items.find((row) => row.id === id)?.title, "v2");
  assert.equal((await a.persistence.load()).meta.rev, known);
});

test("the identity is cached for offline reopens, and a never-synced offline start is still ready", async () => {
  const server = createServer();
  const a = await started(server, "a");
  server.control.down = true;
  const reopened = client(server, "a", a.persistence);
  await reopened.store.open();
  assert.deepEqual([reopened.store.getSnapshot().me, reopened.store.getSnapshot().ready], ["a", true]);

  const fresh = client(server, "b");
  assert.equal(fresh.store.getSnapshot().ready, false);
  await fresh.store.open();
  assert.deepEqual([fresh.store.getSnapshot().me, fresh.store.getSnapshot().ready, fresh.store.getSnapshot().link], [null, true, "offline"]);
});

test("writes made during a flush are sent by the same trigger", async () => {
  const server = createServer();
  const { store } = await started(server);
  const first = store.create("items", task("one"));
  const second = store.create("items", task("two"));
  await Promise.all([first, second]);
  await store.sync();
  assert.equal(store.getSnapshot().pending, 0);
  assert.deepEqual(titles(store.getSnapshot().rows.items), ["one", "two"]);
});

test("a lost acknowledgement is replayed safely and the server's row comes back", async () => {
  const server = createServer();
  const real = server.as("a");
  let lost = false;
  const fetcher: typeof real = async (url, init) => {
    const response = await real(url, init);
    if (init.method === "POST" && lost) {
      lost = false;
      throw new TypeError("connection dropped after the server applied the request");
    }
    return response;
  };
  const persistence = memoryPersistence();
  const store = createStore({ persistence, api: createApi(fetcher) });
  await store.open();
  lost = true;
  const created = idOf(await store.create("items", task("lost reply")));
  await store.sync();
  const snap = store.getSnapshot();
  assert.deepEqual([snap.pending, snap.rejected.length, snap.link, server.rev], [0, 0, "online", 1]);
  assert.equal(posts(server).length, 2);
  assert.equal(snap.rows.items.find((row) => row.id === created)?.rev, 1);
  assert.equal((await persistence.load()).rows.items.length, 1);
});

test("an update aimed at a row the server does not have is parked with the server's reason", async () => {
  const server = createServer();
  const missing = "00000000-0000-4000-8000-0000000000bb";
  const persistence = memoryPersistence();
  await persistence.write({
    outbox: {
      put: [
        {
          id: missing,
          table: "items",
          op: "update",
          row_id: missing,
          patch: { note: "x", updated_at: "2026-10-06T00:00:00Z" },
          seq: 1,
          at: "2026-10-06T00:00:00Z",
        },
      ],
    },
  });
  const { store } = client(server, "b", persistence);
  await store.open();
  assert.deepEqual([store.getSnapshot().pending, store.getSnapshot().rejected.length], [0, 1]);
  assert.match(store.getSnapshot().rejected[0].rejected!.join(), /no such row/);
});

test("every POST carries a JSON content type and no origin header of its own", async () => {
  const server = createServer();
  const { store } = await started(server);
  idOf(await store.create("items", task("one")));
  await store.sync();
  const sent = posts(server);
  assert.equal(sent.length > 0, true);
  assert.deepEqual([...new Set(sent.map((request) => request.contentType))], ["application/json"]);
  assert.deepEqual([...new Set(server.seen.map((request) => request.origin))], [null]);
});

test("the fake server refuses what the worker refuses: no JSON type, cross-origin", async () => {
  const server = createServer();
  const call = server.as("a");
  const body = JSON.stringify({ mutations: [] });
  assert.equal((await call("/api/sync", { method: "POST", body })).status, 415);
  assert.equal((await call("/api/sync", { method: "POST", body, headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await call("/api/sync", { method: "POST", body, headers: { "content-type": "application/json", origin: "https://evil.example.test" } })).status, 403);
  assert.equal((await call("/api/sync", { method: "POST", body, headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" } })).status, 403);
  assert.equal((await call("/api/sync", { method: "POST", body, headers: { "content-type": "application/json" } })).status, 200);
});

test("two tabs on one database keep each other's outbox entries", async () => {
  const server = createServer();
  server.control.down = true;
  const persistence = memoryPersistence();
  const one = client(server, "a", persistence);
  const two = client(server, "a", persistence);
  await one.store.open();
  await two.store.open();
  idOf(await one.store.create("items", task("from tab one")));
  idOf(await two.store.create("items", task("from tab two")));
  assert.equal((await persistence.load()).outbox.length, 2);

  server.control.down = false;
  await one.store.sync();
  const left = (await persistence.load()).outbox;
  assert.deepEqual(left.map((entry) => entry.patch.title), ["from tab two"]);
  await two.store.sync();
  assert.equal((await persistence.load()).outbox.length, 0);
  assert.deepEqual(titles(two.store.getSnapshot().rows.items), ["from tab one", "from tab two"]);
});

test("a pull whose persist fails neither advances the cursor nor rejects", async () => {
  const server = createServer();
  const a = await started(server, "a");
  const b = client(server, "b");
  const real = b.persistence;
  let failing = false;
  const flaky = { ...real, write: async (write: Parameters<typeof real.write>[0]) => {
    if (failing && write.meta) throw new Error("quota");
    return real.write(write);
  } };
  const store = createStore({ persistence: flaky, api: createApi(server.as("b")) });
  await store.open();

  idOf(await a.store.create("items", task("first")));
  await a.store.sync();
  failing = true;
  await store.sync();
  assert.equal((await real.load()).meta.rev, server.rev - 1);

  failing = false;
  idOf(await a.store.create("items", task("second")));
  await a.store.sync();
  await store.sync();
  const reopened = client(server, "b", real);
  server.control.down = true;
  await reopened.store.open();
  assert.deepEqual(titles(reopened.store.getSnapshot().rows.items), ["first", "second"]);
});

test("a trigger landing as a cycle ends is never lost, whatever the timing", async () => {
  for (let ticks = 0; ticks < 12; ticks++) {
    const server = createServer();
    const { store } = await started(server);
    server.control.down = true;
    idOf(await store.create("items", task(`late ${ticks}`)));
    for (let tick = 0; tick < ticks; tick++) await Promise.resolve();
    server.control.down = false;
    await store.sync();
    assert.equal(store.getSnapshot().pending, 0, `after ${ticks} ticks`);
  }
});
