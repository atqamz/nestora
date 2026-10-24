import type { Mutation, Side } from "../../shared/api.ts";
import { tableNames } from "../../shared/tables.ts";
import type { Row, TableName } from "../../shared/tables.ts";

export type Pending = Mutation & { seq: number; at: string; rejected?: string[] };

export type Rows = { [T in TableName]: Row<T>[] };

export type Meta = { rev: number; me: Side | null; epoch: string | null; generation: string | null; adopted: Side | null };

export type Persisted = { rows: Rows; outbox: Pending[]; meta: Meta };

export type Write = {
  rows?: Partial<Rows>;
  outbox?: { put?: Pending[]; drop?: number[] };
  meta?: Partial<Meta>;
};

export type Persistence = {
  load(): Promise<Persisted>;
  write(write: Write): Promise<void>;
  reset(expected: string | null, meta: Omit<Meta, "generation" | "adopted">): Promise<string | null>;
  adopt(from: Persisted): Promise<void>;
};

export type Disk = {
  open(side: Side): Persistence;
  legacy(): Promise<Persistence | null>;
};

export type Hint = { get(): Side | null; set(side: Side): void };

export const assemble = (results: readonly unknown[]): Persisted => {
  const [outbox, rev, me, epoch, generation, adopted] = results.slice(tableNames.length);
  return {
    rows: Object.fromEntries(tableNames.map((table, index) => [table, results[index]])),
    outbox,
    meta: { rev: rev ?? 0, me: me ?? null, epoch: epoch ?? null, generation: generation ?? null, adopted: adopted ?? null },
  } as Persisted;
};
