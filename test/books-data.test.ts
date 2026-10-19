import { test } from "node:test";
import assert from "node:assert/strict";
import { tables } from "../shared/tables.ts";
import { validateCreate, validatePatch } from "../shared/validate.ts";
import { CLIENT_STAMP, NOW, STAMP, apply, count, createDb, id, mutation, stored, task } from "./sync-db.ts";

type Obj = Record<string, unknown>;

const stamps = { created_at: CLIENT_STAMP, updated_at: CLIENT_STAMP };

const place = (n: number, extra: Obj = {}) => mutation("create", "items", id(n), { id: id(n), kind: "place", title: "Home A", ...stamps, ...extra });
const book = (n: number, extra: Obj = {}) => mutation("create", "items", id(n), { id: id(n), kind: "book", title: "Laskar Pelangi", status: "shelf", ...stamps, ...extra });
const copy = (n: number, parent: number, extra: Obj = {}) =>
  mutation("create", "items", id(n), { id: id(n), kind: "copy", parent_id: id(parent), title: "Laskar Pelangi", status: "here", who: "both", ...stamps, ...extra });

const accepts = (m: { patch: Obj }) => assert.deepEqual(validateCreate("items", m.patch), []);
const rejects = (m: { patch: Obj }, pattern: RegExp) => assert.match(validateCreate("items", m.patch).join("\n"), pattern);

const rejected = async (promise: ReturnType<typeof apply>, status: number, pattern: RegExp) => {
  const result = (await promise) as { status: number; errors: string[] };
  assert.equal(result.status, status);
  assert.match(result.errors.join("\n"), pattern);
};

test("the registry lists book, copy and place after the older kinds", () => {
  assert.deepEqual(Object.keys(tables.items.variants), ["task", "vendor", "guest", "book", "copy", "place"]);
});

test("a full book, copy and place pass the validator", () => {
  accepts(place(1, { sort: 2, note: "top shelf" }));
  accepts(
    book(2, {
      group_key: "Classics",
      who: "a",
      amount: 98000,
      note: "why we want it",
      data: {
        author: "Andrea Hirata",
        original_title: "Laskar Pelangi",
        series: "Tetralogi Laskar Pelangi",
        series_no: 1,
        isbn: "9789793062792",
        language: "id",
        cover: "https://covers.openlibrary.org/b/id/1-M.jpg",
        blurb: "A short synopsis.",
        ol: "OL1W",
        gb: "abc",
        public_rating: "4.1",
        priority: "high",
        gift: true,
        shop: "Bookshop",
        shop_url: "https://example.test/book",
        reading_a: "read",
        rating_a: "5",
        finished_a: "2026-03-12",
        reading_b: "want",
        rating_b: "3",
        finished_b: "2026-04-01",
        import_batch: "batch-1",
      },
    }),
  );
  accepts(
    copy(3, 2, {
      group_key: id(1),
      due_on: "2026-11-01",
      data: {
        isbn: "9789793062792",
        language: "id",
        format: "print",
        publisher: "Bentang",
        year: 2005,
        lent_to: "Partner B",
        lent_on: "2026-10-02",
        from: "Sibling",
        moved_on: "2026-10-19",
        was_at: id(1),
        import_batch: "batch-1",
      },
    }),
  );
});

test("an isbn is 13 digits with a valid check digit and nothing else", () => {
  accepts(book(2, { data: { isbn: "9780156012195" } }));
  accepts(copy(3, 2, { data: { isbn: "9789799731234" } }));
  for (const bad of ["9789793062793", "0156012197", "978-979-3062-79-2", "978979306279", "97897930627921", "978979306279X", " 9789793062792"]) {
    rejects(book(2, { data: { isbn: bad } }), /data\.isbn: must be an ISBN-13/);
    rejects(copy(3, 2, { data: { isbn: bad } }), /data\.isbn: must be an ISBN-13/);
  }
});

test("book and copy statuses, copy parent and done date, and the unused columns are enforced", () => {
  rejects(book(2, { status: "owned" }), /status: must be one of wish, shelf/);
  rejects(book(2, { status: undefined }), /status: required for kind book/);
  rejects(book(2, { parent_id: id(9) }), /parent_id: not used by kind book/);
  rejects(book(2, { due_on: "2026-11-01" }), /due_on: not used by kind book/);
  rejects(copy(3, 2, { status: "kept" }), /status: must be one of here, lent, borrowed, gone/);
  rejects(copy(3, 2, { parent_id: undefined }), /parent_id: required for kind copy/);
  rejects(copy(3, 2, { done_on: "2026-11-01" }), /done_on: only allowed when status is gone/);
  accepts(copy(3, 2, { status: "gone", done_on: "2026-11-01" }));
  accepts(copy(3, 2, { status: "borrowed", who: null }));
  rejects(place(1, { status: "here" }), /status: not used by kind place/);
  rejects(place(1, { group_key: "x" }), /group_key: not used by kind place/);
  rejects(place(1, { data: { anything: "x" } }), /data\.anything: unknown key/);
});

test("choice and typed data keys are checked", () => {
  rejects(book(2, { data: { rating_a: "6" } }), /data\.rating_a: must be one of 1, 2, 3, 4, 5/);
  rejects(book(2, { data: { rating_a: 5 } }), /data\.rating_a: must be one of/);
  rejects(book(2, { data: { reading_b: "finished" } }), /data\.reading_b: must be one of want, reading, read, dnf/);
  rejects(book(2, { data: { language: "fr" } }), /data\.language: must be one of id, en, other/);
  rejects(book(2, { data: { series_no: -1 } }), /data\.series_no: must be a non-negative integer/);
  rejects(book(2, { data: { cover: "not a url" } }), /data\.cover: must be an https URL on covers\.openlibrary\.org/);
  for (const cover of ["http://covers.openlibrary.org/b/id/1-M.jpg", "https://example.com/b/id/1-M.jpg", "https://covers.openlibrary.org.example.com/b/id/1-M.jpg", "https://user@covers.openlibrary.org/b/id/1-M.jpg", "https://covers.openlibrary.org:8443/b/id/1-M.jpg", "https://covers.openlibrary.org/b/id/1 M.jpg", "https://covers.openlibrary.org/", "https://coversxopenlibrary.org/b/id/1-M.jpg", `https://covers.openlibrary.org/${"a".repeat(201)}`, ["https://covers.openlibrary.org/b/id/1-M.jpg"]]) {
    rejects(book(2, { data: { cover } }), /data\.cover: must be an https URL on covers\.openlibrary\.org/);
  }
  accepts(book(2, { data: { cover: "https://covers.openlibrary.org/b/id/7079796-M.jpg" } }));
  accepts(book(2, { data: { cover: `https://covers.openlibrary.org/${"a".repeat(200)}` } }));
  rejects(book(2, { data: { finished_a: "2026-02-30" } }), /data\.finished_a: must be a date/);
  rejects(book(2, { data: { priority: "normal" } }), /data\.priority: must be one of high, low/);
  rejects(copy(3, 2, { data: { format: "scroll" } }), /data\.format: must be one of print, ebook, audio/);
  rejects(copy(3, 2, { data: { was_at: "p-1" } }), /data\.was_at: must be a lowercase UUID/);
  rejects(copy(3, 2, { data: { moved_by: "c" } }), /data\.moved_by: must be one of a, b/);
  accepts(copy(3, 2, { data: { moved_by: "b" } }));
  rejects(copy(3, 2, { data: { rating_a: "5" } }), /data\.rating_a: unknown key/);
});

test("a move is one valid patch: the place column and the previous place, date and mover", () => {
  assert.deepEqual(validatePatch("items", "copy", { group_key: id(2), data: { was_at: id(1), moved_on: "2026-10-19", moved_by: "a" } }), []);
  assert.deepEqual(validatePatch("items", "copy", { group_key: id(2), data: { was_at: null, moved_on: null, moved_by: null } }), []);
  assert.notDeepEqual(validatePatch("items", "book", { data: { moved_by: "a" } }), []);
  assert.deepEqual(validatePatch("items", "book", { data: { reading_a: "reading", rating_a: null } }), []);
});

test("a book, its copy and a place are created in one request, stamped by the server and authored by the signed-in side", async () => {
  const { db, sqlite } = createDb();
  assert.equal("errors" in (await apply(db, [place(1), book(2, { data: { author: "Andrea Hirata" } }), copy(3, 2, { group_key: id(1) })], "b")), false);
  assert.equal(count(sqlite, "items"), 3);
  for (const n of [1, 2, 3]) {
    const row = stored(sqlite, "items", id(n));
    assert.equal(row?.created_at, STAMP);
    assert.equal(row?.updated_at, STAMP);
    assert.equal(row?.updated_by, "b");
  }
  assert.equal(stored(sqlite, "items", id(3))?.parent_id, id(2));
  assert.equal(stored(sqlite, "items", id(3))?.group_key, id(1));
});

test("a copy must point at a live book", async () => {
  const { db, sqlite } = createDb();
  assert.equal("errors" in (await apply(db, [book(2), task(4), place(1)])), false);
  await rejected(apply(db, [copy(3, 99)]), 409, /parent_id: must point at a live items row/);
  await rejected(apply(db, [copy(3, 4)]), 409, /parent_id: must point at a book row/);
  await rejected(apply(db, [copy(3, 1)]), 409, /parent_id: must point at a book row/);
  assert.equal("errors" in (await apply(db, [copy(3, 2)])), false);
  assert.equal("errors" in (await apply(db, [mutation("delete", "items", id(2))])), false);
  await rejected(apply(db, [copy(5, 2)]), 409, /parent_id: must point at a live items row/);
  assert.equal(count(sqlite, "items"), 4);
});

test("a copy cannot be re-parented to a non-book, and a book never has a parent", async () => {
  const { db } = createDb();
  assert.equal("errors" in (await apply(db, [book(2), book(6), task(4), copy(3, 2)])), false);
  await rejected(apply(db, [mutation("update", "items", id(3), { parent_id: id(4) })]), 409, /parent_id: must point at a book row/);
  assert.equal("errors" in (await apply(db, [mutation("update", "items", id(3), { parent_id: id(6) })])), false);
  await rejected(apply(db, [book(7, { parent_id: id(2) })]), 400, /parent_id: not used by kind book/);
});

test("moving a copy merges its data and keeps the rest, as the design describes", async () => {
  const { db, sqlite } = createDb();
  assert.equal("errors" in (await apply(db, [place(1), place(8, { title: "Home B" }), book(2), copy(3, 2, { group_key: id(1), data: { format: "print", language: "id" } })])), false);
  const later = new Date("2026-10-19T03:00:00.000Z");
  const move = mutation("update", "items", id(3), { group_key: id(8), data: { was_at: id(1), moved_on: "2026-10-19" } });
  assert.equal("errors" in (await apply(db, [move], "b", later)), false);
  const row = stored(sqlite, "items", id(3));
  assert.equal(row?.group_key, id(8));
  assert.deepEqual(JSON.parse(row?.data as string), { format: "print", language: "id", was_at: id(1), moved_on: "2026-10-19" });
  assert.equal(row?.created_at, NOW.toISOString().replace(/\.\d{3}Z$/, "Z"));
  assert.equal(row?.updated_at, "2026-10-19T03:00:00Z");
  assert.equal(row?.updated_by, "b");
});
