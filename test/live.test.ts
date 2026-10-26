import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Side } from "../shared/api.ts";
import { badgeFor } from "../src/domain/status.ts";
import { createApi } from "../src/store/api.ts";
import type { Fetch } from "../src/store/api.ts";
import { createLive, delayOf } from "../src/store/live.ts";
import { memoryDisk } from "../src/store/memory.ts";
import { wirePage } from "../src/store/page.ts";
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

test("a trigger on a loop that cannot poll arms the chain once, and it polls within one interval of the loop becoming eligible", async () => {
  const { time, state, live } = rig({ view: { paused: true } });
  live.stop();
  assert.equal(time.waiting(), 0);
  for (let n = 0; n < 5; n++) {
    assert.equal(live.trigger(), false);
    assert.equal(time.waiting(), 1);
  }
  state.kind = { link: "online", paused: false };
  await time.advance(10 * SECOND);
  assert.deepEqual(state.calls, [10 * SECOND]);
  assert.equal(time.waiting(), 1);
});

test("twenty triggers 5 s apart leave one live timer each time, and ten active minutes after them make at most 60 calls", async () => {
  const { time, state, live } = rig();
  for (let n = 0; n < 20; n++) {
    live.touch();
    await time.advance(5 * SECOND);
    live.trigger();
    await time.advance(0);
    assert.equal(time.waiting(), 1);
  }
  const before = state.calls.length;
  await time.advance(10 * 60 * SECOND, live.touch);
  assert.ok(state.calls.length - before <= 60, String(state.calls.length - before));
  assert.equal(state.peak, 1);
});

test("stop leaves no live timer, and a trigger while the timer waits and the pull is slow starts one pull and no second chain", async () => {
  const { time, state, live } = rig({ result: () => time.sleep(25 * SECOND).then(() => true) });
  assert.equal(time.waiting(), 1);
  live.stop();
  assert.equal(time.waiting(), 0);
  live.trigger();
  await time.advance(0);
  assert.deepEqual([state.calls.length, time.waiting()], [1, 1]);
  await time.advance(25 * SECOND);
  assert.equal(time.waiting(), 1);
  await time.advance(8 * SECOND);
  live.trigger();
  await time.advance(10 * SECOND, live.touch);
  assert.deepEqual([state.calls.length, state.peak, time.waiting()], [2, 1, 1]);
});

test("a trigger every 2 s on a failing loop makes about one call a minute once the failures pile up", async () => {
  const { time, state, live } = rig({ result: () => false });
  for (let n = 0; n < 300; n++) {
    await time.advance(2 * SECOND);
    live.trigger();
  }
  assert.ok(state.calls.length <= 30, String(state.calls.length));
});

const recorder = () =>
  class extends EventTarget {
    active: [string, unknown][] = [];
    override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
      this.active.push([type, options]);
      super.addEventListener(type, listener, options);
    }
    override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
      const capture = (entry: unknown) => (typeof entry === "object" && entry !== null ? Boolean((entry as EventListenerOptions).capture) : Boolean(entry));
      const at = this.active.findIndex(([name, added]) => name === type && capture(added) === capture(options));
      if (at >= 0) this.active.splice(at, 1);
      super.removeEventListener(type, listener, options);
    }
  };
const Win = recorder();
const Doc = class extends recorder() {
  visibilityState: DocumentVisibilityState = "visible";
};

const fire = (target: EventTarget, type: string) => void target.dispatchEvent(new Event(type));

const pageRig = ({ view = {} as Partial<Kind>, hidden = false, offline = false } = {}) => {
  const time = clock();
  const win = new Win();
  const doc = new Doc();
  const nav = { onLine: !offline };
  doc.visibilityState = hidden ? "hidden" : "visible";
  const state = { kind: { link: "online", paused: false, ...view } as Kind, polls: [] as number[], syncs: [] as number[], onSync: () => {} };
  const store = {
    poll: async () => (state.polls.push(time.now()), true),
    sync: async () => (state.syncs.push(time.now()), state.onSync()),
    getSnapshot: () => state.kind as Snapshot,
  };
  const off = wirePage(store, { win, doc, nav, now: time.now, later: time.later });
  return { time, win, doc, nav, state, off };
};

test("each of the four wake events pulls a healthy page once, and a hidden page nothing", async () => {
  for (const [name, source] of [["visibilitychange", "doc"], ["pageshow", "win"], ["focus", "win"], ["online", "win"]] as const) {
    const page = pageRig();
    await page.time.advance(3 * SECOND);
    fire(page[source], name);
    await page.time.advance(0);
    assert.deepEqual([name, page.state.polls, page.state.syncs], [name, [3 * SECOND], []]);
    page.doc.visibilityState = "hidden";
    fire(page.win, name);
    fire(page.doc, name);
    await page.time.advance(0);
    assert.deepEqual([name, page.state.polls.length, page.state.syncs.length], [name, 1, 0]);
  }
});

for (const path of ["visibilitychange", "pageshow", "focus", "online"] as const) {
  test(`${path} re-arms the dead chain of a read-only page once, and the recovered probe is polled within one interval`, async () => {
    const page = pageRig({ view: { paused: true }, offline: path === "online" });
    if (path !== "online") {
      page.doc.visibilityState = "hidden";
      fire(page.doc, "visibilitychange");
      page.doc.visibilityState = "visible";
    }
    assert.equal(page.time.waiting(), 0);
    page.state.onSync = () => void (page.state.kind = { link: "online", paused: false });
    page.nav.onLine = true;
    fire(path === "visibilitychange" ? page.doc : page.win, path);
    assert.deepEqual([page.time.waiting(), page.state.syncs.length], [1, 1]);
    await page.time.advance(10 * SECOND);
    assert.deepEqual(page.state.polls, [10 * SECOND]);
    assert.equal(page.time.waiting(), 1);
  });
}

test("a page that cannot poll yet falls back to one probe per wake at most every 2 s, and a pollable one never probes", async () => {
  const page = pageRig({ view: { link: "expired" } });
  fire(page.win, "focus");
  fire(page.win, "online");
  assert.equal(page.state.syncs.length, 1);
  await page.time.advance(1999);
  fire(page.win, "focus");
  assert.equal(page.state.syncs.length, 1);
  await page.time.advance(1);
  fire(page.win, "online");
  assert.equal(page.state.syncs.length, 2);
  assert.deepEqual(page.state.polls, []);
  const storm = pageRig({ view: { link: "expired" } });
  await storm.time.advance(10 * 60 * SECOND, () => fire(storm.win, "focus"));
  for (let n = 0; n < 6000; n++) {
    fire(storm.win, "focus");
    await storm.time.advance(100);
  }
  assert.ok(storm.state.syncs.length <= 600, String(storm.state.syncs.length));
  const healthy = pageRig();
  await healthy.time.advance(10 * 60 * SECOND + 3 * SECOND);
  fire(healthy.win, "focus");
  assert.deepEqual([healthy.state.polls.length, healthy.state.syncs.length], [25, 0]);
});

test("the page loop is hidden-aware, offline-aware and idle-aware without any wake event", async () => {
  const hidden = pageRig();
  hidden.doc.visibilityState = "hidden";
  await hidden.time.advance(HOUR);
  const offline = pageRig();
  offline.nav.onLine = false;
  await offline.time.advance(HOUR);
  assert.deepEqual([hidden.state.polls.length, offline.state.polls.length], [0, 0]);
  const idle = pageRig();
  await idle.time.advance(10 * 60 * SECOND);
  assert.equal(idle.state.polls.length, 24);
});

for (const type of ["pointerdown", "keydown"]) {
  test(`${type} counts as input, passively and in the capture phase`, async () => {
    const page = pageRig();
    await page.time.advance(15 * 60 * SECOND);
    const idle = page.state.polls.length;
    fire(page.win, type);
    await page.time.advance(130 * SECOND, () => fire(page.win, type));
    const gaps = page.state.polls.slice(idle + 1).map((at, index) => (at - page.state.polls[idle + index]) / SECOND);
    assert.deepEqual(gaps, Array(gaps.length).fill(10));
    assert.ok(gaps.length >= 5);
    assert.deepEqual(page.win.active.filter(([name]) => name === type), [[type, { passive: true, capture: true }]]);
  });
}

test("one wiring registers each listener once, and its cleanup removes them and stops the chain", async () => {
  const page = pageRig();
  const names = (target: { active: [string, unknown][] }) => target.active.map(([name]) => name).sort();
  assert.deepEqual(names(page.win), ["focus", "keydown", "online", "pageshow", "pointerdown"]);
  assert.deepEqual(names(page.doc), ["visibilitychange"]);
  page.off();
  assert.deepEqual([page.win.active, page.doc.active, page.time.waiting()], [[], [], 0]);
  fire(page.win, "focus");
  fire(page.doc, "visibilitychange");
  await page.time.advance(HOUR);
  assert.deepEqual([page.state.polls, page.state.syncs], [[], []]);
});

test("hiding the page stops the chain, and a read-only reload that was hidden, shown and healed polls again within one interval", async () => {
  const server = createServer();
  const time = clock();
  const raw = await memoryDisk();
  const world = { down: false, hint: null as Side | null };
  const fetcher: Fetch = async (url, init) => {
    if (world.down) throw new TypeError("fetch failed");
    return server.as("a")(url, init);
  };
  const tab = () =>
    createSession({
      disk: raw,
      hint: { get: () => world.hint, set: (side) => void (world.hint = side) },
      api: (side) => createApi(fetcher, side),
      later: time.later,
    });
  await tab().open();
  world.down = true;
  const session = tab();
  await session.open();
  assert.equal(session.getSnapshot().paused, true);
  const win = new Win();
  const doc = new Doc();
  let polls = 0;
  wirePage({ ...session, poll: () => (polls++, session.poll()) }, { win, doc, nav: { onLine: true }, now: time.now, later: time.later });
  doc.visibilityState = "hidden";
  fire(doc, "visibilitychange");
  await time.advance(3 * SECOND);
  doc.visibilityState = "visible";
  fire(doc, "visibilitychange");
  await time.advance(3 * SECOND);
  assert.equal(session.getSnapshot().paused, true);
  world.down = false;
  await time.advance(30 * SECOND);
  assert.deepEqual([session.getSnapshot().paused, session.getSnapshot().link], [false, "online"]);
  const before = polls;
  const touch = () => fire(win, "pointerdown");
  await time.advance(70 * SECOND, touch);
  assert.ok(polls - before >= 6, String(polls - before));
});

test("the browser store wires the real window, document, navigator, clock and timer into the page loop", () => {
  const browser = readFileSync(new URL("../src/store/browser.ts", import.meta.url), "utf8");
  assert.match(browser, /^wirePage\(store, \{ win: window, doc: document, nav: navigator, now: Date\.now, later: timer \}\);$/m);
});

test("the session poll is false before a store is open, and quiet once like the store's own", async () => {
  const server = createServer();
  const session = createSession({ disk: await memoryDisk(), hint: { get: () => null, set: () => {} }, api: (side) => createApi(server.as("a"), side) });
  assert.equal(await session.poll(), false);
  await session.open();
  assert.equal(await session.poll(), true);
  server.control.down = true;
  assert.equal(await session.poll(), false);
  assert.equal(session.getSnapshot().link, "online");
  await session.poll();
  assert.equal(session.getSnapshot().link, "offline");
});

test("a failed pull widens the trigger gap to 4 s, and a page that never saw input starts at the active cadence", async () => {
  const failing = rig({ result: () => false });
  await failing.time.advance(10 * SECOND);
  await failing.time.advance(3999);
  failing.live.trigger();
  await failing.time.advance(0);
  assert.equal(failing.state.calls.length, 1);
  await failing.time.advance(1);
  failing.live.trigger();
  await failing.time.advance(0);
  assert.equal(failing.state.calls.length, 2);
  const time = clock();
  await time.advance(HOUR);
  const calls: number[] = [];
  createLive({ sync: async () => (calls.push(time.now()), true), read: () => ({ link: "online", paused: false }), now: time.now, later: time.later, visible: () => true, online: () => true });
  await time.advance(60 * SECOND);
  assert.equal(calls.length, 6);
});

test("a page whose navigator has no onLine value counts as online", async () => {
  const page = pageRig();
  (page.nav as { onLine?: boolean }).onLine = undefined;
  await page.time.advance(3 * SECOND);
  fire(page.win, "focus");
  await page.time.advance(0);
  assert.deepEqual([page.state.polls.length, page.state.syncs.length], [1, 0]);
});

const sessionPage = async () => {
  const server = createServer();
  const time = clock();
  const world = { down: false, hold: null as Promise<void> | null, hint: null as Side | null };
  const fetcher: Fetch = async (url, init) => {
    await world.hold;
    if (world.down) throw new TypeError("fetch failed");
    return server.as("a")(url, init);
  };
  const session = createSession({
    disk: await memoryDisk(),
    hint: { get: () => world.hint, set: (side) => void (world.hint = side) },
    api: (side) => createApi(fetcher, side),
    later: time.later,
  });
  await session.open();
  const win = new Win();
  const doc = new Doc();
  const nav = { onLine: true };
  const polls: number[] = [];
  wirePage({ ...session, poll: () => (polls.push(time.now()), session.poll()) }, { win, doc, nav, now: time.now, later: time.later });
  const hide = () => {
    doc.visibilityState = "hidden";
    fire(doc, "visibilitychange");
  };
  const show = () => {
    doc.visibilityState = "visible";
    fire(doc, "visibilitychange");
    fire(win, "focus");
    fire(win, "pageshow");
  };
  return { time, world, session, win, nav, polls, hide, show };
};

test("a hide and show within the trigger gap of a pull leaves one timer, and polling goes on", async () => {
  const page = await sessionPage();
  await page.time.advance(10 * SECOND);
  assert.equal(page.polls.length, 1);
  await page.time.advance(300);
  page.hide();
  await page.time.advance(600);
  page.show();
  await page.time.advance(0);
  assert.deepEqual([page.polls.length, page.time.waiting()], [1, 1]);
  await page.time.advance(10 * SECOND);
  assert.equal(page.polls.length, 2);
  assert.equal(page.time.waiting(), 1);
});

test("a hide and show inside the 60 s gap of a failing chain resumes once the network is back, within one interval", async () => {
  const page = await sessionPage();
  page.world.down = true;
  await page.time.advance(190 * SECOND);
  assert.deepEqual(page.polls.map((at) => at / SECOND), [10, 30, 70, 130, 190]);
  await page.time.advance(300);
  page.hide();
  await page.time.advance(20 * SECOND);
  page.world.down = false;
  page.show();
  await page.time.advance(0);
  assert.equal(page.time.waiting(), 1);
  await page.time.advance(60 * SECOND);
  assert.equal(page.polls.length, 6);
  assert.equal(page.session.getSnapshot().link, "online");
  assert.equal(page.time.waiting(), 1);
});

test("a network blip while a pull is in flight resumes when the network is back, within one interval", async () => {
  const page = await sessionPage();
  let release!: () => void;
  await page.time.advance(9 * SECOND);
  page.world.hold = new Promise<void>((resolve) => (release = resolve));
  await page.time.advance(SECOND);
  assert.equal(page.polls.length, 1);
  page.nav.onLine = false;
  page.world.down = true;
  release();
  await page.time.advance(0);
  assert.equal(page.time.waiting(), 0);
  await page.time.advance(300);
  page.nav.onLine = true;
  page.world.down = false;
  fire(page.win, "online");
  await page.time.advance(0);
  assert.equal(page.time.waiting(), 1);
  await page.time.advance(20 * SECOND);
  assert.equal(page.polls.length, 2);
  assert.equal(page.time.waiting(), 1);
});

test("a trigger while a pull runs on a page that stopped being eligible arms no timer, so the timer cannot start a second pull", async () => {
  const { time, state, live } = rig({ result: () => time.sleep(25 * SECOND).then(() => true) });
  await time.advance(10 * SECOND);
  await time.advance(SECOND);
  state.kind = { link: "online", paused: true };
  assert.equal(live.trigger(), false);
  await time.advance(4 * SECOND);
  state.kind = { link: "online", paused: false };
  await time.advance(30 * SECOND);
  assert.deepEqual([state.calls.map((at) => at / SECOND), state.peak], [[10, 45], 1]);
});

test("a trigger on a page that cannot poll yet leaves the live timer where it is", async () => {
  const { time, state, live } = rig({ view: { paused: true } });
  await time.advance(5 * SECOND);
  assert.equal(live.trigger(), false);
  await time.advance(4 * SECOND);
  assert.equal(live.trigger(), false);
  state.kind = { link: "online", paused: false };
  await time.advance(SECOND);
  assert.deepEqual(state.calls, [10 * SECOND]);
});

test("the trigger gap stops doubling at a minute once the chain has failed six times", async () => {
  const { time, state, live } = rig({ result: () => time.sleep(30 * SECOND).then(() => false) });
  while (state.calls.length < 6 || state.busy > 0) await time.advance(SECOND);
  await time.advance(35 * SECOND);
  assert.equal(live.trigger(), true);
  assert.equal(state.calls.length, 7);
});

const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
};

test("any sequence of wake events, hides, blips, failures and slow pulls keeps at most one timer, none on a hidden page, and one whenever a visible online page is idle", async () => {
  const links: Kind[] = [{ link: "online", paused: false }, { link: "offline", paused: false }, { link: "expired", paused: false }, { link: "online", paused: true }];
  const total = { calls: 0, skipped: 0 };
  for (let seed = 1; seed <= 150; seed++) {
    const next = random(seed);
    const pick = (n: number) => Math.floor(next() * n);
    const time = clock();
    const state = { kind: links[0], visible: true, online: true, fail: false, slow: false, pending: [] as (() => void)[], calls: 0, busy: 0, peak: 0, bad: [] as string[] };
    const live = createLive({
      sync: async () => {
        const { link, paused } = state.kind;
        if (!state.visible || !state.online || paused || link === "expired" || link === "mismatch") state.bad.push(`call at ${time.now()} while ineligible`);
        state.calls++;
        state.peak = Math.max(state.peak, ++state.busy);
        const outcome = !state.fail;
        if (state.slow) await new Promise<void>((resolve) => state.pending.push(resolve));
        state.busy--;
        return outcome;
      },
      read: () => state.kind,
      now: time.now,
      later: time.later,
      visible: () => state.visible,
      online: () => state.online,
    });
    const steps: [string, () => Promise<void> | void][] = [
      ["trigger", () => void (state.visible && live.trigger())],
      ["hide", () => ((state.visible = false), live.stop())],
      ["show", () => ((state.visible = true), live.trigger())],
      ["online", () => ((state.online = true), state.visible && live.trigger())],
      ["offline", () => void (state.online = false)],
      ["fail", () => void (state.fail = !state.fail)],
      ["slow", () => void (state.slow = !state.slow)],
      ["finish", () => void state.pending.splice(0).forEach((release) => release())],
      ["link", () => void (state.kind = links[pick(links.length)])],
      ["touch", () => live.touch()],
      ["gap skip", () => time.advance(pick(2000))],
      ["advance", () => time.advance(2000 + pick(40_000))],
      ["advance far", () => time.advance(60_000 + pick(60_000))],
    ];
    for (let step = 0; step < 120; step++) {
      const [name, run] = steps[pick(steps.length)];
      await run();
      await time.advance(0);
      const where = `seed ${seed} step ${step} after ${name} at ${time.now()}`;
      assert.ok(time.waiting() <= 1, `${where}: ${time.waiting()} timers`);
      assert.deepEqual(state.bad, [], where);
      assert.ok(state.peak <= 1, `${where}: two pulls at once`);
      if (!state.visible) assert.equal(time.waiting(), 0, `${where}: timer on a hidden page`);
      if (state.visible && state.online && state.busy === 0) assert.equal(time.waiting(), 1, `${where}: dead chain`);
    }
    total.calls += state.calls;
    state.online = false;
    state.pending.splice(0).forEach((release) => release());
    await time.advance(61 * SECOND);
    assert.equal(time.waiting(), 0, `seed ${seed}: timer on an offline page`);
    const settled = state.calls;
    await time.advance(HOUR);
    assert.deepEqual([state.calls, state.bad], [settled, []], `seed ${seed}`);
  }
  assert.ok(total.calls > 500, String(total.calls));
});
