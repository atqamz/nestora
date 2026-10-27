import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { menuAnchor, menuHeight, menuSpace } from "../src/domain/menu.ts";
import { routineMenu } from "../src/ui/routine-menu.ts";
import { item } from "./domain-rows.ts";
import { markupOf } from "./render.ts";
import { stage } from "./render-store.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

type Rule = { min: number; max: number; selectors: string[]; declarations: Map<string, string> };

const rulesOf = (source: string, min = 0, max = Infinity): Rule[] => {
  const rules: Rule[] = [];
  for (let at = 0; ; ) {
    const open = source.indexOf("{", at);
    if (open < 0) return rules;
    let depth = 0;
    let end = open;
    do depth += source[end] === "{" ? 1 : source[end] === "}" ? -1 : 0;
    while (depth > 0 && ++end < source.length);
    const head = source.slice(at, open).trim();
    const body = source.slice(open + 1, end);
    if (head.startsWith("@media")) {
      rules.push(...rulesOf(body, Math.max(min, Number(/min-width: ([\d.]+)rem/.exec(head)?.[1] ?? 0)), Math.min(max, Number(/max-width: ([\d.]+)rem/.exec(head)?.[1] ?? Infinity))));
    } else if (!head.startsWith("@")) {
      const declarations = new Map([...body.matchAll(/([\w-]+): ([^;]+);/g)].map((entry) => [entry[1], entry[2]] as [string, string]));
      rules.push({ min, max, selectors: head.split(/,\s*(?![^(]*\))/), declarations });
    }
    at = end + 1;
  }
};

const allRules = ["src/style.css", "src/ui/ui.css", "src/ui/sheet.css", "src/views/books.css", "src/views/entry.css", "src/views/settings.css", "src/views/journey.css", "src/views/routines.css"].flatMap((path) => rulesOf(read(path).replace(/\/\*[^]*?\*\//g, "")));

const computed = (selector: string, rem: number) => {
  const final = new Map<string, string>();
  for (const rule of allRules) if (rem >= rule.min && rem <= rule.max && rule.selectors.includes(selector)) for (const [property, value] of rule.declarations) final.set(property, value);
  return final;
};

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
  assert.match(read("src/views/books.tsx"), /icon: "pin", label: text\.books\.places/);
  assert.match(read("src/ui/where.tsx"), /<Icon name="pin" \/>\s*<span>\{label\}<\/span>/);
  assert.match(read("src/ui/screen-sheet.tsx"), /pick === "want" \? "bookmark" : "check"/);
  for (const [file, shown] of [["src/ui/add-sheet.tsx", "text.books.import.open"], ["src/views/import.tsx", "busy ?"]]) {
    assert.match(read(file), new RegExp(`<Icon name="upload" />\\s*\\{${shown.replace(/[.?]/g, "\\$&")}`), file);
  }
  assert.match(read("src/views/settings.tsx"), /<Icon name="download" \/>\s*\{link\.label\}/);
  assert.match(read("src/ui/nav.ts"), /icon: "home", label: text\.nav\.home/);
  assert.doesNotMatch(read("src/ui/icons.tsx"), /^  place:/m);
});

const BAR = "min(var(--icon-l), 28px)";

const SIZED: [string, "s" | "m" | "l" | typeof BAR, "s" | "m" | "l" | null][] = [
  [".sync svg", "s", "s"],
  [".kinds svg", "m", null],
  [".chip svg", "s", "s"],
  [".capture svg", "m", null],
  [".lead svg", "m", null],
  [".meta svg", "s", "s"],
  [".links svg", "m", null],
  [".note svg", "m", null],
  [".ib svg", "m", null],
  [".contact svg", "m", null],
  [".where svg", "s", "s"],
  [".star svg", "l", "l"],
  [".entry-action svg", "m", null],
  [".stop-h svg", "s", "s"],
  [".rt-link svg", "s", "s"],
  [".rt-tick svg", "l", "s"],
  [".rt-count.rt-reached svg", "l", "s"],
  [".rt-week-d svg", "s", "s"],
  [".out svg", "m", null],
  [".tabs :is(a, .tab-add) svg", BAR, "l"],
  [".rail svg", "l", "l"],
  [".icon", "m", "m"],
];

test("the three icon sizes are rem tokens, and every icon rule resolves to its own size and stroke at every text size", () => {
  const tokens = read("src/tokens.css");
  assert.match(tokens, /--icon-s: 1rem;/);
  assert.match(tokens, /--icon-m: 1\.25rem;/);
  assert.match(tokens, /--icon-l: 1\.5rem;/);
  assert.match(tokens, /--stroke-s: 2\.25;[^]*--stroke-m: 2;[^]*--stroke-l: 1\.85;/);
  for (const rem of [10, 20, 40, 80]) {
    for (const [selector, size, stroke] of SIZED) {
      const final = computed(selector, rem);
      const length = size === BAR ? BAR : `var(--icon-${size})`;
      assert.equal(final.get("width"), length, `${selector} width at ${rem}rem`);
      assert.equal(final.get("height"), length, `${selector} height at ${rem}rem`);
      assert.equal(final.get("stroke-width"), stroke === null ? undefined : `var(--stroke-${stroke})`, `${selector} stroke at ${rem}rem`);
    }
  }
  const kept = [".check svg", ".start-box svg", ".stars svg", ".av svg"];
  const named = new Set(SIZED.map(([selector]) => selector));
  for (const rule of allRules)
    for (const selector of rule.selectors)
      if (/\bsvg\b/.test(selector) && !kept.includes(selector) && !named.has(selector) && ["width", "height", "stroke-width"].some((property) => rule.declarations.has(property))) assert.fail(`${selector} sizes an icon outside the tokens`);
});

test("the LICENSE credits the glyphs copied from Lucide under ISC and the one from Feather under the MIT notice", () => {
  const license = read("LICENSE");
  assert.match(license, /"pin", "bookmark", "pause" and "copy" glyphs[^]*Lucide[^]*ISC License/);
  assert.match(license, /"bookmark" path is that of an earlier Lucide release/);
  assert.match(license, /"more" glyph[^]*Feather's more-horizontal[^]*The MIT License \(MIT\)\n\nCopyright \(c\) 2013-present Cole Bemis/);
  assert.match(license, /Permission is hereby granted, free of charge[^]*THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND/);
});

test("the Icon component carries the icon class the size tokens hang on", async () => {
  assert.match(await iconOf("more"), /^<svg class="icon" aria-hidden="true"/);
});

test("every menu item has a glyph, and Pause, Resume and Start each keep their own", () => {
  const handlers = { open: () => undefined, resume: () => undefined, remove: () => undefined };
  assert.deepEqual(routineMenu({ away: false, ...handlers }).map((entry) => [entry.id, entry.icon]), [["duplicate", "copy"], ["pause", "pause"], ["delete", "trash"]]);
  assert.deepEqual(routineMenu({ away: false, ...handlers, resetCounts: () => undefined }).map((entry) => [entry.id, entry.icon]), [["duplicate", "copy"], ["pause", "pause"], ["reset", "reset"], ["delete", "trash"]]);
  assert.deepEqual(routineMenu({ away: true, ...handlers }).map((entry) => [entry.id, entry.icon]), [["duplicate", "copy"], ["pause", "resume"], ["delete", "trash"]]);
  assert.match(read("src/ui/menu.tsx"), /<Icon name=\{item\.icon\} \/>\s*\{item\.label\}/);
  for (const file of ["src/views/routine.tsx", "src/views/today-block.tsx"]) assert.match(read(file), /<Icon name="play" \/>/, file);
});

test("the verbs Start, Resume and Pause draw three different glyphs", async () => {
  const verbs = { start: "play", resume: "resume", pause: "pause" };
  const drawn = await Promise.all(Object.values(verbs).map(async (name) => /<svg[^>]*>(.*)<\/svg>/.exec(await iconOf(name))![1]));
  assert.equal(new Set(drawn).size, 3);
  assert.deepEqual(routineMenu({ away: true, open: () => undefined, resume: () => undefined, remove: () => undefined }).filter((entry) => entry.id === "pause").map((entry) => entry.icon), [verbs.resume]);
});

test("the resume glyph is a ring with a triangle inside, drawn as its own markup", async () => {
  assert.match(await iconOf("resume"), /<circle cx="12" cy="12" r="9"><\/circle><path d="m10\.5 8\.5 5 3\.5-5 3\.5z"><\/path><\/svg>$/);
});

test("the more glyph is three dots of radius one on the middle line", async () => {
  const circles = [...(await iconOf("more")).matchAll(/<circle cx="(\d+)" cy="(\d+)" r="(\d+)"/g)].map((match) => match.slice(1).join(" "));
  assert.deepEqual(circles.sort(), ["12 12 1", "19 12 1", "5 12 1"]);
});

const button = { top: 224, bottom: 272, right: 980 };

test("the popover opens under the button when the page has room below it", () => {
  assert.deepEqual(menuAnchor(button, { width: 1280, height: 900 }, 196), { "--menu-top": "272px", "--menu-room": "628px", "--menu-right": "300px" });
});

test("the popover opens upward from the button when the room below is short and the room above is larger", () => {
  assert.deepEqual(menuAnchor(button, { width: 1280, height: 400 }, 196), { "--menu-bottom": "176px", "--menu-room": "224px", "--menu-right": "300px" });
  assert.deepEqual(menuAnchor(button, { width: 1280, height: 250 }, 196), { "--menu-bottom": "26px", "--menu-room": "224px", "--menu-right": "300px" });
});

test("the popover stays below the button when it fits there, even if the button sits lower than the middle", () => {
  assert.deepEqual(menuAnchor({ top: 600, bottom: 648, right: 980 }, { width: 1280, height: 900 }, 196), { "--menu-top": "648px", "--menu-room": "252px", "--menu-right": "300px" });
});

test("the popover stays below the button when neither side fits and below is the larger", () => {
  assert.deepEqual(menuAnchor({ top: 100, bottom: 148, right: 980 }, { width: 1280, height: 300 }, 196), { "--menu-top": "148px", "--menu-room": "152px", "--menu-right": "300px" });
});

test("the popover is anchored from the window width the scroll lock leaves, not the width beside the scrollbar", () => {
  const menu = read("src/ui/menu.tsx");
  assert.match(menu, /\{ width: innerWidth, height: innerHeight \}/);
  assert.doesNotMatch(menu, /clientWidth/);
});

test("the popover is sized from the menu's own item count at the root text size", () => {
  const menu = read("src/ui/menu.tsx");
  assert.match(menu, /const rem = parseFloat\(getComputedStyle\(document\.documentElement\)\.fontSize\);/);
  assert.match(menu, /menuSpace\(items\.length, rem\)/);
});

test("the menu height estimate follows the item height and the padding the stylesheet gives", () => {
  const rem = 16;
  const space = Number(/--s2: ([\d.]+)rem;/.exec(read("src/tokens.css"))![1]);
  const item = Number(/^([\d.]+)rem$/.exec(computed(".menu button", 20).get("min-height")!)![1]);
  assert.equal(menuHeight(1, rem) - menuHeight(0, rem), item * rem);
  const border = length(split(computed(".add-sheet.menu-sheet", 80).get("border")!)[0], {}, rem);
  assert.equal(border, 1);
  assert.equal(menuHeight(0, rem), 5 * space * rem + 2 * (border as number));
  const tokens = Object.fromEntries([...read("src/tokens.css").matchAll(/(--s\d): ([\d.]+rem);/g)].map((entry) => [entry[1], entry[2]]));
  const clamp = /calc\(var\(--menu-room\) - (var\(--s\d\)) - (var\(--s\d\))\)/.exec(computed(".add-sheet.menu-sheet", 80).get("max-height")!)!;
  assert.equal(menuSpace(0, rem) - menuHeight(0, rem), (length(clamp[1], tokens, rem) as number) + (length(clamp[2], tokens, rem) as number));
  assert.equal(computed(".menu", 20).get("padding"), "var(--s2) 0");
  assert.equal(computed(".add-sheet.menu-sheet .sheet-body", 80).get("padding"), "var(--s2)");
  assert.equal(computed(".menu button.danger", 20).get("margin"), "var(--s2) 0 0");
});

const split = (value: string) => value.match(/(?:[^\s(]|\([^)]*(?:\([^)]*\)[^)]*)*\))+/g)!;

const length = (value: string, vars: Record<string, string | undefined>, rem: number): number | "auto" => {
  const resolved = (text: string): string =>
    text.replace(/var\((--[\w-]+)(?:, *([^()]+))?\)/g, (_, name, fallback) => resolved(vars[name] ?? fallback));
  const text = resolved(value);
  if (text === "auto") return "auto";
  const math = text.replace(/calc/g, "").replace(/([\d.]+)rem/g, (_, n) => `${Number(n) * rem}`).replace(/([\d.]+)px/g, "$1");
  assert.match(math, /^[\d\s.()+*/-]+$/, value);
  return Function(`return ${math}`)() as number;
};

const popover = (viewport: { width: number; height: number }, rem: number, count: number, at = button) => {
  const final = computed(".add-sheet.menu-sheet", viewport.width / rem);
  const tokens = Object.fromEntries([...read("src/tokens.css").matchAll(/(--s\d): ([\d.]+rem);/g)].map((entry) => [entry[1], entry[2]]));
  const vars = { ...tokens, ...menuAnchor(at, viewport, menuSpace(count, rem)) };
  const [top, , bottom] = split(final.get("inset")!).map((entry) => length(entry, vars, rem));
  const margins = split(final.get("margin")!);
  const marginTop = length(margins[0], vars, rem) as number;
  const marginBottom = length(margins[margins.length >= 3 ? 2 : 0], vars, rem) as number;
  const border = length(split(final.get("border")!)[0], vars, rem) as number;
  const natural = menuHeight(count, rem);
  const height = Math.min(natural, length(final.get("max-height")!, vars, rem) as number);
  const from = top === "auto" ? viewport.height - (bottom as number) - marginBottom - height : (top as number) + marginTop;
  const gap = top === "auto" ? at.top - (from + height) : from - at.bottom;
  return { from, to: from + height, height, gap, border, below: top !== "auto", whole: height === natural };
};

const scale = (rem: number) => ({ top: (224 * rem) / 16, bottom: (272 * rem) / 16, right: (980 * rem) / 16 });

test("the popover stays inside a short window and shows every item whenever one side has room for them", () => {
  for (const height of [250, 320, 400, 500, 900]) {
    const box = popover({ width: 1280, height }, 16, 3);
    assert.ok(box.from >= 0 && box.to <= height, `${height}: ${box.from} to ${box.to}`);
    assert.ok(box.whole, `${height} shows all items`);
    assert.ok(box.gap >= 4, `${height}: ${box.gap} px between More and the popover`);
  }
});

test("the popover has a one pixel border, and the menu is sized with it", () => {
  assert.equal(popover({ width: 1280, height: 900 }, 16, 3).border, 1);
});

test("the popover shows every item in each window height where either side has room, and a 4 px gap to More, at 100 and 200 percent text", () => {
  const tokens = Object.fromEntries([...read("src/tokens.css").matchAll(/(--s\d): ([\d.]+)rem;/g)].map((entry) => [entry[1], Number(entry[2])]));
  for (const rem of [16, 32]) {
    const at = scale(rem);
    const margin = (tokens["--s4"] + tokens["--s1"]) * rem;
    for (let height = (300 * rem) / 16; height <= (700 * rem) / 16; height++) {
      const box = popover({ width: rem === 16 ? 1280 : 2100, height }, rem, 3, at);
      const below = height - at.bottom;
      const room = Math.max(below, at.top) - margin;
      assert.equal(box.whole, room >= menuHeight(3, rem), `${rem} px text, window ${height}: ${box.height} px shown, ${room} px of room`);
      assert.equal(box.below, below - margin >= menuHeight(3, rem) || at.top <= below, `${rem} px text, window ${height}: side`);
      assert.ok(box.gap >= tokens["--s1"] * rem, `${rem} px text, window ${height}: gap ${box.gap}`);
      assert.ok(box.from >= 0 && box.to <= height, `${rem} px text, window ${height}: ${box.from} to ${box.to}`);
    }
  }
});

test("the popover is clamped to the room on its side and scrolls inside when its items need more", () => {
  const box = popover({ width: 2100, height: 400 }, 32, 3);
  assert.ok(box.from >= 0 && box.to <= 400, `${box.from} to ${box.to}`);
  assert.ok(!box.whole);
  assert.ok(box.height >= 150, `${box.height}`);
  assert.ok(box.from >= 32 && box.to <= 400 - 32, `${box.from} to ${box.to} keeps one rem from the window edge`);
});

test("the menu is a bottom sheet by default and a popover from the laptop width, with the sheet head kept for the name only", () => {
  const sheet = read("src/ui/sheet.css");
  const wide = /@media \(min-width: 62\.5rem\) \{\s*\.add-sheet\.menu-sheet \{([^}]*)\}([^]*)$/.exec(sheet)!;
  assert.match(wide[1], /inset: var\(--menu-top, auto\) var\(--menu-right\) var\(--menu-bottom, auto\) auto;/);
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
  const rows = [mineRoutine, ...["Cleanse", "Tone", "Serum", "Cream"].map((title) => item({ kind: "step", status: null, parent_id: mineRoutine.id, title, data: null }))];
  stage(rows);
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 26, 8) });
  try {
    const html = await markupOf("views/routines.tsx", ({ Routines }) => createElement(Routines, { id: mineRoutine.id }));
    const tools = html.slice(html.indexOf('class="rt-tools"'), html.indexOf("</div>", html.indexOf('class="rt-tools"')));
    const controls = [...tools.matchAll(/<(?:a|button)\b[^>]*>/g)].map((match) => match[0]);
    assert.equal(controls.length, 3);
    const filled = controls.filter((control) => !control.includes("secondary"));
    assert.equal(filled.length, 1);
    assert.match(filled[0], /^<a class="button rt-lead"/);
    assert.match(tools, /<span class="rt-word" data-wide="Step by step"><span>Step by step<\/span><\/span>/);
    assert.match(tools, /<button type="button" class="secondary" aria-label="Edit Morning care" data-replaces="#\/routines\/[^"]+\/start">/);
  } finally {
    mock.timers.reset();
  }
});

test("the routine detail keeps the Start box at its widest wording once a step is ticked", async () => {
  const mineRoutine = item({ kind: "routine", status: null, who: "a", title: "Morning care", group_key: "morning", data: {} });
  const step = (title: string, data: Record<string, unknown> | null = null) => item({ kind: "step", status: null, parent_id: mineRoutine.id, title, data });
  const rows = [mineRoutine, step("Cleanse", { done_a: "2026-10-26" }), ...["Tone", "Serum", "Cream", "Mist"].map((title) => step(title))];
  stage(rows);
  mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 26, 8) });
  try {
    const html = await markupOf("views/routines.tsx", ({ Routines }) => createElement(Routines, { id: mineRoutine.id }));
    assert.match(html, /<span class="rt-word" data-wide="Step by step"><span>Continue<\/span><\/span>/);
  } finally {
    mock.timers.reset();
  }
});
