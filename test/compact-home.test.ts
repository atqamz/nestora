import { test, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import type { ItemRow } from "../shared/tables.ts";
import { openFirst } from "../src/domain/routines.ts";
import { glance, marks } from "../src/domain/timetable.ts";
import type { Slot } from "../src/domain/timetable.ts";
import { text } from "../src/ui/text.ts";
import { cascade, sheet } from "./css.ts";
import { item } from "./domain-rows.ts";
import { dom, find, mount, textOf } from "./hooks.ts";
import { load, markupOf } from "./render.ts";
import { stage } from "./render-store.ts";

const DAY = "2026-10-26";

const copy = text.routines;

const { TodayBlock } = await load("views/today-block.tsx");
const { Today, forget } = await load("views/today.tsx");
const { LateLine } = await load("views/week.tsx");

const mounted: { unmount: () => void }[] = [];

beforeEach(() => forget());

afterEach(() => {
  for (const view of mounted.splice(0)) view.unmount();
  mock.timers.reset();
  delete (globalThis as any).scrollBy;
});

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const routine = (title: string, group_key: string) => item({ kind: "routine", status: null, who: "a", title, group_key, data: {} });

const step = (parent: ItemRow, title: string, data: Record<string, unknown> | null = null) => item({ kind: "step", status: null, parent_id: parent.id, title, data });

const block = (parent: ItemRow, done: number, total: number) => ({ routine: parent, actions: [], label: null, side: "a" as const, progress: { done, total } });

const at = (hour: number, minute = 0) => hour * 60 + minute;

test("the routine that opens on Today is the first open one whose moment matches the hour: morning until noon, evening from 17:00, else the first open one", () => {
  const morning = block(routine("Morning care", "morning"), 0, 2);
  const evening = block(routine("Wind down", "evening"), 0, 2);
  const blocks = [evening, morning];
  assert.equal(openFirst(blocks, at(8)), morning.routine.id);
  assert.equal(openFirst(blocks, at(11, 59)), morning.routine.id);
  assert.equal(openFirst(blocks, at(12)), evening.routine.id);
  assert.equal(openFirst([morning, evening], at(12)), morning.routine.id);
  assert.equal(openFirst([morning, evening], at(16, 59)), morning.routine.id);
  assert.equal(openFirst([morning, evening], at(17)), evening.routine.id);
  assert.equal(openFirst([morning, evening], at(23, 30)), evening.routine.id);
  assert.equal(openFirst([morning, evening], at(0)), morning.routine.id);
});

test("a finished routine, an on-demand one and one with nothing to tick never open by themselves", () => {
  const done = block(routine("Done", "morning"), 2, 2);
  const need = block(routine("Before going out", "on_demand"), 0, 2);
  const empty = block(routine("Timetable", "morning"), 0, 0);
  const later = block(routine("Wind down", "evening"), 1, 2);
  assert.equal(openFirst([done, need, empty, later], at(8)), later.routine.id);
  assert.equal(openFirst([done, need, empty], at(8)), null);
  assert.equal(openFirst([], at(8)), null);
});

const slot = (title: string, start: string, end: string | null): Slot => ({ row: item({ kind: "block", title }), routine: routine("Week", "timetable"), start, end, where: null });

test("the partner's glance is the block that is on now and the one that comes next, nothing finished and nothing later", () => {
  const slots = [slot("Deep work", "09:30", "12:00"), slot("Lunch", "12:00", "13:00"), slot("Call", "14:00", "15:00"), slot("Gym", "17:30", "18:30")];
  const titles = (minutes: number) => glance(marks(slots, minutes)).map((mark) => mark.slot.row.title);
  assert.deepEqual(titles(at(10)), ["Deep work", "Lunch"]);
  assert.deepEqual(titles(at(12)), ["Lunch", "Call"]);
  assert.deepEqual(titles(at(13, 30)), ["Call"]);
  assert.deepEqual(titles(at(8)), ["Deep work"]);
  assert.deepEqual(titles(at(18)), ["Gym"]);
  assert.deepEqual(titles(at(19)), []);
});

test("with no block on now and none to come next, an untimed block still shows and the finished ones do not", () => {
  const slots = [slot("Done", "09:00", "10:00"), slot("Sometime", "", null), slot("Also sometime", "", null), slot("Third", "", null)];
  assert.deepEqual(glance(marks(slots, at(12))).map((mark) => mark.slot.row.title), ["Sometime", "Also sometime"]);
});

test("Home's partner block draws only the glance, and says so when nothing is left today", async () => {
  const week = item({ kind: "routine", title: "Week", who: "b", group_key: "timetable" });
  const block = (title: string, start: string, end: string) => item({ kind: "block", parent_id: week.id, title, data: { start_time: start, end_time: end } });
  const rows = [week, block("Deep work", "09:30", "12:00"), block("Lunch", "12:00", "13:00"), block("Call", "14:00", "15:00")];
  const draw = async (utc: number) => {
    stage(rows);
    mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 26, utc) });
    try {
      return await markupOf("views/them.tsx", ({ Them }) => createElement(Them));
    } finally {
      mock.timers.reset();
    }
  };
  const noon = await draw(3);
  assert.match(noon, /Deep work/);
  assert.match(noon, /Lunch/);
  assert.equal(noon.includes("Call"), false);
  const late = await draw(14);
  assert.equal(late.includes("Deep work"), false);
  assert.match(late, new RegExp(`<p class="empty">Nothing more in Partner&#x27;s timetable today\\.</p>`));
});

const mountToday = (items: ItemRow[], utcHour: number) => {
  const document = dom();
  stage(items);
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 26, utcHour) });
  const view = mount(Today, {}, document);
  mounted.push(view);
  mock.timers.reset();
  return view;
};

const blocksOf = (view: { tree: unknown }) => find(view.tree as never, (element) => element.type === TodayBlock);

const openIds = (view: { tree: unknown }) => blocksOf(view).filter((element) => element.props.expanded).map((element) => element.key);

const byKey = (view: { tree: unknown }, id: string | null) => blocksOf(view).find((element) => element.key === id)!;

const home = () => {
  const morning = routine("Morning care", "morning");
  const bag = routine("Office bag", "morning");
  const evening = routine("Wind down", "evening");
  const all = [morning, step(morning, "Cleanse"), bag, step(bag, "Laptop"), evening, step(evening, "Tidy"), step(evening, "Plan")];
  return { all, morning, bag, evening };
};

test("Today opens one routine, the one that fits the hour, and every other row is collapsed", () => {
  const { all, morning, evening } = home();
  const early = mountToday(all, 3);
  assert.deepEqual(openIds(early), [morning.id]);
  early.unmount();
  forget();
  const late = mountToday(all, 11);
  assert.deepEqual(openIds(late), [evening.id]);
  late.unmount();
});

test("tapping a collapsed row opens it and closes the open one; tapping the open row closes it; one at a time", () => {
  const { all, morning, bag, evening } = home();
  const view = mountToday(all, 3);
  byKey(view, bag.id).props.onToggle(null);
  assert.deepEqual(openIds(view), [bag.id]);
  byKey(view, evening.id).props.onToggle(null);
  assert.deepEqual(openIds(view), [evening.id]);
  byKey(view, evening.id).props.onToggle(null);
  assert.deepEqual(openIds(view), []);
  byKey(view, morning.id).props.onToggle(null);
  assert.deepEqual(openIds(view), [morning.id]);
  view.unmount();
});

test("a card that folds closes itself only when it was the open one, and nothing else opens in its place", () => {
  const { all, morning, bag } = home();
  const view = mountToday(all, 3);
  byKey(view, bag.id).props.onFold();
  assert.deepEqual(openIds(view), [morning.id]);
  byKey(view, morning.id).props.onFold();
  assert.deepEqual(openIds(view), []);
  view.unmount();
});

test("the open row is picked once: a tick, a new routine or the clock never moves it", () => {
  const { all, morning } = home();
  const view = mountToday(all, 3);
  const extra = routine("Another", "morning");
  stage([extra, step(extra, "One"), ...all]);
  view.update({});
  assert.deepEqual(openIds(view), [morning.id]);
  stage(all.map((row) => (row.parent_id === morning.id ? { ...row, data: { done_a: DAY } } : row)));
  view.update({});
  assert.deepEqual(openIds(view), [morning.id]);
  view.unmount();
});

test("rows that arrive after the first render still get their default, once", () => {
  const { all, evening } = home();
  const view = mountToday([], 11);
  assert.deepEqual(openIds(view), []);
  stage(all);
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 26, 11) });
  view.update({});
  mock.timers.reset();
  assert.deepEqual(openIds(view), [evening.id]);
  view.unmount();
});

test("a Today that showed no rows before leaving Home does not make Back remember a closed list", () => {
  const { all, morning } = home();
  mountToday([], 3).unmount();
  const view = mountToday(all, 3);
  assert.deepEqual(openIds(view), [morning.id]);
  view.unmount();
});

test("Back finds the same row open: the choice survives leaving Home, falls back when that routine is gone, and starts over on the next day", () => {
  const { all, morning, bag, evening } = home();
  const first = mountToday(all, 3);
  byKey(first, bag.id).props.onToggle(null);
  first.unmount();
  const again = mountToday(all, 3);
  assert.deepEqual(openIds(again), [bag.id]);
  again.unmount();
  const closed = mountToday(all, 3);
  byKey(closed, bag.id).props.onToggle(null);
  closed.unmount();
  const none = mountToday(all, 3);
  assert.deepEqual(openIds(none), []);
  byKey(none, morning.id).props.onToggle(null);
  none.unmount();
  const gone = mountToday(all.filter((row) => row.id !== morning.id && row.parent_id !== morning.id), 3);
  assert.deepEqual(openIds(gone), [bag.id]);
  gone.unmount();
  const tomorrow = mountToday(all, 3 + 24);
  assert.deepEqual(openIds(tomorrow), [morning.id]);
  tomorrow.unmount();
  void evening;
});

const HEAD = 60;

const pageOf = (view: { tree: unknown }, bodies: Record<string, number>, around: { above: number; below: number; viewport: number }) => {
  let scroll = 0;
  const order = () => blocksOf(view).map((element) => String(element.key));
  const bodyOf = (id: string) => (openIds(view).includes(id) ? bodies[id] ?? 244 : 0);
  const height = () => around.above + order().length * HEAD + order().reduce((sum, id) => sum + bodyOf(id), 0) + around.below;
  const max = () => Math.max(0, height() - around.viewport);
  const y = () => (scroll = Math.min(scroll, max()));
  const top = (id: string) => {
    const index = order().indexOf(id);
    return around.above + index * HEAD + order().slice(0, index).reduce((sum, other) => sum + bodyOf(other), 0) - y();
  };
  const calls: unknown[] = [];
  (globalThis as any).scrollBy = (options: { top: number }) => {
    calls.push(options);
    scroll = Math.max(0, Math.min(max(), y() + options.top));
  };
  return {
    calls,
    scrollTo: (to: number) => void (scroll = Math.max(0, Math.min(max(), to))),
    atBottom: () => (scroll = max()),
    scrolled: y,
    tap: (id: string) => {
      const before = top(id);
      byKey(view, id).props.onToggle({ getBoundingClientRect: () => ({ top: top(id) }) });
      return { before, after: top(id) };
    },
  };
};

const AROUND = { above: 200, below: 600, viewport: 780 };

const settled = (view: { tree: unknown }, id: string, bodies: Record<string, number> = {}, scroll: number | "bottom" = 0) => {
  const page = pageOf(view, bodies, AROUND);
  if (scroll === "bottom") page.atBottom();
  else page.scrollTo(scroll);
  return page;
};

test("a tap on a row below the open one collapses the open one only when the page can scroll by its height, otherwise the open row stays and nothing under the thumb moves", () => {
  const { all, morning, bag } = home();
  const top = mountToday(all, 3);
  const fresh = settled(top, bag.id, { [morning.id]: 244 }, 0);
  const first = fresh.tap(bag.id);
  assert.equal(first.after, first.before);
  assert.deepEqual(openIds(top).sort(), [morning.id, bag.id].sort());
  top.unmount();
  forget();
  const deep = mountToday(all, 3);
  const scrolled = settled(deep, bag.id, { [morning.id]: 244 }, 244);
  const second = scrolled.tap(bag.id);
  assert.equal(second.after, second.before);
  assert.deepEqual(openIds(deep), [bag.id]);
  assert.deepEqual(scrolled.calls, [{ top: -244, behavior: "instant" }]);
  deep.unmount();
  forget();
  const short = mountToday(all, 3);
  const almost = settled(short, bag.id, { [morning.id]: 244 }, 243);
  const third = almost.tap(bag.id);
  assert.equal(third.after, third.before);
  assert.deepEqual(openIds(short).sort(), [morning.id, bag.id].sort());
});

test("a tap on a row above the open one opens it and collapses the open one below it without moving the tapped header", () => {
  const { all, morning, evening } = home();
  const view = mountToday(all, 11);
  assert.deepEqual(openIds(view), [evening.id]);
  const page = settled(view, morning.id, { [evening.id]: 400 }, 0);
  const moved = page.tap(morning.id);
  assert.equal(moved.after, moved.before);
  assert.deepEqual(openIds(view), [morning.id]);
  assert.deepEqual(page.calls, []);
});

test("at the bottom of the page a tap above the open row leaves it open when closing it would shorten the page under the thumb", () => {
  const { all, morning, evening } = home();
  const view = mountToday(all, 11);
  const page = settled(view, morning.id, { [morning.id]: 100, [evening.id]: 400 }, "bottom");
  const bottom = page.scrolled();
  const moved = page.tap(morning.id);
  assert.equal(moved.after, moved.before);
  assert.deepEqual(openIds(view).sort(), [morning.id, evening.id].sort());
  assert.equal(page.scrolled(), bottom);
});

test("the next tap applies the same rule to every row that is still open", () => {
  const { all, morning, bag, evening } = home();
  const view = mountToday(all, 3);
  const page = settled(view, bag.id, {}, 0);
  page.tap(bag.id);
  page.scrollTo(300);
  const stay = page.tap(evening.id);
  assert.equal(stay.after, stay.before);
  assert.deepEqual(openIds(view).sort(), [morning.id, bag.id, evening.id].sort());
  page.tap(evening.id);
  assert.deepEqual(openIds(view).sort(), [morning.id, bag.id].sort());
  page.scrollTo(600);
  const fold = page.tap(evening.id);
  assert.equal(fold.after, fold.before);
  assert.deepEqual(openIds(view), [evening.id]);
  page.scrollTo(600);
  const again = page.tap(bag.id);
  assert.equal(again.after, again.before);
  assert.deepEqual(openIds(view), [bag.id]);
});

test("closing the tapped row itself is never undone, even when the page shortens under it, and leaves the other open rows alone", () => {
  const { all, morning, bag } = home();
  const view = mountToday(all, 3);
  const page = settled(view, morning.id, {}, "bottom");
  page.tap(morning.id);
  assert.deepEqual(openIds(view), []);
  view.unmount();
  forget();
  const both = mountToday(all, 3);
  const two = settled(both, bag.id, {}, 0);
  two.tap(bag.id);
  assert.deepEqual(openIds(both).sort(), [morning.id, bag.id].sort());
  two.scrollTo(300);
  two.tap(bag.id);
  assert.deepEqual(openIds(both), [morning.id]);
});

test("a stale hold is spent: a fold after the tap does not scroll the page by a drift measured against the old node", () => {
  const { all, morning, bag } = home();
  const view = mountToday(all, 3);
  const page = settled(view, bag.id, {}, 300);
  page.tap(bag.id);
  assert.deepEqual(openIds(view), [bag.id]);
  const before = page.calls.length;
  page.scrollTo(0);
  byKey(view, bag.id).props.onFold();
  assert.deepEqual(openIds(view), []);
  assert.equal(page.calls.length, before);
  void morning;
});

test("Back finds every row that was left open", () => {
  const { all, morning, bag } = home();
  const first = mountToday(all, 3);
  settled(first, bag.id, {}, 0).tap(bag.id);
  assert.deepEqual(openIds(first).sort(), [morning.id, bag.id].sort());
  first.unmount();
  const again = mountToday(all, 3);
  assert.deepEqual(openIds(again).sort(), [morning.id, bag.id].sort());
});

test("the Done today group stays shut with its count, and opens by itself while a card in it is open again", () => {
  const { morning, bag, evening } = home();
  const done = (parent: ItemRow, title: string) => step(parent, title, { done_a: DAY });
  const cleanse = done(morning, "Cleanse");
  const laptop = done(bag, "Laptop");
  const rows = [morning, cleanse, bag, laptop, evening, step(evening, "Tidy")];
  const view = mountToday(rows, 8);
  const group = () => find(view.tree, (element) => element.props.className === "rt-done")[0];
  assert.equal(group().props.open, false);
  assert.equal(textOf(find(group(), (element) => element.type === "summary")), "Done today · 2");
  stage([morning, { ...cleanse, data: {} }, bag, laptop, evening, step(evening, "Tidy")]);
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 26, 8) });
  view.update({});
  mock.timers.reset();
  assert.equal(group().props.open, true);
  view.unmount();
  const shut = mountToday(rows, 8);
  const groupOf = () => find(shut.tree, (element) => element.props.className === "rt-done")[0];
  groupOf().props.onToggle({ currentTarget: { open: true } });
  assert.equal(groupOf().props.open, true);
  groupOf().props.onToggle({ currentTarget: { open: false } });
  assert.equal(groupOf().props.open, false);
  shut.unmount();
});

const header = (view: { tree: unknown }) => find(view.tree as never, (element) => element.type === "button" && String(element.props.className).includes("rt-fold"))[0];

const mountBlock = (expanded: boolean, done: number, total: number, extra: Record<string, unknown> = {}) => {
  const document = dom();
  const calls: unknown[] = [];
  const parent = routine("Morning care", "morning");
  const view = mount(
    TodayBlock,
    { block: block(parent, done, total), items: [], flows: {}, me: "a", day: DAY, expanded, onToggle: (box: unknown) => void calls.push(box), onFold: () => undefined, ...extra },
    document,
  );
  mounted.push(view);
  return { view, calls, parent };
};

test("the header row is one button that says whether the card is open, holds the name, the moment and the count, and hands its own node up on a tap", () => {
  const closed = mountBlock(false, 1, 3);
  const row = header(closed.view);
  assert.equal(row.props["aria-expanded"], false);
  assert.equal(textOf(row), "Morning careMorning · 1 of 3");
  assert.equal(row.props["aria-label"], undefined);
  assert.equal(find(closed.view.tree, (element) => element.props.hidden === true).length, 1);
  row.props.onClick();
  assert.equal(closed.calls.length, 1);
  assert.equal(closed.calls[0], closed.view.node("button"));
  const open = mountBlock(true, 1, 3);
  assert.equal(header(open.view).props["aria-expanded"], true);
  assert.equal(find(open.view.tree, (element) => element.props.hidden === true).length, 0);
  assert.equal(find(open.view.tree, (element) => element.type === "a" && element.props["aria-label"] === copy.openRoutineNamed("Morning care")).length, 1);
  assert.equal(find(open.view.tree, (element) => element.type === "h3").flatMap((h3) => find(h3, (element) => element.type === "a")).length, 0);
});

test("the header row says nothing about a count when there is nothing to count", () => {
  assert.equal(textOf(header(mountBlock(false, 0, 0).view)), "Morning careMorning");
});

const late = async (tasks: ItemRow[], payments: unknown[] = []) => {
  stage(tasks, [], payments);
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 26, 3) });
  try {
    return await markupOf("views/week.tsx", ({ LateLine }) => createElement(LateLine));
  } finally {
    mock.timers.reset();
  }
};

test("the Late line shows the count of what is late and names where it goes, and is gone when nothing is late", async () => {
  const task = (title: string, due: string | null) => item({ kind: "task", title, status: "todo", due_on: due });
  assert.equal(await late([task("Soon", "2026-10-28"), task("No date", null)]), "");
  const html = await late([task("Venue tour", "2026-10-24"), task("Florist", "2026-10-25"), task("Soon", "2026-10-28")]);
  assert.match(html, /<button type="button" class="rt-late" aria-label="Late · 2, go to the late list"><svg/);
  assert.match(html, /<span>Late · 2<\/span>/);
  assert.equal(copy.title, "Routines");
});

test("the Late button scrolls the Late heading into view without animation and focuses it without a second scroll", () => {
  const document = dom();
  const calls: string[] = [];
  const group = { scrollIntoView: (options: unknown) => void calls.push(`scroll ${JSON.stringify(options)}`), focus: (options: unknown) => void calls.push(`focus ${JSON.stringify(options)}`) };
  const asked: string[] = [];
  (document as any).getElementById = (id: string) => (asked.push(id), group);
  stage([item({ kind: "task", title: "Venue tour", status: "todo", due_on: "2026-10-24" })]);
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 26, 3) });
  const view = mount(LateLine, {}, document);
  mounted.push(view);
  mock.timers.reset();
  const button = find(view.tree, (element) => element.type === "button")[0];
  button.props.onClick();
  assert.deepEqual(asked, ["week-overdue"]);
  assert.deepEqual(calls, ['scroll {"block":"start","behavior":"instant"}', 'focus {"preventScroll":true}']);
});

test("the Late heading can take focus", async () => {
  stage([item({ kind: "task", title: "Venue tour", status: "todo", due_on: "2026-10-24" })]);
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 26, 3) });
  try {
    const html = await markupOf("views/week.tsx", ({ Week }) => createElement(Week));
    assert.match(html, /<h3 id="week-overdue" data-late="true" tabindex="-1">/);
  } finally {
    mock.timers.reset();
  }
});

test("Home: the h1 is today's date and keeps Home as the page name, the Late line sits above Today and below the capture row", () => {
  const source = read("views/home.tsx");
  assert.match(source, /<Title name=\{text\.nav\.home\}>\{text\.routines\.today\(formatDay\(day, day\)\)\}<\/Title>/);
  assert.match(source, /<Capture \/>\s*<LateLine \/>\s*<Today \/>/);
  assert.match(read("main.tsx"), /const heading = title\?\.dataset\.title \?\? title\?\.textContent;/);
  assert.equal(copy.today("Mon, 26 Oct"), "Today, Mon 26 Oct");
  assert.equal(copy.today("Sat, 30 Oct 2027"), "Today, Sat 30 Oct 2027");
  assert.equal(copy.today("Mon 26 Oct"), "Today, Mon 26 Oct");
});

test("the title keeps its page name in data-title only when one is given", async () => {
  const named = await markupOf("ui/title.tsx", ({ Title }) => createElement(Title, { name: "Home" }, "Today, Mon 26 Oct"));
  assert.equal(named, '<h1 tabindex="-1" data-title="Home">Today, Mon 26 Oct</h1>');
  const plain = await markupOf("ui/title.tsx", ({ Title }) => createElement(Title, {}, "Routines"));
  assert.equal(plain, '<h1 tabindex="-1">Routines</h1>');
});

const css = sheet("views/routines.css");

test("the Late line is a full-width 44 px target in the late colours, and the row's second line is the quiet count", () => {
  for (const rem of [10, 18.5, 24]) {
    const strip = cascade(css, ".rt-late", rem);
    assert.deepEqual([strip.get("width"), strip.get("min-height"), strip.get("color"), strip.get("background")], ["100%", "var(--target-min)", "var(--late)", "var(--late-bg)"], `${rem}rem`);
    assert.equal(cascade(css, ".rt-late span", rem).get("overflow-wrap"), "break-word");
    const sub = cascade(css, ".rt-block h3 .rt-sub", rem);
    assert.deepEqual([sub.get("display"), sub.get("color"), sub.get("font-variant-numeric")], ["block", "var(--ink-2)", "tabular-nums lining-nums"], `${rem}rem`);
    assert.equal(cascade(css, ".rt-block h3 .rt-live", rem).get("color"), "var(--ink)");
  }
  assert.doesNotMatch(readFileSync(new URL("../src/views/routines.css", import.meta.url), "utf8"), /\.rt-late[^{]*\{[^}]*(transition|animation)/);
});
