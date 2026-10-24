import type { Side } from "../../shared/api.ts";
import type { Api } from "./api.ts";
import type { Disk, Hint } from "./persistence.ts";
import { createStore, unsaved } from "./store.ts";
import type { Snapshot, Store } from "./store.ts";

const PROBE = Number.MAX_SAFE_INTEGER;

const HINT_KEY = "wp-side";

type Open = { at: "open"; side: Side; confirmed: boolean; store: Store };

type State = { at: "none" } | Open;

type Write = "create" | "update" | "remove" | "many" | "setSetting" | "discard";

export const sideHint = (storage: Pick<Storage, "getItem" | "setItem">): Hint => ({
  get: () => {
    try {
      const side = storage.getItem(HINT_KEY);
      return side === "a" || side === "b" ? side : null;
    } catch {
      return null;
    }
  },
  set: (side) => {
    try {
      storage.setItem(HINT_KEY, side);
    } catch {
      return;
    }
  },
});

const adoptLegacy = async (disk: Disk, side: Side) => {
  const old = await disk.legacy();
  if (old === null) return;
  const saved = await old.load();
  if (saved.meta.adopted !== null || (saved.meta.me !== null && saved.meta.me !== side)) return;
  await disk.open(side).adopt(saved);
  await old.write({ meta: { adopted: side } });
};

export const createSession = ({ disk, hint, api }: { disk: Disk; hint: Hint; api: (side?: Side) => Api }): Store => {
  let state: State = { at: "none" };
  let settling: Promise<void> | null = null;
  let bare: Snapshot = { ready: false, me: null, rows: { items: [], budget_entries: [], settings: [] }, pending: 0, rejected: [], link: "offline", storage: "ok", notice: null };
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const enter = async (side: Side, confirmed: boolean) => {
    if (confirmed) {
      await adoptLegacy(disk, side);
      hint.set(side);
    }
    const sided = api(side);
    const entry: Open = {
      at: "open",
      side,
      confirmed,
      store: createStore({
        persistence: disk.open(side),
        api: { ...sided, pull: async (since) => (entry.confirmed ? sided.pull(since) : { kind: "offline" }) },
      }),
    };
    entry.store.subscribe(emit);
    state = entry;
    emit();
    await entry.store.open();
  };

  const settle = async () => {
    const answer = await api().pull(PROBE);
    if (answer.kind === "ok") {
      const { me } = answer.body;
      if (state.at !== "open" || state.side !== me) return enter(me, true);
      state.confirmed = true;
      return state.store.sync();
    }
    if (state.at === "open") return;
    const side = hint.get();
    if (side !== null) return enter(side, false);
    bare = { ...bare, ready: true, link: answer.kind === "expired" ? "expired" : "offline" };
    emit();
  };

  const run = () => (settling ??= settle().finally(() => (settling = null)));

  const write = <K extends Write>(name: K) =>
    ((...args: never[]) => (state.at === "open" ? (state.store[name] as (...rest: never[]) => Promise<unknown>)(...args) : Promise.resolve(unsaved))) as Store[K];

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => (state.at === "open" ? state.store.getSnapshot() : bare),
    open: run,
    sync: () => (state.at === "open" && state.confirmed ? state.store.sync() : run().catch(() => undefined)),
    create: write("create"),
    update: write("update"),
    remove: write("remove"),
    many: write("many"),
    setSetting: write("setSetting"),
    discard: write("discard"),
    dismissNotice: () => (state.at === "open" ? state.store.dismissNotice() : undefined),
  };
};
