import { test } from "node:test";
import assert from "node:assert/strict";
import type { Side } from "../shared/api.ts";
import { badgeFor } from "../src/domain/status.ts";
import { createApi } from "../src/store/api.ts";
import type { Fetch } from "../src/store/api.ts";
import { createLive, delayOf } from "../src/store/live.ts";
import { memoryDisk } from "../src/store/memory.ts";
import { createSession } from "../src/store/partition.ts";
import type { Snapshot } from "../src/store/store.ts";
import { client, idOf, task, titles } from "./store-client.ts";
import { createServer } from "./store-server.ts";

const SECOND = 1000;
const HOUR = 3600 * SECOND;

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

const clock = () => {
  let t = 0;
  const timers: { at: number; run: () => Promise<unknown>; live: boolean }[] = [];
  const later = (run: () => Promise<unknown>, ms: number) => {
    const timer = { at: t + ms, run, live: true };
    timers.push(timer);
    return () => void (timer.live = false);
  };
  const advance = async (ms: number, each?: () => void) => {
    const end = t + ms;
    for (let fired = 0; ; fired++) {
      assert.ok(fired < 5000, "runaway timer chain");
      const next = timers.filter((timer) => timer.live && timer.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      next.live = false;
      t = next.at;
      each?.();
      void next.run();
      await flush();
    }
    t = end;
    await flush();
  };
  const sleep = (ms: number) => new Promise<void>((resolve) => later(async () => resolve(), ms));
  return { now: () => t, later, advance, sleep, waiting: () => timers.filter((timer) => timer.live).length };
};

type Kind = Pick<Snapshot, "link" | "paused">;

const rig = ({ result = (): boolean | Promise<boolean> => true, view = {} as Partial<Kind>, up = {} as { visible?: boolean; online?: boolean } } = {}) => {
  const time = clock();
  const state = { calls: [] as number[], busy: 0, peak: 0, kind: { link: "online", paused: false, ...view } as Kind, visible: up.visible ?? true, online: up.online ?? true, result };
  const live = createLive({
    sync: async () => {
      state.calls.push(time.now());
      state.peak = Math.max(state.peak, ++state.busy);
      try {
        return await state.result();
      } finally {
        state.busy--;
      }
    },
    read: () => state.kind,
    now: time.now,
    later: time.later,
    visible: () => state.visible,
    online: () => state.online,
  });
  return { time, state, live };
};

test("the delay is 10 s while active, 30 s after a minute idle, 60 s after ten, doubling per failure up to 60 s", () => {
  assert.deepEqual([0, 59_999].map((idle) => delayOf(idle, 0)), [10_000, 10_000]);
  assert.deepEqual([60_000, 599_999].map((idle) => delayOf(idle, 0)), [30_000, 30_000]);
  assert.deepEqual([600_000, 3 * HOUR].map((idle) => delayOf(idle, 0)), [60_000, 60_000]);
  assert.deepEqual([0, 1, 2, 3, 4, 40, 5000].map((failures) => delayOf(0, failures)), [10_000, 20_000, 40_000, 60_000, 60_000, 60_000, 60_000]);
  assert.deepEqual([0, 1, 2].map((failures) => delayOf(60_000, failures)), [30_000, 60_000, 60_000]);
});

test("ten minutes without input make 24 calls: six at 10 s, then 30 s steps, then one a minute", async () => {
  const { time, state } = rig();
  await time.advance(10 * 60 * SECOND);
  const seconds = state.calls.map((at) => at / SECOND);
  assert.deepEqual(seconds, [10, 20, 30, 40, 50, 60, ...Array.from({ length: 18 }, (_, step) => 90 + step * 30)]);
  await time.advance(3 * 60 * SECOND);
  assert.deepEqual(state.calls.slice(24).map((at) => at / SECOND), [660, 720, 780]);
});

test("input keeps the schedule at 10 s, and a keypress after a long idle brings it back", async () => {
  const { time, state, live } = rig();
  await time.advance(15 * 60 * SECOND);
  const idle = state.calls.length;
  live.touch();
  await time.advance(70 * SECOND, live.touch);
  const gaps = state.calls.slice(idle).map((at, index, all) => (index === 0 ? Infinity : (at - all[index - 1]) / SECOND));
  assert.deepEqual(gaps.slice(1), Array(gaps.length - 1).fill(10));
  assert.ok(gaps.length >= 2);
});

test("a 25 s cycle never overlaps the next, and the next is armed after it ends", async () => {
  const time = clock();
  const calls: number[] = [];
  let busy = 0;
  let peak = 0;
  const live = createLive({
    sync: async () => {
      calls.push(time.now());
      peak = Math.max(peak, ++busy);
      await time.sleep(25 * SECOND);
      busy--;
      return true;
    },
    read: () => ({ link: "online", paused: false }),
    now: time.now,
    later: time.later,
    visible: () => true,
    online: () => true,
  });
  await time.advance(3 * 60 * SECOND, () => live.touch());
  assert.equal(peak, 1);
  assert.deepEqual(calls.slice(0, 3).map((at) => at / SECOND), [10, 45, 80]);
  assert.ok(calls.length <= 6);
});

test("a hidden page makes no call in an hour, and becoming visible pulls once at once", async () => {
  const { time, state, live } = rig({ up: { visible: false } });
  live.stop();
  await time.advance(HOUR);
  assert.deepEqual(state.calls, []);
  assert.equal(time.waiting(), 0);
  state.visible = true;
  live.touch();
  assert.equal(live.trigger(), true);
  await time.advance(0);
  assert.deepEqual(state.calls, [HOUR]);
  await time.advance(10 * SECOND);
  assert.equal(state.calls.length, 2);
});

test("a timer that fires on a page that went hidden unseen makes no call and arms no more", async () => {
  const { time, state } = rig();
  state.visible = false;
  await time.advance(HOUR);
  assert.deepEqual(state.calls, []);
  assert.equal(time.waiting(), 0);
});

test("a pull that ends on a hidden or offline page arms no timer", async () => {
  for (const off of ["visible", "online"] as const) {
    let release!: () => void;
    const { time, state } = rig({ result: () => new Promise<boolean>((resolve) => (release = () => resolve(true))) });
    await time.advance(10 * SECOND);
    state[off] = false;
    release();
    await time.advance(0);
    assert.deepEqual([state.calls.length, time.waiting()], [1, 0]);
  }
});

test("hiding the page cancels the waiting timer", async () => {
  const { time, state, live } = rig();
  await time.advance(25 * SECOND);
  assert.equal(state.calls.length, 2);
  state.visible = false;
  live.stop();
  await time.advance(HOUR);
  assert.equal(state.calls.length, 2);
});

test("one fake hour of failures makes at most 65 calls, and one of success at 10 s makes at most 360", async () => {
  const failing = rig({ result: () => false });
  await failing.time.advance(HOUR);
  assert.ok(failing.state.calls.length <= 65, String(failing.state.calls.length));
  assert.ok(failing.state.calls.length >= 55, String(failing.state.calls.length));
  const thrown = rig({ result: () => Promise.reject(new Error("boom")) });
  await thrown.time.advance(HOUR);
  assert.ok(thrown.state.calls.length <= 65, String(thrown.state.calls.length));
  const working = rig();
  await working.time.advance(HOUR, working.live.touch);
  assert.ok(working.state.calls.length <= 360, String(working.state.calls.length));
  assert.ok(working.state.calls.length >= 350, String(working.state.calls.length));
});

test("two failures stretch the gap to 20 s and 40 s, and the first success returns it to 10 s", async () => {
  let n = 0;
  const { time, state, live } = rig({ result: () => ++n >= 3 });
  await time.advance(100 * SECOND, live.touch);
  assert.deepEqual(state.calls.slice(0, 6).map((at) => at / SECOND), [10, 30, 70, 80, 90, 100]);
});

for (const [name, view, up] of [
  ["expired", { link: "expired" }, {}],
  ["mismatch", { link: "mismatch" }, {}],
  ["paused", { paused: true }, {}],
  ["navigator.onLine false", {}, { online: false }],
] as const) {
  test(`${name} makes no call, from the timer or a trigger`, async () => {
    const { time, state, live } = rig({ view, up });
    await time.advance(10 * 60 * SECOND);
    assert.equal(live.trigger(), false);
    assert.deepEqual(state.calls, []);
  });
}

test("a state that becomes eligible again is picked up by the timer chain", async () => {
  const { time, state } = rig({ view: { link: "expired" } });
  await time.advance(5 * 60 * SECOND);
  assert.deepEqual(state.calls, []);
  state.kind = { link: "offline", paused: false };
  await time.advance(60 * SECOND);
  assert.ok(state.calls.length >= 1);
});

test("a trigger less than 2 s after a pull began is skipped, one at 2 s is not, and two together pull once", async () => {
  const { time, state, live } = rig();
  await time.advance(10 * SECOND);
  assert.equal(state.calls.length, 1);
  await time.advance(1999);
  assert.equal(live.trigger(), true);
  await time.advance(0);
  assert.equal(state.calls.length, 1);
  await time.advance(1);
  assert.equal(live.trigger(), true);
  await time.advance(0);
  assert.equal(state.calls.length, 2);
  live.trigger();
  live.trigger();
  await time.advance(0);
  assert.equal(state.calls.length, 2);
});

test("a trigger while a pull is running starts no second one", async () => {
  let release!: () => void;
  const { time, state, live } = rig({ result: () => new Promise<boolean>((resolve) => (release = () => resolve(true))) });
  await time.advance(10 * SECOND);
  await time.advance(5 * SECOND);
  live.trigger();
  await time.advance(0);
  assert.deepEqual([state.calls.length, state.peak], [1, 1]);
  release();
  await time.advance(0);
  assert.equal(state.calls.length, 1);
});

test("a partition switch mid-run syncs the new partition only and leaves the old bytes alone", async () => {
  const server = createServer();
  const time = clock();
  const raw = await memoryDisk();
  const world = { who: "a" as Side, down: false, hint: null as Side | null };
  const fetcher: Fetch = async (url, init) => {
    if (world.down) throw new TypeError("fetch failed");
    return server.as(world.who)(url, init);
  };
  const tab = () =>
    createSession({
      disk: raw,
      hint: { get: () => world.hint, set: (side) => void (world.hint = side) },
      api: (side) => createApi(fetcher, side),
      later: time.later,
    });
  const first = tab();
  await first.open();
  idOf(await first.create("items", task("Shared by a")));
  await first.sync();
  world.down = true;
  idOf(await first.create("items", task("A unsent")));
  const kept = async (side: Side) => JSON.stringify(await raw.open(side).load());
  const before = await kept("a");

  const session = tab();
  await session.open();
  assert.deepEqual([session.getSnapshot().me, session.getSnapshot().paused], ["a", true]);
  const polled: (Side | null)[] = [];
  createLive({
    sync: () => (polled.push(session.getSnapshot().me), session.poll()),
    read: session.getSnapshot,
    now: time.now,
    later: time.later,
    visible: () => true,
    online: () => true,
  });
  await time.advance(30 * SECOND);
  assert.deepEqual(polled, []);
  world.down = false;
  world.who = "b";
  await time.advance(3 * 60 * SECOND);
  const snap = session.getSnapshot();
  assert.deepEqual([snap.me, snap.link, snap.paused], ["b", "online", false]);
  assert.deepEqual(titles(snap.rows.items), ["Shared by a"]);
  assert.ok(polled.length >= 1);
  assert.ok(polled.every((side) => side === "b"));
  assert.equal(await kept("a"), before);
  const sends = server.seen.filter((request) => request.method === "POST").length;
  assert.equal(server.rows("items").filter((row) => row.title === "A unsent").length, 0);
  await time.advance(HOUR);
  assert.equal(server.seen.filter((request) => request.method === "POST").length, sends);
  assert.equal(await kept("a"), before);
});

test("one failed background pull leaves the badge synced, two in a row show offline, a success clears it", async () => {
  const server = createServer();
  const { store } = client(server, "a");
  await store.open();
  const time = clock();
  createLive({ sync: store.poll, read: store.getSnapshot, now: time.now, later: time.later, visible: () => true, online: () => true });
  const badge = () => badgeFor({ ...store.getSnapshot(), rejected: store.getSnapshot().rejected.length });
  const seen: string[] = [];
  store.subscribe(() => seen.push(badge()));
  server.control.down = true;
  await time.advance(10 * SECOND);
  assert.deepEqual([badge(), seen], ["synced", []]);
  await time.advance(20 * SECOND);
  assert.deepEqual([badge(), seen], ["offline", ["offline"]]);
  server.control.down = false;
  await time.advance(60 * SECOND);
  assert.deepEqual([badge(), seen], ["synced", ["offline", "synced"]]);
  server.control.down = true;
  await time.advance(60 * SECOND);
  assert.equal(badge(), "synced");
});
