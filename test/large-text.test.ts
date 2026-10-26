import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { cascade, queries, sheet } from "./css.ts";
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

test("a row's text column keeps the longest word of its title whole, beside the check when that fits and on a line of its own when it does not", () => {
  expects(".row-b", PHONE, { flex: "1 1 9rem", "min-width": "0", "max-width": null });
  expects(".row-b", LARGE, { flex: "1 1 0", "min-width": "auto", "max-width": "100%" });
  expects(".row-b .title", LARGE, { "overflow-wrap": "break-word" });
  expects(".row-b .title", PHONE, { "overflow-wrap": null });
  expects(".row > .check", LARGE, { "align-self": "flex-start" });
  expects(".row > .check", PHONE, { "align-self": null });
});

test("the bottom bar keeps one column per entry and hides its labels visually, never from the accessibility tree, only when five tabs cannot fit", () => {
  expects(".tabs", PHONE, { "grid-template-columns": "1fr 1fr 4.5rem 1fr 1fr" });
  expects(".tabs", LARGE, { "grid-template-columns": "1fr 1fr auto 1fr 1fr" });
  expects(".tabs a", LARGE, { position: "relative", "min-height": "var(--target-min)" });
  expects(".tabs a", PHONE, { position: null, "min-height": "3.25rem", "font-size": "var(--fs-micro)", "white-space": "nowrap", "min-width": "0" });
  const hidden = { position: "absolute", width: "1px", height: "1px", margin: "-1px", overflow: "hidden", clip: "rect(0 0 0 0)" };
  expects(".tabs a span", LARGE, hidden);
  expects('.tabs a[aria-current="page"] span', LARGE, hidden);
  expects(".tabs a span", PHONE, { position: null, clip: null, display: null });
  expects(".tabs a span", LARGE, { display: null });
  expects('.tabs a[aria-current="page"] span::after', LARGE, { content: "none" });
  expects('.tabs a[aria-current="page"]::after', LARGE, { content: '""', position: "absolute", bottom: "2px", left: "50%", width: "5px", height: "5px", "margin-left": "-2.5px", "border-radius": "50%", background: "var(--ink)" });
  expects('.tabs a[aria-current="page"]::after', PHONE, { content: null });
  expects(".tab-add", LARGE, { width: "56px", height: "56px", margin: "0 var(--s1)" });
  expects(".tab-add", PHONE, { width: "3.5rem", height: "3.5rem" });
  expects(".tab-add svg", LARGE, { width: "26px", height: "26px" });
});

test("no label, brand, nav control or star is capped by the viewport width, so the phone's text size reaches it", () => {
  const selectors = [".brand", ".tabs", ".tabs a", ".tab-add", ".tab-add svg", ".stars svg", "h1"];
  for (const width of [LARGE, PHONE, 40]) for (const selector of selectors) for (const [property, value] of at(selector, width)) assert.doesNotMatch(value, /vw/, `${selector} ${property} at ${width}rem`);
  expects(".brand", PHONE, { font: "800 1.375rem / 1 var(--font-display)" });
  expects(".stars svg", PHONE, { width: "0.875rem", height: "0.875rem" });
});

test("the header wraps and the gutters shrink on both sides once text is large relative to the screen", () => {
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

test("the large-text layouts switch at the same few thresholds", () => {
  const widths = new Set(queries(css).flatMap((query) => [...query.matchAll(/max-width: ([\d.]+)rem/g)].map(([, rem]) => rem)));
  assert.deepEqual([...widths].sort(), ["13", "18.5", "19", "26"]);
});

test("each tab keeps its icon and its label in a span of its own, so hiding the span leaves the link's accessible name", () => {
  const shell = readFileSync(new URL("../src/ui/shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /<a key=\{entry\.section\}[^>]*>\s*<Icon name=\{entry\.icon\} \/>\s*<span>\{entry\.label\}<\/span>/);
});
