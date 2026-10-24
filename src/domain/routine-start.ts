import type { Side } from "../../shared/api.ts";
import { isDone, progress } from "../../shared/routines.ts";
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

export type Place = { id: string | null; at: number };

export type Screen = { at: number; open: number } & ({ kind: "page"; page: Page } | { kind: "end" | "idle" });

export type Lead = "done" | "next" | "plus";

export const placeOf = (pages: readonly Page[], at: number): Place => ({ id: pages[at]?.[0].id ?? null, at });

export const placeAt = (pages: readonly Page[], place: Place) => {
  if (place.id === null) return pages.length;
  const found = pages.findIndex((page) => page.some((row) => row.id === place.id));
  return found >= 0 ? found : clampTo(place.at, pages.length);
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
