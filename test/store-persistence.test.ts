import { test } from "node:test";
import assert from "node:assert/strict";
import { tableNames } from "../shared/tables.ts";
import { memoryPersistence } from "../src/store/memory.ts";
import { assemble } from "../src/store/persistence.ts";
import type { Persisted } from "../src/store/persistence.ts";
import { item } from "./domain-rows.ts";

const settingRow = (key: string) => ({ key, value: "v", rev: 1, created_at: "x", updated_at: "x", updated_by: null, deleted_at: null });

test("assemble puts every result under its own table name, whatever the table order", () => {
  const reads = [...tableNames.map((name) => [{ marker: name }]), [{ seq: 1 }], 7, "b", "e", "g"];
  const loaded = assemble(reads);
  for (const name of tableNames) assert.deepEqual(loaded.rows[name], [{ marker: name }], name);
  assert.deepEqual(loaded.outbox, [{ seq: 1 }]);
  assert.deepEqual(loaded.meta, { rev: 7, me: "b", epoch: "e", generation: "g", adopted: null });
});

test("assemble defaults the cursor and the identity of an empty database", () => {
  const loaded = assemble([...tableNames.map(() => []), [], undefined, undefined, undefined, undefined]);
  assert.deepEqual(loaded.meta, { rev: 0, me: null, epoch: null, generation: null, adopted: null });
  assert.deepEqual(loaded.rows, { items: [], budget_entries: [], settings: [] });
});

test("the order of the tables is the order of the reads: a swap would put settings under items", () => {
  const reads = tableNames.map((name) => name);
  const loaded = assemble([...reads, [], 0, null, null, null]);
  assert.equal(loaded.rows.settings as unknown, "settings");
  assert.equal(loaded.rows.items as unknown, "items");
  assert.equal(loaded.rows.budget_entries as unknown, "budget_entries");
});

test("a memory database keeps each table's rows apart across a reload", async () => {
  const persistence = memoryPersistence();
  const task = item({ title: "task" });
  const vendor = item({ title: "vendor", kind: "vendor" });
  await persistence.write({
    rows: { items: [task, vendor], budget_entries: [], settings: [settingRow("partner_a_label")] },
    meta: { rev: 4, me: "a", epoch: "e" },
  });
  const loaded = await persistence.load();
  assert.deepEqual(loaded.rows.items.map((row) => row.title).sort(), ["task", "vendor"]);
  assert.deepEqual(loaded.rows.settings.map((row) => row.key), ["partner_a_label"]);
  assert.deepEqual(loaded.rows.budget_entries, []);
  assert.deepEqual(loaded.meta, { rev: 4, me: "a", epoch: "e", generation: null, adopted: null });
});

test("a memory reset changes the generation, and only a caller that saw the current generation can reset", async () => {
  const persistence = memoryPersistence();
  const next = { epoch: "e", rev: 0, me: null } as const;
  assert.equal(await persistence.reset("never seen", next), null);
  const first = await persistence.reset(null, next);
  assert.notEqual(first, null);
  assert.equal((await persistence.load()).meta.generation, first);
  assert.equal(await persistence.reset(null, next), null);
  const second = await persistence.reset(first, { ...next, rev: 3 });
  assert.notEqual(second, first);
  assert.deepEqual((await persistence.load()).meta, { rev: 3, me: null, epoch: "e", generation: second, adopted: null });
});

const adoptable = (): Persisted => ({
  rows: { items: [item({ id: "i1", kind: "task", title: "Old task", rev: 3 })] as never, budget_entries: [], settings: [settingRow("timezone")] as never },
  outbox: [{ seq: 1, id: "m1", table: "items", op: "create", row_id: "i2", patch: { title: "Unsent" }, at: "2026-10-06T00:00:00Z" }],
  meta: { rev: 7, me: "a", epoch: "e1", generation: "g1", adopted: null },
});

test("a memory partition adopts a snapshot while it is empty, as a copy", async () => {
  const persistence = memoryPersistence();
  const from = adoptable();
  await persistence.adopt(from);
  assert.deepEqual(await persistence.load(), from);
  (from.rows.items[0] as { title: string }).title = "changed after";
  assert.equal((await persistence.load()).rows.items[0].title, "Old task");
});

test("a memory partition that holds anything keeps it and adopts nothing", async () => {
  const marks: [string, (persistence: ReturnType<typeof memoryPersistence>) => Promise<unknown>][] = [
    ["an item", (p) => p.write({ rows: { items: [item({ id: "x", kind: "task", title: "Mine", rev: 1 })] as never } })],
    ["a setting", (p) => p.write({ rows: { settings: [settingRow("a")] as never } })],
    ["an unsent change", (p) => p.write({ outbox: { put: [{ seq: 9, id: "m9", table: "items", op: "delete", row_id: "x", patch: {}, at: "2026-10-06T00:00:00Z" }] } })],
    ["a revision", (p) => p.write({ meta: { rev: 1 } })],
    ["a side", (p) => p.write({ meta: { me: "b" } })],
    ["an epoch", (p) => p.write({ meta: { epoch: "e9" } })],
    ["a generation", (p) => p.reset(null, { epoch: "e9", rev: 0, me: "b" })],
  ];
  for (const [name, hold] of marks) {
    const persistence = memoryPersistence();
    await hold(persistence);
    const before = await persistence.load();
    await persistence.adopt(adoptable());
    assert.deepEqual(await persistence.load(), before, name);
  }
});
