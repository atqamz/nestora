import type { Side } from "../../shared/api.ts";
import { ACTION_KINDS, DAY_CODES } from "../../shared/routines.ts";
import type { DayCode } from "../../shared/routines.ts";
import { tables } from "../../shared/tables.ts";
import type { ItemRow } from "../../shared/tables.ts";
import type { Step } from "../store/store.ts";
import { bySort } from "./order.ts";

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
  private: boolean;
  actions: ActionDraft[];
};

export type Problem = { at: number | null; field: "title" | "days" | "from" | "minutes" | "qty" | "start" | "end"; code: "required" | "number" | "days" | "from" | "order" };

export type Current = { routine: ItemRow; actions: readonly ItemRow[] };

export type Plan = { ok: true; id: string; steps: Step[]; names: string[] } | { ok: false; problems: Problem[] };

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
};

const COPY_SUFFIX = " (copy)";

const NUMBER = /^\d{1,5}$/;

const text = (value: unknown) => (typeof value === "string" ? value : "");

const daysOf = (value: unknown): DayCode[] | null => (typeof value === "string" ? DAY_CODES.filter((code) => value.split(",").includes(code)) : null);

const daysString = (days: readonly DayCode[]) => (days.length === 0 || days.length === DAY_CODES.length ? null : DAY_CODES.filter((code) => days.includes(code)).join(","));

export const blankAction = (kind: ActionKind, id: string): ActionDraft => ({ id, kind, title: "", heading: "", days: [], note: "", url: "", minutes: "", qty: "", unit: "", start: "", end: "", where: "" });

export const blankDraft = (me: Side): RoutineDraft => ({ title: "", who: me, moment: "morning", days: [...DAY_CODES], every: "1", from: "", pausedUntil: "", private: false, actions: [] });

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
  if (action.kind === "block" && empty(action.start)) found.push({ at, field: "start", code: "required" });
  if (action.kind === "block" && !empty(action.start) && !empty(action.end) && action.end <= action.start) found.push({ at, field: "end", code: "order" });
  return found;
};

export const problemsOf = (draft: RoutineDraft): Problem[] => [
  ...(empty(draft.title) ? [{ at: null, field: "title", code: "required" } as const] : []),
  ...(draft.days.length === 0 ? [{ at: null, field: "days", code: "days" } as const] : []),
  ...(Number(draft.every) > 1 && empty(draft.from) ? [{ at: null, field: "from", code: "from" } as const] : []),
  ...draft.actions.flatMap(actionProblems),
];

const routineData = (draft: RoutineDraft): Dict => {
  const every = Number(draft.every) > 1;
  return {
    days: daysString(draft.days),
    every_weeks: every ? draft.every : null,
    from: every && !empty(draft.from) ? draft.from : null,
    paused_until: empty(draft.pausedUntil) ? null : draft.pausedUntil,
  };
};

const blank = (value: string) => (empty(value) ? null : value.trim());

const actionColumns = (action: ActionDraft, index: number): Dict => ({
  title: action.title.trim(),
  group_key: blank(action.heading),
  sort: index,
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

export const planOf = (draft: RoutineDraft, current: Current | null, newId: () => string): Plan => {
  const problems = problemsOf(draft);
  if (problems.length > 0) return { ok: false, problems };
  const id = current?.routine.id ?? newId();
  const title = draft.title.trim();
  const known = new Set((current?.actions ?? []).map((row) => row.id));
  const kept = new Set(draft.actions.map((action) => action.id));
  const moment = blank(draft.moment);
  const steps: Step[] = [];
  const names: string[] = [];
  const push = (step: Step, name: string) => (steps.push(step), names.push(name));
  if (current === null) {
    const created = { kind: "routine", title, who: draft.who, group_key: moment ?? undefined, data: dropNulls({ ...routineData(draft), private: draft.private ? true : null }) };
    push({ op: "create", table: "items", id, draft: created }, title);
  } else {
    push({ op: "update", table: "items", id, change: { title, who: draft.who, group_key: moment, data: routineData(draft) } }, title);
  }
  for (const [index, action] of draft.actions.entries()) {
    const columns = actionColumns(action, index);
    const name = action.title.trim();
    if (known.has(action.id)) {
      push({ op: "update", table: "items", id: action.id, change: { ...columns, data: actionData(action) } }, name);
    } else {
      const created = Object.fromEntries(Object.entries({ ...columns, kind: action.kind, parent_id: id }).filter(([, value]) => value !== null));
      push({ op: "create", table: "items", id: action.id, draft: { ...created, data: dropNulls(actionData(action)) } }, name);
    }
  }
  for (const row of current?.actions ?? []) {
    if (!kept.has(row.id)) push({ op: "delete", table: "items", id: row.id }, row.title);
  }
  return { ok: true, id, steps, names };
};
