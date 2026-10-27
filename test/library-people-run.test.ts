import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import type { ReactElement } from "react";
import type { ItemRow } from "../shared/tables.ts";
import { text } from "../src/ui/text.ts";
import { cascade, sheet } from "./css.ts";
import { item } from "./domain-rows.ts";
import { find, mount, textOf } from "./mount.ts";
import { markupOf } from "./render.ts";
import { actions, stage, useSnapshot } from "./render-store.ts";

const load = async (module: string) => {
  let loaded!: Record<string, any>;
  await markupOf(module, (found) => ((loaded = found), createElement("i")));
  return loaded;
};

const { Books } = await load("views/books.tsx");
const { Screens } = await load("views/screens.tsx");
const { People } = await load("views/people.tsx");
const { QuickAdd } = await load("ui/quick-add.tsx");
const { ListHead } = await load("ui/list-head.tsx");
const { OwnerSelect } = await load("ui/owner-select.tsx");

const stub = actions as Record<string, unknown>;
const snapshot = useSnapshot() as { me: string | null };

const settle = async () => {
  for (let turn = 0; turn < 8; turn++) await new Promise((resolve) => setImmediate(resolve));
};

const named = (view: { tree: unknown }, name: string) => find(view.tree as never, (_, type) => (type as { name?: string }).name === name);

const part = (view: { tree: unknown }, name: string) => {
  const element = named(view, name)[0];
  assert.ok(element, name);
  return mount<Record<string, any>>(element.type as never, element.props);
};

const guest = (title: string, who: "a" | "b" | "both" | null, qty = 1) => item({ kind: "guest", status: "todo", title, who, qty, group_key: "Family" });

const around = (t: { after: (fn: () => void) => void }, me: string | null = "a") => {
  snapshot.me = me;
  t.after(() => {
    snapshot.me = "a";
    delete stub.create;
    delete (globalThis as Record<string, unknown>).FormData;
    stage([]);
  });
};

const people = (props: Record<string, unknown>) => {
  const view = mount<Record<string, any>>(People, props);
  return {
    update: view.update,
    get tree() {
      return view.tree;
    },
    get inside() {
      return { tree: named(view, "Split")[0].props.list };
    },
  };
};

type Page = ReturnType<typeof people>;

const owners = (view: Page) => named(view.inside, "OwnerSelect")[0].props;

const shown = (view: Page) => owners(view).value;

const pick = (view: Page, owner: string) => owners(view).onChange(owner);

test("the list head button calls onAdd when pressed", () => {
  const calls: string[] = [];
  const head = mount<Record<string, any>>(ListHead, { title: "Movies", add: "Add a movie", onAdd: () => calls.push("add") });
  const button = find(head.tree as never, (props) => props.type === "button")[0];
  button.props.onClick();
  assert.deepEqual(calls, ["add"]);
});

const lists = [
  ["Books", () => part(mount<Record<string, any>>(Books, { route: "books" }), "Shelf"), text.books.add, "BookSheet", "shelf"],
  ["Wishlist", () => part(mount<Record<string, any>>(Books, { route: "wishlist" }), "Wishlist"), text.books.addWish, "BookSheet", "wish"],
  ["Movies", () => part(mount<Record<string, any>>(Screens, { kind: "movie" }), "ScreenList"), text.movies.add, "ScreenSheet", "movie"],
  ["Series", () => part(mount<Record<string, any>>(Screens, { kind: "series" }), "ScreenList"), text.series.add, "ScreenSheet", "series"],
] as const;

for (const [name, open, label, sheet, kind] of lists) {
  test(`${name}: the Add button carries its own label and opens the add sheet`, (t) => {
    around(t);
    stage([]);
    const list = open();
    const head = named(list, "ListHead")[0] ?? named(list, "Head")[0];
    assert.ok(head, name);
    assert.equal(named(list, sheet).length, 0);
    const button = name === "Books" || name === "Wishlist" ? find(mount<Record<string, any>>(head.type as never, head.props).tree as never, (props) => props.title === text.books.title)[0] : head;
    assert.equal(button.props.add, label);
    head.props.onAdd();
    assert.equal(named(list, sheet).length, 1);
    assert.equal(named(list, sheet)[0].props.kind, kind);
    named(list, sheet)[0].props.onClose();
    assert.equal(named(list, sheet).length, 0);
  });
}

test("Show: no select without a signed-in side, and Mine and Partner count the rows they own", (t) => {
  around(t, null);
  const alone = mount<Record<string, any>>(OwnerSelect, { value: "everyone", onChange: () => undefined, owners: ["a"] });
  assert.equal(alone.tree, null);
  snapshot.me = "a";
  const picked: string[] = [];
  const select = mount<Record<string, any>>(OwnerSelect, { value: "everyone", onChange: (owner: string) => picked.push(owner), owners: ["a", "a", "b", "both", null] });
  const options = find(select.tree as never, (_, type) => type === "option");
  assert.deepEqual(options.map((option) => [option.props.value, textOf(option.props.children)]), [
    ["everyone", `${text.owner.everyone} · 5`],
    ["mine", `${text.owner.mine} · 3`],
    ["theirs", `Partner · 2`],
  ]);
  const control = find(select.tree as never, (_, type) => type === "select")[0];
  control.props.onChange({ target: { value: "mine" } });
  control.props.onChange({ target: { value: "theirs" } });
  assert.deepEqual(picked, ["mine", "theirs"]);
});

test("Show counts every guest, not only the visible ones, and the summary counts the visible ones", (t) => {
  around(t);
  stage([guest("Rina", "a", 2), guest("Tono", "b", 1), guest("Umi", "a", 1)]);
  const view = people({ route: "guests" });
  assert.equal(owners(view).owners.length, 3);
  pick(view, "theirs");
  assert.equal(shown(view), "theirs");
  assert.deepEqual(owners(view).owners, ["a", "b", "a"]);
  const sum = find(view.inside.tree as never, (props) => props.className === "sum")[0];
  assert.match(textOf(sum.props.children), /^1 invitation · 1 person$/);
});

test("the Guests bar is missing on an empty list and shown with one guest", (t) => {
  around(t);
  stage([]);
  const view = people({ route: "guests" });
  assert.equal(find(view.inside.tree as never, (props) => props.className === "people-bar").length, 0);
  stage([guest("Rina", "a")]);
  view.update({});
  assert.equal(find(view.inside.tree as never, (props) => props.className === "people-bar").length, 1);
  stage([item({ kind: "vendor", status: "option", title: "Gardenia Hall" })]);
  const vendors = people({ route: "vendors" });
  assert.equal(find(vendors.inside.tree as never, (props) => props.className === "people-bar").length, 1);
});

test("a guest added while Show is on the other partner puts Show back on Everyone, and one added in view leaves Show alone", (t) => {
  around(t);
  stage([guest("Rina", "a"), guest("Tono", "b")]);
  const view = people({ route: "guests" });
  pick(view, "mine");
  named(view.inside, "QuickAdd")[0].props.onAdded();
  assert.equal(shown(view), "mine");
  pick(view, "theirs");
  named(view.inside, "QuickAdd")[0].props.onAdded();
  assert.equal(shown(view), "everyone");
  pick(view, "theirs");
  snapshot.me = null;
  view.update({});
  named(view.inside, "QuickAdd")[0].props.onAdded();
  assert.equal(shown(view), "theirs");
});

test("for the second partner, Show on the first partner resets after an add and Show on Mine stays", (t) => {
  around(t, "b");
  stage([guest("Rina", "a"), guest("Tono", "b")]);
  const view = people({ route: "guests" });
  pick(view, "mine");
  named(view.inside, "QuickAdd")[0].props.onAdded();
  assert.equal(shown(view), "mine");
  pick(view, "theirs");
  named(view.inside, "QuickAdd")[0].props.onAdded();
  assert.equal(shown(view), "everyone");
});

const submit = async (view: { tree: unknown }, title: string) => {
  (globalThis as Record<string, unknown>).FormData = class {
    form: Record<string, string>;
    constructor(form: Record<string, string>) {
      this.form = form;
    }
    get(name: string) {
      return this.form[name] ?? null;
    }
  };
  const form = find(view.tree as never, (props) => props.className === "quick-add")[0] as ReactElement<any>;
  const reset: string[] = [];
  await form.props.onSubmit({ preventDefault: () => undefined, currentTarget: { title, reset: () => reset.push("reset") } });
  await settle();
  return reset;
};

test("the quick add files a guest under the person adding, resets the form and tells the list, and a failed or empty add does neither", async (t) => {
  around(t, "b");
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-27T05:00:00Z") });
  t.after(() => mock.timers.reset());
  const created: Record<string, unknown>[] = [];
  let ok = true;
  stub.create = async (_: string, row: Record<string, unknown>) => (created.push(row), ok ? { ok: true, id: "x" } : { ok: false, errors: ["No."] });
  stage([]);
  let added = 0;
  const view = mount<Record<string, any>>(QuickAdd, { name: "guest", onAdded: () => added++ });
  assert.deepEqual(await submit(view, "   "), []);
  assert.deepEqual([created.length, added], [0, 0]);
  assert.deepEqual(await submit(view, " Rina "), ["reset"]);
  assert.deepEqual([created.length, created[0].who, created[0].title, created[0].kind, added], [1, "b", "Rina", "guest", 1]);
  ok = false;
  assert.deepEqual(await submit(view, "Tono"), []);
  assert.equal(added, 1);
  assert.deepEqual(find(view.tree as never, (props) => props.role === "alert").map((element) => textOf(element.props.children)), ["No."]);
  snapshot.me = null;
  view.update({});
  ok = true;
  await submit(view, "Umi");
  assert.equal(created[2].who, "a");
});

test("the quick add button is off while an add is in flight", async (t) => {
  around(t);
  let finish!: (value: unknown) => void;
  stub.create = () => new Promise((resolve) => (finish = resolve));
  const view = mount<Record<string, any>>(QuickAdd, { name: "guest" });
  const button = () => find(view.tree as never, (props) => props.type === "submit")[0].props.disabled;
  assert.equal(button(), false);
  const pending = submit(view, "Rina");
  await settle();
  assert.equal(button(), true);
  finish({ ok: true, id: "x" });
  await pending;
  assert.equal(button(), false);
});

test("a vendor quick add carries no side", async (t) => {
  around(t);
  const created: Record<string, unknown>[] = [];
  stub.create = async (_: string, row: Record<string, unknown>) => (created.push(row), { ok: true, id: "x" });
  const view = mount<Record<string, any>>(QuickAdd, { name: "vendor" });
  await submit(view, "Gardenia Hall");
  assert.equal("who" in created[0], false);
});

const rules = ["ui/ui.css", "views/books.css", "views/people.css"].flatMap(sheet);

test("the new header rows keep their own spacing and let the Guests summary and the select share a line", () => {
  const declared = (selector: string, expected: Record<string, string>) => {
    const final = cascade(rules, selector, 40);
    for (const [property, value] of Object.entries(expected)) assert.equal(final.get(property), value, `${selector} ${property}`);
  };
  declared(".lib-find + section > h2:first-child", { "margin-top": "var(--s4)" });
  declared(".fill-page", { margin: "0 0 var(--s4)" });
  declared(".owner-select", { flex: "0 1 auto", "min-width": "0", "max-width": "100%" });
  declared(".owner-select select", { width: "auto", "max-width": "100%" });
  declared(".people-bar > p", { flex: "1 1 auto" });
});

test("a shop or contract link host breaks at its dots and splits a label only as the last resort", async () => {
  const final = cascade(rules, ".detail-facts a", 10);
  assert.equal(final.get("overflow-wrap"), "break-word");
  assert.equal(cascade(rules, ".nums dd", 10).get("overflow-wrap"), "anywhere");
  const wish = item({ kind: "book", status: "wish", title: "Slow Bread", data: { shop_url: "https://very-long.books.example.com:8443/x" } });
  stage([wish]);
  const html = await markupOf("views/books.tsx", ({ Books }) => createElement(Books, { route: "wishlist", id: wish.id }));
  assert.match(html, />very-long\.<wbr\/>books\.<wbr\/>example\.<wbr\/>com:8443<\/a>/);
  stage([]);
});
