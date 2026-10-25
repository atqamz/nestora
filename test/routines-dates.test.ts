import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarOf } from "../shared/ics.ts";
import { DAY_CODES, covers, occursOn, plus, weekday } from "../shared/routines.ts";
import type { ItemRow } from "../shared/tables.ts";
import { item } from "./domain-rows.ts";
import { parse } from "./ics-parse.ts";

const NOW = new Date("2026-10-24T03:00:00Z");

const at = (year: number, month: number, day: number) => {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
};

const text = (date: Date) => `${String(date.getUTCFullYear()).padStart(4, "0")}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;

test("the calendar arithmetic agrees with the platform dates around the years 0, 400, 1900, 2200 and 9999, at the month and year edges", () => {
  const edges = [[0, 1, 1], [0, 2, 28], [0, 2, 29], [0, 3, 1], [0, 12, 31], [1, 1, 1], [399, 12, 31], [400, 1, 1], [400, 2, 28], [400, 2, 29], [400, 3, 1], [400, 12, 31], [401, 1, 1], [1899, 12, 31], [1900, 1, 1], [1900, 2, 28], [1900, 3, 1], [1970, 1, 1], [2000, 2, 29], [2000, 3, 1], [2100, 2, 28], [2100, 3, 1], [2199, 12, 31], [2200, 1, 1], [2200, 2, 28], [2200, 3, 1], [2200, 12, 31], [9998, 12, 31], [9999, 1, 1], [9999, 2, 28], [9999, 3, 1], [9999, 12, 30]] as const;
  for (const [year, month, day] of edges) {
    const date = at(year, month, day);
    const shown = text(date);
    assert.equal(weekday(shown), DAY_CODES[(date.getUTCDay() + 6) % 7], shown);
    for (const step of [-2, -1, 1, 2, 366]) {
      const moved = new Date(date.getTime() + step * 86_400_000);
      if (moved.getUTCFullYear() > 9999 || moved.getUTCFullYear() < 0) continue;
      assert.equal(plus(shown, step), text(moved), `${shown} ${step}`);
    }
  }
});

test("a string that is not a plain date of ten characters falls back to the platform parser and gets no weekday when that rejects it", () => {
  const rejected = ["2026-1-05", "2026-10-5", "26-10-05", "2026/10/05", "2026-10/05", "2026/10-05", "2026-13-01", "2026-00-10", "2026-10-00", "2026-10-32", "20x6-10-05", "2026-10-0x", "2026-x0-05", "", "2026-10-05 ", " 2026-10-05", "10000-01-01", "-001-01-01", "2026-10-05T", "0000000000"];
  for (const date of rejected) assert.equal(weekday(date), undefined, JSON.stringify(date));
  assert.equal(weekday("2026-10-24"), "SA");
  assert.equal(weekday("0000-03-01"), "WE");
  assert.equal(weekday("+002026-10-24"), "SA");
});

test("a start date given as a one-element array does not throw and counts as that date", () => {
  const from = ["2026-10-19"] as unknown as string;
  assert.equal(plus(from, 1), "2026-10-20");
  assert.equal(weekday(from), "MO");
  const row = item({ kind: "routine", status: null, data: { from, every_weeks: "2" } });
  assert.equal(occursOn(row, "2026-10-19"), true);
  assert.equal(occursOn(row, "2026-10-26"), false);
  assert.equal(occursOn(row, "2026-11-02"), true);
});

test("covers matches a whole code at the start, the middle and the end of the list, never a part of a longer word, and everything when there is no list", () => {
  assert.equal(covers("MO", "MO"), true);
  assert.equal(covers("MO,TU,WE", "MO"), true);
  assert.equal(covers("MO,TU,WE", "TU"), true);
  assert.equal(covers("MO,TU,WE", "WE"), true);
  assert.equal(covers("MO,TU,WE", "TH"), false);
  assert.equal(covers("", "MO"), false);
  assert.equal(covers("XMO", "MO"), false);
  assert.equal(covers("MOX", "MO"), false);
  assert.equal(covers("MO.TU", "TU"), false);
  assert.equal(covers("MO.TU", "MO"), false);
  assert.equal(covers("TUMO,SA", "MO"), false);
  assert.equal(covers("XMO,MO", "MO"), true);
  assert.equal(covers("MOX,MO", "MO"), true);
  assert.equal(covers("TUMO,TUMO,MO", "MO"), true);
  assert.equal(covers("MO,", "MO"), true);
  assert.equal(covers(",MO", "MO"), true);
  assert.equal(covers(undefined, "MO"), true);
  assert.equal(covers(null, "MO"), true);
  assert.equal(covers(5, "MO"), true);
  assert.equal(covers(["MO"], "TU"), true);
});

const routine = (data: unknown, extra: Partial<ItemRow> = {}) => item({ kind: "routine", status: null, who: "a", title: "Routine", data: data as ItemRow["data"], ...extra });

const block = (parent: ItemRow, data: unknown) => item({ kind: "block", status: null, parent_id: parent.id, title: "Slot", data: data as ItemRow["data"] });

test("a routine or a block without data, or with data that is not an object, gives a defined feed and never throws", () => {
  const nodata = routine(null);
  const timetable = routine({ start_time: "09:00" }, { group_key: "timetable" });
  const events = (rows: ItemRow[]) => parse(calendarOf(rows, "a", NOW, [])).events.length;
  assert.equal(events([nodata]), 0);
  assert.equal(events([nodata, block(nodata, null)]), 0);
  assert.equal(events([nodata, block(nodata, { start_time: "10:00" })]), 1);
  assert.equal(events([timetable, block(timetable, null)]), 1);
  assert.equal(events([timetable, block(timetable, "{not json")]), 1);
  assert.equal(events([routine("{not json"), block(nodata, "{not json")]), 0);
  const badParent = routine("{not json");
  assert.equal(events([badParent, block(badParent, { start_time: "10:00", days: "MO" })]), 1);
  assert.ok(calendarOf([nodata, block(nodata, null)], "a", NOW, []).startsWith("BEGIN:VCALENDAR\r\n"));
  assert.equal(occursOn(nodata, "2026-10-24"), true);
  assert.equal(occursOn(routine("{not json"), "2026-10-24"), true);
});
