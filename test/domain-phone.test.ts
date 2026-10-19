import { test } from "node:test";
import assert from "node:assert/strict";
import { STORED, draftFor, fallbacks, isPhone, parseDraft } from "../src/domain/draft.ts";
import type { Context, Kind } from "../src/domain/draft.ts";

const KINDS = ["task", "planned", "payment", "guest", "vendor"] as const;

const context: Context = {
  today: "2026-10-07",
  me: "a",
  nicknames: { a: "Rani", b: "Dimas" },
  lines: [{ id: "line-venue", title: "Venue", vendor: null }],
};

const stores = (kind: Kind) => STORED[kind].includes("phone");

const NUMBERS: [string, string][] = [
  ["6281234567890", "+6281234567890"],
  ["+6281234567890", "+6281234567890"],
  ["62812345678", "+62812345678"],
  ["+15551234567", "+15551234567"],
  ["+62812 3456 7890", "+6281234567890"],
  ["+62 812 3456 7890", "+6281234567890"],
  ["+62-812-3456-7890", "+6281234567890"],
  ["+62 812-3456-7890", "+6281234567890"],
  ["62 812 3456 7890", "+6281234567890"],
  ["+44 20 7946 0958", "+442079460958"],
  ["081234567890", "+6281234567890"],
  ["0812 3456 7890", "+6281234567890"],
  ["0812-3456-7890", "+6281234567890"],
  ["0878 0000 1032", "+6287800001032"],
  ["021 5551234", "+62215551234"],
  ["021-5551234", "+62215551234"],
  ["021 555 1234", "+62215551234"],
  ["021-555-1234", "+62215551234"],
  ["021 555-1234", "+62215551234"],
  ["(021) 5551234", "+62215551234"],
  ["(021) 555 1234", "+62215551234"],
  ["(021) 555-1234", "+62215551234"],
  ["(021)5551234", "+62215551234"],
  ["0274 123456", "+62274123456"],
  ["0274-123456", "+62274123456"],
  ["(0274) 123456", "+62274123456"],
  ["0361 123 456", "+62361123456"],
  ["0215551234", "+62215551234"],
];

const SENTENCES = ["Call Aunt", "Venue hall", "Call venue", "Florist"];

test("every phone form is a phone through draftFor on every kind: read and removed where the kind stores it, kept exactly as typed where it does not, and never an amount", () => {
  for (const [typed, e164] of NUMBERS) {
    assert.equal(isPhone(typed), true, typed);
    for (const lead of SENTENCES) {
      for (const text of [`${lead} ${typed}`, `${typed} ${lead}`, `${lead} ${typed}.`, `${lead}, ${typed}`]) {
        for (const kind of KINDS) {
          const { draft } = draftFor(text, context, new Set(), kind);
          assert.equal(draft.amount, null, `${kind}: ${text}`);
          if (stores(kind)) {
            assert.equal(draft.phone, e164, `${kind}: ${text}`);
            assert.equal(draft.title.replace(/[.,]$/, ""), lead, `${kind}: ${text}`);
          } else {
            assert.equal(draft.phone, null, `${kind}: ${text}`);
            assert.ok(draft.title.includes(typed), `${kind} keeps ${typed} exactly: ${draft.title}`);
            assert.equal(draft.title.replace(/[.,]$/, "").split(typed).join("").replace(/[\s,]+/g, " ").trim(), lead, `${kind}: ${text}`);
          }
        }
      }
    }
  }
});

test("the examples of the review, on every kind", () => {
  const cases: [string, string, string][] = [
    ["Call Aunt 6281234567890", "6281234567890", "+6281234567890"],
    ["Call Aunt +6281234567890", "+6281234567890", "+6281234567890"],
    ["Call Aunt 62812345678", "62812345678", "+62812345678"],
    ["Call Aunt +15551234567", "+15551234567", "+15551234567"],
    ["Venue hall 021 5551234", "021 5551234", "+62215551234"],
    ["Call venue (021) 5551234", "(021) 5551234", "+62215551234"],
    ["Call venue 0274 123456", "0274 123456", "+62274123456"],
    ["Call Aunt +62812 3456 7890", "+62812 3456 7890", "+6281234567890"],
    ["Call venue 021-5551234", "021-5551234", "+62215551234"],
    ["Call venue 021 555 1234", "021 555 1234", "+62215551234"],
  ];
  for (const [text, typed, phone] of cases) {
    for (const kind of KINDS) {
      const { draft } = draftFor(text, context, new Set(), kind);
      assert.equal(draft.amount, null, `${kind}: ${text}`);
      assert.equal(draft.phone, stores(kind) ? phone : null, `${kind}: ${text}`);
      assert.equal(draft.title, stores(kind) ? text.replace(` ${typed}`, "") : text, `${kind}: ${text}`);
    }
  }
});

test("the phone is read in the same way whichever tab is chosen, so a date does not change what the number is", () => {
  const text = "Florist 12 oct 2027 6281234567890";
  const vendor = draftFor(text, context, new Set(), "vendor").draft;
  assert.deepEqual([vendor.phone, vendor.amount, vendor.due, vendor.title], ["+6281234567890", null, null, "Florist 12 oct 2027"]);
  const task = draftFor(text, context, new Set(), "task").draft;
  assert.deepEqual([task.phone, task.amount, task.due, task.title], [null, null, "2027-10-12", "Florist 6281234567890"]);
  const guest = draftFor(text, context, new Set(), "guest").draft;
  assert.deepEqual([guest.phone, guest.amount, guest.due], ["+6281234567890", null, null]);
});

test("a figure after a phone is still an amount, and an amount with a word or a currency mark is read even when it looks like a phone", () => {
  const read = (text: string, kind: Kind = "task") => draftFor(text, context, new Set(), kind).draft;
  assert.equal(read("Call Aunt 6281234567890 5 jt").amount, 5_000_000);
  assert.equal(read("Call Aunt 6281234567890 5 jt").title, "Call Aunt 6281234567890");
  assert.equal(read("Florist 021 5551234 12 jt", "vendor").amount, 12_000_000);
  assert.equal(read("Florist 021 5551234 12 jt", "vendor").phone, "+62215551234");
  assert.deepEqual([read("Florist 0812 3456 7890 25000", "vendor").amount, read("Florist 0812 3456 7890 25000", "vendor").title], [null, "Florist 25000"]);
  assert.equal(read("Pay Rp 6281234567890").amount, 6_281_234_567_890);
  assert.equal(read("Pay Rp 0812 3456 7890").phone, null);
  assert.equal(read("Pay 6281234567890 rb").amount, null);
});

test("plain amounts are still read: a word, a currency mark or grouped thousands", () => {
  const cases: [string, number][] = [
    ["Rp 1.500.000", 1_500_000],
    ["Rp1500000", 1_500_000],
    ["2,5 jt", 2_500_000],
    ["500rb", 500_000],
    ["500k", 500_000],
    ["5 juta", 5_000_000],
    ["250 ribu", 250_000],
    ["12.345.678.901", 12_345_678_901],
    ["Rp 12345678901", 12_345_678_901],
    ["Rp 6281234567890", 6_281_234_567_890],
    ["1,500,000", 1_500_000],
  ];
  for (const [typed, value] of cases) {
    for (const kind of ["task", "planned", "payment", "vendor"] as const) assert.equal(draftFor(`Thing ${typed}`, context, new Set(), kind).draft.amount, value, `${kind}: ${typed}`);
  }
});

test("a bare run of digits is never an amount, whatever its length, and stays in the name when it is not a phone", () => {
  for (const typed of ["50000", "1500000", "625000000", "1234567890", "12345678901", "999999999999999", "6281234567", "2500000000", "0812345678901234"]) {
    for (const kind of KINDS) {
      const { draft } = draftFor(`Order ${typed} ready`, context, new Set(), kind);
      assert.equal(draft.amount, null, `${kind}: ${typed}`);
      assert.equal(draft.phone, null, `${kind}: ${typed}`);
      assert.equal(draft.title, `Order ${typed} ready`, `${kind}: ${typed}`);
    }
  }
});

test("dates, plain figures and short groups are not phones", () => {
  for (const typed of ["2027-10-12", "05-10-2026", "12 10 2026", "08 30", "0812 345", "021 123", "62 10 2026", "+1 2", "0 1 2 3 4 5 6 7 8 9", "12.500.000", "1500000", "5551234"]) assert.equal(isPhone(typed), false, typed);
  for (const typed of ["021 5551234 12", "0812 3456 7890 250", "0812 3456 7890 25000", "(021) 5551234 7"]) assert.equal(isPhone(typed), false, typed);
});

test("the phone put back by its chip stays protected from the amount rules", () => {
  const text = "Florist 0812 3456 7890 5 jt";
  const { draft } = draftFor(text, context, new Set(["phone"]), "vendor");
  assert.deepEqual([draft.phone, draft.amount, draft.title], [null, 5_000_000, "Florist 0812 3456 7890"]);
  const bare = draftFor("Florist 6281234567890", context, new Set(["phone"]), "vendor").draft;
  assert.deepEqual([bare.phone, bare.amount, bare.title], [null, null, "Florist 6281234567890"]);
});

test("the currency mark makes the next run an amount instead of a phone, and only that run", () => {
  for (const text of ["Rp 6281234567890", "rp. 6281234567890", "Pay Rp 6281234567890"]) {
    const read = parseDraft(text, context);
    assert.deepEqual([read.phone, read.amount], [null, 6_281_234_567_890], text);
  }
  const both = parseDraft("Rp 5 jt 021 5551234", context);
  assert.deepEqual([both.amount, both.phone], [5_000_000, "+62215551234"]);
  const spaced = parseDraft("Rp 5551234 021 5551234", context);
  assert.deepEqual([spaced.amount, spaced.phone], [5_551_234, "+62215551234"]);
});

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const chars = (text: string) => [...text.replace(/\s+/g, "")].sort().join("");

test("property: with a fixed seed no kind makes an amount from a phone's digits, and title plus the read pieces always give back what was typed", () => {
  const random = mulberry32(20261008);
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  const words = ["venue", "hall", "florist", "cake", "aunt", "call", "book", "tent", "chairs", "caterer"];
  const amounts: [string, number][] = [["5 jt", 5_000_000], ["500rb", 500_000], ["2,5jt", 2_500_000], ["Rp 1.500.000", 1_500_000], ["250 ribu", 250_000], ["Rp 6281234567890", 6_281_234_567_890]];
  const dates = ["tomorrow", "12 Oct", "friday", "12/10"];
  const owners = ["me", "Dimas"];
  let withPhone = 0;
  for (let run = 0; run < 600; run++) {
    const phone = random() < 0.7 ? pick(NUMBERS) : null;
    const amount = random() < 0.5 ? pick(amounts) : null;
    const date = random() < 0.4 ? pick(dates) : null;
    const owner = random() < 0.3 ? pick(owners) : null;
    const pieces = [phone?.[0], amount?.[0], date, owner, ...Array.from({ length: 1 + Math.floor(random() * 3) }, () => pick(words))].filter((piece): piece is string => piece !== undefined && piece !== null);
    for (let at = pieces.length - 1; at > 0; at--) {
      const other = Math.floor(random() * (at + 1));
      [pieces[at], pieces[other]] = [pieces[other], pieces[at]];
    }
    const text = pieces.join(" ");
    if (phone) withPhone++;
    for (const kind of [...KINDS, null] as const) {
      const { draft, kind: chosen } = draftFor(text, context, new Set(), kind);
      const where = `${kind ?? "inferred"} (${chosen}): ${text}`;
      if (amount === null) assert.equal(draft.amount, null, `no amount from digits: ${where}`);
      else if (draft.amount !== null) assert.equal(draft.amount, amount[1], `the amount typed is the amount read: ${where}`);
      if (draft.phone !== null) assert.equal(draft.phone, phone?.[1], where);
      const read = [
        draft.phone !== null ? phone![0] : "",
        draft.amount !== null ? amount![0] : "",
        draft.due !== null ? date! : "",
        draft.who !== null ? owner! : "",
      ];
      assert.equal(chars([draft.title, ...read].join(" ")), chars(text), `nothing typed is lost: ${where} -> ${JSON.stringify(draft)}`);
    }
  }
  assert.ok(withPhone > 300);
});

const mbak: Context = { ...context, nicknames: { a: "Mbak Rani", b: "Dimas" } };

type Read = [amount: number | null, due: string | null, who: string | null, phone: string | null, title: string];

const CROSSING: [string, Context, Record<Exclude<Kind, "book">, Read>][] = [
  ["Top up for 0812 3456 7890 50k", context, {
    task: [50_000, null, null, null, "Top up for 0812 3456 7890"],
    planned: [50_000, null, null, null, "Top up for 0812 3456 7890"],
    payment: [50_000, null, null, null, "Top up for 0812 3456 7890"],
    guest: [null, null, null, "+6281234567890", "Top up for 50k"],
    vendor: [50_000, null, null, "+6281234567890", "Top up"],
  }],
  ["Pay florist for 0812 3456 7890 5 jt", context, {
    task: [5_000_000, null, null, null, "Pay florist for 0812 3456 7890"],
    planned: [5_000_000, null, null, null, "Pay florist for 0812 3456 7890"],
    payment: [5_000_000, null, null, null, "Pay florist for 0812 3456 7890"],
    guest: [null, null, null, "+6281234567890", "Pay florist for 5 jt"],
    vendor: [5_000_000, null, null, "+6281234567890", "Pay florist"],
  }],
  ["Pay for 021 5551234 500rb", context, {
    task: [500_000, null, null, null, "Pay for 021 5551234"],
    planned: [500_000, null, null, null, "Pay for 021 5551234"],
    payment: [500_000, null, null, null, "Pay for 021 5551234"],
    guest: [null, null, null, "+62215551234", "Pay for 500rb"],
    vendor: [500_000, null, null, "+62215551234", "Pay"],
  }],
  ["Call on 0812 3456 7890 friday", context, {
    task: [null, "2026-10-09", null, null, "Call on 0812 3456 7890"],
    planned: [null, null, null, null, "Call on 0812 3456 7890 friday"],
    payment: [null, "2026-10-09", null, null, "Call on 0812 3456 7890"],
    guest: [null, null, null, "+6281234567890", "Call on friday"],
    vendor: [null, null, null, "+6281234567890", "Call on friday"],
  }],
  ["Book by 0812 3456 7890 12 oct", context, {
    task: [null, "2026-10-12", null, null, "Book by 0812 3456 7890"],
    planned: [null, null, null, null, "Book by 0812 3456 7890 12 oct"],
    payment: [null, "2026-10-12", null, null, "Book by 0812 3456 7890"],
    guest: [null, null, null, "+6281234567890", "Book by 12 oct"],
    vendor: [null, null, null, "+6281234567890", "Book by 12 oct"],
  }],
  ["for 0812 3456 7890 5 jt", context, {
    task: [5_000_000, null, null, null, "for 0812 3456 7890"],
    planned: [5_000_000, null, null, null, "for 0812 3456 7890"],
    payment: [5_000_000, null, null, null, "for 0812 3456 7890"],
    guest: [null, null, null, "+6281234567890", "for 5 jt"],
    vendor: [5_000_000, null, null, "+6281234567890", ""],
  }],
  ["Mbak 0812 3456 7890 Rani", mbak, {
    task: [null, null, null, null, "Mbak 0812 3456 7890 Rani"],
    planned: [null, null, null, null, "Mbak 0812 3456 7890 Rani"],
    payment: [null, null, null, null, "Mbak 0812 3456 7890 Rani"],
    guest: [null, null, "a", "+6281234567890", ""],
    vendor: [null, null, null, "+6281234567890", "Mbak Rani"],
  }],
  ["next 0812 3456 7890 friday", context, {
    task: [null, "2026-10-09", null, null, "next 0812 3456 7890"],
    planned: [null, null, null, null, "next 0812 3456 7890 friday"],
    payment: [null, "2026-10-09", null, null, "next 0812 3456 7890"],
    guest: [null, null, null, "+6281234567890", "next friday"],
    vendor: [null, null, null, "+6281234567890", "next friday"],
  }],
  ["12 0812 3456 7890 oct", context, {
    task: [null, null, null, null, "12 0812 3456 7890 oct"],
    planned: [null, null, null, null, "12 0812 3456 7890 oct"],
    payment: [null, null, null, null, "12 0812 3456 7890 oct"],
    guest: [null, null, null, "+6281234567890", "12 oct"],
    vendor: [null, null, null, "+6281234567890", "12 oct"],
  }],
  ["Pay at 021 5551234 500k me", context, {
    task: [500_000, null, "a", null, "Pay at 021 5551234"],
    planned: [500_000, null, null, null, "Pay at 021 5551234 me"],
    payment: [500_000, null, "a", null, "Pay at 021 5551234"],
    guest: [null, null, "a", "+62215551234", "Pay at 500k"],
    vendor: [500_000, null, null, "+62215551234", "Pay me"],
  }],
];

test("a lead word before a phone and a date, amount or nickname after it never take the phone's digits, on every kind", () => {
  const before = fallbacks.count;
  for (const [text, ctx, expected] of CROSSING) {
    for (const kind of KINDS) {
      const { draft } = draftFor(text, ctx, new Set(), kind);
      assert.deepEqual([draft.amount, draft.due, draft.who, draft.phone, draft.title], expected[kind], `${kind}: ${text}`);
    }
    const inferred = draftFor(text, ctx, new Set(), null);
    const task = draftFor(text, ctx, new Set(), "task").draft;
    assert.deepEqual([inferred.kind, inferred.draft], ["task", task], text);
  }
  assert.equal(fallbacks.count, before, "the parser itself never needs the exit check for these");
});

test("a phone put back by its chip restores exactly the typed text, even with a read piece on either side", () => {
  for (const [text, ctx] of CROSSING) {
    for (const kind of KINDS) {
      const back = draftFor(text, ctx, new Set(["phone"]), kind).draft;
      assert.equal(back.phone, null, `${kind}: ${text}`);
      const everything = draftFor(text, ctx, new Set(["amount", "due", "who", "phone"]), kind).draft;
      assert.equal(everything.title, text, `${kind}: ${text}`);
    }
  }
  const vendor = draftFor("Top up for 0812 3456 7890 50k", context, new Set(["phone"]), "vendor").draft;
  assert.deepEqual([vendor.phone, vendor.amount, vendor.title], [null, 50_000, "Top up for 0812 3456 7890"]);
  const guest = draftFor("Call on 0812 3456 7890 friday", context, new Set(["phone"]), "guest").draft;
  assert.deepEqual([guest.phone, guest.title], [null, "Call on 0812 3456 7890 friday"]);
});

const LEADS = ["for", "on", "by", "next", "this", "due", "pay", "call", "at"];

const TAILS = ["50k", "5 jt", "500rb", "friday", "12 oct", "tomorrow", "me"];

test("every lead word before and after every phone form, with a read piece on the other side, on every kind: the number is read where it is stored and is kept exactly as typed where it is not", () => {
  const before = fallbacks.count;
  let seen = 0;
  for (const [typed, e164] of NUMBERS) {
    const squeezed = typed.replace(/\s/g, "");
    for (const lead of LEADS) {
      for (const tail of TAILS) {
        for (const text of [`${lead} ${typed} ${tail}`, `Order ${lead} ${typed} ${tail}`, `${tail} ${lead} ${typed}`, `${typed} ${lead} ${tail}`]) {
          for (const kind of KINDS) {
            seen++;
            const { draft } = draftFor(text, context, new Set(), kind);
            const where = `${kind}: ${text} -> ${JSON.stringify(draft)}`;
            if (stores(kind)) {
              assert.equal(draft.phone, e164, where);
              assert.ok(!draft.title.replace(/\s/g, "").includes(squeezed), where);
            } else {
              assert.equal(draft.phone, null, where);
              assert.ok(draft.title.includes(typed), where);
            }
            const back = draftFor(text, context, new Set(["phone"]), kind).draft;
            assert.ok(back.phone === null && back.title.includes(typed), `put back, ${where}`);
          }
        }
      }
    }
  }
  assert.ok(seen > 30_000);
  assert.equal(fallbacks.count, before, "the exit check never fires on these");
});

test("a full stop or a comma after a phone stays in the name, and a read piece leaves a space where it stood", () => {
  const title = (text: string, kind: Kind) => draftFor(text, context, new Set(), kind).draft.title;
  assert.equal(title("Call 0812 3456 7890.", "vendor"), "Call.");
  assert.equal(title("Call 0812 3456 7890, then", "vendor"), "Call, then");
  assert.equal(title("Call 0812 3456 7890.", "task"), "Call 0812 3456 7890.");
  assert.equal(title("a/5 jt/b", "task"), "a/ /b");
});
