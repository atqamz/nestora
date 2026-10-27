import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import type { ItemRow } from "../shared/tables.ts";
import { text } from "../src/ui/text.ts";
import { item } from "./domain-rows.ts";
import { markupOf } from "./render.ts";
import { stage } from "./render-store.ts";

after(() => stage([]));

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const plain = (html: string) => html.replace(/<link rel="preload"[^>]*\/>/g, "");

const screens = async (rows: ItemRow[], kind: "movie" | "series", id?: string) => {
  stage(rows);
  return plain(await markupOf("views/screens.tsx", ({ Screens }) => createElement(Screens, { kind, id })));
};

const books = async (rows: ItemRow[], route = "books", id?: string) => {
  stage(rows);
  return plain(await markupOf("views/books.tsx", ({ Books }) => createElement(Books, { route, id })));
};

const people = async (rows: ItemRow[], route = "guests") => {
  stage(rows);
  return plain(await markupOf("views/people.tsx", ({ People }) => createElement(People, { route })));
};

const movie = (title: string, fields: Partial<ItemRow> = {}) => item({ kind: "movie", status: "want", title, ...fields });

const shelved = (title: string) => item({ kind: "book", status: "shelf", title, data: { author: "Ana Lestari" } });

const guest = (title: string, who: "a" | "b", qty: number, status = "todo") => item({ kind: "guest", status, title, who, qty, group_key: "Family" });

const order = (html: string, ...marks: string[]) => marks.map((mark) => html.indexOf(mark));

const ascending = (numbers: number[]) => numbers.every((n, i) => n >= 0 && (i === 0 || n > numbers[i - 1]));

test("a cover wears a partner tint only for a row that has that owner, and is neutral for both, nobody and lookup hits", async () => {
  const cover = (who: string | null | undefined) => markupOf("ui/book-bits.tsx", ({ Cover }) => createElement(Cover, { book: { title: "Midnight Ferry", who } }));
  assert.match(await cover("a"), /^<span class="cover" data-tone="a" aria-hidden="true">MF/);
  assert.match(await cover("b"), /data-tone="b"/);
  for (const who of ["both", null, undefined]) assert.doesNotMatch(await cover(who), /data-tone/, String(who));
  stage([movie("Midnight Ferry", { who: "b" }), movie("Salt Road", { who: "both" }), movie("Paper Kites")]);
  const list = await screens([movie("Midnight Ferry", { who: "b" }), movie("Salt Road", { who: "both" }), movie("Paper Kites")], "movie");
  assert.deepEqual(list.match(/<span class="cover"[^>]*>/g)?.map((tag) => /data-tone="(\w)"/.exec(tag)?.[1] ?? "none").sort(), ["b", "none", "none"]);
});

test("Movies and Series head is the title with Add beside it, the search next, and no tools row or poster notice above the first row", async () => {
  const html = await screens([movie("Midnight Ferry"), movie("Salt Road", { status: "watching" })], "movie");
  assert.match(html, /<div class="lib-head"><h1 tabindex="-1">Movies<\/h1><button type="button"><svg[^]*?<\/svg>Add a movie<\/button><\/div>/);
  assert.doesNotMatch(html, /bk-tools/);
  assert.ok(ascending(order(html, "<h1", "Add a movie", 'role="search"', "Watching now", "Midnight Ferry")));
  assert.doesNotMatch(html, /class="posters"[^]*Watching now/);
});

test("Books head keeps Add beside the title and puts Places and Import behind one More menu named for the screen", async () => {
  const html = await books([shelved("Salt and Lantern")]);
  assert.match(html, /<div class="lib-head"><h1 tabindex="-1">Books<\/h1><button type="button"><svg[^]*?<\/svg>Add a book<\/button><\/div>/);
  assert.match(html, /<div class="lib-bar"><div role="group" aria-label="Shelf or wishlist" class="seg">/);
  assert.match(html, /<button type="button" class="secondary" aria-haspopup="menu" aria-expanded="false" aria-label="More actions for Books">/);
  assert.doesNotMatch(html, /href="#\/places"|href="#\/books\/import"|Import a list|>Places</);
  assert.ok(ascending(order(html, "<h1", "Add a book", 'class="seg"', "More actions for Books", 'role="search"', "Salt and Lantern")));
  assert.equal(html.match(/<button type="button" class="secondary" aria-haspopup/g)?.length, 1);
});

test("the Books menu holds Places and Import as pin and upload items that navigate", () => {
  const source = read("views/books.tsx");
  assert.match(source, /\{ id: "places", icon: "pin", label: text\.books\.places, run: go\("#\/places"\) \}/);
  assert.match(source, /\{ id: "import", icon: "upload", label: text\.books\.import\.open, run: go\("#\/books\/import"\) \}/);
  assert.match(read("domain/menu.ts"), /icon: "copy" \| "pause" \| "resume" \| "reset" \| "trash" \| "pin" \| "upload"/);
});

test("the Guests summary is one line with a single owner select beside it, and the quick add has no side select", async () => {
  const html = await people([guest("Rina", "a", 2), guest("Tono", "b", 1), guest("Umi", "a", 1, "declined")]);
  assert.match(html, /<div class="people-bar"><p class="sum"><b>3 invitations<\/b> · <b>3 people<\/b><\/p><div class="owner-select">/);
  assert.match(html, /<label class="visually-hidden" for="[^"]+">Show<\/label><select id="[^"]+"[^>]*><option value="everyone" selected="">Everyone · 3<\/option><option value="mine">Mine · 2<\/option><option value="theirs">Partner · 1<\/option><\/select>/);
  assert.equal(html.match(/<select/g)?.length, 1);
  assert.doesNotMatch(html, /class="sides"|class="seg" role|aria-pressed/);
  assert.ok(ascending(order(html, 'aria-label="People"', 'class="people-bar"', 'class="quick-add"', "Family")));
});

test("the guest quick add files the guest under the person adding, and Vendors keep their one-line summary without a filter", async () => {
  assert.match(read("ui/quick-add.tsx"), /\.\.\.\(name === "guest" \? \{ who: me \?\? "a" \} : \{\}\)/);
  assert.doesNotMatch(read("ui/quick-add.tsx"), /<select|data\.get\("who"\)/);
  const html = await people([item({ kind: "vendor", status: "confirmed", title: "Gardenia Hall" })], "vendors");
  assert.match(html, /<div class="people-bar"><p class="sum"><b>1 vendor<\/b> · 1 booked<\/p><\/div>/);
  assert.doesNotMatch(html, /<select/);
});

test("a movie opens as a read view: back link first, Edit and More under the title, no form, no Delete beside Save or Cancel", async () => {
  const row = movie("Midnight Ferry", { status: "watched", done_on: "2026-09-12", who: "a", note: "Seen on a ferry.", data: { year: 2004, original_title: "Veer" } });
  const html = await screens([row], "movie", row.id);
  assert.match(html, /^<p class="trail"><a href="#\/movies">/);
  assert.match(html, /<button type="button" class="secondary" aria-label="Edit Midnight Ferry"><svg[^]*?<\/svg>Edit<\/button>/);
  assert.match(html, /aria-haspopup="menu" aria-expanded="false" aria-label="More actions for Midnight Ferry"/);
  assert.ok(ascending(order(html, "<h1", "Edit Midnight Ferry", "More actions for", "<dt>Notes</dt>", 'id="sc-status"', 'id="sc-ratings"')));
  assert.doesNotMatch(html, />Cancel<|>Delete<|class="danger"|>Edit details<|id="sc-edit"|name="note"/);
  assert.match(html, /Seen on a ferry\./);
  assert.match(html, /type="date"/);
});

test("a book opens as a read view with the facts the form used to hold, and Edit and More replace the form", async () => {
  const wish = item({ kind: "book", status: "wish", title: "Slow Bread", who: "b", amount: 85000, data: { author: "Kiki Amelia", priority: "high", language: "id", shop_url: "https://shop.example.test/slow-bread" } });
  const html = await books([wish], "wishlist", wish.id);
  assert.match(html, /^<p class="trail"><a href="#\/wishlist">/);
  assert.match(html, /aria-label="Edit Slow Bread"/);
  assert.match(html, /aria-label="More actions for Slow Bread"/);
  assert.match(html, /<dl class="nums detail-facts"><div><dt>Language<\/dt><dd>Indonesian<\/dd><\/div>/);
  assert.match(html, /<div><dt>Priority<\/dt><dd>Next up<\/dd><\/div>/);
  assert.match(html, /<dt>Shop link<\/dt><dd><a href="https:\/\/shop\.example\.test\/slow-bread"[^>]*>shop\.<wbr\/>example\.<wbr\/>test<\/a><\/dd>/);
  assert.doesNotMatch(html, /class="form"|>Cancel<|>Delete<|class="danger"|id="bk-edit"|bk-details|bk-dl/);
  const bare = await books([shelved("Salt and Lantern")], "books", "x");
  assert.doesNotMatch(bare, /detail-facts/);
});

test("the new header rows wrap instead of squeezing a word", () => {
  const css = read("views/books.css");
  const rule = (selector: string) => new RegExp(`(?:^|\\n)${selector.replace(/[.>*[\]="():+]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";
  for (const selector of [".lib-head", ".lib-bar"]) assert.match(rule(selector), /flex-wrap:\s*wrap/, selector);
  for (const selector of [".lib-head > button", ".lib-bar > button"]) assert.match(rule(selector), /min-width:\s*0/, selector);
  assert.match(rule(".lib-head h1"), /margin:\s*0/);
  assert.match(rule('.lib-bar > [role="group"]'), /flex:\s*1 1 12rem/);
  assert.match(read("views/people.css"), /\.people-bar\s*\{[^}]*flex-wrap:\s*wrap/);
});

test("the detail screens mount the shared frame with their own delete flow, and the list headers wire Add and the summary", () => {
  assert.match(read("views/screen.tsx"), /flows=\{\{ remove: \(\) => removeScreen\(\{ actions, go: \(hash\) => void \(location\.hash = hash\) \}, row, kind\), restore: revive \}\}/);
  assert.match(read("views/book.tsx"), /flows=\{\{ remove: \(\) => removeBook\(book, open\.copies\), restore: \(\) => restoreBook\(book\) \}\}/);
  assert.match(read("views/screens.tsx"), /onAdd=\{\(\) => setAdding\(true\)\}/);
  assert.match(read("views/books.tsx"), /<Head mode="shelf" shelf=\{shelf\} wishes=\{wishes\} onAdd=\{\(\) => setAdding\(true\)\} \/>/);
  assert.match(read("views/people.tsx"), /<b>\{text\.contacts\.invitations\(visible\.length\)\}<\/b> · <b>\{text\.people\(total\(headcount\(visible\)\)\.people\)\}<\/b>/);
});
