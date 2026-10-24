import { test } from "node:test";
import assert from "node:assert/strict";
import type { ItemRow } from "../shared/tables.ts";
import { actionsOf, allDone, listing, momentOf, ownerOf, routineRows, routinesOf, runs, tally, todayBlocks } from "../src/domain/routines.ts";
import { item } from "./domain-rows.ts";

const DAY = "2026-10-26";

const routine = (title: string, data: Record<string, unknown> = {}, extra: Partial<ItemRow> = {}) =>
  item({ kind: "routine", status: null, who: "a", title, data, ...extra });
const action = (parent: ItemRow, title: string, kind = "step", extra: Partial<ItemRow> = {}) =>
  item({ kind, status: null, parent_id: parent.id, title, ...extra });

test("the owner of a routine is read against the signed-in side", () => {
  assert.deepEqual([ownerOf(routine("x", {}, { who: "a" }), "a"), ownerOf(routine("x", {}, { who: "a" }), "b"), ownerOf(routine("x", {}, { who: "both" }), "b"), ownerOf(routine("x", {}, { who: "b" }), "b")], ["mine", "theirs", "both", "mine"]);
});

test("the moment is the trimmed group, or none", () => {
  assert.equal(momentOf(routine("x", {}, { group_key: " morning " })), "morning");
  assert.equal(momentOf(routine("x", {}, { group_key: "  " })), null);
  assert.equal(momentOf(routine("x")), null);
});

test("routines and their actions are told apart, deleted rows never count and actions keep their order", () => {
  const morning = routine("Morning routine");
  const gone = routine("Old", {}, { deleted_at: "2026-10-01T00:00:00Z" });
  const second = action(morning, "item 2", "step", { sort: 1 });
  const first = action(morning, "item 1", "pack", { sort: 0 });
  const dead = action(morning, "item 3", "step", { deleted_at: "2026-10-01T00:00:00Z" });
  const other = action(routine("Evening routine"), "item 4");
  const rows = [morning, gone, second, first, dead, other, item({ kind: "task" })];
  assert.deepEqual(routinesOf(rows).map((row) => row.title), ["Morning routine"]);
  assert.deepEqual(actionsOf(rows, morning).map((row) => row.title), ["item 1", "item 2"]);
});

test("the listing groups by owner then moment, in a fixed order, and leaves empty groups out", () => {
  const rows = [
    routine("Bag checklist", {}, { who: "both", group_key: "on_demand" }),
    routine("Evening routine", {}, { who: "a", group_key: "evening" }),
    routine("Morning routine", {}, { who: "a", group_key: "morning" }),
    routine("Timetable", {}, { who: "b", group_key: "timetable" }),
    routine("Loose", {}, { who: "a", group_key: null }),
    routine("Second morning", {}, { who: "a", group_key: "morning", sort: 1 }),
    routine("Other evening", {}, { who: "b", group_key: "evening" }),
  ];
  const view = listing(rows, "a").map(({ owner, moments }) => [owner, moments.map(({ key, routines }) => [key, routines.map((row) => row.title)])]);
  assert.deepEqual(view, [
    ["mine", [["morning", ["Morning routine", "Second morning"]], ["evening", ["Evening routine"]], [null, ["Loose"]]]],
    ["both", [["on_demand", ["Bag checklist"]]]],
    ["theirs", [["evening", ["Other evening"]], ["timetable", ["Timetable"]]]],
  ]);
  assert.deepEqual(listing([], "a"), []);
  assert.deepEqual(listing(rows, "b").map(({ owner }) => owner), ["mine", "both", "theirs"]);
});

test("Today holds only routines that run today and belong to this partner or both, ordered by moment", () => {
  const evening = routine("Evening routine", {}, { group_key: "evening" });
  const morning = routine("Morning routine", {}, { group_key: "morning" });
  const bag = routine("Bag checklist", {}, { who: "both", group_key: "on_demand" });
  const theirs = routine("Their list", {}, { who: "b", group_key: "morning" });
  const weekend = routine("Weekend", { days: "SA,SU" });
  const away = routine("Paused", { paused_until: "2026-11-01" });
  const rows = [evening, morning, bag, theirs, weekend, away, action(morning, "item 1"), action(bag, "item 2")];
  assert.deepEqual(todayBlocks(rows, "a", DAY).map((block) => block.routine.title), ["Morning routine", "Bag checklist", "Evening routine"]);
  assert.deepEqual(todayBlocks(rows, "b", DAY).map((block) => block.routine.title), ["Their list", "Bag checklist"]);
  assert.deepEqual(todayBlocks(rows, null, DAY), []);
});

test("a Today block counts the ticks of the side that owns the mark and carries the day label", () => {
  const weekly = routine("Routine 1", {}, { who: "a" });
  const typeOne = action(weekly, "Day type 1", "day_type", { data: { days: "MO,TH" } });
  const typeTwo = action(weekly, "Day type 2", "day_type", { data: { days: "TU,WE" } });
  const first = action(weekly, "item 1", "step", { data: { done_a: DAY } });
  const second = action(weekly, "item 2", "step", { data: { done_a: "2026-10-25" } });
  const counted = action(weekly, "item 3", "counter", { qty: 2, data: { done_a: DAY, value_a: 2 } });
  const onlyTuesday = action(weekly, "item 4", "step", { data: { days: "TU" } });
  const [block] = todayBlocks([weekly, typeOne, typeTwo, first, second, counted, onlyTuesday], "a", DAY);
  assert.equal(block.label, "Day type 1");
  assert.deepEqual(block.progress, { done: 2, total: 3 });
  assert.deepEqual(block.actions.map((row) => row.title), ["Day type 1", "item 1", "item 2", "item 3"]);
  const shared = routine("Shared", {}, { who: "both" });
  const mark = action(shared, "item 1", "step", { data: { done_a: DAY } });
  assert.deepEqual(todayBlocks([shared, mark], "a", DAY)[0].progress, { done: 1, total: 1 });
  assert.deepEqual(todayBlocks([shared, mark], "b", DAY)[0].progress, { done: 0, total: 1 });
  const owned = routine("Owned", {}, { who: "a" });
  const ownedMark = action(owned, "item 1", "step", { data: { done_a: DAY } });
  assert.equal(todayBlocks([owned, ownedMark], "a", DAY)[0].side, "a");
  assert.deepEqual(todayBlocks([owned, ownedMark], "a", DAY)[0].progress, { done: 1, total: 1 });
});

test("everything is done only when something can be done and all of it is", () => {
  const block = (done: number, total: number) => ({ routine: routine("x"), actions: [], label: null, side: "a" as const, progress: { done, total } });
  assert.equal(allDone([]), false);
  assert.equal(allDone([block(0, 0)]), false);
  assert.equal(allDone([block(2, 2)]), true);
  assert.equal(allDone([block(1, 1)]), true);
  assert.equal(allDone([block(0, 1)]), false);
  assert.equal(allDone([block(2, 2), block(0, 0)]), true);
  assert.equal(allDone([block(2, 2), block(1, 2)]), false);
  assert.deepEqual(tally([block(2, 2), block(1, 3), block(0, 0)]), { done: 3, total: 5 });
  assert.deepEqual(tally([]), { done: 0, total: 0 });
});

test("actions are cut into runs at each change of heading", () => {
  const parent = routine("Deep clean");
  const rows = [action(parent, "a", "step", { group_key: "Kettle" }), action(parent, "b", "step", { group_key: " Kettle " }), action(parent, "c"), action(parent, "d", "step", { group_key: "Kettle" }), action(parent, "e", "step", { group_key: "Oven" })];
  assert.deepEqual(runs(rows).map((run) => [run.heading, run.actions.map((row) => row.title)]), [["Kettle", ["a", "b"]], [null, ["c"]], ["Kettle", ["d"]], ["Oven", ["e"]]]);
  assert.deepEqual(runs([]), []);
});

test("no code path hands the screens a row the partition hides: private routines of the other side and their actions never reach the listing, Today or the actions of a routine", () => {
  const secret = routine("Hidden routine", { private: true }, { who: "a", group_key: "morning" });
  const inside = action(secret, "Hidden step", "step", { data: { days: "MO" } });
  const shared = routine("Shared routine", {}, { who: "a", group_key: "morning" });
  const rows = [secret, inside, shared, action(shared, "item 1")];
  const seen = routineRows(rows, "b");
  const titles = (list: readonly ItemRow[]) => list.map((row) => row.title);
  assert.deepEqual(titles(seen), ["Shared routine", "item 1"]);
  assert.deepEqual(titles(routinesOf(seen)), ["Shared routine"]);
  assert.deepEqual(listing(routinesOf(seen), "b").flatMap(({ moments }) => moments.flatMap(({ routines }) => titles(routines))), ["Shared routine"]);
  assert.deepEqual(todayBlocks(seen, "b", DAY), []);
  assert.deepEqual(titles(actionsOf(seen, secret)), []);
  assert.deepEqual(titles(routineRows(rows, "a")), ["Hidden routine", "Hidden step", "Shared routine", "item 1"]);
  assert.deepEqual(titles(routineRows([...rows, item({ kind: "task", title: "A task" })], "a")), ["Hidden routine", "Hidden step", "Shared routine", "item 1"]);
  assert.deepEqual(routineRows(rows, null).map((row) => row.title), ["Shared routine", "item 1"]);
});

test("a custom moment comes after the known ones and before a routine with no moment, in the listing", () => {
  const rows = [
    routine("none", {}, { group_key: null }),
    routine("custom b", {}, { group_key: "timetable" }),
    routine("custom a", {}, { group_key: "afternoon" }),
    routine("evening", {}, { group_key: "evening" }),
    routine("morning", {}, { group_key: "morning" }),
    routine("demand", {}, { group_key: "on_demand" }),
  ];
  const [{ moments }] = listing(rows, "a");
  assert.deepEqual(moments.map(({ key }) => key), ["morning", "on_demand", "evening", "afternoon", "timetable", null]);
  const today = todayBlocks(rows, "a", DAY).map((block) => block.routine.title);
  assert.deepEqual(today, ["morning", "demand", "evening", "custom a", "custom b", "none"]);
});

test("custom moments sort by name whatever order they arrive in, and routines with no moment keep their order, in the listing and in Today", () => {
  const rows = [
    routine("Routine 1", {}, { group_key: null }),
    routine("Routine 2", {}, { group_key: "zeta" }),
    routine("Routine 3", {}, { group_key: null }),
    routine("Routine 4", {}, { group_key: "alpha" }),
    routine("Routine 5", {}, { group_key: "mid" }),
    routine("Routine 6", {}, { group_key: null }),
    routine("Routine 7", {}, { group_key: "alpha" }),
  ];
  const titles = (list: readonly ItemRow[]) => list.map((row) => row.title);
  assert.deepEqual(todayBlocks(rows, "a", DAY).map((block) => block.routine.title), ["Routine 4", "Routine 7", "Routine 5", "Routine 2", "Routine 1", "Routine 3", "Routine 6"]);
  const [{ moments }] = listing(rows, "a");
  assert.deepEqual(moments.map(({ key, routines }) => [key, titles(routines)]), [["alpha", ["Routine 4", "Routine 7"]], ["mid", ["Routine 5"]], ["zeta", ["Routine 2"]], [null, ["Routine 1", "Routine 3", "Routine 6"]]]);
  assert.deepEqual(listing([routine("Routine 1", {}, { group_key: "b" }), routine("Routine 2", {}, { group_key: "a" })], "a")[0].moments.map(({ key }) => key), ["a", "b"]);
});

test("routines of one moment are listed by their sort, not by the order the rows arrive in", () => {
  const rows = [routine("Routine 3", {}, { group_key: "morning", sort: 2 }), routine("Routine 1", {}, { group_key: "morning", sort: 0 }), routine("Routine 2", {}, { group_key: "morning", sort: 1 })];
  assert.deepEqual(listing(rows, "a")[0].moments[0].routines.map((row) => row.title), ["Routine 1", "Routine 2", "Routine 3"]);
});
