import { test } from "node:test";
import assert from "node:assert/strict";
import type { ItemRow } from "../shared/tables.ts";
import { SCREEN_HITS_MAX, SCREEN_URL, adopt, heldPick, hitSub, parseScreenHits, screenCacheKey, screenLookupUrl, screenParams, screenQueryOf, tmdbData, tmdbPage, usesTmdb, validId, validYear } from "../src/domain/tmdb.ts";
import type { ScreenQuery } from "../src/domain/tmdb.ts";

const of = (query: string) => screenQueryOf(new URLSearchParams(query));

test("a title query is folded: NFC, control characters to spaces, whitespace collapsed, lower case", () => {
  assert.deepEqual(of("kind=movie&title=Pelabuhan++Terakhir"), { kind: "movie", by: "title", title: "pelabuhan terakhir", year: null });
  assert.deepEqual(of("kind=series&title=%20ÀMÉLIE%0A%09x%20"), { kind: "series", by: "title", title: "àmélie x", year: null });
  assert.deepEqual(of(`kind=movie&title=${encodeURIComponent("Amélie")}`), { kind: "movie", by: "title", title: "amélie", year: null });
  assert.deepEqual(of("kind=movie&title=a%00b%E2%80%8Bc"), { kind: "movie", by: "title", title: "a b c", year: null });
});

test("a year is four digits from 1880 to 2200 and rides along with the title only", () => {
  assert.deepEqual(of("kind=movie&title=Up&year=1880"), { kind: "movie", by: "title", title: "up", year: 1880 });
  assert.deepEqual(of("kind=series&title=Up&year=2200"), { kind: "series", by: "title", title: "up", year: 2200 });
  for (const year of ["1879", "2201", "999", "20170", "02017", "", "abc", "2017.0", "+2017", " 2017", "２０１７"]) assert.equal(of(`kind=movie&title=Up&year=${encodeURIComponent(year)}`), null, year);
});

test("a title is two to two hundred characters after folding, counted as characters", () => {
  assert.equal(of("kind=movie&title=a"), null);
  assert.equal(of("kind=movie&title=%20a%20"), null);
  assert.equal(of("kind=movie&title="), null);
  assert.notEqual(of("kind=movie&title=ab"), null);
  assert.notEqual(of(`kind=movie&title=${"x".repeat(200)}`), null);
  assert.equal(of(`kind=movie&title=${"x".repeat(201)}`), null);
  assert.notEqual(of(`kind=movie&title=${encodeURIComponent("😀".repeat(200))}`), null);
  assert.equal(of(`kind=movie&title=${encodeURIComponent("😀".repeat(201))}`), null);
});

test("an id is a positive integer of at most fifteen digits with no sign, space or leading zero, and never mixes with a title or a year", () => {
  assert.deepEqual(of("kind=movie&id=1"), { kind: "movie", by: "id", id: 1 });
  assert.deepEqual(of("kind=series&id=999999999999999"), { kind: "series", by: "id", id: 999999999999999 });
  for (const id of ["0", "-1", "+1", "01", "1.5", "1e3", "0x1", " 1", "1 ", "", "a", "1234567890123456", "٣"]) assert.equal(of(`kind=movie&id=${encodeURIComponent(id)}`), null, id);
  assert.equal(of("kind=movie&id=1&title=Up"), null);
  assert.equal(of("kind=movie&id=1&year=2017"), null);
});

test("the kind is movie or series exactly, and a query with another or a repeated parameter is refused", () => {
  for (const kind of ["", "Movie", "SERIES", "tv", "multi", "movie ", "movies", "person"]) assert.equal(of(`kind=${encodeURIComponent(kind)}&title=Up`), null, kind);
  assert.equal(of("title=Up"), null);
  assert.equal(of("kind=movie"), null);
  assert.equal(of("kind=movie&kind=series&title=Up"), null);
  assert.equal(of("kind=movie&title=Up&title=It"), null);
  assert.equal(of("kind=movie&title=Up&id=1&id=2"), null);
  for (const name of ["language", "api_key", "page", "include_adult", "query", "side"]) assert.equal(of(`kind=movie&title=Up&${name}=x`), null, name);
});

test("the route URL and the cache key are the same for every spelling of a query, and differ when the kind, year or id differs", () => {
  const spellings = ["kind=movie&title=Pelabuhan+Terakhir", "title=%20PELABUHAN%20%20terakhir&kind=movie", "kind=movie&title=pelabuhan%09terakhir"];
  const urls = spellings.map((query) => screenLookupUrl(of(query)!));
  assert.deepEqual([...new Set(urls)], [`${SCREEN_URL}?kind=movie&title=pelabuhan+terakhir`]);
  assert.deepEqual([...new Set(spellings.map((query) => screenCacheKey(of(query)!)))], ["https://lookup.invalid/screen/v1?kind=movie&title=pelabuhan+terakhir"]);
  assert.equal(SCREEN_URL, "/api/lookup/screen");
  const keys = ["kind=movie&title=up", "kind=series&title=up", "kind=movie&title=up&year=2009", "kind=movie&id=5", "kind=series&id=5", "kind=movie&id=6"].map((query) => screenCacheKey(of(query)!));
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(screenParams(of("kind=movie&title=Up&year=2009")!).toString(), "kind=movie&title=up&year=2009");
  assert.equal(screenParams(of("kind=series&id=5")!).toString(), "kind=series&id=5");
});

test("a title with &, #, %26 or a newline stays one parameter value in the route URL and the key, and parses back to itself", () => {
  for (const title of ["fast & furious", "a&id=5", "x#y", "a%26b", "a=b", "a+b", "100%"]) {
    const query = of(`kind=movie&title=${encodeURIComponent(title)}`)!;
    for (const built of [screenLookupUrl(query), screenCacheKey(query)]) {
      const url = new URL(built, "https://x.invalid");
      assert.deepEqual([...url.searchParams.keys()], ["kind", "title"], title);
      assert.equal(url.searchParams.get("title"), title);
      assert.equal(url.hash, "");
    }
    assert.deepEqual(screenQueryOf(new URL(screenLookupUrl(query), "https://x.invalid").searchParams), query);
  }
});

const good = { kind: "movie" as const, tmdb: 910001, title: "Pelabuhan Terakhir", original: null, year: 2017, cover: "https://image.tmdb.org/t/p/w342/abc.jpg" };

const parsed = (extra: object, kind: "movie" | "series" = "movie") => parseScreenHits({ hits: [{ ...good, ...extra }] }, kind);

test("a well-formed hit is kept as six fields, and anything else on it is dropped", () => {
  assert.deepEqual(parseScreenHits({ hits: [good] }, "movie"), [good]);
  assert.deepEqual(parsed({ overview: "INVENTED", genre_ids: [1], vote_average: 9 }), [good]);
  assert.deepEqual(Object.keys(parsed({ overview: "x" })[0]), ["kind", "tmdb", "title", "original", "year", "cover"]);
  assert.deepEqual(parsed({ kind: "series", original: "Original", year: null, cover: null }, "series"), [{ ...good, kind: "series", original: "Original", year: null, cover: null }]);
});

test("a hit is refused for each bad field: kind, id, title, original, year and cover", () => {
  const bad: object[] = [
    { kind: "tv" },
    { kind: undefined },
    { kind: 1 },
    { tmdb: 0 },
    { tmdb: -1 },
    { tmdb: 1.5 },
    { tmdb: "5" },
    { tmdb: 2 ** 60 },
    { tmdb: undefined },
    { title: "" },
    { title: "   " },
    { title: 5 },
    { title: null },
    { title: "x".repeat(201) },
    { original: "" },
    { original: "x".repeat(201) },
    { original: 5 },
    { original: undefined },
    { year: 1879 },
    { year: 2201 },
    { year: 2017.5 },
    { year: "2017" },
    { year: undefined },
    { cover: "javascript:alert(1)" },
    { cover: "https://evil.example/a.jpg" },
    { cover: "https://image.tmdb.org/t/p/original/a.jpg" },
    { cover: 5 },
    { cover: undefined },
  ];
  for (const change of bad) assert.deepEqual(parsed(change), [], JSON.stringify(change));
  assert.equal(parsed({ title: "x".repeat(200) }).length, 1);
  assert.equal(parsed({ original: "x".repeat(200) }).length, 1);
  assert.equal(parsed({ year: 1880 }).length, 1);
  assert.equal(parsed({ year: 2200 }).length, 1);
  assert.equal(parsed({ tmdb: Number.MAX_SAFE_INTEGER }).length, 1);
});

test("titles are trimmed, and a body of any other shape is no hit", () => {
  assert.equal(parsed({ title: "  Padded  " })[0].title, "Padded");
  for (const body of [null, undefined, 5, "x", [], {}, { hits: null }, { hits: "x" }, { hits: {} }, { hits: [null, "x", 5, []] }]) assert.deepEqual(parseScreenHits(body, "movie"), [], JSON.stringify(body));
});

test("at most eight hits are kept, the first eight, and a bad one in front does not count", () => {
  const many = Array.from({ length: 12 }, (_, n) => ({ ...good, tmdb: 100 + n }));
  assert.equal(SCREEN_HITS_MAX, 8);
  assert.deepEqual(parseScreenHits({ hits: many }, "movie").map((hit) => hit.tmdb), [100, 101, 102, 103, 104, 105, 106, 107]);
  assert.deepEqual(parseScreenHits({ hits: [{ ...good, tmdb: 0 }, ...many] }, "movie").map((hit) => hit.tmdb), [100, 101, 102, 103, 104, 105, 106, 107]);
});

test("validId and validYear take only the numbers they should", () => {
  assert.equal(validId(1), 1);
  assert.equal(validId(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  for (const value of [0, -1, 1.5, NaN, Infinity, "1", null, undefined, 2 ** 53]) assert.equal(validId(value), null, String(value));
  assert.equal(validYear(1880), 1880);
  assert.equal(validYear(2200), 2200);
  for (const value of [1879, 2201, 2017.5, NaN, "2017", null, undefined]) assert.equal(validYear(value), null, String(value));
});

test("the query type keeps the two forms apart", () => {
  const title: ScreenQuery = { kind: "movie", by: "title", title: "up", year: null };
  const id: ScreenQuery = { kind: "series", by: "id", id: 3 };
  assert.equal(screenLookupUrl(title), "/api/lookup/screen?kind=movie&title=up");
  assert.equal(screenLookupUrl(id), "/api/lookup/screen?kind=series&id=3");
});

test("a hit of another kind than the one asked for is dropped, and a repeated id keeps the first", () => {
  const mixed = { hits: [{ ...good, tmdb: 1 }, { ...good, tmdb: 2, kind: "series" }, { ...good, tmdb: 1, title: "Again" }, { ...good, tmdb: 3 }] };
  assert.deepEqual(parseScreenHits(mixed, "movie").map((hit) => [hit.tmdb, hit.title]), [[1, good.title], [3, good.title]]);
  assert.deepEqual(parseScreenHits(mixed, "series").map((hit) => hit.tmdb), [2]);
});

test("eight distinct hits are kept however many repeats and bad rows come first", () => {
  const rows = [...Array.from({ length: 50 }, () => ({ ...good, tmdb: 1 })), ...Array.from({ length: 12 }, (_, n) => ({ ...good, tmdb: 10 + n }))];
  assert.deepEqual(parseScreenHits({ hits: rows }, "movie").map((hit) => hit.tmdb), [1, 10, 11, 12, 13, 14, 15, 16]);
});

test("a hit fills the title and the year only when the year is empty, and keeps what the hit knows for the row", () => {
  const hit = { ...good, kind: "movie" as const, original: "Original", year: 2017 };
  assert.deepEqual(adopt({ year: "" }, hit), { title: good.title, year: "2017", picked: { title: good.title, tmdb: 910001, original: "Original", cover: good.cover } });
  assert.equal(adopt({ year: "   " }, hit).year, "2017");
  assert.equal(adopt({ year: "1999" }, hit).year, "1999");
  assert.equal(adopt({ year: "abc" }, hit).year, "abc");
  assert.equal(adopt({ year: "" }, { ...hit, year: null }).year, "");
});

test("a pick holds for its own title only, folded, and lets go as soon as the title is changed", () => {
  const picked = { title: "Amélie", tmdb: 5, original: null, cover: null };
  assert.equal(heldPick(picked, "Amélie"), picked);
  assert.equal(heldPick(picked, "  AMELIE "), picked);
  assert.equal(heldPick(picked, "Amélie 2"), null);
  assert.equal(heldPick(picked, ""), null);
  assert.equal(heldPick(null, "Amélie"), null);
});

test("the data a pick writes is the original title, the poster, the id and the day, and nothing else; no pick writes nothing", () => {
  assert.deepEqual(tmdbData(null, "2026-10-26"), {});
  assert.deepEqual(tmdbData({ title: "T", tmdb: 5, original: "O", cover: good.cover }, "2026-10-26"), { original_title: "O", cover: good.cover, tmdb: 5, tmdb_at: "2026-10-26" });
  assert.deepEqual(tmdbData({ title: "T", tmdb: 5, original: null, cover: null }, "2026-10-26"), { tmdb: 5, tmdb_at: "2026-10-26" });
});

test("a hit shows its original title and year on one line, and no line when it has neither", () => {
  assert.equal(hitSub({ ...good, original: "灯台守の夏", year: 2001 }), "灯台守の夏 · 2001");
  assert.equal(hitSub({ ...good, original: null, year: 2001 }), "2001");
  assert.equal(hitSub({ ...good, original: "O", year: null }), "O");
  assert.equal(hitSub({ ...good, original: null, year: null }), "");
});

test("the TMDB page of a row is the movie or tv path of its id on the public site", () => {
  assert.equal(tmdbPage("movie", 910001), "https://www.themoviedb.org/movie/910001");
  assert.equal(tmdbPage("series", 920001), "https://www.themoviedb.org/tv/920001");
});

test("a list shows TMDB when a row of its kind has a poster or an id, and not for the other kind or a typed row", () => {
  const row = (kind: string, data: Record<string, unknown> | null) => ({ id: "x", kind, title: "T", data }) as unknown as ItemRow;
  assert.equal(usesTmdb([row("movie", { cover: good.cover })], "movie"), true);
  assert.equal(usesTmdb([row("movie", { tmdb: 5 })], "movie"), true);
  assert.equal(usesTmdb([row("movie", { cover: good.cover })], "series"), false);
  assert.equal(usesTmdb([row("movie", { year: 2001, original_title: "O" }), row("movie", null)], "movie"), false);
  assert.equal(usesTmdb([row("movie", { cover: "https://evil.example/a.jpg", tmdb: 0 })], "movie"), false);
  assert.equal(usesTmdb([], "movie"), false);
});
