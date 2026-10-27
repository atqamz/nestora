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
    for (const key of ["update", "remove", "many", "restore"]) delete stub[key];
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
    assert.deepEqual([removed, page.hash, overlay.getSnapshot().toast?.message], [[`items:${row.id}`], route, `Deleted: ${row.title}`]);
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
  const link = /<a href="https:\/\/shop[^>]*>[^<]*<\/a>/.exec(html)![0];
  assert.match(link, /href="https:\/\/shop\.example\.test\/long\/path\/slow-bread\?ref=1"/);
  assert.match(link, /aria-label="[^"]*shop\.example\.test"/);
  assert.match(link, />shop\.example\.test<\/a>$/);
  assert.equal(html.split(">").some((chunk) => chunk.startsWith("https://")), false);
  stage([]);
});
