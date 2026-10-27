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
import { overlay } from "../src/ui/overlay.ts";
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
  const counted = { ...counter, data: { unit: "pcs", done_a: "2026-10-27", value_a: 1 } };
  const minus = button(await rendered(true, counted), "−1 Fish oil");
  assert.match(minus, /aria-disabled="true"/);
  assert.doesNotMatch(minus, /\sdisabled(=|\s|>)/);
  assert.doesNotMatch(button(await rendered(false, counted), "−1 Fish oil"), /aria-disabled/);
  assert.match(button(await rendered(false, counter), "−1 Fish oil"), /aria-disabled="true"/);
  assert.doesNotMatch(input(await rendered(false, check)), /aria-disabled/);
  assert.doesNotMatch(button(await rendered(false, counter), "Add one: Fish oil"), /aria-disabled/);
});

test("a step that does not occur today keeps its native disabled state, paused or not", async () => {
  const step = { kind: "step", title: "Mask" };
  assert.match(input(await rendered(false, step, false)), /\sdisabled(=|\s|>)/);
  assert.match(input(await rendered(true, step, false)), /\sdisabled(=|\s|>)/);
});

test("a tap while paused only announces the pause in place: the write is never run and nothing is focused or looked up", async () => {
  const calls: string[] = [];
  const globals = globalThis as unknown as { document?: unknown };
  globals.document = { getElementById: (id: string) => (calls.push(id), { focus: () => calls.push("focus") }) };
  try {
    const { useSnapshot } = (await import("./render-store.ts")) as unknown as { useSnapshot: () => { paused: boolean } };
    for (const locked of [true, false]) {
      useSnapshot().paused = locked;
      calls.length = 0;
      overlay.dismissToast();
      let hook!: { locked: boolean; guard: (run: () => void) => () => void };
      await markupOf("hooks/use-write-lock.ts", (loaded) => ((hook = loaded.useWriteLock()), null as never));
      hook.guard(() => void calls.push("write"))();
      assert.deepEqual([hook.locked, calls, overlay.getSnapshot().toast?.message], locked ? [true, [], text.pausedTap] : [false, ["write"], undefined]);
    }
  } finally {
    delete globals.document;
    overlay.dismissToast();
  }
});

test("the paused badge is a quiet link to Sync that reads Paused, not the offline or login label", async () => {
  const { useSnapshot } = (await import("./render-store.ts")) as unknown as { useSnapshot: () => { paused: boolean } };
  useSnapshot().paused = true;
  const html = await markupOf("ui/sync-badge.tsx", ({ SyncBadge }) => createElement(SyncBadge));
  assert.match(html, /<div role="status" class="sync" data-state="paused"><a href="#\/sync">Paused<\/a><\/div>/);
  useSnapshot().paused = false;
});

test("the banner is one live status that nothing focuses, and the badge is told whether the store is paused", () => {
  assert.match(read("ui/shell.tsx"), /paused && link !== "mismatch" && \(\s*<div className="notice" role="status">/);
  assert.doesNotMatch(read("ui/shell.tsx"), /PAUSED_NOTICE|tabIndex/);
  assert.doesNotMatch(read("hooks/use-write-lock.ts"), /getElementById|focus/);
  assert.match(read("ui/sync-badge.tsx"), /badgeFor\(\{ storage, link, pending, rejected: rejected\.length, paused \}\)/);
});

test("a disabled or aria-disabled check is muted and, when open, dashed; the banner is not a focus target", () => {
  const css = read("ui/ui.css");
  assert.match(css, /\.check input:disabled,\s*\.check input\[aria-disabled="true"\] \{\s*opacity: 0\.6;/);
  assert.match(css, /\.check input:disabled:not\(:checked\),\s*\.check input\[aria-disabled="true"\]:not\(:checked\) \{\s*border-style: dashed;/);
  assert.doesNotMatch(css, /\.notice:focus/);
  assert.match(read("style.css"), /\.sync\[data-state="paused"\] a::before/);
});

test("Start over, Reset counts, −1 and +1 all go through the paused guard, and the menu item announces aria-disabled while paused", async () => {
  assert.match(read("ui/routine-action.tsx"), /onClick=\{guard\(\(\) => taken > 0 && run\(\(\) => flows\.minus\(routine, action\)\)\)\}/);
  assert.match(read("ui/routine-action.tsx"), /className="pill rt-plus" disabled=\{!active\} aria-disabled=\{locked \|\| undefined\}/);
  assert.match(read("ui/routine-action.tsx"), /onClick=\{guard\(add\)\}/);
  assert.match(read("views/today-block.tsx"), /aria-disabled=\{locked \|\| undefined\} onClick=\{guard\(again\)\}/);
  assert.match(read("views/routine.tsx"), /resetCounts: counted\.length > 0 \? guard\(/);
  assert.match(read("views/routine.tsx"), /^\s+locked,$/m);
  assert.match(read("ui/menu.tsx"), /aria-disabled=\{item\.locked \|\| undefined\}/);
  const { routineMenu } = await import("../src/ui/routine-menu.ts");
  const handlers = { away: false, open: () => undefined, resume: () => undefined, remove: () => undefined, resetCounts: () => undefined };
  assert.equal(routineMenu({ ...handlers, locked: true }).find((entry) => entry.id === "reset")?.locked, true);
  assert.equal(routineMenu({ ...handlers, locked: false }).find((entry) => entry.id === "reset")?.locked, false);
});
