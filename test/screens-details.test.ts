import { test } from "node:test";
import assert from "node:assert/strict";
import type { ItemRow } from "../shared/tables.ts";
import { addDays } from "../src/domain/dates.ts";
import { needsPoster } from "../src/domain/tmdb.ts";
import type { ScreenHit } from "../src/domain/tmdb.ts";
import { GAP_MS, fillScreen, findDetails, paced } from "../src/store/details.ts";
import type { Tally } from "../src/store/details.ts";
import { createLookup } from "../src/store/lookup.ts";
import type { Fetcher } from "../src/store/lookup.ts";
import { item } from "./domain-rows.ts";

const TODAY = "2027-03-01";

const OLD = "https://image.tmdb.org/t/p/w342/invOld0001.jpg";

const NEW = "https://image.tmdb.org/t/p/w342/invNew0001.jpg";

const harbour = (extra: Partial<ScreenHit> = {}): ScreenHit => ({ kind: "movie", tmdb: 910001, title: "Pelabuhan Terakhir", original: null, year: 2017, cover: NEW, ...extra });

const JSON_TYPE = { "content-type": "application/json" };

type Answer = (query: URL, call: number) => Response | ScreenHit[];

const rig = (rows: ItemRow[], options: { answer?: Answer; online?: boolean; save?: "fail" } = {}) => {
  const clock = { now: 0, waits: [] as number[], calls: [] as string[], starts: [] as number[], ends: [] as number[] };
  const wait = async (ms: number) => {
    clock.waits.push(ms);
    clock.now += ms;
  };
  const net: Fetcher = async (input) => {
    const url = new URL(input, "http://local.test");
    clock.calls.push(`${url.pathname}${url.search}`);
    clock.starts.push(clock.now);
    await Promise.resolve();
    clock.now += 40;
    clock.ends.push(clock.now);
    const given = options.answer?.(url, clock.calls.length) ?? [];
    return given instanceof Response ? given : new Response(JSON.stringify({ hits: given }), { headers: JSON_TYPE });
  };
  const lookup = createLookup({ fetcher: paced(net, GAP_MS, () => clock.now, wait), wait: 0, online: () => options.online ?? true });
  const table = new Map(rows.map((row) => [row.id, row]));
  const saved: [string, Record<string, unknown>][] = [];
  const steps: [string, Tally][] = [];
  const pauses: number[] = [];
  const controller = new AbortController();
  const run = (ids = rows.map((row) => row.id)) =>
    findDetails<Record<string, unknown>>({
      ids,
      lookup,
      read: (id) => table.get(id),
      save: async (id, patch) => {
        saved.push([id, patch]);
        if (options.save === "fail") return { ok: false, errors: ["nope"] };
        const row = table.get(id)!;
        const data: Record<string, unknown> = { ...row.data };
        for (const [key, value] of Object.entries(patch)) {
          if (value === null) delete data[key];
          else data[key] = value;
        }
        table.set(id, { ...row, data });
        return { ok: true, id };
      },
      signal: controller.signal,
      onStep: (id, tally) => steps.push([id, tally]),
      wait: async (ms) => void pauses.push(ms),
      attempt: (lookup, _, current) => fillScreen(lookup, current, TODAY),
    });
  return { clock, saved, steps, pauses, controller, table, run };
};

const typed = (title: string, data: Record<string, unknown> = {}, kind = "movie") => item({ kind, status: "want", title, data });

const stamped = (days: number, data: Record<string, unknown> = {}, kind = "movie") => typed("Pelabuhan Terakhir", { tmdb: 910001, cover: OLD, tmdb_at: addDays(TODAY, -days), ...data }, kind);

const empty: Tally = { filled: 0, empty: 0, failed: 0, unsure: 0 };

test("a typed row is searched by title and year, and one hit with the same title and year fills the empty keys and nothing else", async () => {
  const row = typed("pelabuhan  TERAKHIR", { year: 2017 });
  const { run, saved, steps, clock, table } = rig([row], { answer: () => [harbour({ original: "Last Harbour" })] });
  assert.equal(await run(), "finished");
  assert.deepEqual(clock.calls, ["/api/lookup/screen?kind=movie&title=pelabuhan+terakhir&year=2017"]);
  assert.deepEqual(saved, [[row.id, { tmdb: 910001, tmdb_at: TODAY, cover: NEW, original_title: "Last Harbour" }]]);
  assert.equal(table.get(row.id)!.title, "pelabuhan  TERAKHIR");
  assert.deepEqual(steps.map(([, tally]) => tally), [{ ...empty, filled: 1 }]);
});

test("the batch never writes a title: no patch has one, and a hit with another title is not written at all", async () => {
  const rows = [typed("Pelabuhan Terakhir", { year: 2017 }), typed("Other Row")];
  const { run, saved } = rig(rows, { answer: () => [harbour({ title: "Pelabuhan Terakhir" })] });
  await run();
  for (const [, patch] of saved) assert.deepEqual(Object.keys(patch).filter((key) => key === "title" || key === "data"), []);
  assert.equal(saved.length, 1);
});

test("a typed row keeps what it already holds: its year and original title are not overwritten, and a poster it has stays", async () => {
  const row = typed("Pelabuhan Terakhir", { year: 2017, original_title: "My Own Original", cover: OLD });
  const { run, saved } = rig([row], { answer: () => [harbour({ original: "Last Harbour" })] });
  await run();
  assert.deepEqual(saved, [[row.id, { tmdb: 910001, tmdb_at: TODAY }]]);
});

test("a typed row with no year takes the year of the single matching hit, and a hit with no poster writes the id and the day alone", async () => {
  const row = typed("Pelabuhan Terakhir");
  const { run, saved } = rig([row], { answer: () => [harbour({ cover: null })] });
  await run();
  assert.deepEqual(saved, [[row.id, { tmdb: 910001, tmdb_at: TODAY, year: 2017 }]]);
});

test("the original title of a hit also matches, folded, so a row typed in the original language is found", async () => {
  const row = typed("Tōdai-mori no Natsu", { year: 2001 });
  const { run, saved } = rig([row], { answer: () => [harbour({ tmdb: 910002, title: "Lighthouse Summer", original: "Todai mori no natsu", year: 2001 })] });
  await run();
  assert.equal(saved.length, 1);
  assert.equal(saved[0][1].tmdb, 910002);
});

test("two candidates with the same title and year are unsure: nothing is written, and the tally says so", async () => {
  const row = typed("Pelabuhan Terakhir", { year: 2017 });
  const { run, saved, steps } = rig([row], { answer: () => [harbour(), harbour({ tmdb: 910009 })] });
  assert.equal(await run(), "finished");
  assert.deepEqual(saved, []);
  assert.deepEqual(steps.map(([, tally]) => tally), [{ ...empty, unsure: 1 }]);
});

test("a row with no year and two same-title hits is unsure too, and a second hit with another title does not make it so", async () => {
  const bare = typed("Pelabuhan Terakhir");
  const first = rig([bare], { answer: () => [harbour(), harbour({ tmdb: 910009, year: 1971 })] });
  await first.run();
  assert.deepEqual([first.saved.length, first.steps[0][1].unsure], [0, 1]);
  const second = rig([bare], { answer: () => [harbour(), harbour({ tmdb: 910009, title: "Pelabuhan Pertama", original: null })] });
  await second.run();
  assert.deepEqual([second.saved.length, second.steps[0][1].filled], [1, 1]);
});

test("a hit with a different year is not the row: nothing is written, and a hit with no year is not a match for a row with one", async () => {
  const row = typed("Pelabuhan Terakhir", { year: 2017 });
  for (const year of [2018, 2016, null]) {
    const { run, saved, steps } = rig([row], { answer: () => [harbour({ year })] });
    await run();
    assert.deepEqual([saved.length, steps[0][1].unsure], [0, 1], String(year));
  }
});

test("hits that carry another title are unsure, no hits at all is no match, and a title with no letters never matches a title with no letters", async () => {
  const other = rig([typed("Pelabuhan Terakhir", { year: 2017 })], { answer: () => [harbour({ title: "Dermaga Pertama" })] });
  await other.run();
  assert.deepEqual([other.saved.length, other.steps[0][1]], [0, { ...empty, unsure: 1 }]);
  const none = rig([typed("Pelabuhan Terakhir", { year: 2017 })], { answer: () => [] });
  await none.run();
  assert.deepEqual([none.saved.length, none.steps[0][1]], [0, { ...empty, empty: 1 }]);
  const marks = rig([typed("?!")], { answer: () => [harbour({ title: "...", original: null, year: null })] });
  await marks.run();
  assert.deepEqual([marks.saved.length, marks.steps[0][1].unsure], [0, 1]);
});

test("a series row is searched as a series", async () => {
  const row = typed("Rumah Kaca", { year: 2023 }, "series");
  const { run, saved, clock } = rig([row], { answer: () => [harbour({ kind: "series", tmdb: 920001, title: "Rumah Kaca", year: 2023 })] });
  await run();
  assert.equal(clock.calls[0], "/api/lookup/screen?kind=series&title=rumah+kaca&year=2023");
  assert.equal(saved[0][1].tmdb, 920001);
});

test("a row with an id is refreshed by that id, never searched, and gets a new day and the new poster", async () => {
  const row = stamped(130, { year: 2017 });
  const { run, saved, clock } = rig([row], { answer: () => [harbour()] });
  assert.equal(await run(), "finished");
  assert.deepEqual(clock.calls, ["/api/lookup/screen?kind=movie&id=910001"]);
  assert.deepEqual(saved, [[row.id, { tmdb: 910001, tmdb_at: TODAY, cover: NEW }]]);
});

test("a refresh by id writes the day alone when the poster is unchanged, and never replaces a poster with nothing", async () => {
  const same = stamped(130, { year: 2017 });
  const first = rig([same], { answer: () => [harbour({ cover: OLD })] });
  await first.run();
  assert.deepEqual(first.saved, [[same.id, { tmdb: 910001, tmdb_at: TODAY }]]);
  const none = rig([same], { answer: () => [harbour({ cover: null })] });
  await none.run();
  assert.deepEqual(none.saved, [[same.id, { tmdb: 910001, tmdb_at: TODAY }]]);
});

test("a refresh fills an empty year or original title but keeps the couple's own", async () => {
  const bare = stamped(130);
  const filled = rig([bare], { answer: () => [harbour({ original: "Last Harbour" })] });
  await filled.run();
  assert.deepEqual(filled.saved[0][1], { tmdb: 910001, tmdb_at: TODAY, cover: NEW, original_title: "Last Harbour", year: 2017 });
  const own = stamped(130, { year: 2016, original_title: "Mine" });
  const kept = rig([own], { answer: () => [harbour({ original: "Last Harbour" })] });
  await kept.run();
  assert.deepEqual(kept.saved[0][1], { tmdb: 910001, tmdb_at: TODAY, cover: NEW });
});

test("an id TMDB no longer knows purges the three keys and nothing else, counts as no match, and the row is offered again for a title search", async () => {
  const row = stamped(130, { year: 2017, original_title: "Mine", rating_a: "4" });
  const { run, saved, steps, table } = rig([row], { answer: () => [] });
  assert.equal(await run(), "finished");
  assert.deepEqual(saved, [[row.id, { cover: null, tmdb: null, tmdb_at: null }]]);
  assert.deepEqual(steps.map(([, tally]) => tally), [{ ...empty, empty: 1 }]);
  const after = table.get(row.id)!;
  assert.deepEqual(after.data, { year: 2017, original_title: "Mine", rating_a: "4" });
  assert.equal(after.title, "Pelabuhan Terakhir");
  assert.equal(needsPoster(after, TODAY), true);
});

test("an answer for another id than the one asked is a purge, not a refresh to the wrong item", async () => {
  const row = stamped(130);
  const { run, saved } = rig([row], { answer: () => [harbour({ tmdb: 910777 })] });
  await run();
  assert.deepEqual(saved, [[row.id, { cover: null, tmdb: null, tmdb_at: null }]]);
});

test("a row picked or edited while its lookup was out is left alone", async () => {
  const row = typed("Pelabuhan Terakhir", { year: 2017 });
  const gotId = rig([row], { answer: () => [harbour()] });
  const original = gotId.table.get(row.id)!;
  gotId.table.set(row.id, { ...original, data: { ...original.data } });
  const lookup = createLookup({ fetcher: async () => (gotId.table.set(row.id, { ...original, data: { ...original.data, tmdb: 5, tmdb_at: TODAY } }), new Response(JSON.stringify({ hits: [harbour()] }), { headers: JSON_TYPE })), wait: 0 });
  assert.deepEqual(await fillScreen(lookup, () => gotId.table.get(row.id)!, TODAY), { kind: "nothing" });
  const refreshed = stamped(130);
  const moved = new Map([[refreshed.id, refreshed]]);
  const byId = createLookup({ fetcher: async () => (moved.set(refreshed.id, { ...refreshed, data: { ...refreshed.data, tmdb: 6 } }), new Response(JSON.stringify({ hits: [harbour()] }), { headers: JSON_TYPE })), wait: 0 });
  assert.deepEqual(await fillScreen(byId, () => moved.get(refreshed.id)!, TODAY), { kind: "nothing" });
});

test("a book row is not a screen: nothing is asked and nothing is written", async () => {
  const book = item({ kind: "book", status: "shelf", title: "Book", data: null });
  const { run, clock, saved } = rig([book]);
  assert.equal(await run(), "finished");
  assert.deepEqual([clock.calls, saved], [[], []]);
});

test("requests are paced a second apart, one at a time, and the first goes at once", async () => {
  const rows = [typed("Pelabuhan Terakhir", { year: 2017 }), stamped(130), typed("Third")];
  const { run, clock } = rig(rows, { answer: () => [harbour()] });
  await run();
  assert.equal(clock.calls.length, 3);
  assert.equal(clock.starts[0], 0);
  for (let at = 1; at < 3; at++) assert.ok(clock.starts[at] - clock.ends[at - 1] >= GAP_MS);
});

const busy = (status: number, headers: Record<string, string> = {}): Answer => () => new Response(JSON.stringify({ error: "busy", retry: 30 }), { status, headers: { ...JSON_TYPE, ...headers } });

test("a busy answer is not a no-match: the pass backs off with a doubling pause, stops after three, and leaves the rows untried", async () => {
  for (const status of [429, 502, 503]) {
    const rows = [typed("Pelabuhan Terakhir", { year: 2017 }), stamped(130)];
    const { run, saved, steps, pauses, table, clock } = rig(rows, { answer: busy(status) });
    assert.equal(await run(), "busy", String(status));
    assert.deepEqual([saved.length, steps.length, pauses, clock.calls.length], [0, 0, [2000, 4000], 3], String(status));
    assert.equal(rows.every((row) => needsPoster(table.get(row.id)!, TODAY)), true);
  }
});

test("the wait TMDB asked for wins over the back-off when it is longer, and a wait past the cap stops the pass", async () => {
  const long = rig([typed("Pelabuhan Terakhir", { year: 2017 })], { answer: busy(429, { "retry-after": "20" }) });
  assert.equal(await long.run(), "busy");
  assert.deepEqual(long.pauses, [20_000, 20_000]);
  const huge = rig([typed("Pelabuhan Terakhir", { year: 2017 })], { answer: busy(429, { "retry-after": "3600" }) });
  assert.equal(await huge.run(), "busy");
  assert.deepEqual(huge.pauses, []);
});

test("one busy answer followed by a good one carries on, and the count of busy answers starts again after a row", async () => {
  const rows = [typed("Pelabuhan Terakhir", { year: 2017 }), typed("Dermaga Pertama", { year: 2017 })];
  const calls = [1, 3];
  const { run, saved, pauses } = rig(rows, { answer: (url, call) => (calls.includes(call) ? busy(503)(url, call) : [harbour({ title: rows[Number(call > 2)].title })]) });
  assert.equal(await run(), "finished");
  assert.deepEqual([saved.length, pauses], [2, [2000, 2000]]);
});

test("an abort stops the pass after the row in hand and writes nothing more", async () => {
  const rows = [typed("Pelabuhan Terakhir", { year: 2017 }), typed("Pelabuhan Terakhir", { year: 2017 }), typed("Pelabuhan Terakhir", { year: 2017 })];
  const t = rig(rows, { answer: () => [harbour()] });
  const original = t.run;
  const pass = original();
  t.controller.abort();
  assert.equal(await pass, "stopped");
  assert.equal(t.saved.length, 0);
  const mid = rig(rows, { answer: () => [harbour()] });
  const stop = new AbortController();
  const result = await findDetails<Record<string, unknown>>({
    ids: rows.map((row) => row.id),
    lookup: createLookup({ fetcher: async () => new Response(JSON.stringify({ hits: [harbour()] }), { headers: JSON_TYPE }), wait: 0 }),
    read: (id) => rows.find((row) => row.id === id),
    save: async (id, patch) => (mid.saved.push([id, patch]), stop.abort(), { ok: true, id }),
    signal: stop.signal,
    onStep: () => {},
    attempt: (lookup, _, current) => fillScreen(lookup, current, TODAY),
  });
  assert.equal(result, "stopped");
  assert.equal(mid.saved.length, 1);
});

test("offline stops the pass with nothing written, and the row stays untried", async () => {
  const rows = [typed("Pelabuhan Terakhir", { year: 2017 }), stamped(130)];
  const { run, saved, steps, clock } = rig(rows, { online: false });
  assert.equal(await run(), "offline");
  assert.deepEqual([saved.length, steps.length, clock.calls.length], [0, 0, 0]);
});

test("a save that fails is counted as failed and the pass moves on", async () => {
  const rows = [typed("Pelabuhan Terakhir", { year: 2017 }), typed("Pelabuhan Terakhir", { year: 2017 })];
  const { run, steps } = rig(rows, { answer: () => [harbour()], save: "fail" });
  assert.equal(await run(), "finished");
  assert.deepEqual(steps.map(([, tally]) => tally), [{ ...empty, failed: 1 }, { ...empty, failed: 2 }]);
});

test("a title too short to search is no match, and asks nothing", async () => {
  const short = rig([typed("X")], { answer: () => [harbour({ title: "X" })] });
  await short.run();
  assert.deepEqual([short.clock.calls.length, short.steps[0][1].empty], [0, 1]);
});
