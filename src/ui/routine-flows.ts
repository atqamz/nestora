import type { Side } from "../../shared/api.ts";
import { isDone, keyFor, mark, unmark } from "../../shared/routines.ts";
import type { ItemRow } from "../../shared/tables.ts";
import { actionsOf } from "../domain/routines.ts";
import type { Store, Written } from "../store/store.ts";
import { paused } from "../store/store.ts";
import { failureOf } from "./failure.ts";
import { overlay } from "./overlay.ts";
import { text } from "./text.ts";

type Deps = {
  items: readonly ItemRow[];
  actions: Pick<Store, "update" | "many">;
  me: Side | null;
  day: string;
  go: (hash: string) => void;
};

const done: Written = { ok: true, id: "" };

export const routineFlows = ({ items, actions, me, day, go }: Deps) => {
  const write = (routine: ItemRow, action: ItemRow, patch: (action: ItemRow, side: Side, day: string) => { data: Record<string, unknown> } | null) => {
    if (me === null) return Promise.resolve(paused);
    const change = patch(action, keyFor(routine.who, me), day);
    return change === null ? Promise.resolve(done) : actions.update("items", action.id, change);
  };

  const toggle = (routine: ItemRow, action: ItemRow) => write(routine, action, (row, side, day) => (isDone(row, side, day) ? unmark(row, side) : mark(row, side, day)));

  const plus = (routine: ItemRow, action: ItemRow) => write(routine, action, mark);

  const reset = (routine: ItemRow, action: ItemRow) => write(routine, action, unmark);

  const pause = async (routine: ItemRow, until: string): Promise<Written> =>
    until <= day ? { ok: false, errors: [text.routines.pauseLater] } : actions.update("items", routine.id, { data: { paused_until: until } });

  const resume = (routine: ItemRow) => actions.update("items", routine.id, { data: { paused_until: null } });

  const save = async (steps: Parameters<Store["many"]>[0], created: string | null): Promise<Written> => {
    const result = await actions.many(steps);
    if (result.ok && created !== null) go(`/routines/${created}`);
    return result;
  };

  const revive = (ids: readonly string[]) => actions.many(ids.map((id) => ({ op: "update" as const, table: "items" as const, id, change: { deleted_at: null } })));

  const restore = (routine: ItemRow, rows: readonly ItemRow[]) => revive([routine.id, ...rows.map((action) => action.id)]);

  const remove = async (routine: ItemRow): Promise<Written> => {
    const ids = [routine.id, ...actionsOf(items, routine).map((action) => action.id)];
    const result = await actions.many(ids.map((id) => ({ op: "delete" as const, table: "items" as const, id })));
    if (result.ok) {
      go("/routines");
      overlay.announce(text.routines.deleted(routine.title), {
        label: text.undo,
        run: () =>
          void revive(ids).then((back) => {
            const message = failureOf(back);
            if (message.length > 0) overlay.announce(message.join(" "));
          }),
      });
    }
    return result;
  };

  return { toggle, plus, reset, pause, resume, save, remove, restore };
};

export type Flows = ReturnType<typeof routineFlows>;
