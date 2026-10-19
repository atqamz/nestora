import type { BudgetEntryRow, ItemRow } from "../../shared/tables.ts";
import { compare } from "./order.ts";

export const LATELY_COUNT = 5;

const DAY_MS = 86_400_000;

const TOGETHER_MS = 60_000;

export type Activity = {
  id: string;
  by: "a" | "b";
  verb: "added" | "ticked" | "paid" | "changed" | "moved";
  title: string;
  to: string | null;
  at: string;
};

const apart = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b));

const moved = (row: ItemRow) => row.kind === "copy" && typeof row.data?.moved_on === "string" && apart(row.data.moved_on, row.updated_at) < 2 * DAY_MS;

const verbOf = (row: ItemRow | BudgetEntryRow): Activity["verb"] =>
  "kind" in row && row.kind === "task" && row.status === "done"
    ? "ticked"
    : "entry_type" in row && row.entry_type === "payment" && row.status === "paid"
      ? "paid"
      : "kind" in row && moved(row)
        ? "moved"
        : row.rev === 0 || row.created_at === row.updated_at
          ? "added"
          : "changed";

export const lately = (items: readonly ItemRow[], entries: readonly BudgetEntryRow[], limit = LATELY_COUNT): Activity[] => {
  const byId = new Map(items.map((row) => [row.id, row]));
  const together = (row: ItemRow) => {
    const book = byId.get(row.parent_id ?? "");
    return book !== undefined && [book.created_at, book.updated_at].some((at) => apart(at, row.created_at) < TOGETHER_MS);
  };
  return [...items, ...entries]
    .flatMap((row) => {
      if (row.updated_by !== "a" && row.updated_by !== "b") return [];
      if (row.data !== null && "import_batch" in row.data) return [];
      const verb = verbOf(row);
      if ("kind" in row && (row.kind === "place" || (row.kind === "copy" && verb !== "moved" && together(row)))) return [];
      const to = verb === "moved" ? (byId.get((row as ItemRow).group_key ?? "")?.title ?? null) : null;
      return [{ id: row.id, by: row.updated_by, verb, title: row.title, to, at: row.updated_at }];
    })
    .sort((a, b) => compare(b.at, a.at) || compare(a.id, b.id))
    .slice(0, limit);
};
