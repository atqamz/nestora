import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { STALE_MS, begin, keyOf, timerKey } from "../src/domain/routine-timer.ts";
import { timerStore } from "../src/store/timers.ts";
import type { Held } from "../src/store/timers.ts";

const fake = (): Held & { all: () => string[]; raw: Map<string, string> } => {
  const raw = new Map<string, string>();
  return {
    raw,
    all: () => [...raw.keys()].sort(),
    get length() {
      return raw.size;
    },
    key: (at) => [...raw.keys()][at] ?? null,
    getItem: (key) => raw.get(key) ?? null,
    setItem: (key, value) => void raw.set(key, value),
    removeItem: (key) => void raw.delete(key),
  };
};

const clock = { now: 10_000_000 };

const setup = () => {
  const storage = fake();
  return { storage, timers: timerStore(storage, () => clock.now) };
};

const timer = (minutes: number, at = clock.now) => begin(minutes, at);

test("a key names the side, the routine and the action, and an unsided or malformed key names none", () => {
  assert.equal(timerKey("a", "r1", "x1"), "wp.timer.a.r1.x1");
  assert.deepEqual(keyOf("wp.timer.b.r1.x1"), { side: "b", routine: "r1", action: "x1" });
  for (const key of ["wp.timer.r1.x1", "wp.timer.c.r1.x1", "wp.timer.a.r1", "wp.timer.a.r1.x1.y", "wp.timer.a..x1", "wp.timer.", "wp-theme", "xwp.timer.a.r1.x1"]) assert.equal(keyOf(key), null, key);
});

test("a timer is stored under its own side, and the other side reads nothing of it", () => {
  const { storage, timers } = setup();
  timers.write("a", "r1", "x1", timer(5));
  assert.deepEqual(storage.all(), ["wp.timer.a.r1.x1"]);
  assert.deepEqual(timers.read("a", "r1", "x1"), timer(5));
  assert.equal(timers.read("b", "r1", "x1"), null);
  timers.write("a", "r1", "x1", null);
  assert.deepEqual(storage.all(), []);
});

test("a read drops a malformed or stale value and keeps a running or recently ended timer", () => {
  const { storage, timers } = setup();
  const set = (key: string, value: string) => storage.setItem(key, value);
  set(timerKey("a", "r1", "bad"), "{");
  set(timerKey("a", "r1", "odd"), '{"end":"x","ms":5}');
  set(timerKey("a", "r1", "old"), JSON.stringify(timer(1, clock.now - STALE_MS - 61_000)));
  set(timerKey("a", "r1", "edge"), JSON.stringify(timer(1, clock.now - STALE_MS - 60_000)));
  set(timerKey("a", "r1", "ended"), JSON.stringify(timer(1, clock.now - 600_000)));
  set(timerKey("a", "r1", "live"), JSON.stringify(timer(30)));
  for (const action of ["bad", "odd", "old"]) assert.equal(timers.read("a", "r1", action), null, action);
  assert.deepEqual(storage.all(), ["wp.timer.a.r1.edge", "wp.timer.a.r1.ended", "wp.timer.a.r1.live"]);
  assert.deepEqual(timers.read("a", "r1", "edge"), timer(1, clock.now - STALE_MS - 60_000));
  assert.notEqual(timers.read("a", "r1", "ended"), null);
  assert.notEqual(timers.read("a", "r1", "live"), null);
  assert.equal(timers.read("a", "r1", "none"), null);
});

test("purging for a side removes the other side's timers, unsided keys, malformed and stale values, and nothing else", () => {
  const { storage, timers } = setup();
  timers.write("a", "r1", "x1", timer(5));
  timers.write("a", "r2", "x2", timer(5));
  timers.write("b", "r3", "x3", timer(5));
  storage.setItem("wp.timer.r1.x1", JSON.stringify(timer(5)));
  storage.setItem("wp.timer.b.r3", JSON.stringify(timer(5)));
  storage.setItem("wp.timer.a.r9.x9", "nonsense");
  storage.setItem(timerKey("a", "r9", "old"), JSON.stringify(timer(1, clock.now - STALE_MS - 61_000)));
  storage.setItem("wp-theme", "dark");
  storage.setItem("other", "wp.timer.b.r1.x1");
  timers.purge("b");
  assert.deepEqual(storage.all(), ["other", "wp-theme", "wp.timer.b.r3.x3"]);
  timers.purge("a");
  assert.deepEqual(storage.all(), ["other", "wp-theme"]);
});

test("a timer of the same side survives a purge for it, and is dropped once it goes stale", () => {
  const { storage, timers } = setup();
  timers.write("a", "r1", "x1", timer(5));
  timers.write("a", "r1", "x2", timer(1, clock.now - 600_000));
  timers.purge("a");
  assert.deepEqual(storage.all(), ["wp.timer.a.r1.x1", "wp.timer.a.r1.x2"]);
  clock.now += STALE_MS + 6 * 60_000;
  timers.purge("a");
  assert.deepEqual(storage.all(), []);
  clock.now = 10_000_000;
});

test("the running list is the actions of one routine on one side that hold a live or recently ended timer", () => {
  const { storage, timers } = setup();
  timers.write("a", "r1", "x1", timer(5));
  timers.write("a", "r1", "x2", timer(1, clock.now - 600_000));
  timers.write("a", "r2", "x3", timer(5));
  timers.write("b", "r1", "x4", timer(5));
  storage.setItem(timerKey("a", "r1", "x5"), "{");
  storage.setItem(timerKey("a", "r1", "x6"), JSON.stringify(timer(1, clock.now - STALE_MS - 61_000)));
  assert.deepEqual(timers.running("a", "r1").sort(), ["x1", "x2"]);
  assert.deepEqual(timers.running("b", "r1"), ["x4"]);
  assert.deepEqual(timers.running("a", "r9"), []);
  assert.deepEqual(storage.all(), ["wp.timer.a.r1.x1", "wp.timer.a.r1.x2", "wp.timer.a.r2.x3", "wp.timer.b.r1.x4"]);
});

test("keeping an action drops the other timers of that routine and side only", () => {
  const { storage, timers } = setup();
  for (const [side, routine, action] of [["a", "r1", "x1"], ["a", "r1", "x2"], ["a", "r2", "x3"], ["b", "r1", "x4"]] as const) timers.write(side, routine, action, timer(5));
  timers.keep("a", "r1", "x2");
  assert.deepEqual(storage.all(), ["wp.timer.a.r1.x2", "wp.timer.a.r2.x3", "wp.timer.b.r1.x4"]);
  timers.keep("a", "r1", null);
  assert.deepEqual(storage.all(), ["wp.timer.a.r2.x3", "wp.timer.b.r1.x4"]);
});

test("a storage that answers no key for some position still purges the keys after it", () => {
  const storage = fake();
  storage.setItem("wp.timer.a.r1.x1", JSON.stringify(timer(5)));
  storage.setItem("wp.timer.b.r1.x2", JSON.stringify(timer(5)));
  const gappy: Held = { ...storage, length: 3, key: (at) => (at === 0 ? null : (storage.key(at - 1) ?? null)), getItem: storage.getItem, setItem: storage.setItem, removeItem: storage.removeItem };
  timerStore(gappy, () => clock.now).purge("b");
  assert.deepEqual(storage.all(), ["wp.timer.b.r1.x2"]);
});

test("a storage that is missing or throws never makes a call throw", () => {
  const broken: Held = {
    length: 1,
    key: () => {
      throw new Error("blocked");
    },
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
  for (const timers of [timerStore(null), timerStore(broken)]) {
    assert.equal(timers.read("a", "r1", "x1"), null);
    assert.equal(timers.write("a", "r1", "x1", timer(5)), undefined);
    assert.equal(timers.write("a", "r1", "x1", null), undefined);
    assert.deepEqual(timers.running("a", "r1"), []);
    assert.equal(timers.keep("a", "r1", null), undefined);
    assert.equal(timers.purge("a"), undefined);
  }
});

test("no timer key is written without a side: the writers need one, and nothing else in the app names a timer key or touches session storage", () => {
  const { storage, timers } = setup();
  for (const side of ["a", "b"] as const) timers.write(side, "r1", "x1", timer(5));
  timers.write("a", "r1", "x2", timer(5));
  timers.keep("a", "r1", "x2");
  assert.ok(storage.all().length > 0);
  for (const key of storage.all()) assert.match(key, /^wp\.timer\.[ab]\.[^.]+\.[^.]+$/);
  // @ts-expect-error a key without a side does not type check
  timerKey("r1", "x1");
  assert.equal(timerKey.length, 3);
  const files = (dir: string): string[] => readdirSync(new URL(`../${dir}/`, import.meta.url), { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]));
  const sources = ["src", "shared", "worker"].flatMap(files).filter((file) => /\.tsx?$/.test(file));
  const reading = (pattern: RegExp) => sources.filter((file) => pattern.test(readFileSync(new URL(`../${file}`, import.meta.url), "utf8")));
  assert.deepEqual(reading(/wp\.timer/), ["src/domain/routine-timer.ts"]);
  assert.deepEqual(reading(/sessionStorage/), ["src/store/browser.ts"]);
  assert.deepEqual(reading(/localStorage/), ["src/store/browser.ts", "src/ui/theme.ts"]);
});
