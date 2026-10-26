import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { text } from "../src/ui/text.ts";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const rule = (css: string, selector: string) =>
  new RegExp(`(?:^|\\n)${selector.replace(/[.>*[\]="():]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

const logo = readFileSync(new URL("../public/tmdb.svg", import.meta.url));

const css = read("views/books.css");

const credit = read("ui/tmdb-credit.tsx");

test("the notice is TMDB's sentence from §3 of the API terms (read 26 October 2026), with 'application' chosen from the options", () => {
  assert.equal(text.tmdb.credit, "This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB.");
  assert.equal(text.tmdb.logo, "TMDB");
  assert.match(credit, /<span>\{text\.tmdb\.credit\}<\/span>/);
});

test("the logo is TMDB's approved short SVG, byte for byte: 2,065 bytes with the hash on TMDB's own file name", () => {
  assert.equal(logo.length, 2065);
  assert.equal(createHash("sha256").update(logo).digest("hex"), "8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c");
});

test("the logo is served from this app, with no width, height, style, transform, filter or flip, and a height of 0.75rem in the stylesheet", () => {
  assert.match(credit, /<img src="\/tmdb\.svg" alt=\{text\.tmdb\.logo\} decoding="async" \/>/);
  assert.doesNotMatch(credit, /<img[^>]*(?:width|height|style|className|transform|filter)/);
  const box = rule(css, ".tmdb-logo img");
  assert.match(box, /(?:^|[\s;])height:\s*0\.75rem;/);
  assert.doesNotMatch(box, /(?:^|[\s;])(?:width|max-width|min-width|max-height|min-height|transform|filter|object-fit|object-position|rotate|scale|translate|opacity|mix-blend-mode|clip-path|mask|zoom|zoom)\s*:/);
  const [, w, h] = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(logo.toString("utf8")) ?? [];
  assert.match(box, new RegExp(`aspect-ratio:\\s*${w.replace(".", "\\.")}\\s*/\\s*${h.replace(".", "\\.")};`));
  assert.match(box, /flex:\s*none/);
  for (const selector of [".tmdb-logo", ".tmdb", ".tmdb span", ".credit"]) assert.doesNotMatch(rule(css, selector), /transform|filter|rotate|scale|zoom|opacity/, selector);
});

test("the logo link is at least 44 px tall, and it and 'Open on TMDB' open the site in a new tab without opener or referrer", () => {
  assert.match(rule(css, ".tmdb-logo"), /min-height:\s*var\(--target-min\)/);
  assert.match(credit, /href="https:\/\/www\.themoviedb\.org" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"/);
  assert.match(read("views/screen.tsx"), /className="button secondary" href=\{tmdbPage\(kind, tmdb\)\} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"/);
  assert.equal(text.screen.tmdb, "Open on TMDB");
});

test("the credit wraps: the sentence takes its own line and breaks anywhere, so it never makes the page scroll sideways", () => {
  assert.match(rule(css, ".credit"), /flex-wrap:\s*wrap/);
  assert.match(rule(css, ".credit"), /overflow-wrap:\s*anywhere/);
  assert.match(rule(css, ".tmdb span"), /flex:\s*1 1 100%/);
  assert.match(rule(css, ".tmdb span"), /min-width:\s*0/);
});

test("the credit is in all three places: under the lookup list, at the foot of both screens, and in Settings under Credits", () => {
  assert.match(read("ui/screen-lookup.tsx"), /<\/ul>\s*<TmdbCredit \/>/);
  const list = read("views/screens.tsx");
  assert.match(list, /\{usesTmdb\(items, kind\) && <TmdbCredit \/>\}/);
  assert.ok(list.indexOf("<TmdbCredit />") > list.indexOf("</details>"), "after the sections");
  assert.match(read("views/screen.tsx"), /\{usesTmdb\(\[row\], kind\) && <TmdbCredit \/>\}/);
  assert.match(read("views/settings.tsx"), /<h2>\{text\.tmdb\.credits\}<\/h2>\s*<TmdbCredit \/>/);
  assert.equal(text.tmdb.credits, "Credits");
});

test("posters load only from TMDB's CDN through Cover: lazy, no referrer, never copied, and the app names no TMDB API host", () => {
  const bits = read("ui/book-bits.tsx");
  assert.match(bits, /loading="lazy"/);
  assert.match(bits, /referrerPolicy="no-referrer"/);
  assert.match(bits, /isCover\(url\)/);
  for (const file of ["ui/screen-lookup.tsx", "ui/screen-row.tsx", "views/screen.tsx"]) assert.match(read(file), /<Cover /, file);
});

test("UI strings call it TMDB and nothing else", () => {
  const words = JSON.stringify([text.tmdb, text.screen.tmdb, text.screen.lookup.results]);
  assert.doesNotMatch(words, /moviedb|movie database|themoviedb/i);
});
