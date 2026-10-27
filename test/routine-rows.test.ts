import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import type { ItemRow } from "../shared/tables.ts";
import { menuTarget } from "../src/domain/menu.ts";
import { swallowClicks } from "../src/ui/swallow-clicks.ts";
import { routineMenu } from "../src/ui/routine-menu.ts";
import { routineFlows } from "../src/ui/routine-flows.ts";
import { formatDate, formatDay } from "../src/ui/format.ts";
import { rowStatus } from "../src/ui/routine-label.ts";
import { text } from "../src/ui/text.ts";
import { item } from "./domain-rows.ts";
import { markupOf } from "./render.ts";
import { stage } from "./render-store.ts";
import { createServer } from "./store-server.ts";
import { client, idOf } from "./store-client.ts";

const TODAY = "2026-10-26";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const routine = (data: Record<string, unknown> | null, who: "a" | "b" | "both" = "a", title = "Morning routine"): ItemRow => item({ kind: "routine", status: null, who, title, group_key: "morning", data });

const step = (parent: ItemRow, title: string, data: Record<string, unknown> | null = null) => item({ kind: "step", status: null, parent_id: parent.id, title, data });

test("a row states one fact: paused beats done, done beats the count, and the count beats the next day", () => {
  assert.equal(rowStatus(routine({ paused_until: "2026-10-31" }), TODAY, { done: 3, total: 3 }), `Paused until ${formatDate("2026-10-31")}`);
  assert.equal(rowStatus(routine({}), TODAY, { done: 3, total: 3 }), "Done today");
  assert.equal(rowStatus(routine({}), TODAY, { done: 1, total: 3 }), "1 of 3 today");
  assert.equal(rowStatus(routine({}), TODAY, { done: 0, total: 2 }), "0 of 2 today");
  assert.equal(rowStatus(routine({ days: "SU" }), TODAY, { done: 3, total: 3 }), `Next ${formatDay("2026-11-01", TODAY)}`);
  assert.equal(rowStatus(routine({ days: "SU" }), TODAY, { done: 0, total: 0 }), `Next ${formatDay("2026-11-01", TODAY)}`);
});

test("a row with no steps today, or a routine that is not mine, says Today and never a count", () => {
  assert.equal(rowStatus(routine({}), TODAY, { done: 0, total: 0 }), "Today");
  assert.equal(rowStatus(routine({}, "b"), TODAY, null), "Today");
  assert.equal(rowStatus(routine({ days: "SU" }, "b"), TODAY, null), `Next ${formatDay("2026-11-01", TODAY)}`);
  assert.equal(rowStatus(routine({ paused_until: "2026-11-02" }, "b"), TODAY, null), `Paused until ${formatDate("2026-11-02")}`);
});

test("the menu keys wrap at both ends, Home and End jump, and any other key is left alone", () => {
  assert.equal(menuTarget("ArrowDown", 0, 3), 1);
  assert.equal(menuTarget("ArrowDown", 2, 3), 0);
  assert.equal(menuTarget("ArrowDown", -1, 3), 0);
  assert.equal(menuTarget("ArrowUp", 1, 3), 0);
  assert.equal(menuTarget("ArrowUp", 0, 3), 2);
  assert.equal(menuTarget("ArrowUp", -1, 3), 2);
  assert.equal(menuTarget("Home", 2, 3), 0);
  assert.equal(menuTarget("End", 0, 3), 2);
  assert.equal(menuTarget("Tab", 0, 3), null);
  assert.equal(menuTarget("ArrowDown", 0, 0), null);
});

const buttonsIn = (html: string) => [...html.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);

const rowsOf = (html: string) => [...html.matchAll(/<li><div class="row rt-row">(.*?)<\/div><\/li>/g)].map((match) => match[1]);

const mount = async (id?: string) => {
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 26, 8) });
  try {
    return await markupOf("views/routines.tsx", ({ Routines }) => createElement(Routines, { id }));
  } finally {
    mock.timers.reset();
  }
};

const seed = () => {
  const mineDone = routine({}, "a", "Morning care");
  const minePaused = routine({ paused_until: "2026-10-31" }, "a", "Night reading");
  const theirs = routine({}, "b", "Gym session");
  const theirsPaused = routine({ paused_until: "2026-11-02" }, "b", "Iron supplement");
  const secret = routine({ private: true }, "a", "Journal");
  return { mineDone, minePaused, theirs, theirsPaused, secret, rows: [mineDone, minePaused, theirs, theirsPaused, secret, step(mineDone, "Cleanse", { done_a: TODAY }), step(minePaused, "Read"), step(theirs, "Lift"), step(secret, "Write")] };
};

test("every routine row is one link with its state and a chevron, and a paused row adds only Resume, for either partner's routines", async () => {
  stage(seed().rows);
  const rows = rowsOf(await mount());
  assert.equal(rows.length, 5);
  for (const row of rows) assert.equal([...row.matchAll(/<a\b/g)].length, 1);
  const by = (title: string) => rows.find((row) => row.includes(`>${title}</span>`))!;
  assert.match(by("Morning care"), /<span class="meta"><span>Done today<\/span><\/span><\/span><svg/);
  assert.match(by("Journal"), /<span>0 of 1 today<\/span><span>Only you<\/span>/);
  assert.match(by("Gym session"), /<span class="meta"><span>Today<\/span><\/span><\/span><svg/);
  for (const title of ["Morning care", "Journal", "Gym session"]) assert.deepEqual(buttonsIn(by(title)), [], title);
  for (const title of ["Night reading", "Iron supplement"]) {
    const row = by(title);
    assert.deepEqual(buttonsIn(row), [`<button type="button" class="pill rt-resume" aria-label="Resume ${title}">`], title);
    assert.doesNotMatch(row, /<svg/);
    assert.match(row, /Paused until /);
  }
});

test("no routine row names Pause or Duplicate, and the list renders no sheet for either", async () => {
  stage(seed().rows);
  const html = await mount();
  assert.equal(/\bPause\b|Duplicate/.test(html), false);
  assert.equal(html.includes("<dialog"), false);
  const source = read("views/routines.tsx");
  assert.doesNotMatch(source, /PauseSheet|copyDraft|onCopy|onPause|pauseNamed|duplicateNamed/);
});

test("the routine page keeps Edit beside one More menu, named for the routine, and shows no Duplicate, Pause or Delete until it opens", async () => {
  const { mineDone, rows } = seed();
  stage(rows);
  const html = await mount(mineDone.id);
  const tools = html.slice(html.indexOf('class="rt-tools"'), html.indexOf("</div>", html.indexOf('class="rt-tools"')));
  const buttons = buttonsIn(tools);
  assert.equal(buttons.length, 2);
  assert.match(buttons[1], /aria-haspopup="menu" aria-expanded="false" aria-label="More actions for Morning care"/);
  assert.doesNotMatch(tools, /Duplicate|Pause|Resume|Delete/);
  assert.match(tools, /<span class="menu-word">More<\/span><\/button>/);
});

test("the edit sheet no longer carries Delete or the Paused until date", () => {
  const sheet = read("ui/routine-sheet.tsx");
  assert.doesNotMatch(sheet, /rt-delete|flows\.remove|form\.delete|routine-paused|pausedUntil/);
  assert.equal("delete" in text.routines.form, false);
  assert.equal("pausedUntil" in text.routines.form, false);
});

test("the More menu is the native modal: its first item takes focus, the keys go through menuTarget, and an item closes the dialog before it runs so focus returns to the button", () => {
  const menu = read("ui/menu.tsx");
  assert.match(menu, /<Modal title=\{text\.menu\.more\} onClose=\{\(\) => setOpen\(false\)\} dismissible className="menu-sheet" style=\{anchor\}>/);
  assert.match(menu, /role="menu" aria-label=\{name\} onKeyDown=\{move\}/);
  assert.match(menu, /data-first=\{index === 0 \? "" : undefined\}/);
  assert.match(menu, /menuTarget\(event\.key, entries\.indexOf\(document\.activeElement as HTMLElement\), entries\.length\)/);
  assert.match(menu, /aria-haspopup="menu" aria-expanded=\{open\} aria-label=\{name\}/);
  assert.match(menu, /closest\("dialog"\)\?\.close\(\);\s*setOpen\(false\);\s*item\.run\(\);/);
  assert.match(read("views/routine.tsx"), /name=\{copy\.moreNamed\(routine\.title\)\}/);
  assert.equal(text.routines.moreNamed("Evening"), "More actions for Evening");
});

test("the menu offers Duplicate, then Pause or Resume, then Delete last and marked dangerous, each running its own handler", () => {
  const calls: string[] = [];
  const handlers = { open: (sheet: string) => calls.push(`open ${sheet}`), resume: () => calls.push("resume"), remove: () => calls.push("remove") };
  const live = routineMenu({ away: false, ...handlers } as Parameters<typeof routineMenu>[0]);
  assert.deepEqual(live.map((entry) => [entry.label, entry.danger ?? false]), [["Duplicate", false], ["Pause", false], ["Delete", true]]);
  for (const entry of live) entry.run();
  assert.deepEqual(calls.splice(0), ["open copy", "open pause", "remove"]);
  const away = routineMenu({ away: true, ...handlers } as Parameters<typeof routineMenu>[0]);
  assert.deepEqual(away.map((entry) => entry.label), ["Duplicate", "Resume", "Delete"]);
  for (const entry of away) entry.run();
  assert.deepEqual(calls, ["open copy", "resume", "remove"]);
  const page = read("views/routine.tsx");
  assert.match(page, /items=\{routineMenu\(\{\s*away,\s*open: setSheet,/);
  assert.match(page, /resume: guard\(\(\) => void once\(async \(\) => setFailure\(failureOf\(await flows\.resume\(routine\)\)\)\)\),\s*remove: guard\(\(\) => void once\(async \(\) => setFailure\(failureOf\(await flows\.remove\(routine\)\)\)\)\),/);
});

test("the menu keeps its roles, its danger class, its More icon, and stops the page from scrolling on an arrow key", () => {
  const menu = read("ui/menu.tsx");
  assert.match(menu, /type="button"\s*role="menuitem"/);
  assert.match(menu, /className=\{item\.danger \? "danger" : undefined\}/);
  assert.match(menu, /<Icon name="more" \/>/);
  assert.match(menu, /if \(to === null\) return;\s*event\.preventDefault\(\);\s*entries\[to\]\.focus\(\);/);
});

test("the Resume pill writes through flows.resume, is guarded while it runs, and shows a failure under its row", () => {
  const list = read("views/routines.tsx");
  assert.match(list, /disabled=\{busy\} aria-disabled=\{locked \|\| undefined\} aria-label=\{copy\.resumeNamed\(routine\.title\)\} onClick=\{guard\(\(\) => void once\(async \(\) => setFailure\(failureOf\(await flows\.resume\(routine\)\)\)\)\)\}/);
  assert.match(list, /\{failure\.length > 0 && \(\s*<p className="error" role="alert">/);
});

test("a menu item is at least 44 px tall, and Delete sits last, apart, in the late colour", () => {
  const css = read("ui/ui.css");
  const block = (selector: string) => new RegExp(`\\n${selector.replace(/[.]/g, "\\.")} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
  assert.match(block(".menu button"), /min-height:\s*3\.25rem/);
  assert.match(block(".menu button.danger"), /color:\s*var\(--late\)/);
  assert.match(block(".menu button.danger"), /border-top:/);
});

test("the row link keeps a 44 px target and its chevron gives way to large text", () => {
  const css = read("views/routines.css");
  assert.match(/\.rt-link \{([^}]*)\}/.exec(css)![1], /min-height:\s*var\(--row-min\)/);
  assert.match(/@media \(max-width: 19rem\) \{([\s\S]*?)\n\}/.exec(css)![1], /\.rt-link svg \{\s*display: none;/);
  assert.match(/\.rt-text \{([^}]*)\}/.exec(css)![1], /min-width:\s*0/);
});

test("the partner resumes, pauses and deletes my routine from the detail flows and I see each change, with nothing else on the row touched", async () => {
  const server = createServer();
  const a = client(server, "a");
  const b = client(server, "b");
  await a.store.open();
  await b.store.open();
  const id = idOf(await a.store.create("items", { kind: "routine", title: "Evening", who: "a", data: { paused_until: "2026-11-02" } }));
  const stepId = idOf(await a.store.create("items", { kind: "step", title: "Lights off", parent_id: id, sort: 1 }));
  await a.store.sync();
  await b.store.sync();
  const mine = (who: typeof a) => who.store.getSnapshot().rows.items.find((row) => row.id === id) as ItemRow;
  const theirs = routineFlows({ items: b.store.getSnapshot().rows.items, actions: b.store, me: "b", day: TODAY, go: () => undefined });
  assert.deepEqual(await theirs.resume(mine(b)), { ok: true, id });
  await b.store.sync();
  await a.store.sync();
  assert.equal(mine(a).data?.paused_until, undefined);
  assert.equal(mine(a).title, "Evening");
  assert.deepEqual(await theirs.pause(mine(b), "2026-11-09"), { ok: true, id });
  await b.store.sync();
  await a.store.sync();
  assert.equal(mine(a).data?.paused_until, "2026-11-09");
  assert.equal((await theirs.remove(mine(b))).ok, true);
  await b.store.sync();
  await a.store.sync();
  assert.equal(a.store.getSnapshot().rows.items.some((row) => row.id === id || row.id === stepId), false);
});

test("a menu item keeps its identity when Pause turns into Resume, so a remount never drops its focus", () => {
  const handlers = { open: () => undefined, resume: () => undefined, remove: () => undefined };
  const ids = (away: boolean) => routineMenu({ away, ...handlers }).map((entry) => entry.id);
  assert.deepEqual(ids(false), ["duplicate", "pause", "delete"]);
  assert.deepEqual(ids(true), ids(false));
  assert.match(read("ui/menu.tsx"), /key=\{item\.id\}/);
});

test("the keyboard handler queries the same role the items render with", () => {
  const menu = read("ui/menu.tsx");
  const queried = /querySelectorAll<HTMLElement>\('\[role="(\w+)"\]'\)/.exec(menu)?.[1];
  assert.equal(queried, "menuitem");
  assert.match(menu, new RegExp(`role="${queried}"`));
});

test("after an item fires, clicks are swallowed for a moment and then pass again", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const page = new EventTarget();
    let reached = 0;
    swallowClicks(page, 400);
    page.addEventListener("click", () => reached++);
    const click = () => {
      const event = new Event("click", { cancelable: true });
      page.dispatchEvent(event);
      return event.defaultPrevented;
    };
    assert.equal(click(), true);
    assert.equal(reached, 0);
    mock.timers.tick(399);
    assert.equal(click(), true);
    mock.timers.tick(1);
    assert.equal(click(), false);
    assert.equal(reached, 1);
    assert.match(read("ui/menu.tsx"), /swallowClicks\(document, 400\);\s*event\.currentTarget\.closest\("dialog"\)\?\.close\(\);/);
  } finally {
    mock.timers.reset();
  }
});

test("a routine that vanishes under the open menu hands focus to the notice heading", () => {
  assert.match(read("views/routine.tsx"), /function Missing\(\) \{\s*useEffect\(\(\) => document\.querySelector<HTMLElement>\("h1"\)\?\.focus\(\), \[\]\);/);
});

test("each row links to its own routine, and the tally counts only steps scheduled today", async () => {
  const mine = routine({}, "a", "Morning care");
  stage([mine, step(mine, "Cleanse"), step(mine, "Tuesday only", { days: "TU" })]);
  const [row] = rowsOf(await mount());
  assert.match(row, new RegExp(`<a class="rt-link" href="#/routines/${mine.id}">`));
  assert.match(row, /<span>0 of 1 today<\/span>/);
});

test("a paused row states the date once, without the weekday, and keeps a compact Resume at large text", async () => {
  assert.equal(rowStatus(routine({ paused_until: "2027-01-31" }), TODAY, null), "Paused until 31 Jan 2027");
  const css = read("views/routines.css");
  const large = /@media \(max-width: 19rem\) \{([\s\S]*?)\n\}/.exec(css)![1];
  assert.match(large, /\.rt-link \{\s*padding: var\(--s2\);/);
  assert.match(large, /\.rt-row \.rt-resume \{\s*min-height: 36px;\s*margin: 0 var\(--s2\) var\(--s2\) auto;/);
});
