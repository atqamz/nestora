import type { ItemRow } from "../../shared/tables.ts";
import { looksLikeCsv, parseBookCsv } from "./import-csv.ts";
import type { Extra, Problem, Row } from "./import-csv.ts";
import { parseList } from "./import-text.ts";
import type { Warning } from "./import-text.ts";
import { bySort, compare, sortAfter } from "./order.ts";
import { fold } from "./search.ts";

export const IMPORT_LIMIT = 500;

export type Format = "list" | "csv";

export type Read = { rows: Row[]; skipped: number; over: number; problem: Problem | null };

export type Entry = { key: number; row: Row; warnings: Warning[]; checked: boolean };

export type Owner = "a" | "b" | "both";

export type Choices = { kind: "shelf" | "wish"; owner: Owner; placeId: string | null };

export type Created = { id: string; draft: Record<string, unknown> };

export type Batch = { id: string; books: ItemRow[]; at: string };

const NO_EXTRA: Extra = { isbn: "", language: "", status: "", place: "", owner: "", note: "", genre: "" };

export const detectFormat = (input: string): Format => (looksLikeCsv(input) ? "csv" : "list");

export const readInput = (input: string, format: Format): Read => {
  const parsed = format === "csv" ? parseBookCsv(input) : { rows: parseList(input).map((candidate) => ({ ...NO_EXTRA, ...candidate })), skipped: 0, problem: null };
  const rows = parsed.rows.slice(0, IMPORT_LIMIT);
  return { rows, skipped: parsed.skipped, over: parsed.rows.length - rows.length, problem: parsed.rows.length === 0 ? (parsed.problem ?? "empty") : null };
};

const titlesOf = (row: { title: string; original_title: string }) => [row.title, row.original_title].map(fold).filter((name) => name !== "");

export const previewOf = (rows: readonly Row[], items: readonly ItemRow[]): Entry[] => {
  const books = items.filter((item) => item.kind === "book");
  const known = new Set(books.flatMap((book) => titlesOf({ title: book.title, original_title: String(book.data?.original_title ?? "") })));
  const codes = new Set(items.flatMap((item) => ((item.kind === "book" || item.kind === "copy") && typeof item.data?.isbn === "string" ? [item.data.isbn] : [])));
  const places = new Set(items.filter((item) => item.kind === "place").map((place) => fold(place.title)));
  const seen = new Set<string>();
  return rows.map((row, key) => {
    const names = titlesOf(row);
    const warnings: Warning[] = [...row.warnings];
    const exists = names.some((name) => known.has(name)) || (row.isbn !== "" && codes.has(row.isbn));
    if (exists) warnings.push("exists");
    if (names.some((name) => seen.has(name))) warnings.push("twice");
    for (const name of names) seen.add(name);
    if (row.place !== "" && !places.has(fold(row.place))) warnings.push("place_unknown");
    return { key, row, warnings: [...new Set(warnings)], checked: !exists };
  });
};

const ownerOf = (typed: string, labels: { a: string; b: string }): Owner | "" => {
  const word = fold(typed);
  return word === "" ? "" : word === "a" || word === fold(labels.a) ? "a" : word === "b" || word === fold(labels.b) ? "b" : word === "both" || word === "shared" ? "both" : "";
};

export const stepsOf = (
  entries: readonly Entry[],
  choices: Choices,
  { items, labels, batch, id }: { items: readonly ItemRow[]; labels: { a: string; b: string }; batch: string; id: () => string },
): Created[][] => {
  const places = new Map(items.filter((item) => item.kind === "place").map((place) => [fold(place.title), place.id]));
  const next = {
    shelf: sortAfter(items.filter((item) => item.kind === "book" && item.status === "shelf")),
    wish: sortAfter(items.filter((item) => item.kind === "book" && item.status === "wish")),
  };
  return entries.map(({ row }) => {
    const kind = row.status === "shelf" || row.status === "wish" ? row.status : choices.kind;
    const owner = ownerOf(row.owner, labels) || choices.owner;
    const placeId = places.get(fold(row.place)) ?? choices.placeId;
    const edition = Object.fromEntries(Object.entries({ isbn: row.isbn, language: row.language }).filter(([, value]) => value !== ""));
    const details = Object.fromEntries(
      Object.entries({ author: row.author, original_title: row.original_title, blurb: row.blurb, rated_elsewhere: row.rated_elsewhere, ...edition }).filter(([, value]) => value !== ""),
    );
    const bookId = id();
    const book: Created = {
      id: bookId,
      draft: {
        kind: "book",
        title: row.title,
        status: kind,
        who: kind === "wish" ? owner : null,
        ...(row.genre === "" ? {} : { group_key: row.genre }),
        ...(row.note === "" ? {} : { note: row.note }),
        sort: next[kind]++,
        data: { ...details, import_batch: batch },
      },
    };
    if (kind === "wish") return [book];
    const copy: Created = {
      id: id(),
      draft: {
        kind: "copy",
        parent_id: bookId,
        title: row.title,
        status: "here",
        who: owner,
        ...(placeId === null ? {} : { group_key: placeId }),
        data: { format: "print", ...edition, import_batch: batch },
      },
    };
    return [book, copy];
  });
};

export const batchesOf = (items: readonly ItemRow[]): Batch[] => {
  const batches = new Map<string, Batch>();
  for (const book of items) {
    const id = book.kind === "book" ? book.data?.import_batch : undefined;
    if (typeof id !== "string") continue;
    const batch = batches.get(id) ?? { id, books: [], at: book.created_at };
    batch.books.push(book);
    if (book.created_at < batch.at) batch.at = book.created_at;
    batches.set(id, batch);
  }
  return [...batches.values()]
    .map((batch) => ({ ...batch, books: batch.books.sort(bySort) }))
    .sort((a, b) => compare(b.at, a.at));
};

export const batchRows = (items: readonly ItemRow[], batch: string): ItemRow[] =>
  items.filter((item) => (item.kind === "book" || item.kind === "copy") && item.data?.import_batch === batch);
