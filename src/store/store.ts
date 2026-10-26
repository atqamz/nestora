import { settingKeys } from "../domain/settings.ts";
import { toInstant } from "../../shared/api.ts";
import type { Side } from "../../shared/api.ts";
import { tableNames, tables } from "../../shared/tables.ts";
import type { Patch, Row, TableName } from "../../shared/tables.ts";
import { validateChange, validateMutation } from "../../shared/validate.ts";
import type { Api } from "./api.ts";
import { absorb, changedFields, live, newer, overlay, stable, takeBatch, toMaps, wire } from "./outbox.ts";
import type { Pending, Persistence, Rows, Write } from "./persistence.ts";

export type Link = "online" | "offline" | "expired" | "mismatch";

export type Snapshot = {
  ready: boolean;
  me: Side | null;
  rows: Rows;
  pending: number;
  rejected: Pending[];
  link: Link;
  storage: "ok" | "failed";
  notice: { discarded: number } | null;
  paused: boolean;
};

export type Written = { ok: true; id: string } | { ok: false; errors: string[]; storage?: true; paused?: true; step?: number };

export type Draft<T extends TableName> = Partial<
  Omit<Row<T>, "id" | "rev" | "updated_by" | "deleted_at" | "created_at" | "updated_at">
>;

type Dict = Record<string, unknown>;

export type Step =
  | { op: "create"; table: TableName; id: string; draft: Dict }
  | { op: "update"; table: TableName; id: string; change: Dict }
  | { op: "delete"; table: TableName; id: string };

const notFound: Written = { ok: false, errors: ["row: not found"] };

export const unsaved: Written = { ok: false, errors: [], storage: true };

export const paused: Written = { ok: false, errors: [], paused: true };

const nothing: Rows = { items: [], budget_entries: [], settings: [] };

class StorageFailure extends Error {}

export const createStore = ({ persistence, api, held = false }: { persistence: Persistence; api: Api; held?: boolean }) => {
  let base = toMaps({ items: [], budget_entries: [], settings: [] });
  let view = base;
  let outbox: Pending[] = [];
  let rev = 0;
  let epoch: string | null = null;
  let generation: string | null = null;
  let verified = false;
  let notice: Snapshot["notice"] = null;
  let me: Side | null = null;
  let link: Link = "online";
  let storage: Snapshot["storage"] = "ok";
  let loaded = false;
  let attempted = false;
  let photoChecked = false;
  let nextSeq = 1;
  let sending: ReadonlySet<number> = new Set();
  let running: Promise<void> | null = null;
  let again = false;
  let snapshot: Snapshot = { ready: false, me, rows: live(base), pending: 0, rejected: [], link, storage, notice, paused: held };
  const listeners = new Set<() => void>();

  const emit = () => {
    const sendable = outbox.filter((entry) => !entry.rejected);
    view = overlay(base, sendable, me);
    snapshot = {
      ready: loaded && (me !== null || attempted),
      me,
      rows: link === "mismatch" ? nothing : stable(snapshot.rows, live(view)),
      pending: sendable.length,
      rejected: link === "mismatch" ? [] : outbox.filter((entry) => entry.rejected),
      link,
      storage,
      notice,
      paused: held,
    };
    for (const listener of listeners) listener();
  };

  const failed = (kind: Exclude<Link, "online">) => {
    if (link === kind) return;
    link = kind;
    emit();
  };

  const persisting = async <T>(run: () => Promise<T>): Promise<T> => {
    let result: T;
    try {
      result = await run();
    } catch {
      storage = "failed";
      emit();
      throw new StorageFailure();
    }
    if (storage === "failed") {
      storage = "ok";
      emit();
    }
    return result;
  };

  const persist = (write: Write) => persisting(() => persistence.write(write));

  const holdsServerData = () => rev > 0 || tableNames.some((table) => base[table].size > 0);

  const reconcile = async (served: { epoch: string; rev: number; me?: Side }, landed = 0): Promise<"same" | "reset"> => {
    const differs = epoch === null ? holdsServerData() : epoch !== served.epoch;
    if (!differs && served.rev >= rev) {
      if (epoch === null) {
        await persist({ meta: { epoch: served.epoch } });
        epoch = served.epoch;
      }
      return "same";
    }
    const discarded = outbox.length - landed;
    const lost = holdsServerData() || discarded > 0;
    const next = served.me ?? me;
    const renewed = await persisting(() => persistence.reset(generation, { epoch: served.epoch, rev: 0, me: next }));
    if (renewed !== null) {
      generation = renewed;
      base = toMaps({ items: [], budget_entries: [], settings: [] });
      outbox = [];
      rev = 0;
      me = next;
      epoch = served.epoch;
      notice = lost ? { discarded } : null;
    } else {
      const saved = await persisting(() => persistence.load());
      const gone = outbox.filter((entry) => !saved.outbox.some((kept) => kept.seq === entry.seq)).length - landed;
      base = toMaps(saved.rows);
      outbox = saved.outbox.sort((a, b) => a.seq - b.seq);
      nextSeq = Math.max(nextSeq, outbox.reduce((top, entry) => Math.max(top, entry.seq), 0) + 1);
      rev = saved.meta.rev;
      me = saved.meta.me ?? me;
      epoch = saved.meta.epoch;
      generation = saved.meta.generation;
      notice = lost ? { discarded: Math.max(gone, 0) } : null;
    }
    emit();
    return "reset";
  };

  const publishPhoto = async () => {
    const side = me;
    if (side === null || link !== "online") return;
    const photo = await api.me();
    if (photo === null || me !== side || link !== "online") return;
    const key = side === "a" ? settingKeys.photoA : settingKeys.photoB;
    if (view.settings.get(key)?.value !== photo) await setSetting(key, photo);
  };

  const catchUp = async (): Promise<boolean> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await api.pull(rev);
      if (res.kind !== "ok") {
        failed(res.kind);
        return false;
      }
      if ((await reconcile(res.body)) === "reset") continue;
      const rows = newer(base, res.body.changes);
      const next = Math.max(rev, res.body.rev);
      const unchanged = tableNames.every((table) => (rows[table] ?? []).length === 0) && me === res.body.me;
      if (!unchanged || next !== rev || storage === "failed") await persist({ rows, meta: { rev: next, me: res.body.me } });
      absorb(base, rows);
      rev = next;
      me = res.body.me;
      verified = true;
      const quiet = unchanged && link === "online";
      link = "online";
      if (!quiet) emit();
      if (!photoChecked) {
        photoChecked = true;
        void publishPhoto().catch(() => undefined);
      }
      return true;
    }
    failed("offline");
    return false;
  };

  const cycle = async () => {
    if (link === "mismatch") return;
    if (!verified && outbox.some((entry) => !entry.rejected) && !(await catchUp())) return;
    for (;;) {
      const queue = outbox.filter((entry) => !entry.rejected);
      if (queue.length === 0) break;
      const batch = takeBatch(queue);
      sending = new Set(batch.map((entry) => entry.seq));
      try {
        const res = await api.push(batch.map(wire));
        if (res.kind === "ok") {
          if ((await reconcile(res.body, batch.length)) === "reset") continue;
          const rows = newer(base, res.body.rows);
          await persist({ rows, outbox: { drop: batch.map((entry) => entry.seq) } });
          absorb(base, rows);
          outbox = outbox.filter((entry) => !sending.has(entry.seq));
          link = "online";
          emit();
        } else if (res.kind === "rejected") {
          const { index } = res.rejection;
          const named = typeof index === "number" && Number.isInteger(index) && index >= 0 && index < batch.length;
          const parked = (named ? [batch[index]] : batch).map((entry) => ({ ...entry, rejected: res.rejection.errors.map(String) }));
          await persist({ outbox: { put: parked } });
          outbox = outbox.map((entry) => parked.find((candidate) => candidate.seq === entry.seq) ?? entry);
          link = "online";
          emit();
        } else {
          return failed(res.kind);
        }
      } finally {
        sending = new Set();
      }
    }
    await catchUp();
  };

  const sync = (): Promise<void> => {
    if (!loaded) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await cycle().catch((error) => (error instanceof StorageFailure ? undefined : failed("offline")));
        } while (again);
      } finally {
        running = null;
      }
    })();
    return running;
  };

  const open = async () => {
    const saved = await persistence.load();
    base = toMaps(saved.rows);
    outbox = saved.outbox.sort((a, b) => a.seq - b.seq);
    nextSeq = outbox.reduce((top, entry) => Math.max(top, entry.seq), 0) + 1;
    rev = saved.meta.rev;
    me = saved.meta.me;
    epoch = saved.meta.epoch;
    generation = saved.meta.generation;
    loaded = true;
    emit();
    await sync().finally(() => {
      attempted = true;
      emit();
    });
  };

  const fold = async (earlier: Pending, mutation: Omit<Pending, "seq">): Promise<Written> => {
    const merged: Pending = { ...earlier, patch: { ...earlier.patch, ...mutation.patch }, at: mutation.at };
    const errors = validateMutation(wire(merged));
    if (errors.length > 0) return { ok: false, errors };
    outbox = outbox.map((entry) => (entry === earlier ? merged : entry));
    emit();
    try {
      await persist({ outbox: { put: [merged] } });
    } catch {
      outbox = outbox.map((entry) => (entry === merged ? earlier : entry));
      emit();
      return unsaved;
    }
    if (link !== "expired") void sync();
    return { ok: true, id: mutation.row_id };
  };

  const append = async (mutations: readonly Omit<Pending, "seq">[]): Promise<Written> => {
    let seq = Math.max(nextSeq, Date.now() * 1000 + Math.floor(Math.random() * 1000));
    const entries = mutations.map((mutation) => ({ ...mutation, seq: seq++ }));
    nextSeq = seq;
    outbox = [...outbox, ...entries];
    emit();
    try {
      await persist({ outbox: { put: entries } });
    } catch {
      outbox = outbox.filter((queued) => !entries.includes(queued));
      emit();
      return unsaved;
    }
    if (link !== "expired") void sync();
    return { ok: true, id: mutations[0]?.row_id ?? "" };
  };

  const enqueue = async (mutation: Omit<Pending, "seq">): Promise<Written> => {
    const errors = validateMutation(wire(mutation));
    if (errors.length > 0) return { ok: false, errors };
    const earlier =
      mutation.table === "settings" && mutation.op === "update"
        ? outbox.findLast((entry) => entry.table === "settings" && entry.row_id === mutation.row_id && entry.op !== "delete" && !entry.rejected && !sending.has(entry.seq))
        : undefined;
    if (earlier) return fold(earlier, mutation);
    return append([mutation]);
  };

  type Prepared = Omit<Pending, "seq"> | Written;

  const isMutation = (prepared: Prepared): prepared is Omit<Pending, "seq"> => "op" in prepared;

  const settle = (prepared: Prepared) => (isMutation(prepared) ? enqueue(prepared) : Promise.resolve(prepared));

  const preparedCreate = (table: TableName, draft: Dict, rowId: string): Omit<Pending, "seq"> => {
    const at = toInstant(new Date());
    const fields = Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== undefined));
    const patch = { ...fields, [tables[table].key]: rowId, created_at: at, updated_at: at };
    return { id: crypto.randomUUID(), table, op: "create", row_id: rowId, patch, at };
  };

  const preparedUpdate = (table: TableName, rowId: string, change: Dict): Prepared => {
    const row = view[table].get(rowId);
    if (!row) return notFound;
    const at = toInstant(new Date());
    const fields = changedFields(row, change);
    if (Object.keys(fields).length === 0) return { ok: true, id: rowId };
    const patch = { ...fields, updated_at: at };
    const errors = validateChange(table, row, patch);
    if (errors.length > 0) return { ok: false, errors };
    return { id: crypto.randomUUID(), table, op: "update", row_id: rowId, patch, at };
  };

  const preparedRemove = (table: TableName, rowId: string): Prepared => {
    const row = view[table].get(rowId);
    if (!row) return notFound;
    if (row.deleted_at !== null) return { ok: true, id: rowId };
    return { id: crypto.randomUUID(), table, op: "delete", row_id: rowId, patch: {}, at: toInstant(new Date()) };
  };

  const refused = () => held || !loaded || link === "mismatch";

  const create = async <T extends TableName>(table: T, draft: Draft<T>): Promise<Written> =>
    refused() ? paused : enqueue(preparedCreate(table, draft, table === "settings" ? String((draft as Dict).key) : crypto.randomUUID()));

  const update = async <T extends TableName>(table: T, rowId: string, change: Patch<T>): Promise<Written> =>
    refused() ? paused : settle(preparedUpdate(table, rowId, change as Dict));

  const remove = async (table: TableName, rowId: string): Promise<Written> => (refused() ? paused : settle(preparedRemove(table, rowId)));

  const many = async (steps: readonly Step[]): Promise<Written> => {
    if (refused()) return paused;
    const prepared = steps.map((step) =>
      step.op === "create" ? preparedCreate(step.table, step.draft, step.id) : step.op === "update" ? preparedUpdate(step.table, step.id, step.change) : preparedRemove(step.table, step.id),
    );
    const failed = prepared.findIndex((entry) => !isMutation(entry) && !entry.ok);
    if (failed >= 0) return { ...(prepared[failed] as Extract<Written, { ok: false }>), step: failed };
    for (const [step, entry] of prepared.entries()) {
      const errors = isMutation(entry) ? validateMutation(wire(entry)) : [];
      if (errors.length > 0) return { ok: false, errors, step };
    }
    const mutations = prepared.filter(isMutation);
    return mutations.length === 0 ? { ok: true, id: "" } : append(mutations);
  };

  const setSetting = (key: string, value: string) =>
    view.settings.has(key) ? update("settings", key, { value }) : create("settings", { key, value });

  const discard = async (seq: number): Promise<Written> => {
    if (refused()) return paused;
    try {
      await persist({ outbox: { drop: [seq] } });
    } catch {
      return unsaved;
    }
    outbox = outbox.filter((entry) => entry.seq !== seq);
    emit();
    return { ok: true, id: String(seq) };
  };

  const release = () => {
    held = false;
    emit();
  };

  const dismissNotice = () => {
    notice = null;
    emit();
  };

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    open,
    sync,
    create,
    update,
    remove,
    many,
    setSetting,
    discard,
    dismissNotice,
    release,
  };
};

export type Store = ReturnType<typeof createStore>;
