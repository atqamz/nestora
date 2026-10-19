import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLookup } from "../src/store/lookup.ts";
import type { Fetcher } from "../src/store/lookup.ts";

const sample = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/openlibrary/${name}.json`, import.meta.url), "utf8"));

const reply = (body: unknown, status = 200) => new Response(status === 204 ? null : typeof body === "string" ? body : JSON.stringify(body), { status });

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
};

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

type Call = { url: string; init: RequestInit };

const server = (answer: (url: string, init: RequestInit, calls: Call[]) => Promise<Response> | Response) => {
  const calls: Call[] = [];
  const fetcher: Fetcher = (url, init) => {
    calls.push({ url, init });
    const aborted = new Promise<never>((_, reject) => {
      const stop = () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      if (init.signal?.aborted) stop();
      init.signal?.addEventListener("abort", stop, { once: true });
    });
    return Promise.race([Promise.resolve(answer(url, init, calls)), aborted]);
  };
  return { calls, fetcher };
};

const input = (title: string, author = "", original = "") => ({ title, author, original });

test("a search is one request with the query, no credentials and no referrer, and nothing else", async () => {
  const { calls, fetcher } = server(() => reply(sample("laskar-pelangi-search")));
  const lookup = createLookup({ fetcher, wait: 1 });
  const out = await lookup.search(input("Laskar Pelangi"));
  assert.equal(out.kind, "ok");
  assert.equal(out.kind === "ok" && out.value[0].title, "Laskar Pelangi");
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(new URL(url).origin, "https://openlibrary.org");
  assert.equal(new URL(url).searchParams.get("q"), "Laskar Pelangi");
  assert.equal(init.credentials, "omit");
  assert.equal(init.referrerPolicy, "no-referrer");
  assert.equal(init.headers, undefined);
  assert.equal(init.method, undefined);
});

test("the default debounce is a pause in typing of a few hundred milliseconds", async () => {
  const { calls, fetcher } = server(() => reply(sample("bumi-manusia-search")));
  const search = createLookup({ fetcher }).search(input("bumi"));
  await tick(150);
  assert.equal(calls.length, 0);
  assert.equal((await search).kind, "ok");
  assert.equal(calls.length, 1);
});

test("typing is debounced: only the last of several quick searches reaches the network, and the others are stale", async () => {
  const { calls, fetcher } = server(() => reply(sample("bumi-manusia-search")));
  const lookup = createLookup({ fetcher, wait: 30 });
  const outs = [lookup.search(input("bum")), lookup.search(input("bumi")), lookup.search(input("bumi manusia"))];
  assert.deepEqual((await Promise.all(outs)).map((out) => out.kind), ["stale", "stale", "ok"]);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).searchParams.get("q"), "bumi manusia");
});

test("a new search aborts the request in flight and its late answer is stale", async () => {
  const slow = deferred<Response>();
  const { calls, fetcher } = server((url) => (url.includes("q=first") ? slow.promise : reply(sample("bumi-manusia-search"))));
  const lookup = createLookup({ fetcher, wait: 1 });
  const first = lookup.search(input("first"));
  await tick(20);
  assert.equal(calls.length, 1);
  const second = lookup.search(input("second"));
  assert.equal(calls[0].init.signal?.aborted, true);
  assert.equal((await first).kind, "stale");
  assert.equal((await second).kind, "ok");
  slow.resolve(reply(sample("laskar-pelangi-search")));
});

test("an answer that arrives after a newer search began is stale even when the fetch itself ignored the abort", async () => {
  const release = deferred<void>();
  const calls: string[] = [];
  const fetcher: Fetcher = async (url) => {
    calls.push(url);
    if (calls.length === 1) await release.promise;
    return reply(sample("bumi-manusia-search"));
  };
  const lookup = createLookup({ fetcher, wait: 1 });
  const first = lookup.search(input("first"));
  await tick(20);
  const second = lookup.search(input("second"));
  release.resolve();
  assert.equal((await first).kind, "stale");
  assert.equal((await second).kind, "ok");
});

test("one lookup at a time: starting a lookup by ISBN or a description aborts the search before it", async () => {
  const hold = deferred<Response>();
  const { calls, fetcher } = server((url) => (url.includes("/works/") ? reply({ description: "About." }) : hold.promise));
  const lookup = createLookup({ fetcher, wait: 1 });
  const search = lookup.search(input("laskar"));
  await tick(20);
  const blurb = await lookup.blurb("OL15302003W");
  assert.equal(calls[0].init.signal?.aborted, true);
  assert.equal((await search).kind, "stale");
  assert.deepEqual(blurb, { kind: "ok", value: "About." });
  hold.resolve(reply({}));
});

test("cancel aborts what is in flight", async () => {
  const { calls, fetcher } = server(() => new Promise<Response>(() => {}));
  const lookup = createLookup({ fetcher, wait: 1 });
  const search = lookup.search(input("laskar"));
  await tick(20);
  lookup.cancel();
  assert.equal(calls[0].init.signal?.aborted, true);
  assert.equal((await search).kind, "stale");
});

test("a search superseded during its pause answers at once instead of after the pause", async () => {
  const { calls, fetcher } = server(() => reply(sample("bumi-manusia-search")));
  const lookup = createLookup({ fetcher, wait: 400 });
  const first = lookup.search(input("bumi"));
  const started = Date.now();
  const second = lookup.search(input("bumi manusia"));
  assert.equal((await first).kind, "stale");
  assert.ok(Date.now() - started < 200);
  assert.equal((await second).kind, "ok");
  assert.equal(calls.length, 1);
});

test("a lookup by ISBN aborts the search in flight", async () => {
  const { calls, fetcher } = server((url) => (url.includes("isbn=") ? reply(sample("laskar-pelangi-isbn")) : new Promise<Response>(() => {})));
  const lookup = createLookup({ fetcher, wait: 1 });
  const search = lookup.search(input("laskar"));
  await tick(20);
  assert.equal((await lookup.byIsbn("9789793062792")).kind, "ok");
  assert.equal(calls[0].init.signal?.aborted, true);
  assert.equal((await search).kind, "stale");
});

test("cancel during the debounce stops the request before it is made", async () => {
  const { calls, fetcher } = server(() => reply(sample("bumi-manusia-search")));
  const lookup = createLookup({ fetcher, wait: 30 });
  const search = lookup.search(input("laskar"));
  lookup.cancel();
  assert.equal((await search).kind, "stale");
  await tick(50);
  assert.equal(calls.length, 0);
});

test("an answer is remembered for the session, so the same search is not asked twice and answers at once", async () => {
  const { calls, fetcher } = server(() => reply(sample("laskar-pelangi-search")));
  const lookup = createLookup({ fetcher, wait: 1 });
  const first = await lookup.search(input("Laskar Pelangi"));
  const again = await lookup.search(input("Laskar Pelangi"));
  assert.deepEqual(again, first);
  assert.equal(calls.length, 1);
  await lookup.search(input("Laskar Pelangi", "Andrea Hirata"));
  assert.equal(calls.length, 2);
});

test("by default the memory holds many answers, not just the last", async () => {
  const { calls, fetcher } = server(() => reply(sample("laskar-pelangi-search")));
  const lookup = createLookup({ fetcher, wait: 1 });
  for (const title of ["one", "two", "three", "four"]) await lookup.search(input(title));
  for (const title of ["one", "two", "three", "four"]) await lookup.search(input(title));
  assert.equal(calls.length, 4);
});

test("a failure is not remembered: asking again asks again", async () => {
  let up = false;
  const { calls, fetcher } = server(() => (up ? reply(sample("laskar-pelangi-search")) : reply({}, 500)));
  const lookup = createLookup({ fetcher, wait: 1 });
  assert.equal((await lookup.search(input("laskar"))).kind, "failed");
  up = true;
  assert.equal((await lookup.search(input("laskar"))).kind, "ok");
  assert.equal(calls.length, 2);
});

test("the memory holds a bounded number of answers and forgets the oldest first", async () => {
  const { calls, fetcher } = server(() => reply(sample("laskar-pelangi-search")));
  const lookup = createLookup({ fetcher, wait: 1, remember: 2 });
  for (const title of ["one", "two", "three"]) await lookup.search(input(title));
  assert.equal(calls.length, 3);
  await lookup.search(input("three"));
  await lookup.search(input("two"));
  assert.equal(calls.length, 3);
  await lookup.search(input("one"));
  assert.equal(calls.length, 4);
});

test("when the title finds nothing the original title is searched with the same author, and its hits are returned", async () => {
  const { calls, fetcher } = server((url) => (url.includes("q=Pangeran") ? reply({ docs: [] }) : reply(sample("little-prince-search"))));
  const lookup = createLookup({ fetcher, wait: 1 });
  const out = await lookup.search(input("Pangeran Kecil", "Antoine", "Le Petit Prince"));
  assert.equal(out.kind === "ok" && out.value[0].work, "OL10263W");
  assert.deepEqual(calls.map((call) => new URL(call.url).searchParams.get("q")), ["Pangeran Kecil Antoine", "Le Petit Prince Antoine"]);
});

test("the original title is not searched when the title already found something, or when there is none", async () => {
  const found = server(() => reply(sample("little-prince-search")));
  await createLookup({ fetcher: found.fetcher, wait: 1 }).search(input("Le Petit Prince", "", "Le Petit Prince"));
  assert.equal(found.calls.length, 1);
  const none = server(() => reply({ docs: [] }));
  const out = await createLookup({ fetcher: none.fetcher, wait: 1 }).search(input("zzzz"));
  assert.deepEqual(out, { kind: "ok", value: [] });
  assert.equal(none.calls.length, 1);
});

test("a search with nothing to ask makes no request and finds nothing", async () => {
  const { calls, fetcher } = server(() => reply({}));
  assert.deepEqual(await createLookup({ fetcher, wait: 1 }).search(input("", "Antoine", "")), { kind: "ok", value: [] });
  assert.equal(calls.length, 0);
});

test("a lookup by ISBN is one search by that ISBN and returns the best hit", async () => {
  const { calls, fetcher } = server(() => reply(sample("laskar-pelangi-isbn")));
  const lookup = createLookup({ fetcher });
  const out = await lookup.byIsbn("9789793062792");
  assert.equal(out.kind === "ok" && out.value?.work, "OL15302003W");
  assert.equal(new URL(calls[0].url).searchParams.get("isbn"), "9789793062792");
  assert.equal(calls.length, 1);
  assert.deepEqual(await lookup.byIsbn("9789793062792"), out);
  assert.equal(calls.length, 1);
  assert.deepEqual(await createLookup({ fetcher: server(() => reply({ docs: [] })).fetcher }).byIsbn("9780156012195"), { kind: "ok", value: null });
});

test("a lookup by ISBN takes the hit that carries the ISBN even when it is not the first", async () => {
  const body = { docs: [{ key: "/works/OL1W", title: "A" }, { key: "/works/OL2W", title: "B", editions: { docs: [{ isbn: ["9789793062792"] }] } }] };
  const out = await createLookup({ fetcher: server(() => reply(body)).fetcher }).byIsbn("9789793062792");
  assert.equal(out.kind === "ok" && out.value?.work, "OL2W");
});

test("a description is fetched from the work and cut to its first paragraph", async () => {
  const { calls, fetcher } = server(() => reply(sample("little-prince-work")));
  const out = await createLookup({ fetcher }).blurb("OL10263W");
  assert.equal(calls[0].url, "https://openlibrary.org/works/OL10263W.json");
  assert.match(out.kind === "ok" ? (out.value ?? "") : "", /^\*Le Petit Prince\* est une œuvre/);
});

test("offline: no request is made, and the lookup says so", async () => {
  const { calls, fetcher } = server(() => reply({}));
  const lookup = createLookup({ fetcher, wait: 1, online: () => false });
  assert.deepEqual(await lookup.search(input("laskar")), { kind: "offline" });
  assert.deepEqual(await lookup.byIsbn("9789793062792"), { kind: "offline" });
  assert.deepEqual(await lookup.blurb("OL1W"), { kind: "offline" });
  assert.equal(calls.length, 0);
});

test("a remembered answer is still shown offline", async () => {
  let online = true;
  const { fetcher } = server(() => reply(sample("laskar-pelangi-search")));
  const lookup = createLookup({ fetcher, wait: 1, online: () => online });
  await lookup.search(input("laskar"));
  online = false;
  assert.equal((await lookup.search(input("laskar"))).kind, "ok");
});

test("a request that cannot connect is offline", async () => {
  const lookup = createLookup({ fetcher: () => Promise.reject(new TypeError("Failed to fetch")), wait: 1 });
  assert.deepEqual(await lookup.search(input("laskar")), { kind: "offline" });
});

test("every status but 200 is a failure, and so is a body that is not JSON", async () => {
  for (const status of [204, 301, 400, 403, 404, 429, 500, 503]) {
    const lookup = createLookup({ fetcher: server(() => reply({}, status)).fetcher, wait: 1 });
    assert.deepEqual(await lookup.search(input("laskar")), { kind: "failed" }, String(status));
  }
  const lookup = createLookup({ fetcher: server(() => reply("<html>")).fetcher, wait: 1 });
  assert.deepEqual(await lookup.search(input("laskar")), { kind: "failed" });
  assert.deepEqual(await lookup.blurb("OL1W"), { kind: "failed" });
});

test("a very slow answer is cut off at the timeout and reported as slow, and the request is aborted", async () => {
  const { calls, fetcher } = server(() => new Promise<Response>(() => {}));
  const lookup = createLookup({ fetcher, wait: 1, timeout: 30 });
  const started = Date.now();
  assert.deepEqual(await lookup.search(input("laskar")), { kind: "slow" });
  assert.ok(Date.now() - started >= 25);
  assert.equal(calls[0].init.signal?.aborted, true);
});

test("a body that stalls after the headers also times out", async () => {
  const stalled: Fetcher = (_, init) =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          start(controller) {
            init.signal?.addEventListener("abort", () => controller.error(new Error("aborted")), { once: true });
          },
        }),
        { status: 200 },
      ),
    );
  assert.deepEqual(await createLookup({ fetcher: stalled, wait: 1, timeout: 30 }).search(input("laskar")), { kind: "slow" });
});

test("after a timeout the next search works", async () => {
  let slow = true;
  const { fetcher } = server(() => (slow ? new Promise<Response>(() => {}) : reply(sample("laskar-pelangi-search"))));
  const lookup = createLookup({ fetcher, wait: 1, timeout: 20 });
  assert.equal((await lookup.search(input("laskar"))).kind, "slow");
  slow = false;
  assert.equal((await lookup.search(input("laskar"))).kind, "ok");
});

test("a fast answer does not leave a timer that aborts later requests", async () => {
  const { calls, fetcher } = server(() => reply(sample("laskar-pelangi-search")));
  const lookup = createLookup({ fetcher, wait: 1, timeout: 30 });
  await lookup.search(input("laskar"));
  await tick(60);
  assert.equal(calls[0].init.signal?.aborted, false);
});
