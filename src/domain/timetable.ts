import type { Side } from "../../shared/api.ts";
import { DAY_CODES, actionOccursOn, isTimetable, visible, weekDates, weekday } from "../../shared/routines.ts";
import type { DayCode } from "../../shared/routines.ts";
import type { ItemRow } from "../../shared/tables.ts";
import { isTime } from "../../shared/validate.ts";
import { bySort, compare } from "./order.ts";

export type Slot = { row: ItemRow; routine: ItemRow; start: string; end: string | null; where: string | null };

export type State = "done" | "now" | "later";

export type Mark = { slot: Slot; state: State; tag: "now" | "next" | null };

export type Day = { date: string; day: DayCode; today: boolean; slots: Slot[] };

export type Span = { kind: string; start: string; end: string; days: readonly DayCode[] };

const DAY_MINUTES = 24 * 60;

const text = (value: unknown) => (typeof value === "string" ? value : "");

export const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

const startOf = (row: ItemRow) => text(row.data?.start_time);

const slotOf = (routine: ItemRow, row: ItemRow): Slot => {
  const data = row.data ?? {};
  const start = startOf(row);
  const end = text(data.end_time);
  return { row, routine, start, end: start !== "" && end > start ? end : null, where: text(data.where) || null };
};

const byStart = (a: ItemRow, b: ItemRow) => compare(startOf(a), startOf(b)) || bySort(a, b);

const earlier = (a: Slot, b: Slot) => byStart(a.row, b.row);

export const inTimeOrder = (actions: readonly ItemRow[]) => [
  ...actions.filter((row) => row.kind === "block").sort(byStart),
  ...actions.filter((row) => row.kind !== "block"),
];

export const slotsOn = (routine: ItemRow, rows: readonly ItemRow[], date: string): Slot[] =>
  rows
    .filter((row) => row.kind === "block" && row.deleted_at === null && actionOccursOn(routine, row, date))
    .map((row) => slotOf(routine, row))
    .sort(earlier);

export const weekOf = (routine: ItemRow, rows: readonly ItemRow[], day: string): Day[] =>
  weekDates(day).map((date) => ({ date, day: weekday(date), today: date === day, slots: slotsOn(routine, rows, date) }));

export const themToday = (rows: readonly ItemRow[], me: Side | null, day: string): { routines: ItemRow[]; slots: Slot[] } => {
  if (me === null) return { routines: [], slots: [] };
  const seen = visible(rows, me);
  const routines = seen.filter((row) => row.deleted_at === null && isTimetable(row) && row.who === (me === "a" ? "b" : "a"));
  return { routines, slots: routines.flatMap((routine) => slotsOn(routine, seen, day)).sort(earlier) };
};

export const stateOf = (slot: Slot, elapsed: number): State => {
  if (slot.start === "" || minutes(slot.start) > elapsed) return "later";
  return slot.end !== null && minutes(slot.end) <= elapsed ? "done" : "now";
};

export const glance = (all: readonly Mark[]): Mark[] => {
  const near = all.filter((mark) => mark.tag !== null);
  return near.length > 0 ? near : all.filter((mark) => mark.state !== "done").slice(0, 2);
};

export const marks = (slots: readonly Slot[], elapsed: number): Mark[] => {
  const states = slots.map((slot) => stateOf(slot, elapsed));
  const next = slots.findIndex((slot, at) => states[at] === "later" && slot.start !== "");
  return slots.map((slot, at) => ({ slot, state: states[at], tag: states[at] === "now" ? "now" : at === next ? "next" : null }));
};

export const glances = (slots: readonly Slot[]): { from: number; near: Mark[] }[] =>
  [...new Set([0, ...slots.flatMap((slot) => [slot.start, slot.end ?? ""]).map(minutes)])].sort((a, b) => a - b).map((from) => ({ from, near: glance(marks(slots, from)) }));

const span = (block: Span) => (isTime(block.start) ? [minutes(block.start), isTime(block.end) && block.end > block.start ? minutes(block.end) : DAY_MINUTES] : null);

export const overlaps = (blocks: readonly Span[], routineDays: readonly DayCode[]): number[][] => {
  const spans = blocks.map((block) => (block.kind === "block" ? span(block) : null));
  const daysOf = (block: Span) => (block.days.length === 0 ? routineDays : block.days);
  return blocks.map((block, at) =>
    blocks.flatMap((other, to) => {
      const mine = spans[at];
      const theirs = spans[to];
      if (to === at || mine === null || theirs === null) return [];
      const together = DAY_CODES.some((code) => daysOf(block).includes(code) && daysOf(other).includes(code));
      return together && mine[0] < theirs[1] && theirs[0] < mine[1] ? [to] : [];
    }),
  );
};
