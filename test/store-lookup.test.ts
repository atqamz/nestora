import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createLookup, fillBook, follow, searchOf } from "../src/store/lookup.ts";
import type { Fetcher, Search } from "../src/store/lookup.ts";

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

test("the original title is not searched when the title already found something or already failed", async () => {
  const found = server(() => reply(sample("laskar-pelangi-search")));
  const out = await createLookup({ fetcher: found.fetcher, wait: 1 }).search(input("Laskar Pelangi", "", "Le Petit Prince"));
  assert.equal(out.kind, "ok");
  assert.equal(found.calls.length, 1);
  const down = server(() => reply({}, 500));
  assert.deepEqual(await createLookup({ fetcher: down.fetcher, wait: 1 }).search(input("Laskar Pelangi", "", "Le Petit Prince")), { kind: "failed" });
  assert.equal(down.calls.length, 1);
});

test("by default a search waits 400 ms for a pause in typing and gives up on a silent server after 8 s", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { calls, fetcher } = server(() => new Promise<Response>(() => {}));
    const search = createLookup({ fetcher }).search(input("laskar"));
    let outcome: unknown = null;
    void search.then((out) => (outcome = out));
    const flush = () => new Promise((resolve) => setImmediate(resolve));
    mock.timers.tick(399);
    await flush();
    assert.equal(calls.length, 0);
    mock.timers.tick(1);
    await flush();
    assert.equal(calls.length, 1);
    mock.timers.tick(7999);
    await flush();
    assert.equal(outcome, null);
    mock.timers.tick(1);
    await flush();
    assert.deepEqual(outcome, { kind: "slow" });
  } finally {
    mock.timers.reset();
  }
});

test("by default the memory holds 50 answers and forgets the oldest first", async () => {
  const { calls, fetcher } = server(() => reply(sample("laskar-pelangi-search")));
  const lookup = createLookup({ fetcher, wait: 1 });
  for (let n = 0; n <= 50; n++) await lookup.search(input(`title ${n}`));
  assert.equal(calls.length, 51);
  await lookup.search(input("title 50"));
  await lookup.search(input("title 1"));
  assert.equal(calls.length, 51);
  await lookup.search(input("title 0"));
  assert.equal(calls.length, 52);
});

test("by default the lookup is online unless the browser says it is offline", async () => {
  const { calls, fetcher } = server(() => reply(sample("laskar-pelangi-search")));
  const lookup = createLookup({ fetcher, wait: 1 });
  const set = (value: boolean | undefined) => Object.defineProperty(navigator, "onLine", { value, configurable: true });
  try {
    set(false);
    assert.deepEqual(await lookup.search(input("one")), { kind: "offline" });
    assert.equal(calls.length, 0);
    set(true);
    assert.equal((await lookup.search(input("two"))).kind, "ok");
    set(undefined);
    assert.equal((await lookup.search(input("three"))).kind, "ok");
    assert.equal(calls.length, 2);
  } finally {
    Reflect.deleteProperty(navigator, "onLine");
  }
});

test("cancel stops a search but leaves a lookup by ISBN or of a description alone", async () => {
  for (const start of [(lookup: ReturnType<typeof createLookup>) => lookup.byIsbn("9789793062792"), (lookup: ReturnType<typeof createLookup>) => lookup.blurb("OL15302003W")]) {
    const hold = deferred<Response>();
    const { calls, fetcher } = server(() => hold.promise);
    const lookup = createLookup({ fetcher, wait: 1 });
    const pending = start(lookup);
    await tick(5);
    lookup.cancel();
    assert.equal(calls[0].init.signal?.aborted, false);
    hold.resolve(reply({ docs: [], description: "About." }));
    assert.equal((await pending).kind, "ok");
  }
});

test("a search outcome becomes a state; a stale one is idle, not busy", () => {
  const [hit] = [{ work: "OL1W", title: "A", author: "", year: null, coverId: null, isbn: null, language: null }];
  assert.deepEqual(searchOf({ kind: "ok", value: [hit] }), { state: "found", hits: [hit] });
  assert.deepEqual(searchOf({ kind: "ok", value: [] }), { state: "empty", hits: [] });
  for (const kind of ["offline", "failed", "slow"] as const) assert.deepEqual(searchOf({ kind }), { state: kind, hits: [] });
  assert.deepEqual(searchOf({ kind: "stale" }), { state: "idle", hits: [] });
});

const watched = (fetch: Fetcher) => {
  const lookup = createLookup({ fetcher: fetch, wait: 30 });
  const states: Search["state"][] = [];
  const set = (next: Search) => states.push(next.state);
  return { lookup, states, set };
};

test("clearing the title or switching the kind inside the pause sends no request", async () => {
  const { calls, fetcher } = server(() => reply(sample("bumi-manusia-search")));
  const { lookup, states, set } = watched(fetcher);
  const stop = follow(lookup, true, input("Secret Plan"), set);
  stop();
  follow(lookup, false, input(""), set)();
  await tick(80);
  assert.equal(calls.length, 0);
  assert.deepEqual(states, ["busy", "idle"]);
});

test("a search whose sheet closed sends nothing, aborts what it sent, and never sets state after", async () => {
  const { calls, fetcher } = server(() => new Promise<Response>(() => {}));
  const { lookup, states, set } = watched(fetcher);
  const stop = follow(lookup, true, input("Secret Plan"), set);
  await tick(60);
  assert.equal(calls.length, 1);
  stop();
  assert.equal(calls[0].init.signal?.aborted, true);
  await tick(20);
  assert.deepEqual(states, ["busy"]);
});

test("a search that another lookup took over ends idle instead of staying busy", async () => {
  const { calls, fetcher } = server((url) => reply(url.includes("isbn=") ? sample("laskar-pelangi-isbn") : sample("bumi-manusia-search")));
  const { lookup, states, set } = watched(fetcher);
  follow(lookup, true, input("Secret Plan"), set);
  assert.equal((await lookup.byIsbn("9789793062792")).kind, "ok");
  await tick(60);
  assert.deepEqual(states, ["busy", "idle"]);
  assert.equal(calls.length, 1);
});

test("a search that a newer search took over hands its state to the newer one", async () => {
  const { calls, fetcher } = server(() => reply(sample("bumi-manusia-search")));
  const { lookup, states, set } = watched(fetcher);
  const stop = follow(lookup, true, input("bumi"), set);
  stop();
  follow(lookup, true, input("bumi manusia"), set);
  await tick(80);
  assert.deepEqual(states, ["busy", "busy", "found"]);
  assert.equal(calls.length, 1);
});

test("a search that finishes sets found, and a description lookup started by a result survives the search going quiet", async () => {
  const { fetcher } = server((url) => reply(url.includes("/works/") ? { description: "About." } : sample("bumi-manusia-search")));
  const { lookup, states, set } = watched(fetcher);
  const stop = follow(lookup, true, input("bumi"), set);
  await tick(80);
  assert.deepEqual(states, ["busy", "found"]);
  const blurb = lookup.blurb("OL307247W");
  stop();
  assert.deepEqual(await blurb, { kind: "ok", value: "About." });
});

const bookOf = (title: string, data: Record<string, unknown> | null = null) => ({ title, data });

test("filling from an ISBN is a patch for the book it belongs to", async () => {
  const { calls, fetcher } = server((url) => reply(url.includes("/works/") ? sample("laskar-pelangi-work") : sample("laskar-pelangi-isbn")));
  const out = await fillBook(createLookup({ fetcher }), "9789793062792", () => bookOf("Laskar Pelangi"));
  assert.equal(out.kind, "patch");
  const patch = out.kind === "patch" ? out.patch : {};
  assert.deepEqual(Object.keys(patch).sort(), ["author", "blurb", "cover", "language", "ol"]);
  assert.equal(patch.ol, "OL15302003W");
  assert.equal(calls.length, 2);
});

test("filling a book that is not the work of the ISBN says so and asks for nothing more", async () => {
  const { calls, fetcher } = server(() => reply(sample("laskar-pelangi-isbn")));
  assert.deepEqual(await fillBook(createLookup({ fetcher }), "9789793062792", () => bookOf("Pangeran Kecil")), { kind: "mismatch" });
  assert.equal(calls.length, 1);
});

test("the patch is made from the book as it is when the answer arrives", async () => {
  const { fetcher } = server((url) => reply(url.includes("/works/") ? sample("laskar-pelangi-work") : sample("laskar-pelangi-isbn")));
  let book = bookOf("Laskar Pelangi");
  const lookup = createLookup({ fetcher });
  const filling = fillBook(lookup, "9789793062792", () => book);
  book = bookOf("Laskar Pelangi", { author: "Partner A", blurb: "Mine" });
  const out = await filling;
  assert.deepEqual(out.kind === "patch" && Object.keys(out.patch).sort(), ["cover", "language", "ol"]);
});

test("a book that has it all gets nothing new, and an empty ISBN answer is empty", async () => {
  const full = bookOf("Laskar Pelangi", { author: "A", language: "id", cover: "https://covers.openlibrary.org/b/id/1-M.jpg", ol: "OL1W", blurb: "Mine" });
  const { fetcher } = server(() => reply(sample("laskar-pelangi-isbn")));
  assert.deepEqual(await fillBook(createLookup({ fetcher }), "9789793062792", () => full), { kind: "nothing" });
  assert.deepEqual(await fillBook(createLookup({ fetcher: server(() => reply({ docs: [] })).fetcher }), "9780156012195", () => full), { kind: "empty" });
});

test("a failed, slow, offline or superseded lookup is reported as it is, so the button can come back", async () => {
  const book = () => bookOf("Laskar Pelangi");
  assert.deepEqual(await fillBook(createLookup({ fetcher: server(() => reply({}, 500)).fetcher }), "9789793062792", book), { kind: "failed" });
  assert.deepEqual(await fillBook(createLookup({ fetcher: server(() => reply({})).fetcher, online: () => false }), "9789793062792", book), { kind: "offline" });
  const hold = server(() => new Promise<Response>(() => {}));
  const lookup = createLookup({ fetcher: hold.fetcher, wait: 1 });
  const filling = fillBook(lookup, "9789793062792", book);
  await tick(5);
  void lookup.search(input("another"));
  assert.deepEqual(await filling, { kind: "stale" });
});

test("a description lookup superseded while filling is stale, and a failed one still fills the rest", async () => {
  let works = 0;
  const { fetcher } = server((url) => (url.includes("/works/") ? (works++, new Promise<Response>(() => {})) : reply(sample("laskar-pelangi-isbn"))));
  const lookup = createLookup({ fetcher });
  const filling = fillBook(lookup, "9789793062792", () => bookOf("Laskar Pelangi"));
  await tick(10);
  assert.equal(works, 1);
  void lookup.byIsbn("9780156012195");
  assert.deepEqual(await filling, { kind: "stale" });
  const failing = server((url) => (url.includes("/works/") ? reply({}, 500) : reply(sample("laskar-pelangi-isbn"))));
  const out = await fillBook(createLookup({ fetcher: failing.fetcher }), "9789793062792", () => bookOf("Laskar Pelangi"));
  assert.deepEqual(out.kind === "patch" && Object.keys(out.patch).sort(), ["author", "cover", "language", "ol"]);
});
