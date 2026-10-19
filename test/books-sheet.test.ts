import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STORED, draftFor } from "../src/domain/draft.ts";
import type { Context } from "../src/domain/draft.ts";
import { navEntries } from "../src/ui/nav.ts";
import { overlay } from "../src/ui/overlay.ts";
import { text } from "../src/ui/text.ts";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const context: Context = { today: "2026-10-07", me: "a", nicknames: { a: "Partner A", b: "Partner B" }, lines: [{ id: "line-venue", title: "Venue", vendor: null }] };

test("a book title is kept as typed: no date, amount, phone or partner is read out of it", () => {
  for (const typed of ["Laskar Pelangi 2", "Bumi Manusia friday", "1984 5 jt", "Partner A 0812 3456 7890", "Venue 50k tomorrow", "The Little Prince (Le Petit Prince)"]) {
    const { kind, draft } = draftFor(typed, context, new Set(), "book");
    assert.equal(kind, "book", typed);
    assert.deepEqual([draft.title, draft.amount, draft.due, draft.who, draft.phone], [typed, null, null, null, null], typed);
  }
  assert.deepEqual(STORED.book, []);
});

test("the book chip is the sixth kind of the global Add sheet and has its words", () => {
  const sheet = read("ui/add-sheet.tsx");
  assert.match(sheet, /const KINDS: readonly Kind\[\] = \["task", "planned", "payment", "guest", "vendor", "book"\]/);
  assert.match(sheet, /book: "book"/);
  for (const table of [text.sheet.kinds, text.sheet.first, text.sheet.placeholder]) assert.match(table.book, /\S/);
  assert.match(text.sheet.hintBook, /kept until you add it/);
});

test("the unsent book is kept in memory until it is replaced or cleared", () => {
  assert.equal(overlay.keptBook(), null);
  const draft = { kind: "wish" as const, title: "Bumi Manusia", author: "", original: "", isbn: "0156012197", language: "", blurb: "", found: null, ownerPick: null, placePick: null };
  overlay.keepBook(draft);
  assert.deepEqual(overlay.keptBook(), draft);
  overlay.keepBook(null);
  assert.equal(overlay.keptBook(), null);
});

test("the detail line names the mover from the copy's own mark, never the last editor", () => {
  const detail = read("views/book.tsx");
  assert.match(detail, /moverOf\(copy\)/);
  assert.doesNotMatch(detail, /updated_by/);
});

test("both Add sheets close on Escape without dropping what was typed", () => {
  for (const file of ["ui/book-sheet.tsx", "ui/add-sheet.tsx", "ui/modal.tsx"]) assert.doesNotMatch(read(file), /onCancel|keepBook\(null\);\s*(?:onClose|overlay\.closeAdd)/, file);
});

test("the tab bar still has the five slots with Add in the middle", () => {
  assert.equal(navEntries("tabs").length, 5);
});
