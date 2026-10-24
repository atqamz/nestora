import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { text } from "../src/ui/text.ts";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const files = ["views/routine-start.tsx", "ui/start-page.tsx", "ui/routine-week.tsx", "hooks/use-now.ts", "hooks/use-wake-lock.ts", "ui/chime.ts"];

const css = read("views/routines.css");

const rule = (selector: string) => new RegExp(`(?:^|\\n)${selector.replace(/[.>*[\]="():]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? "";

const start = read("views/routine-start.tsx");

const page = read("ui/start-page.tsx");

test("the route is #/routines/<id>/start, any other third segment is not found, and the screen takes its rows only from the filtered hook", () => {
  assert.match(read("main.tsx"), /const \[section = "", id, sub\] = route\.split\("\/"\)\.filter\(Boolean\);/);
  assert.match(read("main.tsx"), /case "routines":\s*return <Routines id=\{id\} sub=\{sub\} \/>;/);
  assert.match(read("main.tsx"), /<Page section=\{section\} id=\{id\} sub=\{sub\} \/>/);
  const routes = read("views/routines.tsx");
  assert.match(routes, /return sub === "start" \? <RoutineStart key=\{id\} id=\{id\} \/> : <Title>\{text\.notFound\}<\/Title>;/);
  assert.match(start, /const rows = useRoutines\(\);\s*const flows = useRoutineFlows\(rows\);/);
  assert.match(start, /items\.find\(\(row\) => row\.id === id && row\.kind === "routine"\)/);
  assert.match(start, /<Title>\{copy\.missing\}<\/Title>/);
  for (const file of files) assert.doesNotMatch(read(file), /useTable\(|useSnapshot\(|readItems|rows\.items|fetch *\(|indexedDB|XMLHttpRequest|localStorage|sendBeacon/, file);
  assert.equal(text.routines.missing, "This routine is not available");
});

test("a tick goes through the same flows as the list, with the displayed day, and an advance waits for a successful write", () => {
  assert.match(start, /flows\.toggle\(routine, action\)/);
  assert.match(start, /flows\.plus\(routine, action\)/);
  assert.match(start, /const result = await work\(\);\s*setFailure\(failureOf\(result\)\);\s*if \(result\.ok\) then\?\.\(\);/);
  assert.match(start, /const write = \(work: \(\) => ReturnType<Flows\["toggle"\]>, then\?: \(\) => void\) =>\s*once\(/);
  assert.doesNotMatch(start, /actions\.|hooks\/use-store|new Date|Date\.now/);
  assert.match(page, /lead === "next" \? next\(\) : done\(action\)/);
  assert.doesNotMatch(page, /flows\./);
});

test("the position derives from the ticks and is read again when the routine day changes", () => {
  assert.match(start, /useState\(\(\) => placeOf\(pages, position\(pages, side, day, timers\.running\(me, routine\.id\)\)\)\)/);
  assert.match(start, /if \(shown !== day\) \{\s*setShown\(day\);\s*timers\.keep\(me, routine\.id, null\);\s*setPlace\(placeOf\(pages, position\(pages, side, day\)\)\);\s*setMessage\(start\.newDay\);\s*\}/);
  assert.match(start, /const screen = screenOf\(pages, place, side, day\);\s*const \{ at, open \} = screen;/);
  assert.match(start, /const followed = follow\(pages, place\);\s*if \(followed !== place\) setPlace\(followed\);/);
});

test("the countdown is derived from the stored end instant on every render, and nothing counts ticks", () => {
  assert.match(page, /const current = phase\(timer, now\);/);
  assert.match(page, /timers\.write\(me, routine\.id, action\.id, next\)/);
  assert.match(page, /useState\(\(\) => timers\.read\(me, routine\.id, action\.id\)\)/);
  assert.match(page, /begin\(minutes, at\)/);
  assert.doesNotMatch(page + start, /left\s*[-+]=|remaining\s*[-+]=|setLeft|setSeconds|count\s*[-+]=\s*1/);
  const hook = read("hooks/use-now.ts");
  assert.match(hook, /const refresh = \(\) => setNow\(Date\.now\(\)\);/);
  for (const event of ["visibilitychange", "pageshow", "focus"]) assert.match(hook, new RegExp(`${event}", refresh`));
  assert.match(hook, /return \(\) => \{\s*clearInterval\(timer\);/);
  assert.equal([...read("hooks/use-routines.ts").matchAll(/new Date\(/g)].length, 2);
});

test("the timer ends with a sound made after a tap, a vibration where there is one and a visual change, and the sound is honest about autoplay", () => {
  assert.match(page, /chime\.unlock\(\);\s*set\(begin\(minutes, at\)\);/);
  assert.match(page, /chime\.play\(\);\s*navigator\.vibrate\?\.\(\[200, 100, 200\]\);/);
  assert.match(page, /\{chime\.locked\(\) && <p className="hint">\{start\.locked\}<\/p>\}/);
  assert.match(start, /onPointerUp=\{touch\}/);
  assert.match(start, /const touch = \(\) => \{\s*chime\.unlock\(\);/);
  const chime = read("ui/chime.ts");
  assert.match(chime, /context \?\?= new AudioContext\(\)/);
  assert.match(chime, /context\.resume\(\)\.catch\(/);
  assert.match(chime, /createOscillator/);
  assert.doesNotMatch(chime, /new Audio\(|\.mp3|\.wav|\.ogg|fetch/);
  assert.match(rule(".start-over"), /background:\s*var\(--signal\)/);
  assert.match(page, /data-phase=\{current\.name\}/);
});

test("the countdown is not announced every second: it is a timer with live off, and the status line speaks at the start, at the end and on request", () => {
  assert.match(page, /role="timer" aria-live="off"/);
  assert.match(page, /say\(start\.timer\.began\(/);
  assert.match(page, /say\(start\.timer\.over\(action\.title\)\)/);
  assert.match(page, /say\(start\.timer\.remaining\(start\.timer\.spoken\(left\)\)\)/);
  assert.match(start, /<p className="visually-hidden" role="status">\s*\{page === undefined && !idle \? ending : message\}\s*<\/p>/);
  assert.equal([...(page + start).matchAll(/aria-live=/g)].length, 2);
  assert.match(page, /className="start-clock start-tally" aria-live="polite"/);
});

test("focus moves to the new primary button on an advance, Escape exits, and a held key never repeats a button", () => {
  assert.match(start, /useEffect\(\(\) => \{\s*if \(!moved\.current\) return;\s*root\.current\?\.querySelector<HTMLElement>\("\[data-primary\]"\)\?\.focus\(\);\s*\}, \[current\]\);/);
  assert.match(start, /event\.key === "Escape" && !event\.defaultPrevented && exit\(\)/);
  assert.match(start, /const exit = \(\) => \{\s*timers\.keep\(me, routine\.id, null\);\s*location\.replace\(`#\/routines\/\$\{routine\.id\}`\);\s*\};/);
  assert.match(start, /onKeyDown=\{\(event\) => \{\s*if \(event\.repeat\) event\.preventDefault\(\);\s*\}\}/);
  assert.match(start, /setMessage\(clamped >= total \? "" : start\.announce\(/);
  assert.match(read("ui/routine-action.tsx"), /className="rt-plus"[^>]*onKeyDown=\{\(event\) => event\.repeat && event\.preventDefault\(\)\}/);
});

test("the wake lock is requested on entry and again when the page is shown, and released on unmount and on pagehide", () => {
  const hook = read("hooks/use-wake-lock.ts");
  assert.match(hook, /keepAwake\(\(navigator as \{ wakeLock\?: WakeApi \}\)\.wakeLock, setState\)/);
  assert.match(hook, /document\.visibilityState === "visible" && void held\.acquire\(\)/);
  assert.match(hook, /addEventListener\("pagehide", leave\)/);
  assert.match(hook, /return \(\) => \{[^}]*removeEventListener\("pagehide", leave\);[^}]*leave\(\);/s);
  assert.match(start, /if \(wake\.state !== "held"\) wake\.again\(\);/);
  assert.match(start, /wake\.state !== "idle" && <p className="hint start-awake">\{wake\.state === "held" \? start\.awake : start\.mayDim\}<\/p>/);
  assert.doesNotMatch(hook + read("domain/wake-lock.ts"), /alert\(|throw /);
});

test("Start mode is a full screen: the bars are hidden, the targets are big, nothing animates and the clock fits the width", () => {
  const shell = read("style.css");
  assert.match(shell, /\.shell:has\(\[data-full\]\) \.chrome,\s*\.shell:has\(\[data-full\]\) \.tabs \{\s*display: none;/);
  assert.match(shell, /\.shell:has\(\[data-full\]\) \{\s*display: block;/);
  assert.match(start, /className="start"\s*data-full/);
  assert.match(rule(".start-do > .start-main"), /grid-column:\s*1 \/ -1;\s*min-height:\s*4\.5rem/);
  assert.match(rule(".start-alt"), /min-height:\s*3\.5rem/);
  assert.match(rule(".start-tick"), /min-height:\s*4\.5rem/);
  assert.match(rule(".start-foot > *"), /min-height:\s*3\.5rem/);
  assert.match(rule(".start-page"), /container-type:\s*inline-size/);
  assert.match(rule(".start-clock"), /100cqi/);
  assert.match(rule(".start-do"), /minmax\(min\(100%, 9rem\), 1fr\)/);
  for (const selector of [".start-title", ".start-note", ".start-clock", ".start-tick", ".start-name"]) assert.match(rule(selector), /overflow-wrap:\s*anywhere/, selector);
  assert.match(css, /\.start-do > button,\s*\.start-do > a \{[^}]*min-width: 0;[^}]*overflow-wrap: anywhere;/);
  const own = css.slice(css.indexOf(".start {"));
  assert.doesNotMatch(own, /transition|animation|@keyframes/);
  assert.doesNotMatch(css, /white-space:\s*nowrap/);
});

test("the week strip is a list of seven days, today is marked by aria-current, and the compact row clamps a long label to one line", () => {
  const week = read("ui/routine-week.tsx");
  assert.match(week, /<ol className="rt-week" data-compact=\{compact\} aria-label=\{copy\.week\.label\}>/);
  assert.match(week, /aria-current=\{today \? "date" : undefined\}/);
  assert.match(week, /aria-label=\{copy\.week\.day\(copy\.dayNames\[day\], label, done\)\}/);
  assert.match(rule(".rt-week"), /repeat\(auto-fit, minmax\(3rem, 1fr\)\)/);
  assert.match(rule(".rt-week[data-compact]"), /repeat\(auto-fit, minmax\(2\.25rem, 1fr\)\)/);
  assert.match(rule(".rt-week[data-compact] .rt-week-l"), /-webkit-line-clamp:\s*1/);
  assert.match(rule(".rt-week li[aria-current=\"date\"]"), /border-color:\s*var\(--ink\)/);
  assert.equal(text.routines.week.day("Monday", "Day type 1", false), "Monday: Day type 1");
  assert.equal(text.routines.week.day("Monday", null, true), "Monday: no day label, done");
});

test("the detail and the Today block lead into Start, and the strip shows on both", () => {
  const detail = read("views/routine.tsx");
  assert.match(detail, /\{today && !away && pagesOf\(todays\)\.length > 0 && \(\s*<a className="button" href=\{`#\/routines\/\$\{routine\.id\}\/start`\}>/);
  assert.match(detail, /\{strip !== null && <RoutineWeek strip=\{strip\} \/>\}/);
  const today = read("views/today.tsx");
  assert.match(today, /href=\{`#\/routines\/\$\{routine\.id\}\/start`\} aria-label=\{copy\.start\.openNamed\(routine\.title\)\}/);
  assert.match(today, /weekStrip\(routine, actionsOf\(items, routine\), day, side\)/);
  assert.match(today, /<RoutineWeek strip=\{strip\} compact \/>/);
});

test("the sheet plans its save from the snapshot taken when it opened and from the live rows, through one helper", () => {
  const sheet = read("ui/routine-sheet.tsx");
  assert.match(sheet, /const \[opened\] = useState\(current\);/);
  assert.match(sheet, /const plan = savePlan\(forTimetable\(draft, me\), opened, current, \(\) => crypto\.randomUUID\(\)\);/);
  assert.doesNotMatch(sheet, /planOf\(|const opened = /);
  assert.equal([...sheet.matchAll(/savePlan\(/g)].length, 1);
  assert.match(read("domain/routine-draft.ts"), /export const savePlan = \(draft: RoutineDraft, opened: Current \| null, current: Current \| null, newId: \(\) => string\): Plan => planOf\(draft, opened, current\?\.actions \?\? \[\], newId\);/);
});

test("a save that edits an action removed on another device is refused with a plain notice, and the action drops out of the sheet", () => {
  const sheet = read("ui/routine-sheet.tsx");
  assert.match(sheet, /setFailure\(lost\.map\(\(action\) => form\.gone\(action\.title\.trim\(\) \|\| form\.untitled\)\)\)/);
  assert.match(sheet, /if \(lost\.length > 0\) setDraft\(\(was\) => \(\{ \.\.\.was, actions: was\.actions\.filter\(\(action\) => !plan\.gone\.includes\(action\.id\)\) \}\)\);/);
  assert.match(sheet, /setProblems\(lost\.length > 0 \? \[\] : plan\.problems\)/);
  assert.equal(text.routines.form.gone("item 2"), "item 2: This action was removed on another device.");
  assert.doesNotMatch(read("domain/routine-draft.ts"), /deleted_at: null/);
});

test("a move clamps the target, focuses the new primary button, starts the settle time and announces the page by its place", () => {
  assert.match(start, /const clamped = clampTo\(to, total\);\s*moved\.current = true;\s*since\.current = performance\.now\(\);\s*setFailure\(\[\]\);\s*setPlace\(placeOf\(pages, clamped\)\);/);
  assert.match(start, /start\.announce\(clamped \+ 1, total, heading\(pages\[clamped\]\)\)/);
});

test("each timer action gets its own countdown: the component is keyed by the action, and the page by the day and the position", () => {
  assert.match(page, /<Timing key=\{action\.id\} \{\.\.\.props\} action=\{action\}/);
  assert.match(start, /<div className="start-page" key=\{`\$\{day\}:\$\{current \?\? "end"\}`\}>/);
  assert.equal([...page.matchAll(/useState\(/g)].length, 1);
});

test("a tap within the settle time of a page change is cancelled for the whole screen, and the clock is the monotonic one", () => {
  assert.match(start, /const since = useRef\(performance\.now\(\)\);/);
  assert.match(start, /since\.current = performance\.now\(\);\s*setFailure\(\[\]\);/);
  assert.match(start, /onClickCapture=\{\(event\) => \{\s*if \(settled\(since\.current, performance\.now\(\)\)\) return;\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*press\(event\.target\);\s*\}\}/);
  assert.doesNotMatch(start, /setTimeout|Date\.now/);
});

test("a timer belongs to its action: only the current page keeps one, and leaving the screen or a new day drops them all", () => {
  assert.match(start, /useEffect\(\(\) => timers\.keep\(me, routine\.id, current\), \[me, routine\.id, current\]\);/);
  assert.match(start, /const current = page\?\.\[0\]\.id \?\? null;/);
  assert.equal([...start.matchAll(/timers\.keep\(me, routine\.id, null\)/g)].length, 2);
  assert.match(page, /timers\.write\(me, routine\.id, action\.id, next\)/);
});

test("the status line and the screen read the end of the list from one value, and a list with nothing to tick never says all done", () => {
  assert.match(start, /const ending = open === 0 \? start\.finished : start\.left\(open\);/);
  assert.equal([...start.matchAll(/start\.finished\b/g)].length, 1);
  assert.equal([...start.matchAll(/start\.left\(/g)].length, 1);
  assert.match(start, /<h2 className="start-title">\{ending\}<\/h2>/);
  assert.match(start, /const idle = screen\.kind === "idle";/);
  assert.match(start, /const page = screen\.kind === "page" \? screen\.page : undefined;/);
  assert.match(start, /\) : idle \? \(\s*<>\s*<h2 className="start-title">\{start\.nothing\}<\/h2>/);
  assert.match(start, /\{!idle && <span className="start-pos">/);
});
