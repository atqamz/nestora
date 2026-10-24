import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { REFRESH_MS, clockAt, minuteOf, watch } from "../src/hooks/clock.ts";

const at = (iso: string) => new Date(iso);

const reading = (iso: string) => clockAt(minuteOf(at(iso)));

test("the minute is the whole minute since the epoch, so the clock never reads ahead of the real time", () => {
  assert.equal(minuteOf(at("1970-01-01T00:00:00.000Z")), 0);
  assert.equal(minuteOf(at("1970-01-01T00:00:59.999Z")), 0);
  assert.equal(minuteOf(at("1970-01-01T00:01:00.000Z")), 1);
  assert.equal(minuteOf(at("2026-10-26T10:30:59.999+07:00")), minuteOf(at("2026-10-26T10:30:00.000+07:00")));
  assert.equal(minuteOf(at("2026-10-26T10:31:00.000+07:00")) - minuteOf(at("2026-10-26T10:30:00.000+07:00")), 1);
});

test("the clock is the routine day and the minutes since its local midnight, whole minutes only", () => {
  assert.deepEqual(reading("2026-10-26T10:30:00+07:00"), { day: "2026-10-26", elapsed: 630 });
  assert.deepEqual(reading("2026-10-26T10:30:59.999+07:00"), { day: "2026-10-26", elapsed: 630 });
  assert.deepEqual(reading("2026-10-26T10:31:00+07:00"), { day: "2026-10-26", elapsed: 631 });
  assert.deepEqual(reading("2026-10-26T00:00:00+07:00"), { day: "2026-10-25", elapsed: 1440 });
  assert.deepEqual(reading("2026-10-26T23:59:00+07:00"), { day: "2026-10-26", elapsed: 1439 });
});

test("the routine day changes at 04:00 and the minutes keep counting from the day before until then", () => {
  assert.deepEqual(reading("2026-10-26T03:59:59.999+07:00"), { day: "2026-10-25", elapsed: 1679 });
  assert.deepEqual(reading("2026-10-26T04:00:00+07:00"), { day: "2026-10-26", elapsed: 240 });
  assert.deepEqual(reading("2026-10-26T04:01:00+07:00"), { day: "2026-10-26", elapsed: 241 });
});

test("the clock is read again every minute and whenever the page becomes visible, and stops when it is released", () => {
  mock.timers.enable({ apis: ["setInterval"] });
  const listeners = new Map<string, () => void>();
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { addEventListener: (name: string, run: () => void) => listeners.set(name, run), removeEventListener: (name: string) => listeners.delete(name) },
  });
  try {
    let reads = 0;
    const release = watch(() => reads++);
    assert.equal(REFRESH_MS, 60_000);
    assert.deepEqual([...listeners.keys()], ["visibilitychange"]);
    mock.timers.tick(REFRESH_MS - 1);
    assert.equal(reads, 0);
    mock.timers.tick(1);
    assert.equal(reads, 1);
    mock.timers.tick(REFRESH_MS * 2);
    assert.equal(reads, 3);
    listeners.get("visibilitychange")?.();
    assert.equal(reads, 4);
    release();
    assert.equal(listeners.size, 0);
    mock.timers.tick(REFRESH_MS * 3);
    assert.equal(reads, 4);
  } finally {
    mock.timers.reset();
    if (original) Object.defineProperty(globalThis, "document", original);
    else delete (globalThis as { document?: unknown }).document;
  }
});
