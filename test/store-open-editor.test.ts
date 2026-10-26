import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Side } from "../shared/api.ts";
import type { ItemRow } from "../shared/tables.ts";
import { follow, pagesOf, placeOf, position, screenOf } from "../src/domain/routine-start.ts";
import { actionsOf } from "../src/domain/routines.ts";
import { begin, timerKey } from "../src/domain/routine-timer.ts";
import { text } from "../src/ui/text.ts";
import { timerStore } from "../src/store/timers.ts";
import type { Held } from "../src/store/timers.ts";
import { createServer } from "./store-server.ts";
import { client, idOf, task } from "./store-client.ts";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const pair = async () => {
  const server = createServer();
  const a = client(server, "a");
  const b = client(server, "b");
  await a.store.open();
  await b.store.open();
  return { server, a, b };
};

const itemOf = (store: ReturnType<typeof client>["store"], id: string) => store.getSnapshot().rows.items.find((row) => row.id === id);

const stored = (server: ReturnType<typeof createServer>, id: string) => server.rows("items").find((row) => row.id === id) as ItemRow;

test("a partner's change to another field lands under an open edit, and the save keeps both", async () => {
  const { server, a, b } = await pair();
  const id = idOf(await a.store.create("items", { ...task("Pack the hampers"), note: "ribbons" }));
  await a.store.sync();
  await b.store.sync();
  const opened = itemOf(b.store, id)!;
  server.control.down = true;
  idOf(await b.store.update("items", id, { title: "Pack the big hampers" }));
  idOf(await a.store.update("items", id, { note: "ribbons and tags" }));
  server.control.down = false;
  await a.store.sync();
  await b.store.sync();
  assert.deepEqual([itemOf(b.store, id)?.title, itemOf(b.store, id)?.note], ["Pack the big hampers", "ribbons and tags"]);
  assert.equal(opened.note, "ribbons");
  assert.deepEqual([stored(server, id).title, stored(server, id).note], ["Pack the big hampers", "ribbons and tags"]);
});

test("a row the partner deleted leaves the snapshot, an edit saved meanwhile changes nothing, and Undo brings the row back", async () => {
  const { server, a, b } = await pair();
  const id = idOf(await a.store.create("items", { ...task("Pack the hampers"), note: "ribbons" }));
  await a.store.sync();
  await b.store.sync();
  idOf(await a.store.remove("items", id));
  await a.store.sync();
  await b.store.sync();
  assert.equal(itemOf(b.store, id), undefined);
  await b.store.update("items", id, { title: "typed while gone" });
  await b.store.sync();
  assert.notEqual(stored(server, id).deleted_at, null);
  assert.equal(stored(server, id).title, "Pack the hampers");
  idOf(await b.store.update("items", id, { deleted_at: null }));
  await b.store.sync();
  assert.equal(stored(server, id).deleted_at, null);
  assert.equal(itemOf(b.store, id)?.note, "ribbons");
  idOf(await b.store.update("items", id, { title: "typed after Undo" }));
  await b.store.sync();
  assert.equal(stored(server, id).title, "typed after Undo");
});

test("a partner's undo of a delete brings the row back under the open form", async () => {
  const { a, b } = await pair();
  const id = idOf(await a.store.create("items", task("Pack the hampers")));
  await a.store.sync();
  await b.store.sync();
  idOf(await a.store.remove("items", id));
  await a.store.sync();
  await b.store.sync();
  assert.equal(itemOf(b.store, id), undefined);
  idOf(await a.store.update("items", id, { deleted_at: null }));
  await a.store.sync();
  await b.store.sync();
  assert.equal(itemOf(b.store, id)?.title, "Pack the hampers");
});

const held = () => {
  const map = new Map<string, string>();
  const storage: Held = {
    get length() {
      return map.size;
    },
    key: (at) => [...map.keys()][at] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
  return { map, timers: timerStore(storage, () => NOW) };
};

const NOW = 10_000_000;

const DAY = "2026-10-26";

const started = async () => {
  const { server, a, b } = await pair();
  const routine = idOf(await a.store.create("items", { kind: "routine", title: "Evening routine", who: "both" }));
  const steps = [];
  for (const [at, title] of ["Wash up", "Lights off", "Lock the door"].entries()) steps.push(idOf(await a.store.create("items", { kind: "step", title, parent_id: routine, sort: at + 1 })));
  await a.store.sync();
  await b.store.sync();
  const me: Side = "b";
  const pages = () => {
    const rows = b.store.getSnapshot().rows.items;
    return pagesOf(actionsOf(rows, rows.find((row) => row.id === routine)!));
  };
  const timers = held();
  const first = pages();
  const place = placeOf(first, position(first, me, DAY));
  timers.timers.write(me, routine, steps[0], begin(5, NOW));
  timers.timers.write(me, routine, steps[1], begin(5, NOW));
  return { a, b, routine, steps, me, pages, place, timers, first };
};

test("Start keeps its place, its screen and its timer when the partner ticks their own mark on the shown step", async () => {
  const { a, b, routine, steps, me, pages, place, timers, first } = await started();
  const before = screenOf(first, place, me, DAY);
  idOf(await a.store.update("items", steps[0], { data: { done_a: DAY } }));
  await a.store.sync();
  await b.store.sync();
  const after = pages();
  assert.equal(follow(after, place), place);
  const shown = screenOf(after, place, me, DAY);
  assert.deepEqual([shown.kind, shown.at, shown.open], [before.kind, before.at, before.open]);
  timers.timers.keep(me, routine, steps[0]);
  assert.deepEqual(timers.timers.running(me, routine), [steps[0]]);
  assert.notEqual(timers.map.get(timerKey(me, routine, steps[0])), undefined);
});

test("Start moves to the next page when the partner deletes the shown step, and only that step's timer goes", async () => {
  const { a, b, routine, steps, me, pages, place, timers } = await started();
  assert.equal(place.id, steps[0]);
  idOf(await a.store.remove("items", steps[0]));
  await a.store.sync();
  await b.store.sync();
  const after = pages();
  const moved = follow(after, place);
  assert.equal(moved.id, steps[1]);
  const shown = screenOf(after, moved, me, DAY);
  assert.deepEqual([shown.kind, shown.at], ["page", 0]);
  timers.timers.keep(me, routine, moved.id);
  assert.deepEqual(timers.timers.running(me, routine), [steps[1]]);
});

test("an open form takes every value from its own snapshot, and a deleted row keeps the form with Undo and no Save", () => {
  const form = read("ui/item-form.tsx");
  assert.match(form, /const \[initial\] = useState\(row\);/);
  assert.match(form, /value: initial\.title/);
  assert.match(form, /value: valueOf\(initial, field\)/);
  assert.doesNotMatch(form, /valueOf\(row,|value: row\.|\[row, siblings/);
  assert.match(form, /<button type="submit" disabled=\{busy \|\| gone\}>/);
  assert.match(form, /actions\.update\(view\.table, row\.id, \{ deleted_at: null \} as never\)/);
  assert.match(form, /\{gone && \(\s*<button ref=\{undo\} type="button" aria-describedby=\{notice\} disabled=\{busy\} onClick=\{restore\}>\s*\{text\.undo\}\s*<\/button>\s*\)\}/);
  assert.match(form, /if \(!gone \|\| busy \|\| !removed\.current\) return;\s*removed\.current = false;\s*undo\.current\?\.focus\(\);/);
  assert.match(form, /\}, \[gone, busy\]\);/);
  assert.match(form, /removed\.current = true;\s*const result = await \(onRemove \? onRemove\(\) : actions\.remove\(view\.table, row\.id\)\);\s*if \(!result\.ok\) removed\.current = false;/);
  assert.equal(text.goneOpen, "This item was deleted. What you typed is still here.");
});

test("every screen that mounts the item form keeps it through a delete instead of showing the deleted page", () => {
  for (const file of ["views/generic-item.tsx", "views/person.tsx", "views/money-line.tsx", "views/book.tsx", "views/screen.tsx"]) {
    const source = read(file);
    assert.match(source, /const \{ row(: \w+)?, gone \} = useOpenRow\(/, file);
    assert.match(source, /<ItemForm\s[^>]*gone=\{gone\}/, file);
    assert.match(source, /if \(!(row|line|open)\) return <Gone /, file);
  }
  assert.match(read("views/money-line.tsx"), /<section aria-labelledby="payments" inert=\{gone\}>/);
  const screen = read("views/screen.tsx");
  assert.match(screen, /\{!gone && <Status /);
  assert.match(screen, /\{!gone && watched && <Ratings /);
  const book = read("views/book.tsx");
  assert.match(book, /\{!gone && <FillBook /);
  assert.match(book, /\{gone \? null : wish \? \(/);
  assert.match(book, /sheet !== null && !gone && <CopySheet /);
});

test("the open-row hook remembers the last row", () => {
  const hook = read("hooks/use-open-row.ts");
  assert.match(hook, /const open = openRow\(last\.current, live\);\s*last\.current = open\.row;/);
});

test("the other editors keep a snapshot of their own and no live row reaches a field being typed in", () => {
  const sheet = read("ui/routine-sheet.tsx");
  assert.match(sheet, /const \[opened\] = useState\(current\);/);
  assert.match(sheet, /const \[draft, setDraft\] = useState\(start\);/);
  assert.match(sheet, /savePlan\(forTimetable\(draft, me\), opened, current, /);
  const row = read("ui/setting-row.tsx");
  assert.match(row, /const \[draft, setDraft\] = useState\(""\);/);
  assert.equal(row.match(/setDraft\(String\(field\.value/g)?.length, 1);
  const add = read("ui/add-sheet.tsx");
  assert.match(add, /const \[start\] = useState\(overlay\.keptDraft\);/);
  assert.match(add, /const \[input, setInput\] = useState\(\(\) => withSeed\(start\?\.input \?\? "", seed\)\);/);
});
