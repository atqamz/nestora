import { test } from "node:test";
import assert from "node:assert/strict";
import type { ItemRow } from "../shared/tables.ts";
import { saveBook } from "../src/ui/book-save.ts";
import type { BookInput } from "../src/ui/book-save.ts";
import { overlay } from "../src/ui/overlay.ts";
import { text } from "../src/ui/text.ts";
import { client, idOf } from "./store-client.ts";
import { createServer } from "./store-server.ts";

const blank: BookInput = { kind: "shelf", title: "Laskar Pelangi", author: "", original: "", isbn: "", language: "", blurb: "", cover: "", ol: "", gb: "", ownerPick: null, placePick: null };

const world = async (me: "a" | "b" = "a") => {
  const { store } = client(createServer(), me);
  await store.open();
  const rows = () => store.getSnapshot().rows.items;
  const save = (input: Partial<BookInput>) => saveBook(rows(), store.create, { ...blank, ...input }, me);
  const place = async (title: string, sort: number) => idOf(await store.create("items", { kind: "place", title, sort }));
  const books = () => rows().filter((row) => row.kind === "book");
  const copies = () => rows().filter((row) => row.kind === "copy");
  return { store, rows, save, place, books, copies };
};

test("a shelf save writes a shelf book and one copy that carries the title, owner and place", async () => {
  const w = await world();
  const home = await w.place("Home A", 0);
  const result = await w.save({ ownerPick: "b", placePick: home });
  assert.ok(result.ok);
  const [book] = w.books();
  const [copy] = w.copies();
  assert.deepEqual([book.status, book.who, book.title], ["shelf", null, "Laskar Pelangi"]);
  assert.deepEqual([copy.parent_id, copy.title, copy.status, copy.who, copy.group_key, copy.data?.format], [book.id, "Laskar Pelangi", "here", "b", home, "print"]);
  assert.equal(result.ok && result.id, copy.id);
});

test("a wish save writes one wish book with the owner and no copy", async () => {
  const w = await world("b");
  const result = await w.save({ kind: "wish", title: "Bumi Manusia" });
  assert.ok(result.ok);
  const [book] = w.books();
  assert.deepEqual([book.status, book.who, w.copies().length], ["wish", "b", 0]);
  await w.save({ kind: "wish", title: "The Little Prince", ownerPick: "both" });
  assert.equal(w.books().find((row) => row.title === "The Little Prince")?.who, "both");
});

test("the owner defaults to both on the shelf and to the saver on the wishlist", async () => {
  const a = await world("a");
  await a.save({});
  assert.equal(a.copies()[0].who, "both");
  await a.save({ kind: "wish", title: "Bumi Manusia" });
  assert.equal(a.books().find((row) => row.status === "wish")?.who, "a");
  assert.equal((await world("b").then(async (w) => (await w.save({ kind: "wish" }), w.books()[0].who))), "b");
});

test("the place defaults to the first place, then to the last used one, and to none when there is no place", async () => {
  const none = await world();
  await none.save({});
  assert.equal(none.copies()[0].group_key, null);
  const w = await world();
  const first = await w.place("Home A", 0);
  await w.save({});
  assert.equal(w.copies()[0].group_key, first);
  const other = await world();
  await other.place("Home A", 0);
  const sibling = await other.place("Sibling's room", 1);
  await other.store.create("items", { kind: "copy", parent_id: idOf(await other.store.create("items", { kind: "book", title: "Bumi Manusia", status: "shelf" })), title: "Bumi Manusia", status: "here", who: "both", group_key: sibling });
  await other.save({});
  assert.equal(other.copies().find((row) => row.title === "Laskar Pelangi")?.group_key, sibling);
  const home = other.rows().find((row) => row.title === "Home A")!.id;
  await other.save({ title: "The Little Prince", placePick: home });
  assert.equal(other.copies().find((row) => row.title === "The Little Prince")?.group_key, home);
});

test("the ISBN is stored as ISBN-13 on the book and on the copy, and is left out when empty", async () => {
  const w = await world();
  await w.save({ isbn: "ISBN 0-15-601219-7", author: " Antoine ", original: "Le Petit Prince" });
  const [book] = w.books();
  const [copy] = w.copies();
  assert.deepEqual(book.data, { author: "Antoine", original_title: "Le Petit Prince", isbn: "9780156012195" });
  assert.deepEqual(copy.data, { format: "print", isbn: "9780156012195" });
  const plain = await world();
  await plain.save({});
  assert.deepEqual(plain.books()[0].data, {});
});

test("an empty title or a wrong ISBN is refused and writes nothing", async () => {
  const w = await world();
  const empty = await w.save({ title: "   " });
  assert.deepEqual(empty, { ok: false, errors: [text.books.sheet.needTitle] });
  const wrong = await w.save({ isbn: "9780156012196" });
  assert.deepEqual(wrong, { ok: false, errors: [text.invalid.isbn] });
  assert.equal(w.rows().filter((row: ItemRow) => row.kind === "book" || row.kind === "copy").length, 0);
});

test("a saved book clears the one shared draft for both sheets, a refused save keeps it", async () => {
  const w = await world();
  const book = { kind: "wish" as const, title: "Draft Leak Probe", author: "", original: "", isbn: "", language: "", blurb: "", found: null, ownerPick: null, placePick: null };
  const sheet = { input: "Draft Leak Probe", kindPick: "book" as const, ignore: [], edits: {}, ownerPick: null };
  overlay.keepBook(book);
  overlay.keepDraft(sheet);
  await w.save({ title: "" });
  assert.deepEqual([overlay.keptBook(), overlay.keptDraft()], [book, sheet]);
  await w.save({ kind: "wish", title: "Draft Leak Probe" });
  assert.deepEqual([overlay.keptBook(), overlay.keptDraft()], [null, null]);
});

test("a write the store refuses keeps the draft and reports the failure", async () => {
  const w = await world();
  const sheet = { input: "Laskar Pelangi", kindPick: "book" as const, ignore: [], edits: {}, ownerPick: null };
  overlay.keepDraft(sheet);
  const refused = { ok: false as const, errors: ["row: refused"] };
  assert.deepEqual(await saveBook(w.rows(), async () => refused, blank, "a"), refused);
  assert.equal(overlay.keptDraft(), sheet);
  let calls = 0;
  const half = async (...args: Parameters<typeof w.store.create>) => (++calls === 1 ? w.store.create(...args) : refused);
  assert.deepEqual(await saveBook(w.rows(), half, blank, "a"), refused);
  assert.equal(overlay.keptDraft(), sheet);
  overlay.keepDraft(null);
});

const found = { language: "id", blurb: "  A school\n  on an island.\r\n", cover: "https://covers.openlibrary.org/b/id/7079796-M.jpg", ol: "OL15302003W" };

test("a book picked from Open Library keeps its cover, work, language and one-line description, and the copy takes the language", async () => {
  const w = await world();
  const result = await w.save({ ...found, author: "Andrea Hirata", isbn: "9789793062792" });
  assert.ok(result.ok);
  const [book] = w.books();
  const [copy] = w.copies();
  assert.deepEqual(book.data, { author: "Andrea Hirata", isbn: "9789793062792", language: "id", blurb: "A school on an island.", cover: found.cover, ol: "OL15302003W" });
  assert.deepEqual(copy.data, { format: "print", isbn: "9789793062792", language: "id" });
});

test("a wish keeps the same details and creates no copy", async () => {
  const w = await world();
  assert.ok((await w.save({ ...found, kind: "wish" })).ok);
  assert.equal(w.books()[0].data?.cover, found.cover);
  assert.equal(w.copies().length, 0);
});

test("a book typed by hand stores no cover, work, language or description, and an empty language is left out of the copy", async () => {
  const w = await world();
  assert.ok((await w.save({ blurb: "   " })).ok);
  assert.deepEqual(w.books()[0].data, {});
  assert.deepEqual(w.copies()[0].data, { format: "print" });
});

test("a cover from any other host is refused and nothing is saved", async () => {
  const w = await world();
  for (const cover of ["https://example.com/b/id/1-M.jpg", "http://covers.openlibrary.org/b/id/1-M.jpg", "javascript:alert(1)"]) {
    const result = await w.save({ cover });
    assert.equal(result.ok, false, cover);
    assert.match(result.ok ? "" : result.errors.join(" "), /data\.cover: must be an https URL on covers\.openlibrary\.org/);
  }
  assert.equal(w.books().length, 0);
});

test("a description over 2000 characters is refused with the field's name", async () => {
  const w = await world();
  const result = await w.save({ blurb: "x".repeat(2001) });
  assert.match(result.ok ? "" : result.errors.join(" "), /data\.blurb/);
  assert.equal(w.books().length, 0);
});
