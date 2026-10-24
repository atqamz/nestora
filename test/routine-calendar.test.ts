import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarOf } from "../shared/ics.ts";
import type { ItemRow } from "../shared/tables.ts";
import { blankDraft, draftOf, planOf, problemsOf } from "../src/domain/routine-draft.ts";
import { text } from "../src/ui/text.ts";
import { parse } from "./ics-parse.ts";
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

const form = text.routines.form;

test("a calendar time and a length are stored as start_time and duration, and read back into the sheet", async () => {
  const { store, rows } = await world();
  const draft = { ...blankDraft("a"), title: "Bag", start: "07:15", duration: " 15 " };
  const plan = planOf(draft, null, [], newId);
  assert.ok(plan.ok);
  assert.deepEqual(await store.many(plan.steps), { ok: true, id: plan.id });
  const [routine] = rows();
  assert.deepEqual(routine.data, { start_time: "07:15", duration: 15 });
  const back = draftOf(routine, []);
  assert.deepEqual([back.start, back.duration], ["07:15", "15"]);
  const again = planOf(back, { routine, actions: [] }, [], newId);
  assert.ok(again.ok);
  assert.deepEqual(again.steps, []);
});

test("changing or clearing the calendar time writes only those keys, and clearing the time drops the length", async () => {
  const { store, rows } = await world();
  const created = planOf({ ...blankDraft("a"), title: "Bag", days: ["MO", "TU"], start: "07:15", duration: "20" }, null, [], newId);
  assert.ok(created.ok);
  await store.many(created.steps);
  const [routine] = rows();
  const edit = (patch: Partial<ReturnType<typeof blankDraft>>) => {
    const plan = planOf({ ...draftOf(routine, []), ...patch }, { routine, actions: [] }, [], newId);
    assert.ok(plan.ok);
    return plan.steps;
  };
  assert.deepEqual(edit({ start: "08:00" }), [{ op: "update", table: "items", id: routine.id, change: { data: { start_time: "08:00" } } }]);
  assert.deepEqual(edit({ duration: "" }), [{ op: "update", table: "items", id: routine.id, change: { data: { duration: null } } }]);
  assert.deepEqual(edit({ start: "" }), [{ op: "update", table: "items", id: routine.id, change: { data: { start_time: null, duration: null } } }]);
  assert.deepEqual(edit({ start: "" }).length, 1);
  await store.many(edit({ start: "" }));
  assert.deepEqual(rows()[0].data, { days: "MO,TU" });
});

test("a bad calendar time or length is a problem on its own field, and a timetable ignores both", () => {
  const found = (patch: Partial<ReturnType<typeof blankDraft>>) => problemsOf({ ...blankDraft("a"), title: "x", ...patch }).map((problem) => [problem.at, problem.field, problem.code]);
  assert.deepEqual(found({ start: "7:15" }), [[null, "start", "time"]]);
  assert.deepEqual(found({ start: "24:00" }), [[null, "start", "time"]]);
  assert.deepEqual(found({ start: "07:15", duration: "0" }), [[null, "duration", "number"]]);
  assert.deepEqual(found({ start: "07:15", duration: "1.5" }), [[null, "duration", "number"]]);
  assert.deepEqual(found({ start: "07:15", duration: "abc" }), [[null, "duration", "number"]]);
  assert.deepEqual(found({ start: "07:15", duration: "1" }), []);
  assert.deepEqual(found({ start: "07:15", duration: "" }), []);
  assert.deepEqual(found({ start: "", duration: "abc" }), []);
  assert.deepEqual(found({ moment: "timetable", start: "99", duration: "abc" }), []);
  assert.ok(form.problem.time && form.problem.number);
});

test("a routine saved on a timetable keeps no calendar time even if the draft had one", async () => {
  const { store, rows } = await world();
  const plan = planOf({ ...blankDraft("a"), title: "Weekly timetable", moment: "timetable", start: "07:15", duration: "30" }, null, [], newId);
  assert.ok(plan.ok);
  await store.many(plan.steps);
  assert.deepEqual(rows()[0].data, {});
});

test("a routine made in the sheet reaches the partner's feed with its time and length", async () => {
  const { store, rows } = await world();
  const plan = planOf({ ...blankDraft("a"), title: "Bag", days: ["MO", "TU", "WE", "TH", "FR"], start: "07:15", duration: "15" }, null, [], newId);
  assert.ok(plan.ok);
  await store.many(plan.steps);
  const [event] = parse(calendarOf(rows() as ItemRow[], "a", new Date("2026-10-24T03:00:00Z"), [])).events;
  assert.equal(event.summary, "Bag");
  assert.equal(event.start, "20261019T071500");
  assert.equal(event.minutes, 15);
  assert.deepEqual(event.rrule?.BYDAY, "MO,TU,WE,TH,FR");
});

test("the sheet shows the calendar fields on a plain routine, hides them on a timetable and shows the length only with a time", async () => {
  const { readFileSync } = await import("node:fs");
  const sheet = readFileSync(new URL("../src/ui/routine-sheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /\{!timetable && <Field control=\{\{ name: "routine-start", label: form\.calendarStart, type: "time"/);
  assert.match(sheet, /\{!timetable && draft\.start\.trim\(\) !== "" && \(\s*<Field control=\{\{ name: "routine-duration", label: form\.duration, type: "int"/);
});

test("a routine with a calendar time and no length reads back with an empty length and saves untouched", async () => {
  const { store, rows } = await world();
  const plan = planOf({ ...blankDraft("a"), title: "Bag", start: "07:15" }, null, [], newId);
  assert.ok(plan.ok);
  await store.many(plan.steps);
  const [routine] = rows();
  assert.deepEqual(routine.data, { start_time: "07:15" });
  const back = draftOf(routine, []);
  assert.deepEqual([back.start, back.duration], ["07:15", ""]);
  const again = planOf(back, { routine, actions: [] }, [], newId);
  assert.ok(again.ok);
  assert.deepEqual(again.steps, []);
});
