import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ItemRow } from "../shared/tables.ts";
import { GAP_MS, findDetails, needsDetails, paced, pending } from "../src/store/details.ts";
import type { Tally } from "../src/store/details.ts";
import { createLookup } from "../src/store/lookup.ts";
import type { Fetcher, Lookup } from "../src/store/lookup.ts";
import { text } from "../src/ui/text.ts";
import { item } from "./domain-rows.ts";

const sample = (name: string) => readFileSync(new URL(`./fixtures/openlibrary/${name}.json`, import.meta.url), "utf8");

const SEARCHES: [RegExp, string][] = [
  [/laskar/i, "laskar-pelangi-search"],
  [/bumi/i, "bumi-manusia-search"],
  [/prince|petit/i, "little-prince-search"],
];

const WORKS: Record<string, string> = { OL15302003W: "laskar-pelangi-work", OL10263W: "little-prince-work" };

const INVENTED: Record<string, string> = { OL307247W: JSON.stringify({ description: "Invented synopsis." }) };

const clock = () => {
  const state = { now: 0, waits: [] as number[], starts: [] as number[], ends: [] as number[], open: 0, peak: 0, calls: [] as string[] };
  const wait = async (ms: number) => {
    state.waits.push(ms);
    state.now += ms;
  };
  return { state, now: () => state.now, wait };
};

type Answer = (url: URL, call: number, signal?: AbortSignal | null) => Response | Promise<Response> | undefined;

const openLibrary = (state: ReturnType<typeof clock>["state"], broken: RegExp | null = null, answer?: Answer): Fetcher => async (input, init) => {
  const url = new URL(input);
  state.calls.push(`${url.pathname}${url.search}`);
  state.starts.push(state.now);
  state.peak = Math.max(state.peak, ++state.open);
  await Promise.resolve();
  state.now += 40;
  state.open--;
  state.ends.push(state.now);
  const query = url.searchParams.get("q") ?? url.searchParams.get("isbn") ?? "";
  const given = answer?.(url, state.calls.length, init?.signal);
  if (given) return given;
  if (broken?.test(query)) return new Response("nope", { status: 500 });
  if (url.searchParams.has("isbn")) return new Response(sample("laskar-pelangi-isbn"));
  if (url.pathname === "/search.json") {
    const found = SEARCHES.find(([pattern]) => pattern.test(query));
    return new Response(found ? sample(found[1]) : JSON.stringify({ docs: [] }));
  }
  const key = url.pathname.replace(/^\/works\/|\.json$/g, "");
  return WORKS[key] ? new Response(sample(WORKS[key])) : INVENTED[key] ? new Response(INVENTED[key]) : new Response("{}", { status: 404 });
};

const book = (title: string, data: Record<string, unknown> = {}) => item({ kind: "book", status: "wish", title, data: { import_batch: "b", ...data } });

const rig = (books: ItemRow[], options: { broken?: RegExp; online?: boolean; answer?: Answer; timeout?: number; pause?: (ms: number, signal: AbortSignal) => Promise<void> } = {}) => {
  const { state, now, wait } = clock();
  const lookup = createLookup({ worker: false, fetcher: paced(openLibrary(state, options.broken ?? null, options.answer), GAP_MS, now, wait), wait: 0, online: () => options.online ?? true, timeout: options.timeout });
  const backoffs: number[] = [];
  const pause = async (ms: number) => void backoffs.push(ms);
  const rows = new Map(books.map((row) => [row.id, row]));
  const saved: [string, Record<string, string>][] = [];
  const steps: [string, Tally][] = [];
  const controller = new AbortController();
  const run = (ids = books.map((row) => row.id), save?: (id: string, patch: Record<string, string>) => Promise<{ ok: true; id: string } | { ok: false; errors: string[] }>) =>
    findDetails({
      ids,
      lookup,
      read: (id) => rows.get(id),
      save:
        save ??
        (async (id, patch) => {
          saved.push([id, patch]);
          const row = rows.get(id)!;
          rows.set(id, { ...row, data: { ...row.data, ...patch } });
          return { ok: true, id };
        }),
      signal: controller.signal,
      onStep: (id, tally) => steps.push([id, tally]),
      wait: options.pause ?? pause,
    });
  return { state, saved, steps, controller, rows, run, lookup, backoffs };
};

test("requests are paced to at least a second between the end of one and the start of the next, and the first goes at once", async () => {
  const { state, now, wait } = clock();
  const fetcher = paced(openLibrary(state), GAP_MS, now, wait);
  for (let at = 0; at < 4; at++) await fetcher("https://openlibrary.org/search.json?q=a", {});
  assert.equal(state.waits.length, 3);
  for (let at = 1; at < 4; at++) assert.ok(state.starts[at] - state.ends[at - 1] >= GAP_MS, `${state.starts[at] - state.ends[at - 1]}`);
  assert.equal(state.starts[0], 0);
  assert.equal(GAP_MS >= 1000, true);
});

test("a failed request still counts for the pause, and an abort during the pause does not wait it out", async () => {
  const state = { now: 0, waited: 0 };
  const fetcher = paced(async () => Promise.reject(new Error("down")), 1000, () => state.now, async (ms) => void (state.waited += ms));
  await assert.rejects(() => fetcher("x", {}));
  state.now = 300;
  await assert.rejects(() => fetcher("x", {}));
  assert.equal(state.waited, 700);
  const abort = new AbortController();
  const real = paced(async () => new Response("ok"), 60_000);
  await real("x", {});
  const started = Date.now();
  const pending = real("x", { signal: abort.signal });
  setTimeout(() => abort.abort(), 20);
  await pending;
  assert.ok(Date.now() - started < 2000);
});

test("books are looked up strictly one request at a time, and every request after the first waits the gap", async () => {
  const { state, run } = rig([book("Laskar Pelangi", { author: "Andrea Hirata" }), book("Bumi Manusia", { author: "Pramoedya Ananta Toer" }), book("Unknown Placeholder")]);
  assert.equal(await run(), "finished");
  assert.equal(state.peak, 1);
  assert.ok(state.calls.length >= 5);
  assert.equal(state.waits.length, state.calls.length - 1);
  assert.ok(state.waits.every((ms) => ms === GAP_MS));
});

test("a wish with no ISBN is matched by title and author and gets only the empty fields: cover, work, blurb, language, never an ISBN", async () => {
  const { run, saved, steps } = rig([book("Laskar Pelangi", { author: "Andrea Hirata" })]);
  assert.equal(await run(), "finished");
  assert.equal(saved.length, 1);
  const [[, patch]] = saved;
  assert.deepEqual(Object.keys(patch).sort(), ["blurb", "cover", "language", "ol"]);
  assert.equal(patch.ol, "OL15302003W");
  assert.equal(patch.language, "id");
  assert.match(patch.cover, /^https:\/\/covers\.openlibrary\.org\/b\/id\/\d+-M\.jpg$/);
  assert.deepEqual(steps.map(([, tally]) => tally), [{ filled: 1, empty: 0, failed: 0, unsure: 0 }]);
});

test("what was typed or imported is never overwritten, and no blurb is requested when there is one", async () => {
  const { run, saved, state } = rig([book("Laskar Pelangi", { author: "Andrea Hirata", blurb: "Imported synopsis.", language: "en", cover: "https://covers.openlibrary.org/b/id/1-M.jpg" })]);
  await run();
  assert.deepEqual(saved.map(([, patch]) => Object.keys(patch)), [["ol"]]);
  assert.equal(state.calls.some((call) => call.startsWith("/works/")), false);
});

test("a title that matches only an author of a different name is skipped as not sure, and a hit by the same name is written", async () => {
  const wrong = rig([book("Bumi Manusia", { author: "Somebody Else" })]);
  assert.equal(await wrong.run(), "finished");
  assert.deepEqual([wrong.saved.length, wrong.steps[0][1]], [0, { filled: 0, empty: 0, failed: 0, unsure: 1 }]);
  const right = rig([book("Bumi Manusia", { author: "Pramoedya Ananta Toer" }), book("Bumi Manusia", { author: "Toer, Pramoedya Ananta" })]);
  await right.run();
  assert.deepEqual(right.saved.map(([, patch]) => patch.ol), ["OL307247W", "OL307247W"]);
});

const doc = (work: string, title: string, authors: string[] = []) => ({ key: `/works/${work}`, title, author_name: authors });

const searching = (...docs: ReturnType<typeof doc>[]): Answer => (url) =>
  url.pathname === "/search.json" ? new Response(JSON.stringify({ docs })) : url.pathname.startsWith("/works/") ? new Response(JSON.stringify({ description: "Invented synopsis." })) : undefined;

const outcome = async (typed: Record<string, unknown>, ...docs: ReturnType<typeof doc>[]) => {
  const { run, saved, steps } = rig([book("Placeholder Gamma", typed)], { answer: searching(...docs) });
  assert.equal(await run(), "finished");
  return { saved, tally: steps[0][1] };
};

const unsure = { saved: [], tally: { filled: 0, empty: 0, failed: 0, unsure: 1 } };

test("a hit by another author, a part of the name or a title that differs is never written", async () => {
  const none = { saved: [], tally: { filled: 0, empty: 1, failed: 0, unsure: 0 } };
  for (const [typed, found] of [["John Smith", "John Green"], ["John Smith", "Adam Smith"], ["John Smith", "Smith, Adam"], ["Wang Wei", "Li Wei"], ["Pramoedya", "Pramoedya Ananta Toer"], ["Pramudya Ananta Tur", "Pramoedya Ananta Toer"], ["Ed Ford II", "Al Ford III"], ["J. Smith", "John Smith"], ["John S.", "John Smith"], ["Prof. John Smith", "John Smith"]])
    assert.deepEqual(await outcome({ author: typed }, doc("OL1W", "Placeholder Gamma", [found])), unsure, `${typed} / ${found}`);
  assert.deepEqual(await outcome({ author: "John Smith" }, doc("OL1W", "Placeholder Gamma")), unsure);
  assert.deepEqual(await outcome({ author: "" }, doc("OL1W", "Placeholder Gamma", ["John Smith"])), unsure);
  assert.deepEqual(await outcome({}, doc("OL1W", "Placeholder Gamma", ["John Smith"])), unsure);
  assert.deepEqual(await outcome({ author: "John Smith" }, doc("OL1W", "Placeholder Gamma", ["Adam Smith"]), doc("OL2W", "Placeholder Gamma", ["Jane Smith"])), unsure);
  assert.deepEqual(await outcome({ author: "John Smith" }, doc("OL1W", "Another Placeholder", ["John Smith"])), none);
});

test("a typed two-author list with Surname, Given entries is written only from a hit that lists both authors", async () => {
  const typed = { author: "Okoye, Maren and Lindqvist, Tove" };
  for (const found of [["Rafi Lindqvist"], ["Anna Tove"], ["Dara Maren"], ["Maren Okoye"], ["Tove Lindqvist"]]) assert.deepEqual(await outcome(typed, doc("OL1W", "Placeholder Gamma", found)), unsure, found.join());
  for (const found of [["Maren Okoye", "Tove Lindqvist"], ["Tove Lindqvist", "Maren Okoye"], ["Okoye, Maren", "Lindqvist, Tove", "Rafi Okoye"]]) {
    const { saved, tally } = await outcome(typed, doc("OL1W", "Placeholder Gamma", ["Rafi Voss"]), doc("OL2W", "Placeholder Gamma", found));
    assert.deepEqual([saved[0][1].ol, saved[0][1].blurb, tally.unsure], ["OL2W", "Invented synopsis.", 0], found.join());
  }
});

test("an author that is the same name in another order, or with a generational suffix, is written", async () => {
  for (const [given, found] of [["John Smith", "Smith, John"], ["Ed Ford Jr.", "Ed Ford"], ["Smith, John", "John Smith"]]) {
    const { saved, tally } = await outcome({ author: given }, doc("OL1W", "Placeholder Gamma", ["Adam Smith"]), doc("OL2W", "Placeholder Gamma", [found]));
    assert.deepEqual([saved[0][1].ol, saved[0][1].blurb, tally], ["OL2W", "Invented synopsis.", { filled: 1, empty: 0, failed: 0, unsure: 0 }], given);
  }
});

test("an empty typed author is skipped as not sure, never matched on the title alone", async () => {
  const { saved, tally } = await outcome({}, doc("OL1W", "Placeholder Gamma", ["Some Entirely Different Person"]));
  assert.deepEqual([saved.length, tally], [0, { filled: 0, empty: 0, failed: 0, unsure: 1 }]);
  assert.deepEqual((await outcome({ author: "   " }, doc("OL1W", "Placeholder Gamma", ["Writer One"]))).tally.unsure, 1);
  assert.deepEqual((await outcome({}, doc("OL1W", "Another Placeholder", ["Writer One"]))).tally, { filled: 0, empty: 1, failed: 0, unsure: 0 });
});

test("a common title with several authors is written only when exactly one work carries the typed author", async () => {
  const crowd = [doc("OL1W", "Placeholder Gamma", ["Writer One"]), doc("OL2W", "Placeholder Gamma", ["Writer One", "Writer Two"]), doc("OL3W", "Placeholder Gamma", ["Writer Three"])];
  assert.deepEqual(await outcome({ author: "Writer One" }, ...crowd), { saved: [], tally: { filled: 0, empty: 0, failed: 0, unsure: 1 } });
  const alone = await outcome({ author: "Writer Three" }, ...crowd);
  assert.deepEqual([alone.saved[0][1].ol, alone.tally.unsure], ["OL3W", 0]);
  const twice = await outcome({ author: "Writer One" }, doc("OL1W", "Placeholder Gamma", ["Writer One"]), doc("OL1W", "Placeholder Gamma", ["Writer One"]));
  assert.deepEqual([twice.saved[0][1].ol, twice.tally.unsure], ["OL1W", 0]);
});

test("a skipped book is marked as tried so it is not asked again, and the count reaches the screen text", async () => {
  const { run, steps } = rig([book("Placeholder Gamma"), book("Laskar Pelangi", { author: "Andrea Hirata" })], { answer: (url) => (url.searchParams.get("q")?.includes("Gamma") ? searching(doc("OL1W", "Placeholder Gamma", ["Writer One"]))(url, 0) : undefined) });
  await run();
  assert.deepEqual(steps.map(([id]) => id).length, 2);
  assert.equal(text.books.import.finished(1, 0, 1), "Done. 1 book got details, 0 had no match. 1 book was skipped (not sure): open it and use Fill details by hand.");
  assert.equal(text.books.import.finished(2, 1, 3), "Done. 2 books got details, 1 had no match. 3 books were skipped (not sure): open them and use Fill details by hand.");
  assert.equal(text.books.import.finished(2, 1, 0), "Done. 2 books got details, 1 had no match.");
  assert.equal(text.books.import.progress(3, 10, 2), "3 of 10, 2 skipped (not sure)");
  assert.equal(text.books.import.progress(3, 10), "3 of 10");
});

test("a book whose title differs from the result's is a mismatch, and the original title can stand in", async () => {
  const different = rig([book("The Little Prince", { author: "Antoine de Saint-Exupéry" })]);
  await different.run();
  assert.equal(different.saved.length, 0);
  const original = rig([book("Pangeran Kecil", { author: "Antoine de Saint-Exupéry", original_title: "Le petit prince" })]);
  await original.run();
  const [[, patch]] = original.saved;
  assert.equal(patch.ol, "OL10263W");
  assert.equal("language" in patch, false);
  assert.equal("isbn" in patch, false);
});

test("a book with an ISBN is looked up by it, and the ISBN itself is never rewritten", async () => {
  const { run, saved, state } = rig([book("Laskar Pelangi", { isbn: "9789793062792" })]);
  await run();
  assert.ok(state.calls[0].includes("isbn=9789793062792"));
  assert.equal("isbn" in saved[0][1], false);
});

test("a lookup the server refuses for good is counted as failed and the pass moves on to the next book", async () => {
  const { run, saved, steps, backoffs } = rig([book("Laskar Pelangi", { author: "Andrea Hirata" }), book("Bumi Manusia", { author: "Pramoedya Ananta Toer" })], {
    answer: (url) => (/laskar/i.test(url.searchParams.get("q") ?? "") ? new Response("gone", { status: 404 }) : undefined),
  });
  assert.equal(await run(), "finished");
  assert.deepEqual(saved.map(([, patch]) => patch.ol), ["OL307247W"]);
  assert.deepEqual(steps.map(([, tally]) => tally), [{ filled: 0, empty: 0, failed: 1, unsure: 0 }, { filled: 1, empty: 0, failed: 1, unsure: 0 }]);
  assert.deepEqual(backoffs, []);
});

const busy = (status: number, headers: Record<string, string> = {}): Answer => (url) => (url.pathname === "/search.json" ? new Response("slow down", { status, headers }) : undefined);

test("429 and 5xx are not a no-match: the pass backs off with a doubling pause, stops after three in a row, and leaves the book untried", async () => {
  for (const status of [429, 500, 502, 503, 504]) {
    const { run, saved, steps, backoffs, rows, state } = rig([book("Laskar Pelangi", { author: "Andrea Hirata" }), book("Bumi Manusia", { author: "Pramoedya Ananta Toer" })], { answer: busy(status) });
    assert.equal(await run(), "busy", String(status));
    assert.deepEqual([saved.length, steps.length, backoffs], [0, 0, [2000, 4000]], String(status));
    assert.equal([...rows.values()].every(needsDetails), true);
    assert.equal(state.calls.length, 3);
  }
});

const gone = (status: number, headers: Record<string, string> = {}): Answer => (url) => (url.pathname.startsWith("/works/") ? new Response("slow down", { status, headers }) : undefined);

test("a synopsis request that is refused as busy backs off like any lookup, asks again, and the book is filled with the synopsis", async () => {
  let refused = 0;
  const { run, saved, backoffs, state } = rig([book("Laskar Pelangi", { author: "Andrea Hirata" })], { answer: (url, call) => (url.pathname.startsWith("/works/") && refused++ < 2 ? gone(429)(url, call) : undefined) });
  assert.equal(await run(), "finished");
  assert.deepEqual(backoffs, [2000, 4000]);
  assert.equal(saved.length, 1);
  assert.equal(typeof saved[0][1].blurb, "string");
  assert.deepEqual(state.calls.filter((call) => call.startsWith("/works/")).length, 3);
});

test("a synopsis request that keeps failing stops the pass as busy and leaves the book untried, so Resume fetches it", async () => {
  for (const status of [429, 500, 503]) {
    let down = true;
    const { run, saved, steps, backoffs, rows } = rig([book("Laskar Pelangi", { author: "Andrea Hirata" })], { answer: (url, call) => (down ? gone(status)(url, call) : undefined) });
    assert.equal(await run(), "busy", String(status));
    assert.deepEqual([saved.length, steps.length, backoffs], [0, 0, [2000, 4000]], String(status));
    assert.equal([...rows.values()].every(needsDetails), true);
    down = false;
    assert.equal(await run(), "finished");
    assert.equal(typeof saved[0][1].blurb, "string");
    assert.equal([...rows.values()].some(needsDetails), false);
  }
});

test("a synopsis request by ISBN that is refused is handled the same way: no save, no done mark", async () => {
  const { run, saved, rows } = rig([book("Laskar Pelangi", { isbn: "9789793062792" })], { answer: gone(503) });
  assert.equal(await run(), "busy");
  assert.deepEqual(saved, []);
  assert.equal([...rows.values()].every(needsDetails), true);
});

test("a synopsis request that is offline or too slow never marks the book done", async () => {
  const dropped: Answer = (url) => (url.pathname.startsWith("/works/") ? Promise.reject(new Error("down")) : undefined);
  const lost = rig([book("Laskar Pelangi", { author: "Andrea Hirata" })], { answer: dropped });
  assert.equal(await lost.run(), "offline");
  assert.deepEqual([lost.saved.length, lost.steps.length, needsDetails([...lost.rows.values()][0])], [0, 0, true]);
  const slow = rig([book("Laskar Pelangi", { author: "Andrea Hirata" })], { answer: (url, call, signal) => (url.pathname.startsWith("/works/") ? new Promise<Response>((_, reject) => signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))) : undefined), timeout: 20 });
  assert.equal(await slow.run(), "busy");
  assert.deepEqual([slow.saved.length, needsDetails([...slow.rows.values()][0])], [0, true]);
});

test("a synopsis page that is missing or unreadable does not stop the other fields from being filled", async () => {
  const missing = rig([book("Laskar Pelangi", { author: "Andrea Hirata" }), book("Bumi Manusia", { author: "Pramoedya Ananta Toer" })], {
    answer: (url, call) => (/OL15302003W/.test(url.pathname) ? gone(404)(url, call) : undefined),
  });
  assert.equal(await missing.run(), "finished");
  assert.deepEqual(missing.saved.map(([, patch]) => [patch.ol, patch.blurb === undefined]), [["OL15302003W", true], ["OL307247W", false]]);
  assert.deepEqual(missing.steps.map(([, tally]) => tally), [{ filled: 1, empty: 0, failed: 0, unsure: 0 }, { filled: 2, empty: 0, failed: 0, unsure: 0 }]);
  const broken = rig([book("Laskar Pelangi", { author: "Andrea Hirata" })], { answer: (url) => (url.pathname.startsWith("/works/") ? new Response("<html>", { status: 200 }) : undefined) });
  assert.equal(await broken.run(), "finished");
  assert.deepEqual(broken.saved.map(([, patch]) => [patch.ol, patch.blurb === undefined]), [["OL15302003W", true]]);
});

test("stopping while the synopsis is in flight leaves the book untried", async () => {
  const { run, controller, saved, rows } = rig([book("Laskar Pelangi", { author: "Andrea Hirata" })], { answer: (url, call, signal) => (url.pathname.startsWith("/works/") ? new Promise<Response>((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted")))) : undefined) });
  const pass = run();
  await new Promise((resolve) => setTimeout(resolve, 20));
  controller.abort();
  assert.equal(await pass, "stopped");
  assert.deepEqual([saved.length, needsDetails([...rows.values()][0])], [0, true]);
});

test("Resume after a busy stop picks the same books up again and fills them", async () => {
  let down = true;
  const { run, saved, steps } = rig([book("Laskar Pelangi", { author: "Andrea Hirata" })], { answer: (url, call) => (down ? busy(429)(url, call) : undefined) });
  assert.equal(await run(), "busy");
  down = false;
  assert.equal(await run(), "finished");
  assert.deepEqual([saved.length, steps.length], [1, 1]);
});

test("a book that answers after a busy reply is filled, and the count of failures in a row starts again for the next book", async () => {
  let refused = 0;
  const pattern = [true, true, false, true, true, false];
  const { run, saved, backoffs } = rig([book("Laskar Pelangi", { author: "Andrea Hirata" }), book("Bumi Manusia", { author: "Pramoedya Ananta Toer" })], {
    answer: (url) => (url.pathname === "/search.json" && pattern[refused++] ? new Response("x", { status: 503 }) : undefined),
  });
  assert.equal(await run(), "finished");
  assert.deepEqual(saved.map(([, patch]) => patch.ol), ["OL15302003W", "OL307247W"]);
  assert.deepEqual(backoffs, [2000, 4000, 2000, 4000]);
});

test("Retry-After in seconds or as a date sets the pause when it is longer than the doubling, and one beyond the cap ends the pass at once", async () => {
  const first = rig([book("Laskar Pelangi", { author: "Andrea Hirata" })], { answer: busy(429, { "retry-after": "30" }) });
  assert.equal(await first.run(), "busy");
  assert.deepEqual(first.backoffs, [30_000, 30_000]);
  const date = rig([book("Laskar Pelangi", { author: "Andrea Hirata" })], { answer: busy(503, { "retry-after": new Date(Date.now() + 10_000).toUTCString() }) });
  assert.equal(await date.run(), "busy");
  assert.ok(date.backoffs[0] >= 8000 && date.backoffs[0] <= 10_000, String(date.backoffs[0]));
  const long = rig([book("Laskar Pelangi", { author: "Andrea Hirata" })], { answer: busy(429, { "retry-after": "3600" }) });
  assert.equal(await long.run(), "busy");
  assert.deepEqual([long.backoffs, long.state.calls.length], [[], 1]);
  const small = rig([book("Laskar Pelangi", { author: "Andrea Hirata" })], { answer: busy(429, { "retry-after": "1" }) });
  await small.run();
  assert.deepEqual(small.backoffs, [2000, 4000]);
  const junk = rig([book("Laskar Pelangi", { author: "Andrea Hirata" })], { answer: busy(429, { "retry-after": "soon" }) });
  await junk.run();
  assert.deepEqual(junk.backoffs, [2000, 4000]);
});

test("a request that times out is treated like a busy server, not as a no-match", async () => {
  const { run, steps, backoffs } = rig([book("Laskar Pelangi", { author: "Andrea Hirata" })], { answer: (_url, _call, signal) => new Promise<Response>((_resolve, reject) => signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))), timeout: 20 });
  assert.equal(await run(), "busy");
  assert.deepEqual([steps.length, backoffs], [0, [2000, 4000]]);
});

test("stopping during the pause ends the pass at once without another request", async () => {
  let controller!: AbortController;
  const made = rig([book("Laskar Pelangi", { author: "Andrea Hirata" })], {
    answer: busy(503),
    pause: async () => controller.abort(),
  });
  controller = made.controller;
  assert.equal(await made.run(), "stopped");
  assert.equal(made.state.calls.length, 1);
});

test("a save that is refused counts as failed and the pass goes on", async () => {
  const { run, steps } = rig([book("Laskar Pelangi", { author: "Andrea Hirata" })]);
  assert.equal(await run(undefined, async () => ({ ok: false, errors: ["x"] })), "finished");
  assert.deepEqual(steps[0][1], { filled: 0, empty: 0, failed: 1, unsure: 0 });
});

test("offline stops the pass at once without marking the book as tried, so resuming picks it up again", async () => {
  const { run, steps, state } = rig([book("Laskar Pelangi")], { online: false });
  assert.equal(await run(), "offline");
  assert.deepEqual([steps.length, state.calls.length], [0, 0]);
});

test("stopping aborts the request in flight, saves nothing from it and leaves the rest untouched", async () => {
  const { run, controller, saved, steps, rows } = rig([book("Laskar Pelangi", { author: "Andrea Hirata" }), book("Bumi Manusia", { author: "Pramoedya Ananta Toer" })]);
  const first = [...rows.keys()][0];
  const pass = run();
  controller.abort();
  assert.equal(await pass, "stopped");
  assert.deepEqual([saved.length, steps.length], [0, 0]);
  assert.equal(needsDetails(rows.get(first)!), true);
});

test("resuming after a stop only handles the books still without details", async () => {
  const books = [book("Laskar Pelangi", { author: "Andrea Hirata" }), book("Bumi Manusia", { author: "Pramoedya Ananta Toer" })];
  const { run, rows, saved } = rig(books);
  await run([books[0].id]);
  assert.deepEqual(saved.map(([id]) => id), [books[0].id]);
  const left = [...rows.values()].filter(needsDetails).map((row) => row.id);
  assert.deepEqual(left, [books[1].id]);
  await run(left);
  assert.deepEqual(saved.map(([id]) => id), [books[0].id, books[1].id]);
  assert.equal([...rows.values()].some(needsDetails), false);
});

test("a lookup that is superseded outside the pass ends it as stopped, without counting the book", async () => {
  const { run, lookup, steps } = rig([book("Laskar Pelangi", { author: "Andrea Hirata" })]);
  const pass = run();
  lookup.stop();
  assert.equal(await pass, "stopped");
  assert.equal(steps.length, 0);
});

test("a book that disappears during its own lookup is still finished off from what was read", async () => {
  const { run, rows, steps } = rig([book("Laskar Pelangi", { author: "Andrea Hirata" })]);
  const [id] = [...rows.keys()];
  let saves = 0;
  const pass = run(undefined, async (saved) => (saves++, { ok: true as const, id: saved }));
  rows.delete(id);
  assert.equal(await pass, "finished");
  assert.deepEqual([saves, steps.length], [1, 1]);
});

test("a book deleted while the pass runs is skipped", async () => {
  const books = [book("Laskar Pelangi"), book("Bumi Manusia", { author: "Pramoedya Ananta Toer" })];
  const { run, rows, saved } = rig(books);
  rows.delete(books[0].id);
  assert.equal(await run(), "finished");
  assert.deepEqual(saved.map(([id]) => id), [books[1].id]);
});

test("a request that comes 1 ms early still waits that millisecond, and one exactly on time waits nothing", async () => {
  const waits: number[] = [];
  let now = 0;
  const fetcher = paced(async () => new Response("ok"), 1000, () => now, async (ms) => void waits.push(ms));
  await fetcher("x", {});
  now = 999;
  await fetcher("x", {});
  assert.deepEqual(waits, [1]);
  now = 1999;
  await fetcher("x", {});
  assert.deepEqual(waits, [1]);
});

test("stopping between two books ends the pass as stopped without asking about the second", async () => {
  const books = [book("Laskar Pelangi", { author: "Andrea Hirata" }), book("Bumi Manusia", { author: "Pramoedya Ananta Toer" })];
  const made = rig(books);
  const calls = () => made.state.calls.length;
  const result = await made.run(undefined, async (id) => {
    made.controller.abort();
    return { ok: true as const, id };
  });
  assert.equal(result, "stopped");
  assert.equal(made.saved.length, 0);
  assert.ok(calls() > 0 && made.state.calls.every((call) => !/bumi/i.test(call)));
});

test("aborting the pass aborts the request that is in flight, not just the wait for its answer", async () => {
  const seen: (AbortSignal | null | undefined)[] = [];
  const made = rig([book("Laskar Pelangi", { author: "Andrea Hirata" })], {
    answer: (_url, _call, signal) => {
      seen.push(signal);
      return new Promise<Response>((_resolve, reject) => signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    },
  });
  const pass = made.run();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(seen[0]?.aborted, false);
  made.controller.abort();
  assert.equal(await pass, "stopped");
  assert.equal(seen[0]?.aborted, true);
});

test("a field the person fills in while the lookup is running is kept, because the book is read again when the answer comes", async () => {
  const made = rig([book("Laskar Pelangi", { author: "Andrea Hirata" })], {
    answer: (url) => {
      if (url.pathname !== "/search.json") return undefined;
      const [id] = [...made.rows.keys()];
      const row = made.rows.get(id)!;
      made.rows.set(id, { ...row, data: { ...row.data, cover: "https://covers.openlibrary.org/b/id/1-M.jpg", language: "en" } });
      return undefined;
    },
  });
  await made.run();
  assert.deepEqual(Object.keys(made.saved[0][1]).sort(), ["blurb", "ol"]);
});

test("a Retry-After of exactly the cap is waited out, and one second more ends the pass", async () => {
  const exact = rig([book("Laskar Pelangi", { author: "Andrea Hirata" })], { answer: busy(429, { "retry-after": "60" }) });
  assert.equal(await exact.run(), "busy");
  assert.deepEqual(exact.backoffs, [60_000, 60_000]);
  const over = rig([book("Laskar Pelangi", { author: "Andrea Hirata" })], { answer: busy(429, { "retry-after": "61" }) });
  assert.equal(await over.run(), "busy");
  assert.deepEqual(over.backoffs, []);
});

const dummyLookup = (calls: string[], search: Lookup["search"]): Lookup => ({
  search,
  byIsbn: async () => ({ kind: "ok", value: null }),
  blurb: async () => ({ kind: "ok", value: null }),
  screen: async () => ({ kind: "ok", value: [] }),
  screenById: async () => ({ kind: "ok", value: null }),
  cancel: () => void calls.push("cancel"),
  stop: () => void calls.push("stop"),
});

const readOf = (rows: ItemRow[]) => (id: string) => rows.find((row) => row.id === id);

test("aborting the pass stops the lookup in flight, once", async () => {
  const calls: string[] = [];
  const controller = new AbortController();
  const rows = [book("Laskar Pelangi", { author: "Andrea Hirata" })];
  const lookup = dummyLookup(calls, () => new Promise(() => {}));
  const pass = findDetails({ ids: [rows[0].id], lookup, read: readOf(rows), save: async (id) => ({ ok: true, id }), signal: controller.signal, onStep: () => {} });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(calls, []);
  controller.abort();
  assert.deepEqual(calls, ["stop"]);
  controller.abort();
  assert.deepEqual(calls, ["stop"]);
  void pass;
});

test("a finished pass lets go of the signal: aborting it later stops nothing", async () => {
  const calls: string[] = [];
  const controller = new AbortController();
  const rows = [book("Laskar Pelangi", { author: "Andrea Hirata" })];
  const lookup = dummyLookup(calls, async () => ({ kind: "ok", value: [] }));
  assert.equal(await findDetails({ ids: [rows[0].id], lookup, read: readOf(rows), save: async (id) => ({ ok: true, id }), signal: controller.signal, onStep: () => {} }), "finished");
  controller.abort();
  assert.deepEqual(calls, []);
  const aborted = new AbortController();
  aborted.abort();
  assert.equal(await findDetails({ ids: [rows[0].id], lookup, read: readOf(rows), save: async (id) => ({ ok: true, id }), signal: aborted.signal, onStep: () => {} }), "stopped");
});

test("an answer that arrives after the pass was stopped is not counted or saved, even when the lookup did not call it stale", async () => {
  const controller = new AbortController();
  const rows = [book("Laskar Pelangi", { author: "Andrea Hirata" })];
  const saved: string[] = [];
  const steps: string[] = [];
  const lookup = dummyLookup([], async () => (controller.abort(), { kind: "ok", value: [] }));
  const finish = await findDetails({ ids: [rows[0].id], lookup, read: readOf(rows), save: async (id) => (saved.push(id), { ok: true, id }), signal: controller.signal, onStep: (id) => steps.push(id) });
  assert.deepEqual([finish, saved, steps], ["stopped", [], []]);
});

test("pending lists the rows that need a lookup and were not tried yet, in order", () => {
  const rows = [item({ title: "one" }), item({ title: "two" }), item({ title: "three" })];
  const needs = (row: ItemRow) => row.title !== "two";
  assert.deepEqual(pending(rows, needs, new Set()).map((row) => row.title), ["one", "three"]);
  assert.deepEqual(pending(rows, needs, new Set([rows[0].id])).map((row) => row.title), ["three"]);
  assert.deepEqual(pending(rows, () => false, new Set()), []);
});
