import type { ItemRow } from "../../shared/tables.ts";
import { copiesAt, lastPlace, moveCopy, restoreMove } from "../domain/places.ts";
import { reorder, sortAfter } from "../domain/order.ts";
import { weGotIt } from "../domain/wish.ts";
import { useStamp } from "../hooks/use-plan.ts";
import { actions, useTable } from "../hooks/use-store.ts";
import type { Written } from "../hooks/use-store.ts";
import { failureOf } from "./failure.ts";
import { overlay } from "./overlay.ts";
import { text } from "./text.ts";

const settled = (results: readonly Written[]): Written => {
  const [first] = results;
  return results.find((result) => !result.ok) ?? { ok: true, id: first?.ok ? first.id : "" };
};

const revive = (id: string) => actions.update("items", id, { deleted_at: null });

const undoing = (work: () => Promise<Written[]>) => ({
  label: text.undo,
  run: () =>
    void work().then((results) => {
      const message = failureOf(settled(results));
      if (message.length > 0) overlay.announce(message.join(" "));
    }),
});

export const useBookActions = () => {
  const items = useTable("items");
  const stamp = useStamp();

  const move = async (copy: ItemRow, placeId: string | null, name: string): Promise<Written> => {
    const patch = moveCopy(copy, placeId, stamp());
    if (patch === null) return { ok: true, id: copy.id };
    const result = await actions.update("items", copy.id, patch);
    if (result.ok) overlay.announce(text.books.moved(name), undoing(async () => [await actions.update("items", copy.id, restoreMove(copy))]));
    return result;
  };

  const gotIt = async (book: ItemRow): Promise<Written> => {
    const { book: patch, copy } = weGotIt(book, lastPlace(items));
    const [updated, created] = await Promise.all([actions.update("items", book.id, patch), actions.create("items", copy)]);
    const wish = { status: "wish", who: book.who } as const;
    if (updated.ok && created.ok) {
      overlay.announce(text.books.gotItDone(book.title), undoing(() => Promise.all([actions.update("items", book.id, wish), actions.remove("items", created.id)])));
      return updated;
    }
    if (updated.ok) await actions.update("items", book.id, wish);
    if (created.ok) await actions.remove("items", created.id);
    return settled([updated, created]);
  };

  const removeBook = async (book: ItemRow, copies: readonly ItemRow[]): Promise<Written> => {
    const result = settled(await Promise.all([...copies.map((copy) => actions.remove("items", copy.id)), actions.remove("items", book.id)]));
    if (result.ok) {
      location.hash = book.status === "wish" ? "/wishlist" : "/books";
      const undo = async () => [await revive(book.id), ...(await Promise.all(copies.map((copy) => revive(copy.id))))];
      overlay.announce(text.books.deleted(book.title), undoing(undo));
    }
    return result;
  };

  const removeCopy = async (copy: ItemRow): Promise<Written> => {
    const result = await actions.remove("items", copy.id);
    if (result.ok) overlay.announce(text.books.copyRemoved, undoing(async () => [await revive(copy.id)]));
    return result;
  };

  const addPlace = (title: string) => actions.create("items", { kind: "place", title, sort: sortAfter(items.filter((row) => row.kind === "place")) });

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
      const patch = moveCopy(copy, target?.id ?? null, stamp());
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

  return { move, gotIt, removeBook, removeCopy, addPlace, swapPlace, deletePlace };
};
