import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFeed, feedUrl } from "../src/store/feed.ts";
import type { Fetch } from "../src/store/api.ts";
import { createWorkerServer } from "./store-worker.ts";

const reply = (status: number, body: unknown, type = "application/json"): Fetch => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": type } });

test("the client creates, reads and revokes the signed-in partner's link through the Worker", async () => {
  const server = createWorkerServer();
  const feed = createFeed(server.as("a"), "a");
  assert.deepEqual(await feed.status(), { kind: "ok", value: { active: false } });
  const made = await feed.create();
  assert.ok(made.kind === "ok");
  assert.match(made.value.token, /^[0-9a-f]{64}$/);
  const status = await feed.status();
  assert.ok(status.kind === "ok" && status.value.active && status.value.fetched_at === null);
  assert.ok(!JSON.stringify(status).includes(made.value.token));
  assert.deepEqual(await createFeed(server.as("b"), "b").status(), { kind: "ok", value: { active: false } });
  assert.deepEqual(await feed.revoke(), { kind: "ok", value: { active: false } });
  assert.deepEqual(await feed.status(), { kind: "ok", value: { active: false } });
});

test("a tab that is signed in as the other partner is told so and changes nothing", async () => {
  const server = createWorkerServer();
  const wrong = createFeed(server.as("b"), "a");
  assert.deepEqual(await wrong.status(), { kind: "mismatch", me: "b" });
  assert.deepEqual(await wrong.create(), { kind: "mismatch", me: "b" });
  assert.deepEqual(await wrong.revoke(), { kind: "mismatch", me: "b" });
  assert.deepEqual(server.sqlite.prepare("SELECT * FROM feed_tokens").all(), []);
});

test("a lost connection, an expired login and an answer that is not ours are three different failures, never a token", async () => {
  const down: Fetch = async () => {
    throw new TypeError("offline");
  };
  assert.deepEqual(await createFeed(down, "a").create(), { kind: "offline" });
  assert.deepEqual(await createFeed(reply(503, {}), "a").status(), { kind: "offline" });
  assert.deepEqual(await createFeed(async () => new Response(null, { status: 302, headers: { location: "https://login.example.test" } }), "a").status(), { kind: "expired" });
  assert.deepEqual(await createFeed(reply(401, {}), "a").create(), { kind: "expired" });
  assert.deepEqual(await createFeed(reply(200, "<html></html>", "text/html"), "a").status(), { kind: "expired" });
  assert.deepEqual(await createFeed(reply(200, { active: "yes" }), "a").status(), { kind: "offline" });
  const stamp = "2026-10-24T00:00:00Z";
  for (const body of [{ active: true }, { active: true, created_at: 5, fetched_at: null }, { active: true, created_at: stamp }, { active: true, created_at: stamp, fetched_at: 5 }, { active: "yes", created_at: stamp, fetched_at: null }, { active: 1 }, null, []]) {
    assert.deepEqual(await createFeed(reply(200, body), "a").status(), { kind: "offline" }, JSON.stringify(body));
  }
  assert.deepEqual(await createFeed(reply(200, { active: true, created_at: stamp, fetched_at: stamp }), "a").status(), { kind: "ok", value: { active: true, created_at: stamp, fetched_at: stamp } });
  assert.deepEqual(await createFeed(reply(200, { active: true, created_at: stamp, fetched_at: null }), "a").revoke(), { kind: "ok", value: { active: true, created_at: stamp, fetched_at: null } });
  for (const status of [201, 204, 400, 404]) {
    assert.deepEqual(await createFeed(reply(status, { active: false }), "a").status(), { kind: "offline" }, String(status));
    assert.deepEqual(await createFeed(reply(status, { token: "a".repeat(64), created_at: stamp }), "a").create(), { kind: "offline" }, String(status));
  }
  assert.deepEqual(await createFeed(reply(200, { token: "short", created_at: "2026-10-24T00:00:00Z" }), "a").create(), { kind: "offline" });
  assert.deepEqual(await createFeed(reply(200, { token: "A".repeat(64), created_at: "2026-10-24T00:00:00Z" }), "a").create(), { kind: "offline" });
  assert.deepEqual(await createFeed(reply(200, { token: "a".repeat(64) }), "a").create(), { kind: "offline" });
});

test("the link is built from the page's own origin and the token, and nothing else", () => {
  assert.equal(feedUrl("https://wp.example.test", "ab".repeat(32)), `https://wp.example.test/feed/${"ab".repeat(32)}.ics`);
});

test("the token lives in component state only: never stored in the browser, never in a hook or the store", () => {
  const section = readFileSync(new URL("../src/ui/feed-section.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(section, /localStorage|sessionStorage|indexedDB|document\.cookie|history\.|location\.(hash|search|assign|href)/);
  assert.match(section, /const \[link, setLink\] = useState<string \| null>\(null\)/);
  for (const file of ["../src/store/store.ts", "../src/store/persistence.ts", "../src/store/db.ts", "../src/store/outbox.ts"]) {
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), "utf8"), /createFeed|feedFor|\/api\/feed/, file);
  }
  assert.match(readFileSync(new URL("../src/store/browser.ts", import.meta.url), "utf8"), /createFeed\(\(url, init\) => fetch\(url, init\), side\)/);
});
