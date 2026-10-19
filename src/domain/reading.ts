import type { Side } from "../../shared/api.ts";
import type { ItemRow, Patch } from "../../shared/tables.ts";
import { bySort } from "./order.ts";

export const READING = ["want", "reading", "read", "dnf"] as const;

export type Reading = (typeof READING)[number];

export type ReadingState = { state: Reading | null; rating: number | null; finished: string | null };

const SIDES = ["a", "b"] as const satisfies readonly Side[];

export const readingOf = (book: ItemRow, side: Side): ReadingState => {
  const state = book.data?.[`reading_${side}`];
  const rating = Number(book.data?.[`rating_${side}`]);
  const finished = book.data?.[`finished_${side}`];
  return {
    state: READING.find((known) => known === state) ?? null,
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
    finished: typeof finished === "string" ? finished : null,
  };
};

export const readingPatch = (book: ItemRow, side: Side, pick: Reading, today: string): Patch<"items"> =>
  readingOf(book, side).state === pick
    ? { data: { [`reading_${side}`]: null, [`rating_${side}`]: null, [`finished_${side}`]: null } }
    : { data: { [`reading_${side}`]: pick, [`finished_${side}`]: pick === "read" ? today : null } };

export const ratingPatch = (book: ItemRow, side: Side, stars: number): Patch<"items"> => ({
  data: { [`rating_${side}`]: readingOf(book, side).rating === stars ? null : String(stars) },
});

export const readersNow = (book: ItemRow): Side[] => SIDES.filter((side) => readingOf(book, side).state === "reading");

export const readingNow = (rows: readonly ItemRow[]) =>
  rows.filter((row) => row.kind === "book" && row.status === "shelf" && readersNow(row).length > 0).sort(bySort);
