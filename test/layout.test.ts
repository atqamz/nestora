import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const sheets = readdirSync(new URL("../src/", import.meta.url), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".css") && entry.name !== "tokens.css")
  .map((entry) => ({ name: entry.name, css: readFileSync(`${entry.parentPath}/${entry.name}`, "utf8") }));

const all = sheets.map((sheet) => sheet.css).join("\n");

test("every width condition is in rem, so a larger root text size moves it with the content", () => {
  const conditions = [...all.matchAll(/@(?:media|container)[^{]*\((?:min|max)-width:\s*([\d.]+)(\w+)\)/g)];
  assert.ok(conditions.length >= 6);
  assert.deepEqual(
    conditions.filter(([, , unit]) => unit !== "rem").map(([match]) => match),
    [],
  );
});

test("amounts may wrap, so a long figure never pushes a screen sideways", () => {
  const rule = /\.amt\s*\{([^}]*)\}/.exec(all)?.[1] ?? "";
  assert.ok(rule.includes("tabular-nums"));
  assert.doesNotMatch(rule, /white-space:\s*nowrap/);
});

test("controls that are not full rows keep a 44 px target", () => {
  const rule = (selector: string) => new RegExp(`${selector.replace(/[.>*[\]="()]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(all)?.[1] ?? "";
  assert.match(rule(".seg > *"), /min-height:\s*var\(--target-min\)/);
  assert.match(rule(".ib"), /width:\s*var\(--target-min\)/);
  assert.match(rule(".ib"), /height:\s*var\(--target-min\)/);
  assert.match(rule(".brand"), /min-width:\s*var\(--target-min\)/);
});

test("a pill is 2rem tall inside a hit area that reaches 44 px, measured from its padding box", () => {
  const pill = /\.pill\s*\{([^}]*)\}/.exec(all)?.[1] ?? "";
  const reach = /\.pill::after\s*\{[^}]*inset:\s*calc\(-([\d.]+)rem - ([\d.]+)px\)/.exec(all);
  const height = Number(/min-height:\s*([\d.]+)rem/.exec(pill)?.[1]) * 16;
  const border = Number(/border:\s*([\d.]+)px/.exec(pill)?.[1]);
  assert.equal(Number(reach?.[2]), border);
  assert.ok(height + 2 * Number(reach?.[1]) * 16 >= 44, `${height} + ${2 * Number(reach?.[1]) * 16}`);
});

const rule = (selector: string) => new RegExp(`${selector.replace(/[.>*[\]="():]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(all)?.[1] ?? "";

test("the Add sheet locks the page without moving it, rides above the keyboard and respects the safe areas", () => {
  assert.match(rule("html:has(dialog[open])"), /overflow:\s*hidden/);
  assert.match(rule("html:has(dialog[open])"), /padding-right:\s*var\(--lock-gap,\s*0px\)/);
  const sheet = rule(".add-sheet");
  assert.match(sheet, /inset-block:\s*0 var\(--kb,\s*0px\)/);
  assert.match(sheet, /max-height:\s*calc\(var\(--vv-h,\s*100dvh\) - var\(--safe-t\)/);
  assert.match(sheet, /overscroll-behavior:\s*contain/);
  assert.match(rule(".sheet-foot"), /var\(--safe-b\)/);
  assert.match(rule(".sheet-body"), /overflow-y:\s*auto/);
  assert.match(read("ui/use-sheet.ts"), /setProperty\("--lock-gap"/);
  assert.match(read("ui/use-sheet.ts"), /removeProperty\("--lock-gap"\)/);
});

test("the sheet and the dialog use the same breakpoint as the shell and animate only when motion is allowed", () => {
  const sheetCss = read("ui/sheet.css");
  assert.match(sheetCss, /@media \(min-width: 62\.5rem\)/);
  const animated = [...sheetCss.matchAll(/animation(?:-name)?:/g)].length;
  const guarded = /@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*$/.exec(sheetCss)?.[0] ?? "";
  assert.equal([...guarded.matchAll(/animation(?:-name)?:/g)].length, animated);
});

test("every control of the Add sheet that is not a full row keeps a 44 px target", () => {
  assert.match(rule(".chip"), /min-height:\s*var\(--target-min\)/);
  assert.match(rule(".kinds button"), /min-height:\s*var\(--target-min\)/);
  assert.match(rule(".choices label"), /min-height:\s*var\(--target-min\)/);
  assert.match(rule(".tab-add"), /width:\s*3\.5rem/);
  assert.match(rule(".tab-add"), /height:\s*3\.5rem/);
});

const sources = readdirSync(new URL("../src/", import.meta.url), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".tsx"))
  .map((entry) => readFileSync(`${entry.parentPath}/${entry.name}`, "utf8"));

const classesIn = (css: string) => {
  const found = new Set<string>();
  for (const [, prelude] of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{/g)) {
    if (!prelude.trim().startsWith("@")) for (const [, name] of prelude.matchAll(/\.([a-zA-Z][\w-]*)/g)) found.add(name);
  }
  return found;
};

const used = new Set(
  sources.flatMap((source) => [...source.matchAll(/(["'`])((?:\\.|(?!\1)[^\\])*)\1/g)].flatMap(([, , body]) => body.split(/\s+/))),
);

test("the class finder sees every class of a compound, descendant or attribute selector", () => {
  assert.deepEqual([...classesIn(".a .b > .c[data-x] + .d:hover, .e::before { color: red }\n@media (min-width: 1rem) { .f { top: 0 } }")].sort(), ["a", "b", "c", "d", "e", "f"]);
  assert.deepEqual([...classesIn("/* .gone { } */ .kept { }")], ["kept"]);
});

test("no class appears in two stylesheets, in any selector, so a rule cannot reach into another screen's markup", () => {
  const owners = new Map<string, string[]>();
  for (const { name, css } of sheets) for (const cls of classesIn(css)) owners.set(cls, [...(owners.get(cls) ?? []), name]);
  assert.deepEqual(
    [...owners].filter(([, files]) => files.length > 1).map(([cls, files]) => `.${cls}: ${files.join(", ")}`),
    [],
  );
});

test("every class a stylesheet names is used by some component, so a removed screen leaves no rules behind", () => {
  assert.ok(used.size > 100);
  assert.deepEqual(
    [...new Set(sheets.flatMap(({ css }) => [...classesIn(css)]))].filter((cls) => !used.has(cls)).sort(),
    [],
  );
});

test("the pane threshold leaves the list at least 28rem beside a 25rem pane", () => {
  const threshold = Number(/PANE_REM = (\d+)/.exec(read("hooks/use-room.ts"))?.[1]);
  const pane = Number(/\.split\[data-wide\]\s*\{[^}]*grid-template-columns:[^;]*?\s(\d+)rem;/.exec(all)?.[1]);
  assert.equal(pane, 25);
  const gutters = 2 * 2.5;
  const gap = 2;
  assert.ok(threshold - gutters - gap - pane >= 28, `${threshold}rem leaves ${threshold - gutters - gap - pane}rem`);
});

test("scrollbars of the detail pane are the default thin ones, hidden on touch by the global rule", () => {
  assert.doesNotMatch(read("ui/ui.css"), /scrollbar-width:\s*none/);
  assert.match(read("style.css"), /@media \(pointer: coarse\)/);
});
