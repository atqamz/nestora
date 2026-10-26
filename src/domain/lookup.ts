import { isCover, isIsbn13 } from "../../shared/validate.ts";
import { ISBNS_MAX, VOLUME, WORK, count, dict, strings } from "./openlibrary.ts";
import type { Hit, Language, Query, Source } from "./openlibrary.ts";

export const LOOKUP_URL = "/api/lookup";

export const TITLE_MAX = 200;

export const AUTHOR_MAX = 120;

const HITS_MAX = 8;

const BLURB_MAX = 501;

export const tidy = (value: string) =>
  value
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export const queryOf = (params: URLSearchParams): Query | null => {
  const [isbn, title, author] = ["isbn", "title", "author"].map((name) => params.get(name));
  if (isbn !== null) return title === null && author === null && /^\d{13}$/.test(isbn) && isIsbn13(isbn) ? { kind: "isbn", isbn } : null;
  if (title === null) return null;
  const [name, by] = [tidy(title), tidy(author ?? "")];
  return Array.from(name).length >= 2 && Array.from(name).length <= TITLE_MAX && Array.from(by).length <= AUTHOR_MAX ? { kind: "title", title: name, author: by } : null;
};

export const paramsOf = (query: Query) => new URLSearchParams(query.kind === "isbn" ? { isbn: query.isbn } : { title: query.title, author: query.author });

export const lookupUrl = (query: Query) => `${LOOKUP_URL}?${paramsOf(query)}`;

export const cacheKey = (query: Query) => `https://lookup.invalid/v1?${paramsOf(query)}`;

const LANGUAGES = new Set<unknown>(["id", "en", "other"]);

const SOURCES = new Set<unknown>(["google", "openlibrary"]);

const text = (value: unknown, max: number) => (typeof value === "string" && value.trim() !== "" && Array.from(value).length <= max ? value.trim() : null);

const hitOf = (raw: unknown): Hit | null => {
  const { source, work, title, author, year, cover, isbns, language, blurb } = dict(raw);
  const name = text(title, TITLE_MAX);
  const codes = strings(isbns);
  if (!SOURCES.has(source) || typeof work !== "string" || !(source === "google" ? VOLUME : WORK).test(work) || name === null) return null;
  if (typeof author !== "string" || author.length > 400 || codes.length > ISBNS_MAX || !codes.every(isIsbn13)) return null;
  if (cover !== null && !isCover(cover)) return null;
  if (language !== null && !LANGUAGES.has(language)) return null;
  if (blurb !== null && text(blurb, BLURB_MAX) === null) return null;
  return {
    source: source as Source,
    work,
    title: name,
    author,
    year: count(year),
    cover: cover as string | null,
    isbns: codes,
    language: language as Language | null,
    blurb: source === "google" ? null : (blurb as string | null),
  };
};

export const parseLookup = (body: unknown): Hit[] => {
  const { hits } = dict(body);
  return Array.isArray(hits) ? hits.flatMap((hit) => hitOf(hit) ?? []).slice(0, HITS_MAX) : [];
};
