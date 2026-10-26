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

export type Change = { id: string; change: Patch<"items"> };

export const backToWishlist = (book: ItemRow, copies: readonly ItemRow[], today: string): { moves: Change[]; undo: Change[] } => {
  const lost = copies.filter((copy) => copy.status !== "gone");
  return {
    moves: [{ id: book.id, change: { status: "wish" } }, ...lost.map((copy) => ({ id: copy.id, change: { status: "gone", done_on: today } }))],
    undo: [{ id: book.id, change: { status: "shelf", who: book.who } }, ...lost.map((copy) => ({ id: copy.id, change: { status: copy.status, done_on: copy.done_on } }))],
  };
};

export const wishSections = (rows: readonly ItemRow[]) => {
  const wishes = rows.filter((row) => row.kind === "book" && row.status === "wish").sort(bySort);
  return { next: wishes.filter((row) => row.data?.priority === "high"), someday: wishes.filter((row) => row.data?.priority !== "high") };
};
