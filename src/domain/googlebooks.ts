import { isCover } from "../../shared/validate.ts";
import { toIsbn13 } from "./isbn.ts";
import { AUTHORS_MAX, ISBNS_MAX, VOLUME, blurbOf, count, dict, phraseOf, strings } from "./openlibrary.ts";
import type { Hit, Language, Query } from "./openlibrary.ts";

const SITE = "https://www.googleapis.com/books/v1/volumes";

export const POWERED_BY = "https://books.google.com/googlebooks/images/poweredby.png";

export const GOOGLE_LIMIT = 8;

const TITLE_MAX = 200;

const NAME_MAX = 100;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'" };

export const googleUrl = (query: Query, key: string) =>
  `${SITE}?${new URLSearchParams({ q: query.kind === "isbn" ? `isbn:${query.isbn}` : phraseOf(query), maxResults: String(GOOGLE_LIMIT), key })}`;

const clean = (value: unknown, max: number) =>
  typeof value === "string" ? Array.from(value.replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, " ").replace(/\s+/g, " ").trim()).slice(0, max).join("") : "";

export const plain = (html: string) =>
  html
    .replace(/<\s*\/p\s*>/gi, "\n\n")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|apos);/g, (_, name: string) => ENTITIES[name]);

export const googleCover = (link: unknown): string | null => {
  if (typeof link !== "string") return null;
  try {
    const url = new URL(link.replace(/^http:\/\//i, "https://"));
    url.searchParams.delete("zoom");
    url.searchParams.delete("edge");
    url.hash = "";
    return isCover(url.href) ? url.href : null;
  } catch {
    return null;
  }
};

const LANGUAGES: Record<string, Language> = { id: "id", en: "en" };

const languageOf = (value: unknown): Language | null => (typeof value === "string" && /^[a-z]{2,3}$/.test(value) && value !== "und" ? (LANGUAGES[value] ?? "other") : null);

const isbnsOf = (identifiers: unknown) =>
  Array.isArray(identifiers)
    ? [
        ...new Set(
          identifiers.flatMap((entry) => {
            const { type, identifier } = dict(entry);
            return (type === "ISBN_13" || type === "ISBN_10") && typeof identifier === "string" ? (toIsbn13(identifier) ?? []) : [];
          }),
        ),
      ].slice(0, ISBNS_MAX)
    : [];

const hitOf = (item: unknown): Hit | null => {
  const { id, volumeInfo } = dict(item);
  const { title, authors, publishedDate, language, industryIdentifiers, imageLinks, description } = dict(volumeInfo);
  const links = dict(imageLinks);
  const name = clean(title, TITLE_MAX);
  if (typeof id !== "string" || !VOLUME.test(id) || name === "") return null;
  return {
    source: "google",
    work: id,
    title: name,
    author: strings(authors)
      .map((author) => clean(author, NAME_MAX))
      .filter(Boolean)
      .slice(0, AUTHORS_MAX)
      .join("; "),
    year: typeof publishedDate === "string" ? count(Number(/^\d{4}/.exec(publishedDate)?.[0])) : null,
    cover: googleCover(links.thumbnail) ?? googleCover(links.smallThumbnail),
    isbns: isbnsOf(industryIdentifiers),
    language: languageOf(language),
    blurb: typeof description === "string" ? blurbOf(plain(description)) : null,
  };
};

export const parseGoogle = (body: unknown): Hit[] => {
  const { items } = dict(body);
  return Array.isArray(items)
    ? items
        .flatMap((item) => hitOf(item) ?? [])
        .filter((hit, at, all) => all.findIndex((other) => other.work === hit.work) === at)
        .slice(0, GOOGLE_LIMIT)
    : [];
};
