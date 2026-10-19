import { test } from "node:test";
import assert from "node:assert/strict";
import { moveCopy, restoreMove } from "../src/domain/places.ts";
import { readingPatch } from "../src/domain/reading.ts";
import { weGotIt } from "../src/domain/wish.ts";
import { createServer } from "./store-server.ts";
import { client, idOf } from "./store-client.ts";

const offline = async (side: "a" | "b") => {
  const server = createServer();
  const c = client(server, side);
  await c.store.open();
  server.control.down = true;
  return { server, ...c };
};

const seeded = async (side: "a" | "b") => {
  const c = await offline(side);
  const home = idOf(await c.store.create("items", { kind: "place", title: "Home A", sort: 0 }));
  const other = idOf(await c.store.create("items", { kind: "place", title: "Home B", sort: 1 }));
  const book = idOf(await c.store.create("items", { kind: "book", title: "Laskar Pelangi", status: "shelf", data: { author: "Partner A" } }));
  const copy = idOf(await c.store.create("items", { kind: "copy", parent_id: book, title: "Laskar Pelangi", status: "here", who: "both", group_key: home, data: { format: "print" } }));
  await c.store.sync();
  c.server.control.down = false;
  await c.store.sync();
  c.server.control.down = true;
  return { ...c, home, other, book, copy };
};

const rowOf = (store: Awaited<ReturnType<typeof seeded>>["store"], id: string) => store.getSnapshot().rows.items.find((row) => row.id === id)!;

for (const side of ["a", "b"] as const) {
  test(`a move made offline by partner ${side.toUpperCase()} shows their side at once and reaches the server with it`, async () => {
    const { server, store, copy, home, other } = await seeded(side);
    assert.equal(rowOf(store, copy).group_key, home);
    idOf(await store.update("items", copy, moveCopy(rowOf(store, copy), other, "2026-10-19")!));
    const shown = rowOf(store, copy);
    assert.deepEqual([shown.group_key, shown.updated_by, shown.data], [other, side, { format: "print", was_at: home, moved_on: "2026-10-19" }]);
    assert.equal(store.getSnapshot().pending, 1);
    server.control.down = false;
    await store.sync();
    assert.equal(store.getSnapshot().pending, 0);
    const stored = server.row("items", copy)!;
    assert.deepEqual([stored.group_key, stored.updated_by, stored.data], [other, side, { format: "print", was_at: home, moved_on: "2026-10-19" }]);
  });

  test(`partner ${side.toUpperCase()} reading state is written under their own keys and merges with the other partner's`, async () => {
    const { server, store, book, copy } = await seeded(side);
    const theirs = side === "a" ? "b" : "a";
    server.row("items", book)!.data = { author: "Partner A", [`reading_${theirs}`]: "want" };
    idOf(await store.update("items", book, readingPatch(rowOf(store, book), side, "reading", "2026-10-19")));
    server.control.down = false;
    await store.sync();
    assert.deepEqual(server.row("items", book)!.data, { author: "Partner A", [`reading_${side}`]: "reading", [`reading_${theirs}`]: "want" });
    assert.ok(server.row("items", copy));
  });
}

test("We got it and its copy leave in one request, and undoing both brings the wish back", async () => {
  const { server, store, book, home } = await seeded("a");
  idOf(await store.update("items", book, { status: "wish", who: "b" }));
  server.control.down = false;
  await store.sync();
  const before = server.seen.length;
  server.control.down = true;
  const wish = rowOf(store, book);
  const { book: patch, copy } = weGotIt(wish, home);
  const [updated, created] = await Promise.all([store.update("items", book, patch), store.create("items", copy)]);
  assert.equal(store.getSnapshot().pending, 2);
  server.control.down = false;
  await store.sync();
  const posts = server.seen.slice(before).filter((request) => request.method === "POST");
  assert.deepEqual(posts.map((request) => request.mutations), [2]);
  assert.deepEqual([server.row("items", book)!.status, server.row("items", book)!.who], ["shelf", null]);
  const copyId = idOf(created);
  assert.equal(server.row("items", copyId)!.parent_id, book);
  assert.ok(updated.ok);
  await Promise.all([store.update("items", book, { status: "wish", who: wish.who }), store.remove("items", copyId)]);
  await store.sync();
  assert.deepEqual([server.row("items", book)!.status, server.row("items", book)!.who], ["wish", "b"]);
  assert.notEqual(server.row("items", copyId)!.deleted_at, null);
});

test("undoing a move restores the old place and date in one update", async () => {
  const { store, server, copy, home, other } = await seeded("a");
  const before = rowOf(store, copy);
  idOf(await store.update("items", copy, moveCopy(before, other, "2026-10-19")!));
  idOf(await store.update("items", copy, restoreMove(before)));
  server.control.down = false;
  await store.sync();
  const stored = server.row("items", copy)!;
  assert.deepEqual([stored.group_key, stored.data], [home, { format: "print" }]);
});
