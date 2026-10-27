import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { cascade, eachScreen, inherited, queries, sheet } from "./css.ts";
import { entry, item, payment } from "./domain-rows.ts";
import { markupOf } from "./render.ts";
import { stage } from "./render-store.ts";

const css = ["tokens.css", "style.css", "ui/ui.css", "ui/sheet.css", "views/journey.css", "views/money.css", "views/people.css", "views/books.css", "views/routines.css", "views/import.css", "views/settings.css", "views/entry.css"].flatMap(sheet);

const PHONE = 20;
const LARGE = 10;

const at = (selector: string, width: number) => cascade(css, selector, width);

const expects = (selector: string, width: number, declared: Record<string, string | null>) => {
  const final = at(selector, width);
  for (const [property, value] of Object.entries(declared)) assert.equal(final.get(property) ?? null, value, `${selector} ${property} at ${width}rem`);
};

test("body and headings break a word only when it cannot fit its own line", () => {
  for (const width of [LARGE, PHONE, 40]) for (const selector of ["body", "h1"]) expects(selector, width, { "overflow-wrap": "break-word" });
});

const carriers = [
  ".title",
  ".who",
  ".facts",
  ".seg > *",
  ".contact .button",
  ".choices label > span",
  ".event-h h3",
  ".rt-block h3",
  ".bk-note",
  ".reader",
  ".reads",
  ".row-r",
  ".plan",
  ".line-s",
  ".nums dd",
  ".event-m",
  ".trail a",
  ".group h2",
  ".group > h3",
  ".amt",
  ".note",
];

test("every flex or grid item that carries user text shrinks below its longest word and wraps it, at any text size", () => {
  for (const width of [LARGE, PHONE, 40]) for (const selector of carriers) expects(selector, width, { "overflow-wrap": "anywhere" });
  for (const selector of carriers) assert.notEqual(at(selector, LARGE).get("min-width"), "min-content", selector);
  expects(".reader", PHONE, { "grid-template-columns": "minmax(0, 1fr)" });
});

test("the markup the carrier rules target holds the user text as its own text, not inside a box that would hide it from them", async () => {
  const phone = "+6281234567890";
  const pic = "Abcdefghijklmnopqrstuvwxyzabcdefghij";
  const row = item({ kind: "vendor", status: "option", title: "Florist", data: { phone, pic } });
  stage([row], [{ key: "partner_a_label", value: "Abcdefghijklmnopqrst", deleted_at: null }]);
  const vendor = await markupOf("views/people.tsx", ({ People }) => createElement(People, { route: "vendors", id: row.id }));
  assert.match(vendor, new RegExp(`<dt>Contact person</dt><dd>${pic}</dd>`));
  assert.match(vendor, new RegExp(`<span class="contact"><a class="button secondary" href="tel:\\${phone}"><svg[^>]*>.*?</svg>Call \\${phone}</a>`));
  const sheet = await markupOf("ui/item-form.tsx", ({ ItemForm }) => createElement(ItemForm, { name: "vendor", row, gone: false, sheet: () => undefined }));
  assert.match(sheet, /<div class="choices"><label><input[^>]*\/><span>[^<]+<\/span><\/label>/);
  const who = await markupOf("ui/avatar.tsx", ({ Who }) => createElement(Who, { side: "a" }));
  assert.match(who, /<span class="who">.*<\/span>Abcdefghijklmnopqrst<\/span>$/);
});

test("the partner's name and every amount sit as text inside the boxes the carrier rules target", async () => {
  const name = "Abcdefghijklmnopqrstuvwxyz";
  stage([item({ kind: "routine", title: "Week", who: "b", group_key: "timetable" })], [{ key: "partner_b_label", value: name, deleted_at: null }]);
  const them = await markupOf("views/them.tsx", ({ Them }) => createElement(Them));
  assert.match(them, new RegExp(`<h2 id="rt-them">${name} today</h2>`));
  assert.match(them, new RegExp(`<p class="trail"><a href="#/routines/[^"]+">${name}&#x27;s week</a></p>`));
  const line = entry({ title: "Venue", group_key: "reception", amount: 123469137191246 });
  const unplanned = entry({ title: "Extra", group_key: "reception", amount: null });
  stage([], [], [line, unplanned, payment(unplanned, { amount: 5000, status: "paid", done_on: "2026-10-01" })]);
  const money = await markupOf("views/money.tsx", ({ MoneyView }) => createElement(MoneyView, {}));
  assert.match(money, /<span class="event-t"><span class="amt"><span class="cur">Rp<\/span>\s[\d.]+<\/span><\/span>/);
  assert.match(money, /<p class="note"><span><span class="amt"><span class="cur">Rp<\/span>\s5\.000<\/span> /);
});

test("a row's text column keeps the longest word of its title whole; a trailing column keeps main's 9rem line so it wraps below before it squeezes a word of the meta", () => {
  expects(".row-b", PHONE, { flex: "1 1 9rem", "min-width": "0", "max-width": null });
  expects(".row-b", LARGE, { flex: "1 1 9rem", "min-width": "auto", "max-width": "100%" });
  expects(".row-b:last-child", LARGE, { "flex-basis": "0" });
  expects(".row-b:last-child", PHONE, { "flex-basis": null });
  expects(".row-b .title", LARGE, { "overflow-wrap": "break-word" });
  expects(".row-b .title", PHONE, { "overflow-wrap": null });
  expects(".row > .check", LARGE, { "align-self": "flex-start" });
  expects(".row > .check", PHONE, { "align-self": null });
});

test("a row's nickname chip is never sized below the nickname once text is large, so the check goes above the title instead of splitting it", () => {
  const chip = [["body"], [".row"], [".row-b"], [".meta"], [".who", ".row-b .who"]];
  assert.equal(inherited(css, chip, "overflow-wrap", LARGE), "break-word");
  assert.equal(inherited(css, chip, "overflow-wrap", PHONE), "anywhere");
  assert.equal(inherited(css, chip, "overflow-wrap", 18.6), "anywhere");
  expects(".row-b .who", LARGE, { "overflow-wrap": "break-word" });
  expects(".row-b .who", PHONE, { "overflow-wrap": null });
  expects(".row-b", LARGE, { "min-width": "auto", "max-width": "100%" });
});

test("a timetable slot's title and place are never sized below their longest word once text is large, and the slot does not widen its list", () => {
  const slot = [["body"], [".rt-slots"], [".rt-slot"], [".rt-slot-b"]];
  for (const selectors of [[...slot, [".title", ".rt-slot-b > span"]], [...slot, [".meta", ".rt-slot-b > span"]]]) {
    assert.equal(inherited(css, selectors, "overflow-wrap", LARGE), "break-word");
    assert.equal(inherited(css, selectors, "overflow-wrap", PHONE), "anywhere");
  }
  expects(".rt-slot-b", LARGE, { display: "block", "min-width": "auto", "max-width": "100%", "overflow-wrap": "break-word" });
  expects(".rt-slot-b", PHONE, { display: "grid", flex: "1 1 8rem", "min-width": "0", "max-width": null, "overflow-wrap": "anywhere" });
  expects(".rt-slot-b > span", LARGE, { display: "block", "overflow-wrap": "break-word" });
  expects(".rt-slot-b > span", PHONE, { display: null, "overflow-wrap": null });
  expects(".rt-slot", LARGE, { "min-width": "0" });
  expects(".rt-slot", PHONE, { display: "flex", "flex-wrap": "wrap", "min-width": null });
  expects(".rt-slot-t", PHONE, { flex: "none", "min-width": "5.5rem" });
  expects(".rt-slots", PHONE, { display: "grid" });
});

test("the glyph widths and the inset the chip, the amount, the due date and the slot lean on stay as measured, at the large and the plain width", () => {
  for (const width of [LARGE, PHONE]) {
    expects(".title", width, { "font-weight": "550" });
    expects(".who", width, { "font-weight": "500" });
    expects(".amt", width, { "font-weight": "650", "font-variant-numeric": "tabular-nums lining-nums" });
    expects(".due[data-late]", width, { "font-weight": "650" });
    expects(".rt-slot-t", width, { "font-weight": "650", "font-variant-numeric": "tabular-nums lining-nums" });
    expects(".row > .row-b:first-child", width, { "padding-left": "var(--s3)" });
    expects(".rt-slot[data-tag]", width, { "padding-inline-start": "var(--s3)" });
    expects(".rt-slots", width, { "list-style": "none" });
  }
});

test("the declarations the row rules lean on: a wrapping flex row, a wrapping meta whose items shrink and break a word, a trailing column held to the line", () => {
  for (const width of [LARGE, PHONE, 40]) {
    expects(".row", width, { display: "flex", "flex-wrap": "wrap" });
    expects(".meta", width, { display: "flex", "flex-wrap": "wrap" });
    expects(".meta > *", width, { "min-width": "0" });
    expects(".who", width, { display: "inline-flex", "min-width": "0", "overflow-wrap": "anywhere" });
    expects(".row-r", width, { display: "flex", flex: "none", "max-width": "100%", "min-width": "0", "margin-left": "auto" });
    expects(".line-s", width, { display: "flex", "flex-wrap": "wrap" });
    expects(".event-m", width, { display: "flex", "flex-wrap": "wrap" });
    expects(".event-h", width, { display: "flex", "flex-wrap": "wrap", "justify-content": "space-between" });
    expects(".nums div", width, { display: "flex", "flex-wrap": "wrap" });
  }
});

test("the bottom bar hides its labels visually, never from the accessibility tree, only when they do not fit, and keeps its 56px add button from 18.5rem down", () => {
  const LABEL_REM = 3.2;
  const ADD_PX = 56;
  eachScreen(({ px, zoom, rem, width }) => {
    const link = width > 18.5 ? (px - 4.5 * rem) / 4 : (px - ADD_PX) / 4;
    const fits = link >= LABEL_REM * rem;
    const final = at(".tabs a span", width);
    assert.equal(final.get("position") ?? null, fits ? null : "absolute", `labels at ${zoom * 100}% on ${px}px (link ${link}px, label ${LABEL_REM * rem}px)`);
  });
  expects(".tabs", PHONE, { "grid-template-columns": "1fr 1fr 4.5rem 1fr 1fr" });
  expects(".tabs", 18.5, { "grid-template-columns": "1fr 1fr auto 1fr 1fr" });
  expects(".tabs a", 16, { position: null, "min-height": "3.25rem", "font-size": "var(--fs-micro)", "white-space": "nowrap", "min-width": "0" });
  expects(".tabs a", 15.5, { position: "relative", "min-height": "var(--target-min)" });
  const hidden = { position: "absolute", width: "1px", height: "1px", margin: "-1px", overflow: "hidden", clip: "rect(0 0 0 0)" };
  expects(".tabs a span", LARGE, hidden);
  expects('.tabs a[aria-current="page"] span', LARGE, hidden);
  expects(".tabs a span", PHONE, { position: null, clip: null, display: null });
  expects(".tabs a span", 16, { position: null, clip: null, display: null });
  expects('.tabs a[aria-current="page"] span::after', LARGE, { content: "none" });
  expects('.tabs a[aria-current="page"] span::after', 16, { content: '""' });
  expects('.tabs a[aria-current="page"]::after', LARGE, { content: '""', position: "absolute", bottom: "2px", left: "50%", width: "5px", height: "5px", "margin-left": "-2.5px", "border-radius": "50%", background: "var(--ink)" });
  expects('.tabs a[aria-current="page"]::after', 16, { content: null });
  expects(".tab-add", 16, { width: "56px", height: "56px", margin: null });
  expects(".tab-add", LARGE, { width: "56px", height: "56px", margin: "0 var(--s1)" });
  expects(".tab-add", PHONE, { width: "3.5rem", height: "3.5rem" });
  expects(":root", 16, { "--tabs": "4.25rem" });
  expects(":root", LARGE, { "--tabs": "calc(56px + var(--s2) + var(--s1) + 1px)" });
  for (const selector of [".tabs", ".bar"]) assert.equal(at(selector, PHONE).get("display"), selector === ".bar" ? "flex" : "grid");
});

test("no label, brand or nav control is capped by the viewport width, and a star is only at 100 percent, so the phone's text size reaches them", () => {
  const selectors = [".brand", ".tabs", ".tabs a", ".tab-add", "h1"];
  for (const width of [LARGE, PHONE, 40]) for (const selector of selectors) for (const [property, value] of at(selector, width)) assert.doesNotMatch(value, /vw/, `${selector} ${property} at ${width}rem`);
  expects(".brand", PHONE, { font: "800 1.375rem / 1 var(--font-display)" });
  for (const width of [LARGE, 18.5]) expects(".stars svg", width, { width: "0.875rem", height: "0.875rem" });
  for (const width of [PHONE, 40]) expects(".stars svg", width, { width: "min(0.875rem, 3.4vw)", height: "min(0.875rem, 3.4vw)" });
});

test("the header wraps and the gutters shrink on both sides once text is large relative to the screen", () => {
  for (const width of [LARGE, PHONE]) expects(".bar", width, { display: "flex", "align-items": "center" });
  expects(".bar", LARGE, { "flex-wrap": "wrap", "padding-block": "calc(var(--safe-t) + var(--s1)) var(--s1)" });
  expects(".bar", PHONE, { "flex-wrap": null, "padding-block": null });
  expects(".pair", LARGE, { "--av": "1.5rem", "margin-left": "auto" });
  expects("main", LARGE, { "padding-right": "max(var(--s2), var(--safe-r))", "padding-left": "max(var(--s2), var(--safe-l))" });
  const wide = at("main", PHONE);
  assert.match(wide.get("padding") ?? "", /var\(--s4\)/);
  assert.equal(wide.get("padding-left"), undefined);
});

test("the search field keeps its icon beside a field that may use the whole width at large text", () => {
  expects(".capture", LARGE, { display: "grid", "grid-template-columns": "auto minmax(0, 1fr)", "row-gap": "var(--s1)", padding: "0 var(--s1) var(--s1)" });
  expects(".capture svg", LARGE, { "margin-left": "var(--s2)" });
  expects(".capture", PHONE, { "grid-template-columns": null, "row-gap": null });
});

test("a choice cell is never narrower than one floor, shared by the three-option and four-option groups, so a status word stays whole", () => {
  const floor = (value: string | undefined) => /(\d+(?:\.\d+)?)rem/.exec(value ?? "")?.[1];
  const four = ".choices:has(> label:nth-child(4):last-child)";
  expects(".choices", PHONE, { "grid-template-columns": "repeat(auto-fit, minmax(min(100%, 5.5rem), 1fr))" });
  expects(".choices", LARGE, { "grid-template-columns": "repeat(auto-fit, minmax(min(100%, 6.5rem), 1fr))" });
  assert.equal(floor(at(".choices", LARGE).get("grid-template-columns")), floor(at(four, 25).get("grid-template-columns")));
  expects(four, 25, { "grid-template-columns": "repeat(auto-fit, minmax(min(100%, max(6.5rem, calc(50% - 0.125rem))), 1fr))" });
  expects(four, 25.7, { "grid-template-columns": null });
  expects(four, 27, { "grid-template-columns": null });
});

test("book and screen rows put the cover above the title when the title would get less than 8rem, and settings rows wrap their button", () => {
  expects(".bk-link", PHONE, { "flex-wrap": "wrap", gap: "var(--s2) var(--s3)" });
  expects(".bk-text", PHONE, { flex: "1 1 8rem" });
  expects(".setl > li", PHONE, { "flex-wrap": "wrap" });
  expects(".setl .v", PHONE, { flex: "1 1 8rem", "min-width": "0" });
  expects(".setl > li > button", PHONE, { "margin-left": "auto" });
});

test("budget lines and the journey give their text the room once text is large", () => {
  expects(".line", LARGE, { "grid-template-columns": "minmax(0, 1fr)", "padding-inline": "var(--s2)" });
  expects(".plan", LARGE, { "grid-column": "1", "text-align": "left" });
  expects(".hero", LARGE, { "--gutter": "var(--s2)" });
  expects(".journey-tabs", LARGE, { "margin-inline": "var(--s2)" });
  expects(".spine", LARGE, { "padding-right": "var(--s2)" });
  expects(".loose", LARGE, { "padding-left": "var(--s2)" });
  expects(".hero", PHONE, { "--gutter": "var(--s5)" });
});

test("the box declarations that the fit rules and the sizes above lean on stay as measured, at the width where no large-text rule is active", () => {
  const pinned: [string, Record<string, string | null>][] = [
  [".bar", { position: "sticky", display: "flex", gap: "var(--s2)", "min-height": "calc(3.5rem + var(--safe-t))", padding: "var(--safe-t) max(var(--s3), var(--safe-r)) 0 max(var(--s4), var(--safe-l))" }],
  [".brand", { display: "inline-flex", flex: "none", "min-width": "var(--target-min)", "min-height": "var(--target-min)" }],
  [".pair", { display: "grid", flex: "none", "min-width": "var(--target-min)", "min-height": "var(--target-min)" }],
  [".tabs", { position: "fixed", right: "0", bottom: "0", left: "0", display: "grid", padding: "var(--s2) var(--safe-r) calc(var(--safe-b) + var(--s1)) var(--safe-l)" }],
  [".tabs a", { display: "flex" }],
  [".tab-add", { display: "grid", "justify-self": "center", "min-height": "0", padding: "0" }],
  ["main", { "max-width": "40rem", margin: "0 auto", padding: "var(--s2) max(var(--s4), var(--safe-r)) calc(var(--tabs) + var(--safe-b) + var(--s6)) max(var(--s4), var(--safe-l))" }],
  [".row", { gap: "var(--s2)", "min-height": "var(--row-min)", padding: "var(--s2) var(--s3) var(--s2) var(--s1)" }],
  [".row-b", { display: "block", padding: "var(--s1) 0" }],
  [".row-r", { "flex-direction": "column", gap: "var(--s2)" }],
  [".title", { display: "block" }],
  [".who", { gap: "6px" }],
  [".check", { display: "grid", flex: "none", width: "var(--target-min)", height: "var(--target-min)" }],
  [".ib", { display: "grid" }],
  [".sheet-head", { flex: "none", gap: "var(--s3)", padding: "var(--s4) max(var(--s2), var(--safe-r)) var(--s2) max(var(--s5), var(--safe-l))" }],
  [".sheet-head h2", { margin: "0" }],
  [".entry-body", { width: "100%", "max-width": "28rem", padding: "var(--s6) max(20px, var(--safe-r)) var(--s8) max(20px, var(--safe-l))" }],
  [".entry-brand", { display: "block" }],
  [".rt-week", { gap: "2px", margin: "0 0 var(--s4)", padding: "0" }],
  [".rt-week li", { display: "grid", gap: "2px", "min-width": "0", padding: "var(--s2)", border: "2px solid transparent" }],
  [".start-head", { gap: "var(--s2)" }],
  [".line", { display: "grid", "grid-template-columns": "minmax(0, 1fr) auto", gap: "2px var(--s3)", "min-height": "var(--row-min)", padding: "var(--s3) var(--s4)" }],
  [".plan", { "grid-column": "2" }],
  [".line-s", { "grid-column": "1 / -1", gap: "0 var(--s3)", "font-size": "var(--fs-meta)" }],
  [".rt-week-l", { "font-size": "var(--fs-micro)" }],
  [".meta", { gap: "2px var(--s3)", "font-size": "var(--fs-meta)" }],
  [".start-name", { margin: "0", "font-size": "var(--fs-station)" }],
  ];
  for (const [selector, declared] of pinned) expects(selector, PHONE, declared);
});

test("the large-text layouts switch at the same few thresholds", () => {
  const widths = new Set(queries(css).flatMap((query) => [...query.matchAll(/max-width: ([\d.]+)rem/g)].map(([, rem]) => rem)));
  assert.deepEqual([...widths].sort(), ["11.5", "13", "14", "15.5", "18.5", "19", "25.5"]);
});

test("each tab keeps its icon and its label in a span of its own, so hiding the span leaves the link's accessible name", () => {
  const shell = readFileSync(new URL("../src/ui/shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /<a key=\{entry\.section\}[^>]*>\s*<Icon name=\{entry\.icon\} \/>\s*<span>\{entry\.label\}<\/span>/);
});

test("Start mode's name keeps its longest word whole and puts the position label on the next line when the word cannot fit beside it", () => {
  for (const width of [LARGE, PHONE, 40]) expects(".start-head", width, { display: "flex", "flex-wrap": "wrap" });
  expects(".start-name", LARGE, { flex: "1 1 0", "min-width": "auto", "max-width": "100%", "overflow-wrap": "break-word" });
  expects(".start-name", PHONE, { flex: "1 1 8rem", "min-width": "0", "max-width": null, "overflow-wrap": "anywhere" });
});

test("the sheet head wraps its close button under a title word that cannot fit beside it, instead of pushing it off the screen", () => {
  for (const width of [LARGE, PHONE]) expects(".sheet-head", width, { display: "flex", "justify-content": "space-between" });
  expects(".sheet-head", LARGE, { "flex-wrap": "wrap" });
  expects(".sheet-head", PHONE, { "flex-wrap": null });
  expects(".sheet-head h2", LARGE, { flex: "1 1 0", "min-width": "auto", "max-width": "100%" });
  expects(".sheet-head h2", PHONE, { flex: null, "min-width": null });
  expects(".sheet-head > button", LARGE, { "margin-left": "auto" });
  expects(".sheet-head > button", PHONE, { "margin-left": null });
});

test("a week strip cell is wide enough for a six-letter day label at every phone width and text size where the strip uses the narrow gutter", () => {
  const LABEL_REM = 2.1;
  const PADDING_REM = 1;
  const BORDER_PX = 4;
  eachScreen(({ px, zoom, rem, width }) => {
    if (width > 18.5) return;
    const floor = Number(/minmax\(([\d.]+)rem, 1fr\)/.exec(at(".rt-week", width).get("grid-template-columns") ?? "")?.[1]) * rem;
    const container = px - rem;
    const columns = Math.max(1, Math.floor((container + 2) / (floor + 2)));
    const cell = (container - 2 * (columns - 1)) / columns;
    assert.ok(cell >= (LABEL_REM + PADDING_REM) * rem + BORDER_PX, `cell ${cell}px at ${zoom * 100}% on ${px}px`);
  });
  expects(".rt-week", PHONE, { display: "grid", "grid-template-columns": "repeat(auto-fit, minmax(3rem, 1fr))" });
  expects(".rt-week-l", PHONE, { "overflow-wrap": "anywhere" });
  expects(".rt-week", LARGE, { "grid-template-columns": "repeat(auto-fit, minmax(3.5rem, 1fr))" });
});

const LAYOUT = /^(display|position|flex|flex-.*|grid|grid-.*|min-width|max-width|width|inline-size|gap|row-gap|column-gap|padding|padding-.*|margin|margin-.*|overflow|overflow-.*|white-space|word-break|text-wrap|hyphens|font|font-size|letter-spacing|box-sizing|float|align-.*|justify-.*|place-.*|border|border-(top|right|bottom|left)|border-width|line-height|text-indent|height|min-height|scroll-padding.*|--(gutter|column|av|av-text|tabs))$/;

const layout = (selector: string, width: number) =>
  [...at(selector, width)]
    .filter(([property]) => LAYOUT.test(property))
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([property, value]) => `${property}: ${value}`)
    .join("; ");

const layouts: [string, [number, string][]][] = [
  ["html", [[10, "scroll-padding: calc(3.5rem + var(--safe-t) + var(--s2)) 0 calc(var(--tabs) + var(--safe-b) + var(--s2)); scroll-padding-top: calc(4.25rem + var(--safe-t) + var(--s2))"], [20, "scroll-padding: calc(3.5rem + var(--safe-t) + var(--s2)) 0 calc(var(--tabs) + var(--safe-b) + var(--s2))"]]],
  ["body", [[10, "font: 400 var(--fs-body) / 1.45 var(--font-text); margin: 0; min-height: 100vh; overflow-wrap: break-word"]]],
  ["h1", [[10, "font: 800 var(--fs-title) / 1.1 var(--font-display); font-size: 1.5rem; letter-spacing: -0.02em; margin: var(--s2) 0 var(--s4); overflow-wrap: break-word"], [17, "font: 800 var(--fs-title) / 1.1 var(--font-display); letter-spacing: -0.02em; margin: var(--s2) 0 var(--s4); overflow-wrap: break-word"]]],
  [".bar", [[10, "align-items: center; border-bottom: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: var(--s2); min-height: calc(3.5rem + var(--safe-t)); padding: var(--safe-t) max(var(--s3), var(--safe-r)) 0 max(var(--s4), var(--safe-l)); padding-block: calc(var(--safe-t) + var(--s1)) var(--s1); position: sticky"], [20, "align-items: center; border-bottom: 1px solid var(--line); display: flex; gap: var(--s2); min-height: calc(3.5rem + var(--safe-t)); padding: var(--safe-t) max(var(--s3), var(--safe-r)) 0 max(var(--s4), var(--safe-l)); position: sticky"]]],
  [".brand", [[10, "align-items: center; display: inline-flex; flex: none; font: 800 1.375rem / 1 var(--font-display); letter-spacing: -0.02em; min-height: var(--target-min); min-width: var(--target-min)"]]],
  [".pair", [[10, "--av: 1.5rem; --av-text: 0.75rem; display: grid; flex: none; margin-left: auto; min-height: var(--target-min); min-width: var(--target-min); place-items: center"], [20, "--av: 2rem; --av-text: 0.75rem; display: grid; flex: none; min-height: var(--target-min); min-width: var(--target-min); place-items: center"]]],
  [".tabs", [[10, "align-items: center; border-top: 1px solid var(--line); display: grid; grid-template-columns: 1fr 1fr auto 1fr 1fr; padding: var(--s2) var(--safe-r) calc(var(--safe-b) + var(--s1)) var(--safe-l); position: fixed"], [20, "align-items: center; border-top: 1px solid var(--line); display: grid; grid-template-columns: 1fr 1fr 4.5rem 1fr 1fr; padding: var(--s2) var(--safe-r) calc(var(--safe-b) + var(--s1)) var(--safe-l); position: fixed"]]],
  [".tabs a", [[10, "align-items: center; display: flex; flex-direction: column; font-size: var(--fs-micro); gap: 3px; justify-content: center; min-height: var(--target-min); min-width: 0; position: relative; white-space: nowrap"], [17, "align-items: center; display: flex; flex-direction: column; font-size: var(--fs-micro); gap: 3px; justify-content: center; min-height: 3.25rem; min-width: 0; white-space: nowrap"]]],
  [".tabs a[aria-current=\"page\"] span", [[10, "height: 1px; margin: -1px; overflow: hidden; position: absolute; width: 1px"], [17, "position: relative"]]],
  [".tabs a[aria-current=\"page\"] span::after", [[10, "height: 5px; margin-left: -2.5px; position: absolute; width: 5px"]]],
  [".tab-add", [[10, "display: grid; height: 56px; justify-self: center; margin: 0 var(--s1); min-height: 0; padding: 0; place-items: center; width: 56px"], [17, "display: grid; height: 56px; justify-self: center; min-height: 0; padding: 0; place-items: center; width: 56px"], [20, "display: grid; height: 3.5rem; justify-self: center; min-height: 0; padding: 0; place-items: center; width: 3.5rem"]]],
  ["main", [[10, "margin: 0 auto; max-width: 40rem; padding: var(--s2) max(var(--s4), var(--safe-r)) calc(var(--tabs) + var(--safe-b) + var(--s6)) max(var(--s4), var(--safe-l)); padding-left: max(var(--s2), var(--safe-l)); padding-right: max(var(--s2), var(--safe-r))"], [20, "margin: 0 auto; max-width: 40rem; padding: var(--s2) max(var(--s4), var(--safe-r)) calc(var(--tabs) + var(--safe-b) + var(--s6)) max(var(--s4), var(--safe-l))"]]],
  ["main[data-page=\"journey\"]", [[10, "max-width: none; padding: 0 0 calc(var(--tabs) + var(--safe-b) + var(--s6))"]]],
  [".sheet-form", [[10, "display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0"]]],
  [".sheet-head", [[10, "align-items: center; display: flex; flex: none; flex-wrap: wrap; gap: var(--s3); justify-content: space-between; padding: var(--s4) max(var(--s2), var(--safe-r)) var(--s2) max(var(--s5), var(--safe-l))"], [20, "align-items: center; display: flex; flex: none; gap: var(--s3); justify-content: space-between; padding: var(--s4) max(var(--s2), var(--safe-r)) var(--s2) max(var(--s5), var(--safe-l))"]]],
  [".sheet-head h2", [[10, "flex: 1 1 0; font: 800 var(--fs-current) / 1.1 var(--font-display); letter-spacing: -0.015em; margin: 0; max-width: 100%; min-width: auto"], [20, "font: 800 var(--fs-current) / 1.1 var(--font-display); letter-spacing: -0.015em; margin: 0"]]],
  [".sheet-body", [[10, "flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 0 max(var(--s5), var(--safe-r)) var(--s4) max(var(--s5), var(--safe-l))"]]],
  [".sheet-foot", [[10, "border-top: 1px solid var(--line); flex: none; padding: var(--s3) max(var(--s5), var(--safe-r)) calc(var(--safe-b) + var(--s3)) max(var(--s5), var(--safe-l))"]]],
  [".kinds", [[10, "display: grid; gap: var(--s2); grid-template-columns: repeat(auto-fit, minmax(6.25rem, 1fr)); margin: var(--s2) 0 var(--s4)"]]],
  [".capture", [[10, "align-items: center; border: 1.5px dashed var(--ink-2); display: grid; gap: var(--s2); grid-template-columns: auto minmax(0, 1fr); margin: 0 0 var(--s5); min-height: 3.25rem; padding: 0 var(--s1) var(--s1); row-gap: var(--s1)"], [20, "align-items: center; border: 1.5px dashed var(--ink-2); display: flex; gap: var(--s2); margin: 0 0 var(--s5); min-height: 3.25rem; padding: 0 var(--s1) 0 var(--s3)"]]],
  [".capture svg", [[10, "flex: none; height: var(--icon-m); margin-left: var(--s2); width: var(--icon-m)"], [20, "flex: none; height: var(--icon-m); width: var(--icon-m)"]]],
  [".choices", [[10, "display: grid; gap: var(--s1); grid-template-columns: repeat(auto-fit, minmax(min(100%, 6.5rem), 1fr)); padding: var(--s1)"], [20, "display: grid; gap: var(--s1); grid-template-columns: repeat(auto-fit, minmax(min(100%, 5.5rem), 1fr)); padding: var(--s1)"]]],
  [".choices label", [[10, "align-items: center; display: flex; font-size: var(--fs-meta); gap: var(--s2); justify-content: center; line-height: 1.2; min-height: var(--target-min); padding: var(--s1) var(--s3); position: relative"]]],
  [".choices label > span", [[10, "align-items: center; display: inline-flex; flex-direction: column; gap: var(--s1); justify-content: center; min-width: 0; overflow-wrap: anywhere"]]],
  [".row", [[10, "align-items: center; display: flex; flex-wrap: wrap; gap: var(--s2); min-height: var(--row-min); padding: var(--s2) var(--s3) var(--s2) var(--s1)"]]],
  [".row-b", [[10, "display: block; flex: 1 1 9rem; max-width: 100%; min-width: auto; padding: var(--s1) 0"], [20, "display: block; flex: 1 1 9rem; min-width: 0; padding: var(--s1) 0"]]],
  [".row-r", [[10, "align-items: flex-end; display: flex; flex: none; flex-direction: column; gap: var(--s2); margin-left: auto; max-width: 100%; min-width: 0; overflow-wrap: anywhere"]]],
  [".lead", [[10, "display: grid; flex: none; height: var(--target-min); place-items: center; width: var(--target-min)"]]],
  [".title", [[10, "display: block; line-height: 1.3; overflow-wrap: anywhere; text-wrap: pretty"]]],
  [".meta", [[10, "align-items: center; display: flex; flex-wrap: wrap; font-size: var(--fs-meta); gap: 2px var(--s3); margin-top: 3px"]]],
  [".meta > *", [[10, "min-width: 0"]]],
  [".who", [[10, "align-items: center; display: inline-flex; gap: 6px; min-width: 0; overflow-wrap: anywhere"]]],
  [".amt", [[10, "overflow-wrap: anywhere"]]],
  [".check", [[10, "display: grid; flex: none; height: var(--target-min); place-items: center; position: relative; width: var(--target-min)"]]],
  [".summary", [[10, "margin-bottom: var(--s4)"]]],
  [".trail a", [[10, "align-items: center; display: inline-flex; min-height: var(--target-min); min-width: var(--target-min); overflow-wrap: anywhere"]]],
  [".seg", [[10, "display: flex; flex-wrap: wrap; gap: var(--s1); margin: 0 0 var(--s4); padding: var(--s1)"]]],
  [".seg > *", [[10, "align-items: center; border: 0; display: inline-flex; flex: 1 1 auto; font-size: var(--fs-meta); gap: var(--s2); justify-content: center; line-height: 1.2; min-height: var(--target-min); min-width: 0; overflow-wrap: anywhere; padding: var(--s1) var(--s3)"]]],
  [".sum", [[10, "line-height: 1.5; margin: 0; text-wrap: pretty"]]],
  [".note", [[10, "align-items: flex-start; display: flex; font-size: var(--fs-meta); gap: var(--s2); margin: var(--s3) 0 0; overflow-wrap: anywhere"]]],
  [".contact .button", [[10, "min-width: 0; overflow-wrap: anywhere"]]],
  [".facts", [[10, "align-items: center; display: flex; flex-wrap: wrap; font-size: var(--fs-meta); gap: var(--s1) var(--s3); margin: 0 0 var(--s4); overflow-wrap: anywhere"]]],
  [".nums dd", [[10, "margin: 0 0 0 auto; overflow-wrap: anywhere"]]],
  [".bk-link", [[10, "align-items: center; display: flex; flex: 1 1 14rem; flex-wrap: wrap; gap: var(--s2) var(--s3); min-height: var(--target-min); min-width: 0"]]],
  [".bk-text", [[10, "display: flex; flex: 1 1 8rem; flex-direction: column; gap: 2px; min-width: 0"]]],
  [".bk-note", [[10, "display: grid; flex: 1 1 100%; font-size: var(--fs-meta); gap: 2px; margin: 0; overflow-wrap: anywhere"]]],
  [".reads", [[10, "align-items: center; display: inline-flex; flex-wrap: wrap; overflow-wrap: anywhere"]]],
  [".stars svg", [[10, "height: 0.875rem; width: 0.875rem"], [20, "height: min(0.875rem, 3.4vw); width: min(0.875rem, 3.4vw)"]]],
  [".reader", [[10, "display: grid; gap: var(--s2); grid-template-columns: minmax(0, 1fr); margin: 0 0 var(--s4); overflow-wrap: anywhere"]]],
  [".entry-brand", [[10, "display: block; font: 800 2.75rem / 1 var(--font-display); font-size: 1.75rem; letter-spacing: -0.02em; margin-bottom: var(--s5)"], [17, "display: block; font: 800 2.75rem / 1 var(--font-display); letter-spacing: -0.02em; margin-bottom: var(--s7)"]]],
  [".entry-body h1", [[10, "margin: 0"]]],
  [".hero", [[10, "--column: 40rem; --gutter: var(--s2); padding: var(--s2) max(var(--gutter), calc((100% - var(--column)) / 2 + var(--gutter))) var(--s6)"], [20, "--column: 40rem; --gutter: var(--s5); padding: var(--s2) max(var(--gutter), calc((100% - var(--column)) / 2 + var(--gutter))) var(--s6)"]]],
  [".count-n", [[10, "align-items: flex-end; display: flex; flex-wrap: wrap; font: inherit; gap: 0 0.875rem; letter-spacing: normal; margin: 0; overflow-wrap: normal"]]],
  [".count-n .num", [[10, "flex: none; font: 850 min(var(--fs-count), 28vw) / 0.8 var(--font-display); letter-spacing: -0.035em; margin-left: -0.25rem"]]],
  [".hero-money", [[10, "border-top: 1px solid color-mix(in oklch, var(--on-hero) 18%, transparent); display: flex; flex-wrap: wrap; font-size: var(--fs-meta); gap: 2px var(--s4); margin: var(--s5) 0 0; min-width: 0; padding-top: var(--s4)"]]],
  [".journey-tabs", [[10, "margin: var(--s4) var(--s4) 0; margin-inline: var(--s2)"], [20, "margin: var(--s4) var(--s4) 0"]]],
  [".spine", [[10, "padding: var(--s5) var(--s4) 0 0; padding-right: var(--s2)"], [20, "padding: var(--s5) var(--s4) 0 0"]]],
  [".loose", [[10, "padding-left: var(--s2)"], [20, "padding-left: var(--s4)"]]],
  [".group", [[10, "margin: var(--s5) 0 0"]]],
  [".group h2", [[10, "align-items: baseline; display: flex; font-size: var(--fs-meta); gap: var(--s2); line-height: 1; margin: 0 0 var(--s2); overflow-wrap: anywhere"]]],
  [".group > h3", [[10, "align-items: baseline; display: flex; font-size: var(--fs-meta); gap: var(--s2); line-height: 1; margin: 0 0 var(--s2); overflow-wrap: anywhere"]]],
  [".event-h", [[10, "align-items: baseline; display: flex; flex-wrap: wrap; gap: 0 var(--s4); justify-content: space-between"]]],
  [".event-h h3", [[10, "font: 700 var(--fs-station) / 1.2 var(--font-text); letter-spacing: -0.005em; overflow-wrap: anywhere"]]],
  [".event-m", [[10, "display: flex; flex-wrap: wrap; font-size: var(--fs-meta); gap: 0 var(--s3); margin: var(--s1) 0 var(--s3); overflow-wrap: anywhere"]]],
  [".line", [[10, "align-items: baseline; display: grid; gap: 2px var(--s3); grid-template-columns: minmax(0, 1fr); min-height: var(--row-min); padding: var(--s3) var(--s4); padding-inline: var(--s2)"], [20, "align-items: baseline; display: grid; gap: 2px var(--s3); grid-template-columns: minmax(0, 1fr) auto; min-height: var(--row-min); padding: var(--s3) var(--s4)"]]],
  [".plan", [[10, "grid-column: 1; overflow-wrap: anywhere"], [20, "grid-column: 2; overflow-wrap: anywhere"]]],
  [".line-s", [[10, "display: flex; flex-wrap: wrap; font-size: var(--fs-meta); gap: 0 var(--s3); grid-column: 1 / -1; overflow-wrap: anywhere"]]],
  [".sheet-h", [[10, "display: none"]]],
  [".rt-block h3", [[10, "font-size: var(--fs-meta); line-height: inherit; margin: 0; overflow-wrap: anywhere"]]],
  [".rt-head", [[10, "align-items: center; display: flex; flex-wrap: wrap; gap: 0 var(--s3); margin: 0 0 var(--s1)"]]],
  [".rt-head h3", [[10, "flex: 1 1 14rem; min-width: 0"]]],
  [".rt-go", [[10, "flex: none; max-width: 100%; min-height: var(--target-min)"]]],
  [".rt-week", [[10, "display: grid; gap: 2px; grid-template-columns: repeat(auto-fit, minmax(3.5rem, 1fr)); margin: 0 0 var(--s4); padding: 0"], [20, "display: grid; gap: 2px; grid-template-columns: repeat(auto-fit, minmax(3rem, 1fr)); margin: 0 0 var(--s4); padding: 0"]]],
  [".rt-week li", [[10, "border: 2px solid transparent; display: grid; gap: 2px; min-width: 0; padding: var(--s2)"]]],
  [".rt-week-d", [[10, "align-items: center; display: inline-flex; font-size: var(--fs-meta); gap: 2px; justify-content: center"]]],
  [".rt-week-l", [[10, "font-size: var(--fs-micro); overflow-wrap: anywhere"]]],
  [".start-head", [[10, "align-items: center; display: flex; flex-wrap: wrap; gap: var(--s2)"]]],
  [".start-name", [[10, "flex: 1 1 0; font-size: var(--fs-station); margin: 0; max-width: 100%; min-width: auto; overflow-wrap: break-word"], [20, "flex: 1 1 8rem; font-size: var(--fs-station); margin: 0; min-width: 0; overflow-wrap: anywhere"]]],
  [".start-pos", [[10, "margin: 0; overflow-wrap: anywhere"]]],
  [".start-meta", [[10, "margin: 0; overflow-wrap: anywhere"]]],
  [".start-up", [[10, "margin: 0; overflow-wrap: anywhere"]]],
  [".setl", [[10, "margin: 0; overflow: hidden; padding: 0"]]],
  [".setl > li", [[10, "align-items: center; display: flex; flex-wrap: wrap; gap: var(--s3); min-height: var(--row-min); padding: var(--s2) var(--s1) var(--s2) var(--s4)"]]],
  [".setl .v", [[10, "flex: 1 1 8rem; min-width: 0"]]],
  [".rt-slots", [[10, "display: grid; margin: 0; padding: 0"]]],
  [".rt-slot", [[10, "align-items: baseline; border-top: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: var(--s1) var(--s3); min-height: var(--target-min); min-width: 0; padding: var(--s2) 0"], [20, "align-items: baseline; border-top: 1px solid var(--line); display: flex; flex-wrap: wrap; gap: var(--s1) var(--s3); min-height: var(--target-min); padding: var(--s2) 0"]]],
  [".rt-slot-t", [[10, "flex: none; min-width: 5.5rem"]]],
  [".rt-slot-b", [[10, "display: block; flex: 1 1 8rem; max-width: 100%; min-width: auto; overflow-wrap: break-word"], [20, "display: grid; flex: 1 1 8rem; min-width: 0; overflow-wrap: anywhere"]]],
];

test("every declaration that sets a size, a wrap, a gap, a spacing or an alignment in the rules the large-text rules lean on stays as measured, at the large, the narrow and the plain width", () => {
  for (const [selector, steps] of layouts) for (const width of [LARGE, 17, PHONE]) assert.equal(layout(selector, width), steps.findLast(([from]) => from <= width)![1], `${selector} at ${width}rem`);
});
