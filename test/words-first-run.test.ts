import { test, mock, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { daysLine } from "../src/ui/routine-label.ts";
import { lately } from "../src/domain/lately.ts";
import { text } from "../src/ui/text.ts";
import { cascade, sheet } from "./css.ts";
import { entry, item } from "./domain-rows.ts";
import { dom, mount } from "./hooks.ts";
import * as plain from "./mount.ts";
import { load, markupOf } from "./render.ts";
import { stage } from "./render-store.ts";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const strings = (value: unknown, path = "text"): [string, string][] =>
  typeof value === "string" ? [[path, value]] : value !== null && typeof value === "object" ? Object.entries(value).flatMap(([key, child]) => strings(child, `${path}.${key}`)) : [];

const all = strings(text);

const setting = (key: string, value: string) => ({ key, value, deleted_at: null });

const NICKS = [setting("partner_a_label", "Mo"), setting("partner_b_label", "Ra")];

const DATE = setting("ceremony_date", "2026-12-12");

const markup = (module: string, name: string, props: Record<string, unknown> = {}) => markupOf(module, (loaded) => createElement(loaded[name], props));

afterEach(() => {
  stage([]);
  mock.timers.reset();
});

test("no user-facing string calls the app a plan, and the private screens say it is private to the two of you", () => {
  assert.deepEqual(all.filter(([, value]) => /\bplans?\b/i.test(value)), []);
  assert.match(text.signIn.body, /^This is private to the two of you\./);
  assert.match(text.denied.body, /cannot open Nestora/);
  assert.match(text.connect.body, /not loaded your data yet/);
});

test("one Edit label: the routine detail reuses it and names its object, and no second copy of the word lives in the routines text", () => {
  assert.equal(text.edit, "Edit");
  assert.equal(text.editNamed("Morning care"), "Edit Morning care");
  assert.equal("edit" in text.routines, false);
  assert.deepEqual(all.filter(([, value]) => value === "Edit"), [["text.edit", "Edit"]]);
});

test("a payment is marked unpaid with those words, Undo is left to toasts, and only a routine or a timetable is called New", () => {
  assert.equal(text.markUnpaid, "Mark unpaid");
  assert.equal(text.markUnpaidNamed("Venue"), "Mark unpaid: Venue");
  assert.deepEqual(
    all.filter(([, value]) => /^New [a-z]/i.test(value)).map(([, value]) => value),
    ["New routine", "New timetable", "New routine"],
  );
});

test("the +1 button's name starts with its visible label, and so does −1", () => {
  assert.equal(text.routines.plus("Fish oil"), `${text.routines.plusLabel} Fish oil`);
  assert.equal(text.routines.minus("Fish oil"), `${text.routines.minusLabel} Fish oil`);
});

test("until a nickname exists the avatar draws a person glyph, never Yo or Pa, and a nickname gives its initials back", async () => {
  stage([], []);
  const bare = await markup("ui/avatar.tsx", "Avatar", { side: "a" });
  assert.match(bare, /<span class="av" data-side="a" aria-hidden="true"><svg class="icon"/);
  assert.doesNotMatch(bare, /Yo|Pa/);
  stage([], [setting("partner_a_label", "mo")]);
  assert.match(await markup("ui/avatar.tsx", "Avatar", { side: "a" }), /<span class="av" data-side="a" aria-hidden="true">Mo<\/span>/);
  assert.match(await markup("ui/avatar.tsx", "Avatar", { side: "b" }), /<svg class="icon"/);
  assert.match(await markup("ui/avatar.tsx", "Avatar", { side: null }), /data-side="none" aria-hidden="true"><\/span>/);
  assert.match(read("ui/icons.tsx"), /person: \(/);
  assert.equal(cascade(sheet("ui/ui.css"), ".av svg", 20).get("width"), "var(--av-icon, var(--icon-s))");
  assert.equal(cascade(sheet("views/settings.css"), ".setl-two", 20).get("--av-icon"), "var(--icon-l)");
});

test("the first-run card lists what is missing, each item a link to its Settings row, and goes when both nicknames and the akad date exist", async () => {
  const card = () => markup("views/first-run.tsx", "FirstRun");
  stage([], []);
  const empty = await card();
  assert.match(empty, /<h2 id="first-run">Set up Nestora<\/h2>/);
  assert.deepEqual([...empty.matchAll(/<a class="rt-link" href="([^"]+)"/g)].map((found) => found[1]), ["#/settings/names", "#/settings/akad"]);
  stage([], [NICKS[0], DATE]);
  assert.deepEqual([...(await card()).matchAll(/href="([^"]+)"/g)].map((found) => found[1]), ["#/settings/names"]);
  stage([], [setting("partner_a_label", "  "), NICKS[1], DATE]);
  assert.deepEqual([...(await card()).matchAll(/href="([^"]+)"/g)].map((found) => found[1]), ["#/settings/names"]);
  stage([], NICKS);
  assert.deepEqual([...(await card()).matchAll(/href="([^"]+)"/g)].map((found) => found[1]), ["#/settings/akad"]);
  stage([], [...NICKS, DATE]);
  assert.equal(await card(), "");
  assert.match(read("views/home.tsx"), /<Title name=\{text\.nav\.home\}>[^<]*<\/Title>\s*<FirstRun \/>/);
});

test("a link from the card lands on its row: the page focuses that row's Change button only while focus is on the page or the heading", () => {
  const rows = new Map<string, { focused: number }>();
  const document = dom() as unknown as Record<string, unknown>;
  document.getElementById = (id: string) => ({
    querySelector: () => {
      const row = rows.get(id) ?? { focused: 0 };
      rows.set(id, row);
      return { focus: () => void row.focused++ };
    },
  });
  const visit = async (row: string | undefined, active: "body" | "h1" | "field", settings: unknown[] = []) => {
    const { Settings } = await load("views/settings.tsx");
    stage([], settings);
    document.activeElement = active === "body" ? document.body : { tagName: active === "h1" ? "H1" : "INPUT" };
    mount(Settings, { row }, document as never);
  };
  return (async () => {
    await visit("akad", "h1");
    assert.deepEqual([...rows].map(([id, row]) => [id, row.focused]), [["set-akad", 1]]);
    rows.clear();
    await visit("names", "body");
    assert.deepEqual([...rows].map(([id, row]) => [id, row.focused]), [["set-a", 1]]);
    rows.clear();
    await visit("names", "body", [setting("partner_a_label", "Mo")]);
    assert.deepEqual([...rows].map(([id]) => id), ["set-b"]);
    rows.clear();
    await visit("akad", "field");
    await visit(undefined, "h1");
    await visit("elsewhere", "h1");
    assert.equal(rows.size, 0);
  })();
});

test("the settings rows carry the ids the card links to", () => {
  const source = read("views/settings.tsx");
  assert.match(source, /id="set-akad"/);
  assert.match(source, /id=\{`set-\$\{side\}`\}/);
  assert.match(read("ui/setting-row.tsx"), /return \(\s*<li id=\{id\}>/);
  assert.match(read("main.tsx"), /return <Settings row=\{id\} \/>;/);
});

test("To pay appears only once a budget line exists", async () => {
  stage([], [], []);
  assert.doesNotMatch(await markup("views/money.tsx", "MoneyView"), /To pay/);
  stage([], [], [entry({ title: "Venue", amount: 5000 })]);
  assert.match(await markup("views/money.tsx", "MoneyView"), /<h2 id="to-pay">To pay /);
});

test("the connect screen takes the entry layout: route, brand, h1, a status line and one button, with the sign-in link unchanged", async () => {
  const connect = await markup("views/connect.tsx", "Connect");
  assert.match(connect, /^<main class="entry"><svg class="entry-route"/);
  assert.match(connect, /<span class="entry-brand">Nestora<\/span><h1[^>]*>Can&#x27;t reach the server yet<\/h1><p role="status">/);
  assert.match(connect, /<button type="button" class="entry-action">Try again<\/button>/);
  const entrySource = read("views/entry.tsx");
  assert.match(entrySource, /<a className="button entry-action" href=\{LOGIN_URL\}>/);
  assert.equal(cascade(sheet("views/entry.css"), ".entry-action", 20).get("min-height"), "3.5rem");
});

test("a tick is named once: the checkbox is labelled by the row title, no hidden sentence repeats it, and the Start page tick keeps its label text", async () => {
  const routine = item({ kind: "routine", status: null, who: "a", title: "Morning care", group_key: "morning", data: {} });
  const step = item({ kind: "step", status: null, parent_id: routine.id, title: "Cleanse", data: null });
  stage([routine, step]);
  const row = await markup("ui/routine-action.tsx", "RoutineAction", { routine, action: step, flows: {}, me: "a", today: "2026-10-27", active: true });
  const id = /<input type="checkbox"[^>]* aria-labelledby="([^"]+)"/.exec(row)?.[1];
  assert.ok(id);
  assert.match(row, new RegExp(`<span id="${id}" class="title">Cleanse</span>`));
  assert.doesNotMatch(row, /visually-hidden|Mark Cleanse/);
  const task = item({ kind: "task", title: "Book the venue", status: "todo" });
  const line = await markup("ui/item-line.tsx", "ItemLine", { name: "task", row: task });
  const taskId = /<input type="checkbox"[^>]* aria-labelledby="([^"]+)"/.exec(line)?.[1];
  assert.ok(taskId);
  assert.match(line, new RegExp(`<span id="${taskId}" class="title">Book the venue</span>`));
  assert.doesNotMatch(line, /visually-hidden|Mark Book/);
  assert.doesNotMatch(read("ui/start-page.tsx"), /text\.(reopen|complete)/);
  assert.equal("reopen" in text, false);
  assert.equal("complete" in text, false);
});

test("a Today heading names the routine only; the moment and progress describe its button", async () => {
  const routine = item({ kind: "routine", status: null, who: "a", title: "Morning care", group_key: "morning", data: {} });
  const step = item({ kind: "step", status: null, parent_id: routine.id, title: "Cleanse", data: null });
  stage([routine, step]);
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 26, 3) });
  const html = await markup("views/today.tsx", "Today");
  const heading = /<h3><button [^>]*aria-labelledby="([^"]+)" aria-describedby="([^"]+)">(.*?)<\/button><\/h3>/.exec(html)!;
  assert.ok(heading);
  const [, name, sub, inner] = heading;
  assert.match(inner, new RegExp(`<span id="${name}">Morning care</span><span id="${sub}" class="rt-sub">Morning · 0 of 1</span>`));
});

test("a day name is read in full to assistive tech while the short form stays on screen", async () => {
  assert.equal(daysLine("MO,TU"), "Mo Tu");
  assert.equal(daysLine("MO,TU", true), "Monday, Tuesday");
  assert.equal(daysLine(undefined, true), null);
  const routine = item({ kind: "routine", status: null, who: "a", title: "Morning care", group_key: "morning", data: {} });
  const step = item({ kind: "step", status: null, parent_id: routine.id, title: "Weigh in", data: { days: "MO,TH" } });
  stage([routine, step]);
  const row = await markup("ui/routine-action.tsx", "RoutineAction", { routine, action: step, flows: {}, me: "a", today: "2026-10-26", active: true });
  assert.match(row, /<span><span aria-hidden="true">Only Mo Th<\/span><span class="visually-hidden">Only Monday, Thursday<\/span><\/span>/);
  stage([{ ...routine, data: { days: "SA,SU", every_weeks: 2, from: "2026-10-24" } }, step]);
  const detail = await markup("views/routine.tsx", "RoutineDetail", { id: routine.id });
  assert.match(detail, /<span aria-hidden="true">Sa Su · Every 2 weeks from [^<]+<\/span><span class="visually-hidden">Saturday, Sunday · Every 2 weeks from [^<]+<\/span>/);
});

test("hint text is capped at 65ch and balanced, the calendar steps fold into a disclosure and no h3 is left behind", async () => {
  const hint = cascade(sheet("ui/ui.css"), ".hint", 20);
  assert.equal(hint.get("max-width"), "65ch");
  assert.equal(hint.get("text-wrap"), "pretty");
  const feed = await markup("ui/feed-section.tsx", "FeedSection", { side: "a", zone: "Asia/Jakarta" });
  assert.match(feed, /<details class="stages"><summary>Add it to a calendar<\/summary><ol class="feed-steps"><li>On a computer/);
  assert.match(feed, /Apple Calendar: on a Mac[^]*<\/details><\/section>$/);
  assert.doesNotMatch(feed, /<h3/);
  assert.match(feed, /Treat this link like a password[^]*<details class="stages">/);
});

test("the partner's finished blocks are lighter, not struck through, and the search fields and the file chooser are drawn solid", () => {
  assert.doesNotMatch(["views/routines.css", "ui/ui.css", "ui/sheet.css"].map(read).join("\n"), /line-through/);
  assert.equal(cascade(sheet("views/routines.css"), '.rt-slot[data-state="done"] .rt-slot-t', 20).get("font-weight"), "400");
  assert.equal(cascade(sheet("views/books.css"), ".lib-find", 20).get("border-style"), "solid");
  const chooser = cascade(sheet("views/import.css"), 'input[type="file"]::file-selector-button', 20);
  assert.equal(chooser.get("min-height"), "calc(var(--target-min) - var(--s2))");
  assert.equal(chooser.get("background"), "transparent");
  assert.equal(cascade(sheet("views/import.css"), 'input[type="file"]', 20).get("min-height"), "var(--target-min)");
});

test("Lately lists wedding work only, whoever added the other things", () => {
  const stamp = { updated_by: "a" as const, updated_at: "2026-10-05T04:00:00Z", created_at: "2026-10-05T04:00:00Z" };
  const rows = ["task", "guest", "vendor", "book", "copy", "movie", "series", "place", "routine"].map((kind) => item({ kind, title: kind, ...stamp }));
  assert.deepEqual(lately(rows, [entry({ title: "Venue", ...stamp })], 20).map((activity) => activity.title).sort(), ["Venue", "guest", "task", "vendor"]);
});

const shell = () => {
  const globals = globalThis as Record<string, unknown>;
  const toggle = { focused: 0, focus() { this.focused++; } };
  Object.assign(globals, {
    location: { hash: "" },
    HTMLElement: class {},
    window: { visualViewport: null },
    innerWidth: 390,
    innerHeight: 800,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    document: {
      activeElement: { tagName: "BODY" },
      body: { tagName: "BODY" },
      querySelector: (selector: string) => (selector === ".rt-today .rt-fold" ? toggle : null),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      documentElement: { clientWidth: 390, style: { getPropertyValue: () => "x", setProperty: () => undefined, removeProperty: () => undefined } },
    },
  });
  mock.timers.enable({ apis: ["Date", "setInterval"], now: Date.parse("2026-10-27T05:00:00Z") });
  const globalsDocument = globals.document as { activeElement: unknown; body: unknown };
  globalsDocument.activeElement = globalsDocument.body;
  return toggle;
};

const unshell = () => {
  for (const key of ["location", "HTMLElement", "window", "innerWidth", "innerHeight", "addEventListener", "removeEventListener", "document"]) delete (globalThis as Record<string, unknown>)[key];
};

const control = (tree: unknown, name: string) => (plain.find(tree as never, (props) => props.control?.name === name)[0] as { props: { control: Record<string, any> } }).props.control;

test("the Pause sheet offers Tomorrow, One week and Two weeks, each fills the date, a typed date lights its preset, and Pause sends the chosen date", async (t) => {
  t.after(unshell);
  shell();
  const { PauseSheet } = await load("ui/routine-sheet.tsx");
  const paused: string[] = [];
  const flows = { pause: async (_row: unknown, until: string) => (paused.push(until), { ok: true }) };
  const view = plain.mount<Record<string, any>>(PauseSheet, { routine: item({ kind: "routine", title: "Morning care" }), flows, onClose: () => undefined });
  const at = (name: string) => control(view.tree, name);
  assert.deepEqual(at("pause-for").options.map((option: { value: string; label: string }) => [option.value, option.label]), [["1", "Tomorrow"], ["7", "One week"], ["14", "Two weeks"]]);
  assert.equal(at("pause-for").value, "");
  assert.equal(at("pause-until").label, "Pick a date");
  for (const [preset, date] of [["1", "2026-10-28"], ["7", "2026-11-03"], ["14", "2026-11-10"]]) {
    at("pause-for").onChange(preset);
    assert.deepEqual([at("pause-until").value, at("pause-for").value], [date, preset]);
  }
  at("pause-until").onChange("2026-11-03");
  assert.equal(at("pause-for").value, "7");
  at("pause-until").onChange("2026-12-25");
  assert.equal(at("pause-for").value, "59");
  at("pause-for").onChange("1");
  const form = plain.find(view.tree as never, (props) => typeof props.onSubmit === "function")[0] as { props: { onSubmit: (event: unknown) => unknown } };
  await form.props.onSubmit({ preventDefault: () => undefined });
  assert.deepEqual(paused, ["2026-10-28"]);
});

test("Today on an empty phone offers one starter, which opens the new routine sheet set to Morning and hands focus to Today when it closes", async (t) => {
  t.after(unshell);
  const toggle = shell();
  stage([]);
  const { Today } = await load("views/today.tsx");
  const view = plain.mount<Record<string, never>>(Today, {});
  const starter = () => plain.find(view.tree as never, (props, type) => type === "button" && plain.textOf(props.children) === text.routines.starter)[0];
  const sheet = () => plain.find(view.tree as never, (_, type) => (type as { name?: string }).name === "RoutineSheet")[0];
  assert.ok(starter());
  assert.equal(sheet(), undefined);
  assert.deepEqual(plain.find(view.tree as never, (props, type) => type === "a" && props.href === "#/routines"), []);
  (starter().props as { onClick: () => void }).onClick();
  assert.equal(sheet().props.start.moment, "morning");
  assert.equal(sheet().props.current, null);
  (sheet().props as { onClose: () => void }).onClose();
  assert.equal(sheet(), undefined);
  assert.equal(toggle.focused, 1);
});

test("a phone that has routines keeps the All routines link and offers no starter", async () => {
  const routine = item({ kind: "routine", status: null, who: "a", title: "Morning care", group_key: "morning", data: {} });
  stage([routine, item({ kind: "step", status: null, parent_id: routine.id, title: "Cleanse", data: null })]);
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 26, 3) });
  const html = await markup("views/today.tsx", "Today");
  assert.doesNotMatch(html, /Add a morning routine/);
  assert.match(html, /All routines/);
});

test("a spoken form that equals the shown one is plain text, and a different one hides the short form from assistive tech", async () => {
  const { Spoken } = await load("ui/spoken.tsx");
  assert.equal(renderToStaticMarkup(createElement(Spoken, { shown: "Every day", said: "Every day" })), "Every day");
  assert.equal(renderToStaticMarkup(createElement(Spoken, { shown: "Mo", said: "Monday" })), '<span aria-hidden="true">Mo</span><span class="visually-hidden">Monday</span>');
});

test("the Pause presets sit in three columns that keep Tomorrow whole at 320 px", () => {
  assert.match(read("ui/routine-sheet.tsx"), /className="form rt-form rt-pause"/);
  assert.equal(cascade(sheet("views/routines.css"), ".rt-pause .choices label", 20).get("padding-inline"), "var(--s1)");
});
