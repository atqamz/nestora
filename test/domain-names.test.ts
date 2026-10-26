import { test } from "node:test";
import assert from "node:assert/strict";
import { heading, possessive, sideName } from "../src/domain/names.ts";
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
