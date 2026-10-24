import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Side } from "../shared/api.ts";
import { AHEAD_DAYS, BACK_DAYS, calendarOf, escape, fold } from "../shared/ics.ts";
import { actionOccursOn, occursOn, plus, routineDay } from "../shared/routines.ts";
import type { ItemRow } from "../shared/tables.ts";
import { item } from "./domain-rows.ts";
import { parse, unescapeText } from "./ics-parse.ts";

const NOW = new Date("2026-10-24T03:00:00Z");

const TODAY = "2026-10-24";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

let next = 1;

const routine = (data: Record<string, unknown>, extra: Partial<ItemRow> = {}) =>
  item({ id: uuid(next++), kind: "routine", status: null, who: "a", title: "Routine", data, ...extra });

const timetable = (data: Record<string, unknown> = {}, extra: Partial<ItemRow> = {}) =>
  routine({ holidays: true, ...data }, { title: "Weekly timetable", group_key: "timetable", ...extra });

const block = (parent: ItemRow, title: string, data: Record<string, unknown>, extra: Partial<ItemRow> = {}) =>
  item({ id: uuid(next++), kind: "block", status: null, parent_id: parent.id, title, data, ...extra });

type Case = { name: string; side?: Side; now?: Date; holidays?: string[]; rows: () => ItemRow[]; has: string[]; lacks?: string[]; events: number };

const longTitle = "Seminar on the quiet harbour, the lighthouse and the long road home ".repeat(3).trim();

const cases: Case[] = [
  {
    name: "weekly-block",
    rows: () => {
      const t = timetable();
      return [t, block(t, "Class", { days: "MO", start_time: "09:00", end_time: "12:00", where: "Place A" })];
    },
    has: ["SUMMARY:Class", "DTSTART;TZID=Asia/Jakarta:20261019T090000", "DTEND;TZID=Asia/Jakarta:20261019T120000", "LOCATION:Place A", "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20270118T020000Z"],
    lacks: ["EXDATE", "DESCRIPTION", "INTERVAL"],
    events: 1,
  },
  {
    name: "multiple-days",
    rows: () => {
      const t = timetable();
      return [t, block(t, "Lab", { days: "MO,WE,FR", start_time: "13:00", end_time: "15:30", where: "Place B" })];
    },
    has: ["DTSTART;TZID=Asia/Jakarta:20261019T130000", "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20270122T060000Z"],
    events: 1,
  },
  {
    name: "open-end",
    rows: () => {
      const t = timetable();
      return [t, block(t, "Meeting", { days: "FR", start_time: "18:30", where: "Place B" })];
    },
    has: ["DTSTART;TZID=Asia/Jakarta:20261023T183000", "DESCRIPTION:open end", "LOCATION:Place B"],
    lacks: ["DTEND", "DURATION"],
    events: 1,
  },
  {
    name: "every-other-week",
    rows: () => [routine({ days: "SU", every_weeks: "2", from: "2026-10-04", start_time: "10:00", duration: 60 }, { title: "Deep clean" })],
    has: ["DTSTART;TZID=Asia/Jakarta:20261018T100000", "DURATION:PT60M", "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=SU;WKST=MO;UNTIL=20270110T030000Z"],
    events: 1,
  },
  {
    name: "until",
    rows: () => [routine({ days: "MO,TH", until: "2026-11-20", start_time: "08:00", duration: 30 }, { title: "Term routine" })],
    has: ["DTSTART;TZID=Asia/Jakarta:20261019T080000", "RRULE:FREQ=WEEKLY;BYDAY=MO,TH;UNTIL=20261119T010000Z"],
    events: 1,
  },
  {
    name: "paused",
    rows: () => [routine({ days: "MO,WE", paused_until: "2026-11-11", start_time: "08:00", duration: 30 }, { title: "Paused routine" })],
    has: ["DTSTART;TZID=Asia/Jakarta:20261111T080000", "BYDAY=MO,WE"],
    lacks: ["EXDATE"],
    events: 1,
  },
  {
    name: "paused-for-good",
    rows: () => [routine({ days: "MO", paused_until: "2027-03-01", start_time: "08:00", duration: 30 })],
    has: [],
    events: 0,
  },
  {
    name: "holidays",
    holidays: ["2026-11-02", "2026-11-30", "2027-01-18"],
    rows: () => {
      const t = timetable();
      return [t, block(t, "Class", { days: "MO", start_time: "09:00", end_time: "12:00" })];
    },
    has: ["EXDATE;TZID=Asia/Jakarta:20261102T090000,20261130T090000", "UNTIL=20270111T020000Z"],
    events: 1,
  },
  {
    name: "start-time-and-duration",
    rows: () => [routine({ days: "MO,TU,WE,TH,FR", start_time: "07:15", duration: 15 }, { title: "Bag" })],
    has: ["SUMMARY:Bag", "DTSTART;TZID=Asia/Jakarta:20261019T071500", "DURATION:PT15M", "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;UNTIL=20270122T001500Z"],
    lacks: ["DTEND", "DESCRIPTION"],
    events: 1,
  },
  {
    name: "default-duration",
    rows: () => [routine({ start_time: "21:00" }, { title: "Evening" })],
    has: ["DURATION:PT15M", "BYDAY=MO,TU,WE,TH,FR,SA,SU"],
    events: 1,
  },
  {
    name: "boundary-04-00",
    rows: () => {
      const t = timetable();
      return [
        t,
        block(t, "Late", { days: "TU", start_time: "03:59", end_time: "04:00" }),
        block(t, "Early", { days: "TU", start_time: "04:00", end_time: "05:00" }),
        block(t, "Midnight", { days: "TU", start_time: "00:00", end_time: "00:30" }),
      ];
    },
    has: ["DTSTART;TZID=Asia/Jakarta:20261020T035900", "DTEND;TZID=Asia/Jakarta:20261020T040000", "DTSTART;TZID=Asia/Jakarta:20261020T040000", "DTSTART;TZID=Asia/Jakarta:20261020T000000"],
    events: 3,
  },
  {
    name: "unicode",
    rows: () => {
      const t = timetable();
      return [t, block(t, "Kelas café ☕ 日本語 🎓", { days: "TH", start_time: "10:00", end_time: "11:00", where: "Pläce Ä" })];
    },
    has: ["SUMMARY:Kelas café ☕ 日本語 🎓", "LOCATION:Pläce Ä"],
    events: 1,
  },
  {
    name: "long-title",
    rows: () => {
      const t = timetable();
      return [t, block(t, longTitle, { days: "TH", start_time: "10:00", end_time: "11:00", where: "Place A ".repeat(20).trim() }), block(t, "日本語".repeat(40), { days: "FR", start_time: "10:00" })];
    },
    has: [],
    events: 2,
  },
  {
    name: "escaping",
    rows: () => {
      const t = timetable();
      return [t, block(t, "A, B; C \\ D\nE", { days: "SA", start_time: "10:00", end_time: "11:00", where: "Place A, wing; 2" })];
    },
    has: ["SUMMARY:A\\, B\\; C \\\\ D\\nE", "LOCATION:Place A\\, wing\\; 2"],
    events: 1,
  },
  {
    name: "twelve-blocks",
    rows: () => {
      const t = timetable();
      return [t, ...Array.from({ length: 12 }, (_, n) => block(t, `Slot ${n + 1}`, { days: "MO", start_time: `${String(7 + n).padStart(2, "0")}:00`, end_time: `${String(7 + n).padStart(2, "0")}:45`, where: n % 2 ? "Place B" : "Place A" })).reverse()];
    },
    has: ["SUMMARY:Slot 1\r\n", "SUMMARY:Slot 12\r\n"],
    events: 12,
  },
  {
    name: "private-excluded",
    rows: () => {
      const own = routine({ private: true, start_time: "06:00", duration: 30 }, { title: "Own private" });
      const theirs = routine({ private: true, start_time: "06:30", duration: 30 }, { title: "Their private", who: "b" });
      const sharedPrivate = routine({ private: true, start_time: "06:45", duration: 30 }, { title: "Both private", who: "both" });
      const t = timetable({ private: true });
      return [own, theirs, sharedPrivate, t, block(t, "Hidden block", { days: "MO", start_time: "09:00" }), routine({ start_time: "07:00", duration: 15 }, { title: "Open" })];
    },
    has: ["SUMMARY:Open"],
    lacks: ["private", "Own", "Their", "Both", "Hidden"],
    events: 1,
  },
  {
    name: "other-partner-excluded",
    rows: () => {
      const theirs = routine({ start_time: "07:00", duration: 15 }, { title: "Their routine", who: "b" });
      const t = timetable({}, { who: "b" });
      return [theirs, t, block(t, "Their class", { days: "MO", start_time: "09:00" }), routine({ start_time: "08:00", duration: 15 }, { title: "Mine" }), routine({ start_time: "08:30", duration: 15 }, { title: "Ours", who: "both" })];
    },
    has: ["SUMMARY:Mine", "SUMMARY:Ours"],
    lacks: ["Their"],
    events: 2,
  },
  {
    name: "other-partner-view",
    side: "b",
    rows: () => {
      const theirs = routine({ start_time: "07:00", duration: 15 }, { title: "A routine", who: "a" });
      const t = timetable({}, { who: "b" });
      return [theirs, t, block(t, "B class", { days: "MO", start_time: "09:00" }), routine({ start_time: "08:30", duration: 15 }, { title: "Ours", who: "both" })];
    },
    has: ["SUMMARY:B class", "SUMMARY:Ours"],
    lacks: ["A routine"],
    events: 2,
  },
  {
    name: "deleted-excluded",
    rows: () => {
      const gone = routine({ start_time: "07:00", duration: 15 }, { title: "Deleted routine", deleted_at: "2026-10-20T00:00:00Z" });
      const t = timetable();
      const orphan = timetable({}, { deleted_at: "2026-10-20T00:00:00Z", title: "Deleted timetable" });
      return [gone, t, block(t, "Deleted block", { days: "MO", start_time: "09:00" }, { deleted_at: "2026-10-20T00:00:00Z" }), block(orphan, "Orphan block", { days: "MO", start_time: "09:00" }), block(t, "Kept", { days: "MO", start_time: "10:00" })];
    },
    has: ["SUMMARY:Kept"],
    lacks: ["Deleted", "Orphan"],
    events: 1,
  },
  {
    name: "versions",
    rows: () => {
      const t = timetable({}, { rev: 7, updated_at: "2026-10-02T03:04:05Z" });
      return [t, block(t, "Class", { days: "MO", start_time: "09:00" }, { rev: 12, updated_at: "2026-10-01T00:00:00Z" }), block(t, "Moved", { days: "TU", start_time: "09:00" }, { rev: 3, updated_at: "2026-10-09T10:11:12Z" })];
    },
    has: ["SEQUENCE:12\r\nLAST-MODIFIED:20261002T030405Z", "SEQUENCE:7\r\nLAST-MODIFIED:20261009T101112Z"],
    events: 2,
  },
];

const FIXTURES = new URL("./fixtures/feed/", import.meta.url);

const render = (c: Case) => calendarOf(c.rows(), c.side ?? "a", c.now ?? NOW, c.holidays ?? []);

const windowDates = (today: string) => {
  const dates: string[] = [];
  for (let date = plus(today, -BACK_DAYS); date <= plus(today, AHEAD_DAYS); date = plus(date, 1)) dates.push(date);
  return dates;
};

for (const c of cases) {
  test(`feed case ${c.name}: matches the fixture, the hand-written lines and the strict parser`, () => {
    next = 1;
    const out = render(c);
    const file = new URL(`${c.name}.ics`, FIXTURES);
    if (process.env.UPDATE_FIXTURES === "1") {
      mkdirSync(FIXTURES, { recursive: true });
      writeFileSync(file, out);
    }
    assert.ok(existsSync(file), `fixture ${c.name}.ics is missing`);
    assert.equal(out, readFileSync(file, "utf8"));
    for (const line of c.has) assert.ok(out.includes(line), `missing ${JSON.stringify(line)}`);
    for (const line of c.lacks ?? []) assert.ok(!out.includes(line), `unexpected ${JSON.stringify(line)}`);
    const { events } = parse(out);
    assert.equal(events.length, c.events);
    assert.equal((out.match(/BEGIN:VEVENT/g) ?? []).length, c.events);
  });

  test(`feed case ${c.name}: every instance is a day the shared rule says it happens, and no day is missing`, () => {
    next = 1;
    const rows = c.rows();
    const side = c.side ?? "a";
    const holidays = c.holidays ?? [];
    const { events } = parse(calendarOf(rows, side, c.now ?? NOW, holidays));
    const byUid = new Map(events.map((event) => [event.uid, event]));
    const live = rows.filter((row) => row.deleted_at === null);
    const open = live.filter((row) => row.data?.private !== true && live.find((p) => p.id === row.parent_id)?.data?.private !== true);
    const dates = windowDates(routineDay(c.now ?? NOW));
    let wanted = 0;
    for (const row of open) {
      const parent = open.find((p) => p.id === row.parent_id) ?? row;
      const mineRow = parent.who === side || parent.who === "both";
      const timed = row.kind === "routine" ? typeof row.data?.start_time === "string" : row.kind === "block" && parent.kind === "routine";
      const expected = mineRow && timed && (row.kind === "routine" || row.kind === "block") ? dates.filter((date) => (row.kind === "block" ? actionOccursOn(parent, row, date, holidays) : occursOn(row, date, holidays))) : [];
      const event = byUid.get(`${row.id}@wp.atqamz.com`);
      if (expected.length === 0) {
        assert.equal(event, undefined, `${row.title} should be absent`);
        continue;
      }
      wanted++;
      assert.ok(event, `${row.title} should be present`);
      const time = String(row.data?.start_time);
      assert.deepEqual(event.instances, expected.map((date) => `${date}T${time}`), row.title);
    }
    assert.equal(wanted, events.length);
  });
}

test("every fixture file is used by a case and a case never rewrites it silently", () => {
  for (const c of cases) assert.ok(existsSync(new URL(`${c.name}.ics`, FIXTURES)), c.name);
});

test("the horizon reaches exactly 7 days back and 90 days ahead, and no further", () => {
  next = 1;
  const daily = routine({ start_time: "06:00", duration: 10 });
  const { events } = parse(calendarOf([daily], "a", NOW, []));
  const [{ instances }] = events;
  assert.equal(instances[0], `${plus(TODAY, -7)}T06:00`);
  assert.equal(instances.at(-1), `${plus(TODAY, 90)}T06:00`);
  assert.equal(instances.length, 98);
  assert.equal(instances[0], "2026-10-17T06:00");
  assert.equal(instances.at(-1), "2027-01-22T06:00");
});

test("a series that starts after the horizon or ended before it has no event; one that starts on day 90 has one", () => {
  next = 1;
  const edge = (data: Record<string, unknown>) => parse(calendarOf([routine({ start_time: "06:00", duration: 10, ...data })], "a", NOW, [])).events;
  assert.equal(edge({ from: "2027-01-23" }).length, 0);
  assert.equal(edge({ until: "2026-10-16" }).length, 0);
  assert.deepEqual(edge({ from: "2027-01-22" })[0].instances, ["2027-01-22T06:00"]);
  assert.deepEqual(edge({ until: "2026-10-17" })[0].instances, ["2026-10-17T06:00"]);
  assert.equal(edge({ from: "2027-01-22" })[0].rrule, null);
});

test("the horizon follows the routine day: 03:59 Jakarta is still yesterday, 04:00 is today", () => {
  next = 1;
  const firstDay = (iso: string) => parse(calendarOf([routine({ start_time: "06:00", duration: 10 })], "a", new Date(iso), [])).events[0].instances[0];
  assert.equal(firstDay("2026-10-23T20:59:00Z"), "2026-10-16T06:00");
  assert.equal(firstDay("2026-10-23T21:00:00Z"), "2026-10-17T06:00");
});

test("the output is stable: same rows in any order give the same bytes, and a second call too", () => {
  next = 1;
  const c = cases.find((entry) => entry.name === "twelve-blocks")!;
  const rows = c.rows();
  const once = calendarOf(rows, "a", NOW, []);
  assert.equal(calendarOf([...rows].reverse(), "a", NOW, []), once);
  assert.equal(calendarOf(rows, "a", NOW, []), once);
});

test("every line ends in CRLF, none is over 75 octets, and folded text unfolds to the original", () => {
  next = 1;
  const c = cases.find((entry) => entry.name === "long-title")!;
  const out = render(c);
  assert.ok(!/(^|[^\r])\n/.test(out));
  for (const line of out.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  const { events } = parse(out);
  assert.deepEqual(events.map((event) => event.summary).sort(), ["日本語".repeat(40), longTitle].sort());
  assert.ok(out.includes("\r\n "));
});

test("fold breaks only between characters and never exceeds 75 octets on any line", () => {
  for (const sample of ["a".repeat(200), "\u007f".repeat(80), "\u0080".repeat(80), "\u07ff".repeat(60), "\u0800".repeat(60), "\uffff".repeat(60), "\u{10000}".repeat(40), `${"a".repeat(74)}\u0080`, `${"a".repeat(73)}\u0800`, `${"a".repeat(72)}\u{10000}`, "é".repeat(100), "日".repeat(60), "🎓".repeat(40), `${"a".repeat(74)}é`, `${"a".repeat(73)}日`, "x".repeat(75), "x".repeat(76), ""]) {
    const folded = fold(sample);
    const lines = folded.split("\r\n");
    for (const line of lines) assert.ok(new TextEncoder().encode(line).length <= 75);
    assert.equal(lines.map((line, at) => (at === 0 ? line : line.slice(1))).join(""), sample);
    for (const line of lines.slice(1)) assert.equal(line[0], " ");
  }
  assert.equal(fold("x".repeat(75)), "x".repeat(75));
  assert.equal(fold("x".repeat(76)), `${"x".repeat(75)}\r\n x`);
  assert.equal(fold("x".repeat(75 + 74)), `${"x".repeat(75)}\r\n ${"x".repeat(74)}`);
  assert.equal(fold("x".repeat(75 + 75)), `${"x".repeat(75)}\r\n ${"x".repeat(74)}\r\n x`);
  assert.equal(fold(`${"a".repeat(74)}é`), `${"a".repeat(74)}\r\n é`);
});

test("escape handles backslash, semicolon, comma, newlines and drops control characters; the strict reader reverses it", () => {
  assert.equal(escape("a\\b;c,d"), "a\\\\b\\;c\\,d");
  assert.equal(escape("one\ntwo\r\nthree\rfour"), "one\\ntwo\\nthree\\nfour");
  assert.equal(escape("bell\u0007nul\u0000tab\there"), "bellnultab\there");
  for (const sample of ["plain", "a,b;c\\d", "\\n", "x\\", ";;,,\\\\", "日本語, café; ☕"]) assert.equal(unescapeText(escape(sample)), sample);
  assert.throws(() => unescapeText("a,b"));
  assert.throws(() => unescapeText("a\\qb"));
});

test("a title with a line break or a stray control character cannot add properties to the event", () => {
  next = 1;
  const t = timetable();
  const out = calendarOf([t, block(t, "Class\r\nATTENDEE:mailto:x@example.test\nEND:VEVENT", { days: "MO", start_time: "09:00" })], "a", NOW, []);
  const { events } = parse(out);
  assert.equal(events.length, 1);
  assert.ok(!/^ATTENDEE/m.test(out));
  assert.equal(events[0].summary, "Class\nATTENDEE:mailto:x@example.test\nEND:VEVENT");
});

test("only VEVENT components leave the Worker, and no action, note or url of a routine is in the feed", () => {
  next = 1;
  const r = routine({ start_time: "07:00", duration: 15, days: "MO" }, { title: "Bag", note: "NOTE-SECRET" });
  const step = item({ id: uuid(next++), kind: "step", status: null, parent_id: r.id, title: "STEP-SECRET", note: "NOTE-SECRET", data: { url: "https://example.test/STEP-SECRET" } });
  const out = calendarOf([r, step], "a", NOW, []);
  assert.ok(!/SECRET/.test(out));
  assert.deepEqual([...new Set(out.match(/^BEGIN:(\w+)/gm))].sort(), ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "BEGIN:VTIMEZONE", "BEGIN:STANDARD"].sort());
  assert.ok(!/VTODO|VALARM|VJOURNAL/.test(out));
});

test("a routine with an invalid start time or a block without one gives no event", () => {
  next = 1;
  const t = timetable();
  const out = calendarOf([routine({ start_time: "25:00" }), routine({ start_time: 700 }), routine({}), t, block(t, "No time", { days: "MO" }), block(t, "Bad time", { days: "MO", start_time: "9:00" })], "a", NOW, []);
  assert.equal(parse(out).events.length, 0);
});

test("an end time that is not after the start is treated as an open end; a zero or negative duration falls back to 15 minutes", () => {
  next = 1;
  const t = timetable();
  const open = parse(calendarOf([t, block(t, "Backwards", { days: "MO", start_time: "10:00", end_time: "09:00" }), block(t, "Equal", { days: "TU", start_time: "10:00", end_time: "10:00" })], "a", NOW, [])).events;
  assert.deepEqual(open.map((event) => [event.end, event.description]), [[null, "open end"], [null, "open end"]]);
  for (const duration of [0, -5, "30", null]) {
    assert.equal(parse(calendarOf([routine({ start_time: "10:00", duration })], "a", NOW, [])).events[0].minutes, 15, String(duration));
  }
  assert.equal(parse(calendarOf([routine({ start_time: "10:00", duration: 1 })], "a", NOW, [])).events[0].minutes, 1);
  assert.equal(parse(calendarOf([routine({ start_time: "23:50", duration: 600 })], "a", NOW, [])).events[0].minutes, 600);
});

test("every_weeks without a start week is ignored, as the shared rule ignores it: no INTERVAL, every week", () => {
  next = 1;
  const [event] = parse(calendarOf([routine({ days: "SU", every_weeks: "2", start_time: "10:00", duration: 30 })], "a", NOW, [])).events;
  assert.equal(event.rrule?.INTERVAL, undefined);
  assert.equal(event.rrule?.WKST, undefined);
  assert.equal(event.instances.length, 14);
  const [every] = parse(calendarOf([routine({ days: "SU", every_weeks: "1", from: "2026-10-04", start_time: "10:00", duration: 30 })], "a", NOW, [])).events;
  assert.equal(every.rrule?.INTERVAL, undefined);
  const [third] = parse(calendarOf([routine({ days: "SU", every_weeks: "3", from: "2026-10-04", start_time: "10:00", duration: 30 })], "a", NOW, [])).events;
  assert.equal(third.rrule?.INTERVAL, "3");
  assert.equal(third.rrule?.WKST, "MO");
  assert.deepEqual(third.instances.slice(0, 3), ["2026-10-25T10:00", "2026-11-15T10:00", "2026-12-06T10:00"]);
});

test("a weekday whose every date is a holiday leaves the rule and gets no EXDATE", () => {
  next = 1;
  const t = timetable();
  const tuesdays: string[] = [];
  for (let date = "2026-10-20"; date <= "2027-01-22"; date = plus(date, 7)) tuesdays.push(date);
  const out = calendarOf([t, block(t, "Class", { days: "MO,TU", start_time: "09:00" })], "a", NOW, [...tuesdays, "2026-11-09"]);
  const [event] = parse(out).events;
  assert.equal(event.rrule?.BYDAY, "MO");
  assert.deepEqual(event.exdates, ["20261109T090000"]);
  assert.ok(!out.includes("T090000,20"));
});

test("feeds with many scrambled entries come out in time order, then id, however the rows arrive", () => {
  next = 1;
  const t = timetable();
  const rows = [t, ...Array.from({ length: 40 }, (_, n) => block(t, `Slot ${n}`, { days: DAYS[n % 7], start_time: `${String(5 + (n % 17)).padStart(2, "0")}:${n % 2 ? "30" : "00"}` }))];
  let seed = 7;
  const shuffled = [...rows].sort(() => ((seed = (seed * 48271) % 2147483647) % 3) - 1);
  const out = calendarOf(shuffled, "a", NOW, []);
  assert.equal(out, calendarOf(rows, "a", NOW, []));
  const keys = parse(out).events.map((event) => `${event.instances[0]}`);
  assert.deepEqual(keys, [...keys].sort());
});

const DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
