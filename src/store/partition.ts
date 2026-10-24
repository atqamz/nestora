import type { Side } from "../../shared/api.ts";
import { PROBE_TIMEOUT_MS } from "./api.ts";
import type { Api } from "./api.ts";
import type { Disk, Hint } from "./persistence.ts";
import { createStore, paused } from "./store.ts";
import type { Snapshot, Store } from "./store.ts";

const PROBE = Number.MAX_SAFE_INTEGER;

const HINT_KEY = "wp-side";

const BACKOFF_MS = [5_000, 15_000, 60_000];

type Down = "offline" | "expired";

type Open = { at: "open"; side: Side; down: Down | null; store: Store };

type Later = (run: () => Promise<unknown>, ms: number) => () => void;

const timer: Later = (run, ms) => {
  const handle = setTimeout(() => void run(), ms);
  return () => clearTimeout(handle);
};

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

export const createSession = ({ disk, hint, api, later = timer }: { disk: Disk; hint: Hint; api: (side?: Side) => Api; later?: Later }): Omit<Store, "release"> => {
  let state: State = { at: "none" };
  let settling: Promise<void> | null = null;
  let tries = 0;
  let first = true;
  let cancel = () => {};
  let bare: Snapshot = { ready: false, me: null, rows: { items: [], budget_entries: [], settings: [] }, pending: 0, rejected: [], link: "offline", storage: "ok", notice: null, paused: true };
  const listeners = new Set<() => void>();

  const emit = () => {
    for (const listener of listeners) listener();
  };

  const enter = async (side: Side, down: Down | null) => {
    if (down === null) {
      await adoptLegacy(disk, side);
      hint.set(side);
    }
    const sided = api(side);
    const entry: Open = {
      at: "open",
      side,
      down,
      store: createStore({
        persistence: disk.open(side),
        held: down !== null,
        api: { ...sided, pull: async (since) => (entry.down === null ? sided.pull(since) : { kind: entry.down }) },
      }),
    };
    entry.store.subscribe(emit);
    state = entry;
    emit();
    await entry.store.open();
  };

  const settle = async () => {
    const answer = await api().pull(PROBE, first ? PROBE_TIMEOUT_MS : undefined);
    first = false;
    if (answer.kind === "ok") {
      const { me } = answer.body;
      if (state.at !== "open" || state.side !== me) return enter(me, null);
      state.down = null;
      state.store.release();
      return state.store.sync();
    }
    const down = answer.kind === "expired" ? "expired" : "offline";
    if (state.at === "open") {
      if (state.down === null) return;
      state.down = down;
      return state.store.sync();
    }
    const side = hint.get();
    if (side !== null) return enter(side, down);
    bare = { ...bare, ready: true, link: down };
    emit();
  };

  const reprobe = () => {
    cancel();
    if (state.at === "open" && state.down === null) return;
    cancel = later(() => run().catch(() => undefined), BACKOFF_MS[Math.min(tries++, BACKOFF_MS.length - 1)]);
  };

  const run = () =>
    (settling ??= settle().finally(() => {
      settling = null;
      reprobe();
    }));

  const write = <K extends Write>(name: K) =>
    ((...args: never[]) => (state.at === "open" ? (state.store[name] as (...rest: never[]) => Promise<unknown>)(...args) : Promise.resolve(paused))) as Store[K];

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => (state.at === "open" ? state.store.getSnapshot() : bare),
    open: run,
    sync: () => (state.at === "open" && state.down === null ? state.store.sync() : run().catch(() => undefined)),
    create: write("create"),
    update: write("update"),
    remove: write("remove"),
    many: write("many"),
    setSetting: write("setSetting"),
    discard: write("discard"),
    dismissNotice: () => (state.at === "open" ? state.store.dismissNotice() : undefined),
  };
};
