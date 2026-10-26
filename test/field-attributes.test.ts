import { test } from "node:test";
import assert from "node:assert/strict";
import { attributes } from "../src/ui/field-attributes.ts";

test("year and int open the numeric keypad on a text input with no autofill and a Done key", () => {
  for (const type of ["year", "int"] as const) {
    assert.deepEqual(attributes(type), { type: "text", inputMode: "numeric", autoComplete: "off", enterKeyHint: "done" }, type);
    assert.deepEqual(attributes(type, true), attributes(type), type);
  }
});

test("date and time use the native input, phone and url their own keypads, zone and isbn plain lowercase text", () => {
  assert.deepEqual(attributes("date"), { type: "date" });
  assert.deepEqual(attributes("time"), { type: "time" });
  assert.deepEqual(attributes("phone"), { type: "tel", inputMode: "tel", autoComplete: "off", autoCapitalize: "none", spellCheck: false });
  assert.deepEqual(attributes("url"), { type: "url", inputMode: "url", autoComplete: "off", autoCapitalize: "none", autoCorrect: "off", spellCheck: false });
  for (const type of ["zone", "isbn"] as const) assert.deepEqual(attributes(type), { type: "text", autoComplete: "off", autoCapitalize: "none", spellCheck: false }, type);
});

test("other text capitalises sentences, or words when asked", () => {
  assert.deepEqual(attributes("text"), { type: "text", autoComplete: "off", autoCapitalize: "sentences" });
  assert.deepEqual(attributes("text", true), { type: "text", autoComplete: "off", autoCapitalize: "words" });
});
