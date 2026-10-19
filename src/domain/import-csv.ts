import { LONGTEXT_MAX, NOTE_MAX, TEXT_MAX } from "../../shared/validate.ts";
import { fit, line, tidy } from "./import-text.ts";
import type { Candidate, Warning } from "./import-text.ts";
import { toIsbn13 } from "./isbn.ts";

export type Extra = { isbn: string; language: string; status: string; place: string; owner: string; note: string; genre: string };

export type Row = Candidate & Extra;

export type Problem = "empty" | "no_title";

export type Parsed = { rows: Row[]; skipped: number; problem: Problem | null };

const DELIMITERS = [",", ";", "\t"];

const HEADERS = {
  title: ["title"],
  author: ["author", "authors"],
  original_title: ["originaltitle"],
  isbn: ["isbn", "isbn13"],
  status: ["status"],
  place: ["place"],
  owner: ["owner", "who"],
  rated_elsewhere: ["rating", "ratedelsewhere", "publicrating"],
  note: ["note", "notes"],
  language: ["language"],
  blurb: ["blurb", "synopsis"],
  genre: ["genre", "groupkey"],
} as const;

const unBom = (input: string) => input.replace(/^\ufeff/, "");

const headerKey = (cell: string) => cell.toLowerCase().replace(/^\s*data[._\s]/, "").replace(/[^a-z0-9]/g, "");

export const delimiterOf = (input: string) => {
  const counts = new Map(DELIMITERS.map((delimiter) => [delimiter, 0]));
  let quoted = false;
  for (const char of unBom(input)) {
    if (char === '"') quoted = !quoted;
    else if (!quoted && (char === "\n" || char === "\r")) break;
    else if (!quoted && counts.has(char)) counts.set(char, counts.get(char)! + 1);
  }
  return [...counts].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
};

export const readCsv = (input: string, delimiter = delimiterOf(input)): string[][] => {
  const text = unBom(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let at = 0; at < text.length; at++) {
    const char = text[at];
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[at + 1] === '"') (field += '"', at++);
      else quoted = false;
    } else if (char === '"' && field === "") {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) rows.push([...row, field]);
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
};

export const looksLikeCsv = (input: string) => {
  const [head = []] = readCsv(input.slice(0, 4000));
  return head.some((cell) => (HEADERS.title as readonly string[]).includes(headerKey(cell)));
};

const unescape = (cell: string) => (/^'[=+\-@\t\r]/.test(cell) ? cell.slice(1) : cell);

const languageOf = (value: string) => {
  const word = value.trim().toLowerCase();
  return word === "" ? "" : ["id", "ind", "indonesian"].includes(word) ? "id" : ["en", "eng", "english"].includes(word) ? "en" : "other";
};

const statusOf = (value: string) => {
  const word = value.trim().toLowerCase();
  return ["wish", "wishlist"].includes(word) ? "wish" : ["shelf", "owned", "own"].includes(word) ? "shelf" : "";
};

export const parseBookCsv = (input: string, delimiter = delimiterOf(input)): Parsed => {
  const [header, ...records] = readCsv(input, delimiter);
  if (header === undefined) return { rows: [], skipped: 0, problem: "empty" };
  const keys = header.map(headerKey);
  const at = Object.fromEntries(
    (Object.keys(HEADERS) as (keyof typeof HEADERS)[]).map((field) => [field, keys.flatMap((key, index) => ((HEADERS[field] as readonly string[]).includes(key) ? [index] : []))]),
  ) as Record<keyof typeof HEADERS, number[]>;
  if (at.title.length === 0) return { rows: [], skipped: 0, problem: "no_title" };
  const rows: Row[] = [];
  let skipped = 0;
  for (const cells of records) {
    const get = (field: keyof typeof HEADERS) => at[field].map((index) => unescape(cells[index] ?? "")).find((cell) => cell.trim() !== "") ?? "";
    const warnings: Warning[] = [];
    const title = line(get("title"));
    if (title === "") {
      skipped++;
      continue;
    }
    const typed = line(get("isbn"));
    const isbn = typed === "" ? "" : (toIsbn13(typed) ?? "");
    if (typed !== "" && isbn === "") warnings.push("bad_isbn");
    const author = fit(line(get("author")), TEXT_MAX, warnings);
    if (author === "") warnings.push("missing_author");
    rows.push({
      title: fit(title, TEXT_MAX, warnings),
      original_title: fit(line(get("original_title")), TEXT_MAX, warnings),
      author,
      rated_elsewhere: fit(line(get("rated_elsewhere")), TEXT_MAX, warnings),
      blurb: fit(line(get("blurb")), LONGTEXT_MAX, warnings),
      isbn,
      language: languageOf(get("language")),
      status: statusOf(get("status")),
      place: line(get("place")),
      owner: line(get("owner")),
      note: fit(tidy(get("note")), NOTE_MAX, warnings),
      genre: fit(line(get("genre")), TEXT_MAX, warnings),
      warnings: [...new Set(warnings)],
    });
  }
  return { rows, skipped, problem: null };
};
