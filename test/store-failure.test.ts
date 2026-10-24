import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createApi } from "../src/store/api.ts";
import { memoryPersistence } from "../src/store/memory.ts";
import type { Persistence, Write } from "../src/store/persistence.ts";
import { createStore } from "../src/store/store.ts";
import { createServer } from "./store-server.ts";
import type { Server } from "./store-server.ts";
import { client, idOf, task, titles } from "./store-client.ts";

const flaky = (real: Persistence) => {
  const control = { failing: false, writes: [] as Write[] };
  const persistence: Persistence = {
    load: () => real.load(),
    reset: (expected, meta) => real.reset(expected, meta),
    adopt: (from) => real.adopt(from),
    write: async (write) => {
      if (control.failing) throw new Error("QuotaExceededError");
      control.writes.push(write);
      return real.write(write);
    },
  };
  return { control, persistence };
};

const started = async (server: Server) => {
  const memory = memoryPersistence();
  const { control, persistence } = flaky(memory);
  const store = createStore({ persistence, api: createApi(server.as("a")) });
  await store.open();
  await store.sync();
  return { store, memory, control };
};

const posts = (server: Server) => server.seen.filter((request) => request.method === "POST");

test("a failed write is reported, rolled back and shown as a storage problem, never as up to date", async () => {
  const server = createServer();
  const { store, memory, control } = await started(server);
  assert.equal(store.getSnapshot().storage, "ok");
  const before = store.getSnapshot().rows.items.length;

  control.failing = true;
  const result = await store.create("items", task("will not persist"));
  assert.deepEqual(result, { ok: false, errors: [], storage: true });
  const snap = store.getSnapshot();
  assert.deepEqual([snap.storage, snap.pending, snap.rows.items.length], ["failed", 0, before]);
  assert.equal((await memory.load()).outbox.length, 0);
  assert.equal(posts(server).length, 0);

  control.failing = false;
  idOf(await store.create("items", task("persists")));
  assert.equal(store.getSnapshot().storage, "ok");
  assert.deepEqual(titles(store.getSnapshot().rows.items), ["persists"]);
});

test("updates and deletes report a failed write the same way and leave the row as it was", async () => {
  const server = createServer();
  const { store, control } = await started(server);
  const id = idOf(await store.create("items", task("keep")));
  await store.sync();

  control.failing = true;
  assert.deepEqual(await store.update("items", id, { status: "done" }), { ok: false, errors: [], storage: true });
  assert.deepEqual(await store.remove("items", id), { ok: false, errors: [], storage: true });
  const row = store.getSnapshot().rows.items.find((item) => item.id === id);
  assert.deepEqual([row?.status, store.getSnapshot().pending], ["todo", 0]);
});

test("a failed write while a pull or a push result is stored is a storage problem, not an offline one", async () => {
  const server = createServer();
  const { store, control } = await started(server);
  idOf(await store.create("items", task("waits")));
  control.failing = true;
  await store.sync();
  const snap = store.getSnapshot();
  assert.deepEqual([snap.storage, snap.link, snap.pending], ["failed", "online", 1]);

  control.failing = false;
  await store.sync();
  assert.deepEqual([store.getSnapshot().storage, store.getSnapshot().pending], ["ok", 0]);
  assert.deepEqual(titles(store.getSnapshot().rows.items), ["waits"]);
});

test("a failed discard keeps the parked entry and says so", async () => {
  const server = createServer();
  const { store, memory, control } = await started(server);
  idOf(await store.create("budget_entries", { entry_type: "payment", title: "orphan", budget_id: "00000000-0000-4000-8000-0000000000aa", status: "due", amount: 1 }));
  await store.sync();
  const [parked] = store.getSnapshot().rejected;
  assert.equal(parked.patch.title, "orphan");

  control.failing = true;
  assert.deepEqual(await store.discard(parked.seq), { ok: false, errors: [], storage: true });
  assert.equal(store.getSnapshot().rejected.length, 1);
  assert.equal((await memory.load()).outbox.length, 1);

  control.failing = false;
  assert.equal((await store.discard(parked.seq)).ok, true);
  assert.equal(store.getSnapshot().rejected.length, 0);
});

test("removing a row that is already deleted queues nothing", async () => {
  const server = createServer();
  const { store, memory } = await started(server);
  const id = idOf(await store.create("items", task("twice")));
  idOf(await store.remove("items", id));
  const queued = (await memory.load()).outbox.length;
  assert.deepEqual(await store.remove("items", id), { ok: true, id });
  assert.equal((await memory.load()).outbox.length, queued);
  await store.sync();
  assert.equal(server.row("items", id)?.deleted_at !== null, true);
  const again = posts(server).length;
  assert.deepEqual(await store.remove("items", id), { ok: true, id });
  await store.sync();
  assert.equal(posts(server).length, again);
});

test("every request uses manual redirects and a 15 second abort signal", async () => {
  const timeouts: number[] = [];
  const real = AbortSignal.timeout.bind(AbortSignal);
  mock.method(AbortSignal, "timeout", (ms: number) => {
    timeouts.push(ms);
    return real(ms);
  });
  try {
    const server = createServer();
    const { store } = await started(server);
    idOf(await store.create("items", task("one")));
    await store.sync();
    assert.equal(server.seen.length > 2, true);
    assert.deepEqual([...new Set(server.seen.map((request) => request.redirect))], ["manual"]);
    assert.deepEqual([...new Set(server.seen.map((request) => request.signal))], [true]);
    assert.equal(timeouts.length, server.seen.length + server.asked.length);
    assert.deepEqual([...new Set(timeouts)], [15_000]);
  } finally {
    mock.restoreAll();
  }
});

test("a 403 is an expired login, like a 401 and a redirect", async () => {
  const server = createServer();
  const { store } = await started(server);
  server.control.session = "forbidden";
  idOf(await store.create("items", task("while forbidden")));
  await store.sync();
  assert.deepEqual([store.getSnapshot().link, store.getSnapshot().pending, store.getSnapshot().rejected.length], ["expired", 1, 0]);
});

test("a 404, a 429 or a 5xx from the edge is retry-later, not a login problem", async () => {
  for (const status of [404, 429, 500, 502, 503]) {
    const server = createServer();
    const { store } = await started(server);
    server.control.fail = [status, status, status, status];
    idOf(await store.create("items", task(`waits ${status}`)));
    await store.sync();
    assert.deepEqual([store.getSnapshot().link, store.getSnapshot().pending, store.getSnapshot().rejected.length], ["offline", 1, 0], String(status));
  }
});

test("a JSON 404 without a rejection body is retry-later; a JSON 404 rejection parks the mutation", async () => {
  const body = (status: number, payload: unknown) => async (_url: string, init: RequestInit) =>
    init.method === "POST" ? Response.json(payload, { status }) : Response.json({ rev: 0, epoch: "e", me: "a", changes: { items: [], budget_entries: [], settings: [] } });
  const persistence = memoryPersistence();
  const stub = createStore({ persistence, api: createApi(body(404, { error: "not_found" })) });
  await stub.open();
  idOf(await stub.create("items", task("one")));
  await stub.sync();
  assert.deepEqual([stub.getSnapshot().link, stub.getSnapshot().pending, stub.getSnapshot().rejected.length], ["offline", 1, 0]);

  const rejecting = createStore({ persistence, api: createApi(body(404, { status: 404, errors: ["row_id: no such row"], index: 0 })) });
  await rejecting.open();
  assert.deepEqual([rejecting.getSnapshot().pending, rejecting.getSnapshot().rejected.length], [0, 1]);
});

const stubbed = (reply: () => Response) => async (_url: string, init: RequestInit) =>
  init.method === "POST" ? reply() : Response.json({ rev: 0, epoch: "e", me: "a", changes: { items: [], budget_entries: [], settings: [] } });

const seeded = async (count: number) => {
  const persistence = memoryPersistence();
  const writer = createStore({ persistence, api: createApi(stubbed(() => new Response("down", { status: 503 }))) });
  await writer.open();
  for (let n = 1; n <= count; n++) idOf(await writer.create("items", task(`task ${n}`)));
  return persistence;
};

test("a rejection without an index parks the whole request at once, not one mutation per cycle", async () => {
  const persistence = await seeded(25);
  let requests = 0;
  const reject = stubbed(() => {
    requests += 1;
    return Response.json({ status: 400, errors: ["body: malformed"] }, { status: 400 });
  });
  const store = createStore({ persistence, api: createApi(reject) });
  await store.open();
  const snap = store.getSnapshot();
  assert.deepEqual([snap.pending, snap.rejected.length, requests], [0, 25, 2]);
  assert.equal(snap.rejected.every((entry) => entry.rejected?.[0] === "body: malformed"), true);
});

test("an index outside the request parks the whole request, an index inside parks that mutation only", async () => {
  for (const [index, parked] of [[99, ["task 1", "task 2", "task 3"]], [-1, ["task 1", "task 2", "task 3"]], [1.5, ["task 1", "task 2", "task 3"]], [1, ["task 2"]]] as const) {
    const persistence = await seeded(3);
    let first = true;
    const reply = stubbed(() => {
      if (!first) return new Response("down", { status: 503 });
      first = false;
      return Response.json({ status: 409, errors: ["budget_id: conflict"], index }, { status: 409 });
    });
    const store = createStore({ persistence, api: createApi(reply) });
    await store.open();
    const titlesOf = store.getSnapshot().rejected.map((entry) => String(entry.patch.title));
    assert.deepEqual(titlesOf.sort(), [...parked].sort(), `index ${index}`);
  }
});

test("a 5xx never parks a mutation, even when its JSON body looks like a rejection", async () => {
  const persistence = memoryPersistence();
  const busy = stubbed(() => Response.json({ status: 503, errors: ["busy"], index: 0 }, { status: 503 }));
  const store = createStore({ persistence, api: createApi(busy) });
  await store.open();
  idOf(await store.create("items", task("one")));
  await store.sync();
  assert.deepEqual([store.getSnapshot().link, store.getSnapshot().pending, store.getSnapshot().rejected.length], ["offline", 1, 0]);
});

test("the opaque redirect a browser returns for redirect: manual is an expired login", async () => {
  const opaque = { type: "opaqueredirect", status: 0, headers: new Headers(), json: async () => ({}) } as unknown as Response;
  const persistence = memoryPersistence();
  const store = createStore({ persistence, api: createApi(async () => opaque) });
  await store.open();
  assert.equal(store.getSnapshot().link, "expired");
  idOf(await store.create("items", task("one")));
  assert.deepEqual([store.getSnapshot().link, store.getSnapshot().pending], ["expired", 1]);
});
