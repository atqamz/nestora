import type { ItemRow } from "../../shared/tables.ts";
import { sortBefore } from "../domain/order.ts";
import { parseYear } from "../domain/screen.ts";
import type { ScreenKind } from "../domain/screen.ts";
import type { Store, Written } from "../store/store.ts";
import { failureOf } from "./failure.ts";
import { overlay } from "./overlay.ts";
import { views } from "./registry.ts";
import { text } from "./text.ts";

export type ScreenInput = { kind: ScreenKind; title: string; year: string; status: "want" | "watched"; who: "a" | "b" | "both" };

export const saveScreen = async (items: readonly ItemRow[], create: Store["create"], input: ScreenInput, today: string): Promise<Written> => {
  const title = input.title.trim();
  if (title === "") return { ok: false, errors: [text.screen.sheet.needTitle] };
  const year = parseYear(input.year);
  if (!year.ok) return { ok: false, errors: [text.screen.sheet.badYear] };
  return create("items", {
    kind: input.kind,
    title,
    status: input.status,
    who: input.who,
    ...(input.status === "watched" ? { done_on: today } : {}),
    sort: sortBefore(items.filter((row) => row.kind === input.kind && row.status === input.status)),
    data: year.value === null ? {} : { year: year.value },
  });
};

type Deps = { actions: Pick<Store, "update" | "remove">; go: (hash: string) => void };

export const removeScreen = async ({ actions, go }: Deps, row: ItemRow, kind: ScreenKind): Promise<Written> => {
  const result = await actions.remove("items", row.id);
  if (result.ok) {
    go(`/${views[kind].route}`);
    overlay.announce(text.screen.deleted(row.title), {
      label: text.undo,
      run: () =>
        void actions.update("items", row.id, { deleted_at: null }).then((undone) => {
          const message = failureOf(undone);
          if (message.length > 0) overlay.announce(message.join(" "));
        }),
    });
  }
  return result;
};
