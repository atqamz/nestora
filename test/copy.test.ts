import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { tables } from "../shared/tables.ts";
import { validatePatch } from "../shared/validate.ts";
import { sideName } from "../src/domain/names.ts";
import { reasonText, settingName } from "../src/ui/labels.ts";
import { text } from "../src/ui/text.ts";

const strings = (value: unknown): string[] =>
  typeof value === "string"
    ? [value]
    : typeof value === "function"
      ? [value(1), value("x")].flatMap(strings)
      : typeof value === "object" && value !== null
        ? Object.values(value).flatMap(strings)
        : [];

test("no UI string says Partner", () => {
  const all = strings(text);
  assert.ok(all.length > 100);
  assert.deepEqual(all.filter((line) => /partner/i.test(line)), []);
});

test("no source file spells out Partner A or Partner B", () => {
  const files = readdirSync(new URL("../src/", import.meta.url), { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
  assert.ok(files.length > 20);
  for (const file of files) {
    assert.doesNotMatch(readFileSync(`${file.parentPath}/${file.name}`, "utf8"), /Partner [AB]/, file.name);
  }
});

test("the two nickname fields and the ownership blank are named without placeholders", () => {
  assert.deepEqual([text.settings.yourNickname, text.settings.theirNickname, text.nobody, text.both], ["Your nickname", "Their nickname", "Nobody yet", "Both"]);
});

test("every ownership label, nicknames or fallbacks, is visible and never says Partner, A or B", () => {
  const seen = new Set<string>();
  for (const me of ["a", "b", null] as const) {
    for (const a of ["Ana", null]) {
      for (const b of ["Bo", null]) {
        for (const side of ["a", "b", "both", null]) {
          const label = sideName(side, me, { a, b }, text);
          seen.add(label);
          assert.match(label, /\S/);
          assert.doesNotMatch(label, /partner/i);
          assert.doesNotMatch(label, /^[AB]$/);
        }
      }
    }
  }
  for (const word of [text.you, text.them, text.both, text.nobody]) assert.ok(seen.has(word), word);
});

test("no attribute literal in a source file says Partner either", () => {
  const files = readdirSync(new URL("../src/", import.meta.url), { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
  const attribute = /\b(?:aria-label|aria-description|title|alt|placeholder)=(?:"([^"]*)"|\{"([^"]*)"\}|\{`([^`]*)`\})/g;
  for (const file of files) {
    const source = readFileSync(`${file.parentPath}/${file.name}`, "utf8");
    for (const [, a, b, c] of source.matchAll(attribute)) assert.doesNotMatch(a ?? b ?? c, /partner/i, file.name);
  }
});

test("the countdown unit agrees with the number", () => {
  assert.deepEqual([text.countdown.to(1), text.countdown.to(2), text.countdown.to(402)], ["day to the akad", "days to the akad", "days to the akad"]);
  assert.deepEqual([text.countdown.since(1), text.countdown.since(2)], ["day since the akad", "days since the akad"]);
});

test("the offline badge keeps the word Offline, and says the changes are saved when some are waiting", () => {
  assert.equal(text.sync.offline(0), "Offline");
  for (const waiting of [1, 2, 30]) assert.equal(text.sync.offline(waiting), "Offline, saved on this phone");
});

test("the not-estimated note and the estimate sentence agree with the count", () => {
  assert.equal(text.budget.unestimated(1), "1 line is not estimated yet, so it is not in these totals.");
  assert.equal(text.budget.unestimated(3), "3 lines are not estimated yet, so they are not in these totals.");
  assert.equal(text.money.estimatedOn(11, 14), "estimated on 11 of 14 lines.");
  assert.equal(text.money.estimatedOn(1, 1), "estimated on 1 line.");
  assert.equal(text.money.estimatedOn(2, 2), "estimated on 2 lines.");
});

test("guest and vendor statuses read as the design words, and no other status changes", () => {
  assert.deepEqual(text.option["guest.status"], { todo: "Not invited yet", sent: "Invited", confirmed: "Coming", declined: "Not coming" });
  assert.deepEqual(text.option["vendor.status"], { option: "Considering", confirmed: "Booked", cancelled: "Dropped" });
  assert.equal(text.option.status.confirmed, "Confirmed");
});

test("the repeated call and WhatsApp actions name the row they belong to", () => {
  assert.equal(text.callNamed("Hall"), "Call Hall");
  assert.equal(text.whatsappNamed("Hall"), "WhatsApp Hall");
});

test("every known setting has a plain name, mine or theirs, that never shows the key or says Partner", () => {
  const keys = Object.keys(tables.settings.values);
  assert.ok(keys.length >= 11);
  for (const me of ["a", "b", null] as const) {
    for (const key of keys) {
      const name = settingName(key, me);
      assert.match(name, /\S/, key);
      assert.notEqual(name, key);
      assert.doesNotMatch(name, /partner|_/i, key);
    }
  }
  assert.equal(settingName("partner_a_photo", "a"), "Your profile photo");
  assert.equal(settingName("partner_a_photo", "b"), "Their profile photo");
  assert.equal(settingName("partner_b_photo", "b"), "Your profile photo");
  assert.equal(settingName("partner_b_label", "a"), "Their nickname");
  assert.equal(settingName("not_a_setting", "a"), "not_a_setting");
});

test("a refusal reason names the setting by its plain name", () => {
  for (const key of Object.keys(tables.settings.values)) {
    const reason = `value: must be something for key ${key}`;
    for (const me of ["a", "b", null] as const) assert.doesNotMatch(reasonText(reason, me), /partner|_/i, key);
  }
  const [refusal] = validatePatch("settings", "partner_b_photo", { value: "http://lh3.googleusercontent.com/a" });
  assert.match(reasonText(refusal, "a"), /for their profile photo$/);
  const [stages] = validatePatch("settings", "stages", { value: "[]" });
  assert.equal(reasonText(stages, "a"), stages.replace("for key stages", "for route stages"));
});
