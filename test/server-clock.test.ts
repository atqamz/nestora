import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY, learned, newestStamp, unknown } from "../src/store/server-clock.ts";
import type { Clock } from "../src/store/server-clock.ts";

const DEVICE = Date.parse("2027-03-01T05:00:00Z");

const at = (day: string) => Date.parse(`${day}T05:00:00Z`);

const never = () => null;

const accepted = (served: number, device = DEVICE): Clock => ({ skew: served - device, last: served, held: null });

test("a Date that the device agrees with within a day is taken at once", () => {
  assert.deepEqual(learned(unknown, DEVICE + 1000, DEVICE, never), accepted(DEVICE + 1000));
  assert.deepEqual(learned(unknown, DEVICE + DAY, DEVICE, never), accepted(DEVICE + DAY));
  assert.deepEqual(learned(unknown, DEVICE - DAY, DEVICE, never), accepted(DEVICE - DAY));
});

test("a missing Date changes nothing", () => {
  assert.equal(learned(unknown, null, DEVICE, never), unknown);
  const good = accepted(DEVICE);
  assert.equal(learned(good, null, DEVICE, never), good);
});

test("a 2015 Date and a Date far in the future are never taken, however often they come", () => {
  for (const day of ["2015-01-01", "2100-01-01"]) {
    let clock = unknown;
    for (let answer = 0; answer < 3; answer++) clock = learned(clock, at(day), DEVICE, never);
    assert.deepEqual(clock, unknown, day);
  }
  const good = accepted(DEVICE);
  assert.equal(learned(good, at("2015-01-01"), DEVICE, never), good);
});

test("a Date 400 days off is out of bounds and one 399 days off is only held", () => {
  assert.deepEqual(learned(unknown, DEVICE + 400 * DAY, DEVICE, never), unknown);
  assert.deepEqual(learned(unknown, DEVICE - 400 * DAY, DEVICE, never), unknown);
  assert.deepEqual(learned(unknown, DEVICE + 399 * DAY, DEVICE, never), { skew: null, last: null, held: 399 * DAY });
});

test("a Date that moves back more than a day behind the last one taken is refused, a day back is taken", () => {
  const good = accepted(DEVICE);
  const later = DEVICE + 3600_000;
  assert.equal(learned(good, DEVICE - 3 * DAY, later, never), good);
  assert.deepEqual(learned(good, DEVICE - DAY + 3600_000, later, never), accepted(DEVICE - DAY + 3600_000, later));
});

test("a proxy's stale Date is held on its first answer and dropped when a good one follows, and a stale one between good ones changes nothing", () => {
  const stale = at("2027-02-10");
  const first = learned(unknown, stale, DEVICE, never);
  assert.deepEqual(first, { skew: null, last: null, held: stale - DEVICE });
  assert.deepEqual(learned(first, DEVICE + 1000, DEVICE, never), accepted(DEVICE + 1000));
  const good = accepted(DEVICE);
  const between = learned(good, stale, DEVICE + 1000, never);
  assert.equal(between.skew, good.skew);
  assert.equal(between.last, good.last);
});

test("a Date a phone with a wrong clock sees is taken on the second answer that agrees with the first, not on the first", () => {
  const served = at("2027-03-01");
  const wrong = at("2027-09-17");
  const first = learned(unknown, served, wrong, never);
  assert.equal(first.skew, null);
  const second = learned(first, served + 5000, wrong + 5000, never);
  assert.deepEqual(second, accepted(served + 5000, wrong + 5000));
  assert.equal(learned(first, at("2027-03-05"), wrong + 5000, never).skew, null);
});

test("two answers that agree with each other are not taken when the rows hold a stamp more than a day after them", () => {
  const served = at("2027-03-01");
  const wrong = at("2027-09-17");
  const first = learned(unknown, served, wrong, () => at("2027-05-01"));
  assert.equal(learned(first, served + 5000, wrong + 5000, () => at("2027-05-01")).skew, null);
  assert.equal(learned(first, served + 5000, wrong + 5000, () => served + DAY).skew, served + 5000 - (wrong + 5000));
  assert.equal(learned(first, served + 5000, wrong + 5000, () => null).skew, served + 5000 - (wrong + 5000));
});

test("two good answers are taken, and the second moves the last Date on", () => {
  const one = learned(unknown, DEVICE, DEVICE, never);
  const two = learned(one, DEVICE + 60_000, DEVICE + 60_000, never);
  assert.deepEqual(two, accepted(DEVICE + 60_000, DEVICE + 60_000));
});

test("the newest stamp is the latest valid tmdb_at of the rows, and nothing when none is valid", () => {
  const rows = [{ data: { tmdb_at: "2027-02-01" } }, { data: { tmdb_at: "2027-02-20" } }, { data: { tmdb_at: "soon" } }, { data: null }, { data: { tmdb_at: 5 } }, { data: {} }];
  assert.equal(newestStamp(rows), Date.parse("2027-02-20"));
  assert.equal(newestStamp([{ data: null }, { data: { tmdb_at: "" } }, { data: { tmdb_at: "2027-02-30x" } }, { data: { tmdb_at: 5 } }, { data: { tmdb_at: 1798761600000 } }]), null);
  assert.equal(newestStamp([]), null);
});
