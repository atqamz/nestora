import { test } from "node:test";
import assert from "node:assert/strict";
import type { ItemRow } from "../shared/tables.ts";
import { draftOf, planOf } from "../src/domain/routine-draft.ts";
import { item } from "./domain-rows.ts";

const routine = item({ kind: "routine", status: null, who: "a", title: "Morning routine", group_key: "morning", data: {} });

const step = (title: string, sort: number, extra: Partial<ItemRow> = {}) => item({ kind: "step", status: null, parent_id: routine.id, title, sort, ...extra });

const one = step("item 1", 0);
const two = item({ kind: "timer", status: null, parent_id: routine.id, title: "item 2", sort: 1, data: { minutes: 5 } });
const three = step("item 3", 2);
const rows = [one, two, three];
const opened = { routine, actions: rows };
const draft = draftOf(routine, rows);

const never = () => {
  throw new Error("an id was asked for");
};

const idsOf = (plan: ReturnType<typeof planOf>) => (plan.ok ? plan.steps.map((entry) => entry.id) : []);

test("a reorder never writes to an action that was removed elsewhere, and writes the sort of the rest", () => {
  const [a, b, c] = draft.actions;
  const live = [one, three];
  const plan = planOf({ ...draft, actions: [c, b, a] }, opened, live, never);
  assert.ok(plan.ok);
  assert.deepEqual(plan.steps.map((entry) => [entry.op, entry.id]), [["update", three.id], ["update", one.id]]);
  assert.deepEqual(plan.names, ["item 3", "item 1"]);
  const everyone = planOf({ ...draft, actions: [c, b, a] }, opened, rows, never);
  assert.ok(everyone.ok);
  assert.deepEqual(idsOf(everyone), [three.id, two.id, one.id]);
});

test("an edit of a removed action is refused whichever part of it changed, and an untouched removed action is not", () => {
  const [a, b, c] = draft.actions;
  const live = [one, three];
  for (const edited of [{ ...b, minutes: "10" }, { ...b, title: "item 2 here" }]) {
    const plan = planOf({ ...draft, actions: [a, edited, c] }, opened, live, never);
    assert.deepEqual(plan, { ok: false, problems: [], gone: [two.id] });
  }
  const note = planOf({ ...draft, actions: [a, b, { ...c, note: "note 3" }] }, opened, [one, two], never);
  assert.deepEqual(note, { ok: false, problems: [], gone: [three.id] });
  const quiet = planOf({ ...draft, title: "Routine 2" }, opened, live, never);
  assert.ok(quiet.ok);
  assert.deepEqual(idsOf(quiet), [routine.id]);
  const both = planOf({ ...draft, actions: [{ ...a, title: "item 1 here" }, { ...b, minutes: "9" }, { ...c, title: "item 3 here" }] }, opened, [], never);
  assert.deepEqual(both, { ok: false, problems: [], gone: [one.id, two.id, three.id] });
});

test("a new routine takes its id from the generator once, an edit never asks for one, and every step is named", () => {
  let asked = 0;
  const made = planOf({ ...draft, title: " Evening routine " }, null, [], () => `id-${++asked}`);
  assert.ok(made.ok);
  assert.deepEqual([made.id, asked], ["id-1", 1]);
  assert.deepEqual(made.steps[0], { op: "create", table: "items", id: "id-1", draft: made.steps[0].op === "create" ? made.steps[0].draft : null });
  assert.deepEqual(made.names, ["Evening routine", "item 1", "item 2", "item 3"]);
  const edit = planOf({ ...draft, title: "Routine 2", actions: draft.actions.slice(0, 2) }, opened, rows, never);
  assert.ok(edit.ok);
  assert.equal(edit.id, routine.id);
  assert.deepEqual(edit.names, ["Routine 2", "item 3"]);
  assert.deepEqual(idsOf(edit), [routine.id, three.id]);
});
