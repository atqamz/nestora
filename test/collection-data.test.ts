import { test } from "node:test";
import assert from "node:assert/strict";
import { COLLECTION_MAX, ORDER_MAX, tables } from "../shared/tables.ts";
import { validateChange, validateCreate, validateMutation } from "../shared/validate.ts";
import { apply, createDb, id, mutation, stored } from "./sync-db.ts";
import { CLIENT_STAMP } from "./sync-db.ts";

type Obj = Record<string, unknown>;

const stamps = { created_at: CLIENT_STAMP, updated_at: CLIENT_STAMP };

const screen = (kind: string, data: Obj, extra: Obj = {}) => ({ id: id(1), kind, title: "Red Dragon", status: "want", ...stamps, data, ...extra });

const problems = (kind: string, data: Obj) => validateCreate("items", screen(kind, data)).join("\n");

for (const kind of ["movie", "series"]) {
  test(`a ${kind} takes a collection name and an order key, both optional`, () => {
    assert.deepEqual(validateCreate("items", screen(kind, {})), []);
    assert.deepEqual(validateCreate("items", screen(kind, { collection: "Hannibal", order: 0 })), []);
    assert.deepEqual(validateCreate("items", screen(kind, { collection: "Hannibal" })), []);
  });

  test(`a ${kind} collection name is text of at most ${COLLECTION_MAX} characters with something visible`, () => {
    assert.deepEqual(validateCreate("items", screen(kind, { collection: "x".repeat(COLLECTION_MAX) })), []);
    assert.match(problems(kind, { collection: "x".repeat(COLLECTION_MAX + 1) }), /data\.collection: must be at most 60 characters/);
    for (const collection of ["", "   ", "a\nb", "a\u0000b", 5, true, ["a"], null]) assert.match(problems(kind, { collection }), /data\.collection:/, JSON.stringify(collection));
  });

  test(`a ${kind} order key is a finite number from -${ORDER_MAX} to ${ORDER_MAX}, whole or fractional`, () => {
    for (const order of [0, 1, -1, 0.5, -0.000001, 1 / 3, ORDER_MAX, -ORDER_MAX]) assert.deepEqual(validateCreate("items", screen(kind, { order })), [], String(order));
    for (const order of [ORDER_MAX + 1, -ORDER_MAX - 1, Infinity, -Infinity, Number.NaN, "1", "", true, [1], null]) {
      assert.match(problems(kind, { order }), /data\.order:/, String(order));
    }
    assert.match(problems(kind, { order: ORDER_MAX + 1 }), /a finite number from -1000000000 to 1000000000/);
  });

  test(`a patch on a ${kind} may set, move and clear both keys, field by field`, () => {
    const row = { ...screen(kind, { collection: "Hannibal", order: 1, year: 2002 }), rev: 1, deleted_at: null, updated_by: "a" };
    assert.deepEqual(validateChange("items", row, { data: { order: 1.5 } }), []);
    assert.deepEqual(validateChange("items", row, { data: { collection: "Hannibal Lecter" } }), []);
    assert.deepEqual(validateChange("items", row, { data: { collection: null, order: null } }), []);
    assert.match(validateChange("items", row, { data: { order: 2e9 } }).join("\n"), /data\.order:/);
    assert.match(validateChange("items", row, { data: { collection: "x".repeat(61) } }).join("\n"), /data\.collection: must be at most 60/);
  });
}

test("the other kinds refuse both keys, so a collection never leaks onto books, tasks or routines", () => {
  const base = { id: id(1), title: "x", ...stamps };
  const cases: Obj[] = [
    { kind: "book", status: "shelf" },
    { kind: "task", status: "todo" },
    { kind: "vendor", status: "option" },
    { kind: "routine", who: "a" },
    { kind: "place" },
  ];
  for (const own of cases) {
    for (const key of ["collection", "order"]) {
      const text = key === "collection" ? "Hannibal" : 1;
      assert.match(validateCreate("items", { ...base, ...own, data: { [key]: text } }).join("\n"), new RegExp(`data\\.${key}: unknown key`), `${String(own.kind)} ${key}`);
    }
  }
});

test("the registry declares the two keys on the shared screen field set, with the bounds as exported constants", () => {
  assert.equal(tables.items.variants.movie.data.collection, "text");
  assert.equal(tables.items.variants.series.data.order, "order");
  assert.deepEqual([COLLECTION_MAX, ORDER_MAX], [60, 1_000_000_000]);
});

test("the Worker's own mutation check refuses an over-long name and an out-of-range key before any write", () => {
  const create = (data: Obj) => validateMutation({ id: id(5), table: "items", op: "create", row_id: id(1), patch: screen("movie", data) });
  assert.deepEqual(create({ collection: "Hannibal", order: 0.25 }), []);
  assert.match(create({ collection: "x".repeat(61) }).join("\n"), /data\.collection/);
  assert.match(create({ order: ORDER_MAX + 1 }).join("\n"), /data\.order/);
});

test("on the real sync path two partners move different members and one renames, and every patch survives the merge", async () => {
  const { db, sqlite } = createDb();
  const make = (n: number, title: string, order: number) => mutation("create", "items", id(n), { id: id(n), kind: "movie", title, status: "want", data: { collection: "Hannibal", order, year: 2000 + n }, ...stamps });
  const first = await apply(db, [make(1, "Hannibal Rising", 0), make(2, "Red Dragon", 1), make(3, "The Silence of the Lambs", 2), make(4, "Hannibal", 3)]);
  assert.equal("errors" in first, false);
  const move = (n: number, order: number) => mutation("update", "items", id(n), { data: { order } });
  const rename = (n: number) => mutation("update", "items", id(n), { data: { collection: "Hannibal Lecter" } });
  const moved = await apply(db, [move(3, 0.5)], "a");
  const renamed = await apply(db, [rename(1), rename(2), rename(3), rename(4), move(4, 1.5)], "b");
  assert.equal("errors" in moved, false);
  assert.equal("errors" in renamed, false);
  const rows = [1, 2, 3, 4].map((n) => stored(sqlite, "items", id(n))!);
  const data = rows.map((row) => JSON.parse(row.data as string) as Obj);
  assert.deepEqual(data.map((one) => one.collection), Array(4).fill("Hannibal Lecter"));
  assert.deepEqual(data.map((one) => one.order), [0, 1, 0.5, 1.5]);
  assert.deepEqual(data.map((one) => one.year), [2001, 2002, 2003, 2004]);
});

test("a move outside the range is rejected by the Worker and nothing in the batch lands", async () => {
  const { db, sqlite } = createDb();
  await apply(db, [mutation("create", "items", id(1), { id: id(1), kind: "movie", title: "a", status: "want", data: { collection: "X", order: 0 }, ...stamps })]);
  const result = await apply(db, [mutation("update", "items", id(1), { data: { order: 5 } }), mutation("update", "items", id(1), { data: { order: ORDER_MAX + 1 } })]);
  assert.equal("errors" in result, true);
  assert.equal(JSON.parse(stored(sqlite, "items", id(1))!.data as string).order, 0);
});
