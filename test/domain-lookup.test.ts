import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheKey, lookupUrl, parseLookup, paramsOf, queryOf } from "../src/domain/lookup.ts";
import type { Hit } from "../src/domain/openlibrary.ts";
import { isCover, validateCreate } from "../shared/validate.ts";

const params = (init: Record<string, string>) => new URLSearchParams(init);

test("an ISBN query is exactly 13 digits with a valid check digit and nothing else", () => {
  assert.deepEqual(queryOf(params({ isbn: "9789793062792" })), { kind: "isbn", isbn: "9789793062792" });
  for (const isbn of ["9789793062793", "978979306279", "97897930627920", "9793062797", "978-979-3062-79-2", " 9789793062792", "97897930627x2", "", "９７８９７９３０６２７９２"]) {
    assert.equal(queryOf(params({ isbn })), null, isbn);
  }
  assert.equal(queryOf(params({ isbn: "9789793062792", title: "x" })), null);
  assert.equal(queryOf(params({ isbn: "9789793062792", author: "x" })), null);
});

test("a title query is folded to one trimmed lowercase line with an optional author", () => {
  assert.deepEqual(queryOf(params({ title: "  Laskar\tPELANGI \n" })), { kind: "title", title: "laskar pelangi", author: "" });
  assert.deepEqual(queryOf(params({ title: "Bumi Manusia", author: " Pramoedya  Ananta Toer " })), { kind: "title", title: "bumi manusia", author: "pramoedya ananta toer" });
  assert.deepEqual(queryOf(params({ title: "Pangeran​ Kecil\u0000" })), { kind: "title", title: "pangeran kecil", author: "" });
  assert.deepEqual(queryOf(params({ title: "Saint-Exupéry", author: "é" })), { kind: "title", title: "saint-exupéry", author: "é" });
  assert.deepEqual(queryOf(params({ title: "Le Petit Prince", side: "a" })), { kind: "title", title: "le petit prince", author: "" });
});

test("a title needs two characters and at most 200, an author at most 120, and a title is required", () => {
  for (const title of ["", " ", "a", " a ", "​​", "x".repeat(201), "😀".repeat(201)]) assert.equal(queryOf(params({ title })), null, title.slice(0, 8));
  assert.notEqual(queryOf(params({ title: "ab" })), null);
  assert.notEqual(queryOf(params({ title: "x".repeat(200) })), null);
  assert.notEqual(queryOf(params({ title: "😀".repeat(200) })), null);
  assert.notEqual(queryOf(params({ title: "ab", author: "y".repeat(120) })), null);
  assert.equal(queryOf(params({ title: "ab", author: "y".repeat(121) })), null);
  assert.equal(queryOf(params({ author: "Someone" })), null);
  assert.equal(queryOf(params({})), null);
});

test("the same book asked differently has one cache key, and different books have different keys", () => {
  const key = (init: Record<string, string>) => cacheKey(queryOf(params(init))!);
  assert.equal(key({ title: "Laskar Pelangi" }), key({ title: "  laskar   pelangi " }));
  assert.equal(key({ title: "Laskar Pelangi", author: "Andrea Hirata" }), key({ title: "LASKAR PELANGI", author: "andrea  hirata" }));
  assert.notEqual(key({ title: "Laskar Pelangi" }), key({ title: "Laskar Pelangi", author: "Andrea Hirata" }));
  assert.notEqual(key({ title: "aa bb", author: "cc" }), key({ title: "aa", author: "bb cc" }));
  assert.notEqual(key({ title: "9789793062792" }), key({ isbn: "9789793062792" }));
  assert.notEqual(key({ title: "ab", author: "cd" }), key({ title: "cd", author: "ab" }));
});

test("a cache key is a URL on a reserved host, with the query as data and no key or secret", () => {
  const url = new URL(cacheKey({ kind: "title", title: "a&key=SECRET #x", author: "" }));
  assert.equal(url.origin, "https://lookup.invalid");
  assert.deepEqual([...url.searchParams.keys()], ["title", "author"]);
  assert.equal(url.searchParams.get("title"), "a&key=SECRET #x");
  assert.equal(url.hash, "");
  assert.deepEqual([...new URL(cacheKey({ kind: "isbn", isbn: "9789793062792" })).searchParams.keys()], ["isbn"]);
});

test("the client URL is the route with the query as data", () => {
  assert.equal(lookupUrl({ kind: "isbn", isbn: "9789793062792" }), "/api/lookup?isbn=9789793062792");
  assert.equal(lookupUrl({ kind: "title", title: "Laskar Pelangi", author: "" }), "/api/lookup?title=Laskar+Pelangi&author=");
  assert.equal(new URLSearchParams(lookupUrl({ kind: "title", title: "a&b=c", author: "d#e" }).split("?")[1]).get("title"), "a&b=c");
  assert.equal(paramsOf({ kind: "title", title: "x", author: "y" }).toString(), "title=x&author=y");
});

const good = (extra: object = {}): Hit => ({ source: "google", work: "Vol1AbCdEfGh", title: "Bumi Manusia", author: "Pramoedya Ananta Toer", year: 2005, cover: "https://books.google.com/books/content?id=Vol1AbCdEfGh", isbns: ["9789793062792"], language: "id", blurb: "Invented.", ...extra });

test("a good answer parses to the same hits, and at most eight", () => {
  assert.deepEqual(parseLookup({ hits: [good(), good({ source: "openlibrary", work: "OL1W", cover: null, blurb: null, isbns: [], language: null, year: null })] }), [good(), good({ source: "openlibrary", work: "OL1W", cover: null, blurb: null, isbns: [], language: null, year: null })]);
  assert.equal(parseLookup({ hits: Array.from({ length: 12 }, (_, n) => good({ work: `Vol${n}` })) }).length, 8);
});

test("a body of any other shape gives no hits", () => {
  for (const body of [null, "x", 7, [], {}, { hits: "x" }, { hits: [null, 1, "x", [], {}] }]) assert.deepEqual(parseLookup(body), []);
});

test("a hostile hit is dropped, whatever field is bad", () => {
  const bad: object[] = [
    { source: "other" },
    { source: "google", work: "a b" },
    { source: "openlibrary", work: "Vol1AbCdEfGh" },
    { work: "a/b" },
    { work: 5 },
    { title: "" },
    { title: " " },
    { title: 5 },
    { title: "x".repeat(201) },
    { author: 5 },
    { author: "x".repeat(401) },
    { cover: "javascript:alert(1)" },
    { cover: "https://evil.test/books/content?id=a" },
    { cover: undefined },
    { isbns: ["9789793062793"] },
    { isbns: Array.from({ length: 6 }, () => "9789793062792") },
    { language: "fr" },
    { language: undefined },
    { blurb: 5 },
    { blurb: "x".repeat(502) },
    { blurb: undefined },
  ];
  for (const extra of bad) assert.deepEqual(parseLookup({ hits: [good(extra)] }), [], JSON.stringify(extra));
});

test("a year that is not a positive whole number is dropped to nothing, a title and blurb are trimmed", () => {
  assert.equal(parseLookup({ hits: [good({ year: -1 })] })[0].year, null);
  assert.equal(parseLookup({ hits: [good({ year: "2005" })] })[0].year, null);
  const [hit] = parseLookup({ hits: [good({ title: "  T  ", blurb: " B " })] });
  assert.deepEqual([hit.title, hit.blurb], ["T", " B "]);
});

const COVER_OK = [
  "https://covers.openlibrary.org/b/id/7079796-M.jpg",
  "https://books.google.com/books/content?id=abc&printsec=frontcover&img=1&source=gbs_api",
  "https://books.google.com/books/content/images/frontcover/abc?fife=w200-h300",
  "https://books.google.com/books/publisher/content/images/frontcover/abc?fife=w200-h300",
  "https://books.googleusercontent.com/books/content?id=abc",
];

const COVER_BAD = [
  "http://covers.openlibrary.org/b/id/1-M.jpg",
  "http://books.google.com/books/content?id=abc",
  "https://books.google.com/books/content",
  "https://books.google.com/books/contentx?id=abc",
  "https://books.google.com/books/content?",
  "https://books.google.com/books/publisher/other?id=abc",
  "https://books.google.com/",
  "https://books.google.com",
  "https://books.google.com.evil.test/books/content?id=abc",
  "https://books.google.com@evil.test/books/content?id=abc",
  "https://evil.test/https://books.google.com/books/content?id=abc",
  "https://user@books.google.com/books/content?id=abc",
  "https://user:pw@books.googleusercontent.com/x",
  "https://books.googleusercontent.com",
  "https://books.googleusercontent.com.evil.test/x",
  "https://xbooks.googleusercontent.com/x",
  "https://lh3.googleusercontent.com/x",
  "https://googleusercontent.com/x",
  "https://google.com/books/content?id=abc",
  "https://books.google.com:443/books/content?id=abc",
  "https://BOOKS.google.com/books/content?id=abc",
  "https://books.google.com/books/content?id=a b",
  "https://books.google.com/books/content?id=é",
  "https://books.google.com/books/content?id=a\nb",
  `https://books.google.com/books/content?${"a".repeat(201)}`,
  `https://covers.openlibrary.org/${"a".repeat(201)}`,
  "javascript:alert(1)",
  "",
];

test("the cover allow-list takes the Open Library host and the two Google image hosts, with https only, no credentials, no port and a path prefix", () => {
  for (const url of COVER_OK) assert.equal(isCover(url), true, url);
  for (const url of COVER_BAD) assert.equal(isCover(url), false, url);
  for (const value of [null, undefined, 5, {}, []]) assert.equal(isCover(value), false);
  assert.equal(isCover(`https://books.google.com/books/content?${"a".repeat(200)}`), true);
  assert.equal(isCover(`https://covers.openlibrary.org/${"a".repeat(200)}`), true);
});

test("a book row accepts a Google cover and refuses a lookalike", () => {
  const row = (cover: string) => ({ id: "00000000-0000-4000-8000-000000000001", kind: "book", title: "Placeholder", status: "wish", created_at: "2026-10-06T05:00:00Z", updated_at: "2026-10-06T05:00:00Z", data: { cover } });
  assert.deepEqual(validateCreate("items", row("https://books.google.com/books/content?id=abc")), []);
  assert.deepEqual(validateCreate("items", row("https://books.googleusercontent.com/x")), []);
  assert.match(validateCreate("items", row("https://books.google.com.evil.test/books/content?id=abc")).join("\n"), /data\.cover: must be an https URL on covers\.openlibrary\.org, books\.google\.com or books\.googleusercontent\.com/);
});

test("the size limits are inclusive: 200 characters of title, 400 of author, five ISBNs and 501 of blurb pass, one more does not", () => {
  const sizes = (extra: object) => parseLookup({ hits: [good(extra)] }).length;
  assert.equal(sizes({ title: "x".repeat(200) }), 1);
  assert.equal(sizes({ author: "x".repeat(400) }), 1);
  assert.equal(sizes({ blurb: "x".repeat(501) }), 1);
  assert.equal(sizes({ isbns: Array.from({ length: 5 }, () => "9789793062792") }), 1);
  assert.equal(sizes({ title: "x".repeat(201) }), 0);
});
