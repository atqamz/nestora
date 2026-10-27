import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import type { ItemRow } from "../shared/tables.ts";
import { text } from "../src/ui/text.ts";
import { cascade } from "./css.ts";
import { item } from "./domain-rows.ts";
import { dom, find, mount, textOf } from "./hooks.ts";
import { load, markupOf } from "./render.ts";
import { stage } from "./render-store.ts";

const DAY = "2026-10-26";

const copy = text.routines;

const { TodayBlock, SETTLE_MS, QUIET_MS, SETTLE_CAP_MS } = await load("views/today-block.tsx");
const { RoutineAction } = await load("ui/routine-action.tsx");
const { Today } = await load("views/today.tsx");

const routine = (title: string, group_key = "morning") => item({ kind: "routine", status: null, who: "a", title, group_key, data: {} });

const counter = (parent: ItemRow, title: string, qty: number, data: Record<string, unknown> | null = null) => item({ kind: "counter", status: null, parent_id: parent.id, title, qty, data });

const step = (parent: ItemRow, title: string, data: Record<string, unknown> | null = null) => item({ kind: "step", status: null, parent_id: parent.id, title, data });

const ok = { ok: true as const, id: "" };

const settle = () => new Promise((resolve) => setImmediate(resolve));

const block = (parent: ItemRow, done: number, total = 2, actions: ItemRow[] = []) => ({ routine: parent, actions, label: null, side: "a" as const, progress: { done, total } });

const flowsOf = () => {
  const calls: string[] = [];
  const stub = (name: string, result: unknown = ok) => async () => {
    calls.push(name);
    return result;
  };
  const flows = { toggle: stub("toggle"), plus: stub("plus"), minus: stub("minus"), clear: stub("clear") } as any;
  return { calls, flows };
};

const mountBlock = (t: { after: (fn: () => void) => void }, parent: ItemRow, done: number, total = 2, actions: ItemRow[] = []) => {
  const document = dom();
  mock.timers.reset();
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const { flows, calls } = flowsOf();
  const view = mount(TodayBlock, { block: block(parent, done, total, actions), items: [], flows, me: "a", day: DAY }, document);
  t.after(() => {
    view.unmount();
    mock.timers.reset();
  });
  const hidden = () => find(view.tree, (element) => "hidden" in element.props)[0].props.hidden as boolean;
  const stateOf = () => (view.tree as any).props["data-fold"] as string;
  const said = () => textOf(find(view.tree, (element) => element.props.role === "status"));
  const progress = (next: number) => view.update({ block: block(parent, next, total, actions) });
  return { document, view, calls, flows, stateOf, said, progress, hidden };
};

test("the settle is 600 ms, the quiet time 500 ms and the cap 3 s", () => {
  assert.deepEqual([SETTLE_MS, QUIET_MS, SETTLE_CAP_MS], [600, 500, 3000]);
});

test("a finished card settles for 600 ms, folds, and says it is done once when focus was elsewhere", (t) => {
  const parent = routine("Morning care");
  const { view, stateOf, said, progress, document } = mountBlock(t, parent, 1);
  assert.equal(stateOf(), "open");
  progress(2);
  assert.equal(stateOf(), "settling");
  mock.timers.tick(SETTLE_MS - 1);
  assert.equal(stateOf(), "settling");
  assert.equal(said(), "");
  mock.timers.tick(1);
  assert.equal(stateOf(), "folded");
  assert.equal(said(), copy.finished("Morning care"));
  assert.equal(document.activeElement, document.body);
  assert.equal(view.node("rt-fold")?.kind, "button");
});

test("the folded row takes focus and stays quiet when the last tick had focus inside the card", (t) => {
  const parent = routine("Morning care");
  const { view, stateOf, said, progress, document } = mountBlock(t, parent, 1);
  view.node("rt-block")!.inside = true;
  document.activeElement = { kind: "input" };
  progress(2);
  mock.timers.tick(SETTLE_MS);
  assert.equal(stateOf(), "folded");
  assert.equal(document.activeElement, view.node("rt-fold"));
  assert.equal(said(), "");
});

test("a focus outside the card is left alone at the fold", (t) => {
  const parent = routine("Morning care");
  const { view, document, progress } = mountBlock(t, parent, 1);
  const elsewhere = { kind: "input" };
  document.activeElement = elsewhere;
  progress(2);
  mock.timers.tick(SETTLE_MS);
  assert.equal(document.activeElement, elsewhere);
  assert.equal(view.node("rt-fold")?.kind, "button");
});

test("unticking during the settle keeps the card open, and a tick, untick, tick folds only 600 ms after the last tick", (t) => {
  const parent = routine("Morning care");
  const { stateOf, said, progress } = mountBlock(t, parent, 1);
  progress(2);
  mock.timers.tick(300);
  progress(1);
  assert.equal(stateOf(), "open");
  mock.timers.tick(SETTLE_MS * 2);
  assert.equal(stateOf(), "open");
  assert.equal(said(), "");
  progress(2);
  mock.timers.tick(100);
  progress(1);
  mock.timers.tick(100);
  progress(2);
  mock.timers.tick(SETTLE_MS - 1);
  assert.equal(stateOf(), "settling");
  mock.timers.tick(1);
  assert.equal(stateOf(), "folded");
});

test("a card that is unticked after the fold reopens, in place, with the announcement cleared, also from the expanded state", (t) => {
  const parent = routine("Morning care");
  const { stateOf, said, progress, view } = mountBlock(t, parent, 1);
  progress(2);
  mock.timers.tick(SETTLE_MS);
  assert.equal(said(), copy.finished("Morning care"));
  progress(1);
  assert.equal(stateOf(), "open");
  assert.equal(said(), "");
  progress(2);
  mock.timers.tick(SETTLE_MS);
  assert.equal(stateOf(), "folded");
  const toggle = find(view.tree, (element) => element.props.className === "rt-fold")[0];
  toggle.props.onClick();
  assert.equal(stateOf(), "kept");
  assert.equal(find(view.tree, (element) => element.props.className === "rt-fold")[0].props["aria-expanded"], true);
  progress(1);
  assert.equal(stateOf(), "open");
  assert.equal(said(), "");
  assert.equal(find(view.tree, (element) => element.props.className === "rt-fold").length, 0);
});

test("only the folded state hides the card's body", (t) => {
  const parent = routine("Morning care");
  const { view, stateOf, hidden, progress } = mountBlock(t, parent, 1);
  assert.deepEqual([stateOf(), hidden()], ["open", false]);
  progress(2);
  assert.deepEqual([stateOf(), hidden()], ["settling", false]);
  mock.timers.tick(SETTLE_MS);
  assert.deepEqual([stateOf(), hidden()], ["folded", true]);
  find(view.tree, (element) => element.props.className === "rt-fold")[0].props.onClick();
  assert.deepEqual([stateOf(), hidden()], ["kept", false]);
});

test("the Start link shows only on an open card that has something to walk through", (t) => {
  const parent = routine("Morning care");
  const start = (view: { tree: unknown }) => find(view.tree as never, (element) => element.props.className === "rt-start").length;
  const none = mountBlock(t, parent, 1);
  assert.equal(start(none.view), 0);
  const some = mountBlock(t, parent, 1, 2, [step(parent, "Cleanse")]);
  assert.equal(start(some.view), 1);
  some.progress(2);
  assert.equal(start(some.view), 0);
});

test("an open card shows its progress only when there is something to count", (t) => {
  const parent = routine("Morning care");
  const header = (view: { tree: unknown }) => textOf(find(view.tree as never, (element) => element.type === "h3"));
  const counted = mountBlock(t, parent, 1);
  assert.match(header(counted.view), /1 of 2/);
  const empty = mountBlock(t, parent, 0, 0);
  assert.equal(header(empty.view).includes("0 of 0"), false);
});

test("the settle listens in the capture phase and lets go of exactly the listeners it took", (t) => {
  const parent = routine("Morning care");
  const { document, progress } = mountBlock(t, parent, 1);
  progress(2);
  assert.deepEqual([...document.captured.values()], [true, true, true]);
  mock.timers.tick(SETTLE_MS);
  const left = [...document.listeners.values()].reduce((all, set) => all + set.size, 0);
  assert.equal(left, 0);
});

test("the folded row toggles between folded and kept and names the routine as done", (t) => {
  const parent = routine("Morning care");
  const { view, stateOf } = mountBlock(t, parent, 2);
  assert.equal(stateOf(), "folded");
  const toggle = () => find(view.tree, (element) => element.props.className === "rt-fold")[0];
  assert.equal(toggle().props["aria-label"], "Morning care done");
  assert.equal(toggle().props["aria-expanded"], false);
  toggle().props.onClick();
  assert.equal(stateOf(), "kept");
  assert.equal(toggle().props["aria-expanded"], true);
  toggle().props.onClick();
  assert.equal(stateOf(), "folded");
});

test("a tap or key within 500 ms of the fold delays it, so the card never folds under a thumb, and the wait is capped at 3 s", (t) => {
  const parent = routine("Morning care");
  const { stateOf, progress, document } = mountBlock(t, parent, 1);
  progress(2);
  mock.timers.tick(300);
  document.emit("pointerdown");
  mock.timers.tick(QUIET_MS - 1);
  assert.equal(stateOf(), "settling");
  mock.timers.tick(1);
  assert.equal(stateOf(), "folded");
});

test("each of pointerdown, touchstart and keydown re-arms the fold", (t) => {
  for (const event of ["pointerdown", "touchstart", "keydown"]) {
    const { stateOf, progress, document } = mountBlock(t, routine(event), 1);
    progress(2);
    mock.timers.tick(SETTLE_MS - 1);
    document.emit(event);
    mock.timers.tick(QUIET_MS - 1);
    assert.equal(stateOf(), "settling", event);
    mock.timers.tick(1);
    assert.equal(stateOf(), "folded", event);
    mock.timers.reset();
  }
});

test("steady taps cannot keep the card open past the cap", (t) => {
  const parent = routine("Morning care");
  const { stateOf, progress, document } = mountBlock(t, parent, 1);
  progress(2);
  for (let elapsed = 0; elapsed < SETTLE_CAP_MS - 100; elapsed += 100) {
    document.emit("pointerdown");
    mock.timers.tick(100);
  }
  assert.equal(stateOf(), "settling");
  mock.timers.tick(100);
  assert.equal(stateOf(), "folded");
});

test("the touch listeners live only while the card settles", (t) => {
  const parent = routine("Morning care");
  const { progress, document } = mountBlock(t, parent, 1);
  const listening = () => ["pointerdown", "touchstart", "keydown"].map((event) => document.listeners.get(event)?.size ?? 0);
  assert.deepEqual(listening(), [0, 0, 0]);
  progress(2);
  assert.deepEqual(listening(), [1, 1, 1]);
  mock.timers.tick(SETTLE_MS);
  assert.deepEqual(listening(), [0, 0, 0]);
  progress(1);
  progress(2);
  progress(1);
  assert.deepEqual(listening(), [0, 0, 0]);
});

test("Start over clears the routine and hands focus to its title link once it opens again, but not when the write fails", async (t) => {
  const parent = routine("Before going out", "on_demand");
  const run = async (result: unknown) => {
    const { view, flows, calls, stateOf, progress, document } = mountBlock(t, parent, 2);
    flows.clear = async () => {
      calls.push("clear");
      return result;
    };
    const again = find(view.tree, (element) => element.props["aria-label"] === copy.againNamed("Before going out"))[0];
    again.props.onClick();
    await settle();
    progress(1);
    return { view, calls, stateOf, document };
  };
  const good = await run(ok);
  assert.deepEqual(good.calls, ["clear"]);
  assert.equal(good.stateOf(), "open");
  assert.equal(good.document.activeElement, good.view.node("a"));
  mock.timers.reset();
  const bad = await run({ ok: false, errors: ["no"] });
  assert.equal(bad.stateOf(), "open");
  assert.notEqual(bad.document.activeElement, bad.view.node("a"));
});

test("a hand-off to the title link is spent when it happens, so a later reopen by a partner does not steal focus", async (t) => {
  const parent = routine("Before going out", "on_demand");
  const { view, flows, stateOf, progress, document } = mountBlock(t, parent, 2);
  void flows;
  find(view.tree, (element) => element.props["aria-label"] === copy.againNamed("Before going out"))[0].props.onClick();
  await settle();
  progress(1);
  assert.equal(document.activeElement, view.node("a"));
  document.activeElement = document.body;
  progress(2);
  mock.timers.tick(SETTLE_MS);
  assert.equal(stateOf(), "folded");
  document.activeElement = document.body;
  progress(1);
  assert.equal(stateOf(), "open");
  assert.equal(document.activeElement, document.body);
});

const actionProps = (parent: ItemRow, action: ItemRow, flows: unknown) => ({ routine: parent, action, flows: flows as any, me: "a" as const, today: DAY, active: true });

const mountAction = (t: { after: (fn: () => void) => void }, action: ItemRow, parent: ItemRow, flows: unknown, extra: Record<string, unknown> = {}) => {
  const document = dom();
  stage([]);
  const view = mount(RoutineAction, { ...actionProps(parent, action, flows), ...extra }, document);
  t.after(() => view.unmount());
  const button = (name: string) => find(view.tree, (element) => String(element.props.className).includes(name))[0];
  return { document, view, button };
};

const target = (parent: ItemRow, value: number) => counter(parent, "Iron", 5, { done_a: value > 0 ? DAY : null, value_a: value });

test("my own tap that reaches the target moves focus to −1, the +1 having gone from under it", async (t) => {
  const parent = routine("Vitamins");
  const { flows, calls } = flowsOf();
  const { document, view, button } = mountAction(t, target(parent, 4), parent, flows);
  document.activeElement = view.node("pill rt-plus");
  button("rt-plus").props.onClick();
  await settle();
  assert.deepEqual(calls, ["plus"]);
  document.activeElement = document.body;
  view.update({ action: target(parent, 5) });
  assert.equal(document.activeElement, view.node("pill rt-minus"));
});

test("a remote change that reaches the target does not move focus", async (t) => {
  const parent = routine("Vitamins");
  const { flows } = flowsOf();
  const { document, view } = mountAction(t, target(parent, 4), parent, flows);
  view.update({ action: target(parent, 5) });
  assert.equal(document.activeElement, document.body);
});

test("a remote change after my own tap that did not reach the target, or failed, does not move focus either", async (t) => {
  const parent = routine("Vitamins");
  const early = flowsOf();
  const a = mountAction(t, target(parent, 2), parent, early.flows);
  a.button("rt-plus").props.onClick();
  await settle();
  a.view.update({ action: target(parent, 5) });
  assert.equal(a.document.activeElement, a.document.body);
  const failing = flowsOf();
  failing.flows.plus = async () => ({ ok: false, errors: ["no"] });
  const b = mountAction(t, target(parent, 4), parent, failing.flows);
  b.button("rt-plus").props.onClick();
  await settle();
  b.view.update({ action: target(parent, 5) });
  assert.equal(b.document.activeElement, b.document.body);
});

test("a hand-off to −1 is spent when it happens, so a later remote change to the target does not steal focus", async (t) => {
  const parent = routine("Vitamins");
  const { flows } = flowsOf();
  const { document, view } = mountAction(t, target(parent, 4), parent, flows);
  view.node("pill rt-plus");
  (find(view.tree, (element) => String(element.props.className).includes("rt-plus"))[0].props.onClick as () => void)();
  await settle();
  document.activeElement = document.body;
  view.update({ action: target(parent, 5) });
  assert.equal(document.activeElement, view.node("pill rt-minus"));
  document.activeElement = document.body;
  view.update({ action: target(parent, 4) });
  view.update({ action: target(parent, 5) });
  assert.equal(document.activeElement, document.body);
});

test("my own tap leaves focus alone when it is already somewhere else, and in the detail", async (t) => {
  const parent = routine("Vitamins");
  const { flows } = flowsOf();
  const a = mountAction(t, target(parent, 4), parent, flows);
  a.button("rt-plus").props.onClick();
  await settle();
  const elsewhere = { kind: "input" };
  a.document.activeElement = elsewhere;
  a.view.update({ action: target(parent, 5) });
  assert.equal(a.document.activeElement, elsewhere);
  const b = mountAction(t, target(parent, 4), parent, flows, { full: true });
  b.button("rt-plus").props.onClick();
  await settle();
  b.view.update({ action: target(parent, 5) });
  assert.equal(b.document.activeElement, b.document.body);
});

test("−1 takes one off through flows.minus, is silent at zero, and reads −1 with the title as its name", async (t) => {
  const parent = routine("Vitamins");
  const { flows, calls } = flowsOf();
  const some = mountAction(t, target(parent, 3), parent, flows);
  const minus = some.button("rt-minus");
  assert.equal(textOf(minus.props.children), "−1");
  assert.equal(minus.props["aria-label"], "−1 Iron");
  minus.props.onClick();
  await settle();
  assert.deepEqual(calls, ["minus"]);
  const none = mountAction(t, target(parent, 0), parent, flows);
  none.button("rt-minus").props.onClick();
  await settle();
  assert.deepEqual(calls, ["minus"]);
  assert.equal(none.button("rt-minus").props["aria-disabled"], true);
  assert.equal(textOf(some.button("rt-plus").props.children), "+1");
});

test("the counter buttons swallow key repeat so a held key adds or takes one only once, and go dead when the action is not for today", (t) => {
  const parent = routine("Vitamins");
  const { flows } = flowsOf();
  for (const name of ["rt-minus", "rt-plus"]) {
    const live = mountAction(t, target(parent, 3), parent, flows);
    const swallowed: string[] = [];
    const key = (repeat: boolean) => live.button(name).props.onKeyDown({ repeat, preventDefault: () => swallowed.push(name) });
    key(false);
    assert.deepEqual(swallowed, [], name);
    key(true);
    assert.deepEqual(swallowed, [name], name);
    assert.equal(live.button(name).props.disabled, false, name);
    const off = mountAction(t, target(parent, 3), parent, flows, { active: false });
    assert.equal(off.button(name).props.disabled, true, name);
  }
});

const rows = () => {
  const done = routine("Morning care");
  const open = routine("Evening wind down", "evening");
  const need = routine("Before going out", "on_demand");
  return { all: [done, step(done, "Cleanse", { done_a: DAY }), open, step(open, "Dim the lights"), need, step(need, "Keys")], done, open, need };
};

const today = async (items: ItemRow[]) => {
  const document = dom();
  stage(items);
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 26, 8) });
  const view = mount(Today, {}, document);
  mock.timers.reset();
  return view;
};

test("each Today block is keyed by its own routine, in all three sections", async () => {
  const { all, done, open, need } = rows();
  const view = await today(all);
  const blocks = find(view.tree, (element) => element.type === TodayBlock);
  assert.deepEqual(blocks.map((element) => element.key), [open.id, done.id, need.id]);
  view.unmount();
});

test("Today draws no Done today label and no 0 of 0 tally when there is nothing to show for them", async () => {
  const { open, need } = rows();
  const html = await (async () => {
    stage([open, step(open, "Dim the lights"), need, step(need, "Keys")]);
    mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 26, 8) });
    try {
      return await markupOf("views/today.tsx", ({ Today: view }) => createElement(view));
    } finally {
      mock.timers.reset();
    }
  })();
  assert.equal(html.includes("rt-label"), false);
  assert.match(html, /<span class="rt-tally">0 of 1<\/span>/);
  const only = routine("Before going out", "on_demand");
  stage([only, step(only, "Keys")]);
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 26, 8) });
  try {
    const alone = await markupOf("views/today.tsx", ({ Today: view }) => createElement(view));
    assert.equal(alone.includes("0 of 0"), false);
    assert.equal(alone.includes("rt-label"), false);
    assert.equal(alone.includes("All done"), false);
  } finally {
    mock.timers.reset();
  }
});

test("Today has no When needed group, and no Done today label, when no routine belongs in them", async () => {
  const open = routine("Evening wind down", "evening");
  stage([open, step(open, "Dim the lights")]);
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 26, 8) });
  try {
    const html = await markupOf("views/today.tsx", ({ Today: view }) => createElement(view));
    assert.equal(html.includes("rt-needed"), false);
    assert.equal(html.includes("When needed"), false);
  } finally {
    mock.timers.reset();
  }
});

test("a folded card offers Open routine with the routine's title as its name", async () => {
  const { all } = rows();
  stage(all);
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 26, 8) });
  try {
    const html = await markupOf("views/today.tsx", ({ Today: view }) => createElement(view));
    assert.match(html, /<a href="#\/routines\/[^"]+" aria-label="Open routine: Morning care">Open routine<\/a>/);
    assert.equal(html.includes("Open routine: Evening wind down"), false);
  } finally {
    mock.timers.reset();
  }
});

const at = (selector: string, rem: number) => cascade("views/routines.css", selector, rem);

const LARGE = [10, 12.2, 18.5];

const NORMAL = [18.51, 20, 24.375];

test("the folded row at large text drops Done, shrinks the tick box to the disc and its gap, and lets the name column shrink without a horizontal scroll", () => {
  for (const rem of LARGE) {
    assert.equal(at(".rt-block h3 .rt-state", rem).get("display"), "none", `${rem}rem`);
    assert.equal(at(".rt-block h3 .rt-tick", rem).get("width"), "24px", `${rem}rem`);
    assert.equal(at(".rt-block h3 .rt-tick", rem).get("height"), "24px", `${rem}rem`);
    assert.equal(at(".rt-block h3 .rt-fold", rem).get("gap"), "var(--s1)", `${rem}rem`);
    assert.equal(at(".rt-block h3 .rt-name", rem).get("min-width"), "0", `${rem}rem`);
    assert.equal(at(".rt-block h3 .rt-name", rem).get("max-width"), undefined, `${rem}rem`);
  }
});

test("the folded row keeps its 100 percent look above the large text step", () => {
  for (const rem of NORMAL) {
    assert.equal(at(".rt-block h3 .rt-state", rem).get("display"), undefined, `${rem}rem`);
    assert.equal(at(".rt-block h3 .rt-tick", rem).get("width"), "var(--target-min)", `${rem}rem`);
    assert.equal(at(".rt-block h3 .rt-tick", rem).get("height"), "var(--target-min)", `${rem}rem`);
    assert.equal(at(".rt-block h3 .rt-fold", rem).get("gap"), "var(--s2)", `${rem}rem`);
    assert.equal(at(".rt-block h3 .rt-name", rem).get("min-width"), "0", `${rem}rem`);
    assert.equal(at(".rt-block h3 .rt-name", rem).get("max-width"), undefined, `${rem}rem`);
  }
});

test("the folded row's boxes: full width button, a name that grows and never splits a word, a fixed tick and chevron", () => {
  for (const rem of [...LARGE, ...NORMAL]) {
    const fold = at(".rt-block h3 .rt-fold", rem);
    assert.equal(fold.get("width"), "100%");
    assert.equal(fold.get("min-height"), "var(--row-min)");
    assert.equal(fold.get("justify-content"), "flex-start");
    assert.equal(fold.get("padding"), "var(--s2) var(--s3) var(--s2) var(--s1)");
    assert.equal(fold.get("text-align"), "left");
    const name = at(".rt-block h3 .rt-name", rem);
    assert.equal(name.get("flex"), "1 1 0");
    assert.equal(name.get("overflow-wrap"), "break-word");
    assert.equal(name.get("margin"), "0");
    const tick = at(".rt-block h3 .rt-tick", rem);
    assert.equal(tick.get("flex"), "none");
    assert.equal(tick.get("display"), "grid");
    assert.equal(tick.get("place-items"), "center");
    const chevron = at(".rt-block .rt-fold::after", rem);
    assert.equal(chevron.get("flex"), "none");
    assert.equal(chevron.get("width"), "0.5rem");
    assert.equal(chevron.get("height"), "0.5rem");
    assert.equal(chevron.get("align-self"), "center");
    assert.equal(chevron.get("margin"), "0 var(--s1) 0 0");
    assert.equal(at(".rt-block h3 .rt-state", Infinity).get("flex"), "none");
  }
});

test("the after row keeps a full-size target on its link and a quiet spacing around the Done today label", () => {
  assert.equal(at(".rt-after a", 20).get("min-height"), "var(--target-min)");
  assert.equal(at(".rt-after a", 20).get("align-items"), "center");
  assert.equal(at(".rt-after", 20).get("margin"), "var(--s2) 0 var(--s3)");
  assert.equal(at(".rt-label", 20).get("margin"), "var(--s5) 0 var(--s1)");
  assert.equal(at(".rt-count.rt-reached svg", 20).get("width"), "24px");
});

const PINS: Record<string, Record<string, string>> = {
  ".rt-btns .rt-plus": { "min-width": "var(--target-min)", "margin-right": "0", padding: "0 var(--s3)" },
  ".rt-block .rt-fold::after": { content: '""', flex: "none", "align-self": "center", width: "0.5rem", height: "0.5rem", margin: "0 var(--s1) 0 0", border: "solid var(--ink-2)", "border-width": "0 2px 2px 0", transform: "translateY(-2px) rotate(45deg)" },
  '.rt-block .rt-fold[aria-expanded="true"]::after': { transform: "translateY(2px) rotate(-135deg)" },
  ".rt-block h3 .rt-fold": { "justify-content": "flex-start", gap: "var(--s2)", width: "100%", "min-height": "var(--row-min)", padding: "var(--s2) var(--s3) var(--s2) var(--s1)", "border-color": "transparent", "border-radius": "var(--r-group)", background: "var(--surface)", "box-shadow": "0 0 0 1px var(--line)", color: "var(--ink-2)", "font-weight": "550", "line-height": "1.3", "text-align": "left" },
  ".rt-block h3 .rt-tick": { display: "grid", flex: "none", "place-items": "center", width: "var(--target-min)", "min-width": "0", height: "var(--target-min)", margin: "0" },
  ".rt-tick svg": { "box-sizing": "border-box", width: "24px", height: "24px", padding: "3px", "border-radius": "50%", background: "var(--route)", color: "var(--bg)", "stroke-width": "3" },
  ".rt-block h3 .rt-name": { flex: "1 1 0", "min-width": "0", margin: "0", "overflow-wrap": "break-word", color: "var(--ink-2)", "font-weight": "550", "text-wrap": "pretty" },
  ".rt-block h3 .rt-state": { flex: "none", "min-width": "0", margin: "0", "font-size": "var(--fs-meta)", "font-weight": "600" },
  ".rt-label": { margin: "var(--s5) 0 var(--s1)", color: "var(--ink-2)", "font-size": "var(--fs-meta)", "font-weight": "700" },
  ".rt-needed": { "margin-top": "var(--s4)" },
  ".rt-needed > summary": { color: "var(--ink-2)", "font-size": "var(--fs-meta)", "font-weight": "700" },
  ".rt-after": { display: "flex", "flex-wrap": "wrap", "align-items": "center", "justify-content": "space-between", gap: "var(--s2) var(--s4)", margin: "var(--s2) 0 var(--s3)" },
  ".rt-today summary": { display: "flex", "flex-wrap": "wrap", "list-style": "none", "align-items": "center", "justify-content": "space-between", gap: "var(--s3)", "min-height": "var(--target-min)", cursor: "pointer" },
  ".rt-after a": { display: "inline-flex", "align-items": "center", "min-height": "var(--target-min)" },
};

test("every declaration of the folded row, the disc, the chevron, the label, the group and the after row is pinned above the large text step", () => {
  for (const [selector, declarations] of Object.entries(PINS)) assert.deepEqual(Object.fromEntries(at(selector, 20)), declarations, selector);
});
