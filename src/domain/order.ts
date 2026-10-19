export type Sortable = { id: string; sort: number; created_at: string };

export const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export const bySort = (a: Sortable, b: Sortable) =>
  a.sort - b.sort || compare(a.created_at, b.created_at) || compare(a.id, b.id);

export const sortBefore = (rows: readonly Sortable[]) => rows.reduce((low, row) => Math.min(low, row.sort), 1) - 1;

export const sortAfter = (rows: readonly Sortable[]) => rows.reduce((high, row) => Math.max(high, row.sort), -1) + 1;

export const reorder = (rows: readonly Sortable[], id: string, step: -1 | 1): { id: string; sort: number }[] => {
  const list = [...rows].sort(bySort);
  const from = list.findIndex((row) => row.id === id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= list.length) return [];
  list.splice(to, 0, ...list.splice(from, 1));
  return list.flatMap((row, index) => (row.sort === index ? [] : [{ id: row.id, sort: index }]));
};
