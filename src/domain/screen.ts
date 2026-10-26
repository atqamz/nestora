import type { Side } from "../../shared/api.ts";
import type { ItemRow, Patch } from "../../shared/tables.ts";
import { DONE_MIN, YEAR_MAX, YEAR_MIN, isDate } from "../../shared/validate.ts";
import { bySort, compare } from "./order.ts";
import { fold } from "./search.ts";

export const SCREEN_KINDS = ["movie", "series"] as const;

export type ScreenKind = (typeof SCREEN_KINDS)[number];

export const WATCH = ["want", "watching", "watched"] as const;

export type Watch = (typeof WATCH)[number];

export const START = ["want", "watched"] as const;

export const OPEN_ALL = 30;

export const isScreenKind = (kind: string): kind is ScreenKind => (SCREEN_KINDS as readonly string[]).includes(kind);

export const watchOf = (row: ItemRow): Watch => WATCH.find((known) => known === row.status) ?? "want";

export const screenSections = (rows: readonly ItemRow[], kind: ScreenKind) => {
  const own = rows.filter((row) => row.kind === kind);
  const of = (watch: Watch) => own.filter((row) => watchOf(row) === watch);
  return {
    watching: of("watching").sort(bySort),
    want: of("want").sort(bySort),
    watched: of("watched").sort((a, b) => compare(b.done_on ?? "", a.done_on ?? "") || bySort(a, b)),
  };
};

export const statusPatch = (row: ItemRow, pick: Watch, today: string): Patch<"items"> | null =>
  watchOf(row) === pick ? null : { status: pick, done_on: pick === "watched" ? today : null };

export const restoreStatus = (row: ItemRow): Patch<"items"> => ({ status: watchOf(row), done_on: row.done_on });

export const watchedDate = (raw: string, today: string): { ok: true; value: string } | { ok: false; reason: "invalid" | "future" } =>
  !isDate(raw) || raw < DONE_MIN ? { ok: false, reason: "invalid" } : raw > today ? { ok: false, reason: "future" } : { ok: true, value: raw };

export const datePatch = (row: ItemRow, day: string): Patch<"items"> | null => (row.done_on === day ? null : { done_on: day });

export const settleDraft = (draft: string | null, day: string): string | null => (draft === day ? null : draft);

export const restoreDate = (row: ItemRow): Patch<"items"> => ({ done_on: row.done_on });

export const ratingOf = (row: ItemRow, side: Side): number | null => {
  const stars = Number(row.data?.[`rating_${side}`]);
  return Number.isInteger(stars) && stars >= 1 && stars <= 5 ? stars : null;
};

export const ratingPatch = (row: ItemRow, side: Side, stars: number): Patch<"items"> => ({
  data: { [`rating_${side}`]: ratingOf(row, side) === stars ? null : String(stars) },
});

export const ratingRows = (row: ItemRow, me: Side | null) =>
  (me === "b" ? (["b", "a"] as const) : (["a", "b"] as const)).map((side) => ({ side, stars: ratingOf(row, side), mine: side === me }));

export const originalOf = (row: ItemRow): string | null => {
  const original = row.data?.original_title;
  return typeof original === "string" && fold(original) !== fold(row.title) ? original : null;
};

export const yearOf = (row: ItemRow): number | null => (typeof row.data?.year === "number" ? row.data.year : null);

export const screenFacts = (row: ItemRow, me: Side | null) => {
  const original = originalOf(row);
  const year = yearOf(row);
  const watched = watchOf(row) === "watched";
  return {
    original,
    year,
    sub: [original, year === null ? null : String(year)].filter(Boolean).join(" · "),
    side: row.who === "a" || row.who === "b" ? row.who : null,
    watched,
    watchedOn: watched ? row.done_on : null,
    rated: watched ? ratingRows(row, me).flatMap(({ side, stars }) => (stars === null ? [] : [{ side, stars }])) : [],
  };
};

export const screenDetail = (rows: readonly ItemRow[], kind: ScreenKind, id: string) => {
  const found = rows.find((candidate) => candidate.id === id);
  return { row: found?.kind === kind ? found : null, elsewhere: found !== undefined && found.kind !== kind };
};

export const parseYear = (raw: string): { ok: true; value: number | null } | { ok: false } => {
  const typed = raw.trim();
  if (typed === "") return { ok: true, value: null };
  const year = Number(typed);
  return /^\d{4}$/.test(typed) && year >= YEAR_MIN && year <= YEAR_MAX ? { ok: true, value: year } : { ok: false };
};

export const searchScreens = (query: string, rows: readonly ItemRow[], kind: ScreenKind): ItemRow[] => {
  const words = fold(query).split(" ").filter(Boolean);
  const { watching, want, watched } = screenSections(rows, kind);
  return [...watching, ...want, ...watched].filter((row) => {
    const haystack = fold(`${row.title} ${typeof row.data?.original_title === "string" ? row.data.original_title : ""}`).split(" ");
    return words.every((word) => haystack.some((found) => found.startsWith(word)));
  });
};

export const screenList = (rows: readonly ItemRow[], kind: ScreenKind, query: string) => {
  const sections = screenSections(rows, kind);
  const { watching, want, watched } = sections;
  if (watching.length + want.length + watched.length === 0) return { mode: "empty" } as const;
  if (query.trim() !== "") return { mode: "found", found: searchScreens(query, rows, kind) } as const;
  return { mode: "sections", ...sections, allWatched: watching.length === 0 && want.length === 0, openWatched: watched.length <= OPEN_ALL } as const;
};
