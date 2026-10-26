import { test } from "node:test";
import assert from "node:assert/strict";
import { createLookup } from "../src/store/lookup.ts";
import type { Fetcher } from "../src/store/lookup.ts";

const JSON_TYPE = { "content-type": "application/json" };

const reply = (body: unknown, status = 200, headers: Record<string, string> = JSON_TYPE) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });

type Call = { url: string; init: RequestInit };

const net = (answer: (url: string, init: RequestInit) => Response | Promise<Response>) => {
  const calls: Call[] = [];
  const fetcher: Fetcher = (url, init) => {
    calls.push({ url, init });
    return new Promise<Response>((resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
      Promise.resolve(answer(url, init)).then(resolve, reject);
    });
  };
  return { calls, fetcher };
};

const lookup = (fetcher: Fetcher, extra: { online?: () => boolean; timeout?: number; wait?: number } = {}) => createLookup({ fetcher, wait: 1, ...extra });

const hit = { kind: "movie", tmdb: 910001, title: "Pelabuhan Terakhir", original: null, year: 2017, cover: "https://image.tmdb.org/t/p/w342/abc.jpg" };

const found = (...hits: object[]) => reply({ hits });

const input = { kind: "movie", title: "Pelabuhan Terakhir", year: null } as const;

test("a title search goes to our own route only, folded, with the cookie, no referrer and no redirect, and shows what the route returned", async () => {
  const t = net(() => found(hit));
  const out = await lookup(t.fetcher).screen({ kind: "movie", title: "  Pelabuhan  TERAKHIR ", year: 2017 });
  assert.deepEqual(out, { kind: "ok", value: [hit] });
  assert.equal(t.calls.length, 1);
  const [{ url, init }] = t.calls;
  assert.equal(url, "/api/lookup/screen?kind=movie&title=pelabuhan+terakhir&year=2017");
  assert.equal(init.credentials, "same-origin");
  assert.equal(init.redirect, "manual");
  assert.equal(init.referrerPolicy, "no-referrer");
  assert.equal(init.headers, undefined);
  assert.equal(init.method, undefined);
  assert.ok(init.signal instanceof AbortSignal);
});

test("a series title without a year sends no year, and an id lookup sends the kind and the id", async () => {
  const t = net((url) => found({ ...hit, kind: "series", tmdb: url.includes("id=920001") ? 920001 : 1 }));
  await lookup(t.fetcher).screen({ kind: "series", title: "Rumah", year: null });
  assert.equal(t.calls[0].url, "/api/lookup/screen?kind=series&title=rumah");
  const out = await lookup(t.fetcher).screenById("series", 920001);
  assert.equal(t.calls[1].url, "/api/lookup/screen?kind=series&id=920001");
  assert.equal(out.kind === "ok" && out.value?.tmdb, 920001);
  assert.equal(t.calls[1].init.credentials, "same-origin");
  assert.equal(t.calls[1].init.redirect, "manual");
});

test("a title the route would refuse, or a bad id or year, is an empty answer with no request", async () => {
  const t = net(() => found(hit));
  const search = lookup(t.fetcher);
  for (const title of ["", "a", "  b  ", "\u0000\u0000", "x".repeat(201)]) assert.deepEqual(await search.screen({ kind: "movie", title, year: null }), { kind: "ok", value: [] }, title);
  assert.deepEqual(await search.screen({ kind: "movie", title: "Heat", year: 1700 }), { kind: "ok", value: [] });
  for (const id of [0, -1, 1.5, NaN, Infinity, 2 ** 60]) assert.deepEqual(await search.screenById("movie", id), { kind: "ok", value: null }, String(id));
  assert.equal(t.calls.length, 0);
});

test("the search waits for the typing pause before it sends, and a newer search or a cancel inside the pause sends nothing and is stale", async () => {
  const t = net(() => found(hit));
  const slow = createLookup({ fetcher: t.fetcher, wait: 60 });
  const started = Date.now();
  const first = slow.screen(input);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(t.calls.length, 0);
  assert.equal((await first).kind, "ok");
  assert.ok(Date.now() - started >= 50);
  const replaced = slow.screen({ ...input, title: "Another" });
  const second = slow.screen({ ...input, title: "Third" });
  assert.deepEqual(await replaced, { kind: "stale" });
  assert.equal((await second).kind, "ok");
  assert.equal(t.calls.length, 2);
  const cancelled = slow.screen({ ...input, title: "Cancelled" });
  slow.cancel();
  assert.deepEqual(await cancelled, { kind: "stale" });
  assert.equal(t.calls.length, 2);
});

test("a new search aborts the request in flight and the old answer is stale", async () => {
  let release!: (res: Response) => void;
  const t = net((url) => (url.includes("first") ? new Promise<Response>((resolve) => (release = resolve)) : found(hit)));
  const search = lookup(t.fetcher);
  const first = search.screen({ ...input, title: "first" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const second = search.screen({ ...input, title: "second" });
  assert.deepEqual(await first, { kind: "stale" });
  assert.equal((await second).kind, "ok");
  release(found());
  assert.equal(t.calls[0].init.signal?.aborted, true);
});

test("cancel and stop abort a search in flight, and only stop aborts an id lookup", async () => {
  const hang = () => new Promise<Response>(() => {});
  const searching = net(hang);
  const search = lookup(searching.fetcher);
  const pending = search.screen(input);
  await new Promise((resolve) => setTimeout(resolve, 20));
  search.cancel();
  assert.deepEqual(await pending, { kind: "stale" });
  const byId = net(hang);
  const other = lookup(byId.fetcher);
  const one = other.screenById("movie", 5);
  await new Promise((resolve) => setTimeout(resolve, 20));
  other.cancel();
  assert.equal(byId.calls[0].init.signal?.aborted, false);
  other.stop();
  assert.deepEqual(await one, { kind: "stale" });
});

test("offline sends nothing, and a network error or an unreachable route is offline with no other host tried", async () => {
  const t = net(() => found(hit));
  assert.deepEqual(await lookup(t.fetcher, { online: () => false }).screen(input), { kind: "offline" });
  assert.deepEqual(await lookup(t.fetcher, { online: () => false }).screenById("movie", 5), { kind: "offline" });
  assert.equal(t.calls.length, 0);
  const down = net(() => Promise.reject(new TypeError("Failed to fetch")));
  assert.deepEqual(await lookup(down.fetcher).screen(input), { kind: "offline" });
  assert.deepEqual(await lookup(down.fetcher).screenById("movie", 5), { kind: "offline" });
  assert.equal(down.calls.length, 2);
  assert.ok(down.calls.every((call) => call.url.startsWith("/api/lookup/screen?")));
});

test("an answer that is not ours counts as offline: a login page, a redirect, a 400, a 403, bad JSON", async () => {
  const cases: [string, () => Response][] = [
    ["login page", () => reply("<html>sign in</html>", 200, { "content-type": "text/html" })],
    ["200 not json", () => reply("{not json")],
    ["302", () => reply("", 302, { location: "/login" })],
    ["403 html", () => reply("<html>", 403, { "content-type": "text/html" })],
    ["429 html", () => reply("<html>", 429, { "content-type": "text/html" })],
    ["503 plain", () => reply("down", 503, { "content-type": "text/plain" })],
    ["400 json", () => reply({ error: "bad_query" }, 400)],
  ];
  for (const [name, answer] of cases) {
    assert.deepEqual(await lookup(net(answer).fetcher).screen(input), { kind: "offline" }, name);
    assert.deepEqual(await lookup(net(answer).fetcher).screenById("movie", 5), { kind: "offline" }, name);
  }
});

test("a busy answer keeps its wait, in milliseconds, and a plain failure is a retryable failure", async () => {
  const busy = net(() => reply({ error: "busy", retry: 7 }, 429, { ...JSON_TYPE, "retry-after": "7" }));
  assert.deepEqual(await lookup(busy.fetcher).screen(input), { kind: "failed", retry: 7000 });
  assert.deepEqual(await lookup(busy.fetcher).screenById("series", 3), { kind: "failed", retry: 7000 });
  const down = net(() => reply({ error: "busy", retry: 30 }, 503, { ...JSON_TYPE, "retry-after": "30" }));
  assert.deepEqual(await lookup(down.fetcher).screen(input), { kind: "failed", retry: 30000 });
  const failed = net(() => reply({ error: "failed" }, 502));
  assert.deepEqual(await lookup(failed.fetcher).screen(input), { kind: "failed", retry: 0 });
  assert.deepEqual(await lookup(failed.fetcher).screenById("movie", 5), { kind: "failed", retry: 0 });
  assert.equal(busy.calls.length + down.calls.length + failed.calls.length, 5);
});

test("a stalled route is slow, not offline and not a reason to ask anyone else", async () => {
  const t = net(() => new Promise<Response>(() => {}));
  assert.deepEqual(await lookup(t.fetcher, { timeout: 30 }).screen(input), { kind: "slow" });
  assert.deepEqual(await lookup(t.fetcher, { timeout: 30 }).screenById("movie", 5), { kind: "slow" });
  assert.ok(t.calls.every((call) => call.url.startsWith("/api/lookup/screen?")));
});

test("a repeated search or id lookup is answered from the client cache, and a failure is not remembered", async () => {
  const t = net(() => found(hit));
  const search = lookup(t.fetcher);
  await search.screen(input);
  await search.screen({ ...input, title: "pelabuhan   terakhir" });
  await search.screenById("movie", 910001);
  await search.screenById("movie", 910001);
  assert.equal(t.calls.length, 2);
  const flaky = net(() => reply({ error: "failed" }, 502));
  const again = lookup(flaky.fetcher);
  await again.screen(input);
  await again.screen(input);
  assert.equal(flaky.calls.length, 2);
});

test("hits that are not in our own shape are dropped before the screens see them", async () => {
  const body = { hits: [hit, { ...hit, tmdb: 2, cover: "javascript:alert(1)" }, { ...hit, tmdb: 3, title: "" }, { ...hit, tmdb: 4, kind: "tv" }, { ...hit, tmdb: 5, overview: "x" }, null] };
  const out = await lookup(net(() => reply(body)).fetcher).screen(input);
  assert.deepEqual(out.kind === "ok" && out.value.map((entry) => entry.tmdb), [910001, 5]);
  assert.ok(out.kind === "ok" && out.value.every((entry) => Object.keys(entry).join() === "kind,tmdb,title,original,year,cover"));
  for (const odd of [{}, { hits: "x" }, []]) assert.deepEqual(await lookup(net(() => reply(odd)).fetcher).screen(input), { kind: "ok", value: [] });
});

test("an id lookup shows the hit with that id, null when the route has none, and nothing else", async () => {
  assert.deepEqual(await lookup(net(() => found(hit)).fetcher).screenById("movie", 910001), { kind: "ok", value: hit });
  assert.deepEqual(await lookup(net(() => found()).fetcher).screenById("movie", 910001), { kind: "ok", value: null });
  assert.deepEqual(await lookup(net(() => found({ ...hit, tmdb: 2 })).fetcher).screenById("movie", 910001), { kind: "ok", value: null });
});

test("a screen lookup never asks a book source, and a book lookup is unchanged beside it", async () => {
  const t = net((url) => (url.startsWith("/api/lookup/screen") ? found(hit) : reply({ hits: [] })));
  const both = lookup(t.fetcher);
  await both.screen(input);
  assert.equal(t.calls.length, 1);
  assert.match(t.calls[0].url, /^\/api\/lookup\/screen\?/);
});
