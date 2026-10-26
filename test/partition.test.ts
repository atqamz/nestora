import { mock, test } from "node:test";
import assert from "node:assert/strict";
import type { Side } from "../shared/api.ts";
import { createApi } from "../src/store/api.ts";
import type { Fetch } from "../src/store/api.ts";
import { memoryDisk, memoryPersistence } from "../src/store/memory.ts";
import { createSession, sideHint } from "../src/store/partition.ts";
import { timerStore } from "../src/store/timers.ts";
import type { Disk, Persisted } from "../src/store/persistence.ts";
import { paused } from "../src/store/store.ts";
import type { Snapshot } from "../src/store/store.ts";
import { failureOf } from "../src/ui/failure.ts";
import { text } from "../src/ui/text.ts";
import { screenFor } from "../src/domain/status.ts";
import { begin, timerKey } from "../src/domain/routine-timer.ts";
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

type Timer = { ms: number; run: () => Promise<unknown>; live: boolean };

const profile = async (server: Source, who: Side, { legacy, hint = null }: { legacy?: Persisted; hint?: Side | null } = {}) => {
  const state = { who, hint, down: false, hang: false, calls: 0, hold: null as Promise<void> | null };
  const raw = await memoryDisk(legacy);
  const opened: Side[] = [];
  const disk: Disk = { ...raw, open: (side) => (opened.push(side), raw.open(side)) };
  const fetcher: Fetch = async (url, init) => {
    state.calls++;
    await state.hold;
    if (state.hang) {
      await new Promise<void>((resolve) => (init.signal?.aborted ? resolve() : init.signal?.addEventListener("abort", () => resolve())));
      throw new TypeError("aborted");
    }
    if (state.down) throw new TypeError("fetch failed");
    return server.as(state.who)(url, init);
  };
  const timers: Timer[] = [];
  const stored = new Map<string, string>();
  const storage = {
    get length() {
      return stored.size;
    },
    key: (at: number) => [...stored.keys()][at] ?? null,
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
  };
  const held = timerStore(storage);
  const later = (run: () => Promise<unknown>, ms: number) => {
    const timer = { ms, run, live: true };
    timers.push(timer);
    return () => void (timer.live = false);
  };
  const tab = (over: Partial<Disk> = {}, schedule: typeof later | null = later) =>
    createSession({
      disk: { ...disk, ...over },
      hint: { get: () => state.hint, set: (side) => void (state.hint = side) },
      api: (side) => createApi(fetcher, side),
      purge: held.purge,
      ...(schedule ? { later: schedule } : {}),
    });
  const due = () => timers.filter((timer) => timer.live).map((timer) => timer.ms);
  const fire = async () => {
    const timer = timers.findLast((entry) => entry.live);
    assert.ok(timer, "no retry is waiting");
    timer.live = false;
    await timer.run();
  };
  return { state, raw, opened, tab, timers, due, fire, held, stored };
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
  assert.deepEqual(tab.getSnapshot(), { ready: false, me: null, rows: { items: [], budget_entries: [], settings: [] }, pending: 0, rejected: [], link: "offline", storage: "ok", notice: null, paused: true, dated: false });
  await tab.open();
  const snap = tab.getSnapshot();
  assert.deepEqual([snap.ready, snap.me, snap.link, snap.paused], [true, "a", "online", false]);
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
  const kept = await saved(p, "a");
  assert.deepEqual(await cold.create("items", task("Typed on the cold start")), paused);
  assert.deepEqual(await saved(p, "a"), kept);
  p.state.down = false;
  await cold.sync();
  assert.deepEqual(p.opened, ["a"]);
  assert.deepEqual([cold.getSnapshot().link, cold.getSnapshot().pending], ["online", 0]);
  assert.deepEqual(server.rows("items").filter((row) => row.title === "Typed on the cold start"), []);
  assert.equal(server.rows("items").filter((row) => row.title === "Queued offline").length, 1);
  idOf(await cold.create("items", task("Typed after the answer")));
  await cold.sync();
  assert.equal(server.rows("items").filter((row) => row.title === "Typed after the answer").length, 1);
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
  assert.deepEqual(snap.rows, { items: [], budget_entries: [], settings: [] });
  assert.equal(leaks(JSON.stringify(snap), "a"), false);
  assert.deepEqual(server.sqlite.prepare("SELECT title FROM items").all(), []);
  assert.deepEqual(await saved(p, "a"), before);
  const calls = server.calls.length;
  await tab1.sync();
  const refused = await everyWrite(tab1, crypto.randomUUID());
  assert.deepEqual(refused, refused.map(() => paused));
  assert.equal(server.calls.length, calls);
  assert.equal(JSON.stringify(await saved(p, "a")), JSON.stringify(before));
  assert.equal(tab1.getSnapshot().pending, 2);
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
  assert.deepEqual(written, paused);
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

const nothing = { items: [], budget_entries: [], settings: [] };

const strand = async (server: Source, who: Side) => {
  const p = await profile(server, "a");
  await work(p, "a");
  p.state.who = who;
  p.state.down = true;
  const tab = p.tab();
  await tab.open();
  return { p, tab };
};

const everyWrite = async (tab: ReturnType<Profile["tab"]>, parent: string) => [
  await tab.create("items", task("B shared")),
  await tab.create("items", secret("b")),
  await tab.update("items", parent, { title: "Renamed" }),
  await tab.remove("items", parent),
  await tab.many([{ op: "create", table: "items", id: crypto.randomUUID(), draft: task("B many") }]),
  await tab.setSetting("timezone", "Asia/Jakarta"),
  await tab.discard(1),
];

test("an unconfirmed start is read-only: every write is refused with the paused notice and the partition is byte-identical", async () => {
  const server = createWorkerServer();
  const { p, tab } = await strand(server, "b");
  assert.deepEqual([tab.getSnapshot().me, tab.getSnapshot().paused], ["a", true]);
  const parent = tab.getSnapshot().rows.items[0].id;
  const kept = JSON.stringify(await saved(p, "a"));
  const calls = server.calls.length;
  const refused = await everyWrite(tab, parent);
  assert.deepEqual(refused, refused.map(() => paused));
  assert.deepEqual(failureOf(refused[0]), [text.paused]);
  assert.equal(text.paused, "Sign-in not confirmed yet. Changes are paused. Try again when you are back online.");
  assert.equal(JSON.stringify(await saved(p, "a")), kept);
  assert.equal(JSON.stringify(await saved(p, "b")), JSON.stringify(await p.raw.open("b").load()));
  assert.deepEqual([tab.getSnapshot().pending, server.calls.length], [0, calls]);
  assert.deepEqual((await saved(p, "b")).outbox, []);
});

test("the probe that then names the other side opens that partition, and the writes of that person go out as that person", async () => {
  const server = createWorkerServer();
  const { p, tab } = await strand(server, "b");
  const parent = tab.getSnapshot().rows.items[0].id;
  const kept = JSON.stringify(await saved(p, "a"));
  assert.ok((await everyWrite(tab, parent)).every((written) => !written.ok));
  p.state.down = false;
  await p.fire();
  assert.deepEqual([tab.getSnapshot().me, tab.getSnapshot().link, p.state.hint, p.due()], ["b", "online", "b", []]);
  assert.equal(leaks(everything(tab.getSnapshot()), "a"), false);
  idOf(await tab.create("items", task("B shared")));
  idOf(await tab.create("items", secret("b")));
  await tab.sync();
  assert.equal(tab.getSnapshot().pending, 0);
  assert.deepEqual(
    server.sqlite.prepare("SELECT title, updated_by FROM items WHERE title LIKE 'B %' OR title LIKE 'Partner B%'").all().map((row) => [row.title, row.updated_by]).sort(),
    [["B shared", "b"], [MARK("b"), "b"]],
  );
  assert.equal(JSON.stringify(await saved(p, "a")), kept);
  p.state.who = "a";
  const back = p.tab();
  await back.open();
  const snap = back.getSnapshot();
  assert.deepEqual([snap.pending, snap.rejected, leaks(everything(snap), "b")], [0, [], false]);
  assert.deepEqual(server.sqlite.prepare(`SELECT title FROM items WHERE updated_by = 'a' AND title IN ('B shared', '${MARK("b")}')`).all(), []);
});

test("the probe that confirms the same side lifts the pause with no reload", async () => {
  const server = createWorkerServer();
  const { p, tab } = await strand(server, "a");
  assert.deepEqual(await tab.create("items", task("Too early")), paused);
  p.state.down = false;
  await p.fire();
  assert.deepEqual([tab.getSnapshot().link, tab.getSnapshot().paused, p.due()], ["online", false, []]);
  idOf(await tab.create("items", task("In time")));
  await tab.sync();
  assert.deepEqual(server.sqlite.prepare("SELECT title, updated_by FROM items WHERE title IN ('In time', 'Too early')").all().map((row) => [row.title, row.updated_by]), [["In time", "a"]]);
});

test("a write attempted while the probe answer is in flight is refused, and the next one is accepted once the same side is confirmed", async () => {
  const server = createWorkerServer();
  const { p, tab } = await strand(server, "a");
  p.state.down = false;
  let release!: () => void;
  p.state.hold = new Promise<void>((resolve) => (release = resolve));
  const probing = tab.sync();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const kept = JSON.stringify(await saved(p, "a"));
  assert.deepEqual(await tab.create("items", task("In flight")), paused);
  release();
  await probing;
  assert.equal(JSON.stringify(await saved(p, "a")), kept);
  idOf(await tab.create("items", task("After the answer")));
  await tab.sync();
  assert.deepEqual(server.sqlite.prepare("SELECT title FROM items WHERE title LIKE '%flight' OR title LIKE 'After%'").all().map((row) => row.title), ["After the answer"]);
});

test("a write attempted while the probe answer names the other side is refused, and lands in that side's partition afterwards", async () => {
  const server = createWorkerServer();
  const { p, tab } = await strand(server, "b");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const cold = p.tab({ open: (side) => (side === "b" ? { ...p.raw.open(side), load: async () => (await gate, p.raw.open(side).load()) } : p.raw.open(side)) });
  await cold.open();
  p.state.down = false;
  const kept = JSON.stringify(await saved(p, "a"));
  const switching = cold.sync();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(await cold.create("items", secret("b")), paused);
  release();
  await switching;
  assert.equal(JSON.stringify(await saved(p, "a")), kept);
  assert.deepEqual([cold.getSnapshot().me, cold.getSnapshot().pending], ["b", 0]);
  idOf(await cold.create("items", secret("b")));
  assert.deepEqual([(await saved(p, "a")).outbox.length, (await saved(p, "b")).outbox.length], [0, 1]);
  assert.equal(tab.getSnapshot().me, "a");
});

test("while unconfirmed the probe is retried after 5 s, 15 s, 60 s and then every 60 s, and stops once the side is confirmed", async () => {
  const server = createServer();
  const { p, tab } = await strand(server, "a");
  assert.deepEqual(p.due(), [5_000]);
  const delays: number[] = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    delays.push(...p.due());
    await p.fire();
  }
  assert.deepEqual(delays, [5_000, 15_000, 60_000, 60_000, 60_000]);
  assert.deepEqual([tab.getSnapshot().link, p.due()], ["offline", [60_000]]);
  const asked = server.seen.length;
  p.state.down = false;
  await p.fire();
  assert.deepEqual([tab.getSnapshot().link, p.due()], ["online", []]);
  assert.ok(server.seen.length > asked);
  const timers = p.timers.length;
  await tab.sync();
  assert.equal(p.timers.length, timers);
});

test("a start with no hint keeps asking for the side on the same back-off", async () => {
  const server = createServer();
  const p = await profile(server, "a");
  p.state.down = true;
  const tab = p.tab();
  await tab.open();
  assert.deepEqual(p.due(), [5_000]);
  await p.fire();
  assert.deepEqual(p.due(), [15_000]);
  p.state.down = false;
  await p.fire();
  assert.deepEqual([tab.getSnapshot().me, p.due()], ["a", []]);
});

test("online and visibility events probe at once while unconfirmed, and a probe already in flight is shared", async () => {
  const server = createServer();
  const { p, tab } = await strand(server, "a");
  const asked = server.seen.length;
  p.state.down = false;
  await Promise.all([tab.sync(), tab.sync()]);
  assert.equal(server.seen.slice(asked).filter((request) => request.side === null).length, 1);
  assert.deepEqual([tab.getSnapshot().link, p.due()], ["online", []]);
  assert.ok(server.seen.length > asked);
});

test("an expired login with a hint shows the log-in path, not offline, and stays read-only", async () => {
  for (const session of ["unauthorized", "forbidden", "redirect", "html"] as const) {
    const server = createServer();
    const p = await profile(server, "a");
    await work(p, "a");
    server.control.session = session;
    const tab = p.tab();
    await tab.open();
    const snap = tab.getSnapshot();
    assert.deepEqual([snap.link, snap.me, screenFor(snap)], ["expired", "a", "app"], session);
    assert.deepEqual(await tab.create("items", task("Typed")), paused, session);
    await tab.sync();
    assert.equal(tab.getSnapshot().link, "expired", session);
    p.state.down = true;
    await p.fire();
    assert.equal(tab.getSnapshot().link, "offline", session);
    p.state.down = false;
    server.control.session = "ok";
    await p.fire();
    assert.deepEqual([tab.getSnapshot().link, p.due()], ["online", []], session);
    idOf(await tab.create("items", task("Typed")));
  }
});

test("a tab in mismatch renders no rows and no parked entries, and keeps them on disk", async () => {
  const server = createWorkerServer();
  const p = await profile(server, "a");
  const tab = p.tab();
  await tab.open();
  idOf(await tab.create("items", secret("a")));
  idOf(await tab.many([{ op: "create", table: "items", id: crypto.randomUUID(), draft: { kind: "step", title: `${MARK("a")} orphan`, parent_id: crypto.randomUUID() } }]));
  await tab.sync();
  assert.equal(tab.getSnapshot().rejected.length, 1);
  assert.equal(leaks(everything(tab.getSnapshot()), "a"), true);
  p.state.who = "b";
  await tab.sync();
  const snap = tab.getSnapshot();
  assert.deepEqual([snap.link, snap.rows, snap.rejected, snap.paused], ["mismatch", nothing, [], false]);
  assert.equal(leaks(JSON.stringify(snap), "a"), false);
  assert.equal((await saved(p, "a")).outbox.length, 1);
  assert.equal(p.due().length, 0);
});

test("the probe has its own 4 s timeout, shorter than the 15 s of the other requests", async () => {
  const timeout = mock.method(AbortSignal, "timeout");
  try {
    const server = createServer();
    const p = await profile(server, "a");
    const tab = p.tab();
    await tab.open();
    await tab.sync();
    const waits = timeout.mock.calls.map((call) => call.arguments[0]);
    assert.equal(waits[0], 4_000);
    assert.ok(waits.slice(1).length > 0 && waits.slice(1).every((ms) => ms === 15_000));
  } finally {
    timeout.mock.restore();
  }
});

test("a probe that hangs counts as a failed probe: the hint partition opens read-only and the probe is retried", async () => {
  const server = createServer();
  const p = await profile(server, "a");
  await work(p, "a");
  p.state.hang = true;
  const real = AbortSignal.timeout.bind(AbortSignal);
  const hung = mock.method(AbortSignal, "timeout", () => real(1));
  try {
    const tab = p.tab();
    await tab.open();
    assert.deepEqual([tab.getSnapshot().ready, tab.getSnapshot().me, tab.getSnapshot().link], [true, "a", "offline"]);
    assert.deepEqual(await tab.create("items", task("Typed")), paused);
    assert.deepEqual(p.due(), [5_000]);
  } finally {
    hung.mock.restore();
  }
});

test("only the first probe is cut at 4 s: the retries wait the 15 s of the other requests", async () => {
  const server = createServer();
  const p = await profile(server, "a");
  await work(p, "a");
  p.state.hang = true;
  const real = AbortSignal.timeout.bind(AbortSignal);
  const hung = mock.method(AbortSignal, "timeout", () => real(1));
  try {
    const tab = p.tab();
    await tab.open();
    await p.fire();
    await p.fire();
    assert.deepEqual(hung.mock.calls.map((call) => call.arguments[0]), [4_000, 15_000, 15_000]);
  } finally {
    hung.mock.restore();
  }
});

test("the default timer retries on the back-off, and a probe started by an event replaces the waiting retry", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const server = createServer();
    const p = await profile(server, "a");
    await work(p, "a");
    p.state.down = true;
    const tab = p.tab({}, null);
    await tab.open();
    const probes = () => p.state.calls;
    const settled = () => new Promise((resolve) => setImmediate(resolve));
    const asked = probes();
    mock.timers.tick(4_999);
    await settled();
    assert.equal(probes(), asked);
    mock.timers.tick(1);
    await settled();
    assert.equal(probes(), asked + 1);
    await tab.sync();
    assert.equal(probes(), asked + 2);
    mock.timers.tick(59_999);
    await settled();
    assert.equal(probes(), asked + 2);
    p.state.down = false;
    mock.timers.tick(1);
    await settled();
    await settled();
    assert.deepEqual([tab.getSnapshot().link, tab.getSnapshot().paused], ["online", false]);
    const done = probes();
    mock.timers.tick(600_000);
    await settled();
    assert.equal(probes(), done);
  } finally {
    mock.timers.reset();
  }
});

test("opening a confirmed tab again while the network is down leaves it confirmed and writable", async () => {
  const server = createServer();
  const p = await profile(server, "a");
  const tab = await work(p, "a");
  p.state.down = true;
  await tab.open();
  assert.deepEqual([tab.getSnapshot().link, tab.getSnapshot().paused, p.due()], ["online", false, []]);
  idOf(await tab.create("items", task("Still writable")));
  assert.equal(tab.getSnapshot().pending, 1);
});

test("the timers of a side are removed from the shared tab storage when the other side is confirmed, and only then", async () => {
  const server = createServer();
  const p = await profile(server, "a");
  const mine = (side: Side) => [...p.stored.keys()].filter((key) => key.startsWith(`wp.timer.${side}.`));
  p.held.write("a", "private-routine", "action-1", begin(5, Date.now()));
  p.held.write("b", "other-routine", "action-2", begin(5, Date.now()));

  p.state.down = true;
  p.state.hint = "a";
  const offline = p.tab();
  await offline.open();
  assert.equal(offline.getSnapshot().link, "offline");
  assert.deepEqual([mine("a").length, mine("b").length], [1, 1]);

  p.state.down = false;
  const again = p.tab();
  await again.open();
  assert.equal(again.getSnapshot().me, "a");
  assert.deepEqual(mine("a"), [timerKey("a", "private-routine", "action-1")]);
  assert.deepEqual(mine("b"), []);

  p.state.who = "b";
  const other = p.tab();
  await other.open();
  assert.equal(other.getSnapshot().me, "b");
  assert.deepEqual([...p.stored.keys()], []);
  assert.equal(p.held.read("a", "private-routine", "action-1"), null);
  assert.equal(JSON.stringify([...p.stored]).includes("private-routine"), false);
});

test("a tab that changes side after its probe drops the timers of the side it leaves", async () => {
  const server = createServer();
  const p = await profile(server, "a");
  const tab = p.tab();
  await tab.open();
  p.held.write("a", "private-routine", "action-1", begin(5, Date.now()));
  p.state.who = "b";
  await tab.open();
  assert.equal(tab.getSnapshot().me, "b");
  assert.deepEqual([...p.stored.keys()], []);
});
