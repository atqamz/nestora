import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import type { ItemRow } from "../shared/tables.ts";
import { blankDraft, draftOf } from "../src/domain/routine-draft.ts";
import { readFileSync } from "node:fs";
import { text } from "../src/ui/text.ts";
import { item } from "./domain-rows.ts";
import { markupOf } from "./render.ts";

const sheetOf = (routine: ItemRow, gone: boolean) =>
  markupOf("ui/routine-sheet.tsx", ({ RoutineSheet }) =>
    createElement(RoutineSheet, { start: draftOf(routine, []), current: { routine, actions: [] }, me: "a", today: "2026-10-26", gone, flows: {}, onClose: () => undefined }),
  );

const parts = (html: string) => {
  const [body, foot = ""] = html.split('<div class="sheet-foot">');
  return { body, foot };
};

const buttons = (html: string) => [...html.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);

const routines = [
  ["a routine", item({ kind: "routine", status: null, who: "both", title: "Evening", group_key: "evening" })],
  ["a timetable", item({ kind: "routine", status: null, who: "a", title: "Weekdays", group_key: "timetable" })],
] as const;

for (const [name, routine] of routines) {
  test(`the sheet of ${name} the partner deleted shows the notice and Undo above the fields, and the foot holds only a disabled Save`, async () => {
    const { body, foot } = parts(await sheetOf(routine, true));
    assert.match(body, new RegExp(`<p id="([^"]+)" class="hint" role="status">${text.routines.goneOpen}</p><button type="button" class="secondary" aria-describedby="\\1">${text.undo}</button>`));
    assert.ok(body.indexOf(text.undo) < body.indexOf('name="routine-title"'));
    assert.equal(foot.includes(text.undo) || foot.includes("role="), false);
    assert.deepEqual(buttons(foot), ['<button type="submit" disabled="">']);
    assert.equal(buttons(body).some((tag) => tag.includes("danger")), false);
  });

  test(`the sheet of ${name} that is live has an empty notice region, no Undo and a working Save`, async () => {
    const { body, foot } = parts(await sheetOf(routine, false));
    assert.match(body, /<p id="[^"]+" class="visually-hidden" role="status"><\/p>/);
    assert.equal(body.includes(text.undo), false);
    assert.equal(body.includes(text.routines.goneOpen), false);
    assert.deepEqual(buttons(foot), ['<button type="submit">']);
    assert.equal(buttons(body).some((tag) => tag.includes("danger")), false);
  });
}

test("a new routine sheet never shows the notice", async () => {
  const html = await markupOf("ui/routine-sheet.tsx", ({ RoutineSheet }) =>
    createElement(RoutineSheet, { start: blankDraft("a"), current: null, me: "a", today: "2026-10-26", flows: {}, onClose: () => undefined }),
  );
  assert.equal(html.includes(text.undo), false);
  assert.equal(html.includes(text.routines.goneOpen), false);
});

const formOf = (gone: boolean) => markupOf("ui/item-form.tsx", ({ ItemForm }) => createElement(ItemForm, { name: "guest", row: item({ kind: "guest", title: "Pak Budi", status: "invited" }), gone }));

test("a deleted row's form shows the notice and Undo, with Save and Delete off", async () => {
  const html = await formOf(true);
  assert.match(html, new RegExp(`<p id="([^"]+)" class="hint" role="status">${text.goneOpen}</p>`));
  assert.match(html, new RegExp(`<button type="button" aria-describedby="[^"]+">${text.undo}</button><button type="submit" disabled="">`));
  assert.ok(buttons(html).some((tag) => tag.includes("danger") && tag.includes('disabled=""')));
});

test("a live row's form has an empty notice region and no Undo", async () => {
  const html = await formOf(false);
  assert.match(html, /<p id="[^"]+" class="visually-hidden" role="status"><\/p>/);
  assert.equal(html.includes(text.undo), false);
  assert.equal(html.includes(text.goneOpen), false);
});

test("the form takes the gone flag as a required prop, so the typecheck fails a screen that forgets it", () => {
  const source = readFileSync(new URL("../src/ui/item-form.tsx", import.meta.url), "utf8");
  assert.match(source, /type Props = \{[^}]*\bgone: boolean;/);
  assert.match(source, /export function ItemForm\(\{ name, row, gone, /);
});
