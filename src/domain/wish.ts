import type { ItemRow, Patch } from "../../shared/tables.ts";
import { bySort } from "./order.ts";

export const weGotIt = (book: ItemRow, placeId: string | null): { book: Patch<"items">; copy: Partial<ItemRow> } => {
  const data = Object.fromEntries(
    (["isbn", "language"] as const).flatMap((key) => (typeof book.data?.[key] === "string" ? [[key, book.data[key]]] : [])),
  );
  return {
    book: { status: "shelf", who: null },
    copy: { kind: "copy", parent_id: book.id, title: book.title, status: "here", group_key: placeId, who: "both", data: { format: "print", ...data } },
  };
};

export const wishSections = (rows: readonly ItemRow[]) => {
  const wishes = rows.filter((row) => row.kind === "book" && row.status === "wish").sort(bySort);
  return { next: wishes.filter((row) => row.data?.priority === "high"), someday: wishes.filter((row) => row.data?.priority !== "high") };
};
