import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { luminance } from "./oklch.ts";

const css = readFileSync(new URL("../src/tokens.css", import.meta.url), "utf8");

const block = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  return start < 0 ? "" : css.slice(start, css.indexOf("}", start));
};

const lightPart = css.slice(0, css.indexOf("@media (prefers-color-scheme: dark)"));
const darkPart = block(':root:not([data-theme="light"])');
const forcedDark = block(':root[data-theme="dark"]');
const forcedLight = block(':root[data-theme="light"]');

const read = (part: string) =>
  Object.fromEntries(
    [...part.matchAll(/--([a-z0-9-]+):\s*oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)/g)].map(([, name, l, c, h]) => [
      name,
      [+l / 100, +c, +h],
    ]),
  );

const themes = { light: read(lightPart), dark: { ...read(lightPart), ...read(darkPart) } };

const ratio = (theme: Record<string, number[]>, fg: string, bg: string) => {
  const [hi, lo] = [luminance(theme[fg]), luminance(theme[bg])].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

const sources = readdirSync(new URL("../src/", import.meta.url), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".css") && entry.name !== "tokens.css")
  .map((entry) => readFileSync(`${entry.parentPath}/${entry.name}`, "utf8"))
  .join("\n");

const referenced = new Set([...sources.matchAll(/var\(--([a-z0-9-]+)/g)].map(([, name]) => name));

const text = [
  ["ink", "bg"],
  ["ink", "surface"],
  ["ink", "surface-2"],
  ["ink-2", "bg"],
  ["ink-2", "surface"],
  ["ink-2", "surface-2"],
  ["on-hero", "hero"],
  ["on-hero-2", "hero"],
  ["on-accent", "accent"],
  ["accent", "bg"],
  ["accent", "surface"],
  ["on-signal", "signal"],
  ["signal", "hero"],
  ["late", "bg"],
  ["late", "surface"],
  ["late", "late-bg"],
  ["on-tint", "tint-a"],
  ["on-tint", "tint-b"],
  ["bg", "ink"],
];

const graphics = [
  ["focus", "bg"],
  ["focus", "surface"],
  ["focus", "surface-2"],
  ["on-hero", "hero"],
  ["ink-2", "bg"],
  ["ink-2", "surface"],
  ["route", "bg"],
  ["route", "surface"],
  ["route", "surface-2"],
];

for (const [name, theme] of Object.entries(themes)) {
  test(`${name}: every text pair reaches 4.5:1`, () => {
    for (const [fg, bg] of text) assert.ok(ratio(theme, fg, bg) >= 4.5, `${fg} on ${bg} is ${ratio(theme, fg, bg).toFixed(2)}`);
  });

  test(`${name}: every graphic and focus pair reaches 3:1`, () => {
    for (const [fg, bg] of graphics) assert.ok(ratio(theme, fg, bg) >= 3, `${fg} on ${bg} is ${ratio(theme, fg, bg).toFixed(2)}`);
  });
}

test("both themes define the same tokens", () => {
  assert.deepEqual(Object.keys(themes.dark).sort(), Object.keys(themes.light).sort());
  assert.ok(Object.keys(themes.light).length >= 20);
});

test("every colour token is used by some rule, and every token in a contrast pair is", () => {
  const pairs = new Set([...text, ...graphics].flat());
  assert.deepEqual(
    [...pairs].filter((name) => !referenced.has(name)),
    [],
  );
  assert.deepEqual(
    Object.keys(themes.light).filter((name) => !referenced.has(name)),
    [],
  );
});

test("every colour token a rule uses has a contrast pair, except the decorative line", () => {
  const pairs = new Set([...text, ...graphics].flat());
  assert.deepEqual(
    Object.keys(themes.light).filter((name) => !["line", "scrim", "shade"].includes(name) && referenced.has(name) && !pairs.has(name)),
    [],
  );
});

test("only decorative or disabled rules use opacity, so a text pair never hides behind it", () => {
  const rules = [...sources.matchAll(/([^{}]+)\{[^{}]*\bopacity:\s*(?!1\b)[\d.]+/g)].map(([, selector]) => selector.replace(/\s+/g, " ").trim());
  assert.deepEqual(rules, ['.sync[data-state="pending"] a::before, .sync[data-state="offline"] a::before', "button:disabled", ".av img"]);
});

test("a chosen dark theme has exactly the tokens of the system dark theme, so the two cannot drift", () => {
  assert.ok(Object.keys(read(darkPart)).length >= 20);
  assert.deepEqual(read(forcedDark), read(darkPart));
  assert.match(forcedDark, /color-scheme: dark;/);
  assert.match(forcedLight, /color-scheme: light;/);
  assert.deepEqual(read(forcedLight), {});
});

test("the system dark theme steps aside when light is chosen", () => {
  assert.match(css, /@media \(prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{/);
});

test("no colour is written outside tokens.css, so a theme change reaches every rule; only the Google button, which follows Google's brand rules, keeps its own", () => {
  const stray = readdirSync(new URL("../src/", import.meta.url), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".css") && entry.name !== "tokens.css" && entry.name !== "entry.css")
    .flatMap((entry) => [...readFileSync(`${entry.parentPath}/${entry.name}`, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/oklch\(|#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\bhwb\(|\blab\(|\blch\(|color\(/g)].map(([match]) => `${entry.name}: ${match}`));
  assert.deepEqual(stray, []);
});

test("the scrim and the shadow colour are the same in both themes", () => {
  assert.deepEqual([themes.light.scrim, themes.light.shade], [themes.dark.scrim, themes.dark.shade]);
  assert.ok(themes.light.scrim && themes.light.shade);
});
