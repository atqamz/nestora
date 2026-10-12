import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { createAuthenticator } from "../worker/auth.ts";
import worker, { createWorker } from "../worker/index.ts";
import type { Bindings } from "../worker/index.ts";
import { createDb, id, mutation, task } from "./sync-db.ts";

const url = (path: string) => `https://wp.example.test${path}`;


const setup = (extra: Partial<Bindings> = {}) => {
  const { db, sqlite, calls } = createDb();
  const reads: string[] = [];
  const pages: Record<string, string> = { round2: "<h1>round2</h1>" };
  const DESIGN: Bindings["DESIGN"] = { get: async (key) => (reads.push(key), pages[key] ?? null) };
  const env: Bindings = { DB: db, DESIGN, AUTH_MODE: "dev", DEV_WHO: "b", ...extra };
  return { env, db, sqlite, calls, reads };
};

const call = (env: Bindings, path: string, init?: RequestInit) => worker.fetch(new Request(url(path), init), env);

const JSON_HEADERS = { "content-type": "application/json" };

const postJson = (env: Bindings, body: unknown, headers: Record<string, string> = {}) =>
  call(env, "/api/sync", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body), headers: { ...JSON_HEADERS, ...headers } });

const LEAK = /\bat .+[(:]|Error:|node_modules|\.ts:\d+|SQLITE|\/home\//;

test("GET /api/health returns ok for an authenticated caller", async () => {
  const { env } = setup();
  const res = await call(env, "/api/health");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("every /api route needs authentication, including health and unknown paths", async () => {
  const { env } = setup({ AUTH_MODE: undefined });
  for (const [method, path] of [["GET", "/api/health"], ["GET", "/api/me"], ["POST", "/api/me"], ["GET", "/api/login"], ["GET", "/api/sync"], ["POST", "/api/sync"], ["GET", "/api/export?format=json"], ["GET", "/api/nope"], ["DELETE", "/api/sync"]]) {
    const res = await call(env, path, { method });
    assert.equal(res.status, 401, `${method} ${path}`);
    assert.deepEqual(await res.json(), { error: "unauthorized" });
  }
});

test("unknown /api paths are 404 json for an authenticated caller, other paths are 404 too", async () => {
  const { env } = setup();
  for (const path of ["/api/nope", "/api/sync/", "/api/", "/other"]) {
    const res = await call(env, path);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "not_found" });
  }
});

test("wrong methods are 405 with Allow", async () => {
  const { env } = setup();
  const cases: [string, string, string][] = [
    ["POST", "/api/health", "GET"],
    ["POST", "/api/me", "GET"],
    ["PUT", "/api/login", "GET"],
    ["POST", "/api/export?format=json", "GET"],
    ["DELETE", "/api/sync", "GET, POST"],
    ["PATCH", "/api/sync", "GET, POST"],
  ];
  for (const [method, path, allow] of cases) {
    const res = await call(env, path, { method });
    assert.equal(res.status, 405, `${method} ${path}`);
    assert.equal(res.headers.get("allow"), allow);
    assert.deepEqual(await res.json(), { error: "method_not_allowed" });
  }
});

test("GET /api/login redirects to /, whatever the query says", async () => {
  const { env } = setup();
  for (const query of ["", "?next=https://evil.example.test", "?redirect=//evil.example.test"]) {
    const res = await call(env, `/api/login${query}`, { redirect: "manual" });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "/");
  }
});

test("a sync round trip through the router", async () => {
  const { env, sqlite } = setup();
  const post = await postJson(env, { mutations: [task(2)] });
  assert.equal(post.status, 200);
  const result = (await post.json()) as { rev: number; epoch: string; rows: { items: { id: string; updated_by: string; updated_at: string }[] } };
  assert.match(result.epoch, /^[0-9a-f]{32}$/);
  assert.equal(result.rev, 1);
  assert.equal(result.rows.items.length, 1);
  assert.equal(result.rows.items[0].updated_by, "b");
  assert.match(result.rows.items[0].updated_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.notEqual(result.rows.items[0].updated_at, "2026-10-01T00:00:00Z");
  const pull = await call(env, "/api/sync?since=0");
  const pulled = (await pull.json()) as { rev: number; epoch: string; me: string; changes: { items: unknown[] } };
  assert.equal(pulled.epoch, result.epoch);
  assert.deepEqual([pulled.rev, pulled.me, pulled.changes.items.length], [1, "b", 1]);
  assert.equal((sqlite.prepare("SELECT count(*) AS n FROM items").get() as { n: number }).n, 1);
});

test("a rejection keeps the Rejection shape and the matching http status", async () => {
  const { env } = setup();
  const res = await postJson(env, { mutations: [mutation("update", "items", id(9), { title: "x" })] });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { status: 404, errors: ["row_id: no such row"], index: 0 });
});

test("the export route answers json and csv", async () => {
  const { env } = setup();
  assert.equal((await call(env, "/api/export?format=json")).status, 200);
  assert.equal((await call(env, "/api/export?format=csv&table=items&kind=task")).status, 200);
  assert.equal((await call(env, "/api/export")).status, 400);
});

test("a JWT travels through the router and picks the side", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: "k", alg: "RS256", use: "sig" };
  const handler = createWorker(createAuthenticator(async () => Response.json({ keys: [jwk] })));
  const { db } = createDb();
  const env: Bindings = { DB: db, DESIGN: { get: async () => null }, ACCESS_TEAM_DOMAIN: "team.example.test", ACCESS_AUD: "aud", ALLOWED_EMAILS: "a@example.test,b@example.test" };
  const jwt = await new SignJWT({ email: "B@Example.test" })
    .setProtectedHeader({ alg: "RS256", kid: "k" })
    .setIssuer("https://team.example.test")
    .setAudience("aud")
    .setExpirationTime("5m")
    .sign(privateKey);
  const res = await handler.fetch(new Request(url("/api/sync"), { headers: { "Cf-Access-Jwt-Assertion": jwt } }), env);
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as { me: string }).me, "b");
  const anonymous = await handler.fetch(new Request(url("/api/sync")), env);
  assert.equal(anonymous.status, 401);
});

test("no response leaks a stack trace or internals", async (t) => {
  const log = mock.method(console, "error", () => {});
  t.after(() => log.mock.restore());
  const { env } = setup();
  const failing: Bindings = {
    ...env,
    DB: {
      prepare: env.DB.prepare,
      batch: async () => {
        throw new Error("SQLITE_BUSY: database is locked at /home/someone/wp/worker/sync.ts:1:1");
      },
    },
  };
  const requests: [Bindings, string, RequestInit?][] = [
    [env, "/api/health"],
    [env, "/api/nope"],
    [env, "/api/sync", { method: "DELETE" }],
    [env, "/api/sync?since=zzz"],
    [env, "/api/sync", { method: "POST", body: "{", headers: JSON_HEADERS }],
    [env, "/api/sync", { method: "POST", body: "{}" }],
    [env, "/api/sync", { method: "POST", body: "{}", headers: { ...JSON_HEADERS, origin: "https://evil.example.test" } }],
    [env, "/api/sync", { method: "POST", body: JSON.stringify({ mutations: [{}] }), headers: JSON_HEADERS }],
    [env, "/api/sync", { method: "POST", body: JSON.stringify({ mutations: [mutation("update", "items", id(9))] }), headers: JSON_HEADERS }],
    [env, "/api/export?format=xml"],
    [env, "/api/export?format=csv&table=settings"],
    [{ ...env, AUTH_MODE: undefined }, "/api/sync"],
    [failing, "/api/sync"],
    [failing, "/api/sync", { method: "POST", body: JSON.stringify({ mutations: [task(1)] }), headers: JSON_HEADERS }],
    [failing, "/api/export?format=json"],
  ];
  for (const [bindings, path, init] of requests) {
    const res = await call(bindings, path, init);
    const text = await res.text();
    assert.doesNotMatch(text, LEAK, `${init?.method ?? "GET"} ${path}`);
    assert.ok(res.status >= 200 && res.status < 600);
  }
  const res = await call(failing, "/api/sync");
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "internal" });
  assert.ok(log.mock.callCount() > 0);
  assert.doesNotMatch(JSON.stringify(log.mock.calls.map((c) => c.arguments)), /SQLITE|someone|locked/);
});

const rowCount = (sqlite: ReturnType<typeof createDb>["sqlite"]) => (sqlite.prepare("SELECT count(*) AS n FROM items").get() as { n: number }).n;

const unsafe = async (headers: Record<string, string>) => {
  const { env, sqlite } = setup();
  const res = await call(env, "/api/sync", { method: "POST", body: JSON.stringify({ mutations: [task(1)] }), headers });
  return { res, written: rowCount(sqlite) };
};

for (const [name, headers] of [
  ["text/plain", { "content-type": "text/plain;charset=UTF-8" }],
  ["a missing content type", {}],
  ["a url-encoded form", { "content-type": "application/x-www-form-urlencoded" }],
  ["a multipart form", { "content-type": "multipart/form-data; boundary=x" }],
  ["a lookalike json type", { "content-type": "application/jsonp" }],
  ["a json suffix type", { "content-type": "application/vnd.api+json" }],
  ["json only as a parameter", { "content-type": "text/plain; x=application/json" }],
] as [string, Record<string, string>][]) {
  test(`POST /api/sync with ${name} is 415 and writes nothing`, async () => {
    const { res, written } = await unsafe(headers);
    assert.equal(res.status, 415);
    assert.deepEqual(await res.json(), { error: "unsupported_media_type" });
    assert.equal(written, 0);
  });
}

for (const type of ["application/json", "application/json; charset=utf-8", "Application/JSON;charset=UTF-8", "application/json ; charset=utf-8"]) {
  test(`POST /api/sync accepts ${type}`, async () => {
    const { res, written } = await unsafe({ "content-type": type });
    assert.equal(res.status, 200);
    assert.equal(written, 1);
  });
}

for (const [name, headers] of [
  ["a cross-origin Origin", { origin: "https://evil.example.test" }],
  ["a sibling subdomain Origin", { origin: "https://other.example.test" }],
  ["the same host over http", { origin: "http://wp.example.test" }],
  ["the same host on another port", { origin: "https://wp.example.test:8443" }],
  ["a null Origin", { origin: "null" }],
  ["an empty Origin", { origin: "" }],
  ["Sec-Fetch-Site cross-site", { "sec-fetch-site": "cross-site" }],
  ["Sec-Fetch-Site same-site", { "sec-fetch-site": "same-site" }],
  ["an unknown Sec-Fetch-Site", { "sec-fetch-site": "whatever" }],
  ["an empty Sec-Fetch-Site", { "sec-fetch-site": "" }],
  ["a matching Origin but Sec-Fetch-Site cross-site", { origin: "https://wp.example.test", "sec-fetch-site": "cross-site" }],
  ["a cross-origin Origin but Sec-Fetch-Site same-origin", { origin: "https://evil.example.test", "sec-fetch-site": "same-origin" }],
] as [string, Record<string, string>][]) {
  test(`POST /api/sync with ${name} is 403 and writes nothing`, async () => {
    const { res, written } = await unsafe({ ...JSON_HEADERS, ...headers });
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "forbidden" });
    assert.equal(written, 0);
  });
}

for (const [name, headers] of [
  ["no Origin and no Sec-Fetch-Site", {}],
  ["the same-origin Origin", { origin: "https://wp.example.test" }],
  ["Sec-Fetch-Site same-origin", { "sec-fetch-site": "same-origin" }],
  ["Sec-Fetch-Site none", { "sec-fetch-site": "none" }],
  ["both same-origin signals", { origin: "https://wp.example.test", "sec-fetch-site": "same-origin" }],
] as [string, Record<string, string>][]) {
  test(`POST /api/sync with ${name} is accepted`, async () => {
    const { res, written } = await unsafe({ ...JSON_HEADERS, ...headers });
    assert.equal(res.status, 200);
    assert.equal(written, 1);
  });
}

test("the unsafe-request checks run after authentication and before parsing", async () => {
  const { env } = setup({ AUTH_MODE: undefined });
  const res = await call(env, "/api/sync", { method: "POST", body: "{", headers: { origin: "https://evil.example.test" } });
  assert.equal(res.status, 401);
  const authed = setup().env;
  assert.equal((await call(authed, "/api/sync", { method: "POST", body: "{", headers: { origin: "https://evil.example.test", ...JSON_HEADERS } })).status, 403);
  assert.equal((await call(authed, "/api/sync", { method: "POST", body: "{", headers: JSON_HEADERS })).status, 400);
});

test("GET routes ignore Origin and Sec-Fetch-Site and need no content type", async () => {
  const { env } = setup();
  const foreign = { origin: "https://evil.example.test", "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors" };
  for (const path of ["/api/health", "/api/sync", "/api/sync?since=0", "/api/export?format=json", "/api/export?format=csv&table=items&kind=task"]) {
    assert.equal((await call(env, path, { headers: foreign })).status, 200, path);
  }
  assert.equal((await call(env, "/api/login", { headers: foreign, redirect: "manual" })).status, 302);
});

test("wrong methods stay 405 whatever the content type or Origin", async () => {
  const { env } = setup();
  const res = await call(env, "/api/health", { method: "POST", headers: { origin: "https://evil.example.test" } });
  assert.equal(res.status, 405);
});

test("no response carries CORS headers", async () => {
  const { env } = setup();
  const anonymous = { ...env, AUTH_MODE: undefined };
  const requests: [Bindings, string, RequestInit?][] = [
    [env, "/api/sync", { headers: { origin: "https://evil.example.test" } }],
    [env, "/api/sync", { method: "OPTIONS", headers: { origin: "https://evil.example.test", "access-control-request-method": "POST" } }],
    [env, "/api/sync", { method: "POST", body: "{}", headers: { ...JSON_HEADERS, origin: "https://evil.example.test" } }],
    [env, "/api/sync", { method: "POST", body: "{}", headers: { origin: "https://evil.example.test" } }],
    [env, "/api/health", { headers: { origin: "https://wp.example.test" } }],
    [anonymous, "/api/sync", { method: "OPTIONS", headers: { origin: "https://evil.example.test" } }],
  ];
  for (const [bindings, path, init] of requests) {
    const res = await call(bindings, path, init);
    assert.deepEqual([...res.headers.keys()].filter((name) => name.startsWith("access-control-")), [], `${init?.method ?? "GET"} ${path}`);
  }
});

test("design pages need authentication before the KV is read", async () => {
  const { env, reads } = setup({ AUTH_MODE: undefined });
  for (const path of ["/design/round2/", "/design/round2", "/design/", "/design/Bad"]) {
    const res = await call(env, path);
    assert.equal(res.status, 401, path);
    assert.deepEqual(await res.json(), { error: "unauthorized" });
  }
  assert.deepEqual(reads, []);
});

test("GET and HEAD serve a design page with the private headers", async () => {
  const { env, reads } = setup();
  const headers = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "private, no-store",
    "x-robots-tag": "noindex, nofollow",
    "x-content-type-options": "nosniff",
  };
  for (const path of ["/design/round2/", "/design/round2"]) {
    const res = await call(env, path);
    assert.equal(res.status, 200);
    for (const [name, value] of Object.entries(headers)) assert.equal(res.headers.get(name), value, name);
    assert.equal(await res.text(), "<h1>round2</h1>");
  }
  const head = await call(env, "/design/round2/", { method: "HEAD" });
  assert.equal(head.status, 200);
  for (const [name, value] of Object.entries(headers)) assert.equal(head.headers.get(name), value, name);
  assert.equal(await head.text(), "");
  assert.deepEqual(reads, ["round2", "round2", "round2"]);
});

test("a missing design page is 404 json", async () => {
  const { env } = setup();
  const res = await call(env, "/design/absent/");
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "not_found" });
});

test("bad design names are 404 without reading the KV", async () => {
  const { env, reads } = setup();
  for (const path of ["/design/", "/design/../round2", "/design/%2e%2e/", "/design/Round2/", "/design/-a/", `/design/${"a".repeat(41)}/`, "/design/round2/extra", "/design/round2//", "/design/a/b/"]) {
    const res = await call(env, path);
    assert.equal(res.status, 404, path);
    assert.deepEqual(await res.json(), { error: "not_found" });
  }
  assert.equal((await call(env, `/design/${"a".repeat(40)}/`)).status, 404);
  assert.deepEqual(reads, ["a".repeat(40)]);
});

test("design pages reject other methods with Allow", async () => {
  const { env, reads } = setup();
  for (const method of ["POST", "PUT", "DELETE"]) {
    const res = await call(env, "/design/round2/", { method });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("allow"), "GET, HEAD");
    assert.deepEqual(await res.json(), { error: "method_not_allowed" });
  }
  assert.deepEqual(reads, []);
});

test("a KV failure on a design page is a generic 500", async () => {
  const { env } = setup({ DESIGN: { get: async () => { throw new Error("kv down /home/secret"); } } });
  const res = await call(env, "/design/round2/");
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { error: "internal" });
});
