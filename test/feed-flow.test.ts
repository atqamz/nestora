import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createFeed } from "../src/store/feed.ts";
import type { Fetch } from "../src/store/api.ts";
import { LOADING, copyFailed, created, linkAfterCreate, linkAfterRevoke, loaded, revoked, statusLine, sureText } from "../src/ui/feed-flow.ts";
import { formatStamp } from "../src/ui/format.ts";
import type { View } from "../src/ui/feed-flow.ts";
import { text } from "../src/ui/text.ts";
import { createWorkerServer } from "./store-worker.ts";

const copy = text.settings.feed;

const ORIGIN = "https://wp.example.test";

const section = readFileSync(new URL("../src/ui/feed-section.tsx", import.meta.url), "utf8");

const css = readFileSync(new URL("../src/views/settings.css", import.meta.url), "utf8");

const down: Fetch = async () => {
  throw new TypeError("offline");
};

const login: Fetch = async () => new Response(null, { status: 302, headers: { location: "https://login.example.test" } });

const none: View = { state: { phase: "ready", status: { active: false } }, note: null };

const stamp = "2026-10-24T00:00:00Z";

test("loading the status ends in a ready screen, or in a failed one with the reason, until there was a ready screen", async () => {
  const server = createWorkerServer();
  assert.deepEqual(loaded(LOADING, await createFeed(server.as("a"), "a").status()), none);
  assert.deepEqual(loaded(LOADING, await createFeed(down, "a").status()), { state: { phase: "failed", reason: "offline" }, note: null });
  assert.deepEqual(loaded(LOADING, await createFeed(login, "a").status()), { state: { phase: "failed", reason: "expired" }, note: null });
  assert.deepEqual(loaded(LOADING, await createFeed(server.as("b"), "a").status()), { state: { phase: "failed", reason: "mismatch" }, note: null });
  for (const reason of ["offline", "expired", "mismatch"] as const) assert.ok(copy.failed[reason].length > 10);
});

test("making the first link shows it once and a ready screen without a fetch time; making a new one replaces it and keeps nothing of the old one", async () => {
  const server = createWorkerServer();
  const feed = createFeed(server.as("a"), "a");
  const first = await feed.create();
  assert.ok(first.kind === "ok");
  const link = linkAfterCreate(null, first, ORIGIN);
  assert.equal(link, `${ORIGIN}/feed/${first.value.token}.ics`);
  const view = created(none, first);
  assert.deepEqual(view, { state: { phase: "ready", status: { active: true, created_at: first.value.created_at, fetched_at: null } }, note: null });
  const second = await feed.create();
  assert.ok(second.kind === "ok");
  const next = linkAfterCreate(link, second, ORIGIN);
  assert.equal(next, `${ORIGIN}/feed/${second.value.token}.ics`);
  assert.notEqual(next, link);
  assert.ok(!JSON.stringify(created(view, second)).includes(second.value.token));
});

test("a failed make keeps the link on the screen and says why, and on a screen that never loaded it shows the failure instead", async () => {
  const server = createWorkerServer();
  const made = await createFeed(server.as("a"), "a").create();
  assert.ok(made.kind === "ok");
  const link = linkAfterCreate(null, made, ORIGIN);
  const ready = created(none, made);
  for (const [fetcher, reason] of [[down, "offline"], [login, "expired"], [server.as("b"), "mismatch"]] as const) {
    const result = await createFeed(fetcher, "a").create();
    assert.equal(linkAfterCreate(link, result, ORIGIN), link);
    assert.deepEqual(created(ready, result), { state: ready.state, note: copy.failed[reason] });
    assert.deepEqual(created(LOADING, result), { state: { phase: "failed", reason }, note: null });
  }
  assert.equal(linkAfterCreate(null, await createFeed(down, "a").create(), ORIGIN), null);
});

test("a good make or revoke clears an earlier note, and revoking removes the link from the screen", async () => {
  const server = createWorkerServer();
  const feed = createFeed(server.as("a"), "a");
  const noted: View = { ...none, note: copy.failed.offline };
  const made = await feed.create();
  assert.equal(created(noted, made).note, null);
  assert.ok(made.kind === "ok");
  const link = linkAfterCreate(null, made, ORIGIN);
  const gone = await feed.revoke();
  assert.equal(linkAfterRevoke(link, gone), null);
  assert.deepEqual(revoked({ ...noted, state: created(none, made).state }, gone), none);
  assert.deepEqual(await feed.status(), { kind: "ok", value: { active: false } });
});

test("a failed revoke keeps the link and the state and says why; a mismatched tab changes nothing on the server", async () => {
  const server = createWorkerServer();
  const feed = createFeed(server.as("a"), "a");
  const made = await feed.create();
  assert.ok(made.kind === "ok");
  const link = linkAfterCreate(null, made, ORIGIN);
  const ready = created(none, made);
  for (const [fetcher, reason] of [[down, "offline"], [login, "expired"], [server.as("b"), "mismatch"]] as const) {
    const result = await createFeed(fetcher, "a").revoke();
    assert.equal(linkAfterRevoke(link, result), link);
    assert.deepEqual(revoked(ready, result), { state: ready.state, note: copy.failed[reason] });
  }
  const status = await feed.status();
  assert.ok(status.kind === "ok" && status.value.active);
  assert.equal(server.sqlite.prepare("SELECT count(*) AS n FROM feed_tokens").get()?.n, 1);
});

test("a copy that fails leaves a note and everything else as it was", () => {
  const ready: View = { state: { phase: "ready", status: { active: true, created_at: stamp, fetched_at: null } }, note: null };
  assert.deepEqual(copyFailed(ready), { state: ready.state, note: copy.copyFailed });
  assert.match(copy.copyFailed, /Select the link and copy it by hand/);
});

test("the link is shown with the once-only note and lives in component state that is dropped when the side changes", () => {
  assert.match(copy.once, /only time the link is shown/);
  assert.match(section, /\{copy\.once\}/);
  assert.match(section, /return \(\) => \{\s*current = false;\s*setLink\(null\);\s*setAsking\(null\);\s*\};\s*\}, \[feed\]\);/);
  assert.match(section, /navigator\.clipboard\.writeText\(link \?\? ""\)/);
  assert.match(section, /overlay\.announce\(copy\.copied\)/);
  assert.match(section, /setView\(copyFailed\)/);
});

test("Make a new link and Revoke link only ask first: the buttons that start them open a confirmation, never the request", () => {
  assert.match(section, /onClick=\{status\.active \? \(\) => setAsking\("rotate"\) : create\}/);
  assert.match(section, /data-ask="revoke" className="danger" disabled=\{busy\} onClick=\{\(\) => setAsking\("revoke"\)\}/);
  assert.equal([...section.matchAll(/onClick=\{[^}]*\bcreate\b[^}]*\}/g)].length, 2);
  assert.equal([...section.matchAll(/onClick=\{[^}]*\brevoke\b[^}]*\}/g)].length, 2);
  assert.doesNotMatch(section, /onClick=\{revoke\}/);
});

test("the confirmation names what it does, puts focus on Keep, has Keep first and the destructive button last, and Escape cancels", () => {
  assert.match(copy.sureRotate, /old link stops working at once/);
  assert.match(copy.sureRevoke, /stops updating/);
  assert.equal(copy.keep, "Keep");
  assert.match(section, /role="group" aria-labelledby=\{noted\} onKeyDown=\{cancel\}/);
  assert.match(section, /event\.key === "Escape" && !busy/);
  assert.match(section, /keep\.current\?\.focus\(\)/);
  const keepAt = section.indexOf("ref={keep}");
  const dangerAt = section.indexOf('className="danger" disabled={busy} onClick={asking === "rotate" ? create : revoke}');
  assert.ok(keepAt > 0 && dangerAt > keepAt);
  assert.match(section, /<button ref=\{keep\} type="button" disabled=\{busy\} onClick=\{\(\) => setAsking\(null\)\}>/);
  assert.match(section, /asking === "rotate" \? copy\.rotate : copy\.revoke/);
  assert.match(section, /\[data-ask="\$\{ask\}"\]`\) \?\? acts\.current\?\.querySelector\("button"\)\)\?\.focus\(\)/);
  assert.match(section, /\}, \[asking, busy\]\);/);
});

test("the confirmation keeps the 48 px button height of the sheet buttons and wraps on a narrow screen", () => {
  assert.match(css, /\.feed-confirm \{\s*display: grid;/);
  assert.match(css, /\.feed-confirm \.feed-acts > button \{\s*flex: 1 1 auto;\s*min-width: 0;\s*max-width: 100%;\s*\}/);
  assert.match(css, /\.feed-acts \{\s*display: flex;\s*flex-wrap: wrap;/);
  const block = css.slice(css.indexOf(".feed-confirm {"), css.indexOf(".feed-confirm .feed-acts > button {") + 200);
  assert.doesNotMatch(block, /(?:^|[^-])height:|max-height/);
});

test("the status line says when the link was made and whether it was fetched, in the partner's zone, or that there is no link", () => {
  assert.equal(statusLine({ active: false }, "Asia/Jakarta"), copy.none);
  assert.equal(statusLine({ active: true, created_at: "2026-10-24T00:00:00Z", fetched_at: null }, "Asia/Jakarta"), `${copy.since(formatStamp("2026-10-24T00:00:00Z", "Asia/Jakarta"))} ${copy.neverFetched}`);
  assert.equal(
    statusLine({ active: true, created_at: "2026-10-24T00:00:00Z", fetched_at: "2026-10-25T10:30:00Z" }, "Asia/Jakarta"),
    `${copy.since(formatStamp("2026-10-24T00:00:00Z", "Asia/Jakarta"))} ${copy.fetched(formatStamp("2026-10-25T10:30:00Z", "Asia/Jakarta"))}`,
  );
  assert.notEqual(statusLine({ active: true, created_at: "2026-10-24T00:00:00Z", fetched_at: "2026-10-25T10:30:00Z" }, "Asia/Jakarta"), statusLine({ active: true, created_at: "2026-10-24T00:00:00Z", fetched_at: null }, "Asia/Jakarta"));
});

test("each confirmation asks its own question, and no question is asked while nothing is pending", () => {
  assert.equal(sureText(null), null);
  assert.equal(sureText("rotate"), copy.sureRotate);
  assert.equal(sureText("revoke"), copy.sureRevoke);
  assert.notEqual(copy.sureRotate, copy.sureRevoke);
});
