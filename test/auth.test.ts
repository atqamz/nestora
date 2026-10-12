import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT, exportJWK, generateKeyPair } from "jose";
import type { CryptoKey } from "jose";
import { createAuthenticator } from "../worker/auth.ts";
import type { AuthEnv } from "../worker/auth.ts";

const domain = "team.example.test";
const audience = "example-aud";
const emails = { a: "a@example.test", b: "b@example.test" };
const env: AuthEnv = { ACCESS_TEAM_DOMAIN: domain, ACCESS_AUD: audience, ALLOWED_EMAILS: `${emails.a},${emails.b}` };

const signer = await generateKeyPair("RS256", { extractable: true });
const stranger = await generateKeyPair("RS256", { extractable: true });
const jwk = { ...(await exportJWK(signer.publicKey)), kid: "k1", alg: "RS256", use: "sig" };

type Claims = { custom?: unknown; email?: unknown; iss?: string; aud?: string; exp?: string | number | null; alg?: string; key?: CryptoKey; kid?: string };

const token = async ({ custom, email = emails.a, iss = `https://${domain}`, aud = audience, exp = "5m", alg = "RS256", key = signer.privateKey, kid = "k1" }: Claims = {}) => {
  const jwt = new SignJWT({ email, ...(custom === undefined ? {} : { custom }) }).setProtectedHeader({ alg, kid }).setIssuer(iss).setAudience(aud).setIssuedAt();
  if (exp !== null) jwt.setExpirationTime(exp);
  return jwt.sign(key);
};

const requestWith = (jwt?: string) => new Request("https://wp.example.test/api/sync", jwt ? { headers: { "Cf-Access-Jwt-Assertion": jwt } } : {});

const setup = (keys: unknown[] = [jwk]) => {
  const urls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    urls.push(String(input));
    return Response.json({ keys });
  };
  return { urls, authenticate: createAuthenticator(fetcher) };
};

test("a valid token maps position 1 to a and position 2 to b", async () => {
  const { authenticate } = setup();
  assert.equal(await authenticate(requestWith(await token()), env), "a");
  assert.equal(await authenticate(requestWith(await token({ email: emails.b })), env), "b");
});

test("keys come from the team certs url and are cached", async () => {
  const { authenticate, urls } = setup();
  await authenticate(requestWith(await token()), env);
  await authenticate(requestWith(await token({ email: emails.b })), env);
  assert.deepEqual(urls, [`https://${domain}/cdn-cgi/access/certs`]);
});

test("a missing header is rejected", async () => {
  assert.equal(await setup().authenticate(requestWith(), env), null);
});

test("a garbage token is rejected", async () => {
  assert.equal(await setup().authenticate(requestWith("not-a-jwt"), env), null);
});

test("a wrong issuer is rejected", async () => {
  assert.equal(await setup().authenticate(requestWith(await token({ iss: "https://other.example.test" })), env), null);
});

test("a wrong audience is rejected", async () => {
  assert.equal(await setup().authenticate(requestWith(await token({ aud: "other-aud" })), env), null);
});

test("an expired token is rejected", async () => {
  const expired = Math.floor(Date.now() / 1000) - 3600;
  assert.equal(await setup().authenticate(requestWith(await token({ exp: expired })), env), null);
});

test("a token without exp is rejected", async () => {
  assert.equal(await setup().authenticate(requestWith(await token({ exp: null })), env), null);
});

test("a token signed with another key is rejected", async () => {
  assert.equal(await setup().authenticate(requestWith(await token({ key: stranger.privateKey })), env), null);
});

test("a token with an algorithm other than RS256 is rejected", async () => {
  const pss = await generateKeyPair("PS256", { extractable: true });
  const key = { ...(await exportJWK(pss.publicKey)), kid: "k2", alg: "PS256", use: "sig" };
  const { authenticate } = setup([key]);
  assert.equal(await authenticate(requestWith(await token({ alg: "PS256", key: pss.privateKey, kid: "k2" })), env), null);
});

test("a token whose key id is not in the key set is rejected", async () => {
  assert.equal(await setup().authenticate(requestWith(await token({ kid: "unknown" })), env), null);
});

test("an unreachable key set is rejected", async () => {
  const authenticate = createAuthenticator(async () => new Response("down", { status: 503 }));
  assert.equal(await authenticate(requestWith(await token()), env), null);
});

test("an email outside the pair is rejected", async () => {
  assert.equal(await setup().authenticate(requestWith(await token({ email: "c@example.test" })), env), null);
});

test("a token without an email string is rejected", async () => {
  const { authenticate } = setup();
  assert.equal(await authenticate(requestWith(await token({ email: null })), env), null);
  assert.equal(await authenticate(requestWith(await token({ email: 5 })), env), null);
  assert.equal(await authenticate(requestWith(await token({ email: [emails.a] })), env), null);
});

for (const [name, secret] of [
  ["one entry", emails.a],
  ["three entries", `${emails.a},${emails.b},c@example.test`],
  ["an empty second entry", `${emails.a},`],
  ["an empty secret", ""],
  ["no secret", undefined],
] as const) {
  test(`a pair with ${name} fails closed`, async () => {
    const { authenticate } = setup();
    const jwt = await token();
    assert.equal(await authenticate(requestWith(jwt), { ...env, ALLOWED_EMAILS: secret }), null);
  });
}

for (const missing of ["ACCESS_TEAM_DOMAIN", "ACCESS_AUD"] as const) {
  test(`a missing ${missing} fails closed`, async () => {
    const { authenticate } = setup();
    assert.equal(await authenticate(requestWith(await token()), { ...env, [missing]: undefined }), null);
  });
}

test("email case and spacing differences are ignored", async () => {
  const { authenticate } = setup();
  const spaced = { ...env, ALLOWED_EMAILS: " A@Example.Test , B@EXAMPLE.test " };
  assert.equal(await authenticate(requestWith(await token({ email: "a@EXAMPLE.test" })), spaced), "a");
  assert.equal(await authenticate(requestWith(await token({ email: "B@example.test" })), spaced), "b");
});

test("dev mode needs AUTH_MODE dev and a valid DEV_WHO", async () => {
  const { authenticate } = setup();
  const request = requestWith();
  assert.equal(await authenticate(request, { AUTH_MODE: "dev", DEV_WHO: "b" }), "b");
  assert.equal(await authenticate(request, { AUTH_MODE: "dev", DEV_WHO: "a" }), "a");
  assert.equal(await authenticate(request, { AUTH_MODE: "dev", DEV_WHO: "c" }), null);
  assert.equal(await authenticate(request, { AUTH_MODE: "dev" }), null);
  assert.equal(await authenticate(request, { DEV_WHO: "a" }), null);
  assert.equal(await authenticate(request, { AUTH_MODE: "prod", DEV_WHO: "a" }), null);
  assert.equal(await authenticate(request, { ...env, DEV_WHO: "a" }), null);
});

test("the verified payload goes to the callback once, after every check, and only for an allowed e-mail", async () => {
  const { authenticate } = setup();
  const run = async (jwt: string | undefined, environment: AuthEnv = env) => {
    const seen: unknown[] = [];
    const side = await authenticate(requestWith(jwt), environment, (payload) => seen.push(payload));
    return { side, seen };
  };
  const custom = { picture: "https://lh3.googleusercontent.com/a/example=s96-c" };
  const allowed = await run(await token({ custom }));
  assert.equal(allowed.side, "a");
  assert.equal(allowed.seen.length, 1);
  assert.deepEqual((allowed.seen[0] as { custom: unknown; email: string }).custom, custom);
  assert.equal((allowed.seen[0] as { email: string }).email, emails.a);
  const second = await run(await token({ email: emails.b.toUpperCase() }));
  assert.deepEqual([second.side, second.seen.length], ["b", 1]);

  const pss = await generateKeyPair("PS256", { extractable: true });
  const refused: [string, string | undefined, AuthEnv?][] = [
    ["another e-mail", await token({ email: "stranger@example.test" })],
    ["a null e-mail", await token({ email: null })],
    ["an e-mail that is not text", await token({ email: 5 })],
    ["a wrong issuer", await token({ iss: "https://other.example.test" })],
    ["a wrong audience", await token({ aud: "other-aud" })],
    ["an expired token", await token({ exp: Math.floor(Date.now() / 1000) - 3600 })],
    ["no exp", await token({ exp: null })],
    ["another key", await token({ key: stranger.privateKey })],
    ["another key id", await token({ kid: "k9" })],
    ["another algorithm", await token({ alg: "PS256", key: pss.privateKey })],
    ["garbage", "not-a-jwt"],
    ["no header", undefined],
    ["no audience in the environment", await token(), { ...env, ACCESS_AUD: undefined }],
    ["no team domain", await token(), { ...env, ACCESS_TEAM_DOMAIN: undefined }],
    ["one allowed e-mail", await token(), { ...env, ALLOWED_EMAILS: emails.a }],
    ["three allowed e-mails", await token(), { ...env, ALLOWED_EMAILS: `${emails.a},${emails.b},x@example.test` }],
    ["a blank allowed e-mail", await token(), { ...env, ALLOWED_EMAILS: `${emails.a},` }],
  ];
  for (const [name, jwt, environment] of refused) {
    const result = await run(jwt, environment);
    assert.deepEqual([result.side, result.seen.length], [null, 0], name);
  }
  const dev = await run(undefined, { AUTH_MODE: "dev", DEV_WHO: "b" });
  assert.deepEqual([dev.side, dev.seen.length], ["b", 0]);
});
