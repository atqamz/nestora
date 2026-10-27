import type { Side } from "../../shared/api.ts";
import { actionOccursOn, isDone, progress } from "../../shared/routines.ts";
import type { ItemRow } from "../../shared/tables.ts";

export type Page = ItemRow[];

export const pagesOf = (actions: readonly ItemRow[]): Page[] => {
  const found: Page[] = [];
  for (const action of actions) {
    if (action.kind === "block") continue;
    const last = found.at(-1);
    if (action.kind === "pack" && last?.[0].kind === "pack" && last[0].group_key === action.group_key) last.push(action);
    else found.push([action]);
  }
  return found;
};

const MIN_STEPS = 4;

export type Offer = "start" | "continue";

export const offerOf = (routine: ItemRow, actions: readonly ItemRow[], side: Side, day: string): Offer | null => {
  const todays = actions.filter((action) => actionOccursOn(routine, action, day));
  const open = todays.filter((action) => (action.kind === "step" || action.kind === "timer") && !isDone(action, side, day));
  if (!open.some((action) => action.kind === "timer" && typeof action.data?.minutes === "number") && open.length < MIN_STEPS) return null;
  return progress(todays, side, day).done > 0 ? "continue" : "start";
};

export const heldOffer = (now: Offer | null, held: Offer | null, release: boolean): Offer | null => (release ? null : (now ?? held));

export const isOpen = (page: Page, side: Side, day: string) => {
  const { done, total } = progress(page, side, day);
  return done < total;
};

export const openCount = (pages: readonly Page[], side: Side, day: string) => pages.filter((page) => isOpen(page, side, day)).length;

export const clampTo = (to: number, total: number) => Math.max(0, Math.min(to, total));

export const SETTLE_MS = 300;

export const settled = (since: number, now: number) => now - since >= SETTLE_MS;

export const hasWork = (pages: readonly Page[], side: Side, day: string) => pages.some((page) => progress(page, side, day).total > 0);

export const position = (pages: readonly Page[], side: Side, day: string, running: readonly string[] = []) => {
  const timed = pages.findIndex((page) => running.includes(page[0].id));
  if (timed >= 0) return timed;
  let at = pages.findIndex((page) => isOpen(page, side, day));
  if (at < 0) return pages.length;
  while (at > 0 && progress(pages[at - 1], side, day).total === 0) at--;
  return at;
};

export type Place = { id: string | null; rest: string[] };

export type Screen = { at: number; open: number } & ({ kind: "page"; page: Page } | { kind: "end" | "idle" });

export type Lead = "done" | "next" | "plus";

export const placeOf = (pages: readonly Page[], at: number): Place => ({ id: pages[at]?.[0].id ?? null, rest: pages.slice(at).flatMap((page) => page.map((row) => row.id)) });

const pageOf = (pages: readonly Page[], id: string) => pages.findIndex((page) => page.some((row) => row.id === id));

export const placeAt = (pages: readonly Page[], place: Place) => {
  if (place.id === null) return pages.length;
  return place.rest.map((id) => pageOf(pages, id)).find((at) => at >= 0) ?? pages.length;
};

export const follow = (pages: readonly Page[], place: Place): Place => {
  const next = placeOf(pages, placeAt(pages, place));
  return next.id === place.id && next.rest.join() === place.rest.join() ? place : next;
};

export const screenOf = (pages: readonly Page[], place: Place, side: Side, day: string): Screen => {
  const at = placeAt(pages, place);
  const open = openCount(pages, side, day);
  if (!hasWork(pages, side, day)) return { kind: "idle", at, open };
  return pages[at] === undefined ? { kind: "end", at, open } : { kind: "page", at, open, page: pages[at] };
};

export const leadOf = (action: ItemRow, side: Side, day: string): Lead => {
  if (isDone(action, side, day) || !["step", "timer", "counter"].includes(action.kind)) return "next";
  return action.kind === "counter" ? "plus" : "done";
};
