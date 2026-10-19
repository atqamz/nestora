import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { screenOf } from "../src/ui/routes.ts";
import { views } from "../src/ui/registry.ts";
import { text } from "../src/ui/text.ts";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const css = read("views/import.css");

const rule = (selector: string) => new RegExp(`(?:^|\\n)${selector.replace(/[.>*[\]="():]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

test("the import screen lives under the Books section at a route no book id can take", () => {
  assert.equal(screenOf("books"), "books");
  assert.match(read("views/books.tsx"), /id === "import"\) return <ImportBooks \/>/);
  assert.match(read("views/books.tsx"), /href="#\/books\/import"/);
  assert.match(read("ui/add-sheet.tsx"), /href="#\/books\/import"/);
});

test("the preview restacks as cards, never a table, so nothing pushes the page sideways", () => {
  assert.doesNotMatch(read("views/import.tsx"), /<table|<td|<th/);
  assert.doesNotMatch(css, /white-space:\s*nowrap|overflow-x|min-width:\s*\d+(?:rem|px)/);
  for (const selector of [".imp-row", ".imp-text", ".imp-batch"]) assert.match(rule(selector), /min-width:\s*0/, selector);
  assert.match(rule(".imp-text"), /overflow-wrap:\s*anywhere/);
  assert.match(rule(".imp-line"), /overflow-wrap:\s*anywhere/);
  assert.match(rule(".imp-bar"), /flex-wrap:\s*wrap/);
  assert.match(rule(".imp-acts"), /flex-wrap:\s*wrap/);
});

test("every row, button and the file picker keep a 44 px target, and only existing tokens are used", () => {
  assert.match(rule(".imp-row"), /min-height:\s*var\(--row-min\)/);
  assert.match(rule('input[type="file"]'), /min-height:\s*var\(--target-min\)/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgb\(|hsl\(|oklch\(/i);
});

test("the batch undo and the toast undo are one action, and the page says what it will do before it does it", () => {
  const view = read("views/import.tsx");
  assert.match(view, /undoImport\(ids, batch\.books\.length, actions\.many\)/);
  assert.match(read("ui/book-import.ts"), /announce\(text\.books\.import\.done\(books\)/);
  assert.ok(text.books.import.intro.includes("Nothing is saved before you press Import"));
});

test("the rated-elsewhere note is a plain text node and the key can be edited with the other book fields", () => {
  assert.ok(views.book.fields.includes("data.rated_elsewhere"));
  assert.equal(text.field.book["data.rated_elsewhere"], "Rated elsewhere");
  assert.doesNotMatch([read("views/books.tsx"), read("views/book.tsx"), read("views/import.tsx")].join("\n"), /dangerouslySetInnerHTML|innerHTML/);
  assert.equal(text.books.ratedElsewhere("<b>x</b> ~4 / 5"), "Rated elsewhere: <b>x</b> ~4 / 5");
});

test("no Indonesian outside the parser's label constants", () => {
  const sources = ["views/import.tsx", "ui/book-import.ts", "hooks/use-details.ts", "store/details.ts", "domain/import-plan.ts", "domain/import-csv.ts"].map(read).join("\n");
  assert.doesNotMatch(sources, /\b(?:penulis|sinopsis|pengarang|judul|buku|bagian|jilid)\b/i);
  const parser = read("domain/import-text.ts");
  assert.match(parser, /const AUTHOR_LABELS = \["Penulis", "Author"\]/);
  assert.match(parser, /const SYNOPSIS_LABELS = \["Sinopsis", "Synopsis"\]/);
});
