export type Instance = string;

export type Event = {
  uid: string;
  summary: string;
  location: string | null;
  description: string | null;
  sequence: number;
  modified: string;
  stamp: string;
  start: string;
  end: string | null;
  minutes: number | null;
  rrule: Record<string, string> | null;
  exdates: string[];
  instances: Instance[];
};

type Line = { name: string; params: Record<string, string>; value: string };

type Component = { name: string; lines: Line[]; parts: Component[] };

const OFFSET_MS = 7 * 3_600_000;

const DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

const fail = (message: string): never => {
  throw new Error(message);
};

const octets = (text: string) => new TextEncoder().encode(text).length;

const unfold = (source: string) => {
  if (!source.endsWith("\r\n")) fail("must end with CRLF");
  const physical = source.slice(0, -2).split("\r\n");
  const logical: string[] = [];
  for (const line of physical) {
    if (/[\r\n]/.test(line)) fail("bare CR or LF");
    if (octets(line) > 75) fail(`line over 75 octets: ${line.slice(0, 20)}`);
    if (line === "") fail("empty line");
    if (line[0] === " " || line[0] === "\t") {
      if (logical.length === 0) fail("fold before any line");
      logical[logical.length - 1] += line.slice(1);
    } else logical.push(line);
  }
  return logical;
};

const lineOf = (text: string): Line => {
  const match = /^([A-Z0-9-]+)((?:;[A-Z0-9-]+=[^;:",]+)*):(.*)$/s.exec(text);
  if (match === null) return fail(`bad content line: ${text.slice(0, 40)}`);
  const params = Object.fromEntries(match[2].split(";").filter(Boolean).map((part) => part.split("=") as [string, string]));
  return { name: match[1], params, value: match[3] };
};

const tree = (lines: string[]): Component => {
  const stack: Component[] = [];
  let root: Component | null = null;
  for (const text of lines) {
    const line = lineOf(text);
    if (line.name === "BEGIN") {
      const component: Component = { name: line.value, lines: [], parts: [] };
      if (stack.length === 0) {
        if (root !== null) fail("second top-level component");
        root = component;
      } else stack[stack.length - 1].parts.push(component);
      stack.push(component);
    } else if (line.name === "END") {
      if (stack.pop()?.name !== line.value) fail(`END:${line.value} mismatch`);
    } else if (stack.length === 0) fail("line outside a component");
    else stack[stack.length - 1].lines.push(line);
  }
  if (stack.length > 0) fail("unclosed component");
  return root ?? fail("no component");
};

export const unescapeText = (value: string) => {
  let out = "";
  for (let at = 0; at < value.length; at++) {
    const char = value[at];
    if (char === "\\") {
      const next = value[++at];
      if (next === "n" || next === "N") out += "\n";
      else if (next === "\\" || next === ";" || next === ",") out += next;
      else fail(`bad escape \\${next}`);
    } else if (char === "," || char === ";") fail("unescaped separator in text");
    else if (/[\u0000-\u0008\u000a-\u001f\u007f]/.test(char)) fail("control character in text");
    else out += char;
  }
  return out;
};

const one = (lines: Line[], name: string) => {
  const found = lines.filter((line) => line.name === name);
  if (found.length > 1) fail(`duplicate ${name}`);
  return found[0] ?? null;
};

const localStamp = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})00$/;

const localMs = (value: string) => {
  const m = localStamp.exec(value) ?? fail(`bad local time ${value}`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
};

const localText = (ms: number) => new Date(ms).toISOString().slice(0, 16);

const utcMs = (value: string) => {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value) ?? fail(`bad UTC time ${value}`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + OFFSET_MS;
};

const zoned = (line: Line, zone: string) => {
  if (line.params.TZID !== zone) fail(`${line.name} lacks TZID=${zone}`);
  return line.value;
};

const rrule = (value: string) => {
  const parts = Object.fromEntries(value.split(";").map((part) => part.split("=") as [string, string]));
  const allowed = ["FREQ", "INTERVAL", "BYDAY", "WKST", "UNTIL"];
  if (Object.keys(parts).some((key) => !allowed.includes(key)) || value.split(";").length !== Object.keys(parts).length) fail(`bad RRULE ${value}`);
  if (parts.FREQ !== "WEEKLY") fail("FREQ must be WEEKLY");
  if (parts.INTERVAL !== undefined && !/^[2-9]\d*$/.test(parts.INTERVAL)) fail("bad INTERVAL");
  if (parts.WKST !== undefined && parts.WKST !== "MO") fail("bad WKST");
  const days = (parts.BYDAY ?? "").split(",");
  if (!days.every((day) => DAYS.includes(day)) || new Set(days).size !== days.length) fail("bad BYDAY");
  return parts;
};

const expand = (start: string, rule: Record<string, string>, skip: Set<number>) => {
  const first = localMs(start);
  const until = utcMs(rule.UNTIL ?? fail("RRULE needs UNTIL"));
  const interval = Number(rule.INTERVAL ?? 1);
  const days = rule.BYDAY.split(",").map((day) => DAYS.indexOf(day));
  const dayMs = 86_400_000;
  const monday = first - ((new Date(first).getUTCDay() + 6) % 7) * dayMs - (first % dayMs);
  const instances: number[] = [];
  for (let week = monday; week <= until; week += interval * 7 * dayMs) {
    for (const day of [...days].sort((a, b) => a - b)) {
      const at = week + day * dayMs + (first % dayMs);
      if (at >= first && at <= until && !skip.has(at)) instances.push(at);
    }
  }
  return instances;
};

export const parse = (source: string) => {
  const calendar = tree(unfold(source));
  if (calendar.name !== "VCALENDAR") fail("not a VCALENDAR");
  if (one(calendar.lines, "VERSION")?.value !== "2.0") fail("VERSION must be 2.0");
  if (one(calendar.lines, "PRODID") === null) fail("PRODID missing");
  const zones = calendar.parts.filter((part) => part.name === "VTIMEZONE");
  const others = calendar.parts.filter((part) => part.name !== "VTIMEZONE" && part.name !== "VEVENT");
  if (others.length > 0) fail(`unexpected component ${others[0].name}`);
  if (zones.length !== 1) fail("exactly one VTIMEZONE");
  const zone = one(zones[0].lines, "TZID")?.value ?? fail("VTIMEZONE needs TZID");
  const standard = zones[0].parts;
  if (standard.length !== 1 || standard[0].name !== "STANDARD") fail("one STANDARD part");
  const sOffset = (name: string) => one(standard[0].lines, name)?.value;
  if (sOffset("TZOFFSETFROM") !== "+0700" || sOffset("TZOFFSETTO") !== "+0700" || one(standard[0].lines, "DTSTART") === null) fail("zone offsets");
  const seen = new Set<string>();
  const events = calendar.parts
    .filter((part) => part.name === "VEVENT")
    .map((part): Event => {
      if (part.parts.length > 0) fail("VEVENT must not nest");
      const { lines } = part;
      const text = (name: string) => {
        const line = one(lines, name);
        return line === null ? null : unescapeText(line.value);
      };
      const uid = one(lines, "UID")?.value ?? fail("UID missing");
      if (!/^[^@\s]+@wp\.atqamz\.com$/.test(uid) || seen.has(uid)) fail(`bad or duplicate UID ${uid}`);
      seen.add(uid);
      const startLine = one(lines, "DTSTART") ?? fail("DTSTART missing");
      const start = zoned(startLine, zone);
      const endLine = one(lines, "DTEND");
      const durationLine = one(lines, "DURATION");
      if (endLine !== null && durationLine !== null) fail("DTEND and DURATION together");
      const end = endLine === null ? null : zoned(endLine, zone);
      if (end !== null && localMs(end) <= localMs(start)) fail("DTEND not after DTSTART");
      const minutes = durationLine === null ? null : Number(/^PT(\d+)M$/.exec(durationLine.value)?.[1] ?? fail("bad DURATION"));
      const rule = one(lines, "RRULE");
      const parsed = rule === null ? null : rrule(rule.value);
      const exdates = lines.filter((line) => line.name === "EXDATE").flatMap((line) => zoned(line, zone).split(","));
      if (exdates.length > 0 && parsed === null) fail("EXDATE without RRULE");
      const skip = new Set(exdates.map(localMs));
      const instances = parsed === null ? [localMs(start)] : expand(start, parsed, skip);
      if (!instances.includes(localMs(start))) fail("DTSTART is not the first instance");
      for (const gone of skip) if (!expand(start, parsed ?? fail("no rule"), new Set()).includes(gone)) fail("EXDATE is not an instance of the rule");
      const stamp = one(lines, "DTSTAMP")?.value ?? fail("DTSTAMP missing");
      utcMs(stamp);
      const modified = one(lines, "LAST-MODIFIED")?.value ?? fail("LAST-MODIFIED missing");
      utcMs(modified);
      const sequence = Number(/^\d+$/.test(one(lines, "SEQUENCE")?.value ?? "") ? one(lines, "SEQUENCE")?.value : fail("SEQUENCE missing"));
      const allowed = ["UID", "DTSTAMP", "SEQUENCE", "LAST-MODIFIED", "SUMMARY", "DTSTART", "DTEND", "DURATION", "RRULE", "EXDATE", "LOCATION", "DESCRIPTION"];
      for (const line of lines) if (!allowed.includes(line.name)) fail(`unexpected property ${line.name}`);
      return {
        uid,
        summary: text("SUMMARY") ?? fail("SUMMARY missing"),
        location: text("LOCATION"),
        description: text("DESCRIPTION"),
        sequence,
        modified,
        stamp,
        start,
        end,
        minutes,
        rrule: parsed,
        exdates,
        instances: instances.map(localText),
      };
    });
  return { zone, events };
};
