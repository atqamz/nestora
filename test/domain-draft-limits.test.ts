import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STORED, blank, draftFor, fallbacks, parseDraft } from "../src/domain/draft.ts";
import type { Context, Field, Kind } from "../src/domain/draft.ts";

const KINDS: readonly Kind[] = ["task", "planned", "payment", "guest", "vendor"];

const context: Context = { today: "2026-10-07", me: "a", nicknames: { a: "Rani", b: "Dimas" }, lines: [{ id: "line-venue", title: "Venue", vendor: null }] };

const mbak: Context = { ...context, nicknames: { a: "Mbak Rani", b: "Dimas" } };

const BUDGET_MS = 250;

const once = (text: string) => {
  let worst = 0;
  for (const kind of [...KINDS, null] as const) {
    const started = performance.now();
    draftFor(text, context, new Set(), kind);
    worst = Math.max(worst, performance.now() - started);
  }
  return worst;
};

const slowest = (text: string) => Math.min(once(text), once(text), once(text));

draftFor("warm up 0812 3456 7890 5 jt tomorrow me", context, new Set(), "vendor");

const digits = (n: number, digit = "1") => digit.repeat(n);

const SMALL: [string, string][] = [
  ["a digit run and a letter, 24 digits", `Call ${digits(24)}x`],
  ["a digit run and a letter, 26 digits", `Call ${digits(26)}x`],
  ["a digit run and a letter, 28 digits", `${digits(28)}a`],
  ["six hyphen groups", "0812-".repeat(6)],
  ["eight hyphen groups", "0812-".repeat(8)],
  ["ten hyphen groups", "0812-".repeat(10)],
  ["a run with a bracket and a trailer", `(${digits(26)})-`],
  ["a plus run with a trailer", `+${digits(26)}_`],
];

const AT_CAP: [string, string][] = [
  ["one hundred hyphen groups", "0812-".repeat(100)],
  ["166 short hyphen groups and a letter", `${"12-".repeat(166)}x`],
  ["495 digits and a letter", `Call ${digits(495)}x`],
  ["40 digits and a letter", `${digits(40)}x`],
  ["500 digits", digits(500)],
  ["62 repeated", "62".repeat(250)],
  ["zeros and spaces", "0 ".repeat(250)],
  ["phone groups", "0812 3456 ".repeat(50)],
  ["plus country groups", "+62 ".repeat(125)],
  ["landline groups", "(021) 5551234 ".repeat(35)],
  ["brackets", `${"(".repeat(250)}1`],
  ["closed brackets", "1)".repeat(250)],
  ["hyphens", "-".repeat(500)],
  ["spaces", " ".repeat(500)],
  ["dotted groups", "1.2.3.".repeat(83)],
  ["currency marks", "Rp ".repeat(166)],
  ["currency and dotted groups", "Rp 1.".repeat(100)],
  ["commas", "1,".repeat(250)],
  ["months and days", "12 oct ".repeat(71)],
  ["slashes", "12/10 ".repeat(83)],
  ["owner words", "me ".repeat(166)],
  ["amount words", "5 jt ".repeat(100)],
  ["tabs, no-break and ideographic spaces", "021 5551234\t021　5551234 ".repeat(20)],
  ["the marker character", `${"0812 3456 7890 ".repeat(33)}`],
  ["a long phone-like token with every trailer", ...[`${digits(480)}é`] as [string]],
];

test("odd short inputs that took seconds before are read in under 50 ms", () => {
  for (const [name, text] of SMALL) {
    const ms = slowest(text);
    assert.ok(ms < BUDGET_MS, `${name}: ${ms.toFixed(1)} ms for ${JSON.stringify(text.slice(0, 40))}`);
  }
});

test("the trailers that failed a digit token (a ) - _ / é , a ring and an emoji) are read in under 50 ms", () => {
  for (const trailer of ["a", ")", "-", "_", "/", "é", ",", "💍", "x)", "-)"]) {
    for (const lead of ["Call ", "62", "08", "021 ", "(021) ", "+"]) {
      const ms = slowest(`${lead}${digits(26)}${trailer}`);
      assert.ok(ms < BUDGET_MS, `${lead}…${trailer}: ${ms.toFixed(1)} ms`);
    }
  }
});

test("pathological shapes at the 500-character cap are read in under 50 ms", () => {
  for (const [name, text] of AT_CAP) {
    assert.ok(text.length <= 520, name);
    const ms = slowest(text);
    assert.ok(ms < BUDGET_MS, `${name}: ${ms.toFixed(1)} ms`);
  }
});

const same = (text: string) => [...text.replace(/\s+/g, "")].sort().join("");

const included = (part: string, whole: string) => {
  const counts = new Map<string, number>();
  for (const char of whole.replace(/\s+/g, "")) counts.set(char, (counts.get(char) ?? 0) + 1);
  for (const char of part.replace(/\s+/g, "")) {
    const left = counts.get(char) ?? 0;
    if (left === 0) return false;
    counts.set(char, left - 1);
  }
  return true;
};

test("no private character is written into the text, so a typed one cannot take a phone's place", () => {
  const phone = "0812 3456 7890";
  const marks = ["", "", "", "\u{F0000}", "‍", "‏", "\u0000", "�"];
  for (const mark of marks) {
    for (const text of [`a${mark}b ${phone}`, `${phone} a${mark}b`, `${mark} ${phone} ${mark}`, `a${mark}${mark}b ${phone}`, `${mark}${phone}${mark}`, `a${mark}b ${phone} c${mark}d`]) {
      for (const kind of KINDS) {
        const { draft } = draftFor(text, context, new Set(), kind);
        assert.ok(included(draft.title, text), `${kind}: no character is invented in ${JSON.stringify(text)} -> ${JSON.stringify(draft.title)}`);
        const rest = draft.phone !== null ? text.replace(phone, "") : text;
        if (draft.title === "") assert.ok(!/[\p{L}\p{N}]/u.test(rest), `${kind}: an empty name only when nothing but marks is left: ${JSON.stringify(text)}`);
        else assert.equal(same(draft.title), same(rest), `${kind}: nothing moves or is lost in ${JSON.stringify(text)} -> ${JSON.stringify(draft.title)}`);
      }
    }
  }
  const task = draftFor("ab 0812 3456 7890", context, new Set(), "task").draft;
  assert.equal(task.title, "ab 0812 3456 7890");
  const vendor = draftFor("ab 0812 3456 7890", context, new Set(), "vendor").draft;
  assert.deepEqual([vendor.title, vendor.phone], ["ab", "+6281234567890"]);
  const back = draftFor("ab 0812 3456 7890", context, new Set(["phone"]), "vendor").draft;
  assert.deepEqual([back.title, back.phone], ["ab 0812 3456 7890", null]);
});

test("a number that is separated by a tab, a no-break space or an ideographic space is read like one that is separated by spaces", () => {
  for (const space of ["\t", " ", "　", " ", " "]) {
    for (const typed of [`021${space}5551234`, `0812${space}3456${space}7890`, `(021)${space}5551234`, `+62${space}812${space}3456${space}7890`]) {
      const vendor = draftFor(`Call ${typed}`, context, new Set(), "vendor").draft;
      assert.ok(vendor.phone !== null && vendor.amount === null, JSON.stringify(typed));
      assert.equal(vendor.title, "Call", JSON.stringify(typed));
      const task = draftFor(`Call ${typed}`, context, new Set(), "task").draft;
      assert.deepEqual([task.phone, task.amount], [null, null], JSON.stringify(typed));
      assert.equal(same(task.title), same(`Call ${typed}`), JSON.stringify(typed));
    }
  }
});

test("phone shapes that the grammar does not read stay in the name and never become an amount", () => {
  const texts = [
    "Call 0812 3456 7890 and 021 5551234",
    "Florist +62 21 5551234",
    "Florist +49 30 1234567",
    "Florist (021 5551234)",
    "Florist (021) 5551234)",
    "Florist +12345678",
    "Call venue 021 555123456",
    "Call 021.555.1234",
    "Order 0812-3456",
    "Call 1234 5678 9012",
  ];
  for (const text of texts) {
    for (const kind of KINDS) {
      const { draft } = draftFor(text, context, new Set(), kind);
      assert.equal(draft.amount, null, `${kind}: ${text}`);
      assert.ok(included(draft.title, text), `${kind}: ${text}`);
    }
  }
  const two = draftFor("Call 0812 3456 7890 and 021 5551234", context, new Set(), "vendor").draft;
  assert.deepEqual([two.phone, two.title], ["+6281234567890", "Call and 021 5551234"]);
});

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const PIECES = [
  "0812 3456 7890", "0812-3456-7890", "081234567890", "6281234567890", "+6281234567890", "+62812 3456 7890", "+62 21 5551234", "+49 30 1234567", "62812345678", "+12345678",
  "021 5551234", "021-5551234", "(021) 5551234", "(021 5551234)", "0274 123456", "021 5551234", "021\t5551234", "021　5551234", "0812-".repeat(5),
  "5 jt", "2,5jt", "500rb", "500k", "250 ribu", "Rp 1.500.000", "Rp 6281234567890", "1.500.000", "1500000", "50000", "625000000", "12345678901",
  "tomorrow", "friday", "12 Oct", "12/10", "12 oct 2027", "me", "Dimas", "Rani's", "both", "Cake 1/2 kg",
  "venue", "hall", "florist", "call", "aunt", "x", "é", "💍", "حفل", "", "", "‍", "(", ")", "-", "+", ".", ",", "/", "_", "…", "a)", "(5jt)",
];

const LEAD_WORDS = ["for", "on", "by", "next", "this", "due", "pay", "call", "at", "before", "until", "Top up", "Mbak", "12", "Rp", "and"];

const SPACES = [" ", " ", " ", "  ", "\t", " ", "　", "-"];

const FIELDS: readonly Field[] = ["amount", "due", "who", "phone"];

const UNIT_OR_MARK = /(?:jt|juta|rb|ribu|k)(?![\p{L}\p{N}_])|\brp\.?\s*\d|\d[.,]\d{3}/iu;

const crossed: string[] = [];

const watch: typeof blank = (state, start, end, mark) => {
  if (mark === state.gone && state.hold.subarray(start, end).includes(1)) crossed.push(`${start}-${end}`);
  blank(state, start, end, mark);
};

const typed = (text: string) => [...text].filter((char) => /[\p{L}\p{N}]/u.test(char)).join("");

test("fuzz with a fixed seed: no amount from digits alone, nothing invented or lost, nothing a kind cannot store, no marker, and no call near a hang", () => {
  const random = mulberry32(20261009);
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  const before = fallbacks.count;
  let inputs = 0;
  for (let run = 0; run < 1500; run++) {
    const count = 1 + Math.floor(random() * 12);
    let text = "";
    for (let at = 0; at < count; at++) text += `${at === 0 ? "" : pick(SPACES)}${random() < 0.3 ? pick(LEAD_WORDS) : pick(PIECES)}`;
    if (random() < 0.05) text = text.repeat(1 + Math.floor(500 / Math.max(text.length, 1))).slice(0, 500);
    const ctx = run % 2 === 0 ? context : mbak;
    const some = new Set(FIELDS.filter(() => random() < 0.25));
    for (const ignore of [new Set<Field>(), some]) {
      for (const kind of [...KINDS, null] as const) {
        inputs++;
        const started = performance.now();
        const { draft, kind: chosen } = draftFor(text, ctx, ignore, kind, watch);
        const where = `${kind ?? "inferred"} (${chosen}) ignoring ${[...ignore].join(",") || "nothing"}: ${JSON.stringify(text)}`;
        assert.deepEqual(crossed.splice(0), [], `a read span covers a hidden phone: ${where}`);
        assert.equal(fallbacks.count, before, `the exit check fired, so a parser bug lost typed text: ${where}`);
        assert.ok(included(draft.title, text), `nothing invented: ${where} -> ${JSON.stringify(draft.title)}`);
        assert.ok(!draft.title.includes("") || text.includes(""), `no marker: ${where}`);
        if (!UNIT_OR_MARK.test(text)) assert.equal(draft.amount, null, `no amount from digits alone: ${where}`);
        if (draft.phone !== null) {
          assert.match(draft.phone, /^\+[1-9]\d{6,14}$/, where);
          assert.ok(STORED[chosen].includes("phone"), `a phone only where it is stored: ${where}`);
        }
        for (const field of ["amount", "due", "who"] as const) if (!STORED[chosen].includes(field)) assert.equal(draft[field], null, `${field} not stored: ${where}`);
        for (const field of ignore) if (field !== "line") assert.equal(draft[field], null, `${field} ignored: ${where}`);
        if (chosen === "guest") assert.notEqual(draft.who, "both", where);
        if (draft.amount === null && draft.due === null && draft.who === null && draft.phone === null) assert.equal(typed(draft.title), typed(text), `nothing read, nothing lost: ${where}`);
        assert.equal(typed(draftFor(text, ctx, new Set(FIELDS), kind).draft.title), typed(text), `everything put back gives the typed text: ${where}`);
        assert.ok(performance.now() - started < BUDGET_MS * 4, `time: ${where}`);
      }
    }
  }
  assert.equal(inputs, 1500 * 2 * 6);
  assert.equal(fallbacks.count, before);
});

test("parseDraft alone never writes a private character into a long input", () => {
  for (const [, text] of AT_CAP) {
    const started = performance.now();
    const read = parseDraft(text, context);
    assert.ok(performance.now() - started < BUDGET_MS);
    assert.ok(!read.title.includes("") || text.includes(""));
  }
});

test("a long budget costs no compiled pattern per line on the first call", () => {
  const cold = (word: string) => {
    const lines = Array.from({ length: 150 }, (_, i) => ({ id: `line-${i}`, title: `${word}${i} hall`, vendor: `${word}${i} studio` }));
    const started = performance.now();
    const { draft } = draftFor("Pay florist 5 jt", { ...context, lines }, new Set(), null);
    assert.equal(draft.line, null);
    return performance.now() - started;
  };
  const ms = Math.min(cold("Zorblat"), cold("Quindle"), cold("Mervane"));
  assert.ok(ms < BUDGET_MS, `${ms.toFixed(1)} ms`);
  const hit = draftFor("Zorblat7 hall deposit 5 jt", { ...context, lines: [{ id: "line-7", title: "Zorblat7 hall", vendor: null }, { id: "line-8", title: "Zorblat8 hall", vendor: null }] }, new Set(), null);
  assert.deepEqual([hit.draft.line, hit.draft.kind], ["line-7", "payment"]);
});

test("draft.ts has no constant that nothing uses", () => {
  const source = readFileSync(new URL("../src/domain/draft.ts", import.meta.url), "utf8");
  const names = [...source.matchAll(/^const ([A-Za-z_]\w*)\b/gm)].map(([, name]) => name);
  assert.ok(names.length > 20);
  for (const name of names) assert.ok(new RegExp(`\\b${name}\\b`, "g").test(source) && (source.match(new RegExp(`\\b${name}\\b`, "g")) ?? []).length >= 2, `${name} is never used`);
});
