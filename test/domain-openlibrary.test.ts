import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adopt, arrive, coverUrl, fillPatch, isbnUrl, parseBlurb, parseIsbn, parseSearch, queriesOf, release, sameBook, sameTitle, searchUrl, settle, workPage, workUrl } from "../src/domain/openlibrary.ts";
import type { Hit, Typed } from "../src/domain/openlibrary.ts";
import { isCover } from "../shared/validate.ts";

const sample = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/openlibrary/${name}.json`, import.meta.url), "utf8"));

test("a search hit carries the work, the title, the authors, the year, the edition's ISBN-13, language and cover", () => {
  const [first, second] = parseSearch(sample("laskar-pelangi-search"));
  assert.deepEqual(first, { work: "OL15302003W", title: "Laskar Pelangi", author: "Andrea Hirata", year: 2005, coverId: 7079796, isbn: "9789793062792", language: "id" });
  assert.equal(second.title, "The rainbow troops");
  assert.equal(second.language, "en");
  assert.equal(second.isbn, "9780374246310");
  assert.equal(second.coverId, 13007586);
});

test("an edition without an ISBN leaves the ISBN empty and takes the edition's own cover", () => {
  const [first, second] = parseSearch(sample("bumi-manusia-search"));
  assert.deepEqual(first, { work: "OL307247W", title: "Bumi Manusia", author: "Pramoedya Ananta Toer", year: 1972, coverId: 15122195, isbn: null, language: "id" });
  assert.deepEqual([second.language, second.coverId], ["other", null]);
});

test("an edition in two languages gives neither an ISBN nor a language, and the work's cover stands in for its own", () => {
  const [first, second, third] = parseSearch(sample("little-prince-search"));
  assert.deepEqual(first, { work: "OL10263W", title: "Le petit prince", author: "Antoine de Saint-Exupéry", year: 1943, coverId: 10708272, isbn: null, language: null });
  assert.deepEqual([second.isbn, second.language, second.coverId], ["9781467707374", null, 7605279]);
  assert.deepEqual([third.isbn, third.language, third.coverId], [null, "en", 14491562]);
});

test("a search body of any other shape gives no hits, and bad docs are skipped", () => {
  for (const body of [null, "x", 7, [], {}, { docs: "x" }, { docs: [null, 1, "x", [], {}] }]) assert.deepEqual(parseSearch(body), []);
  const doc = { key: "/works/OL1W", title: "T" };
  const bad = [{ ...doc, key: "/works/x" }, { ...doc, key: 5 }, { ...doc, title: " " }, { ...doc, title: 4 }];
  assert.deepEqual(parseSearch({ docs: bad }), []);
  assert.deepEqual(parseSearch({ docs: [{ ...doc, author_name: [1, "A", "B", "C", "D"], first_publish_year: -1, cover_i: "7", editions: { docs: "x" } }] }), [
    { work: "OL1W", title: "T", author: "A; B; C", year: null, coverId: null, isbn: null, language: null },
  ]);
  assert.equal(parseSearch({ docs: Array.from({ length: 9 }, (_, n) => ({ key: `/works/OL${n + 1}W`, title: "T" })) }).length, 5);
});

test("a year or a cover id that is not a positive whole number is ignored, and a title is trimmed", () => {
  const doc = (extra: object) => parseSearch({ docs: [{ key: "/works/OL1W", title: "  Spaced  ", ...extra }] })[0];
  assert.deepEqual([doc({}).title, doc({ first_publish_year: 1943 }).year, doc({ cover_i: 7 }).coverId], ["Spaced", 1943, 7]);
  for (const bad of [0, -3, 7.5, "7", null, Number.NaN]) {
    assert.deepEqual([doc({ first_publish_year: bad }).year, doc({ cover_i: bad }).coverId, doc({ editions: { docs: [{ cover_i: bad, language: ["ind"] }] } }).coverId], [null, null, null], String(bad));
  }
});

test("the first valid ISBN in the edition is used, and an ISBN-10 becomes an ISBN-13", () => {
  const docs = (isbn: unknown) => ({ docs: [{ key: "/works/OL1W", title: "T", editions: { docs: [{ isbn, language: ["ind"] }] } }] });
  assert.equal(parseSearch(docs(["123", "0156012197", "9789793062792"]))[0].isbn, "9780156012195");
  assert.equal(parseSearch(docs(["123", 5]))[0].isbn, null);
  assert.equal(parseSearch(docs("9789793062792"))[0].isbn, null);
});

test("a lookup by ISBN takes the work whose edition has that ISBN, else the first hit, else nothing", () => {
  assert.equal(parseIsbn(sample("laskar-pelangi-isbn"), "9789793062792")?.work, "OL15302003W");
  const body = { docs: [{ key: "/works/OL1W", title: "A" }, { key: "/works/OL2W", title: "B", editions: { docs: [{ isbn: ["9789793062792"] }] } }] };
  assert.equal(parseIsbn(body, "9789793062792")?.work, "OL2W");
  assert.equal(parseIsbn(body, "9780156012195")?.work, "OL1W");
  assert.equal(parseIsbn({ docs: [] }, "9780156012195"), null);
});

test("a description is the first paragraph on one line, from a string or a typed value", () => {
  assert.equal(parseBlurb(sample("laskar-pelangi-work"))?.startsWith("“Laskar Pelangi adalah ramuan"), true);
  assert.equal(parseBlurb(sample("laskar-pelangi-work"))?.includes("\n"), false);
  const typed = parseBlurb(sample("little-prince-work"));
  assert.match(typed ?? "", /^\*Le Petit Prince\* est une œuvre de langue française/);
  assert.doesNotMatch(typed ?? "", /Traduit en/);
  assert.equal(parseBlurb({ description: "One\r\ntwo  three\u0007four\n\nNext" }), "One two three four");
  assert.equal(parseBlurb({ description: "Intro ----------\nSee also" }), "Intro");
  assert.equal(parseBlurb({ description: "\n\nAfter a gap" }), "After a gap");
  assert.equal(parseBlurb({ description: "Well --- known" }), "Well --- known");
  assert.equal(parseBlurb({ description: "Well ---- known" }), "Well ---- known");
  assert.equal(parseBlurb({ description: "Intro -----\nSee also" }), "Intro");
  assert.equal(parseBlurb({ description: "Read [more](https://example.com/x) now" }), "Read more now");
  assert.equal(parseBlurb({ description: { value: "Typed" } }), "Typed");
  for (const body of [null, {}, { description: "" }, { description: " \n " }, { description: 5 }, { description: { value: 5 } }]) {
    assert.equal(parseBlurb(body), null);
  }
});

test("a long description is cut at a word under 500 characters and ends with an ellipsis", () => {
  const long = Array.from({ length: 200 }, () => "word").join(" ");
  const cut = parseBlurb({ description: long }) ?? "";
  assert.ok(cut.length <= 500 && cut.endsWith("word…"), String(cut.length));
  assert.equal(parseBlurb({ description: "x".repeat(500) }), "x".repeat(500));
  assert.equal(parseBlurb({ description: "x".repeat(501) }), `${"x".repeat(500)}…`);
  assert.equal(parseBlurb({ description: `${"x".repeat(499)} yy` }), `${"x".repeat(499)}…`);
  assert.equal(parseBlurb({ description: `${"x".repeat(400)} ${"y".repeat(99)} zz` }), `${"x".repeat(400)} ${"y".repeat(99)}…`);
  assert.equal(parseBlurb({ description: `${"x".repeat(400)} ${"y".repeat(100)} zz` }), `${"x".repeat(400)}…`);
  assert.equal(parseBlurb({ description: "x".repeat(600) }), `${"x".repeat(500)}…`);
});

test("urls carry only the query, a field list and a limit, and the cover url is one the registry accepts", () => {
  const url = new URL(searchUrl("pangeran kecil Antoine"));
  assert.equal(`${url.origin}${url.pathname}`, "https://openlibrary.org/search.json");
  assert.deepEqual([...url.searchParams.keys()], ["q", "limit", "fields"]);
  assert.equal(url.searchParams.get("q"), "pangeran kecil Antoine");
  assert.equal(url.searchParams.get("limit"), "5");
  assert.match(url.searchParams.get("fields") ?? "", /^key,title,author_name,first_publish_year,cover_i,editions/);
  assert.doesNotMatch(url.searchParams.get("fields") ?? "", /(^|,)isbn/);
  const byIsbn = new URL(isbnUrl("9789793062792"));
  assert.deepEqual([...byIsbn.searchParams.keys()], ["isbn", "limit", "fields"]);
  assert.equal(new URL(searchUrl("a&b=c#d")).searchParams.get("q"), "a&b=c#d");
  assert.equal(workUrl("OL15302003W"), "https://openlibrary.org/works/OL15302003W.json");
  assert.equal(coverUrl(7079796), "https://covers.openlibrary.org/b/id/7079796-M.jpg");
  assert.ok(isCover(coverUrl(7079796)));
});

test("the work page link is built only from a well-formed work id", () => {
  assert.equal(workPage("OL15302003W"), "https://openlibrary.org/works/OL15302003W");
  for (const bad of ["", "x", "OL1M", "OL1W/../x", "javascript:1", "../OL1W"]) assert.equal(workPage(bad), null, bad);
});

test("the title is searched first with the author, then the original title", () => {
  assert.deepEqual(queriesOf({ title: "Pangeran Kecil", author: "", original: "" }), ["Pangeran Kecil"]);
  assert.deepEqual(queriesOf({ title: " Pangeran  Kecil ", author: " Antoine ", original: "Le Petit Prince" }), ["Pangeran Kecil Antoine", "Le Petit Prince Antoine"]);
  assert.deepEqual(queriesOf({ title: "Le Petit Prince", author: "", original: "Le Petit Prince" }), ["Le Petit Prince"]);
  assert.deepEqual(queriesOf({ title: "", author: "", original: "Le Petit Prince" }), ["Le Petit Prince"]);
  assert.deepEqual(queriesOf({ title: "", author: "Antoine", original: "" }), []);
  assert.deepEqual(queriesOf({ title: " ", author: "", original: " " }), []);
});

test("a typed title the hit contains becomes the hit's title; a translation keeps the typed title and the hit's goes to the original", () => {
  assert.deepEqual(settle("laskar", "Laskar Pelangi"), { title: "Laskar Pelangi", original: "" });
  assert.deepEqual(settle("bumi manusia", "Bumi manusia"), { title: "Bumi manusia", original: "" });
  assert.deepEqual(settle("", "The Little Prince"), { title: "The Little Prince", original: "" });
  assert.deepEqual(settle("Pangeran Kecil ", "Le petit prince"), { title: "Pangeran Kecil", original: "Le petit prince" });
  assert.deepEqual(settle("the little prince", "Le petit prince"), { title: "the little prince", original: "Le petit prince" });
  assert.deepEqual(settle("lask", "Laskar Pelangi"), { title: "Laskar Pelangi", original: "" });
  assert.deepEqual(settle("Laskar Pelangi 2", "Laskar Pelangi"), { title: "Laskar Pelangi 2", original: "Laskar Pelangi" });
});

test("filling an existing book adds only what it lacks and never replaces what is there", () => {
  const [hit] = parseSearch(sample("bumi-manusia-search"));
  const blank = { title: "Bumi Manusia", data: null };
  assert.deepEqual(fillPatch(blank, hit, "Short"), {
    author: "Pramoedya Ananta Toer",
    language: "id",
    cover: "https://covers.openlibrary.org/b/id/15122195-M.jpg",
    ol: "OL307247W",
    blurb: "Short",
  });
  assert.deepEqual(fillPatch({ title: "Bumi Manusia", data: { author: "Typed", cover: "https://covers.openlibrary.org/b/id/1-M.jpg", blurb: "Mine", ol: "OL1W", language: "en" } }, hit, "Short"), {});
  assert.deepEqual(fillPatch({ title: "Bumi Manusia", data: { author: null, ol: "OL1W" } }, hit, null), {
    author: "Pramoedya Ananta Toer",
    language: "id",
    cover: "https://covers.openlibrary.org/b/id/15122195-M.jpg",
  });
  assert.deepEqual(fillPatch({ title: "Bumi Manusia", data: null }, { ...hit, author: "", coverId: null, language: null }, ""), { ol: "OL307247W" });
});

test("filling a book whose title is not the hit's title writes nothing, so another work's cover, key and blurb never land on it", () => {
  const [laskar] = parseSearch(sample("laskar-pelangi-isbn"));
  assert.equal(fillPatch({ title: "Pangeran Kecil", data: null }, laskar, "Blurb of Laskar Pelangi"), null);
  assert.equal(fillPatch({ title: "Pangeran Kecil", data: { author: "Partner A" } }, laskar, null), null);
  assert.equal(fillPatch({ title: "Laskar", data: null }, laskar, null), null);
  assert.notEqual(fillPatch({ title: "Laskar Pelangi", data: null }, laskar, null), null);
});

test("a translated book matches the hit by its original title, and then takes no language from that edition", () => {
  const [prince] = parseSearch(sample("little-prince-search"));
  const patch = fillPatch({ title: "Pangeran Kecil", data: { original_title: "Le petit prince" } }, { ...prince, language: "en" }, "Blurb");
  assert.deepEqual(patch, {
    author: "Antoine de Saint-Exupéry",
    cover: "https://covers.openlibrary.org/b/id/10708272-M.jpg",
    ol: "OL10263W",
    blurb: "Blurb",
  });
  assert.equal(fillPatch({ title: "Pangeran Kecil", data: { original_title: "" } }, prince, null), null);
  assert.equal(fillPatch({ title: "Pangeran Kecil", data: { original_title: "Mine" } }, prince, null), null);
  assert.equal(fillPatch({ title: "Pangeran Kecil", data: { original_title: 5 } }, prince, null), null);
});

const form = (over: Partial<Typed> = {}): Typed => ({ title: "", author: "", original: "", isbn: "", language: "", blurb: "", found: null, ...over });

const take = (typed: Typed, hit: Hit): Typed => {
  const next = adopt(typed, hit);
  return { ...typed, title: next.title, ...Object.fromEntries(Object.entries(next.patch).filter(([, value]) => value !== null)), found: next.found };
};

const fieldsOf = ({ title, author, original, isbn, language, blurb }: Typed) => ({ title, author, original, isbn, language, blurb });

const laskar = () => parseSearch(sample("laskar-pelangi-search"))[0];
const bumi = () => parseSearch(sample("bumi-manusia-search"))[0];

test("tapping a result on an empty form fills the author, the ISBN and the language, asks for the description and remembers what it filled", () => {
  const next = adopt(form({ title: "laskar" }), laskar());
  assert.deepEqual(next.patch, { author: "Andrea Hirata", original: "", isbn: "9789793062792", language: "id", blurb: "" });
  assert.equal(next.title, "Laskar Pelangi");
  assert.equal(next.wantsBlurb, true);
  assert.deepEqual(next.found, {
    title: "Laskar Pelangi",
    cover: "https://covers.openlibrary.org/b/id/7079796-M.jpg",
    ol: "OL15302003W",
    auto: { author: "Andrea Hirata", isbn: "9789793062792", language: "id" },
  });
  assert.deepEqual(adopt(form({ title: "laskar", author: " ", isbn: "\n" }), laskar()).patch, next.patch);
  assert.equal(adopt(form({ title: "Laskar Pelangi" }), { ...laskar(), coverId: null }).found.cover, null);
});

test("what the user typed is kept, and only that: the description is not asked for when one is typed", () => {
  const next = adopt(form({ title: "Laskar Pelangi", author: "Partner A", language: "other", isbn: "9780156012195", blurb: "Mine" }), laskar());
  assert.deepEqual(next.patch, { author: null, original: "", isbn: null, language: null, blurb: null });
  assert.equal(next.wantsBlurb, false);
  assert.deepEqual(next.found.auto, {});
  assert.deepEqual(adopt(form({ title: "Laskar Pelangi" }), { ...laskar(), author: "", isbn: null, language: null }).found.auto, {});
});

test("a hit under another title gives its original title and author, but not the ISBN and language of an edition the user may not own", () => {
  const [, rainbow] = parseSearch(sample("laskar-pelangi-search"));
  const next = adopt(form({ title: "Laskar Pelangi" }), rainbow);
  assert.deepEqual(next.patch, { author: "Andrea Hirata", original: "The rainbow troops", isbn: "", language: "", blurb: "" });
  assert.deepEqual(next.found.auto, { author: "Andrea Hirata", original: "The rainbow troops" });
  assert.equal(adopt(form({ title: "Laskar Pelangi", original: "Mine" }), rainbow).patch.original, null);
  assert.deepEqual(adopt(form(), rainbow).patch, { author: "Andrea Hirata", original: "", isbn: "9780374246310", language: "en", blurb: "" });
});

test("picking a second result replaces everything the first pick filled, and writes no ISBN of the first edition under the second title", () => {
  const first = take(form({ title: "Laskar Pelangi" }), laskar());
  const withBlurb = { ...first, ...arrive(first, "OL15302003W", "The rainbow troops blurb") };
  assert.deepEqual(fieldsOf(withBlurb), { title: "Laskar Pelangi", author: "Andrea Hirata", original: "", isbn: "9789793062792", language: "id", blurb: "The rainbow troops blurb" });
  const second = take({ ...withBlurb, title: "Bumi Manusia" }, bumi());
  assert.deepEqual(fieldsOf(second), { title: "Bumi Manusia", author: "Pramoedya Ananta Toer", original: "", isbn: "", language: "id", blurb: "" });
  assert.deepEqual(second.found?.auto, { author: "Pramoedya Ananta Toer", language: "id" });
  assert.equal(second.found?.ol, "OL307247W");
});

test("picking again keeps a field the user edited after the first pick, and replaces the rest", () => {
  const first = take(form({ title: "Laskar Pelangi" }), laskar());
  const second = take({ ...first, title: "Bumi Manusia", author: "Partner B", language: "other" }, bumi());
  assert.deepEqual(fieldsOf(second), { title: "Bumi Manusia", author: "Partner B", original: "", isbn: "", language: "other", blurb: "" });
  assert.deepEqual(second.found?.auto, {});
});

test("a pick over a translation's original title does not leave that original title on an edition pick", () => {
  const [prince] = parseSearch(sample("little-prince-search"));
  const first = take(form({ title: "Pangeran Kecil" }), prince);
  assert.deepEqual([first.title, first.original, first.isbn], ["Pangeran Kecil", "Le petit prince", ""]);
  const second = take({ ...first, title: "Laskar Pelangi" }, laskar());
  assert.deepEqual([second.original, second.isbn, second.author], ["", "9789793062792", "Andrea Hirata"]);
});

test("when the title no longer matches the pick, what the pick filled is cleared and what the user edited stays", () => {
  const first = take(form({ title: "Laskar Pelangi" }), laskar());
  const filled = { ...first, ...arrive(first, "OL15302003W", "Blurb") };
  assert.deepEqual(release({ ...filled, title: "" }), { author: "", original: null, isbn: "", language: "", blurb: "" });
  assert.deepEqual(release({ ...filled, author: "Partner A", blurb: "Mine" }), { author: null, original: null, isbn: "", language: "", blurb: null });
  assert.deepEqual(release(form({ author: "Partner A", isbn: "9789793062792" })), { author: null, original: null, isbn: null, language: null, blurb: null });
});

test("a description arrives only for the pick still shown, only into an empty or untouched description, and is remembered as filled", () => {
  const first = take(form({ title: "Laskar Pelangi" }), laskar());
  assert.deepEqual(arrive(first, "OL15302003W", "Blurb"), { blurb: "Blurb", found: { ...first.found, auto: { ...first.found?.auto, blurb: "Blurb" } } });
  assert.equal(arrive(first, "OL307247W", "Blurb"), null);
  assert.equal(arrive({ blurb: "", found: null }, "OL15302003W", "Blurb"), null);
  assert.equal(arrive(first, "OL15302003W", " "), null);
  assert.equal(arrive({ ...first, blurb: "Mine" }, "OL15302003W", "Blurb"), null);
  const arrived = { ...first, ...arrive(first, "OL15302003W", "Blurb") };
  assert.equal(arrive(arrived, "OL15302003W", "Newer")?.blurb, "Newer");
  assert.equal(arrive({ ...arrived, blurb: "Blurb, edited" }, "OL15302003W", "Newer"), null);
});

const SAME: [string, string][] = [
  ["Laskar Pelangi", "Laskar Pelangi"],
  ["laskar pelangi", "  Laskar   Pelangi! "],
  ["Pangéran Kécil", "pangeran kecil"],
  ["Bumi Manusia", "Bumi Manusia: Sebuah Novel"],
  ["Bumi Manusia: Sebuah Novel", "Bumi Manusia"],
  ["Laskar Pelangi", "Laskar Pelangi – Sebuah Novel"],
  ["Laskar Pelangi — Novel", "Laskar Pelangi"],
  ["Bumi Manusia", "Bumi Manusia - Novel"],
  ["Bumi Manusia (Series 1)", "Bumi Manusia"],
  ["Laskar Pelangi", "Laskar Pelangi Vol. 3"],
  ["Laskar Pelangi, Book 2", "Laskar Pelangi"],
  ["Pangeran Kecil #2", "Pangeran Kecil"],
  ["Pangeran Kecil", "Pangeran Kecil 2"],
  ["Le petit prince", "Le Petit Prince!"],
];

const OTHER: [string, string][] = [
  ["Laskar", "Laskar Pelangi"],
  ["Laskar Pelangi", "Laskar"],
  ["Laskar Pelangi", "Laskar Pelangi Dua"],
  ["Bumi Manusia Anak", "Bumi Manusia"],
  ["Laskar Pelangi Vol. 2", "Laskar Pelangi Vol. 3"],
  ["Laskar Pelangi: Novel", "Laskar Pelangi: Sekuel"],
  ["Bumi Manusia (Series 1)", "Bumi Manusia (Series 2)"],
  ["Laskar Pelangi", "Bumi Manusia"],
  ["Pangeran Kecil", "Le petit prince"],
  ["Pangeran", "Pangeran Kecil"],
  ["Laskar Pelangi", ""],
];

test("the same title: equal after folding, or one is the other plus a subtitle, a bracketed series note or a volume number", () => {
  for (const [typed, found] of SAME) assert.equal(sameTitle(typed, found), true, `${typed} / ${found}`);
});

test("a sibling, a prefix, another volume or subtitle and a translation are not the same title, in either order", () => {
  for (const [typed, found] of OTHER) {
    assert.equal(sameTitle(typed, found), false, `${typed} / ${found}`);
    assert.equal(sameTitle(found, typed), false, `${found} / ${typed}`);
  }
});

test("one rule says whether a hit is the book: its title, its original title when there is one, or any hit while the title is still blank", () => {
  const book = (title: string, original: unknown = "") => sameBook({ title, original }, "Le petit prince");
  assert.equal(book("Le petit prince"), true);
  assert.equal(book("Pangeran Kecil", "Le petit prince"), true);
  assert.equal(book("Pangeran Kecil", "Le Petit Prince: Novel"), true);
  assert.equal(book("Pangeran Kecil"), false);
  assert.equal(book("Pangeran Kecil", " "), false);
  assert.equal(book("Pangeran Kecil", 5), false);
  assert.equal(book("Pangeran Kecil", "Laskar Pelangi"), false);
  assert.equal(book(" "), true);
  assert.equal(book("", "Laskar Pelangi"), true);
});
