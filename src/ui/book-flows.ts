import type { Side } from "../../shared/api.ts";
import type { ItemRow } from "../../shared/tables.ts";
import { copiesAt, lastPlace, moveCopy, placesOf, restoreMove } from "../domain/places.ts";
import { reorder, sortAfter } from "../domain/order.ts";
import { fold } from "../domain/search.ts";
import { backToWishlist, weGotIt } from "../domain/wish.ts";
import type { Change } from "../domain/wish.ts";
import type { Store, Written } from "../store/store.ts";
import { failureOf } from "./failure.ts";
import { overlay } from "./overlay.ts";
import { text } from "./text.ts";

type Deps = {
  items: readonly ItemRow[];
  actions: Pick<Store, "create" | "update" | "remove" | "many" | "restore">;
  stamp: () => string;
  me: Side | null;
  go: (hash: string) => void;
};

const settled = (results: readonly Written[]): Written => {
  const [first] = results;
  return results.find((result) => !result.ok) ?? { ok: true, id: first?.ok ? first.id : "" };
};

const undoing = (work: () => Promise<Written[]>) => ({
  label: text.undo,
  run: () =>
    void work().then((results) => {
      const message = failureOf(settled(results));
      if (message.length > 0) overlay.announce(message.join(" "));
    }),
});

export const bookFlows = ({ items, actions, stamp, me, go }: Deps) => {
  const revive = (id: string) => actions.update("items", id, { deleted_at: null });

  const move = async (copy: ItemRow, placeId: string | null, name: string): Promise<Written> => {
    const patch = moveCopy(copy, placeId, stamp(), me);
    if (patch === null) return { ok: true, id: copy.id };
    const result = await actions.update("items", copy.id, patch);
    if (result.ok) overlay.announce(text.books.moved(name), undoing(async () => [await actions.update("items", copy.id, restoreMove(copy))]));
    return result;
  };

  const gotIt = async (book: ItemRow): Promise<Written> => {
    if (items.find((row) => row.id === book.id)?.status !== "wish") return { ok: true, id: book.id };
    const { book: patch, copy } = weGotIt(book, lastPlace(items));
    const held = items.some((row) => row.kind === "copy" && row.parent_id === book.id && row.status !== "gone");
    const [updated, ...made] = await Promise.all([actions.update("items", book.id, patch), ...(held ? [] : [actions.create("items", copy)])]);
    const created = made.flatMap((result) => (result.ok ? [result.id] : []));
    const wish = { status: "wish", who: book.who } as const;
    if (updated.ok && created.length === made.length) {
      overlay.announce(text.books.gotItDone(book.title), undoing(() => Promise.all([actions.update("items", book.id, wish), ...created.map((id) => actions.remove("items", id))])));
      return updated;
    }
    if (updated.ok) await actions.update("items", book.id, wish);
    await Promise.all(created.map((id) => actions.remove("items", id)));
    return settled([updated, ...made]);
  };

  const steps = (changes: readonly Change[]) => changes.map(({ id, change }) => ({ op: "update", table: "items", id, change }) as const);

  const lostIt = async (book: ItemRow): Promise<Written> => {
    if (items.find((row) => row.id === book.id)?.status !== "shelf") return { ok: true, id: book.id };
    const { moves, undo } = backToWishlist(book, items.filter((row) => row.kind === "copy" && row.parent_id === book.id), stamp());
    const result = await actions.many(steps(moves));
    if (result.ok) overlay.announce(text.books.lostItDone(book.title), undoing(async () => [await actions.many(steps(undo))]));
    return result.ok ? { ok: true, id: book.id } : result;
  };

  const removeBook = async (book: ItemRow, copies: readonly ItemRow[]): Promise<Written> => {
    const result = await actions.many([book, ...copies].map((row) => ({ op: "delete" as const, table: "items" as const, id: row.id })));
    if (result.ok) {
      go(book.status === "wish" ? "/wishlist" : "/books");
      overlay.announce(text.books.deleted(book.title), undoing(async () => [await actions.restore(book.id)]));
    }
    return result;
  };

  const restoreBook = (book: ItemRow) => actions.restore(book.id);

  const removeCopy = async (copy: ItemRow): Promise<Written> => {
    const result = await actions.remove("items", copy.id);
    if (result.ok) overlay.announce(text.books.copyRemoved, undoing(async () => [await revive(copy.id)]));
    return result;
  };

  const taken = (title: string, own?: string) => placesOf(items).some((place) => place.id !== own && fold(place.title) === fold(title));

  const duplicate: Written = { ok: false, errors: [text.books.placesPage.duplicate] };

  const addPlace = async (title: string): Promise<Written> =>
    taken(title) ? duplicate : actions.create("items", { kind: "place", title, sort: sortAfter(items.filter((row) => row.kind === "place")) });

  const renamePlace = async (place: ItemRow, title: string): Promise<Written> => (taken(title, place.id) ? duplicate : actions.update("items", place.id, { title }));

  const swapPlace = async (place: ItemRow, step: -1 | 1) =>
    settled(
      await Promise.all(
        reorder(
          items.filter((row) => row.kind === "place"),
          place.id,
          step,
        ).map(({ id, sort }) => actions.update("items", id, { sort })),
      ),
    );

  const deletePlace = async (place: ItemRow, target: ItemRow | null): Promise<Written> => {
    const copies = copiesAt(items, place.id);
    const moves = copies.flatMap((copy) => {
      const patch = moveCopy(copy, target?.id ?? null, stamp(), me);
      return patch === null ? [] : [{ copy, patch }];
    });
    const failed = (await Promise.all(moves.map(({ copy, patch }) => actions.update("items", copy.id, patch)))).find((result) => !result.ok);
    if (failed) return failed;
    const result = await actions.remove("items", place.id);
    if (result.ok) {
      const undo = async () => [await revive(place.id), ...(await Promise.all(moves.map(({ copy }) => actions.update("items", copy.id, restoreMove(copy)))))];
      overlay.announce(text.books.placesPage.deleted(place.title, copies.filter((copy) => copy.status !== "gone").length), undoing(undo));
    }
    return result;
  };

  return { move, gotIt, lostIt, removeBook, restoreBook, removeCopy, addPlace, renamePlace, swapPlace, deletePlace };
};
