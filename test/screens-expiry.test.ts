import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ItemRow } from "../shared/tables.ts";
import { validateChange } from "../shared/validate.ts";
import { addDays } from "../src/domain/dates.ts";
import { PURGE_DAYS, REFRESH_DAYS, expired, expiredSteps, needsPoster, posterAge, purgePatch } from "../src/domain/tmdb.ts";
import { createApi } from "../src/store/api.ts";
import { memoryPersistence } from "../src/store/memory.ts";
import { createStore, paused } from "../src/store/store.ts";
import { sweepExpired } from "../src/ui/screen-save.ts";
import { item } from "./domain-rows.ts";
import { client, idOf } from "./store-client.ts";
import { createServer } from "./store-server.ts";

const TODAY = "2027-03-01";

const POSTER = "https://image.tmdb.org/t/p/w342/invPoster0001.jpg";

const aged = (days: number | null, extra: Record<string, unknown> = {}, kind = "movie") =>
  item({ kind, status: "want", title: "Pelabuhan Terakhir", data: { cover: POSTER, tmdb: 910001, ...(days === null ? {} : { tmdb_at: addDays(TODAY, -days) }), ...extra } });

test("the windows are 120 and 170 days", () => {
  assert.deepEqual([REFRESH_DAYS, PURGE_DAYS], [120, 170]);
});

test("a stamp under 120 days old needs nothing: 119 days is fresh", () => {
  for (const days of [0, 1, 60, 119]) {
    assert.deepEqual([expired(aged(days), TODAY), needsPoster(aged(days), TODAY)], [false, false], String(days));
  }
});

test("from 120 to 169 days the row needs a refresh by id and is not purged", () => {
  for (const days of [120, 121, 150, 169]) {
    assert.deepEqual([expired(aged(days), TODAY), needsPoster(aged(days), TODAY)], [false, true], String(days));
  }
});

test("at 170 days and later, or with no stamp on a row that has a poster or an id, the row is purged", () => {
  for (const days of [170, 171, 400]) assert.equal(expired(aged(days), TODAY), true, String(days));
  assert.equal(expired(aged(null), TODAY), true);
  assert.equal(expired(aged(null, { cover: undefined }), TODAY), true);
  assert.equal(expired(aged(null, { tmdb: undefined }), TODAY), true);
  assert.equal(needsPoster(aged(null), TODAY), true);
});

test("a stamp that is not a date counts as missing", () => {
  for (const stamp of ["", "soon", "2027-13-45", 5, null]) {
    assert.equal(posterAge(aged(5, { tmdb_at: stamp }), TODAY), null, String(stamp));
    assert.equal(expired(aged(5, { tmdb_at: stamp }), TODAY), true, String(stamp));
  }
});

test("a stamp from the future never expires anything", () => {
  assert.equal(posterAge(aged(-3), TODAY), -3);
  assert.deepEqual([expired(aged(-3), TODAY), needsPoster(aged(-3), TODAY)], [false, false]);
});

test("a row with neither poster nor id has nothing to purge, and a hand-typed row needs a lookup at any age", () => {
  const typed = item({ kind: "movie", status: "want", title: "Typed", data: { year: 2001 } });
  assert.deepEqual([expired(typed, TODAY), needsPoster(typed, TODAY)], [false, true]);
  const stampOnly = aged(400, { cover: undefined, tmdb: undefined });
  assert.equal(expired(stampOnly, TODAY), false);
  assert.equal(expired(item({ kind: "movie", status: "want", title: "No data", data: null }), TODAY), false);
  assert.equal(needsPoster(item({ kind: "movie", status: "want", title: "No data", data: null }), TODAY), true);
});

test("only movies and series are swept or offered a lookup: a book with an old cover is left alone", () => {
  const book = item({ kind: "book", status: "shelf", title: "Book", data: { cover: POSTER, tmdb_at: "2020-01-01" } });
  assert.deepEqual([expired(book, TODAY), needsPoster(book, TODAY)], [false, false]);
  assert.equal(expired(aged(400, {}, "series"), TODAY), true);
});

test("an id with a fresh stamp but no poster needs nothing: TMDB had none", () => {
  const bare = aged(10, { cover: undefined });
  assert.deepEqual([expired(bare, TODAY), needsPoster(bare, TODAY)], [false, false]);
});

test("the purge patch sets exactly cover, tmdb and tmdb_at to null and nothing else, and it is a valid patch for both kinds", () => {
  assert.deepEqual(purgePatch(), { data: { cover: null, tmdb: null, tmdb_at: null } });
  assert.notEqual(purgePatch().data, purgePatch().data);
  for (const kind of ["movie", "series"]) {
    const row = { ...aged(170, { year: 2017 }, kind), id: "00000000-0000-4000-8000-000000000001" };
    assert.deepEqual(validateChange("items", row as never, purgePatch() as never), [], kind);
  }
});

test("one step per expired row, each an update of that row alone, and fresh or other rows get none", () => {
  const old = aged(170);
  const older = aged(null, {}, "series");
  const steps = expiredSteps([aged(10), old, aged(169), older, item({ kind: "book", title: "B", status: "shelf", data: { cover: POSTER } })], TODAY);
  assert.deepEqual(steps, [
    { op: "update", table: "items", id: old.id, change: { data: { cover: null, tmdb: null, tmdb_at: null } } },
    { op: "update", table: "items", id: older.id, change: { data: { cover: null, tmdb: null, tmdb_at: null } } },
  ]);
  assert.deepEqual(expiredSteps([], TODAY), []);
});

const own = (store: ReturnType<typeof client>["store"]) => store.getSnapshot().rows.items;

const seeded = async () => {
  const server = createServer();
  const a = client(server, "a").store;
  const b = client(server, "b").store;
  await a.open();
  await b.open();
  const data = (days: number | null, extra: Record<string, unknown> = {}) => ({
    original_title: "Last Harbour",
    year: 2017,
    rating_a: "4",
    rating_b: "3",
    cover: POSTER,
    tmdb: 910001,
    ...(days === null ? {} : { tmdb_at: addDays(TODAY, -days) }),
    ...extra,
  });
  const make = async (title: string, kind: string, days: number | null) =>
    idOf(await a.create("items", { kind, title, status: "watched", who: "both", done_on: "2027-01-01", note: "Together", data: data(days) } as never));
  const ids = {
    fresh: await make("Fresh", "movie", 119),
    refresh: await make("Refresh", "movie", 120),
    late: await make("Late", "series", 169),
    purge: await make("Purge", "movie", 170),
    more: await make("More", "series", 171),
    none: await make("None", "movie", null),
  };
  await a.sync();
  await b.sync();
  return { server, a, b, ids };
};

const KEPT = { original_title: "Last Harbour", year: 2017, rating_a: "4", rating_b: "3" };

test("the sweep clears the three keys at 170 days and with no stamp, and leaves everything else on every row, the title and status included", async () => {
  const { server, a, ids } = await seeded();
  const before = new Map(server.rows("items").map((row) => [row.id as string, structuredClone(row)]));
  sweepExpired(own(a), TODAY, a.many);
  await a.sync();
  for (const id of [ids.purge, ids.more, ids.none]) {
    const row = server.row("items", id)!;
    assert.deepEqual(row.data, KEPT, row.title as string);
    for (const column of ["title", "status", "who", "done_on", "note", "kind"]) assert.equal(row[column], before.get(id)![column], `${row.title} ${column}`);
  }
  for (const id of [ids.fresh, ids.refresh, ids.late]) assert.deepEqual(server.row("items", id), before.get(id), String(id));
});

test("the sweep sends one patch per expired row, with exactly the three keys", async () => {
  const { a, ids } = await seeded();
  const sent: unknown[] = [];
  sweepExpired(own(a), TODAY, async (steps) => (sent.push(...steps), a.many(steps)));
  assert.deepEqual(
    sent.map((step) => (step as { id: string }).id).sort(),
    [ids.purge, ids.more, ids.none].sort(),
  );
  for (const step of sent) assert.deepEqual((step as { change: unknown }).change, { data: { cover: null, tmdb: null, tmdb_at: null } });
});

test("a second sweep over the swept rows writes nothing", async () => {
  const { a } = await seeded();
  sweepExpired(own(a), TODAY, a.many);
  const calls: number[] = [];
  sweepExpired(own(a), TODAY, async (steps) => (calls.push(steps.length), a.many(steps)));
  assert.deepEqual(calls, []);
});

test("two clients sweeping at once leave one result: the same three keys gone, nothing else changed, no row lost or doubled", async () => {
  const { server, a, b, ids } = await seeded();
  const count = server.rows("items").length;
  sweepExpired(own(a), TODAY, a.many);
  sweepExpired(own(b), TODAY, b.many);
  await a.sync();
  await b.sync();
  await a.sync();
  await b.sync();
  assert.equal(server.rows("items").length, count);
  for (const id of [ids.purge, ids.more, ids.none]) assert.deepEqual(server.row("items", id)!.data, KEPT);
  for (const id of [ids.fresh, ids.refresh, ids.late]) assert.equal((server.row("items", id)!.data as { tmdb: number }).tmdb, 910001);
  assert.deepEqual(
    own(a).map((row) => [row.id, row.data]).sort(),
    own(b).map((row) => [row.id, row.data]).sort(),
  );
  assert.deepEqual([...a.getSnapshot().rejected, ...b.getSnapshot().rejected], []);
});

test("a refresh that lands after the other client's sweep leaves only the new day, which holds no TMDB data, and the rest of the row is untouched", async () => {
  const { server, a, b, ids } = await seeded();
  sweepExpired(own(a), TODAY, a.many);
  idOf(await b.update("items", ids.purge, { data: { tmdb_at: TODAY } }));
  await a.sync();
  await b.sync();
  await a.sync();
  const data = server.row("items", ids.purge)!.data as Record<string, unknown>;
  assert.deepEqual(Object.keys(data).filter((key) => ["cover", "tmdb", "tmdb_at"].includes(key)).sort(), ["tmdb_at"]);
  assert.equal(data.year, 2017);
});

test("no write goes out while the side is unconfirmed, and the next sweep after it is confirmed does the work", async () => {
  const { server, ids } = await seeded();
  const store = createStore({ persistence: memoryPersistence(), api: createApi(server.as("a"), "a"), held: true });
  await store.open();
  const posts = () => server.seen.filter((request) => request.method === "POST").length;
  const before = posts();
  const results: unknown[] = [];
  sweepExpired(own(store), TODAY, async (steps) => (results.push(await store.many(steps)), paused));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(results, [paused]);
  await store.sync();
  assert.equal(posts(), before);
  assert.equal((server.row("items", ids.purge)!.data as { tmdb: number }).tmdb, 910001);
  assert.equal(store.getSnapshot().pending, 0);
  store.release();
  sweepExpired(own(store), TODAY, store.many);
  await store.sync();
  assert.deepEqual(server.row("items", ids.purge)!.data, KEPT);
});

test("a store that has not loaded refuses too, so the sweep before the first load changes nothing", async () => {
  const server = createServer();
  const store = createStore({ persistence: memoryPersistence(), api: createApi(server.as("a"), "a") });
  const rows = [aged(400)] as ItemRow[];
  const results: unknown[] = [];
  sweepExpired(rows, TODAY, async (steps) => (results.push(await store.many(steps)), paused));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(results, [paused]);
  assert.equal(server.seen.filter((request) => request.method === "POST").length, 0);
});

test("the Shell runs the sweep beside the undo sweep, on the rows and today's date, through the store's own many", () => {
  const shell = readFileSync(new URL("../src/ui/shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /useEffect\(\(\) => sweepUndone\(rows\.items, actions\.many\), \[rows\.items\]\);\s*useEffect\(\(\) => sweepExpired\(rows\.items, stamp\(\), actions\.many\), \[rows\.items\]\);/);
  assert.match(shell, /const stamp = useStamp\(\);/);
});
