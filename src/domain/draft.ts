import type { Side } from "../../shared/api.ts";
import { addDays } from "./dates.ts";
import { parseRupiah } from "./money.ts";
import { sideName } from "./names.ts";
import { normalizePhone } from "./phone.ts";

export type Kind = "task" | "planned" | "payment" | "guest" | "vendor" | "book";

export type Field = "amount" | "due" | "who" | "phone" | "line";

export type Line = { id: string; title: string; vendor: string | null };

export type Context = {
  today: string;
  me: Side | null;
  nicknames: { a: string | null; b: string | null };
  lines: readonly Line[];
};

export type Draft = {
  title: string;
  kind: "task" | "payment";
  amount: number | null;
  due: string | null;
  who: Side | "both" | null;
  line: string | null;
  phone: string | null;
};

type State = { rest: string; gone: Uint8Array; hold: Uint8Array; read: string[]; spans: Spans };

export type Spans = (state: State, start: number, end: number, mark: Uint8Array) => void;

export const blank: Spans = (state, start, end, mark) => {
  state.rest = `${state.rest.slice(0, start)}${" ".repeat(end - start)}${state.rest.slice(end)}`;
  mark.fill(1, start, end);
};

const begin = (text: string, spans: Spans = blank): State => ({ rest: text, gone: new Uint8Array(text.length), hold: new Uint8Array(text.length), read: [], spans });

const START = "(?<![\\p{L}\\p{N}_\\u2212-])";
const AMOUNT_START = "(?<![\\p{L}\\p{N}_.,\\u2212-])";
const END = "(?![\\p{L}\\p{N}_])";
const MAX_AMOUNT = 999_999_999_999_999;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const WEEKDAY = "(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thu|friday|fri|saturday|sat)";
const DATE_LEAD = "(?:(?:by|on|due|before|until)\\s+)?";
const AMOUNT_LEAD = "(?:(?:for|at)\\s+)?";
const MEASURE_AHEAD = "(?!\\s*(?:kg|g|gr|gram|l|ml|cm|mm|m|km|pcs|pax|people|portions|persons|tiers|x|%)(?![\\p{L}\\p{N}_]))";
const UNIT_AHEAD = "(?!\\s*(?:jt|juta|rb|ribu|k)(?![\\p{L}\\p{N}_]))";
const UNITS: Record<string, number> = { k: 1_000, rb: 1_000, ribu: 1_000, jt: 1_000_000, juta: 1_000_000 };

const OPAQUE = /:\/\/|@|^www\./i;

const opaque = (text: string, at: number) => {
  let from = at;
  while (from > 0 && !/\s/.test(text[from - 1])) from--;
  let to = at;
  while (to < text.length && !/\s/.test(text[to])) to++;
  return OPAQUE.test(text.slice(from, to));
};

const after = (match: RegExpExecArray) => match.index + String.fromCodePoint(match[0].codePointAt(0) ?? 0x20).length;

const take = <T>(state: State, pattern: RegExp, read: (match: RegExpExecArray) => T | null): T | null => {
  pattern.lastIndex = 0;
  for (let match = pattern.exec(state.rest); match !== null; match = pattern.exec(state.rest)) {
    const end = match.index + match[0].length;
    if (end === match.index || state.hold.subarray(match.index, end).includes(1)) pattern.lastIndex = after(match);
    else if (!opaque(state.rest, match.index)) {
      const value = read(match);
      if (value !== null) {
        state.read.push(match[0]);
        state.spans(state, match.index, end, state.gone);
        return value;
      }
    }
  }
  return null;
};

const iso = (year: number, month: number, day: number) => {
  const at = new Date(Date.UTC(year, month - 1, day));
  const valid = at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day;
  return valid ? at.toISOString().slice(0, 10) : null;
};

const upcoming = (today: string, month: number, day: number) => {
  const year = Number(today.slice(0, 4));
  for (let ahead = 0; ahead <= 8; ahead++) {
    const date = iso(year + ahead, month, day);
    if (date !== null && date >= today) return date;
  }
  return null;
};

const weekday = (today: string, word: string, next: boolean) => {
  const target = WEEKDAYS.indexOf(word.slice(0, 3).toLowerCase());
  const now = new Date(`${today}T00:00:00Z`).getUTCDay();
  const ahead = (target - now + 7) % 7 || 7;
  return addDays(today, next ? ahead + 7 : ahead);
};

const dateOf = (state: State, today: string): string | null => {
  const pattern = (body: string) => new RegExp(`${START}${DATE_LEAD}${body}${END}`, "giu");
  const year = (text: string | undefined) => (text === undefined ? null : text.length === 2 ? 2000 + Number(text) : Number(text));
  const named = (day: string, month: string, text: string | undefined) => {
    const [d, m, y] = [Number(day), MONTHS.indexOf(month.slice(0, 3).toLowerCase()) + 1, year(text)];
    return y === null ? upcoming(today, m, d) : iso(y, m, d);
  };
  return (
    take(state, pattern("(\\d{4})-(\\d{2})-(\\d{2})"), (m) => iso(Number(m[1]), Number(m[2]), Number(m[3]))) ??
    take(state, pattern(`(\\d{1,2})(?:st|nd|rd|th)?\\s*${MONTH}(?:,?\\s+(\\d{4}))?`), (m) => named(m[1], m[2], m[3])) ??
    take(state, pattern(`${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`), (m) => named(m[2], m[1], m[3])) ??
    take(state, pattern(`(\\d{1,2})/(\\d{1,2})(?:/(\\d{4}|\\d{2}))?${MEASURE_AHEAD}`), (m) => {
      const y = year(m[3]);
      return y === null ? upcoming(today, Number(m[2]), Number(m[1])) : iso(y, Number(m[2]), Number(m[1]));
    }) ??
    take(state, pattern("today"), () => today) ??
    take(state, pattern("tomorrow"), () => addDays(today, 1)) ??
    take(state, pattern(`(?:(next|this)\\s+)?${WEEKDAY}`), (m) => weekday(today, m[2], m[1]?.toLowerCase() === "next"))
  );
};

const unitAmount = (whole: string, fraction: string, unit: string) => {
  const multiplier = UNITS[unit.toLowerCase()];
  const value = Number(whole) * multiplier + Math.round(Number(`0.${fraction || "0"}`) * multiplier);
  return value <= MAX_AMOUNT ? value : null;
};

const amountOf = (state: State): number | null => {
  const rupiah = "(?:rp\\.?\\s*)?";
  return (
    take(state, new RegExp(`${AMOUNT_START}${AMOUNT_LEAD}${rupiah}(\\d{1,12})(?:[.,](\\d{1,3}))?\\s*(jt|juta|rb|ribu|k)${END}`, "giu"), (m) => unitAmount(m[1], m[2] ?? "", m[3])) ??
    take(state, new RegExp(`${AMOUNT_START}${AMOUNT_LEAD}rp\\.?\\s*(\\d+(?:[.,]\\d+)*)(?![\\d.,])${UNIT_AHEAD}`, "giu"), (m) => parseRupiah(m[1])) ??
    take(state, new RegExp(`(?<![\\p{L}\\p{N}_./,-])${AMOUNT_LEAD}(?!0)(\\d{1,3}(?:[.,]\\d{3})+)(?![\\p{L}\\p{N}_/-]|[.,]\\d)${UNIT_AHEAD}`, "giu"), (m) => {
      const value = parseRupiah(m[1]);
      return value !== null && String(value).length >= 5 ? value : null;
    })
  );
};

export const parseAmount = (input: string): number | null => {
  const text = input.trim();
  const plain = parseRupiah(text);
  if (plain !== null) return plain;
  const state = begin(text);
  const read = amountOf(state);
  return state.rest.trim() === "" ? read : null;
};

const PHONE_TOKEN = /^[(+]?\d[\d)-]*$/;

const COUNTRY = /^(?:\+\d{2,15}|62\d{0,13})(?:[ -]\d{2,5}){0,4}$/;

const MOBILE = /^08\d{2,3}(?:([ -])\d{3,5}(?:\1\d{3,5}){0,2})?$/;

const LOCAL_RUN = /^0\d{8,12}$/;

const LANDLINE = /^(?:\(0[1-79]\d{0,2}\)[ -]?|0[1-79]\d{0,2}[ -])(\d{5,8}|\d{3,4}(?:[ -]\d{3,4}){1,2})$/;

const MAX_PHONE_LENGTH = 30;

const digitCount = (text: string) => text.replace(/\D/g, "").length;

const between = (value: number, low: number, high: number) => value >= low && value <= high;

export const isPhone = (text: string): boolean => {
  if (text.length > MAX_PHONE_LENGTH) return false;
  const digits = digitCount(text);
  if (text.startsWith("+")) return COUNTRY.test(text) && between(digits, 9, 15);
  if (text.startsWith("62")) return COUNTRY.test(text) && between(digits, 11, 14);
  if (MOBILE.test(text)) return between(digits, 9, 13);
  if (LOCAL_RUN.test(text)) return true;
  const landline = LANDLINE.exec(text);
  return landline !== null && between(digits, 8, 12) && between(digitCount(landline[1]), 5, 8);
};

const MAX_PHONE_TOKENS = 6;

const PHONE_NEXT = /(?:[\p{L}\p{N}_/]|[.,]\d)/uy;

const AMOUNT_NEXT = /\s*(?:jt|juta|rb|ribu|k)(?![\p{L}\p{N}_])/iuy;

const MONTH_NEXT = new RegExp(`\\s*${MONTH}(?![\\p{L}\\p{N}_])`, "iuy");

const at = (pattern: RegExp, text: string, index: number) => {
  pattern.lastIndex = index;
  return pattern.test(text);
};

const phoneOf = (state: State, keep: boolean): string | null => {
  const rest = state.rest;
  const tokens = [...rest.matchAll(/\S+/gu)].map((match) => ({ start: match.index, end: match.index + match[0].length, text: match[0] }));
  const starts = (text: string) => /^[(+]?\d/.test(text);
  for (let first = 0; first < tokens.length; first++) {
    const head = tokens[first];
    if (!starts(head.text) || OPAQUE.test(head.text) || (first > 0 && /^rp\.?$/i.test(tokens[first - 1].text))) continue;
    let last = first;
    while (last + 1 < tokens.length && last + 1 - first < MAX_PHONE_TOKENS && tokens[last + 1].start - tokens[last].end === 1 && PHONE_TOKEN.test(tokens[last].text) && starts(tokens[last + 1].text)) last++;
    for (let count = last - first + 1; count >= 1; count--) {
      const raw = rest.slice(head.start, tokens[first + count - 1].end);
      if (raw.length > MAX_PHONE_LENGTH + 4) continue;
      const text = raw.replace(/\s/g, " ").replace(/[.,;:!?]+$/, "");
      const end = head.start + text.length;
      const words = tokens.slice(first, first + count).some((token, index) => index > 0 && (at(AMOUNT_NEXT, rest, token.end) || (token.text.length <= 2 && at(MONTH_NEXT, rest, token.end))));
      if (words || at(PHONE_NEXT, rest, end) || !PHONE_TOKEN.test(text.slice(text.lastIndexOf(" ") + 1)) || !isPhone(text)) continue;
      const phone = normalizePhone(text);
      if (phone === null) continue;
      state.spans(state, head.start, end, keep ? state.hold : state.gone);
      if (keep) return null;
      state.read.push(text);
      return phone;
    }
  }
  return null;
};

const escaped = (phrase: string) => phrase.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");

const phrase = (name: string) => new RegExp(`${START}${escaped(name)}${END}`, "iu");

const mentions = (input: string, name: string) => new RegExp(escaped(name), "iu").test(input) && phrase(name).test(input);

const NO_FALLBACK = { you: "", them: "", both: "both", nobody: "" };

const vocabulary = ({ me, nicknames }: Context): [string, Side | "both"][] => {
  const other = me === "a" ? "b" : "a";
  const pronouns: [string, Side][] = me === null ? [] : [["me", me], ["mine", me], ["them", other], ["theirs", other]];
  const names = (["a", "b", "both"] as const).map((who): [string, Side | "both"] => [sideName(who, me, nicknames, NO_FALLBACK), who]);
  return [...names, ...pronouns].filter(([word]) => word.trim() !== "").sort((a, b) => b[0].length - a[0].length);
};

const ownerOf = (state: State, context: Context): Draft["who"] => {
  const found = new Set<Side | "both">();
  for (const [word, who] of vocabulary(context)) {
    const pattern = new RegExp(`${START}${escaped(word)}(?:['\u2019]s)?${END}`, "giu");
    while (take(state, pattern, () => who) !== null) found.add(who);
  }
  return found.has("both") || (found.has("a") && found.has("b")) ? "both" : found.has("a") ? "a" : found.has("b") ? "b" : null;
};

const MIN_NAME = 3;

const lineOf = (input: string, lines: readonly Line[]): string | null => {
  const hits = lines.flatMap((line) =>
    [line.title, line.vendor].flatMap((name) => (name !== null && name.trim().length >= MIN_NAME && mentions(input, name) ? [{ id: line.id, size: name.trim().length }] : [])),
  );
  return hits.sort((a, b) => b.size - a.size)[0]?.id ?? null;
};

export const STORED: Record<Kind, readonly Field[]> = {
  task: ["amount", "due", "who"],
  planned: ["amount"],
  payment: ["amount", "due", "who"],
  guest: ["phone", "who"],
  vendor: ["amount", "phone"],
  book: [],
};

const READ_IN_TEXT: readonly Field[] = ["amount", "due", "who", "phone"];

const parse = (input: string, context: Context, ignore: ReadonlySet<Field>, spans: Spans): { draft: Draft; read: string[] } => {
  const state = begin(input, spans);
  const phone = phoneOf(state, ignore.has("phone"));
  const due = ignore.has("due") ? null : dateOf(state, context.today);
  const amount = ignore.has("amount") ? null : amountOf(state);
  const who = ignore.has("who") ? null : ownerOf(state, context);
  const line = ignore.has("line") ? null : lineOf(input, context.lines);
  let kept = "";
  for (let at = 0; at < input.length; at++) kept += state.gone[at] === 1 ? " " : input[at];
  const tidy = kept
    .replace(/[([{]\s*[)\]}]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:[\u2013\u2014-]+ )+|(?: [\u2013\u2014-]+)+$/g, "")
    .replace(/\s+([.,;:!?)\]}])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/[,;:]+\s*([.!?])/g, "$1")
    .replace(/^[\s,;:]+|[\s,;:]+$/g, "");
  const title = /[\p{L}\p{N}]/u.test(tidy) ? tidy : "";
  return { draft: { title, kind: amount !== null && line !== null ? "payment" : "task", amount, due, who, line, phone }, read: state.read };
};

export const parseDraft = (input: string, context: Context, ignore: ReadonlySet<Field> = new Set()): Draft => parse(input, context, ignore, blank).draft;

export const fallbacks = { count: 0 };

const letters = (text: string) => [...text.matchAll(/[\p{L}\p{N}]/gu)].map(([char]) => char);

export const lossless = (input: string, title: string, read: readonly string[]) => {
  const typed = letters(input);
  const kept = letters(title);
  let at = 0;
  for (const char of typed) if (char === kept[at]) at++;
  return at === kept.length && [...kept, ...read.flatMap(letters)].sort().join("") === [...typed].sort().join("");
};

export const draftFor = (input: string, context: Context, ignore: ReadonlySet<Field>, pick: Kind | null, spans: Spans = blank): { draft: Draft; kind: Kind } => {
  const first = parse(input, context, ignore, spans);
  const kind = pick ?? first.draft.kind;
  const blocked = READ_IN_TEXT.filter((field) => !STORED[kind].includes(field) && !ignore.has(field));
  const second = blocked.length === 0 ? first : parse(input, context, new Set([...ignore, ...blocked]), spans);
  const both = kind === "guest" && second.draft.who === "both";
  const { draft, read } = both ? parse(input, context, new Set([...ignore, ...blocked, "who"]), spans) : second;
  if (lossless(input, draft.title, read)) return { kind, draft };
  fallbacks.count++;
  return { kind: pick ?? "task", draft: { title: input.trim(), kind: "task", amount: null, due: null, who: null, line: null, phone: null } };
};
