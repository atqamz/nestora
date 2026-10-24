import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTION_KINDS, DAY_CODES } from "../shared/routines.ts";
import type { ItemRow } from "../shared/tables.ts";
import { KIND_FIELDS, LIMITS, blankAction, blankDraft, copyDraft, draftOf, planOf, problemsOf, savePlan } from "../src/domain/routine-draft.ts";
import type { ActionDraft, RoutineDraft } from "../src/domain/routine-draft.ts";
import { text } from "../src/ui/text.ts";
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
    action("day_type", { title: "Day type 1", days: ["MO", "TH"] }),
    action("counter", { title: "item 5", qty: "2", unit: "portions" }),
    action("text", { title: "item 6" }),
  ],
});

type Dict = Record<string, unknown>;

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
  const plan = planOf(everything(), null, [], newId);
  assert.ok(plan.ok);
  assert.equal(plan.steps.length, 8);
  assert.deepEqual(plan.names, ["Morning routine", "item 1", "item 2", "item 3", "item 4", "Day type 1", "item 5", "item 6"]);
  const written = await store.many(plan.steps);
  assert.deepEqual(written, { ok: true, id: plan.id });
  const [routine] = rows().filter((row) => row.kind === "routine");
  assert.equal(routine.id, plan.id);
  assert.deepEqual([routine.title, routine.who, routine.group_key, routine.data], ["Morning routine", "a", "morning", {}]);
  const stored = children(rows(), routine);
  assert.deepEqual(stored.map((row) => [row.kind, row.title, row.sort]), [["step", "item 1", 0], ["timer", "item 2", 1], ["pack", "item 3", 2], ["block", "item 4", 3], ["day_type", "Day type 1", 4], ["counter", "item 5", 5], ["text", "item 6", 6]]);
  assert.deepEqual(stored.map((row) => row.data), [{ days: "MO,TH", url: "https://example.com/a" }, { minutes: 45 }, {}, { days: "MO", start_time: "09:00", end_time: "12:00", where: "Place A" }, { days: "MO,TH" }, { unit: "portions" }, {}]);
  assert.deepEqual([stored[0].note, stored[0].group_key, stored[5].qty, stored[1].note, stored[1].qty], ["line 1\nline 2", "Kettle", 2, null, null]);
  assert.ok(stored.every((row) => row.parent_id === routine.id));
});

test("the routine rule is stored sparsely: every day and every week leave no keys, other rules leave exactly theirs", async () => {
  const { store, rows } = await world();
  const draft = { ...blankDraft("a"), title: "Bag checklist", who: "both" as const, moment: "on_demand", days: ["MO", "TU", "WE", "TH", "FR"] as RoutineDraft["days"], every: "2", from: "2026-10-26", pausedUntil: "2026-11-02" };
  const plan = planOf(draft, null, [], newId);
  assert.ok(plan.ok);
  await store.many(plan.steps);
  const [routine] = rows();
  assert.deepEqual([routine.who, routine.group_key, routine.data], ["both", "on_demand", { days: "MO,TU,WE,TH,FR", every_weeks: "2", from: "2026-10-26", paused_until: "2026-11-02" }]);
  const weekly = planOf({ ...draft, every: "1", days: [...DAY_CODES], pausedUntil: "" }, null, [], newId);
  assert.ok(weekly.ok);
  assert.deepEqual((weekly.steps[0] as unknown as { draft: { data: unknown } }).draft.data, {});
});

test("a private routine is created private, owned by the signed-in side, and the flag is never sent again on an edit", async () => {
  const { store, rows } = await world();
  const plan = planOf({ ...blankDraft("a"), title: "Evening routine", private: true }, null, [], newId);
  assert.ok(plan.ok);
  await store.many(plan.steps);
  const [routine] = rows();
  assert.deepEqual([routine.who, routine.data], ["a", { private: true }]);
  const edit = planOf({ ...draftOf(routine, []), title: "Evening routine 2" }, { routine, actions: [] }, [], newId);
  assert.ok(edit.ok);
  assert.deepEqual(edit.steps, [{ op: "update", table: "items", id: routine.id, change: { title: "Evening routine 2" } }]);
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
  assert.deepEqual(planOf(draft, null, [], newId), { ok: false, problems: problemsOf(draft), gone: [] });
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
  const plan = planOf(everything(), null, [], newId);
  assert.ok(plan.ok);
  await store.many(plan.steps);
  const [routine] = rows().filter((row) => row.kind === "routine");
  const before = store.getSnapshot().pending;
  const again = planOf(draftOf(routine, children(rows(), routine)), { routine, actions: children(rows(), routine) }, children(rows(), routine), newId);
  assert.ok(again.ok);
  assert.deepEqual(again.steps, []);
  assert.deepEqual(await store.many(again.steps), { ok: true, id: "" });
  assert.equal(store.getSnapshot().pending, before);
});

test("an edit renames, retimes, reorders, removes and adds, and keeps today's ticks", async () => {
  const { store, rows } = await world();
  const plan = planOf(everything(), null, [], newId);
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
  const next = planOf(edited, current, current.actions, newId);
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
  const plan = planOf(everything(), null, [], newId);
  assert.ok(plan.ok);
  await store.many(plan.steps);
  const [routine] = rows().filter((row) => row.kind === "routine");
  const actions = children(rows(), routine);
  const draft = draftOf(routine, actions);
  const next = planOf({ ...draft, actions: draft.actions.slice(0, 5) }, { routine, actions }, actions, newId);
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
  const plan = planOf(copied, null, [], newId);
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
  const shared = planOf({ ...blankDraft("a"), title: "Bag checklist", who: "both", actions: [action("pack", { title: "item 1" })] }, null, [], newId);
  assert.ok(shared.ok);
  await store.many(shared.steps);
  const [routine] = rows().filter((row) => row.kind === "routine");
  const copied = { ...copyDraft(routine, children(rows(), routine), newId), private: true, who: "a" as const };
  const plan = planOf(copied, null, [], newId);
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
  const plan = planOf({ ...blankDraft("a"), title: " " }, null, [], newId);
  assert.deepEqual(plan, { ok: false, problems: [{ at: null, field: "title", code: "required" }], gone: [] });
});

test("reading a routine back fills every field of the form, including the ones the kind does not use", () => {
  const routine = { id: newId(), kind: "routine", title: "Deep clean", who: "b", group_key: null, data: { days: "SU", every_weeks: "2", from: "2026-10-25", paused_until: "2026-11-01" }, sort: 0, created_at: "x" } as unknown as ItemRow;
  const step = { id: newId(), kind: "step", title: "item 1", parent_id: routine.id, sort: 0, created_at: "x", qty: null, note: null, group_key: null, data: null } as unknown as ItemRow;
  const timer = { id: newId(), kind: "timer", title: "item 2", parent_id: routine.id, sort: 1, created_at: "x", qty: null, note: null, group_key: null, data: { minutes: 15 } } as unknown as ItemRow;
  const draft = draftOf(routine, [timer, step]);
  assert.deepEqual([draft.who, draft.moment, draft.days, draft.every, draft.from, draft.pausedUntil, draft.private], ["b", "", ["SU"], "2", "2026-10-25", "2026-11-01", false]);
  assert.deepEqual(draft.actions.map((entry) => [entry.id, entry.qty, entry.minutes, entry.note, entry.days, entry.heading]), [[step.id, "", "", "", [], ""], [timer.id, "", "15", "", [], ""]]);
  assert.equal(draftOf(routine, [{ ...step, group_key: "Heading 1" }]).actions[0].heading, "Heading 1");
  assert.equal(draftOf({ ...routine, data: {} }, []).every, "1");
});

test("a new action is stored with only the columns it uses", () => {
  const plan = planOf({ ...blankDraft("a"), title: "x", actions: [action("step", { title: "item 1" })] }, null, [], newId);
  assert.ok(plan.ok);
  const created = plan.steps[1] as unknown as { draft: Record<string, unknown> };
  assert.deepEqual(Object.keys(created.draft).sort(), ["data", "kind", "parent_id", "sort", "title"]);
  assert.deepEqual(created.draft.data, {});
});

const sync = async (...stores: Awaited<ReturnType<typeof world>>["store"][]) => {
  for (let round = 0; round < 2; round++) for (const store of stores) await store.sync();
};

const open = async (server: ReturnType<typeof createServer>, side: "a" | "b") => {
  const { store } = client(server, side);
  await store.open();
  await store.sync();
  return store;
};

const concurrent = async (who: "a" | "both" = "both") => {
  const server = createServer();
  const mine = await open(server, "a");
  const plan = planOf({ ...blankDraft("a"), title: "Routine 1", who, actions: [1, 2, 3].map((n) => action("step", { title: `item ${n}`, note: `note ${n}` })) }, null, [], newId);
  assert.ok(plan.ok);
  await mine.many(plan.steps);
  await sync(mine);
  const rows = (store: typeof mine) => store.getSnapshot().rows.items;
  const routineOf = (store: typeof mine) => rows(store).find((row) => row.id === plan.id)!;
  const actionsOf = (store: typeof mine) => children(rows(store), routineOf(store));
  const [r1, r2, r3] = actionsOf(mine);
  const sheet = () => {
    const opened = { routine: routineOf(mine), actions: actionsOf(mine) };
    const draft = draftOf(opened.routine, opened.actions);
    return {
      draft,
      opened,
      save: async (next: RoutineDraft) => {
        const saved = savePlan(next, opened, { routine: routineOf(mine), actions: actionsOf(mine) }, newId);
        assert.ok(saved.ok);
        assert.equal((await mine.many(saved.steps)).ok, true);
        return saved;
      },
    };
  };
  const truth = async () => {
    const check = await open(server, "a");
    return { routine: routineOf(check), actions: actionsOf(check) };
  };
  return { server, mine, sheet, truth, routineOf, actionsOf, r1, r2, r3 };
};

const titlesOf = (rows: readonly ItemRow[]) => rows.map((row) => row.title);

for (const [side, where] of [["a", "another device of the same partner"], ["b", "the other partner on a shared routine"]] as const) {
  test(`saving the sheet leaves alone an action added and an action deleted on ${where} while it was open`, async () => {
    const w = await concurrent();
    const elsewhere = await open(w.server, side);
    const open_ = w.sheet();
    await elsewhere.many([{ op: "delete", table: "items", id: w.r2.id }, { op: "create", table: "items", id: newId(), draft: { kind: "step", title: "item 4", parent_id: w.r1.parent_id, sort: 3 } }]);
    await sync(elsewhere, w.mine);
    assert.deepEqual(titlesOf(w.actionsOf(w.mine)), ["item 1", "item 3", "item 4"]);
    const saved = await open_.save({ ...open_.draft, title: "Routine 2" });
    assert.deepEqual(saved.steps.map((step) => step.op), ["update"]);
    await sync(w.mine, elsewhere);
    const now = await w.truth();
    assert.equal(now.routine.title, "Routine 2");
    assert.deepEqual(titlesOf(now.actions), ["item 1", "item 3", "item 4"]);
  });

  test(`an action the user removed is deleted, one removed on ${where} is not deleted twice, and one added there stays`, async () => {
    const w = await concurrent();
    const elsewhere = await open(w.server, side);
    const open_ = w.sheet();
    await elsewhere.many([{ op: "delete", table: "items", id: w.r2.id }, { op: "create", table: "items", id: newId(), draft: { kind: "step", title: "item 4", parent_id: w.r1.parent_id, sort: 3 } }]);
    await sync(elsewhere, w.mine);
    const saved = await open_.save({ ...open_.draft, actions: open_.draft.actions.filter((entry) => entry.id !== w.r3.id && entry.id !== w.r2.id) });
    assert.deepEqual(saved.steps.filter((step) => step.op === "delete").map((step) => step.id), [w.r3.id]);
    await sync(w.mine, elsewhere);
    assert.deepEqual(titlesOf((await w.truth()).actions), ["item 1", "item 4"]);
  });

  test(`an action the user added is created next to one added on ${where}`, async () => {
    const w = await concurrent();
    const elsewhere = await open(w.server, side);
    const open_ = w.sheet();
    await elsewhere.many([{ op: "create", table: "items", id: newId(), draft: { kind: "step", title: "item 4", parent_id: w.r1.parent_id, sort: 3 } }]);
    await sync(elsewhere, w.mine);
    await open_.save({ ...open_.draft, actions: [...open_.draft.actions, action("pack", { title: "item 5" })] });
    await sync(w.mine, elsewhere);
    assert.deepEqual(titlesOf((await w.truth()).actions).sort(), ["item 1", "item 2", "item 3", "item 4", "item 5"]);
  });

  test(`an edit on ${where} to a field the user left alone survives, and the same field is last write wins`, async () => {
    const w = await concurrent();
    const elsewhere = await open(w.server, side);
    const open_ = w.sheet();
    await elsewhere.update("items", w.r1.id, { title: "item 1 elsewhere" });
    await elsewhere.update("items", w.r2.id, { note: "note 2 elsewhere", title: "item 2 elsewhere" });
    await elsewhere.update("items", w.routineOf(elsewhere).id, { data: { paused_until: "2026-11-02" }, group_key: "evening" });
    await sync(elsewhere, w.mine);
    const [one, two, three] = open_.draft.actions;
    const saved = await open_.save({ ...open_.draft, title: "Routine 2", actions: [{ ...one, note: "note 1 here" }, two, { ...three, title: "item 3 here" }] });
    assert.deepEqual(saved.steps.map((step) => step.id), [w.routineOf(w.mine).id, w.r1.id, w.r3.id]);
    await sync(w.mine, elsewhere);
    const now = await w.truth();
    assert.deepEqual([now.routine.title, now.routine.group_key, now.routine.data], ["Routine 2", "evening", { paused_until: "2026-11-02" }]);
    assert.deepEqual(now.actions.map((row) => [row.title, row.note]), [["item 1 elsewhere", "note 1 here"], ["item 2 elsewhere", "note 2 elsewhere"], ["item 3 here", "note 3"]]);
  });

  test(`an action deleted on ${where} stays deleted: saving an edit of it is refused with the action named, and the rest saves after it is dropped`, async () => {
    const w = await concurrent();
    const elsewhere = await open(w.server, side);
    const open_ = w.sheet();
    await elsewhere.many([{ op: "delete", table: "items", id: w.r2.id }, { op: "delete", table: "items", id: w.r3.id }]);
    await sync(elsewhere, w.mine);
    const [one, two, three] = open_.draft.actions;
    const refused = planOf({ ...open_.draft, title: "Routine 2", actions: [one, { ...two, title: "item 2 here" }, { ...three }] }, open_.opened, w.actionsOf(w.mine), newId);
    assert.deepEqual(refused, { ok: false, problems: [], gone: [w.r2.id] });
    const saved = await open_.save({ ...open_.draft, title: "Routine 2", actions: [one, three] });
    assert.deepEqual(saved.steps.map((step) => step.id), [w.routineOf(w.mine).id]);
    await sync(w.mine, elsewhere);
    const now = await w.truth();
    assert.deepEqual(now.actions.map((row) => [row.id, row.title]), [[w.r1.id, "item 1"]]);
    assert.equal(now.routine.title, "Routine 2");
  });

  test(`an action deleted on ${where} and left untouched in the sheet is neither refused nor written`, async () => {
    const w = await concurrent();
    const elsewhere = await open(w.server, side);
    const open_ = w.sheet();
    await elsewhere.many([{ op: "delete", table: "items", id: w.r2.id }]);
    await sync(elsewhere, w.mine);
    const saved = await open_.save({ ...open_.draft, title: "Routine 2" });
    assert.deepEqual(saved.steps.map((step) => step.id), [w.routineOf(w.mine).id]);
    await sync(w.mine, elsewhere);
    assert.deepEqual(titlesOf((await w.truth()).actions), ["item 1", "item 3"]);
  });

  test(`a reorder on ${where} survives a save that did not reorder, and a reorder in the sheet keeps what was added there`, async () => {
    const w = await concurrent();
    const elsewhere = await open(w.server, side);
    const open_ = w.sheet();
    await elsewhere.many([{ op: "update", table: "items", id: w.r3.id, change: { sort: -1 } }, { op: "create", table: "items", id: newId(), draft: { kind: "step", title: "item 4", parent_id: w.r1.parent_id, sort: 3 } }]);
    await sync(elsewhere, w.mine);
    const kept = await open_.save({ ...open_.draft, title: "Routine 2" });
    assert.deepEqual(kept.steps.map((step) => step.id), [w.routineOf(w.mine).id]);
    await sync(w.mine, elsewhere);
    assert.deepEqual(titlesOf((await w.truth()).actions), ["item 3", "item 1", "item 2", "item 4"]);
    const again = w.sheet();
    const [first, second, ...rest] = again.draft.actions;
    await again.save({ ...again.draft, actions: [second, first, ...rest] });
    await sync(w.mine, elsewhere);
    assert.deepEqual(titlesOf((await w.truth()).actions), ["item 1", "item 3", "item 2", "item 4"]);
  });
}

test("an action removed in the sheet and edited elsewhere is still deleted, and a sheet opened and saved untouched writes nothing", async () => {
  const w = await concurrent();
  const elsewhere = await open(w.server, "b");
  const open_ = w.sheet();
  await elsewhere.update("items", w.r2.id, { title: "item 2 elsewhere" });
  await sync(elsewhere, w.mine);
  assert.deepEqual((await open_.save(open_.draft)).steps, []);
  const saved = await open_.save({ ...open_.draft, actions: open_.draft.actions.filter((entry) => entry.id !== w.r2.id) });
  assert.deepEqual(saved.steps.map((step) => step.op), ["delete"]);
  await sync(w.mine, elsewhere);
  assert.deepEqual(titlesOf((await w.truth()).actions), ["item 1", "item 3"]);
});

test("a new draft and a new action start empty, and Save refuses them until each is named", () => {
  assert.deepEqual(blankAction("step", "id-1"), { id: "id-1", kind: "step", title: "", heading: "", days: [], note: "", url: "", minutes: "", qty: "", unit: "", start: "", end: "", where: "" });
  assert.deepEqual(blankDraft("b"), { title: "", who: "b", moment: "morning", days: [...DAY_CODES], every: "1", from: "", pausedUntil: "", private: false, actions: [] });
  assert.deepEqual(problemsOf({ ...blankDraft("a"), actions: [blankAction("step", "id-1")] }).map((problem) => [problem.at, problem.field, problem.code]), [[null, "title", "required"], [0, "title", "required"]]);
  assert.deepEqual(problemsOf({ ...blankDraft("a"), title: "x", actions: [blankAction("timer", "id-1"), blankAction("counter", "id-2"), blankAction("block", "id-3")] }).map((problem) => [problem.at, problem.field]), [[0, "title"], [0, "minutes"], [1, "title"], [1, "qty"], [2, "title"], [2, "start"]]);
});

test("a copy of a name that ends in the middle of an emoji drops the half character, and one that fits is kept whole", () => {
  const make = (title: string) => copyDraft({ id: newId(), kind: "routine", title, who: "a", group_key: null, data: null, sort: 0 } as unknown as ItemRow, [], newId).title;
  assert.equal(make("x".repeat(112) + "😀".repeat(3)), "x".repeat(112) + " (copy)");
  assert.equal(make("x".repeat(113) + "😀"), "x".repeat(113) + " (copy)");
  assert.equal(make("x".repeat(113)), "x".repeat(113) + " (copy)");
  assert.equal(make("Routine 1"), "Routine 1 (copy)");
});

test("numbers padded with spaces count as the number, and a padded zero is still refused", () => {
  const found = (kind: "timer" | "counter", value: string) =>
    problemsOf({ ...blankDraft("a"), title: "x", actions: [action(kind, { title: "t", minutes: kind === "timer" ? value : "", qty: kind === "counter" ? value : "" })] }).map((problem) => [problem.field, problem.code]);
  assert.deepEqual(found("timer", " 45 "), []);
  assert.deepEqual(found("timer", "\t7\n"), []);
  assert.deepEqual(found("timer", " 0 "), [["minutes", "number"]]);
  assert.deepEqual(found("timer", "   "), [["minutes", "required"]]);
  assert.deepEqual(found("counter", " 3 "), []);
  assert.deepEqual(found("counter", " 0 "), [["qty", "number"]]);
  assert.deepEqual(found("counter", "   "), [["qty", "required"]]);
  const plan = planOf({ ...blankDraft("a"), title: "x", actions: [action("timer", { title: "t", minutes: " 45 " }), action("counter", { title: "c", qty: " 3 " })] }, null, [], newId);
  assert.ok(plan.ok);
  const made = plan.steps.slice(1) as unknown as { draft: { qty?: number; data: Record<string, unknown> } }[];
  assert.deepEqual([made[0].draft.data.minutes, made[1].draft.qty], [45, 3]);
});

test("text is stored without the spaces around it, and a heading of spaces is no heading", () => {
  const plan = planOf(
    {
      ...blankDraft("a"),
      title: " Routine 1 ",
      moment: "  ",
      actions: [
        action("step", { title: " item 1 ", heading: " Heading 1 ", note: " note 1 ", url: " https://example.com/a " }),
        action("block", { title: "\titem 2\t", heading: "   ", start: "09:00", end: "10:00", where: " Place A " }),
        action("counter", { title: " item 3 ", qty: "2", unit: " glasses " }),
      ],
    },
    null,
    [],
    newId,
  );
  assert.ok(plan.ok);
  assert.deepEqual(plan.names, ["Routine 1", "item 1", "item 2", "item 3"]);
  const made = plan.steps.map((step) => (step as unknown as { draft: Record<string, unknown> }).draft);
  assert.equal(made[0].group_key, undefined);
  assert.deepEqual([made[1].title, made[1].group_key, made[1].note, (made[1].data as Dict).url], ["item 1", "Heading 1", "note 1", "https://example.com/a"]);
  assert.deepEqual([made[2].title, made[2].group_key, made[2].data], ["item 2", undefined, { start_time: "09:00", end_time: "10:00", where: "Place A" }]);
  assert.deepEqual([made[3].title, (made[3].data as Dict).unit], ["item 3", "glasses"]);
  const edit = planOf({ ...blankDraft("a"), title: "Routine 1", moment: "morning", actions: [] }, { routine: { id: newId(), kind: "routine", title: "Routine 1", who: "a", group_key: "morning", data: null, sort: 0 } as unknown as ItemRow, actions: [] }, [], newId);
  assert.ok(edit.ok);
  assert.deepEqual(edit.steps, []);
});

test("a step link is checked before anything is sent, with the problem on the link field", () => {
  const found = (url: string, kind: "step" | "pack" = "step") => problemsOf({ ...blankDraft("a"), title: "x", actions: [action(kind, { title: "t", url })] }).map((problem) => [problem.at, problem.field, problem.code]);
  assert.deepEqual(found("not a url"), [[0, "url", "url"]]);
  assert.deepEqual(found("ftp://example.com"), [[0, "url", "url"]]);
  assert.deepEqual(found("https://exa mple.com"), [[0, "url", "url"]]);
  assert.deepEqual(found("https://example.com/a"), []);
  assert.deepEqual(found("  https://example.com/a  "), []);
  assert.deepEqual(found(""), []);
  assert.deepEqual(found("   "), []);
  assert.deepEqual(found("not a url", "pack"), []);
  assert.match(text.routines.form.problem.url, /http/);
  assert.deepEqual(planOf({ ...blankDraft("a"), title: "x", actions: [action("step", { title: "t", url: "not a url" })] }, null, [], newId), { ok: false, problems: [{ at: 0, field: "url", code: "url" }], gone: [] });
});

test("a routine name is compared without the spaces around it, so a padded name that did not change writes nothing", () => {
  const routine = { id: newId(), kind: "routine", title: " Routine 1 ", who: "a", group_key: "morning", data: null, sort: 0 } as unknown as ItemRow;
  const steps = (draft: RoutineDraft, opened: ItemRow) => {
    const plan = planOf(draft, { routine: opened, actions: [] }, [], newId);
    assert.ok(plan.ok);
    return plan.steps;
  };
  assert.deepEqual(steps(draftOf(routine, []), routine), []);
  assert.deepEqual(steps({ ...draftOf(routine, []), title: "Routine 1" }, routine), []);
  assert.deepEqual(steps({ ...draftOf(routine, []), title: "  Routine 1" }, { ...routine, title: "Routine 1" }), []);
});

test("removing or adding actions without moving any leaves the order of the others alone, and a new action goes after the last live one", async () => {
  const w = await concurrent();
  const first = w.sheet();
  const dropped = await first.save({ ...first.draft, actions: first.draft.actions.slice(1) });
  assert.deepEqual(dropped.steps.map((step) => step.op), ["delete"]);
  const second = w.sheet();
  const added = await second.save({ ...second.draft, actions: [...second.draft.actions, action("pack", { title: "item 4" })] });
  assert.deepEqual(added.steps.map((step) => step.op), ["create"]);
  assert.equal((added.steps[0] as unknown as { draft: { sort: number } }).draft.sort, 3);
  await sync(w.mine);
  assert.deepEqual(titlesOf((await w.truth()).actions), ["item 2", "item 3", "item 4"]);
  const third = w.sheet();
  const [one, two, ...rest] = third.draft.actions;
  const between = await third.save({ ...third.draft, actions: [one, action("pack", { title: "item 5" }), two, ...rest] });
  assert.deepEqual(between.steps.map((step) => step.op), ["update", "create", "update", "update"]);
  await sync(w.mine);
  assert.deepEqual(titlesOf((await w.truth()).actions), ["item 2", "item 5", "item 3", "item 4"]);
});

test("the sheet's save is planned from the snapshot it opened with and the rows that are live now, and a creation has no live rows", async () => {
  const w = await concurrent();
  const elsewhere = await open(w.server, "b");
  const open_ = w.sheet();
  await elsewhere.update("items", w.r1.id, { title: "item 1 elsewhere" });
  await elsewhere.many([{ op: "delete", table: "items", id: w.r2.id }]);
  await sync(elsewhere, w.mine);
  const live = { routine: w.routineOf(w.mine), actions: w.actionsOf(w.mine) };
  const edited = { ...open_.draft, title: "Routine 2" };
  const planned = savePlan(edited, open_.opened, live, newId);
  assert.ok(planned.ok);
  assert.deepEqual(planned.steps.map((step) => step.id), [live.routine.id]);
  assert.deepEqual(planned, planOf(edited, open_.opened, live.actions, newId));
  const wrongSnapshot = savePlan(edited, live, live, newId);
  assert.ok(wrongSnapshot.ok);
  assert.ok(wrongSnapshot.steps.length > planned.steps.length);
  assert.ok(wrongSnapshot.steps.some((step) => step.id === w.r1.id));
  const noLive = savePlan(edited, open_.opened, null, newId);
  assert.ok(noLive.ok);
  assert.deepEqual(noLive.steps.map((step) => step.id), [live.routine.id]);
  const noRows = savePlan({ ...open_.draft, actions: open_.draft.actions.slice(0, 1) }, open_.opened, { routine: live.routine, actions: [] }, newId);
  assert.ok(noRows.ok);
  assert.deepEqual(noRows.steps, []);
  const made = savePlan(everything(), null, null, newId);
  assert.ok(made.ok);
  assert.equal(made.steps.length, 8);
});
