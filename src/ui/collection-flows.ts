import type { ItemRow, Patch } from "../../shared/tables.ts";
import { collectionName, collections, joinPatch, leavePatch, moveOrders, nameTaken, parseCollection, renameTargets, restoreCollection, restoreName, restoreOrder } from "../domain/collection.ts";
import type { ScreenKind } from "../domain/screen.ts";
import { fold } from "../domain/search.ts";
import type { Store, Written } from "../store/store.ts";
import { overlay } from "./overlay.ts";
import { undoing } from "./screen-save.ts";
import { text } from "./text.ts";

type Deps = { items: () => readonly ItemRow[]; actions: Pick<Store, "update" | "many"> };

const words = text.screen.collection;

const refuse = (message: string): Written => ({ ok: false, errors: [message] });

const done = (id: string): Written => ({ ok: true, id });

const steps = (changes: readonly { id: string; patch: Patch<"items"> }[]) => changes.map(({ id, patch }) => ({ op: "update", table: "items", id, change: patch }) as const);

export const moveMember = async ({ items, actions }: Deps, kind: ScreenKind, row: ItemRow, step: -1 | 1): Promise<Written> => {
  const rows = items();
  const group = collections(rows, kind).find(({ rows: members }) => members.some((member) => member.id === row.id));
  const moves = group === undefined ? [] : moveOrders(group.rows, row.id, step);
  if (group === undefined || moves.length === 0) return done(row.id);
  const before = new Map(group.rows.map((member) => [member.id, member]));
  const result = await actions.many(steps(moves.map(({ id, order }) => ({ id, patch: { data: { order } } }))));
  if (result.ok) {
    const after = collections(items(), kind).find(({ key }) => key === group.key);
    const position = (after?.rows.findIndex((member) => member.id === row.id) ?? -1) + 1;
    overlay.announce(
      words.moved(row.title, position, group.rows.length),
      undoing(() => actions.many(steps(moves.map(({ id }) => ({ id, patch: restoreOrder(before.get(id)!) }))))),
    );
  }
  return result;
};

export const renameCollection = async ({ items, actions }: Deps, kind: ScreenKind, from: string, raw: string): Promise<Written> => {
  const name = parseCollection(raw);
  if (!name.ok || name.value === null) return refuse(words.invalid);
  const rows = items();
  if (nameTaken(rows, kind, from, name.value)) return refuse(words.taken);
  const targets = renameTargets(rows, kind, from, name.value);
  if (targets.length === 0) return done("");
  const result = await actions.many(steps(targets.map(({ id }) => ({ id, patch: { data: { collection: name.value } } }))));
  if (result.ok) {
    overlay.announce(
      words.renamed(from, name.value),
      undoing(() => actions.many(steps(targets.map((target) => ({ id: target.id, patch: restoreName(target) }))))),
    );
  }
  return result;
};

export const setCollection = async ({ items, actions }: Deps, kind: ScreenKind, row: ItemRow, raw: string): Promise<Written> => {
  const name = parseCollection(raw);
  if (!name.ok) return refuse(words.invalid);
  const rows = items();
  const live = rows.find((candidate) => candidate.id === row.id) ?? row;
  const current = collectionName(live);
  if (name.value === null ? current === null : current !== null && fold(current) === fold(name.value)) return done(row.id);
  const patch = name.value === null ? leavePatch : joinPatch(rows, kind, name.value);
  const result = await actions.update("items", row.id, patch);
  if (result.ok) {
    const label = name.value === null ? words.left(row.title, current ?? "") : words.joined(row.title, String(patch.data?.collection));
    overlay.announce(label, undoing(() => actions.update("items", row.id, restoreCollection(live))));
  }
  return result;
};
