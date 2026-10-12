import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, daysBetween, daysUntil, todayIn } from "../src/domain/dates.ts";
import { parseField } from "../src/domain/field.ts";
import { headcount } from "../src/domain/guests.ts";
import { parseRupiah } from "../src/domain/money.ts";
import { bySort, sortBefore } from "../src/domain/order.ts";
import { normalizePhone, whatsappUrl } from "../src/domain/phone.ts";
import { DEFAULT_ZONE, readSettings } from "../src/domain/settings.ts";
import { STAGES } from "../src/domain/stages.ts";
import { item } from "./domain-rows.ts";

test("phone: 08 and +62 forms normalise to E.164", () => {
  for (const input of ["08123456789", "0812-3456-789", "+62 812 3456 789", "62812 3456 789", "0062 812 3456 789", "+62 0812 3456 789", "(0812) 3456.789"]) {
    assert.equal(normalizePhone(input), "+628123456789", input);
  }
});

test("phone: landline and foreign numbers keep their digits", () => {
  assert.equal(normalizePhone("021 555 1234"), "+62215551234");
  assert.equal(normalizePhone("+65 9123 4567"), "+6591234567");
});

test("phone: junk, short and bare numbers are refused", () => {
  for (const input of ["", "abc", "0812", "8123456789", "+0123456789", "+62 812 abc", "08123456789012345678"]) {
    assert.equal(normalizePhone(input), null, input);
  }
});

test("phone: wa.me link has no plus", () => {
  assert.equal(whatsappUrl("+628123456789"), "https://wa.me/628123456789");
});

test("rupiah: plain digits and thousands groups in either convention", () => {
  const accepted: [string, number][] = [
    ["0", 0],
    ["5", 5],
    ["500", 500],
    ["1500000", 1_500_000],
    ["1.000", 1000],
    ["1,000", 1000],
    ["12.500", 12_500],
    ["999.999", 999_999],
    ["1.500.000", 1_500_000],
    ["1,500,000", 1_500_000],
    ["25.000.000", 25_000_000],
    ["999.999.999.999.999", 999_999_999_999_999],
    ["  5.000.000  ", 5_000_000],
    ["Rp 5.000.000", 5_000_000],
    ["Rp1,500,000", 1_500_000],
    ["rp 1500000", 1_500_000],
  ];
  for (const [input, expected] of accepted) assert.equal(parseRupiah(input), expected, input);
});

test("rupiah: a fractional part is accepted only when it is all zeros", () => {
  const accepted: [string, number][] = [
    ["1.500.000,00", 1_500_000],
    ["1,500,000.00", 1_500_000],
    ["1.500.000,0", 1_500_000],
    ["1,500,000.0", 1_500_000],
    ["1500000,00", 1_500_000],
    ["1500000.00", 1_500_000],
    ["10.00", 10],
    ["10,0", 10],
    ["0,00", 0],
  ];
  for (const [input, expected] of accepted) assert.equal(parseRupiah(input), expected, input);
});

test("rupiah: everything else is refused, never read as another number", () => {
  const refused = [
    "",
    "   ",
    "Rp",
    "abc",
    "12a",
    "-5",
    "+5",
    "1500000.50",
    "1500000,50",
    "1.500.000,50",
    "1,500,000.50",
    "1,5",
    "1.5",
    "0,5",
    "1.500,000",
    "1,500.000",
    "1.500.000.00",
    "1,500,000,00",
    "1.500,000,00",
    "1.50.000",
    "1.5000",
    "1500.000",
    "1,5000,000",
    "12.34.567",
    "1 500 000",
    "1.500.000 ,00",
    "1.500.000,000",
    "1,500,000.000",
    ".500",
    ",500",
    "1.",
    "1,",
    "1..500",
    "1.500..000",
    "1.500.000,",
    "Rp-5",
    "5 Rp",
    "1e6",
    "0x10",
    "٣٠٠",
    "1000000000000000",
    "1.000.000.000.000.000",
  ];
  for (const input of refused) assert.equal(parseRupiah(input), null, JSON.stringify(input));
});

test("sorting follows the fractional sort, then created_at, then id", () => {
  const row = (id: string, sort: number, created_at = "2026-10-01T00:00:00Z") => ({ id, sort, created_at });
  const sorted = [row("c", 2), row("b", 1.5), row("a2", 1, "2026-10-02T00:00:00Z"), row("a1", 1), row("a0", 1)].sort(bySort);
  assert.deepEqual(
    sorted.map((r) => r.id),
    ["a0", "a1", "a2", "b", "c"],
  );
});

test("sortBefore goes ahead of every row", () => {
  assert.equal(sortBefore([]), 0);
  assert.equal(sortBefore([item({ sort: 0 })]), -1);
  assert.equal(sortBefore([item({ sort: 5 }), item({ sort: 3 })]), 0);
  assert.equal(sortBefore([item({ sort: -2.5 }), item({ sort: 3 })]), -3.5);
});

test("countdown counts calendar days, negative after the day", () => {
  assert.equal(daysUntil("2027-10-06", "2026-10-06"), 365);
  assert.equal(daysUntil("2026-10-06", "2026-10-06"), 0);
  assert.equal(daysUntil("2026-10-01", "2026-10-06"), -5);
  assert.equal(daysUntil("2028-03-01", "2028-02-27"), 3);
  assert.equal(daysUntil(null, "2026-10-06"), null);
  assert.equal(daysBetween("2026-10-06", "2026-10-07"), 1);
});

test("addDays crosses month and year ends", () => {
  assert.equal(addDays("2026-12-30", 3), "2027-01-02");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2026-10-06", -6), "2026-09-30");
});

test("today follows the saved time zone, not the machine", () => {
  const now = new Date("2026-10-06T20:00:00Z");
  assert.equal(todayIn(now, "Asia/Jakarta"), "2026-10-07");
  assert.equal(todayIn(now, "UTC"), "2026-10-06");
  assert.equal(todayIn(now, "America/Los_Angeles"), "2026-10-06");
  assert.equal(todayIn(new Date("2026-10-06T16:59:59Z"), "Asia/Jakarta"), "2026-10-06");
  assert.equal(todayIn(new Date("2026-10-06T17:00:00Z"), "Asia/Jakarta"), "2026-10-07");
});

test("settings default the zone and leave the rest empty", () => {
  assert.equal(DEFAULT_ZONE, "Asia/Jakarta");
  assert.deepEqual(readSettings([]), { ceremonyDate: null, timezone: "Asia/Jakarta", partnerA: null, partnerB: null, photoA: null, photoB: null, stages: STAGES, hijriOffset: 0 });
  const row = (key: string, value: string) => ({ key, value, rev: 1, created_at: "", updated_at: "", updated_by: null, deleted_at: null });
  assert.deepEqual(
    readSettings([row("ceremony_date", "2027-01-01"), row("timezone", "Asia/Makassar"), row("partner_a_label", "Sam")]),
    { ceremonyDate: "2027-01-01", timezone: "Asia/Makassar", partnerA: "Sam", partnerB: null, photoA: null, photoB: null, stages: STAGES, hijriOffset: 0 },
  );
});

test("headcount sums people per side, skips declined, counts a missing size as one", () => {
  const guest = (fields: Parameters<typeof item>[0]) => item({ kind: "guest", status: "todo", ...fields });
  assert.deepEqual(
    headcount([
      guest({ who: "a", qty: 4 }),
      guest({ who: "a" }),
      guest({ who: "b", qty: 2, status: "confirmed" }),
      guest({ who: "b", qty: 9, status: "declined" }),
      guest({ qty: 3 }),
      item({ kind: "task", who: "a" }),
    ]),
    { a: { guests: 2, people: 5 }, b: { guests: 1, people: 2 }, none: { guests: 1, people: 3 } },
  );
});

test("form fields: empty clears, phones normalise, numbers are whole, unchecked clears a flag", () => {
  assert.deepEqual(parseField("text", "  hall  "), { ok: true, value: "hall" });
  assert.deepEqual(parseField("text", "   "), { ok: true, value: null });
  assert.deepEqual(parseField("phone", "0812 3456 789"), { ok: true, value: "+628123456789" });
  assert.deepEqual(parseField("phone", "12"), { ok: false });
  assert.deepEqual(parseField("int", "Rp 2.500.000"), { ok: true, value: 2_500_000 });
  assert.deepEqual(parseField("int", "two"), { ok: false });
  assert.deepEqual(parseField("bool", true), { ok: true, value: true });
  assert.deepEqual(parseField("bool", false), { ok: true, value: null });
  assert.deepEqual(parseField("date", "2026-10-06"), { ok: true, value: "2026-10-06" });
});
