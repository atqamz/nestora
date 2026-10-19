import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ItemRow } from "../shared/tables.ts";
import { GAP_MS, findDetails, needsDetails, paced } from "../src/store/details.ts";
import type { Tally } from "../src/store/details.ts";
import { createLookup } from "../src/store/lookup.ts";
import type { Fetcher } from "../src/store/lookup.ts";
import { item } from "./domain-rows.ts";

const sample = (name: string) => readFileSync(new URL(`./fixtures/openlibrary/${name}.json`, import.meta.url), "utf8");

const SEARCHES: [RegExp, string][] = [
  [/laskar/i, "laskar-pelangi-search"],
  [/bumi/i, "bumi-manusia-search"],
  [/prince|petit/i, "little-prince-search"],
];

const WORKS: Record<string, string> = { OL15302003W: "laskar-pelangi-work", OL10263W: "little-prince-work" };

const clock = () => {
  const state = { now: 0, waits: [] as number[], starts: [] as number[], ends: [] as number[], open: 0, peak: 0, calls: [] as string[] };
  const wait = async (ms: number) => {
    state.waits.push(ms);
    state.now += ms;
  };
  return { state, now: () => state.now, wait };
};

const openLibrary = (state: ReturnType<typeof clock>["state"], broken: RegExp | null = null): Fetcher => async (input) => {
  const url = new URL(input);
  state.calls.push(`${url.pathname}${url.search}`);
  state.starts.push(state.now);
  state.peak = Math.max(state.peak, ++state.open);
  await Promise.resolve();
  state.now += 40;
  state.open--;
  state.ends.push(state.now);
  const query = url.searchParams.get("q") ?? url.searchParams.get("isbn") ?? "";
  if (broken?.test(query)) return new Response("nope", { status: 500 });
  if (url.searchParams.has("isbn")) return new Response(sample("laskar-pelangi-isbn"));
  if (url.pathname === "/search.json") {
    const found = SEARCHES.find(([pattern]) => pattern.test(query));
    return new Response(found ? sample(found[1]) : JSON.stringify({ docs: [] }));
  }
  const work = WORKS[url.pathname.replace(/^\/works\/|\.json$/g, "")];
  return work ? new Response(sample(work)) : new Response("{}", { status: 404 });
};

const book = (title: string, data: Record<string, unknown> = {}) => item({ kind: "book", status: "wish", title, data: { import_batch: "b", ...data } });

const rig = (books: ItemRow[], options: { broken?: RegExp; online?: boolean } = {}) => {
  const { state, now, wait } = clock();
  const lookup = createLookup({ fetcher: paced(openLibrary(state, options.broken ?? null), GAP_MS, now, wait), wait: 0, online: () => options.online ?? true });
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
    });
  return { state, saved, steps, controller, rows, run, lookup };
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
  assert.deepEqual(steps.map(([, tally]) => tally), [{ filled: 1, empty: 0, failed: 0 }]);
});

test("what was typed or imported is never overwritten, and no blurb is requested when there is one", async () => {
  const { run, saved, state } = rig([book("Laskar Pelangi", { author: "Andrea Hirata", blurb: "Imported synopsis.", language: "en", cover: "https://covers.openlibrary.org/b/id/1-M.jpg" })]);
  await run();
  assert.deepEqual(saved.map(([, patch]) => Object.keys(patch)), [["ol"]]);
  assert.equal(state.calls.some((call) => call.startsWith("/works/")), false);
});

test("a title that matches only an author of a different name is not accepted, and a blank author takes the first title match", async () => {
  const wrong = rig([book("Bumi Manusia", { author: "Somebody Else" })]);
  assert.equal(await wrong.run(), "finished");
  assert.deepEqual([wrong.saved.length, wrong.steps[0][1]], [0, { filled: 0, empty: 1, failed: 0 }]);
  const right = rig([book("Bumi Manusia", { author: "Pramoedya Ananta Toer" }), book("Bumi Manusia")]);
  await right.run();
  assert.deepEqual(right.saved.map(([, patch]) => patch.ol), ["OL307247W", "OL307247W"]);
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

test("a failed lookup is counted and the pass moves on to the next book", async () => {
  const { run, saved, steps } = rig([book("Laskar Pelangi", { author: "Andrea Hirata" }), book("Bumi Manusia", { author: "Pramoedya Ananta Toer" })], { broken: /laskar/i });
  assert.equal(await run(), "finished");
  assert.deepEqual(saved.map(([, patch]) => patch.ol), ["OL307247W"]);
  assert.deepEqual(steps.map(([, tally]) => tally), [{ filled: 0, empty: 0, failed: 1 }, { filled: 1, empty: 0, failed: 1 }]);
});

test("a save that is refused counts as failed and the pass goes on", async () => {
  const { run, steps } = rig([book("Laskar Pelangi", { author: "Andrea Hirata" })]);
  assert.equal(await run(undefined, async () => ({ ok: false, errors: ["x"] })), "finished");
  assert.deepEqual(steps[0][1], { filled: 0, empty: 0, failed: 1 });
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
