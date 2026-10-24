import { tables } from "./tables.ts";
import type { Row, TableName } from "./tables.ts";

export type Side = "a" | "b";

export type Op = "create" | "update" | "delete";

export type Mutation = {
  id: string;
  table: TableName;
  op: Op;
  row_id: string;
  patch: Record<string, unknown>;
};

export type Changes = { [T in TableName]: Row<T>[] };

export type SyncResponse = {
  rev: number;
  epoch: string;
  me: Side;
  changes: Changes;
};

export type SyncRequest = {
  mutations: Mutation[];
};

export type SyncResult = {
  rev: number;
  epoch: string;
  rows: Changes;
};

export type Rejection = {
  status: number;
  errors: string[];
  index?: number;
};

export type ErrorBody = { error: string };

export type SideMismatch = { error: "side_mismatch"; me: Side };

export const SIDE_HEADER = "x-wp-side";

export const MAX_MUTATIONS = 20;

export const MAX_BODY_BYTES = 1048576;

export const rowKey = <T extends TableName>(table: T, row: Row<T>): string =>
  (row as Record<string, string>)[tables[table].key];

export const toInstant = (date: Date): string => date.toISOString().replace(/\.\d{3}Z$/, "Z");

export const applyPatch = <T extends Record<string, unknown>>(row: T, patch: Record<string, unknown>): T => {
  const { data, ...fields } = patch;
  const merged: Record<string, unknown> = Object.fromEntries([...Object.entries(row), ...Object.entries(fields)]);
  if (data !== undefined) {
    if (typeof data !== "object" || data === null || Array.isArray(data)) throw new TypeError("a data patch must be an object");
    const keys = new Map(Object.entries(typeof row.data === "object" && row.data !== null ? row.data : {}));
    for (const [key, value] of Object.entries(data)) {
      if (value === null) keys.delete(key);
      else keys.set(key, value);
    }
    merged.data = Object.fromEntries(keys);
  }
  return merged as T;
};
