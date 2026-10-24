import { MAX_MUTATIONS, applyPatch } from "../../shared/api.ts";
import type { Changes, Mutation, Side } from "../../shared/api.ts";
import { tableNames, tables } from "../../shared/tables.ts";
import type { Column, TableName } from "../../shared/tables.ts";
import type { Pending, Rows } from "./persistence.ts";

type Dict = Record<string, unknown>;

export type Maps = Record<TableName, Map<string, Dict>>;

export const BATCH_BYTES = 512 * 1024;

const encoder = new TextEncoder();

export const wire = ({ id, table, op, row_id, patch }: Mutation): Mutation => ({ id, table, op, row_id, patch });

export const takeBatch = (queue: readonly Pending[]): Pending[] => {
  const batch: Pending[] = [];
  let size = encoder.encode('{"mutations":[]}').length;
  for (const entry of queue) {
    size += encoder.encode(JSON.stringify(wire(entry))).length + 1;
    if (batch.length > 0 && (batch.length === MAX_MUTATIONS || size > BATCH_BYTES)) break;
    batch.push(entry);
  }
  return batch;
};

export const toMaps = (rows: Rows): Maps =>
  Object.fromEntries(
    tableNames.map((table) => [
      table,
      new Map((rows[table] as Dict[]).map((row) => [row[tables[table].key] as string, row])),
    ]),
  ) as Maps;

export const live = (maps: Maps): Rows =>
  Object.fromEntries(
    tableNames.map((table) => [table, [...maps[table].values()].filter((row) => row.deleted_at === null)]),
  ) as unknown as Rows;

export const newer = (base: Maps, changes: Changes): Partial<Rows> => {
  const fresh: Record<string, Dict[]> = {};
  for (const table of tableNames) {
    for (const row of (changes[table] ?? []) as Dict[]) {
      const known = base[table].get(row[tables[table].key] as string);
      if (!known || (row.rev as number) > (known.rev as number)) (fresh[table] ??= []).push(row);
    }
  }
  return fresh as Partial<Rows>;
};

export const absorb = (base: Maps, rows: Partial<Rows>) => {
  for (const table of tableNames) {
    for (const row of (rows[table] ?? []) as Dict[]) base[table].set(row[tables[table].key] as string, row);
  }
};

const blankRow = (table: TableName, patch: Dict): Dict =>
  Object.fromEntries(
    Object.entries(tables[table].columns as Record<string, Column>).map(([name, column]) => [
      name,
      patch[name] ?? column.default ?? (name === "rev" ? 0 : null),
    ]),
  );

export const overlay = (base: Maps, queue: readonly Pending[], me: Side | null = null): Maps => {
  const view = Object.fromEntries(tableNames.map((table) => [table, new Map(base[table])])) as Maps;
  const stamped = (row: Dict): Dict => (me === null ? row : { ...row, updated_by: me });
  for (const mutation of queue) {
    const rows = view[mutation.table];
    const row = rows.get(mutation.row_id);
    if (mutation.op === "create") {
      if (!row) rows.set(mutation.row_id, stamped(blankRow(mutation.table, mutation.patch)));
      else if (mutation.table === "settings") rows.set(mutation.row_id, stamped(applyPatch(row, mutation.patch)));
    } else if (row) {
      rows.set(mutation.row_id, mutation.op === "update" ? stamped(applyPatch(row, mutation.patch)) : { ...row, deleted_at: mutation.at });
    }
  }
  return view;
};

export const changedFields = (row: Dict, change: Dict): Dict => {
  const patch: Dict = {};
  for (const [name, value] of Object.entries(change)) {
    if (value === undefined) continue;
    if (name === "data" && typeof value === "object" && value !== null) {
      const current = (row.data ?? {}) as Dict;
      const data = Object.fromEntries(
        Object.entries(value).filter(([key, next]) => (next === null ? key in current : next !== undefined && current[key] !== next)),
      );
      if (Object.keys(data).length > 0) patch.data = data;
    } else if (row[name] !== value) {
      patch[name] = value;
    }
  }
  return patch;
};
