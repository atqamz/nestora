import type { ItemRow } from "../../shared/tables.ts";
import { bySort } from "./order.ts";

export type Where = { kind: "place"; place: ItemRow } | { kind: "ebook" } | { kind: "unplaced" } | { kind: "lent" } | { kind: "away" };

export type ShelfSection = { where: Where; books: ItemRow[] };

export const copiesByBook = (rows: readonly ItemRow[]) => {
  const copies = new Map<string, ItemRow[]>();
  for (const row of rows) if (row.kind === "copy" && row.parent_id !== null) copies.set(row.parent_id, [...(copies.get(row.parent_id) ?? []), row]);
  return copies;
};

const ORDER = ["ebook", "unplaced", "lent", "away"] as const;

export const whereOf = (copy: ItemRow, places: ReadonlyMap<string, ItemRow>): Where | null => {
  if (copy.status === "gone") return null;
  if (copy.status === "lent") return { kind: "lent" };
  if (copy.data?.format === "ebook") return { kind: "ebook" };
  const place = places.get(copy.group_key ?? "");
  return place ? { kind: "place", place } : { kind: "unplaced" };
};

export const shelfSections = (rows: readonly ItemRow[]): ShelfSection[] => {
  const places = new Map(rows.filter((row) => row.kind === "place").map((place) => [place.id, place]));
  const copies = copiesByBook(rows);
  const sections = new Map<string, ShelfSection>();
  for (const book of rows.filter((row) => row.kind === "book" && row.status === "shelf").sort(bySort)) {
    const wheres = (copies.get(book.id) ?? []).flatMap((copy) => whereOf(copy, places) ?? []);
    for (const where of wheres.length > 0 ? wheres : [{ kind: "away" } as const]) {
      const key = where.kind === "place" ? where.place.id : where.kind;
      const section: ShelfSection = sections.get(key) ?? { where, books: [] };
      if (!section.books.includes(book)) section.books.push(book);
      sections.set(key, section);
    }
  }
  const rank = (where: Where) => (where.kind === "place" ? -1 : ORDER.indexOf(where.kind));
  return [...sections.values()].sort(
    (a, b) =>
      rank(a.where) - rank(b.where) ||
      (a.where.kind === "place" && b.where.kind === "place" ? bySort(a.where.place, b.where.place) : 0),
  );
};
