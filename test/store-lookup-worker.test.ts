import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseGoogle } from "../src/domain/googlebooks.ts";
import { GAP_MS, findDetails, paced } from "../src/store/details.ts";
import { createLookup, fillBook, fillTitle } from "../src/store/lookup.ts";
import type { Fetcher } from "../src/store/lookup.ts";
import { item } from "./domain-rows.ts";

const sample = (dir: string, name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${dir}/${name}.json`, import.meta.url), "utf8"));

const reply = (body: unknown, status = 200, headers: Record<string, string> = { "content-type": "application/json" }) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });

const wire = (name: string) => ({ hits: parseGoogle(sample("google", name)) });

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
  const own = () => calls.filter((call) => call.url.startsWith("/api/lookup"));
  const direct = () => calls.filter((call) => call.url.startsWith("https://openlibrary.org"));
  return { calls, fetcher, own, direct };
};

const routed = (worker: Response | (() => Response | Promise<Response>), open: () => Response = () => reply(sample("openlibrary", "laskar-pelangi-search"))) =>
  net((url) => (url.startsWith("/api/lookup") ? (typeof worker === "function" ? worker() : worker.clone()) : open()));

const input = (title: string, author = "", original = "") => ({ title, author, original });

const lookup = (fetcher: Fetcher, extra: { online?: () => boolean; timeout?: number } = {}) => createLookup({ fetcher, wait: 1, ...extra });

const bookOf = (title: string, data: Record<string, unknown> = {}) => () => ({ title, data: Object.keys(data).length === 0 ? null : data });

test("a search goes to the Worker route first, with the cookie and no redirect, and shows what Google returned", async () => {
  const t = routed(reply(wire("laskar-pelangi")));
  const out = await lookup(t.fetcher).search(input("Laskar Pelangi", "Andrea Hirata"));
  assert.equal(out.kind, "ok");
  assert.deepEqual(out.kind === "ok" && out.value.map((hit) => hit.source), ["google", "google", "google", "google"]);
  assert.equal(t.calls.length, 1);
  const [{ url, init }] = t.calls;
  assert.equal(url, "/api/lookup?title=Laskar+Pelangi&author=Andrea+Hirata");
  assert.equal(init.credentials, "same-origin");
  assert.equal(init.redirect, "manual");
  assert.equal(init.referrerPolicy, "no-referrer");
  assert.equal(init.headers, undefined);
  assert.equal(init.method, undefined);
  assert.equal(t.direct().length, 0);
});

test("an ISBN lookup goes to the route and picks the volume that has the ISBN, and nothing from another edition", async () => {
  const t = routed(reply(wire("laskar-pelangi")));
  const out = await lookup(t.fetcher).byIsbn("9789793062792");
  assert.equal(t.calls[0].url, "/api/lookup?isbn=9789793062792");
  assert.equal(out.kind === "ok" && out.value?.work, "Lp1AbCdEfGhI");
  const none = await lookup(routed(reply(wire("laskar-pelangi"))).fetcher).byIsbn("9780156012195");
  assert.deepEqual(none, { kind: "ok", value: null });
});

test("an Open Library hit from the route stands in for the ISBN when no hit has it, as before", async () => {
  const body = { hits: [{ source: "openlibrary", work: "OL1W", title: "A", author: "", year: null, cover: null, isbns: [], language: null, blurb: null }] };
  const out = await lookup(routed(reply(body)).fetcher).byIsbn("9789793062792");
  assert.equal(out.kind === "ok" && out.value?.work, "OL1W");
});

test("the second name is tried only when the first finds nothing, each through the route", async () => {
  const t = net((url) => (url.includes("title=Pangeran") ? reply({ hits: [] }) : reply(wire("little-prince"))));
  const out = await lookup(t.fetcher).search(input("Pangeran Kecil", "", "Le Petit Prince"));
  assert.deepEqual(t.calls.map((call) => call.url), ["/api/lookup?title=Pangeran+Kecil&author=", "/api/lookup?title=Le+Petit+Prince&author="]);
  assert.equal(out.kind, "ok");
});

test("when the Worker is unreachable the direct Open Library search answers, with no cookie", async () => {
  const unreachable: [string, () => Response | Promise<Response>][] = [
    ["network error", () => Promise.reject(new TypeError("Failed to fetch"))],
    ["login redirect", () => new Response(null, { status: 302, headers: { location: "https://login.example.test/" } })],
    ["401", () => reply({ error: "unauthorized" }, 401)],
    ["403", () => reply("<html>", 403, { "content-type": "text/html" })],
    ["404 shell", () => reply("<html>", 404, { "content-type": "text/html" })],
    ["500 internal", () => reply({ error: "internal" }, 500)],
    ["400 refused", () => reply({ error: "bad_query" }, 400)],
    ["502 from the edge", () => reply("<html>bad gateway", 502, { "content-type": "text/html" })],
    ["html with 200", () => reply("<html>", 200, { "content-type": "text/html" })],
  ];
  for (const [name, worker] of unreachable) {
    const t = routed(worker);
    const out = await lookup(t.fetcher).search(input("Laskar Pelangi"));
    assert.equal(out.kind, "ok", name);
    assert.equal(out.kind === "ok" && out.value[0].source, "openlibrary", name);
    assert.equal(t.own().length, 1, name);
    assert.equal(t.direct().length, 1, name);
    assert.equal(t.direct()[0].init.credentials, "omit", name);
  }
});

test("the fallback runs the same way for an ISBN", async () => {
  const t = routed(() => Promise.reject(new TypeError("Failed to fetch")), () => reply(sample("openlibrary", "laskar-pelangi-isbn")));
  const out = await lookup(t.fetcher).byIsbn("9789793062792");
  assert.equal(out.kind === "ok" && out.value?.work, "OL15302003W");
  assert.equal(new URL(t.direct()[0].url).searchParams.get("isbn"), "9789793062792");
});

test("offline stays offline and nothing is sent, and a Worker that is down while the device is online but the direct path fails too is offline", async () => {
  const t = routed(reply(wire("laskar-pelangi")));
  assert.deepEqual(await lookup(t.fetcher, { online: () => false }).search(input("Laskar Pelangi")), { kind: "offline" });
  assert.deepEqual(await lookup(t.fetcher, { online: () => false }).byIsbn("9789793062792"), { kind: "offline" });
  assert.equal(t.calls.length, 0);
  const down = net(() => Promise.reject(new TypeError("Failed to fetch")));
  assert.deepEqual(await lookup(down.fetcher).search(input("Laskar Pelangi")), { kind: "offline" });
  assert.equal(down.calls.length, 2);
});

test("a busy answer from the Worker keeps its wait and does not fall back", async () => {
  const t = routed(reply({ error: "busy", retry: 7 }, 429, { "content-type": "application/json", "retry-after": "7" }));
  assert.deepEqual(await lookup(t.fetcher).search(input("Laskar Pelangi")), { kind: "failed", retry: 7000 });
  assert.equal(t.direct().length, 0);
  const again = routed(reply({ error: "busy", retry: 30 }, 503, { "content-type": "application/json", "retry-after": "30" }));
  assert.deepEqual(await lookup(again.fetcher).byIsbn("9789793062792"), { kind: "failed", retry: 30000 });
  assert.equal(again.direct().length, 0);
});

test("a plain failure from the Worker is a failure marked retryable as any 5xx is, and no fallback", async () => {
  const t = routed(reply({ error: "failed" }, 502));
  assert.deepEqual(await lookup(t.fetcher).search(input("Laskar Pelangi")), { kind: "failed", retry: 0 });
  assert.equal(t.direct().length, 0);
});

test("a Worker that stalls is slow, not a reason to ask Open Library", async () => {
  const t = routed(() => new Promise<Response>(() => {}));
  assert.deepEqual(await lookup(t.fetcher, { timeout: 30 }).search(input("Laskar Pelangi")), { kind: "slow" });
  assert.equal(t.direct().length, 0);
});

test("a new search aborts the Worker request in flight and the old answer is stale", async () => {
  let release!: (res: Response) => void;
  const t = net((url) => (url.includes("first") ? new Promise<Response>((resolve) => (release = resolve)) : reply(wire("bumi-manusia"))));
  const search = lookup(t.fetcher);
  const first = search.search(input("first"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  const second = search.search(input("second"));
  assert.deepEqual(await first, { kind: "stale" });
  assert.equal((await second).kind, "ok");
  release(reply(wire("laskar-pelangi")));
  assert.equal(t.calls[0].init.signal?.aborted, true);
});

test("a repeated search is answered from the client cache, and a failure is not remembered", async () => {
  const t = routed(reply(wire("laskar-pelangi")));
  const search = lookup(t.fetcher);
  await search.search(input("Laskar Pelangi"));
  await search.search(input("Laskar Pelangi"));
  assert.equal(t.own().length, 1);
  const flaky = routed(reply({ error: "failed" }, 502));
  const again = lookup(flaky.fetcher);
  await again.search(input("Laskar Pelangi"));
  await again.search(input("Laskar Pelangi"));
  assert.equal(flaky.own().length, 2);
});

test("a Worker body of any other shape is no hit, and bad hits are dropped before the guards run", async () => {
  for (const body of [{}, { hits: "x" }, { hits: [{ source: "google", work: "a/b", title: "T" }] }, []]) {
    assert.deepEqual(await lookup(routed(reply(body)).fetcher).search(input("Laskar Pelangi")), { kind: "ok", value: [] });
  }
});

test("a Worker body that is not JSON counts as an unreachable Worker", async () => {
  const t = routed(reply("{not json"));
  const out = await lookup(t.fetcher).search(input("Laskar Pelangi"));
  assert.equal(out.kind === "ok" && out.value[0].source, "openlibrary");
});

test("several Google editions of one book, same title and author, are one book for a title fill, and it writes gb and no blurb with no Open Library request", async () => {
  const t = routed(reply(wire("laskar-pelangi")));
  const out = await fillTitle(lookup(t.fetcher), bookOf("Laskar Pelangi", { author: "Andrea Hirata" }));
  assert.equal(out.kind, "patch");
  if (out.kind !== "patch") return;
  assert.equal(out.patch.gb, "Lp1AbCdEfGhI");
  assert.equal(out.patch.ol, undefined);
  assert.equal(out.patch.language, "id");
  assert.equal(out.patch.blurb, undefined);
  assert.match(out.patch.cover, /^https:\/\/books\.google\.com\/books\/content\?id=Lp1AbCdEfGhI/);
  assert.equal(out.patch.isbn, undefined);
  assert.equal(t.calls.length, 1);
});

test("a volume by another author does not count against the book, a typed author nobody wrote is unsure, and two editions by the same author are one book", async () => {
  const [first, second] = wire("laskar-pelangi").hits;
  const other = { ...second, work: "Other1AbCdEf", author: "Someone Else", isbns: [] };
  const mixed = await fillTitle(lookup(routed(reply({ hits: [first, other] })).fetcher), bookOf("Laskar Pelangi", { author: "Andrea Hirata" }));
  assert.equal(mixed.kind === "patch" && mixed.patch.gb, "Lp1AbCdEfGhI");
  assert.deepEqual(await fillTitle(lookup(routed(reply(wire("laskar-pelangi"))).fetcher), bookOf("Laskar Pelangi", { author: "Partner A" })), { kind: "unsure" });
  assert.equal((await fillTitle(lookup(routed(reply({ hits: [first, { ...second, work: "Other1AbCdEf" }] })).fetcher), bookOf("Laskar Pelangi", { author: "Andrea Hirata" }))).kind, "patch");
});

test("a translated title with the original in parentheses fills from its volume, the author spelled without accents", async () => {
  const t = routed(reply(wire("little-prince")));
  const out = await fillTitle(lookup(t.fetcher), bookOf("Pangeran Kecil", { author: "Antoine de Saint-Exupery" }));
  assert.equal(out.kind, "patch");
  assert.equal(out.kind === "patch" && out.patch.gb, "Pk1AbCdEfGhI");
});

test("a title and an original title that match two different Google titles are unsure, not guessed", async () => {
  const t = routed(reply(wire("little-prince")));
  assert.deepEqual(await fillTitle(lookup(t.fetcher), bookOf("Pangeran Kecil", { author: "Antoine de Saint-Exupery", original_title: "Le Petit Prince" })), { kind: "unsure" });
});

test("an ISBN fill from a Google volume writes gb, cover and the volume's own language, and refuses a volume of another title", async () => {
  const t = routed(reply(wire("laskar-pelangi")));
  const out = await fillBook(lookup(t.fetcher), "9789793062792", bookOf("Laskar Pelangi", { isbn: "9789793062792" }));
  assert.equal(out.kind, "patch");
  assert.equal(out.kind === "patch" && out.patch.gb, "Lp1AbCdEfGhI");
  assert.deepEqual(await fillBook(lookup(routed(reply(wire("laskar-pelangi"))).fetcher), "9789793062792", bookOf("Bumi Manusia", { isbn: "9789793062792" })), { kind: "mismatch" });
  assert.deepEqual(await fillBook(lookup(routed(reply({ hits: [] })).fetcher), "9789793062792", bookOf("Laskar Pelangi")), { kind: "empty" });
});

test("an Open Library hit through the route still asks Open Library for its description, directly", async () => {
  const body = { hits: [{ source: "openlibrary", work: "OL15302003W", title: "Laskar Pelangi", author: "Andrea Hirata", year: 2005, cover: null, isbns: [], language: "id", blurb: null }] };
  const t = net((url) => (url.startsWith("/api/lookup") ? reply(body) : reply({ description: "From the work." })));
  const out = await fillTitle(lookup(t.fetcher), bookOf("Laskar Pelangi", { author: "Andrea Hirata" }));
  assert.equal(out.kind === "patch" && out.patch.blurb, "From the work.");
  assert.equal(out.kind === "patch" && out.patch.ol, "OL15302003W");
  assert.equal(t.direct().length, 1);
  assert.equal(t.direct()[0].init.credentials, "omit");
});

test("the Find pass backs off on a busy Worker, reads the wait, and then fills from Google", async () => {
  const state = { now: 0, waits: [] as number[], busy: 1 };
  const wait = async (ms: number) => void ((state.now += ms), state.waits.push(ms));
  const inner = net((url) => (url.startsWith("/api/lookup") ? (state.busy-- > 0 ? reply({ error: "busy", retry: 30 }, 429, { "content-type": "application/json", "retry-after": "30" }) : reply(wire("laskar-pelangi"))) : reply({})));
  const search = createLookup({ fetcher: paced(inner.fetcher, GAP_MS, () => state.now, wait), wait: 0 });
  const row = item({ kind: "book", status: "wish", title: "Laskar Pelangi", data: { author: "Andrea Hirata", import_batch: "b" } });
  const pauses: number[] = [];
  const saved: Record<string, string>[] = [];
  const finish = await findDetails({
    ids: [row.id],
    lookup: search,
    read: () => row,
    save: async (id, patch) => (saved.push(patch), { ok: true, id }),
    signal: new AbortController().signal,
    onStep: () => {},
    wait: async (ms) => void pauses.push(ms),
  });
  assert.equal(finish, "finished");
  assert.deepEqual(pauses, [30000]);
  assert.equal(saved[0]?.gb, "Lp1AbCdEfGhI");
  assert.equal(inner.own().length, 2);
});

test("a Google blurb that reaches the browser anyway is never written, by a title fill or a fill by ISBN, and no Open Library request is made for it", async () => {
  const hits = wire("laskar-pelangi").hits.map((hit) => ({ ...hit, blurb: "Google's own synopsis." }));
  const title = routed(reply({ hits }));
  const byTitle = await fillTitle(lookup(title.fetcher), bookOf("Laskar Pelangi", { author: "Andrea Hirata" }));
  assert.equal(byTitle.kind === "patch" && byTitle.patch.blurb, undefined);
  assert.equal(title.calls.length, 1);
  const code = routed(reply({ hits }));
  const byIsbn = await fillBook(lookup(code.fetcher), "9789793062792", bookOf("Laskar Pelangi"));
  assert.equal(byIsbn.kind === "patch" && byIsbn.patch.blurb, undefined);
  assert.equal(byIsbn.kind === "patch" && byIsbn.patch.gb, "Lp1AbCdEfGhI");
  assert.equal(code.calls.length, 1);
});
