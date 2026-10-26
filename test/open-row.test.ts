import { test } from "node:test";
import assert from "node:assert/strict";
import { openRow } from "../src/domain/open-row.ts";

const row = (title: string) => ({ id: "r1", title });

test("a live row is shown as it is, and nothing is gone", () => {
  const live = row("live");
  assert.deepEqual(openRow(undefined, live), { row: live, gone: false });
  assert.deepEqual(openRow(row("last"), live), { row: live, gone: false });
});

test("a row that vanished is gone and the last row is still shown", () => {
  const last = row("last");
  const result = openRow(last, undefined);
  assert.equal(result.row, last);
  assert.equal(result.gone, true);
});

test("a row that never existed is not gone, there is nothing to show", () => {
  assert.deepEqual(openRow(undefined, undefined), { row: undefined, gone: false });
});
