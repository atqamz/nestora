import { test } from "node:test";
import assert from "node:assert/strict";
import { isCover, validateCreate } from "../shared/validate.ts";

const FILE = "abcDEF123_-xyz";

const OK = [`https://image.tmdb.org/t/p/w342/${FILE}.jpg`, "https://image.tmdb.org/t/p/w342/a.jpg", `https://image.tmdb.org/t/p/w342/${"a".repeat(64)}.jpg`, "https://image.tmdb.org/t/p/w342/_-_.jpg"];

const BAD = [
  `http://image.tmdb.org/t/p/w342/${FILE}.jpg`,
  `https://image.tmdb.org.evil.example/t/p/w342/${FILE}.jpg`,
  `https://image.tmdb.org@evil.example/t/p/w342/${FILE}.jpg`,
  `https://evil.example/https://image.tmdb.org/t/p/w342/${FILE}.jpg`,
  `https://user@image.tmdb.org/t/p/w342/${FILE}.jpg`,
  `https://xx.image.tmdb.org/t/p/w342/${FILE}.jpg`,
  `https://ximage.tmdb.org/t/p/w342/${FILE}.jpg`,
  `https://image.tmdb.org:443/t/p/w342/${FILE}.jpg`,
  `https://IMAGE.tmdb.org/t/p/w342/${FILE}.jpg`,
  `https://image.tmdb.org/t/p/w342/${FILE}.jpg?x=1`,
  `https://image.tmdb.org/t/p/w342/${FILE}.jpg#x`,
  `https://image.tmdb.org/t/p/w342/${FILE}.jpg\n`,
  `https://image.tmdb.org/t/p/w342/${FILE}.jpg `,
  ` https://image.tmdb.org/t/p/w342/${FILE}.jpg`,
  `https://image.tmdb.org/t/p/w500/${FILE}.jpg`,
  `https://image.tmdb.org/t/p/w185/${FILE}.jpg`,
  `https://image.tmdb.org/t/p/original/${FILE}.jpg`,
  `https://image.tmdb.org/t/p/w3420/${FILE}.jpg`,
  `https://image.tmdb.org/t/p/w34/${FILE}.jpg`,
  `https://image.tmdb.org/t/p/W342/${FILE}.jpg`,
  `https://image.tmdb.org/t/w342/${FILE}.jpg`,
  `https://image.tmdb.org/x/t/p/w342/${FILE}.jpg`,
  `https://image.tmdb.org/t/p/w342/${FILE}.png`,
  `https://image.tmdb.org/t/p/w342/${FILE}.jpeg`,
  `https://image.tmdb.org/t/p/w342/${FILE}.JPG`,
  `https://image.tmdb.org/t/p/w342/${FILE}.jpg.exe`,
  `https://image.tmdb.org/t/p/w342/${FILE}`,
  "https://image.tmdb.org/t/p/w342/.jpg",
  "https://image.tmdb.org/t/p/w342/",
  "https://image.tmdb.org/t/p/w342",
  `https://image.tmdb.org/t/p/w342/${"a".repeat(65)}.jpg`,
  "https://image.tmdb.org/t/p/w342/a/b.jpg",
  "https://image.tmdb.org/t/p/w342//a.jpg",
  "https://image.tmdb.org/t/p/w342/../a.jpg",
  "https://image.tmdb.org/t/p/w342/%2e%2e.jpg",
  "https://image.tmdb.org/t/p/w342/a b.jpg",
  "https://image.tmdb.org/t/p/w342/é.jpg",
  "https://image.tmdb.org/t/p/w342/a\\b.jpg",
  "https://image.tmdb.org/",
  "https://image.tmdb.org",
  "https://themoviedb.org/t/p/w342/a.jpg",
  "https://www.themoviedb.org/t/p/w342/a.jpg",
  "https://tmdb.org/t/p/w342/a.jpg",
  "data:image/jpeg;base64,AAAA",
  "javascript:alert(1)",
];

test("the cover allow-list takes the TMDB poster URL in exactly one shape: https, the image host, the t/p/w342 path and a plain .jpg name", () => {
  for (const url of OK) assert.equal(isCover(url), true, url);
  for (const url of BAD) assert.equal(isCover(url), false, url);
  for (const value of [null, undefined, 5, {}, [], [OK[0]]]) assert.equal(isCover(value), false);
});

test("the older hosts are still accepted next to it", () => {
  for (const url of ["https://covers.openlibrary.org/b/id/7079796-M.jpg", "https://books.google.com/books/content?id=abc", "https://books.googleusercontent.com/books/content?id=abc"]) assert.equal(isCover(url), true, url);
});

test("a stored cover is checked with the same rule, and the refusal names the TMDB host", () => {
  const row = (cover: string) => ({ id: "00000000-0000-4000-8000-000000000001", kind: "book", title: "Placeholder", status: "wish", created_at: "2026-10-06T05:00:00Z", updated_at: "2026-10-06T05:00:00Z", data: { cover } });
  assert.deepEqual(validateCreate("items", row(OK[0])), []);
  for (const bad of ["https://image.tmdb.org.evil.example/t/p/w342/a.jpg", "https://image.tmdb.org/t/p/w500/a.jpg", "http://image.tmdb.org/t/p/w342/a.jpg", "https://image.tmdb.org/t/p/w342/a.jpg?x=1", "https://image.tmdb.org/t/p/w342/a.png"]) {
    assert.match(validateCreate("items", row(bad)).join("\n"), /data\.cover: must be an https URL on covers\.openlibrary\.org, books\.google\.com, books\.googleusercontent\.com or image\.tmdb\.org/, bad);
  }
});

test("a movie and a series hold the poster in data.cover, and refuse a cover that is not on a known host, with the same message", () => {
  const row = (kind: string, cover: string) => ({ id: "00000000-0000-4000-8000-000000000001", kind, title: "Placeholder", status: "want", created_at: "2026-10-06T05:00:00Z", updated_at: "2026-10-06T05:00:00Z", data: { cover } });
  for (const kind of ["movie", "series"]) {
    assert.deepEqual(validateCreate("items", row(kind, OK[0])), [], kind);
    for (const bad of ["https://image.tmdb.org.evil.example/t/p/w342/a.jpg", "https://evil.example/a.jpg", "https://image.tmdb.org/t/p/w500/a.jpg", "https://image.tmdb.org/t/p/w342/a.png", "http://image.tmdb.org/t/p/w342/a.jpg"]) {
      assert.match(validateCreate("items", row(kind, bad)).join("\n"), /data\.cover: must be an https URL on covers\.openlibrary\.org, books\.google\.com, books\.googleusercontent\.com or image\.tmdb\.org/, `${kind} ${bad}`);
    }
  }
});
