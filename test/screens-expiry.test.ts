import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ItemRow } from "../shared/tables.ts";
import { validateChange } from "../shared/validate.ts";
import { addDays, todayIn } from "../src/domain/dates.ts";
import { PURGE_DAYS, REFRESH_DAYS, expired, expiredSteps, needsPoster, posterAge, posterPatch, purgePatch, revivePatch } from "../src/domain/tmdb.ts";
import { createApi } from "../src/store/api.ts";
import { memoryPersistence } from "../src/store/memory.ts";
import { createStore, paused } from "../src/store/store.ts";
import type { Snapshot } from "../src/store/store.ts";
import { sweepDay, sweepDeps, sweepExpired } from "../src/ui/screen-save.ts";
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

test("a stamp up to a day ahead is fresh, and one further ahead counts as invalid like a missing stamp", () => {
  for (const days of [0, -1]) {
    assert.equal(posterAge(aged(days), TODAY), days);
    assert.deepEqual([expired(aged(days), TODAY), needsPoster(aged(days), TODAY)], [false, false], String(days));
  }
  for (const stamp of [addDays(TODAY, 2), addDays(TODAY, 3), addDays(TODAY, 400), "9999-12-31"]) {
    const row = aged(5, { tmdb_at: stamp });
    assert.equal(posterAge(row, TODAY), null, stamp);
    assert.deepEqual([expired(row, TODAY), needsPoster(row, TODAY)], [true, true], stamp);
    assert.deepEqual(expiredSteps([row], TODAY).map((step) => step.id), [row.id], stamp);
  }
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

test("the Shell runs the sweep beside the undo sweep, on the server's day, through the store's own many and the readiness deps", () => {
  const shell = readFileSync(new URL("../src/ui/shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /useEffect\(\(\) => sweepUndone\(rows\.items, actions\.many\), \[rows\.items\]\);\s*useEffect\(\(\) => sweepExpired\(rows\.items, sweepDay\(snapshot, actions\.serverNow\(\), timezone\), actions\.many\), \[\.\.\.sweepDeps\(snapshot\), timezone\]\);/);
  assert.doesNotMatch(shell, /useStamp/);
});

const ZONE = "Asia/Jakarta";

const SERVER_DAY = "2027-03-01";

const deviceAt = (at: string) => {
  mock.timers.reset();
  mock.timers.enable({ apis: ["Date"], now: new Date(at) });
};

const fixedServerDate = (server: ReturnType<typeof createServer>, at = `${SERVER_DAY}T05:00:00Z`) => {
  server.control.date = () => new Date(at).toUTCString();
  deviceAt(at);
};

afterEach(() => mock.timers.reset());

test("the sweep day is the server's day in the app's zone, and none while the store is paused, has no side or has not heard from the server", () => {
  const ready = { paused: false, me: "a" as const };
  const now = new Date("2027-03-01T20:00:00Z");
  assert.equal(sweepDay(ready, now, ZONE), "2027-03-02");
  assert.equal(sweepDay(ready, now, "UTC"), "2027-03-01");
  assert.equal(sweepDay({ ...ready, paused: true }, now, ZONE), null);
  assert.equal(sweepDay({ ...ready, me: null }, now, ZONE), null);
  assert.equal(sweepDay(ready, null, ZONE), null);
  const calls: number[] = [];
  sweepExpired([aged(400)], null, async (steps) => (calls.push(steps.length), paused));
  assert.deepEqual(calls, []);
});

test("a store learns the server's time from the Date header of its answers, whatever its own clock says once two answers agree, and knows nothing without one", async () => {
  const server = createServer();
  fixedServerDate(server);
  deviceAt("2027-09-17T05:00:00Z");
  try {
    const store = client(server, "a").store;
    assert.equal(store.serverNow(), null);
    assert.equal(store.getSnapshot().dated, false);
    await store.open();
    assert.equal(store.getSnapshot().dated, false);
    assert.equal(store.serverNow(), null);
    await store.sync();
    assert.equal(store.getSnapshot().dated, true);
    assert.ok(Math.abs(store.serverNow()!.getTime() - new Date(`${SERVER_DAY}T05:00:00Z`).getTime()) < 1000);
    assert.equal(todayIn(store.serverNow()!, ZONE), SERVER_DAY);
  } finally {
    mock.timers.reset();
  }
  const bare = createServer();
  bare.control.date = null;
  const undated = client(bare, "a").store;
  await undated.open();
  idOf(await undated.create("items", { kind: "task", title: "Typed", status: "todo" }));
  await undated.sync();
  assert.deepEqual([undated.serverNow(), undated.getSnapshot().dated, undated.getSnapshot().pending], [null, false, 0]);
  let emits = 0;
  undated.subscribe(() => emits++);
  await undated.sync();
  await undated.sync();
  assert.equal(emits, 0);
});

test("a phone whose clock is 200 days ahead sweeps nothing fresh: the sweep runs on the server's day, and the device's day would have wiped it", async () => {
  const { server, ids } = await seeded();
  const days = (extra: Record<string, unknown>) => ({ original_title: "Last Harbour", year: 2017, cover: POSTER, tmdb: 910001, ...extra });
  const recent = await (async () => {
    const a = client(server, "a").store;
    await a.open();
    return idOf(await a.create("items", { kind: "movie", title: "Baru", status: "want", data: days({ tmdb_at: addDays(SERVER_DAY, -3) }) } as never));
  })();
  fixedServerDate(server);
  deviceAt("2027-09-17T05:00:00Z");
  try {
    const ahead = client(server, "a").store;
    await ahead.open();
    assert.equal(ahead.serverNow(), null);
    await ahead.sync();
    assert.notEqual(ahead.serverNow(), null);
    const items = own(ahead);
    assert.equal(items.length, 7);
    const deviceDay = todayIn(new Date(), ZONE);
    assert.equal(deviceDay, "2027-09-17");
    assert.equal(expiredSteps(items, deviceDay).length, 7);
    const posts = server.seen.filter((request) => request.method === "POST").length;
    sweepExpired(items, sweepDay(ahead.getSnapshot(), ahead.serverNow(), ZONE), ahead.many);
    await ahead.sync();
    assert.equal(server.seen.filter((request) => request.method === "POST").length - posts, 1);
    assert.equal((server.row("items", recent)!.data as { tmdb: number }).tmdb, 910001);
    for (const id of [ids.fresh, ids.refresh, ids.late]) assert.equal((server.row("items", id)!.data as { tmdb: number }).tmdb, 910001, String(id));
    for (const id of [ids.purge, ids.more, ids.none]) assert.deepEqual(server.row("items", id)!.data, KEPT, String(id));
  } finally {
    mock.timers.reset();
  }
});

test("a row stamped in the future is swept on the server's day, a day ahead is kept, and the sweep writes it once", async () => {
  const { server, a } = await seeded();
  fixedServerDate(server);
  const make = async (title: string, stamp: string) =>
    idOf(await a.create("items", { kind: "movie", title, status: "want", data: { cover: POSTER, tmdb: 910001, tmdb_at: stamp } } as never));
  const far = await make("Far", "9999-12-31");
  const year = await make("Year", addDays(SERVER_DAY, 365));
  const edge = await make("Edge", addDays(SERVER_DAY, 1));
  const past = await make("Past", addDays(SERVER_DAY, 2));
  await a.sync();
  sweepExpired(own(a), sweepDay(a.getSnapshot(), a.serverNow(), ZONE), a.many);
  await a.sync();
  for (const id of [far, year, past]) assert.deepEqual(server.row("items", id)!.data, {}, String(id));
  assert.equal((server.row("items", edge)!.data as { tmdb: number }).tmdb, 910001);
});

test("offline with no server date yet, the sweep makes no write and no request", async () => {
  const { server, ids } = await seeded();
  const persistence = memoryPersistence();
  const warm = createStore({ persistence, api: createApi(server.as("a"), "a") });
  await warm.open();
  const rows = own(warm);
  server.control.down = true;
  const cold = createStore({ persistence, api: createApi(server.as("a"), "a") });
  const posts = server.seen.filter((request) => request.method === "POST").length;
  await cold.open();
  assert.equal(cold.serverNow(), null);
  const sent: unknown[] = [];
  sweepExpired(own(cold), sweepDay(cold.getSnapshot(), cold.serverNow(), ZONE), async (steps) => (sent.push(...steps), cold.many(steps)));
  assert.deepEqual(sent, []);
  assert.equal(server.seen.filter((request) => request.method === "POST").length, posts);
  assert.equal(cold.getSnapshot().pending, 0);
  assert.ok(rows.length > 0 && ids.purge.length > 0);
});

const effect = (store: ReturnType<typeof client>["store"], run: (snapshot: Snapshot) => void) => {
  let last: readonly unknown[] | null = null;
  const check = () => {
    const snapshot = store.getSnapshot();
    const deps = sweepDeps(snapshot);
    if (last !== null && deps.every((dep, index) => Object.is(dep, last![index]))) return;
    last = deps;
    run(snapshot);
  };
  check();
  return store.subscribe(check);
};

test("releasing a held store changes only the paused dep of the sweep: same row list, one more reason to run it", async () => {
  const { server } = await seeded();
  const store = createStore({ persistence: memoryPersistence(), api: createApi(server.as("a"), "a"), held: true });
  await store.open();
  await store.sync();
  const before = sweepDeps(store.getSnapshot());
  store.release();
  const after = sweepDeps(store.getSnapshot());
  assert.deepEqual(after.map((dep, index) => !Object.is(dep, before[index])), [false, true, false, false]);
  assert.deepEqual([before[1], after[1], after[3]], [true, false, true]);
});

test("an expired row is swept after the reconnect: the effect runs again when the held store is released, though the row list is the same", async () => {
  const { server, ids } = await seeded();
  fixedServerDate(server);
  const store = createStore({ persistence: memoryPersistence(), api: createApi(server.as("a"), "a"), held: true });
  await store.open();
  const runs: (string | null)[] = [];
  const stop = effect(store, (snapshot) => {
    const day = sweepDay(snapshot, store.serverNow(), ZONE);
    runs.push(day);
    sweepExpired(snapshot.rows.items, day, store.many);
  });
  await store.sync();
  assert.deepEqual(runs, [null]);
  assert.equal((server.row("items", ids.purge)!.data as { tmdb: number }).tmdb, 910001);
  store.release();
  await store.sync();
  stop();
  assert.equal(runs[0], null);
  assert.equal(runs[1], SERVER_DAY);
  assert.deepEqual(server.row("items", ids.purge)!.data, KEPT);
  assert.equal((server.row("items", ids.fresh)!.data as { tmdb: number }).tmdb, 910001);
});

test("the sweep runs again when the first answer from the server arrives after the rows were already on the phone", async () => {
  const { server, ids } = await seeded();
  fixedServerDate(server);
  const persistence = memoryPersistence();
  const warm = createStore({ persistence, api: createApi(server.as("a"), "a") });
  await warm.open();
  server.control.down = true;
  const store = createStore({ persistence, api: createApi(server.as("a"), "a") });
  await store.open();
  const runs: (string | null)[] = [];
  const stop = effect(store, (snapshot) => {
    const day = sweepDay(snapshot, store.serverNow(), ZONE);
    runs.push(day);
    sweepExpired(snapshot.rows.items, day, store.many);
  });
  assert.deepEqual(runs, [null]);
  assert.equal(store.getSnapshot().rows.items.length, 6);
  server.control.down = false;
  await store.sync();
  stop();
  assert.equal(runs[1], SERVER_DAY);
  assert.deepEqual(server.row("items", ids.purge)!.data, KEPT);
});

test("an idle store that gets the same answer again does not wake the Shell: the date arrives once", async () => {
  const server = createServer();
  const store = client(server, "a").store;
  await store.open();
  let emits = 0;
  store.subscribe(() => emits++);
  await store.sync();
  await store.sync();
  assert.equal(emits, 0);
});

test("the first Date header, after answers without one, wakes the Shell once and only then", async () => {
  const server = createServer();
  server.control.date = null;
  const store = client(server, "a").store;
  await store.open();
  assert.equal(store.getSnapshot().dated, false);
  fixedServerDate(server);
  let emits = 0;
  store.subscribe(() => emits++);
  await store.sync();
  assert.deepEqual([store.getSnapshot().dated, emits], [true, 1]);
  await store.sync();
  assert.equal(emits, 1);
});

test("a revive carries the poster keys the row holds, one by one, and nothing when it holds none", () => {
  assert.deepEqual(revivePatch(aged(null, { cover: undefined, tmdb: undefined })), { deleted_at: null });
  assert.deepEqual(revivePatch(aged(null, { cover: undefined })), { deleted_at: null, data: { tmdb: 910001 } });
  assert.deepEqual(revivePatch(aged(5, { year: 2017 })), { deleted_at: null, data: { cover: POSTER, tmdb: 910001, tmdb_at: addDays(TODAY, -5) } });
});

test("a match with no year adds no year, and one with a year adds it only to a row without one", () => {
  const hit = { kind: "movie" as const, tmdb: 910001, title: "Pelabuhan Terakhir", original: null, year: null, cover: POSTER };
  assert.deepEqual(posterPatch(aged(null, { cover: undefined, tmdb: undefined }), hit, TODAY), { tmdb: 910001, tmdb_at: TODAY, cover: POSTER });
  assert.deepEqual(posterPatch(aged(null, { year: 2017 }), { ...hit, year: 2018 }, TODAY).year, undefined);
  assert.equal(posterPatch(aged(null, { cover: undefined, tmdb: undefined }), { ...hit, year: 2018 }, TODAY).year, 2018);
});

const WRONG = "Thu, 01 Jan 2015 05:00:00 GMT";

const posted = (server: ReturnType<typeof createServer>) => server.seen.filter((request) => request.method === "POST").length;

const keepsPosters = (server: ReturnType<typeof createServer>, ids: string[]) => {
  for (const id of ids) assert.equal((server.row("items", id)!.data as { tmdb: number }).tmdb, 910001, id);
};

test("one answer with a 2015 Date never causes a write: the store takes no server time from it, and the sweep that follows has no day", async () => {
  const { server, a, ids } = await seeded();
  await a.sync();
  server.control.date = () => WRONG;
  deviceAt(`${SERVER_DAY}T05:00:00Z`);
  const store = client(server, "a").store;
  await store.open();
  assert.deepEqual([store.getSnapshot().dated, store.serverNow()], [false, null]);
  const posts = posted(server);
  sweepExpired(own(store), sweepDay(store.getSnapshot(), store.serverNow(), ZONE), store.many);
  await store.sync();
  assert.equal(posted(server), posts);
  keepsPosters(server, Object.values(ids));
});

test("a good first answer, then one with a 2015 Date, then a row change: the server day stays the real one and the 3-day-old poster stays", async () => {
  const { server, a, ids } = await seeded();
  fixedServerDate(server);
  const store = client(server, "a").store;
  await store.open();
  const recent = idOf(await store.create("items", { kind: "movie", title: "Baru", status: "want", data: { cover: POSTER, tmdb: 910001, tmdb_at: addDays(SERVER_DAY, -3) } } as never));
  await store.sync();
  assert.equal(todayIn(store.serverNow()!, ZONE), SERVER_DAY);
  server.control.date = () => WRONG;
  await store.sync();
  assert.equal(todayIn(store.serverNow()!, ZONE), SERVER_DAY);
  idOf(await store.update("items", ids.fresh, { note: "Rewatch" } as never));
  await store.sync();
  sweepExpired(own(store), sweepDay(store.getSnapshot(), store.serverNow(), ZONE), store.many);
  await store.sync();
  keepsPosters(server, [recent, ids.fresh, ids.refresh, ids.late]);
  for (const id of [ids.purge, ids.more, ids.none]) assert.deepEqual(server.row("items", id)!.data, KEPT, id);
});

test("a 2015 Date that keeps coming, and one 2100 Date, take nothing either", async () => {
  const { server, ids } = await seeded();
  for (const date of [WRONG, "Fri, 01 Jan 2100 05:00:00 GMT"]) {
    fixedServerDate(server);
    server.control.date = () => date;
    const store = client(server, "a").store;
    await store.open();
    await store.sync();
    await store.sync();
    assert.equal(store.serverNow(), null, date);
    const posts = posted(server);
    sweepExpired(own(store), sweepDay(store.getSnapshot(), store.serverNow(), ZONE), store.many);
    await store.sync();
    assert.equal(posted(server), posts, date);
  }
  keepsPosters(server, Object.values(ids));
});

test("a phone with a wrong clock does not take a Date that the rows it holds contradict, however often it comes", async () => {
  const { server } = await seeded();
  fixedServerDate(server);
  const store = client(server, "a").store;
  await store.open();
  idOf(await store.create("items", { kind: "movie", title: "Ahead", status: "want", data: { cover: POSTER, tmdb: 910001, tmdb_at: addDays(SERVER_DAY, 30) } } as never));
  await store.sync();
  deviceAt("2027-09-17T05:00:00Z");
  const wrong = client(server, "a").store;
  await wrong.open();
  await wrong.sync();
  await wrong.sync();
  assert.equal(wrong.serverNow(), null);
  const calm = createServer();
  fixedServerDate(calm);
  deviceAt("2027-09-17T05:00:00Z");
  const other = client(calm, "a").store;
  await other.open();
  await other.sync();
  assert.notEqual(other.serverNow(), null);
});
