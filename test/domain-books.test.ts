import { test } from "node:test";
import assert from "node:assert/strict";
import type { ItemRow } from "../shared/tables.ts";
import { validateChange, validateCreate } from "../shared/validate.ts";
import { fold, searchBooks } from "../src/domain/search.ts";
import { shelfSections } from "../src/domain/shelf.ts";
import { weGotIt, wishSections } from "../src/domain/wish.ts";
import { item } from "./domain-rows.ts";

const book = (title: string, fields: Partial<ItemRow> = {}) => item({ kind: "book", title, status: "shelf", ...fields });
const copy = (parent: ItemRow, fields: Partial<ItemRow> = {}) => item({ kind: "copy", parent_id: parent.id, title: parent.title, status: "here", who: "both", ...fields });
const place = (title: string, sort = 0) => item({ kind: "place", title, status: null, sort });

const titles = (rows: readonly { title: string }[]) => rows.map((row) => row.title);

const homeA = place("Home A", 1);
const homeB = place("Home B", 2);
const siblings = place("Sibling's room", 3);

const laskar = book("Laskar Pelangi", { data: { author: "Andrea Hirata" } });
const bumi = book("Bumi Manusia", { data: { author: "Pramoedya Ananta Toer", series: "Tetralogi Buru" } });
const pangeran = book("Pangeran Kecil", { data: { author: "Antoine de Saint-Exupéry", original_title: "Le Petit Prince" } });
const prince = book("The Little Prince", { data: { author: "Antoine de Saint-Exupéry" } });
const wished = book("Wished Novel", { status: "wish", who: "a", data: { author: "Partner B" } });

const world = [
  homeA,
  homeB,
  siblings,
  laskar,
  bumi,
  pangeran,
  prince,
  wished,
  copy(laskar, { group_key: homeA.id }),
  copy(bumi, { group_key: homeB.id, data: { isbn: "9789799731234" } }),
  copy(pangeran, { group_key: homeA.id, title: "Pangeran Kecil (Indonesian)", data: { isbn: "9789793062792" } }),
  copy(prince, { group_key: siblings.id, data: { isbn: "9780156012195" } }),
  copy(prince, { status: "gone", group_key: homeA.id, done_on: "2026-09-01" }),
];

test("the shelf groups books by place, places by their order, and leaves out the wishlist", () => {
  const sections = shelfSections(world);
  assert.deepEqual(
    sections.map((s) => [s.where.kind === "place" ? s.where.place.title : s.where.kind, titles(s.books)]),
    [
      ["Home A", ["Laskar Pelangi", "Pangeran Kecil"]],
      ["Home B", ["Bumi Manusia"]],
      ["Sibling's room", ["The Little Prince"]],
    ],
  );
});

test("a place with no books has no section, and sections follow place order whatever the row order", () => {
  const empty = place("Home C", 0);
  const sections = shelfSections([siblings, empty, homeB, homeA, copy(bumi, { group_key: homeB.id }), bumi, copy(prince, { group_key: siblings.id }), prince]);
  assert.deepEqual(
    sections.map((s) => (s.where.kind === "place" ? s.where.place.title : s.where.kind)),
    ["Home B", "Sibling's room"],
  );
});

test("books order by manual sort, then creation", () => {
  const first = book("First", { sort: 2 });
  const second = book("Second", { sort: 1 });
  const rows = [homeA, first, second, copy(first, { group_key: homeA.id }), copy(second, { group_key: homeA.id })];
  assert.deepEqual(titles(shelfSections(rows)[0].books), ["Second", "First"]);
});

test("ebooks, lent copies, unplaced copies and books with no copy here get their own sections after the places", () => {
  const ebook = book("Ebook only");
  const lent = book("Lent out");
  const lost = book("Given away");
  const unknown = book("Unknown place");
  const nowhere = book("No copy yet");
  const rows = [
    homeA,
    ebook,
    copy(ebook, { data: { format: "ebook" }, group_key: null }),
    lent,
    copy(lent, { status: "lent", group_key: homeA.id, due_on: "2026-11-01" }),
    lost,
    copy(lost, { status: "gone", group_key: homeA.id }),
    unknown,
    copy(unknown, { group_key: "00000000-0000-4000-8000-0000000000ff" }),
    nowhere,
    laskar,
    copy(laskar, { group_key: homeA.id }),
  ];
  assert.deepEqual(
    shelfSections(rows).map((s) => [s.where.kind, titles(s.books)]),
    [
      ["place", ["Laskar Pelangi"]],
      ["ebook", ["Ebook only"]],
      ["unplaced", ["Unknown place"]],
      ["lent", ["Lent out"]],
      ["away", ["Given away", "No copy yet"]],
    ],
  );
});

test("a borrowed copy sits at its place, and a book with copies in two places shows in both, once each", () => {
  const borrowed = book("Borrowed");
  const split = book("Split");
  const rows = [
    homeA,
    homeB,
    borrowed,
    copy(borrowed, { status: "borrowed", who: null, group_key: homeA.id }),
    split,
    copy(split, { group_key: homeA.id }),
    copy(split, { group_key: homeA.id }),
    copy(split, { group_key: homeB.id }),
  ];
  assert.deepEqual(
    shelfSections(rows).map((s) => titles(s.books)),
    [["Borrowed", "Split"], ["Split"]],
  );
});

test("the shelf never reorders or changes its input", () => {
  const before = world.map((row) => row.id);
  const sections = shelfSections(world);
  sections[0].books.reverse();
  assert.deepEqual(
    world.map((row) => row.id),
    before,
  );
  assert.equal(world.find((row) => row.id === laskar.id), laskar);
});

test("folding drops case, accents and punctuation, and keeps letters and digits of every language", () => {
  assert.equal(fold("  Saint-Exupéry, “Le Petit Prince”! "), "saint exupery le petit prince");
  assert.equal(fold("Sibling's room"), "siblings room");
  assert.equal(fold("Sibling’s room"), "siblings room");
  assert.equal(fold("ÀÉÎÕÜ àéîõü"), "aeiou aeiou");
  assert.equal(fold("Tetralogi Buru #1"), "tetralogi buru 1");
  assert.equal(fold("..."), "");
});

test("search ignores case and accents, in the title, the original title and the author", () => {
  assert.deepEqual(titles(searchBooks("LASKAR", world)), ["Laskar Pelangi"]);
  assert.deepEqual(titles(searchBooks("pangeran kecil", world)), ["Pangeran Kecil"]);
  assert.deepEqual(titles(searchBooks("le petit prince", world)), ["Pangeran Kecil"]);
  assert.deepEqual(titles(searchBooks("exupery", world)), ["Pangeran Kecil", "The Little Prince"]);
  assert.deepEqual(titles(searchBooks("SAINT-EXUPÉRY", world)), ["Pangeran Kecil", "The Little Prince"]);
  assert.deepEqual(titles(searchBooks("pramoedya", world)), ["Bumi Manusia"]);
  assert.deepEqual(titles(searchBooks("little prince", world)), ["The Little Prince"]);
  assert.deepEqual(titles(searchBooks("prince", world)), ["Pangeran Kecil", "The Little Prince"]);
});

test("every word must match somewhere in the book, in any order, across fields", () => {
  assert.deepEqual(titles(searchBooks("bumi pramoedya", world)), ["Bumi Manusia"]);
  assert.deepEqual(titles(searchBooks("pramoedya bumi", world)), ["Bumi Manusia"]);
  assert.deepEqual(titles(searchBooks("bumi laskar", world)), []);
  assert.deepEqual(titles(searchBooks("buru", world)), ["Bumi Manusia"]);
});

test("a word matches the start of a word, and a single letter before the last word only a whole word, so Home A is not every author with an A", () => {
  assert.deepEqual(titles(searchBooks("pelan", world)), ["Laskar Pelangi"]);
  assert.deepEqual(titles(searchBooks("elangi", world)), []);
  assert.deepEqual(titles(searchBooks("a home", world)), ["Laskar Pelangi", "Pangeran Kecil"]);
  assert.deepEqual(titles(searchBooks("a ", world)), ["Laskar Pelangi", "Pangeran Kecil"]);
  assert.deepEqual(titles(searchBooks("home b ", world)), ["Bumi Manusia"]);
  assert.deepEqual(titles(searchBooks("home p", world)), ["Laskar Pelangi", "Bumi Manusia", "Pangeran Kecil"]);
  assert.deepEqual(titles(searchBooks("home p ", world)), []);
});

test("the word being typed is a prefix even when it is one letter, so the results never blank at a word start", () => {
  assert.deepEqual(titles(searchBooks("p", world)), ["Laskar Pelangi", "Bumi Manusia", "Pangeran Kecil", "The Little Prince", "Wished Novel"]);
  assert.deepEqual(titles(searchBooks("little p", world)), ["The Little Prince"]);
  assert.deepEqual(titles(searchBooks("little p ", world)), []);
  assert.deepEqual(titles(searchBooks("x", world)), []);
});

test("folding turns ł, đ and ß into plain letters so they can be typed without them", () => {
  const rows = [book("Łódź Đà Lạt Straße")];
  assert.equal(fold("Łódź Đà Lạt Straße"), "lodz da lat strasse");
  for (const query of ["lodz", "da lat", "strasse", "ŁÓDŹ"]) assert.equal(searchBooks(query, rows).length, 1, query);
});

test("search finds a book by where it is, and a copy that is gone no longer counts", () => {
  assert.deepEqual(titles(searchBooks("home a ", world)), ["Laskar Pelangi", "Pangeran Kecil"]);
  assert.deepEqual(titles(searchBooks("home b ", world)), ["Bumi Manusia"]);
  assert.deepEqual(titles(searchBooks("siblings room", world)), ["The Little Prince"]);
  assert.deepEqual(titles(searchBooks("Sibling's room", world)), ["The Little Prince"]);
  assert.deepEqual(titles(searchBooks("little home a ", world)), []);
});

test("search matches a copy's printed title and ISBN digits, and turns a typed ISBN-10 into its ISBN-13", () => {
  assert.deepEqual(titles(searchBooks("indonesian", world)), ["Pangeran Kecil"]);
  assert.deepEqual(titles(searchBooks("9789793062792", world)), ["Pangeran Kecil"]);
  assert.deepEqual(titles(searchBooks("978-979-3062-79-2", world)), ["Pangeran Kecil"]);
  assert.deepEqual(titles(searchBooks("0156012197", world)), ["The Little Prince"]);
});

test("search covers wishes too, an empty query lists every book and no copy or place, and nothing matches nonsense", () => {
  assert.deepEqual(titles(searchBooks("partner b", world)), ["Wished Novel"]);
  assert.deepEqual(titles(searchBooks("", world)), ["Laskar Pelangi", "Bumi Manusia", "Pangeran Kecil", "The Little Prince", "Wished Novel"]);
  assert.deepEqual(titles(searchBooks(" !! ", world)), titles(searchBooks("", world)));
  assert.deepEqual(titles(searchBooks("zzz", world)), []);
});

test("We got it turns a wish into a shelf book and a copy owned by both, with the wished ISBN and language", () => {
  const wish = book("Laskar Pelangi", { status: "wish", who: "b", amount: 98000, data: { author: "Andrea Hirata", isbn: "9789793062792", language: "id", priority: "high" } });
  const done = weGotIt(wish, homeA.id);
  assert.deepEqual(done.book, { status: "shelf", who: null });
  assert.deepEqual(done.copy, {
    kind: "copy",
    parent_id: wish.id,
    title: "Laskar Pelangi",
    status: "here",
    group_key: homeA.id,
    who: "both",
    data: { format: "print", isbn: "9789793062792", language: "id" },
  });
  assert.deepEqual(validateChange("items", wish, done.book), []);
  assert.deepEqual(validateCreate("items", { ...done.copy, id: "00000000-0000-4000-8000-0000000000aa", created_at: wish.created_at, updated_at: wish.updated_at }), []);
});

test("We got it copies only what the wish has, and allows no place yet", () => {
  const plain = book("Bumi Manusia", { status: "wish", data: null });
  const done = weGotIt(plain, null);
  assert.deepEqual(done.copy.data, { format: "print" });
  assert.equal(done.copy.group_key, null);
  assert.deepEqual(weGotIt(book("Bumi Manusia", { status: "wish", data: { isbn: "9789799731234" } }), null).copy.data, { format: "print", isbn: "9789799731234" });
  assert.equal(plain.status, "wish");
});

test("places order the sections by their own order, even when books and places were made in the opposite order", () => {
  const first = place("First", 1);
  const second = place("Second", 2);
  const third = place("Third", 3);
  const early = book("Early", { sort: 0 });
  const late = book("Late", { sort: 1 });
  const rows = [third, second, first, early, late, copy(early, { group_key: third.id }), copy(late, { group_key: first.id })];
  assert.deepEqual(
    shelfSections(rows).map((s) => (s.where.kind === "place" ? s.where.place.title : s.where.kind)),
    ["First", "Third"],
  );
  assert.deepEqual(
    shelfSections([...rows].reverse()).map((s) => titles(s.books)),
    [["Late"], ["Early"]],
  );
});

test("a partial or prefixed ISBN finds the book after hyphens, spaces and an isbn label are dropped", () => {
  assert.deepEqual(titles(searchBooks("978-979", world)), ["Bumi Manusia", "Pangeran Kecil"]);
  assert.deepEqual(titles(searchBooks("978-979-3062", world)), ["Pangeran Kecil"]);
  assert.deepEqual(titles(searchBooks("978 979 3062 79", world)), ["Pangeran Kecil"]);
  assert.deepEqual(titles(searchBooks("isbn 9789793062792", world)), ["Pangeran Kecil"]);
  assert.deepEqual(titles(searchBooks("ISBN: 978-979-3062-79-2", world)), ["Pangeran Kecil"]);
  assert.deepEqual(titles(searchBooks("isbn 0156012197", world)), ["The Little Prince"]);
  assert.deepEqual(titles(searchBooks("9780156", world)), ["The Little Prince"]);
});

test("an ISBN labelled the way covers and shop pages print it still finds the book, with any hyphen", () => {
  for (const query of ["ISBN-13: 978-0-15-601219-5", "ISBN-10: 0-15-601219-7", "ISBN13 9780156012195", "isbn10:0156012197", "ISBN 0-15-601219-7", "ISBN‐13: 978‐0‐15‐601219‐5", "978–0–15–601219–5", "isbn: 9780156"])
    assert.deepEqual(titles(searchBooks(query, world)), ["The Little Prince"], query);
});

test("a typed number reads as an ISBN prefix from four digits, however it is spaced", () => {
  assert.deepEqual(titles(searchBooks("97 8", world)), []);
  assert.deepEqual(titles(searchBooks("97 89", world)), ["Bumi Manusia", "Pangeran Kecil"]);
  assert.deepEqual(titles(searchBooks("9789", world)), ["Bumi Manusia", "Pangeran Kecil"]);
});

test("a short number is still an ordinary word, and a prefix that matches no ISBN finds nothing", () => {
  assert.deepEqual(titles(searchBooks("978", world)), ["Bumi Manusia", "Pangeran Kecil", "The Little Prince"]);
  assert.deepEqual(titles(searchBooks("978-111", world)), []);
  const numbered = book("Catch 22");
  assert.deepEqual(titles(searchBooks("22", [numbered])), ["Catch 22"]);
  assert.deepEqual(titles(searchBooks("isbn", world)), []);
});

test("a gone copy no longer matches its ISBN, and a wish keeps its own ISBN searchable", () => {
  const sold = book("Sold");
  const wanted = book("Wanted", { status: "wish", data: { isbn: "9789799731234" } });
  const rows = [sold, copy(sold, { status: "gone", data: { isbn: "9789793062792" } }), wanted];
  assert.deepEqual(titles(searchBooks("978-979-3062", rows)), []);
  assert.deepEqual(titles(searchBooks("978-979-9731", rows)), ["Wanted"]);
});

test("the wishlist splits next-up wishes from the rest, both by manual order, and leaves the shelf out", () => {
  const rows = [
    book("Low", { status: "wish", sort: 1, data: { priority: "low" } }),
    book("High B", { status: "wish", sort: 3, data: { priority: "high" } }),
    book("Plain", { status: "wish", sort: 0 }),
    book("High A", { status: "wish", sort: 2, data: { priority: "high" } }),
    laskar,
    homeA,
  ];
  const { next, someday } = wishSections(rows);
  assert.deepEqual(titles(next), ["High A", "High B"]);
  assert.deepEqual(titles(someday), ["Plain", "Low"]);
  assert.deepEqual(wishSections([laskar]), { next: [], someday: [] });
});
