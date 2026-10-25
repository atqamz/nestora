import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createAuthenticator } from "../worker/auth.ts";
import { createWorker } from "../worker/index.ts";
import type { Bindings } from "../worker/index.ts";
import { CACHE_SECONDS, OPEN_LIBRARY_AGENT, RETRY_SECONDS } from "../worker/lookup.ts";
import type { Store } from "../worker/lookup.ts";
import { googleUrl } from "../src/domain/googlebooks.ts";
import { isbnUrl, searchUrl } from "../src/domain/openlibrary.ts";
import { isCover } from "../shared/validate.ts";

const KEY = "test-key-not-a-real-secret-0000";

const sample = (dir: string, name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${dir}/${name}.json`, import.meta.url), "utf8"));

const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });

type Call = { url: string; init: RequestInit | undefined };

type Upstream = (url: URL, calls: Call[]) => Response | Promise<Response>;

const upstream = (google: Upstream, open: Upstream = () => reply({ docs: [] })) => {
  const calls: Call[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url: url.href, init });
    if (url.hostname === "www.googleapis.com") return google(url, calls);
    if (url.hostname === "openlibrary.org") return open(url, calls);
    throw new Error(`unexpected host ${url.hostname}`);
  }) as typeof fetch;
  const count = (host: string) => calls.filter((call) => new URL(call.url).hostname === host).length;
  return { calls, fetcher, google: () => count("www.googleapis.com"), open: () => count("openlibrary.org") };
};

const fakeCache = () => {
  const entries = new Map<string, { body: string; control: string | null }>();
  const puts: string[] = [];
  const store = {
    async match(request: RequestInfo | URL) {
      const entry = entries.get(String(request instanceof Request ? request.url : request));
      return entry === undefined ? undefined : new Response(entry.body, { headers: { "content-type": "application/json" } });
    },
    async put(request: RequestInfo | URL, response: Response) {
      const url = String(request instanceof Request ? request.url : request);
      puts.push(url);
      entries.set(url, { body: await response.text(), control: response.headers.get("cache-control") });
    },
  } as unknown as Store;
  return { store, entries, puts };
};

const env = (extra: Partial<Bindings> = {}): Bindings => ({ DB: {} as Bindings["DB"], DESIGN: { get: async () => null }, AUTH_MODE: "dev", DEV_WHO: "a", GOOGLE_BOOKS_KEY: KEY, ...extra });

const setup = (google: Upstream, open?: Upstream, extra: Partial<Bindings> = {}) => {
  const net = upstream(google, open);
  const cache = fakeCache();
  const worker = createWorker(createAuthenticator(), net.fetcher, () => cache.store);
  const get = (query: string, init?: RequestInit, bindings = env(extra)) => worker.fetch(new Request(`https://wp.example.test/api/lookup?${query}`, init), bindings);
  return { ...net, cache, get };
};

const laskar = () => reply(sample("google", "laskar-pelangi"));

const hitsOf = async (res: Response) => ((await res.json()) as { hits: { source: string; work: string; title: string; isbns: string[]; cover: string | null }[] }).hits;

const QUERY = "title=Laskar+Pelangi&author=Andrea+Hirata";

test("a title lookup asks Google with a plain query and the key, and returns its volumes in its order", async () => {
  const t = setup(laskar);
  const res = await t.get(QUERY);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const hits = await hitsOf(res);
  assert.deepEqual(hits.map((hit) => [hit.source, hit.work]), [["google", "Lp1AbCdEfGhI"], ["google", "Lp2AbCdEfGhI"], ["google", "Lp3AbCdEfGhI"], ["google", "Lp4AbCdEfGhI"]]);
  assert.deepEqual(hits[0].isbns, ["9789793062792"]);
  assert.equal(t.google(), 1);
  assert.equal(t.open(), 0);
  assert.equal(t.calls[0].url, googleUrl({ kind: "title", title: "laskar pelangi", author: "andrea hirata" }));
  assert.equal(new URL(t.calls[0].url).searchParams.get("q"), "laskar pelangi andrea hirata");
});

test("an ISBN lookup asks Google for isbn:<13>", async () => {
  const t = setup(laskar);
  const res = await t.get("isbn=9789793062792");
  assert.equal(res.status, 200);
  assert.equal(new URL(t.calls[0].url).searchParams.get("q"), "isbn:9789793062792");
  assert.equal((await hitsOf(res)).length, 4);
});

test("the upstream requests carry no credentials, follow no redirect and ask for json, Google with the key in a header and Open Library with an identifying agent", async () => {
  const t = setup(() => reply({ totalItems: 0 }), () => reply(sample("openlibrary", "laskar-pelangi-search")));
  await t.get(QUERY);
  const [google, open] = t.calls.map((call) => call.init ?? {});
  for (const init of [google, open]) {
    assert.equal(init.redirect, "manual");
    assert.equal(init.credentials, undefined);
    assert.ok(init.signal instanceof AbortSignal);
  }
  assert.deepEqual(google.headers, { accept: "application/json", "x-goog-api-key": KEY });
  assert.deepEqual(open.headers, { accept: "application/json", "user-agent": "Nestora/1.0 (+https://nestora.atqamz.com)" });
  assert.equal(OPEN_LIBRARY_AGENT, "Nestora/1.0 (+https://nestora.atqamz.com)");
  assert.doesNotMatch(OPEN_LIBRARY_AGENT, /@/);
  assert.ok(!t.calls[0].url.includes(KEY) && !t.calls[1].url.includes(KEY));
});

test("every cover that leaves the route is on the registry's allow-list and https", async () => {
  const t = setup(laskar);
  for (const hit of await hitsOf(await t.get(QUERY))) assert.ok(hit.cover === null || isCover(hit.cover), String(hit.cover));
  assert.doesNotMatch(JSON.stringify(await hitsOf(await t.get(QUERY))), /zoom=|edge=curl|http:\/\//);
});

test("when Google finds nothing the Open Library search answers, and the answer says so", async () => {
  const t = setup(() => reply({ kind: "books#volumes", totalItems: 0 }), () => reply(sample("openlibrary", "laskar-pelangi-search")));
  const hits = await hitsOf(await t.get(QUERY));
  assert.equal(hits[0].source, "openlibrary");
  assert.equal(hits[0].work, "OL15302003W");
  assert.equal(t.calls[1].url, searchUrl("laskar pelangi andrea hirata"));
});

test("an ISBN falls back to the Open Library ISBN search", async () => {
  const t = setup(() => reply({ totalItems: 0 }), () => reply(sample("openlibrary", "laskar-pelangi-isbn")));
  const hits = await hitsOf(await t.get("isbn=9789793062792"));
  assert.equal(hits[0].source, "openlibrary");
  assert.equal(t.calls[1].url, isbnUrl("9789793062792"));
});

test("a volume list with no usable volume counts as nothing", async () => {
  const t = setup(() => reply({ items: [{ id: "a/b", volumeInfo: { title: "T" } }, { id: "Vol1AbCdEfGh", volumeInfo: { title: "" } }] }), () => reply(sample("openlibrary", "bumi-manusia-search")));
  assert.equal((await hitsOf(await t.get("title=bumi+manusia")))[0].source, "openlibrary");
});

test("the first source with answers wins and nothing is mixed in", async () => {
  const t = setup(laskar, () => reply(sample("openlibrary", "laskar-pelangi-search")));
  assert.deepEqual([...new Set((await hitsOf(await t.get(QUERY))).map((hit) => hit.source))], ["google"]);
  assert.equal(t.open(), 0);
});

test("every cached answer, found, empty or from Open Library, is kept for at most an hour, under a key without the secret", async () => {
  const found = setup(laskar);
  await found.get(QUERY);
  assert.equal(found.cache.puts.length, 1);
  const [url] = found.cache.puts;
  assert.equal(found.cache.entries.get(url)?.control, "public, max-age=3600");
  assert.equal(CACHE_SECONDS, 3600);
  assert.equal(new URL(url).origin, "https://lookup.invalid");
  assert.ok(!url.includes(KEY));
  assert.ok(![...found.cache.entries.values()].some((entry) => entry.body.includes(KEY)));

  const empty = setup(() => reply({ totalItems: 0 }));
  await empty.get(QUERY);
  assert.equal(empty.cache.entries.get(empty.cache.puts[0])?.control, "public, max-age=3600");

  const open = setup(() => reply({ totalItems: 0 }), () => reply(sample("openlibrary", "laskar-pelangi-search")));
  await open.get(QUERY);
  assert.equal(open.cache.entries.get(open.cache.puts[0])?.control, "public, max-age=3600");
});

test("a stored answer older than an hour is not served, whatever the cache says, and is asked for again", async () => {
  mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  try {
    const t = setup(laskar);
    await t.get(QUERY);
    mock.timers.tick(3_599_999);
    await t.get(QUERY);
    assert.equal(t.google(), 1);
    mock.timers.tick(1);
    await t.get(QUERY);
    assert.equal(t.google(), 2);
    assert.equal(t.cache.puts.length, 2);
    mock.timers.tick(3_599_000);
    await t.get(QUERY);
    assert.equal(t.google(), 2);
  } finally {
    mock.timers.reset();
  }
});

test("an entry stamped in the future, without a stamp or with a bad one is not served", async () => {
  mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  try {
    const hits = [{ source: "google", work: "Vol1AbCdEfGh", title: "Stored", author: "", year: null, cover: null, isbns: [], language: null, blurb: null }];
    for (const stored of [{ hits, at: 1_800_000_000_001 }, { hits }, { hits, at: "now" }, { hits, at: "1800000000000" }, { hits, at: null }, { hits, at: Number.NaN }]) {
      const t = setup(laskar);
      const key = `https://lookup.invalid/v1?${new URLSearchParams({ title: "laskar pelangi", author: "andrea hirata" })}`;
      await t.cache.store.put(new Request(key), Response.json(stored));
      assert.equal((await hitsOf(await t.get(QUERY)))[0].title, "Laskar Pelangi", JSON.stringify(stored));
      assert.equal(t.google(), 1);
    }
    const fresh = setup(laskar);
    const key = `https://lookup.invalid/v1?${new URLSearchParams({ title: "laskar pelangi", author: "andrea hirata" })}`;
    await fresh.cache.store.put(new Request(key), Response.json({ hits, at: 1_800_000_000_000 }));
    assert.equal((await hitsOf(await fresh.get(QUERY)))[0].title, "Stored");
    assert.equal(fresh.google(), 0);
  } finally {
    mock.timers.reset();
  }
});

test("a repeat of the same lookup, however it is spelled, is answered from the cache with no upstream call", async () => {
  const t = setup(laskar);
  const first = await hitsOf(await t.get(QUERY));
  const again = await t.get("title=%20LASKAR%20%20pelangi&author=andrea+hirata");
  assert.deepEqual(await hitsOf(again), first);
  assert.equal(again.headers.get("cache-control"), "no-store");
  assert.equal(t.google(), 1);
  assert.equal(t.cache.puts.length, 1);
  await t.get("title=Laskar+Pelangi");
  assert.equal(t.google(), 2);
});

test("an empty answer is cached too, so a missing book does not spend the quota twice", async () => {
  const t = setup(() => reply({ totalItems: 0 }));
  assert.deepEqual(await hitsOf(await t.get(QUERY)), []);
  assert.deepEqual(await hitsOf(await t.get(QUERY)), []);
  assert.equal(t.google(), 1);
  assert.equal(t.open(), 1);
});

test("an Open Library answer after an answering Google is cached as well", async () => {
  const t = setup(() => reply({ totalItems: 0 }), () => reply(sample("openlibrary", "laskar-pelangi-search")));
  await t.get(QUERY);
  await t.get(QUERY);
  assert.equal(t.open(), 1);
  assert.equal(t.cache.puts.length, 1);
});

test("errors are never cached, whatever the failure", async () => {
  const failures: [string, Upstream][] = [
    ["429", () => reply({}, 429)],
    ["500", () => reply({}, 500)],
    ["503", () => reply({}, 503)],
    ["403", () => reply({}, 403)],
    ["404", () => reply({}, 404)],
    ["302", () => reply("", 302, { location: "https://elsewhere.test/" })],
    ["malformed", () => reply("{not json")],
    ["html", () => reply("<html>")],
    ["throws", () => Promise.reject(new TypeError("fetch failed"))],
  ];
  for (const [name, google] of failures) {
    const t = setup(google, () => reply({}, 500));
    const res = await t.get(QUERY);
    assert.ok(res.status >= 429, name);
    assert.equal(t.cache.puts.length, 0, name);
    await t.get(QUERY);
    assert.equal(t.google(), 2, name);
  }
});

test("Google 429 with Open Library hits answers with those hits and caches nothing", async () => {
  const t = setup(() => reply({}, 429, { "retry-after": "12" }), () => reply(sample("openlibrary", "laskar-pelangi-search")));
  const res = await t.get(QUERY);
  assert.equal(res.status, 200);
  assert.equal((await hitsOf(res))[0].source, "openlibrary");
  assert.equal(t.cache.puts.length, 0);
});

test("Google 429 with nothing from Open Library answers 429 busy with the wait in seconds, in the body and in Retry-After", async () => {
  const t = setup(() => reply({}, 429, { "retry-after": "12" }));
  const res = await t.get(QUERY);
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: "busy", retry: 12 });
  assert.equal(res.headers.get("retry-after"), "12");
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("Google 5xx with nothing from Open Library answers 503 busy with the default wait", async () => {
  for (const status of [500, 502, 503, 504]) {
    const res = await setup(() => reply({}, status)).get(QUERY);
    assert.equal(res.status, 503, String(status));
    assert.deepEqual(await res.json(), { error: "busy", retry: RETRY_SECONDS });
    assert.equal(res.headers.get("retry-after"), String(RETRY_SECONDS));
  }
});

test("the wait is a whole number of seconds from 1 to 3600, and a bad header means the default", async () => {
  const wait = async (header: string | null) => (await setup(() => reply({}, 429, header === null ? {} : { "retry-after": header })).get(QUERY).then((res) => res.json())) as { retry: number };
  assert.equal((await wait("0")).retry, 1);
  assert.equal((await wait("2.2")).retry, 3);
  assert.equal((await wait("999999")).retry, 3600);
  assert.equal((await wait("-5")).retry, 1);
  for (const bad of [null, "", "  ", "soon", "Wed, 21 Oct 2026 07:28:00 GMT"]) assert.equal((await wait(bad)).retry, RETRY_SECONDS, String(bad));
});

test("Open Library limiting after an empty Google answers busy too", async () => {
  const res = await setup(() => reply({ totalItems: 0 }), () => reply({}, 429, { "retry-after": "5" })).get(QUERY);
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { error: "busy", retry: 5 });
});

test("a malformed Google answer with nothing from Open Library is a plain failure with no wait", async () => {
  const res = await setup(() => reply("{not json"), () => reply({}, 404)).get(QUERY);
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: "failed" });
  assert.equal(res.headers.get("retry-after"), null);
});

test("a failing Google with an empty Open Library is not an empty answer, so the client does not take a miss for a no", async () => {
  const res = await setup(() => reply({}, 500), () => reply({ docs: [] })).get(QUERY);
  assert.equal(res.status, 503);
});

test("malformed JSON from Google falls back to Open Library", async () => {
  const t = setup(() => reply("{not json"), () => reply(sample("openlibrary", "laskar-pelangi-search")));
  assert.equal((await hitsOf(await t.get(QUERY)))[0].source, "openlibrary");
  assert.equal(t.cache.puts.length, 0);
});

test("a response over a megabyte is refused, with or without a length header, and falls back", async () => {
  const huge = JSON.stringify({ items: [], pad: "x".repeat(1_100_000) });
  const t = setup(() => reply(huge), () => reply(sample("openlibrary", "laskar-pelangi-search")));
  assert.equal((await hitsOf(await t.get(QUERY)))[0].source, "openlibrary");
  const chunked = setup(() => new Response(new ReadableStream({ start: (controller) => { for (let n = 0; n < 30; n++) controller.enqueue(new TextEncoder().encode("x".repeat(100_000))); controller.close(); } })), () => reply(sample("openlibrary", "laskar-pelangi-search")));
  assert.equal((await hitsOf(await chunked.get(QUERY)))[0].source, "openlibrary");
  const body = JSON.stringify({ items: [{ id: "Vol1AbCdEfGh", volumeInfo: { title: "Fits", description: "x".repeat(900_000) } }] });
  assert.equal((await hitsOf(await setup(() => reply(body)).get(QUERY)))[0].title, "Fits");
});

test("hostile fields from Google come out as safe, bounded, plain data", async () => {
  const items = [
    { id: "Vol1AbCdEfGh", volumeInfo: { title: "<script>alert(1)</script>Judul", authors: ["<b>x</b>", "x".repeat(500)], description: "<img src=x onerror=alert(1)>Isi &amp; lagi", imageLinks: { thumbnail: "javascript:alert(1)", smallThumbnail: "http://books.google.com/books/content?id=Vol1AbCdEfGh&zoom=5&edge=curl" }, industryIdentifiers: [{ type: "ISBN_13", identifier: "9789793062792" }, { type: "ISBN_13", identifier: "9789793062792" }, { type: "ISBN_10", identifier: "9793062797" }], language: "id", publishedDate: "2008" } },
    { id: "Vol1AbCdEfGh", volumeInfo: { title: "Duplicate id" } },
    { id: "Vol2AbCdEfGh", volumeInfo: { title: "T".repeat(5000), imageLinks: { thumbnail: "https://evil.test/books/content?id=x" } } },
    { id: "Vol3AbCdEfGh", volumeInfo: { title: "Pangéran Kecil — 小王子 — الأمير الصغير", authors: [], industryIdentifiers: [{ type: "ISBN_10", identifier: "0374246319" }] } },
    { id: "Vol4AbCdEfGh", volumeInfo: { title: "No identifiers or images" } },
    { id: "Vol5AbCdEfGh" },
    null,
    "x",
  ];
  const res = await setup(() => reply({ items })).get(QUERY);
  const hits = (await res.json()) as { hits: { work: string; title: string; author: string; blurb: string | null; cover: string | null; isbns: string[] }[] };
  assert.deepEqual(hits.hits.map((hit) => hit.work), ["Vol1AbCdEfGh", "Vol2AbCdEfGh", "Vol3AbCdEfGh", "Vol4AbCdEfGh"]);
  const [first, long, plain, bare] = hits.hits;
  assert.equal(first.title, "<script>alert(1)</script>Judul");
  assert.equal(first.blurb, null);
  assert.equal(first.cover, "https://books.google.com/books/content?id=Vol1AbCdEfGh");
  assert.deepEqual(first.isbns, ["9789793062792"]);
  assert.equal(first.author.split("; ")[1].length, 100);
  assert.equal(long.title.length, 200);
  assert.equal(long.cover, null);
  assert.deepEqual([plain.title, plain.author, plain.isbns], ["Pangéran Kecil — 小王子 — الأمير الصغير", "", ["9780374246310"]]);
  assert.deepEqual([bare.isbns, bare.cover], [[], null]);
});

test("validation: an ISBN needs 13 valid digits, a title two characters, caps hold, and nothing reaches upstream when it fails", async () => {
  const t = setup(laskar);
  const bad = ["", "isbn=9789793062793", "isbn=978979306279", "isbn=9789793062792&title=x", "title=", "title=a", `title=${"x".repeat(201)}`, "title=ab&author=" + "y".repeat(121), "author=Someone", "title=%00%00", "isbn=9793062797"];
  for (const query of bad) {
    const res = await t.get(query);
    assert.equal(res.status, 400, query);
    assert.deepEqual(await res.json(), { error: "bad_query" });
  }
  assert.equal(t.calls.length, 0);
  assert.equal((await t.get("title=ab")).status, 200);
  assert.equal((await t.get(`title=${"x".repeat(200)}&author=${"y".repeat(120)}`)).status, 200);
});

test("only GET is allowed", async () => {
  const t = setup(laskar);
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const res = await t.get(QUERY, { method, body: method === "DELETE" ? undefined : "{}" });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("allow"), "GET");
  }
  assert.equal(t.calls.length, 0);
});

test("the route answers only a signed-in caller, before any validation or upstream call", async () => {
  const t = setup(laskar);
  for (const query of [QUERY, "", "isbn=9789793062792"]) {
    const res = await t.get(query, undefined, env({ AUTH_MODE: undefined }));
    assert.equal(res.status, 401, query);
    assert.deepEqual(await res.json(), { error: "unauthorized" });
  }
  assert.equal(t.calls.length, 0);
  assert.equal(t.cache.puts.length, 0);
});

test("without the secret, empty or blank, Google is never asked and Open Library answers, uncached", async () => {
  for (const GOOGLE_BOOKS_KEY of [undefined, "", "   "]) {
    const t = setup(laskar, () => reply(sample("openlibrary", "laskar-pelangi-search")), { GOOGLE_BOOKS_KEY });
    const res = await t.get(QUERY);
    assert.equal(res.status, 200);
    assert.equal((await hitsOf(res))[0].source, "openlibrary");
    assert.equal(t.google(), 0);
    assert.equal(t.cache.puts.length, 0);
    await t.get(QUERY);
    assert.equal(t.open(), 2);
  }
});

test("without the secret and without an Open Library answer the miss is an empty list, not an error", async () => {
  const res = await setup(laskar, () => reply({ docs: [] }), { GOOGLE_BOOKS_KEY: undefined }).get(QUERY);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { hits: [] });
});

test("a broken Cache API never breaks a lookup", async () => {
  const net = upstream(laskar);
  const broken = { match: async () => Promise.reject(new Error("cache down")), put: async () => Promise.reject(new Error("cache down")) } as unknown as Store;
  for (const store of [() => broken, () => { throw new Error("no cache"); }]) {
    const worker = createWorker(createAuthenticator(), net.fetcher, store);
    const res = await worker.fetch(new Request(`https://wp.example.test/api/lookup?${QUERY}`), env());
    assert.equal(res.status, 200);
    assert.equal((await hitsOf(res)).length, 4);
  }
  const bad = { match: async () => new Response("not json"), put: async () => {} } as unknown as Store;
  const res = await createWorker(createAuthenticator(), net.fetcher, () => bad).fetch(new Request(`https://wp.example.test/api/lookup?${QUERY}`), env());
  assert.equal((await hitsOf(res)).length, 4);
  const wrong = { match: async () => Response.json({ hits: "x" }), put: async () => {} } as unknown as Store;
  assert.equal((await hitsOf(await createWorker(createAuthenticator(), net.fetcher, () => wrong).fetch(new Request(`https://wp.example.test/api/lookup?${QUERY}`), env()))).length, 4);
});

test("the key never leaves the Worker: not in a response body, a header, a log line or the cache, even when every upstream call fails", async () => {
  const spies = (["log", "info", "warn", "error", "debug", "trace"] as const).map((name) => mock.method(console, name, () => {}));
  try {
    const leaking: Upstream[] = [
      (url) => reply({ error: { message: `blocked ${url.href}` } }, 403),
      (url) => reply({ error: { message: `quota ${url.href}` } }, 429, { "retry-after": "9", "x-echo": url.href }),
      (url) => reply(`oops ${url.href}`, 500),
      (url) => Promise.reject(Object.assign(new TypeError(`fetch failed ${url.href}`), { cause: new Error(url.href) })),
      (url) => reply(`{"items": "${url.href}`),
    ];
    for (const google of leaking) {
      for (const open of [(): Response => reply({}, 500), (): Response => Promise.reject(new Error(KEY)) as never]) {
        const t = setup(google, open);
        for (const query of [QUERY, "isbn=9789793062792", "title=<script>&author=x", "title=a"]) {
          const res = await t.get(query);
          const seen = [await res.clone().text(), ...[...res.headers].flat(), res.url, String(res.status)].join("\n");
          assert.ok(!seen.includes(KEY), `${query} ${seen.slice(0, 120)}`);
          assert.ok(!seen.includes("googleapis.com"), "no upstream URL either");
        }
        assert.equal(t.cache.puts.length, 0);
      }
    }
    const ok = setup(laskar);
    const res = await ok.get(QUERY);
    assert.ok(![await res.text(), ...[...res.headers].flat(), ...ok.cache.entries.keys(), ...[...ok.cache.entries.values()].map((entry) => entry.body)].some((text) => text.includes(KEY)));
    const logged = spies.flatMap((spy) => spy.mock.calls.map((call) => JSON.stringify(call.arguments)));
    assert.ok(logged.every((line) => !line.includes(KEY)), logged.join("\n"));
    assert.equal(logged.length, 0, "the route logs nothing at all");
  } finally {
    mock.restoreAll();
  }
});

test("the key and the Google host are not in the client bundle sources", () => {
  const sources = ["../src/domain/lookup.ts", "../src/store/lookup.ts", "../src/ui/book-lookup.tsx"].map((path) => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
  assert.doesNotMatch(sources, /GOOGLE_BOOKS_KEY|googleapis\.com/);
  assert.doesNotMatch(readFileSync(new URL("../worker/lookup.ts", import.meta.url), "utf8"), /console\./);
});

test("the default wait is thirty seconds", () => {
  assert.equal(RETRY_SECONDS, 30);
});

test("a body of exactly a megabyte is read, one byte more is refused", async () => {
  const sized = (bytes: number) => {
    const head = '{"items":[{"id":"Vol1AbCdEfGh","volumeInfo":{"title":"Fits"}}],"pad":"';
    const tail = '"}';
    return head + "x".repeat(bytes - head.length - tail.length) + tail;
  };
  const open = () => reply(sample("openlibrary", "laskar-pelangi-search"));
  assert.equal((await hitsOf(await setup(() => reply(sized(1_000_000)), open).get(QUERY)))[0].source, "google");
  assert.equal((await hitsOf(await setup(() => reply(sized(1_000_001)), open).get(QUERY)))[0].source, "openlibrary");
});

test("a status below 500 other than 429 is a plain failure, 500 is a busy one", async () => {
  assert.equal((await setup(() => reply({}, 499)).get(QUERY)).status, 502);
  assert.equal((await setup(() => reply({}, 500)).get(QUERY)).status, 503);
  assert.equal((await setup(() => reply({}, 428)).get(QUERY)).status, 502);
});

test("one hit is cached for an hour, and one Open Library hit is enough after a failing Google", async () => {
  const one = reply({ items: [{ id: "Vol1AbCdEfGh", volumeInfo: { title: "Solo" } }] });
  const t = setup(() => one.clone());
  await t.get(QUERY);
  assert.equal(t.cache.entries.get(t.cache.puts[0])?.control, "public, max-age=3600");
  const doc = { key: "/works/OL1W", title: "Solo" };
  const after = setup(() => reply({}, 500), () => reply({ docs: [doc] }));
  const res = await after.get(QUERY);
  assert.equal(res.status, 200);
  assert.deepEqual((await hitsOf(res)).map((hit) => hit.work), ["OL1W"]);
});

test("a Google answer that counts volumes but lists none is an upstream oddity: Open Library answers and nothing is cached", async () => {
  for (const body of [{ totalItems: 1 }, { totalItems: 7 }, { totalItems: 7, items: [] }, { totalItems: 3, items: [{ id: "a/b", volumeInfo: { title: "T" } }] }]) {
    const t = setup(() => reply(body), () => reply(sample("openlibrary", "laskar-pelangi-search")));
    assert.equal((await hitsOf(await t.get(QUERY)))[0].source, "openlibrary", JSON.stringify(body));
    assert.equal(t.cache.puts.length, 0);
    await t.get(QUERY);
    assert.equal(t.google(), 2);
    const bare = await setup(() => reply(body), () => reply({ docs: [] })).get(QUERY);
    assert.equal(bare.status, 502);
  }
});

test("a Google answer that counts nothing is a definite empty one", async () => {
  for (const body of [{ totalItems: 0 }, { totalItems: 0, items: [] }, { kind: "books#volumes" }]) {
    const t = setup(() => reply(body));
    assert.deepEqual(await hitsOf(await t.get(QUERY)), []);
    assert.equal(t.cache.puts.length, 1, JSON.stringify(body));
  }
});

test("only a 200 is read: another success status with a good body is a failure", async () => {
  for (const status of [201, 203, 206, 299]) {
    const res = await setup(() => new Response(JSON.stringify(sample("google", "laskar-pelangi")), { status }), () => new Response(JSON.stringify({ docs: [] }), { status })).get(QUERY);
    assert.equal(res.status, 502, String(status));
  }
});

test("a response over the cap is cancelled, not drained", async () => {
  let cancelled = false;
  let pulls = 0;
  const body = new ReadableStream({
    pull(controller) {
      pulls++;
      controller.enqueue(new TextEncoder().encode("x".repeat(400_000)));
    },
    cancel() {
      cancelled = true;
    },
  });
  const t = setup(() => new Response(body), () => reply(sample("openlibrary", "laskar-pelangi-search")));
  assert.equal((await hitsOf(await t.get(QUERY)))[0].source, "openlibrary");
  assert.equal(cancelled, true);
  assert.ok(pulls <= 4, String(pulls));
});
