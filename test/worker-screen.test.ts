import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createAuthenticator } from "../worker/auth.ts";
import { createWorker } from "../worker/index.ts";
import type { Bindings } from "../worker/index.ts";
import type { Store } from "../worker/lookup.ts";
import { CALL_MS, MAX_BYTES, RESULTS_READ, SCREEN_CACHE_SECONDS } from "../worker/screen.ts";
import { AGENT, RETRY_SECONDS } from "../worker/lookup.ts";
import { parseScreenHits } from "../src/domain/tmdb.ts";
import type { ScreenHit } from "../src/domain/tmdb.ts";
import { isCover } from "../shared/validate.ts";

const TOKEN = "test-token-not-a-real-secret-0000";

const root = new URL("../", import.meta.url);

const sample = (name: string): Record<string, unknown> => JSON.parse(readFileSync(new URL(`./fixtures/tmdb/${name}.json`, import.meta.url), "utf8"));

const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });

type Call = { url: string; init: RequestInit | undefined };

type Upstream = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;

const upstream = (answer: Upstream) => {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url: url.href, init });
    if (url.hostname !== "api.themoviedb.org") throw new Error(`unexpected host ${url.hostname}`);
    return answer(url, init);
  }) as typeof fetch;
  return { calls, fetcher };
};

const fakeCache = () => {
  const entries = new Map<string, { body: string; control: string | null }>();
  const puts: string[] = [];
  let matches = 0;
  const store = {
    async match(request: RequestInfo | URL) {
      matches++;
      const entry = entries.get(String(request instanceof Request ? request.url : request));
      return entry === undefined ? undefined : new Response(entry.body, { headers: { "content-type": "application/json" } });
    },
    async put(request: RequestInfo | URL, response: Response) {
      const url = String(request instanceof Request ? request.url : request);
      puts.push(url);
      entries.set(url, { body: await response.text(), control: response.headers.get("cache-control") });
    },
  } as unknown as Store;
  return { store, entries, puts, matches: () => matches };
};

const env = (extra: Partial<Bindings> = {}): Bindings => ({ DB: {} as Bindings["DB"], DESIGN: { get: async () => null }, AUTH_MODE: "dev", DEV_WHO: "a", TMDB_TOKEN: TOKEN, ...extra });

const setup = (answer: Upstream, extra: Partial<Bindings> = {}) => {
  const net = upstream(answer);
  const cache = fakeCache();
  const worker = createWorker(createAuthenticator(), net.fetcher, () => cache.store);
  const get = (query: string, init?: RequestInit, bindings = env(extra)) => worker.fetch(new Request(`https://wp.example.test/api/lookup/screen?${query}`, init), bindings);
  const languages = () => net.calls.map((call) => new URL(call.url).searchParams.get("language"));
  return { ...net, cache, get, languages };
};

const searchOf = (movie: unknown, tv: unknown = movie): Upstream => (url) => reply(url.pathname.startsWith("/3/search/tv") ? tv : movie);

const movies = () => reply(sample("movie-search"));

const MOVIE = "kind=movie&title=Pelabuhan+Terakhir";

const hitsOf = async (res: Response) => ((await res.json()) as { hits: ScreenHit[] }).hits;

const none = { page: 1, results: [], total_pages: 0, total_results: 0 };

test("a movie title lookup asks the movie search with a plain query, the id-ID language, no adult results and one page, and returns the hits in order", async () => {
  const t = setup(movies);
  const res = await t.get(MOVIE);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.deepEqual((await hitsOf(res)).map((hit) => hit.tmdb), [910001, 910002, 910003, 910005]);
  assert.deepEqual(t.calls.map((call) => call.url), ["https://api.themoviedb.org/3/search/movie?query=pelabuhan+terakhir&language=id-ID&include_adult=false&page=1"]);
});

test("a series lookup asks the tv search, and a typed year goes in the year parameter of its own kind and only then", async () => {
  const t = setup(searchOf(sample("movie-search"), sample("tv-search")));
  await t.get("kind=series&title=Rumah+di+Ujung+Jalan");
  await t.get("kind=series&title=Rumah+di+Ujung+Jalan&year=2023");
  await t.get("kind=movie&title=Pelabuhan+Terakhir&year=2017");
  assert.deepEqual(t.calls.map((call) => call.url), [
    "https://api.themoviedb.org/3/search/tv?query=rumah+di+ujung+jalan&language=id-ID&include_adult=false&page=1",
    "https://api.themoviedb.org/3/search/tv?query=rumah+di+ujung+jalan&language=id-ID&include_adult=false&page=1&first_air_date_year=2023",
    "https://api.themoviedb.org/3/search/movie?query=pelabuhan+terakhir&language=id-ID&include_adult=false&page=1&primary_release_year=2017",
  ]);
});

test("the id form asks the details of its own kind with the language, and the route answers with that one hit", async () => {
  const t = setup((url) => reply(sample(url.pathname.startsWith("/3/tv/") ? "tv-details" : "movie-details")));
  const movie = await hitsOf(await t.get("kind=movie&id=910001"));
  const series = await hitsOf(await t.get("kind=series&id=920001"));
  assert.deepEqual(t.calls.map((call) => call.url), ["https://api.themoviedb.org/3/movie/910001?language=id-ID", "https://api.themoviedb.org/3/tv/920001?language=id-ID"]);
  assert.deepEqual(movie, [{ kind: "movie", tmdb: 910001, title: "Pelabuhan Terakhir", original: null, year: 2017, cover: "https://image.tmdb.org/t/p/w342/invPoster0001AbCdEfGhIjKlMn.jpg" }]);
  assert.deepEqual(series, [{ kind: "series", tmdb: 920001, title: "Rumah di Ujung Jalan", original: null, year: 2023, cover: "https://image.tmdb.org/t/p/w342/invPoster0101AbCdEfGhIjKlMn.jpg" }]);
});

test("every upstream request is https to api.themoviedb.org under /3 with a fixed path, whatever the title, kind or id", async () => {
  const t = setup(() => reply(none));
  const titles = ["../../movie/550", "a&include_adult=true", "a#fragment", "100%25", "a%26b", "x\ny", "https://evil.example/", "a b\u0000c", "千と千尋の神隠し", "‮gnp.exe", "?api_key=1", "a/../b", "ünï"];
  for (const kind of ["movie", "series"]) {
    for (const title of titles) await t.get(new URLSearchParams({ kind, title }).toString());
    await t.get(`kind=${kind}&id=1`);
  }
  assert.ok(t.calls.length >= 26);
  const paths = new Set(["/3/search/movie", "/3/search/tv", "/3/movie/1", "/3/tv/1"]);
  for (const { url } of t.calls) {
    const parsed = new URL(url);
    assert.equal(parsed.protocol, "https:", url);
    assert.equal(parsed.host, "api.themoviedb.org", url);
    assert.ok(paths.has(parsed.pathname), url);
    assert.equal(parsed.hash, "", url);
    assert.equal(parsed.username + parsed.password, "", url);
    assert.ok(!parsed.searchParams.has("api_key"), url);
    const keys = [...parsed.searchParams.keys()];
    assert.deepEqual(keys, parsed.pathname.startsWith("/3/search") ? ["query", "language", "include_adult", "page"] : ["language"], url);
    if (keys.length > 1) assert.equal(parsed.searchParams.get("include_adult"), "false", url);
  }
});

test("a title carries `&`, `#`, `%26`, newlines and unicode into the query value and nowhere else", async () => {
  const t = setup(() => reply(none));
  const cases: [string, string][] = [
    ["Fast & Furious", "fast & furious"],
    ["a&include_adult=true&page=9", "a&include_adult=true&page=9"],
    ["x#y", "x#y"],
    ["a%26b", "a%26b"],
    ["line one\nline two\r\nthree", "line one line two three"],
    ["千と千尋の神隠し", "千と千尋の神隠し"],
    ["ÀMÉLIE", "àmélie"],
    ["a\u0000b​c", "a b c"],
  ];
  for (const [typed, folded] of cases) {
    const before = t.calls.length;
    const res = await t.get(`kind=movie&title=${encodeURIComponent(typed)}`);
    assert.equal(res.status, 200, typed);
    const url = new URL(t.calls[before].url);
    assert.equal(url.searchParams.get("query"), folded, typed);
    assert.equal(url.searchParams.get("include_adult"), "false", typed);
    assert.equal(url.searchParams.get("page"), "1", typed);
    assert.equal(url.searchParams.get("language"), "id-ID", typed);
  }
});

test("the request carries the token in the Authorization header only, an identifying agent, no credentials and no redirect following", async () => {
  const t = setup(movies);
  await t.get(MOVIE);
  const [{ init, url }] = t.calls;
  assert.deepEqual(init?.headers, { accept: "application/json", "user-agent": "Nestora/1.0 (+https://nestora.atqamz.com)", authorization: `Bearer ${TOKEN}` });
  assert.equal(AGENT, "Nestora/1.0 (+https://nestora.atqamz.com)");
  assert.equal(init?.redirect, "manual");
  assert.equal(init?.credentials, undefined);
  assert.equal(init?.method, undefined);
  assert.equal(init?.body, undefined);
  assert.ok(init?.signal instanceof AbortSignal);
  assert.ok(!url.includes(TOKEN) && !/api_key|token|key=/i.test(url));
});

test("a token with spaces around it is trimmed before it is sent", async () => {
  const t = setup(movies, { TMDB_TOKEN: `  ${TOKEN}\n` });
  await t.get(MOVIE);
  assert.equal((t.calls[0].init?.headers as Record<string, string>).authorization, `Bearer ${TOKEN}`);
});

test("the hits carry six fields: a localised title, the original only when it differs, the year and the fixed w342 poster", async () => {
  const hits = await hitsOf(await setup(movies).get(MOVIE));
  assert.deepEqual(hits, [
    { kind: "movie", tmdb: 910001, title: "Pelabuhan Terakhir", original: null, year: 2017, cover: "https://image.tmdb.org/t/p/w342/invPoster0001AbCdEfGhIjKlMn.jpg" },
    { kind: "movie", tmdb: 910002, title: "The Summer of the Lighthouse Keeper", original: "灯台守の夏", year: 2001, cover: "https://image.tmdb.org/t/p/w342/invPoster0002-AbCdEfGhIjKlMn.jpg" },
    { kind: "movie", tmdb: 910003, title: "Kapal Kertas", original: null, year: null, cover: null },
    { kind: "movie", tmdb: 910005, title: "Poster Aneh", original: null, year: 1999, cover: null },
  ]);
  for (const hit of hits) assert.deepEqual(Object.keys(hit), ["kind", "tmdb", "title", "original", "year", "cover"]);
  for (const hit of hits) assert.ok(hit.cover === null || isCover(hit.cover));
  assert.deepEqual(parseScreenHits({ hits }, "movie"), hits);
});

test("a series hit reads name, original_name and first_air_date, and ignores the movie fields", async () => {
  const t = setup(searchOf(sample("movie-search"), sample("tv-search")));
  assert.deepEqual(await hitsOf(await t.get("kind=series&title=Rumah")), [
    { kind: "series", tmdb: 920001, title: "Rumah di Ujung Jalan", original: null, year: 2023, cover: "https://image.tmdb.org/t/p/w342/invPoster0101AbCdEfGhIjKlMn.jpg" },
    { kind: "series", tmdb: 920002, title: "Moonlight Garden", original: "달빛 정원", year: 2021, cover: "https://image.tmdb.org/t/p/w342/invPoster0102_AbCdEfGhIjKlMn.jpg" },
  ]);
  const wrong = setup(searchOf(sample("movie-search")));
  assert.deepEqual(await hitsOf(await wrong.get("kind=series&title=Pelabuhan")), []);
  const asMovie = setup(searchOf(sample("tv-search")));
  assert.deepEqual(await hitsOf(await asMovie.get("kind=movie&title=Rumah")), []);
});

test("overview, genres, ratings, popularity and every other TMDB field are dropped before anything is sent or cached", async () => {
  for (const [query, name] of [[MOVIE, "movie-search"], ["kind=series&title=Rumah", "tv-search"], ["kind=movie&id=910001", "movie-details"], ["kind=series&id=920001", "tv-details"]]) {
    const t = setup(() => reply(sample(name)));
    const res = await t.get(query);
    const seen = [await res.text(), ...[...t.cache.entries.values()].map((entry) => entry.body)].join("\n");
    assert.doesNotMatch(seen, /INVENTED|overview|genre|vote_|popularity|backdrop|adult|tagline|runtime|homepage|imdb|seasons/i, name);
    assert.equal(t.cache.puts.length, 1, name);
  }
});

test("the answer holds at most eight hits, in TMDB's order, and a repeated id is kept once", async () => {
  const results = Array.from({ length: 12 }, (_, n) => ({ id: 1000 + n, title: `Film ${n}` }));
  const hits = await hitsOf(await setup(() => reply({ results })).get(MOVIE));
  assert.deepEqual(hits.map((hit) => hit.tmdb), [1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007]);
  const twice = await hitsOf(await setup(() => reply({ results: [{ id: 5, title: "One" }, { id: 5, title: "Again" }, { id: 6, title: "Two" }] })).get(MOVIE));
  assert.deepEqual(twice.map((hit) => [hit.tmdb, hit.title]), [[5, "One"], [6, "Two"]]);
  const dropped = Array.from({ length: 10 }, (_, n) => ({ id: 2000 + n, title: n < 4 ? "" : `Kept ${n}`, adult: n === 5 }));
  assert.deepEqual((await hitsOf(await setup(() => reply({ results: dropped })).get(MOVIE))).map((hit) => hit.tmdb), [2004, 2006, 2007, 2008, 2009]);
});

test("Indonesian first: id-ID answers with hits and en-US is never asked", async () => {
  const t = setup(movies);
  await t.get(MOVIE);
  assert.deepEqual(t.languages(), ["id-ID"]);
});

test("en-US is asked only after an empty id-ID answer, with the same query, and its hits are the answer", async () => {
  const t = setup((url) => reply(url.searchParams.get("language") === "en-US" ? sample("movie-search") : none));
  const res = await t.get("kind=movie&title=Summer+Keeper&year=2001");
  assert.deepEqual(t.languages(), ["id-ID", "en-US"]);
  const [first, second] = t.calls.map((call) => new URL(call.url));
  assert.equal(first.pathname, second.pathname);
  assert.equal(first.searchParams.get("query"), second.searchParams.get("query"));
  assert.equal(first.searchParams.get("primary_release_year"), "2001");
  assert.equal(second.searchParams.get("primary_release_year"), "2001");
  assert.equal((await hitsOf(res)).length, 4);
  assert.equal(t.cache.puts.length, 1);
});

test("empty in both languages is a definite empty answer, cached, so a missing title does not ask twice", async () => {
  const t = setup(() => reply(none));
  assert.deepEqual(await hitsOf(await t.get(MOVIE)), []);
  assert.deepEqual(t.languages(), ["id-ID", "en-US"]);
  assert.deepEqual(await hitsOf(await t.get(MOVIE)), []);
  assert.equal(t.calls.length, 2);
  assert.equal(t.cache.puts.length, 1);
  const unusable = setup(() => reply({ results: [{ id: 1, title: "", original_title: "" }, { id: 2, adult: true, title: "X" }] }));
  assert.deepEqual(await hitsOf(await unusable.get(MOVIE)), []);
  assert.deepEqual(unusable.languages(), ["id-ID", "en-US"]);
});

test("an error in the first language ends the lookup there: it is never taken for an empty answer and en-US is not asked", async () => {
  for (const status of [429, 500, 401, 403, 422, 400, 404, 302]) {
    const t = setup(() => reply({}, status));
    const res = await t.get(MOVIE);
    assert.ok(res.status >= 429, String(status));
    assert.equal(t.calls.length, 1, String(status));
    assert.equal(t.cache.puts.length, 0, String(status));
  }
});

test("an error in the second language after an empty first one is the error, not an empty list, and nothing is cached", async () => {
  for (const [status, expected] of [[429, 429], [503, 503], [500, 503], [401, 502], [404, 502]] as const) {
    const t = setup((url) => (url.searchParams.get("language") === "id-ID" ? reply(none) : reply({}, status, { "retry-after": "9" })));
    const res = await t.get(MOVIE);
    assert.equal(res.status, expected, String(status));
    assert.equal(t.cache.puts.length, 0, String(status));
    await t.get(MOVIE);
    assert.equal(t.calls.length, 4, String(status));
  }
  const bad = setup((url) => (url.searchParams.get("language") === "id-ID" ? reply(none) : reply("{not json")));
  assert.equal((await bad.get(MOVIE)).status, 502);
  assert.equal(bad.cache.puts.length, 0);
});

test("the id form asks once, a 404 is an empty answer that is not cached, and no second language is tried", async () => {
  const t = setup(() => reply({ success: false, status_code: 34, status_message: "The resource you requested could not be found." }, 404));
  const res = await t.get("kind=movie&id=910001");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { hits: [] });
  assert.equal(t.calls.length, 1);
  assert.equal(t.cache.puts.length, 0);
  await t.get("kind=movie&id=910001");
  assert.equal(t.calls.length, 2);
});

test("the id form answers nothing for an adult entry, and fails on an answer that is not the id asked for or has no title", async () => {
  assert.deepEqual(await hitsOf(await setup(() => reply({ id: 910001, adult: true, title: "X" })).get("kind=movie&id=910001")), []);
  for (const body of [{ id: 910002, title: "Another" }, { id: 910001, title: "" }, { id: "910001", title: "T" }, {}, [], null, "x"]) {
    const t = setup(() => reply(body as never));
    const res = await t.get("kind=movie&id=910001");
    assert.equal(res.status, 502, JSON.stringify(body));
    assert.equal(t.cache.puts.length, 0);
  }
  const t = setup(() => reply({ id: 910001, title: "T", poster_path: "/x.jpg" }, 404));
  assert.deepEqual(await hitsOf(await t.get("kind=series&id=910001")), []);
});

test("every cached answer, a list or a definite empty one, is kept for at most a day under a key without the token", async () => {
  assert.equal(SCREEN_CACHE_SECONDS, 86_400);
  for (const answer of [movies, () => reply(none)]) {
    const t = setup(answer);
    await t.get(`${MOVIE}&year=2017`);
    assert.equal(t.cache.puts.length, 1);
    const [url] = t.cache.puts;
    assert.equal(t.cache.entries.get(url)?.control, "public, max-age=86400");
    assert.equal(url, "https://lookup.invalid/screen/v1?kind=movie&title=pelabuhan+terakhir&year=2017");
    assert.ok(![url, ...[...t.cache.entries.values()].map((entry) => entry.body)].some((text) => text.includes(TOKEN)));
    const stored = JSON.parse(t.cache.entries.get(url)!.body) as { hits: unknown[]; at: unknown };
    assert.equal(typeof stored.at, "number");
    assert.deepEqual(Object.keys(stored).sort(), ["at", "hits"]);
  }
  const byId = setup((url) => reply(sample(url.pathname.startsWith("/3/tv/") ? "tv-details" : "movie-details")));
  await byId.get("kind=series&id=920001");
  assert.equal(byId.cache.puts[0], "https://lookup.invalid/screen/v1?kind=series&id=920001");
  assert.equal(byId.cache.entries.get(byId.cache.puts[0])?.control, "public, max-age=86400");
});

test("the books cache keys and the screen keys cannot collide", async () => {
  const t = setup(movies);
  await t.get(MOVIE);
  assert.ok(t.cache.puts[0].startsWith("https://lookup.invalid/screen/v1?"));
  assert.ok(!t.cache.puts[0].startsWith("https://lookup.invalid/v1?"));
});

test("a stored answer a day old is not served, whatever the cache says, and is asked for again", async () => {
  mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  try {
    const t = setup(movies);
    await t.get(MOVIE);
    mock.timers.tick(86_399_999);
    await t.get(MOVIE);
    assert.equal(t.calls.length, 1);
    mock.timers.tick(1);
    await t.get(MOVIE);
    assert.equal(t.calls.length, 2);
    assert.equal(t.cache.puts.length, 2);
    mock.timers.tick(86_399_000);
    await t.get(MOVIE);
    assert.equal(t.calls.length, 2);
  } finally {
    mock.timers.reset();
  }
});

test("an entry stamped in the future, without a stamp or with a bad one is not served, and a fresh one is", async () => {
  mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  try {
    const key = "https://lookup.invalid/screen/v1?kind=movie&title=pelabuhan+terakhir";
    const hits = [{ kind: "movie", tmdb: 77, title: "Stored", original: null, year: null, cover: null }];
    for (const stored of [{ hits, at: 1_800_000_000_001 }, { hits }, { hits, at: "now" }, { hits, at: "1800000000000" }, { hits, at: null }, { hits, at: Number.NaN }, { hits, at: 1_700_000_000_000 }, { hits: "x", at: 1_800_000_000_000 }, { hits: null, at: 1_800_000_000_000 }]) {
      const t = setup(movies);
      await t.cache.store.put(new Request(key), Response.json(stored));
      assert.equal((await hitsOf(await t.get(MOVIE)))[0].title, "Pelabuhan Terakhir", JSON.stringify(stored));
      assert.equal(t.calls.length, 1);
    }
    const fresh = setup(movies);
    await fresh.cache.store.put(new Request(key), Response.json({ hits, at: 1_800_000_000_000 }));
    const res = await fresh.get(MOVIE);
    assert.equal((await hitsOf(res))[0].title, "Stored");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(fresh.calls.length, 0);
  } finally {
    mock.timers.reset();
  }
});

test("a stored entry is parsed again before it is served: it cannot carry extra fields, a foreign poster or more than eight hits", async () => {
  const key = "https://lookup.invalid/screen/v1?kind=movie&title=pelabuhan+terakhir";
  const good = { kind: "movie", tmdb: 5, title: "Good", original: null, year: 2001, cover: null };
  const stored = [
    { ...good, overview: "INVENTED-OVERVIEW-MARKER" },
    { ...good, tmdb: 6, cover: "javascript:alert(1)" },
    { ...good, tmdb: 7, cover: "https://image.tmdb.org/t/p/original/x.jpg" },
    { ...good, tmdb: 8, title: "" },
    ...Array.from({ length: 12 }, (_, n) => ({ ...good, tmdb: 100 + n })),
  ];
  const t = setup(movies);
  await t.cache.store.put(new Request(key), Response.json({ hits: stored, at: Date.now() }));
  const res = await t.get(MOVIE);
  const text = await res.text();
  assert.doesNotMatch(text, /INVENTED|javascript|original\/x/);
  assert.equal((JSON.parse(text) as { hits: unknown[] }).hits.length, 8);
  assert.equal(t.calls.length, 0);
});

test("a repeat of the same lookup, however it is spelled, is answered from the cache; another kind, year or title is not", async () => {
  const t = setup(searchOf(sample("movie-search"), sample("tv-search")));
  const first = await hitsOf(await t.get(MOVIE));
  const again = await t.get("title=%20PELABUHAN%20%20terakhir&kind=movie");
  assert.deepEqual(await hitsOf(again), first);
  assert.equal(again.headers.get("cache-control"), "no-store");
  assert.equal(t.calls.length, 1);
  assert.equal(t.cache.puts.length, 1);
  for (const other of ["kind=series&title=Pelabuhan+Terakhir", `${MOVIE}&year=2017`, "kind=movie&title=Pelabuhan"]) {
    const asked: number = t.calls.length;
    await t.get(other);
    assert.equal(t.calls.length, asked + 1, other);
  }
});

test("errors are never cached, whatever the failure", async () => {
  const failures: [string, Upstream][] = [
    ["429", () => reply({}, 429)],
    ["500", () => reply({}, 500)],
    ["503", () => reply({}, 503)],
    ["401", () => reply({}, 401)],
    ["403", () => reply({}, 403)],
    ["404", () => reply({}, 404)],
    ["422", () => reply({}, 422)],
    ["302", () => reply("", 302, { location: "https://elsewhere.test/" })],
    ["204", () => reply("", 204)],
    ["malformed", () => reply("{not json")],
    ["html", () => reply("<html>")],
    ["no results", () => reply({ page: 1 })],
    ["results not a list", () => reply({ results: {} })],
    ["null", () => reply("null")],
    ["throws", () => Promise.reject(new TypeError("fetch failed"))],
  ];
  for (const [name, answer] of failures) {
    const t = setup(answer);
    const res = await t.get(MOVIE);
    assert.ok(res.status >= 429, name);
    assert.equal(t.cache.puts.length, 0, name);
    await t.get(MOVIE);
    assert.equal(t.calls.length, 2, name);
  }
});

test("429 answers busy with TMDB's wait in the body and in Retry-After, and nothing else of the answer", async () => {
  const res = await setup(() => reply({ status_code: 25, status_message: "Your request count (41) is over the allowed limit of (40)." }, 429, { "retry-after": "12" })).get(MOVIE);
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: "busy", retry: 12 });
  assert.equal(res.headers.get("retry-after"), "12");
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("the wait is a whole number of seconds from 1 to 3600, and a missing or bad header means thirty", async () => {
  const wait = async (header: string | null) =>
    (await setup(() => reply({}, 429, header === null ? {} : { "retry-after": header })).get(MOVIE).then(async (res) => ({ body: (await res.json()) as { retry: number }, header: res.headers.get("retry-after") })));
  assert.equal((await wait("0")).body.retry, 1);
  assert.equal((await wait("2.2")).body.retry, 3);
  assert.equal((await wait("999999")).body.retry, 3600);
  assert.equal((await wait("-5")).body.retry, 1);
  assert.equal((await wait("3600")).body.retry, 3600);
  for (const bad of [null, "", "  ", "soon", "Wed, 21 Oct 2026 07:28:00 GMT"]) {
    const out = await wait(bad);
    assert.equal(out.body.retry, RETRY_SECONDS, String(bad));
    assert.equal(out.header, String(RETRY_SECONDS), String(bad));
  }
  assert.equal(RETRY_SECONDS, 30);
});

test("a 5xx answers 503 busy with thirty seconds, whatever Retry-After says", async () => {
  for (const status of [500, 502, 503, 504, 599]) {
    const res = await setup(() => reply({ status_code: 11 }, status, { "retry-after": "9" })).get(MOVIE);
    assert.equal(res.status, 503, String(status));
    assert.deepEqual(await res.json(), { error: "busy", retry: 30 });
    assert.equal(res.headers.get("retry-after"), "30");
  }
});

test("a refused token, a forbidden call, an invalid parameter and every other status below 500 is a plain failure with no wait", async () => {
  for (const status of [400, 401, 403, 404, 405, 422, 428, 499, 201, 203, 206, 299, 302, 304]) {
    const res = await setup(() => reply({ status_code: 7, status_message: `Invalid API key ${TOKEN}` }, status)).get(MOVIE);
    assert.equal(res.status, 502, String(status));
    assert.deepEqual(await res.json(), { error: "failed" });
    assert.equal(res.headers.get("retry-after"), null);
  }
});

test("only a 200 is read, and a 200 with the hits of a good body is read", async () => {
  assert.equal((await setup(movies).get(MOVIE)).status, 200);
  for (const status of [201, 203, 206]) assert.equal((await setup(() => new Response(JSON.stringify(sample("movie-search")), { status })).get(MOVIE)).status, 502, String(status));
});

const sized = (bytes: number) => {
  const head = '{"results":[{"id":910001,"title":"Fits"}],"pad":"';
  const tail = '"}';
  return head + "x".repeat(bytes - head.length - tail.length) + tail;
};

test("a body of exactly 256 KiB is read, one byte more is refused, with or without a length header", async () => {
  assert.equal(MAX_BYTES, 262_144);
  const ok = await setup(() => reply(sized(262_144))).get(MOVIE);
  assert.equal(ok.status, 200);
  assert.equal((await hitsOf(ok))[0].title, "Fits");
  const over = await setup(() => reply(sized(262_145))).get(MOVIE);
  assert.equal(over.status, 502);
  assert.deepEqual(await over.json(), { error: "failed" });
  const chunked = (bytes: number) => new Response(new ReadableStream({ start: (controller) => { const text = new TextEncoder().encode(sized(bytes)); for (let at = 0; at < text.length; at += 10_000) controller.enqueue(text.slice(at, at + 10_000)); controller.close(); } }));
  assert.equal((await setup(() => chunked(262_144)).get(MOVIE)).status, 200);
  assert.equal((await setup(() => chunked(262_145)).get(MOVIE)).status, 502);
  const lying = await setup(() => reply(sized(262_145), 200, { "content-length": "100" })).get(MOVIE);
  assert.equal(lying.status, 502);
});

test("a response over the cap is cancelled, not drained", async () => {
  let cancelled = false;
  let pulls = 0;
  const stream = new ReadableStream({
    pull(controller) {
      pulls++;
      controller.enqueue(new TextEncoder().encode("x".repeat(100_000)));
    },
    cancel() {
      cancelled = true;
    },
  });
  const t = setup(() => new Response(stream));
  assert.equal((await t.get(MOVIE)).status, 502);
  assert.equal(cancelled, true);
  assert.ok(pulls <= 6, String(pulls));
  assert.equal(t.calls.length, 1);
});

test("a gzip bomb is cut at the cap while it is still decompressing, and fails the lookup", async () => {
  const chunk = new Uint8Array(1 << 20);
  let made = 0;
  const zeros = new ReadableStream<Uint8Array>({ pull: (controller) => (made++ < 64 ? controller.enqueue(chunk) : controller.close()) });
  const gzip = new Uint8Array(await new Response(zeros.pipeThrough(new CompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)).arrayBuffer());
  assert.ok(gzip.length < 200_000, String(gzip.length));
  let produced = 0;
  const bomb = () =>
    new Response(
      new Blob([gzip]).stream().pipeThrough(new DecompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>).pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform: (part, controller) => ((produced += part.length), controller.enqueue(part)) })),
      { headers: { "content-encoding": "gzip" } },
    );
  const t = setup(bomb);
  const started = Date.now();
  const res = await t.get(MOVIE);
  assert.equal(res.status, 502);
  assert.ok(produced < 16 * (1 << 20), String(produced));
  assert.ok(Date.now() - started < 2000);
  assert.equal(t.cache.puts.length, 0);
});

test("a call that never answers, and a body that starts and then stalls, both fail after the three second limit and are never cached", async () => {
  assert.equal(CALL_MS, 3000);
  const silent = setup((_url, init) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true })));
  const head = new TextEncoder().encode('{"results":[{"id":1,"ti');
  const stalled = setup(() => new Response(new ReadableStream({ start: (controller) => controller.enqueue(head) })));
  const whole = new TextEncoder().encode(JSON.stringify(sample("movie-search")));
  const unfinished = setup(() => new Response(new ReadableStream({ start: (controller) => controller.enqueue(whole) })));
  const started = Date.now();
  const all = await Promise.all([silent.get(MOVIE), stalled.get(MOVIE), unfinished.get(MOVIE)]);
  const took = Date.now() - started;
  for (const res of all) {
    assert.equal(res.status, 502);
    assert.deepEqual(await res.json(), { error: "failed" });
  }
  assert.ok(took >= 2900 && took < 5000, String(took));
  for (const t of [silent, stalled, unfinished]) {
    assert.equal(t.calls.length, 1, "an error in the first pass ends the lookup");
    assert.equal(t.cache.puts.length, 0);
  }
});

test("each call has its own three seconds: a slow empty first pass does not shorten the second", async () => {
  const t = setup((url) => (url.searchParams.get("language") === "id-ID" ? new Promise<Response>((resolve) => setTimeout(() => resolve(reply(none)), 1500)) : new Promise<Response>((resolve) => setTimeout(() => resolve(reply(sample("movie-search"))), 1500))));
  const res = await t.get(MOVIE);
  assert.equal(res.status, 200);
  assert.equal((await hitsOf(res)).length, 4);
});

test("hostile payloads come out as bounded, plain, well-formed hits and never as an error, a crash or an empty answer by mistake", async () => {
  const noise = "x\u0000​\n\t ‮ y";
  const results = [
    null,
    "x",
    5,
    [],
    {},
    { id: "1", title: "String id" },
    { id: -1, title: "Negative" },
    { id: 1.5, title: "Fraction" },
    { id: 2 ** 60, title: "Unsafe" },
    { id: 1e21, title: "Huge" },
    { id: 0, title: "Zero" },
    { id: 10, title: { text: "object" } },
    { id: 11, title: ["array"] },
    { id: 12, title: "<script>alert(1)</script>Judul", original_title: "<img src=x onerror=alert(1)>", poster_path: "javascript:alert(1)", release_date: "2017<script>" },
    { id: 13, title: "T".repeat(5000), original_title: "O".repeat(5000), release_date: "99999-01-01" },
    { id: 14, title: noise, original_title: `  ${noise}  `, release_date: "0000-01-01" },
    { id: 15, title: "Pangéran Kecil — 小王子 — الأمير الصغير", release_date: 20170101 },
    { id: 16, title: "Future", release_date: "9999-01-01" },
    { id: 17, title: "Date only year", release_date: "2017" },
    { id: 18, title: "Odd date", release_date: "2017-1-1" },
    { id: 19, title: "Fine", poster_path: "/Ab_-9.jpg" },
    { id: 20, title: "Leading junk", release_date: "v2017-01-01" },
  ];
  const t = setup(() => reply({ results }));
  const res = await t.get(MOVIE);
  assert.equal(res.status, 200);
  const hits = await hitsOf(res);
  assert.deepEqual(hits.map((hit) => hit.tmdb), [12, 13, 14, 15, 16, 17, 18]);
  const byId = new Map(hits.map((hit) => [hit.tmdb, hit]));
  assert.deepEqual(byId.get(12), { kind: "movie", tmdb: 12, title: "<script>alert(1)</script>Judul", original: "<img src=x onerror=alert(1)>", year: null, cover: null });
  assert.equal(byId.get(13)!.title.length, 200);
  assert.equal(byId.get(13)!.original!.length, 200);
  assert.equal(byId.get(13)!.year, null);
  assert.equal(byId.get(14)!.title, "x y");
  assert.equal(byId.get(14)!.original, null);
  assert.equal(byId.get(14)!.year, null);
  assert.equal(byId.get(15)!.year, null);
  assert.equal(byId.get(16)!.year, null);
  const more = await hitsOf(await setup(() => reply({ results: results.slice(18) })).get(MOVIE));
  assert.deepEqual(more.map((hit) => [hit.tmdb, hit.year, hit.cover]), [[17, 2017, null], [18, null, null], [19, null, "https://image.tmdb.org/t/p/w342/Ab_-9.jpg"], [20, null, null]]);
  assert.deepEqual(parseScreenHits({ hits }, "movie"), hits);
});

test("only the TMDB poster path shape becomes a cover, on the fixed host and size, and anything else leaves the hit with no cover", async () => {
  const paths: [unknown, string | null][] = [
    ["/abcDEF123_-xyz.jpg", "https://image.tmdb.org/t/p/w342/abcDEF123_-xyz.jpg"],
    ["/a.jpg", "https://image.tmdb.org/t/p/w342/a.jpg"],
    ["/" + "a".repeat(64) + ".jpg", "https://image.tmdb.org/t/p/w342/" + "a".repeat(64) + ".jpg"],
    ["/" + "a".repeat(65) + ".jpg", null],
    ["/.jpg", null],
    ["abc.jpg", null],
    ["/abc.png", null],
    ["/abc.jpeg", null],
    ["/abc.JPG", null],
    ["/abc.jpg.exe", null],
    ["/abc.jpg?size=1", null],
    ["/abc.jpg#x", null],
    ["/abc.jpg\n", null],
    ["\n/abc.jpg", null],
    [" /abc.jpg", null],
    ["/a/b.jpg", null],
    ["/../abc.jpg", null],
    ["/%2e%2e.jpg", null],
    ["//evil.example/abc.jpg", null],
    ["https://evil.example/abc.jpg", null],
    ["https://image.tmdb.org/t/p/w342/abc.jpg", null],
    ["javascript:alert(1)", null],
    ["data:image/jpeg;base64,AAAA", null],
    ["/a b.jpg", null],
    ["/é.jpg", null],
    ["/a\\b.jpg", null],
    [["/abc.jpg"], null],
    [{ toString: "/abc.jpg" }, null],
    [12, null],
    [null, null],
  ];
  for (const [path, cover] of paths) {
    const res = await setup(() => reply({ results: [{ id: 1, title: "T", poster_path: path }] })).get(MOVIE);
    const [hit] = await hitsOf(res);
    assert.equal(hit.cover, cover, JSON.stringify(path));
    if (hit.cover !== null) assert.ok(isCover(hit.cover));
  }
});

test("a missing or malformed results list is an upstream oddity, a failure, never an empty answer", async () => {
  for (const body of [{}, { results: null }, { results: "x" }, { results: {} }, [], "null", "[]", { total_results: 9 }]) {
    const t = setup(() => reply(body as never));
    const res = await t.get(MOVIE);
    assert.equal(res.status, 502, JSON.stringify(body));
    assert.equal(t.cache.puts.length, 0);
    assert.equal(t.calls.length, 1);
  }
});

test("validation: kind, title length, year range and id forms are checked, and nothing reaches upstream when it fails", async () => {
  const t = setup((url) => reply(url.pathname.startsWith("/3/search/") ? none : { id: Number(url.pathname.split("/").pop()), title: "T", name: "T" }));
  const long = "x".repeat(201);
  const bad = [
    "",
    "title=Heat",
    "kind=movie",
    "kind=&title=Heat",
    "kind=Movie&title=Heat",
    "kind=tv&title=Heat",
    "kind=multi&title=Heat",
    "kind=movie%20&title=Heat",
    "kind=movie&kind=series&title=Heat",
    "kind=movie&title=",
    "kind=movie&title=a",
    "kind=movie&title=%20a%20",
    "kind=movie&title=%00%00",
    "kind=movie&title=%E2%80%8B%E2%80%8B",
    `kind=movie&title=${long}`,
    "kind=movie&title=Heat&title=Up",
    "kind=movie&title=Heat&year=",
    "kind=movie&title=Heat&year=1879",
    "kind=movie&title=Heat&year=2201",
    "kind=movie&title=Heat&year=999",
    "kind=movie&title=Heat&year=02017",
    "kind=movie&title=Heat&year=20x7",
    "kind=movie&title=Heat&year=2017.5",
    "kind=movie&title=Heat&year=%2B2017",
    "kind=movie&title=Heat&year=%202017",
    "kind=movie&title=Heat&year=2017&year=2018",
    "kind=movie&title=Heat&yr=2017",
    "kind=movie&title=Heat&language=en-US",
    "kind=movie&title=Heat&api_key=x",
    "kind=movie&title=Heat&id=5",
    "kind=movie&id=5&year=2017",
    "kind=movie&id=",
    "kind=movie&id=0",
    "kind=movie&id=-1",
    "kind=movie&id=01",
    "kind=movie&id=1.5",
    "kind=movie&id=1e3",
    "kind=movie&id=0x10",
    "kind=movie&id=%2B5",
    "kind=movie&id=%205",
    "kind=movie&id=5%20",
    "kind=movie&id=5/../6",
    "kind=movie&id=5%2F..%2F6",
    "kind=movie&id=5&id=6",
    "kind=movie&id=abc",
    "kind=movie&id=%D9%A5",
    "kind=movie&id=1234567890123456",
    "kind=movie&id=9007199254740993",
    "kind=series&id=",
  ];
  for (const query of bad) {
    const res = await t.get(query);
    assert.equal(res.status, 400, query);
    assert.deepEqual(await res.json(), { error: "bad_query" });
    assert.equal(res.headers.get("cache-control"), "no-store");
  }
  assert.equal(t.calls.length, 0);
  assert.equal(t.cache.puts.length, 0);
  for (const good of ["kind=movie&title=Up", "kind=series&title=It", `kind=movie&title=${"x".repeat(200)}`, "kind=movie&title=Heat&year=1880", "kind=movie&title=Heat&year=2200", "kind=movie&id=1", "kind=series&id=999999999999999", "kind=movie&title=%20%20ab%20%20"]) {
    assert.equal((await t.get(good)).status, 200, good);
  }
});

test("a title of 200 characters counts characters, not UTF-16 units or bytes", async () => {
  const t = setup(() => reply(none));
  assert.equal((await t.get(`kind=movie&title=${encodeURIComponent("千".repeat(200))}`)).status, 200);
  assert.equal((await t.get(`kind=movie&title=${encodeURIComponent("😀".repeat(200))}`)).status, 200);
  assert.equal((await t.get(`kind=movie&title=${encodeURIComponent("😀".repeat(201))}`)).status, 400);
  assert.equal((await t.get(`kind=movie&title=${encodeURIComponent("😀")}`)).status, 400);
  assert.equal((await t.get(`kind=movie&title=${encodeURIComponent("😀😀")}`)).status, 200);
});

test("the route is exactly /api/lookup/screen, GET only, and the books route is untouched", async () => {
  const t = setup(movies);
  const send = (path: string, init?: RequestInit) => createWorker(createAuthenticator(), t.fetcher, () => t.cache.store).fetch(new Request(`https://wp.example.test${path}`, init), env());
  for (const path of ["/api/lookup/screen/", "/api/lookup/screens", "/api/lookup/screen/x", "/api/lookup/Screen", "/api/lookup/screen%2F", "/api/screen"]) assert.equal((await send(`${path}?${MOVIE}`)).status, 404, path);
  assert.equal(t.calls.length, 0);
  for (const method of ["POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]) {
    const res = await send(`/api/lookup/screen?${MOVIE}`, { method, body: ["POST", "PUT", "PATCH"].includes(method) ? "{}" : undefined });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("allow"), "GET", method);
  }
  assert.equal(t.calls.length, 0);
  assert.equal(t.cache.puts.length, 0);
  assert.equal((await send(`/api/lookup/screen?${MOVIE}`)).status, 200);
});

test("the route answers only a signed-in caller, before any validation, cache read or upstream call", async () => {
  const t = setup(movies);
  for (const query of [MOVIE, "", "kind=movie&id=1", "kind=zzz"]) {
    const res = await t.get(query, undefined, env({ AUTH_MODE: undefined }));
    assert.equal(res.status, 401, query);
    assert.deepEqual(await res.json(), { error: "unauthorized" });
  }
  assert.equal(t.calls.length, 0);
  assert.equal(t.cache.puts.length, 0);
  assert.equal(t.cache.matches(), 0);
});

test("without the token, empty or blank, the route fails cleanly with no upstream call, no cache read and no cache write, even for a lookup that is cached", async () => {
  for (const TMDB_TOKEN of [undefined, "", "   ", "\n\t"]) {
    const t = setup(movies, { TMDB_TOKEN });
    await t.cache.store.put(new Request("https://lookup.invalid/screen/v1?kind=movie&title=pelabuhan+terakhir"), Response.json({ hits: [{ kind: "movie", tmdb: 1, title: "Cached", original: null, year: null, cover: null }], at: Date.now() }));
    const before = t.cache.puts.length;
    const res = await t.get(MOVIE);
    assert.equal(res.status, 502, String(TMDB_TOKEN));
    assert.deepEqual(await res.json(), { error: "failed" });
    assert.equal(res.headers.get("retry-after"), null);
    assert.equal(t.calls.length, 0);
    assert.equal(t.cache.puts.length, before);
    assert.equal(t.cache.matches(), 0);
    assert.equal((await t.get("kind=movie&id=1")).status, 502);
    assert.equal((await t.get("kind=bad")).status, 400);
    assert.equal(t.calls.length, 0);
  }
});

test("a broken Cache API never breaks a lookup", async () => {
  const net = upstream(movies);
  const broken = { match: async () => Promise.reject(new Error("cache down")), put: async () => Promise.reject(new Error("cache down")) } as unknown as Store;
  const call = (store: () => Store) => createWorker(createAuthenticator(), net.fetcher, store).fetch(new Request(`https://wp.example.test/api/lookup/screen?${MOVIE}`), env());
  for (const store of [() => broken, () => { throw new Error("no cache"); }]) {
    const res = await call(store);
    assert.equal(res.status, 200);
    assert.equal((await hitsOf(res)).length, 4);
  }
  for (const match of [async () => new Response("not json"), async () => Response.json({ hits: "x" }), async () => Response.json(null)]) {
    const res = await call(() => ({ match, put: async () => {} }) as unknown as Store);
    assert.equal((await hitsOf(res)).length, 4);
  }
});

test("the token never leaves the Worker: not in a response body, a header, a log line, a cache key or entry, even when every upstream call fails", async () => {
  const spies = (["log", "info", "warn", "error", "debug", "trace"] as const).map((name) => mock.method(console, name, () => {}));
  try {
    const leaking: Upstream[] = [
      (url, init) => reply({ status_message: `blocked ${url.href} ${JSON.stringify(init?.headers)}` }, 401),
      (url, init) => reply({ status_message: `quota ${url.href}` }, 429, { "retry-after": "9", "x-echo": `${url.href} ${(init?.headers as Record<string, string>).authorization}` }),
      (url) => reply(`oops ${url.href}`, 500),
      (url, init) => reply(`<html>${url.href} ${(init?.headers as Record<string, string>).authorization}</html>`, 403),
      (url, init) => Promise.reject(Object.assign(new TypeError(`fetch failed ${url.href}`), { cause: new Error((init?.headers as Record<string, string>).authorization) })),
      (url) => reply(`{"results": "${url.href}`),
    ];
    for (const answer of leaking) {
      const t = setup(answer);
      for (const query of [MOVIE, "kind=series&title=Rumah&year=2023", "kind=movie&id=910001", `kind=movie&title=${TOKEN}`, "kind=movie&title=a", "kind=x"]) {
        const res = await t.get(query);
        const seen = [await res.clone().text(), ...[...res.headers].flat(), res.url, String(res.status)].join("\n");
        assert.ok(!seen.includes(TOKEN), `${query} ${seen.slice(0, 160)}`);
        assert.ok(!/themoviedb|bearer|authorization/i.test(seen.replace(/"title":"Bearer[^"]*"/i, "")), `${query} ${seen.slice(0, 160)}`);
      }
      const stored = [...t.cache.puts, ...[...t.cache.entries.values()].flatMap((entry) => [entry.body, entry.control ?? ""])];
      assert.ok(stored.every((text) => !text.includes(TOKEN) && !/themoviedb|bearer/i.test(text)), stored.join("\n").slice(0, 200));
    }
    const ok = setup(movies);
    const res = await ok.get(MOVIE);
    assert.ok(![await res.text(), ...[...res.headers].flat(), ...ok.cache.entries.keys(), ...[...ok.cache.entries.values()].flatMap((entry) => [entry.body, entry.control ?? ""])].some((text) => text.includes(TOKEN)));
    const logged = spies.flatMap((spy) => spy.mock.calls.map((call) => JSON.stringify(call.arguments)));
    assert.equal(logged.length, 0, `the route logs nothing at all: ${logged.join("\n")}`);
  } finally {
    mock.restoreAll();
  }
});

test("a token that the upstream echoes in a field the route drops never reaches the client or the cache", async () => {
  const t = setup((_url, init) => reply({ results: [{ id: 1, title: "Fine" }], echo: (init?.headers as Record<string, string>).authorization }));
  const res = await t.get(MOVIE);
  const seen = [await res.text(), ...[...res.headers].flat()].join("\n");
  assert.ok(!seen.includes(TOKEN));
  assert.ok(![...t.cache.entries.values()].some((entry) => entry.body.includes(TOKEN)));
});

const walk = (dir: URL): URL[] =>
  readdirSync(dir).flatMap((name) => {
    const child = new URL(`${name}${statSync(new URL(name, dir)).isDirectory() ? "/" : ""}`, dir);
    return child.pathname.endsWith("/") ? walk(child) : [child];
  });

test("the token name and the TMDB API host are in the Worker route and nowhere under src or shared, and the route logs nothing", () => {
  const pattern = /TMDB_TOKEN|api\.themoviedb\.org/;
  const named = (dir: string) => walk(new URL(`${dir}/`, root)).filter((file) => pattern.test(readFileSync(file, "utf8"))).map((file) => file.pathname.slice(root.pathname.length));
  assert.deepEqual(named("src"), []);
  assert.deepEqual(named("shared"), []);
  assert.deepEqual(named("public"), []);
  assert.deepEqual(named("worker"), ["worker/screen.ts"]);
  assert.doesNotMatch(readFileSync(new URL("worker/screen.ts", root), "utf8"), /console\./);
  assert.doesNotMatch(readFileSync(new URL("index.html", root), "utf8"), pattern);
  assert.equal(readFileSync(new URL(".dev.vars.example", root), "utf8").split("\n").includes("TMDB_TOKEN="), true);
});

test("the token is read from the environment in one place, and the header is the only place it is used", () => {
  const source = readFileSync(new URL("worker/screen.ts", root), "utf8");
  assert.equal(source.match(/TMDB_TOKEN/g)?.length, 2);
  assert.equal(source.match(/\$\{token\}/g)?.length, 1);
  assert.doesNotMatch(source, /api_key/);
  assert.match(source, /authorization: `Bearer \$\{token\}`/);
});

test("only the first twenty results are read, so a huge body cannot cost the CPU of reading it all", async () => {
  assert.equal(RESULTS_READ, 20);
  const filler = (from: number, count: number) => Array.from({ length: count }, (_, n) => ({ id: from + n, title: "" }));
  const late = { id: 77, title: "Too Late" };
  const last = { id: 78, title: "Last Read" };
  const body = (results: unknown[]) => reply({ results });
  const t = setup(() => body([...filler(1, 19), last, late, ...filler(100, 10_500)]));
  assert.deepEqual((await hitsOf(await t.get(MOVIE))).map((hit) => hit.tmdb), [78]);
  const beyond = setup(() => body([...filler(1, 20), late, ...filler(100, 10_500)]));
  const answer = await beyond.get(MOVIE);
  assert.equal(answer.status, 200);
  assert.deepEqual(await hitsOf(answer), []);
});

test("a stored entry is served only for its own kind and each id once, so a poisoned entry cannot mix kinds or repeat a hit", async () => {
  const key = "https://lookup.invalid/screen/v1?kind=movie&title=pelabuhan+terakhir";
  const good = { kind: "movie", tmdb: 5, title: "Good", original: null, year: 2001, cover: null };
  const stored = [good, { ...good, tmdb: 6, kind: "series", title: "Wrong Kind" }, { ...good, title: "Same Id Again" }, { ...good, tmdb: 7, title: "Other" }];
  const t = setup(movies);
  await t.cache.store.put(new Request(key), Response.json({ hits: stored, at: Date.now() }));
  const hits = await hitsOf(await t.get(MOVIE));
  assert.deepEqual(hits.map((hit) => [hit.tmdb, hit.title]), [[5, "Good"], [7, "Other"]]);
  assert.equal(t.calls.length, 0);
});
