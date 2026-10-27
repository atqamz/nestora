import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { text } from "../src/ui/text.ts";
import { views } from "../src/ui/registry.ts";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const screens = ["views/routines.tsx", "views/routine.tsx", "views/today.tsx", "ui/routine-action.tsx", "ui/routine-sheet.tsx"];

const css = read("views/routines.css");

const rule = (selector: string) => new RegExp(`(?:^|\\n)${selector.replace(/[.>*[\]="():]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

test("the routine screens read rows only through the hook that applies the partition filter", () => {
  for (const file of screens) assert.doesNotMatch(read(file), /useTable\(|useSnapshot\(|readItems|rows\.items|\.rows\b.*items/, file);
  const hook = read("hooks/use-routines.ts");
  assert.match(hook, /routineRows\(rows\.items, me\)/);
  assert.equal([...hook.matchAll(/rows\.items/g)].length, 2);
  assert.match(read("domain/routines.ts"), /export const routineRows = \(rows: readonly ItemRow\[\], me: Side \| null\) => visible\(rows, me\)\.filter/);
  assert.match(read("domain/lately.ts"), /MARRIAGE_KINDS: ReadonlySet<string> = new Set\(\["task", "vendor", "guest"\]\)/);
});

test("every routine screen takes its rows from useRoutines and its writes from the flows", () => {
  for (const file of ["views/routines.tsx", "views/routine.tsx", "views/today.tsx"]) {
    const source = read(file);
    assert.match(source, /const rows = useRoutines\(\)/, file);
    assert.match(source, /useRoutineFlows\(rows\)/, file);
  }
  for (const file of [...screens, "ui/routine-flows.ts"]) assert.doesNotMatch(read(file), /fetch *\(|indexedDB|XMLHttpRequest|localStorage|sendBeacon/, file);
  assert.doesNotMatch(read("ui/routine-action.tsx"), /actions\.|hooks\/use-store/);
});

test("the routine writes go through the store, so the paused refusal and the outbox apply", () => {
  const flows = read("ui/routine-flows.ts");
  assert.match(flows, /actions: Pick<Store, "update" \| "many" \| "restore">/);
  assert.match(flows, /paused/);
  assert.match(read("hooks/use-routines.ts"), /routineFlows\(\{\s*items,\s*actions,/);
});

test("every icon-only button on the routine screens has a label, and every external link says where it goes", () => {
  for (const file of screens) {
    const source = read(file);
    for (const [match] of source.matchAll(/<button[^>]*className="[^"]*\bib\b[^"]*"[^>]*>/g)) assert.match(match, /aria-label=/, `${file}: ${match}`);
    for (const [match] of source.matchAll(/<a[^>]*target="_blank"[^>]*>/g)) assert.match(match, /rel="noopener noreferrer"/, `${file}: ${match}`);
    for (const [match] of source.matchAll(/<a[^>]*className="pill"[^>]*>/g)) assert.match(match, /aria-label=/, `${file}: ${match}`);
  }
  assert.match(read("ui/routine-sheet.tsx"), /aria-label=\{copy\.dayNames\[code\]\}/);
});

test("the edit sheet and the pause sheet are the native modal, which traps focus and closes on Escape and on a route change", () => {
  const sheet = read("ui/routine-sheet.tsx");
  assert.equal([...sheet.matchAll(/<Modal\b/g)].length, 2);
  assert.doesNotMatch(sheet, /<dialog/);
  assert.match(read("ui/modal.tsx"), /showModal\(\)/);
  assert.match(read("ui/modal.tsx"), /useSheet\(dialog, true, onClose\)/);
});

test("the sheet shows the private choice at creation only, with one line of explanation, and never offers it on an edit", () => {
  const sheet = read("ui/routine-sheet.tsx");
  assert.match(sheet, /\{creating && \(\s*<div className="field check-field">/);
  assert.match(sheet, /\{!creating && locked && <p className="hint rt-private">\{form\.privateKept\}<\/p>\}/);
  assert.match(sheet, /\{!locked && \(\s*<Field/);
  assert.equal(text.routines.form.privateHint.split(/[.!?]\s/).length <= 2, true);
  assert.match(text.routines.form.makePrivate, /duplicate it as private, then delete the shared one/);
});

test("the global Add sheet has no routine chip and the Settings exports list no routine kinds, which the full export already covers", () => {
  assert.deepEqual(Object.keys(text.sheet.kinds), ["task", "planned", "payment", "guest", "vendor", "book"]);
  assert.deepEqual(Object.keys(views).filter((name) => /routine|step|timer|pack|block|day_type|counter|text/.test(name)), []);
  assert.match(read("views/settings.tsx"), /label: text\.settings\.exportAll, query: "format=json"/);
});

test("Home shows the Today block under the Late line and above the due list, and the route is wired", () => {
  const home = read("views/home.tsx");
  assert.match(home, /<LateLine \/>\s*<Today \/>\s*<Them \/>\s*<h2 className="visually-hidden">\{text\.week\.heading\}<\/h2>\s*<Week \/>/);
  assert.match(read("main.tsx"), /case "routines":\s*return <Routines id=\{id\} sub=\{sub\} \/>;/);
  assert.match(read("main.tsx"), /import "\.\/views\/routines\.css";/);
});

test("the whole Today block collapses by its own choice only, so a tick never closes it under the thumb", () => {
  const today = read("views/today.tsx");
  assert.match(today, /useState\(!finished\)/);
  assert.match(today, /<details open=\{open\} onToggle=\{\(event\) => setOpen\(event\.currentTarget\.open\)\}>/);
  assert.doesNotMatch(today, /useEffect\(\(\) => \{[^}]*setOpen/);
});

test("a tick or a tap leaves keyboard focus on its control: nothing is disabled while a write runs, and the guard refuses a second tap", () => {
  const source = read("ui/routine-action.tsx");
  assert.doesNotMatch(source, /disabled=\{[^}]*busy/);
  assert.match(source, /<input type="checkbox" checked=\{done\} disabled=\{!active\} aria-labelledby=\{titleId\} aria-disabled=\{locked \|\| undefined\} onChange=\{guard\(\(\) => run\(/);
  assert.match(source, /className="pill rt-plus" disabled=\{!active\} aria-disabled=\{locked \|\| undefined\} aria-label/);
  assert.match(source, /aria-disabled=\{taken === 0 \|\| locked \|\| undefined\}/);
  assert.match(source, /onClick=\{guard\(add\)\}/);
  assert.match(source, /onClick=\{guard\(\(\) => taken > 0 && run\(/);
  assert.match(source, /const run = \(work: [^\n]*\) => once\(/);
  assert.match(read("ui/ui.css"), /button:disabled,\s*button\[aria-disabled="true"\] \{\s*opacity: 0\.6;/);
});

test("the count of a counter is a polite live region, so a screen reader hears each change", () => {
  assert.match(read("ui/routine-action.tsx"), /<span className="meta rt-nums" aria-live=\{action\.kind === "counter" \? "polite" : undefined\}>/);
});

test("the Today block opens again when the routine day changes", () => {
  const today = read("views/today.tsx");
  assert.match(today, /const \[shown, setShown\] = useState\(day\);\s*if \(shown !== day\) \{\s*setShown\(day\);\s*setOpen\(!finished\);\s*setPicks\(undefined\);\s*\}/);
});

test("the flows write the day the screens show: the clock is read in one place, the day hook, and handed down", () => {
  const hook = read("hooks/use-routines.ts");
  assert.equal([...hook.matchAll(/new Date\(/g)].length, 2);
  assert.match(hook, /useRoutineFlows = \(\{ items, me, day \}: ReturnType<typeof useRoutines>\)/);
  assert.match(hook, /routineFlows\(\{\s*items,\s*actions,\s*me,\s*day,/);
  assert.doesNotMatch(read("ui/routine-flows.ts"), /new Date|Date\.now|\bnow\b|routineDay/);
});

test("long names, notes and many actions wrap inside the row and never push the page sideways", () => {
  for (const selector of [".rt-btns", ".rt-act", ".rt-fields", ".rt-add button", ".rt-dayset button"]) assert.match(rule(selector), /min-width:\s*(0|var\(--target-min\))/, selector);
  assert.match(rule(".rt-btns"), /flex-wrap:\s*wrap/);
  assert.match(rule(".rt-side"), /flex-wrap:\s*wrap/);
  assert.match(rule(".rt-note"), /white-space:\s*pre-wrap/);
  assert.match(rule(".rt-today summary"), /flex-wrap:\s*wrap/);
  assert.doesNotMatch(css, /white-space:\s*nowrap/);
  assert.match(rule(".rt-dayset"), /repeat\(auto-fit, minmax\(2\.75rem, 1fr\)\)/);
  assert.match(rule(".rt-fields"), /repeat\(auto-fit, minmax\(min\(100%, 8rem\), 1fr\)\)/);
});

test("every control keeps a 44 px target and the summaries are tall enough to tap", () => {
  for (const selector of [".rt-today summary", ".rt-more summary"]) assert.match(rule(selector), /min-height:\s*var\(--target-min\)/, selector);
  assert.match(rule(".rt-btns .rt-minus"), /min-width:\s*var\(--target-min\)/);
  assert.match(rule(".rt-btns .rt-minus"), /min-height:\s*var\(--target-min\)/);
  assert.match(rule(".rt-block h3 .rt-fold"), /min-height:\s*var\(--row-min\)/);
});

test("the routine styles use the existing tokens only, with no colour of their own and no gamification", () => {
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgb\(|hsl\(|oklch\(|animation|@keyframes|confetti/i);
  const words = JSON.stringify(text.routines).toLowerCase();
  for (const banned of ["streak", "badge", "points", "score", "missed", "congrat", "level"]) assert.equal(words.includes(banned), false, banned);
});

test("the Today block and the routine screens show nothing of the partner beyond the shared routines", () => {
  const list = read("views/routines.tsx");
  assert.match(list, /const own = routine\.who === me \|\| routine\.who === "both";\s*const tally = own\s*\? progress\([^;]*\)\s*: null;/);
  assert.match(read("domain/routines.ts"), /\.filter\(\(\{ routine \}\) => mine\(routine, me\)\)/);
});

test("a tick never changes the width of what sits beside it, so the block keeps its line breaks", () => {
  assert.match(rule(".rt-tally"), /min-width:\s*9ch/);
  assert.match(rule(".rt-tally"), /tabular-nums/);
  assert.match(rule(".rt-nums"), /tabular-nums/);
  assert.match(rule(".rt-block h3 .rt-sub"), /display:\s*block/);
  assert.match(rule(".rt-block h3 .rt-sub"), /tabular-nums/);
  assert.match(read("ui/routine-action.tsx"), /className="meta rt-nums"/);
});
