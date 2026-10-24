import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTION_KINDS, DAY_CODES } from "../shared/routines.ts";
import type { ItemRow } from "../shared/tables.ts";
import { KIND_FIELDS, LIMITS, blankAction, blankDraft, copyDraft, draftOf, planOf, problemsOf } from "../src/domain/routine-draft.ts";
import type { ActionDraft, RoutineDraft } from "../src/domain/routine-draft.ts";
import { client } from "./store-client.ts";
import { createServer } from "./store-server.ts";

let counter = 0;
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

const world = async () => {
  const server = createServer();
  const { store } = client(server, "a");
  await store.open();
  const rows = () => store.getSnapshot().rows.items;
  return { store, rows };
};

const action = (kind: (typeof ACTION_KINDS)[number], fields: Partial<ActionDraft>): ActionDraft => ({ ...blankAction(kind, newId()), ...fields });

const everything = (): RoutineDraft => ({
  ...blankDraft("a"),
  title: " Morning routine ",
  actions: [
    action("step", { title: "item 1", note: "line 1\nline 2", url: "https://example.com/a", heading: "Kettle", days: ["MO", "TH"] }),
    action("timer", { title: "item 2", minutes: "45" }),
    action("pack", { title: "item 3" }),
    action("block", { title: "item 4", start: "09:00", end: "12:00", where: "Place A", days: ["MO"] }),
    action("day_type", { title: "Lower", days: ["MO", "TH"] }),
    action("counter", { title: "item 5", qty: "2", unit: "portions" }),
    action("text", { title: "item 6" }),
  ],
});

const children = (rows: readonly ItemRow[], routine: ItemRow) => rows.filter((row) => row.parent_id === routine.id).sort((a, b) => a.sort - b.sort);

test("every action kind lists the fields it shows, and the kinds are exactly the registry's", () => {
  assert.deepEqual(Object.keys(KIND_FIELDS).sort(), [...ACTION_KINDS].sort());
  assert.deepEqual(KIND_FIELDS.timer, ["minutes"]);
  assert.deepEqual(KIND_FIELDS.counter, ["qty", "unit"]);
  assert.deepEqual(KIND_FIELDS.block, ["start", "end", "where"]);
  assert.deepEqual(KIND_FIELDS.step, ["note", "url"]);
});

test("a new routine with every kind is accepted by the validators and stored with the right parameters", async () => {
  const { store, rows } = await world();
  const plan = planOf(everything(), null, newId);
  assert.ok(plan.ok);
  assert.equal(plan.steps.length, 8);
  assert.deepEqual(plan.names, ["Morning routine", "item 1", "item 2", "item 3", "item 4", "Lower", "item 5", "item 6"]);
  const written = await store.many(plan.steps);
  assert.deepEqual(written, { ok: true, id: plan.id });
  const [routine] = rows().filter((row) => row.kind === "routine");
  assert.equal(routine.id, plan.id);
  assert.deepEqual([routine.title, routine.who, routine.group_key, routine.data], ["Morning routine", "a", "morning", {}]);
  const stored = children(rows(), routine);
  assert.deepEqual(stored.map((row) => [row.kind, row.title, row.sort]), [["step", "item 1", 0], ["timer", "item 2", 1], ["pack", "item 3", 2], ["block", "item 4", 3], ["day_type", "Lower", 4], ["counter", "item 5", 5], ["text", "item 6", 6]]);
  assert.deepEqual(stored.map((row) => row.data), [{ days: "MO,TH", url: "https://example.com/a" }, { minutes: 45 }, {}, { days: "MO", start_time: "09:00", end_time: "12:00", where: "Place A" }, { days: "MO,TH" }, { unit: "portions" }, {}]);
  assert.deepEqual([stored[0].note, stored[0].group_key, stored[5].qty, stored[1].note, stored[1].qty], ["line 1\nline 2", "Kettle", 2, null, null]);
  assert.ok(stored.every((row) => row.parent_id === routine.id));
});

test("the routine rule is stored sparsely: every day and every week leave no keys, other rules leave exactly theirs", async () => {
  const { store, rows } = await world();
  const draft = { ...blankDraft("a"), title: "Bag checklist", who: "both" as const, moment: "on_demand", days: ["MO", "TU", "WE", "TH", "FR"] as RoutineDraft["days"], every: "2", from: "2026-10-26", pausedUntil: "2026-11-02" };
  const plan = planOf(draft, null, newId);
  assert.ok(plan.ok);
  await store.many(plan.steps);
  const [routine] = rows();
  assert.deepEqual([routine.who, routine.group_key, routine.data], ["both", "on_demand", { days: "MO,TU,WE,TH,FR", every_weeks: "2", from: "2026-10-26", paused_until: "2026-11-02" }]);
  const weekly = planOf({ ...draft, every: "1", days: [...DAY_CODES], pausedUntil: "" }, null, newId);
  assert.ok(weekly.ok);
  assert.deepEqual((weekly.steps[0] as unknown as { draft: { data: unknown } }).draft.data, {});
});

test("a private routine is created private, owned by the signed-in side, and the flag is never sent again on an edit", async () => {
  const { store, rows } = await world();
  const plan = planOf({ ...blankDraft("a"), title: "Evening routine", private: true }, null, newId);
  assert.ok(plan.ok);
  await store.many(plan.steps);
  const [routine] = rows();
  assert.deepEqual([routine.who, routine.data], ["a", { private: true }]);
  const edit = planOf({ ...draftOf(routine, []), title: "Evening routine 2" }, { routine, actions: [] }, newId);
  assert.ok(edit.ok);
  assert.deepEqual(edit.steps, [{ op: "update", table: "items", id: routine.id, change: { title: "Evening routine 2", who: "a", group_key: "morning", data: { days: null, every_weeks: null, from: null, paused_until: null } } }]);
  await store.many(edit.steps);
  assert.deepEqual([rows()[0].title, rows()[0].data], ["Evening routine 2", { private: true }]);
});

test("a draft with problems reports each one by the action and the field and plans nothing", () => {
  const draft: RoutineDraft = {
    ...blankDraft("a"),
    title: "  ",
    days: [],
    every: "3",
    from: "",
    actions: [
      action("step", { title: "" }),
      action("timer", { title: "t", minutes: "" }),
      action("timer", { title: "t", minutes: "abc" }),
      action("timer", { title: "t", minutes: "0" }),
      action("counter", { title: "c", qty: "" }),
      action("counter", { title: "c", qty: "0" }),
      action("counter", { title: "c", qty: "1.5" }),
      action("block", { title: "b", start: "" }),
      action("block", { title: "b", start: "10:00", end: "10:00" }),
      action("block", { title: "b", start: "10:00", end: "09:00" }),
      action("block", { title: "b", start: "10:00", end: "" }),
      action("pack", { title: "p" }),
    ],
  };
  const expected = [
    [null, "title", "required"],
    [null, "days", "days"],
    [null, "from", "from"],
    [0, "title", "required"],
    [1, "minutes", "required"],
    [2, "minutes", "number"],
    [3, "minutes", "number"],
    [4, "qty", "required"],
    [5, "qty", "number"],
    [6, "qty", "number"],
    [7, "start", "required"],
    [8, "end", "order"],
    [9, "end", "order"],
  ];
  assert.deepEqual(problemsOf(draft).map((problem) => [problem.at, problem.field, problem.code]), expected);
  assert.deepEqual(planOf(draft, null, newId), { ok: false, problems: problemsOf(draft) });
  assert.deepEqual(problemsOf({ ...draft, title: "x", days: ["MO"], every: "1", actions: [] }), []);
  assert.deepEqual(problemsOf({ ...draft, title: "x", days: ["MO"], every: "2", from: "2026-10-26", actions: [action("text", { title: " " })] }).map((problem) => [problem.at, problem.field]), [[0, "title"]]);
});

test("numbers are whole and short, and a title of spaces is empty", () => {
  const one = (fields: Partial<ActionDraft>, kind: "timer" | "counter") => problemsOf({ ...blankDraft("a"), title: "x", actions: [action(kind, { title: "t", minutes: "1", qty: "1", ...fields })] }).length;
  assert.equal(one({ minutes: "99999" }, "timer"), 0);
  assert.equal(one({ minutes: "100000" }, "timer"), 1);
  assert.equal(one({ minutes: " 45 " }, "timer"), 0);
  assert.equal(one({ minutes: "-5" }, "timer"), 1);
  assert.equal(one({ qty: "1e3" }, "counter"), 1);
  assert.equal(one({ qty: "7" }, "counter"), 0);
  assert.equal(problemsOf({ ...blankDraft("a"), title: "\t \n" }).length, 1);
});

test("saving a draft read back from the rows changes nothing, so an edit sheet opened and saved is silent", async () => {
  const { store, rows } = await world();
  const plan = planOf(everything(), null, newId);
  assert.ok(plan.ok);
  await store.many(plan.steps);
  const [routine] = rows().filter((row) => row.kind === "routine");
  const before = store.getSnapshot().pending;
  const again = planOf(draftOf(routine, children(rows(), routine)), { routine, actions: children(rows(), routine) }, newId);
  assert.ok(again.ok);
  assert.equal(again.steps.length, 8);
  assert.deepEqual(await store.many(again.steps), { ok: true, id: "" });
  assert.equal(store.getSnapshot().pending, before);
});

test("an edit renames, retimes, reorders, removes and adds, and keeps today's ticks", async () => {
  const { store, rows } = await world();
  const plan = planOf(everything(), null, newId);
  assert.ok(plan.ok);
  await store.many(plan.steps);
  const [routine] = rows().filter((row) => row.kind === "routine");
  const [one, , three, , , counter] = children(rows(), routine);
  await store.update("items", one.id, { data: { done_a: "2026-10-26" } });
  await store.update("items", counter.id, { data: { done_a: "2026-10-26", value_a: 1 } });
  const current = { routine: rows().find((row) => row.id === routine.id)!, actions: children(rows(), routine) };
  const draft = draftOf(current.routine, current.actions);
  const added = action("pack", { title: "item 7" });
  const edited: RoutineDraft = {
    ...draft,
    title: "Morning routine 2",
    moment: "evening",
    days: ["MO", "TU"],
    actions: [
      { ...draft.actions[2], heading: "Bag" },
      { ...draft.actions[0], title: "item 1 b", days: [], note: "", url: "" },
      { ...draft.actions[1], minutes: "50" },
      { ...draft.actions[5], qty: "3", unit: "" },
      added,
    ],
  };
  const next = planOf(edited, current, newId);
  assert.ok(next.ok);
  assert.deepEqual(await store.many(next.steps), { ok: true, id: routine.id });
  const after = rows();
  const fresh = after.find((row) => row.id === routine.id)!;
  assert.deepEqual([fresh.title, fresh.group_key, fresh.data], ["Morning routine 2", "evening", { days: "MO,TU" }]);
  const list = children(after, fresh);
  assert.deepEqual(list.map((row) => [row.title, row.sort]), [["item 3", 0], ["item 1 b", 1], ["item 2", 2], ["item 5", 3], ["item 7", 4]]);
  assert.deepEqual(list.map((row) => row.group_key), ["Bag", "Kettle", null, null, null]);
  const first = list[1];
  assert.deepEqual([first.id, first.note, first.data], [one.id, null, { done_a: "2026-10-26" }]);
  assert.deepEqual(list[2].data, { minutes: 50 });
  assert.deepEqual([list[3].qty, list[3].data], [3, { done_a: "2026-10-26", value_a: 1 }]);
  assert.equal(after.find((row) => row.id === three.id)?.sort, 0);
  assert.equal(after.filter((row) => row.parent_id === routine.id).length, 5);
});

test("an action left out of the draft is deleted, and a draft that adds nothing deletes only what it dropped", async () => {
  const { store, rows } = await world();
  const plan = planOf(everything(), null, newId);
  assert.ok(plan.ok);
  await store.many(plan.steps);
  const [routine] = rows().filter((row) => row.kind === "routine");
  const actions = children(rows(), routine);
  const draft = draftOf(routine, actions);
  const next = planOf({ ...draft, actions: draft.actions.slice(0, 5) }, { routine, actions }, newId);
  assert.ok(next.ok);
  assert.deepEqual(next.steps.filter((step) => step.op === "delete").map((step) => step.id), [actions[5].id, actions[6].id]);
  assert.deepEqual(next.names.slice(-2), ["item 5", "item 6"]);
  await store.many(next.steps);
  assert.equal(rows().filter((row) => row.parent_id === routine.id).length, 5);
});

test("a copy starts a new routine: new ids, a suffixed name, no pause, no ticks", () => {
  const routine = { id: newId(), kind: "routine", title: "Morning routine", who: "a", group_key: "morning", data: { days: "MO", paused_until: "2026-11-02", private: true }, sort: 0, created_at: "x" } as unknown as ItemRow;
  const step = { id: newId(), kind: "step", title: "item 1", parent_id: routine.id, sort: 0, created_at: "x", note: "n", data: { done_a: "2026-10-26", done_b: "2026-10-25", days: "MO" } } as unknown as ItemRow;
  const copied = copyDraft(routine, [step], newId);
  assert.deepEqual([copied.title, copied.pausedUntil, copied.private, copied.who, copied.days], ["Morning routine (copy)", "", true, "a", ["MO"]]);
  assert.notEqual(copied.actions[0].id, step.id);
  const plan = planOf(copied, null, newId);
  assert.ok(plan.ok);
  assert.notEqual(plan.id, routine.id);
  const created = (plan.steps[1] as unknown as { draft: { data: Record<string, unknown>; parent_id: string } }).draft;
  assert.deepEqual(created.data, { days: "MO" });
  assert.equal(created.parent_id, plan.id);
});

test("a copy of a long name still fits the name limit, without splitting a character", () => {
  const make = (title: string) => copyDraft({ id: newId(), kind: "routine", title, who: "a", group_key: null, data: null, sort: 0 } as unknown as ItemRow, [], newId).title;
  assert.equal(make("x".repeat(100)).length, 107);
  assert.equal(make("x".repeat(LIMITS.title)).length, LIMITS.title);
  assert.equal(make("x".repeat(LIMITS.title)).endsWith(" (copy)"), true);
  const emoji = make("a" + "😀".repeat(LIMITS.title));
  assert.ok(emoji.length <= LIMITS.title);
  assert.doesNotMatch(emoji, /[\ud800-\udbff] \(copy\)$/);
  assert.equal(make("x".repeat(LIMITS.title - 7)).length, LIMITS.title);
});

test("a duplicate can be made private by choice, and then takes the signed-in side as owner", async () => {
  const { store, rows } = await world();
  const shared = planOf({ ...blankDraft("a"), title: "Bag checklist", who: "both", actions: [action("pack", { title: "item 1" })] }, null, newId);
  assert.ok(shared.ok);
  await store.many(shared.steps);
  const [routine] = rows().filter((row) => row.kind === "routine");
  const copied = { ...copyDraft(routine, children(rows(), routine), newId), private: true, who: "a" as const };
  const plan = planOf(copied, null, newId);
  assert.ok(plan.ok);
  assert.deepEqual(await store.many(plan.steps), { ok: true, id: plan.id });
  const made = rows().find((row) => row.id === plan.id)!;
  assert.deepEqual([made.title, made.who, made.data], ["Bag checklist (copy)", "a", { private: true }]);
  assert.equal(children(rows(), made).length, 1);
  assert.equal(rows().find((row) => row.id === routine.id)?.data?.private, undefined);
});

test("the draft limits are the registry's caps", () => {
  assert.deepEqual(LIMITS, { title: 120, heading: 60, note: 2000, where: 120, unit: 24 });
});

test("the smallest values are valid: one minute, a target of one, and a start week with every two weeks", () => {
  const draft = (fields: Partial<RoutineDraft>, ...actions: ActionDraft[]): RoutineDraft => ({ ...blankDraft("a"), title: "x", actions, ...fields });
  assert.deepEqual(problemsOf(draft({}, action("timer", { title: "t", minutes: "1" }), action("counter", { title: "c", qty: "1" }))), []);
  assert.deepEqual(problemsOf(draft({ every: "2", from: "2026-10-26" })), []);
  assert.deepEqual(problemsOf(draft({ every: "2" })).map((problem) => problem.code), ["from"]);
  assert.deepEqual(problemsOf(draft({ every: "1" })), []);
});

test("one problem alone is enough to refuse the plan", () => {
  const plan = planOf({ ...blankDraft("a"), title: " " }, null, newId);
  assert.deepEqual(plan, { ok: false, problems: [{ at: null, field: "title", code: "required" }] });
});

test("reading a routine back fills every field of the form, including the ones the kind does not use", () => {
  const routine = { id: newId(), kind: "routine", title: "Deep clean", who: "b", group_key: null, data: { days: "SU", every_weeks: "2", from: "2026-10-25", paused_until: "2026-11-01" }, sort: 0, created_at: "x" } as unknown as ItemRow;
  const step = { id: newId(), kind: "step", title: "item 1", parent_id: routine.id, sort: 0, created_at: "x", qty: null, note: null, group_key: null, data: null } as unknown as ItemRow;
  const timer = { id: newId(), kind: "timer", title: "item 2", parent_id: routine.id, sort: 1, created_at: "x", qty: null, note: null, group_key: null, data: { minutes: 15 } } as unknown as ItemRow;
  const draft = draftOf(routine, [timer, step]);
  assert.deepEqual([draft.who, draft.moment, draft.days, draft.every, draft.from, draft.pausedUntil, draft.private], ["b", "", ["SU"], "2", "2026-10-25", "2026-11-01", false]);
  assert.deepEqual(draft.actions.map((entry) => [entry.id, entry.qty, entry.minutes, entry.note, entry.days]), [[step.id, "", "", "", []], [timer.id, "", "15", "", []]]);
  assert.equal(draftOf({ ...routine, data: {} }, []).every, "1");
});

test("a new action is stored with only the columns it uses", () => {
  const plan = planOf({ ...blankDraft("a"), title: "x", actions: [action("step", { title: "item 1" })] }, null, newId);
  assert.ok(plan.ok);
  const created = plan.steps[1] as unknown as { draft: Record<string, unknown> };
  assert.deepEqual(Object.keys(created.draft).sort(), ["data", "kind", "parent_id", "sort", "title"]);
  assert.deepEqual(created.draft.data, {});
});
