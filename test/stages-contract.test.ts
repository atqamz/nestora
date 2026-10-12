import { test } from "node:test";
import assert from "node:assert/strict";
import { tables } from "../shared/tables.ts";
import { STAGES_MAX, STAGE_NAME_MAX, stageProblems, validateChange, validateCreate, validatePatch } from "../shared/validate.ts";
import { STAGES } from "../src/domain/stages.ts";
import { createServer } from "./store-server.ts";
import { client } from "./store-client.ts";
import { NOW, apply, createDb, mutation, setting, stored } from "./sync-db.ts";

const stage = (key: string, name: string, from: number, to: number) => ({ key, name, from, to });

const months = (count: number) => Array.from({ length: count }, (_, i) => stage(`s${i}`, `Stage ${i}`, i - count + 1, i - count + 1));

const json = (value: unknown) => JSON.stringify(value);

const valid: [string, string][] = [
  ["the default list", json(STAGES)],
  ["one stage", json([stage("day", "The day", 0, 0)])],
  ["a stage after the ceremony month", json([stage("day", "The day", 0, 0), stage("after", "After", 1, 12)])],
  ["gaps between stages", json([stage("a", "A", -36, -30), stage("b", "B", -3, 0)])],
  ["the full bounds", json([stage("a", "A", -36, 12)])],
  ["the cap of twelve stages", json(months(STAGES_MAX))],
  ["a name of the longest length", json([stage("a", "n".repeat(STAGE_NAME_MAX), -1, 0)])],
  ["an emoji and a joined emoji", json([stage("a", "Rings 💍", -2, -1), stage("b", "👩‍❤️‍👨", 0, 0)])],
  ["a right-to-left name", json([stage("a", "حفل الزفاف", -1, 0)])],
  ["a key at its longest", json([stage("a".repeat(32), "A", -1, 0)])],
  ["a key with digits and an underscore", json([stage("step_2", "A", -1, 0)])],
];

const invalid: [string, string][] = [
  ["text that is not JSON", "not json"],
  ["an object", json({ key: "a" })],
  ["an empty list", "[]"],
  ["one more than the cap", json(months(STAGES_MAX + 1))],
  ["a list of numbers", "[1,2]"],
  ["a null entry", json([null])],
  ["an extra field", json([{ ...stage("a", "A", -1, 0), colour: "red" }])],
  ["a missing field", json([{ key: "a", name: "A", from: -1 }])],
  ["a repeated key", json([stage("a", "A", -3, -2), stage("a", "B", -1, 0)])],
  ["a repeated name in another case", json([stage("a", "Details", -3, -2), stage("b", "details", -1, 0)])],
  ["a blank name", json([stage("a", "   ", -1, 0)])],
  ["an empty name", json([stage("a", "", -1, 0)])],
  ["a name with a leading space", json([stage("a", " A", -1, 0)])],
  ["a name with a trailing space", json([stage("a", "A ", -1, 0)])],
  ["a name one character too long", json([stage("a", "n".repeat(STAGE_NAME_MAX + 1), -1, 0)])],
  ["a name with a newline", json([stage("a", "A\nB", -1, 0)])],
  ["a name with a bidirectional override", json([stage("a", "A‮B", -1, 0)])],
  ["a name that is not a string", json([stage("a", 5 as unknown as string, -1, 0)])],
  ["an uppercase key", json([stage("Abc", "A", -1, 0)])],
  ["a key that starts with a digit", json([stage("1a", "A", -1, 0)])],
  ["a key that is too long", json([stage("a".repeat(33), "A", -1, 0)])],
  ["a start below the bound", json([stage("a", "A", -37, 0)])],
  ["an end above the bound", json([stage("a", "A", 0, 13)])],
  ["a fractional month", json([stage("a", "A", -1.5, 0)])],
  ["a month written as text", json([stage("a", "A", "-1" as unknown as number, 0)])],
  ["a start after the end", json([stage("a", "A", 0, -1)])],
  ["a range that overlaps the one before", json([stage("a", "A", -3, -1), stage("b", "B", -1, 0)])],
  ["a range that starts where the one before starts", json([stage("a", "A", -3, -2), stage("b", "B", -3, 0)])],
  ["stages out of order", json([stage("a", "A", -1, 0), stage("b", "B", -3, -2)])],
];

const set = (value: string) => ({ key: "stages", value, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" });

const verdicts = async (value: string) => {
  const created = validateCreate("settings", set(value)).length === 0;
  const patched = validatePatch("settings", "stages", { value }).length === 0;
  const changed = validateChange("settings", { ...set(json([stage("x", "X", -1, 0)])), rev: 1, updated_by: null, deleted_at: null }, { value }).length === 0;

  const { db, sqlite } = createDb();
  const worker = !("errors" in (await apply(db, [setting("stages", value)])));
  const workerFirst = worker && stored(sqlite, "settings", "stages")?.value === value;
  const seeded = createDb();
  await apply(seeded.db, [setting("stages", json([stage("x", "X", -1, 0)]))]);
  const replaced = !("errors" in (await apply(seeded.db, [mutation("update", "settings", "stages", { value })])));

  const server = createServer();
  const phone = client(server, "a");
  await phone.store.open();
  const store = (await phone.store.setSetting("stages", value)).ok;
  const again = (await phone.store.setSetting("stages", json([stage("y", "Y", -2, 0)]))).ok;
  const second = (await phone.store.setSetting("stages", value)).ok;
  return { created, patched, changed, worker, workerFirst, replaced, store, again, second };
};

for (const [name, value] of valid) {
  test(`stages: ${name} is accepted by the contract, the Worker and the store`, async () => {
    assert.deepEqual(stageProblems(JSON.parse(value)), []);
    const seen = await verdicts(value);
    assert.deepEqual(seen, { created: true, patched: true, changed: true, worker: true, workerFirst: true, replaced: true, store: true, again: true, second: true });
  });
}

for (const [name, value] of invalid) {
  test(`stages: ${name} is refused by the contract, the Worker and the store`, async () => {
    const seen = await verdicts(value);
    assert.deepEqual(seen, { created: false, patched: false, changed: false, worker: false, workerFirst: false, replaced: false, store: false, again: true, second: false });
  });
}

test("stages: the problems name the stage and the field that is wrong", () => {
  assert.deepEqual(stageProblems([stage("a", "A", -3, -1), stage("b", "B", -1, 0)]), [{ index: 1, field: "from", code: "overlap" }]);
  assert.deepEqual(stageProblems([stage("a", "A", 0, -1)]), [{ index: 0, field: "to", code: "range" }]);
  assert.deepEqual(stageProblems([stage("a", "A", -40, 0)]), [{ index: 0, field: "from", code: "bounds" }]);
  assert.deepEqual(stageProblems([stage("a", "A", -2, -1), stage("b", "a", 0, 0)]), [{ index: 1, field: "name", code: "name_twice" }]);
  assert.deepEqual(stageProblems([stage("a", "A", -2, -1), stage("a", "B", 0, 0)]), [{ index: 1, field: "key", code: "key_twice" }]);
  assert.deepEqual(stageProblems([]), [{ index: null, field: "name", code: "count" }]);
});

test("stages: the longest legal list stays under the 2000 characters of a settings value", () => {
  const worst = Array.from({ length: STAGES_MAX }, (_, i) => stage(`${"k".repeat(30)}${String(i).padStart(2, "0")}`, `${"\\\"".repeat(STAGE_NAME_MAX / 2)}`.slice(0, STAGE_NAME_MAX - 2) + String(i).padStart(2, "0"), -36 + i * 3, -34 + i * 3));
  const value = json(worst);
  assert.deepEqual(stageProblems(worst), []);
  assert.ok(value.length <= 2000, `${value.length}`);
  assert.deepEqual(validateCreate("settings", set(value)), []);
});

test("stages: a value over the settings limit is refused before the stage check", () => {
  assert.ok(validateCreate("settings", set(json(months(STAGES_MAX)) + " ".repeat(2000))).some((error) => /value/.test(error)));
});

test("stages: the key is declared next to the other known settings keys and the others are untouched", () => {
  assert.deepEqual(Object.keys(tables.settings.values), [
    "ceremony_date",
    "timezone",
    "partner_a_label",
    "partner_b_label",
    "partner_a_photo",
    "partner_b_photo",
    "hijri_calendar",
    "hijri_offset_days",
    "holidays",
    "portion_multiplier",
    "stages",
  ]);
  assert.equal(tables.settings.values.stages, "stages");
  assert.deepEqual(tables.settings.values.hijri_offset_days, ["-2", "-1", "0", "1", "2"]);
});

test("stages: the Worker keeps the value as written and answers with the stored row", async () => {
  const { db, sqlite } = createDb();
  const value = json(STAGES);
  const result = await apply(db, [setting("stages", value)], "a", NOW);
  assert.equal("errors" in result, false);
  assert.equal(stored(sqlite, "settings", "stages")?.value, value);
});
