import { fold } from "./search.ts";
import { toIsbn13 } from "./isbn.ts";

export type Language = "id" | "en" | "other";

export type Hit = {
  work: string;
  title: string;
  author: string;
  year: number | null;
  coverId: number | null;
  isbn: string | null;
  language: Language | null;
};

const SITE = "https://openlibrary.org";

const SEARCH_FIELDS = "key,title,author_name,first_publish_year,cover_i,editions,editions.title,editions.language,editions.cover_i,editions.isbn";

const LIMIT = 5;

const AUTHORS_MAX = 3;

const BLURB_MAX = 500;

const WORK = /^OL\d{1,12}W$/;

const LANGUAGES: Record<string, Language> = { ind: "id", eng: "en" };

const dict = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {});

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);

const count = (value: unknown) => (typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null);

export const searchUrl = (query: string) => `${SITE}/search.json?${new URLSearchParams({ q: query, limit: String(LIMIT), fields: SEARCH_FIELDS })}`;

export const isbnUrl = (isbn: string) => `${SITE}/search.json?${new URLSearchParams({ isbn, limit: String(LIMIT), fields: SEARCH_FIELDS })}`;

export const workUrl = (work: string) => `${SITE}/works/${work}.json`;

export const workPage = (work: string) => (WORK.test(work) ? `${SITE}/works/${work}` : null);

export const coverUrl = (id: number) => `https://covers.openlibrary.org/b/id/${id}-M.jpg`;

export const queriesOf = ({ title, author, original }: { title: string; author: string; original: string }): string[] => [
  ...new Set([title, original].map((name) => [name, author].join(" ").trim().replace(/\s+/g, " ")).filter((query) => query !== author.trim().replace(/\s+/g, " "))),
];

const hitOf = (doc: unknown): Hit | null => {
  const { key, title, author_name: authors, first_publish_year: year, cover_i: cover, editions } = dict(doc);
  const work = typeof key === "string" ? key.replace(/^\/works\//, "") : "";
  if (!WORK.test(work) || typeof title !== "string" || title.trim() === "") return null;
  const [edition] = Array.isArray(dict(editions).docs) ? (dict(editions).docs as unknown[]) : [];
  const { isbn, language, cover_i: editionCover } = dict(edition);
  const languages = strings(language);
  const single = languages.length <= 1;
  const code = single ? (strings(isbn).map(toIsbn13).find((value) => value !== null) ?? null) : null;
  return {
    work,
    title: title.trim(),
    author: strings(authors).slice(0, AUTHORS_MAX).join("; "),
    year: count(year),
    coverId: (single ? count(editionCover) : null) ?? count(cover),
    isbn: code,
    language: languages.length === 1 ? (LANGUAGES[languages[0]] ?? "other") : null,
  };
};

export const parseSearch = (body: unknown): Hit[] => {
  const { docs } = dict(body);
  return Array.isArray(docs) ? docs.flatMap((doc) => hitOf(doc) ?? []).slice(0, LIMIT) : [];
};

export const parseIsbn = (body: unknown, isbn: string): Hit | null => {
  const hits = parseSearch(body);
  return hits.find((hit) => hit.isbn === isbn) ?? hits[0] ?? null;
};

export const parseBlurb = (body: unknown): string | null => {
  const { description } = dict(body);
  const raw = typeof description === "string" ? description : dict(description).value;
  if (typeof raw !== "string") return null;
  const flat = raw
    .trim()
    .split(/\r?\n\s*\r?\n|-{5,}/)[0]
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (flat === "") return null;
  if (flat.length <= BLURB_MAX) return flat;
  const at = flat.lastIndexOf(" ", BLURB_MAX);
  return `${flat.slice(0, at === -1 ? BLURB_MAX : at)}…`;
};

export const settle = (typed: string, found: string): { title: string; original: string } => {
  const words = fold(typed).split(" ").filter(Boolean);
  const have = fold(found).split(" ");
  return words.every((word) => have.some((known) => known.startsWith(word)))
    ? { title: found, original: "" }
    : { title: typed.trim(), original: found };
};

export const fillPatch = (book: { title: string; data: Record<string, unknown> | null }, hit: Hit, blurb: string | null): Record<string, string> => {
  const found: Record<string, string | null> = {
    author: hit.author,
    original_title: settle(book.title, hit.title).original,
    language: hit.language,
    cover: hit.coverId === null ? null : coverUrl(hit.coverId),
    ol: hit.work,
    blurb,
  };
  return Object.fromEntries(Object.entries(found).filter((entry): entry is [string, string] => entry[1] !== null && entry[1] !== "" && book.data?.[entry[0]] == null));
};
