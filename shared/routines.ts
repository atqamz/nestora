import type { Side } from "./api.ts";
import type { ItemRow } from "./tables.ts";

export const ACTION_KINDS = ["step", "timer", "pack", "block", "day_type", "counter", "text"] as const;

export const ROUTINE_KINDS: readonly string[] = ["routine", ...ACTION_KINDS];

export const isRoutineKind = (kind: string) => ROUTINE_KINDS.includes(kind);

export const DAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

const DAY_START_HOUR = 4;

const UTC_OFFSET_HOURS = 7;

export type DayCode = (typeof DAY_CODES)[number];

export type Schedule = { days?: string; every_weeks?: string; from?: string; until?: string; paused_until?: string; holidays?: boolean };

export type Scheduled = { routine: ItemRow; actions: ItemRow[] };

const HOUR = 3_600_000;

const DAY = 24 * HOUR;

const KEYS = { a: ["done_a", "value_a"], b: ["done_b", "value_b"] } as const;

const COMPLETES = ["step", "timer", "pack", "counter"];

const dataOf = (row: ItemRow) => (row.data ?? {}) as Record<string, unknown>;

const epochDay = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY;

const dateOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const plus = (date: string, days: number) => dateOf((epochDay(date) + days) * DAY);

const NEXT_LOOKAHEAD_DAYS = 400;

type Raw = Record<string, unknown>;

export const flagged = (row: Raw | undefined) => row?.kind === "routine" && (row.data as Raw | null)?.private === true;

const withheld = (row: Raw | undefined, side: Side | null) => flagged(row) && row?.who !== side;

export const hides = (row: Raw, parent: Raw | undefined, side: Side | null) => withheld(row, side) || withheld(parent, side);

export const visible = <R extends ItemRow>(rows: readonly R[], side: Side | null): R[] => {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return rows.filter((row) => !hides(row, byId.get(row.parent_id ?? ""), side));
};

export const routineDay = (now: Date) => dateOf(now.getTime() + (UTC_OFFSET_HOURS - DAY_START_HOUR) * HOUR);

export const weekday = (date: string): DayCode => DAY_CODES[(((epochDay(date) + 3) % 7) + 7) % 7];

const weekIndex = (date: string) => Math.floor((epochDay(date) + 3) / 7);

const covers = (days: unknown, code: DayCode) => typeof days !== "string" || days.split(",").includes(code);

const listed = (days: unknown, date: string) => covers(days, weekday(date));

export const occursOn = (routine: ItemRow, date: string, holidays: readonly string[] = []) => {
  const { days, every_weeks, from, until, paused_until, holidays: skip } = dataOf(routine) as Schedule;
  if (!listed(days, date)) return false;
  if (from !== undefined && date < from) return false;
  if (until !== undefined && date > until) return false;
  if (paused_until !== undefined && date < paused_until) return false;
  if (from !== undefined && every_weeks !== undefined && (weekIndex(date) - weekIndex(from)) % Number(every_weeks) !== 0) return false;
  return skip !== true || !holidays.includes(date);
};

export const paused = (routine: ItemRow, today: string) => {
  const until = dataOf(routine).paused_until;
  return typeof until === "string" && today < until;
};

export const nextOccurrence = (routine: ItemRow, from: string, holidays: readonly string[] = []) => {
  const { paused_until, until, from: starts } = dataOf(routine) as Schedule;
  let date = [paused_until, starts].reduce<string>((latest, next) => (next !== undefined && next > latest ? next : latest), from);
  for (let step = 0; step < NEXT_LOOKAHEAD_DAYS && (until === undefined || date <= until); step++, date = plus(date, 1)) {
    if (occursOn(routine, date, holidays)) return date;
  }
  return null;
};

export const actionOccursOn = (routine: ItemRow, action: ItemRow, date: string, holidays: readonly string[] = []) =>
  action.parent_id === routine.id && occursOn(routine, date, holidays) && listed(dataOf(action).days, date);

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const order = (a: ItemRow, b: ItemRow) => a.sort - b.sort || compare(a.created_at, b.created_at) || compare(a.id, b.id);

export const scheduled = (rows: readonly ItemRow[], date: string, holidays: readonly string[] = []): Scheduled[] => {
  const live = rows.filter((row) => row.deleted_at === null);
  return live
    .filter((row) => row.kind === "routine" && occursOn(row, date, holidays))
    .sort(order)
    .map((routine) => ({
      routine,
      actions: live.filter((row) => row.parent_id === routine.id && listed(dataOf(row).days, date)).sort(order),
    }));
};

export const mine = (routine: ItemRow, side: Side) => routine.who === side || routine.who === "both";

export const weeklyPattern = (actions: readonly ItemRow[]): { day: DayCode; label: string | null }[] => {
  const types = actions.filter((row) => row.kind === "day_type" && row.deleted_at === null).sort(order);
  return DAY_CODES.map((day) => ({
    day,
    label: types.find((row) => covers(dataOf(row).days, day))?.title ?? null,
  }));
};

export const dayLabel = (actions: readonly ItemRow[], date: string) => weeklyPattern(actions).find((entry) => entry.day === weekday(date))!.label;

export const keyFor = (who: ItemRow["who"], tapper: Side): Side => (who === "a" || who === "b" ? who : tapper);

export const count = (action: ItemRow, side: Side, today: string) => {
  const [done, value] = KEYS[side];
  const data = dataOf(action);
  return data[done] === today ? ((data[value] as number | undefined) ?? 0) : 0;
};

export const isDone = (action: ItemRow, side: Side, today: string) => {
  if (!COMPLETES.includes(action.kind)) return false;
  if (action.kind === "counter") return action.qty !== null && count(action, side, today) >= action.qty;
  return dataOf(action)[KEYS[side][0]] === today;
};

export const progress = (actions: readonly ItemRow[], side: Side, today: string) => {
  const open = actions.filter((row) => COMPLETES.includes(row.kind));
  return { done: open.filter((row) => isDone(row, side, today)).length, total: open.length };
};

export const mark = (action: ItemRow, side: Side, today: string): { data: Record<string, unknown> } | null => {
  if (!COMPLETES.includes(action.kind)) return null;
  const [done, value] = KEYS[side];
  return { data: action.kind === "counter" ? { [done]: today, [value]: count(action, side, today) + 1 } : { [done]: today } };
};

export const unmark = (action: ItemRow, side: Side): { data: Record<string, null> } | null => {
  if (!COMPLETES.includes(action.kind)) return null;
  const [done, value] = KEYS[side];
  return { data: action.kind === "counter" ? { [done]: null, [value]: null } : { [done]: null } };
};
