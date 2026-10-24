import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTION_KINDS, hides, isRoutineKind, nextOccurrence, occursOn, paused, visible } from "../shared/routines.ts";
import type { Schedule } from "../shared/routines.ts";
import type { ItemRow } from "../shared/tables.ts";
import { hides as workerHides } from "../worker/private.ts";
import { item } from "./domain-rows.ts";

const routine = (schedule: Schedule & { private?: boolean } = {}, extra: Partial<ItemRow> = {}) =>
  item({ kind: "routine", status: null, who: "a", title: "Morning routine", data: { ...schedule }, ...extra });
const step = (parent: ItemRow | null, extra: Partial<ItemRow> = {}) => item({ kind: "step", status: null, parent_id: parent?.id ?? null, title: "item 1", ...extra });

test("the routine kinds are the container and the seven action kinds, matched exactly", () => {
  for (const kind of ["routine", ...ACTION_KINDS]) assert.equal(isRoutineKind(kind), true, kind);
  for (const kind of ["task", "book", "copy", "place", "vendor", "guest", "", "Routine", "step ", "constructor", "__proto__"]) assert.equal(isRoutineKind(kind), false, kind);
});

test("a routine is paused before its date and back on it", () => {
  assert.equal(paused(routine(), "2026-10-24"), false);
  assert.equal(paused(routine({ paused_until: "2026-10-25" }), "2026-10-24"), true);
  assert.equal(paused(routine({ paused_until: "2026-10-24" }), "2026-10-24"), false);
  assert.equal(paused(routine({ paused_until: "2026-10-23" }), "2026-10-24"), false);
  assert.equal(paused(item({ kind: "routine", data: { paused_until: 5 } }), "2026-10-24"), false);
  assert.equal(paused(item({ kind: "routine", data: null }), "2026-10-24"), false);
});

test("the next occurrence is the first day on or after the start that the routine runs", () => {
  assert.equal(nextOccurrence(routine(), "2026-10-24"), "2026-10-24");
  assert.equal(nextOccurrence(routine({ days: "MO,TH" }), "2026-10-24"), "2026-10-26");
  assert.equal(nextOccurrence(routine({ days: "MO,TH" }), "2026-10-26"), "2026-10-26");
  assert.equal(nextOccurrence(routine({ days: "MO,TH" }), "2026-10-27"), "2026-10-29");
  assert.equal(nextOccurrence(routine({ days: "MO" }), "2026-10-27"), "2026-11-02");
});

test("the next occurrence waits for the pause to end and for the start date", () => {
  assert.equal(nextOccurrence(routine({ days: "MO", paused_until: "2026-11-02" }), "2026-10-24"), "2026-11-02");
  assert.equal(nextOccurrence(routine({ days: "MO", paused_until: "2026-11-03" }), "2026-10-24"), "2026-11-09");
  assert.equal(nextOccurrence(routine({ days: "MO", paused_until: "2026-10-01" }), "2026-10-24"), "2026-10-26");
  assert.equal(nextOccurrence(routine({ from: "2030-01-07" }), "2026-10-24"), "2030-01-07");
  assert.equal(nextOccurrence(routine({ days: "MO", from: "2026-11-02" }), "2026-10-24"), "2026-11-02");
});

test("the next occurrence follows every N weeks from the start week", () => {
  const biweekly = routine({ days: "SU", every_weeks: "2", from: "2026-10-25" });
  assert.equal(nextOccurrence(biweekly, "2026-10-25"), "2026-10-25");
  assert.equal(nextOccurrence(biweekly, "2026-10-26"), "2026-11-08");
  assert.equal(nextOccurrence(routine({ days: "SU", every_weeks: "4", from: "2026-10-25" }), "2026-10-26"), "2026-11-22");
  assert.equal(nextOccurrence(biweekly, "2026-11-08"), "2026-11-08");
});

test("the next occurrence stops at the until date, which still counts", () => {
  assert.equal(nextOccurrence(routine({ days: "MO", until: "2026-10-25" }), "2026-10-24"), null);
  assert.equal(nextOccurrence(routine({ days: "MO", until: "2026-10-26" }), "2026-10-24"), "2026-10-26");
  assert.equal(nextOccurrence(routine({ until: "2026-10-23" }), "2026-10-24"), null);
  assert.equal(nextOccurrence(routine({ from: "2026-12-01", until: "2026-11-01" }), "2026-10-24"), null);
});

test("the next occurrence skips holidays only for routines that ask for it, and never runs forever", () => {
  assert.equal(nextOccurrence(routine({ holidays: true }), "2026-10-24", ["2026-10-24", "2026-10-25"]), "2026-10-26");
  assert.equal(nextOccurrence(routine({}), "2026-10-24", ["2026-10-24"]), "2026-10-24");
  const everyDay = Array.from({ length: 500 }, (_, index) => new Date(Date.UTC(2026, 9, 24 + index)).toISOString().slice(0, 10));
  assert.equal(nextOccurrence(routine({ holidays: true }), "2026-10-24", everyDay), null);
});

test("whatever the next occurrence says, the schedule function agrees and nothing earlier runs", () => {
  const rules: Schedule[] = [{}, { days: "TU,FR" }, { days: "SU", every_weeks: "3", from: "2026-10-04" }, { days: "WE", paused_until: "2026-11-15" }, { days: "MO,SA", from: "2026-12-07" }];
  for (const rule of rules) {
    const row = routine(rule);
    for (let offset = 0; offset < 60; offset++) {
      const from = new Date(Date.UTC(2026, 9, 1 + offset)).toISOString().slice(0, 10);
      const next = nextOccurrence(row, from);
      assert.ok(next !== null && next >= from && occursOn(row, next), JSON.stringify([rule, from, next]));
      for (let day = Date.parse(`${from}T00:00:00Z`); day < Date.parse(`${next}T00:00:00Z`); day += 86_400_000) {
        assert.equal(occursOn(row, new Date(day).toISOString().slice(0, 10)), false, JSON.stringify([rule, from, next, day]));
      }
    }
  }
});

test("the client filter drops a private routine of the other partner and its actions, and nothing else", () => {
  const secret = routine({ private: true }, { who: "a", title: "Hidden" });
  const inside = step(secret);
  const shared = routine({}, { who: "a", title: "Shared" });
  const sharedStep = step(shared);
  const mineB = routine({ private: true }, { who: "b" });
  const task = item({ kind: "task", data: { private: true } });
  const orphan = step(null, { parent_id: "00000000-0000-4000-8000-0000000000ff" });
  const rows = [secret, inside, shared, sharedStep, mineB, task, orphan];
  assert.deepEqual(visible(rows, "b").map((row) => row.id), [shared.id, sharedStep.id, mineB.id, task.id, orphan.id]);
  assert.deepEqual(visible(rows, "a").map((row) => row.id), [secret.id, inside.id, shared.id, sharedStep.id, task.id, orphan.id]);
  assert.deepEqual(visible(rows, null).map((row) => row.id), [shared.id, sharedStep.id, task.id, orphan.id]);
  assert.equal(rows.length, 7);
});

test("a flag that is false or missing hides nothing, and the flag counts only on a routine", () => {
  const open = routine({ private: false }, { who: "a" });
  assert.equal(visible([open, step(open)], "b").length, 2);
  assert.equal(visible([routine({}, { who: "a" })], "b").length, 1);
  assert.equal(visible([item({ kind: "step", who: "a", data: { private: true } })], "b").length, 1);
});

test("the client filter and the Worker filter are the same function", () => {
  assert.equal(hides, workerHides);
  const secret = routine({ private: true }, { who: "a" });
  assert.equal(hides(step(secret), secret, "b"), true);
  assert.equal(hides(step(secret), secret, "a"), false);
  assert.equal(hides(secret, undefined, "b"), true);
});

test("the search for the next day reaches exactly 400 days and no further", () => {
  const day = (offset: number) => new Date(Date.UTC(2026, 9, 24 + offset)).toISOString().slice(0, 10);
  const skipped = (count: number) => Array.from({ length: count }, (_, offset) => day(offset));
  assert.equal(nextOccurrence(routine({ holidays: true }), "2026-10-24", skipped(399)), day(399));
  assert.equal(nextOccurrence(routine({ holidays: true }), "2026-10-24", skipped(400)), null);
});
