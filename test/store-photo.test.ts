import { test } from "node:test";
import assert from "node:assert/strict";
import { memoryPersistence } from "../src/store/memory.ts";
import { createStore } from "../src/store/store.ts";
import { createApi } from "../src/store/api.ts";
import type { Fetch } from "../src/store/api.ts";
import { createServer } from "./store-server.ts";
import { client } from "./store-client.ts";

const HOST = "https://lh3.googleusercontent.com";
const RANI = `${HOST}/a/ACg8ocRani=s96-c`;
const DIMAS = `${HOST}/a/ACg8ocDimas=s96-c`;

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

const open = async (server: ReturnType<typeof createServer>, side: "a" | "b") => {
  const c = client(server, side);
  await c.store.open();
  await settle();
  await c.store.sync();
  return c;
};

const photos = (server: ReturnType<typeof createServer>) =>
  Object.fromEntries(["partner_a_photo", "partner_b_photo"].map((key) => [key, server.row("settings", key)?.value ?? null]));

const own = (store: ReturnType<typeof client>["store"], key: string) => store.getSnapshot().rows.settings.find((row) => row.key === key)?.value ?? null;

test("my photo is written once, to my own key only", async () => {
  const server = createServer();
  server.control.photo = RANI;
  const { store } = await open(server, "a");
  assert.deepEqual(photos(server), { partner_a_photo: RANI, partner_b_photo: null });
  assert.equal(server.asked.length, 1);
  assert.equal(store.getSnapshot().pending, 0);
  const writes = server.seen.filter((request) => request.method === "POST").length;
  await store.sync();
  await store.sync();
  await settle();
  assert.equal(server.asked.length, 1);
  assert.equal(server.seen.filter((request) => request.method === "POST").length, writes);
});

test("the other side's key is never written, whatever the answer", async () => {
  const server = createServer();
  server.control.photo = DIMAS;
  await open(server, "b");
  assert.deepEqual(photos(server), { partner_a_photo: null, partner_b_photo: DIMAS });
});

test("the other partner receives the photo through normal sync", async () => {
  const server = createServer();
  server.control.photo = RANI;
  await open(server, "a");
  server.control.photo = null;
  const other = await open(server, "b");
  assert.equal(own(other.store, "partner_a_photo"), RANI);
  assert.equal(own(other.store, "partner_b_photo"), null);
  assert.equal(other.store.getSnapshot().pending, 0);
});

test("a null answer writes nothing", async () => {
  const server = createServer();
  const { store } = await open(server, "a");
  assert.equal(server.asked.length, 1);
  assert.deepEqual(photos(server), { partner_a_photo: null, partner_b_photo: null });
  assert.equal(store.getSnapshot().rows.settings.length, 0);
  assert.equal(server.seen.filter((request) => request.method === "POST").length, 0);
});

test("a photo that is already stored is not written again", async () => {
  const server = createServer();
  server.control.photo = RANI;
  await open(server, "a");
  const rev = server.rev;
  const again = await open(server, "a");
  assert.equal(server.asked.length, 2);
  assert.equal(server.rev, rev);
  assert.equal(again.store.getSnapshot().pending, 0);
});

test("a changed photo replaces the stored one in one write", async () => {
  const server = createServer();
  server.control.photo = RANI;
  await open(server, "a");
  const rev = server.rev;
  server.control.photo = `${HOST}/a/ACg8ocRaniNew=s96-c`;
  await open(server, "a");
  assert.equal(server.rev, rev + 1);
  assert.deepEqual(photos(server), { partner_a_photo: `${HOST}/a/ACg8ocRaniNew=s96-c`, partner_b_photo: null });
});

test("a hostile answer is refused by the store and nothing is stored", async () => {
  for (const photo of ["javascript:alert(1)", "http://lh3.googleusercontent.com/a", "https://example.test/a.png", ""]) {
    const server = createServer();
    server.control.photo = photo;
    const { store } = await open(server, "a");
    assert.deepEqual(photos(server), { partner_a_photo: null, partner_b_photo: null }, photo);
    assert.equal(store.getSnapshot().pending, 0, photo);
    assert.equal(store.getSnapshot().rejected.length, 0, photo);
  }
});

test("nothing is asked while offline, and it is asked once after the first successful sync", async () => {
  const server = createServer();
  server.control.photo = RANI;
  server.control.down = true;
  const { store } = client(server, "a");
  await store.open();
  await settle();
  assert.equal(server.asked.length, 0);
  assert.equal(store.getSnapshot().link, "offline");
  server.control.down = false;
  await store.sync();
  await settle();
  await store.sync();
  assert.equal(server.asked.length, 1);
  assert.deepEqual(photos(server), { partner_a_photo: RANI, partner_b_photo: null });
});

test("nothing is asked while the sign-in screen shows", async () => {
  for (const session of ["redirect", "html", "unauthorized", "forbidden"] as const) {
    const server = createServer();
    server.control.photo = RANI;
    server.control.session = session;
    const { store } = client(server, "a");
    await store.open();
    await settle();
    assert.equal(store.getSnapshot().link, "expired", session);
    assert.equal(server.asked.length, 0, session);
    assert.deepEqual(photos(server), { partner_a_photo: null, partner_b_photo: null }, session);
  }
});

test("a failed question is ignored and not repeated", async () => {
  const answers: Fetch[] = [
    async () => new Response("down", { status: 500 }),
    async () => Response.json({ photo: 5 }),
    async () => Response.json({}),
    async () => new Response("<html></html>", { headers: { "content-type": "text/html" } }),
    async () => new Response(null, { status: 302, headers: { location: "https://team.example.test/login" } }),
    async () => Promise.reject(new TypeError("fetch failed")),
  ];
  for (const answer of answers) {
    const api = createApi(answer);
    assert.equal(await api.me(), null);
  }
});

test("the question is a manual-redirect GET to /api/me with a 15 second limit", async () => {
  const seen: { url: string; init: RequestInit }[] = [];
  const api = createApi(async (url, init) => (seen.push({ url, init }), Response.json({ photo: RANI })));
  assert.equal(await api.me(), RANI);
  assert.equal(seen[0]?.url, "/api/me");
  assert.equal(seen[0]?.init.method, "GET");
  assert.equal(seen[0]?.init.redirect, "manual");
  assert.equal(seen[0]?.init.signal instanceof AbortSignal, true);
});

test("a photo is not written when the link drops while the answer is in flight", async () => {
  const server = createServer();
  server.control.photo = RANI;
  const c = client(server, "a");
  server.control.onMe = async () => {
    server.control.down = true;
    await c.store.sync();
    server.control.down = false;
  };
  await c.store.open();
  await settle();
  assert.equal(c.store.getSnapshot().link, "offline");
  assert.equal(server.asked.length, 1);
  assert.equal(c.store.getSnapshot().pending, 0);
  await c.store.sync();
  await settle();
  assert.equal(server.asked.length, 1);
  assert.deepEqual(photos(server), { partner_a_photo: null, partner_b_photo: null });
});

test("a photo is not written under a side that is no longer the signed-in one", async () => {
  const server = createServer();
  server.control.photo = RANI;
  let side: "a" | "b" = "a";
  const persistence = memoryPersistence();
  const store = createStore({ persistence, api: createApi((url, init) => server.as(side)(url, init)) });
  server.control.onMe = async () => {
    side = "b";
    await store.sync();
  };
  await store.open();
  await settle();
  assert.equal(store.getSnapshot().me, "b");
  assert.equal(store.getSnapshot().pending, 0);
  assert.deepEqual(photos(server), { partner_a_photo: null, partner_b_photo: null });
});
