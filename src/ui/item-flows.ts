import type { BudgetEntryRow, ItemRow } from "../../shared/tables.ts";
import type { Store, Written } from "../store/store.ts";
import { overlay } from "./overlay.ts";
import { views } from "./registry.ts";
import type { ViewName } from "./registry.ts";
import { undoing } from "./screen-save.ts";
import { text } from "./text.ts";

export type Row = ItemRow | BudgetEntryRow;

type Deps = { actions: Pick<Store, "update" | "remove">; go: (hash: string) => void };

export const backHref = (name: ViewName, row: Row) =>
  name === "payment"
    ? `#/money/${(row as BudgetEntryRow).budget_id}`
    : name === "book" && (row as ItemRow).status === "wish"
      ? "#/wishlist"
      : `#/${views[name].route}`;

export const instantFields = (name: ViewName): readonly ("status" | "who")[] => {
  const view = views[name] as { fields: readonly string[]; assignable?: true };
  return [...(view.fields.includes("status") ? (["status"] as const) : []), ...(view.assignable ? (["who"] as const) : [])];
};

export const sheetFields = (name: ViewName) => views[name].fields.filter((field) => !instantFields(name).some((own) => own === field));

export const instantChange = (name: ViewName, field: "status" | "who", value: string, today: string) => {
  const view = views[name] as { done?: string };
  if (field === "who") return { who: value === "" ? null : value };
  return view.done === undefined ? { status: value } : { status: value, done_on: value === view.done ? today : null };
};

export const restoreItem = (actions: Pick<Store, "update">, name: ViewName, row: Row): Promise<Written> =>
  actions.update(views[name].table, row.id, { deleted_at: null } as never);

export const removeItem = async ({ actions, go }: Deps, name: ViewName, row: Row): Promise<Written> => {
  const result = await actions.remove(views[name].table, row.id);
  if (result.ok) {
    go(backHref(name, row));
    overlay.announce(text.itemDeleted(row.title), undoing(() => restoreItem(actions, name, row)));
  }
  return result;
};
