import type { Side } from "../../shared/api.ts";
import { ACTION_KINDS, DAY_CODES, TIMETABLE } from "../../shared/routines.ts";
import { isTime, isUrl } from "../../shared/validate.ts";
import type { DayCode } from "../../shared/routines.ts";
import { tables } from "../../shared/tables.ts";
import type { ItemRow } from "../../shared/tables.ts";
import type { Step } from "../store/store.ts";
import { bySort, sortAfter } from "./order.ts";

export type ActionKind = (typeof ACTION_KINDS)[number];

export type Who = "a" | "b" | "both";

export type ActionDraft = {
  id: string;
  kind: ActionKind;
  title: string;
  heading: string;
  days: DayCode[];
  note: string;
  url: string;
  minutes: string;
  qty: string;
  unit: string;
  start: string;
  end: string;
  where: string;
};

export type RoutineDraft = {
  title: string;
  who: Who;
  moment: string;
  days: DayCode[];
  every: string;
  from: string;
  pausedUntil: string;
  start: string;
  duration: string;
  private: boolean;
  actions: ActionDraft[];
};

export type Problem = { at: number | null; field: "title" | "days" | "from" | "minutes" | "qty" | "start" | "end" | "url" | "duration"; code: "required" | "number" | "days" | "from" | "order" | "time" | "url" | "long" };

export type Current = { routine: ItemRow; actions: readonly ItemRow[] };

export type Plan = { ok: true; id: string; steps: Step[]; names: string[] } | { ok: false; problems: Problem[]; gone: string[] };

type Dict = Record<string, unknown>;

export const KIND_FIELDS = {
  step: ["note", "url"],
  timer: ["minutes"],
  pack: [],
  block: ["start", "end", "where"],
  day_type: [],
  counter: ["qty", "unit"],
  text: [],
} as const satisfies Record<ActionKind, readonly (keyof ActionDraft)[]>;

const { caps } = tables.items.variants.step;

export const LIMITS = {
  title: caps.title,
  heading: caps.group_key,
  note: caps.note,
  where: tables.items.variants.block.caps["data.where"],
  unit: tables.items.variants.counter.caps["data.unit"],
  minutes: tables.items.variants.routine.caps["data.duration"],
};

const COPY_SUFFIX = " (copy)";

const NUMBER = /^\d{1,5}$/;

const text = (value: unknown) => (typeof value === "string" ? value : "");

const daysOf = (value: unknown): DayCode[] | null => (typeof value === "string" ? DAY_CODES.filter((code) => value.split(",").includes(code)) : null);

const daysString = (days: readonly DayCode[]) => (days.length === 0 || days.length === DAY_CODES.length ? null : DAY_CODES.filter((code) => days.includes(code)).join(","));

export const blankAction = (kind: ActionKind, id: string): ActionDraft => ({ id, kind, title: "", heading: "", days: [], note: "", url: "", minutes: "", qty: "", unit: "", start: "", end: "", where: "" });

export const blankDraft = (me: Side, moment = "morning"): RoutineDraft => ({ title: "", who: me, moment, days: [...DAY_CODES], every: "1", from: "", pausedUntil: "", start: "", duration: "", private: false, actions: [] });

const actionDraft = (row: ItemRow): ActionDraft => {
  const data = row.data ?? {};
  return {
    id: row.id,
    kind: row.kind as ActionKind,
    title: row.title,
    heading: row.group_key ?? "",
    days: daysOf(data.days) ?? [],
    note: row.note ?? "",
    url: text(data.url),
    minutes: data.minutes === undefined ? "" : String(data.minutes),
    qty: row.qty === null ? "" : String(row.qty),
    unit: text(data.unit),
    start: text(data.start_time),
    end: text(data.end_time),
    where: text(data.where),
  };
};

export const draftOf = (routine: ItemRow, children: readonly ItemRow[]): RoutineDraft => {
  const data = routine.data ?? {};
  return {
    title: routine.title,
    who: (routine.who ?? "both") as Who,
    moment: routine.group_key ?? "",
    days: daysOf(data.days) ?? [...DAY_CODES],
    every: text(data.every_weeks) || "1",
    from: text(data.from),
    pausedUntil: text(data.paused_until),
    start: text(data.start_time),
    duration: data.duration === undefined ? "" : String(data.duration),
    private: data.private === true,
    actions: [...children].sort(bySort).map(actionDraft),
  };
};

const copyTitle = (title: string) =>
  title.length + COPY_SUFFIX.length <= LIMITS.title ? title + COPY_SUFFIX : title.slice(0, LIMITS.title - COPY_SUFFIX.length).replace(/[\ud800-\udbff]$/, "") + COPY_SUFFIX;

export const copyDraft = (routine: ItemRow, children: readonly ItemRow[], newId: () => string): RoutineDraft => {
  const draft = draftOf(routine, children);
  return { ...draft, title: copyTitle(draft.title), pausedUntil: "", actions: draft.actions.map((action) => ({ ...action, id: newId() })) };
};

const dropNulls = (data: Dict) => Object.fromEntries(Object.entries(data).filter(([, value]) => value !== null));

const empty = (value: string) => value.trim() === "";

const actionProblems = (action: ActionDraft, at: number): Problem[] => {
  const found: Problem[] = [];
  if (empty(action.title)) found.push({ at, field: "title", code: "required" });
  if (action.kind === "timer" && !NUMBER.test(action.minutes.trim())) found.push({ at, field: "minutes", code: empty(action.minutes) ? "required" : "number" });
  if (action.kind === "timer" && NUMBER.test(action.minutes.trim()) && Number(action.minutes) < 1) found.push({ at, field: "minutes", code: "number" });
  if (action.kind === "counter" && (!NUMBER.test(action.qty.trim()) || Number(action.qty) < 1)) found.push({ at, field: "qty", code: empty(action.qty) ? "required" : "number" });
  if (action.kind === "step" && !empty(action.url) && !isUrl(action.url.trim())) found.push({ at, field: "url", code: "url" });
  if (action.kind === "block" && !isTime(action.start)) found.push({ at, field: "start", code: empty(action.start) ? "required" : "time" });
  if (action.kind === "block" && !empty(action.end) && !isTime(action.end)) found.push({ at, field: "end", code: "time" });
  if (action.kind === "block" && isTime(action.start) && isTime(action.end) && action.end <= action.start) found.push({ at, field: "end", code: "order" });
  return found;
};

const dated = (draft: RoutineDraft) => draft.moment.trim() !== TIMETABLE && !empty(draft.start);

const durationProblems = (minutes: string): Problem[] =>
  !/^\d+$/.test(minutes) || Number(minutes) < 1 ? [{ at: null, field: "duration", code: "number" }] : Number(minutes) > LIMITS.minutes ? [{ at: null, field: "duration", code: "long" }] : [];

const calendarProblems = (draft: RoutineDraft): Problem[] => [
  ...(dated(draft) && !isTime(draft.start) ? [{ at: null, field: "start", code: "time" } as const] : []),
  ...(dated(draft) && !empty(draft.duration) ? durationProblems(draft.duration.trim()) : []),
];

export const forTimetable = (draft: RoutineDraft, me: Side): RoutineDraft =>
  draft.moment === TIMETABLE ? { ...draft, who: draft.who === "both" ? me : draft.who, days: [...DAY_CODES] } : draft;

export const problemsOf = (draft: RoutineDraft): Problem[] => [
  ...(empty(draft.title) ? [{ at: null, field: "title", code: "required" } as const] : []),
  ...(draft.days.length === 0 ? [{ at: null, field: "days", code: "days" } as const] : []),
  ...(Number(draft.every) > 1 && empty(draft.from) ? [{ at: null, field: "from", code: "from" } as const] : []),
  ...calendarProblems(draft),
  ...draft.actions.flatMap(actionProblems),
];

const routineData = (draft: RoutineDraft): Dict => {
  const every = Number(draft.every) > 1;
  return {
    days: daysString(draft.days),
    every_weeks: every ? draft.every : null,
    from: every && !empty(draft.from) ? draft.from : null,
    paused_until: empty(draft.pausedUntil) ? null : draft.pausedUntil,
    start_time: dated(draft) ? draft.start : null,
    duration: dated(draft) && !empty(draft.duration) ? Number(draft.duration) : null,
  };
};

const blank = (value: string) => (empty(value) ? null : value.trim());

const actionColumns = (action: ActionDraft): Dict => ({
  title: action.title.trim(),
  group_key: blank(action.heading),
  ...(action.kind === "step" ? { note: blank(action.note) } : {}),
  ...(action.kind === "counter" ? { qty: Number(action.qty) } : {}),
});

const actionData = (action: ActionDraft): Dict => ({
  days: daysString(action.days),
  ...(action.kind === "step" ? { url: blank(action.url) } : {}),
  ...(action.kind === "timer" ? { minutes: Number(action.minutes) } : {}),
  ...(action.kind === "block" ? { start_time: action.start, end_time: blank(action.end), where: blank(action.where) } : {}),
  ...(action.kind === "counter" ? { unit: blank(action.unit) } : {}),
});

const changed = (next: Dict, was: Dict): Dict => Object.fromEntries(Object.entries(next).filter(([key, value]) => value !== was[key]));

const withData = (columns: Dict, data: Dict): Dict => ({ ...columns, ...(Object.keys(data).length > 0 ? { data } : {}) });

const routineChange = (draft: RoutineDraft, was: RoutineDraft): Dict =>
  withData(
    changed({ title: draft.title.trim(), who: draft.who, group_key: blank(draft.moment) }, { title: was.title.trim(), who: was.who, group_key: blank(was.moment) }),
    changed(routineData(draft), routineData(was)),
  );

const actionChange = (action: ActionDraft, was: ActionDraft): Dict => withData(changed(actionColumns(action), actionColumns(was)), changed(actionData(action), actionData(was)));

export const planOf = (draft: RoutineDraft, opened: Current | null, live: readonly ItemRow[], newId: () => string): Plan => {
  const was = opened === null ? null : draftOf(opened.routine, opened.actions);
  const before = new Map((was?.actions ?? []).map((action) => [action.id, action]));
  const alive = new Set(live.map((row) => row.id));
  const problems = problemsOf(draft);
  const gone = draft.actions.filter((action) => {
    const prior = before.get(action.id);
    return prior !== undefined && !alive.has(action.id) && Object.keys(actionChange(action, prior)).length > 0;
  });
  if (problems.length > 0 || gone.length > 0) return { ok: false, problems, gone: gone.map((action) => action.id) };
  const id = opened?.routine.id ?? newId();
  const title = draft.title.trim();
  const kept = new Set(draft.actions.map((action) => action.id));
  const moment = blank(draft.moment);
  const natural = [...(was?.actions ?? []).map((action) => action.id).filter((actionId) => kept.has(actionId)), ...draft.actions.map((action) => action.id).filter((actionId) => !before.has(actionId))];
  const moved = draft.actions.some((action, index) => action.id !== natural[index]);
  let next = sortAfter(live);
  const steps: Step[] = [];
  const names: string[] = [];
  const push = (step: Step, name: string) => (steps.push(step), names.push(name));
  if (was === null) {
    const created = { kind: "routine", title, who: draft.who, group_key: moment ?? undefined, data: dropNulls({ ...routineData(draft), private: draft.private ? true : null }) };
    push({ op: "create", table: "items", id, draft: created }, title);
  } else {
    const change = routineChange(draft, was);
    if (Object.keys(change).length > 0) push({ op: "update", table: "items", id, change }, title);
  }
  for (const [index, action] of draft.actions.entries()) {
    const name = action.title.trim();
    const prior = before.get(action.id);
    if (prior === undefined) {
      const created = Object.fromEntries(Object.entries({ ...actionColumns(action), sort: moved ? index : next++, kind: action.kind, parent_id: id }).filter(([, value]) => value !== null));
      push({ op: "create", table: "items", id: action.id, draft: { ...created, data: dropNulls(actionData(action)) } }, name);
      continue;
    }
    const change = { ...actionChange(action, prior), ...(moved ? { sort: index } : {}) };
    if (alive.has(action.id) && Object.keys(change).length > 0) push({ op: "update", table: "items", id: action.id, change }, name);
  }
  for (const row of opened?.actions ?? []) {
    if (!kept.has(row.id) && alive.has(row.id)) push({ op: "delete", table: "items", id: row.id }, row.title);
  }
  return { ok: true, id, steps, names };
};

export const savePlan = (draft: RoutineDraft, opened: Current | null, current: Current | null, newId: () => string): Plan => planOf(draft, opened, current?.actions ?? [], newId);
