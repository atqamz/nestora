import { test } from "node:test";
import assert from "node:assert/strict";
import { cascade, sheet } from "./css.ts";

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

test("a heading and the sign-in wordmark drop one size step when 'Payments' or 'Nestora' would not fit a line", () => {
  expects("h1", 12.9, { "font-size": "1.5rem", "font-stretch": "100%" });
  expects("h1", 13.1, { "font-size": null, "font-stretch": "var(--stretch-display)" });
  expects(".entry-brand", 12.9, { font: "800 2.75rem / 1 var(--font-display)", "font-size": "2.25rem" });
  expects(".entry-brand", 13.1, { "font-size": null });
});

test("the sign-in screens let text size reach the wordmark and the headline", () => {
  for (const width of [LARGE, PHONE, 40]) for (const selector of [".entry-brand", ".entry-body h1"]) for (const [property, value] of at(selector, width)) assert.doesNotMatch(value, /vw/, `${selector} ${property} at ${width}rem`);
});
