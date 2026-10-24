import { test } from "node:test";
import assert from "node:assert/strict";
import type { ItemRow } from "../shared/tables.ts";
import { formatDay } from "../src/ui/format.ts";
import { daysLine, momentLabel, scheduleLine, whenLine } from "../src/ui/routine-label.ts";
import { text } from "../src/ui/text.ts";
import { item } from "./domain-rows.ts";

const TODAY = "2026-10-26";

const routine = (data: Record<string, unknown> | null): ItemRow => item({ kind: "routine", status: null, who: "a", title: "Morning routine", data });

test("a moment is named from the fixed list, falls back to the typed text, and none reads as Other", () => {
  assert.deepEqual(["morning", "on_demand", "evening", "timetable"].map(momentLabel), ["Morning", "On demand", "Evening", "Timetable"]);
  assert.equal(momentLabel(null), "Other");
  assert.equal(momentLabel("late"), "late");
  assert.equal(momentLabel("constructor"), "constructor");
  assert.equal(momentLabel("toString"), "toString");
});

test("the days read as short names in week order, and no filter reads as nothing", () => {
  assert.equal(daysLine("MO,TH"), "Mo Th");
  assert.equal(daysLine("SA,SU"), "Sa Su");
  assert.equal(daysLine(undefined), null);
  assert.equal(daysLine(5), null);
});

test("the schedule line says every day, the days, and the cadence with its start", () => {
  assert.equal(scheduleLine(routine({}), TODAY), "Every day");
  assert.equal(scheduleLine(routine(null), TODAY), "Every day");
  assert.equal(scheduleLine(routine({ days: "MO,TH" }), TODAY), "Mo Th");
  assert.equal(scheduleLine(routine({ days: "SU", every_weeks: "1" }), TODAY), "Su");
  assert.equal(scheduleLine(routine({ days: "SU", every_weeks: "2", from: "2026-10-25" }), TODAY), `Su · Every 2 weeks from ${formatDay("2026-10-25", TODAY)}`);
  assert.equal(scheduleLine(routine({ every_weeks: "4" }), TODAY), "Every day · Every 4 weeks");
});

test("the when line says today, the next day, a pause, or that nothing is coming", () => {
  assert.equal(whenLine(routine({}), TODAY), "Today");
  assert.equal(whenLine(routine({ days: "TH" }), TODAY), `Next ${formatDay("2026-10-29", TODAY)}`);
  assert.equal(whenLine(routine({ paused_until: "2026-11-02" }), TODAY), `Paused until ${formatDay("2026-11-02", TODAY)}`);
  assert.equal(whenLine(routine({ paused_until: TODAY }), TODAY), "Today");
  assert.equal(whenLine(routine({ days: "MO", until: "2026-10-25" }), TODAY), text.routines.noNext);
  assert.equal(whenLine(routine({ days: "TU", paused_until: "2026-11-03" }), TODAY), `Paused until ${formatDay("2026-11-03", TODAY)}`);
  assert.equal(whenLine(routine({ days: "TU", paused_until: "2026-11-04" }), "2026-11-03"), `Paused until ${formatDay("2026-11-04", "2026-11-03")}`);
});
