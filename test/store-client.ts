import { createApi } from "../src/store/api.ts";
import { memoryPersistence } from "../src/store/memory.ts";
import { createStore } from "../src/store/store.ts";
import type { Side } from "../shared/api.ts";
import type { Written } from "../src/store/store.ts";
import type { Server } from "./store-server.ts";

export const client = (server: Server, side: Side, persistence = memoryPersistence()) => ({
  persistence,
  store: createStore({ persistence, api: createApi(server.as(side), side) }),
});

export const task = (title: string) => ({ kind: "task", title, status: "todo" });

export const titles = (rows: { title: string }[]) => rows.map((row) => row.title).sort();

export const idOf = (written: Written) => {
  if (!written.ok) throw new Error(written.errors.join("; "));
  return written.id;
};
