import { LONGTEXT_MAX, TEXT_MAX, VISIBLE } from "../../shared/validate.ts";

export type Warning = "missing_author" | "cut" | "joined" | "bad_isbn" | "place_unknown" | "exists" | "twice" | "hidden";

export type Candidate = {
  title: string;
  original_title: string;
  author: string;
  rated_elsewhere: string;
  blurb: string;
  warnings: Warning[];
};

const AUTHOR_LABELS = ["Penulis", "Author"];
const RATING_LABELS = ["Rating"];
const SYNOPSIS_LABELS = ["Sinopsis", "Synopsis"];

const NOT_ORIGINAL = /^(?:(?:edisi|edition|cetakan|novel|film)\b|(?:vol(?:ume)?|jilid|seri|series|buku|book|bagian|part)\.?\s*(?:\d+|[ivx]+)?$)/iu;

const RATING = /~?\s?\d+(?:[.,]\d+)?(?:\s?\/\s?\d+(?:[.,]\d+)?)?/u;

const LABEL = new RegExp(
  `(?<!\\p{L})(?:(${AUTHOR_LABELS.join("|")})|(?:${RATING_LABELS.join("|")})(?:\\s+(\\p{L}[\\p{L}\\p{N}]*))?|(${SYNOPSIS_LABELS.join("|")}))\\s*:`,
  "giu",
);

const MARK = /(?<![\p{L}\p{N}])(?<!\/ ?)(\d{1,3})\.(?!\d)/gu;

const seen = (value: string) => (VISIBLE.test(value) ? value : "");

export const tidy = (input: string) =>
  seen(
    input
      .replace(/\r\n?|[\u2028\u2029\u0085]/g, "\n")
      .replace(/[^\S\n]+/g, " ")
      .replace(/(?!\u200d|\n)[\p{Cc}\p{Cf}\p{Cs}]/gu, "")
      .replace(/ ?\n ?/g, "\n")
      .trim(),
  );

export const line = (input: string) => tidy(input).replace(/\n+/g, " ");

export const readLine = (input: string, warnings: Warning[]) => {
  const out = line(input);
  if (out === "" && input.trim() !== "") warnings.push("hidden");
  return out;
};

export const fit = (input: string, max: number, warnings: Warning[]) => {
  if (input.length <= max) return input;
  warnings.push("cut");
  const room = max - 1;
  const space = input.lastIndexOf(" ", room);
  let end = space > room / 2 ? space : room;
  if (/[\uD800-\uDBFF]/.test(input[end - 1])) end--;
  return `${input.slice(0, end).trimEnd()}…`;
};

const within = (positions: readonly number[], from: number, to: number) => {
  let low = 0;
  let high = positions.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (positions[mid] < from) low = mid + 1;
    else high = mid;
  }
  return low < positions.length && positions[low] < to;
};

type Piece = { body: string; joined: boolean };

const piecesOf = (text: string): Piece[] => {
  const marks = [...text.matchAll(MARK)];
  const labels = [...text.matchAll(LABEL)].map((label) => label.index);
  const ends = marks.map((mark, at) => mark.index + mark[0].length);
  const upTo = (at: number) => marks[at + 1]?.index ?? text.length;
  const trusted = marks.map((_, at) => labels.length === 0 || within(labels, ends[at], upTo(at)));
  const following: (number | null)[] = [];
  let ahead: number | null = null;
  for (let at = marks.length - 1; at >= 0; at--) {
    following[at] = ahead;
    if (trusted[at]) ahead = Number(marks[at][1]);
  }
  const chosen: { start: number; end: number; number: number; joined: boolean; stop?: number }[] = [];
  let skipped: number | null = null;
  marks.forEach((mark, at) => {
    const number = Number(mark[1]);
    const start = mark.index;
    const last = chosen.at(-1);
    const lineStart = start === 0 || text[start - 1] === "\n";
    const continues = last === undefined ? number === 1 || lineStart : number === (skipped ?? last.number) + 1;
    const plausible = continues || (last !== undefined && number === 1);
    if (!plausible && !(labels.length > 0 && trusted[at])) return;
    const rest = text.slice(ends[at], upTo(at)).trim();
    if (!trusted[at] && !(continues && (following[at] === number + 1 || (lineStart && rest !== "")))) {
      if (last && rest === "") {
        last.stop ??= start;
        skipped = number;
      } else if (last) last.joined = true;
      return;
    }
    skipped = null;
    chosen.push({ start, end: ends[at], number, joined: false });
  });
  if (chosen.length === 0) return text.split("\n").filter((row) => row !== "").map((body) => ({ body, joined: false }));
  return chosen.map((entry, at) => ({ body: text.slice(entry.end, entry.stop ?? chosen[at + 1]?.start ?? text.length), joined: entry.joined }));
};

export const splitTitle = (heading: string): { title: string; original: string } => {
  const open = heading.lastIndexOf("(");
  const inner = heading.slice(open + 1, -1).trim();
  const title = heading.slice(0, Math.max(open, 0)).trim();
  const original = open > 0 && heading.endsWith(")") && title !== "" && !inner.includes(")") && inner.length >= 2 && /\p{L}/u.test(inner) && !NOT_ORIGINAL.test(inner);
  return original ? { title, original: inner } : { title: heading, original: "" };
};

type Found = { kind: "author" | "rating" | "synopsis"; at: number; end: number; source: string };

const candidateOf = ({ body, joined }: Piece): Candidate | null => {
  const found: Found[] = [];
  for (const label of body.matchAll(LABEL)) {
    const kind = label[1] ? "author" : label[3] ? "synopsis" : "rating";
    if (!found.some((known) => known.kind === kind)) found.push({ kind, at: label.index, end: label.index + label[0].length, source: label[2] ?? "" });
  }
  const warnings: Warning[] = joined ? ["joined"] : [];
  const read = (kind: Found["kind"]) => {
    const at = found.findIndex((known) => known.kind === kind);
    return at < 0 ? null : { text: readLine(body.slice(found[at].end, found[at + 1]?.at), warnings), source: found[at].source };
  };
  const heading = line(body.slice(0, found[0]?.at));
  if (heading === "") return null;
  const { title, original } = splitTitle(heading);
  if (seen(title) === "") return null;
  const author = read("author")?.text ?? "";
  if (author === "") warnings.push("missing_author");
  const rating = read("rating");
  const score = rating === null ? null : RATING.exec(rating.text)?.[0].replace(/\s+/g, " ").trim();
  return {
    title: fit(title, TEXT_MAX, warnings),
    original_title: fit(original, TEXT_MAX, warnings),
    author: fit(author, TEXT_MAX, warnings),
    rated_elsewhere: score ? (rating!.source === "" ? score : `${score} (${rating!.source})`) : "",
    blurb: fit(read("synopsis")?.text ?? "", LONGTEXT_MAX, warnings),
    warnings: [...new Set(warnings)],
  };
};

export const parseList = (input: string): Candidate[] => piecesOf(tidy(input)).flatMap((piece) => candidateOf(piece) ?? []);
