import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import type { ReactElement } from "react";
import type { BudgetEntryRow, ItemRow } from "../shared/tables.ts";
import { overlay } from "../src/ui/overlay.ts";
import { sheetFields } from "../src/ui/item-flows.ts";
import { text } from "../src/ui/text.ts";
import { entry, item, payment } from "./domain-rows.ts";
import { find, mount, textOf } from "./mount.ts";
import { markupOf } from "./render.ts";
import { actions, useSnapshot } from "./render-store.ts";
import { client, idOf, task } from "./store-client.ts";
import { createServer } from "./store-server.ts";

const load = async (module: string) => {
  let loaded!: Record<string, any>;
  await markupOf(module, (found) => ((loaded = found), createElement("i")));
  return loaded;
};

const { ItemDetail } = await load("ui/item-detail.tsx");

const stub = actions as Record<string, unknown>;
const snapshot = useSnapshot() as { paused: boolean };

type Call = [string, string, Record<string, unknown>];

const ok = { ok: true as const, id: "x" };

const settle = async () => {
  for (let turn = 0; turn < 8; turn++) await new Promise((resolve) => setImmediate(resolve));
};

const fake = (result: unknown = ok) => {
  const calls: Call[] = [];
  const removed: string[] = [];
  stub.update = async (table: string, id: string, change: Record<string, unknown>) => (calls.push([table, id, change]), result);
  stub.remove = async (table: string, id: string) => (removed.push(`${table}:${id}`), result);
  return { calls, removed };
};

const page = { hash: "" };
const doc = {};

let announced!: { mock: { callCount: () => number; restore: () => void } };

const around = (t: { after: (fn: () => void) => void }, paused = false) => {
  const globals = globalThis as Record<string, unknown>;
  globals.location = page;
  globals.document = doc;
  page.hash = "";
  announced = mock.method(overlay, "announce");
  snapshot.paused = paused;
  mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-27T05:00:00Z") });
  t.after(() => {
    mock.timers.reset();
    announced.mock.restore();
    snapshot.paused = false;
    delete globals.location;
    delete globals.document;
    overlay.dismissToast();
    for (const key of ["update", "remove"]) delete stub[key];
  });
};

const open = (name: string, row: ItemRow | BudgetEntryRow, over: Record<string, unknown> = {}) =>
  mount<Record<string, any>>(ItemDetail, { name, row, gone: false, back: { href: "#/tasks", word: "Tasks" }, ...over });

const instant = (name: string, row: ItemRow | BudgetEntryRow) => {
  const element = find(open(name, row).tree, (_, type) => (type as { name?: string }).name === "Instant")[0];
  return mount<Record<string, any>>(element.type as never, element.props);
};

const press = (view: { tree: unknown }, label: string) => {
  const button = find(view.tree as never, (props) => props.type === "button" && props["aria-pressed"] !== undefined && textOf(props.children) === label)[0];
  assert.ok(button, label);
  return button.props.onClick();
};

const pressed = (view: { tree: unknown }) => find(view.tree as never, (props) => props["aria-pressed"] === true).map((element) => textOf(element.props.children));

const byLabel = (view: { tree: unknown }, label: string) => find(view.tree as never, (props) => props["aria-label"] === label)[0];

const menuOf = (view: { tree: unknown }) => find(view.tree as never, (props) => Array.isArray(props.items))[0].props.items[0];

const formOf = (view: { tree: unknown }): ReactElement<any> | undefined => find(view.tree as never, (props) => typeof props.sheet === "function")[0];

const done = (kind: string, over: Record<string, unknown>) => (kind === "task" ? item({ title: "Confirm the tasting menu", ...over }) : payment(entry({ id: "line-1" }), { title: "Deposit", ...over }));

for (const [name, kind, table, now, pick, other] of [
  ["task", "task", "items", "done", "Done", "To do"],
  ["payment", "payment", "budget_entries", "paid", "Paid", "Due"],
] as const) {
  test(`tapping the pressed ${pick} on a ${name} writes nothing and keeps done_on, tapping the other choice writes the status and clears it`, async (t) => {
    around(t);
    const { calls } = fake();
    const view = instant(name, done(kind, { status: now, done_on: "2026-10-05" }) as never);
    assert.deepEqual(pressed(view).slice(0, 1), [pick]);
    await press(view, pick);
    await settle();
    assert.deepEqual(calls, []);
    const row = done(kind, { status: now, done_on: "2026-10-05" });
    const again = instant(name, row as never);
    await press(again, other);
    await settle();
    assert.deepEqual(calls, [[table, row.id, { status: name === "task" ? "todo" : "due", done_on: null }]]);
  });

  test(`choosing ${pick} on an open ${name} writes to ${table} with today's date from the clock`, async (t) => {
    around(t);
    const { calls } = fake();
    const row = done(kind, { status: name === "task" ? "todo" : "due", done_on: null });
    await press(instant(name, row as never), pick);
    await settle();
    assert.deepEqual(calls, [[table, row.id, { status: now, done_on: "2026-10-27" }]]);
  });

  test(`on the real store, tapping the pressed ${pick} of a ${name} keeps done_on and the revision on both devices`, async (t) => {
    around(t);
    const server = createServer();
    const a = client(server, "a");
    const b = client(server, "b");
    await a.store.open();
    await b.store.open();
    const table = name === "task" ? "items" : "budget_entries";
    const line = idOf(await a.store.create("budget_entries", { entry_type: "planned", title: "Venue", group_key: "reception", amount: 1000 }));
    const id =
      name === "task"
        ? idOf(await a.store.create("items", { ...task("Confirm the tasting menu"), status: "done", done_on: "2026-10-05" }))
        : idOf(await a.store.create("budget_entries", { entry_type: "payment", title: "Deposit", budget_id: line, status: "paid", done_on: "2026-10-05", amount: 500 }));
    await a.store.sync();
    await b.store.sync();
    Object.assign(stub, { update: a.store.update, remove: a.store.remove });
    const rowOf = () => (a.store.getSnapshot().rows[table] as { id: string; rev: number; done_on: string | null }[]).find((row) => row.id === id)!;
    const before = rowOf();
    await press(instant(name, before as never), pick);
    await settle();
    await a.store.sync();
    await b.store.sync();
    const stored = server.rows(table).find((row) => row.id === id) as { rev: number; done_on: string };
    assert.deepEqual([rowOf().done_on, rowOf().rev, stored.done_on, stored.rev], ["2026-10-05", before.rev, "2026-10-05", before.rev]);
    const theirs = (b.store.getSnapshot().rows[table] as { id: string; rev: number; done_on: string | null }[]).find((row) => row.id === id)!;
    assert.deepEqual([theirs.done_on, theirs.rev], ["2026-10-05", before.rev]);
  });
}

test("the owner row writes who, with null for nobody, and a tap on the pressed owner writes nothing", async (t) => {
  around(t);
  const { calls } = fake();
  const row = item({ title: "Pick the music", who: "a" });
  const view = instant("task", row);
  for (const label of [text.nobody, "Partner", "You"]) {
    await press(view, label);
    await settle();
  }
  assert.deepEqual(calls, [["items", row.id, { who: null }], ["items", row.id, { who: "b" }]]);
});

test("a guest has a status choice only, written without a done date", async (t) => {
  around(t);
  const { calls } = fake();
  const row = item({ kind: "guest", title: "Aunt Rina", status: "todo" });
  await press(instant("guest", row), "Invited");
  await settle();
  assert.deepEqual(calls, [["items", row.id, { status: "sent" }]]);
});

test("a refused instant write shows its errors in an alert under the choices", async (t) => {
  around(t);
  fake({ ok: false, errors: ["Title is too long."] });
  const view = instant("task", item({ title: "Pick the music", status: "todo" }));
  assert.equal(find(view.tree as never, (props) => props.role === "alert").length, 0);
  await press(view, "Done");
  await settle();
  const alert = find(view.tree as never, (props) => props.role === "alert");
  assert.deepEqual(alert.map((element) => textOf(element.props.children)), ["Title is too long."]);
});

test("while paused a tap on a choice, on Edit or on Delete only announces the pause and writes nothing", async (t) => {
  around(t, true);
  const { calls, removed } = fake();
  const view = open("task", item({ title: "Pick the music", status: "todo", who: "a" }));
  await press(instant("task", item({ title: "Pick the music", status: "todo" })), "Done");
  byLabel(view, text.editNamed("Pick the music")).props.onClick();
  menuOf(view).run();
  await settle();
  assert.deepEqual([calls, removed, formOf(view), announced.mock.callCount(), overlay.getSnapshot().toast?.message], [[], [], undefined, 3, text.paused]);
});

test("while paused Edit and the Delete menu item announce aria-disabled, live they carry none", async (t) => {
  around(t, true);
  fake();
  const row = item({ title: "Pick the music" });
  const edit = () => byLabel(open("task", row), text.editNamed("Pick the music")).props["aria-disabled"];
  const del = () => menuOf(open("task", row)).locked;
  assert.deepEqual([edit(), del()], [true, true]);
  snapshot.paused = false;
  assert.deepEqual([edit(), del()], [undefined, false]);
});

test("a menu item marked locked renders aria-disabled and stays a live menuitem, an unmarked one carries none", async (t) => {
  around(t);
  const { Menu } = await load("ui/menu.tsx");
  const globals = globalThis as Record<string, unknown>;
  Object.assign(globals, { getComputedStyle: () => ({ fontSize: "16px" }), innerWidth: 390, innerHeight: 800, addEventListener: () => undefined, removeEventListener: () => undefined });
  Object.assign(doc, { documentElement: {} });
  t.after(() => {
    for (const key of ["getComputedStyle", "innerWidth", "innerHeight", "addEventListener", "removeEventListener"]) delete globals[key];
  });
  const run = () => undefined;
  const view = mount<Record<string, any>>(Menu, {
    name: "More actions for Pick the music",
    items: [
      { id: "delete", icon: "trash", label: "Delete", danger: true, locked: true, run },
      { id: "copy", icon: "copy", label: "Copy", run },
    ],
  });
  const more = find(view.tree as never, (props) => props["aria-haspopup"] === "menu")[0];
  more.props.ref.current.getBoundingClientRect = () => ({ top: 10, bottom: 50, right: 380 });
  more.props.onClick();
  const entries = find(view.tree as never, (props) => props.role === "menuitem");
  assert.deepEqual(entries.map((entry) => [textOf(entry.props.children), entry.props["aria-disabled"]]), [["Delete", true], ["Copy", undefined]]);
});

test("Edit opens the sheet with the page's own fields and Save closes it", async (t) => {
  around(t);
  fake();
  const row = item({ title: "Pick the music" });
  const view = open("task", row);
  assert.equal(formOf(view), undefined);
  byLabel(view, text.editNamed("Pick the music")).props.onClick();
  const form = formOf(view)!;
  assert.deepEqual(form.props.only, sheetFields("task"));
  form.props.sheet();
  assert.equal(formOf(view), undefined);
});

test("the sheet's field list is the same array on every render, even when the row changes", async (t) => {
  around(t);
  const row = item({ title: "Pick the music" });
  const view = open("task", row);
  byLabel(view, text.editNamed("Pick the music")).props.onClick();
  const first = formOf(view)!.props.only;
  view.update({ row: { ...row, note: "ask the band" } });
  assert.equal(formOf(view)!.props.only, first);
});

test("Delete removes the row from its table, leaves for the list and toasts Deleted with Undo", async (t) => {
  around(t);
  const { removed } = fake();
  const row = item({ title: "Pick the music" });
  const view = open("task", row);
  assert.equal(menuOf(view).danger, true);
  assert.equal(find(view.tree as never, (props) => props.role === "alert").length, 0);
  menuOf(view).run();
  await settle();
  assert.deepEqual([removed, page.hash, overlay.getSnapshot().toast?.message], [[`items:${row.id}`], "#/tasks", "Deleted Pick the music"]);
});

test("a refused Delete stays on the page and shows its errors in an alert", async (t) => {
  around(t);
  fake({ ok: false, errors: ["Not now."] });
  const view = open("task", item({ title: "Pick the music" }));
  menuOf(view).run();
  await settle();
  const alert = find(view.tree as never, (props) => props.role === "alert");
  assert.deepEqual([page.hash, alert.map((element) => textOf(element.props.children)), overlay.getSnapshot().toast], ["", ["Not now."], null]);
});

test("the page does not take focus when it opens, and moves focus to Edit only after Undo brings a deleted row back", async (t) => {
  around(t);
  const { calls } = fake();
  const row = item({ title: "Pick the music" });
  const live = open("task", row);
  assert.equal(live.focusLog.length, 0);
  const gone = open("task", row, { gone: true });
  assert.equal(gone.focusLog.length, 0);
  const undo = find(gone.tree as never, (props) => props.type === "button" && textOf(props.children) === text.undo)[0];
  await undo.props.onClick();
  await settle();
  assert.deepEqual(calls, [["items", row.id, { deleted_at: null }]]);
  gone.update({ gone: false });
  assert.equal(gone.focusLog.length, 1);
  assert.equal(gone.focusLog[0].element.props["aria-label"], text.editNamed("Pick the music"));
  gone.update({ gone: true });
  gone.update({ gone: false });
  assert.equal(gone.focusLog.length, 1);
});

test("a refused Undo does not queue a focus move for the next time the row comes back", async (t) => {
  around(t);
  fake({ ok: false, errors: ["No."] });
  const row = item({ title: "Pick the music" });
  const gone = open("task", row, { gone: true });
  await find(gone.tree as never, (props) => props.type === "button" && textOf(props.children) === text.undo)[0].props.onClick();
  await settle();
  gone.update({ gone: false });
  assert.equal(gone.focusLog.length, 0);
});

const detailPage = (name: string, row: ItemRow | BudgetEntryRow) =>
  markupOf("ui/item-detail.tsx", ({ ItemDetail: Detail }) => createElement(Detail, { name, row, gone: false, back: { href: "#/tasks", word: "Tasks" } }));

test("the read view lists a note on its own full line, leaves a short fact in the row, and draws no list for a row with nothing to list", async () => {
  const html = await detailPage("task", item({ title: "Pick the music", note: "ask the band", due_on: "2026-11-20" }));
  assert.equal(html.match(/<div data-long="true">/g)?.length, 1);
  assert.match(html, /<div data-long="true"><dt>Note<\/dt>/);
  assert.match(html, /<div><dt>Due date<\/dt>/);
  assert.equal((await detailPage("task", item({ title: "Pick the music" }))).includes("detail-facts"), false);
});

const vendorPage = (data: Record<string, unknown>) =>
  markupOf("ui/item-detail.tsx", ({ ItemDetail: Detail }) =>
    createElement(Detail, { name: "vendor", row: item({ kind: "vendor", title: "Studio", status: "todo", data }), gone: false, back: { href: "#/vendors", word: "Vendors" } }),
  );

test("a contract link reads as its host, keeps the whole URL as its target and names itself with the host", async () => {
  const url = "https://files.example.com/contracts/2026/studio-agreement-final-signed-copy.pdf?download=1";
  const html = await vendorPage({ contract_url: url });
  const link = /<a href="https:[^>]*>.*?<\/a>/.exec(html)![0];
  assert.match(link, /href="https:\/\/files\.example\.com\/contracts\/2026\/studio-agreement-final-signed-copy\.pdf\?download=1"/);
  assert.match(link, /aria-label="[^"]*files\.example\.com"/);
  assert.match(link, />files\.<wbr\/>example\.<wbr\/>com<\/a>$/);
  assert.equal(html.split(">").some((chunk) => chunk.startsWith("https://")), false);
});

test("a value that only looks like a web address stays plain text, whole", async () => {
  const html = await vendorPage({ contract_url: "http://" });
  assert.equal(html.includes('href="http://"'), false);
  assert.match(html, /<dd>http:\/\/<\/dd>/);
});
