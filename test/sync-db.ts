import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";
import type { Mutation, Side } from "../shared/api.ts";
import { applyMutations } from "../worker/sync.ts";
import type { Db } from "../worker/sync.ts";

const migrations = readdirSync(new URL("../migrations/", import.meta.url))
  .sort()
  .map((name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));

const MAX_PARAMS = 100;

export function createDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const migration of migrations) sqlite.exec(migration);
  const calls: string[][] = [];
  let inBatch = false;
  const statement = (sql: string, params: SQLInputValue[] = []) => ({
    sql,
    bind(...values: unknown[]) {
      if (values.length > MAX_PARAMS) throw new Error("too many bound parameters");
      return statement(sql, values as SQLInputValue[]);
    },
    async all() {
      if (!inBatch) calls.push([sql]);
      return { results: sqlite.prepare(sql).all(...params).map((row) => ({ ...row })) };
    },
    async first() {
      return (await this.all()).results[0] ?? null;
    },
    async run() {
      await this.all();
      return { success: true };
    },
  });
  const db: Db = {
    prepare: (sql) => statement(sql),
    async batch(statements) {
      calls.push(statements.map((item) => (item as unknown as { sql: string }).sql));
      inBatch = true;
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const item of statements) results.push(await item.all());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      } finally {
        inBatch = false;
      }
    },
  };
  return { db, sqlite, calls };
}

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const NOW = new Date("2026-10-06T05:00:00.789Z");
export const STAMP = "2026-10-06T05:00:00Z";
export const CLIENT_STAMP = "2026-10-01T00:00:00Z";

type Patch = Record<string, unknown>;

let counter = 0;

export const mutation = (op: Mutation["op"], table: Mutation["table"], rowId: string, patch: Patch = {}): Mutation => ({
  id: id(900000 + ++counter),
  table,
  op,
  row_id: rowId,
  patch,
});

const stamps = { created_at: CLIENT_STAMP, updated_at: CLIENT_STAMP };

export const task = (n: number, extra: Patch = {}) =>
  mutation("create", "items", id(n), { id: id(n), kind: "task", title: "Task", status: "todo", ...stamps, ...extra });

export const vendor = (n: number, extra: Patch = {}) =>
  mutation("create", "items", id(n), { id: id(n), kind: "vendor", title: "Vendor", status: "option", ...stamps, ...extra });

export const planned = (n: number, extra: Patch = {}) =>
  mutation("create", "budget_entries", id(n), {
    id: id(n),
    entry_type: "planned",
    group_key: "reception",
    title: "Planned",
    amount: 1000,
    ...stamps,
    ...extra,
  });

export const payment = (n: number, plannedN: number, extra: Patch = {}) =>
  mutation("create", "budget_entries", id(n), {
    id: id(n),
    entry_type: "payment",
    budget_id: id(plannedN),
    title: "Payment",
    status: "due",
    amount: 100,
    ...stamps,
    ...extra,
  });

export const setting = (key: string, value: string) =>
  mutation("create", "settings", key, { key, value, ...stamps });

export const apply = (db: Db, mutations: unknown[], who: Side = "a", now = NOW) => applyMutations(db, who, mutations, now);

export const stored = (sqlite: DatabaseSync, table: string, key: string) => {
  const column = table === "settings" ? "key" : "id";
  const found = sqlite.prepare(`SELECT * FROM ${table} WHERE ${column} = ?`).get(key);
  return found === undefined ? undefined : { ...found };
};

export const currentEpoch = (sqlite: DatabaseSync) => (sqlite.prepare("SELECT epoch FROM sync_state").get() as { epoch: string }).epoch;

export const currentRev = (sqlite: DatabaseSync) => (sqlite.prepare("SELECT rev FROM sync_state").get() as { rev: number }).rev;

export const count = (sqlite: DatabaseSync, table: string) => (sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
