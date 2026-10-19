import type { ItemRow } from "../../shared/tables.ts";
import { toIsbn13, withoutLabel } from "./isbn.ts";
import { copiesByBook } from "./shelf.ts";

const LETTERS: Record<string, string> = { ł: "l", đ: "d", ß: "ss" };

export const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[łđß]/g, (letter) => LETTERS[letter])
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const texts = (row: ItemRow) => [row.title, row.data?.original_title, row.data?.author, row.data?.series, row.data?.isbn];

const MIN_PREFIX = 4;

export const searchBooks = (query: string, rows: readonly ItemRow[]): ItemRow[] => {
  const typed = withoutLabel(query);
  const full = toIsbn13(typed);
  const digits = typed.replace(/[\s\p{Pd}]/gu, "");
  const prefix = full ?? (/^[\d\s\p{Pd}]+$/u.test(typed) && digits.length >= MIN_PREFIX ? digits : null);
  const words = fold(full ?? typed).split(" ").filter(Boolean);
  const typing = !/\s$/.test(typed);
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
      return words.every((word, at) => haystack.some((found) => (word.length > 1 || (typing && at === words.length - 1) ? found.startsWith(word) : found === word)));
    });
};
