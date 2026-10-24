import type { Side } from "./api.ts";
import { DAY_CODES, covers, mine, occursOn, plus, routineDay, visible, weekday } from "./routines.ts";
import type { DayCode, Schedule } from "./routines.ts";
import { DURATION_MAX } from "./tables.ts";
import type { ItemRow } from "./tables.ts";
import { isTime } from "./validate.ts";

export const ZONE = "Asia/Jakarta";

export const HOST = "wp.atqamz.com";

export const BACK_DAYS = 7;

export const AHEAD_DAYS = 90;

export const DEFAULT_MINUTES = 15;

const LINE_OCTETS = 75;

type Entry = { row: ItemRow; routine: ItemRow; block: boolean; title: string; start: string; end: string | null; minutes: number | null; where: string | null };

const text = (value: unknown) => (typeof value === "string" ? value : "");

export const escape = (value: string) =>
  value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[\\;,]/g, "\\$&")
    .replace(/\r\n|[\r\n\u0085\u2028\u2029]/g, "\\n");

export const fold = (line: string) => {
  const parts: string[] = [];
  let start = 0;
  let size = 0;
  for (let at = 0; at < line.length; at++) {
    const unit = line.charCodeAt(at);
    const pair = unit >= 0xd800 && unit <= 0xdbff && line.charCodeAt(at + 1) >= 0xdc00 && line.charCodeAt(at + 1) <= 0xdfff;
    const width = pair ? 4 : unit < 0x80 ? 1 : unit < 0x800 ? 2 : 3;
    if (size + width > LINE_OCTETS) {
      parts.push(line.slice(start, at));
      start = at;
      size = 1;
    }
    size += width;
    if (pair) at++;
  }
  parts.push(line.slice(start));
  return parts.join("\r\n ");
};

type Day = { date: string; code: DayCode };

const range = (from: string, to: string) => {
  const days: Day[] = [];
  for (let date = from; date <= to; date = plus(date, 1)) days.push({ date, code: weekday(date) });
  return days;
};

const instant = (when: number | string) => {
  const iso = new Date(when).toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
};

const utc = (date: string, time: string) => instant(`${date}T${time}:00+07:00`);

const clock = (date: string, time: string) => `${date.replaceAll("-", "")}T${time.replace(":", "")}00`;

const local = (name: string, date: string, time: string) => `${name};TZID=${ZONE}:${clock(date, time)}`;

const loosened = (routine: ItemRow): ItemRow => ({ ...routine, data: { ...routine.data, paused_until: undefined } });

type Flags = (routine: ItemRow) => boolean[];

const entriesOf = (rows: readonly ItemRow[], side: Side): Entry[] => {
  const open = visible(
    rows.filter((row) => row.deleted_at === null),
    null,
  );
  const blocks = new Map<string, ItemRow[]>();
  for (const row of open) if (row.kind === "block" && row.parent_id !== null) blocks.set(row.parent_id, [...(blocks.get(row.parent_id) ?? []), row]);
  const entries: Entry[] = [];
  for (const routine of open.filter((row) => row.kind === "routine" && mine(row, side))) {
    const start = text(routine.data?.start_time);
    const duration = routine.data?.duration;
    if (isTime(start)) {
      const minutes = typeof duration === "number" && duration >= 1 ? Math.min(duration, DURATION_MAX) : DEFAULT_MINUTES;
      entries.push({ row: routine, routine, block: false, title: routine.title, start, end: null, minutes, where: null });
    }
    for (const row of blocks.get(routine.id) ?? []) {
      const data = row.data ?? {};
      const start = text(data.start_time);
      const end = text(data.end_time);
      if (!isTime(start)) continue;
      entries.push({ row, routine, block: true, title: row.title, start, end: isTime(end) && end > start ? end : null, minutes: null, where: text(data.where) || null });
    }
  }
  return entries;
};

const eventOf = (entry: Entry, window: readonly Day[], held: Flags, loosely: Flags) => {
  const { row, routine } = entry;
  const only = row.data?.days;
  const listed = (day: Day) => !entry.block || covers(only, day.code);
  const hits = held(routine);
  const dates = window.filter((day, at) => hits[at] && listed(day));
  if (dates.length === 0) return null;
  const first = dates[0].date;
  const last = dates[dates.length - 1].date;
  const stamp = instant(Math.max(Date.parse(row.updated_at), Date.parse(routine.updated_at)));
  const lines = [
    "BEGIN:VEVENT",
    `UID:${row.id}@${HOST}`,
    `DTSTAMP:${stamp}`,
    `SEQUENCE:${Math.max(row.rev, routine.rev)}`,
    `LAST-MODIFIED:${stamp}`,
    `SUMMARY:${escape(entry.title)}`,
    local("DTSTART", first, entry.start),
  ];
  if (entry.end !== null) lines.push(local("DTEND", first, entry.end));
  if (entry.minutes !== null) lines.push(`DURATION:PT${entry.minutes}M`);
  if (dates.length > 1) {
    const { every_weeks, from } = (routine.data ?? {}) as Schedule;
    const interval = from !== undefined && Number(every_weeks) > 1 ? Number(every_weeks) : 1;
    const codes = new Set(dates.map((day) => day.code));
    const days = DAY_CODES.filter((code) => codes.has(code));
    const rule = ["FREQ=WEEKLY", ...(interval > 1 ? [`INTERVAL=${interval}`] : []), `BYDAY=${days.join(",")}`, ...(interval > 1 ? ["WKST=MO"] : []), `UNTIL=${utc(last, entry.start)}`];
    lines.push(`RRULE:${rule.join(";")}`);
    const skipped: Day[] = [];
    let loose: boolean[] | undefined;
    window.forEach((day, at) => {
      if (day.date > first && day.date < last && !hits[at] && codes.has(day.code) && (loose ??= loosely(routine))[at]) skipped.push(day);
    });
    if (skipped.length > 0) lines.push(`EXDATE;TZID=${ZONE}:${skipped.map((day) => clock(day.date, entry.start)).join(",")}`);
  }
  if (entry.where !== null) lines.push(`LOCATION:${escape(entry.where)}`);
  if (entry.end === null && entry.minutes === null) lines.push("DESCRIPTION:open end");
  lines.push("END:VEVENT");
  return { key: `${first}T${entry.start}${row.id}`, lines };
};

const ZONE_LINES = [
  "BEGIN:VTIMEZONE",
  `TZID:${ZONE}`,
  "BEGIN:STANDARD",
  "DTSTART:19700101T000000",
  "TZOFFSETFROM:+0700",
  "TZOFFSETTO:+0700",
  "TZNAME:WIB",
  "END:STANDARD",
  "END:VTIMEZONE",
];

export const calendarOf = (rows: readonly ItemRow[], side: Side, now: Date, holidays: readonly string[] = []) => {
  const today = routineDay(now);
  const window = range(plus(today, -BACK_DAYS), plus(today, AHEAD_DAYS));
  const flags = (loose: boolean): Flags => {
    const seen = new Map<string, boolean[]>();
    return (routine) => {
      let known = seen.get(routine.id);
      if (known === undefined) {
        const subject = loose ? loosened(routine) : routine;
        const { days, from, until, paused_until } = (subject.data ?? {}) as Schedule;
        known = window.map((day) => covers(days, day.code) && (from === undefined || day.date >= from) && (until === undefined || day.date <= until) && (paused_until === undefined || day.date >= paused_until) && occursOn(subject, day.date, loose ? [] : holidays));
        seen.set(routine.id, known);
      }
      return known;
    };
  };
  const held = flags(false);
  const loosely = flags(true);
  const events = entriesOf(rows, side)
    .flatMap((entry) => eventOf(entry, window, held, loosely) ?? [])
    .sort((a, b) => (a.key < b.key ? -1 : 1));
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//wp//feed//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:wp", ...ZONE_LINES, ...events.flatMap((event) => event.lines), "END:VCALENDAR"];
  return lines.map((line) => `${fold(line)}\r\n`).join("");
};
