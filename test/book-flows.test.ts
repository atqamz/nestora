import { test } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import type { ItemRow } from "../shared/tables.ts";
import { movable } from "../src/domain/shelf.ts";
import { bookFlows } from "../src/ui/book-flows.ts";
import { overlay } from "../src/ui/overlay.ts";
import { text } from "../src/ui/text.ts";
import { client, idOf } from "./store-client.ts";
import { createServer } from "./store-server.ts";

const DAY = "2026-10-19";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const world = async (t: TestContext, me: "a" | "b" = "a") => {
  t.after(() => overlay.dismissToast());
  overlay.dismissToast();
  const server = createServer();
  const { store } = client(server, me);
  await store.open();
  const calls: string[] = [];
  const hashes: string[] = [];
  const rows = () => store.getSnapshot().rows.items;
  const row = (id: string) => rows().find((candidate) => candidate.id === id)!;
  const flows = () =>
    bookFlows({
      items: rows(),
      actions: {
        create: store.create,
        update: (table, id, patch) => {
          calls.push(id);
          return store.update(table, id, patch);
        },
        remove: store.remove,
      },
      stamp: () => DAY,
      me,
      go: (hash) => hashes.push(hash),
    });
  const place = async (title: string, sort: number) => idOf(await store.create("items", { kind: "place", title, sort }));
  const book = async (title: string, fields: Record<string, unknown> = {}) => idOf(await store.create("items", { kind: "book", title, status: "shelf", ...fields }));
  const copy = async (parent: string, fields: Record<string, unknown> = {}) =>
    idOf(await store.create("items", { kind: "copy", parent_id: parent, title: "Laskar Pelangi", status: "here", who: "both", data: { format: "print" }, ...fields }));
  const undo = async () => {
    const toast = overlay.getSnapshot().toast;
    assert.ok(toast?.action, "the toast offers Undo");
    toast.action.run();
    overlay.dismissToast();
    await settle();
    await settle();
  };
  return { server, store, calls, hashes, rows, row, flows, place, book, copy, undo };
};

const toast = () => overlay.getSnapshot().toast;

test("a move writes the place, the previous place, the day and the mover, and the Undo puts all four back", async (t) => {
  const w = await world(t, "b");
  const home = await w.place("Home A", 0);
  const other = await w.place("Home B", 1);
  const book = await w.book("Laskar Pelangi");
  const copy = await w.copy(book, { group_key: home, data: { format: "print", was_at: other, moved_on: "2026-09-01", moved_by: "a" } });
  const before = w.row(copy);
  idOf(await w.flows().move(before, other, "Home B"));
  assert.deepEqual([w.row(copy).group_key, w.row(copy).data], [other, { format: "print", was_at: home, moved_on: DAY, moved_by: "b" }]);
  assert.equal(toast()?.message, text.books.moved("Home B"));
  await w.undo();
  assert.deepEqual([w.row(copy).group_key, w.row(copy).data], [home, { format: "print", was_at: other, moved_on: "2026-09-01", moved_by: "a" }]);
});

test("undoing a move of a copy that never moved clears the move marks", async (t) => {
  const w = await world(t);
  const home = await w.place("Home A", 0);
  const other = await w.place("Home B", 1);
  const copy = await w.copy(await w.book("Laskar Pelangi"), { group_key: home });
  idOf(await w.flows().move(w.row(copy), other, "Home B"));
  await w.undo();
  assert.deepEqual([w.row(copy).group_key, w.row(copy).data?.moved_on ?? null, w.row(copy).data?.moved_by ?? null, w.row(copy).data?.was_at ?? null], [home, null, null, null]);
});

test("moving a copy to where it already is changes nothing and offers no Undo", async (t) => {
  const w = await world(t);
  const home = await w.place("Home A", 0);
  const copy = await w.copy(await w.book("Laskar Pelangi"), { group_key: home });
  const rev = w.row(copy).updated_at;
  idOf(await w.flows().move(w.row(copy), home, "Home A"));
  assert.equal(toast(), null);
  assert.equal(w.row(copy).updated_at, rev);
});

test("We got it turns the wish into a shelf book with a copy at the last place, and Undo brings back the wish with its owner and drops the copy", async (t) => {
  const w = await world(t);
  const home = await w.place("Home A", 0);
  const wish = await w.book("Laskar Pelangi", { status: "wish", who: "b", data: { isbn: "9789793062792" } });
  idOf(await w.flows().gotIt(w.row(wish)));
  const made = w.rows().filter((row) => row.kind === "copy");
  assert.deepEqual([w.row(wish).status, w.row(wish).who, made.length, made[0].group_key, made[0].parent_id], ["shelf", null, 1, home, wish]);
  assert.equal(toast()?.message, text.books.gotItDone("Laskar Pelangi"));
  await w.undo();
  assert.deepEqual([w.row(wish).status, w.row(wish).who], ["wish", "b"]);
  assert.equal(w.rows().filter((row) => row.kind === "copy").length, 0);
});

test("a second We got it on a book that is already on the shelf makes no second copy", async (t) => {
  const w = await world(t);
  await w.place("Home A", 0);
  const wish = await w.book("Laskar Pelangi", { status: "wish", who: "b" });
  const stale = w.row(wish);
  idOf(await w.flows().gotIt(stale));
  idOf(await w.flows().gotIt(stale));
  assert.equal(w.rows().filter((row) => row.kind === "copy").length, 1);
});

test("when the copy cannot be created, We got it puts the wish back and reports the failure", async (t) => {
  const w = await world(t);
  const wish = await w.book("Laskar Pelangi", { status: "wish", who: "b" });
  const flows = bookFlows({
    items: w.rows(),
    actions: { create: async () => ({ ok: false, errors: ["no"] }), update: w.store.update, remove: w.store.remove },
    stamp: () => DAY,
    me: "a",
    go: () => undefined,
  });
  const result = await flows.gotIt(w.row(wish));
  assert.deepEqual(result, { ok: false, errors: ["no"] });
  assert.deepEqual([w.row(wish).status, w.row(wish).who], ["wish", "b"]);
  assert.equal(toast(), null);
});

test("deleting a book removes its copies and Undo revives the book before its copies", async (t) => {
  const w = await world(t);
  const home = await w.place("Home A", 0);
  const shelf = await w.book("Laskar Pelangi");
  const one = await w.copy(shelf, { group_key: home });
  const two = await w.copy(shelf, { group_key: home });
  const gone = [w.row(shelf), w.row(one), w.row(two)];
  idOf(await w.flows().removeBook(gone[0], gone.slice(1)));
  assert.deepEqual(w.hashes, ["/books"]);
  assert.deepEqual(w.rows().map((row) => row.id), [home]);
  assert.equal(toast()?.message, text.books.deleted("Laskar Pelangi"));
  w.calls.length = 0;
  await w.undo();
  assert.deepEqual(w.calls, [shelf, one, two]);
  assert.deepEqual(w.rows().map((row) => row.id).sort(), [home, shelf, one, two].sort());
});

test("deleting a wish goes back to the wishlist", async (t) => {
  const w = await world(t);
  const wish = await w.book("Bumi Manusia", { status: "wish" });
  idOf(await w.flows().removeBook(w.row(wish), []));
  assert.deepEqual(w.hashes, ["/wishlist"]);
  await w.undo();
  assert.equal(w.row(wish).status, "wish");
});

test("removing one copy can be undone", async (t) => {
  const w = await world(t);
  const copy = await w.copy(await w.book("Laskar Pelangi"));
  idOf(await w.flows().removeCopy(w.row(copy)));
  assert.equal(w.rows().some((row) => row.id === copy), false);
  assert.equal(toast()?.message, text.books.copyRemoved);
  await w.undo();
  assert.equal(w.row(copy).id, copy);
});

test("deleting a place moves its copies to the chosen place by the current partner, and Undo brings back the place and each copy's earlier marks", async (t) => {
  const w = await world(t, "b");
  const home = await w.place("Home A", 0);
  const other = await w.place("Home B", 1);
  const book = await w.book("Laskar Pelangi");
  const moved = await w.copy(book, { group_key: home, data: { format: "print", was_at: other, moved_on: "2026-09-01", moved_by: "a" } });
  const plain = await w.copy(book, { group_key: home });
  const kept = await w.copy(book, { group_key: other });
  const doomed = w.row(home);
  idOf(await w.flows().deletePlace(doomed, w.row(other)));
  assert.equal(w.rows().some((row) => row.id === home), false);
  for (const id of [moved, plain]) assert.deepEqual([w.row(id).group_key, w.row(id).data?.moved_on, w.row(id).data?.moved_by, w.row(id).data?.was_at], [other, DAY, "b", home]);
  assert.equal(w.row(kept).data?.moved_on, undefined);
  assert.equal(toast()?.message, text.books.placesPage.deleted("Home A", 2));
  await w.undo();
  assert.equal(w.row(home).id, home);
  assert.deepEqual([w.row(moved).group_key, w.row(moved).data], [home, { format: "print", was_at: other, moved_on: "2026-09-01", moved_by: "a" }]);
  assert.deepEqual([w.row(plain).group_key, w.row(plain).data?.moved_on ?? null, w.row(plain).data?.moved_by ?? null], [home, null, null]);
});

test("deleting a place that holds nothing moves nothing, and the toast counts only copies that are still around", async (t) => {
  const w = await world(t);
  const home = await w.place("Home A", 0);
  const empty = await w.place("Home B", 1);
  const copy = await w.copy(await w.book("Laskar Pelangi"), { group_key: home, status: "gone" });
  idOf(await w.flows().deletePlace(w.row(empty), null));
  assert.equal(toast()?.message, text.books.placesPage.deleted("Home B", 0));
  idOf(await w.flows().deletePlace(w.row(home), null));
  assert.equal(toast()?.message, text.books.placesPage.deleted("Home A", 0));
  assert.deepEqual([w.row(copy).group_key], [null]);
});

test("a place cannot take the name of another place, in any case or accent, when added or renamed", async (t) => {
  const w = await world(t);
  const home = await w.place("Home A", 0);
  const other = await w.place("Sibling's room", 1);
  assert.deepEqual(await w.flows().addPlace("  home a "), { ok: false, errors: [text.books.placesPage.duplicate] });
  assert.deepEqual(await w.flows().addPlace("SIBLINGS ROOM"), { ok: false, errors: [text.books.placesPage.duplicate] });
  assert.deepEqual(await w.flows().renamePlace(w.row(other), "Home A"), { ok: false, errors: [text.books.placesPage.duplicate] });
  assert.equal(w.rows().filter((row) => row.kind === "place").length, 2);
  idOf(await w.flows().renamePlace(w.row(home), "HOME A"));
  assert.equal(w.row(home).title, "HOME A");
  const added = idOf(await w.flows().addPlace("Home B"));
  assert.equal(w.row(added).sort > w.row(other).sort, true);
});

test("swapping two places exchanges their order", async (t) => {
  const w = await world(t);
  const one = await w.place("Home A", 0);
  const two = await w.place("Home B", 1);
  idOf(await w.flows().swapPlace(w.row(two), -1));
  assert.deepEqual([w.row(two).sort < w.row(one).sort], [true]);
});

test("only a copy that is here or borrowed, and not an ebook, can be moved", () => {
  const copy = (fields: Partial<ItemRow>) => ({ kind: "copy", status: "here", data: { format: "print" }, ...fields }) as ItemRow;
  assert.equal(movable(copy({})), true);
  assert.equal(movable(copy({ status: "borrowed" })), true);
  assert.equal(movable(copy({ status: "gone" })), false);
  assert.equal(movable(copy({ status: "lent" })), false);
  assert.equal(movable(copy({ data: { format: "ebook" } })), false);
  assert.equal(movable(copy({ data: null })), true);
});
