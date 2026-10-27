import type { Side } from "../../shared/api.ts";
import { actionOccursOn, dayLabel, isRoutineKind, isTimetable, keyFor, mine, occursOn, progress, scheduled, TIMETABLE, visible, weekDates, weeklyPattern } from "../../shared/routines.ts";
import type { DayCode } from "../../shared/routines.ts";
import type { ItemRow } from "../../shared/tables.ts";
import { bySort, compare } from "./order.ts";
import { inTimeOrder } from "./timetable.ts";

export const MOMENTS = ["morning", "on_demand", "evening", TIMETABLE] as const;

export type Owner = "mine" | "both" | "theirs";

export type Listing = { owner: Owner; moments: { key: string | null; routines: ItemRow[] }[] }[];

export type Block = { routine: ItemRow; actions: ItemRow[]; label: string | null; side: Side; progress: { done: number; total: number } };

export type Strip = { date: string; day: DayCode; label: string | null; today: boolean; done: boolean }[];

export type Run = { heading: string | null; actions: ItemRow[] };

const OWNERS: Owner[] = ["mine", "both", "theirs"];

const momentRank = (key: string | null) => (key === null ? MOMENTS.length + 1 : MOMENTS.includes(key as (typeof MOMENTS)[number]) ? MOMENTS.indexOf(key as (typeof MOMENTS)[number]) : MOMENTS.length);

const byMoment = (a: string | null, b: string | null) => momentRank(a) - momentRank(b) || compare(a ?? "", b ?? "");

const live = (rows: readonly ItemRow[]) => rows.filter((row) => row.deleted_at === null);

export const routineRows = (rows: readonly ItemRow[], me: Side | null) => visible(rows, me).filter((row) => isRoutineKind(row.kind));

export const routinesOf = (rows: readonly ItemRow[]) => live(rows).filter((row) => row.kind === "routine");

export const actionsOf = (rows: readonly ItemRow[], routine: ItemRow) => live(rows).filter((row) => row.parent_id === routine.id && row.kind !== "routine").sort(bySort);

export const ownerOf = (routine: ItemRow, me: Side): Owner => (routine.who === "both" ? "both" : routine.who === me ? "mine" : "theirs");

export const momentOf = (routine: ItemRow) => routine.group_key?.trim() || null;

export const listing = (routines: readonly ItemRow[], me: Side): Listing =>
  OWNERS.flatMap((owner) => {
    const own = routines.filter((routine) => ownerOf(routine, me) === owner);
    const keys = [...new Set(own.map(momentOf))].sort(byMoment);
    return own.length === 0 ? [] : [{ owner, moments: keys.map((key) => ({ key, routines: own.filter((routine) => momentOf(routine) === key).sort(bySort) })) }];
  });

export const todayBlocks = (rows: readonly ItemRow[], me: Side | null, day: string): Block[] =>
  me === null
    ? []
    : scheduled(rows, day)
        .filter(({ routine }) => mine(routine, me))
        .map(({ routine, actions }) => {
          const side = keyFor(routine.who, me);
          return { routine, actions: isTimetable(routine) ? inTimeOrder(actions) : actions, side, label: dayLabel(actions, day), progress: progress(actions, side, day) };
        })
        .sort((a, b) => byMoment(momentOf(a.routine), momentOf(b.routine)));

export const onDemand = (block: Block) => momentOf(block.routine) === "on_demand";

export const finished = ({ done, total }: Block["progress"]) => total > 0 && done === total;

export const sum = (blocks: readonly Block[]) => blocks.reduce((all, { progress }) => ({ done: all.done + progress.done, total: all.total + progress.total }), { done: 0, total: 0 });

export const tally = (blocks: readonly Block[]) => sum(blocks.filter((block) => !onDemand(block)));

export const allDone = (blocks: readonly Block[]) => finished(tally(blocks));

export type Seen = { day: string; known: ReadonlySet<string>; rested: ReadonlySet<string> };

export const unseen = (day: string): Seen => ({ day, known: new Set(), rested: new Set() });

export const see = (seen: Seen, blocks: readonly Block[], day: string): Seen => {
  if (seen.day !== day) return see(unseen(day), blocks, day);
  const fresh = blocks.filter(({ routine }) => !seen.known.has(routine.id));
  const reopened = new Set(blocks.filter(({ progress }) => !finished(progress)).map(({ routine }) => routine.id));
  const kept = [...seen.rested].filter((id) => !reopened.has(id));
  if (fresh.length === 0 && kept.length === seen.rested.size) return seen;
  return {
    day,
    known: new Set([...seen.known, ...fresh.map(({ routine }) => routine.id)]),
    rested: new Set([...kept, ...fresh.filter(({ progress }) => finished(progress)).map(({ routine }) => routine.id)]),
  };
};

export const sections = (blocks: readonly Block[], rested: ReadonlySet<string>) => ({
  open: blocks.filter((block) => !onDemand(block) && !rested.has(block.routine.id)),
  done: blocks.filter((block) => !onDemand(block) && rested.has(block.routine.id)),
  needed: blocks.filter(onDemand),
});

export const runs = (actions: readonly ItemRow[]): Run[] => {
  const found: Run[] = [];
  for (const action of actions) {
    const heading = action.group_key?.trim() || null;
    const last = found.at(-1);
    if (last !== undefined && last.heading === heading) last.actions.push(action);
    else found.push({ heading, actions: [action] });
  }
  return found;
};

export const weekStrip = (routine: ItemRow, actions: readonly ItemRow[], day: string, side: Side): Strip | null => {
  if (!actions.some((row) => row.kind === "day_type")) return null;
  const pattern = weeklyPattern(actions);
  const { done, total } = progress(actions.filter((action) => actionOccursOn(routine, action, day)), side, day);
  return weekDates(day).map((date, index) => ({
    date,
    day: pattern[index].day,
    label: occursOn(routine, date) ? pattern[index].label : null,
    today: date === day,
    done: date === day && total > 0 && done === total,
  }));
};
