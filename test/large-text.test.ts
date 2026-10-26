import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { cascade, eachScreen, queries, sheet } from "./css.ts";
import { item } from "./domain-rows.ts";
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
  ".sides li",
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
  assert.match(vendor, new RegExp(`<p class="facts"><span class="mark"[^>]*>[^<]*</span><span>${pic}</span></p>`));
  assert.match(vendor, new RegExp(`<span class="contact"><a class="button secondary" href="tel:\\${phone}"><svg[^>]*>.*?</svg>Call \\${phone}</a>`));
  assert.match(vendor, /<div class="choices"><label><input[^>]*\/><span>[^<]+<\/span><\/label>/);
  const who = await markupOf("ui/avatar.tsx", ({ Who }) => createElement(Who, { side: "a" }));
  assert.match(who, /<span class="who">.*<\/span>Abcdefghijklmnopqrst<\/span>$/);
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

test("the declarations the row rules lean on: a wrapping flex row, a wrapping meta whose items shrink and break a word, a trailing column held to the line", () => {
  for (const width of [LARGE, PHONE, 40]) {
    expects(".row", width, { display: "flex", "flex-wrap": "wrap" });
    expects(".meta", width, { display: "flex", "flex-wrap": "wrap" });
    expects(".meta > *", width, { "min-width": "0" });
    expects(".who", width, { display: "inline-flex", "min-width": "0", "overflow-wrap": "anywhere" });
    expects(".row-r", width, { display: "flex", flex: "none", "max-width": "100%", "min-width": "0", "margin-left": "auto" });
    expects(".line-s", width, { display: "flex", "flex-wrap": "wrap" });
    expects(".event-m", width, { display: "flex", "flex-wrap": "wrap" });
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
  expects(".tab-add svg", 16, { width: "26px", height: "26px" });
  expects(":root", 16, { "--tabs": "4.25rem" });
  expects(":root", LARGE, { "--tabs": "calc(56px + var(--s2) + var(--s1) + 1px)" });
  for (const selector of [".tabs", ".bar"]) assert.equal(at(selector, PHONE).get("display"), selector === ".bar" ? "flex" : "grid");
});

test("no label, brand, nav control or star is capped by the viewport width, so the phone's text size reaches it", () => {
  const selectors = [".brand", ".tabs", ".tabs a", ".tab-add", ".tab-add svg", ".stars svg", "h1"];
  for (const width of [LARGE, PHONE, 40]) for (const selector of selectors) for (const [property, value] of at(selector, width)) assert.doesNotMatch(value, /vw/, `${selector} ${property} at ${width}rem`);
  expects(".brand", PHONE, { font: "800 1.375rem / 1 var(--font-display)" });
  expects(".stars svg", PHONE, { width: "0.875rem", height: "0.875rem" });
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

test("the capture button stacks under its field instead of squeezing the word Add", () => {
  expects(".capture", LARGE, { display: "grid", "grid-template-columns": "auto minmax(0, 1fr)", "row-gap": "var(--s1)", padding: "0 var(--s1) var(--s1)" });
  expects(".capture svg", LARGE, { "margin-left": "var(--s2)" });
  expects(".capture button", LARGE, { "grid-column": "1 / -1" });
  expects(".capture", PHONE, { "grid-template-columns": null, "row-gap": null });
  expects(".capture button", PHONE, { "grid-column": null });
});

test("a choice cell is never narrower than one floor, shared by the three-option and four-option groups, so a status word stays whole", () => {
  const floor = (value: string | undefined) => /(\d+(?:\.\d+)?)rem/.exec(value ?? "")?.[1];
  const four = ".choices:has(> label:nth-child(4):last-child)";
  expects(".choices", PHONE, { "grid-template-columns": "repeat(auto-fit, minmax(min(100%, 5.5rem), 1fr))" });
  expects(".choices", LARGE, { "grid-template-columns": "repeat(auto-fit, minmax(min(100%, 6.5rem), 1fr))" });
  assert.equal(floor(at(".choices", LARGE).get("grid-template-columns")), floor(at(four, 25).get("grid-template-columns")));
  expects(four, 25, { "grid-template-columns": "repeat(auto-fit, minmax(min(100%, max(6.5rem, calc(50% - 0.125rem))), 1fr))" });
  expects(four, 27, { "grid-template-columns": null });
});

test("book and screen rows put the cover above the title when the title would get less than 8rem, and settings rows wrap their button", () => {
  expects(".bk-link", PHONE, { "flex-wrap": "wrap", gap: "var(--s2) var(--s3)" });
  expects(".bk-text", PHONE, { flex: "1 1 8rem" });
  expects(".setl > li", PHONE, { "flex-wrap": "wrap" });
  expects(".setl .v", PHONE, { flex: "1 1 8rem" });
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
  assert.deepEqual([...widths].sort(), ["11.5", "13", "14", "15.5", "18.5", "19", "26"]);
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
});
