import { COLLECTION_MAX, ORDER_MAX } from "../../shared/tables.ts";
import type { ItemRow, Patch } from "../../shared/tables.ts";
import { bySort, compare, reorder, sortAfter } from "./order.ts";
import type { Sortable } from "./order.ts";
import { fold } from "./search.ts";

const MISSING = 2 * ORDER_MAX;

export type Collection = { key: string; name: string; rows: ItemRow[]; next: string | null };

export type Naming = { ok: true; value: string | null } | { ok: false };

export const collectionName = (row: ItemRow): string | null => {
  const name = row.data?.collection;
  return typeof name === "string" && fold(name) !== "" ? name.trim() : null;
};

export const parseCollection = (raw: string): Naming => {
  const typed = raw.trim();
  if (typed === "") return { ok: true, value: null };
  return fold(typed) === "" || typed.length > COLLECTION_MAX ? { ok: false } : { ok: true, value: typed };
};

const orderOf = (row: ItemRow) => {
  const order = row.data?.order;
  return typeof order === "number" && Math.abs(order) <= ORDER_MAX ? order : MISSING;
};

const placed = (row: ItemRow): Sortable => ({ id: row.id, sort: orderOf(row), created_at: row.created_at });

const byOrder = (a: ItemRow, b: ItemRow) => bySort(placed(a), placed(b));

const oldest = (a: ItemRow, b: ItemRow) => compare(a.created_at, b.created_at) || compare(a.id, b.id);

export const collections = (rows: readonly ItemRow[], kind: string): Collection[] => {
  const groups = new Map<string, ItemRow[]>();
  for (const row of rows) {
    const name = row.kind === kind ? collectionName(row) : null;
    if (name !== null) groups.set(fold(name), [...(groups.get(fold(name)) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([key, members]) => ({
      key,
      name: collectionName([...members].sort(oldest)[0])!,
      rows: members.sort(byOrder),
      next: members.find((row) => row.status !== "watched")?.id ?? null,
    }))
    .sort((a, b) => Number(a.next === null) - Number(b.next === null) || compare(a.key, b.key));
};

export const collectionNames = (rows: readonly ItemRow[], kind: string) => collections(rows, kind).map(({ name }) => name);

const membersOf = (rows: readonly ItemRow[], kind: string, name: string) => collections(rows, kind).find(({ key }) => key === fold(name))?.rows ?? [];

export const joinPatch = (rows: readonly ItemRow[], kind: string, name: string): Patch<"items"> => {
  const members = membersOf(rows, kind, name);
  const known = members.length > 0 ? collectionName(members[0]) : null;
  return { data: { collection: known ?? name, order: sortAfter(members.map(placed).filter((member) => member.sort !== MISSING)) } };
};

export const leavePatch: Patch<"items"> = { data: { collection: null, order: null } };

const nameOf = (row: ItemRow) => (typeof row.data?.collection === "string" ? row.data.collection : null);

const keyOf = (row: ItemRow) => (typeof row.data?.order === "number" ? row.data.order : null);

export const restoreName = (row: ItemRow): Patch<"items"> => ({ data: { collection: nameOf(row) } });

export const restoreOrder = (row: ItemRow): Patch<"items"> => ({ data: { order: keyOf(row) } });

export const restoreCollection = (row: ItemRow): Patch<"items"> => ({ data: { collection: nameOf(row), order: keyOf(row) } });

export const moveOrders = (members: readonly ItemRow[], id: string, step: -1 | 1): { id: string; order: number }[] => {
  const list = [...members].sort(byOrder);
  const from = list.findIndex((row) => row.id === id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= list.length) return [];
  const rest = list.filter((row) => row.id !== id);
  const low = to > 0 ? orderOf(rest[to - 1]) : null;
  const high = to < rest.length ? orderOf(rest[to]) : null;
  const key = low === null ? (high ?? 0) - 1 : high === null ? low + 1 : (low + high) / 2;
  if (key > (low ?? -Infinity) && key < (high ?? Infinity) && Math.abs(key) <= ORDER_MAX) return [{ id, order: key }];
  return reorder(list.map(placed), id, step).map(({ id: moved, sort }) => ({ id: moved, order: sort }));
};

export const renameTargets = (rows: readonly ItemRow[], kind: string, from: string, to: string) =>
  membersOf(rows, kind, from).filter((row) => collectionName(row) !== to);

export const nameTaken = (rows: readonly ItemRow[], kind: string, own: string, name: string) =>
  fold(own) !== fold(name) && membersOf(rows, kind, name).length > 0;
