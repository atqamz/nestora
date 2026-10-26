import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { text } from "../src/ui/text.ts";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const rule = (css: string, selector: string) =>
  new RegExp(`(?:^|\\n)${selector.replace(/[.>*[\]="():]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

const files = ["views/screens.tsx", "views/screen.tsx", "ui/screen-row.tsx", "ui/screen-sheet.tsx", "ui/screen-save.ts", "domain/screen.ts"];

const books = read("views/books.css");

const ui = read("ui/ui.css");

test("the three Library screens share one tab bar, the Books screen only for its two lists, and Marriage still gets its own", () => {
  const tabs = read("ui/space-tabs.tsx");
  assert.match(tabs, /<nav className="space-tabs" aria-label=\{label\}>/);
  assert.match(tabs, /aria-current=\{tab\.screens\.includes\(screen\) \? "page" : undefined\}/);
  assert.match(tabs, /<SpaceTabs tabs=\{libraryTabs\} label=\{text\.nav\.library\}/);
  assert.match(read("ui/marriage-tabs.tsx"), /<SpaceTabs tabs=\{marriageTabs\} label=\{text\.marriage\.label\}/);
  assert.match(read("views/screens.tsx"), /<LibraryTabs screen=\{kind === "movie" \? "movies" : "series"\} \/>/);
  const view = read("views/books.tsx");
  assert.match(view, /<LibraryTabs screen="books" \/>\s*\{route === "wishlist" \? <Wishlist \/> : <Shelf \/>\}/);
  assert.ok(view.indexOf("<LibraryTabs") > view.indexOf('if (id !== undefined) return <BookDetail'), "the detail, places and import carry no tabs");
});

test("each screen has one h1 and its sections are h2, and the Watched summary is not a heading", () => {
  const list = read("views/screens.tsx");
  assert.equal(list.match(/<Title>/g)?.length, 1);
  assert.match(list, /<h2 id="sc-watching">/);
  assert.match(list, /<h2 id="sc-want">/);
  assert.match(list, /<summary>\s*<span className="shelf-name">\{text\.screen\.watched\}<\/span>/);
  assert.doesNotMatch(list, /<h[3-6][\s>]/);
  assert.equal(read("views/screen.tsx").match(/<Title>/g)?.length, 1);
  assert.doesNotMatch(read("views/screen.tsx"), /<h[3-6][\s>]/);
});

test("no screen source makes a request or opens a database, so every write goes through the store", () => {
  for (const file of files) assert.doesNotMatch(read(file), /fetch *\(|indexedDB|XMLHttpRequest|sendBeacon|localStorage/, file);
});

test("the detail shows a rating control only for the signed-in partner, and none while the side is unknown", () => {
  const view = read("views/screen.tsx");
  assert.match(view, /ratingRows\(row, me\)\.map\(\(\{ side, stars, mine \}\) => \(/);
  assert.match(view, /\{mine \? \(\s*<div className="rate"/);
  assert.equal(view.match(/ratingPatch\(/g)?.length, 1);
  assert.match(view, /onClick=\{\(\) => run\(ratingPatch\(row, side, n\)\)\}/);
  assert.match(view, /text\.screen\.notRated/);
  assert.match(view, /\{!gone && watched && <Ratings row=\{row\} \/>\}/);
});

test("the status control moves a row through the registry's three statuses and does nothing for the current one", () => {
  const view = read("views/screen.tsx");
  assert.match(view, /\{WATCH\.map\(\(pick\) => \(/);
  assert.match(view, /aria-pressed=\{now === pick\}/);
  assert.match(view, /once\(async \(\) => setFailure\(failureOf\(await moveScreen\(actions, row, pick, stamp\(\)\)\)\)\)/);
  assert.deepEqual(text.screen.pick, { want: "To watch", watching: "Watching", watched: "Watched" });
});

test("the list gives each kind its own words, an empty state and an all-watched state, and searches over the title and original title", () => {
  const view = read("views/screens.tsx");
  assert.match(view, /words\.empty/);
  assert.match(view, /shown\.allWatched && <p className="empty">\{words\.allWatched\}<\/p>/);
  assert.match(view, /screenList\(items, kind, query\)/);
  assert.match(view, /open=\{shown\.openWatched\}/);
  assert.equal(text.movies.empty, "No movies yet. Add one you want to watch.");
  assert.equal(text.movies.allWatched, "Nothing left to watch. Add another movie.");
  assert.equal(text.series.add, "Add a series");
  assert.equal(text.movies.found(1), "1 movie found");
  assert.equal(text.series.found(2), "2 series found");
});

test("the add sheet needs only a title, defaults the pick to both, and offers To watch and Watched", () => {
  const sheet = read("ui/screen-sheet.tsx");
  assert.match(sheet, /useState<ScreenInput\["who"\]>\("both"\)/);
  assert.match(sheet, /useState<ScreenInput\["status"\]>\("want"\)/);
  assert.match(sheet, /START\.map\(\(pick\)/);
  assert.match(sheet, /name: "title", label: text\.screen\.sheet\.title, type: "text", required: true/);
  assert.doesNotMatch(sheet, /name: "year"[^\n]*required/);
  assert.doesNotMatch(read("ui/add-sheet.tsx"), /movie|series/);
});

test("rows and detail reuse the book layout classes, which keep a 44 px target, shrink and wrap", () => {
  const view = ["views/screens.tsx", "views/screen.tsx", "ui/screen-row.tsx"].map(read).join("\n");
  for (const name of ["bk", "bk-link", "bk-text", "bk-by", "shelf-sec", "bk-head", "bk-id", "star", "rate", "seg"]) assert.match(view, new RegExp(`className="${name}[" ]`), name);
  assert.match(rule(books, ".bk-link"), /min-height:\s*var\(--target-min\)/);
  assert.match(rule(books, ".bk-link"), /min-width:\s*0/);
  assert.match(rule(books, ".bk-text"), /min-width:\s*0/);
  assert.match(rule(books, ".bk-by"), /overflow-wrap:\s*anywhere/);
  assert.match(rule(books, ".shelf-sec summary"), /min-height:\s*var\(--target-min\)/);
  assert.match(rule(books, ".bk-id"), /min-width:\s*0/);
  assert.doesNotMatch(rule(books, ".star"), /(?:^|[\s;])(?:min-)?(?:width|height):/);
  assert.match(ui, /button,\s*\.button\s*\{[^}]*min-width:\s*var\(--target-min\)/);
  assert.match(rule(ui, ".space-tabs a"), /min-height:\s*var\(--target-min\)/);
  assert.match(rule(ui, ".space-tabs"), /flex-wrap:\s*wrap/);
});

test("the screens draw no image of their own and name no host: posters go through Cover, which checks the host", () => {
  for (const file of files) assert.doesNotMatch(read(file), /<img|image\.tmdb\.org|api\.themoviedb/i, file);
});

test("a row of the other list shows its own not-found page with Back and no Undo", () => {
  const view = read("views/screen.tsx");
  assert.match(view, /if \(!row && elsewhere\) \{[^]*?<DetailTitle wide=\{false\}>\{text\.screen\.notHere\}<\/DetailTitle>[^]*?\{text\.back\}[^]*?\}\s*if \(!row\) return <Gone/);
  assert.doesNotMatch(view.slice(view.indexOf("if (!row && elsewhere)"), view.indexOf("if (!row) return")), /text\.undo/);
});

test("deleting a row goes back to its own list and offers Undo", () => {
  const save = read("ui/screen-save.ts");
  assert.match(save, /go\(`\/\$\{views\[kind\]\.route\}`\)/);
  assert.match(save, /label: text\.undo/);
  assert.match(save, /deleted_at: null/);
  assert.equal(text.screen.deleted("Inception"), "Deleted: Inception");
});
