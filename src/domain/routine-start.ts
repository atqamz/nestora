import type { Side } from "../../shared/api.ts";
import { progress } from "../../shared/routines.ts";
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

export const position = (pages: readonly Page[], side: Side, day: string) => {
  let at = pages.findIndex((page) => isOpen(page, side, day));
  if (at < 0) return pages.length;
  while (at > 0 && progress(pages[at - 1], side, day).total === 0) at--;
  return at;
};
