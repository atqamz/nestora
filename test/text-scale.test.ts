import { test } from "node:test";
import assert from "node:assert/strict";
import { cascade, eachScreen, fontRem, sheet } from "./css.ts";

const css = ["tokens.css", "style.css", "ui/ui.css", "views/entry.css"].flatMap(sheet);

const PHONE = 20;
const LARGE = 10;

const at = (selector: string, width: number) => cascade(css, selector, width);

const expects = (selector: string, width: number, declared: Record<string, string | null>) => {
  const final = at(selector, width);
  for (const [property, value] of Object.entries(declared)) assert.equal(final.get(property) ?? null, value, `${selector} ${property} at ${width}rem`);
};

test("the scroll reserves follow the real height of the wrapped header and of the bar", () => {
  assert.equal(at(":root", PHONE).get("--tabs"), "4.25rem");
  expects(":root", LARGE, { "--tabs": "calc(56px + var(--s2) + var(--s1) + 1px)" });
  expects("html", LARGE, { "scroll-padding-top": "calc(4.25rem + var(--safe-t) + var(--s2))" });
  expects("html", PHONE, { "scroll-padding-top": null });
});

const WORDMARK_EM = 4.4;

test("a heading drops one size step when 'Payments' would not fit a line", () => {
  expects("h1", 12.9, { "font-size": "1.5rem", "font-stretch": "100%" });
  expects("h1", 13.1, { "font-size": null, "font-stretch": "var(--stretch-display)" });
});

test("the sign-in wordmark stays one word in its column at every phone width and text size, and keeps its full size when it fits", () => {
  eachScreen(({ px, zoom, rem, width }) => {
    const size = fontRem(at(".entry-brand", width)) * rem;
    const column = px - 40;
    assert.ok(size * WORDMARK_EM <= column, `wordmark ${size}px needs ${size * WORDMARK_EM}px of ${column}px at ${zoom * 100}% on ${px}px`);
    if (width > 14) assert.equal(fontRem(at(".entry-brand", width)), 2.75, `${zoom * 100}% on ${px}px`);
  });
  expects(".entry-brand", 20, { font: "800 2.75rem / 1 var(--font-display)", "font-size": null });
  expects(".entry-brand", 14, { "font-size": "2.25rem" });
  expects(".entry-brand", 11.5, { "font-size": "1.75rem" });
});

test("the sign-in screens let text size reach the wordmark and the headline", () => {
  for (const width of [LARGE, PHONE, 40]) for (const selector of [".entry-brand", ".entry-body h1"]) for (const [property, value] of at(selector, width)) assert.doesNotMatch(value, /vw/, `${selector} ${property} at ${width}rem`);
});
