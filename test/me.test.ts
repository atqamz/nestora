import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import { createAuthenticator } from "../worker/auth.ts";
import { createWorker } from "../worker/index.ts";
import type { Bindings } from "../worker/index.ts";
import { createDb } from "./sync-db.ts";

const domain = "team.example.test";
const audience = "example-aud";
const emails = { a: "rani@example.test", b: "dimas@example.test" };
const HOST = "https://lh3.googleusercontent.com";
const PHOTO = `${HOST}/a/ACg8ocRani=s96-c`;
const OTHER = `${HOST}/a/ACg8ocDimas=s96-c`;
const IDENTITY = `https://${domain}/cdn-cgi/access/get-identity`;

const signer = await generateKeyPair("RS256", { extractable: true });
const stranger = await generateKeyPair("RS256", { extractable: true });
const jwk = { ...(await exportJWK(signer.publicKey)), kid: "k1", alg: "RS256", use: "sig" };

const token = async (claims: Record<string, unknown> = {}, key = signer.privateKey) =>
  new SignJWT({ email: emails.a, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(`https://${domain}`)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);

type Identity = (init: RequestInit | undefined) => Response | Promise<Response>;

const setup = (identity: Identity = () => Response.json({})) => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url === `https://${domain}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
    calls.push({ url, init });
    return identity(init);
  };
  const { db } = createDb();
  const env: Bindings = { DB: db, DESIGN: { get: async () => null }, ACCESS_TEAM_DOMAIN: domain, ACCESS_AUD: audience, ALLOWED_EMAILS: `${emails.a},${emails.b}` };
  const worker = createWorker(createAuthenticator(fetcher), fetcher);
  const me = async (headers: Record<string, string> = {}, method = "GET", environment = env) =>
    worker.fetch(new Request("https://wp.example.test/api/me", { method, headers }), environment);
  return { calls, me, env };
};

const signed = async (claims?: Record<string, unknown>) => ({ "cf-access-jwt-assertion": await token(claims) });

const withCookie = async (claims?: Record<string, unknown>, cookie = "CF_Authorization=session-token") => ({ ...(await signed(claims)), cookie });

const quiet = () => (["log", "info", "warn", "error", "debug"] as const).map((name) => mock.method(console, name, () => undefined));

test("the verified token's custom picture is returned without any other request", async () => {
  const { me, calls } = setup();
  const res = await me(await signed({ custom: { picture: PHOTO } }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { photo: PHOTO });
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(calls, []);
});

test("the picture is the signed-in side's own, never the other side's", async () => {
  const { me } = setup();
  const own = await me(await signed({ email: emails.b, custom: { picture: OTHER } }));
  assert.deepEqual(await own.json(), { photo: OTHER });
});

test("a token without a custom claim falls back to get-identity with the cookie", async () => {
  const { me, calls } = setup(() => Response.json({ custom: { picture: PHOTO } }));
  const res = await me(await withCookie());
  assert.deepEqual(await res.json(), { photo: PHOTO });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, IDENTITY);
  assert.deepEqual(calls[0]?.init?.headers, { cookie: "CF_Authorization=session-token" });
  assert.equal(calls[0]?.init?.redirect, "manual");
  assert.equal(calls[0]?.init?.signal instanceof AbortSignal, true);
});

test("a trimmed custom claim without a picture falls back too", async () => {
  for (const custom of [{}, { other: "x" }, null, "text", []]) {
    const { me, calls } = setup(() => Response.json({ custom: { picture: PHOTO } }));
    const res = await me(await withCookie({ custom }));
    assert.deepEqual(await res.json(), { photo: PHOTO }, JSON.stringify(custom));
    assert.equal(calls.length, 1);
  }
});

test("the fallback reads the cookie among others and ignores look-alike names", async () => {
  const { me, calls } = setup(() => Response.json({ custom: { picture: PHOTO } }));
  await me(await withCookie(undefined, "theme=dark; XCF_Authorization=wrong; CF_Authorization=a=b==; other=1"));
  assert.deepEqual(calls[0]?.init?.headers, { cookie: "CF_Authorization=a=b==" });
  const prefixed = setup(() => Response.json({ custom: { picture: PHOTO } }));
  await prefixed.me(await withCookie(undefined, "CF_Authorization_x=wrong; CF_Authorization=right"));
  assert.deepEqual(prefixed.calls[0]?.init?.headers, { cookie: "CF_Authorization=right" });
  const only = setup();
  assert.deepEqual(await (await only.me(await withCookie(undefined, "CF_Authorization_x=wrong; CF_AuthorizationX=wrong"))).json(), { photo: null });
  assert.deepEqual(only.calls, []);
  const none = setup();
  assert.deepEqual(await (await none.me(await withCookie(undefined, "XCF_Authorization=wrong; CF_Authorization="))).json(), { photo: null });
  assert.deepEqual(none.calls, []);
});

test("without a cookie the fallback is not attempted", async () => {
  const { me, calls } = setup();
  assert.deepEqual(await (await me(await signed())).json(), { photo: null });
  assert.deepEqual(calls, []);
});

test("a failing get-identity gives null with status 200, never an error", async () => {
  const cases: [string, Identity][] = [
    ["a server error", () => new Response("down", { status: 500 })],
    ["a not found", () => new Response("no", { status: 404 })],
    ["a redirect", () => new Response(null, { status: 302, headers: { location: "https://team.example.test/login" } })],
    ["a network error", () => Promise.reject(new TypeError("fetch failed"))],
    ["an html page", () => new Response("<html></html>", { headers: { "content-type": "text/html" } })],
    ["a json null", () => Response.json(null)],
    ["a json list", () => Response.json([1])],
    ["no custom part", () => Response.json({ email: emails.a })],
    ["a picture that is not text", () => Response.json({ custom: { picture: 5 } })],
  ];
  for (const [name, identity] of cases) {
    const { me } = setup(identity);
    const res = await me(await withCookie());
    assert.equal(res.status, 200, name);
    assert.deepEqual(await res.json(), { photo: null }, name);
  }
});

test("get-identity gets a 3 second limit and a timeout gives null", async () => {
  const limits: number[] = [];
  const real = AbortSignal.timeout.bind(AbortSignal);
  mock.method(AbortSignal, "timeout", (ms: number) => {
    limits.push(ms);
    return ms === 3000 ? AbortSignal.abort() : real(ms);
  });
  try {
    const { me } = setup((init) => (init?.signal?.aborted ? Promise.reject(new DOMException("aborted", "TimeoutError")) : Response.json({ custom: { picture: PHOTO } })));
    const res = await me(await withCookie());
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { photo: null });
    assert.equal(limits.includes(3000), true);
  } finally {
    mock.restoreAll();
  }
});

const hostile: [string, string][] = [
  ["a javascript URL", "javascript:alert(1)"],
  ["a data URL", "data:image/png;base64,AAAA"],
  ["plain http", "http://lh3.googleusercontent.com/a"],
  ["another host", "https://example.test/a.png"],
  ["a look-alike path", "https://evil.example.test/.googleusercontent.com"],
  ["a look-alike prefix", "https://googleusercontent.com.evil.example.test/a"],
  ["credentials", "https://user:pass@lh3.googleusercontent.com/a"],
  ["a user name that is the real host", "https://lh3.googleusercontent.com@evil.example.test/a"],
  ["513 characters", `${HOST}/${"a".repeat(513 - HOST.length - 1)}`],
  ["a control character", `${HOST}/a\u0000b`],
  ["a Cyrillic look-alike", "https://lh3.googleusercontеnt.com/a"],
  ["a non-string", "5"],
];

test("hostile pictures in the token give null and are not replaced by the fallback", async () => {
  for (const [name, picture] of hostile) {
    const { me, calls } = setup(() => Response.json({ custom: { picture: PHOTO } }));
    const res = await me(await withCookie({ custom: { picture: name === "a non-string" ? 5 : picture } }));
    assert.deepEqual(await res.json(), { photo: null }, name);
    assert.deepEqual(calls, [], name);
  }
});

test("hostile pictures from get-identity give null", async () => {
  for (const [name, picture] of hostile) {
    const { me } = setup(() => Response.json({ custom: { picture: name === "a non-string" ? 5 : picture } }));
    assert.deepEqual(await (await me(await withCookie())).json(), { photo: null }, name);
  }
});

test("a picture of exactly 512 characters is returned", async () => {
  const picture = `${HOST}/${"a".repeat(512 - HOST.length - 1)}`;
  const { me } = setup();
  assert.deepEqual(await (await me(await signed({ custom: { picture } }))).json(), { photo: picture });
});

test("nothing but the photo is returned or logged", async () => {
  const spies = quiet();
  try {
    const { me } = setup(() => Response.json({ email: emails.a, name: "Rani", user_uuid: "u-1", id: "i-1", custom: { picture: PHOTO, email: "x@example.test" } }));
    for (const headers of [await signed({ name: "Rani", custom: { picture: PHOTO, email: "x@example.test" } }), await withCookie()]) {
      const text = await (await me(headers)).text();
      assert.deepEqual(JSON.parse(text), { photo: PHOTO });
      assert.doesNotMatch(text, /@|u-1|i-1|name/);
    }
    const failing = setup(() => Promise.reject(new TypeError(`fetch failed for ${emails.a}`)));
    await failing.me(await withCookie());
    assert.equal(spies.reduce((total, spy) => total + spy.mock.callCount(), 0), 0);
  } finally {
    mock.restoreAll();
  }
});

test("dev mode returns null without any request", async () => {
  const { me, calls, env } = setup(() => Response.json({ custom: { picture: PHOTO } }));
  const res = await me({ cookie: "CF_Authorization=session-token" }, "GET", { ...env, AUTH_MODE: "dev", DEV_WHO: "a" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { photo: null });
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(calls, []);
});

test("only GET is allowed", async () => {
  const { me, calls } = setup();
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) {
    const res = await me(await withCookie(), method);
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("allow"), "GET", method);
    if (method !== "HEAD") assert.deepEqual(await res.json(), { error: "method_not_allowed" }, method);
  }
  assert.deepEqual(calls, []);
});

test("a caller without a valid token gets 401 and nothing is fetched", async () => {
  const { me, calls } = setup(() => Response.json({ custom: { picture: PHOTO } }));
  const forged = { "cf-access-jwt-assertion": await token({ custom: { picture: PHOTO } }, stranger.privateKey), cookie: "CF_Authorization=session-token" };
  const outsider = { "cf-access-jwt-assertion": await token({ email: "stranger@example.test", custom: { picture: PHOTO } }), cookie: "CF_Authorization=session-token" };
  for (const [name, headers] of [["no token", { cookie: "CF_Authorization=session-token" }], ["a forged token", forged], ["a stranger", outsider], ["garbage", { "cf-access-jwt-assertion": "x.y.z" }]] as const) {
    for (const method of ["GET", "POST"]) {
      const res = await me(headers, method);
      assert.equal(res.status, 401, `${name} ${method}`);
      assert.deepEqual(await res.json(), { error: "unauthorized" });
    }
  }
  assert.deepEqual(calls, []);
});

test("an unexpected failure is a generic 500 like the other routes", async () => {
  const spies = quiet();
  try {
    const { env } = setup();
    const worker = createWorker(async (_request, _env, onVerified) => (onVerified?.({ custom: { get picture(): string { throw new Error("boom"); } } }), "a"), async () => new Response());
    const res = await worker.fetch(new Request("https://wp.example.test/api/me"), env);
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: "internal" });
  } finally {
    mock.restoreAll();
  }
});
