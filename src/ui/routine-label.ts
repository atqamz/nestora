import { nextOccurrence, occursOn, paused } from "../../shared/routines.ts";
import type { DayCode } from "../../shared/routines.ts";
import type { ItemRow } from "../../shared/tables.ts";
import { formatDate, formatDay } from "./format.ts";
import { text } from "./text.ts";

const copy = text.routines;

export const momentLabel = (key: string | null) => (key === null ? copy.moment.other : Object.hasOwn(copy.moment, key) ? copy.moment[key as keyof typeof copy.moment] : key);

export const daysLine = (days: unknown, spoken = false) =>
  typeof days === "string" ? days.split(",").map((code) => copy[spoken ? "dayNames" : "days"][code as DayCode]).join(spoken ? ", " : " ") : null;

export const scheduleLine = (routine: ItemRow, today: string, spoken = false) => {
  const data = routine.data ?? {};
  const days = daysLine(data.days, spoken) ?? copy.everyDay;
  const every = Number(data.every_weeks ?? 1);
  return every > 1 ? `${days} · ${copy.everyWeeks(every, typeof data.from === "string" ? formatDay(data.from, today) : null)}` : days;
};

export const whenLine = (routine: ItemRow, today: string) => {
  if (paused(routine, today)) return copy.paused(formatDay(String(routine.data?.paused_until), today));
  if (occursOn(routine, today)) return copy.onToday;
  const next = nextOccurrence(routine, today);
  return next === null ? copy.noNext : copy.nextOn(formatDay(next, today));
};

export const rowStatus = (routine: ItemRow, today: string, tally: { done: number; total: number } | null) => {
  if (paused(routine, today)) return copy.paused(formatDate(String(routine.data?.paused_until)));
  const when = whenLine(routine, today);
  if (tally === null || tally.total === 0 || !occursOn(routine, today)) return when;
  return tally.done >= tally.total ? copy.doneToday : copy.progressToday(tally.done, tally.total);
};
