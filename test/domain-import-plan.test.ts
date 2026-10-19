import { test } from "node:test";
import assert from "node:assert/strict";
import { validateMutation } from "../shared/validate.ts";
import { IMPORT_LIMIT, batchRows, batchesOf, changedBooks, detectFormat, previewOf, readInput, stepsOf } from "../src/domain/import-plan.ts";
import type { Choices, Entry } from "../src/domain/import-plan.ts";
import type { Row } from "../src/domain/import-csv.ts";
import { item } from "./domain-rows.ts";

const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Fields = Parameters<typeof item>[0];

const book = (n: number, fields: Fields = {}) => item({ id: uuid(n), kind: "book", status: "shelf", ...fields });

const copy = (n: number, parent: number, fields: Fields = {}) => item({ id: uuid(n), kind: "copy", parent_id: uuid(parent), status: "here", ...fields });

const place = (n: number, fields: Fields = {}) => item({ id: uuid(n), kind: "place", status: null, ...fields });

const row = (title: string, extra: Partial<Row> = {}): Row => ({
  title,
  original_title: "",
  author: "Placeholder Author",
  rated_elsewhere: "",
  blurb: "",
  isbn: "",
  language: "",
  status: "",
  place: "",
  owner: "",
  note: "",
  genre: "",
  warnings: [],
  ...extra,
});

const labels = { a: "Partner A", b: "Partner B" };

let counter = 0;

const context = (items: Parameters<typeof stepsOf>[2]["items"] = [], batch = "batch-1") => ({ items, labels, batch, id: () => `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}` });

const wishes: Choices = { kind: "wish", owner: "a", placeId: null };

const entries = (rows: Row[]): Entry[] => rows.map((value, key) => ({ key, row: value, warnings: value.warnings, checked: true }));

test("a list pasted as text is read as text, a file with a title header as CSV", () => {
  assert.equal(detectFormat("1. Laskar Pelangi  Penulis: Andrea Hirata"), "list");
  assert.equal(detectFormat("title;author\nA;B"), "csv");
  assert.equal(readInput("1. A  Penulis: X", "list").rows.length, 1);
  assert.equal(readInput("1. A  Penulis: X", "list").skipped, 0);
  assert.equal(readInput("title\nA", "csv").rows.length, 1);
});

test("choosing the wrong format by hand gives a readable result or a named problem, never a crash", () => {
  assert.equal(readInput("title,author\nA,B", "list").rows[0].title, "title,author");
  assert.equal(readInput("1. A  Penulis: X", "csv").problem, "no_title");
  assert.equal(readInput("   ", "list").problem, "empty");
  assert.equal(readInput("", "csv").problem, "empty");
});

test("rows past the limit are counted but not read", () => {
  const text = Array.from({ length: IMPORT_LIMIT + 7 }, (_, at) => `${at + 1}. Title ${at}  Penulis: X`).join("\n");
  const read = readInput(text, "list");
  assert.deepEqual([read.rows.length, read.over, read.problem], [IMPORT_LIMIT, 7, null]);
  assert.equal(readInput(`title\n${Array.from({ length: IMPORT_LIMIT }, (_, at) => `T${at}`).join("\n")}`, "csv").over, 0);
});

test("a title already on the shelf or wishlist, by folded title or ISBN, is flagged and unticked", () => {
  const items = [
    book(1, { title: "Laskar Pelangi" }),
    book(2, { title: "Bumi Manusia", data: { isbn: "9789793062792", original_title: "This Earth of Mankind" } }),
    copy(3, 2, { data: { isbn: "9780141439518" } }),
  ];
  const found = previewOf(
    [row("LASKAR  pelangi!"), row("Another", { isbn: "9789793062792" }), row("Third", { isbn: "9780141439518" }), row("this earth of mankind"), row("New Title")],
    items,
  );
  assert.deepEqual(found.map((entry) => [entry.checked, entry.warnings]), [
    [false, ["exists"]],
    [false, ["exists"]],
    [false, ["exists"]],
    [false, ["exists"]],
    [true, []],
  ]);
});

test("a title like \"true\" is not a duplicate of a book with no original title, and a new ISBN is not a duplicate", () => {
  const found = previewOf([row("true"), row("Other", { isbn: "9789793062792" })], [book(1, { title: "Different" })]);
  assert.deepEqual(found.map((entry) => entry.warnings), [[], []]);
});

test("a repeated title inside one paste is kept ticked and flagged, by title or original title", () => {
  const found = previewOf([row("Judul Dua", { original_title: "The Two Parts" }), row("Other"), row("The Two Parts"), row("judul dua")], []);
  assert.deepEqual(found.map((entry) => [entry.checked, entry.warnings]), [[true, []], [true, []], [true, ["twice"]], [true, ["twice"]]]);
});

test("a title that folds to nothing never counts as a duplicate", () => {
  assert.deepEqual(previewOf([row("???"), row("!!!")], [book(1, { title: "***" })]).map((entry) => entry.warnings), [[], []]);
});

test("an unknown place in a CSV row is flagged, a known one is not, and the parser's own warnings stay", () => {
  const found = previewOf([row("A", { place: "home a" }), row("B", { place: "Attic" }), row("C", { warnings: ["cut"] })], [place(1, { title: "Home A" })]);
  assert.deepEqual(found.map((entry) => entry.warnings), [[], ["place_unknown"], ["cut"]]);
});

test("wishes are created one row each in paste order after the existing wishes, owned by the chosen side", () => {
  const items = [book(1, { title: "Old", status: "wish", sort: 4 })];
  const steps = stepsOf(entries([row("A", { rated_elsewhere: "~4.2 / 5 (Goodreads)", blurb: "Words.", original_title: "Orig" }), row("B", { author: "" })]), wishes, context(items));
  assert.equal(steps.length, 2);
  assert.deepEqual(steps[0], [
    {
      id: steps[0][0].id,
      draft: {
        kind: "book",
        title: "A",
        status: "wish",
        who: "a",
        sort: 5,
        data: { author: "Placeholder Author", original_title: "Orig", blurb: "Words.", rated_elsewhere: "~4.2 / 5 (Goodreads)", import_batch: "batch-1" },
      },
    },
  ]);
  assert.deepEqual(steps[1][0].draft, { kind: "book", title: "B", status: "wish", who: "a", sort: 6, data: { import_batch: "batch-1" } });
});

test("shelf books come with a print copy at the chosen place, and the book carries no owner", () => {
  const [[bookRow, copyRow]] = stepsOf(entries([row("A", { isbn: "9789793062792", language: "id" })]), { kind: "shelf", owner: "both", placeId: "place-1" }, context());
  assert.deepEqual(bookRow.draft, { kind: "book", title: "A", status: "shelf", who: null, sort: 0, data: { author: "Placeholder Author", isbn: "9789793062792", language: "id", import_batch: "batch-1" } });
  assert.deepEqual(copyRow.draft, {
    kind: "copy",
    parent_id: bookRow.id,
    title: "A",
    status: "here",
    who: "both",
    group_key: "place-1",
    data: { format: "print", isbn: "9789793062792", language: "id", import_batch: "batch-1" },
  });
});

test("a copy with no place chosen is left without one", () => {
  const [[, copyRow]] = stepsOf(entries([row("A")]), { kind: "shelf", owner: "both", placeId: null }, context());
  assert.equal("group_key" in copyRow.draft, false);
});

test("a CSV row can pick its own status, owner by letter or nickname, place by name, genre and note", () => {
  const items = [place(1, { title: "Home A" }), place(2, { title: "Sibling's room" })];
  const steps = stepsOf(
    entries([
      row("A", { status: "shelf", owner: "partner b", place: "sibling's room", genre: "Novel", note: "Lend it" }),
      row("B", { status: "wish", owner: "b" }),
      row("C", { status: "shelf", owner: "shared", place: "Attic" }),
      row("D", { owner: "unknown" }),
    ]),
    { kind: "shelf", owner: "a", placeId: items[0].id },
    context(items),
  );
  const [a, b, c, d] = steps;
  assert.deepEqual([a[0].draft.status, a[0].draft.group_key, a[0].draft.note, a[1].draft.who, a[1].draft.group_key], ["shelf", "Novel", "Lend it", "b", items[1].id]);
  assert.deepEqual([b.length, b[0].draft.status, b[0].draft.who], [1, "wish", "b"]);
  assert.deepEqual([c[1].draft.who, c[1].draft.group_key], ["both", items[0].id]);
  assert.deepEqual([d[1].draft.who, d.length], ["a", 2]);
});

test("a lone letter names the owner, and the other status's sort never moves this one's", () => {
  const items = [book(1, { title: "W", status: "wish", sort: 50 })];
  const [[a], [b]] = stepsOf(entries([row("A", { owner: "a" }), row("B", { owner: "b" })]), { kind: "shelf", owner: "both", placeId: null }, context(items));
  assert.deepEqual([a.draft.sort, b.draft.sort], [0, 1]);
  const [, [, copyA], [, copyB]] = stepsOf(entries([row("X"), row("A", { owner: "a" }), row("B", { owner: "b" })]), { kind: "shelf", owner: "both", placeId: null }, context(items));
  assert.deepEqual([copyA.draft.who, copyB.draft.who], ["a", "b"]);
});

test("sort order continues per status, so a mixed CSV keeps each list's order", () => {
  const items = [book(1, { title: "S", status: "shelf", sort: 9 })];
  const steps = stepsOf(entries([row("A", { status: "wish" }), row("B", { status: "shelf" }), row("C", { status: "wish" }), row("D", { status: "shelf" })]), wishes, context(items));
  assert.deepEqual(steps.map((step) => step[0].draft.sort), [0, 10, 1, 11]);
});

test("every created draft passes the sync validator as a create mutation", () => {
  const long = row("Full", {
    original_title: "Original",
    rated_elsewhere: "~4.2 / 5 (Goodreads)",
    blurb: "A blurb — with “quotes”.",
    isbn: "9789793062792",
    language: "other",
    genre: "Novel",
    note: "a\nb",
  });
  for (const choices of [wishes, { kind: "shelf", owner: "both", placeId: null } as Choices]) {
    for (const created of stepsOf(entries([long, row("Plain")]), choices, context()).flat()) {
      const at = "2026-10-19T00:00:00Z";
      const errors = validateMutation({ id: created.id, table: "items", op: "create", row_id: created.id, patch: { ...created.draft, id: created.id, created_at: at, updated_at: at } });
      assert.deepEqual(errors, []);
    }
  }
});

test("a full import of the limit is 1000 mutations, every book ahead of its own copy", () => {
  const created = stepsOf(entries(Array.from({ length: IMPORT_LIMIT }, (_, at) => row(`Book ${at}`))), { kind: "shelf", owner: "both", placeId: null }, context()).flat();
  assert.equal(created.length, 1000);
  const seen = new Set<string>();
  for (const { id, draft } of created) {
    if (draft.kind === "copy") assert.ok(seen.has(draft.parent_id as string));
    seen.add(id);
  }
});

test("the books of a batch come in paste order", () => {
  const items = [book(1, { title: "Second", sort: 2, data: { import_batch: "x" } }), book(2, { title: "First", sort: 1, data: { import_batch: "x" } })];
  assert.deepEqual(batchesOf(items)[0].books.map((entry) => entry.title), ["First", "Second"]);
  const old = book(3, { title: "A", created_at: "2026-10-01T00:00:00Z", data: { import_batch: "old" } });
  const recent = book(4, { title: "B", created_at: "2026-10-03T00:00:00Z", data: { import_batch: "new" } });
  assert.deepEqual(batchesOf([old, recent]).map((batch) => batch.id), ["new", "old"]);
  assert.deepEqual(batchesOf([recent, old]).map((batch) => batch.id), ["new", "old"]);
});

test("batches are listed newest first with their live books, and a batch's rows include its copies only", () => {
  const items = [
    book(1, { title: "A", created_at: "2026-10-01T00:00:00Z", data: { import_batch: "old" } }),
    book(2, { title: "B", created_at: "2026-10-03T00:00:00Z", data: { import_batch: "new" } }),
    book(3, { title: "C", created_at: "2026-10-02T00:00:00Z", data: { import_batch: "new" } }),
    book(4, { title: "Typed" }),
    copy(5, 2, { data: { import_batch: "new" } }),
    copy(6, 4, {}),
  ];
  const batches = batchesOf(items);
  assert.deepEqual(batches.map((batch) => [batch.id, batch.books.length, batch.at]), [["new", 2, "2026-10-02T00:00:00Z"], ["old", 1, "2026-10-01T00:00:00Z"]]);
  assert.deepEqual(batchRows(items, "new").map((item) => item.id), [items[1].id, items[2].id, items[4].id]);
  assert.deepEqual(batchRows(items, "none"), []);
});

const touched = { updated_at: "2026-10-02T00:00:00Z" };

const imported = (batch = "new") => [
  book(1, { title: "A", data: { import_batch: batch } }),
  copy(2, 1, { data: { import_batch: batch } }),
  book(3, { title: "B", data: { import_batch: batch } }),
  copy(4, 3, { data: { import_batch: batch } }),
];

test("a batch's rows are its books first, then every copy under them, whether the copy came with the import or was added later", () => {
  const items = [...imported(), copy(5, 1, { status: "lent" }), copy(6, 3, { status: "here", data: { format: "ebook" } }), book(7, { title: "Other", data: { import_batch: "x" } }), copy(8, 7, { data: { import_batch: "x" } }), copy(9, 99, {})];
  assert.deepEqual(batchRows(items, "new").map((row) => row.id), [uuid(1), uuid(3), uuid(2), uuid(4), uuid(5), uuid(6)]);
  assert.deepEqual(batchRows(items, "x").map((row) => row.id), [uuid(7), uuid(8)]);
});

test("a copy that carries the batch but whose book is no longer there is still part of it, so it cannot stay live alone", () => {
  const items = [book(1, { title: "A", data: { import_batch: "new" } }), copy(2, 1, { data: { import_batch: "new" } }), copy(3, 50, { data: { import_batch: "new" } })];
  assert.deepEqual(batchRows(items, "new").map((row) => row.id), [uuid(1), uuid(2), uuid(3)]);
});

test("books changed since the import are counted once each: edits, reading state, copies added, copies moved or lent", () => {
  assert.equal(changedBooks(imported(), "new"), 0);
  assert.equal(changedBooks([...imported(), copy(5, 1, {})], "new"), 1);
  const edited = imported();
  edited[0] = { ...edited[0], ...touched };
  assert.equal(changedBooks(edited, "new"), 1);
  const reading = imported();
  reading[2] = { ...reading[2], ...touched, data: { import_batch: "new", reading_a: "read", rating_a: "5" } };
  assert.equal(changedBooks(reading, "new"), 1);
  const moved = imported();
  moved[1] = { ...moved[1], ...touched, status: "lent" };
  assert.equal(changedBooks(moved, "new"), 1);
  const everything = [...imported(), copy(5, 1, {}), copy(6, 1, {})];
  everything[0] = { ...everything[0], ...touched };
  everything[1] = { ...everything[1], ...touched };
  everything[2] = { ...everything[2], ...touched };
  assert.equal(changedBooks(everything, "new"), 2);
  assert.equal(changedBooks(edited, "other"), 0);
  assert.equal(changedBooks([book(1, { title: "A", data: { import_batch: "new" } }), copy(2, 50, { data: { import_batch: "new" }, ...touched })], "new"), 1);
  assert.equal(changedBooks([], "new"), 0);
});

test("only books count as already there: a place, a task or a copy with the same title does not untick a row", () => {
  const items = [place(1, { title: "Laskar Pelangi" }), item({ id: uuid(2), kind: "task", title: "Bumi Manusia" }), book(3, { title: "Typed" }), copy(4, 3, { title: "The Little Prince" })];
  const found = previewOf([row("Laskar Pelangi"), row("Bumi Manusia"), row("The Little Prince"), row("Typed")], items);
  assert.deepEqual(found.map((entry) => [entry.checked, entry.warnings]), [[true, []], [true, []], [true, []], [false, ["exists"]]]);
});
