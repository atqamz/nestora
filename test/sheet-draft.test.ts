import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { overlay } from "../src/ui/overlay.ts";
import { text } from "../src/ui/text.ts";

const sheet = readFileSync(new URL("../src/ui/add-sheet.tsx", import.meta.url), "utf8");

test("the unsent draft is kept in memory until it is replaced or cleared", () => {
  assert.equal(overlay.keptDraft(), null);
  const draft = { input: "Venue 5 jt", kindPick: "task" as const, ignore: ["amount" as const], edits: { due: "2026-12-24" }, ownerPick: "none" };
  overlay.keepDraft(draft);
  assert.deepEqual(overlay.keptDraft(), draft);
  overlay.keepDraft({ ...draft, input: "Venue 6 jt" });
  assert.equal(overlay.keptDraft()?.input, "Venue 6 jt");
  overlay.keepDraft(null);
  assert.equal(overlay.keptDraft(), null);
});

test("the sheet starts from the kept draft, keeps every change, and clears it only when the add succeeded", () => {
  assert.match(sheet, /useState\(overlay\.keptDraft\)/);
  assert.match(sheet, /overlay\.keepDraft\(pristine \? null : \{/);
  const save = /if \(!result\.ok\) return;([\s\S]*?)overlay\.closeAdd\(\);/.exec(sheet)?.[1] ?? "";
  assert.match(save, /overlay\.keepDraft\(null\)/);
  assert.equal([...sheet.matchAll(/overlay\.keepDraft\(null\)/g)].length, 1);
});

test("the sheet says in one calm line that what is typed is kept until it is added", () => {
  assert.match(text.sheet.hint, /What you type is kept until you add it\./);
  assert.doesNotMatch(sheet, /confirm\(/);
});
