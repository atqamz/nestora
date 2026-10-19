import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { navEntries } from "../src/ui/nav.ts";
import { overlay } from "../src/ui/overlay.ts";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const books = read("views/books.css");

const all = [books, read("style.css"), read("ui/ui.css"), read("ui/sheet.css")].join("\n");

const rule = (css: string, selector: string) =>
  new RegExp(`(?:^|\\n)${selector.replace(/[.>*[\]="():]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

test("the phone tab bar has one column per entry, the Add button's wider than the rest and capped by the viewport so the links keep 44 px at large text", () => {
  const columns = /\.tabs\s*\{[^}]*grid-template-columns:\s*([^;]+);/.exec(read("style.css"))?.[1].trim().replace(/min\(([^)]*)\)/, (_, args) => `min(${args.replace(/\s+/g, "")})`).split(/\s+/) ?? [];
  assert.equal(columns.length, navEntries("tabs").length);
  assert.deepEqual(columns, ["1fr", "1fr", "min(4.5rem,20vw)", "1fr", "1fr"]);
  assert.match(rule(read("style.css"), ".tab-add"), /width:\s*min\(3\.5rem, 16vw\)/);
});

test("a tab label never breaks inside a word and never outgrows its column", () => {
  const link = rule(read("style.css"), ".tabs a");
  assert.match(link, /white-space:\s*nowrap/);
  assert.match(link, /min-width:\s*0/);
  assert.match(link, /font-size:\s*min\(var\(--fs-micro\), 3\.6vw\)/);
  assert.match(link, /min-height:\s*3\.25rem/);
});

test("at large text the Undo toast wraps its action under the message and the place actions wrap inside the row", () => {
  assert.match(rule(all, ".toast p"), /flex-wrap:\s*wrap/);
  assert.match(rule(all, ".toast span"), /overflow-wrap:\s*anywhere/);
  assert.match(rule(all, ".acts"), /flex-wrap:\s*wrap/);
  assert.match(rule(all, ".acts"), /max-width:\s*100%/);
});

test("the location chip, the book link, the section header, the place choices and the stars keep a 44 px target", () => {
  assert.match(rule(books, "button.where"), /min-height:\s*var\(--target-min\)/);
  assert.match(rule(books, ".bk-link"), /min-height:\s*var\(--target-min\)/);
  assert.match(rule(books, ".shelf-sec summary"), /min-height:\s*var\(--target-min\)/);
  assert.match(rule(books, ".pick"), /min-height:\s*var\(--row-min\)/);
  assert.doesNotMatch(rule(books, ".star"), /(?:^|[\s;])(?:min-)?(?:width|height):/);
  assert.match(read("ui/ui.css"), /button,\s*\.button\s*\{[^}]*min-width:\s*var\(--target-min\)/);
});

test("long titles, authors and places can shrink and wrap, so no row pushes the page sideways", () => {
  for (const selector of [".bk-link", ".bk-text", ".bk-where", ".where", ".copy", ".bk-id", ".place-b"]) assert.match(rule(books, selector), /min-width:\s*0/, selector);
  for (const selector of [".where span", ".pick span"]) assert.match(rule(books, selector), /overflow-wrap:\s*anywhere/, selector);
  assert.match(rule(books, ".bk-by"), /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(books, /white-space:\s*nowrap/);
  assert.match(rule(books, ".cover"), /flex:\s*none/);
});

test("the cover keeps a 2 to 3 ratio and uses only the existing tints", () => {
  assert.match(rule(books, ".cover"), /aspect-ratio:\s*2 \/ 3/);
  assert.match(rule(books, ".cover"), /background:\s*var\(--tint-a\)/);
  assert.match(rule(books, '.cover[data-tone="b"]'), /background:\s*var\(--tint-b\)/);
  assert.doesNotMatch(books, /#[0-9a-f]{3,8}\b|rgb\(|hsl\(|oklch\(/i);
});

test("the Reading now mark is the rose signal colour", () => {
  assert.match(rule(books, '.reads[data-reading]::before'), /background:\s*var\(--signal\)/);
});

test("the toast takes taps on its action only, so the page under it stays usable", () => {
  assert.match(rule(all, ".toast"), /pointer-events:\s*none/);
  assert.match(rule(all, ".toast button"), /pointer-events:\s*auto/);
});

test("an action toast carries its action, lasts longer than a plain one, and can be dismissed", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let ran = 0;
  overlay.announce("Moved to Home B", { label: "Undo", run: () => (ran += 1) });
  const toast = overlay.getSnapshot().toast!;
  assert.deepEqual([toast.message, toast.action?.label], ["Moved to Home B", "Undo"]);
  toast.action!.run();
  assert.equal(ran, 1);
  t.mock.timers.tick(6000);
  assert.equal(overlay.getSnapshot().toast?.message, "Moved to Home B");
  t.mock.timers.tick(6000);
  assert.equal(overlay.getSnapshot().toast, null);
  overlay.announce("Plain");
  assert.equal(overlay.getSnapshot().toast?.action, undefined);
  t.mock.timers.tick(6000);
  assert.equal(overlay.getSnapshot().toast, null);
  overlay.announce("Again", { label: "Undo", run: () => undefined });
  overlay.dismissToast();
  assert.equal(overlay.getSnapshot().toast, null);
});

test("the book dialogs are native modals that lock the page, ride above the keyboard, give focus back and close on a route change", () => {
  const modal = read("ui/modal.tsx");
  const hook = read("ui/use-sheet.ts");
  assert.match(modal, /showModal\(\)/);
  assert.match(modal, /useSheet\(dialog, true, onClose\)/);
  assert.match(read("ui/add-sheet.tsx"), /useSheet\(dialog, adding, overlay\.closeAdd\)/);
  assert.match(hook, /setProperty\("--lock-gap"/);
  assert.match(hook, /removeProperty\("--lock-gap"\)/);
  assert.match(hook, /keyboardInset\(innerHeight, viewport\)/);
  assert.match(modal, /opener\.focus\(/);
  assert.match(hook, /addEventListener\("hashchange"/);
  assert.doesNotMatch(modal + read("ui/add-sheet.tsx"), /--lock-gap|keyboardInset/);
  assert.match(modal, /onClose=\{\(event\) => event\.target === event\.currentTarget && onClose\(\)\}/);
  assert.match(hook, /const first = document\.documentElement\.style\.getPropertyValue\("--lock-gap"\) === "";/);
  assert.match(hook, /if \(first\) document\.documentElement\.style\.removeProperty\("--lock-gap"\);/);
  assert.match(modal, /aria-labelledby=\{heading\}/);
  assert.match(modal, /aria-label=\{text\.sheet\.close\}/);
});

test("every icon-only button in the book screens has a label", () => {
  for (const file of ["views/books.tsx", "views/book.tsx", "views/places.tsx", "ui/where.tsx", "ui/copy-sheet.tsx", "ui/book-sheet.tsx"]) {
    const source = read(file);
    for (const [match] of source.matchAll(/<button[^>]*className="[^"]*\bib\b[^"]*"[^>]*>/g)) assert.match(match, /aria-label=/, `${file}: ${match}`);
  }
  for (const [match] of read("views/book.tsx").matchAll(/<button[^>]*className="star"[^>]*>/g)) assert.match(match, /aria-label=/);
  for (const [match] of read("ui/where.tsx").matchAll(/<button[^>]*className="where"[^>]*>/g)) assert.match(match, /aria-label=/);
});
