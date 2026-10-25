import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { POWERED_BY, googleCover, googleUrl, parseGoogle } from "../src/domain/googlebooks.ts";
import { fillPatch, sameAuthor } from "../src/domain/openlibrary.ts";
import { isCover } from "../shared/validate.ts";

const sample = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/google/${name}.json`, import.meta.url), "utf8"));

const volume = (info: object, id = "Vol1AbCdEfGh") => ({ items: [{ id, volumeInfo: { title: "T", ...info } }] });

const one = (info: object, id?: string) => parseGoogle(volume(info, id))[0];

test("a volume carries the id, title, authors, year, language, ISBN-13s, https cover and no blurb", () => {
  const [first, second, third, fourth] = parseGoogle(sample("laskar-pelangi"));
  assert.deepEqual(first, {
    source: "google",
    work: "Lp1AbCdEfGhI",
    title: "Laskar Pelangi",
    author: "Andrea Hirata",
    year: 2008,
    cover: "https://books.google.com/books/content?id=Lp1AbCdEfGhI&printsec=frontcover&img=1&source=gbs_api",
    isbns: ["9789793062792"],
    language: "id",
    blurb: null,
  });
  assert.deepEqual([second.year, second.isbns, second.blurb], [2013, ["9789791227780"], null]);
  assert.deepEqual([third.language, third.isbns, third.cover], ["en", ["9780374246310"], null]);
  assert.deepEqual([fourth.author, fourth.isbns, fourth.title], ["", [], "Laskar Pelangi (Edisi Anak)"]);
});

test("the subtitle is left out of the title so a typed title still matches", () => {
  const [first] = parseGoogle(sample("laskar-pelangi"));
  assert.equal(first.title, "Laskar Pelangi");
});

test("authors are capped at three and each one is cleaned", () => {
  assert.equal(one({ authors: ["A", " B\u0000 ", "", 7, "C", "D"] }).author, "A; B; C");
  assert.equal(one({ authors: "A" }).author, "");
  assert.equal(one({ authors: ["x".repeat(300)] }).author.length, 100);
});

test("a title is cleaned and capped, and a volume without a usable title or id is dropped", () => {
  assert.equal(one({ title: "  Bumi ​\n Manusia  " }).title, "Bumi Manusia");
  assert.equal(one({ title: "x".repeat(900) }).title.length, 200);
  for (const title of ["", "  ", "​", 5, null]) assert.deepEqual(parseGoogle(volume({ title })), [], String(title));
  for (const id of ["", "a/b", "a b", "x".repeat(33), "id?x=1", "<b>"]) assert.deepEqual(parseGoogle(volume({}, id)), [], id);
  assert.deepEqual(parseGoogle({ items: [{ volumeInfo: { title: "T" } }, { id: 5, volumeInfo: { title: "T" } }] }), []);
});

test("a title with HTML stays plain text, never markup the code interprets", () => {
  const hit = one({ title: "<img src=x onerror=alert(1)>Bumi", authors: ["<b>Name</b>"] });
  assert.equal(hit.title, "<img src=x onerror=alert(1)>Bumi");
  assert.equal(hit.author, "<b>Name</b>");
});

test("a body of any other shape gives no hits", () => {
  for (const body of [null, "x", 7, [], {}, { items: "x" }, { items: [null, 1, "x", [], {}] }, { items: [{ id: "abc", volumeInfo: "x" }] }]) assert.deepEqual(parseGoogle(body), []);
});

test("at most eight volumes, and one hit per id", () => {
  const items = Array.from({ length: 12 }, (_, n) => ({ id: `Vol${n}AbCdEfGh`, volumeInfo: { title: `T${n}` } }));
  assert.equal(parseGoogle({ items }).length, 8);
  const twice = parseGoogle({ items: [items[0], items[1], items[0]] });
  assert.deepEqual(twice.map((hit) => hit.work), ["Vol0AbCdEfGh", "Vol1AbCdEfGh"]);
});

test("the year is the first four digits of the date, else nothing", () => {
  assert.deepEqual(["2008", "2008-01", "2008-01-31", "1999-12-31T00:00:00Z"].map((publishedDate) => one({ publishedDate }).year), [2008, 2008, 2008, 1999]);
  for (const publishedDate of ["", "x", "20", "0000", 2008, null, "'08", "x2008", " 2008", "c. 2008"]) assert.equal(one({ publishedDate }).year, null, String(publishedDate));
});

test("the language is id, en, other, or unknown", () => {
  assert.deepEqual(["id", "en", "fr", "jv"].map((language) => one({ language }).language), ["id", "en", "other", "other"]);
  for (const language of ["und", "", "ID", "indonesian", "e", "abcd", "id-ID", "i d", 5, null]) assert.equal(one({ language }).language, null, String(language));
});

test("ISBNs: both kinds become ISBN-13 once each, other identifiers and bad checksums are ignored", () => {
  const ids = (list: unknown[]) => one({ industryIdentifiers: list }).isbns;
  assert.deepEqual(ids([{ type: "ISBN_10", identifier: "9793062797" }, { type: "ISBN_13", identifier: "9789793062792" }]), ["9789793062792"]);
  assert.deepEqual(ids([{ type: "ISBN_10", identifier: "0374246319" }]), ["9780374246310"]);
  assert.deepEqual(ids([{ type: "OTHER", identifier: "9789793062792" }, { type: "ISBN_13", identifier: "9789793062793" }, { type: "ISBN_13", identifier: 5 }, null, "x"]), []);
  assert.deepEqual(ids([{ type: "ISBN_13", identifier: "978-979-3062-79-2" }]), ["9789793062792"]);
  assert.deepEqual(one({ industryIdentifiers: "x" }).isbns, []);
  assert.deepEqual(one({}).isbns, []);
  const many = Array.from({ length: 10 }, (_, n) => ({ type: "ISBN_13", identifier: `978000000000${n}`.padEnd(13, "0") }));
  assert.ok(ids(many).length <= 5);
});

test("a cover link becomes an https link without zoom and curl, and only a registry host survives", () => {
  assert.equal(googleCover("http://books.google.com/books/content?id=abc&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api"), "https://books.google.com/books/content?id=abc&printsec=frontcover&img=1&source=gbs_api");
  assert.equal(googleCover("https://books.google.com/books/content?id=abc&zoom=5"), "https://books.google.com/books/content?id=abc");
  assert.equal(googleCover("https://books.google.com/books/publisher/content/images/frontcover/abc?fife=w200-h300"), "https://books.google.com/books/publisher/content/images/frontcover/abc?fife=w200-h300");
  assert.equal(googleCover("http://books.googleusercontent.com/x/abc=s128"), "https://books.googleusercontent.com/x/abc=s128");
  assert.equal(googleCover("https://books.google.com/books/content?id=abc#frag"), "https://books.google.com/books/content?id=abc");
  assert.equal(googleCover("https://books.google.com/books/content?id=abc&back=http://example.test/x"), "https://books.google.com/books/content?id=abc&back=http%3A%2F%2Fexample.test%2Fx");
  for (const bad of [
    "javascript:alert(1)",
    "data:image/png;base64,AAAA",
    "//books.google.com/books/content?id=abc",
    "https://books.google.com.evil.test/books/content?id=abc",
    "https://evil.test/books.google.com/books/content?id=abc",
    "https://books.google.com@evil.test/books/content?id=abc",
    "https://user:pw@books.google.com/books/content?id=abc",
    "https://books.google.com:8443/books/content?id=abc",
    "https://books.google.com/books?id=abc&img=1",
    "https://books.google.com/other/content?id=abc",
    "https://www.google.com/books/content?id=abc",
    "https://evilbooks.googleusercontent.com/x",
    "https://books.googleusercontent.com.evil.test/x",
    "https://books.google.com/books/content?id=" + "a".repeat(400),
    "ftp://books.google.com/books/content?id=abc",
    "",
    "not a url",
  ]) assert.equal(googleCover(bad), null, bad);
  for (const bad of [null, undefined, 5, {}, ["https://books.google.com/books/content?id=abc"]]) assert.equal(googleCover(bad), null);
});

test("the cover is the thumbnail, else the small one, and a hostile link means no cover", () => {
  const link = (name: string) => `https://books.google.com/books/content?id=${name}`;
  assert.equal(one({ imageLinks: { thumbnail: link("a"), smallThumbnail: link("b") } }).cover, link("a"));
  assert.equal(one({ imageLinks: { smallThumbnail: link("b") } }).cover, link("b"));
  assert.equal(one({ imageLinks: { thumbnail: "javascript:alert(1)", smallThumbnail: link("b") } }).cover, link("b"));
  assert.equal(one({ imageLinks: { thumbnail: "javascript:alert(1)" } }).cover, null);
  assert.equal(one({ imageLinks: "x" }).cover, null);
  assert.equal(one({}).cover, null);
  const cover = one({ imageLinks: { thumbnail: link("a") } }).cover;
  assert.ok(isCover(cover));
});

test("a description is never kept, whatever it holds", () => {
  for (const description of ["<p>First <b>para</b></p><p>Second</p>", "x".repeat(900), "", " ", 5, null]) assert.equal(one({ description }).blurb, null, String(description));
});

test("a hostile volume with 200 KB or 1 MB fields gives bounded plain data and no blurb", () => {
  const runs = ["<p", "&amp;", "<", "<a ", " ", "[", "\u0000", "\n"];
  for (const size of [200_000, 1_000_000]) {
    for (const run of runs) {
      const hostile = run.repeat(Math.ceil(size / run.length));
      const hit = one({ title: hostile, authors: [hostile], description: hostile, language: hostile, publishedDate: hostile });
      assert.ok(hit === undefined || (Array.from(hit.title).length <= 200 && hit.author.length <= 100), run);
      assert.deepEqual(hit === undefined ? [null, null, null] : [hit.blurb, hit.language, hit.year], [null, null, null], run);
    }
  }
});

test("the request is a plain query without the key, never an intitle or inauthor operator", () => {
  const url = new URL(googleUrl({ kind: "title", title: "laskar pelangi", author: "andrea hirata" }));
  assert.equal(`${url.origin}${url.pathname}`, "https://www.googleapis.com/books/v1/volumes");
  assert.deepEqual([...url.searchParams.keys()], ["q", "maxResults"]);
  assert.equal(url.searchParams.get("q"), "laskar pelangi andrea hirata");
  assert.equal(url.searchParams.get("maxResults"), "8");
  assert.doesNotMatch(url.href, /intitle|inauthor/);
  assert.equal(new URL(googleUrl({ kind: "title", title: "pangeran kecil", author: "" })).searchParams.get("q"), "pangeran kecil");
  assert.equal(new URL(googleUrl({ kind: "isbn", isbn: "9789793062792" })).searchParams.get("q"), "isbn:9789793062792");
  assert.equal(new URL(googleUrl({ kind: "title", title: "a&b=c #d", author: "" })).searchParams.get("q"), "a&b=c #d");
});

test("the guards run unchanged on Indonesian cases: a translation with the original in parentheses, a series number, a transliterated author, an empty author", () => {
  const [translated, , , plainPrince] = parseGoogle(sample("little-prince"));
  assert.equal(fillPatch({ title: "Pangeran Kecil", data: null }, translated, null)?.gb, translated.work);
  assert.equal(fillPatch({ title: "Le Petit Prince", data: null }, translated, null)?.gb, undefined);
  assert.equal(fillPatch({ title: "Pangeran Kecil", data: { original_title: "Le Petit Prince" } }, translated, null)?.gb, translated.work);
  assert.equal(fillPatch({ title: "Pangeran Kecil", data: null }, plainPrince, null)?.ol, undefined);
  assert.equal(sameAuthor("Gramedia Anak", plainPrince.author), true);
  assert.equal(sameAuthor("Antoine de Saint-Exupery", translated.author), true);
  const [, , , abbreviated] = parseGoogle(sample("bumi-manusia"));
  assert.equal(sameAuthor("Pramoedya Ananta Toer", abbreviated.author), false);
  assert.equal(fillPatch({ title: "Bumi Manusia", data: null }, abbreviated, null), null);
  assert.equal(fillPatch({ title: "Bumi Manusia: Tetralogi Buru 1", data: null }, parseGoogle(sample("bumi-manusia"))[0], null)?.gb, "Bm1AbCdEfGhI");
  const [numbered] = parseGoogle({ items: [{ id: "Sr1AbCdEfGhI", volumeInfo: { title: "Seri Contoh 2" } }] });
  assert.equal(fillPatch({ title: "Seri Contoh 2", data: null }, numbered, null)?.gb, numbered.work);
  assert.equal(fillPatch({ title: "Seri Contoh", data: null }, numbered, null), null);
  const [none] = parseGoogle(sample("laskar-pelangi")).slice(3);
  assert.equal(sameAuthor("Andrea Hirata", none.author), false);
});

test("filling from a volume writes its id under gb, never a blurb from Google, and never the ISBN or a language from another title", () => {
  const [first, , english] = parseGoogle(sample("laskar-pelangi"));
  assert.deepEqual(fillPatch({ title: "Laskar Pelangi", data: null }, first, null), {
    author: "Andrea Hirata",
    language: "id",
    cover: first.cover,
    gb: first.work,
  });
  assert.equal(fillPatch({ title: "Laskar Pelangi", data: { original_title: "The Rainbow Troops" } }, english, null)?.language, undefined);
  assert.equal(fillPatch({ title: "Laskar Pelangi", data: { author: "Mine" } }, first, null)?.blurb, undefined);
});

const isbn13 = (n: number) => {
  const body = `978${String(n).padStart(9, "0")}`;
  const sum = [...body].reduce((total, digit, at) => total + Number(digit) * (at % 2 === 0 ? 1 : 3), 0);
  return `${body}${(10 - (sum % 10)) % 10}`;
};

test("at most five ISBNs are kept, and the Google Books logo is the one Google hosts", () => {
  const ids = (count: number) => one({ industryIdentifiers: Array.from({ length: count }, (_, n) => ({ type: "ISBN_13", identifier: isbn13(n + 1) })) }).isbns;
  assert.equal(ids(5).length, 5);
  assert.deepEqual(ids(6), ids(5));
  assert.equal(POWERED_BY, "https://books.google.com/googlebooks/images/poweredby.png");
});
