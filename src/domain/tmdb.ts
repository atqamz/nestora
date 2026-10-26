import { isCover, YEAR_MAX, YEAR_MIN } from "../../shared/validate.ts";
import { TITLE_MAX, tidy } from "./lookup.ts";
import { dict } from "./openlibrary.ts";
import { isScreenKind } from "./screen.ts";
import type { ScreenKind } from "./screen.ts";

export const SCREEN_URL = "/api/lookup/screen";

export const SCREEN_HITS_MAX = 8;

export type ScreenQuery = { kind: ScreenKind } & ({ by: "title"; title: string; year: number | null } | { by: "id"; id: number });

export type ScreenHit = { kind: ScreenKind; tmdb: number; title: string; original: string | null; year: number | null; cover: string | null };

const NAMES = new Set(["kind", "title", "year", "id"]);

const ID = /^[1-9]\d{0,14}$/;

const YEAR = /^\d{4}$/;

export const validId = (value: unknown) => (typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null);

export const validYear = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value >= YEAR_MIN && value <= YEAR_MAX ? value : null);

export const screenQueryOf = (params: URLSearchParams): ScreenQuery | null => {
  const names = [...params.keys()];
  const kind = params.get("kind");
  if (names.length !== new Set(names).size || !names.every((name) => NAMES.has(name)) || kind === null || !isScreenKind(kind)) return null;
  const [title, year, id] = [params.get("title"), params.get("year"), params.get("id")];
  if (id !== null) return title === null && year === null && ID.test(id) ? { kind, by: "id", id: Number(id) } : null;
  if (title === null) return null;
  const name = tidy(title);
  const length = Array.from(name).length;
  if (length < 2 || length > TITLE_MAX) return null;
  if (year === null) return { kind, by: "title", title: name, year: null };
  return YEAR.test(year) && validYear(Number(year)) !== null ? { kind, by: "title", title: name, year: Number(year) } : null;
};

export const screenParams = (query: ScreenQuery) =>
  new URLSearchParams(
    query.by === "id"
      ? { kind: query.kind, id: String(query.id) }
      : { kind: query.kind, title: query.title, ...(query.year === null ? {} : { year: String(query.year) }) },
  );

export const screenLookupUrl = (query: ScreenQuery) => `${SCREEN_URL}?${screenParams(query)}`;

export const screenCacheKey = (query: ScreenQuery) => `https://lookup.invalid/screen/v1?${screenParams(query)}`;

const text = (value: unknown) => (typeof value === "string" && value.trim() !== "" && Array.from(value).length <= TITLE_MAX ? value.trim() : null);

const hitOf = (raw: unknown): ScreenHit | null => {
  const { kind, tmdb, title, original, year, cover } = dict(raw);
  const name = text(title);
  if (typeof kind !== "string" || !isScreenKind(kind) || validId(tmdb) === null || name === null) return null;
  if (original !== null && text(original) === null) return null;
  if (year !== null && validYear(year) === null) return null;
  if (cover !== null && !isCover(cover)) return null;
  return { kind, tmdb: tmdb as number, title: name, original: original as string | null, year: year as number | null, cover: cover as string | null };
};

export const parseScreenHits = (body: unknown): ScreenHit[] => {
  const { hits } = dict(body);
  return Array.isArray(hits) ? hits.flatMap((hit) => hitOf(hit) ?? []).slice(0, SCREEN_HITS_MAX) : [];
};
