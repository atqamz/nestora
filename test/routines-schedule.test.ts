import { test } from "node:test";
import assert from "node:assert/strict";
import { applyPatch } from "../shared/api.ts";
import {
  DAY_CODES,
  actionOccursOn,
  count,
  dayLabel,
  isDone,
  keyFor,
  mark,
  mine,
  occursOn,
  progress,
  routineDay,
  scheduled,
  unmark,
  weekday,
  weeklyPattern,
} from "../shared/routines.ts";
import type { Schedule } from "../shared/routines.ts";
import type { ItemRow } from "../shared/tables.ts";
import { item } from "./domain-rows.ts";

const routine = (schedule: Schedule = {}, extra: Partial<ItemRow> = {}) =>
  item({ kind: "routine", status: null, who: "a", title: "Morning routine", data: { ...schedule }, ...extra });
const step = (parent: ItemRow, data: Record<string, unknown> | null = null, extra: Partial<ItemRow> = {}) =>
  item({ kind: "step", status: null, parent_id: parent.id, title: "item 1", data, ...extra });
const action = (kind: string, parent: ItemRow, data: Record<string, unknown> | null = null, extra: Partial<ItemRow> = {}) =>
  item({ kind, status: null, parent_id: parent.id, title: "item 1", data, ...extra });

const mulberry = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86_400_000;
const day = (date: string, offset = 0) => iso(Date.parse(`${date}T00:00:00Z`) + offset * DAY);

test("weekday agrees with the calendar for every date from 2020 to 2035", () => {
  for (let ms = Date.UTC(2020, 0, 1); ms < Date.UTC(2036, 0, 1); ms += DAY) {
    assert.equal(weekday(iso(ms)), DAY_CODES[(new Date(ms).getUTCDay() + 6) % 7], iso(ms));
  }
  assert.equal(weekday("2026-10-19"), "MO");
  assert.equal(weekday("2026-10-25"), "SU");
  assert.equal(weekday("1970-01-01"), "TH");
});

test("the routine day starts at 04:00 in Jakarta, which is 21:00 UTC", () => {
  const cases: [string, string][] = [
    ["2026-10-23T20:59:59Z", "2026-10-23"],
    ["2026-10-23T21:00:00Z", "2026-10-24"],
    ["2026-10-24T00:00:00Z", "2026-10-24"],
    ["2026-10-24T16:59:59Z", "2026-10-24"],
    ["2026-10-24T17:00:00Z", "2026-10-24"],
    ["2026-10-24T20:59:59Z", "2026-10-24"],
    ["2026-10-24T21:00:00Z", "2026-10-25"],
    ["2026-12-31T20:59:59Z", "2026-12-31"],
    ["2026-12-31T21:00:00Z", "2027-01-01"],
    ["2028-02-28T21:00:00Z", "2028-02-29"],
    ["2028-02-29T20:59:59Z", "2028-02-29"],
    ["2026-03-01T00:00:00Z", "2026-03-01"],
  ];
  for (const [instant, routineDate] of cases) {
    assert.equal(routineDay(new Date(instant)), routineDate, instant);
  }
});

test("the routine day never goes back, and changes exactly at 21:00:00 UTC", () => {
  const random = mulberry(1);
  let previous = routineDay(new Date(Date.UTC(2026, 0, 1)));
  for (let ms = Date.UTC(2026, 0, 1); ms < Date.UTC(2027, 0, 1); ms += Math.floor(random() * 6 * 3_600_000) + 1000) {
    const now = routineDay(new Date(ms));
    assert.ok(now >= previous);
    assert.equal(routineDay(new Date(ms)), iso(ms - 21 * 3_600_000 + DAY));
    previous = now;
  }
  const edge = Date.UTC(2026, 5, 10, 21);
  assert.notEqual(routineDay(new Date(edge - 1000)), routineDay(new Date(edge)));
  assert.equal(routineDay(new Date(edge)), routineDay(new Date(edge + 86_399_000)));
});

test("a routine without a rule happens every day", () => {
  const r = routine();
  const bare = item({ kind: "routine", who: "a", data: null });
  for (let i = 0; i < 400; i++) {
    assert.equal(occursOn(r, day("2026-01-01", i)), true);
    assert.equal(occursOn(bare, day("2026-01-01", i)), true);
  }
});

test("days limit the weekdays, each code on its own", () => {
  for (const [index, code] of DAY_CODES.entries()) {
    const r = routine({ days: code });
    for (let i = 0; i < 14; i++) assert.equal(occursOn(r, day("2026-10-19", i)), i % 7 === index, `${code} ${i}`);
  }
  const r = routine({ days: "MO,TH" });
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].filter((i) => occursOn(r, day("2026-10-19", i))), [0, 3]);
  const all = routine({ days: DAY_CODES.join(",") });
  for (let i = 0; i < 14; i++) assert.equal(occursOn(all, day("2026-10-19", i)), true);
});

test("from and until are inclusive and each is optional", () => {
  const r = routine({ from: "2026-10-20", until: "2026-10-22" });
  assert.deepEqual([18, 19, 20, 21, 22, 23, 24].map((d) => occursOn(r, `2026-10-${d}`)), [false, false, true, true, true, false, false]);
  assert.equal(occursOn(routine({ from: "2026-10-20" }), "2026-10-19"), false);
  assert.equal(occursOn(routine({ from: "2026-10-20" }), "2030-01-01"), true);
  assert.equal(occursOn(routine({ until: "2026-10-20" }), "2020-01-01"), true);
  assert.equal(occursOn(routine({ until: "2026-10-20" }), "2026-10-21"), false);
  assert.equal(occursOn(routine({ from: "2026-10-20", until: "2026-10-20" }), "2026-10-20"), true);
});

test("paused until skips the dates before it and resumes on it", () => {
  const r = routine({ paused_until: "2026-11-02" });
  assert.equal(occursOn(r, "2026-10-31"), false);
  assert.equal(occursOn(r, "2026-11-01"), false);
  assert.equal(occursOn(r, "2026-11-02"), true);
  assert.equal(occursOn(r, "2026-11-03"), true);
  assert.equal(occursOn(r, "2026-01-01"), false);
  const weekly = routine({ days: "MO", paused_until: "2026-11-02" });
  assert.deepEqual(["2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09"].map((d) => occursOn(weekly, d)), [false, false, true, true]);
});

test("every n weeks counts whole calendar weeks from the week of from", () => {
  const sunday = routine({ days: "SU", every_weeks: "2", from: "2026-10-04" });
  assert.deepEqual(["2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25", "2026-11-01"].map((d) => occursOn(sunday, d)), [true, false, true, false, true]);
  const wednesday = routine({ days: "MO", every_weeks: "2", from: "2026-10-07" });
  assert.deepEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02"].map((d) => occursOn(wednesday, d)), [false, false, true, false, true]);
  const third = routine({ days: "FR", every_weeks: "3", from: "2026-10-02" });
  assert.deepEqual([2, 9, 16, 23, 30].map((d) => occursOn(third, `2026-10-${String(d).padStart(2, "0")}`)), [true, false, false, true, false]);
  assert.equal(occursOn(third, "2026-11-13"), true);
  const fourth = routine({ days: "SA", every_weeks: "4", from: "2026-10-03" });
  assert.deepEqual(["2026-10-03", "2026-10-10", "2026-10-31", "2026-11-07", "2026-11-28"].map((d) => occursOn(fourth, d)), [true, false, true, false, true]);
  const weekly = routine({ days: "SA", every_weeks: "1", from: "2026-10-03" });
  assert.equal(occursOn(weekly, "2026-10-10"), true);
});

test("the week starts on Monday, so a Sunday from belongs to the week before the next Monday", () => {
  const r = routine({ every_weeks: "2", from: "2026-10-04" });
  assert.equal(occursOn(r, "2026-10-04"), true);
  assert.equal(occursOn(r, "2026-10-05"), false);
  assert.equal(occursOn(r, "2026-10-11"), false);
  assert.equal(occursOn(r, "2026-10-18"), true);
  assert.equal(occursOn(r, "2026-10-19"), false);
  assert.equal(occursOn(r, "2026-10-26"), true);
  const monday = routine({ every_weeks: "2", from: "2026-10-05" });
  assert.deepEqual(["2026-10-05", "2026-10-11", "2026-10-12", "2026-10-18", "2026-10-19", "2026-10-25"].map((d) => occursOn(monday, d)), [true, true, false, false, true, true]);
});

test("a cadence needs a start; without from it is ignored", () => {
  const r = routine({ days: "MO", every_weeks: "2" });
  assert.deepEqual(["2026-10-12", "2026-10-19", "2026-10-26"].map((d) => occursOn(r, d)), [true, true, true]);
});

test("holidays are skipped only when the routine asks for it", () => {
  const holidays = ["2026-10-20", "2026-12-25"];
  assert.equal(occursOn(routine({ holidays: true }), "2026-10-20", holidays), false);
  assert.equal(occursOn(routine({ holidays: true }), "2026-10-21", holidays), true);
  assert.equal(occursOn(routine({ holidays: false }), "2026-10-20", holidays), true);
  assert.equal(occursOn(routine({}), "2026-10-20", holidays), true);
  assert.equal(occursOn(routine({ holidays: true }), "2026-10-20"), true);
  assert.equal(occursOn(routine({ holidays: true, days: "SU" }), "2026-10-25", holidays), true);
  assert.equal(occursOn(routine({ holidays: true, days: "FR" }), "2026-12-25", holidays), false);
});

const reference = (schedule: Schedule, date: string, holidays: string[]) => {
  const dt = new Date(`${date}T00:00:00Z`);
  const mondayOf = (d: Date) => new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY);
  if (schedule.days !== undefined && !schedule.days.split(",").includes(DAY_CODES[(dt.getUTCDay() + 6) % 7])) return false;
  if (schedule.from !== undefined && date < schedule.from) return false;
  if (schedule.until !== undefined && date > schedule.until) return false;
  if (schedule.paused_until !== undefined && date < schedule.paused_until) return false;
  if (schedule.every_weeks !== undefined && schedule.from !== undefined) {
    let weeks = 0;
    for (let w = mondayOf(new Date(`${schedule.from}T00:00:00Z`)); w < mondayOf(dt); w = new Date(w.getTime() + 7 * DAY)) weeks++;
    if (weeks % Number(schedule.every_weeks) !== 0) return false;
  }
  return !(schedule.holidays === true && holidays.includes(date));
};

test("occursOn agrees with a brute-force reference on 20000 random schedules and dates", () => {
  const random = mulberry(7);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  const around = () => day("2026-09-01", Math.floor(random() * 200));
  for (let i = 0; i < 20000; i++) {
    const schedule: Schedule = {};
    if (random() < 0.6) schedule.days = DAY_CODES.filter(() => random() < 0.4).join(",") || pick(DAY_CODES);
    if (random() < 0.5) schedule.every_weeks = pick(["1", "2", "3", "4"]);
    if (random() < 0.7) schedule.from = around();
    if (random() < 0.4) schedule.until = around();
    if (random() < 0.4) schedule.paused_until = around();
    if (random() < 0.5) schedule.holidays = random() < 0.8;
    const holidays = Array.from({ length: 6 }, around);
    const date = random() < 0.2 ? pick(holidays) : around();
    assert.equal(occursOn(routine(schedule), date, holidays), reference(schedule, date, holidays), JSON.stringify({ schedule, date, holidays }));
  }
});

test("a single-day cadence of n weeks has occurrences exactly 7n days apart, starting in the first full week", () => {
  const random = mulberry(11);
  for (let i = 0; i < 200; i++) {
    const n = 1 + Math.floor(random() * 4);
    const code = DAY_CODES[Math.floor(random() * 7)];
    const from = day("2026-06-01", Math.floor(random() * 120));
    const r = routine({ days: code, every_weeks: String(n), from });
    const hits = Array.from({ length: 7 * n * 6 }, (_, k) => day(from, k)).filter((d) => occursOn(r, d));
    assert.ok(hits.length >= 5);
    for (let k = 1; k < hits.length; k++) assert.equal((Date.parse(hits[k]) - Date.parse(hits[k - 1])) / DAY, 7 * n);
    assert.ok(Date.parse(hits[0]) - Date.parse(from) < 7 * n * DAY);
  }
});

test("pausing never adds an occurrence and removes exactly those before the pause ends", () => {
  const random = mulberry(13);
  for (let i = 0; i < 300; i++) {
    const base: Schedule = { days: DAY_CODES.filter(() => random() < 0.5).join(",") || "MO", from: day("2026-09-01", Math.floor(random() * 30)) };
    const paused = day("2026-10-01", Math.floor(random() * 60));
    for (let k = 0; k < 90; k++) {
      const date = day("2026-09-01", k);
      const without = occursOn(routine(base), date);
      assert.equal(occursOn(routine({ ...base, paused_until: paused }), date), date >= paused && without);
    }
  }
});

test("an action shows when its routine does and its own days include the weekday", () => {
  const r = routine({ days: "MO,TH", from: "2026-10-01" });
  const always = step(r);
  const mondays = step(r, { days: "MO" });
  const fridays = step(r, { days: "FR" });
  const elsewhere = step(routine());
  const holidayRoutine = routine({ holidays: true });
  const onHoliday = step(holidayRoutine);
  assert.deepEqual([always, mondays, fridays, elsewhere].map((a) => actionOccursOn(r, a, "2026-10-19")), [true, true, false, false]);
  assert.deepEqual([always, mondays, fridays].map((a) => actionOccursOn(r, a, "2026-10-22")), [true, false, false]);
  assert.deepEqual([always, mondays, fridays].map((a) => actionOccursOn(r, a, "2026-10-23")), [false, false, false]);
  assert.equal(actionOccursOn(r, always, "2026-09-28"), false);
  assert.equal(actionOccursOn(holidayRoutine, onHoliday, "2026-10-20", ["2026-10-20"]), false);
  assert.equal(actionOccursOn(holidayRoutine, onHoliday, "2026-10-21", ["2026-10-20"]), true);
});

test("scheduled lists the live routines of a date with their live actions in order", () => {
  const monday = routine({ days: "MO,TH" }, { title: "Evening routine", sort: 2 });
  const daily = routine({}, { title: "Bag checklist", sort: 1 });
  const gone = routine({}, { deleted_at: "2026-10-20T00:00:00Z" });
  const later = routine({ from: "2026-12-01" });
  const rows = [
    monday,
    daily,
    step(monday, null, { sort: 5, title: "item 3" }),
    step(monday, null, { sort: 1, title: "item 1" }),
    step(monday, { days: "TU" }, { sort: 3, title: "item 2" }),
    step(monday, null, { sort: 2, title: "item 4", deleted_at: "2026-10-20T00:00:00Z" }),
    action("pack", daily, null, { title: "item 5" }),
    gone,
    step(gone),
    later,
    step(later),
    item({ kind: "task", title: "Task" }),
  ];
  const mondayRows = scheduled(rows, "2026-10-19");
  assert.deepEqual(mondayRows.map((s) => s.routine.title), ["Bag checklist", "Evening routine"]);
  assert.deepEqual(mondayRows[1].actions.map((a) => a.title), ["item 1", "item 3"]);
  assert.deepEqual(mondayRows[0].actions.map((a) => a.title), ["item 5"]);
  assert.deepEqual(scheduled(rows, "2026-10-20").map((s) => s.routine.title), ["Bag checklist"]);
  assert.deepEqual(scheduled(rows, "2026-12-01").map((s) => s.routine.id).sort(), [daily.id, later.id].sort());
  assert.deepEqual(scheduled([], "2026-10-19"), []);
});

test("scheduled orders equal sorts by creation and id and never mixes routines", () => {
  const r = routine();
  const first = step(r, null, { sort: 1, created_at: "2026-10-01T00:00:00Z", id: "00000000-0000-4000-8000-0000000000b2" });
  const second = step(r, null, { sort: 1, created_at: "2026-10-01T00:00:00Z", id: "00000000-0000-4000-8000-0000000000a1" });
  const third = step(r, null, { sort: 1, created_at: "2026-10-02T00:00:00Z", id: "00000000-0000-4000-8000-0000000000a0" });
  const [entry] = scheduled([r, third, first, second], "2026-10-19");
  assert.deepEqual(entry.actions.map((a) => a.id), [second.id, first.id, third.id]);
});

test("a routine belongs to its owner and to both", () => {
  assert.deepEqual((["a", "b"] as const).map((side) => mine(routine({}, { who: "a" }), side)), [true, false]);
  assert.deepEqual((["a", "b"] as const).map((side) => mine(routine({}, { who: "b" }), side)), [false, true]);
  assert.deepEqual((["a", "b"] as const).map((side) => mine(routine({}, { who: "both" }), side)), [true, true]);
  assert.deepEqual((["a", "b"] as const).map((side) => mine(routine({}, { who: null }), side)), [false, false]);
});

test("the weekly pattern comes from the day types", () => {
  const r = routine();
  const actions = [
    action("day_type", r, { days: "TU,FR" }, { title: "Upper", sort: 2 }),
    action("day_type", r, { days: "MO,TH" }, { title: "Lower", sort: 1 }),
    action("day_type", r, { days: "WE,SA,SU" }, { title: "Rest", sort: 3 }),
    step(r, { days: "MO" }),
  ];
  assert.deepEqual(weeklyPattern(actions).map((e) => e.label), ["Lower", "Upper", "Rest", "Lower", "Upper", "Rest", "Rest"]);
  assert.deepEqual(weeklyPattern(actions).map((e) => e.day), [...DAY_CODES]);
  assert.deepEqual([19, 20, 21, 22, 23, 24, 25].map((d) => dayLabel(actions, `2026-10-${d}`)), ["Lower", "Upper", "Rest", "Lower", "Upper", "Rest", "Rest"]);
});

test("the weekly pattern leaves gaps, lets the first by order win and skips deleted day types", () => {
  const r = routine();
  const actions = [
    action("day_type", r, { days: "MO" }, { title: "Second", sort: 2 }),
    action("day_type", r, { days: "MO,TU" }, { title: "First", sort: 1 }),
    action("day_type", r, { days: "WE" }, { title: "Gone", deleted_at: "2026-10-20T00:00:00Z" }),
    action("day_type", r, null, { title: "Any", sort: 9 }),
  ];
  assert.deepEqual(weeklyPattern(actions).map((e) => e.label), ["First", "First", "Any", "Any", "Any", "Any", "Any"]);
  assert.deepEqual(weeklyPattern([]).map((e) => e.label), Array(7).fill(null));
  assert.equal(dayLabel([], "2026-10-19"), null);
  assert.equal(dayLabel([step(r)], "2026-10-19"), null);
});

test("each tap writes the owner's key on a routine owned by one partner, and the tapper's on a shared one", () => {
  assert.equal(keyFor("a", "a"), "a");
  assert.equal(keyFor("a", "b"), "a");
  assert.equal(keyFor("b", "a"), "b");
  assert.equal(keyFor("b", "b"), "b");
  assert.equal(keyFor("both", "a"), "a");
  assert.equal(keyFor("both", "b"), "b");
  assert.equal(keyFor(null, "b"), "b");
});

const apply = (row: ItemRow, patch: { data: Record<string, unknown> } | null) => (patch === null ? row : applyPatch(row, patch));

test("a tick writes the routine day and the next day starts unticked", () => {
  const r = routine();
  for (const kind of ["step", "timer", "pack"]) {
    const a = action(kind, r);
    assert.deepEqual(mark(a, "a", "2026-10-24"), { data: { done_a: "2026-10-24" } });
    assert.deepEqual(mark(a, "b", "2026-10-24"), { data: { done_b: "2026-10-24" } });
    const ticked = apply(a, mark(a, "a", "2026-10-24"));
    assert.equal(isDone(ticked, "a", "2026-10-24"), true, kind);
    assert.equal(isDone(ticked, "b", "2026-10-24"), false, kind);
    assert.equal(isDone(ticked, "a", "2026-10-25"), false, kind);
    assert.equal(isDone(ticked, "a", "2026-10-23"), false, kind);
    assert.deepEqual(unmark(ticked, "a"), { data: { done_a: null } });
    assert.equal(isDone(apply(ticked, unmark(ticked, "a")), "a", "2026-10-24"), false);
    assert.equal(isDone(a, "a", "2026-10-24"), false);
  }
});

test("the two partners' marks are independent and ticking again is idempotent", () => {
  const a = apply(apply(action("step", routine()), mark(action("step", routine()), "a", "2026-10-24")), { data: { done_b: "2026-10-23" } });
  assert.equal(isDone(a, "a", "2026-10-24"), true);
  assert.equal(isDone(a, "b", "2026-10-24"), false);
  assert.equal(isDone(a, "b", "2026-10-23"), true);
  const twice = apply(a, mark(a, "a", "2026-10-24"));
  assert.deepEqual(twice.data, a.data);
});

test("kinds without a completion have no mark and are never done", () => {
  const r = routine();
  for (const kind of ["block", "day_type", "text", "routine"]) {
    const a = kind === "routine" ? r : action(kind, r, { done_a: "2026-10-24" });
    assert.equal(mark(a, "a", "2026-10-24"), null, kind);
    assert.equal(unmark(a, "a"), null, kind);
    assert.equal(isDone(a, "a", "2026-10-24"), false, kind);
  }
});

test("a counter adds one per tap, restarts each day and is done at its target", () => {
  const c = action("counter", routine(), { unit: "portions" }, { qty: 2 });
  assert.equal(count(c, "a", "2026-10-24"), 0);
  const one = apply(c, mark(c, "a", "2026-10-24"));
  assert.deepEqual(one.data, { unit: "portions", done_a: "2026-10-24", value_a: 1 });
  assert.equal(count(one, "a", "2026-10-24"), 1);
  assert.equal(isDone(one, "a", "2026-10-24"), false);
  const two = apply(one, mark(one, "a", "2026-10-24"));
  assert.equal(count(two, "a", "2026-10-24"), 2);
  assert.equal(isDone(two, "a", "2026-10-24"), true);
  assert.equal(count(two, "b", "2026-10-24"), 0);
  assert.equal(isDone(two, "b", "2026-10-24"), false);
  assert.equal(count(two, "a", "2026-10-25"), 0);
  assert.equal(isDone(two, "a", "2026-10-25"), false);
  const next = apply(two, mark(two, "a", "2026-10-25"));
  assert.equal(count(next, "a", "2026-10-25"), 1);
  assert.deepEqual(unmark(next, "a"), { data: { done_a: null, value_a: null } });
  const cleared = apply(next, unmark(next, "a"));
  assert.equal(count(cleared, "a", "2026-10-25"), 0);
  assert.deepEqual(cleared.data, { unit: "portions" });
});

test("a counter without a target is never done, and a target of zero is done at once", () => {
  const open = action("counter", routine(), { done_a: "2026-10-24", value_a: 9 });
  assert.equal(isDone(open, "a", "2026-10-24"), false);
  assert.equal(count(open, "a", "2026-10-24"), 9);
  const zero = action("counter", routine(), null, { qty: 0 });
  assert.equal(isDone(zero, "a", "2026-10-24"), true);
  const unvalued = action("counter", routine(), { done_a: "2026-10-24" }, { qty: 1 });
  assert.equal(count(unvalued, "a", "2026-10-24"), 0);
  assert.equal(isDone(unvalued, "a", "2026-10-24"), false);
});

test("progress counts only the actions that complete, for one person and one day", () => {
  const r = routine({}, { who: "both" });
  const s1 = step(r, { done_a: "2026-10-24", done_b: "2026-10-23" });
  const s2 = step(r, { done_b: "2026-10-24" });
  const t = action("timer", r, { done_a: "2026-10-24" });
  const c = action("counter", r, { done_a: "2026-10-24", value_a: 2 }, { qty: 2 });
  const rows = [s1, s2, t, c, action("block", r), action("text", r), action("day_type", r)];
  assert.deepEqual(progress(rows, "a", "2026-10-24"), { done: 3, total: 4 });
  assert.deepEqual(progress(rows, "b", "2026-10-24"), { done: 1, total: 4 });
  assert.deepEqual(progress(rows, "a", "2026-10-25"), { done: 0, total: 4 });
  assert.deepEqual(progress([], "a", "2026-10-24"), { done: 0, total: 0 });
  assert.deepEqual(progress([action("text", r)], "a", "2026-10-24"), { done: 0, total: 0 });
});

test("random tick sequences match a model that keeps one mark per person", () => {
  const random = mulberry(21);
  for (let run = 0; run < 200; run++) {
    const kind = ["step", "timer", "pack", "counter"][Math.floor(random() * 4)];
    let row = action(kind, routine({}, { who: "both" }), null, { qty: kind === "counter" ? 1 + Math.floor(random() * 3) : null });
    const model = { a: { day: "", n: 0 }, b: { day: "", n: 0 } };
    for (let step = 0; step < 60; step++) {
      const side = random() < 0.5 ? "a" : "b";
      const today = day("2026-10-20", Math.floor(random() * 4));
      if (random() < 0.7) {
        row = apply(row, mark(row, side, today));
        model[side] = { day: today, n: model[side].day === today ? model[side].n + 1 : 1 };
        if (kind !== "counter") model[side].n = 1;
      } else {
        row = apply(row, unmark(row, side));
        model[side] = { day: "", n: 0 };
      }
      for (const who of ["a", "b"] as const) {
        const probe = day("2026-10-20", Math.floor(random() * 4));
        const expected = model[who].day === probe ? model[who].n : 0;
        assert.equal(isDone(row, who, probe), kind === "counter" ? expected >= row.qty! : expected > 0);
        if (kind === "counter") assert.equal(count(row, who, probe), expected);
      }
    }
  }
});
