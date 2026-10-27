import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { text } from "../src/ui/text.ts";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const rule = (css: string, selector: string) =>
  new RegExp(`(?:^|\\n)${selector.replace(/[.>*[\]="():]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

test("a cover image is lazy, sized by its box, has alt text or none, sends no referrer, and gives way to the generated cover on error", () => {
  const bits = read("ui/book-bits.tsx");
  assert.match(bits, /loading="lazy"/);
  assert.match(bits, /referrerPolicy="no-referrer"/);
  assert.match(bits, /width="200" height="300"/);
  assert.match(bits, /onError=\{\(\) => setFailed\(src\)\}/);
  assert.match(bits, /isCover\(url\)/);
  assert.match(bits, /aria-hidden=\{alt === undefined \|\| src === null \? "true" : undefined\}/);
  const css = read("views/books.css");
  assert.match(rule(css, ".cover"), /position:\s*relative/);
  assert.match(rule(css, ".cover img"), /position:\s*absolute;[^}]*inset:\s*0;[^}]*width:\s*100%;[^}]*height:\s*100%;[^}]*object-fit:\s*cover/);
});

test("the detail names the cover for a screen reader, and the lists leave it decorative", () => {
  assert.match(read("views/book.tsx"), /<Cover book=\{book\} alt=\{text\.books\.lookup\.coverOf\(book\.title\)\} \/>/);
  assert.doesNotMatch(read("ui/book-row.tsx"), /alt=/);
  assert.equal(text.books.lookup.coverOf("Bumi Manusia"), "Cover of Bumi Manusia");
});

test("the results are a labelled list of real buttons that are at least a row tall, with a visible focus ring, and the credit sits under them", () => {
  const view = read("ui/book-lookup.tsx");
  assert.match(view, /<ul className="hits" aria-label=\{WORDS\.results\[first\.source\]\}>/);
  assert.match(view, /<button type="button" className="hit" onClick=\{\(\) => accept\(hit\)\}>/);
  assert.match(view, /<\/ul>\s*<Credit source=\{first\.source\} \/>/);
  const css = read("views/books.css");
  assert.match(rule(css, ".hit"), /min-height:\s*var\(--row-min\)/);
  assert.match(rule(css, ".hit"), /width:\s*100%/);
  assert.doesNotMatch(rule(css, ".hit"), /outline:\s*none/);
  assert.match(rule(css, ".hits"), /overflow:\s*hidden/);
});

test("every state has plain words, and each tells the user typing goes on", () => {
  const { lookup } = text.books;
  assert.equal(lookup.offline, "Offline: type it in.");
  assert.equal(lookup.empty, "No match. Keep typing.");
  assert.match(lookup.failed, /Keep typing\.$/);
  assert.match(lookup.slow, /Keep typing\.$/);
  assert.deepEqual(lookup.credit, { google: "Details from Google Books", openlibrary: "Details from Open Library" });
  assert.deepEqual(lookup.results, { google: "Google Books search results", openlibrary: "Open Library results" });
  assert.equal(lookup.powered, "Powered by Google");
  assert.match(lookup.searching, /Searching/);
});

test("the status lines are polite live regions that exist before they have words, and an empty one takes no room", () => {
  const view = read("ui/book-lookup.tsx");
  assert.equal(view.match(/<p className="hint look-note" role="status">/g)?.length, 3);
  assert.match(rule(read("views/books.css"), ".look-note:empty"), /position:\s*absolute/);
});

test("the credit links to the work page in a new tab without opener or referrer", () => {
  const view = read("ui/book-lookup.tsx");
  assert.match(view, /target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"/);
});

test("the form searches only while no result is accepted for the title, and drops the accepted cover when the title changes", () => {
  const sheet = read("ui/book-sheet.tsx");
  assert.match(sheet, /const settled = held\(found, title\);/);
  assert.match(sheet, /useSearch\(\{ title, author, original \}, live && settled === null\)/);
  assert.match(sheet, /cover: settled\?\.cover \?\? "", ol: settled\?\.source === "openlibrary" \? settled\.work : "", gb: settled\?\.source === "google" \? settled\.work : ""/);
});

test("both Add sheets share the one form, so the global sheet's book chip gets the lookup too", () => {
  assert.match(read("ui/add-sheet.tsx"), /useBookForm\("wish", draft\.title, setInput, kind === "book" && onward === null\)/);
  assert.match(read("ui/book-sheet.tsx"), /useBookForm\(start, title, setTitle\)/);
  assert.match(read("ui/book-sheet.tsx"), /<BookLookup form=\{form\} \/>/);
});

test("the lookup client is the only code that reaches the network for books, and it sets nothing on the request", () => {
  const client = read("store/lookup.ts");
  assert.match(client, /credentials: own \? "same-origin" : "omit"/);
  assert.match(client, /referrerPolicy: "no-referrer"/);
  assert.doesNotMatch(client, /headers:|method:|cookie|localStorage|sendBeacon/);
  assert.doesNotMatch(read("hooks/use-lookup.ts"), /fetch/);
});

test("a result row wraps its text under the cover when the line is too narrow for both, so a word is not broken letter by letter", () => {
  const css = read("views/books.css");
  assert.match(rule(css, ".hit"), /flex-wrap:\s*wrap/);
  assert.match(rule(css, ".hit .bk-text"), /flex:\s*1 1 8rem/);
});

test("the search hook follows the pure state machine, and the screens fill through the pure helpers and let go on stale", () => {
  assert.match(read("hooks/use-lookup.ts"), /useEffect\(\(\) => follow\(lookup, ready, \{ title, author, original \}, setSearch\), \[ready, title, author, original\]\);/);
  const sheet = read("ui/book-sheet.tsx");
  assert.match(sheet, /const next = adopt\(typed\.current, hit\);/);
  assert.match(sheet, /typed\.current = \{ title, author, original, isbn, language, blurb, found \};/);
  assert.match(sheet, /const \{ hit, state \} = fillOutcome\(await lookup\.byIsbn\(code\), typed\.current, code, turn\.latest\(mine\)\);/);
  assert.match(sheet, /put\(release\(typed\.current\)\);\s*setFound\(null\);/);
  assert.match(sheet, /if \(!next\.wantsBlurb\) return;/);
  assert.match(sheet, /const got = arrive\(typed\.current, hit\.work,/);
  const view = read("ui/book-lookup.tsx");
  assert.match(view, /const latest = useRef\(book\);\s*latest\.current = book;/);
  assert.match(view, /fillBook\(lookup, code, \(\) => latest\.current\)/);
  assert.match(view, /if \(out\.kind === "stale"\) return setState\("idle"\);/);
  assert.equal(text.books.lookup.mismatch, "The ISBN belongs to a different book");
});

test("Google results carry the Powered by Google logo beside the credit and a link to the Google Books page on every row, and Open Library rows carry neither", () => {
  const view = read("ui/book-lookup.tsx");
  assert.match(view, /\{source === "google" && <img className="powered" src=\{POWERED_BY\} alt=\{WORDS\.powered\}/);
  assert.match(view, /\{hit\.source === "google" && \(\s*<a className="hint hit-link" href=\{pageOf\("google", hit\.work\) \?\? undefined\} target="_blank" rel="noopener noreferrer"/);
  assert.equal(text.books.lookup.openNamed("Bumi Manusia"), "Open Bumi Manusia on Google Books");
  assert.match(rule(read("views/books.css"), ".hit-link"), /display:\s*flex/);
  assert.match(rule(read("views/books.css"), ".hit-link"), /min-height:\s*var\(--target-min\)/);
  assert.match(read("tokens.css"), /--target-min:\s*44px/);
});

test("a stored book credits the source it was filled from, linked to that source's page", () => {
  const view = read("ui/book-lookup.tsx");
  assert.match(view, /<Credit source=\{google === null \? "openlibrary" : "google"\} work=\{work\} \/>/);
});
