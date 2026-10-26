import { MAX_BODY_BYTES, MAX_MUTATIONS, POSTER_KEYS, POSTER_PURGE, applyPatch, dropsPoster, toInstant, withoutPoster } from "../shared/api.ts";
import type { Changes, Mutation, Rejection, Side, SyncResponse, SyncResult } from "../shared/api.ts";
import { ACTION_KINDS } from "../shared/routines.ts";
import { tableNames, tables } from "../shared/tables.ts";
import type { Column, TableName } from "../shared/tables.ts";
import { validateChange, validateMutation } from "../shared/validate.ts";
import { checkPrivacy, gate, hides } from "./private.ts";

type Raw = Record<string, unknown>;
type Failure = Omit<Rejection, "index">;
type Result = { results: Raw[] };
type World = Record<TableName, Map<string, Raw>>;
type Context = { db: Db; world: World; hidden: Set<string>; stamp: string; who: Side };

export type Statement = { bind(...values: unknown[]): Statement; all(): Promise<Result> };
export type Db = { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<Result[]> };

const NEW_REV = "(SELECT rev FROM sync_state WHERE id = 1)";

const parents: Record<string, string> = { copy: "book", ...Object.fromEntries(ACTION_KINDS.map((kind) => [kind, "routine"])) };

const refs: Record<TableName, Record<string, readonly ["items" | "budget_entries", string | Record<string, string>]>> = {
  settings: {},
  items: {
    parent_id: ["items", parents],
  },
  budget_entries: {
    vendor_id: ["items", "vendor"],
    budget_id: ["budget_entries", "planned"],
  },
};

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

export const reject = (status: number, errors: string[], index?: number) =>
  json({ status, errors, index } satisfies Rejection, status);

const marks = (values: readonly unknown[]) => values.map(() => "?").join(", ");

const parseRow = (raw: Raw): Raw => (typeof raw.data === "string" ? { ...raw, data: JSON.parse(raw.data) } : raw);

const collect = (results: Result[]) => ({
  rev: results[tableNames.length].results[0].rev as number,
  epoch: results[tableNames.length].results[0].epoch as string,
  rows: Object.fromEntries(tableNames.map((name, i) => [name, results[i].results.map(parseRow)])) as Changes,
});

export const pull = async (db: Db, since: number, who: Side) => {
  const reads = tableNames.map((name) => {
    const [filter, params] = gate(name, who);
    return db.prepare(`SELECT * FROM ${name} WHERE rev > ? ${filter} ORDER BY rev, ${tables[name].key}`).bind(since, ...params);
  });
  const { rev, epoch, rows } = collect(await db.batch([...reads, db.prepare("SELECT rev, epoch FROM sync_state WHERE id = 1")]));
  return { rev, epoch, changes: rows };
};

const load = async (db: Db, mutations: Mutation[], who: Side) => {
  const wanted: Record<TableName, Set<string>> = { settings: new Set(), items: new Set(), budget_entries: new Set() };
  const budgetRows: string[] = [];
  for (const mutation of mutations) {
    wanted[mutation.table].add(mutation.row_id);
    if (mutation.table === "budget_entries") budgetRows.push(mutation.row_id);
    for (const [column, [target]] of Object.entries(refs[mutation.table])) {
      const id = mutation.patch[column];
      if (typeof id === "string") wanted[target].add(id);
    }
  }
  const ids = (name: TableName) => [...wanted[name]];
  const queries: Record<TableName, [string, unknown[]]> = {
    settings: [`SELECT * FROM settings WHERE key IN (${marks(ids("settings"))})`, ids("settings")],
    items: [
      `SELECT * FROM items WHERE id IN (${marks(ids("items"))}) OR id IN (SELECT parent_id FROM items WHERE id IN (${marks(ids("items"))}))`,
      [...ids("items"), ...ids("items")],
    ],
    budget_entries: [
      `SELECT * FROM budget_entries WHERE id IN (${marks(ids("budget_entries"))}) OR id IN (SELECT budget_id FROM budget_entries WHERE id IN (${marks(budgetRows)}))`,
      [...ids("budget_entries"), ...budgetRows],
    ],
  };
  const results = await db.batch(tableNames.map((name) => db.prepare(queries[name][0]).bind(...queries[name][1])));
  const world = Object.fromEntries(
    tableNames.map((name, i) => [
      name,
      new Map(results[i].results.map((raw) => [raw[tables[name].key] as string, parseRow(raw)])),
    ]),
  ) as World;
  const hidden = new Set([...world.items].filter(([, row]) => hides(row, world.items.get(row.parent_id as string), who)).map(([id]) => id));
  for (const id of hidden) world.items.delete(id);
  return { world, hidden };
};

const checkRefs = (world: World, name: TableName, before: Raw | undefined, after: Raw): string[] => {
  const changed = (column: string) => before === undefined || before[column] !== after[column];
  const errors: string[] = [];
  for (const [column, [targetTable, want]] of Object.entries(refs[name])) {
    if (after[column] === null || !changed(column)) continue;
    const kind = typeof want === "string" ? want : want[after.kind as string];
    const target = world[targetTable].get(after[column] as string);
    if (!target || target.deleted_at !== null) errors.push(`${column}: must point at a live ${targetTable} row`);
    else if (target[tables[targetTable].by] !== kind) errors.push(`${column}: must point at a ${kind} row`);
  }
  if (errors.length > 0 || name !== "budget_entries") return errors;
  if (!["budget_id", "currency"].some(changed)) return errors;
  if (after.budget_id !== null && world.budget_entries.get(after.budget_id as string)?.currency !== after.currency) {
    errors.push("currency: must equal the currency of the planned row");
  }
  return errors;
};

const privacy = (ctx: Context, name: TableName, before: Raw | undefined, after: Raw) =>
  name === "items" ? checkPrivacy(ctx.world.items, ctx.who, before, after) : [];

const updateStatement = (ctx: Context, name: TableName, id: string, sets: Raw, data: Raw) => {
  const assignments = Object.keys(sets).map((column) => `${column} = ?`);
  const values = Object.values(sets);
  if (Object.keys(data).length > 0) {
    assignments.push("data = json_patch(coalesce(data, '{}'), ?)");
    values.push(JSON.stringify(data));
  }
  assignments.push(`rev = ${NEW_REV}`, "updated_at = ?", "updated_by = ?");
  values.push(ctx.stamp, ctx.who, id);
  return ctx.db.prepare(`UPDATE ${name} SET ${assignments.join(", ")} WHERE ${tables[name].key} = ?`).bind(...values);
};

const differences = (name: TableName, stored: Raw, patch: Raw) => {
  const sets = Object.fromEntries(
    Object.keys(tables[name].columns)
      .filter((column) => column !== "data" && column !== "updated_at" && Object.hasOwn(patch, column) && patch[column] !== stored[column])
      .map((column) => [column, patch[column]]),
  );
  const base = (stored.data ?? {}) as Raw;
  const data = Object.fromEntries(
    Object.entries((patch.data ?? {}) as Raw).filter(([key, value]) => (value === null ? Object.hasOwn(base, key) : base[key] !== value)),
  );
  return { sets, data };
};

const insert = (ctx: Context, name: TableName, mutation: Mutation): Failure | Statement => {
  const columns = Object.entries(tables[name].columns) as [string, Column][];
  const row: Raw = Object.fromEntries(columns.map(([column, spec]) => [column, mutation.patch[column] ?? spec.default ?? null]));
  Object.assign(row, { rev: 0, created_at: ctx.stamp, updated_at: ctx.stamp, updated_by: ctx.who, deleted_at: null });
  const conflicts = [...checkRefs(ctx.world, name, undefined, row), ...privacy(ctx, name, undefined, row)];
  if (conflicts.length > 0) return { status: 409, errors: conflicts };
  ctx.world[name].set(mutation.row_id, row);
  const names = columns.map(([column]) => column).filter((column) => column !== "rev");
  const values = names.map((column) => (column === "data" && row.data !== null ? JSON.stringify(row.data) : row[column]));
  return ctx.db
    .prepare(`INSERT INTO ${name} (${names.join(", ")}, rev) VALUES (${marks(names)}, ${NEW_REV})`)
    .bind(...values);
};

const update = (ctx: Context, name: TableName, id: string, patch: Raw, stored: Raw): Failure | Statement | undefined => {
  const revives =
    patch.deleted_at === null &&
    Object.entries(patch).every(
      ([key, value]) =>
        key === "deleted_at" ||
        key === "updated_at" ||
        (key === "data" && dropsPoster(name, stored) && typeof value === "object" && value !== null && Object.keys(value).every((held) => POSTER_KEYS.some((poster) => poster === held))),
    );
  if (stored.deleted_at !== null && !revives) return undefined;
  const errors = validateChange(name, stored, patch);
  if (errors.length > 0) return { status: 400, errors };
  const merged = applyPatch(stored, patch);
  const conflicts = [...checkRefs(ctx.world, name, stored, merged), ...privacy(ctx, name, stored, merged)];
  if (conflicts.length > 0) return { status: 409, errors: conflicts };
  const { sets, data } = differences(name, stored, patch);
  if (Object.keys(sets).length === 0 && Object.keys(data).length === 0) return undefined;
  ctx.world[name].set(id, { ...merged, updated_at: ctx.stamp, updated_by: ctx.who });
  return updateStatement(ctx, name, id, sets, data);
};

const remove = (ctx: Context, name: TableName, id: string, stored: Raw): Failure | Statement | undefined => {
  if (stored.deleted_at !== null) return undefined;
  ctx.world[name].set(id, { ...withoutPoster(name, stored), deleted_at: ctx.stamp, updated_at: ctx.stamp, updated_by: ctx.who });
  const { data } = dropsPoster(name, stored) ? differences(name, stored, { data: POSTER_PURGE }) : { data: {} };
  return updateStatement(ctx, name, id, { deleted_at: ctx.stamp }, data);
};

const step = (ctx: Context, mutation: Mutation): Failure | Statement | undefined => {
  const { table, op, row_id: id } = mutation;
  if (table === "items" && ctx.hidden.has(id)) return { status: 404, errors: ["row_id: no such row"] };
  const stored = ctx.world[table].get(id);
  if (op === "create") {
    if (!stored) return insert(ctx, table, mutation);
    return table === "settings" ? update(ctx, table, id, { value: mutation.patch.value }, stored) : undefined;
  }
  if (!stored) return { status: 404, errors: ["row_id: no such row"] };
  return op === "update" ? update(ctx, table, id, mutation.patch, stored) : remove(ctx, table, id, stored);
};

export const applyMutations = async (db: Db, who: Side, mutations: unknown[], now: Date): Promise<SyncResult | Rejection> => {
  const invalid = mutations.findIndex((mutation) => validateMutation(mutation).length > 0);
  const valid = (invalid < 0 ? mutations : mutations.slice(0, invalid)) as Mutation[];
  const ctx: Context = { db, ...(await load(db, valid, who)), stamp: toInstant(now), who };
  const writes: Statement[] = [];
  for (const [index, mutation] of valid.entries()) {
    const outcome = step(ctx, mutation);
    if (outcome === undefined) continue;
    if ("errors" in outcome) return { ...outcome, index };
    writes.push(outcome);
  }
  if (invalid >= 0) return { status: 400, errors: validateMutation(mutations[invalid]), index: invalid };
  const reads = tableNames.map((name) => {
    const ids = [...new Set(valid.filter((mutation) => mutation.table === name).map((mutation) => mutation.row_id))];
    const [filter, params] = gate(name, who);
    return db
      .prepare(`SELECT * FROM ${name} WHERE ${tables[name].key} IN (${marks(ids)}) ${filter} ORDER BY rev, ${tables[name].key}`)
      .bind(...ids, ...params);
  });
  const bump = writes.length > 0 ? [db.prepare("UPDATE sync_state SET rev = rev + 1 WHERE id = 1"), ...writes] : [];
  const results = await db.batch([...bump, ...reads, db.prepare("SELECT rev, epoch FROM sync_state WHERE id = 1")]);
  return collect(results.slice(-(tableNames.length + 1)));
};

export const getSync = async (url: URL, db: Db, who: Side) => {
  const since = url.searchParams.get("since") ?? "0";
  if (!/^(0|[1-9]\d*)$/.test(since) || !Number.isSafeInteger(Number(since))) {
    return reject(400, ["since: must be a non-negative integer"]);
  }
  const { rev, epoch, changes } = await pull(db, Number(since), who);
  return json({ rev, epoch, me: who, changes } satisfies SyncResponse);
};

const readText = async (request: Request, max: number) => {
  if (Number(request.headers.get("content-length")) > max) return null;
  const reader = request.body?.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  let text = "";
  let size = 0;
  while (reader) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
};

export const postSync = async (request: Request, db: Db, who: Side) => {
  let body: unknown;
  try {
    const text = await readText(request, MAX_BODY_BYTES);
    if (text === null) return reject(413, [`body: must be at most ${MAX_BODY_BYTES} bytes`]);
    body = JSON.parse(text);
  } catch {
    return reject(400, ["body: must be JSON"]);
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return reject(400, ["body: must be an object"]);
  const unknownFields = Object.keys(body).filter((key) => key !== "mutations");
  if (unknownFields.length > 0) return reject(400, unknownFields.map((key) => `${key}: unknown field`));
  const { mutations } = body as { mutations?: unknown };
  if (!Array.isArray(mutations)) return reject(400, ["mutations: must be an array"]);
  if (mutations.length > MAX_MUTATIONS) return reject(400, [`mutations: must have at most ${MAX_MUTATIONS} entries`]);
  const result = await applyMutations(db, who, mutations, new Date());
  return "errors" in result ? reject(result.status, result.errors, result.index) : json(result);
};
