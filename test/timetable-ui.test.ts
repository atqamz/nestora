import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HELD_MS, press } from "../src/ui/press.ts";
import { text } from "../src/ui/text.ts";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const css = read("views/routines.css");

const rule = (selector: string) => new RegExp(`(?:^|\\n)${selector.replace(/[.>*[\]="():]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

const copy = text.routines;

test("them today takes its rows from the filtered hook and the one pure function, and reads no storage or network", () => {
  const them = read("views/them.tsx");
  assert.match(them, /const \{ items, me \} = useRoutines\(\);/);
  assert.match(them, /themToday\(items, me, day\)/);
  assert.match(them, /const \{ day, elapsed \} = useRoutineClock\(\);/);
  assert.match(them, /marks\(them\.slots, elapsed\)/);
  assert.doesNotMatch(them, /useSnapshot\(|useTable\(|rows\.items|fetch *\(|indexedDB|XMLHttpRequest|localStorage|sessionStorage|sendBeacon|new Date|Date\.now|setInterval/);
  assert.match(them, /if \(them\.routines\.length === 0\) return null;/);
  assert.match(read("views/home.tsx"), /<Today \/>\s*<Them \/>/);
});

test("them today is read-only: no checkbox, no button, no write flow, only a link", () => {
  const files = ["views/them.tsx", "ui/timetable.tsx"].map(read).join("\n");
  assert.doesNotMatch(files, /<button|<input|useRoutineFlows|flows\.|actions\./);
  assert.match(files, /<a href=/);
});

test("the clock hook reads the minute of the routine day from one state and watches the clock through one helper", () => {
  const hook = read("hooks/use-routines.ts");
  assert.match(hook, /useEffect\(\(\) => watch\(\(\) => setValue\(read\(\)\)\), \[\]\);/);
  assert.match(hook, /useRoutineClock = \(\) => clockAt\(useReading\(\(\) => minuteOf\(new Date\(\)\)\)\);/);
  assert.match(hook, /export const useRoutineDay = \(\) => useReading\(\(\) => routineDay\(new Date\(\)\)\);/);
});

test("the week is a labelled group of seven sections, each with a heading and a list or a plain empty line, and today is marked by aria-current and a word", () => {
  const view = read("ui/timetable.tsx");
  assert.match(view, /<div className="rt-tt" role="group" aria-label=\{copy\.timetable\.week\}>/);
  assert.match(view, /<section key=\{date\} className="rt-tt-day" aria-labelledby=\{`tt-\$\{date\}`\} aria-current=\{here \? "date" : undefined\}/);
  assert.match(view, /<h2 id=\{`tt-\$\{date\}`\}>/);
  assert.match(view, /\{here && <span className="rt-tag">\{copy\.timetable\.today\}<\/span>\}/);
  assert.match(view, /<ul className="rt-slots">/);
  assert.match(view, /<p className="empty rt-tt-none">\{copy\.timetable\.free\}<\/p>/);
  assert.equal(copy.timetable.free, "Nothing planned");
  assert.equal(copy.timetable.today, "Today");
});

test("the times are drawn short and read in words: from 09:30 to 10:30, from 18:30 with no end, and no time set", () => {
  const view = read("ui/timetable.tsx");
  assert.match(view, /<span aria-hidden="true">\{start === "" \? copy\.timetable\.noTime : copy\.timeRange\(start, end\)\}<\/span>/);
  assert.match(view, /<span className="visually-hidden">\{copy\.timeSpoken\(start, end\)\}<\/span>/);
  assert.equal(copy.timeSpoken("09:30", "10:30"), "from 09:30 to 10:30");
  assert.equal(copy.timeSpoken("18:30", null), "from 18:30, no end time");
  assert.equal(copy.timeSpoken("", null), "no time set");
  assert.equal(copy.timeRange("09:30", "10:30"), "09:30–10:30");
  assert.equal(copy.timeRange("18:30", null), "18:30–…");
  assert.match(read("ui/routine-action.tsx"), /<Times start=\{word\(action, "start_time"\) \?\? ""\} end=\{word\(action, "end_time"\)\} \/>/);
});

test("a slot says now and next in words, and a finished one is said to be finished to a screen reader and struck through for the eye", () => {
  const view = read("ui/timetable.tsx");
  assert.match(view, /\{mark\?\.tag && <span className="rt-tag">\{copy\.them\[mark\.tag\]\}<\/span>\}/);
  assert.match(view, /\{mark\?\.state === "done" && <span className="visually-hidden">\{copy\.them\.done\}<\/span>\}/);
  assert.match(view, /data-state=\{mark\?\.state\} data-tag=\{mark\?\.tag \?\? undefined\}/);
  assert.deepEqual([copy.them.now, copy.them.next, copy.them.done, copy.them.title], ["Now", "Next", "Finished", "Them today"]);
  assert.match(rule('.rt-slot[data-state="done"] .rt-slot-b'), /text-decoration:\s*line-through/);
  assert.match(rule('.rt-slot[data-tag]'), /box-shadow:\s*inset var\(--route-w\) 0 0 var\(--signal\)/);
});

test("the week and the slots wrap long labels, fit 320 px with one column, and never use fixed widths or nowrap", () => {
  assert.match(rule(".rt-tt"), /grid-template-columns:\s*repeat\(auto-fit, minmax\(min\(100%, 18rem\), 1fr\)\)/);
  assert.match(rule(".rt-tt-day"), /min-width:\s*0/);
  assert.match(rule(".rt-slot"), /flex-wrap:\s*wrap/);
  assert.match(rule(".rt-slot"), /min-height:\s*var\(--target-min\)/);
  assert.match(rule(".rt-slot-b"), /min-width:\s*0;[^}]*overflow-wrap:\s*anywhere/);
  assert.match(rule(".rt-slot-t"), /min-width:\s*5\.5rem/);
  assert.match(rule(".rt-tt-day h2"), /flex-wrap:\s*wrap/);
  assert.match(rule(".rt-tt-day h2"), /min-height:\s*var\(--target-min\)/);
  assert.doesNotMatch(css, /white-space:\s*nowrap/);
  assert.doesNotMatch(rule(".rt-slot-t") + rule(".rt-tt-day") + rule(".rt-slot"), /[^-]width:\s*\d/);
});

test("the timetable detail replaces the block rows with the week, keeps other actions listed, and the list offers a new timetable", () => {
  const detail = read("views/routine.tsx");
  assert.match(detail, /const table = isTimetable\(routine\);/);
  assert.match(detail, /const listed = table \? actions\.filter\(\(action\) => action\.kind !== "block"\) : actions;/);
  assert.match(detail, /\{table && <Timetable days=\{weekOf\(routine, actions, day\)\} today=\{day\} \/>\}/);
  const list = read("views/routines.tsx");
  assert.match(list, /setSheet\(\{ kind: "timetable" \}\)/);
  assert.match(list, /blankDraft\(me, sheet\.kind === "timetable" \? TIMETABLE : undefined\)/);
  assert.equal(copy.newTimetable, "New timetable");
});

test("the sheet in the timetable moment offers only blocks, only one owner at a time, no routine days, and shows block days and an overlap hint inline", () => {
  const sheet = read("ui/routine-sheet.tsx");
  assert.match(sheet, /const timetable = draft\.moment === TIMETABLE;/);
  assert.match(sheet, /ACTION_KINDS\.filter\(\(kind\) => !timetable \|\| KINDS_IN_TIMETABLE\.includes\(kind\)\)/);
  assert.match(sheet, /const KINDS_IN_TIMETABLE: readonly ActionKind\[\] = \["block"\];/);
  assert.match(sheet, /\.\.\.\(timetable \? \[\] : \[\{ value: "both", label: text\.both, icon: <Pair \/> \}\]\)/);
  assert.match(sheet, /\{!timetable && <DayChips label=\{form\.days\}/);
  assert.match(sheet, /onChange: \(moment\) => set\(\{ moment \}\)/);
  assert.match(sheet, /savePlan\(forTimetable\(draft, me\), opened/);
  assert.match(sheet, /\{slot && <DayChips label=\{form\.days\} days=\{action\.days\} hint=\{form\.blockDaysHint\}/);
  assert.match(sheet, /\{clash !== null && <p className="hint rt-clash">\{clash\}<\/p>\}/);
  assert.match(sheet, /hint: slot && field === "end" \? form\.endHint : undefined/);
  assert.doesNotMatch(sheet, /role="alert"[^>]*rt-clash|rt-clash[^>]*role="alert"/);
  assert.equal(copy.form.overlaps("Block 1, Block 2"), "Overlaps with Block 1, Block 2. That is allowed.");
  assert.equal(copy.form.endHint, "Leave empty if there is no end time.");
});

test("the time fields are the native time input, so a 12-hour phone widget still hands over HH:MM", () => {
  const sheet = read("ui/routine-sheet.tsx");
  assert.match(sheet, /start: "time", end: "time"/);
  assert.match(read("ui/field.tsx"), /type === "date" \|\| type === "time"\s*\? \{ type \}/);
});

test("a tap swallowed by the settle guard marks the control pressed for a moment and then lets go", () => {
  class Fake {
    dataset: Record<string, string> = {};
    found: Fake | null;
    constructor(found: Fake | null = null) {
      this.found = found;
    }
    closest() {
      return this.found;
    }
  }
  (globalThis as { Element?: unknown }).Element = Fake;
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const control = new Fake();
    const inner = new Fake(control);
    press(inner as unknown as EventTarget);
    assert.equal("held" in control.dataset, true);
    mock.timers.tick(HELD_MS - 1);
    assert.equal("held" in control.dataset, true);
    mock.timers.tick(1);
    assert.equal("held" in control.dataset, false);
    press(new Fake(null) as unknown as EventTarget);
    press(null);
    press({} as EventTarget);
    assert.equal(HELD_MS, 200);
  } finally {
    mock.timers.reset();
    delete (globalThis as { Element?: unknown }).Element;
  }
});

test("a pressed control shows a ring and a smaller size, with no animation and no opacity", () => {
  assert.match(rule(".start [data-held]"), /outline:\s*3px solid var\(--focus\);[^}]*transform:\s*scale\(0\.97\)/);
  assert.doesNotMatch(rule(".start [data-held]"), /opacity|transition|animation/);
  assert.match(read("views/routine-start.tsx"), /press\(event\.target\);/);
});
