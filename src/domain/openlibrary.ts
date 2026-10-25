import { fold } from "./search.ts";
import { toIsbn13 } from "./isbn.ts";

export type Language = "id" | "en" | "other";

export type Source = "google" | "openlibrary";

export type Hit = {
  source: Source;
  work: string;
  title: string;
  author: string;
  year: number | null;
  cover: string | null;
  isbns: string[];
  language: Language | null;
  blurb: string | null;
};

const SITE = "https://openlibrary.org";

const SEARCH_FIELDS = "key,title,author_name,first_publish_year,cover_i,editions,editions.title,editions.language,editions.cover_i,editions.isbn";

const LIMIT = 5;

export const AUTHORS_MAX = 3;

const BLURB_MAX = 500;

export const ISBNS_MAX = 5;

export const WORK = /^OL\d{1,12}W$/;

const LANGUAGES: Record<string, Language> = { ind: "id", eng: "en" };

export const dict = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {});

export const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);

export const count = (value: unknown) => (typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null);

export const searchUrl = (query: string) => `${SITE}/search.json?${new URLSearchParams({ q: query, limit: String(LIMIT), fields: SEARCH_FIELDS })}`;

export const isbnUrl = (isbn: string) => `${SITE}/search.json?${new URLSearchParams({ isbn, limit: String(LIMIT), fields: SEARCH_FIELDS })}`;

export const workUrl = (work: string) => `${SITE}/works/${work}.json`;

export const workPage = (work: string) => (WORK.test(work) ? `${SITE}/works/${work}` : null);

export const VOLUME = /^[A-Za-z0-9_-]{1,32}$/;

export const pageOf = (source: Source, work: string) =>
  source === "google" ? (VOLUME.test(work) ? `https://books.google.com/books?id=${work}` : null) : workPage(work);

export const coverUrl = (id: number) => `https://covers.openlibrary.org/b/id/${id}-M.jpg`;

export type TitleQuery = { kind: "title"; title: string; author: string };

export type Query = TitleQuery | { kind: "isbn"; isbn: string };

const squash = (value: string) => value.trim().replace(/\s+/g, " ");

export const queriesOf = ({ title, author, original }: { title: string; author: string; original: string }): TitleQuery[] =>
  [...new Set([title, original].map(squash).filter(Boolean))].map((name) => ({ kind: "title", title: name, author: squash(author) }));

export const phraseOf = ({ title, author }: TitleQuery) => [title, author].filter(Boolean).join(" ");

const hitOf = (doc: unknown): Hit | null => {
  const { key, title, author_name: authors, first_publish_year: year, cover_i: coverId, editions } = dict(doc);
  const work = typeof key === "string" ? key.replace(/^\/works\//, "") : "";
  if (!WORK.test(work) || typeof title !== "string" || title.trim() === "") return null;
  const [edition] = Array.isArray(dict(editions).docs) ? (dict(editions).docs as unknown[]) : [];
  const { isbn, language, cover_i: editionCover } = dict(edition);
  const languages = strings(language);
  const single = languages.length <= 1;
  const codes = single ? [...new Set(strings(isbn).map(toIsbn13).filter((value) => value !== null))].slice(0, ISBNS_MAX) : [];
  const cover = (single ? count(editionCover) : null) ?? count(coverId);
  return {
    source: "openlibrary",
    work,
    title: title.trim(),
    author: strings(authors).slice(0, AUTHORS_MAX).join("; "),
    year: count(year),
    cover: cover === null ? null : coverUrl(cover),
    isbns: codes,
    language: languages.length === 1 ? (LANGUAGES[languages[0]] ?? "other") : null,
    blurb: null,
  };
};

export const parseSearch = (body: unknown): Hit[] => {
  const { docs } = dict(body);
  return Array.isArray(docs) ? docs.flatMap((doc) => hitOf(doc) ?? []).slice(0, LIMIT) : [];
};

export const pickIsbn = (hits: Hit[], isbn: string): Hit | null =>
  hits.find((hit) => hit.isbns.includes(isbn)) ?? hits.find((hit) => hit.source === "openlibrary") ?? null;

export const parseIsbn = (body: unknown, isbn: string): Hit | null => pickIsbn(parseSearch(body), isbn);

export const blurbOf = (raw: string): string | null => {
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

export const parseBlurb = (body: unknown): string | null => {
  const { description } = dict(body);
  const raw = typeof description === "string" ? description : dict(description).value;
  return typeof raw === "string" ? blurbOf(raw) : null;
};

export const settle = (typed: string, found: string): { title: string; original: string } => {
  const words = fold(typed).split(" ").filter(Boolean);
  const have = fold(found).split(" ");
  return words.every((word) => have.some((known) => known.startsWith(word)))
    ? { title: found, original: "" }
    : { title: typed.trim(), original: found };
};

const SUBTITLE = /\s*(?::|–|—|\s-\s).*$/su;

const NOTE = /\s*\([^)]*\)$/;

const NUMBER = /\s+(?:(?:vol(?:ume)?|book|bk|no|part|#)\.?\s*)?\d{1,3}$/i;

const heads = (title: string, suffixes = [NOTE, NUMBER]) =>
  [title, title.replace(SUBTITLE, "")]
    .flatMap((whole) => [whole, ...suffixes.map((suffix) => whole.replace(suffix, ""))])
    .map(fold)
    .filter(Boolean);

const subtitled = (title: string) => SUBTITLE.test(title);

export const sameTitle = (typed: string, found: string) => {
  const [left, right] = [fold(typed), fold(found)];
  return left === right || heads(typed).includes(right) || ((subtitled(typed) || !subtitled(found)) && heads(found, [NOTE]).includes(left));
};

const blank = (value: string) => value.trim() === "";

export const sameBook = (book: { title: string; original: unknown }, found: string) =>
  blank(book.title) || sameTitle(book.title, found) || (typeof book.original === "string" && !blank(book.original) && sameTitle(book.original, found));

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

const AUTHORS = /\s*;\s*|\s+&\s+|\s+(?:and|dan)\s+/i;

const nameOf = (name: string) =>
  [
    ...new Set(
      name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/['’`]/g, "")
        .split(/[^\p{L}\p{N}\p{M}]+/u)
        .filter((word) => word !== "" && !SUFFIXES.has(word)),
    ),
  ]
    .sort()
    .join(" ");

export const sameAuthor = (typed: unknown, found: string) => {
  if (typeof typed !== "string") return false;
  const wanted = typed.split(AUTHORS).map(nameOf).filter(Boolean);
  const have = found.split(";").map(nameOf);
  return wanted.length > 0 && wanted.every((name) => have.includes(name));
};

export const workKey = (hit: Hit) =>
  hit.source === "openlibrary" ? hit.work : `${fold(hit.title)}|${hit.author.split(";").map(nameOf).sort().join(",")}`;

export const AUTO = ["author", "original", "isbn", "language", "blurb"] as const;

export type Field = (typeof AUTO)[number];

export type Auto = Partial<Record<Field, string>>;

export type Found = { title: string; cover: string | null; source: Source; work: string; auto: Auto };

export type Typed = Record<Field | "title", string> & { found: Found | null };

export type Patch = Record<Field, string | null>;

const patchOf = (change: (field: Field) => string | null) => Object.fromEntries(AUTO.map((field) => [field, change(field)])) as Patch;

const mine = (typed: Typed, field: Field) => !blank(typed[field]) && typed[field] !== typed.found?.auto[field];

export const adopt = (typed: Typed, hit: Hit) => {
  const next = settle(typed.title, hit.title);
  const edition = next.original === "";
  const fresh: Record<Field, string> = {
    author: hit.author,
    original: edition ? "" : next.original,
    isbn: edition ? (hit.isbns[0] ?? "") : "",
    language: edition ? (hit.language ?? "") : "",
    blurb: hit.blurb ?? "",
  };
  const patch = patchOf((field) => (mine(typed, field) ? null : fresh[field]));
  const auto: Auto = Object.fromEntries(AUTO.flatMap((field) => (patch[field] ? [[field, patch[field]]] : [])));
  const found: Found = { title: next.title.trim(), cover: hit.cover, source: hit.source, work: hit.work, auto };
  return { title: next.title, patch, wantsBlurb: patch.blurb === "" && lacksBlurb(hit), found };
};

export const lacksBlurb = (hit: Hit) => hit.source === "openlibrary" && hit.blurb === null;

export const held = (found: Found | null, title: string) => (found !== null && fold(found.title) === fold(title) ? found : null);

export const release = (typed: Typed): Patch => patchOf((field) => (typed.found?.auto[field] !== undefined && typed[field] === typed.found.auto[field] ? "" : null));

export const arrive = (typed: { blurb: string; found: Found | null }, work: string, blurb: string) => {
  const { found } = typed;
  if (found === null || found.work !== work || blank(blurb)) return null;
  if (!blank(typed.blurb) && typed.blurb !== found.auto.blurb) return null;
  return { blurb, found: { ...found, auto: { ...found.auto, blurb } } };
};

export const fillPatch = (book: { title: string; data: Record<string, unknown> | null }, hit: Hit, blurb: string | null): Record<string, string> | null => {
  if (!sameBook({ title: book.title, original: book.data?.original_title }, hit.title)) return null;
  const found: Record<string, string | null> = {
    author: hit.author,
    language: sameTitle(book.title, hit.title) ? hit.language : null,
    cover: hit.cover,
    [hit.source === "google" ? "gb" : "ol"]: hit.work,
    blurb: blurb ?? hit.blurb,
  };
  return Object.fromEntries(Object.entries(found).filter((entry): entry is [string, string] => entry[1] !== null && entry[1] !== "" && book.data?.[entry[0]] == null));
};
