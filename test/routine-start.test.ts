import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY_CODES, weekDates } from "../shared/routines.ts";
import type { ItemRow } from "../shared/tables.ts";
import { SETTLE_MS, clampTo, hasWork, isOpen, openCount, pagesOf, position, settled } from "../src/domain/routine-start.ts";
import { ADD_MS, FRESH_MS, STALE_MS, begin, clock, extend, parse, phase, share, timerKey } from "../src/domain/routine-timer.ts";
import { weekStrip } from "../src/domain/routines.ts";
import { keepAwake } from "../src/domain/wake-lock.ts";
import type { WakeState } from "../src/domain/wake-lock.ts";
import { text } from "../src/ui/text.ts";
import { item } from "./domain-rows.ts";

const DAY = "2026-10-26";

const routine = (data: Record<string, unknown> = {}, extra: Partial<ItemRow> = {}) => item({ kind: "routine", status: null, who: "a", title: "Morning routine", data, ...extra });

const action = (parent: ItemRow, title: string, kind = "step", extra: Partial<ItemRow> = {}) => item({ kind, status: null, parent_id: parent.id, title, ...extra });

const ticked = (row: ItemRow, day = DAY): ItemRow => ({ ...row, data: { ...row.data, done_a: day } });

test("a page is one action, a block is left out, and consecutive items under one heading share a page", () => {
  const r = routine();
  const rows = [
    action(r, "item 1"),
    action(r, "item 2", "block"),
    action(r, "item 3", "pack"),
    action(r, "item 4", "pack"),
    action(r, "item 5", "pack", { group_key: "Bag" }),
    action(r, "item 6", "pack", { group_key: "Bag" }),
    action(r, "item 7", "step"),
    action(r, "item 8", "pack"),
    action(r, "item 9", "timer"),
  ];
  assert.deepEqual(pagesOf(rows).map((page) => page.map((row) => row.title)), [["item 1"], ["item 3", "item 4"], ["item 5", "item 6"], ["item 7"], ["item 8"], ["item 9"]]);
  assert.deepEqual(pagesOf([]), []);
  assert.deepEqual(pagesOf([action(r, "item 1", "block")]), []);
});

test("a page is open until every action on it that completes is done, and a note is never open", () => {
  const r = routine();
  const one = action(r, "item 1");
  const note = action(r, "item 2", "text");
  const pair = [action(r, "item 3", "pack"), action(r, "item 4", "pack")];
  const counter = action(r, "item 5", "counter", { qty: 2 });
  assert.equal(isOpen([one], "a", DAY), true);
  assert.equal(isOpen([ticked(one)], "a", DAY), false);
  assert.equal(isOpen([ticked(one, "2026-10-25")], "a", DAY), true);
  assert.equal(isOpen([note], "a", DAY), false);
  assert.equal(isOpen([ticked(pair[0]), pair[1]], "a", DAY), true);
  assert.equal(isOpen(pair.map((row) => ticked(row)), "a", DAY), false);
  assert.equal(isOpen([{ ...counter, data: { done_a: DAY, value_a: 1 } }], "a", DAY), true);
  assert.equal(isOpen([{ ...counter, data: { done_a: DAY, value_a: 2 } }], "a", DAY), false);
  assert.equal(isOpen([one], "b", DAY), true);
  assert.equal(openCount([[one], [note], [ticked(one)]], "a", DAY), 1);
});

test("the position is the first open page, backed up over the notes that lead into it, and past the end when all is done", () => {
  const r = routine();
  const a = action(r, "item 1");
  const intro = action(r, "item 2", "text");
  const label = action(r, "item 3", "day_type");
  const b = action(r, "item 4");
  const c = action(r, "item 5");
  const pages = pagesOf([a, intro, label, b, c]);
  assert.equal(position(pages, "a", DAY), 0);
  assert.equal(position(pagesOf([ticked(a), intro, label, b, c]), "a", DAY), 1);
  assert.equal(position(pagesOf([ticked(a), intro, label, ticked(b), c]), "a", DAY), 4);
  assert.equal(position(pagesOf([ticked(a), intro, label, ticked(b), ticked(c)]), "a", DAY), 5);
  assert.equal(position(pagesOf([intro, label]), "a", DAY), 2);
  assert.equal(position([], "a", DAY), 0);
  assert.equal(position(pagesOf([ticked(a, "2026-10-25"), b]), "a", DAY), 0);
  assert.equal(position(pagesOf([ticked(a), b]), "b", DAY), 0);
});

test("a routine that starts with a pack still pages, and the notes before the first open page all lead into it", () => {
  const r = routine();
  assert.deepEqual(pagesOf([action(r, "item 1", "pack"), action(r, "item 2", "pack")]).map((page) => page.length), [2]);
  const a = action(r, "item 1");
  const notes = [action(r, "item 2", "text"), action(r, "item 3", "day_type"), action(r, "item 4", "text")];
  const b = action(r, "item 5");
  assert.equal(position(pagesOf([ticked(a), ...notes, b]), "a", DAY), 1);
  assert.equal(position(pagesOf([...notes, b]), "a", DAY), 0);
  assert.equal(position(pagesOf([ticked(a), ...notes, ticked(b)]), "a", DAY), 5);
});

test("the position goes to the page whose timer is held, else to the first open page", () => {
  const r = routine();
  const a = action(r, "item 1");
  const t = action(r, "item 2", "timer");
  const b = action(r, "item 3");
  const pages = pagesOf([a, t, b]);
  assert.equal(position(pages, "a", DAY, [t.id]), 1);
  assert.equal(position(pages, "a", DAY, [b.id, t.id]), 1);
  assert.equal(position(pages, "a", DAY, ["gone"]), 0);
  assert.equal(position(pages, "a", DAY, []), 0);
  assert.equal(position(pagesOf([ticked(a), ticked(t), ticked(b)]), "a", DAY, [t.id]), 1);
  const first = action(r, "item 4", "timer");
  assert.equal(position(pagesOf([ticked(first), b]), "a", DAY, [first.id]), 0);
  assert.equal(position(pagesOf([ticked(first), b]), "a", DAY), 1);
  assert.equal(position(pagesOf([ticked(a), ticked(t), ticked(b)]), "a", DAY), 3);
});

test("a routine has work only when some page can be ticked", () => {
  const r = routine();
  const note = action(r, "item 1", "text");
  const label = action(r, "item 2", "day_type");
  const one = action(r, "item 3");
  assert.equal(hasWork([], "a", DAY), false);
  assert.equal(hasWork(pagesOf([note, label]), "a", DAY), false);
  assert.equal(hasWork(pagesOf([note, one]), "a", DAY), true);
  assert.equal(hasWork(pagesOf([ticked(one)]), "a", DAY), true);
  assert.equal(hasWork(pagesOf([action(r, "item 4", "counter", { qty: 2 })]), "a", DAY), true);
  assert.equal(hasWork(pagesOf([action(r, "item 5", "pack")]), "a", DAY), true);
});

test("a move goes to the page asked for, held between the first page and the end", () => {
  assert.deepEqual([-3, 0, 2, 5, 9].map((to) => clampTo(to, 5)), [0, 0, 2, 5, 5]);
  assert.equal(clampTo(0, 0), 0);
  assert.equal(clampTo(1, 0), 0);
});

test("a tap is let through only 300 ms after the page changed", () => {
  assert.equal(SETTLE_MS, 300);
  assert.equal(settled(1_000, 1_000), false);
  assert.equal(settled(1_000, 1_299), false);
  assert.equal(settled(1_000, 1_300), true);
  assert.equal(settled(1_000, 5_000), true);
  assert.equal(settled(0, 40), false);
  assert.equal(settled(0, 120), false);
});

test("the week is Monday to Sunday around any date, across a month and a year end", () => {
  assert.deepEqual(weekDates("2026-10-26"), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
  assert.deepEqual(weekDates("2026-11-01"), weekDates("2026-10-26"));
  assert.deepEqual(weekDates("2026-10-28"), weekDates("2026-10-26"));
  assert.deepEqual(weekDates("2026-12-31").slice(0, 1), ["2026-12-28"]);
  assert.deepEqual(weekDates("2026-12-31").slice(-1), ["2027-01-03"]);
});

test("the strip shows the planned day label per weekday, marks today, and marks done only for today", () => {
  const r = routine();
  const lower = action(r, "Day type 1", "day_type", { sort: 0, data: { days: "MO,TH" } });
  const upper = action(r, "Day type 2", "day_type", { sort: 1, data: { days: "TU,FR" } });
  const rest = action(r, "Day type 3", "day_type", { sort: 2, data: { days: "WE,SA,SU" } });
  const step = action(r, "item 1", "step", { sort: 3, data: { days: "MO,TU" } });
  const all = [lower, upper, rest, step];
  const strip = weekStrip(r, all, "2026-10-28", "a")!;
  assert.deepEqual(strip.map((entry) => entry.label), ["Day type 1", "Day type 2", "Day type 3", "Day type 1", "Day type 2", "Day type 3", "Day type 3"]);
  assert.deepEqual(strip.map((entry) => entry.date), weekDates("2026-10-28"));
  assert.deepEqual(strip.map((entry) => entry.today), [false, false, true, false, false, false, false]);
  assert.deepEqual(strip.map((entry) => entry.done), [false, false, false, false, false, false, false]);
  assert.equal(weekStrip(r, [lower, upper, rest, ticked(step, "2026-10-26")], "2026-10-26", "a")!.filter((entry) => entry.done).length, 1);
  assert.equal(weekStrip(r, [lower, upper, rest, ticked(step, "2026-10-26")], "2026-10-27", "a")!.filter((entry) => entry.done).length, 0);
  assert.equal(weekStrip(r, [lower, upper, rest, ticked(step, "2026-10-26")], "2026-10-26", "b")!.filter((entry) => entry.done).length, 0);
});

test("the strip names the days in order and ticks today from the actions that occur today only", () => {
  const r = routine();
  const label = action(r, "Day type 1", "day_type");
  const monday = ticked(action(r, "item 1", "step", { data: { days: "MO" } }));
  const tuesday = action(r, "item 2", "step", { data: { days: "TU" } });
  const strip = weekStrip(r, [label, monday, tuesday], DAY, "a")!;
  assert.deepEqual(strip.map((entry) => entry.day), [...DAY_CODES]);
  assert.deepEqual(strip.map((entry) => entry.done), [true, false, false, false, false, false, false]);
  assert.deepEqual(strip.map((entry) => entry.today), [true, false, false, false, false, false, false]);
  const wednesday = weekStrip(r, [label, monday, tuesday], "2026-10-28", "a")!;
  assert.deepEqual(wednesday.map((entry) => entry.day), [...DAY_CODES]);
  assert.deepEqual(wednesday.map((entry) => entry.today), [false, false, true, false, false, false, false]);
  assert.equal(weekStrip(r, [label, ticked(monday), tuesday], DAY, "a")![0].done, true);
});

test("a routine with no day label has no strip, a day the routine skips has no label, and a day without a label stays empty", () => {
  const r = routine({ days: "MO,TU,WE" });
  const one = action(r, "Day type 1", "day_type", { data: { days: "MO,TU" } });
  assert.equal(weekStrip(r, [action(r, "item 1")], DAY, "a"), null);
  assert.equal(weekStrip(r, [], DAY, "a"), null);
  assert.equal(weekStrip(r, [{ ...one, deleted_at: "2026-10-01T00:00:00Z" }], DAY, "a")!.every((entry) => entry.label === null), true);
  assert.deepEqual(weekStrip(r, [one], DAY, "a")!.map((entry) => entry.label), ["Day type 1", "Day type 1", null, null, null, null, null]);
  const paused = routine({ paused_until: "2026-10-28" });
  assert.deepEqual(weekStrip(paused, [action(paused, "Day type 1", "day_type")], DAY, "a")!.map((entry) => entry.label), [null, null, "Day type 1", "Day type 1", "Day type 1", "Day type 1", "Day type 1"]);
});

test("a timer started now ends after its minutes, adding a minute pushes the end and the total", () => {
  const t = begin(45, 1_000);
  assert.deepEqual(t, { end: 1_000 + 45 * 60_000, ms: 45 * 60_000 });
  assert.deepEqual(extend(t, 2_000), { end: t.end + ADD_MS, ms: t.ms + ADD_MS });
  const late = extend(t, t.end + 5_000);
  assert.deepEqual(late, { end: t.end + 5_000 + ADD_MS, ms: t.ms + 5_000 + ADD_MS });
  assert.equal(late.end - late.ms, t.end - t.ms);
});

test("the phase is read from the end instant alone: the same answer for a throttled tab, a reload and a clock jump", () => {
  const t = begin(1, 0);
  assert.deepEqual(phase(null, 0), { name: "idle" });
  assert.deepEqual(phase(t, 0), { name: "running", left: 60_000, ms: 60_000 });
  assert.deepEqual(phase(t, 59_999), { name: "running", left: 1, ms: 60_000 });
  assert.deepEqual(phase(t, 60_000), { name: "ended", ago: 0 });
  assert.deepEqual(phase(t, 90_000), { name: "ended", ago: 30_000 });
  assert.deepEqual(phase(t, 60_000 + STALE_MS), { name: "ended", ago: STALE_MS });
  assert.deepEqual(phase(t, 60_001 + STALE_MS), { name: "idle" });
  assert.deepEqual(phase(t, -5_000), { name: "running", left: 60_000, ms: 60_000 });
  const long = begin(180, 0);
  assert.deepEqual(phase(long, 10 * 60_000 + 500), { name: "running", left: 170 * 60_000 - 500, ms: 180 * 60_000 });
  assert.ok(FRESH_MS > 0 && FRESH_MS < STALE_MS);
});

test("the countdown reads m:ss under an hour and h:mm:ss from an hour, rounding up so zero shows only at the end", () => {
  assert.equal(clock(0), "0:00");
  assert.equal(clock(1), "0:01");
  assert.equal(clock(1_000), "0:01");
  assert.equal(clock(1_001), "0:02");
  assert.equal(clock(59_000), "0:59");
  assert.equal(clock(60_000), "1:00");
  assert.equal(clock(45 * 60_000), "45:00");
  assert.equal(clock(3_599_000), "59:59");
  assert.equal(clock(3_600_000), "1:00:00");
  assert.equal(clock(3 * 3_600_000), "3:00:00");
  assert.equal(clock(3 * 3_600_000 + 61_000), "3:01:01");
});

test("the countdown puts hours, minutes and seconds in that order", () => {
  assert.equal(clock(2 * 3_600_000 + 3 * 60_000 + 7_000), "2:03:07");
  assert.equal(clock(7 * 3_600_000 + 25 * 60_000 + 9_000), "7:25:09");
  assert.equal(clock(65_000), "1:05");
  assert.equal(clock(9 * 60_000 + 41_000), "9:41");
});

test("the three timer limits are one minute, one hour and two minutes", () => {
  assert.equal(ADD_MS, 60_000);
  assert.equal(STALE_MS, 3_600_000);
  assert.equal(FRESH_MS, 120_000);
});

test("the share of the timer used grows from 0 to 1", () => {
  const t = begin(10, 0);
  const at = (now: number) => share(phase(t, now) as Extract<ReturnType<typeof phase>, { name: "running" }>);
  assert.equal(at(0), 0);
  assert.equal(at(300_000), 0.5);
  assert.ok(at(599_000) < 1);
});

test("a stored timer is read back only when it is well formed, and its key names the routine and the action", () => {
  const t = begin(5, 123);
  assert.deepEqual(parse(JSON.stringify(t)), t);
  assert.deepEqual(parse('{"end":1,"ms":1}'), { end: 1, ms: 1 });
  assert.deepEqual(parse('{"end":-1,"ms":0.5}'), { end: -1, ms: 0.5 });
  for (const raw of [null, "", "{", "[]", "null", "{}", '{"end":1}', '{"end":"1","ms":2}', '{"end":1,"ms":0}', '{"end":1,"ms":-5}', '{"end":null,"ms":5}', '{"end":1e999,"ms":5}']) assert.equal(parse(raw), null, String(raw));
  assert.equal(timerKey("a", "r1", "a1"), "wp.timer.a.r1.a1");
  assert.notEqual(timerKey("a", "r1", "a1"), timerKey("a", "r1", "a2"));
  assert.notEqual(timerKey("a", "r1", "a1"), timerKey("b", "r1", "a1"));
});

test("the spoken time lists hours, minutes and seconds with plurals, and says zero plainly", () => {
  const spoken = text.routines.start.timer.spoken;
  assert.equal(spoken(1_000), "1 second");
  assert.equal(spoken(61_000), "1 minute 1 second");
  assert.equal(spoken(2 * 3_600_000), "2 hours");
  assert.equal(spoken(3_600_000 + 2 * 60_000 + 5_000), "1 hour 2 minutes 5 seconds");
  assert.equal(spoken(0), "0 seconds");
  assert.equal(spoken(500), "1 second");
});

const sentinel = () => {
  const listeners: (() => void)[] = [];
  const s = { released: 0, types: [] as string[], release: async () => void s.released++, addEventListener: (type: "release", listener: () => void) => (s.types.push(type), void listeners.push(listener)), fire: () => listeners.forEach((listener) => listener()) };
  return s;
};

const lock = (api: Parameters<typeof keepAwake>[0]) => {
  const seen: WakeState[] = [];
  return { seen, ...keepAwake(api, (state) => seen.push(state)) };
};

test("the wake lock holds the screen after a request and releases it on exit", async () => {
  const s = sentinel();
  const calls: string[] = [];
  const w = lock({ request: async (type) => (calls.push(type), s) });
  await w.acquire();
  assert.deepEqual([calls, w.seen], [["screen"], ["held"]]);
  await w.acquire();
  assert.equal(calls.length, 1);
  await w.release();
  assert.deepEqual([s.released, w.seen.at(-1)], [1, "idle"]);
  await w.release();
  assert.equal(s.released, 1);
});

test("a browser that has no wake lock, or refuses it, gives a state and never an error", async () => {
  const none = lock(undefined);
  await none.acquire();
  assert.deepEqual(none.seen, ["unavailable"]);
  const denied = lock({ request: async () => Promise.reject(new DOMException("battery saver", "NotAllowedError")) });
  await denied.acquire();
  assert.deepEqual(denied.seen, ["unavailable"]);
  const sync = lock({ request: () => { throw new Error("sync throw"); } });
  await sync.acquire();
  assert.deepEqual(sync.seen, ["unavailable"]);
});

test("the browser releasing the lock when the page is hidden is noticed, and the next request takes it again", async () => {
  const first = sentinel();
  const second = sentinel();
  const queue = [first, second];
  const w = lock({ request: async () => queue.shift()! });
  await w.acquire();
  first.fire();
  assert.deepEqual(w.seen, ["held", "idle"]);
  await w.acquire();
  assert.deepEqual(w.seen, ["held", "idle", "held"]);
  first.fire();
  assert.equal(w.seen.length, 3);
});

test("a request that is refused while hidden is retried and succeeds, and a release during a pending request is honoured", async () => {
  const s = sentinel();
  let refuse = true;
  const w = lock({ request: async () => (refuse ? Promise.reject(new Error("hidden")) : s) });
  await w.acquire();
  refuse = false;
  await w.acquire();
  assert.deepEqual(w.seen, ["unavailable", "held"]);

  const late = sentinel();
  let finish: (value: typeof late) => void = () => {};
  const slow = lock({ request: () => new Promise((resolve) => (finish = resolve as typeof finish)) });
  const pending = slow.acquire();
  await slow.release();
  finish(late);
  await pending;
  assert.equal(late.released, 1);
  assert.equal(slow.seen.includes("held"), false);

  const again = sentinel();
  let done: (value: typeof again) => void = () => {};
  const swap = lock({ request: () => new Promise((resolve) => (done = resolve as typeof done)) });
  const first = swap.acquire();
  await swap.release();
  const second = swap.acquire();
  done(again);
  await Promise.all([first, second]);
  assert.equal(again.released, 0);
  assert.equal(swap.seen.at(-1), "held");
});

test("the lock listens for the browser's own release event, and a release that fails is swallowed", async () => {
  const s = sentinel();
  const w = lock({ request: async () => s });
  await w.acquire();
  assert.deepEqual(s.types, ["release"]);

  const stuck = { ...sentinel(), release: () => Promise.reject(new Error("gone")) };
  const held = lock({ request: async () => stuck });
  await held.acquire();
  await held.release();
  assert.equal(held.seen.at(-1), "idle");

  let finish: (value: typeof stuck) => void = () => {};
  const late = lock({ request: () => new Promise((resolve) => (finish = resolve as typeof finish)) });
  const pending = late.acquire();
  await late.release();
  finish(stuck);
  await pending;
  assert.deepEqual(late.seen, ["idle"]);
});
