import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { createApi } from "../src/store/api.ts";
import { memoryPersistence } from "../src/store/memory.ts";
import { createStore } from "../src/store/store.ts";
import { badgeFor } from "../src/domain/status.ts";
import type { Health } from "../src/domain/status.ts";
import { text } from "../src/ui/text.ts";
import { client, idOf, task, titles } from "./store-client.ts";
import { markupOf } from "./render.ts";
import { createServer } from "./store-server.ts";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const healthy: Health = { storage: "ok", link: "online", rejected: 0, pending: 0, paused: false };

const flows = new Proxy({}, { get: () => () => Promise.resolve({ ok: true, id: "x" }) }) as never;

const row = (over: Record<string, unknown>) => ({ id: "r", deleted_at: null, rev: 1, who: "a", data: {}, ...over });

const rendered = async (paused: boolean, action: Record<string, unknown>, active = true) => {
  const { useSnapshot } = (await import("./render-store.ts")) as unknown as { useSnapshot: () => { paused: boolean } };
  useSnapshot().paused = paused;
  return markupOf("ui/routine-action.tsx", ({ RoutineAction }) =>
    createElement(RoutineAction, { routine: row({ kind: "routine", title: "Morning" }), action: row({ id: "s", parent_id: "r", ...action }), flows, me: "a", today: "2026-10-27", active }),
  );
};

const input = (html: string) => /<input[^>]*type="checkbox"[^>]*>/.exec(html)?.[0] ?? "";

const button = (html: string, label: string) => new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`).exec(html)?.[0] ?? "";

test("the badge reads Paused for a held store, below login and above the rest, so the one fix still shows", () => {
  assert.equal(badgeFor({ ...healthy, paused: true }), "paused");
  assert.equal(badgeFor({ ...healthy, paused: true, link: "offline", pending: 2 }), "paused");
  assert.equal(badgeFor({ ...healthy, paused: true, rejected: 1 }), "paused");
  assert.equal(badgeFor({ ...healthy, paused: true, link: "expired" }), "login");
  assert.equal(badgeFor({ ...healthy, paused: true, link: "mismatch" }), "mismatch");
  assert.equal(badgeFor({ ...healthy, paused: true, storage: "failed" }), "storage");
  assert.equal(badgeFor({ ...healthy, link: "offline" }), "offline");
  assert.equal(text.sync.paused, "Paused");
});

test("a held phone shows Paused, then the partner's work and an unpaused badge once the answer confirms it", async () => {
  const server = createServer();
  const partner = client(server, "b");
  await partner.store.open();
  idOf(await partner.store.create("items", task("Added by the partner")));
  await partner.store.sync();
  let reachable = false;
  const real = createApi(server.as("a"), "a");
  const mine = createStore({ persistence: memoryPersistence(), held: true, api: { ...real, pull: (since) => (reachable ? real.pull(since) : Promise.resolve({ kind: "offline" as const })) } });
  await mine.open();
  const badge = () => badgeFor({ ...mine.getSnapshot(), rejected: 0 });
  assert.deepEqual([mine.getSnapshot().paused, badge()], [true, "paused"]);
  assert.deepEqual(titles(mine.getSnapshot().rows.items), []);
  reachable = true;
  mine.release();
  await mine.sync();
  assert.deepEqual([mine.getSnapshot().paused, badge()], [false, "synced"]);
  assert.deepEqual(titles(mine.getSnapshot().rows.items), ["Added by the partner"]);
});

test("while paused a check and a counter button stay focusable but announce aria-disabled; live ones carry no such attribute", async () => {
  const check = { kind: "step", title: "Cleanse" };
  const counter = { kind: "counter", title: "Fish oil", qty: 2, data: { unit: "pcs" } };
  const on = await rendered(true, check);
  assert.match(input(on), /aria-disabled="true"/);
  assert.doesNotMatch(input(on), /\sdisabled(=|\s|>)/);
  const plus = button(await rendered(true, counter), "Add one: Fish oil");
  assert.match(plus, /aria-disabled="true"/);
  assert.doesNotMatch(plus, /\sdisabled(=|\s|>)/);
  assert.match(button(await rendered(true, counter), "Reset count: Fish oil"), /aria-disabled="true"/);
  assert.doesNotMatch(input(await rendered(false, check)), /aria-disabled/);
  assert.doesNotMatch(button(await rendered(false, counter), "Add one: Fish oil"), /aria-disabled/);
});

test("a step that does not occur today keeps its native disabled state, paused or not", async () => {
  const step = { kind: "step", title: "Mask" };
  assert.match(input(await rendered(false, step, false)), /\sdisabled(=|\s|>)/);
  assert.match(input(await rendered(true, step, false)), /\sdisabled(=|\s|>)/);
});

test("a tap while paused only moves focus to the banner: the write is never run and focus goes to the banner", async () => {
  const calls: string[] = [];
  const spot = { focus: () => void calls.push("focus") };
  const globals = globalThis as unknown as { document?: unknown };
  globals.document = { getElementById: (id: string) => (calls.push(id), spot) };
  try {
    const { useSnapshot } = (await import("./render-store.ts")) as unknown as { useSnapshot: () => { paused: boolean } };
    for (const locked of [true, false]) {
      useSnapshot().paused = locked;
      calls.length = 0;
      let hook!: { locked: boolean; guard: (run: () => void) => () => void };
      await markupOf("hooks/use-write-lock.ts", (loaded) => ((hook = loaded.useWriteLock()), null as never));
      hook.guard(() => void calls.push("write"))();
      assert.deepEqual([hook.locked, calls], locked ? [true, ["paused-notice", "focus"]] : [false, ["write"]]);
    }
  } finally {
    delete globals.document;
  }
});

test("the paused badge is a quiet link to Sync that reads Paused, not the offline or login label", async () => {
  const { useSnapshot } = (await import("./render-store.ts")) as unknown as { useSnapshot: () => { paused: boolean } };
  useSnapshot().paused = true;
  const html = await markupOf("ui/sync-badge.tsx", ({ SyncBadge }) => createElement(SyncBadge));
  assert.match(html, /<div role="status" class="sync" data-state="paused"><a href="#\/sync">Paused<\/a><\/div>/);
  useSnapshot().paused = false;
});

test("the banner takes the id the hook looks for, and the badge is told whether the store is paused", () => {
  assert.match(read("ui/shell.tsx"), /import \{ PAUSED_NOTICE \} from "\.\.\/hooks\/use-write-lock\.ts";/);
  assert.match(read("ui/shell.tsx"), /id=\{PAUSED_NOTICE\} tabIndex=\{-1\}/);
  assert.equal([...read("hooks/use-write-lock.ts").matchAll(/PAUSED_NOTICE = "paused-notice"/g)].length, 1);
  assert.match(read("ui/sync-badge.tsx"), /badgeFor\(\{ storage, link, pending, rejected: rejected\.length, paused \}\)/);
});

test("a disabled or aria-disabled check is muted and, when open, dashed; the banner shows a ring when focused", () => {
  const css = read("ui/ui.css");
  assert.match(css, /\.check input:disabled,\s*\.check input\[aria-disabled="true"\] \{\s*opacity: 0\.6;/);
  assert.match(css, /\.check input:disabled:not\(:checked\),\s*\.check input\[aria-disabled="true"\]:not\(:checked\) \{\s*border-style: dashed;/);
  assert.match(css, /\.notice:focus \{\s*outline: 2\.5px solid var\(--focus\);\s*outline-offset: 2px;/);
  assert.match(read("style.css"), /\.sync\[data-state="paused"\] a::before/);
});
