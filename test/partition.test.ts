import { test } from "node:test";
import assert from "node:assert/strict";
import type { Side } from "../shared/api.ts";
import { createApi } from "../src/store/api.ts";
import type { Fetch } from "../src/store/api.ts";
import { memoryDisk, memoryPersistence } from "../src/store/memory.ts";
import { createSession, sideHint } from "../src/store/partition.ts";
import type { Disk, Persisted } from "../src/store/persistence.ts";
import type { Snapshot } from "../src/store/store.ts";
import { screenFor } from "../src/domain/status.ts";
import { client, idOf, task, titles } from "./store-client.ts";
import { createServer } from "./store-server.ts";
import { createWorkerServer } from "./store-worker.ts";

const MARK = (side: Side) => `Partner ${side.toUpperCase()} private routine`;

const secret = (side: Side) => ({ kind: "routine", title: MARK(side), who: side, data: { private: true } });

const leaks = (text: string, side: Side) => text.includes(MARK(side));

const everything = (snapshot: Snapshot) => JSON.stringify([snapshot.rows, snapshot.rejected]);

const watched = (tab: { subscribe(listener: () => void): () => void; getSnapshot(): Snapshot }) => {
  const seen: Snapshot[] = [tab.getSnapshot()];
  tab.subscribe(() => seen.push(tab.getSnapshot()));
  return seen;
};

type Source = { as(side: Side): Fetch };

const profile = async (server: Source, who: Side, { legacy, hint = null }: { legacy?: Persisted; hint?: Side | null } = {}) => {
  const state = { who, hint, down: false, hold: null as Promise<void> | null };
  const raw = await memoryDisk(legacy);
  const opened: Side[] = [];
  const disk: Disk = { ...raw, open: (side) => (opened.push(side), raw.open(side)) };
  const fetcher: Fetch = async (url, init) => {
    await state.hold;
    if (state.down) throw new TypeError("fetch failed");
    return server.as(state.who)(url, init);
  };
  const tab = (over: Partial<Disk> = {}) =>
    createSession({
      disk: { ...disk, ...over },
      hint: { get: () => state.hint, set: (side) => void (state.hint = side) },
      api: (side) => createApi(fetcher, side),
    });
  return { state, raw, opened, tab };
};

type Profile = Awaited<ReturnType<typeof profile>>;

const saved = (p: Profile, side: Side) => p.raw.open(side).load();

const work = async (p: Profile, side: Side) => {
  p.state.who = side;
  const tab = p.tab();
  await tab.open();
  idOf(await tab.create("items", task(`Shared by ${side}`)));
  const routine = idOf(await tab.create("items", secret(side)));
  idOf(await tab.create("items", { kind: "step", title: `${MARK(side)} step`, parent_id: routine }));
  await tab.sync();
  assert.equal(tab.getSnapshot().pending, 0);
  return tab;
};

const posts = (server: ReturnType<typeof createServer>) => server.seen.filter((request) => request.method === "POST");

test("a fresh browser asks the server for the side with a bare probe, then opens that side's partition only", async () => {
  const server = createServer();
  const p = await profile(server, "a");
  const tab = p.tab();
  assert.deepEqual(tab.getSnapshot(), { ready: false, me: null, rows: { items: [], budget_entries: [], settings: [] }, pending: 0, rejected: [], link: "offline", storage: "ok", notice: null });
  await tab.open();
  const snap = tab.getSnapshot();
  assert.deepEqual([snap.ready, snap.me, snap.link], [true, "a", "online"]);
  assert.deepEqual(p.opened, ["a"]);
  assert.equal(p.state.hint, "a");
  assert.deepEqual(server.seen.slice(0, 2).map((request) => [request.since, request.side]), [[Number.MAX_SAFE_INTEGER, null], [0, "a"]]);
  assert.deepEqual(await saved(p, "b"), { rows: { items: [], budget_entries: [], settings: [] }, outbox: [], meta: { rev: 0, me: null, epoch: null, generation: null, adopted: null } });
});

test("with no hint and no network nothing is opened, and the app shows its connect screen", async () => {
  const server = createServer();
  const p = await profile(server, "a");
  p.state.down = true;
  const tab = p.tab();
  const seen = watched(tab);
  await tab.open();
  assert.deepEqual(seen.map((snap) => snap.ready), [false, true]);
  const snap = tab.getSnapshot();
  assert.deepEqual([snap.ready, snap.me, snap.link, snap.pending], [true, null, "offline", 0]);
  assert.deepEqual(snap.rows, { items: [], budget_entries: [], settings: [] });
  assert.equal(screenFor(snap), "connect");
  assert.deepEqual(p.opened, []);
  assert.equal(p.state.hint, null);
  p.state.down = false;
  await tab.sync();
  assert.deepEqual([tab.getSnapshot().me, p.opened], ["a", ["a"]]);
});

test("with no hint and an expired login nothing is opened and the app asks to sign in", async () => {
  const server = createServer();
  const p = await profile(server, "a");
  server.control.session = "unauthorized";
  const tab = p.tab();
  await tab.open();
  assert.deepEqual([tab.getSnapshot().link, screenFor(tab.getSnapshot())], ["expired", "signin"]);
  assert.deepEqual(p.opened, []);
  server.control.session = "ok";
  await tab.sync();
  assert.equal(tab.getSnapshot().me, "a");
});

test("a malformed answer without a side opens nothing", async () => {
  const p = await profile({ as: () => async () => Response.json({ rev: 1, epoch: "e", changes: { items: [], budget_entries: [], settings: [] } }) }, "a");
  const tab = p.tab();
  await tab.open();
  assert.deepEqual([tab.getSnapshot().me, tab.getSnapshot().link, p.opened], [null, "offline", []]);
});

test("a hinted start shows no rows until the server has confirmed the side", async () => {
  const server = createServer();
  const p = await profile(server, "a");
  await work(p, "a");
  assert.equal(p.state.hint, "a");
  p.opened.length = 0;
  let release!: () => void;
  p.state.hold = new Promise<void>((resolve) => (release = resolve));
  const tab = p.tab();
  const seen = watched(tab);
  const opening = tab.open();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual([tab.getSnapshot().ready, tab.getSnapshot().rows.items, p.opened], [false, [], []]);
  release();
  await opening;
  assert.deepEqual(seen.filter((snap) => snap.rows.items.length > 0 && !snap.ready), []);
  assert.deepEqual(titles(tab.getSnapshot().rows.items), ["Shared by a", MARK("a"), `${MARK("a")} step`].sort());
});

test("an offline cold start opens the hint partition: the device's own last state, with its unsent changes", async () => {
  const server = createServer();
  const p = await profile(server, "a");
  const first = await work(p, "a");
  const sent = posts(server).length;
  p.state.down = true;
  idOf(await first.create("items", task("Queued offline")));
  p.opened.length = 0;
  const cold = p.tab();
  await cold.open();
  const snap = cold.getSnapshot();
  assert.deepEqual([snap.me, snap.link, snap.pending], ["a", "offline", 1]);
  assert.deepEqual(titles(snap.rows.items), ["Queued offline", "Shared by a", MARK("a"), `${MARK("a")} step`].sort());
  await cold.sync();
  assert.deepEqual([p.opened, cold.getSnapshot().link], [["a"], "offline"]);
  p.state.down = false;
  idOf(await cold.create("items", task("Typed on the cold start")));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual([posts(server).length, cold.getSnapshot().pending], [sent, 2]);
  await cold.sync();
  assert.deepEqual(p.opened, ["a"]);
  assert.deepEqual([cold.getSnapshot().link, cold.getSnapshot().pending], ["online", 0]);
  assert.equal(server.rows("items").filter((row) => row.title === "Typed on the cold start" || row.title === "Queued offline").length, 2);
});

test("Partner B on Partner A's profile never sees Partner A's rows, on first paint or after", async () => {
  const server = createServer();
  const p = await profile(server, "a");
  await work(p, "a");
  const sent = posts(server).length;
  const before = await saved(p, "a");
  p.state.who = "b";
  const tab = p.tab();
  const seen = watched(tab);
  await tab.open();
  assert.ok(seen.length > 1);
  for (const snap of seen) assert.equal(leaks(everything(snap), "a"), false);
  const snap = tab.getSnapshot();
  assert.deepEqual([snap.me, p.state.hint, titles(snap.rows.items)], ["b", "b", ["Shared by a"]]);
  assert.equal(leaks(JSON.stringify(await saved(p, "b")), "a"), false);
  assert.deepEqual(await saved(p, "a"), before);
  assert.equal(posts(server).length, sent);
});

test("a device that opened Partner A offline switches to Partner B's partition at the first answer, and keeps A's unsent change in A's", async () => {
  const server = createServer();
  const p = await profile(server, "a");
  const first = await work(p, "a");
  const sent = posts(server).length;
  p.state.down = true;
  idOf(await first.create("items", task("A queued")));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const tab = p.tab({ open: (side) => (side === "b" ? { ...p.raw.open(side), load: async () => (await gate, p.raw.open(side).load()) } : p.raw.open(side)) });
  await tab.open();
  assert.equal(leaks(everything(tab.getSnapshot()), "a"), true);
  p.state.who = "b";
  p.state.down = false;
  const seen = watched(tab);
  const switching = tab.sync();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual([seen.length > 1, leaks(everything(seen.at(-1)!), "a"), seen.at(-1)!.ready], [true, false, false]);
  release();
  await switching;
  for (const snap of seen.slice(1)) assert.equal(leaks(everything(snap), "a"), false);
  assert.deepEqual([tab.getSnapshot().me, tab.getSnapshot().pending, p.state.hint], ["b", 0, "b"]);
  assert.deepEqual(titles(tab.getSnapshot().rows.items), ["Shared by a"]);
  assert.equal(posts(server).length, sent);
  assert.equal((await saved(p, "a")).outbox.length, 1);
  p.state.who = "a";
  const back = p.tab();
  await back.open();
  assert.deepEqual([back.getSnapshot().pending, server.rows("items").filter((row) => row.title === "A queued").length], [0, 1]);
});

test("Partner A's data returns intact when A signs in again: no duplicates, and nobody's unsent changes are lost", async () => {
  const server = createServer();
  const p = await profile(server, "a");
  const a = await work(p, "a");
  p.state.down = true;
  idOf(await a.create("items", task("A unsent")));
  p.state.down = false;
  const b = await work(p, "b");
  p.state.down = true;
  idOf(await b.create("items", task("B unsent")));
  assert.equal((await saved(p, "a")).outbox.length, 1);
  assert.equal((await saved(p, "b")).outbox.length, 1);
  p.state.down = false;
  p.state.who = "a";
  const back = p.tab();
  await back.open();
  const snap = back.getSnapshot();
  assert.deepEqual(titles(snap.rows.items), ["A unsent", "Shared by a", "Shared by b", MARK("a"), `${MARK("a")} step`].sort());
  assert.equal(snap.rows.items.filter((row) => row.title === MARK("a")).length, 1);
  assert.equal(leaks(JSON.stringify(await saved(p, "a")), "b"), false);
  assert.equal((await saved(p, "b")).outbox.length, 1);
  p.state.who = "b";
  const there = p.tab();
  await there.open();
  assert.equal(server.rows("items").filter((row) => row.title === "B unsent").length, 1);
  assert.equal(server.rows("items").filter((row) => row.title === "A unsent").length, 1);
});

test("a tab loaded as Partner A cannot write under Partner B: it stops, shows the mismatch and keeps its partition", async () => {
  const server = createWorkerServer();
  const p = await profile(server, "a");
  const tab1 = p.tab();
  await tab1.open();
  p.state.down = true;
  idOf(await tab1.create("items", secret("a")));
  idOf(await tab1.create("items", task("Public by a")));
  assert.equal(tab1.getSnapshot().pending, 2);
  const before = await saved(p, "a");
  p.state.down = false;
  p.state.who = "b";
  const tab2 = p.tab();
  await tab2.open();
  assert.equal(tab2.getSnapshot().me, "b");
  await tab1.sync();
  const snap = tab1.getSnapshot();
  assert.deepEqual([snap.link, snap.pending, snap.rejected, snap.me], ["mismatch", 2, [], "a"]);
  assert.deepEqual(server.sqlite.prepare("SELECT title FROM items").all(), []);
  assert.deepEqual(await saved(p, "a"), before);
  const calls = server.calls.length;
  await tab1.sync();
  idOf(await tab1.create("items", task("Typed after the mismatch")));
  assert.equal(server.calls.length, calls);
  assert.equal((await saved(p, "a")).outbox.length, 3);
  assert.deepEqual([tab2.getSnapshot().pending, tab2.getSnapshot().rejected, tab2.getSnapshot().notice], [0, [], null]);
  const reload = p.tab();
  await reload.open();
  assert.deepEqual([reload.getSnapshot().me, reload.getSnapshot().link], ["b", "online"]);
  assert.deepEqual(reload.getSnapshot().rows.items, []);
});

test("a mismatch pushed to a tab does not touch the other partition or park anything", async () => {
  const server = createServer();
  const p = await profile(server, "a");
  const tab = await work(p, "a");
  idOf(await tab.create("items", task("Before")));
  p.state.down = true;
  idOf(await tab.create("items", task("Unsent")));
  p.state.down = false;
  p.state.who = "b";
  await tab.sync();
  assert.deepEqual([tab.getSnapshot().link, tab.getSnapshot().rejected.length, server.mismatched.length], ["mismatch", 0, 1]);
  assert.equal(server.rows("items").filter((row) => row.title === "Unsent").length, 0);
  assert.deepEqual(await saved(p, "b"), { rows: { items: [], budget_entries: [], settings: [] }, outbox: [], meta: { rev: 0, me: null, epoch: null, generation: null, adopted: null } });
});

test("pending counts only the open partition", async () => {
  const server = createServer();
  const p = await profile(server, "a");
  const a = await work(p, "a");
  p.state.down = true;
  idOf(await a.create("items", secret("a")));
  assert.equal(a.getSnapshot().pending, 1);
  p.state.down = false;
  p.state.who = "b";
  const b = p.tab();
  await b.open();
  assert.deepEqual([b.getSnapshot().me, b.getSnapshot().pending], ["b", 0]);
  idOf(await b.create("items", task("B own")));
  await b.sync();
  assert.equal(b.getSnapshot().pending, 0);
  assert.equal((await saved(p, "a")).outbox.length, 1);
});

test("a rejection parks only the entry of the open side and never carries another side's data", async () => {
  const server = createWorkerServer();
  const p = await profile(server, "a");
  const a = p.tab();
  await a.open();
  const routine = idOf(await a.create("items", secret("a")));
  idOf(await a.create("items", { kind: "step", title: `${MARK("a")} step`, parent_id: routine }));
  await a.sync();
  assert.equal(a.getSnapshot().pending, 0);
  p.state.who = "b";
  const b = p.tab();
  await b.open();
  idOf(await b.many([{ op: "create", table: "items", id: routine, draft: { kind: "task", title: "B takes the hidden id", status: "todo" } }]));
  await b.sync();
  const snap = b.getSnapshot();
  assert.deepEqual(snap.rejected.map((entry) => entry.patch.title), ["B takes the hidden id"]);
  assert.deepEqual(snap.rejected[0].rejected, ["row_id: no such row"]);
  assert.equal(leaks(JSON.stringify([everything(snap), await saved(p, "b")]), "a"), false);
  assert.equal((await saved(p, "a")).outbox.length, 0);
});

test("a parent that does not exist for the open side parks only that side's own step", async () => {
  const server = createWorkerServer();
  const p = await profile(server, "a");
  const a = p.tab();
  await a.open();
  const routine = idOf(await a.create("items", secret("a")));
  await a.sync();
  p.state.who = "b";
  const b = p.tab();
  await b.open();
  idOf(await b.many([{ op: "create", table: "items", id: crypto.randomUUID(), draft: { kind: "step", title: "B step", parent_id: routine } }]));
  await b.sync();
  const snap = b.getSnapshot();
  assert.deepEqual(snap.rejected.map((entry) => [entry.patch.title, entry.rejected]), [["B step", ["parent_id: must point at a live items row"]]]);
  assert.equal(leaks(JSON.stringify([everything(snap), await saved(p, "b")]), "a"), false);
});

const legacyOf = async (side: Side | null, build: (store: ReturnType<typeof client>["store"], server: ReturnType<typeof createServer>) => Promise<void>) => {
  const server = createServer();
  const old = memoryPersistence();
  const phone = client(server, side ?? "a", old);
  server.control.down = side === null;
  await phone.store.open();
  await build(phone.store, server);
  server.control.down = false;
  return { server, data: await old.load() };
};

const adopted = async (p: Profile) => (await (await p.raw.legacy())!.load()).meta.adopted;

test("an existing user's database is adopted by the side the server confirms: same rows, same unsent changes, original kept", async () => {
  const { server, data } = await legacyOf("a", async (store, server) => {
    idOf(await store.create("items", task("Old task")));
    await store.sync();
    server.control.down = true;
    idOf(await store.create("items", task("Old unsent")));
    server.control.down = false;
  });
  const p = await profile(server, "a", { legacy: data });
  const tab = p.tab();
  await tab.open();
  assert.equal(p.state.hint, "a");
  assert.equal(await adopted(p), "a");
  assert.deepEqual(titles(tab.getSnapshot().rows.items), ["Old task", "Old unsent"]);
  assert.equal(tab.getSnapshot().pending, 0);
  assert.equal(server.rows("items").filter((row) => row.title === "Old unsent").length, 1);
  const original = await (await p.raw.legacy())!.load();
  assert.deepEqual({ ...original, meta: { ...original.meta, adopted: null } }, data);
  const again = p.tab();
  await again.open();
  assert.equal(again.getSnapshot().rows.items.filter((row) => row.title === "Old task").length, 1);
});

test("a database that last belonged to the other side is not adopted until that side signs in", async () => {
  const { server, data } = await legacyOf("b", async (store) => {
    idOf(await store.create("items", task("Old task")));
    await store.sync();
  });
  const p = await profile(server, "a", { legacy: data });
  const a = p.tab();
  await a.open();
  assert.equal(await adopted(p), null);
  assert.deepEqual((await saved(p, "a")).outbox, []);
  p.state.who = "b";
  const b = p.tab();
  await b.open();
  assert.equal(await adopted(p), "b");
  assert.equal((await saved(p, "b")).meta.me, "b");
});

test("a database no one owns is adopted once, by the first side that confirms", async () => {
  const { server, data } = await legacyOf(null, async (store) => {
    idOf(await store.create("items", task("Offline draft")));
  });
  const p = await profile(server, "a", { legacy: data });
  await p.tab().open();
  assert.equal(await adopted(p), "a");
  p.state.who = "b";
  await p.tab().open();
  assert.deepEqual((await saved(p, "b")).outbox, []);
  assert.equal(server.rows("items").filter((row) => row.title === "Offline draft").length, 1);
});

test("the first offline start after an update opens nothing and leaves the old database alone", async () => {
  const { server, data } = await legacyOf("a", async (store) => {
    idOf(await store.create("items", task("Old task")));
    await store.sync();
  });
  const p = await profile(server, "a", { legacy: data });
  p.state.down = true;
  const tab = p.tab();
  await tab.open();
  assert.deepEqual([tab.getSnapshot().me, p.opened, p.state.hint, await adopted(p)], [null, [], null, null]);
  assert.deepEqual(await (await p.raw.legacy())!.load(), data);
  p.state.down = false;
  await tab.sync();
  assert.deepEqual([tab.getSnapshot().me, await adopted(p), titles(tab.getSnapshot().rows.items)], ["a", "a", ["Old task"]]);
});

test("two tabs upgrading at once adopt the old database once and never replay what the first tab already sent", async () => {
  const { server, data } = await legacyOf("a", async (store, server) => {
    idOf(await store.create("items", task("Old task")));
    await store.sync();
    server.control.down = true;
    idOf(await store.create("items", task("Old unsent")));
    server.control.down = false;
  });
  const p = await profile(server, "a", { legacy: data });
  const before = posts(server).reduce((total, request) => total + request.mutations, 0);
  let release!: () => void;
  const late = new Promise<void>((resolve) => (release = resolve));
  const slow = async () => {
    const old = (await p.raw.legacy())!;
    return { ...old, load: async () => { const read = await old.load(); await late; return read; } };
  };
  const second = p.tab({ legacy: slow });
  const waiting = second.open();
  const first = p.tab();
  await first.open();
  assert.equal(first.getSnapshot().pending, 0);
  idOf(await first.create("items", task("After the upgrade")));
  await first.sync();
  release();
  await waiting;
  const snap = second.getSnapshot();
  assert.deepEqual(titles(snap.rows.items), ["After the upgrade", "Old task", "Old unsent"]);
  assert.equal(snap.pending, 0);
  assert.equal(server.rows("items").length, 3);
  assert.deepEqual((await saved(p, "a")).outbox, []);
  assert.equal(posts(server).reduce((total, request) => total + request.mutations, 0) - before, 2);
});

test("a copy that fails leaves the old database unmarked and the next start tries again", async () => {
  const { server, data } = await legacyOf("a", async (store) => {
    idOf(await store.create("items", task("Old task")));
    await store.sync();
  });
  const p = await profile(server, "a", { legacy: data });
  const broken: Partial<Disk> = { open: (side) => ({ ...p.raw.open(side), adopt: async () => { throw new Error("QuotaExceededError"); } }) };
  await assert.rejects(p.tab(broken).open(), /QuotaExceededError/);
  assert.deepEqual([p.state.hint, await adopted(p), (await saved(p, "a")).rows.items], [null, null, []]);
  assert.deepEqual(await (await p.raw.legacy())!.load(), data);
  const retry = p.tab();
  await retry.open();
  assert.deepEqual([await adopted(p), titles(retry.getSnapshot().rows.items)], ["a", ["Old task"]]);
});

test("a confirmed partition syncs on its own, without asking for the side again", async () => {
  const server = createServer();
  const p = await profile(server, "a");
  const tab = await work(p, "a");
  const before = server.seen.length;
  await tab.sync();
  assert.ok(server.seen.length > before);
  assert.deepEqual(server.seen.slice(before).filter((request) => request.side === null), []);
});

test("writes with no partition open are refused and nothing is sent", async () => {
  const server = createServer();
  const p = await profile(server, "a");
  p.state.down = true;
  const tab = p.tab();
  await tab.open();
  const written = await tab.create("items", task("Nowhere"));
  assert.deepEqual(written, { ok: false, errors: [], storage: true });
  assert.equal(tab.dismissNotice(), undefined);
  assert.deepEqual([server.seen.length, p.opened], [0, []]);
});

test("the side hint keeps only a or b and never throws", () => {
  const kept = new Map<string, string>();
  const storage = { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value) };
  const hint = sideHint(storage);
  assert.equal(hint.get(), null);
  hint.set("b");
  assert.equal(hint.get(), "b");
  hint.set("a");
  assert.equal(hint.get(), "a");
  for (const junk of ["", "c", "A", "ab", "null"]) {
    kept.set([...kept.keys()][0], junk);
    assert.equal(hint.get(), null, junk);
  }
  const broken = sideHint({
    getItem: () => {
      throw new Error("SecurityError");
    },
    setItem: () => {
      throw new Error("QuotaExceededError");
    },
  });
  assert.equal(broken.get(), null);
  assert.doesNotThrow(() => broken.set("a"));
});

test("a start that the server has not confirmed never adopts the old database", async () => {
  const { server, data } = await legacyOf("a", async (store) => {
    idOf(await store.create("items", task("Old task")));
    await store.sync();
  });
  const p = await profile(server, "a", { legacy: data, hint: "a" });
  p.state.down = true;
  const tab = p.tab();
  await tab.open();
  assert.deepEqual([await adopted(p), (await saved(p, "a")).rows.items, p.state.hint], [null, [], "a"]);
  assert.deepEqual(await (await p.raw.legacy())!.load(), data);
});

test("the old database is marked before the partition opens", async () => {
  const { server, data } = await legacyOf("a", async (store) => {
    idOf(await store.create("items", task("Old task")));
    await store.sync();
  });
  const p = await profile(server, "a", { legacy: data });
  const slow = async () => {
    const old = (await p.raw.legacy())!;
    return { ...old, write: async (write: Parameters<typeof old.write>[0]) => (await new Promise((resolve) => setTimeout(resolve, 30)), old.write(write)) };
  };
  await p.tab({ legacy: slow }).open();
  assert.equal(await adopted(p), "a");
});

test("a listener that unsubscribes is not called again", async () => {
  const server = createServer();
  const p = await profile(server, "a");
  const tab = p.tab();
  let calls = 0;
  const off = tab.subscribe(() => calls++);
  await tab.open();
  const opened = calls;
  assert.ok(opened > 0);
  idOf(await tab.create("items", task("While listening")));
  const during = calls;
  assert.ok(during > opened);
  off();
  idOf(await tab.create("items", task("After")));
  await tab.sync();
  assert.equal(calls, during);
});
