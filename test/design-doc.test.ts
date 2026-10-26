import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const doc = read("DESIGN.md");
const tokens = read("src/tokens.css");
const css = ["src/tokens.css", "src/style.css", "src/ui/ui.css", "src/ui/sheet.css", "src/views/journey.css"].map(read).join("\n");
const front = doc.split("---")[1];
const light = tokens.slice(tokens.indexOf(":root {"), tokens.indexOf("@media (prefers-color-scheme: dark)"));
const declared = (name: string) => new RegExp(`${name}:\\s*([^;]+);`).exec(light)?.[1];
const section = (key: string) =>
  [...(new RegExp(`^${key}:\\n((?:  .*\\n)+)`, "m").exec(front)?.[1] ?? "").matchAll(/^  ([\w-]+): "([^"]+)"/gm)];

const planned = new Set(["--icon-s", "--icon-m", "--icon-l"]);

test("every colour, radius and spacing step in the DESIGN.md frontmatter matches its light-theme token", () => {
  const groups: [string, string][] = [["colors", "--"], ["rounded", "--r-"], ["spacing", "--"]];
  for (const [key, prefix] of groups) {
    const entries = section(key);
    assert.ok(entries.length > 0, key);
    for (const [, name, value] of entries) {
      assert.equal(declared(`${prefix}${name}`), value, `${prefix}${name}`);
    }
  }
});

test("every custom property named in DESIGN.md exists in the CSS, except the planned icon sizes", () => {
  const named = new Set([...doc.matchAll(/`(--[a-z0-9-]+)[`;:,)]/g)].map((m) => m[1]!));
  assert.ok(named.size > 25);
  for (const name of named) {
    if (planned.has(name)) {
      assert.equal(css.includes(`${name}:`), false, `${name} now exists: drop it from planned and DESIGN.md Target note`);
    } else {
      assert.match(css, new RegExp(`${name}:`), name);
    }
  }
});
