import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { BudgetEntryRow, ItemRow } from "../shared/tables.ts";
import { EVENT_ORDER, eventKeys } from "../src/domain/budget.ts";
import { openRow } from "../src/domain/open-row.ts";
import { views } from "../src/ui/registry.ts";
import { bookFlows } from "../src/ui/book-flows.ts";
import { overlay } from "../src/ui/overlay.ts";
import { createServer } from "./store-server.ts";
import { client, idOf } from "./store-client.ts";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const pair = async () => {
  const server = createServer();
  const a = client(server, "a");
  const b = client(server, "b");
  await a.store.open();
  await b.store.open();
  return { server, a, b };
};

const items = (store: ReturnType<typeof client>["store"]) => store.getSnapshot().rows.items;

const stored = (server: ReturnType<typeof createServer>, id: string) => server.rows("items").find((row) => row.id === id) as ItemRow;

test("a partner moving a line out of its custom group leaves the group among the options of the open form", async () => {
  const { a, b } = await pair();
  const id = idOf(await a.store.create("budget_entries", { entry_type: "planned", title: "Marquee", group_key: "Tenting", amount: 1000 }));
  await a.store.sync();
  await b.store.sync();
  const initial = b.store.getSnapshot().rows.budget_entries.find((row) => row.id === id)!;
  idOf(await a.store.update("budget_entries", id, { group_key: "Catering" }));
  await a.store.sync();
  await b.store.sync();
  const used = (b.store.getSnapshot().rows.budget_entries as BudgetEntryRow[]).flatMap((row) => (row.group_key ? [row.group_key] : []));
  assert.deepEqual(used, ["Catering"]);
  assert.deepEqual(eventKeys(used, initial.group_key), [...EVENT_ORDER, "Catering", "Tenting"]);
  assert.deepEqual(eventKeys(used, null), [...EVENT_ORDER, "Catering"]);
  assert.deepEqual(eventKeys([], "engagement"), EVENT_ORDER);
});

test("both event selects take the row's own value into their options", () => {
  assert.match(read("ui/item-form.tsx"), /eventKeys\(used, initial\.group_key\)/);
  assert.match(read("ui/add-sheet.tsx"), /eventKeys\(used\("budget_entries", "planned"\), values\.group === "" \? null : values\.group\)/);
});

test("the form's other choice controls take their options from the registry, never from live rows", () => {
  const form = read("ui/item-form.tsx");
  assert.match(form, /const options = fieldOptions\(name, field\);/);
  assert.match(form, /choice: owner \|\| field === "status" \? true : undefined/);
  assert.equal(form.match(/siblings/g)?.length, 3);
});

test("a deleted row's form shows the notice in a region that was already mounted, and Undo points at it", () => {
  const form = read("ui/item-form.tsx");
  assert.match(form, /<p id=\{notice\} className=\{gone \? "hint" : "visually-hidden"\} role="status">\s*\{gone \? text\.goneOpen : ""\}\s*<\/p>/);
  assert.match(form, /<button ref=\{undo\} type="button" aria-describedby=\{notice\}/);
});

test("Undo from an open form moves focus to the first field once the row is back, and only for the user's own Undo", () => {
  const form = read("ui/item-form.tsx");
  assert.match(form, /revived\.current = true;\s*const result = await \(onRestore \? onRestore\(\) : actions\.update\(view\.table, row\.id, \{ deleted_at: null \} as never\)\);\s*if \(!result\.ok\) revived\.current = false;\s*setFailure\(failureOf\(result\)\);/);
  assert.match(form, /if \(gone \|\| busy \|\| !revived\.current\) return;\s*revived\.current = false;\s*root\(\)\?\.querySelector<HTMLElement>\("input, select, textarea"\)\?\.focus\(\);\s*\}, \[gone, busy\]\);/);
});

test("Delete is off on a deleted row", () => {
  assert.match(read("ui/item-form.tsx"), /<button type="button" className="danger" disabled=\{busy \|\| gone\} onClick=\{remove\}>/);
});

test("the open form keeps the fields it was opened with whichever way the partner turns the book", () => {
  const book = read("views/book.tsx");
  const SHELF = views.book.fields.filter((field) => !["data.shop"].includes(field));
  assert.match(book, /function BookForm\(.*\) \{\s*const \[wish\] = useState\(book\.status === "wish"\);\s*return <ItemForm name="book" row=\{book\} gone=\{gone\} only=\{wish \? views\.book\.fields : SHELF_FIELDS\}/);
  assert.match(book, /<BookForm key=\{book\.id\} book=\{book\} gone=\{gone\}/);
  assert.doesNotMatch(book.slice(book.indexOf("export function BookDetail")), /only=/);
  assert.ok(views.book.fields.includes("data.shop") && !SHELF.includes("data.shop"));
});

test("the book form's Undo brings back the copies the book's delete took with it", async (t) => {
  t.after(() => overlay.dismissToast());
  overlay.dismissToast();
  const { server, a, b } = await pair();
  const book = idOf(await a.store.create("items", { kind: "book", title: "Atlas", status: "shelf" }));
  const copy = idOf(await a.store.create("items", { kind: "copy", parent_id: book, title: "Atlas", status: "here", who: "both" }));
  await a.store.sync();
  await b.store.sync();
  const seen = { book: items(b.store).find((row) => row.id === book)!, copies: items(b.store).filter((row) => row.parent_id === book) };
  const mine = bookFlows({ items: items(a.store), actions: a.store, stamp: () => "2026-10-26", me: "a", go: () => undefined });
  const removed = await mine.removeBook(items(a.store).find((row) => row.id === book)!, items(a.store).filter((row) => row.parent_id === book));
  assert.equal(removed.ok, true);
  await a.store.sync();
  await b.store.sync();
  assert.equal(items(b.store).some((row) => row.id === book || row.id === copy), false);
  assert.deepEqual(openRow(seen, undefined), { row: seen, gone: true });
  const theirs = bookFlows({ items: items(b.store), actions: b.store, stamp: () => "2026-10-26", me: "b", go: () => undefined });
  assert.equal((await theirs.restoreBook(seen.book)).ok, true);
  await b.store.sync();
  await a.store.sync();
  assert.deepEqual([stored(server, book).deleted_at, stored(server, copy).deleted_at], [null, null]);
  assert.deepEqual(items(a.store).map((row) => row.id).sort(), [book, copy].sort());
  const source = read("views/book.tsx");
  assert.match(source, /onRestore=\{\(\) => restoreBook\(book\)\}/);
  assert.match(source, /useOpenRow\(found && \{ book: found, copies: copies\.get\(found\.id\) \?\? \[\] \}\)/);
});

test("the open-row hook returns what openRow said", () => {
  assert.match(read("hooks/use-open-row.ts"), /const open = openRow\(last\.current, live\);\s*last\.current = open\.row;\s*return open;/);
});

test("the form's options and labels follow the rows, the partner names and the field list", () => {
  assert.match(read("ui/item-form.tsx"), /\}, \[initial, siblings, name, view, only, label\]\);/);
});

test("a failed Undo says so", () => {
  assert.match(read("ui/item-form.tsx"), /setFailure\(failureOf\(result\)\);\s*\}\);\s*useEffect/);
});
