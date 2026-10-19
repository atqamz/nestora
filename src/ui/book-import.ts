import type { ItemRow } from "../../shared/tables.ts";
import { batchRows } from "../domain/import-plan.ts";
import type { Created } from "../domain/import-plan.ts";
import type { Store, Written } from "../store/store.ts";
import { failureOf } from "./failure.ts";
import { overlay } from "./overlay.ts";
import { text } from "./text.ts";

type Many = Store["many"];

export type Undone = { batch: string; ids: readonly string[]; books: readonly string[]; at: string };

let undone: readonly Undone[] = [];

const listeners = new Set<() => void>();

const keep = (next: readonly Undone[]) => {
  undone = next;
  for (const listener of listeners) listener();
};

const change = (batch: string, edit: (entry: Undone) => Undone) => keep(undone.map((entry) => (entry.batch === batch ? edit(entry) : entry)));

export const undoneImports = {
  subscribe: (listener: () => void) => (listeners.add(listener), () => void listeners.delete(listener)),
  get: () => undone,
};

export const createAll = async (steps: readonly Created[][], many: Many): Promise<Written> => {
  const created = steps.flat();
  const result = await many(created.map(({ id, draft }) => ({ op: "create" as const, table: "items" as const, id, draft })));
  if (result.ok || result.step === undefined) return result;
  const title = String(created[result.step]?.draft.title ?? "");
  return { ...result, errors: result.errors.map((error) => `${title}: ${error}`) };
};

const hideAll = (ids: readonly string[], many: Many) => many(ids.map((id) => ({ op: "delete" as const, table: "items" as const, id })));

const showAll = (ids: readonly string[], many: Many) => many(ids.map((id) => ({ op: "update" as const, table: "items" as const, id, change: { deleted_at: null } })));

export const restoreImport = async (batch: string, many: Many): Promise<Written> => {
  const entry = undone.find((known) => known.batch === batch);
  if (entry === undefined) return { ok: true, id: "" };
  const result = await showAll(entry.ids, many);
  if (result.ok) keep(undone.filter((known) => known.batch !== batch));
  return result;
};

export const undoImport = async (batch: string, read: () => readonly ItemRow[], many: Many): Promise<Written> => {
  const rows = batchRows(read(), batch);
  const books = rows.filter((row) => row.kind === "book");
  const result = await hideAll(rows.map((row) => row.id), many);
  if (!result.ok || rows.length === 0) return result;
  const at = books.map((book) => book.created_at).sort()[0] ?? "";
  keep([...undone.filter((entry) => entry.batch !== batch), { batch, ids: rows.map((row) => row.id), books: books.map((book) => book.id), at }]);
  overlay.announce(text.books.import.undone(books.length), {
    label: text.undo,
    run: () => void restoreImport(batch, many).then((back) => back.ok || overlay.announce(failureOf(back).join(" "))),
  });
  return result;
};

export const sweepUndone = (items: readonly ItemRow[], many: Many) => {
  for (const entry of undone) {
    const books = new Set(entry.books);
    const have = new Set(entry.ids);
    const loose = items.filter((item) => item.kind === "copy" && books.has(item.parent_id ?? "") && !have.has(item.id)).map((item) => item.id);
    if (loose.length === 0) continue;
    change(entry.batch, (known) => ({ ...known, ids: [...known.ids, ...loose] }));
    void hideAll(loose, many).then((result) => result.ok || change(entry.batch, (known) => ({ ...known, ids: known.ids.filter((id) => !loose.includes(id)) })));
  }
};

export const announceImport = (batch: string, books: number, read: () => readonly ItemRow[], many: Many) =>
  overlay.announce(text.books.import.done(books), {
    label: text.undo,
    run: () => void undoImport(batch, read, many).then((result) => result.ok || overlay.announce(failureOf(result).join(" "))),
  });
