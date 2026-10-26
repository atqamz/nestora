import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const media = (css: string, query: string) => {
  const start = css.indexOf(`@media ${query} {`);
  assert.ok(start >= 0, `${query} missing`);
  let depth = 0;
  for (let at = css.indexOf("{", start); at < css.length; at++) {
    if (css[at] === "{") depth++;
    if (css[at] === "}" && --depth === 0) return css.slice(css.indexOf("{", start) + 1, at);
  }
  throw new Error(`${query} not closed`);
};

const rule = (css: string, selector: string) =>
  new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.>*[\]="():+~]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

const style = read("style.css");
const ui = read("ui/ui.css");
const narrow = "(max-width: 18.5rem)";

test("no label, brand, nav control or star is capped by the viewport width, so the phone's text size reaches it", () => {
  for (const selector of [".brand", ".tabs", ".tabs a", ".tab-add"]) assert.doesNotMatch(rule(style, selector), /vw/, selector);
  assert.doesNotMatch(rule(read("views/books.css"), ".stars svg"), /vw/);
  assert.match(rule(style, ".brand"), /font:\s*800 1\.375rem/);
});

test("words wrap at their own length: body and headings break a word only when it cannot fit a line", () => {
  assert.match(rule(style, "body"), /overflow-wrap:\s*break-word/);
  assert.match(rule(style, "h1"), /overflow-wrap:\s*break-word/);
  assert.doesNotMatch(rule(style, "body"), /anywhere/);
});

test("tab labels keep the 0.78125rem token and hide visually, never from the accessibility tree, when five tabs cannot fit", () => {
  assert.match(read("tokens.css"), /--fs-micro:\s*0\.78125rem/);
  assert.match(rule(style, ".tabs a"), /font-size:\s*var\(--fs-micro\)/);
  const hidden = media(style, narrow);
  const label = rule(hidden, ".tabs a span,\n  .tabs a[aria-current=\"page\"] span");
  assert.match(label, /clip:\s*rect\(0 0 0 0\)/);
  assert.match(label, /position:\s*absolute/);
  assert.doesNotMatch(hidden, /\.tabs a[^{]*span[^{]*\{[^}]*display:\s*none/);
  assert.match(rule(hidden, '.tabs a[aria-current="page"]::after'), /content:\s*""/);
  assert.match(rule(hidden, '.tabs a[aria-current="page"] span::after'), /content:\s*none/);
  assert.match(read("ui/shell.tsx"), /<a key=\{entry\.section\}[^>]*>\s*<Icon name=\{entry\.icon\} \/>\s*<span>\{entry\.label\}<\/span>/);
});

test("with the labels hidden the bar stays 44 px per link and the Add button stays a fixed 56 px circle", () => {
  const hidden = media(style, narrow);
  assert.match(rule(hidden, ".tabs a"), /min-height:\s*var\(--target-min\)/);
  assert.match(rule(hidden, ".tabs"), /grid-template-columns:\s*1fr 1fr auto 1fr 1fr/);
  assert.match(rule(hidden, ".tab-add"), /width:\s*56px/);
  assert.match(rule(hidden, ".tab-add"), /height:\s*56px/);
});

test("the header wraps and its gutters shrink once text is large relative to the screen", () => {
  const hidden = media(style, narrow);
  assert.match(rule(hidden, ".bar"), /flex-wrap:\s*wrap/);
  assert.match(style, /@media \(max-width: 18\.5rem\) \{\s*main \{[^}]*padding-left:\s*max\(var\(--s2\)/);
});

test("a heading drops its stretch and one size step when 'Payments' would not fit a line", () => {
  const rules = media(style, "(max-width: 13rem)");
  assert.match(rule(rules, "h1"), /font-stretch:\s*100%/);
  assert.match(rule(rules, "h1"), /font-size:\s*1\.5rem/);
});

test("at large text a row's title keeps the check beside it, and the check sits at the top of a tall row", () => {
  assert.match(rule(ui, ".row-b"), /flex:\s*1 1 9rem/);
  const rules = media(ui, narrow);
  assert.match(rule(rules, ".row-b"), /flex:\s*1 1 0/);
  assert.match(rule(rules, ".row-b"), /min-width:\s*8ch/);
  assert.match(rule(rules, ".row > .check"), /align-self:\s*flex-start/);
});

test("a four-option choice is two by two below 26rem and drops to one column when a cell would be under 8rem", () => {
  const rules = media(ui, "(max-width: 26rem)");
  const four = rule(rules, ".choices:has(> label:nth-child(4):last-child)");
  assert.match(four, /minmax\(min\(100%, max\(8rem, calc\(50% - 0\.125rem\)\)\), 1fr\)/);
  assert.match(rule(ui, ".choices"), /minmax\(min\(100%, 5\.5rem\), 1fr\)/);
});

test("the capture button stacks under its field instead of squeezing the word Add", () => {
  const rules = media(read("ui/sheet.css"), narrow);
  assert.match(rule(rules, ".capture"), /display:\s*grid/);
  assert.match(rule(rules, ".capture button"), /grid-column:\s*1 \/ -1/);
});

test("book and screen rows put the cover above the title when the title would get less than 8rem", () => {
  const books = read("views/books.css");
  assert.match(rule(books, ".bk-link"), /flex-wrap:\s*wrap/);
  assert.match(rule(books, ".bk-text"), /flex:\s*1 1 8rem/);
});

test("settings rows, budget lines and the journey give their text the room at large text", () => {
  assert.match(rule(read("views/settings.css"), ".setl > li"), /flex-wrap:\s*wrap/);
  assert.match(rule(read("views/settings.css"), ".setl .v"), /flex:\s*1 1 8rem/);
  assert.match(rule(read("views/settings.css"), ".setl > li > button"), /margin-left:\s*auto/);
  const money = media(read("views/money.css"), narrow);
  assert.match(rule(money, ".line"), /grid-template-columns:\s*minmax\(0, 1fr\);/);
  assert.match(rule(money, ".line"), /padding-inline:\s*var\(--s2\)/);
  assert.match(rule(money, ".plan"), /grid-column:\s*1;/);
  const journey = media(read("views/journey.css"), narrow);
  assert.match(rule(journey, ".hero"), /--gutter:\s*var\(--s2\)/);
  assert.match(rule(journey, ".journey-tabs"), /margin-inline:\s*var\(--s2\)/);
  assert.match(rule(journey, ".spine"), /padding-right:\s*var\(--s2\)/);
  assert.match(rule(journey, ".loose"), /padding-left:\s*var\(--s2\)/);
});

test("every large-text rule shares one threshold, so the layouts switch together", () => {
  const thresholds = new Set(
    ["style.css", "ui/ui.css", "ui/sheet.css", "views/money.css", "views/journey.css"].flatMap((file) => [...read(file).matchAll(/@media \(max-width: ([\d.]+)rem\)/g)].map(([, value]) => value)).filter((value) => value !== "26" && value !== "13"),
  );
  assert.deepEqual([...thresholds], ["18.5"]);
});
