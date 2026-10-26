import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { heading, nicknameOf, possessive, sideName } from "../src/domain/names.ts";
import { text } from "../src/ui/text.ts";

const name = (side: string | null, me: "a" | "b" | null, a: string | null, b: string | null) => sideName(side, me, { a, b }, text);

test("both nicknames set: each side shows its nickname whoever is signed in", () => {
  for (const me of ["a", "b", null] as const) {
    assert.deepEqual([name("a", me, "Ana", "Bo"), name("b", me, "Ana", "Bo")], ["Ana", "Bo"], String(me));
  }
});

test("no nickname set: the signed-in side is You and the other side is Partner", () => {
  assert.deepEqual([name("a", "a", null, null), name("b", "a", null, null)], ["You", "Partner"]);
  assert.deepEqual([name("a", "b", null, null), name("b", "b", null, null)], ["Partner", "You"]);
});

test("no nickname set and nobody known: every side is Partner, never empty", () => {
  assert.deepEqual([name("a", null, null, null), name("b", null, null, null)], ["Partner", "Partner"]);
});

test("one nickname set: the other side falls back by who is signed in", () => {
  assert.deepEqual([name("a", "a", "Ana", null), name("b", "a", "Ana", null)], ["Ana", "Partner"]);
  assert.deepEqual([name("a", "b", "Ana", null), name("b", "b", "Ana", null)], ["Ana", "You"]);
  assert.deepEqual([name("a", "a", null, "Bo"), name("b", "a", null, "Bo")], ["You", "Bo"]);
  assert.deepEqual([name("a", "b", null, "Bo"), name("b", "b", null, "Bo")], ["Partner", "Bo"]);
  assert.deepEqual([name("a", null, "Ana", null), name("b", null, "Ana", null)], ["Ana", "Partner"]);
  assert.deepEqual([name("a", null, null, "Bo"), name("b", null, null, "Bo")], ["Partner", "Bo"]);
});

test("both and nobody do not depend on nicknames or on who is signed in", () => {
  for (const me of ["a", "b", null] as const) {
    for (const [a, b] of [["Ana", "Bo"], [null, null], ["Ana", null]] as const) {
      assert.deepEqual([name("both", me, a, b), name(null, me, a, b), name("", me, a, b)], ["Both", "Nobody yet", "Nobody yet"]);
    }
  }
});

test("a blank or whitespace-only nickname falls back like none, and a nickname is trimmed", () => {
  assert.deepEqual([name("b", "a", "Ana", ""), name("b", "a", "Ana", "   "), name("b", "a", "Ana", " \t ")], ["Partner", "Partner", "Partner"]);
  assert.deepEqual([name("a", "b", "", "Bo"), name("a", "b", "  Ana ", "Bo")], ["Partner", "Ana"]);
});

test("the possessive always appends 's, whatever the name ends in or holds", () => {
  const cases: [string, string][] = [["Sam", "Sam's"], ["James", "James's"], ["Partner", "Partner's"], ["O'Neil", "O'Neil's"], ["Alex 🌙", "Alex 🌙's"], ["A".repeat(60), `${"A".repeat(60)}'s`]];
  for (const [given, want] of cases) assert.equal(possessive(given), want);
});

test("the partner's name reaches the possessive labels, with Partner when no nickname is known", () => {
  for (const [nick, who] of [["Sam", "Sam"], [null, "Partner"], ["  ", "Partner"]] as const) {
    const label = name("b", "a", "Alex", nick);
    assert.equal(label, who);
    assert.deepEqual(
      [text.routines.owner.theirs(nick === null ? null : nick.trim() || null), text.routines.them.title(label), text.routines.them.empty(label), text.routines.them.week(label)],
      [`${who}'s`, `${who} today`, `Nothing in ${who}'s timetable today.`, `${who}'s week`],
    );
  }
});

test("a group heading is the nickname's possessive, Mine for the viewer and Partner's for the partner when none is set, never Yours or Theirs", () => {
  const { mine, theirs, both } = text.routines.owner;
  assert.deepEqual([mine("Sam"), theirs("Alex"), both], ["Sam's", "Alex's", "Shared"]);
  for (const blank of [null, "", "  "]) assert.deepEqual([mine(blank), theirs(blank), heading(blank, "x")], ["Mine", "Partner's", "x"]);
});

test("nicknameOf gives the trimmed nickname of that side only, null when blank, unset or no side", () => {
  const both = { a: " Sam ", b: "Alex" };
  assert.deepEqual([nicknameOf("a", both), nicknameOf("b", both)], ["Sam", "Alex"]);
  assert.deepEqual([nicknameOf("a", { a: "Sam", b: null }), nicknameOf("b", { a: "Sam", b: null })], ["Sam", null]);
  assert.deepEqual([nicknameOf("a", { a: null, b: "Alex" }), nicknameOf("b", { a: null, b: "Alex" })], [null, "Alex"]);
  for (const blank of ["", "  ", " \t "]) assert.deepEqual([nicknameOf("a", { a: blank, b: "Alex" }), nicknameOf("b", { a: "Sam", b: blank })], [null, null], JSON.stringify(blank));
  assert.equal(nicknameOf(null, both), null);
});

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("usePartner hands its two nicknames to nicknameOf as a and b", () => {
  assert.match(source("hooks/use-plan.ts"), /nicknameOf\(side, \{ a: partnerA, b: partnerB \}\)/);
});

test("the Mine chip is the viewer's own nickname or Mine, never the partner's", () => {
  const chip = source("ui/owner-filter.tsx");
  assert.match(chip, /\["mine", nickname\(me\) \?\? text\.owner\.mine\]/);
  assert.equal(text.owner.mine, "Mine");
  assert.doesNotMatch(chip, /nickname\(me === /);
  assert.match(chip, /\["theirs", label\(me === "a" \? "b" : "a"\)\]/);
});

test("a routines heading is Shared for both, the viewer's nickname for mine and the partner's for theirs", () => {
  assert.match(source("views/routines.tsx"), /owner === "both" \? copy\.owner\.both : copy\.owner\[owner\]\(nickname\(owner === "mine" \? me : me === "a" \? "b" : "a"\)\)/);
  assert.equal(text.routines.owner.both, "Shared");
});
