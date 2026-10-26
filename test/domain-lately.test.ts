import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTION_KINDS } from "../shared/routines.ts";
import { LATELY_COUNT, lately } from "../src/domain/lately.ts";
import { entry, item, payment } from "./domain-rows.ts";

const edited = { created_at: "2026-10-01T00:00:00Z" };

test("newest change first, at most the limit", () => {
  const rows = [1, 2, 3, 4].map((hour) => item({ title: `t${hour}`, updated_by: "a", updated_at: `2026-10-05T0${hour}:00:00Z` }));
  assert.deepEqual(
    lately(rows, [], 2).map((activity) => activity.title),
    ["t4", "t3"],
  );
});

test("items and budget entries mix on one timeline", () => {
  const line = entry({ title: "Venue", updated_by: "b", updated_at: "2026-10-05T01:00:00Z" });
  const rows = [item({ title: "task", updated_by: "a", updated_at: "2026-10-05T02:00:00Z" })];
  assert.deepEqual(
    lately(rows, [line]).map((activity) => [activity.title, activity.by]),
    [
      ["task", "a"],
      ["Venue", "b"],
    ],
  );
});

test("changes made by an import or by nobody are left out", () => {
  const rows = [item({ updated_by: "import" }), item({ updated_by: null }), item({ title: "kept", updated_by: "b" })];
  assert.deepEqual(
    lately(rows, []).map((activity) => activity.title),
    ["kept"],
  );
});

test("the verb follows what the row looks like now", () => {
  const line = entry({});
  const verbs = lately(
    [
      item({ title: "ticked", status: "done", updated_by: "a", updated_at: "2026-10-05T05:00:00Z", ...edited }),
      item({ title: "added", updated_by: "a", updated_at: "2026-10-05T04:00:00Z", created_at: "2026-10-05T04:00:00Z" }),
      item({ title: "changed", updated_by: "a", updated_at: "2026-10-05T03:00:00Z", ...edited }),
      item({ title: "vendor done", kind: "vendor", status: "confirmed", updated_by: "a", updated_at: "2026-10-05T02:00:00Z", ...edited }),
    ],
    [payment(line, { title: "paid", status: "paid", updated_by: "b", updated_at: "2026-10-05T06:00:00Z", ...edited })],
  );
  assert.deepEqual(
    verbs.map((activity) => [activity.title, activity.verb]),
    [
      ["paid", "paid"],
      ["ticked", "ticked"],
      ["added", "added"],
      ["changed", "changed"],
      ["vendor done", "changed"],
    ],
  );
});

test("the default length is LATELY_COUNT", () => {
  const rows = Array.from({ length: LATELY_COUNT + 2 }, (_, index) => item({ updated_by: "a", updated_at: `2026-10-05T0${index}:00:00Z` }));
  assert.equal(lately(rows, []).length, LATELY_COUNT);
  assert.equal(LATELY_COUNT, 5);
});

test("changes at the same instant sort by id, whatever the input order", () => {
  const at = { updated_by: "a" as const, updated_at: "2026-10-05T00:00:00Z" };
  const first = item({ title: "first", id: "00000000-0000-4000-8000-000000000001", ...at });
  const second = item({ title: "second", id: "00000000-0000-4000-8000-000000000002", ...at });
  const line = entry({ title: "third", id: "00000000-0000-4000-8000-000000000003", ...at });
  for (const rows of [
    [first, second],
    [second, first],
  ]) {
    assert.deepEqual(
      lately(rows, [line]).map((activity) => activity.title),
      ["first", "second", "third"],
    );
  }
});

test("added means unsynced, or never changed since the server stored it", () => {
  const created = "2026-10-05T10:00:00Z";
  const verb = (fields: Parameters<typeof item>[0]) => lately([item({ updated_by: "a", created_at: created, ...fields })], [])[0].verb;
  assert.equal(verb({ updated_at: created }), "added");
  assert.equal(verb({ updated_at: "2026-10-05T10:00:01Z" }), "changed");
  assert.equal(verb({ updated_at: "2026-10-06T10:00:00Z" }), "changed");
  assert.equal(verb({ updated_at: "2026-10-06T10:00:00Z", rev: 0 }), "added");
});

const shelf = (title: string, at: string, fields: Parameters<typeof item>[0] = {}) =>
  item({ kind: "book", title, status: "shelf", updated_by: "a", created_at: at, updated_at: at, ...fields });
const place = (title: string) => item({ kind: "place", title, status: null, updated_by: "a", updated_at: "2026-10-05T01:00:00Z" });
const copyOf = (book: ReturnType<typeof item>, fields: Parameters<typeof item>[0] = {}) =>
  item({ kind: "copy", parent_id: book.id, title: book.title, status: "here", updated_by: "a", created_at: book.created_at, updated_at: book.updated_at, ...fields });
const summary = (rows: ReturnType<typeof item>[]) => lately(rows, []).map((activity) => [activity.verb, activity.title, activity.to]);

test("a book added with its copy reads as one line, and the places are left out", () => {
  const book = shelf("Laskar Pelangi", "2026-10-05T10:00:00Z");
  const home = place("Home A");
  const copy = copyOf(book, { created_at: "2026-10-05T10:00:02Z", updated_at: "2026-10-05T10:00:02Z", group_key: home.id });
  assert.deepEqual(summary([home, book, copy]), [["added", "Laskar Pelangi", null]]);
});

test("a copy made by We got it, at the moment the book changed, is hidden too", () => {
  const book = shelf("Laskar Pelangi", "2026-10-01T10:00:00Z", { status: "shelf", updated_at: "2026-10-05T10:00:00Z", rev: 3 });
  const copy = copyOf(book, { created_at: "2026-10-05T10:00:00Z", updated_at: "2026-10-05T10:00:00Z" });
  assert.deepEqual(summary([book, copy]), [["changed", "Laskar Pelangi", null]]);
});

test("a copy added to an older book shows as added", () => {
  const book = shelf("Laskar Pelangi", "2026-10-01T10:00:00Z");
  const copy = copyOf(book, { created_at: "2026-10-05T10:00:00Z", updated_at: "2026-10-05T10:00:00Z" });
  assert.deepEqual(summary([book, copy]), [["added", "Laskar Pelangi", null], ["added", "Laskar Pelangi", null]]);
});

test("a move reads as moved <title> to <place>, even for a copy that was added together with its book a minute ago", () => {
  const home = place("Home B");
  const book = shelf("Laskar Pelangi", "2026-10-05T10:00:00Z");
  const copy = copyOf(book, { updated_at: "2026-10-05T10:00:30Z", rev: 2, group_key: home.id, data: { moved_on: "2026-10-05", moved_by: "a" } });
  assert.deepEqual(summary([home, copy]), [["moved", "Laskar Pelangi", "Home B"]]);
});

test("a move seen from a zone a day ahead still reads as moved, and a copy edited long after its move reads as changed", () => {
  const home = place("Home B");
  const book = shelf("Laskar Pelangi", "2026-10-01T10:00:00Z");
  const next = copyOf(book, { created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-05T20:00:00Z", rev: 2, group_key: home.id, data: { moved_on: "2026-10-06" } });
  assert.equal(summary([home, next])[0][0], "moved");
  const later = copyOf(book, { created_at: "2026-10-01T10:00:00Z", updated_at: "2026-10-20T20:00:00Z", rev: 3, group_key: home.id, data: { moved_on: "2026-10-05" } });
  assert.equal(summary([home, later])[0][0], "changed");
});

test("a move to a place that is gone or unset reads without a destination", () => {
  const book = shelf("Laskar Pelangi", "2026-10-01T10:00:00Z");
  const copy = copyOf(book, { updated_at: "2026-10-05T20:00:00Z", rev: 2, group_key: null, data: { moved_on: "2026-10-05" } });
  assert.deepEqual(summary([copy]), [["moved", "Laskar Pelangi", null]]);
});

test("the burst of an import is left out, books and copies alike, while nothing has touched the rows", () => {
  const book = shelf("Imported", "2026-10-05T10:00:00Z", { data: { import_batch: "b1" } });
  const copy = copyOf(book, { created_at: "2026-10-09T10:00:00Z", updated_at: "2026-10-09T10:00:00Z", data: { import_batch: "b1" } });
  const task = item({ title: "kept", updated_by: "a", updated_at: "2026-10-04T10:00:00Z", data: { note: "x" } });
  assert.deepEqual(summary([book, copy, task]), [["changed", "kept", null]]);
});

test("what happens to imported rows afterwards shows as it does for typed ones: a move by the other partner, an edit, a rating, a copy added later", () => {
  const home = place("Home B");
  const book = shelf("Imported", "2026-10-05T10:00:00Z", { data: { import_batch: "b1" } });
  const copy = copyOf(book, { created_at: "2026-10-05T10:00:00Z", updated_at: "2026-10-05T20:00:00Z", updated_by: "b", rev: 2, group_key: home.id, data: { import_batch: "b1", moved_on: "2026-10-05", moved_by: "b" } });
  assert.deepEqual(lately([home, book, copy], []).map((activity) => [activity.verb, activity.by, activity.title, activity.to]), [["moved", "b", "Imported", "Home B"]]);
  const plain = copyOf(book, { created_at: "2026-10-05T10:00:00Z", updated_at: "2026-10-06T10:00:00Z", updated_by: "b", rev: 2, status: "lent", data: { import_batch: "b1" } });
  const typed = shelf("Typed", "2026-10-05T10:00:00Z");
  const typedCopy = copyOf(typed, { created_at: "2026-10-05T10:00:00Z", updated_at: "2026-10-06T10:00:00Z", updated_by: "b", rev: 2, status: "lent" });
  assert.deepEqual(summary([book, plain]), []);
  assert.deepEqual(summary([typed, typedCopy]), [["added", "Typed", null]]);
  const rated = shelf("Imported", "2026-10-05T10:00:00Z", { updated_at: "2026-10-07T10:00:00Z", updated_by: "b", rev: 3, data: { import_batch: "b1", rating_b: "5" } });
  assert.deepEqual(summary([rated]), [["changed", "Imported", null]]);
  const sibling = copyOf(rated, { created_at: "2026-10-08T10:00:00Z", updated_at: "2026-10-08T10:00:00Z", status: "lent" });
  assert.deepEqual(summary([rated, sibling]).map(([verb]) => verb), ["added", "changed"]);
});

test("books do not push the wedding work off Home: 5 slots hold the latest wedding changes when books are old", () => {
  const rows = [
    item({ title: "t1", updated_by: "a", updated_at: "2026-10-05T10:00:00Z" }),
    item({ title: "t2", updated_by: "b", updated_at: "2026-10-05T09:00:00Z" }),
  ];
  const book = shelf("Laskar Pelangi", "2026-10-05T11:00:00Z");
  const home = place("Home A");
  const copy = copyOf(book, { group_key: home.id });
  assert.deepEqual(summary([...rows, book, copy, home]).map(([, title]) => title), ["Laskar Pelangi", "t1", "t2"]);
});

const withMove = (data: Record<string, unknown>, by: "a" | "b", at: string, home: ReturnType<typeof item>, fields: Parameters<typeof item>[0] = {}) => {
  const novel = shelf("Laskar Pelangi", "2026-09-01T10:00:00Z", { updated_by: null });
  return { novel, copy: copyOf(novel, { title: "Copy of the story", created_at: "2026-09-01T10:00:00Z", updated_at: at, updated_by: by, rev: 3, group_key: home.id, data, ...fields }) };
};

test("a move later edited by the other partner names the mover and shows the book title", () => {
  const home = place("Home B");
  const { novel, copy } = withMove({ moved_on: "2026-10-19", moved_by: "a" }, "b", "2026-10-19T14:00:00Z", home);
  assert.deepEqual(
    lately([novel, home, copy], []).map((activity) => [activity.by, activity.verb, activity.title, activity.to]),
    [["a", "moved", "Laskar Pelangi", "Home B"]],
  );
});

test("an old move without a mover is credited to the last editor", () => {
  const home = place("Sibling's room");
  const { novel, copy } = withMove({ moved_on: "2026-10-19" }, "b", "2026-10-19T09:00:00Z", home);
  assert.deepEqual(
    lately([novel, home, copy], []).map((activity) => [activity.by, activity.verb, activity.title]),
    [["b", "moved", "Laskar Pelangi"]],
  );
});

test("a move whose book is not in the list keeps the copy title", () => {
  const home = place("Home A");
  const { copy } = withMove({ moved_on: "2026-10-19", moved_by: "a" }, "a", "2026-10-19T09:00:00Z", home);
  assert.equal(lately([home, copy], [])[0].title, "Copy of the story");
});

test("routines and every kind of action are left out, and the other kinds are untouched", () => {
  const kinds = ["routine", ...ACTION_KINDS];
  const rows = [
    ...kinds.map((kind, index) => item({ kind, title: kind, status: null, updated_by: "a", updated_at: `2026-10-05T0${index}:00:00Z`, ...edited })),
    item({ kind: "task", title: "task", updated_by: "a", updated_at: "2026-10-05T09:00:00Z", ...edited }),
    item({ kind: "vendor", title: "vendor", status: "option", updated_by: "b", updated_at: "2026-10-05T08:30:00Z", ...edited }),
  ];
  assert.deepEqual(lately(rows, [], 20).map((activity) => activity.title), ["task", "vendor"]);
  const ticked = item({ kind: "step", title: "item 1", status: null, updated_by: "a", updated_at: "2026-10-05T10:00:00Z", data: { done_a: "2026-10-05" }, ...edited });
  assert.deepEqual(lately([ticked], []), []);
});

test("a movie or series is listed when added and never when changed, so a rating or a status move stays off the timeline", () => {
  const rows = ["movie", "series"].flatMap((kind) => [
    item({ kind, title: `${kind} added`, status: "want", updated_by: "a", updated_at: "2026-10-05T04:00:00Z", created_at: "2026-10-05T04:00:00Z" }),
    item({ kind, title: `${kind} rated`, status: "watched", updated_by: "b", updated_at: "2026-10-05T06:00:00Z", ...edited }),
  ]);
  assert.deepEqual(
    lately(rows, []).map((activity) => [activity.title, activity.verb]),
    [
      ["movie added", "added"],
      ["series added", "added"],
    ],
  );
});
