import type { ItemRow } from "../../shared/tables.ts";
import { toIsbn13 } from "./isbn.ts";
import { copiesByBook } from "./shelf.ts";

export const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const texts = (row: ItemRow) => [row.title, row.data?.original_title, row.data?.author, row.data?.series, row.data?.isbn];

export const searchBooks = (query: string, rows: readonly ItemRow[]): ItemRow[] => {
  const words = fold(toIsbn13(query) ?? query).split(" ").filter(Boolean);
  const places = new Map(rows.filter((row) => row.kind === "place").map((place) => [place.id, place.title]));
  const copies = copiesByBook(rows);
  return rows
    .filter((row) => row.kind === "book")
    .filter((book) => {
      const kept = (copies.get(book.id) ?? []).filter((copy) => copy.status !== "gone");
      const haystack = fold(
        [...texts(book), ...kept.flatMap((copy) => [...texts(copy), places.get(copy.group_key ?? "")])]
          .filter((text): text is string => typeof text === "string")
          .join(" "),
      ).split(" ");
      return words.every((word) => haystack.some((found) => (word.length > 1 ? found.startsWith(word) : found === word)));
    });
};
