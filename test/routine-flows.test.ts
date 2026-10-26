import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import type { Side } from "../shared/api.ts";
import { routineDay } from "../shared/routines.ts";
import type { ItemRow } from "../shared/tables.ts";
import { blankAction, blankDraft, planOf } from "../src/domain/routine-draft.ts";
import { createSession } from "../src/store/partition.ts";
import { overlay } from "../src/ui/overlay.ts";
import { routineFlows } from "../src/ui/routine-flows.ts";
import { text } from "../src/ui/text.ts";
import { client, idOf } from "./store-client.ts";
import { createServer } from "./store-server.ts";

const NOW = new Date("2026-10-26T03:00:00Z");

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let counter = 0;
const newId = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;

const world = async (t: TestContext, me: Side = "a", server = createServer()) => {
  t.after(() => overlay.dismissToast());
  overlay.dismissToast();
  const { store } = client(server, me);
  await store.open();
  const hashes: string[] = [];
  const clock = { now: NOW };
  const rows = () => store.getSnapshot().rows.items;
  const row = (id: string) => rows().find((candidate) => candidate.id === id)!;
  const flows = () => routineFlows({ items: rows(), actions: store, me, day: routineDay(clock.now), go: (hash) => hashes.push(hash) });
  const make = async (draft = blankDraft(me)) => {
    const plan = planOf(draft, null, [], newId);
    assert.ok(plan.ok);
    idOf(await store.many(plan.steps));
    return plan.id;
  };
  const undo = async () => {
    const toast = overlay.getSnapshot().toast;
    assert.ok(toast?.action, "the toast offers Undo");
    toast.action.run();
    overlay.dismissToast();
    await settle();
    await settle();
  };
  return { server, store, hashes, clock, rows, row, flows, make, undo };
};

const draftWith = (who: "a" | "b" | "both", ...kinds: Parameters<typeof blankAction>[0][]) => ({
  ...blankDraft("a"),
  title: "Morning routine",
  who,
  actions: kinds.map((kind, index) => ({ ...blankAction(kind, newId()), title: `item ${index + 1}`, minutes: "5", qty: "2" })),
});

const ids = (rows: readonly ItemRow[], routine: string) => rows.filter((row) => row.parent_id === routine).sort((a, b) => a.sort - b.sort).map((row) => row.id);

test("a tick writes today's routine day under the owner's key, whoever taps, and a second tap clears it", async (t) => {
  const w = await world(t, "b");
  const routine = await w.make({ ...draftWith("a", "step", "pack"), who: "a" });
  const [first] = ids(w.rows(), routine);
  assert.deepEqual(await w.flows().toggle(w.row(routine), w.row(first)), { ok: true, id: first });
  assert.deepEqual(w.row(first).data, { done_a: "2026-10-26" });
  await w.flows().toggle(w.row(routine), w.row(first));
  assert.deepEqual(w.row(first).data, {});
});

test("on a shared routine each partner writes only their own mark", async (t) => {
  const server = createServer();
  const a = await world(t, "a", server);
  const routine = await a.make(draftWith("both", "step"));
  await a.store.sync();
  const [step] = ids(a.rows(), routine);
  const b = await world(t, "b", server);
  await b.store.sync();
  await a.flows().toggle(a.row(routine), a.row(step));
  await b.flows().toggle(b.row(routine), b.row(step));
  for (const store of [a.store, b.store, a.store, b.store]) await store.sync();
  assert.deepEqual(b.row(step).data, { done_a: "2026-10-26", done_b: "2026-10-26" });
  assert.deepEqual(a.row(step).data, { done_a: "2026-10-26", done_b: "2026-10-26" });
  await b.flows().toggle(b.row(routine), b.row(step));
  for (const store of [b.store, a.store]) await store.sync();
  assert.deepEqual(a.row(step).data, { done_a: "2026-10-26" });
});

test("the routine day starts at 04:00 in Jakarta, so a tick before then belongs to the evening before", async (t) => {
  const w = await world(t);
  const routine = await w.make(draftWith("a", "step"));
  const [step] = ids(w.rows(), routine);
  w.clock.now = new Date("2026-10-25T20:59:00Z");
  await w.flows().toggle(w.row(routine), w.row(step));
  assert.deepEqual(w.row(step).data, { done_a: "2026-10-25" });
  await w.flows().toggle(w.row(routine), w.row(step));
  w.clock.now = new Date("2026-10-25T21:00:00Z");
  await w.flows().toggle(w.row(routine), w.row(step));
  assert.deepEqual(w.row(step).data, { done_a: "2026-10-26" });
});

test("the flows write the day the screen shows, so a tap just after 04:00 and the next tap agree with the checkbox", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-25T21:00:20Z") });
  const w = await world(t);
  const routine = await w.make(draftWith("a", "step"));
  const [step] = ids(w.rows(), routine);
  const shown = (day: string) => routineFlows({ items: w.rows(), actions: w.store, me: "a", day, go: () => undefined });
  assert.equal(routineDay(new Date()), "2026-10-26");
  await shown("2026-10-25").toggle(w.row(routine), w.row(step));
  assert.deepEqual(w.row(step).data, { done_a: "2026-10-25" });
  await shown("2026-10-25").toggle(w.row(routine), w.row(step));
  assert.deepEqual(w.row(step).data, {});
  await shown("2026-10-25").plus(w.row(routine), w.row(step));
  assert.deepEqual(w.row(step).data, { done_a: "2026-10-25" });
  await shown("2026-10-26").toggle(w.row(routine), w.row(step));
  assert.deepEqual(w.row(step).data, { done_a: "2026-10-26" });
  assert.deepEqual(await shown("2026-10-25").pause(w.row(routine), "2026-10-26"), { ok: true, id: routine });
  assert.deepEqual(await shown("2026-10-26").pause(w.row(routine), "2026-10-26"), { ok: false, errors: [text.routines.pauseLater] });
});

test("yesterday's tick does not count today, so ticking again marks today and the day moves on without a write", async (t) => {
  const w = await world(t);
  const routine = await w.make(draftWith("a", "step"));
  const [step] = ids(w.rows(), routine);
  await w.store.update("items", step, { data: { done_a: "2026-10-25" } });
  await w.flows().toggle(w.row(routine), w.row(step));
  assert.deepEqual(w.row(step).data, { done_a: "2026-10-26" });
});

test("a counter adds one per tap and a reset clears the count and the day, and a text line cannot be ticked", async (t) => {
  const w = await world(t);
  const routine = await w.make(draftWith("a", "counter", "text"));
  const [counter, line] = ids(w.rows(), routine);
  await w.flows().plus(w.row(routine), w.row(counter));
  await w.flows().plus(w.row(routine), w.row(counter));
  await w.flows().plus(w.row(routine), w.row(counter));
  assert.deepEqual(w.row(counter).data, { done_a: "2026-10-26", value_a: 3 });
  await w.flows().reset(w.row(routine), w.row(counter));
  assert.deepEqual(w.row(counter).data, {});
  const before = w.store.getSnapshot().pending;
  assert.deepEqual(await w.flows().toggle(w.row(routine), w.row(line)), { ok: true, id: "" });
  assert.deepEqual(await w.flows().plus(w.row(routine), w.row(line)), { ok: true, id: "" });
  assert.equal(w.store.getSnapshot().pending, before);
});

test("an old count restarts from zero on a new day", async (t) => {
  const w = await world(t);
  const routine = await w.make(draftWith("a", "counter"));
  const [counter] = ids(w.rows(), routine);
  await w.store.update("items", counter, { data: { done_a: "2026-10-25", value_a: 5 } });
  await w.flows().plus(w.row(routine), w.row(counter));
  assert.deepEqual(w.row(counter).data, { done_a: "2026-10-26", value_a: 1 });
});

test("pausing needs a later day, and resuming clears the date", async (t) => {
  const w = await world(t);
  const routine = await w.make(draftWith("a"));
  assert.deepEqual(await w.flows().pause(w.row(routine), "2026-10-26"), { ok: false, errors: [text.routines.pauseLater] });
  assert.deepEqual(await w.flows().pause(w.row(routine), "2026-10-20"), { ok: false, errors: [text.routines.pauseLater] });
  assert.equal(w.row(routine).data?.paused_until, undefined);
  assert.deepEqual(await w.flows().pause(w.row(routine), "2026-11-02"), { ok: true, id: routine });
  assert.equal(w.row(routine).data?.paused_until, "2026-11-02");
  await w.flows().resume(w.row(routine));
  assert.deepEqual(w.row(routine).data, {});
});

test("saving navigates to a new routine and stays on an edited one", async (t) => {
  const w = await world(t);
  const plan = planOf(draftWith("a", "step"), null, [], newId);
  assert.ok(plan.ok);
  await w.flows().save(plan.steps, plan.id);
  assert.deepEqual(w.hashes, [`/routines/${plan.id}`]);
  await w.flows().save([], null);
  assert.equal(w.hashes.length, 1);
  const refused = await w.flows().save([{ op: "update", table: "items", id: "00000000-0000-4000-8000-00000000ffff", change: { title: "x" } }], plan.id);
  assert.equal(refused.ok, false);
  assert.equal(w.hashes.length, 1);
});

test("deleting hides the routine and every action, goes back to the list, and Undo brings them all back", async (t) => {
  const w = await world(t);
  const routine = await w.make(draftWith("a", "step", "timer", "counter"));
  const other = await w.make({ ...draftWith("a", "step"), title: "Evening routine" });
  const mine = ids(w.rows(), routine);
  await w.flows().toggle(w.row(routine), w.row(mine[0]));
  assert.deepEqual(await w.flows().remove(w.row(routine)), { ok: true, id: routine });
  assert.deepEqual(w.hashes, ["/routines"]);
  assert.deepEqual(w.rows().map((row) => row.id).sort(), [other, ...ids(w.rows(), other)].sort());
  assert.equal(overlay.getSnapshot().toast?.message, text.routines.deleted("Morning routine"));
  await w.undo();
  assert.deepEqual(w.rows().filter((row) => row.id === routine || mine.includes(row.id)).length, 4);
  assert.deepEqual(w.row(mine[0]).data, { done_a: "2026-10-26" });
});

test("while the side is unconfirmed every write answers paused and changes nothing, so the screens show the notice and keep what was typed", async (t) => {
  t.after(() => overlay.dismissToast());
  const server = createServer();
  const warm = client(server, "a");
  await warm.store.open();
  const draft = planOf(draftWith("a", "step"), null, [], newId);
  assert.ok(draft.ok);
  idOf(await warm.store.many(draft.steps));
  const [routine] = warm.store.getSnapshot().rows.items.filter((row) => row.kind === "routine");
  const [step] = warm.store.getSnapshot().rows.items.filter((row) => row.kind === "step");
  const session = createSession({
    disk: { open: () => warm.persistence, legacy: async () => null } as never,
    hint: { get: () => "a", set: () => undefined },
    api: () => ({ pull: async () => ({ kind: "offline" }), push: async () => ({ kind: "offline" }), me: async () => null }) as never,
    later: () => () => undefined,
  });
  await session.open();
  const flows = routineFlows({ items: [], actions: session, me: "a", day: routineDay(NOW), go: () => assert.fail("no navigation while paused") });
  const paused = { ok: false, errors: [], paused: true };
  assert.deepEqual(await flows.toggle(routine, step), paused);
  assert.deepEqual(await flows.plus(routine, step), paused);
  assert.deepEqual(await flows.reset(routine, step), paused);
  assert.deepEqual(await flows.resume(routine), paused);
  assert.deepEqual(await flows.pause(routine, "2026-11-02"), paused);
  assert.deepEqual(await flows.save(draft.steps, draft.id), paused);
  assert.deepEqual(await flows.remove(routine), paused);
  assert.equal(overlay.getSnapshot().toast, null);
  assert.deepEqual(session.getSnapshot().rows.items.map((row) => row.deleted_at), [null, null]);
});

test("without a confirmed side nothing is written", async (t) => {
  const w = await world(t);
  const routine = await w.make(draftWith("a", "step"));
  const [step] = ids(w.rows(), routine);
  const blind = routineFlows({ items: w.rows(), actions: w.store, me: null, day: routineDay(NOW), go: () => undefined });
  const before = w.store.getSnapshot().pending;
  for (const result of [await blind.toggle(w.row(routine), w.row(step)), await blind.plus(w.row(routine), w.row(step)), await blind.reset(w.row(routine), w.row(step))]) {
    assert.deepEqual(result, { ok: false, errors: [], paused: true });
  }
  assert.equal(w.store.getSnapshot().pending, before);
});

test("an Undo that works says nothing, and an Undo that fails says why", async (t) => {
  const w = await world(t);
  const routine = await w.make(draftWith("a", "step"));
  await w.flows().remove(w.row(routine));
  overlay.getSnapshot().toast!.action!.run();
  overlay.dismissToast();
  await settle();
  await settle();
  assert.equal(overlay.getSnapshot().toast, null);
  const failing = routineFlows({
    items: w.rows(),
    actions: { update: w.store.update, many: w.store.many, restore: async () => ({ ok: false, errors: ["row: boom"] }) },
    me: "a",
    day: routineDay(NOW),
    go: () => undefined,
  });
  await failing.remove(w.row(routine));
  overlay.getSnapshot().toast!.action!.run();
  await settle();
  assert.equal(overlay.getSnapshot().toast?.message, "row: boom");
});
