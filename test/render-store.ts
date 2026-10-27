const snapshot = { ready: true, me: "a", rows: { items: [], budget_entries: [], settings: [] }, pending: 0, rejected: [], link: "online", storage: "ok", notice: null, paused: false, dated: true };

export const stage = (items: unknown[], settings: unknown[] = [], budget_entries: unknown[] = []) => {
  snapshot.rows = { items, budget_entries, settings } as never;
};

export const useSnapshot = () => snapshot;

export const useTable = (table: keyof typeof snapshot.rows) => snapshot.rows[table];

export const actions = { serverNow: () => null };

export const timers = {};

export const readItems = () => snapshot.rows.items;

export const openStore = () => Promise.resolve();

export const feedFor = () => undefined;
