import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { menuAnchor } from "../src/domain/menu.ts";
import { routineMenu } from "../src/ui/routine-menu.ts";
import { item } from "./domain-rows.ts";
import { markupOf } from "./render.ts";
import { stage } from "./render-store.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const css = ["src/style.css", "src/ui/ui.css", "src/ui/sheet.css", "src/views/books.css", "src/views/entry.css", "src/views/settings.css", "src/views/journey.css", "src/views/routines.css"].map(read).join("\n");

const blocks = (source: string) => [...source.matchAll(/^([^\n{}@]+) \{\n([^}]*)\}/gm)].map((match) => ({ selector: match[1], body: match[2] }));

const iconOf = async (name: string) => markupOf("ui/icons.tsx", ({ Icon }) => createElement(Icon, { name }));

test("each icon draws something of its own, so no two verbs share a glyph by accident", async () => {
  const names = [...read("src/ui/icons.tsx").matchAll(/^  (\w+): [<(]/gm)].map((match) => match[1]);
  assert.ok(names.length >= 35);
  const drawn = new Map<string, string>();
  for (const name of names) {
    const body = /<svg[^>]*>(.*)<\/svg>/.exec(await iconOf(name))![1];
    assert.notEqual(body, "", name);
    assert.equal(drawn.get(body), undefined, `${name} repeats ${drawn.get(body)}`);
    drawn.set(body, name);
  }
});

test("every icon the app names exists in the icon file", () => {
  const defined = new Set([...read("src/ui/icons.tsx").matchAll(/^  (\w+): [<(]/gm)].map((match) => match[1]));
  const named = new Set<string>();
  for (const dir of ["src/ui", "src/views"]) {
    for (const file of readdirSync(new URL(`../${dir}/`, import.meta.url)).filter((name) => /\.tsx?$/.test(name) && name !== "icons.tsx")) {
      for (const match of read(`${dir}/${file}`).matchAll(/<Icon name="(\w+)"|icon: "(\w+)"|\? "(\w+)" : "check"/g)) named.add(match[1] ?? match[2] ?? match[3]);
    }
  }
  assert.ok(named.size >= 20);
  for (const name of named) assert.ok(defined.has(name), name);
});

test("Places is a map pin, To watch a bookmark, Import an upload arrow, and Home keeps the house", () => {
  assert.match(read("src/views/books.tsx"), /<Icon name="pin" \/>\s*\{text\.books\.places\}/);
  assert.match(read("src/ui/where.tsx"), /<Icon name="pin" \/>\s*<span>\{label\}<\/span>/);
  assert.match(read("src/ui/screen-sheet.tsx"), /pick === "want" \? "bookmark" : "check"/);
  for (const [file, shown] of [["src/views/books.tsx", "text.books.import.open"], ["src/ui/add-sheet.tsx", "text.books.import.open"], ["src/views/import.tsx", "busy ?"]]) {
    assert.match(read(file), new RegExp(`<Icon name="upload" />\\s*\\{${shown.replace(/[.?]/g, "\\$&")}`), file);
  }
  assert.match(read("src/views/settings.tsx"), /<Icon name="download" \/>\s*\{link\.label\}/);
  assert.match(read("src/ui/nav.ts"), /icon: "home", label: text\.nav\.home/);
  assert.doesNotMatch(read("src/ui/icons.tsx"), /^  place:/m);
});

test("the three icon sizes are rem tokens, and every icon rule uses them", () => {
  const tokens = read("src/tokens.css");
  assert.match(tokens, /--icon-s: 1rem;/);
  assert.match(tokens, /--icon-m: 1\.25rem;/);
  assert.match(tokens, /--icon-l: 1\.5rem;/);
  assert.match(tokens, /--stroke-s: 2\.25;[^]*--stroke-m: 2;[^]*--stroke-l: 1\.85;/);
  const kept = [".check svg", ".start-box svg", ".stars svg"];
  const own = blocks(css).filter(({ selector, body }) => /\bsvg\b/.test(selector) && /(^|\s)(width|height):/.test(body) && !kept.includes(selector));
  assert.ok(own.length >= 15);
  for (const { selector, body } of own) {
    assert.match(body, /width: var\(--icon-[sml]\);/, selector);
    assert.match(body, /height: var\(--icon-[sml]\);/, selector);
  }
  const bumped = blocks(css).filter(({ selector, body }) => /\bsvg\b/.test(selector) && /stroke-width: [\d.]+;/.test(body) && !kept.concat([".check svg", ".start-box svg"]).includes(selector));
  assert.deepEqual(bumped.map(({ selector }) => selector), []);
  assert.match(/\n\.icon \{([^}]*)\}/.exec(css)![1], /width: var\(--icon-m\);[^]*height: var\(--icon-m\);[^]*stroke-width: var\(--stroke-m\);/);
});

test("the Icon component carries the icon class the size tokens hang on", async () => {
  assert.match(await iconOf("more"), /^<svg class="icon" aria-hidden="true"/);
});

test("every menu item has a glyph, and Pause and Resume do not borrow each other's", () => {
  const handlers = { open: () => undefined, resume: () => undefined, remove: () => undefined };
  assert.deepEqual(routineMenu({ away: false, ...handlers }).map((entry) => [entry.id, entry.icon]), [["duplicate", "copy"], ["pause", "pause"], ["delete", "trash"]]);
  assert.deepEqual(routineMenu({ away: true, ...handlers }).map((entry) => [entry.id, entry.icon]), [["duplicate", "copy"], ["pause", "play"], ["delete", "trash"]]);
  assert.match(read("src/ui/menu.tsx"), /<Icon name=\{item\.icon\} \/>\s*\{item\.label\}/);
});

test("the popover anchors its top-right corner under the button that opened it", () => {
  assert.deepEqual(menuAnchor({ bottom: 120, right: 980 }, 1280), { "--menu-top": "120px", "--menu-right": "300px" });
  assert.match(read("src/ui/menu.tsx"), /menuAnchor\(event\.currentTarget\.getBoundingClientRect\(\), document\.documentElement\.clientWidth\)/);
});

test("the menu is a bottom sheet by default and a popover from the laptop width, with the sheet head kept for the name only", () => {
  const sheet = read("src/ui/sheet.css");
  const wide = /@media \(min-width: 62\.5rem\) \{\s*\.add-sheet\.menu-sheet \{([^}]*)\}([^]*)$/.exec(sheet)!;
  assert.match(wide[1], /inset: var\(--menu-top\) var\(--menu-right\) auto auto;/);
  assert.match(wide[1], /width: 15rem;/);
  assert.match(wide[2], /\.add-sheet\.menu-sheet \.sheet-head button \{\s*display: none;/);
  assert.match(wide[2], /\.add-sheet\.menu-sheet::backdrop \{\s*background: transparent;/);
  assert.doesNotMatch(sheet.slice(0, sheet.indexOf("@media (min-width: 62.5rem) {\n  .add-sheet.menu-sheet")), /\.menu-sheet \{/);
  assert.match(read("src/ui/modal.tsx"), /className=\{className \? `add-sheet \$\{className\}` : "add-sheet"\}\s*style=\{style\}/);
  assert.match(read("src/ui/menu.tsx"), /dismissible className="menu-sheet"/);
});

test("a menu item keeps room for a long word beside its glyph at large text: the sheet body and the item take small side padding", () => {
  const sheet = read("src/ui/sheet.css");
  assert.match(/\.add-sheet\.menu-sheet \.sheet-body \{([^}]*)\}/.exec(sheet)![1], /padding: 0 var\(--s2\) var\(--s4\);/);
  assert.match(/\n\.menu button \{([^}]*)\}/.exec(read("src/ui/ui.css"))![1], /padding: 0 var\(--s3\);/);
});

test("the routine toolbar keeps natural widths so no button is stretched or left alone on a line", () => {
  assert.match(/\.rt-tools > \* \{([^}]*)\}/.exec(read("src/views/routines.css"))![1], /flex: 0 1 auto;/);
});

test("the routine detail shows one filled button and two outlined ones in one toolbar, Edit and More first-class beside the primary", async () => {
  const mineRoutine = item({ kind: "routine", status: null, who: "a", title: "Morning care", group_key: "morning", data: {} });
  const rows = [mineRoutine, item({ kind: "step", status: null, parent_id: mineRoutine.id, title: "Cleanse", data: null }), item({ kind: "step", status: null, parent_id: mineRoutine.id, title: "Tone", data: null })];
  stage(rows);
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 26, 8) });
  try {
    const html = await markupOf("views/routines.tsx", ({ Routines }) => createElement(Routines, { id: mineRoutine.id }));
    const tools = html.slice(html.indexOf('class="rt-tools"'), html.indexOf("</div>", html.indexOf('class="rt-tools"')));
    const controls = [...tools.matchAll(/<(?:a|button)\b[^>]*>/g)].map((match) => match[0]);
    assert.equal(controls.length, 3);
    const filled = controls.filter((control) => !control.includes("secondary"));
    assert.equal(filled.length, 1);
    assert.match(filled[0], /^<a class="button"/);
  } finally {
    mock.timers.reset();
  }
});
