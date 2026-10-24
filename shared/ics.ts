import type { Side } from "./api.ts";
import { DAY_CODES, actionOccursOn, mine, occursOn, plus, routineDay, visible, weekday } from "./routines.ts";
import type { Schedule } from "./routines.ts";
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
    .replace(/\r\n|\r|\n/g, "\\n");

const octets = (char: string) => {
  const point = char.codePointAt(0)!;
  return point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
};

export const fold = (line: string) => {
  const parts = [""];
  let size = 0;
  for (const char of line) {
    const width = octets(char);
    if (size + width > LINE_OCTETS) {
      parts.push("");
      size = 1;
    }
    parts[parts.length - 1] += char;
    size += width;
  }
  return parts.join("\r\n ");
};

const range = (from: string, to: string) => {
  const dates: string[] = [];
  for (let date = from; date <= to; date = plus(date, 1)) dates.push(date);
  return dates;
};

const instant = (when: number | string) => new Date(when).toISOString().replace(/[-:]|\.\d{3}/g, "");

const utc = (date: string, time: string) => instant(`${date}T${time}:00+07:00`);

const clock = (date: string, time: string) => `${date.replaceAll("-", "")}T${time.replace(":", "")}00`;

const local = (name: string, date: string, time: string) => `${name};TZID=${ZONE}:${clock(date, time)}`;

const loosened = (routine: ItemRow): ItemRow => ({ ...routine, data: { ...routine.data, paused_until: undefined } });

const holds = (entry: Entry, routine: ItemRow, date: string, holidays: readonly string[]) =>
  entry.block ? actionOccursOn(routine, entry.row, date, holidays) : occursOn(routine, date, holidays);

const entriesOf = (rows: readonly ItemRow[], side: Side): Entry[] => {
  const open = visible(
    rows.filter((row) => row.deleted_at === null),
    null,
  );
  const entries: Entry[] = [];
  for (const routine of open.filter((row) => row.kind === "routine" && mine(row, side))) {
    const start = text(routine.data?.start_time);
    const duration = routine.data?.duration;
    if (isTime(start)) {
      const minutes = typeof duration === "number" && duration >= 1 ? duration : DEFAULT_MINUTES;
      entries.push({ row: routine, routine, block: false, title: routine.title, start, end: null, minutes, where: null });
    }
    for (const row of open.filter((child) => child.kind === "block" && child.parent_id === routine.id)) {
      const data = row.data ?? {};
      const start = text(data.start_time);
      const end = text(data.end_time);
      if (!isTime(start)) continue;
      entries.push({ row, routine, block: true, title: row.title, start, end: isTime(end) && end > start ? end : null, minutes: null, where: text(data.where) || null });
    }
  }
  return entries;
};

const eventOf = (entry: Entry, window: readonly string[], holidays: readonly string[]) => {
  const dates = window.filter((date) => holds(entry, entry.routine, date, holidays));
  if (dates.length === 0) return null;
  const first = dates[0];
  const last = dates[dates.length - 1];
  const { row, routine } = entry;
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
    const days = DAY_CODES.filter((code) => dates.some((date) => weekday(date) === code));
    const rule = ["FREQ=WEEKLY", ...(interval > 1 ? [`INTERVAL=${interval}`] : []), `BYDAY=${days.join(",")}`, ...(interval > 1 ? ["WKST=MO"] : []), `UNTIL=${utc(last, entry.start)}`];
    lines.push(`RRULE:${rule.join(";")}`);
    const kept = new Set(dates);
    const loose = loosened(routine);
    const skipped = window.filter((date) => date > first && date < last && !kept.has(date) && days.includes(weekday(date)) && holds(entry, loose, date, []));
    if (skipped.length > 0) lines.push(`EXDATE;TZID=${ZONE}:${skipped.map((date) => clock(date, entry.start)).join(",")}`);
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
  const events = entriesOf(rows, side)
    .flatMap((entry) => eventOf(entry, window, holidays) ?? [])
    .sort((a, b) => (a.key < b.key ? -1 : 1));
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//wp//feed//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:wp", ...ZONE_LINES, ...events.flatMap((event) => event.lines), "END:VCALENDAR"];
  return lines.map((line) => `${fold(line)}\r\n`).join("");
};
