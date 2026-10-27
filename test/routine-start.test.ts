import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY_CODES, weekDates } from "../shared/routines.ts";
import type { ItemRow } from "../shared/tables.ts";
import { SETTLE_MS, clampTo, follow, hasWork, heldOffer, isOpen, leadOf, offerOf, openCount, pagesOf, placeAt, placeOf, position, screenOf, settled } from "../src/domain/routine-start.ts";
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

const places = (pages: ItemRow[][]) => pages.map((page) => page[0].id);

test("a place names the page by its first action and keeps the index as a fallback", () => {
  const r = routine();
  const rows = [action(r, "item 1"), action(r, "item 2"), action(r, "item 3", "pack"), action(r, "item 4", "pack")];
  const pages = pagesOf(rows);
  assert.deepEqual(placeOf(pages, 1), { id: rows[1].id, rest: [rows[1].id, rows[2].id, rows[3].id] });
  assert.deepEqual(placeOf(pages, 2), { id: rows[2].id, rest: [rows[2].id, rows[3].id] });
  assert.deepEqual(placeOf(pages, 3), { id: null, rest: [] });
  assert.deepEqual(placeOf([], 0), { id: null, rest: [] });
});

test("a page found by its id stays current when an earlier action is removed, added or reordered elsewhere", () => {
  const r = routine();
  const [one, two, three] = [action(r, "item 1"), action(r, "item 2"), action(r, "item 3")];
  const place = placeOf(pagesOf([one, two, three]), 1);
  assert.equal(placeAt(pagesOf([two, three]), place), 0);
  assert.equal(placeAt(pagesOf([one, two, three]), place), 1);
  assert.equal(placeAt(pagesOf([action(r, "item 4"), one, two, three]), place), 2);
  assert.equal(placeAt(pagesOf([three, two, one]), place), 1);
  assert.equal(placeAt(pagesOf([three, one, two]), place), 2);
  assert.equal(places(pagesOf([two, three]))[placeAt(pagesOf([two, three]), place)], two.id);
});

test("a page whose first item is removed is still found by another item of it, and a removed page falls back to its old position", () => {
  const r = routine();
  const pack = [action(r, "item 1", "pack"), action(r, "item 2", "pack")];
  const place = { id: pack[1].id, rest: [pack[1].id] };
  const before = action(r, "item 0");
  assert.equal(placeAt(pagesOf([before, ...pack]), place), 1);
  assert.equal(placeAt(pagesOf([before, action(r, "item 7"), ...pack]), place), 2);
  assert.equal(placeAt(pagesOf([before, pack[1]]), place), 1);
  const rows = [action(r, "item 3"), action(r, "item 4"), action(r, "item 5")];
  const gone = { id: "00000000-0000-4000-8000-00000000ffff", rest: [rows[1].id, rows[2].id] };
  assert.equal(placeAt(pagesOf(rows), gone), 1);
  assert.equal(placeAt(pagesOf([rows[0], rows[2]]), gone), 1);
  assert.equal(placeAt(pagesOf(rows.slice(0, 1)), gone), 1);
  assert.equal(placeAt(pagesOf(rows), { id: gone.id, rest: [] }), 3);
});

test("the end of the list stays the end when an action is added, and an empty list has only the end", () => {
  const r = routine();
  const rows = [action(r, "item 1"), action(r, "item 2")];
  assert.equal(placeAt(pagesOf(rows), { id: null, rest: [] }), 2);
  assert.equal(placeAt(pagesOf([...rows, action(r, "item 3")]), { id: null, rest: [] }), 3);
  assert.equal(placeAt([], { id: "x", rest: ["x"] }), 0);
});

test("the screen is the page at the place, the end when the place is past the last page, and idle when nothing can be ticked", () => {
  const r = routine();
  const rows = [action(r, "item 1"), action(r, "item 2"), action(r, "item 3", "text")];
  const pages = pagesOf(rows);
  const first = screenOf(pages, placeOf(pages, 0), "a", DAY);
  assert.deepEqual([first.kind, first.at, first.open], ["page", 0, 2]);
  assert.equal(first.kind === "page" && first.page[0].id, rows[0].id);
  const end = screenOf(pages, placeOf(pages, 3), "a", DAY);
  assert.deepEqual([end.kind, end.at, end.open], ["end", 3, 2]);
  const ticks = rows.map((row, index) => (index < 2 ? ticked(row) : row));
  const finished = screenOf(pagesOf(ticks), placeOf(pagesOf(ticks), 3), "a", DAY);
  assert.deepEqual([finished.kind, finished.open], ["end", 0]);
  const notes = pagesOf([action(r, "item 4", "text"), action(r, "item 5", "day_type")]);
  assert.deepEqual([screenOf(notes, placeOf(notes, 0), "a", DAY).kind, screenOf(notes, placeOf(notes, 2), "a", DAY).kind], ["idle", "idle"]);
  assert.deepEqual(screenOf([], placeOf([], 0), "a", DAY), { kind: "idle", at: 0, open: 0 });
});

test("an earlier page removed while a later one is current leaves the screen on the same page", () => {
  const r = routine();
  const rows = [action(r, "item 1"), action(r, "item 2", "timer", { data: { minutes: 5 } }), action(r, "item 3")];
  const place = placeOf(pagesOf(rows), 1);
  const after = pagesOf(rows.slice(1));
  const screen = screenOf(after, place, "a", DAY);
  assert.equal(screen.kind === "page" && screen.page[0].id, rows[1].id);
  assert.equal(screen.at, 0);
  assert.deepEqual(placeOf(after, screen.at), { id: rows[1].id, rest: [rows[1].id, rows[2].id] });
});

const stepsOn = (place: ReturnType<typeof placeOf>, rows: readonly ItemRow[], ticks: ReadonlySet<string> = new Set()) => {
  const shown = rows.map((row) => (ticks.has(row.id) ? ticked(row) : row));
  const pages = pagesOf(shown);
  const screen = screenOf(pages, place, "a", DAY);
  return { title: screen.kind === "page" ? screen.page[0].title : null, at: screen.at, open: screen.open, next: follow(pages, place) };
};

test("deleting an earlier action and then the current one lands on the action that followed it, never one further", () => {
  const r = routine();
  const rows = ["item 1", "item 2", "item 3", "item 4", "item 5"].map((title) => action(r, title));
  const [one, two, three, four, five] = rows;
  const start = placeOf(pagesOf(rows), 2);
  const ticks = new Set([one.id, five.id]);
  const asked = (kept: readonly ItemRow[], place: typeof start) => stepsOn(place, kept, ticks);

  const earlier = asked([two, three, four, five], start);
  assert.deepEqual([earlier.title, earlier.at, earlier.open], ["item 3", 1, 3]);
  const gone = asked([two, four, five], earlier.next);
  assert.deepEqual([gone.title, gone.at, gone.open], ["item 4", 1, 2]);

  const swapped = asked([one, two, four, five], start);
  assert.deepEqual([swapped.title, swapped.at], ["item 4", 2]);
  const then = asked([two, four, five], swapped.next);
  assert.deepEqual([then.title, then.at, then.open], ["item 4", 1, 2]);

  const together = asked([two, four, five], start);
  assert.deepEqual([together.title, together.at, together.open], ["item 4", 1, 2]);
  const last = asked([two, three, four], placeOf(pagesOf([two, three, four]), 2));
  assert.equal(asked([two, three], last.next).title, null);
  assert.equal(asked([two, three], last.next).at, 2);
});

test("following a place keeps the very same place while nothing changed, and renews it when the later pages or the current one changed", () => {
  const r = routine();
  const [one, two, three] = [action(r, "item 1"), action(r, "item 2"), action(r, "item 3")];
  const pages = pagesOf([one, two, three]);
  for (const at of [0, 1, 2, 3]) {
    const place = placeOf(pages, at);
    assert.equal(follow(pages, place), place);
    assert.equal(placeAt(pages, place), at);
  }
  const place = placeOf(pages, 1);
  assert.deepEqual(follow(pagesOf([one, two]), place), { id: two.id, rest: [two.id] });
  assert.deepEqual(follow(pagesOf([three, two, one]), place), { id: two.id, rest: [two.id, one.id] });
  assert.deepEqual(follow(pagesOf([one, three]), place), { id: three.id, rest: [three.id] });
  assert.deepEqual(follow(pagesOf([one]), place), { id: null, rest: [] });
});

test("a moved current action is found where it went, and a pack that loses its first item stays on the rest of it", () => {
  const r = routine();
  const [one, two, three] = [action(r, "item 1"), action(r, "item 2"), action(r, "item 3")];
  const moved = stepsOn(placeOf(pagesOf([one, two, three]), 1), [one, three, two]);
  assert.deepEqual([moved.title, moved.at], ["item 2", 2]);
  const pack = [action(r, "item 4", "pack"), action(r, "item 5", "pack")];
  const place = placeOf(pagesOf([one, ...pack, three]), 1);
  const rest = stepsOn(place, [one, pack[1], three]);
  assert.deepEqual([rest.title, rest.at], ["item 5", 1]);
});

test("the button that leads a page is Done for something to tick, Next once it is ticked or when it cannot be ticked, and +1 for a counter below its target", () => {
  const r = routine();
  const step = action(r, "item 1");
  const timer = action(r, "item 2", "timer", { data: { minutes: 5 } });
  const counter = action(r, "item 3", "counter", { qty: 2 });
  const lead = (row: ItemRow, side: "a" | "b" = "a") => leadOf(row, side, DAY);
  assert.deepEqual([lead(step), lead(timer), lead(counter)], ["done", "done", "plus"]);
  assert.deepEqual([lead(ticked(step)), lead(ticked(timer))], ["next", "next"]);
  assert.equal(lead(ticked(step), "b"), "done");
  assert.equal(lead(ticked(step, "2026-10-25")), "done");
  assert.equal(lead({ ...counter, data: { done_a: DAY, value_a: 1 } }), "plus");
  assert.equal(lead({ ...counter, data: { done_a: DAY, value_a: 2 } }), "next");
  assert.equal(lead({ ...counter, data: { done_a: "2026-10-25", value_a: 2 } }), "plus");
  for (const kind of ["text", "day_type", "pack", "block"]) assert.equal(lead(action(r, "item 4", kind)), "next");
});

const steps = (parent: ItemRow, count: number, kind = "step") => Array.from({ length: count }, (_, at) => action(parent, `item ${at + 1}`, kind));

test("Step by step is offered for a timer or four open steps, and for nothing else", () => {
  const r = routine();
  assert.equal(offerOf(r, steps(r, 3), "a", DAY), null);
  assert.equal(offerOf(r, steps(r, 4), "a", DAY), "start");
  assert.equal(offerOf(r, [action(r, "item 1"), action(r, "item 2", "timer", { data: { minutes: 5 } })], "a", DAY), "start");
  assert.equal(offerOf(r, [action(r, "item 1", "timer", { data: { minutes: 5 } })], "a", DAY), "start");
  assert.equal(offerOf(r, [], "a", DAY), null);
  assert.equal(offerOf(r, steps(r, 1), "a", DAY), null);
});

test("an items-only, a counter-only, a note-only and a finished routine are never offered it", () => {
  const r = routine();
  assert.equal(offerOf(r, steps(r, 6, "pack"), "a", DAY), null);
  assert.equal(offerOf(r, [action(r, "item 1", "counter", { qty: 2 })], "a", DAY), null);
  assert.equal(offerOf(r, steps(r, 5, "counter"), "a", DAY), null);
  assert.equal(offerOf(r, [...steps(r, 5, "text"), ...steps(r, 5, "block"), ...steps(r, 5, "day_type")], "a", DAY), null);
  assert.equal(offerOf(r, [...steps(r, 3), ...steps(r, 6, "pack")], "a", DAY), null);
  assert.equal(offerOf(r, steps(r, 4).map((row) => ticked(row)), "a", DAY), null);
  const timer = action(r, "item 1", "timer", { data: { minutes: 5 } });
  assert.equal(offerOf(r, [ticked(timer)], "a", DAY), null);
  assert.equal(offerOf(r, [ticked(timer), action(r, "item 2")], "a", DAY), null);
});

test("a paused routine, a routine that does not run today and an action that does not run today never count", () => {
  const paused = routine({ paused_until: "2026-10-30" });
  assert.equal(offerOf(paused, steps(paused, 5), "a", DAY), null);
  const lapsed = routine({ paused_until: DAY });
  assert.equal(offerOf(lapsed, steps(lapsed, 5), "a", DAY), "start");
  const tuesday = routine({ days: "TU" });
  assert.equal(offerOf(tuesday, steps(tuesday, 5), "a", DAY), null);
  assert.equal(offerOf(tuesday, steps(tuesday, 5), "a", "2026-10-27"), "start");
  const r = routine();
  const mixed = [...steps(r, 3), action(r, "item 4", "step", { data: { days: "TU" } })];
  assert.equal(offerOf(r, mixed, "a", DAY), null);
  assert.equal(offerOf(r, mixed, "a", "2026-10-27"), "start");
  const other = routine();
  assert.equal(offerOf(r, steps(other, 5), "a", DAY), null);
  const elsewhere = [...steps(r, 4), ticked(action(r, "item 5", "step", { data: { days: "TU" } }))];
  assert.equal(offerOf(r, elsewhere, "a", DAY), "start");
});

test("it reads Continue once something is ticked, and goes away when fewer than four steps are left", () => {
  const r = routine();
  const five = steps(r, 5);
  assert.equal(offerOf(r, [ticked(five[0]), ...five.slice(1)], "a", DAY), "continue");
  assert.equal(offerOf(r, [ticked(five[0], "2026-10-25"), ...five.slice(1)], "a", DAY), "start");
  assert.equal(offerOf(r, [ticked(five[0]), ticked(five[1]), ...five.slice(2)], "a", DAY), null);
  const timer = action(r, "item 6", "timer", { data: { minutes: 5 } });
  assert.equal(offerOf(r, [ticked(five[0]), ticked(five[1]), ticked(five[2]), ticked(five[3]), ticked(five[4]), timer], "a", DAY), "continue");
  const pack = action(r, "item 7", "pack");
  assert.equal(offerOf(r, [ticked(pack), ...five], "a", DAY), "continue");
});

test("ticks are read for the side that is asking", () => {
  const r = routine({}, { who: "both" });
  const four = steps(r, 4);
  const theirs = four.map((row) => ({ ...row, data: { done_a: DAY } }));
  assert.equal(offerOf(r, theirs, "a", DAY), null);
  assert.equal(offerOf(r, theirs, "b", DAY), "start");
  assert.equal(offerOf(r, [{ ...four[0], data: { done_a: DAY } }, ...four.slice(1)], "b", DAY), "start");
  assert.equal(offerOf(r, [{ ...four[0], data: { done_b: DAY } }, ...four.slice(1)], "b", DAY), null);
});

test("an offer already on screen stays while the routine is worked down, and goes when it is finished or stops running", () => {
  assert.equal(heldOffer("start", null, false), "start");
  assert.equal(heldOffer("continue", "start", false), "continue");
  assert.equal(heldOffer(null, "continue", false), "continue");
  assert.equal(heldOffer(null, null, false), null);
  assert.equal(heldOffer(null, "continue", true), null);
  assert.equal(heldOffer("start", "start", true), null);
});
