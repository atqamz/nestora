import type { Side } from "../../shared/api.ts";
import { tableNames, tables } from "../../shared/tables.ts";
import type { TableName } from "../../shared/tables.ts";
import type { Disk, Meta, Pending, Persistence, Persisted } from "./persistence.ts";

type Dict = Record<string, unknown>;

export const memoryPersistence = (): Persistence => {
  const rows = new Map<TableName, Map<string, Dict>>(tableNames.map((table) => [table, new Map()]));
  const outbox = new Map<number, Pending>();
  const meta: Meta = { rev: 0, me: null, epoch: null, generation: null, adopted: null };
  return {
    load: async () =>
      structuredClone({
        rows: Object.fromEntries(tableNames.map((table) => [table, [...rows.get(table)!.values()]])),
        outbox: [...outbox.values()],
        meta,
      }) as Persisted,
    write: async (write) => {
      const copy = structuredClone(write);
      for (const table of tableNames) {
        for (const row of (copy.rows?.[table] ?? []) as Dict[]) rows.get(table)!.set(row[tables[table].key] as string, row);
      }
      for (const entry of copy.outbox?.put ?? []) outbox.set(entry.seq, entry);
      for (const seq of copy.outbox?.drop ?? []) outbox.delete(seq);
      Object.assign(meta, copy.meta);
    },
    reset: async (expected, next) => {
      if (meta.generation !== expected) return null;
      for (const table of tableNames) rows.get(table)!.clear();
      outbox.clear();
      Object.assign(meta, structuredClone(next), { generation: crypto.randomUUID() });
      return meta.generation;
    },
    adopt: async (from) => {
      const empty = [...rows.values()].every((table) => table.size === 0) && outbox.size === 0 && Object.values(meta).every((value) => value === null || value === 0);
      if (!empty) return;
      const copy = structuredClone(from);
      for (const table of tableNames) {
        for (const row of copy.rows[table] as Dict[]) rows.get(table)!.set(row[tables[table].key] as string, row);
      }
      for (const entry of copy.outbox) outbox.set(entry.seq, entry);
      Object.assign(meta, copy.meta);
    },
  };
};

export const memoryDisk = async (legacy?: Persisted): Promise<Disk> => {
  const partitions: Record<Side, Persistence> = { a: memoryPersistence(), b: memoryPersistence() };
  const old = memoryPersistence();
  if (legacy) await old.adopt(legacy);
  return { open: (side) => partitions[side], legacy: async () => (legacy ? old : null) };
};
