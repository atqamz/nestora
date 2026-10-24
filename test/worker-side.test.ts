import { test } from "node:test";
import assert from "node:assert/strict";
import { SIDE_HEADER } from "../shared/api.ts";
import type { Side } from "../shared/api.ts";
import worker from "../worker/index.ts";
import type { Bindings } from "../worker/index.ts";
import { count, createDb, task } from "./sync-db.ts";

const sides: Side[] = ["a", "b"];

const other = (side: Side): Side => (side === "a" ? "b" : "a");

const setup = (who: Side | null) => {
  const { db, sqlite, calls } = createDb();
  const env: Bindings = { DB: db, DESIGN: { get: async () => null }, AUTH_MODE: who === null ? undefined : "dev", DEV_WHO: who ?? undefined };
  const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`https://wp.example.test${path}`, init), env);
  return { call, sqlite, calls };
};

const routes = (claim: string | null): [string, string, RequestInit][] => {
  const headers: Record<string, string> = claim === null ? {} : { [SIDE_HEADER]: claim };
  const post = { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ mutations: [task(1)] }) };
  return [
    ["pull", "/api/sync?since=0", { headers }],
    ["push", "/api/sync", post],
    ["export json", "/api/export?format=json", { headers }],
    ["export csv", "/api/export?format=csv&table=items&kind=task", { headers }],
  ];
};

test("a request that names the signed-in side is served, for both partners", async () => {
  for (const side of sides) {
    const { call, sqlite } = setup(side);
    for (const [name, path, init] of routes(side)) {
      const res = await call(path, init);
      assert.equal(res.status, 200, `${side} ${name}`);
    }
    assert.equal(count(sqlite, "items"), 1);
    assert.equal(((await (await call("/api/sync?since=0", { headers: { [SIDE_HEADER]: side } })).json()) as { me: Side }).me, side);
  }
});

test("a request without the header behaves as before, so an old client keeps working", async () => {
  for (const side of sides) {
    const { call, sqlite } = setup(side);
    for (const [name, path, init] of routes(null)) assert.equal((await call(path, init)).status, 200, `${side} ${name}`);
    assert.equal(count(sqlite, "items"), 1);
  }
});

test("a header for the other side is a 409 that names the signed-in side and does nothing else", async () => {
  for (const side of sides) {
    for (const claim of [other(side), "", "x", "A"]) {
      const { call, sqlite, calls } = setup(side);
      for (const [name, path, init] of routes(claim)) {
        const res = await call(path, init);
        assert.equal(res.status, 409, `${side} claims ${JSON.stringify(claim)} on ${name}`);
        assert.deepEqual(await res.json(), { error: "side_mismatch", me: side });
        assert.equal(res.headers.get("cache-control"), "no-store");
      }
      assert.deepEqual(calls, []);
      assert.equal(count(sqlite, "items"), 0);
      assert.equal((sqlite.prepare("SELECT rev FROM sync_state").get() as { rev: number }).rev, 0);
    }
  }
});

test("an export link carries the side in the query, checked the same way as the header", async () => {
  for (const side of sides) {
    const { call, calls } = setup(side);
    for (const path of ["/api/export?format=json", "/api/export?format=csv&table=items&kind=task"]) {
      assert.equal((await call(`${path}&side=${side}`)).status, 200);
      const res = await call(`${path}&side=${other(side)}`);
      assert.equal(res.status, 409);
      assert.deepEqual(await res.json(), { error: "side_mismatch", me: side });
    }
    const before = calls.length;
    assert.equal((await call(`/api/export?format=json&side=${other(side)}`, { headers: { [SIDE_HEADER]: side } })).status, 200);
    assert.equal((await call(`/api/export?format=json&side=${side}`, { headers: { [SIDE_HEADER]: other(side) } })).status, 409);
    assert.ok(calls.length > before);
  }
});

test("only sync and export check the side", async () => {
  const { call } = setup("a");
  const headers = { [SIDE_HEADER]: "b" };
  assert.equal((await call("/api/health", { headers })).status, 200);
  assert.equal((await call("/api/me", { headers })).status, 200);
  assert.equal((await call("/api/login", { headers })).status, 302);
  assert.equal((await call("/api/nope", { headers })).status, 404);
  assert.equal((await call("/api/sync", { method: "PUT", headers: { [SIDE_HEADER]: "a" } })).status, 405);
});

test("a caller who is not signed in learns nothing about the side", async () => {
  const { call, calls } = setup(null);
  for (const [name, path, init] of routes("a")) {
    const res = await call(path, init);
    assert.equal(res.status, 401, name);
    assert.deepEqual(await res.json(), { error: "unauthorized" });
  }
  assert.deepEqual(calls, []);
});
