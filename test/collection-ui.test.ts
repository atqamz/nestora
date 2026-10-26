import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { collections } from "../src/domain/collection.ts";
import { text } from "../src/ui/text.ts";
import { item } from "./domain-rows.ts";
import { markupOf } from "./render.ts";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const rule = (css: string, selector: string) =>
  new RegExp(`(?:^|\\n)${selector.replace(/[.>*[\]="():]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

const books = read("views/books.css");

const ui = read("ui/ui.css");

const films = [
  item({ kind: "movie", title: "Hannibal Rising", status: "watched", done_on: "2026-10-01", created_at: "2026-10-04T00:00:00Z", data: { collection: "Hannibal", order: 0, year: 2007 } }),
  item({ kind: "movie", title: "Red Dragon", status: "want", created_at: "2026-10-03T00:00:00Z", data: { collection: "Hannibal", order: 1, year: 2002 } }),
  item({ kind: "movie", title: "The Silence of the Lambs", status: "want", created_at: "2026-10-01T00:00:00Z", data: { collection: "Hannibal", order: 2, year: 1991 } }),
];

const group = collections(films, "movie")[0];

const strip = (html: string) => html.replace(/<link rel="preload"[^>]*\/>/g, "");

const sectionOf = async () => strip(await markupOf("ui/collection-section.tsx", ({ CollectionSection }) => createElement(CollectionSection, { kind: "movie", group })));

test("a collection renders as a labelled section: an h2 with the name and count, then an ordered list in watch order", async () => {
  const html = await sectionOf();
  assert.match(html, /^<section aria-labelledby="([^"]+)"><div class="co-h"><h2 id="\1">Hannibal <span class="tally">3<\/span><\/h2>/);
  assert.match(html, /<ol class="rows" role="list">/);
  assert.equal(html.match(/<li /g)?.length, 3);
  assert.deepEqual([...html.matchAll(/<span class="title">([^<]*)</g)].map((match) => match[1]), ["Hannibal Rising", "Red Dragon", "The Silence of the Lambs"]);
  assert.doesNotMatch(html, /<h[13-6][\s>]/);
});

test("each row shows its position, its status and, on the first unwatched one only, the Next up mark", async () => {
  const html = await sectionOf();
  assert.deepEqual([...html.matchAll(/<span class="co-no" aria-hidden="true">(\d+)<\/span>/g)].map((match) => match[1]), ["1", "2", "3"]);
  assert.deepEqual([...html.matchAll(/<span class="co-state">([^<]*)</g)].map((match) => match[1]), ["To watch", "To watch"]);
  assert.equal(html.match(/<span class="co-next">Next up<\/span>/g)?.length, 1);
  assert.match(html, /<li class="bk" data-member="true" data-next="true">[^]*?Red Dragon/);
  assert.equal(html.match(/data-next="true"/g)?.length, 1);
});

test("a row link reads its title and facts once: no repeated Watched, no bare position digit and no cover initials", async () => {
  const html = await sectionOf();
  const links = [...html.matchAll(/<a class="bk-link"[^>]*>([^]*?)<\/a>/g)].map((match) => match[1].replace(/<span class="(?:co-no|cover)"[^>]*aria-hidden="true"[^>]*>[^<]*(?:<img[^>]*>)?<\/span>/g, "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
  assert.equal(links.length, 3);
  assert.match(links[0], /^Hannibal Rising\b/);
  for (const name of links) assert.ok((name.match(/Watched/g) ?? []).length <= 1, name);
  assert.match(links[0], /Watched 1 Oct 2026/);
});

test("each row has Move up and Move down buttons named after the title, disabled only at the ends, and a rename button names the collection", async () => {
  const html = await sectionOf();
  const button = (label: string) => new RegExp(`<button type="button" class="ib" data-move="(?:up|down):[^"]+"( disabled="")? aria-label="${label}">`).exec(html);
  assert.equal(button("Move up: Hannibal Rising")?.[1], ' disabled=""');
  assert.equal(button("Move down: Hannibal Rising")?.[1], undefined);
  assert.equal(button("Move up: Red Dragon")?.[1], undefined);
  assert.equal(button("Move down: Red Dragon")?.[1], undefined);
  assert.equal(button("Move down: The Silence of the Lambs")?.[1], ' disabled=""');
  assert.ok(button("Move up: The Silence of the Lambs"));
  assert.match(html, /<button type="button" class="ib" aria-label="Rename collection: Hannibal">/);
});

test("a single-member collection has no way to move and still reads as a section", async () => {
  const one = collections([films[0]], "movie")[0];
  const html = strip(await markupOf("ui/collection-section.tsx", ({ CollectionSection }) => createElement(CollectionSection, { kind: "movie", group: one })));
  assert.equal(html.match(/data-move="up:[^"]+" disabled=""/g)?.length, 1);
  assert.equal(html.match(/data-move="down:[^"]+" disabled=""/g)?.length, 1);
});

test("the list puts collection sections after Watching now and before To watch, and the loose sections keep their own ids", () => {
  const view = read("views/screens.tsx");
  assert.ok(view.indexOf('id="sc-watching"') < view.indexOf("shown.groups.map") && view.indexOf("shown.groups.map") < view.indexOf('id="sc-want"'));
  assert.match(view, /<CollectionSection key=\{group\.key\} kind=\{kind\} group=\{group\} \/>/);
  assert.doesNotMatch(view, /<h[3-6][\s>]/);
});

test("Move buttons keep keyboard focus on the moved row, falling back to the other button when one is disabled, and never use busy to disable", () => {
  const section = read("ui/collection-section.tsx");
  assert.match(section, /moved\.current = `\$\{step < 0 \? "up" : "down"\}:\$\{row\.id\}`/);
  assert.match(section, /\(target && !target\.disabled \? target : find\(way === "up" \? "down" : "up"\)\)\?\.focus\(\)/);
  assert.doesNotMatch(section, /useBusy/);
  assert.match(section, /readItems/);
});

test("the targets are 44 px: icon buttons take --target-min both ways and the row link keeps its own", () => {
  assert.match(rule(ui, ".ib"), /width:\s*var\(--target-min\)/);
  assert.match(rule(ui, ".ib"), /height:\s*var\(--target-min\)/);
  assert.match(rule(books, ".bk-link"), /min-height:\s*var\(--target-min\)/);
  assert.match(rule(books, ".co-h h2"), /min-width:\s*0/);
  assert.match(rule(books, ".co-h h2"), /overflow-wrap:\s*anywhere/);
  assert.match(rule(books, ".co-no"), /font-variant-numeric:\s*tabular-nums/);
});

test("the next-up mark is text as well as a colour, and the member row keeps its layout width", () => {
  assert.equal(text.screen.collection.nextUp, "Next up");
  assert.match(rule(books, ".bk[data-member]"), /border-inline-start:\s*3px solid transparent/);
  assert.match(rule(books, ".bk[data-next]"), /border-inline-start-color:\s*var\(--accent\)/);
});

test("the add sheet and the detail offer the Collection field with the existing names as suggestions, never a lookup", () => {
  const sheet = read("ui/screen-sheet.tsx");
  assert.match(sheet, /name: "collection",\s*label: text\.screen\.collection\.label,[^}]*suggestions: collectionNames\(items, kind\)/);
  assert.match(sheet, /collectionProblem\(collection\)/);
  const detail = read("views/screen.tsx");
  assert.match(detail, /<h2 id="sc-collection">\{words\.section\}<\/h2>/);
  assert.match(detail, /suggestions: collectionNames\(rows, kind\)/);
  assert.match(detail, /\{!gone && <Collection row=\{row\} kind=\{kind\} \/>\}/);
  assert.match(detail, /words\.remove/);
  assert.doesNotMatch(read("domain/collection.ts"), /tmdb/i);
  assert.doesNotMatch(read("ui/collection-flows.ts"), /tmdb|fetch/i);
});

test("the words are English, name a partner nowhere, and the live note is polite", () => {
  const words = text.screen.collection;
  assert.equal(words.up("Red Dragon"), "Move up: Red Dragon");
  assert.equal(words.down("Red Dragon"), "Move down: Red Dragon");
  assert.equal(words.position(2, 4), "Position 2 of 4");
  assert.equal(words.moved("Red Dragon", 2, 4), "Moved: Red Dragon, now 2 of 4");
  assert.equal(words.renamed("Hannibal", "Hannibal Lecter"), "Renamed Hannibal to Hannibal Lecter");
  assert.equal(words.joined("Red Dragon", "Hannibal"), "Added to Hannibal: Red Dragon");
  assert.equal(words.left("Red Dragon", "Hannibal"), "Removed from Hannibal: Red Dragon");
  assert.doesNotMatch(JSON.stringify(words), /Partner/);
  assert.match(read("views/screen.tsx"), /<p className="hint" role="status">\s*\{words\.position\(/);
});

test("the export and Find posters code paths are untouched by the feature: the collection files never read or write a TMDB key", () => {
  for (const file of ["domain/collection.ts", "ui/collection-flows.ts", "ui/collection-section.tsx"]) assert.doesNotMatch(read(file), /cover|tmdb_at|"tmdb"|data\.tmdb/, file);
});

test("an idle section renders no failure line and no open sheet, and the focus effect only runs after a press", async () => {
  const html = await sectionOf();
  assert.doesNotMatch(html, /role="alert"|<dialog/);
  const section = read("ui/collection-section.tsx");
  assert.match(section, /if \(pressed === null\) return;\n\s*moved\.current = null;/);
  assert.match(section, /if \(!result\.ok\) moved\.current = null;/);
  assert.match(section, /useRef<string \| null>\(null\)/);
  assert.match(section, /\{failure\.length > 0 && \(\s*<p className="error" role="alert">/);
});
