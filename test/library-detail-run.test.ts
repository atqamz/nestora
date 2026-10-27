import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import type { ReactElement } from "react";
import type { ItemRow } from "../shared/tables.ts";
import { overlay } from "../src/ui/overlay.ts";
import { views } from "../src/ui/registry.ts";
import { text } from "../src/ui/text.ts";
import { item } from "./domain-rows.ts";
import { find, mount, textOf } from "./mount.ts";
import { markupOf } from "./render.ts";
import { actions, stage, useSnapshot } from "./render-store.ts";

const load = async (module: string) => {
  let loaded!: Record<string, any>;
  await markupOf(module, (found) => ((loaded = found), createElement("i")));
  return loaded;
};

const { ScreenDetail } = await load("views/screen.tsx");
const { BookDetail } = await load("views/book.tsx");

const stub = actions as Record<string, unknown>;
const snapshot = useSnapshot() as { paused: boolean };

type Call = [string, string, Record<string, unknown>];

const ok = { ok: true as const, id: "x" };

const settle = async () => {
  for (let turn = 0; turn < 8; turn++) await new Promise((resolve) => setImmediate(resolve));
};

const page = { hash: "" };
const doc = { notices: 0, getElementById: (id: string) => ({ focus: () => void (id === "paused-notice" && doc.notices++) }), querySelector: () => null };

const around = (t: { after: (fn: () => void) => void }, paused = false) => {
  const globals = globalThis as Record<string, unknown>;
  globals.location = page;
  globals.document = doc;
  page.hash = "";
  doc.notices = 0;
  snapshot.paused = paused;
  const calls: Call[] = [];
  const removed: string[] = [];
  const many: unknown[] = [];
  Object.assign(stub, {
    update: async (table: string, id: string, change: Record<string, unknown>) => (calls.push([table, id, change]), ok),
    remove: async (table: string, id: string) => (removed.push(`${table}:${id}`), ok),
    many: async (steps: unknown) => (many.push(steps), ok),
    restore: async (id: string) => (calls.push(["restore", id, {}]), ok),
  });
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-27T05:00:00Z") });
  t.after(() => {
    mock.timers.reset();
    snapshot.paused = false;
    delete globals.location;
    delete globals.document;
    overlay.dismissToast();
    for (const key of ["update", "remove", "many", "restore", "create"]) delete stub[key];
    stage([]);
  });
  return { calls, removed, many };
};

const movie = (fields: Partial<ItemRow> = {}) => item({ kind: "movie", status: "watched", done_on: "2026-09-12", title: "Midnight Ferry", ...fields });

const book = (fields: Partial<ItemRow> = {}) => item({ kind: "book", status: "shelf", title: "Slow Bread", ...fields });

const part = (view: { tree: unknown }, name: string) => {
  const element = find(view.tree as never, (_, type) => (type as { name?: string }).name === name)[0];
  assert.ok(element, name);
  return mount<Record<string, any>>(element.type as never, element.props);
};

const frame = (view: { tree: unknown }) => part(view, "ItemDetail");

const screenView = (row: ItemRow, kind = "movie") => (stage([row]), frame(mount<Record<string, any>>(ScreenDetail, { kind, id: row.id })));

const bookView = (row: ItemRow) => (stage([row]), frame(mount<Record<string, any>>(BookDetail, { id: row.id })));

const byLabel = (view: { tree: unknown }, label: string) => find(view.tree as never, (props) => props["aria-label"] === label)[0];

const menuOf = (view: { tree: unknown }) => find(view.tree as never, (props) => Array.isArray(props.items))[0].props.items[0];

const formOf = (view: { tree: unknown }): ReactElement<any> | undefined => find(view.tree as never, (props) => typeof props.sheet === "function")[0];

const press = (view: { tree: unknown }, label: string) => {
  const button = find(view.tree as never, (props) => props.type === "button" && props["aria-pressed"] !== undefined && textOf(props.children) === label)[0];
  assert.ok(button, label);
  return button.props.onClick();
};

test("tapping the pressed Watched on a movie writes nothing and keeps the watched date, tapping Watching clears it", async (t) => {
  const { calls } = around(t);
  const row = movie();
  const view = part(screenView(row), "Status");
  await press(view, text.screen.pick.watched);
  await settle();
  assert.deepEqual(calls, []);
  await press(view, text.screen.pick.watching);
  await settle();
  assert.deepEqual(calls, [["items", row.id, { status: "watching", done_on: null }]]);
});

test("choosing Watched on a movie that is not watched yet stamps today from the clock", async (t) => {
  const { calls } = around(t);
  const row = movie({ status: "want", done_on: null });
  await press(part(screenView(row), "Status"), text.screen.pick.watched);
  await settle();
  assert.deepEqual(calls, [["items", row.id, { status: "watched", done_on: "2026-10-27" }]]);
});

for (const [kind, route] of [["movie", "/movies"], ["series", "/series"]] as const) {
  test(`Delete in More removes the ${kind}, leaves for its list and toasts with Undo that revives it`, async (t) => {
    const { removed, calls } = around(t);
    const row = movie({ kind });
    const view = screenView(row, kind);
    const del = menuOf(view);
    assert.deepEqual([del.id, del.danger, del.icon], ["delete", true, "trash"]);
    del.run();
    await settle();
    assert.deepEqual([removed, page.hash, overlay.getSnapshot().toast?.message], [[`items:${row.id}`], route, `Deleted ${row.title}`]);
    overlay.getSnapshot().toast?.action?.run();
    await settle();
    assert.deepEqual(calls, [["items", row.id, { deleted_at: null }]]);
  });
}

test("Delete on a book takes its copies along and Undo restores the book through the store", async (t) => {
  const { many, calls } = around(t);
  const row = book();
  const copy = item({ kind: "copy", parent_id: row.id, status: "here", title: "Slow Bread" });
  stage([row, copy]);
  const view = frame(mount<Record<string, any>>(BookDetail, { id: row.id }));
  menuOf(view).run();
  await settle();
  assert.deepEqual(many, [[{ op: "delete", table: "items", id: row.id }, { op: "delete", table: "items", id: copy.id }]]);
  assert.deepEqual([page.hash, overlay.getSnapshot().toast?.message], ["/books", text.books.deleted(row.title)]);
  overlay.getSnapshot().toast?.action?.run();
  await settle();
  assert.deepEqual(calls, [["restore", row.id, {}]]);
});

test("Delete on a wishlist book leaves for the wishlist", async (t) => {
  around(t);
  const view = bookView(book({ status: "wish" }));
  menuOf(view).run();
  await settle();
  assert.equal(page.hash, "/wishlist");
});

for (const [name, make] of [["movie", () => screenView(movie())], ["book", () => bookView(book())]] as const) {
  test(`while paused Edit and Delete on a ${name} announce aria-disabled and only move focus to the banner`, async (t) => {
    const { calls, removed, many } = around(t, true);
    const view = make();
    const title = (name === "movie" ? "Midnight Ferry" : "Slow Bread");
    assert.deepEqual([byLabel(view, text.editNamed(title)).props["aria-disabled"], menuOf(view).locked], [true, true]);
    byLabel(view, text.editNamed(title)).props.onClick();
    menuOf(view).run();
    await settle();
    assert.deepEqual([calls, removed, many, formOf(view), doc.notices], [[], [], [], undefined, 2]);
    snapshot.paused = false;
    assert.deepEqual([byLabel(make(), text.editNamed(title)).props["aria-disabled"], menuOf(make()).locked], [undefined, false]);
  });
}

test("Edit on a wish book opens the sheet with every book field, on a shelf book without the wish-only ones, and the list stays the same array", async (t) => {
  around(t);
  const wish = book({ status: "wish" });
  const view = bookView(wish);
  byLabel(view, text.editNamed("Slow Bread")).props.onClick();
  const first = formOf(view)!.props.only;
  assert.deepEqual(first, views.book.fields);
  stage([{ ...wish, status: "shelf" }]);
  view.update({});
  assert.equal(formOf(view)!.props.only, first);
  const shelf = bookView(book());
  byLabel(shelf, text.editNamed("Slow Bread")).props.onClick();
  const only = formOf(shelf)!.props.only as string[];
  for (const field of ["who", "data.priority", "data.gift", "amount", "data.shop", "data.shop_url"]) assert.equal(only.includes(field), false, field);
  assert.ok(only.includes("data.language") && only.includes("note"));
});

test("Edit on a movie opens the sheet with the movie's own fields and Save closes it", async (t) => {
  around(t);
  const view = screenView(movie());
  assert.equal(formOf(view), undefined);
  byLabel(view, text.editNamed("Midnight Ferry")).props.onClick();
  assert.deepEqual(formOf(view)!.props.only, views.movie.fields);
  formOf(view)!.props.sheet();
  assert.equal(formOf(view), undefined);
});

test("a deleted movie or book shows its notice and Undo in the frame, and Undo writes the revive patch or the store restore", async (t) => {
  const { calls } = around(t);
  const row = movie({ data: { cover: "https://image.tmdb.org/t/p/w185/x.jpg", tmdb: 910001, tmdb_at: "2026-10-01" } });
  stage([row]);
  const open = mount<Record<string, any>>(ScreenDetail, { kind: "movie", id: row.id });
  stage([]);
  open.update({});
  const gone = frame(open);
  const undo = find(gone.tree as never, (props) => props.type === "button" && textOf(props.children) === text.undo)[0];
  assert.ok(find(gone.tree as never, (props) => props.role === "status" && textOf(props.children) === text.gone).length > 0);
  await undo.props.onClick();
  await settle();
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0][0], calls[0][1], calls[0][2].deleted_at], ["items", row.id, null]);
});

test("a shop link on a wish book reads as its host and keeps the whole URL as its target", async () => {
  const wish = book({ status: "wish", data: { shop_url: "https://shop.example.test/long/path/slow-bread?ref=1" } });
  stage([wish]);
  const html = await markupOf("views/books.tsx", ({ Books }) => createElement(Books, { route: "wishlist", id: wish.id }));
  const link = /<a href="https:\/\/shop[^>]*>.*?<\/a>/.exec(html)![0];
  assert.match(link, /href="https:\/\/shop\.example\.test\/long\/path\/slow-bread\?ref=1"/);
  assert.match(link, /aria-label="[^"]*shop\.example\.test"/);
  assert.match(link, />shop\.<wbr\/>example\.<wbr\/>test<\/a>$/);
  assert.equal(html.split(">").some((chunk) => chunk.startsWith("https://")), false);
  stage([]);
});

const plain = (html: string) => html.replace(/<link rel="preload"[^>]*\/>/g, "");

const bookHtml = async (row: ItemRow, rows: ItemRow[] = [], route = "books") => {
  stage([row, ...rows]);
  const html = plain(await markupOf("views/books.tsx", ({ Books }) => createElement(Books, { route, id: row.id })));
  stage([]);
  return html;
};

const movieHtml = async (row: ItemRow, kind = "movie") => {
  stage([row]);
  const html = plain(await markupOf("views/screens.tsx", ({ Screens }) => createElement(Screens, { kind, id: row.id })));
  stage([]);
  return html;
};

const factNames = (html: string) => [...html.matchAll(/<dt>([^<]*)<\/dt>/g)].map((match) => match[1]);

test("a shelf book puts its cover, title and the lookup lines in the frame's head and lists only what is not already there", async () => {
  const row = book({ group_key: "Harbor Cycle", note: "Lent.", data: { author: "Ana Lestari", original_title: "Garam", series: "Harbor Cycle", series_no: 2, isbn: "9780306406157", language: "id", rated_elsewhere: "4 of 5", priority: "high", gift: true, shop: "Pasar", shop_url: "https://shop.example.test/x" }, who: "b", amount: 5000 });
  const html = await bookHtml(row);
  assert.match(html, /^<p class="trail"><a href="#\/books"><svg[^]*?<\/svg>Shelf<\/a><\/p><div class="bk-head"><span class="cover"[^>]*>SB<\/span><div class="bk-id"><h1 tabindex="-1">Slow Bread<\/h1><p class="bk-sub">Original title: Garam<\/p><p class="bk-sub">Ana Lestari<\/p><p class="hint">Harbor Cycle #2 · Harbor Cycle · ISBN 9780306406157<\/p><p class="hint">[^<]*4 of 5[^<]*<\/p><\/div><\/div>/);
  assert.deepEqual(factNames(html), ["Language", "Notes"]);
});

test("a wish book lists its wish fields, and the same fields on a book already on the shelf stay out of the list", async () => {
  const data = { author: "Kiki", language: "id", priority: "high", gift: true, shop: "Pasar", shop_url: "https://shop.example.test/x" };
  const wish = await bookHtml(book({ status: "wish", who: "b", amount: 5000, data }), [], "wishlist");
  assert.match(wish, /^<p class="trail"><a href="#\/wishlist"><svg[^]*?<\/svg>Wishlist<\/a><\/p>/);
  assert.equal(factNames(wish).length, 7);
  assert.deepEqual(factNames(await bookHtml(book({ who: "b", amount: 5000, data }))), ["Language"]);
});

test("a book shows its copies and the first-copy button, or the empty line and the add-first button", async () => {
  const row = book();
  const empty = await bookHtml(row);
  assert.match(empty, new RegExp(`<p class="empty">${text.books.noCopy}</p>`));
  assert.match(empty, new RegExp(`${text.books.addFirstCopy}</button>`));
  assert.doesNotMatch(empty, /class="copies"/);
  const full = await bookHtml(row, [item({ kind: "copy", parent_id: row.id, status: "here", title: "Slow Bread" })]);
  assert.match(full, /<ul class="copies">/);
  assert.match(full, new RegExp(`${text.books.addCopy}</button>`));
  assert.doesNotMatch(full, /class="empty"/);
});

test("the blurb gets its own About section, and none without one", async () => {
  assert.match(await bookHtml(book({ data: { blurb: "A quiet story." } })), /<h2 id="bk-about">About<\/h2><p class="bk-text-block">A quiet story\.<\/p>/);
  assert.doesNotMatch(await bookHtml(book()), /bk-about/);
});

test("a movie's head holds its original title, year and owner, and the facts list leaves them out and keeps the note", async () => {
  const html = await movieHtml(movie({ who: "a", note: "Seen.", data: { year: 2004, original_title: "Veer" } }));
  assert.match(html, /^<p class="trail"><a href="#\/movies"><svg[^]*?<\/svg>Movies<\/a><\/p><div class="bk-head"><span class="cover"[^>]*>MF<\/span><div class="bk-id"><h1 tabindex="-1">Midnight Ferry<\/h1><p class="bk-sub">Original title: Veer<\/p><p class="hint facts"><span>2004<\/span>/);
  assert.deepEqual(factNames(html), ["Notes"]);
  assert.match(html, /<span>2004<\/span><span class="who">/);
  const bare = await movieHtml(movie({ data: {} }));
  assert.doesNotMatch(bare, /bk-sub|hint facts/);
  const owner = await movieHtml(movie({ who: "b", data: {} }));
  assert.match(owner, /<p class="hint facts"><span class="who">/);
  assert.doesNotMatch(owner, /<span>\d{4}<\/span>/);
  const year = await movieHtml(movie({ who: "both", data: { year: 1999 } }));
  assert.match(year, /<p class="hint facts"><span>1999<\/span><\/p>/);
  assert.doesNotMatch(year, /class="who"/);
  assert.match(await movieHtml(movie({ kind: "series" }), "series"), /^<p class="trail"><a href="#\/series">[^]*?Series<\/a>/);
});

test("a deleted movie keeps no Remove poster button, and an open one with a poster has it", async (t) => {
  around(t);
  const row = movie({ data: { cover: "https://image.tmdb.org/t/p/w185/x.jpg", tmdb: 910001, tmdb_at: "2026-10-20" } });
  const removal = (view: { tree: unknown }) => find(view.tree as never, (_, type) => (type as { name?: string }).name === "PosterRemoval").length;
  stage([row]);
  const live = mount<Record<string, any>>(ScreenDetail, { kind: "movie", id: row.id });
  assert.equal(removal(live), 1);
  stage([]);
  live.update({});
  assert.equal(removal(live), 0);
});

test("a refused Got it shows the error in an alert and keeps focus where it is, a done one moves focus to the title", async (t) => {
  const { calls } = around(t);
  const focused: unknown[] = [];
  doc.querySelector = (() => ({ focus: (options: unknown) => focused.push(options) })) as never;
  t.after(() => void (doc.querySelector = () => null));
  const row = book({ status: "wish" });
  stage([row]);
  const live = mount<Record<string, any>>(BookDetail, { id: row.id });
  const got = find(live.tree as never, (props) => props.className === "got")[0];
  stub.create = async () => ok;
  stub.update = async () => ({ ok: false, errors: ["Not now."] });
  await got.props.onClick();
  await settle();
  assert.deepEqual(find(live.tree as never, (props) => props.role === "alert").map((element) => textOf(element.props.children)), ["Not now."]);
  assert.deepEqual(focused, []);
  stub.update = async (table: string, id: string, change: Record<string, unknown>) => (calls.push([table, id, change]), ok);
  await find(live.tree as never, (props) => props.className === "got")[0].props.onClick();
  await settle();
  assert.deepEqual(focused, [{ preventScroll: true }]);
});
