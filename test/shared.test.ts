import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tables, tableNames } from "../shared/tables.ts";
import type { Patch, Row, TableName } from "../shared/tables.ts";
import { MAX_BODY_BYTES, MAX_MUTATIONS, applyPatch, rowKey, toInstant } from "../shared/api.ts";
import { validateChange, validateCreate, validateMutation, validatePatch, validateRow } from "../shared/validate.ts";

const migration = readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8");

const migrated = () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(migration);
  return db;
};

type Obj = Record<string, unknown>;

const instant = "2026-10-06T05:00:00Z";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const plannedId = uuid(10);
const stamps = { created_at: instant, updated_at: instant };
const phone = "+628123456789";

const task = {
  id: uuid(2),
  kind: "task",
  title: "Book a hall",
  status: "todo",
  due_on: "2026-12-31",
  done_on: "2026-10-06",
  who: "both",
  group_key: "kua",
  amount: 150000,
  currency: "IDR",
  qty: 2,
  note: "bring ID",
  sort: 1.5,
  data: { start_on: "2026-10-01", decision: true, rules: "after the venue" },
  ...stamps,
};
const vendor = {
  id: uuid(3),
  kind: "vendor",
  title: "Caterer",
  status: "option",
  group_key: "food",
  amount: 0,
  data: { phone, pic: "Sam", contract_url: "https://example.test/contract", facts: "net 30" },
  ...stamps,
};
const guest = {
  id: uuid(4),
  kind: "guest",
  title: "Guest",
  status: "todo",
  who: "a",
  group_key: "friends",
  qty: 3,
  data: { phone, channel: "both", rsvp_qty: 0, import_batch: "batch-1" },
  ...stamps,
};
const planned = {
  id: plannedId,
  entry_type: "planned",
  title: "Hall",
  group_key: "reception",
  amount: 5000000,
  ...stamps,
};
const payment = {
  id: uuid(11),
  entry_type: "payment",
  title: "Down payment",
  budget_id: plannedId,
  status: "due",
  amount: 1000000,
  due_on: "2026-11-01",
  who: "b",
  data: { proof_url: "https://example.test/proof" },
  ...stamps,
};
const setting = { key: "ceremony_date", value: "2027-06-01", ...stamps };

const items = { task, vendor, guest };

const sqlRow = (row: Obj) =>
  Object.fromEntries(
    Object.entries({
      rev: 1,
      ...row,
      ...(typeof row.data === "object" && row.data !== null ? { data: JSON.stringify(row.data) } : {}),
    }).filter(([, value]) => value !== undefined),
  );

const insert = (db: DatabaseSync, table: string, row: Obj) => {
  const stored = sqlRow(row);
  const cols = Object.keys(stored);
  db.prepare(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(
    ...(Object.values(stored) as (string | number | null)[]),
  );
};

const seeded = () => {
  const db = migrated();
  insert(db, "budget_entries", planned);
  return db;
};

const rejects = (table: string, row: Obj, pattern: RegExp) => {
  const errors = validateCreate(table, row);
  assert.ok(
    errors.some((e) => pattern.test(e)),
    `expected ${pattern} in ${JSON.stringify(errors)}`,
  );
};

const patchRejects = (table: string, variant: unknown, patch: Obj, pattern: RegExp) => {
  const errors = validatePatch(table, variant, patch);
  assert.ok(
    errors.some((e) => pattern.test(e)),
    `expected ${pattern} in ${JSON.stringify(errors)}`,
  );
};

test("registry columns match the migration", () => {
  const db = migrated();
  for (const name of tableNames) {
    const info = db.prepare(`PRAGMA table_info(${name})`).all() as {
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }[];
    const actual = info.map((c) => ({
      name: c.name,
      sql: c.type,
      notNull: c.notnull === 1 || c.pk === 1,
      default: c.dflt_value === null ? undefined : c.dflt_value.replace(/^'(.*)'$/, "$1"),
    }));
    const spec = Object.entries(tables[name].columns).map(([column, c]) => ({
      name: column,
      sql: c.sql,
      notNull: c.notNull,
      default: "default" in c ? String(c.default) : undefined,
    }));
    assert.deepEqual(spec, actual, name);
    assert.deepEqual(
      info.filter((c) => c.pk === 1).map((c) => c.name),
      [tables[name].key],
      `${name} key`,
    );
  }
});

test("registry is internally consistent", () => {
  for (const name of tableNames) {
    const table: import("../shared/tables.ts").Table = tables[name];
    const columns = Object.keys(table.columns);
    assert.ok(table.common.every((c) => columns.includes(c)), `${name} common`);
    assert.ok(columns.includes(table.key));
    if (table.by) assert.ok(table.common.includes(table.by));
    for (const [variantName, v] of Object.entries(table.variants ?? {})) {
      const label = `${name}.${variantName}`;
      assert.ok(v.columns.every((c) => columns.includes(c) && !table.common.includes(c)), `${label} columns`);
      assert.ok(v.required.every((c) => v.columns.includes(c)), `${label} required`);
      if (v.status) assert.ok(v.columns.includes("status"), `${label} status`);
      if (v.who) assert.ok(v.columns.includes("who"), `${label} who`);
      if (v.doneOnStatus) assert.ok(v.status?.includes(v.doneOnStatus), `${label} doneOnStatus`);
    }
  }
  assert.deepEqual(Object.keys(tables.items.variants), ["task", "vendor", "guest", "book", "copy", "place"]);
  assert.deepEqual(Object.keys(tables.budget_entries.variants), ["planned", "payment"]);
});

test("derived row types accept a full row", () => {
  const row: Row<"settings"> = { key: "k", value: "v", rev: 1, ...stamps, updated_by: null, deleted_at: null };
  const table: TableName = "settings";
  assert.equal(rowKey(table, row), "k");
});

test("patch types omit identity, discriminator, created_at and server columns", () => {
  const ok: Patch<"items"> = { status: "done", data: { phone: null }, updated_at: instant };
  const okEntry: Patch<"budget_entries"> = { amount: null };
  const okSetting: Patch<"settings"> = { value: "v" };
  // @ts-expect-error
  const kind: Patch<"items"> = { kind: "task" };
  // @ts-expect-error
  const entryType: Patch<"budget_entries"> = { entry_type: "planned" };
  // @ts-expect-error
  const id: Patch<"items"> = { id: "x" };
  // @ts-expect-error
  const key: Patch<"settings"> = { key: "x" };
  // @ts-expect-error
  const created: Patch<"items"> = { created_at: instant };
  // @ts-expect-error
  const rev: Patch<"items"> = { rev: 1 };
  // @ts-expect-error
  const updatedBy: Patch<"items"> = { updated_by: "a" };
  assert.ok([ok, okEntry, okSetting, kind, entryType, id, key, created, rev, updatedBy].every((p) => typeof p === "object"));
});

test("accepts a valid row of every kind and entry type", () => {
  for (const [kind, row] of Object.entries(items)) assert.deepEqual(validateCreate("items", row), [], kind);
  assert.deepEqual(validateCreate("budget_entries", planned), []);
  assert.deepEqual(validateCreate("budget_entries", payment), []);
  assert.deepEqual(validateCreate("settings", setting), []);
});

test("minimal rows are accepted", () => {
  assert.deepEqual(validateCreate("items", { id: uuid(20), kind: "task", title: "t", status: "done", ...stamps }), []);
});

test("a planned row needs no amount, a payment does", () => {
  const { amount: _planned, ...noAmount } = planned;
  assert.deepEqual(validateCreate("budget_entries", noAmount), []);
  assert.deepEqual(validateCreate("budget_entries", { ...planned, amount: null }), []);
  assert.deepEqual(validateCreate("budget_entries", { ...planned, amount: 0 }), []);
  const { amount: _payment, ...paymentNoAmount } = payment;
  rejects("budget_entries", paymentNoAmount, /amount: required/);
  rejects("budget_entries", { ...payment, amount: null }, /amount: required/);
});

test("rejects unknown tables, kinds, entry types and columns", () => {
  assert.match(validateCreate("users", task)[0], /unknown table/);
  assert.match(validatePatch("users", "task", {})[0], /unknown table/);
  assert.match(validateCreate("sync_state", { id: 1, rev: 0 })[0], /unknown table/);
  assert.match(validateCreate("constructor", task)[0], /unknown table/);
  assert.match(validateCreate("toString", task)[0], /unknown table/);
  rejects("items", { ...task, kind: "rundown" }, /kind: unknown kind/);
  rejects("items", { ...task, kind: "constructor" }, /kind: unknown kind/);
  rejects("items", { ...task, kind: 5 }, /kind: must be/);
  rejects("budget_entries", { ...payment, entry_type: "refund" }, /entry_type: unknown entry_type/);
  rejects("items", { ...task, colour: "red" }, /colour: unknown column/);
  rejects("items", { ...task, kind: "project" }, /kind: unknown kind/);
  rejects("items", { ...task, project_id: uuid(1) }, /project_id: unknown column/);
  rejects("budget_entries", { ...planned, project_id: uuid(1) }, /project_id: unknown column/);
  rejects("budget_entries", { ...payment, project_id: uuid(1) }, /project_id: unknown column/);
  rejects("items", JSON.parse('{"__proto__": 1}'), /__proto__: unknown column/);
  rejects("settings", { ...setting, id: uuid(1) }, /id: unknown column/);
});

test("requires the columns the table and the kind need", () => {
  for (const column of ["id", "kind", "title", "created_at", "updated_at"]) {
    const { [column]: _removed, ...row } = task as Obj;
    rejects("items", row, new RegExp(`${column}: required`));
  }
  for (const [kind, row] of [
    ["task", task],
    ["vendor", vendor],
    ["guest", guest],
  ] as const) {
    for (const column of ["status"]) {
      const { [column]: _removed, ...rest } = row as Obj;
      rejects("items", rest, new RegExp(`${column}: required for kind ${kind}`));
      rejects("items", { ...row, [column]: null }, new RegExp(`${column}: required for kind ${kind}`));
    }
  }
  const { group_key: _group, ...planned2 } = planned;
  rejects("budget_entries", planned2, /group_key: required for entry_type planned/);
  for (const column of ["budget_id", "status"]) {
    const { [column]: _removed, ...rest } = payment as Obj;
    rejects("budget_entries", rest, new RegExp(`${column}: required for entry_type payment`));
  }
  for (const title of ["", "   ", null, 5]) rejects("items", { ...task, title }, /title/);
  for (const column of ["key", "value"]) {
    const { [column]: _removed, ...rest } = setting as Obj;
    rejects("settings", rest, new RegExp(`${column}: required`));
  }
});

test("ids are lowercase UUIDs", () => {
  for (const id of ["abc", "", "0190A1B2-C3D4-7E5F-8A6B-7C8D9E0F1A2B", "00000000-0000-0000-8000-000000000001", 5, null])
    rejects("items", { ...task, id }, /id:/);
  rejects("budget_entries", { ...payment, budget_id: "abc" }, /budget_id: must be a lowercase UUID/);
  assert.deepEqual(validateCreate("items", { ...task, id: "0190a1b2-c3d4-7e5f-8a6b-7c8d9e0f1a2b" }), []);
});

test("instants are RFC 3339 UTC with Z", () => {
  for (const ok of ["2026-10-06T05:00:00Z", "2024-02-29T23:59:59Z", "2026-12-31T23:59:59Z"])
    assert.deepEqual(validateCreate("items", { ...task, created_at: ok }), [], ok);
  for (const bad of [
    "2026-10-06",
    "2026-10-06T05:00:00",
    "2026-10-06T05:00:00+07:00",
    "2026-10-06T05:00:00z",
    "2026-10-06 05:00:00Z",
    "2026-02-30T05:00:00Z",
    "2026-10-06T24:00:00Z",
    "2026-10-06T05:60:00Z",
    "2026-10-06T05:00:60Z",
    "2026-10-06T05:00Z",
    "2026-10-06T05:00:00.5Z",
    "2026-10-06T05:00:00.000Z",
    "2026-10-06T05:00:00.123456789Z",
    5,
    null,
  ])
    rejects("items", { ...task, created_at: bad }, /created_at/);
  assert.ok(validateRow("items", stored({ ...task, deleted_at: "2026-10-06" })).some((e) => /deleted_at: must be an RFC 3339/.test(e)));
  assert.deepEqual(validateCreate("items", { ...task, deleted_at: null }), []);
});

test("dates are YYYY-MM-DD", () => {
  for (const bad of ["06-10-2026", "2026/10/06", "2026-13-01", "2026-02-30", "2026-10-06T00:00:00Z", 20261006])
    rejects("items", { ...task, due_on: bad }, /due_on: must be a date/);
  rejects("items", { ...task, done_on: "2026-2-3" }, /done_on/);
  assert.deepEqual(validateCreate("items", { ...task, due_on: "2028-02-29", done_on: null }), []);
});

test("money is a whole non-negative integer with a currency code", () => {
  for (const bad of [-1, 1.5, "100", NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, true])
    rejects("items", { ...task, amount: bad }, /amount: must be a non-negative integer/);
  rejects("items", { ...task, qty: -1 }, /qty/);
  rejects("items", { ...task, qty: 1.5 }, /qty/);
  rejects("budget_entries", { ...payment, amount: -5 }, /amount/);
  rejects("budget_entries", { ...planned, amount: 2.5 }, /amount/);
  for (const ok of [0, 1, Number.MAX_SAFE_INTEGER]) assert.deepEqual(validateCreate("items", { ...task, amount: ok }), []);
  for (const bad of ["RP", "idr", "IDRR", "", 3, null]) rejects("items", { ...task, currency: bad }, /currency/);
  const { currency: _currency, ...noCurrency } = task;
  assert.deepEqual(validateCreate("items", noCurrency), []);
  assert.deepEqual(validateCreate("items", { ...task, currency: "USD" }), []);
  rejects("budget_entries", { ...planned, currency: "rp" }, /currency/);
});

test("phone numbers in data are E.164", () => {
  for (const ok of ["+628123456789", "+14155550100", "+442071838750", "+1234567", "+123456789012345"])
    assert.deepEqual(validateCreate("items", { ...vendor, data: { phone: ok } }), [], ok);
  for (const bad of [
    "+62",
    "+12",
    "+123456",
    "+1234567890123456",
    "08123456789",
    "628123456789",
    "+0123456789",
    "+62 812 3456 789",
    "+62-812-3456",
    "+",
    "",
    628123456789,
  ])
    rejects("items", { ...vendor, data: { phone: bad } }, /data.phone/);
  rejects("items", { ...guest, data: { phone: "0812" } }, /data.phone/);
});

test("who is a, b or both, and a guest side is a or b", () => {
  for (const who of ["a", "b", "both"]) assert.deepEqual(validateCreate("items", { ...task, who }), [], who);
  for (const who of ["c", "A", "", 1]) rejects("items", { ...task, who }, /who: must be one of a, b, both/);
  assert.deepEqual(validateCreate("items", { ...guest, who: "b" }), []);
  rejects("items", { ...guest, who: "both" }, /who: must be one of a, b for kind guest/);
  rejects("budget_entries", { ...payment, who: "c" }, /who/);
});

test("status is checked per kind and per entry type", () => {
  const good = {
    task: ["todo", "done"],
    vendor: ["option", "confirmed", "cancelled"],
    guest: ["todo", "sent", "confirmed", "declined"],
  } as const;
  for (const [kind, statuses] of Object.entries(good)) {
    assert.deepEqual(tables.items.variants[kind as keyof typeof good].status, statuses, `${kind} status set`);
    for (const status of statuses)
      assert.deepEqual(validateCreate("items", { ...items[kind as keyof typeof items], status }), [], `${kind} ${status}`);
    const foreign = Object.values(good).flat().find((s) => !(statuses as readonly string[]).includes(s))!;
    rejects("items", { ...items[kind as keyof typeof items], status: foreign }, /status: must be one of/);
    rejects("items", { ...items[kind as keyof typeof items], status: "bogus" }, /status: must be one of/);
  }
  assert.deepEqual(validateCreate("budget_entries", { ...payment, status: "paid", done_on: "2026-11-02" }), []);
  rejects("budget_entries", { ...payment, status: "late" }, /status/);
});

test("columns a kind does not use must be empty", () => {
  rejects("items", { ...vendor, qty: 1 }, /qty: not used by kind vendor/);
  rejects("items", { ...vendor, who: "a" }, /who: not used by kind vendor/);
  rejects("items", { ...guest, amount: 1 }, /amount: not used by kind guest/);
  rejects("items", { ...task, parent_id: uuid(2) }, /parent_id: not used by kind task/);
  rejects("budget_entries", { ...planned, status: "due" }, /status: not used by entry_type planned/);
  rejects("budget_entries", { ...planned, due_on: "2026-11-01" }, /due_on: not used/);
  rejects("budget_entries", { ...planned, done_on: "2026-11-01" }, /done_on: not used/);
  rejects("budget_entries", { ...planned, budget_id: plannedId }, /budget_id: not used/);
  rejects("budget_entries", { ...payment, vendor_id: uuid(3) }, /vendor_id: not used by entry_type payment/);
  assert.deepEqual(validateCreate("items", { ...vendor, qty: null }), []);
  assert.deepEqual(validateCreate("budget_entries", { ...planned, vendor_id: uuid(3) }), []);
});

test("a payment date needs a paid payment", () => {
  rejects("budget_entries", { ...payment, status: "due", done_on: "2026-11-02" }, /done_on: only allowed when status is paid/);
  assert.deepEqual(validateCreate("budget_entries", { ...payment, status: "paid", done_on: "2026-11-02" }), []);
  assert.deepEqual(validateCreate("budget_entries", { ...payment, status: "paid" }), []);
});

test("data key sets are exact", () => {
  const keys = (v: { data: object }) => Object.keys(v.data).sort();
  assert.deepEqual(keys(tables.items.variants.task), ["decision", "rules", "start_on"]);
  assert.deepEqual(keys(tables.items.variants.vendor), ["contract_url", "facts", "phone", "pic"]);
  assert.deepEqual(keys(tables.items.variants.guest), ["channel", "import_batch", "phone", "rsvp_qty"]);
  assert.deepEqual(keys(tables.budget_entries.variants.planned), []);
  assert.deepEqual(keys(tables.budget_entries.variants.payment), ["proof_url"]);
});

test("data holds only the keys the kind allows", () => {
  assert.deepEqual(validateCreate("items", { ...task, data: null }), []);
  rejects("items", { ...task, data: { phone } }, /data.phone: unknown key/);
  rejects("items", { ...vendor, data: { channel: "print" } }, /data.channel: unknown key/);
  rejects("items", { ...guest, data: { pic: "x" } }, /data.pic: unknown key/);
  rejects("budget_entries", { ...planned, data: { proof_url: "https://example.test" } }, /data.proof_url: unknown key/);
  rejects("items", { ...task, data: { start_on: "2026-13-01" } }, /data.start_on/);
  rejects("items", { ...task, data: { decision: "yes" } }, /data.decision: must be true or false/);
  rejects("items", { ...guest, data: { channel: "sms" } }, /data.channel: must be one of digital, print, both/);
  rejects("items", { ...guest, data: { rsvp_qty: -1 } }, /data.rsvp_qty/);
  rejects("items", { ...vendor, data: { pic: null } }, /data.pic: must not be null/);
  for (const bad of ["javascript:alert(1)", "ftp://example.test/x", "not a url", "data:text/html,x", ""])
    rejects("items", { ...vendor, data: { contract_url: bad } }, /data.contract_url: must be an http or https URL/);
  rejects("budget_entries", { ...payment, data: { proof_url: "javascript:alert(1)" } }, /data.proof_url/);
  for (const bad of [[], "{}", 5, true]) rejects("items", { ...task, data: bad }, /data: must be an object/);
});

test("the client never sets rev or updated_by", () => {
  rejects("items", { ...task, updated_by: "a" }, /updated_by: set by the server/);
  rejects("items", { ...task, updated_by: "someone@example.test" }, /updated_by/);
  rejects("items", { ...task, rev: 1 }, /rev: set by the server/);
  rejects("budget_entries", { ...payment, updated_by: "import" }, /updated_by: set by the server/);
  rejects("settings", { ...setting, updated_by: "b" }, /updated_by: set by the server/);
  rejects("settings", { ...setting, rev: 3 }, /rev: set by the server/);
});

test("settings are keyed by a lowercase key", () => {
  for (const key of ["Ceremony", "has space", "", "1abc", 5, "a".repeat(65)]) rejects("settings", { ...setting, key }, /key/);
  rejects("settings", { ...setting, value: "" }, /value/);
  rejects("settings", { ...setting, value: 5 }, /value/);
  assert.deepEqual(validateCreate("settings", { ...setting, deleted_at: null }), []);
});

test("sort is a finite number", () => {
  assert.deepEqual(validateCreate("items", { ...task, sort: -2.25 }), []);
  for (const bad of ["1", NaN, Infinity, null]) rejects("items", { ...task, sort: bad }, /sort/);
});


const maxed = (n: number, c = "a") => c.repeat(n);

test("text rejects control, format and surrogate characters", () => {
  for (const bad of ["\0", "\x07", "a\0b", "​", "‌", "⁠", "‮", "﻿", "\ud800", "a\ud800b", "a\nb", "a\tb", "a\rb", "\x7f", "\x85"])
    for (const column of ["title", "group_key"])
      rejects("items", { ...task, [column]: `x${bad}` }, new RegExp(`${column}: must be a single-line string`));
  rejects("items", { ...task, title: "ok‮" }, /title/);
  rejects("budget_entries", { ...planned, title: "a\0b" }, /title/);
  rejects("settings", { ...setting, value: "a\nb" }, /value/);
  rejects("items", { ...vendor, data: { pic: "a\0b" } }, /data.pic/);
  rejects("items", { ...vendor, data: { facts: "a\nb" } }, /data.facts/);
  assert.deepEqual(validateCreate("items", { ...task, title: "Café 結婚 🎉" }), []);
});

test("text accepts the zero width joiner used by emoji sequences", () => {
  const emoji = {
    family: "\u{1F468}‍\u{1F469}‍\u{1F467}",
    couple: "\u{1F469}‍❤️‍\u{1F468}",
    rainbowFlag: "\u{1F3F3}️‍\u{1F308}",
    keycap: "1️⃣",
    skinTone: "\u{1F44D}\u{1F3FD}",
  };
  for (const [name, value] of Object.entries(emoji)) {
    assert.deepEqual(validateCreate("items", { ...task, title: value, note: `a ${value}\nb` }), [], name);
    assert.deepEqual(validateCreate("items", { ...task, title: `Trip ${value}`, group_key: value }), [], name);
    assert.deepEqual(validatePatch("items", "task", { title: value, note: value }), [], name);
  }
  for (const bad of ["‍‍", "‍", " ‍ ", "‍​"]) {
    rejects("items", { ...task, title: bad }, /title/);
    rejects("items", { ...task, note: bad }, /note/);
  }
  for (const bad of ["​", "‌", "⁠", "﻿", "‮", "⁦"]) {
    rejects("items", { ...task, title: `\u{1F468}‍\u{1F469}${bad}` }, /title/);
    rejects("items", { ...task, note: `\u{1F468}‍\u{1F469}${bad}` }, /note/);
  }
});

test("only a note may span lines", () => {
  assert.deepEqual(validateCreate("items", { ...task, note: "line one\nline two\n\tindented" }), []);
  for (const bad of ["a\rb", "a\0b", "a​b", "a\ud800b", "a\x1bb"])
    rejects("items", { ...task, note: bad }, /note: must be a string/);
});

test("text needs a visible character", () => {
  for (const blank of ["", " ", " ", "　", "⠀", "ㅤ", "ᅟ", "​", " ", "   "]) {
    rejects("items", { ...task, title: blank }, /title/);
    rejects("items", { ...task, note: blank }, /note/);
  }
  assert.deepEqual(validateCreate("items", { ...task, title: " a " }), []);
  assert.deepEqual(validateCreate("items", { ...task, title: "." }), []);
});

test("text length caps hold at the boundary", () => {
  const cases: [string, (v: string) => [string, Obj], number][] = [
    ["items", (v) => ["items", { ...task, title: v }], 500],
    ["items", (v) => ["items", { ...task, group_key: v }], 500],
    ["items", (v) => ["items", { ...task, note: v }], 10000],
    ["budget_entries", (v) => ["budget_entries", { ...planned, title: v }], 500],
    ["budget_entries", (v) => ["budget_entries", { ...planned, group_key: v }], 500],
    ["settings", (v) => ["settings", { ...setting, key: "label_free", value: v }], 2000],
    ["items", (v) => ["items", { ...vendor, data: { pic: v } }], 500],
    ["items", (v) => ["items", { ...vendor, data: { facts: v } }], 2000],
    ["items", (v) => ["items", { ...task, data: { rules: v } }], 2000],
    ["items", (v) => ["items", { ...guest, data: { import_batch: v } }], 500],
  ];
  for (const [label, build, max] of cases) {
    const [okTable, ok] = build(maxed(max));
    assert.deepEqual(validateCreate(okTable, ok), [], `${label} ${max}`);
    const [badTable, bad] = build(maxed(max + 1));
    assert.ok(validateCreate(badTable, bad).length > 0, `${label} ${max + 1}`);
  }
});

test("serialized data is capped at 20000 characters", () => {
  const size = (n: number) => ({ extra: maxed(n - JSON.stringify({ extra: "" }).length) });
  assert.equal(JSON.stringify(size(20000)).length, 20000);
  const tooLarge = /data: must serialize to at most 20000 characters/;
  assert.ok(!validateCreate("items", { ...vendor, data: size(20000) }).some((e) => tooLarge.test(e)));
  rejects("items", { ...vendor, data: size(20001) }, tooLarge);
  rejects("items", { ...vendor, data: { pic: 1n } }, /data/);
});

test("urls are canonical http or https with a host", () => {
  const url = (v: unknown) => ({ ...vendor, data: { contract_url: v } });
  for (const ok of ["https://example.test", "http://example.test/a?b=c#d", "HTTPS://EXAMPLE.TEST/x", "https://example.test:8443/p", "https://a.example.test/ü"])
    assert.deepEqual(validateCreate("items", url(ok)), [], ok);
  for (const bad of [
    " https://example.test",
    "https://example.test ",
    "https://exa\nmple.test",
    "https://exa\tmple.test",
    "https://example.test/\0",
    "https://example.test/ ",
    "https://example.test/a b",
    "https://example.test/​",
    "https://example.test/‮",
    "https://example.test/ ",
    "https:example.test",
    "https:/example.test",
    "https:///example.test",
    "https://",
    "https://?x",
    "https://#x",
    "//example.test",
    "example.test",
    "javascript:alert(1)",
    "data:text/html,x",
    "file:///etc/passwd",
    "blob:https://example.test/x",
    "mailto:a@example.test",
    "ftp://example.test",
    "",
    5,
  ])
    rejects("items", url(bad), /data.contract_url: must be an http or https URL/);
  const base = "https://example.test/";
  assert.deepEqual(validateCreate("items", url(base + maxed(2048 - base.length))), []);
  rejects("items", url(base + maxed(2049 - base.length)), /data.contract_url/);
  rejects("budget_entries", { ...payment, data: { proof_url: base + maxed(2049 - base.length) } }, /data.proof_url/);
  rejects("budget_entries", { ...payment, data: { proof_url: "https://example.test/a\nb" } }, /data.proof_url/);
});

test("instants have one canonical form, and toInstant produces it", () => {
  assert.equal(toInstant(new Date(Date.UTC(2026, 9, 6, 5, 0, 0, 0))), "2026-10-06T05:00:00Z");
  assert.equal(toInstant(new Date(Date.UTC(2026, 9, 6, 5, 0, 0, 999))), "2026-10-06T05:00:00Z");
  assert.equal(toInstant(new Date("2026-10-06T12:00:00.5+07:00")), "2026-10-06T05:00:00Z");
  for (const d of [new Date(0), new Date(), new Date(Date.UTC(2099, 11, 31, 23, 59, 59, 999)), new Date(Date.UTC(1999, 0, 1))])
    assert.deepEqual(validateCreate("items", { ...task, created_at: toInstant(d) }), [], toInstant(d));
  const earlier = "2026-10-06T05:00:00Z";
  const later = toInstant(new Date(Date.parse(earlier) + 500));
  assert.ok(later >= earlier);
});

test("settings values follow the known keys and unknown keys stay free", () => {
  const set = (key: string, value: unknown) => ({ ...setting, key, value });
  const good: [string, string][] = [
    ["ceremony_date", "2027-06-01"],
    ["timezone", "Asia/Jakarta"],
    ["timezone", "UTC"],
    ["timezone", "America/Argentina/Buenos_Aires"],
    ["partner_a_label", "Partner A"],
    ["partner_b_label", "Partner B"],
    ["hijri_calendar", "islamic-umalqura"],
    ["hijri_calendar", "islamic-rgsa"],
    ["hijri_offset_days", "-2"],
    ["hijri_offset_days", "0"],
    ["hijri_offset_days", "2"],
    ["holidays", "[]"],
    ["holidays", '["2027-01-01","2027-03-31"]'],
    ["portion_multiplier", "1.15"],
    ["portion_multiplier", "2"],
    ["akad_venue", "anything goes"],
    ["some_future_key", "not a date"],
  ];
  for (const [key, value] of good) assert.deepEqual(validateCreate("settings", set(key, value)), [], `${key} ${value}`);
  const bad: [string, unknown][] = [
    ["ceremony_date", "not a date"],
    ["ceremony_date", "2027-02-30"],
    ["ceremony_date", "2027-06-01T00:00:00Z"],
    ["timezone", "Mars/Olympus"],
    ["timezone", "+07:00"],
    ["timezone", "Asia/ Jakarta"],
    ["timezone", "WIB"],
    ["hijri_calendar", "gregory"],
    ["hijri_offset_days", "3"],
    ["hijri_offset_days", "-3"],
    ["hijri_offset_days", "1.5"],
    ["hijri_offset_days", "+1"],
    ["holidays", "2027-01-01"],
    ["holidays", '["2027-13-01"]'],
    ["holidays", "[1]"],
    ["holidays", "{}"],
    ["portion_multiplier", "0"],
    ["portion_multiplier", "-1"],
    ["portion_multiplier", "1e3"],
    ["portion_multiplier", "abc"],
    ["portion_multiplier", "1234567"],
  ];
  for (const [key, value] of bad) rejects("settings", set(key, value), new RegExp(`value: must be .* for key ${key}`));
  assert.deepEqual(validatePatch("settings", "ceremony_date", { value: "2027-07-01" }), []);
  patchRejects("settings", "ceremony_date", { value: "nope" }, /value: must be a date/);
  assert.deepEqual(validatePatch("settings", "some_future_key", { value: "free" }), []);
  assert.deepEqual(validateRow("settings", { ...set("ceremony_date", "2027-06-01"), rev: 1, updated_by: null }), []);
  rejects("settings", set("ceremony_date", "x"), /value/);
  assert.ok(validateRow("settings", { ...set("ceremony_date", "x"), rev: 1 }).some((e) => /value/.test(e)));
});

test("deleted_at can only be cleared in a patch", () => {
  for (const [table, variant] of [
    ["items", "task"],
    ["budget_entries", "payment"],
    ["settings", "ceremony_date"],
  ])
    for (const value of [instant, "2026-10-06", "", 5, true])
      patchRejects(table, variant, { deleted_at: value }, /deleted_at: can only be cleared with null in a patch/);
});

test("a row cannot be created already deleted", () => {
  const rows: [string, Obj][] = [
    ["items", task],
    ["items", vendor],
    ["items", guest],
    ["budget_entries", planned],
    ["budget_entries", payment],
    ["settings", setting],
  ];
  for (const [table, row] of rows) {
    for (const value of [instant, "2026-10-06", "", 5, true]) {
      assert.ok(validateCreate(table, { ...row, deleted_at: value }).some((e) => /^deleted_at: /.test(e)), `${table} ${String(value)}`);
      const errors = validateMutation({
        id: uuid(700),
        table,
        op: "create",
        row_id: row[table === "settings" ? "key" : "id"],
        patch: { ...row, deleted_at: value },
      });
      assert.ok(errors.some((e) => /^patch.deleted_at: /.test(e)), `${table} ${String(value)}`);
    }
    rejects(table, { ...row, deleted_at: instant }, /deleted_at: cannot be set when creating a row/);
    assert.deepEqual(validateCreate(table, { ...row, deleted_at: null }), []);
    assert.deepEqual(validateRow(table, stored({ ...row, deleted_at: instant })), []);
  }
});

test("created_at cannot be patched", () => {
  patchRejects("items", "task", { created_at: "2026-01-01T00:00:00Z" }, /created_at: cannot be changed/);
  patchRejects("budget_entries", "payment", { created_at: "2026-01-01T00:00:00Z" }, /created_at: cannot be changed/);
  patchRejects("settings", "ceremony_date", { created_at: "2026-01-01T00:00:00Z" }, /created_at: cannot be changed/);
  assert.deepEqual(validatePatch("items", "task", { updated_at: "2026-01-01T00:00:00Z" }), []);
});

const stored = (row: Obj): Obj => ({ ...row, rev: 3, updated_by: "a" });

test("validateRow accepts stored rows and checks server columns", () => {
  for (const row of [task, vendor, guest]) assert.deepEqual(validateRow("items", stored(row)), []);
  for (const row of [planned, payment]) assert.deepEqual(validateRow("budget_entries", stored(row)), []);
  assert.deepEqual(validateRow("settings", stored(setting)), []);
  for (const updated_by of ["a", "b", "import", null]) assert.deepEqual(validateRow("items", { ...stored(task), updated_by }), []);
  rejects("items", { ...stored(task) }, /set by the server/);
  const bad = (row: Obj) => validateRow("items", row);
  assert.ok(bad({ ...stored(task), updated_by: "someone@example.test" }).some((e) => /updated_by/.test(e)));
  assert.ok(bad({ ...stored(task), updated_by: "c" }).some((e) => /updated_by/.test(e)));
  for (const rev of [-1, 1.5, "3", null]) assert.ok(bad({ ...stored(task), rev }).some((e) => /rev/.test(e)), String(rev));
  const { rev: _rev, ...noRev } = stored(task);
  assert.ok(bad(noRev).some((e) => /rev: required/.test(e)));
  assert.ok(bad({ ...stored(task), data: JSON.stringify(task.data) }).some((e) => /data: must be an object/.test(e)));
  assert.ok(bad({ ...stored(task), amount: -1 }).length > 0);
  assert.ok(bad({ ...stored(task), kind: "rundown" }).length > 0);
  assert.ok(validateRow("users", {}).length > 0);
  assert.ok(validateRow("budget_entries", { ...stored(payment), status: "due", done_on: "2026-11-02" }).some((e) => /done_on/.test(e)));
});

test("applyPatch merges shallowly and data key by key", () => {
  const row = { id: "x", title: "t", amount: 5, who: "a", data: { phone, pic: "p", facts: "f" } };
  assert.deepEqual(applyPatch(row, { title: "u", amount: null }), { id: "x", title: "u", amount: null, who: "a", data: row.data });
  assert.deepEqual(applyPatch(row, { data: { pic: "q", phone: null, rules: "r" } }).data, { pic: "q", facts: "f", rules: "r" });
  assert.deepEqual(applyPatch(row, { data: { phone: null, pic: null, facts: null } }).data, {});
  assert.deepEqual(applyPatch({ ...row, data: null }, { data: { pic: "q" } }).data, { pic: "q" });
  assert.deepEqual(applyPatch({ id: "x" }, { data: { pic: "q" } }), { id: "x", data: { pic: "q" } });
  assert.deepEqual(applyPatch(row, {}), row);
  assert.deepEqual(row, { id: "x", title: "t", amount: 5, who: "a", data: { phone, pic: "p", facts: "f" } });
  const hostile = applyPatch(row, JSON.parse('{"data":{"__proto__":{"polluted":true}}}'));
  assert.equal(({} as Obj).polluted, undefined);
  assert.equal(Object.getPrototypeOf(hostile.data), Object.prototype);
});

const patches: [string, string, string, Obj, Obj][] = [
  ["items", "task", "task", task, { status: "done", done_on: "2026-10-07", amount: null, data: { decision: false, rules: null } }],
  ["items", "vendor", "vendor", vendor, { status: "confirmed", amount: 100, data: { pic: null, phone: "+628111222333" } }],
  ["items", "guest", "guest", guest, { who: "b", qty: 1, data: { channel: "print", rsvp_qty: 2 } }],
  ["budget_entries", "planned", "planned", planned, { amount: null, vendor_id: vendor.id }],
  ["budget_entries", "planned", "planned", planned, { amount: 0, group_key: "ceremony" }],
  ["budget_entries", "payment", "payment", payment, { status: "paid", done_on: "2026-11-02", data: { proof_url: null } }],
  ["budget_entries", "payment", "payment", { ...payment, status: "paid", done_on: "2026-11-02" }, { done_on: null }],
  ["settings", "", "ceremony_date", setting, { value: "2027-07-01" }],
];

const dbFor = (row: Obj) => {
  const db = migrated();
  if (row.id !== vendor.id) insert(db, "items", vendor);
  if (row.id !== planned.id) insert(db, "budget_entries", planned);
  return db;
};

test("a merged patch validates and inserts into SQLite for every kind and entry type", () => {
  for (const [table, , variant, base, patch] of patches) {
    const row = stored(base);
    const variantName = table === "settings" ? (row.key as string) : variant;
    assert.deepEqual(validatePatch(table, variantName, patch), [], `${variant} patch`);
    const merged = applyPatch(row, patch);
    assert.deepEqual(validateRow(table, merged), [], `${variant} merged`);
    if (table === "settings") insert(migrated(), table, merged);
    else insert(dbFor(merged), table, merged);
  }
});

test("a patch that is fine alone breaks the merged row", () => {
  const paid = stored({ ...payment, status: "paid", done_on: "2026-11-02" });
  assert.deepEqual(validatePatch("budget_entries", "payment", { status: "due" }), []);
  const merged = applyPatch(paid, { status: "due" });
  assert.ok(validateRow("budget_entries", merged).some((e) => /done_on: only allowed when status is paid/.test(e)));
  assert.throws(() => insert(dbFor(merged), "budget_entries", merged), /CHECK constraint failed/);
  const due = stored(payment);
  assert.deepEqual(validatePatch("budget_entries", "payment", { done_on: "2026-11-02" }), []);
  const mergedDue = applyPatch(due, { done_on: "2026-11-02" });
  assert.ok(validateRow("budget_entries", mergedDue).length > 0);
  assert.throws(() => insert(dbFor(mergedDue), "budget_entries", mergedDue), /CHECK constraint failed/);
  const cleared = applyPatch(stored(planned), { amount: null });
  assert.deepEqual(validateRow("budget_entries", cleared), []);
  const noAmount = applyPatch(due, { amount: null });
  assert.ok(validateRow("budget_entries", noAmount).length > 0);
  assert.throws(() => insert(dbFor(noAmount), "budget_entries", noAmount), /CHECK constraint failed/);
});

test("validateMutation checks the envelope and a create row", () => {
  const create = (row: Obj, table = "items") => ({ id: uuid(500), table, op: "create", row_id: row[table === "settings" ? "key" : "id"], patch: row });
  assert.deepEqual(validateMutation(create(task)), []);
  assert.deepEqual(validateMutation(create(payment, "budget_entries")), []);
  assert.deepEqual(validateMutation(create(setting, "settings")), []);
  assert.deepEqual(validateMutation({ id: uuid(501), table: "items", op: "update", row_id: task.id, patch: { status: "done" } }), []);
  assert.deepEqual(validateMutation({ id: uuid(502), table: "items", op: "delete", row_id: task.id, patch: {} }), []);
  assert.deepEqual(validateMutation({ id: uuid(503), table: "settings", op: "update", row_id: "ceremony_date", patch: { value: "2027-07-01" } }), []);
  const bad = (m: unknown, pattern: RegExp) => {
    const errors = validateMutation(m);
    assert.ok(errors.some((e) => pattern.test(e)), `expected ${pattern} in ${JSON.stringify(errors)}`);
  };
  const ok = { id: uuid(504), table: "items", op: "update", row_id: task.id, patch: {} };
  for (const id of ["abc", "", 5, null, undefined]) bad({ ...ok, id }, /^id: must be a lowercase UUID/);
  bad({ ...ok, table: "users" }, /^table: unknown table/);
  bad({ ...ok, table: "sync_state" }, /^table: unknown table/);
  bad({ ...ok, table: undefined }, /^table: unknown table/);
  for (const op of ["upsert", "CREATE", "", 1, undefined]) bad({ ...ok, op }, /^op: must be one of create, update, delete/);
  for (const row_id of ["abc", "", 5, undefined, "ceremony_date"]) bad({ ...ok, row_id }, /^row_id: must be a lowercase UUID/);
  for (const row_id of ["Ceremony", "", 5, uuid(1)]) bad({ ...ok, table: "settings", row_id }, /^row_id: must be a lowercase key/);
  for (const patch of [null, [], "x", 5, undefined]) bad({ ...ok, patch }, /^patch: must be an object/);
  bad({ ...ok, extra: 1 }, /^extra: unknown field/);
  bad({ ...create(task), row_id: uuid(999) }, /^patch.id: must equal row_id/);
  bad({ ...create(setting, "settings"), row_id: "other_key" }, /^patch.key: must equal row_id/);
  bad({ ...create({ ...task, amount: -1 }) }, /^patch.amount: /);
  bad({ ...create({ ...task, rev: 1 }) }, /^patch.rev: set by the server/);
  bad({ ...create({ ...task, data: { phone } }) }, /^patch.data.phone: unknown key/);
  bad({ ...ok, op: "create", patch: { title: "x" } }, /^patch.id: must equal row_id/);
  for (const junk of [undefined, null, 1, "x", [], true]) assert.ok(validateMutation(junk).length > 0);
});

const every: [string, Obj, Obj][] = patches.map(([table, , , base, patch]) => [table, stored(base), patch]);

test("validateChange accepts every valid update and returns no errors", () => {
  for (const [table, row, patch] of every) assert.deepEqual(validateChange(table, row, patch), [], `${table} ${row.id ?? row.key}`);
  assert.deepEqual(validateChange("items", stored({ ...task, deleted_at: instant }), { deleted_at: null }), []);
});

test("validateChange rejects what the merged-row check alone would accept", () => {
  const rows: [string, Obj][] = [
    ["items", stored(task)],
    ["budget_entries", stored(payment)],
    ["settings", stored(setting)],
  ];
  const bypasses: [string, Obj, RegExp, boolean][] = [
    ["rev", { rev: 99 }, /rev: set by the server/, true],
    ["updated_by", { updated_by: "b" }, /updated_by: set by the server/, true],
    ["id", { id: uuid(900) }, /id: cannot be changed/, true],
    ["kind", { kind: "vendor" }, /kind: cannot be changed/, false],
    ["entry_type", { entry_type: "planned" }, /entry_type: cannot be changed/, false],
    ["key", { key: "other_key" }, /key: cannot be changed/, true],
    ["created_at", { created_at: "2020-01-01T00:00:00Z" }, /created_at: cannot be changed/, true],
    ["deleted_at", { deleted_at: instant }, /deleted_at: can only be cleared/, true],
  ];
  for (const [table, row] of rows) {
    for (const [name, patch, pattern, mergedAloneAccepts] of bypasses) {
      if (!(name in tables[table as TableName].columns)) continue;
      if (mergedAloneAccepts) assert.deepEqual(validateRow(table, applyPatch(row, patch)), [], `merged-only path accepts ${name} on ${table}`);
      const errors = validateChange(table, row, patch);
      assert.ok(errors.some((e) => pattern.test(e)), `${table} ${name}: ${JSON.stringify(errors)}`);
    }
  }
});

test("validateChange rejects data patches that are not objects", () => {
  for (const data of [null, [], ["phone"], "x", "{}", 5, true]) {
    const errors = validateChange("items", stored(vendor), { data });
    assert.ok(errors.some((e) => /^data: must be an object/.test(e)), `${JSON.stringify(data)}: ${JSON.stringify(errors)}`);
  }
  assert.ok(validateChange("items", stored(vendor), { data: { phone: "0812" } }).some((e) => /data.phone/.test(e)));
  assert.ok(validateChange("items", stored(vendor), { data: { channel: "print" } }).some((e) => /data.channel: unknown key/.test(e)));
  assert.deepEqual(validateChange("items", stored(vendor), { data: {} }), []);
});

test("applyPatch refuses a data patch that is not an object", () => {
  const row = { id: "x", data: { pic: "p" } };
  for (const data of [null, [], "x", 5, true]) assert.throws(() => applyPatch(row, { data }), TypeError, JSON.stringify(data));
  assert.deepEqual(applyPatch(row, { data: undefined }), row);
  assert.deepEqual(applyPatch(row, { title: "t" }), { ...row, title: "t" });
});

test("the settings known-key check comes from the stored row", () => {
  const row = stored({ ...setting, key: "ceremony_date", value: "2027-06-01" });
  assert.ok(validateChange("settings", row, { value: "banana" }).some((e) => /value: must be a date as YYYY-MM-DD for key ceremony_date/.test(e)));
  assert.deepEqual(validateChange("settings", row, { value: "2027-07-01" }), []);
  const free = stored({ ...setting, key: "some_future_key", value: "x" });
  assert.deepEqual(validateChange("settings", free, { value: "banana" }), []);
  const hijri = stored({ ...setting, key: "hijri_calendar", value: "islamic" });
  assert.ok(validateChange("settings", hijri, { value: "gregory" }).length > 0);
  for (const skipped of ["", undefined, null, 5, "Bad Key"])
    assert.ok(validatePatch("settings", skipped, { value: "banana" }).some((e) => /key: the stored row key is invalid/.test(e)), String(skipped));
  assert.ok(validateChange("settings", { ...row, key: "" }, { value: "banana" }).length > 0);
  const { key: _key, ...noKey } = row;
  assert.ok(validateChange("settings", noKey, { value: "banana" }).length > 0);
});

test("validateChange checks the stored row, the table and the shapes", () => {
  assert.match(validateChange("users", stored(task), {})[0], /unknown table/);
  assert.ok(validateChange("items", null, {}).length > 0);
  assert.ok(validateChange("items", stored(task), null).length > 0);
  assert.ok(validateChange("items", stored(task), []).length > 0);
  assert.ok(validateChange("items", { ...stored(task), kind: "rundown" }, { status: "done" }).some((e) => /kind: unknown kind/.test(e)));
  const { kind: _kind, ...noKind } = stored(task);
  assert.ok(validateChange("items", noKind, { status: "done" }).length > 0);
  const paid = stored({ ...payment, status: "paid", done_on: "2026-11-02" });
  assert.ok(validateChange("budget_entries", paid, { status: "due" }).some((e) => /done_on: only allowed when status is paid/.test(e)));
  assert.ok(validateChange("budget_entries", stored(payment), { done_on: "2026-11-02" }).length > 0);
  assert.ok(validateChange("budget_entries", stored(payment), { amount: null }).length > 0);
  assert.ok(validateChange("items", stored(task), { status: "confirmed" }).length > 0);
  assert.ok(validateChange("items", stored(task), { title: null }).length > 0);
  for (const junk of [undefined, 1, "x", true, () => 1, Symbol("s"), 10n])
    for (const other of [undefined, null, {}, [], "x"]) {
      assert.ok(Array.isArray(validateChange(junk, other, other)));
      assert.ok(Array.isArray(validateChange("items", other, junk)));
    }
});

test("settings are never deleted", () => {
  const key = { id: uuid(610), table: "settings", row_id: "ceremony_date" };
  for (const patch of [{}, { value: "2027-07-01" }, { key: "ceremony_date" }, null])
    assert.ok(validateMutation({ ...key, op: "delete", patch }).some((e) => /^op: settings are never deleted/.test(e)), JSON.stringify(patch));
  assert.deepEqual(
    validateMutation({ ...key, op: "create", patch: { key: "ceremony_date", value: "2027-06-01", ...stamps } }),
    [],
  );
  assert.deepEqual(validateMutation({ ...key, op: "update", patch: { value: "2027-07-01" } }), []);
  assert.deepEqual(validateMutation({ ...key, op: "update", patch: { deleted_at: null } }), []);
  for (const table of ["items", "budget_entries"])
    assert.deepEqual(validateMutation({ id: uuid(611), table, op: "delete", row_id: uuid(5), patch: {} }), []);
  assert.deepEqual(validateMutation({ ...key, op: "settings", patch: {} }).filter((e) => /settings are never deleted/.test(e)), []);
});

test("a delete mutation carries an empty patch", () => {
  const del = (patch: unknown) => ({ id: uuid(600), table: "items", op: "delete", row_id: task.id, patch });
  assert.deepEqual(validateMutation(del({})), []);
  for (const patch of [{ title: "x" }, { rev: 5 }, { deleted_at: instant }, { data: {} }, { status: "done" }])
    assert.ok(validateMutation(del(patch)).some((e) => /^patch: must be empty for delete/.test(e)), JSON.stringify(patch));
  assert.ok(validateMutation({ ...del({}), table: "settings", row_id: "ceremony_date" }).some((e) => /^op: settings are never deleted/.test(e)));
  assert.deepEqual(validateMutation({ ...del({ title: "x" }), op: "update" }), []);
});

test("default-ignorable characters alone are blank, visible emoji stay accepted", () => {
  const invisible = [
    "︀",
    "️",
    "\u{e0100}",
    "\u{e01ef}",
    "͏",
    "᠋",
    "᠌",
    "᠍",
    "᠏",
    "឴",
    "឵",
    "‍️",
    "️️",
    " ͏ ",
    "឴឵᠋",
    "ᅟ",
    "ᅠ",
    "ㅤ",
    "ﾠ",
    "⠀",
  ];
  for (const blank of invisible) {
    rejects("items", { ...task, title: blank }, /title/);
    rejects("items", { ...task, note: blank }, /note/);
    rejects("items", { ...task, group_key: blank }, /group_key/);
    rejects("settings", { ...setting, key: "label_free", value: blank }, /value/);
    rejects("items", { ...vendor, data: { pic: blank } }, /data.pic/);
  }
  const visible = [
    "\u{1f44d}\u{1f3fd}",
    "❤️",
    "\u{1f468}‍\u{1f469}‍\u{1f467}",
    "\u{1f3f3}️‍\u{1f308}",
    "1️⃣",
    "a️",
    "a͏",
    "❤︎",
  ];
  for (const ok of visible) {
    assert.deepEqual(validateCreate("items", { ...task, title: ok, note: ok }), [], ok);
    assert.deepEqual(validateCreate("items", { ...task, title: `${ok}͏️` }), [], ok);
  }
});

test("the batch caps are fixed", () => {
  assert.equal(MAX_MUTATIONS, 20);
  assert.equal(MAX_BODY_BYTES, 1048576);
});

test("never throws on bad input and returns errors", () => {
  const junk = [undefined, null, 0, 1, "x", "", true, [], {}, () => 1, Symbol("s"), 10n, JSON.parse('{"__proto__":{"x":1}}')];
  for (const table of junk)
    for (const row of junk) {
      assert.ok(Array.isArray(validateCreate(table, row)));
      assert.ok(Array.isArray(validatePatch(table, row, row)));
      assert.ok(validateRow(table, row).length > 0);
      assert.ok(validateMutation(row).length > 0);
    }
  for (const table of ["items", "budget_entries", "settings"])
    for (const row of junk) {
      assert.ok(validateCreate(table, row).length > 0, `${table} ${String(row)}`);
      assert.ok(Array.isArray(validatePatch(table, "task", row)));
    }
  assert.ok(validateCreate("items", {}).length > 0);
  assert.ok(validateCreate("items", [task]).length > 0);
});

test("reports every error, not just the first", () => {
  const errors = validateCreate("items", { ...task, amount: -1, who: "c", due_on: "x", colour: 1 });
  assert.equal(errors.length, 4);
});

test("patch accepts field-level changes", () => {
  assert.deepEqual(validatePatch("items", "task", { status: "done" }), []);
  assert.deepEqual(validatePatch("items", "task", { status: "done", done_on: "2026-10-06", amount: 0 }), []);
  assert.deepEqual(validatePatch("items", "task", { amount: null, due_on: null, who: null, note: null }), []);
  assert.deepEqual(validatePatch("items", "task", { updated_at: instant }), []);
  assert.deepEqual(validatePatch("items", "task", { deleted_at: null }), []);
  assert.deepEqual(validatePatch("budget_entries", "payment", { deleted_at: null }), []);
  assert.deepEqual(validatePatch("settings", "ceremony_date", { deleted_at: null }), []);
  assert.deepEqual(validatePatch("items", "vendor", { data: { phone, pic: null } }), []);
  assert.deepEqual(validatePatch("items", "guest", { who: "b", qty: 4 }), []);
  assert.deepEqual(validatePatch("items", "task", {}), []);
  assert.deepEqual(validatePatch("budget_entries", "payment", { status: "paid", done_on: "2026-11-02" }), []);
  assert.deepEqual(validatePatch("budget_entries", "planned", { amount: null, vendor_id: null }), []);
  assert.deepEqual(validatePatch("settings", "ceremony_date", { value: "2027-07-01" }), []);
});

test("patch rejects what create rejects, field by field", () => {
  patchRejects("items", "task", { amount: -1 }, /amount/);
  patchRejects("items", "task", { due_on: "x" }, /due_on/);
  patchRejects("items", "task", { who: "c" }, /who/);
  patchRejects("items", "guest", { who: "both" }, /who: must be one of a, b for kind guest/);
  patchRejects("items", "task", { status: "confirmed" }, /status: must be one of todo, done/);
  patchRejects("items", "task", { colour: "red" }, /colour: unknown column/);
  patchRejects("items", "task", { updated_by: "a" }, /updated_by: set by the server/);
  patchRejects("items", "task", { rev: 9 }, /rev: set by the server/);
  patchRejects("items", "task", { project_id: uuid(1) }, /project_id: unknown column/);
  patchRejects("items", "project", { status: "active" }, /kind: unknown kind/);
  patchRejects("items", "vendor", { data: { channel: "print" } }, /data.channel: unknown key/);
  patchRejects("items", "vendor", { data: { phone: "0812" } }, /data.phone/);
  patchRejects("items", "task", { data: null }, /data: must be an object/);
  patchRejects("items", "task", { data: [] }, /data: must be an object/);
  patchRejects("budget_entries", "planned", { status: "due" }, /status: not used by entry_type planned/);
  patchRejects("budget_entries", "payment", { vendor_id: uuid(3) }, /vendor_id: not used/);
  patchRejects("budget_entries", "payment", { status: "due", done_on: "2026-11-02" }, /done_on: only allowed when status is paid/);
  patchRejects("settings", "ceremony_date", { value: "" }, /value/);
});

test("patch cannot clear required fields or change identity", () => {
  patchRejects("items", "task", { title: null }, /title: must not be null/);
  patchRejects("items", "task", { status: null }, /status: required for kind task/);
  patchRejects("items", "task", { created_at: null }, /created_at: cannot be changed/);
  patchRejects("items", "task", { currency: null }, /currency: must not be null/);
  patchRejects("items", "task", { id: uuid(9) }, /id: cannot be changed/);
  patchRejects("items", "task", { kind: "vendor" }, /kind: cannot be changed/);
  patchRejects("budget_entries", "payment", { entry_type: "planned" }, /entry_type: cannot be changed/);
  patchRejects("budget_entries", "payment", { amount: null }, /amount: required for entry_type payment/);
  patchRejects("budget_entries", "planned", { group_key: null }, /group_key: required for entry_type planned/);
  patchRejects("settings", "ceremony_date", { key: "other" }, /key: cannot be changed/);
  patchRejects("items", "rundown", { status: "done" }, /kind: unknown kind/);
  patchRejects("items", undefined, { status: "done" }, /kind: unknown kind/);
});

const validRows: [string, Obj][] = [];
for (const kind of Object.keys(items) as (keyof typeof items)[]) {
  const v = tables.items.variants[kind];
  const row = items[kind] as Obj;
  for (const status of v.status) validRows.push([`${kind} ${status}`, { ...row, status }]);
  if (v.columns.includes("who" as never)) {
    for (const who of ("who" in v ? v.who : tables.items.columns.who.type)) validRows.push([`${kind} who ${who}`, { ...row, who }]);
  }
}
for (const status of tables.budget_entries.variants.payment.status)
  validRows.push([`payment ${status}`, { ...payment, status, ...(status === "paid" ? { done_on: "2026-11-02" } : {}) }]);
for (const who of tables.budget_entries.columns.who.type) validRows.push([`payment who ${who}`, { ...payment, who }]);

test("every row the validator accepts passes the SQL constraints", () => {
  let n = 1000;
  for (const [label, row] of validRows) {
    const table = "entry_type" in row ? "budget_entries" : "items";
    assert.deepEqual(validateCreate(table, row), [], label);
    insert(seeded(), table, { ...row, id: uuid(n++) });
  }
  const db = seeded();
  insert(db, "items", task);
  insert(db, "items", vendor);
  insert(db, "items", guest);
  insert(db, "budget_entries", payment);
  insert(db, "budget_entries", { ...planned, id: uuid(12), amount: null });
  insert(db, "budget_entries", { ...payment, id: uuid(13), status: "paid", done_on: "2026-11-02", data: undefined });
  insert(migrated(), "settings", setting);
  insert(db, "items", { ...task, id: uuid(30), currency: "USD" });
  insert(db, "budget_entries", { ...planned, id: uuid(31), vendor_id: vendor.id });
});

const sqlAlsoRejects: [string, string, Obj][] = [
  ["created_at without time", "items", { ...task, created_at: "2026-10-06" }],
  ["updated_at without Z", "items", { ...task, updated_at: "2026-10-06T05:00:00" }],
  ["deleted_at without time", "items", { ...task, deleted_at: "2026-10-06" }],
  ["bad due_on", "items", { ...task, due_on: "06-10-2026" }],
  ["bad done_on", "items", { ...task, done_on: "2026/10/06" }],
  ["bad who", "items", { ...task, who: "c" }],
  ["negative amount", "items", { ...task, amount: -1 }],
  ["negative qty", "items", { ...task, qty: -1 }],
  ["bad currency", "items", { ...task, currency: "RP" }],
  ["currency of four letters", "items", { ...task, currency: "IDRR" }],
  ["data that is not JSON", "items", { ...task, data: "{" }],
  ["settings created_at without time", "settings", { ...setting, created_at: "2026-10-06" }],
  ["settings updated_at without Z", "settings", { ...setting, updated_at: "2026-10-06T05:00:00" }],
  ["settings deleted_at without time", "settings", { ...setting, deleted_at: "2026-10-06" }],
  ["updated_by from the client", "items", { ...task, updated_by: "someone@example.test" }],
  ["setting updated_by from the client", "settings", { ...setting, updated_by: "someone@example.test" }],
  ["planned without group_key", "budget_entries", { ...planned, id: uuid(20), group_key: null }],
  ["planned with budget_id", "budget_entries", { ...planned, id: uuid(20), budget_id: plannedId }],
  ["planned with status", "budget_entries", { ...planned, id: uuid(20), status: "due" }],
  ["planned with due_on", "budget_entries", { ...planned, id: uuid(20), due_on: "2026-11-01" }],
  ["planned with done_on", "budget_entries", { ...planned, id: uuid(20), done_on: "2026-11-01" }],
  ["planned with negative amount", "budget_entries", { ...planned, id: uuid(20), amount: -1 }],
  ["payment without budget_id", "budget_entries", { ...payment, budget_id: null }],
  ["payment with vendor_id", "budget_entries", { ...payment, vendor_id: vendor.id }],
  ["payment without status", "budget_entries", { ...payment, status: null }],
  ["payment with an unknown status", "budget_entries", { ...payment, status: "late" }],
  ["payment without amount", "budget_entries", { ...payment, amount: null }],
  ["payment with negative amount", "budget_entries", { ...payment, amount: -1 }],
  ["due payment with done_on", "budget_entries", { ...payment, done_on: "2026-11-02" }],
  ["unknown entry_type", "budget_entries", { ...payment, entry_type: "refund" }],
  ["bad payment who", "budget_entries", { ...payment, who: "c" }],
];

for (const [label, table, row] of sqlAlsoRejects) {
  test(`validator and SQL both reject ${label}`, () => {
    assert.ok(validateCreate(table, row).length > 0, "validator");
    const db = seeded();
    insert(db, "items", vendor);
    assert.throws(() => insert(db, table, row), /CHECK constraint failed/);
  });
}
