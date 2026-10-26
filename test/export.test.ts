import { test } from "node:test";
import assert from "node:assert/strict";
import type { Rejection } from "../shared/api.ts";
import { exportData } from "../worker/export.ts";
import { pull } from "../worker/sync.ts";
import { STAMP, apply, createDb, id, mutation, payment, planned, setting, task, vendor } from "./sync-db.ts";

const get = (db: ReturnType<typeof createDb>["db"], query: string) => exportData(new URL(`https://wp.example.test/api/export?${query}`), db, "a");

const seeded = async () => {
  const env = createDb();
  const result = await apply(env.db, [
    vendor(20, { data: { phone: "+628123456789", pic: "Sam" }, amount: 5000 }),
    task(4, { title: "Book the venue", sort: 2, note: "line one\nline two", data: { decision: true } }),
    task(5, { title: "Gone" }),
    planned(10, { vendor_id: id(20) }),
    payment(30, 10, { data: { proof_url: "https://example.test/p" } }),
    setting("timezone", "Asia/Jakarta"),
  ]);
  assert.equal("errors" in result, false);
  await apply(env.db, [mutation("delete", "items", id(5))]);
  return env;
};

const parse = (csv: string) => csv.split("\r\n").slice(0, -1);

test("json export is a lossless dump of all three tables with tombstones", async () => {
  const { db, sqlite } = await seeded();
  const res = await get(db, "format=json");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /application\/json/);
  assert.match(res.headers.get("content-disposition") ?? "", /^attachment; filename="export-\d{4}-\d\d-\d\d\.json"$/);
  const body = (await res.json()) as { format_version: number; exported_at: string; rev: number; tables: Record<string, Record<string, unknown>[]> };
  assert.equal(body.format_version, 1);
  assert.match(body.exported_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.equal(body.rev, 2);
  assert.deepEqual(Object.keys(body.tables).sort(), ["budget_entries", "items", "settings"]);
  assert.deepEqual(body.tables, (await pull(db, 0, "a")).changes);
  assert.equal(body.tables.items.length, 3);
  assert.equal(body.tables.items.find((row) => row.id === id(5))?.deleted_at, STAMP);
  assert.deepEqual(body.tables.items.find((row) => row.id === id(20))?.data, { phone: "+628123456789", pic: "Sam" });
  for (const [table, rows] of Object.entries(body.tables)) {
    const raw = sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number };
    assert.equal(rows.length, raw.n);
  }
});

test("json export of an empty database", async () => {
  const body = (await (await get(createDb().db, "format=json")).json()) as { rev: number; tables: unknown };
  assert.equal(body.rev, 0);
  assert.deepEqual(body.tables, { items: [], budget_entries: [], settings: [] });
});

test("csv export has a header from the registry and one row per live row of the kind", async () => {
  const { db } = await seeded();
  const res = await get(db, "format=csv&table=items&kind=task");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "text/csv; charset=utf-8");
  assert.equal(res.headers.get("content-disposition"), 'attachment; filename="items-task.csv"');
  const lines = parse(await res.text());
  assert.equal(
    lines[0],
    "id,kind,title,status,group_key,due_on,done_on,amount,currency,qty,who,note,sort,rev,created_at,updated_at,updated_by,deleted_at,data.start_on,data.decision,data.rules",
  );
  assert.equal(lines.length, 2);
  assert.match(lines[1], new RegExp(`^${id(4)},task,Book the venue,todo,,,,,IDR,,,"line one\nline two",2,1,.*,a,,,true,$`));
  const text = await (await get(db, "format=csv&table=items&kind=task")).text();
  assert.equal(text.endsWith("\r\n"), true);
  assert.equal(text.includes("Gone"), false);
});

test("csv export covers the other items kinds and budget entries", async () => {
  const { db } = await seeded();
  const vendors = parse(await (await get(db, "format=csv&table=items&kind=vendor")).text());
  assert.equal(vendors[0], "id,kind,title,status,group_key,amount,currency,sort,rev,created_at,updated_at,updated_by,deleted_at,data.phone,data.pic,data.contract_url,data.facts");
  assert.match(vendors[1], /,'\+628123456789,Sam,,$/);
  const payments = parse(await (await get(db, "format=csv&table=budget_entries&entry_type=payment")).text());
  assert.equal(payments[0], "id,entry_type,budget_id,title,status,amount,currency,due_on,done_on,who,sort,rev,created_at,updated_at,updated_by,deleted_at,data.proof_url");
  assert.match(payments[1], /,https:\/\/example.test\/p$/);
  const plans = parse(await (await get(db, "format=csv&table=budget_entries&entry_type=planned")).text());
  assert.equal(plans[0], "id,entry_type,vendor_id,title,group_key,amount,currency,sort,rev,created_at,updated_at,updated_by,deleted_at");
  assert.equal(plans.length, 2);
  assert.equal(parse(await (await get(db, "format=csv&table=items&kind=guest")).text()).length, 1);
});

test("csv cells are quoted per RFC 4180", async () => {
  const { db } = createDb();
  await apply(db, [task(4, { title: 'He said "hi", twice', note: "a\nb" })]);
  const text = await (await get(db, "format=csv&table=items&kind=task")).text();
  assert.match(text, /"He said ""hi"", twice"/);
  assert.match(text, /"a\nb"/);
});

test("csv cells starting with = + - @ cannot become formulas", async () => {
  const { db } = createDb();
  const titles = ["=1+1", "+1", "-1", "@SUM(A1)", '=HYPERLINK("http://example.test")'];
  const mutations = titles.map((title, i) => task(10 + i, { title, note: title, data: { rules: title } }));
  assert.equal("errors" in (await apply(db, [...mutations, task(20, { note: "\t=1" })])), false);
  const text = await (await get(db, "format=csv&table=items&kind=task")).text();
  for (const title of titles.slice(0, 4)) {
    assert.equal(text.split(`'${title}`).length - 1, 3, title);
    assert.equal(text.split(/,|\r\n/).includes(title), false, title);
  }
  assert.ok(text.includes(`,"'=HYPERLINK(""http://example.test"")",`));
  assert.ok(text.includes(",'\t=1,"));
});

test("a negative number is not a formula", async () => {
  const { db } = createDb();
  await apply(db, [task(4, { sort: -1.5 })]);
  const lines = parse(await (await get(db, "format=csv&table=items&kind=task")).text());
  assert.match(lines[1], /,-1.5,/);
});

test("csv export rejects bad parameters with a Rejection and no index", async () => {
  const { db } = createDb();
  const bad = [
    "",
    "format=xml",
    "format=csv",
    "format=csv&table=settings",
    "format=csv&table=users",
    "format=csv&table=items",
    "format=csv&table=items&kind=nothing",
    "format=csv&table=items&kind=__proto__",
    "format=csv&table=items&kind=constructor",
    "format=csv&table=items&entry_type=task",
    "format=csv&table=budget_entries&kind=planned",
    "format=csv&table=budget_entries&entry_type=task",
  ];
  for (const query of bad) {
    const res = await get(db, query);
    assert.equal(res.status, 400, query);
    const body = (await res.json()) as Rejection;
    assert.equal(body.status, 400);
    assert.ok(body.errors.length > 0);
    assert.equal("index" in body, false);
  }
});

test("imported rows may carry CR: it is quoted and a leading CR is guarded", async () => {
  const { db, sqlite } = createDb();
  await apply(db, [task(4), task(5, { sort: 1 })]);
  sqlite.prepare("UPDATE items SET title = ? WHERE id = ?").run("a\rb", id(4));
  sqlite.prepare("UPDATE items SET title = ? WHERE id = ?").run("\r=1", id(5));
  const text = await (await get(db, "format=csv&table=items&kind=task")).text();
  assert.ok(text.includes(`,"a\rb",`));
  assert.ok(text.includes(`,"'\r=1",`));
});

test("movie and series csv hold their own columns and data keys, and a title that starts with = is not a formula", async () => {
  const { db } = createDb();
  const stamps = { created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
  const result = await apply(db, [
    mutation("create", "items", id(40), { id: id(40), kind: "movie", title: "=Inception", status: "watched", who: "both", done_on: "2026-10-17", note: "Lights on", data: { original_title: "Origin", year: 2010, rating_a: "4", rating_b: "3", cover: "https://image.tmdb.org/t/p/w342/a.jpg", tmdb: 910001, tmdb_at: "2026-10-26" }, ...stamps }),
    mutation("create", "items", id(41), { id: id(41), kind: "series", title: "Breaking Bad", status: "want", ...stamps }),
  ]);
  assert.equal("errors" in result, false);
  const movies = parse(await (await get(db, "format=csv&table=items&kind=movie")).text());
  assert.equal(movies.length, 2);
  const header = movies[0].split(",");
  for (const column of ["status", "who", "done_on", "note", "data.original_title", "data.year", "data.rating_a", "data.rating_b", "data.cover", "data.tmdb", "data.tmdb_at"]) assert.ok(header.includes(column), column);
  assert.ok(movies[1].includes(",'=Inception,"));
  assert.ok(movies[1].includes(",2010,4,3,https://image.tmdb.org/t/p/w342/a.jpg,910001,2026-10-26"));
  const series = parse(await (await get(db, "format=csv&table=items&kind=series")).text());
  assert.equal(series.length, 2);
  assert.ok(series[1].includes("Breaking Bad") && !series[1].includes("Inception"));
});
