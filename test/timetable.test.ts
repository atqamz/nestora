import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY_CODES, TIMETABLE, isTimetable, routineDay, routineMinutes } from "../shared/routines.ts";
import type { DayCode } from "../shared/routines.ts";
import type { ItemRow } from "../shared/tables.ts";
import { blankAction, blankDraft, forTimetable, planOf, problemsOf } from "../src/domain/routine-draft.ts";
import type { ActionDraft } from "../src/domain/routine-draft.ts";
import { todayBlocks } from "../src/domain/routines.ts";
import { inTimeOrder, marks, minutes, overlaps, slotsOn, stateOf, themToday, weekOf } from "../src/domain/timetable.ts";
import type { Slot } from "../src/domain/timetable.ts";
import { text } from "../src/ui/text.ts";
import { item } from "./domain-rows.ts";

const MONDAY = "2026-10-26";

const table = (who: "a" | "b" | "both" = "b", data: Record<string, unknown> = {}, extra: Partial<ItemRow> = {}) =>
  item({ kind: "routine", status: null, who, title: "Weekly timetable", group_key: TIMETABLE, data, ...extra });

const block = (parent: ItemRow, title: string, start: string | null, end: string | null, days: string | null = null, extra: Partial<ItemRow> = {}) =>
  item({
    kind: "block",
    status: null,
    parent_id: parent.id,
    title,
    data: { ...(start === null ? {} : { start_time: start }), ...(end === null ? {} : { end_time: end }), ...(days === null ? {} : { days }) },
    ...extra,
  });

const titles = (slots: readonly Slot[]) => slots.map((slot) => slot.row.title);

const at = (iso: string) => new Date(iso);

test("a routine is a timetable by its moment alone, trimmed, and nothing else is", () => {
  assert.equal(TIMETABLE, "timetable");
  assert.equal(isTimetable(table()), true);
  assert.equal(isTimetable(table("b", {}, { group_key: " timetable " })), true);
  assert.equal(isTimetable(table("b", {}, { group_key: "evening" })), false);
  assert.equal(isTimetable(table("b", {}, { group_key: null })), false);
  assert.equal(isTimetable(item({ kind: "block", group_key: "timetable" })), false);
});

test("the minutes of the routine day count from midnight in Jakarta, and the hours before 04:00 still belong to the day before", () => {
  assert.equal(routineMinutes(at("2026-10-26T03:00:00Z")), 10 * 60);
  assert.equal(routineMinutes(at("2026-10-25T21:00:00Z")), 4 * 60);
  assert.equal(routineMinutes(at("2026-10-25T20:59:00Z")), 24 * 60 + 3 * 60 + 59);
  assert.equal(routineMinutes(at("2026-10-25T17:00:00Z")), 24 * 60);
  assert.equal(routineMinutes(at("2026-10-25T16:59:00Z")), 23 * 60 + 59);
  assert.equal(routineMinutes(at("2026-10-26T16:59:59.999Z")), 23 * 60 + 59);
  assert.equal(routineDay(at("2026-10-25T20:59:00Z")), "2026-10-25");
  assert.equal(routineDay(at("2026-10-25T21:00:00Z")), "2026-10-26");
});

test("a time is read as minutes after midnight", () => {
  assert.equal(minutes("00:00"), 0);
  assert.equal(minutes("09:30"), 570);
  assert.equal(minutes("23:59"), 1439);
});

test("a day lists its blocks by start time, then by the order they were put in, with a block without a time first", () => {
  const r = table();
  const rows = [
    r,
    block(r, "Block 3", "13:00", "14:00"),
    block(r, "Block 1", "09:00", "10:30"),
    block(r, "Block 2", "09:00", null, null, { sort: 5 }),
    block(r, "Block 0", null, null),
    block(r, "Block 4", "00:30", "01:00"),
  ];
  assert.deepEqual(titles(slotsOn(r, rows, MONDAY)), ["Block 0", "Block 4", "Block 1", "Block 2", "Block 3"]);
});

test("a block keeps its own end only when it is after its start, an open end stays open, and a place is the text or nothing", () => {
  const r = table();
  const rows = [
    r,
    block(r, "Block 1", "09:00", "10:30", null, { data: { start_time: "09:00", end_time: "10:30", where: "Place A" } }),
    block(r, "Block 2", "09:00", "09:00"),
    block(r, "Block 3", "09:00", "08:00"),
    block(r, "Block 4", "18:30", null),
    block(r, "Block 5", null, "18:00"),
  ];
  const found = slotsOn(r, rows, MONDAY);
  const by = (title: string) => found.find((slot) => slot.row.title === title)!;
  assert.deepEqual([by("Block 1").start, by("Block 1").end, by("Block 1").where], ["09:00", "10:30", "Place A"]);
  assert.equal(by("Block 2").end, null);
  assert.equal(by("Block 3").end, null);
  assert.deepEqual([by("Block 4").end, by("Block 4").where], [null, null]);
  assert.deepEqual([by("Block 5").start, by("Block 5").end], ["", null]);
});

test("a block shows on its own days, and on the routine's days when it has none, and not when the routine skips the date", () => {
  const r = table("b", { days: "MO,WE,FR" });
  const rows = [r, block(r, "Block 1", "09:00", "10:00"), block(r, "Block 2", "09:00", "10:00", "MO,TU"), block(r, "Block 3", "11:00", "12:00", "SU")];
  assert.deepEqual(titles(slotsOn(r, rows, "2026-10-26")), ["Block 1", "Block 2"]);
  assert.deepEqual(titles(slotsOn(r, rows, "2026-10-27")), []);
  assert.deepEqual(titles(slotsOn(r, rows, "2026-10-28")), ["Block 1"]);
  assert.deepEqual(titles(slotsOn(r, rows, "2026-11-01")), []);
  const paused = table("b", { paused_until: "2026-11-02" });
  assert.deepEqual(titles(slotsOn(paused, [paused, block(paused, "Block 1", "09:00", "10:00")], MONDAY)), []);
  const biweekly = table("b", { every_weeks: "2", from: "2026-10-26" });
  const kept = [biweekly, block(biweekly, "Block 1", "09:00", "10:00")];
  assert.deepEqual([MONDAY, "2026-11-02", "2026-11-09"].map((date) => slotsOn(biweekly, kept, date).length), [1, 0, 1]);
});

test("deleted blocks and blocks of another routine never show", () => {
  const r = table();
  const other = table();
  const rows = [r, block(r, "Block 1", "09:00", "10:00", null, { deleted_at: "2026-10-02T00:00:00Z" }), block(other, "Block 2", "09:00", "10:00"), block(r, "Block 3", "09:00", "10:00")];
  assert.deepEqual(titles(slotsOn(r, rows, MONDAY)), ["Block 3"]);
});

test("the week runs Monday to Sunday around any day, marks today, and keeps the days with no block", () => {
  const r = table();
  const rows = [r, block(r, "Block 1", "09:00", "10:00", "MO"), block(r, "Block 2", "18:30", null, "WE")];
  const week = weekOf(r, rows, "2026-10-28");
  assert.deepEqual(week.map((day) => day.day), [...DAY_CODES]);
  assert.deepEqual(week.map((day) => day.date), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
  assert.deepEqual(week.map((day) => day.today), [false, false, true, false, false, false, false]);
  assert.deepEqual(week.map((day) => titles(day.slots)), [["Block 1"], [], ["Block 2"], [], [], [], []]);
  assert.deepEqual(weekOf(r, [r], "2026-11-01").map((day) => day.date)[0], "2026-10-26");
});

test("a day with twelve blocks lists all twelve in order", () => {
  const r = table();
  const rows = [r, ...Array.from({ length: 12 }, (_, step) => block(r, `Block ${step + 1}`, `${String(20 - step).padStart(2, "0")}:00`, null))];
  const found = slotsOn(r, rows, MONDAY);
  assert.equal(found.length, 12);
  assert.deepEqual(found.map((slot) => slot.start), found.map((slot) => slot.start).sort());
  assert.equal(found[0].row.title, "Block 12");
});

test("the actions of a timetable come in time order with the blocks first, and a routine that is not a timetable keeps its order", () => {
  const r = table();
  const a = block(r, "Block 1", "13:00", "14:00", null, { sort: 0 });
  const b = block(r, "Block 2", "09:00", "10:00", null, { sort: 1 });
  const note = item({ kind: "text", status: null, parent_id: r.id, title: "Note 1", sort: -1 });
  assert.deepEqual(inTimeOrder([note, a, b]).map((row) => row.title), ["Block 2", "Block 1", "Note 1"]);
  assert.deepEqual(inTimeOrder([]), []);
  const evening = item({ kind: "routine", status: null, who: "a", group_key: "evening", title: "Routine 1" });
  const rows = [r, a, b, evening, item({ kind: "step", status: null, parent_id: evening.id, title: "Step 2", sort: 1 }), item({ kind: "step", status: null, parent_id: evening.id, title: "Step 1", sort: 0 })];
  const today = todayBlocks(rows.map((row) => (row.id === r.id ? { ...row, who: "a" as const } : row)), "a", MONDAY);
  assert.deepEqual(today.find((entry) => entry.routine.id === r.id)!.actions.map((row) => row.title), ["Block 2", "Block 1"]);
  assert.deepEqual(today.find((entry) => entry.routine.id === evening.id)!.actions.map((row) => row.title), ["Step 1", "Step 2"]);
});

const slot = (start: string, end: string | null): Slot => ({ row: item({ kind: "block", title: "Block 1" }), routine: table(), start, end, where: null });

test("a block is later before it starts, now from its start to just before its end, and done from its end", () => {
  const timed = slot("09:00", "10:30");
  assert.equal(stateOf(timed, minutes("08:59")), "later");
  assert.equal(stateOf(timed, minutes("09:00")), "now");
  assert.equal(stateOf(timed, minutes("10:29")), "now");
  assert.equal(stateOf(timed, minutes("10:30")), "done");
  assert.equal(stateOf(timed, minutes("23:59")), "done");
});

test("a block with no end is now from its start for the rest of the day, and a block without a time is never started", () => {
  const open = slot("18:30", null);
  assert.equal(stateOf(open, minutes("18:29")), "later");
  assert.equal(stateOf(open, minutes("18:30")), "now");
  assert.equal(stateOf(open, 24 * 60 + 200), "now");
  assert.equal(stateOf(slot("", null), minutes("12:00")), "later");
});

test("in the small hours the routine day is still yesterday's, so every block of it is done, even one that starts at 00:30", () => {
  const night = routineMinutes(at("2026-10-25T18:00:00Z"));
  assert.equal(night, 25 * 60);
  for (const [start, end] of [["23:00", "23:59"], ["00:30", "01:00"], ["04:30", "05:00"], ["09:00", "10:00"]] as const) assert.equal(stateOf(slot(start, end), night), "done");
  assert.equal(stateOf(slot("23:30", null), night), "now");
  const early = routineMinutes(at("2026-10-25T21:00:00Z"));
  assert.equal(stateOf(slot("02:00", "03:00"), early), "done");
  assert.equal(stateOf(slot("04:00", "05:00"), early), "now");
});

test("the next block is the first one that has not started, now blocks are tagged now, and a block without a time is never next", () => {
  const list = [slot("", null), slot("08:00", "09:00"), slot("09:00", "12:00"), slot("09:30", "10:00"), slot("11:00", "12:00"), slot("13:00", null)];
  const at0930 = marks(list, minutes("09:30"));
  assert.deepEqual(at0930.map((mark) => mark.state), ["later", "done", "now", "now", "later", "later"]);
  assert.deepEqual(at0930.map((mark) => mark.tag), [null, null, "now", "now", "next", null]);
  const before = marks(list, minutes("07:00"));
  assert.deepEqual(before.map((mark) => mark.tag), [null, "next", null, null, null, null]);
  const after = marks(list, minutes("22:00"));
  assert.deepEqual(after.map((mark) => mark.tag), [null, null, null, null, null, "now"]);
  assert.deepEqual(marks([], 0), []);
  assert.deepEqual(marks([slot("", null)], 0).map((mark) => mark.tag), [null]);
});

test("them today holds the other partner's timetable blocks for the day, in time order, from every visible timetable of theirs", () => {
  const first = table("b");
  const second = table("b");
  const mineOwn = table("a");
  const rows = [first, second, mineOwn, block(first, "Block 2", "13:00", "14:00", "MO"), block(second, "Block 1", "09:00", "10:30", "MO"), block(mineOwn, "Block 9", "08:00", "09:00"), block(first, "Block 3", "09:00", "10:00", "TU")];
  const them = themToday(rows, "a", MONDAY);
  assert.deepEqual(titles(them.slots), ["Block 1", "Block 2"]);
  assert.deepEqual(them.routines.map((row) => row.id), [first.id, second.id]);
  assert.deepEqual(titles(themToday(rows, "b", MONDAY).slots), ["Block 9"]);
  assert.deepEqual(themToday(rows, null, MONDAY), { routines: [], slots: [] });
});

test("them today never shows a private timetable of theirs, its blocks, a deleted timetable, a shared routine of both, or a routine that is not a timetable", () => {
  const hidden = table("b", { private: true });
  const gone = table("b", {}, { deleted_at: "2026-10-02T00:00:00Z" });
  const both = table("both");
  const plain = table("b", {}, { group_key: "evening" });
  const shown = table("b");
  const rows = [hidden, gone, both, plain, shown, ...[hidden, gone, both, plain, shown].map((r) => block(r, `Block of ${r.id.slice(-2)}`, "09:00", "10:00"))];
  const them = themToday(rows, "a", MONDAY);
  assert.deepEqual(them.routines.map((row) => row.id), [shown.id]);
  assert.equal(them.slots.length, 1);
  assert.equal(them.slots[0].routine.id, shown.id);
  assert.deepEqual(themToday(rows, "b", MONDAY), { routines: [], slots: [] });
  const own = table("a", { private: true });
  assert.deepEqual(themToday([own, block(own, "Block 1", "09:00", "10:00")], "b", MONDAY), { routines: [], slots: [] });
});

test("them today follows the routine day: on a day the timetable skips, or while it is paused, nothing is listed but the timetable is still theirs", () => {
  const r = table("b", { paused_until: "2026-10-30" });
  const rows = [r, block(r, "Block 1", "09:00", "10:00")];
  assert.deepEqual(themToday(rows, "a", MONDAY), { routines: [r], slots: [] });
  assert.deepEqual(themToday(rows, "a", "2026-10-30").slots.length, 1);
});

const draft = (fields: Partial<ActionDraft>) => ({ ...blankDraft("a", TIMETABLE), title: "Weekly timetable", actions: [{ ...blankAction("block", "00000000-0000-4000-8000-0000000000aa"), title: "Block 1", ...fields }] });

const problems = (fields: Partial<ActionDraft>) => problemsOf(draft(fields)).map((problem) => [problem.field, problem.code]);

test("a block needs a start time of the form HH:MM, and an end after it on the same day, or no end", () => {
  assert.deepEqual(problems({ start: "09:00", end: "10:30" }), []);
  assert.deepEqual(problems({ start: "09:00", end: "" }), []);
  assert.deepEqual(problems({ start: "00:00", end: "23:59" }), []);
  assert.deepEqual(problems({ start: "" }), [["start", "required"]]);
  assert.deepEqual(problems({ start: "9:00" }), [["start", "time"]]);
  assert.deepEqual(problems({ start: "24:00" }), [["start", "time"]]);
  assert.deepEqual(problems({ start: "09:60" }), [["start", "time"]]);
  assert.deepEqual(problems({ start: "09:00:00" }), [["start", "time"]]);
  assert.deepEqual(problems({ start: "09:00", end: "9:30" }), [["end", "time"]]);
  assert.deepEqual(problems({ start: "09:00", end: "09:00" }), [["end", "order"]]);
  assert.deepEqual(problems({ start: "23:00", end: "01:00" }), [["end", "order"]]);
  assert.deepEqual(problems({ start: "23:00", end: "00:00" }), [["end", "order"]]);
  assert.deepEqual(problems({ start: "bad", end: "bad" }), [["start", "time"], ["end", "time"]]);
});

test("a block that ends after midnight is refused with the plain message that says what to do instead", () => {
  assert.equal(text.routines.form.problem.end, "The end must be after the start on the same day. To go past midnight, end at 23:59 and add a block on the next day.");
  assert.equal(text.routines.form.problem.time, "Use a time like 09:30.");
});

test("a new timetable starts in the timetable moment, owned by the signed-in side, shared", () => {
  const blank = blankDraft("b", TIMETABLE);
  assert.deepEqual([blank.moment, blank.who, blank.private], [TIMETABLE, "b", false]);
  assert.equal(blankDraft("b").moment, "morning");
});

test("a timetable is saved as a routine in the timetable moment with blocks that keep their days, times and place", () => {
  const plan = planOf(
    draft({ start: "09:00", end: "", where: "Place A", days: ["MO", "WE"] }),
    null,
    [],
    () => "00000000-0000-4000-8000-0000000000bb",
  );
  assert.ok(plan.ok);
  assert.deepEqual(plan.steps[0], { op: "create", table: "items", id: "00000000-0000-4000-8000-0000000000bb", draft: { kind: "routine", title: "Weekly timetable", who: "a", group_key: TIMETABLE, data: {} } });
  assert.deepEqual(plan.steps[1].op === "create" && plan.steps[1].draft.data, { days: "MO,WE", start_time: "09:00", where: "Place A" });
});

const span = (start: string, end: string, days: ActionDraft["days"] = [], kind = "block") => ({ kind, start, end, days });

test("blocks that share a day and a stretch of time are flagged, each against the others, and touching blocks are not", () => {
  const all = [...DAY_CODES];
  assert.deepEqual(overlaps([span("09:00", "10:00"), span("09:30", "11:00"), span("11:00", "12:00")], all), [[1], [0], []]);
  assert.deepEqual(overlaps([span("09:00", "10:00"), span("10:00", "11:00")], all), [[], []]);
  assert.deepEqual(overlaps([span("09:00", "12:00"), span("10:00", "11:00")], all), [[1], [0]]);
});

test("blocks on different days never overlap, and a block with no days of its own takes the routine's days", () => {
  assert.deepEqual(overlaps([span("09:00", "10:00", ["MO"]), span("09:00", "10:00", ["TU"])], [...DAY_CODES]), [[], []]);
  assert.deepEqual(overlaps([span("09:00", "10:00", ["MO", "TU"]), span("09:30", "10:00", ["TU", "WE"])], [...DAY_CODES]), [[1], [0]]);
  assert.deepEqual(overlaps([span("09:00", "10:00"), span("09:30", "10:00", ["TU"])], ["MO"]), [[], []]);
  assert.deepEqual(overlaps([span("09:00", "10:00"), span("09:30", "10:00", ["TU"])], ["MO", "TU"]), [[1], [0]]);
});

test("an open end runs to the end of the day, and an end that is not after the start counts as open too", () => {
  const all = [...DAY_CODES];
  assert.deepEqual(overlaps([span("18:30", ""), span("23:00", "23:30")], all), [[1], [0]]);
  assert.deepEqual(overlaps([span("18:30", ""), span("09:00", "10:00")], all), [[], []]);
  assert.deepEqual(overlaps([span("18:30", "18:00"), span("23:00", "23:30")], all), [[1], [0]]);
  assert.deepEqual(overlaps([span("18:30", "18:30"), span("23:00", "23:30")], all), [[1], [0]]);
});

test("a block with no valid start, and anything that is not a block, is never flagged and never flags another", () => {
  const all = [...DAY_CODES];
  assert.deepEqual(overlaps([span("", ""), span("09:00", "10:00")], all), [[], []]);
  assert.deepEqual(overlaps([span("bad", ""), span("09:00", "10:00")], all), [[], []]);
  assert.deepEqual(overlaps([span("09:00", "10:00", [], "step"), span("09:00", "10:00")], all), [[], []]);
  assert.deepEqual(overlaps([], all), []);
});

test("an open-end block runs to the end of the day, so it overlaps a block that starts at any time after it, even in the last minute", () => {
  const block = (start: string, end: string): { kind: string; start: string; end: string; days: DayCode[] } => ({ kind: "block", start, end, days: ["MO"] });
  assert.deepEqual(overlaps([block("23:00", ""), block("23:40", "23:50")], DAY_CODES), [[1], [0]]);
  assert.deepEqual(overlaps([block("23:00", ""), block("23:59", "")], DAY_CODES), [[1], [0]]);
  assert.deepEqual(overlaps([block("23:00", ""), block("22:00", "23:00")], DAY_CODES), [[], []]);
});

test("a timetable is saved owned by one side on every day, but the draft keeps the owner and days it had until then", () => {
  const both = { ...blankDraft("a"), who: "both" as const, days: ["MO", "TH"] as DayCode[], moment: "evening" };
  const toggled = { ...both, moment: TIMETABLE };
  assert.deepEqual([toggled.who, toggled.days], ["both", ["MO", "TH"]]);
  assert.deepEqual([forTimetable(toggled, "b").who, forTimetable(toggled, "b").days], ["b", DAY_CODES]);
  assert.deepEqual(forTimetable({ ...toggled, who: "a" }, "b").who, "a");
  assert.equal(forTimetable(both, "b"), both);
  assert.deepEqual({ ...toggled, moment: "evening" }, both);
});
