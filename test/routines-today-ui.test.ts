import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import type { ItemRow } from "../shared/tables.ts";
import { text } from "../src/ui/text.ts";
import { cascade, eachScreen, sheet } from "./css.ts";
import { item } from "./domain-rows.ts";
import { dom, find, mount, textOf } from "./hooks.ts";
import { load, markupOf } from "./render.ts";
import { stage } from "./render-store.ts";

const DAY = "2026-10-26";

const copy = text.routines;

const { TodayBlock, SETTLE_MS, QUIET_MS, SETTLE_CAP_MS } = await load("views/today-block.tsx");
const { RoutineAction } = await load("ui/routine-action.tsx");
const { Today, forget } = await load("views/today.tsx");

const mounted: { unmount: () => void }[] = [];

beforeEach(() => forget());

afterEach(() => {
  for (const view of mounted.splice(0)) view.unmount();
  mock.timers.reset();
});

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

const mountBlock = (t: { after: (fn: () => void) => void }, parent: ItemRow, done: number, total = 2, actions: ItemRow[] = [], start = done < total) => {
  const document = dom();
  mock.timers.reset();
  mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const { flows, calls } = flowsOf();
  const shown = { expanded: start };
  const folds: string[] = [];
  const props = (next: number) => ({ block: block(parent, next, total, actions), expanded: shown.expanded });
  const view = mount(
    TodayBlock,
    {
      ...props(done),
      items: [],
      flows,
      me: "a",
      day: DAY,
      onToggle: () => {
        shown.expanded = !shown.expanded;
        view.update({ expanded: shown.expanded });
      },
      onFold: () => {
        folds.push("fold");
        shown.expanded = false;
        view.update({ expanded: false });
      },
    },
    document,
  );
  t.after(() => {
    view.unmount();
    mock.timers.reset();
  });
  const hidden = () => find(view.tree, (element) => "hidden" in element.props)[0].props.hidden as boolean;
  const stateOf = () => (view.tree as any).props["data-fold"] as string;
  const said = () => textOf(find(view.tree, (element) => element.props.role === "status"));
  const progress = (next: number) => view.update({ block: block(parent, next, total, actions) });
  return { document, view, calls, flows, stateOf, said, progress, hidden, folds };
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
  assert.equal(view.node("button")?.kind, "button");
});

test("the folded row takes focus and stays quiet when the last tick had focus inside the card", (t) => {
  const parent = routine("Morning care");
  const { view, stateOf, said, progress, document } = mountBlock(t, parent, 1);
  view.node("rt-block")!.inside = true;
  document.activeElement = { kind: "input" };
  progress(2);
  mock.timers.tick(SETTLE_MS);
  assert.equal(stateOf(), "folded");
  assert.equal(document.activeElement, view.node("button"));
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
  assert.equal(view.node("button")?.kind, "button");
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
  assert.equal(find(view.tree, (element) => element.props.className === "rt-fold rt-live")[0].props["aria-expanded"], true);
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

test("the Step by step link sits in the header row of an open card that has a timer or four open steps, stays through the settle with what it showed, goes at the fold, and does not come back stale", (t) => {
  const parent = routine("Morning care");
  const steps = ["Cleanse", "Tone", "Serum", "Cream", "Mist"].map((title) => step(parent, title));
  const ticked = (count: number) => steps.map((row, index) => (index < count ? { ...row, data: { done_a: DAY } } : row));
  const go = (view: { tree: unknown }) => find(view.tree as never, (element) => String(element.props.className).includes("rt-go"));
  const word = (view: { tree: unknown }) => go(view).map(textOf);
  const none = mountBlock(t, parent, 1);
  assert.equal(go(none.view).length, 0);
  const short = mountBlock(t, parent, 0, 3, steps.slice(0, 3));
  assert.equal(go(short.view).length, 0);
  const some = mountBlock(t, parent, 0, 5, steps);
  assert.deepEqual(word(some.view), [copy.start.open]);
  assert.equal(find(some.view.tree, (element) => element.props.className === "rt-start").length, 0);
  assert.equal(go(some.view)[0].props["aria-label"], `${copy.start.open}: Morning care`);
  some.view.update({ block: block(parent, 1, 5, ticked(1)) });
  assert.deepEqual(word(some.view), [copy.start.resume]);
  some.view.update({ block: block(parent, 4, 5, ticked(4)) });
  assert.deepEqual(word(some.view), [copy.start.resume]);
  some.view.update({ block: block(parent, 5, 5, ticked(5)) });
  assert.equal(some.stateOf(), "settling");
  assert.deepEqual(word(some.view), [copy.start.resume]);
  mock.timers.tick(SETTLE_MS);
  assert.equal(some.stateOf(), "folded");
  assert.equal(go(some.view).length, 0);
  find(some.view.tree, (element) => element.props.className === "rt-fold")[0].props.onClick();
  assert.equal(some.stateOf(), "kept");
  assert.equal(go(some.view).length, 0);
  some.view.update({ block: block(parent, 4, 5, ticked(4)) });
  assert.equal(some.stateOf(), "open");
  assert.equal(go(some.view).length, 0);
});

test("a ticked row never makes the offer vanish before the last tick, and its label changes inside a box that always holds the wider one", (t) => {
  const parent = routine("Morning care");
  const steps = ["Cleanse", "Tone", "Serum", "Cream", "Mist"].map((title) => step(parent, title));
  const ticked = (count: number) => steps.map((row, index) => (index < count ? { ...row, data: { done_a: DAY } } : row));
  const go = (view: { tree: unknown }) => find(view.tree as never, (element) => String(element.props.className).includes("rt-go"));
  const word = (view: { tree: unknown }) => find(go(view)[0], (element) => element.props.className === "rt-word")[0];
  const { view } = mountBlock(t, parent, 0, 5, steps);
  assert.equal(word(view).props["data-wide"], copy.start.open);
  assert.equal(textOf(word(view)), copy.start.open);
  for (let count = 1; count < 5; count++) {
    view.update({ block: block(parent, count, 5, ticked(count)) });
    assert.equal(go(view).length, 1, `after ${count} ticks`);
    assert.equal(word(view).props["data-wide"], copy.start.open, `after ${count} ticks`);
    assert.equal(textOf(word(view)), copy.start.resume, `after ${count} ticks`);
  }
  assert.ok(copy.start.open.length >= copy.start.resume.length);
});

test("the Start label sits in a one-cell grid with a hidden copy of the wider label, so the link keeps the width and the line count of the wider label at every phone width and text size", () => {
  eachScreen(({ px, zoom, width }) => {
    const label = `${px}px ${zoom}`;
    const word = cascade(routinesCss, ".rt-word", width);
    assert.deepEqual([word.get("display"), word.get("justify-items"), word.get("text-align")], ["inline-grid", "center", "center"], label);
    const sizer = cascade(routinesCss, ".rt-word::after", width);
    assert.deepEqual([sizer.get("content"), sizer.get("visibility"), sizer.get("grid-area")], ["attr(data-wide)", "hidden", "1 / 1"], label);
    assert.equal(cascade(routinesCss, ".rt-word > *", width).get("grid-area"), "1 / 1", label);
    const link = cascade(routinesCss, ".rt-go", width);
    assert.deepEqual([link.get("flex"), link.get("max-width"), link.get("min-height")], ["none", "100%", "var(--target-min)"], label);
  });
});

test("the detail toolbar drops the glyphs of Start and Edit and the word of More when the row would not hold them, keeps the ellipsis, and keeps the natural widths that never stretch a control", () => {
  const glyphs = ".rt-tools:has(> .rt-lead) > :not([aria-haspopup]) > svg";
  const word = ".rt-tools:has(> .rt-lead) > [aria-haspopup] > .menu-word";
  const ellipsis = ".rt-tools:has(> .rt-lead) > [aria-haspopup] > svg";
  eachScreen(({ px, zoom, width }) => {
    const hidden = px === 412 && zoom === 1 ? undefined : "none";
    assert.equal(cascade(routinesCss, glyphs, width).get("display"), hidden, `${px}px ${zoom}`);
    assert.equal(cascade(routinesCss, word, width).get("display"), hidden, `${px}px ${zoom}`);
    assert.equal(cascade(routinesCss, ellipsis, width).get("display"), undefined, `${px}px ${zoom}`);
    assert.equal(cascade(routinesCss, ".rt-tools > *", width).get("flex"), "0 1 auto", `${px}px ${zoom}`);
  });
  for (const rem of [10, 18.5, 20, 25.5]) assert.deepEqual([at(glyphs, rem).get("display"), at(word, rem).get("display")], ["none", "none"], `${rem}rem`);
  for (const rem of [25.51, 26, 40]) assert.deepEqual([at(glyphs, rem).get("display"), at(word, rem).get("display")], [undefined, undefined], `${rem}rem`);
  assert.equal(at(".rt-tools > .rt-lead", 20).get("flex"), undefined);
});

test("a card's header row names the Start link it stands in for, so Back finds its routine when the offer is gone", (t) => {
  const parent = routine("Morning care");
  const { view } = mountBlock(t, parent, 1);
  const header = find(view.tree, (element) => element.type === "button" && element.props["data-replaces"] !== undefined);
  assert.equal(header.length, 1);
  assert.equal(header[0].props["data-replaces"], `#/routines/${parent.id}/start`);
  const heading = find(view.tree, (element) => element.type === "h3");
  assert.equal(find(heading[0], (element) => element.type === "a").length, 0);
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

test("Start over clears the routine and hands focus to its header row once it opens again, but not when the write fails", async (t) => {
  const parent = routine("Before going out", "on_demand");
  const run = async (result: unknown) => {
    const { view, flows, calls, stateOf, progress, document } = mountBlock(t, parent, 2, 2, [], true);
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
  assert.equal(good.document.activeElement, good.view.node("button"));
  mock.timers.reset();
  const bad = await run({ ok: false, errors: ["no"] });
  assert.equal(bad.stateOf(), "open");
  assert.notEqual(bad.document.activeElement, bad.view.node("button"));
});

test("a hand-off to the header row is spent when it happens, so a later reopen by a partner does not steal focus", async (t) => {
  const parent = routine("Before going out", "on_demand");
  const { view, flows, stateOf, progress, document } = mountBlock(t, parent, 2, 2, [], true);
  void flows;
  find(view.tree, (element) => element.props["aria-label"] === copy.againNamed("Before going out"))[0].props.onClick();
  await settle();
  progress(1);
  assert.equal(document.activeElement, view.node("button"));
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
  const next = flowsOf();
  const c = mountAction(t, target(parent, 3), parent, next.flows);
  c.button("rt-plus").props.onClick();
  await settle();
  assert.deepEqual(next.calls, ["plus"]);
  c.view.update({ action: target(parent, 5) });
  assert.equal(c.document.activeElement, c.document.body);
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
  mounted.push(view);
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
  assert.equal(html.includes("rt-done"), false);
  assert.match(html, /<span class="rt-tally">0 of 1<\/span>/);
  const only = routine("Before going out", "on_demand");
  stage([only, step(only, "Keys")]);
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 26, 8) });
  try {
    const alone = await markupOf("views/today.tsx", ({ Today: view }) => createElement(view));
    assert.equal(alone.includes("0 of 0"), false);
    assert.equal(alone.includes("rt-done"), false);
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

test("an open card offers Open routine with the routine's title as its name, and a collapsed one draws no body link", async () => {
  const { all } = rows();
  stage(all);
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 26, 8) });
  try {
    const html = await markupOf("views/today.tsx", ({ Today: view }) => createElement(view));
    assert.match(html, /<a class="rt-open" href="#\/routines\/[^"]+" aria-label="Open routine: Evening wind down">Open routine<\/a>/);
    assert.equal(html.includes("Open routine: Morning care"), false);
  } finally {
    mock.timers.reset();
  }
});

const placed = (view: { tree: unknown }, id: string) => {
  const blocks = find(view.tree as never, (element) => element.type === TodayBlock);
  const block = blocks.find((element) => element.key === id)!;
  const parent = find(view.tree as never, (element) => [element.props.children].flat(Infinity).includes(block))[0];
  const siblings = find(parent, (element) => element.type === TodayBlock);
  return { order: blocks.map((element) => element.key), siblings: siblings.map((element) => element.key), group: parent.props.className ?? null, fold: (block.props as any).block.progress.done };
};

const restage = (view: { update: (next: object) => void }, items: ItemRow[]) => {
  stage(items);
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 26, 8) });
  try {
    view.update({});
  } finally {
    mock.timers.reset();
  }
};

test("unticking a step in a card of the Done today group reopens it in the same place of the tree, so it is not remounted and keeps focus", async () => {
  const { done, open, need } = rows();
  const cleanse = step(done, "Cleanse", { done_a: DAY });
  const first = step(done, "Rinse", { done_a: DAY });
  const items = [done, cleanse, first, open, step(open, "Dim the lights"), need, step(need, "Keys")];
  const view = await today(items);
  const before = placed(view, done.id);
  assert.deepEqual(before.siblings, [done.id]);
  assert.equal(before.group, "rt-done");
  assert.equal(before.fold, 2);
  restage(view, [done, { ...cleanse, data: {} }, first, ...items.slice(3)]);
  const after = placed(view, done.id);
  assert.equal(after.fold, 1);
  assert.deepEqual({ ...after, fold: 0 }, { ...before, fold: 0 });
  view.unmount();
});

test("a partner unticking a step of a card in Done today moves nothing: same group, same order, same place in the tree", async () => {
  const early = routine("Night checks", "evening");
  const { done, open, need } = rows();
  const lock = step(early, "Lock the door", { done_a: DAY });
  const items = [done, step(done, "Cleanse", { done_a: DAY }), early, lock, step(early, "Lights", { done_a: DAY }), open, step(open, "Dim the lights"), need, step(need, "Keys")];
  const view = await today(items);
  const before = [done, early, open, need].map((row) => placed(view, row.id));
  assert.deepEqual(before[1].siblings.length, 2);
  restage(view, items.map((row) => (row.id === lock.id ? { ...row, data: {} } : row)));
  const after = [done, early, open, need].map((row) => placed(view, row.id));
  assert.deepEqual(after.map((place) => ({ ...place, fold: 0 })), before.map((place) => ({ ...place, fold: 0 })));
  assert.equal(after[1].fold, 1);
  view.unmount();
});

const textsOf = async (items: ItemRow[]) => {
  stage(items);
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 26, 8) });
  try {
    const html = await markupOf("views/today.tsx", ({ Today: view }) => createElement(view));
    return [...html.matchAll(/>([^<]+)</g)].map((found) => found[1]);
  } finally {
    mock.timers.reset();
  }
};

test("Today's text nodes are exactly the titles, labels and counts, with no stray text in the folded row, the groups or the after row", async () => {
  const { done, open, need } = rows();
  assert.deepEqual(await textsOf([done, step(done, "Cleanse", { done_a: DAY }), open, step(open, "Dim the lights"), need, step(need, "Keys", { done_a: DAY })]), [
    "Routines",
    "1 of 2",
    "Evening wind down",
    "Evening · 0 of 1",
    "Open routine",
    "Dim the lights",
    "Done today · 1",
    "Morning care",
    "Done",
    "Cleanse",
    "When needed",
    "1 of 1",
    "Before going out",
    "Done",
    "Keys",
    "All routines",
  ]);
});

test("Today with one routine, with none, and with one that is not scheduled today each say exactly their own text", async () => {
  const open = routine("Evening wind down", "evening");
  assert.deepEqual(await textsOf([open, step(open, "Dim the lights")]), ["Routines", "0 of 1", "Evening wind down", "Evening · 0 of 1", "Open routine", "Dim the lights", "All routines"]);
  assert.deepEqual(await textsOf([]), ["Routines", copy.emptyHome, copy.starter]);
  const other = item({ kind: "routine", status: null, who: "a", title: "Tuesday only", group_key: "morning", data: { days: "tue" } });
  assert.deepEqual(await textsOf([other, step(other, "Water the plants")]), ["Routines", copy.nothingToday, "All routines"]);
});

const routinesCss = sheet("views/routines.css");

const at = (selector: string, rem: number) => cascade(routinesCss, selector, rem);

const LARGE = [10, 12.2, 18.5];

const NORMAL = [18.51, 20, 24.375];

test("the folded row at large text drops Done, shrinks the tick box to the disc and its gap, and lets the name column shrink without a horizontal scroll", () => {
  for (const rem of LARGE) {
    assert.equal(at(".rt-block h3 .rt-state", rem).get("display"), "none", `${rem}rem`);
    assert.equal(at(".rt-block h3 .rt-tick", rem).get("width"), "var(--icon-l)", `${rem}rem`);
    assert.equal(at(".rt-block h3 .rt-tick", rem).get("height"), "var(--icon-l)", `${rem}rem`);
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

test("the Open routine link keeps a full-size target, the after row a quiet spacing and a quiet spacing around the Done today group", () => {
  assert.equal(at(".rt-open", 20).get("min-height"), "var(--target-min)");
  assert.equal(at(".rt-open", 20).get("align-items"), "center");
  assert.equal(at(".rt-after", 20).get("margin"), "var(--s2) 0 var(--s3)");
  assert.equal(at(".rt-done", 20).get("margin-top"), "var(--s4)");
  assert.equal(at(".rt-count.rt-reached svg", 20).get("width"), "var(--icon-l)");
});

const PINS: Record<string, Record<string, string>> = {
  ".rt-btns .rt-plus": { "min-width": "var(--target-min)", "min-height": "var(--target-min)", "margin-right": "0", padding: "0 var(--s3)" },
  ".rt-block .rt-fold::after": { content: '""', flex: "none", "align-self": "center", width: "0.5rem", height: "0.5rem", margin: "0 var(--s1) 0 0", border: "solid var(--ink-2)", "border-width": "0 2px 2px 0", transform: "translateY(-2px) rotate(45deg)" },
  '.rt-block .rt-fold[aria-expanded="true"]::after': { transform: "translateY(2px) rotate(-135deg)" },
  ".rt-block h3 .rt-fold": { "justify-content": "flex-start", gap: "var(--s2)", width: "100%", "min-height": "var(--row-min)", padding: "var(--s2) var(--s3) var(--s2) var(--s1)", "border-color": "transparent", "border-radius": "var(--r-group)", background: "var(--surface)", "box-shadow": "0 0 0 1px var(--line)", color: "var(--ink-2)", "font-weight": "550", "line-height": "1.3", "text-align": "left" },
  ".rt-block h3 .rt-tick": { display: "grid", flex: "none", "place-items": "center", width: "var(--target-min)", "min-width": "0", height: "var(--target-min)", margin: "0" },
  ".rt-tick svg": { "box-sizing": "border-box", width: "var(--icon-l)", height: "var(--icon-l)", padding: "3px", "border-radius": "50%", background: "var(--route)", color: "var(--bg)", "stroke-width": "var(--stroke-s)" },
  ".rt-block h3 .rt-name": { flex: "1 1 0", "min-width": "0", margin: "0", "overflow-wrap": "break-word", color: "var(--ink-2)", "font-weight": "550", "text-wrap": "pretty" },
  ".rt-block h3 .rt-state": { flex: "none", "min-width": "0", margin: "0", "font-size": "var(--fs-meta)", "font-weight": "600" },
  ".rt-done": { "margin-top": "var(--s4)" },
  ".rt-needed": { "margin-top": "var(--s4)" },
  ".rt-done > summary": { color: "var(--ink-2)", "font-size": "var(--fs-meta)", "font-weight": "700" },
  ".rt-needed > summary": { color: "var(--ink-2)", "font-size": "var(--fs-meta)", "font-weight": "700" },
  ".rt-after": { display: "flex", "flex-wrap": "wrap", "align-items": "center", "justify-content": "space-between", gap: "var(--s2) var(--s4)", margin: "var(--s2) 0 var(--s3)" },
  ".rt-today summary": { display: "flex", "flex-wrap": "wrap", "list-style": "none", "align-items": "center", "justify-content": "space-between", gap: "var(--s3)", "min-height": "var(--target-min)", cursor: "pointer" },
  ".rt-open": { display: "inline-flex", flex: "none", "align-items": "center", "min-height": "var(--target-min)" },
};

test("every declaration of the folded row, the disc, the chevron, the label, the group and the after row is pinned above the large text step", () => {
  for (const [selector, declarations] of Object.entries(PINS)) assert.deepEqual(Object.fromEntries(at(selector, 20)), declarations, selector);
});

test("the −1 and +1 pills keep a 44 px target on both axes at every phone width and text size", () => {
  eachScreen(({ px, zoom, width }) => {
    for (const selector of [".rt-btns .rt-plus", ".rt-btns .rt-minus"]) {
      const final = cascade(routinesCss, selector, width);
      assert.equal(final.get("min-width"), "var(--target-min)", `${selector} ${px}px ${zoom}`);
      assert.equal(final.get("min-height"), "var(--target-min)", `${selector} ${px}px ${zoom}`);
      assert.equal(final.get("height"), undefined, `${selector} ${px}px ${zoom}`);
    }
  });
});
