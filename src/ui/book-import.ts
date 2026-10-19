import type { Created } from "../domain/import-plan.ts";
import type { Store, Written } from "../store/store.ts";
import { failureOf } from "./failure.ts";
import { overlay } from "./overlay.ts";
import { text } from "./text.ts";

type Many = Store["many"];

export const createAll = (steps: readonly Created[][], many: Many): Promise<Written> =>
  many(steps.flat().map(({ id, draft }) => ({ op: "create" as const, table: "items" as const, id, draft })));

const hideAll = (ids: readonly string[], many: Many) => many(ids.map((id) => ({ op: "delete" as const, table: "items" as const, id })));

const showAll = (ids: readonly string[], many: Many) => many(ids.map((id) => ({ op: "update" as const, table: "items" as const, id, change: { deleted_at: null } })));

export const undoImport = async (ids: readonly string[], books: number, many: Many): Promise<Written> => {
  const result = await hideAll(ids, many);
  if (!result.ok) return result;
  const restore = () => void showAll(ids, many).then((back) => back.ok || overlay.announce(failureOf(back).join(" ")));
  overlay.announce(text.books.import.undone(books), { label: text.undo, run: restore });
  return result;
};

export const announceImport = (ids: readonly string[], books: number, many: Many) =>
  overlay.announce(text.books.import.done(books), {
    label: text.undo,
    run: () => void undoImport(ids, books, many).then((result) => result.ok || overlay.announce(failureOf(result).join(" "))),
  });
