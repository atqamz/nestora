import { POSTER_KEYS, POSTER_PURGE } from "../../shared/api.ts";
import type { ItemRow, Patch } from "../../shared/tables.ts";
import { isPoster, YEAR_MAX, YEAR_MIN } from "../../shared/validate.ts";
import { daysBetween } from "./dates.ts";
import { TITLE_MAX, tidy } from "./lookup.ts";
import { dict } from "./openlibrary.ts";
import { fold } from "./search.ts";
import { isScreenKind, yearOf } from "./screen.ts";
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
  if (cover !== null && !isPoster(cover)) return null;
  return { kind, tmdb: tmdb as number, title: name, original: original as string | null, year: year as number | null, cover: cover as string | null };
};

export const parseScreenHits = (body: unknown, kind: ScreenKind): ScreenHit[] => {
  const { hits } = dict(body);
  const seen = new Set<number>();
  const kept: ScreenHit[] = [];
  for (const raw of Array.isArray(hits) ? hits : []) {
    const hit = hitOf(raw);
    if (hit === null || hit.kind !== kind || seen.has(hit.tmdb)) continue;
    seen.add(hit.tmdb);
    kept.push(hit);
    if (kept.length === SCREEN_HITS_MAX) break;
  }
  return kept;
};

export const hitSub = (hit: ScreenHit) => [hit.original, hit.year === null ? null : String(hit.year)].filter(Boolean).join(" · ");

export const usesTmdb = (rows: readonly ItemRow[], kind: ScreenKind) =>
  rows.some((row) => row.kind === kind && (isPoster(row.data?.cover) || validId(row.data?.tmdb) !== null));

export const heldIds = (rows: readonly ItemRow[], kind: ScreenKind) =>
  new Set(rows.flatMap((row) => (row.kind === kind && validId(row.data?.tmdb) !== null ? [row.data?.tmdb as number] : [])));

export const tmdbPage = (kind: ScreenKind, id: number) => `https://www.themoviedb.org/${kind === "movie" ? "movie" : "tv"}/${id}`;

export type Picked = { title: string; tmdb: number; original: string | null; cover: string | null };

export const adopt = (typed: { year: string }, hit: ScreenHit) => {
  const filled = typed.year.trim() === "" && hit.year !== null ? String(hit.year) : null;
  return {
    title: hit.title,
    year: filled ?? typed.year,
    filled,
    picked: { title: hit.title, tmdb: hit.tmdb, original: hit.original, cover: hit.cover },
  };
};

export const unfill = (year: string, filled: string | null) => (filled !== null && year === filled ? "" : year);

export const heldPick = (picked: Picked | null, title: string) => (picked !== null && fold(picked.title) === fold(title) ? picked : null);

export const letGo = (picked: Picked | null, title: string, year: string, filled: string | null) =>
  picked !== null && heldPick(picked, title) === null ? { year: unfill(year, filled) } : null;

export const tmdbData = (picked: Picked | null, today: string) =>
  picked === null ? {} : { ...(picked.original === null ? {} : { original_title: picked.original }), ...(picked.cover === null ? {} : { cover: picked.cover }), tmdb: picked.tmdb, tmdb_at: today };

export const REFRESH_DAYS = 120;

export const PURGE_DAYS = 170;

export const FUTURE_DAYS = 1;

export const posterAge = (row: ItemRow, today: string) => {
  const stamp = row.data?.tmdb_at;
  const age = typeof stamp === "string" ? daysBetween(stamp, today) : NaN;
  return Number.isFinite(age) && age >= -FUTURE_DAYS ? age : null;
};

export const expired = (row: ItemRow, today: string) => {
  if (!isScreenKind(row.kind) || (row.data?.cover == null && row.data?.tmdb == null)) return false;
  const age = posterAge(row, today);
  return age === null || age >= PURGE_DAYS;
};

export const needsPoster = (row: ItemRow, today: string) => {
  if (!isScreenKind(row.kind)) return false;
  const age = posterAge(row, today);
  return validId(row.data?.tmdb) === null || age === null || age >= REFRESH_DAYS;
};

export const purgePatch = () => ({ data: { ...POSTER_PURGE } });

export const posterKeys = (row: ItemRow) => Object.fromEntries(POSTER_KEYS.filter((key) => row.data?.[key] != null).map((key) => [key, row.data?.[key]]));

export const hasPoster = (row: ItemRow) => row.data?.cover != null || row.data?.tmdb != null;

export const restorePosterPatch = (row: ItemRow): Patch<"items"> => ({ data: posterKeys(row) });

export const revivePatch = (row: ItemRow): Patch<"items"> => ({ deleted_at: null, ...(Object.keys(posterKeys(row)).length > 0 ? restorePosterPatch(row) : {}) });

export const expiredSteps = (rows: readonly ItemRow[], today: string) =>
  rows.filter((row) => expired(row, today)).map((row) => ({ op: "update" as const, table: "items" as const, id: row.id, change: purgePatch() }));

const sameTitle = (row: ItemRow, hit: ScreenHit) => {
  const title = fold(row.title);
  return title !== "" && [hit.title, hit.original].some((name) => name !== null && fold(name) === title);
};

export const askedAbout = (asked: ItemRow, now: ItemRow) =>
  asked.title === now.title && (asked.data?.original_title ?? null) === (now.data?.original_title ?? null) && yearOf(asked) === yearOf(now);

export const matches = (row: ItemRow, hits: readonly ScreenHit[]) => {
  const year = yearOf(row);
  return hits.filter((hit) => sameTitle(row, hit) && (year === null || hit.year === year));
};

export const posterPatch = (row: ItemRow, hit: ScreenHit, today: string) => {
  const data = row.data ?? {};
  return {
    tmdb: hit.tmdb,
    tmdb_at: today,
    ...(hit.cover !== null && (data.tmdb == null ? data.cover == null : hit.cover !== data.cover) ? { cover: hit.cover } : {}),
    ...(hit.original !== null && data.original_title == null ? { original_title: hit.original } : {}),
    ...(hit.year !== null && data.year == null ? { year: hit.year } : {}),
  };
};
