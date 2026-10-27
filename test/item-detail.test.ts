import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import type { BudgetEntryRow, ItemRow } from "../shared/tables.ts";
import { factsOf } from "../src/ui/item-facts.ts";
import { backHref, instantChange, instantFields, removeItem, restoreItem, sheetFields } from "../src/ui/item-flows.ts";
import { overlay } from "../src/ui/overlay.ts";
import { views } from "../src/ui/registry.ts";
import type { ViewName } from "../src/ui/registry.ts";
import { text } from "../src/ui/text.ts";
import { entry, item, payment } from "./domain-rows.ts";
import { markupOf } from "./render.ts";
import { cascade, sheet } from "./css.ts";
import { client, idOf, task } from "./store-client.ts";
import { createServer } from "./store-server.ts";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const side = (who: string) => (who === "a" ? "Aca" : who === "b" ? "Atqa" : "Both");

test("status is instant on every Marriage item, and the owner only where the registry says the item is assignable", () => {
  assert.deepEqual(instantFields("task"), ["status", "who"]);
  for (const name of ["payment", "guest", "vendor"] as const) assert.deepEqual(instantFields(name), ["status"]);
  assert.deepEqual(instantFields("planned"), []);
});

test("the edit sheet holds the fields the page does not already save on tap", () => {
  assert.deepEqual(sheetFields("task"), ["due_on", "group_key", "amount", "note", "data.decision"]);
  assert.deepEqual(sheetFields("guest"), ["who", "qty", "group_key", "data.phone"]);
  assert.deepEqual(sheetFields("planned"), ["group_key", "amount"]);
  for (const name of ["task", "payment", "guest", "vendor", "planned"] as const) for (const field of instantFields(name)) assert.equal(sheetFields(name).includes(field), false, `${name} ${field}`);
});

test("an instant change stamps the done date when the status is the view's done status, clears it otherwise, and writes the owner as null for nobody", () => {
  assert.deepEqual(instantChange("task", "status", "done", "2026-10-27"), { status: "done", done_on: "2026-10-27" });
  assert.deepEqual(instantChange("task", "status", "todo", "2026-10-27"), { status: "todo", done_on: null });
  assert.deepEqual(instantChange("payment", "status", "paid", "2026-10-27"), { status: "paid", done_on: "2026-10-27" });
  assert.deepEqual(instantChange("payment", "status", "due", "2026-10-27"), { status: "due", done_on: null });
  assert.deepEqual(instantChange("guest", "status", "sent", "2026-10-27"), { status: "sent" });
  assert.deepEqual(instantChange("task", "who", "", "2026-10-27"), { who: null });
  assert.deepEqual(instantChange("task", "who", "b", "2026-10-27"), { who: "b" });
});

test("the back link goes to the list the item belongs to, a payment to its budget line", () => {
  assert.equal(backHref("task", item({})), "#/tasks");
  assert.equal(backHref("guest", item({ kind: "guest" })), "#/guests");
  assert.equal(backHref("payment", payment(entry({ id: "line-1" }), {})), "#/money/line-1");
  assert.equal(backHref("planned", entry({})), "#/money");
  assert.equal(backHref("book", item({ kind: "book", status: "wish" })), "#/wishlist");
});

test("the read view lists only what is set, formats it, and leaves out what the page shows elsewhere", () => {
  const row = item({ title: "Photographer", who: "a", due_on: "2026-11-20", group_key: "Planning", amount: 1500000, note: "Second shooter", data: { decision: true, rules: "" } });
  const facts = factsOf("task", row, ["status", "who"], side);
  assert.deepEqual(
    facts.map((fact) => [fact.field, fact.label, fact.kind]),
    [["due_on", "Due date", "text"], ["group_key", "Phase", "text"], ["amount", "Amount", "money"], ["note", "Note", "long"], ["data.decision", "Needs a decision", "text"]],
  );
  assert.equal(facts[0].value, "20 Nov 2026");
  assert.equal(facts[2].value, 1500000);
  assert.equal(facts[4].value, text.yes);
  assert.deepEqual(factsOf("task", item({}), ["status", "who"], side), []);
  assert.deepEqual(factsOf("task", item({ data: { decision: false } }), ["status"], side), []);
});

test("a guest's side shows as the partner's name, and a link is a link only when it is web", () => {
  assert.deepEqual(factsOf("guest", item({ kind: "guest", who: "b", qty: 2 }), ["status"], side).map((fact) => [fact.label, fact.value]), [["Side", "Atqa"], ["People", "2"]]);
  const vendor = (url: string) => factsOf("vendor", item({ kind: "vendor", data: { contract_url: url, facts: "Pays in cash" } }), ["status"], side);
  assert.deepEqual(vendor("https://example.com/c").map((fact) => fact.kind), ["link", "long"]);
  assert.deepEqual(vendor("javascript:alert(1)").map((fact) => fact.kind), ["text", "long"]);
});

const pair = async () => {
  const server = createServer();
  const a = client(server, "a");
  const b = client(server, "b");
  await a.store.open();
  await b.store.open();
  return { server, a, b };
};

const rowsOf = (store: ReturnType<typeof client>["store"], table: "items" | "budget_entries") => store.getSnapshot().rows[table] as (ItemRow | BudgetEntryRow)[];

const stored = (server: ReturnType<typeof createServer>, table: "items" | "budget_entries", id: string) => server.rows(table).find((row) => row.id === id) as { deleted_at: string | null };

for (const [name, table] of [["task", "items"], ["payment", "budget_entries"]] as const) {
  test(`deleting a ${name} leaves for its list with "Deleted <title>" and a 12 s Undo that brings it back for both partners`, async (t) => {
    t.after(() => overlay.dismissToast());
    const { server, a, b } = await pair();
    const line = idOf(await a.store.create("budget_entries", { entry_type: "planned", title: "Venue", group_key: "reception", amount: 1000 }));
    const id = name === "task" ? idOf(await a.store.create("items", task("Pick the music"))) : idOf(await a.store.create("budget_entries", { entry_type: "payment", title: "Deposit", budget_id: line, status: "due", amount: 500 }));
    await a.store.sync();
    await b.store.sync();
    const row = rowsOf(a.store, table).find((candidate) => candidate.id === id)!;
    const went: string[] = [];
    const removed = await removeItem({ actions: a.store, go: (hash) => void went.push(hash) }, name, row);
    assert.equal(removed.ok, true);
    assert.deepEqual(went, [name === "task" ? "#/tasks" : `#/money/${line}`]);
    const toast = overlay.getSnapshot().toast!;
    assert.equal(toast.message, `Deleted ${row.title}`);
    assert.equal(toast.action?.label, text.undo);
    await a.store.sync();
    await b.store.sync();
    assert.notEqual(stored(server, table, id).deleted_at, null);
    assert.equal(rowsOf(b.store, table).some((candidate) => candidate.id === id), false);
    toast.action!.run();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await a.store.sync();
    await b.store.sync();
    assert.equal(stored(server, table, id).deleted_at, null);
    assert.equal(rowsOf(b.store, table).some((candidate) => candidate.id === id), true);
  });
}

test("a delete the store refuses neither leaves the screen nor shows a toast", async (t) => {
  t.after(() => overlay.dismissToast());
  overlay.dismissToast();
  const { a } = await pair();
  const id = idOf(await a.store.create("items", task("Pick the music")));
  const row = rowsOf(a.store, "items").find((candidate) => candidate.id === id)!;
  const went: string[] = [];
  const refused = await removeItem({ actions: { ...a.store, remove: async () => ({ ok: false as const, errors: ["no"] }) }, go: (hash) => void went.push(hash) }, "task", row);
  assert.equal(refused.ok, false);
  assert.deepEqual([went, overlay.getSnapshot().toast], [[], null]);
});

test("an instant status change keeps the partner's concurrent edit of another field, and Undo from the page's own banner revives the row", async () => {
  const { server, a, b } = await pair();
  const id = idOf(await a.store.create("items", { ...task("Pick the music"), note: "ask the band" }));
  await a.store.sync();
  await b.store.sync();
  idOf(await b.store.update("items", id, { note: "ask the band and the DJ" }));
  idOf(await a.store.update("items", id, instantChange("task", "status", "done", "2026-10-27") as never));
  await a.store.sync();
  await b.store.sync();
  await a.store.sync();
  const now = rowsOf(a.store, "items").find((row) => row.id === id) as ItemRow;
  assert.deepEqual([now.status, now.done_on, now.note], ["done", "2026-10-27", "ask the band and the DJ"]);
  idOf(await b.store.remove("items", id));
  await b.store.sync();
  await a.store.sync();
  assert.equal(rowsOf(a.store, "items").some((row) => row.id === id), false);
  idOf(await restoreItem(a.store, "task", now));
  await a.store.sync();
  assert.equal(stored(server, "items", id).deleted_at, null);
});

const detail = (name: ViewName, row: ItemRow | BudgetEntryRow, over: Record<string, unknown> = {}) =>
  markupOf("ui/item-detail.tsx", ({ ItemDetail }) => createElement(ItemDetail, { name, row, gone: false, back: { href: "#/tasks", word: "Tasks" }, ...over }));

const tags = (html: string, tag: string) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "g"))].map((match) => match[0]);

test("the page opens as a read view: back link first, one heading, Edit and More, the status as a pressed choice, and no form, Save, Cancel or Delete", async () => {
  const html = await detail("task", item({ title: "Pick the music", note: "ask the band", who: "a" }));
  assert.ok(html.indexOf("<a ") < html.indexOf("<h1"), "the first link comes before the heading");
  assert.match(html, /^<p class="trail"><a href="#\/tasks"><svg[^>]*>.*?<\/svg>Tasks<\/a><\/p><h1 tabindex="-1">Pick the music<\/h1>/);
  assert.equal(tags(html, "h1").length, 1);
  assert.match(html, /aria-label="Edit Pick the music"/);
  assert.match(html, /<button[^>]*aria-haspopup="menu"[^>]*aria-label="More actions for Pick the music"/);
  assert.match(html, /<div role="group" aria-labelledby="[^"]+" class="seg"><button type="button" aria-pressed="true">To do<\/button><button type="button" aria-pressed="false">Done<\/button><\/div>/);
  assert.match(html, /<dt>Note<\/dt><dd>ask the band<\/dd>/);
  assert.match(html, /<p class="hint" id="[^"]+-who">Owner<\/p><div role="group" aria-labelledby="[^"]+-who" class="seg"><button type="button" aria-pressed="false">Nobody yet<\/button><button type="button" aria-pressed="true">You<\/button>/);
  for (const absent of ["<form", 'type="submit"', text.save, text.cancel, text.delete, "danger"]) assert.equal(html.includes(absent), false, absent);
  assert.doesNotMatch(html, /dialog/);
});

test("beside the list the page has no back link, and its heading is the pane's", async () => {
  const html = await detail("guest", item({ kind: "guest", title: "Aunt Rina", status: "todo", who: "a" }), { wide: true, back: { href: "#/guests", word: "Guests" } });
  assert.equal(html.includes("trail"), false);
  assert.match(html, /<h2 tabindex="-1" class="pane-t">Aunt Rina<\/h2>/);
});

test("a row the partner deleted shows the notice and Undo, and everything else on the page is inert", async () => {
  const gone = await detail("task", item({ title: "Pick the music" }), { gone: true });
  assert.match(gone, /<p id="item-gone" class="hint" role="status">This item was deleted<\/p><p><button type="button" class="secondary" aria-describedby="item-gone">Undo<\/button><\/p><div inert="">/);
  const live = await detail("task", item({ title: "Pick the music" }));
  assert.match(live, /<p id="item-gone" class="visually-hidden" role="status"><\/p><div>/);
  assert.equal(live.includes("Undo"), false);
});

test("while paused the write controls say so with aria-disabled and stay focusable", async () => {
  const { useSnapshot } = (await import("./render-store.ts")) as unknown as { useSnapshot: () => { paused: boolean } };
  useSnapshot().paused = true;
  try {
    const html = await detail("task", item({ title: "Pick the music" }));
    assert.equal(tags(html, "button").filter((tag) => tag.includes("aria-pressed")).every((tag) => tag.includes('aria-disabled="true"') && !tag.includes("disabled=\"\"")), true);
  } finally {
    useSnapshot().paused = false;
  }
  const live = await detail("task", item({ title: "Pick the music" }));
  assert.equal(live.includes("aria-disabled"), false);
});

test("the edit sheet has Save in its foot and no Cancel or Delete, and a deleted row keeps its Undo above the typed fields", async () => {
  const sheet = (gone: boolean) =>
    markupOf("ui/item-form.tsx", ({ ItemForm }) => createElement(ItemForm, { name: "task", row: item({ title: "Pick the music" }), gone, only: sheetFields("task"), sheet: () => undefined }));
  const live = await sheet(false);
  assert.match(live, /<h2[^>]*>Edit<\/h2>/);
  const [body, foot] = live.split('<div class="sheet-foot">');
  assert.match(foot, /^<button type="submit">Save<\/button>/);
  for (const absent of [text.cancel, text.delete, "danger", 'name="status"', 'name="who"']) assert.equal(live.includes(absent), false, absent);
  assert.match(body, /name="due_on"/);
  const gone = await sheet(true);
  assert.match(gone, /role="status">This item was deleted\. What you typed is still here\.<\/p><button type="button" class="secondary" aria-describedby="[^"]+">Undo<\/button>/);
  assert.match(gone, /<button type="submit" disabled="">Save<\/button>/);
});

test("the four screens share the frame and no longer mount the form inline", () => {
  for (const file of ["views/generic-item.tsx", "views/person.tsx", "views/money-line.tsx"]) {
    const source = read(file);
    assert.match(source, /<ItemDetail\b/, file);
    assert.doesNotMatch(source, /<ItemForm\b/, file);
    assert.doesNotMatch(source, /<Heading id="(person|line)-edit"|<p className="trail">/, file);
  }
  assert.match(read("views/person.tsx"), /wide=\{wide\}\s*back=\{\{ href: back, word: text\.contacts\[kind === "guest" \? "guests" : "vendors"\] \}\}[\s\S]*skip=\{\["group_key", "data\.phone"\]\}/);
  assert.match(read("views/generic-item.tsx"), /name === "payment" \? \(line\?\.title \?\? text\.nav\.money\) : text\.tasks/);
  assert.match(read("views/money-line.tsx"), /wide=\{wide\}\s*back=\{\{ href: "#\/money", word: text\.nav\.money \}\}[\s\S]*details=\{false\}/);
  const form = read("ui/item-form.tsx");
  assert.match(form, /if \(sheet\) sheet\(\);\s*else location\.hash = backHref\(name, row\)\.slice\(1\);/);
  assert.match(form, /const root = \(\) => form\.current \?\? body\.current;/);
  assert.match(form, /onClose=\{sheet\}/);
  assert.match(form, /<div className="form" ref=\{body\}>/);
  const frame = read("ui/item-detail.tsx");
  assert.match(frame, /className=\{gone && !editing \? "hint" : "visually-hidden"\} role="status">\s*\{gone && !editing \? text\.gone : ""\}/);
  assert.match(frame, /\{gone && !editing && \(\s*<p>\s*<button type="button" className="secondary" aria-describedby=\{notice\}/);
  assert.match(frame, /revived\.current = true;\s*const result = await restoreItem\(actions, name, row\);\s*if \(!result\.ok\) revived\.current = false;/);
  assert.match(frame, /if \(gone \|\| !revived\.current\) return;\s*revived\.current = false;\s*edit\.current\?\.focus\(\);/);
  assert.match(frame, /<ItemForm key=\{row\.id\} name=\{name\} row=\{row\} gone=\{gone\} only=\{sheetFields\(name\)\} sheet=/);
  assert.match(frame, /items=\{\[\{ id: "delete", icon: "trash", label: text\.delete, danger: true, run: guard\(remove\) \}\]\}/);
  assert.match(frame, /onClick=\{guard\(\(\) => setEditing\(true\)\)\}/);
});

test("the budget line has no instant controls and no details list, and keeps its own body", async () => {
  const html = await detail("planned", entry({ title: "Venue" }), { details: false, back: { href: "#/money", word: "Money" } });
  assert.equal(html.includes("seg"), false);
  assert.equal(html.includes("detail-facts"), false);
  assert.match(html, /Money<\/a>/);
});

test("every field a Marriage item shows or edits is still reachable from the page or the sheet", () => {
  for (const name of ["task", "payment", "guest", "vendor", "planned"] as const) {
    const shown = new Set([...instantFields(name), ...sheetFields(name)]);
    for (const field of views[name].fields) assert.equal(shown.has(field), true, `${name} ${field}`);
  }
});

const css = ["tokens.css", "style.css", "ui/ui.css", "ui/sheet.css"].flatMap(sheet);

const declared = (selector: string, width: number) => cascade(css, selector, width);

test("a Delete that is alone in the More menu sits 48 px (3rem) from the sheet's Close on a phone, and needs no gap in the laptop popover", () => {
  assert.equal(declared(".menu button.danger:first-child", 40).get("margin-top"), "var(--s7)");
  assert.equal(declared(".menu button.danger:first-child", 40).get("border-top"), "0");
  assert.equal(declared(".menu button.danger:first-child", 62.5).get("margin-top"), "0");
  assert.equal(declared(".menu button.danger", 40).get("border-top"), "1px solid var(--line)");
});

test("the header buttons shrink and wrap instead of stretching", () => {
  assert.equal(declared(".detail-tools > *", 10).get("flex"), "0 1 auto");
  assert.equal(declared(".detail-tools", 10).get("flex-wrap"), "wrap");
});

test("a link in the read view is a 44 px target, and a long note keeps its line breaks under its label", () => {
  assert.equal(declared(".detail-facts a", 40).get("min-height"), "var(--target-min)");
  assert.equal(declared(".detail-facts [data-long] dd", 10).get("flex-basis"), "100%");
  assert.equal(declared(".detail-facts [data-long] dd", 10).get("white-space"), "pre-wrap");
  assert.equal(declared(".detail-facts [data-long] dd", 10).get("text-align"), "left");
});
