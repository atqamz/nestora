import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import type { Side } from "../shared/api.ts";
import { lower, routineDay } from "../shared/routines.ts";
import type { ItemRow } from "../shared/tables.ts";
import { blankAction, blankDraft, planOf } from "../src/domain/routine-draft.ts";
import { allDone, finished, onDemand, sections, see, sum, tally, todayBlocks, unseen } from "../src/domain/routines.ts";
import { routineFlows } from "../src/ui/routine-flows.ts";
import { routineMenu } from "../src/ui/routine-menu.ts";
import { item } from "./domain-rows.ts";
import { markupOf } from "./render.ts";
import { stage } from "./render-store.ts";
import { client, idOf } from "./store-client.ts";
import { createServer } from "./store-server.ts";

const DAY = "2026-10-26";

const NOW = new Date("2026-10-26T03:00:00Z");

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const routine = (title: string, group_key: string, who: "a" | "b" | "both" = "a") => item({ kind: "routine", status: null, who, title, group_key, data: {} });

const step = (parent: ItemRow, title: string, data: Record<string, unknown> | null = null) => item({ kind: "step", status: null, parent_id: parent.id, title, data });

const counter = (parent: ItemRow, title: string, qty: number, data: Record<string, unknown> | null = null) => item({ kind: "counter", status: null, parent_id: parent.id, title, qty, data });

test("minus takes one off a counter, clears the key at one or zero, and ignores anything that is not a counter", () => {
  const parent = routine("Vitamins", "morning");
  const some = counter(parent, "Fish oil", 3, { done_a: DAY, value_a: 3, done_b: DAY, value_b: 1 });
  assert.deepEqual(lower(some, "a", DAY), { data: { done_a: DAY, value_a: 2 } });
  assert.deepEqual(lower(counter(parent, "x", 3, { done_a: DAY, value_a: 1 }), "a", DAY), { data: { done_a: null, value_a: null } });
  assert.deepEqual(lower(counter(parent, "x", 3), "a", DAY), { data: { done_a: null, value_a: null } });
  assert.deepEqual(lower(some, "b", DAY), { data: { done_b: null, value_b: null } });
  assert.deepEqual(lower(counter(parent, "x", 3, { done_a: "2026-10-25", value_a: 4 }), "a", DAY), { data: { done_a: null, value_a: null } });
  assert.deepEqual(lower(counter(parent, "x", 2, { done_a: DAY, value_a: 5 }), "a", DAY), { data: { done_a: DAY, value_a: 4 } });
  assert.equal(lower(step(parent, "Cleanse", { done_a: DAY }), "a", DAY), null);
});

const block = (done: number, total: number, group = "morning", title = "x") => ({ routine: routine(title, group), actions: [], label: null, side: "a" as const, progress: { done, total } });

test("a routine is finished only when something can be done and all of it is", () => {
  assert.equal(finished({ done: 0, total: 0 }), false);
  assert.equal(finished({ done: 2, total: 3 }), false);
  assert.equal(finished({ done: 3, total: 3 }), true);
});

test("on-demand routines stay out of the tally and out of All done, and keep their own count", () => {
  const blocks = [block(2, 2), block(0, 2, "on_demand"), block(1, 1, "evening")];
  assert.deepEqual(tally(blocks), { done: 3, total: 3 });
  assert.equal(allDone(blocks), true);
  assert.equal(allDone([block(2, 2), block(1, 2)]), false);
  assert.equal(allDone([block(0, 2, "on_demand")]), false);
  assert.deepEqual(tally([block(0, 2, "on_demand")]), { done: 0, total: 0 });
  assert.deepEqual(sum(blocks.filter(onDemand)), { done: 0, total: 2 });
  assert.equal(onDemand(block(0, 1, "on_demand")), true);
  assert.equal(onDemand(block(0, 1, "morning")), false);
});

test("a routine that is finished the first time it is seen sits in the rested group, and one finished in view keeps its place", () => {
  const first = block(3, 3, "morning", "first");
  const second = block(1, 3, "morning", "second");
  const first_ = see(unseen(DAY), [first, second], DAY);
  assert.deepEqual([...first_.rested], [first.routine.id]);
  assert.deepEqual([...first_.known].sort(), [first.routine.id, second.routine.id].sort());
  const later = { ...second, progress: { done: 3, total: 3 } };
  assert.equal(see(first_, [first, later], DAY), first_);
  assert.deepEqual([...see(first_, [first, later], DAY).rested], [first.routine.id]);
  const open = { ...first, progress: { done: 1, total: 3 } };
  assert.deepEqual([...see(first_, [open, second], DAY).rested], [first.routine.id]);
  const arrived = block(3, 3, "evening", "arrived");
  const grown = see(first_, [first, second, arrived], DAY);
  assert.deepEqual([...grown.rested].sort(), [first.routine.id, arrived.routine.id].sort());
  assert.equal(grown.known.has(arrived.routine.id), true);
  const tomorrow = see(first_, [first, second], "2026-10-27");
  assert.equal(tomorrow.day, "2026-10-27");
  assert.deepEqual([...tomorrow.rested], [first.routine.id]);
  assert.equal(see(unseen(DAY), [], DAY).known.size, 0);
  const again = see(grown, [first, later, arrived, block(0, 1, "evening", "fourth")], DAY);
  assert.deepEqual([...again.rested].sort(), [first.routine.id, arrived.routine.id].sort());
  assert.equal(again.known.size, 4);
});

test("the sections split open, rested and on-demand routines and keep each one's order", () => {
  const a = block(1, 3, "morning", "a");
  const b = block(3, 3, "morning", "b");
  const c = block(0, 2, "on_demand", "c");
  const d = block(0, 1, "evening", "d");
  const e = block(2, 2, "on_demand", "e");
  const rested = new Set([b.routine.id, e.routine.id]);
  const split = sections([a, b, c, d, e], rested);
  assert.deepEqual(split.open.map((x) => x.routine.title), ["a", "d"]);
  assert.deepEqual(split.done.map((x) => x.routine.title), ["b"]);
  assert.deepEqual(split.needed.map((x) => x.routine.title), ["c", "e"]);
});

const render = async (items: ItemRow[], view: "views/today.tsx" | "ui/routine-action.tsx" = "views/today.tsx", props: Record<string, unknown> = {}) => {
  stage(items);
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 26, 8) });
  try {
    return view === "views/today.tsx" ? await markupOf(view, ({ Today }) => createElement(Today)) : await markupOf(view, ({ RoutineAction }) => createElement(RoutineAction, props));
  } finally {
    mock.timers.reset();
  }
};

const rows = () => {
  const done = routine("Morning care", "morning");
  const open = routine("Evening wind down", "evening");
  const vitamins = routine("Vitamins", "morning");
  const need = routine("Before going out", "on_demand");
  return [
    done,
    step(done, "Cleanse", { done_a: DAY }),
    step(done, "Tone", { done_a: DAY }),
    open,
    step(open, "Dim the lights"),
    vitamins,
    counter(vitamins, "Fish oil", 2, { done_a: DAY, value_a: 2 }),
    counter(vitamins, "Iron", 3, { done_a: DAY, value_a: 1 }),
    counter(vitamins, "Water", 6),
    need,
    step(need, "Keys"),
  ];
};

test("Today draws a finished routine as one folded row with a check, Done and no Start, after the open ones", async () => {
  const html = await render(rows());
  const finishedBlock = /<div class="rt-block" data-fold="folded">(.*?)<\/div><\/div>/s.exec(html)?.[1] ?? "";
  assert.match(finishedBlock, /<button type="button" class="rt-fold" aria-expanded="false" aria-label="Morning care done">/);
  assert.match(finishedBlock, /<span class="rt-tick" aria-hidden="true"><svg/);
  assert.match(finishedBlock, /<span class="rt-state">Done<\/span>/);
  assert.match(html, /<div hidden="">/);
  assert.match(html, /<p class="rt-label">Done today<\/p>/);
  assert.equal([...html.matchAll(/\/start/g)].length, 3);
  assert.equal(html.includes("Start Morning care"), false);
  assert.ok(html.indexOf("Evening wind down") < html.indexOf("Done today"));
  assert.ok(html.indexOf("Morning care") > html.indexOf("Done today"));
});

test("Today counts only scheduled routines and shows on-demand ones in a closed group with their own count", async () => {
  const html = await render(rows());
  assert.match(html, /<span class="rt-tally">3 of 6<\/span>/);
  assert.match(html, /<details class="rt-needed"><summary><span>When needed<\/span><span class="rt-tally">0 of 1<\/span><\/summary>/);
  assert.equal(html.includes("<details class=\"rt-needed\" open"), false);
  const all = [routine("Morning care", "morning"), routine("Before going out", "on_demand")];
  const done = await render([all[0], step(all[0], "Cleanse", { done_a: DAY }), all[1], step(all[1], "Keys")]);
  assert.match(done, /<span class="rt-tally">All done<\/span>/);
  assert.match(done, /<span>0 of 1<\/span>/);
  assert.equal(done.includes("<details open=\"\"><summary><h2"), false);
});

test("only a finished on-demand routine offers Start over", async () => {
  const folded = routine("Morning care", "morning");
  const need = routine("Before going out", "on_demand");
  const html = await render([folded, step(folded, "Cleanse", { done_a: DAY }), need, step(need, "Keys", { done_a: DAY })]);
  assert.equal([...html.matchAll(/Start over/g)].length, 2);
  assert.match(html, /aria-label="Start over: Before going out"/);
  assert.equal(html.includes("Start over: Morning care"), false);
});

test("a counter at target shows a check and no +1 on Today, a counter below it shows both −1 and +1", async () => {
  const html = await render(rows());
  const rowOf = (title: string) => new RegExp(`<li[^>]*>(?:(?!</li>).)*?>${title}</span>(?:(?!</li>).)*</li>`, "s").exec(html)?.[0] ?? "";
  const reached = rowOf("Fish oil");
  assert.match(reached, /class="lead rt-count rt-reached" aria-hidden="true"><svg/);
  assert.equal(reached.includes("rt-plus"), false);
  assert.match(reached, /class="pill rt-minus"[^>]*aria-label="−1 Fish oil"/);
  assert.match(reached, /<span>2 of 2<\/span>/);
  const below = rowOf("Iron");
  assert.match(below, /class="lead rt-count" aria-hidden="true">1</);
  assert.match(below, /rt-minus/);
  assert.match(below, /rt-plus/);
  assert.ok(below.indexOf("rt-minus") < below.indexOf("rt-plus"));
  const empty = rowOf("Water");
  assert.match(empty, /class="pill rt-minus"[^>]*aria-disabled="true"/);
  assert.equal(/class="pill rt-plus"[^>]*aria-disabled/.test(empty), false);
});

test("the detail keeps a quiet +1 on a counter at target, for a deliberate extra", async () => {
  const parent = routine("Vitamins", "morning");
  const action = counter(parent, "Fish oil", 2, { done_a: DAY, value_a: 2 });
  const html = await render([parent, action], "ui/routine-action.tsx", { routine: parent, action, flows: {}, me: "a", today: DAY, active: true, full: true });
  assert.match(html, /rt-reached/);
  assert.match(html, /class="pill rt-plus"/);
  assert.match(html, /class="pill rt-minus"/);
});

test("the folded row, its focus hand-off and its announcement are wired: 600 ms, the row takes focus when the last tick had it, the live region speaks otherwise", () => {
  const source = read("views/today-block.tsx");
  assert.match(source, /export const SETTLE_MS = 600;/);
  assert.match(source, /setTimeout\(\(\) => \{[^}]*document\.activeElement[\s\S]*?\}, SETTLE_MS\)/);
  assert.match(source, /focus\.current = inside \? "toggle" : null;\s*setSaid\(!inside\);/);
  assert.match(source, /if \(fold === "folded" && focus\.current === "toggle"\) toggle\.current\?\.focus\(\);/);
  assert.match(source, /<span className="visually-hidden" role="status">\s*\{said \? copy\.finished\(name\) : ""\}/);
  assert.match(source, /<div hidden=\{fold === "folded"\}>/);
  assert.match(source, /aria-expanded=\{fold === "kept"\}/);
  assert.doesNotMatch(source, /overlay|toast/);
  assert.match(source, /onClick=\{\(\) => setFold\(fold === "kept" \? "folded" : "kept"\)\}/);
  assert.match(source, /\} else if \(complete && fold === "open"\) setFold\("settling"\);/);
  assert.match(source, /if \(fold !== "settling"\) return;/);
  assert.match(source, /const folding = fold === "folded" \|\| fold === "kept";/);
  assert.match(source, /if \(fold === "open" && focus\.current === "link"\) link\.current\?\.focus\(\);/);
  assert.match(source, /focus\.current = "link";\s*void flows\.clear\(routine, actions\)\.then\(\(result\) => \{\s*if \(!result\.ok\) focus\.current = null;/);
});

test("a counter that reaches its target on Today hands focus to −1, only when the +1 it had was removed from under it", () => {
  const source = read("ui/routine-action.tsx");
  assert.match(source, /if \(reached && !was\.current && !full && document\.activeElement === document\.body\) minus\.current\?\.focus\(\);\s*was\.current = reached;/);
  assert.match(source, /<button type="button" ref=\{minus\} className="pill rt-minus"/);
  assert.match(source, /\{\(!reached \|\| full\) && \(\s*<button type="button" className="pill rt-plus"/);
});

test("the folded row drops the word Done when text is large for the screen, and the check is a filled disc", () => {
  const css = read("views/routines.css");
  assert.match(css, /@media \(max-width: 11rem\) \{\s*\.rt-block h3 \.rt-state \{\s*display: none;/);
  assert.match(css, /\.rt-count\.rt-reached svg,\s*\.rt-tick svg \{[^}]*background: var\(--route\);[^}]*color: var\(--bg\)/);
});

test("the day closes with Today: the on-demand group is collapsed and the Today summary carries a chevron", () => {
  const css = read("views/routines.css");
  assert.match(css, /\.rt-today summary::after,\s*\.rt-block \.rt-fold::after \{[^}]*border: solid var\(--ink-2\)/);
  assert.match(css, /\.rt-today details\[open\] > summary::after/);
  assert.match(css, /\.rt-btns \{[^}]*gap: var\(--s2\)/);
});

test("Reset counts sits in the More menu, only while a counter has a count, before Delete", () => {
  const handlers = { away: false, open: () => undefined, resume: () => undefined, remove: () => undefined };
  assert.deepEqual(routineMenu(handlers).map((entry) => entry.id), ["duplicate", "pause", "delete"]);
  const items = routineMenu({ ...handlers, resetCounts: () => undefined });
  assert.deepEqual(items.map((entry) => [entry.id, entry.label]), [["duplicate", "Duplicate"], ["pause", "Pause"], ["reset", "Reset counts"], ["delete", "Delete"]]);
});

test("the detail says Done today when everything is ticked and clears counters from the menu", () => {
  const detail = read("views/routine.tsx");
  assert.match(detail, /finished\(\{ done, total \}\) \? copy\.doneToday : copy\.progress\(done, total\)/);
  assert.match(detail, /const counted = todays\.filter\(\(action\) => action\.kind === "counter" && count\(action, keyFor\(routine\.who, me\), day\) > 0\);/);
  assert.match(detail, /resetCounts: counted\.length > 0 \? \(\) => void once\(async \(\) => setFailure\(failureOf\(await flows\.clear\(routine, counted\)\)\)\) : undefined/);
});

const world = async (server: ReturnType<typeof createServer>, me: Side) => {
  const { store } = client(server, me);
  await store.open();
  const rows = () => store.getSnapshot().rows.items;
  const flows = () => routineFlows({ items: rows(), actions: store, me, day: routineDay(NOW), go: () => undefined });
  return { store, rows, flows, row: (id: string) => rows().find((candidate) => candidate.id === id)! };
};

let ids = 0;
const newId = () => `00000000-0000-4000-8000-${String(++ids + 5000).padStart(12, "0")}`;

const planned = async (owner: Side, who: "a" | "b" | "both", kinds: Parameters<typeof blankAction>[0][]) => {
  const server = createServer();
  const a = await world(server, owner);
  const plan = planOf({ ...blankDraft(owner), title: "Vitamins", who, actions: kinds.map((kind, index) => ({ ...blankAction(kind, newId()), title: `item ${index + 1}`, minutes: "5", qty: "2" })) }, null, [], newId);
  assert.ok(plan.ok);
  idOf(await a.store.many(plan.steps));
  await a.store.sync();
  const b = await world(server, owner === "a" ? "b" : "a");
  await b.store.sync();
  const children = a.rows().filter((row) => row.parent_id === plan.id).sort((x, y) => x.sort - y.sort);
  return { a, b, parent: a.row(plan.id), children };
};

test("minus and clear on a shared routine change only the tapper's keys, through sync", async () => {
  const { a, b, parent, children } = await planned("a", "both", ["counter", "step"]);
  const [count, tick] = children;
  for (let tap = 0; tap < 2; tap++) {
    await a.flows().plus(a.row(parent.id), a.row(count.id));
    await b.flows().plus(b.row(parent.id), b.row(count.id));
  }
  await a.flows().toggle(a.row(parent.id), a.row(tick.id));
  await b.flows().toggle(b.row(parent.id), b.row(tick.id));
  for (const store of [a.store, b.store, a.store, b.store]) await store.sync();
  assert.deepEqual(a.row(count.id).data, { done_a: DAY, value_a: 2, done_b: DAY, value_b: 2 });
  await b.flows().minus(b.row(parent.id), b.row(count.id));
  for (const store of [b.store, a.store]) await store.sync();
  assert.deepEqual(a.row(count.id).data, { done_a: DAY, value_a: 2, done_b: DAY, value_b: 1 });
  assert.equal((await a.flows().clear(a.row(parent.id), [a.row(count.id), a.row(tick.id)])).ok, true);
  for (const store of [a.store, b.store]) await store.sync();
  assert.deepEqual(b.row(count.id).data, { done_b: DAY, value_b: 1 });
  assert.deepEqual(b.row(tick.id).data, { done_b: DAY });
  assert.deepEqual(a.row(count.id).data, { done_b: DAY, value_b: 1 });
});

test("clear and minus write the owner's keys on a routine that belongs to the partner", async () => {
  const { a, b, parent, children } = await planned("a", "b", ["counter", "step"]);
  const [count, tick] = children;
  await b.flows().plus(b.row(parent.id), b.row(count.id));
  await b.flows().plus(b.row(parent.id), b.row(count.id));
  await b.flows().toggle(b.row(parent.id), b.row(tick.id));
  for (const store of [b.store, a.store]) await store.sync();
  assert.deepEqual(a.row(count.id).data, { done_b: DAY, value_b: 2 });
  await a.flows().minus(a.row(parent.id), a.row(count.id));
  assert.deepEqual(a.row(count.id).data, { done_b: DAY, value_b: 1 });
  await a.flows().clear(a.row(parent.id), [a.row(count.id), a.row(tick.id)]);
  assert.deepEqual(a.row(count.id).data, {});
  assert.deepEqual(a.row(tick.id).data, {});
});

test("clear writes nothing when there is nothing to clear", async () => {
  const { a, parent, children } = await planned("a", "a", ["step", "counter"]);
  const before = a.store.getSnapshot().pending;
  assert.deepEqual(await a.flows().clear(a.row(parent.id), children), { ok: true, id: "" });
  assert.equal(a.store.getSnapshot().pending, before);
});

test("a partner ticking the last step of my routine finishes it on my side, without a write of mine", async () => {
  const { a, b, parent, children } = await planned("a", "a", ["step", "step"]);
  const blocksOf = () => todayBlocks(a.rows(), "a", DAY);
  await a.flows().toggle(a.row(parent.id), a.row(children[0].id));
  assert.equal(finished(blocksOf()[0].progress), false);
  await a.store.sync();
  const pending = a.store.getSnapshot().pending;
  await b.flows().toggle(b.row(parent.id), b.row(children[1].id));
  for (const store of [b.store, a.store]) await store.sync();
  assert.equal(finished(blocksOf()[0].progress), true);
  assert.equal(a.store.getSnapshot().pending, pending);
  assert.deepEqual(a.row(children[1].id).data, { done_a: DAY });
});
