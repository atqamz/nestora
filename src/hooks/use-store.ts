import { useSyncExternalStore } from "react";
import { LOGIN_URL } from "../store/api.ts";
import { feedOf, store } from "../store/browser.ts";
import type { TableName } from "../../shared/tables.ts";

export type { Pending } from "../store/persistence.ts";
export type { Written } from "../store/store.ts";

export const openStore = store.open;

export const feedFor = feedOf;

export const actions = {
  create: store.create,
  update: store.update,
  remove: store.remove,
  many: store.many,
  restore: store.restore,
  setSetting: store.setSetting,
  discard: store.discard,
  dismissNotice: store.dismissNotice,
  sync: store.sync,
  serverNow: store.serverNow,
  logIn: () => location.assign(LOGIN_URL),
  reload: () => location.reload(),
};

export const readItems = () => store.getSnapshot().rows.items;

export const useSnapshot = () => useSyncExternalStore(store.subscribe, store.getSnapshot);

export const useTable = <T extends TableName>(table: T) => useSnapshot().rows[table];
