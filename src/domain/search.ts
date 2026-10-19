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

const MIN_PREFIX = 4;

export const searchBooks = (query: string, rows: readonly ItemRow[]): ItemRow[] => {
  const typed = query.replace(/^\s*isbn(?=[\s:.-]*\d)[\s:.-]*/i, "");
  const full = toIsbn13(typed);
  const digits = typed.replace(/[\s-]/g, "");
  const prefix = full ?? (/^[\d\s-]+$/.test(typed) && digits.length >= MIN_PREFIX ? digits : null);
  const words = fold(full ?? typed).split(" ").filter(Boolean);
  const places = new Map(rows.filter((row) => row.kind === "place").map((place) => [place.id, place.title]));
  const copies = copiesByBook(rows);
  return rows
    .filter((row) => row.kind === "book")
    .filter((book) => {
      const kept = (copies.get(book.id) ?? []).filter((copy) => copy.status !== "gone");
      const strings = [...texts(book), ...kept.flatMap((copy) => [...texts(copy), places.get(copy.group_key ?? "")])].filter(
        (text): text is string => typeof text === "string",
      );
      const haystack = fold(strings.join(" ")).split(" ");
      if (prefix !== null && [book, ...kept].some((row) => typeof row.data?.isbn === "string" && row.data.isbn.startsWith(prefix))) return true;
      return words.every((word) => haystack.some((found) => (word.length > 1 ? found.startsWith(word) : found === word)));
    });
};
