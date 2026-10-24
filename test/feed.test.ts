import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { FeedStatus, Side } from "../shared/api.ts";
import { SIDE_HEADER } from "../shared/api.ts";
import { tableNames } from "../shared/tables.ts";
import { createWorker } from "../worker/index.ts";
import type { Bindings } from "../worker/index.ts";
import { same } from "../worker/feed.ts";
import { parse } from "./ics-parse.ts";
import { createDb, id, mutation } from "./sync-db.ts";

const ORIGIN = "https://wp.example.test";

const NOW = new Date("2026-10-24T03:00:00Z");

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

const setup = () => {
  const { db, sqlite, calls } = createDb();
  const worker = createWorker();
  const env = (who: Side | null): Bindings => ({ DB: db, DESIGN: { get: async () => null }, ...(who === null ? {} : { AUTH_MODE: "dev" as const, DEV_WHO: who }) });
  const as = (who: Side) => (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, init), env(who));
  const anon = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`${ORIGIN}${path}`, init), env(null));
  const json = { "content-type": "application/json" };
  const rotate = async (who: Side) => ((await (await as(who)("/api/feed", { method: "POST", headers: json, body: "{}" })).json()) as { token: string }).token;
  const status = async (who: Side) => (await (await as(who)("/api/feed")).json()) as FeedStatus;
  const push = async (who: Side, ...rows: Record<string, unknown>[]) => {
    const res = await as(who)("/api/sync", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ mutations: rows.map((row) => mutation("create", "items", row.id as string, row)) }),
    });
    assert.equal(res.status, 200, await res.clone().text());
  };
  return { db, sqlite, calls, as, anon, rotate, status, push, json };
};

const stamps = { created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };

const routine = (n: number, title: string, who: Side | "both", data: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id: id(n),
  kind: "routine",
  title,
  who,
  data,
  ...stamps,
  ...extra,
});

const block = (n: number, parent: number, title: string, data: Record<string, unknown>) => ({ id: id(n), kind: "block", title, parent_id: id(parent), data, ...stamps });

const fetchFeed = (call: ReturnType<typeof setup>["anon"], token: string, init: RequestInit = {}) => call(`/feed/${token}.ics`, init);

const summaries = async (res: Response) => parse(await res.text()).events.map((event) => event.summary).sort();

test("migration 0002 applies on real SQLite after 0001 and adds only the server-only table", () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const name of readdirSync(new URL("../migrations/", import.meta.url)).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  const names = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((row) => row.name);
  assert.deepEqual(names, ["budget_entries", "feed_tokens", "items", "settings", "sync_state"]);
  assert.deepEqual(
    (sqlite.prepare("SELECT name FROM pragma_table_info('feed_tokens') ORDER BY cid").all() as { name: string }[]).map((row) => row.name),
    ["who", "hash", "created_at", "fetched_at"],
  );
  assert.ok(!tableNames.includes("feed_tokens" as never));
  const insert = (who: string, hash: string, created = "2026-10-24T00:00:00Z") => sqlite.prepare("INSERT INTO feed_tokens (who, hash, created_at) VALUES (?, ?, ?)").run(who, hash, created);
  insert("a", sha("one"));
  assert.throws(() => insert("a", sha("two")), /UNIQUE|PRIMARY/);
  assert.throws(() => insert("b", sha("one")), /UNIQUE/);
  assert.throws(() => insert("c", sha("three")));
  assert.throws(() => insert("b", "abc"));
  assert.throws(() => insert("b", sha("four").toUpperCase()));
  assert.throws(() => insert("b", sha("five"), "yesterday"));
  insert("b", sha("six"));
  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM feed_tokens").get() as { n: number }).n, 2);
});

test("a token is 256 random bits in lowercase hex, never repeats, and rotation replaces it at once", async () => {
  const { rotate, anon, sqlite } = setup();
  const seen = new Set<string>();
  for (let n = 0; n < 50; n++) {
    const token = await rotate("a");
    assert.match(token, /^[0-9a-f]{64}$/);
    seen.add(token);
  }
  assert.equal(seen.size, 50);
  const [first] = seen;
  assert.equal((await fetchFeed(anon, first)).status, 404);
  assert.equal((await fetchFeed(anon, [...seen].at(-1)!)).status, 200);
  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM feed_tokens").get() as { n: number }).n, 1);
  const bits = [...seen].map((token) => [...token].reduce((sum, char) => sum + parseInt(char, 16).toString(2).replaceAll("0", "").length, 0));
  for (const ones of bits) assert.ok(ones > 80 && ones < 176, `${ones} one-bits out of 256`);
});

test("a valid token serves the feed with the quiet headers, and HEAD gives the same headers without a body", async () => {
  const { rotate, anon, push } = setup();
  await push("a", routine(1, "Bag", "a", { start_time: "07:00", duration: 15 }));
  const token = await rotate("a");
  const res = await fetchFeed(anon, token);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/calendar; charset=utf-8");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("set-cookie"), null);
  assert.deepEqual(await summaries(res), ["Bag"]);
  const head = await fetchFeed(anon, token, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  for (const name of ["content-type", "cache-control", "x-robots-tag", "referrer-policy"]) assert.equal(head.headers.get(name), res.headers.get(name));
});

test("the feed needs no Access JWT and no cookie, while the management route still needs a signed-in partner", async () => {
  const { anon, as, rotate } = setup();
  const token = await rotate("b");
  assert.equal((await anon(`/feed/${token}.ics`, { headers: {} })).status, 200);
  assert.equal((await anon("/api/feed")).status, 401);
  assert.equal((await anon("/api/feed", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 401);
  assert.equal((await as("a")("/api/feed")).status, 200);
});

test("an unknown token and every malformed one get the same 404, with the same body and headers and the same database work", async () => {
  const { rotate, anon, calls } = setup();
  const token = await rotate("a");
  const flipped = `${token.slice(0, 63)}${token[63] === "0" ? "1" : "0"}`;
  const bad = [
    "0".repeat(64),
    flipped,
    "",
    "a",
    token.slice(0, 63),
    `${token}0`,
    token.toUpperCase(),
    `${token.slice(0, 63)}g`,
    `${token.slice(0, 32)}%2e${token.slice(34)}`,
    `${token}/..`,
    "x".repeat(5000),
    "é".repeat(40),
  ];
  const results: [string, number, string, string][] = [];
  for (const candidate of bad) {
    calls.length = 0;
    const res = await fetchFeed(anon, candidate);
    results.push([candidate.slice(0, 10), res.status, await res.text(), JSON.stringify([...res.headers].sort())]);
    assert.deepEqual(calls.map((call) => call.length), [1], `database work for ${candidate.slice(0, 10)}`);
    assert.match(calls[0][0], /FROM feed_tokens/);
  }
  calls.length = 0;
  await fetchFeed(anon, token);
  assert.ok(calls.length > 1);
  for (const [name, status, body, headers] of results) {
    assert.equal(status, 404, name);
    assert.equal(body, results[0][2], name);
    assert.equal(headers, results[0][3], name);
  }
  assert.equal(results[0][2], '{"error":"not_found"}');
  for (const path of ["/feed/", "/feed/x", `/feed/${token}`, `/feed/${token}.ICS`, `/feed/${token}.ics/`, `/feed//${token}.ics`, `/feed/${token}.ics.ics`]) {
    const res = await anon(path);
    assert.equal(res.status, 404, path);
    assert.equal(await res.text(), results[0][2], path);
  }
});

test("other methods on the feed are refused the same way whatever the token", async () => {
  const { rotate, anon } = setup();
  const token = await rotate("a");
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    for (const candidate of [token, "0".repeat(64), "x"]) {
      const res = await anon(`/feed/${candidate}.ics`, { method });
      assert.equal(res.status, 405, `${method} ${candidate.slice(0, 4)}`);
      assert.equal(res.headers.get("allow"), "GET, HEAD");
    }
  }
  assert.equal((await fetchFeed(anon, token)).status, 200);
});

test("revoking a token ends the feed, and a new token does not revive the old one", async () => {
  const { rotate, anon, as, status, json } = setup();
  const first = await rotate("a");
  assert.equal((await fetchFeed(anon, first)).status, 200);
  const res = await as("a")("/api/feed", { method: "DELETE", headers: json, body: "{}" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { active: false });
  assert.equal((await fetchFeed(anon, first)).status, 404);
  assert.deepEqual(await status("a"), { active: false });
  const second = await rotate("a");
  assert.equal((await fetchFeed(anon, first)).status, 404);
  assert.equal((await fetchFeed(anon, second)).status, 200);
  assert.equal((await as("a")("/api/feed", { method: "DELETE", headers: json, body: "{}" })).status, 200);
  assert.equal((await as("a")("/api/feed", { method: "DELETE", headers: json, body: "{}" })).status, 200);
});

test("revoking one partner's feed leaves the other's token working", async () => {
  const { rotate, anon, as, json } = setup();
  const a = await rotate("a");
  const b = await rotate("b");
  await as("a")("/api/feed", { method: "DELETE", headers: json, body: "{}" });
  assert.equal((await fetchFeed(anon, a)).status, 404);
  assert.equal((await fetchFeed(anon, b)).status, 200);
  await rotate("a");
  assert.equal((await fetchFeed(anon, b)).status, 200);
});

test("the status shows never fetched, then the fetch time, and a rotation starts over", async () => {
  const { rotate, anon, status } = setup();
  assert.deepEqual(await status("a"), { active: false });
  const token = await rotate("a");
  const fresh = await status("a");
  assert.ok(fresh.active);
  assert.match(fresh.created_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.equal(fresh.fetched_at, null);
  assert.equal((await fetchFeed(anon, "0".repeat(64))).status, 404);
  assert.equal((await status("a") as { fetched_at: string | null }).fetched_at, null);
  await fetchFeed(anon, token);
  const used = await status("a");
  assert.ok(used.active && used.fetched_at !== null);
  assert.match(used.fetched_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  await rotate("a");
  assert.equal((await status("a") as { fetched_at: string | null }).fetched_at, null);
});

test("each token yields its own partner's view only; private routines of either partner are in nobody's feed", async () => {
  const { rotate, anon, push } = setup();
  await push(
    "a",
    routine(1, "A only", "a", { start_time: "07:00", duration: 15 }),
    routine(2, "A private", "a", { start_time: "07:30", duration: 15, private: true }),
    routine(3, "Shared", "both", { start_time: "08:00", duration: 15 }),
    routine(4, "A timetable", "a", { holidays: true }, { group_key: "timetable" }),
    block(5, 4, "A class", { days: "MO", start_time: "09:00" }),
  );
  await push(
    "b",
    routine(11, "B only", "b", { start_time: "07:10", duration: 15 }),
    routine(12, "B private", "b", { start_time: "07:40", duration: 15, private: true }),
    routine(14, "B timetable", "b", { holidays: true }, { group_key: "timetable" }),
    block(15, 14, "B class", { days: "TU", start_time: "10:00" }),
    routine(16, "B private timetable", "b", { private: true }, { group_key: "timetable" }),
    block(17, 16, "B hidden class", { days: "WE", start_time: "10:00" }),
  );
  const a = await rotate("a");
  const b = await rotate("b");
  assert.deepEqual(await summaries(await fetchFeed(anon, a)), ["A class", "A only", "Shared"]);
  assert.deepEqual(await summaries(await fetchFeed(anon, b)), ["B class", "B only", "Shared"]);
  for (const token of [a, b]) {
    const text = await (await fetchFeed(anon, token)).text();
    assert.ok(!/private|hidden/i.test(text));
  }
});

test("a deleted routine, a deleted block and a routine whose private flag is set leave the feed at once", async () => {
  const { rotate, anon, push, as, json } = setup();
  await push("a", routine(1, "Gone soon", "a", { start_time: "07:00", duration: 15 }), routine(2, "Kept", "a", { start_time: "08:00", duration: 15 }));
  const token = await rotate("a");
  assert.deepEqual(await summaries(await fetchFeed(anon, token)), ["Gone soon", "Kept"]);
  const res = await as("a")("/api/sync", { method: "POST", headers: json, body: JSON.stringify({ mutations: [mutation("delete", "items", id(1))] }) });
  assert.equal(res.status, 200);
  assert.deepEqual(await summaries(await fetchFeed(anon, token)), ["Kept"]);
});

test("holidays in the settings become EXDATEs", async () => {
  const { rotate, anon, push, as, json } = setup();
  await push("a", routine(1, "Timetable", "a", { holidays: true }, { group_key: "timetable" }), block(2, 1, "Class", { days: "MO", start_time: "09:00" }));
  const token = await rotate("a");
  const before = await (await fetchFeed(anon, token)).text();
  assert.ok(!before.includes("EXDATE"));
  const holidays = JSON.stringify(["2099-01-01", "2026-11-02", "not a date"]);
  const set = { id: id(777), table: "settings", op: "create", row_id: "holidays", patch: { key: "holidays", value: holidays, ...stamps } };
  assert.equal((await as("a")("/api/sync", { method: "POST", headers: json, body: JSON.stringify({ mutations: [set] }) })).status, 400);
  const good = { ...set, patch: { ...set.patch, value: JSON.stringify(["2026-11-02"]) } };
  assert.equal((await as("a")("/api/sync", { method: "POST", headers: json, body: JSON.stringify({ mutations: [good] }) })).status, 200);
  const after = await (await fetchFeed(anon, token)).text();
  assert.ok(after.includes("EXDATE;TZID=Asia/Jakarta:20261102T090000"));
  assert.equal(parse(after).events.length, 1);
});

test("the plain token is never stored: the database holds only its SHA-256, and no table cell contains the token", async () => {
  const { rotate, sqlite, push } = setup();
  await push("a", routine(1, "Bag", "a", { start_time: "07:00", duration: 15 }));
  const token = await rotate("a");
  const rows = (sqlite.prepare("SELECT who, hash FROM feed_tokens").all() as { who: string; hash: string }[]).map((row) => ({ ...row }));
  assert.deepEqual(rows, [{ who: "a", hash: sha(token) }]);
  assert.notEqual(rows[0].hash, token);
  const tables = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((row) => row.name);
  for (const table of tables) {
    for (const row of sqlite.prepare(`SELECT * FROM ${table}`).all()) {
      for (const value of Object.values(row)) assert.ok(!String(value).includes(token), `${table} holds the token`);
    }
  }
});

test("neither the status, the sync, the exports nor the other partner's screens ever carry a token or its hash", async () => {
  const { rotate, as, status, push } = setup();
  await push("a", routine(1, "Bag", "a", { start_time: "07:00", duration: 15 }), routine(2, "Secret", "a", { private: true, start_time: "07:00" }));
  const a = await rotate("a");
  const b = await rotate("b");
  const seen: string[] = [];
  for (const who of ["a", "b"] as Side[]) {
    const headers = { [SIDE_HEADER]: who };
    for (const path of ["/api/sync?since=0", "/api/export?format=json", "/api/export?format=csv&table=items&kind=routine", "/api/export?format=csv&table=items&kind=block", "/api/feed", "/api/health", "/api/me"]) {
      const res = await as(who)(path, { headers });
      seen.push(`${who} ${path} ${await res.text()}`, [...res.headers].join(";"));
    }
  }
  seen.push(JSON.stringify(await status("a")), JSON.stringify(await status("b")));
  for (const dump of seen) for (const secret of [a, b, sha(a), sha(b)]) assert.ok(!dump.includes(secret), dump.slice(0, 60));
});

test("a partner learns nothing about the other's feed: the status is their own, and a mismatched side claim is a 409", async () => {
  const { rotate, as, status, json } = setup();
  assert.deepEqual(await status("b"), { active: false });
  await rotate("a");
  assert.deepEqual(await status("b"), { active: false });
  assert.ok((await status("a")).active);
  const mismatch = await as("b")("/api/feed", { headers: { [SIDE_HEADER]: "a" } });
  assert.equal(mismatch.status, 409);
  assert.deepEqual(await mismatch.json(), { error: "side_mismatch", me: "b" });
  const refused = await as("b")("/api/feed", { method: "POST", headers: { ...json, [SIDE_HEADER]: "a" }, body: "{}" });
  assert.equal(refused.status, 409);
  assert.ok((await status("a")).active);
  await as("b")("/api/feed", { method: "DELETE", headers: json, body: "{}" });
  assert.ok((await status("a")).active);
});

test("creating or revoking needs a JSON request from the same site, and the token is returned once and no-store", async () => {
  const { as, status } = setup();
  const post = (init: RequestInit) => as("a")("/api/feed", { method: "POST", body: "{}", ...init });
  assert.equal((await post({ headers: { "content-type": "text/plain" } })).status, 415);
  assert.equal((await post({ headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" } })).status, 403);
  assert.equal((await post({ headers: { "content-type": "application/json", origin: "https://evil.example.test" } })).status, 403);
  assert.deepEqual(await status("a"), { active: false });
  const ok = await post({ headers: { "content-type": "application/json", origin: ORIGIN, "sec-fetch-site": "same-origin" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "no-store");
  const body = (await ok.json()) as Record<string, string>;
  assert.deepEqual(Object.keys(body).sort(), ["created_at", "token"]);
  assert.ok(!JSON.stringify(await status("a")).includes(body.token));
  assert.equal((await as("a")("/api/feed", { method: "PUT" })).status, 405);
});

test("the token never reaches a log or an error body, even when the database fails", async () => {
  const { db } = createDb();
  const token = "ab".repeat(32);
  const logged: unknown[][] = [];
  const spies = (["log", "warn", "error", "info", "debug"] as const).map((name) => {
    const original = console[name];
    console[name] = (...args: unknown[]) => void logged.push(args);
    return () => void (console[name] = original);
  });
  try {
    const broken: Bindings = {
      DESIGN: { get: async () => null },
      DB: { ...db, prepare: () => { throw new Error(`boom ${token}`); }, batch: async () => { throw new Error(`boom ${token}`); } },
    };
    const res = await createWorker().fetch(new Request(`${ORIGIN}/feed/${token}.ics`), broken);
    assert.equal(res.status, 500);
    assert.ok(!(await res.text()).includes(token));
  } finally {
    for (const restore of spies) restore();
  }
  assert.ok(!JSON.stringify(logged).includes(token));
  assert.ok(logged.length > 0);
});

test("same() compares every byte even after a difference, and tells different lengths apart", () => {
  const bytes = (text: string) => new TextEncoder().encode(text);
  const reads: number[] = [];
  const watched = (data: Uint8Array) =>
    new Proxy(data, {
      get: (target, key) => {
        if (typeof key === "string" && /^\d+$/.test(key)) reads.push(Number(key));
        return Reflect.get(target, key);
      },
    });
  const right = bytes(sha("x"));
  const wrong = bytes(sha("y"));
  for (const at of [0, 31, 63]) {
    const other = Uint8Array.from(right);
    other[at] ^= 1;
    reads.length = 0;
    assert.equal(same(watched(right), other), false, `difference at ${at}`);
    assert.equal(reads.length, 64, `bytes read with a difference at ${at}`);
  }
  reads.length = 0;
  assert.equal(same(watched(right), wrong), false);
  assert.equal(reads.length, 64);
  assert.equal(same(right, Uint8Array.from(right)), true);
  assert.equal(same(right, right.slice(0, 63)), false);
  assert.equal(same(right.slice(0, 63), right), false);
  assert.equal(same(new Uint8Array(0), new Uint8Array(0)), true);
  assert.equal(same(bytes("a"), new Uint8Array(0)), false);
});

test("the stored hash is compared only through same(), for every row, with no early exit", () => {
  const source = readFileSync(new URL("../worker/feed.ts", import.meta.url), "utf8");
  assert.match(source, /for \(const row of results\) if \(same\(digest, encoder\.encode\(String\(row\.hash\)\)\)\) found = row\.who as Side;/);
  assert.doesNotMatch(source, /\.hash\s*[!=]==?|[!=]==?\s*row\.hash|digest\s*[!=]==?|\.includes\(.*hash|\bWHERE hash\b/);
  assert.doesNotMatch(source, /console\./);
  assert.match(source, /crypto\.getRandomValues\(new Uint8Array\(TOKEN_BYTES\)\)/);
  assert.match(source, /const TOKEN_BYTES = 32;/);
});

test("run_worker_first gains /feed/* and the asset settings are otherwise unchanged", () => {
  const config = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")) as { assets: Record<string, unknown>; routes: unknown; env: { dev: { routes: unknown[] } } };
  assert.deepEqual(config.assets, { not_found_handling: "single-page-application", run_worker_first: ["/api/*", "/design/*", "/feed/*"] });
  assert.deepEqual(config.routes, [{ pattern: "wp.atqamz.com", custom_domain: true }]);
});

test("nothing else changed for the other routes: /api and /design still need a partner, anything else is a 404 before authentication", async () => {
  const { anon, as } = setup();
  assert.equal((await anon("/api/health")).status, 401);
  assert.equal((await anon("/design/round2/")).status, 401);
  assert.equal((await anon("/")).status, 404);
  assert.equal((await anon("/feeds/x.ics")).status, 404);
  assert.equal((await anon("/feed")).status, 404);
  assert.equal((await as("a")("/api/health")).status, 200);
  assert.equal((await as("a")("/design/round2/")).status, 404);
});

test("migration 0002 pins every constraint of feed_tokens, including the ones SQLite leaves open on a TEXT primary key", () => {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of readdirSync(new URL("../migrations/", import.meta.url)).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  const stamp = "2026-10-24T00:00:00Z";
  const put = (who: string | null, hash: string | null, created: string | null, fetched: string | null = null) =>
    sqlite.prepare("INSERT INTO feed_tokens (who, hash, created_at, fetched_at) VALUES (?, ?, ?, ?)").run(who, hash, created, fetched);
  assert.throws(() => put("a", null, stamp), /NOT NULL/);
  assert.throws(() => put("a", sha("x"), null), /NOT NULL/);
  assert.throws(() => put("a", sha("x"), stamp, "yesterday"), /CHECK/);
  assert.throws(() => put("a", sha("x"), stamp, "2026-10-24"), /CHECK/);
  assert.throws(() => put("a", "g".repeat(64), stamp), /CHECK/);
  assert.throws(() => put("a", "a".repeat(65), stamp), /CHECK/);
  assert.throws(() => put("a", "a".repeat(63), stamp), /CHECK/);
  assert.throws(() => put("a", "", stamp), /CHECK/);
  assert.throws(() => put("A", sha("x"), stamp), /CHECK/);
  assert.throws(() => put("ab", sha("x"), stamp), /CHECK/);
  assert.throws(() => put("a", sha("x"), "2026-10-24 00:00:00"), /CHECK/);
  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM feed_tokens").get() as { n: number }).n, 0);
  put("a", sha("x"), stamp, null);
  put("b", sha("y"), stamp, "2026-10-24T01:02:03Z");
  assert.throws(() => put("a", sha("z"), stamp), /UNIQUE|PRIMARY/);
});

test("who is not declared NOT NULL: SQLite accepts a NULL who on a TEXT primary key, and no code path can write one", async () => {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of readdirSync(new URL("../migrations/", import.meta.url)).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  const stamp = "2026-10-24T00:00:00Z";
  sqlite.prepare("INSERT INTO feed_tokens (who, hash, created_at) VALUES (NULL, ?, ?)").run(sha("one"), stamp);
  sqlite.prepare("INSERT INTO feed_tokens (who, hash, created_at) VALUES (NULL, ?, ?)").run(sha("two"), stamp);
  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM feed_tokens WHERE who IS NULL").get() as { n: number }).n, 2);
  const source = readFileSync(new URL("../worker/feed.ts", import.meta.url), "utf8");
  assert.equal([...source.matchAll(/INSERT INTO feed_tokens/g)].length, 1);
  assert.match(source, /export const rotateFeed = async \(db: Db, who: Side,/);
  const { as, sqlite: live } = setup();
  assert.equal((await as("a")("/api/feed", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 200);
  assert.deepEqual(live.prepare("SELECT who FROM feed_tokens").all().map((row) => row.who), ["a"]);
});

test("rotation is one INSERT ... ON CONFLICT DO UPDATE statement, and with two rotations at once exactly the last writer's token is live", async () => {
  const { rotate, anon, calls, sqlite } = setup();
  calls.length = 0;
  await rotate("a");
  const writes = calls.filter(([sql]) => /feed_tokens/.test(sql) && !/^SELECT/.test(sql));
  assert.equal(writes.length, 1);
  assert.match(writes[0][0], /^INSERT INTO feed_tokens \(who, hash, created_at, fetched_at\) VALUES \(\?, \?, \?, NULL\) ON CONFLICT \(who\) DO UPDATE SET hash = excluded\.hash, created_at = excluded\.created_at, fetched_at = NULL$/);
  for (let round = 0; round < 20; round++) {
    const tokens = await Promise.all([rotate("a"), rotate("a"), rotate("a")]);
    const live = (await Promise.all(tokens.map(async (token) => (await fetchFeed(anon, token)).status))).map((status, at) => (status === 200 ? at : -1)).filter((at) => at >= 0);
    assert.equal(live.length, 1, `round ${round}`);
    const rows = sqlite.prepare("SELECT hash FROM feed_tokens").all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].hash, sha(tokens[live[0]]));
  }
  const first = await rotate("a");
  const second = await rotate("a");
  assert.equal((await fetchFeed(anon, first)).status, 404);
  assert.equal((await fetchFeed(anon, second)).status, 200);
});

test("a length above one day is refused when a routine is saved, clamped to 1440 in the feed, and an older row above the cap neither blocks an edit nor breaks the feed", async () => {
  const { push, as, anon, rotate, sqlite, json } = setup();
  const sync = (who: Side, rows: Record<string, unknown>[]) => as(who)("/api/sync", { method: "POST", headers: json, body: JSON.stringify({ mutations: rows.map((row) => mutation("create", "items", row.id as string, row)) }) });
  const refused = await sync("a", [routine(1, "Too long", "a", { start_time: "07:00", duration: 99999 })]);
  assert.equal(refused.status, 400);
  assert.match(JSON.stringify(await refused.json()), /data\.duration: must be at most 1440/);
  assert.equal((await sync("a", [routine(2, "Day long", "a", { start_time: "07:00", duration: 1441 })])).status, 400);
  await push("a", routine(3, "Edge", "a", { start_time: "07:00", duration: 1440 }));
  sqlite.prepare("INSERT INTO items (id, kind, title, who, data, sort, rev, created_at, updated_at) VALUES (?, 'routine', 'Old row', 'a', ?, 0, 1, ?, ?)").run(id(4), JSON.stringify({ start_time: "08:00", duration: 99999 }), stamps.created_at, stamps.updated_at);
  const token = await rotate("a");
  const events = parse(await (await fetchFeed(anon, token)).text()).events;
  assert.deepEqual(events.map((event) => [event.summary, event.minutes]).sort(), [["Edge", 1440], ["Old row", 1440]]);
  const edit = await as("a")("/api/sync", { method: "POST", headers: json, body: JSON.stringify({ mutations: [mutation("update", "items", id(4), { title: "Renamed" })] }) });
  assert.equal(edit.status, 200, await edit.clone().text());
  const fix = await as("a")("/api/sync", { method: "POST", headers: json, body: JSON.stringify({ mutations: [mutation("update", "items", id(4), { data: { duration: 99999 } })] }) });
  assert.equal(fix.status, 400);
  const shorter = await as("a")("/api/sync", { method: "POST", headers: json, body: JSON.stringify({ mutations: [mutation("update", "items", id(4), { data: { duration: 45 } })] }) });
  assert.equal(shorter.status, 200);
  assert.deepEqual(parse(await (await fetchFeed(anon, token)).text()).events.map((event) => [event.summary, event.minutes]).sort(), [["Edge", 1440], ["Renamed", 45]]);
});

test("created_at and fetched_at accept a 9 and refuse a non-digit in every digit position of the date, and need the T and the Z", () => {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of readdirSync(new URL("../migrations/", import.meta.url)).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  let n = 0;
  const put = (created: string, fetched: string | null) => sqlite.prepare("INSERT INTO feed_tokens (who, hash, created_at, fetched_at) VALUES (?, ?, ?, ?)").run(n % 2 === 0 ? "a" : "b", sha(`k${++n}`), created, fetched);
  const clear = () => void sqlite.exec("DELETE FROM feed_tokens");
  put("9999-99-99T99:99:99Z", "9999-99-99T99:99:99Z");
  clear();
  for (const at of [0, 1, 2, 3, 5, 6, 8, 9]) {
    const stamp = "2026-10-24T00:00:00Z";
    const broken = `${stamp.slice(0, at)}x${stamp.slice(at + 1)}`;
    assert.throws(() => put(broken, null), /CHECK/, `created_at position ${at}`);
    assert.throws(() => put(stamp, broken), /CHECK/, `fetched_at position ${at}`);
  }
  for (const stamp of ["2026-10-24X00:00:00Z", "2026/10/24T00:00:00Z", "2026-10-24T00:00:00", "2026-10-24T"]) {
    assert.throws(() => put(stamp, null), /CHECK/, stamp);
    assert.throws(() => put("2026-10-24T00:00:00Z", stamp), /CHECK/, stamp);
  }
  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM feed_tokens").get() as { n: number }).n, 0);
});
