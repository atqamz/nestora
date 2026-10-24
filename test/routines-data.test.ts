import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTION_KINDS } from "../shared/routines.ts";
import { tables } from "../shared/tables.ts";
import { validateChange, validateCreate, validatePatch } from "../shared/validate.ts";
import { CLIENT_STAMP, apply, count, createDb, id, mutation, stored, task } from "./sync-db.ts";

type Obj = Record<string, unknown>;

const stamps = { created_at: CLIENT_STAMP, updated_at: CLIENT_STAMP };

const routine = (n: number, extra: Obj = {}) =>
  mutation("create", "items", id(n), { id: id(n), kind: "routine", title: "Morning routine", who: "a", ...stamps, ...extra });
const action = (n: number, parent: number, kind: string, extra: Obj = {}) =>
  mutation("create", "items", id(n), { id: id(n), kind, parent_id: id(parent), title: "item 1", ...stamps, ...extra });

const accepts = (m: { patch: Obj }) => assert.deepEqual(validateCreate("items", m.patch), []);
const rejects = (m: { patch: Obj }, pattern: RegExp) => assert.match(validateCreate("items", m.patch).join("\n"), pattern);

const rejected = async (promise: ReturnType<typeof apply>, status: number, pattern: RegExp) => {
  const result = (await promise) as { status: number; errors: string[] };
  assert.equal(result.status, status);
  assert.match(result.errors.join("\n"), pattern);
};

test("the action kinds are the registry kinds that point at a routine", () => {
  assert.deepEqual([...ACTION_KINDS], ["step", "timer", "pack", "block", "day_type", "counter", "text"]);
  const variants: Record<string, { columns: readonly string[]; required: readonly string[] }> = tables.items.variants;
  for (const kind of ACTION_KINDS) {
    assert.ok(variants[kind].columns.includes("parent_id"), kind);
    assert.deepEqual(variants[kind].required, ["parent_id"], kind);
  }
  assert.equal(variants.routine.columns.includes("parent_id"), false);
  assert.deepEqual(variants.routine.required, ["who"]);
  assert.deepEqual(variants.counter.columns, ["parent_id", "group_key", "note", "qty"]);
});

test("a full routine and every action kind pass the validator", () => {
  accepts(
    routine(1, {
      group_key: "morning",
      note: "a note",
      data: {
        days: "MO,WE,FR",
        every_weeks: "2",
        from: "2026-10-05",
        until: "2026-12-31",
        paused_until: "2026-11-02",
        start_time: "07:30",
        holidays: true,
        private: true,
        remind: true,
        calendar: false,
      },
    }),
  );
  accepts(action(2, 1, "step", { group_key: "Kettle", note: "how to", data: { days: "SU", done_a: "2026-10-24", done_b: "2026-10-23", url: "https://example.test/steps" } }));
  accepts(action(3, 1, "timer", { data: { minutes: 45, done_a: "2026-10-24" } }));
  accepts(action(4, 1, "pack", { data: { days: "MO,TU,WE,TH,FR", done_b: "2026-10-24" } }));
  accepts(action(5, 1, "block", { data: { days: "MO", start_time: "09:00", end_time: "12:00", where: "Place A" } }));
  accepts(action(6, 1, "day_type", { data: { days: "MO,TH" } }));
  accepts(action(7, 1, "counter", { qty: 2, data: { unit: "portions", value_a: 1, value_b: 0, done_a: "2026-10-24" } }));
  accepts(action(8, 1, "text", { note: "guidance" }));
});

test("a routine needs an owner, takes no parent, and who is a, b or both", () => {
  rejects(routine(1, { who: undefined }), /who: required for kind routine/);
  rejects(routine(1, { who: "c" }), /who: must be one of a, b, both/);
  rejects(routine(1, { parent_id: id(2) }), /parent_id: not used by kind routine/);
  rejects(routine(1, { status: "todo" }), /status: not used by kind routine/);
  for (const who of ["a", "b", "both"]) accepts(routine(1, { who }));
});

test("an action needs a parent and takes only its own columns", () => {
  for (const kind of ACTION_KINDS) {
    rejects(action(2, 1, kind, { parent_id: undefined }), /parent_id: required for kind/);
    rejects(action(2, 1, kind, { who: "a" }), /who: not used by kind/);
    rejects(action(2, 1, kind, { status: "todo" }), /status: not used by kind/);
    rejects(action(2, 1, kind, { due_on: "2026-10-24" }), /due_on: not used by kind/);
    accepts(action(2, 1, kind));
  }
  rejects(action(2, 1, "step", { qty: 1 }), /qty: not used by kind step/);
  accepts(action(2, 1, "counter", { qty: 0 }));
  rejects(action(2, 1, "counter", { qty: -1 }), /qty: must be a non-negative integer/);
});

test("the data keys of each kind are its own", () => {
  rejects(action(2, 1, "step", { data: { minutes: 5 } }), /data\.minutes: unknown key/);
  rejects(action(2, 1, "timer", { data: { url: "https://example.test" } }), /data\.url: unknown key/);
  rejects(action(2, 1, "pack", { data: { unit: "x" } }), /data\.unit: unknown key/);
  rejects(action(2, 1, "block", { data: { done_a: "2026-10-24" } }), /data\.done_a: unknown key/);
  rejects(action(2, 1, "day_type", { data: { done_a: "2026-10-24" } }), /data\.done_a: unknown key/);
  rejects(action(2, 1, "text", { data: { done_b: "2026-10-24" } }), /data\.done_b: unknown key/);
  rejects(action(2, 1, "counter", { data: { value_c: 1 } }), /data\.value_c: unknown key/);
  for (const kind of ACTION_KINDS) rejects(action(2, 1, kind, { data: { private: true } }), /data\.private: unknown key/);
  rejects(routine(1, { data: { done_a: "2026-10-24" } }), /data\.done_a: unknown key/);
  rejects(routine(1, { data: { minutes: 5 } }), /data\.minutes: unknown key/);
});

test("typed data keys are checked", () => {
  rejects(routine(1, { data: { every_weeks: "5" } }), /data\.every_weeks: must be one of 1, 2, 3, 4/);
  rejects(routine(1, { data: { every_weeks: 2 } }), /data\.every_weeks: must be one of/);
  rejects(routine(1, { data: { from: "2026-02-30" } }), /data\.from: must be a date/);
  rejects(routine(1, { data: { until: "soon" } }), /data\.until: must be a date/);
  rejects(routine(1, { data: { paused_until: 5 } }), /data\.paused_until: must be a date/);
  for (const key of ["holidays", "private", "remind", "calendar"]) rejects(routine(1, { data: { [key]: "yes" } }), new RegExp(`data\\.${key}: must be true or false`));
  rejects(action(2, 1, "timer", { data: { minutes: -1 } }), /data\.minutes: must be a non-negative integer/);
  rejects(action(2, 1, "timer", { data: { minutes: 1.5 } }), /data\.minutes: must be a non-negative integer/);
  rejects(action(2, 1, "step", { data: { url: "javascript:alert(1)" } }), /data\.url: must be an http or https URL/);
  rejects(action(2, 1, "counter", { data: { value_a: -1 } }), /data\.value_a: must be a non-negative integer/);
  rejects(action(2, 1, "counter", { data: { done_b: "2026-13-01" } }), /data\.done_b: must be a date/);
});

test("a cadence needs a start and until cannot come before from", () => {
  rejects(routine(1, { data: { every_weeks: "2" } }), /data\.from: required with data\.every_weeks/);
  rejects(routine(1, { data: { every_weeks: "2", until: "2026-12-31" } }), /data\.from: required with data\.every_weeks/);
  accepts(routine(1, { data: { every_weeks: "2", from: "2026-10-05" } }));
  accepts(routine(1, { data: { until: "2026-12-31" } }));
  accepts(routine(1, { data: { from: "2026-10-05" } }));
  accepts(routine(1, { data: { from: "2026-10-05", until: "2026-10-05" } }));
  accepts(routine(1, { data: { from: "2026-10-05", until: "2026-10-06" } }));
  rejects(routine(1, { data: { from: "2026-10-05", until: "2026-10-04" } }), /data\.until: must not be before data\.from/);
  rejects(routine(1, { data: { every_weeks: "2", from: "2026-12-31", until: "2026-01-01" } }), /data\.until: must not be before data\.from/);
});

test("a stored routine that was valid before keeps working, and a patch is checked only when it touches the schedule", () => {
  const row = (data: Obj | null) => ({ id: id(1), kind: "routine", who: "a", title: "Morning routine", currency: "IDR", sort: 0, rev: 1, data, ...stamps, updated_by: "a", deleted_at: null });
  const legacy = row({ every_weeks: "2", from: "2026-10-05", until: "2026-10-01" });
  const noStart = row({ every_weeks: "2" });
  for (const stored of [legacy, noStart]) {
    assert.deepEqual(validateChange("items", stored, { title: "Renamed" }), []);
    assert.deepEqual(validateChange("items", stored, { data: { remind: true } }), []);
  }
  assert.deepEqual(validateChange("items", noStart, { data: { every_weeks: null } }), []);
  assert.deepEqual(validateChange("items", legacy, { data: { until: null } }), []);
  assert.deepEqual(validateChange("items", legacy, { data: { until: "2026-10-05" } }), []);
  assert.deepEqual(validateChange("items", noStart, { data: { from: "2026-10-05" } }), []);
  assert.match(validateChange("items", legacy, { data: { until: "2026-10-04" } }).join(), /data\.until: must not be before data\.from/);
  assert.match(validateChange("items", legacy, { data: { from: "2026-10-06" } }).join(), /data\.until: must not be before data\.from/);
  assert.match(validateChange("items", noStart, { data: { every_weeks: "3" } }).join(), /data\.from: required with data\.every_weeks/);
  assert.match(validateChange("items", row({ every_weeks: "2", from: "2026-10-05" }), { data: { from: null } }).join(), /data\.from: required with data\.every_weeks/);
  assert.match(validateChange("items", row(null), { data: { every_weeks: "2" } }).join(), /data\.from: required with data\.every_weeks/);
  assert.deepEqual(validateChange("items", row(null), { data: { every_weeks: "2", from: "2026-10-05" } }), []);
  const step = { id: id(2), kind: "step", parent_id: id(1), title: "item 1", currency: "IDR", sort: 0, rev: 1, data: null, ...stamps, updated_by: "a", deleted_at: null };
  assert.deepEqual(validateChange("items", step, { data: { done_a: "2026-10-24" } }), []);
});

test("the time type is HH:MM from 00:00 to 23:59", () => {
  for (const good of ["00:00", "07:30", "09:05", "12:00", "19:59", "20:00", "20:30", "21:00", "21:45", "22:00", "22:59", "23:00", "23:59"]) {
    accepts(routine(1, { data: { start_time: good } }));
    accepts(action(2, 1, "block", { data: { start_time: good, end_time: good } }));
  }
  for (const bad of ["24:00", "7:30", "07:60", "07:3", "0730", "07:30:00", " 07:30", "07:30 ", "ab:cd", "-1:00", "", "12.30", "2026-10-24T07:30", "07:30\n"]) {
    rejects(routine(1, { data: { start_time: bad } }), /data\.start_time: must be a time as HH:MM from 00:00 to 23:59/);
    rejects(action(2, 1, "block", { data: { end_time: bad } }), /data\.end_time: must be a time as HH:MM/);
  }
  for (const bad of [730, true, ["07:30"], {}]) rejects(routine(1, { data: { start_time: bad } }), /data\.start_time: must be a time/);
});

test("the days type is distinct weekday codes in week order", () => {
  for (const good of ["MO", "SU", "MO,TH", "MO,TU,WE,TH,FR,SA,SU", "SA,SU", "TU,SU"]) {
    accepts(routine(1, { data: { days: good } }));
    accepts(action(2, 1, "step", { data: { days: good } }));
  }
  for (const bad of ["", "mo", "MO,", ",MO", "MO,,TU", "TU,MO", "MO,MO", "MO TU", "MO, TU", "XX", "MON", "SU,MO", "MO,TU,WE,TH,FR,SA,SU,MO", " MO", "MO\n"]) {
    rejects(routine(1, { data: { days: bad } }), /data\.days: must be weekday codes in order/);
    rejects(action(2, 1, "text", { data: { days: bad } }), /data\.days: must be weekday codes in order/);
  }
  for (const bad of [1, ["MO"], true]) rejects(routine(1, { data: { days: bad } }), /data\.days: must be weekday codes/);
});

test("field lengths are capped per kind", () => {
  const long = (n: number) => "x".repeat(n);
  for (const kind of ["routine", ...ACTION_KINDS]) {
    const make = (extra: Obj) => (kind === "routine" ? routine(1, extra) : action(2, 1, kind, extra));
    accepts(make({ title: long(120), group_key: long(60), note: long(2000) }));
    rejects(make({ title: long(121) }), /title: must be at most 120 characters/);
    rejects(make({ group_key: long(61) }), /group_key: must be at most 60 characters/);
    rejects(make({ note: long(2001) }), /note: must be at most 2000 characters/);
  }
  accepts(action(2, 1, "block", { data: { where: "x".repeat(120) } }));
  rejects(action(2, 1, "block", { data: { where: "x".repeat(121) } }), /data\.where: must be at most 120 characters/);
  accepts(action(2, 1, "counter", { data: { unit: "x".repeat(24) } }));
  rejects(action(2, 1, "counter", { data: { unit: "x".repeat(25) } }), /data\.unit: must be at most 24 characters/);
  rejects(action(2, 1, "step", { data: { url: `https://example.test/${"x".repeat(3000)}` } }), /data\.url: must be an http or https URL/);
});

test("caps apply to patches and to the stored row plus the patch", () => {
  assert.notDeepEqual(validatePatch("items", "step", { title: "x".repeat(121) }), []);
  assert.deepEqual(validatePatch("items", "step", { title: "x".repeat(120) }), []);
  assert.notDeepEqual(validatePatch("items", "block", { data: { where: "x".repeat(121) } }), []);
  assert.deepEqual(validatePatch("items", "block", { data: { where: null } }), []);
  const row = { id: id(2), kind: "step", parent_id: id(1), title: "item 1", currency: "IDR", sort: 0, rev: 1, data: null, ...stamps, updated_by: "a", deleted_at: null };
  assert.deepEqual(validateChange("items", row, { note: "ok" }), []);
  assert.notDeepEqual(validateChange("items", row, { note: "x".repeat(2001) }), []);
});

test("the other kinds keep their older limits", () => {
  accepts(task(1, { title: "x".repeat(500), group_key: "x".repeat(500), note: "x".repeat(5000) }));
  rejects(task(1, { title: "x".repeat(501) }), /title: must be a single-line string of up to 500/);
});

test("an action's parent must be a live routine, for every action kind", async () => {
  const env = createDb();
  assert.equal("errors" in (await apply(env.db, [routine(1), routine(10), task(3), mutation("create", "items", id(4), { id: id(4), kind: "book", title: "Laskar Pelangi", status: "shelf", ...stamps })])), false);
  for (const [n, kind] of ACTION_KINDS.entries()) {
    await rejected(apply(env.db, [action(20 + n, 99, kind)]), 409, /parent_id: must point at a live items row/);
    await rejected(apply(env.db, [action(20 + n, 3, kind)]), 409, /parent_id: must point at a routine row/);
    await rejected(apply(env.db, [action(20 + n, 4, kind)]), 409, /parent_id: must point at a routine row/);
    assert.equal("errors" in (await apply(env.db, [action(20 + n, 1, kind)])), false, kind);
  }
  assert.equal(count(env.sqlite, "items"), 4 + ACTION_KINDS.length);
  await apply(env.db, [mutation("delete", "items", id(10))]);
  await rejected(apply(env.db, [action(40, 10, "step")]), 409, /parent_id: must point at a live items row/);
  await rejected(apply(env.db, [action(41, 20, "step")]), 409, /parent_id: must point at a routine row/);
});

test("a copy still needs a book, and an action cannot hang under a copy, a book or another action", async () => {
  const env = createDb();
  const book = mutation("create", "items", id(4), { id: id(4), kind: "book", title: "Laskar Pelangi", status: "shelf", ...stamps });
  const copy = (n: number, parent: number) =>
    mutation("create", "items", id(n), { id: id(n), kind: "copy", parent_id: id(parent), title: "Laskar Pelangi", status: "here", ...stamps });
  assert.equal("errors" in (await apply(env.db, [routine(1), action(2, 1, "step"), book, copy(5, 4)])), false);
  await rejected(apply(env.db, [copy(6, 1)]), 409, /parent_id: must point at a book row/);
  await rejected(apply(env.db, [copy(6, 2)]), 409, /parent_id: must point at a book row/);
  await rejected(apply(env.db, [action(6, 2, "step")]), 409, /parent_id: must point at a routine row/);
  await rejected(apply(env.db, [action(6, 4, "step")]), 409, /parent_id: must point at a routine row/);
  await rejected(apply(env.db, [action(6, 5, "step")]), 409, /parent_id: must point at a routine row/);
});

test("an action can move between routines of the same visibility, not to a task or a missing row", async () => {
  const env = createDb();
  assert.equal("errors" in (await apply(env.db, [routine(1), routine(10), task(3), action(2, 1, "step")])), false);
  await rejected(apply(env.db, [mutation("update", "items", id(2), { parent_id: id(3) })]), 409, /parent_id: must point at a routine row/);
  await rejected(apply(env.db, [mutation("update", "items", id(2), { parent_id: id(99) })]), 409, /parent_id: must point at a live items row/);
  await rejected(apply(env.db, [mutation("update", "items", id(2), { parent_id: null })]), 400, /parent_id: required for kind step/);
  assert.equal("errors" in (await apply(env.db, [mutation("update", "items", id(2), { parent_id: id(10) })])), false);
  assert.equal(stored(env.sqlite, "items", id(2))?.parent_id, id(10));
});

test("ticks merge into data one key at a time and null removes a mark", async () => {
  const env = createDb();
  await apply(env.db, [routine(1, { who: "both" }), action(2, 1, "counter", { qty: 2, data: { unit: "portions" } })]);
  assert.equal("errors" in (await apply(env.db, [mutation("update", "items", id(2), { data: { done_a: "2026-10-24", value_a: 1 } })], "a")), false);
  assert.equal("errors" in (await apply(env.db, [mutation("update", "items", id(2), { data: { done_b: "2026-10-24", value_b: 2 } })], "b")), false);
  assert.deepEqual(JSON.parse(stored(env.sqlite, "items", id(2))?.data as string), { unit: "portions", done_a: "2026-10-24", value_a: 1, done_b: "2026-10-24", value_b: 2 });
  assert.equal("errors" in (await apply(env.db, [mutation("update", "items", id(2), { data: { done_a: null, value_a: null } })], "a")), false);
  assert.deepEqual(JSON.parse(stored(env.sqlite, "items", id(2))?.data as string), { unit: "portions", done_b: "2026-10-24", value_b: 2 });
});
