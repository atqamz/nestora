import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ItemRow } from "../shared/tables.ts";
import { DONE_MIN, validateChange } from "../shared/validate.ts";
import { todayIn } from "../src/domain/dates.ts";
import { datePatch, restoreDate, watchedDate } from "../src/domain/screen.ts";
import { overlay } from "../src/ui/overlay.ts";
import { saveScreen, moveScreen, moveWatched } from "../src/ui/screen-save.ts";
import { text } from "../src/ui/text.ts";
import { apply, id, mutation, stored, createDb, NOW } from "./sync-db.ts";
import { item } from "./domain-rows.ts";
import { client, idOf } from "./store-client.ts";
import { createServer } from "./store-server.ts";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const TODAY = "2026-10-26";

test("watchedDate takes today and earlier, and refuses tomorrow, bad strings and anything before 1888", () => {
  assert.deepEqual(watchedDate("2026-10-26", TODAY), { ok: true, value: "2026-10-26" });
  assert.deepEqual(watchedDate("2026-10-25", TODAY), { ok: true, value: "2026-10-25" });
  assert.deepEqual(watchedDate("2026-10-27", TODAY), { ok: false, reason: "future" });
  assert.deepEqual(watchedDate("2027-01-01", TODAY), { ok: false, reason: "future" });
  assert.deepEqual(watchedDate("1888-01-01", TODAY), { ok: true, value: "1888-01-01" });
  assert.deepEqual(watchedDate("1887-12-31", TODAY), { ok: false, reason: "invalid" });
  assert.equal(DONE_MIN, "1888-01-01");
  for (const bad of ["", "yesterday", "2026-1-5", "2026-02-30", "2026-13-01", "26-10-20", "2026-10-25T00:00:00Z", " 2026-10-25", "0000-00-00"]) {
    assert.deepEqual(watchedDate(bad, TODAY), { ok: false, reason: "invalid" }, bad);
  }
});

test("leap days: 29 February exists only in a leap year", () => {
  assert.equal(watchedDate("2024-02-29", TODAY).ok, true);
  assert.equal(watchedDate("2000-02-29", TODAY).ok, true);
  assert.equal(watchedDate("1900-02-29", TODAY).ok, false);
  assert.equal(watchedDate("2025-02-29", TODAY).ok, false);
  assert.deepEqual(watchedDate("2028-02-29", "2028-02-28"), { ok: false, reason: "future" });
  assert.equal(watchedDate("2028-02-29", "2028-02-29").ok, true);
});

test("the day comes from the app's day helper: around local midnight, today is the device's day, not the UTC day", () => {
  const instant = new Date("2026-10-25T17:30:00Z");
  const jakarta = todayIn(instant, "Asia/Jakarta");
  const honolulu = todayIn(instant, "Pacific/Honolulu");
  assert.equal(jakarta, "2026-10-26");
  assert.equal(honolulu, "2026-10-25");
  assert.equal(watchedDate("2026-10-26", jakarta).ok, true);
  assert.deepEqual(watchedDate("2026-10-26", honolulu), { ok: false, reason: "future" });
  assert.equal(watchedDate("2026-10-25", honolulu).ok, true);
  const justBefore = new Date("2026-10-25T16:59:59Z");
  assert.deepEqual(watchedDate("2026-10-26", todayIn(justBefore, "Asia/Jakarta")), { ok: false, reason: "future" });
});

const watched = (extra: Partial<ItemRow> = {}) => item({ kind: "movie", status: "watched", done_on: "2026-10-17", ...extra });

test("datePatch writes only done_on, writes nothing for the same day, and restoreDate puts the old one back", () => {
  const row = watched();
  assert.deepEqual(datePatch(row, "2026-10-20"), { done_on: "2026-10-20" });
  assert.equal(datePatch(row, "2026-10-17"), null);
  assert.deepEqual(restoreDate(row), { done_on: "2026-10-17" });
});

for (const kind of ["movie", "series"] as const) {
  test(`validateChange for a ${kind}: a past date on a Watched row passes, and the merged row stays valid`, () => {
    const row = watched({ kind });
    assert.deepEqual(validateChange("items", row, { done_on: "2026-10-20" }, "2026-10-27"), []);
    assert.deepEqual(validateChange("items", row, { done_on: "2026-10-27" }, "2026-10-27"), []);
    assert.deepEqual(validateChange("items", row, { done_on: "1888-01-01" }, "2026-10-27"), []);
  });

  test(`validateChange for a ${kind}: refuses a bad date, a future date, a date before 1888 and a date on a row that is not Watched`, () => {
    const row = watched({ kind });
    const errors = (patch: object, current: ItemRow = row) => validateChange("items", current, patch, "2026-10-27").join("\n");
    assert.match(errors({ done_on: "2026-02-30" }), /done_on: must be a date as YYYY-MM-DD/);
    assert.match(errors({ done_on: "soon" }), /done_on: must be a date/);
    assert.match(errors({ done_on: 5 }), /done_on: must be a date/);
    assert.match(errors({ done_on: "2026-10-28" }), /done_on: must not be after 2026-10-27/);
    assert.match(errors({ done_on: "1887-12-31" }), /done_on: must not be before 1888-01-01/);
    assert.match(errors({ done_on: "2026-10-20" }, watched({ kind, status: "want", done_on: null })), /done_on: only allowed when status is watched/);
    assert.match(errors({ done_on: "2026-10-20" }, watched({ kind, status: "watching", done_on: null })), /done_on: only allowed when status is watched/);
    assert.match(errors({ status: "watching", done_on: "2026-10-20" }), /done_on: only allowed when status is watched/);
    assert.deepEqual(validateChange("items", row, { status: "watching", done_on: null }), []);
  });
}

test("validateChange without a latest day checks the shape only, so the local store never needs the clock", () => {
  assert.deepEqual(validateChange("items", watched(), { done_on: "2099-01-01" }), []);
});

test("done_on on kinds that do not allow it, and the future limit on kinds that have no watched rule, are unchanged", () => {
  const book = item({ kind: "book", status: "shelf", done_on: null });
  assert.match(validateChange("items", book, { done_on: "2026-10-20" }, "2026-10-27").join("\n"), /done_on: not used by kind book/);
  const task = item({ kind: "task", status: "done", done_on: "2026-10-17" });
  assert.deepEqual(validateChange("items", task, { done_on: "2099-01-01" }, "2026-10-27"), []);
  const place = item({ kind: "place", status: null });
  assert.match(validateChange("items", place, { done_on: "2026-10-20" }, "2026-10-27").join("\n"), /done_on: not used by kind place/);
});

test("the Worker refuses a future date, a date before 1888 and a date on a row that is not Watched, and keeps the day after UTC for phones ahead of it", async () => {
  const { db, sqlite } = createDb();
  const base = { kind: "movie", title: "Inception", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
  const rows = [
    mutation("create", "items", id(1), { id: id(1), ...base, status: "watched", done_on: "2026-10-05" }),
    mutation("create", "items", id(2), { id: id(2), ...base, title: "Jaws", status: "want" }),
  ];
  assert.equal("errors" in (await apply(db, rows)), false);
  const put = (rowId: string, done_on: string) => apply(db, [mutation("update", "items", rowId, { done_on })]);
  assert.match(((await put(id(1), "2026-10-08")) as { errors: string[] }).errors.join(), /done_on: must not be after 2026-10-07/);
  assert.match(((await put(id(1), "1887-12-31")) as { errors: string[] }).errors.join(), /done_on: must not be before 1888-01-01/);
  assert.match(((await put(id(1), "2026-02-30")) as { errors: string[] }).errors.join(), /done_on/);
  assert.match(((await put(id(2), "2026-10-04")) as { errors: string[] }).errors.join(), /only allowed when status is watched/);
  assert.equal(stored(sqlite, "items", id(1))?.done_on, "2026-10-05");
  assert.equal("errors" in (await put(id(1), "2026-10-07")), false);
  assert.equal(stored(sqlite, "items", id(1))?.done_on, "2026-10-07");
  assert.equal("errors" in (await put(id(1), "2026-10-01")), false);
  assert.equal(NOW.toISOString().slice(0, 10), "2026-10-06");
});

const pair = async () => {
  const server = createServer();
  const a = client(server, "a");
  const b = client(server, "b");
  await a.store.open();
  await b.store.open();
  return { server, a: a.store, b: b.store };
};

const rowOf = (store: ReturnType<typeof client>["store"], rowId: string) => store.getSnapshot().rows.items.find((row) => row.id === rowId) as ItemRow;

const input = { kind: "movie", title: "Inception", year: "2010", status: "watched", who: "both" } as const;

test("moveWatched changes the day, announces it with an Undo that brings the old day back, on both phones", async () => {
  const { server, a, b } = await pair();
  const rowId = idOf(await saveScreen(a.getSnapshot().rows.items, a.create, input, "2026-10-17"));
  await a.sync();
  await b.sync();
  overlay.dismissToast();
  idOf(await moveWatched(a, rowOf(a, rowId), "2026-10-23", TODAY));
  assert.equal(rowOf(a, rowId).done_on, "2026-10-23");
  const toast = overlay.getSnapshot().toast!;
  assert.equal(toast.message, "Watched on 23 Oct 2026: Inception");
  assert.equal(toast.action?.label, "Undo");
  await a.sync();
  await b.sync();
  assert.equal(rowOf(b, rowId).done_on, "2026-10-23");
  toast.action!.run();
  await settle();
  await a.sync();
  await b.sync();
  assert.equal(server.row("items", rowId)!.done_on, "2026-10-17");
  assert.equal(rowOf(b, rowId).done_on, "2026-10-17");
  overlay.dismissToast();
});

test("moveWatched refuses a future date, a bad date and an empty field with the app's words, writes nothing and shows no toast", async () => {
  const { a } = await pair();
  const rowId = idOf(await saveScreen(a.getSnapshot().rows.items, a.create, input, "2026-10-17"));
  await a.sync();
  overlay.dismissToast();
  const row = rowOf(a, rowId);
  assert.deepEqual(await moveWatched(a, row, "2026-10-27", TODAY), { ok: false, errors: [text.screen.watchedDate.future] });
  assert.deepEqual(await moveWatched(a, row, "", TODAY), { ok: false, errors: [text.screen.watchedDate.invalid] });
  assert.deepEqual(await moveWatched(a, row, "1800-01-01", TODAY), { ok: false, errors: [text.screen.watchedDate.invalid] });
  assert.deepEqual(await moveWatched(a, row, "2026-10-17", TODAY), { ok: true, id: rowId });
  assert.equal(a.getSnapshot().pending, 0);
  assert.equal(overlay.getSnapshot().toast, null);
  assert.equal(rowOf(a, rowId).done_on, "2026-10-17");
});

test("a date change and the partner's rating or status change on the same row both survive", async () => {
  const { server, a, b } = await pair();
  const rowId = idOf(await saveScreen(a.getSnapshot().rows.items, a.create, input, "2026-10-17"));
  await a.sync();
  await b.sync();
  idOf(await moveWatched(a, rowOf(a, rowId), "2026-10-20", TODAY));
  idOf(await b.update("items", rowId, { data: { rating_b: "5" } }));
  idOf(await b.update("items", rowId, { note: "Rewatch" }));
  await a.sync();
  await b.sync();
  await a.sync();
  const row = server.row("items", rowId)!;
  assert.equal(row.done_on, "2026-10-20");
  assert.equal(row.note, "Rewatch");
  assert.deepEqual(row.data, { year: 2010, rating_b: "5" });
  assert.equal(rowOf(a, rowId).done_on, "2026-10-20");
  assert.equal(rowOf(b, rowId).done_on, "2026-10-20");
  overlay.dismissToast();
});

test("the partner moves the row off Watched while the date is pending: the date change is refused, the row stays consistent, and moving back stamps today", async () => {
  const { server, a, b } = await pair();
  const rowId = idOf(await saveScreen(a.getSnapshot().rows.items, a.create, input, "2026-10-17"));
  await a.sync();
  await b.sync();
  idOf(await moveWatched(a, rowOf(a, rowId), "2026-10-20", TODAY));
  idOf(await moveScreen(b, rowOf(b, rowId), "watching", "2026-10-25"));
  await b.sync();
  await a.sync();
  await a.sync();
  assert.equal(server.row("items", rowId)!.status, "watching");
  assert.equal(server.row("items", rowId)!.done_on, null);
  assert.equal(rowOf(a, rowId).done_on, null);
  idOf(await moveScreen(a, rowOf(a, rowId), "watched", TODAY));
  assert.equal(rowOf(a, rowId).done_on, TODAY);
  await a.sync();
  assert.equal(server.row("items", rowId)!.done_on, TODAY);
  overlay.dismissToast();
});

test("Watched, Watching, Watched keeps stamping today and a date edit after it Undoes to that day", async () => {
  const { a } = await pair();
  const rowId = idOf(await saveScreen(a.getSnapshot().rows.items, a.create, input, "2026-10-17"));
  idOf(await moveScreen(a, rowOf(a, rowId), "watching", "2026-10-24"));
  idOf(await moveScreen(a, rowOf(a, rowId), "watched", "2026-10-24"));
  idOf(await moveWatched(a, rowOf(a, rowId), "2026-10-21", TODAY));
  assert.equal(rowOf(a, rowId).done_on, "2026-10-21");
  overlay.getSnapshot().toast!.action!.run();
  await settle();
  assert.equal(rowOf(a, rowId).done_on, "2026-10-24");
  overlay.dismissToast();
});

test("an Undo after the partner left Watched says why in a new toast and changes nothing", async () => {
  const { a, b } = await pair();
  const rowId = idOf(await saveScreen(a.getSnapshot().rows.items, a.create, input, "2026-10-17"));
  await a.sync();
  await b.sync();
  idOf(await moveWatched(a, rowOf(a, rowId), "2026-10-20", TODAY));
  const undo = overlay.getSnapshot().toast!.action!;
  idOf(await moveScreen(b, rowOf(b, rowId), "want", TODAY));
  await b.sync();
  await a.sync();
  undo.run();
  await settle();
  assert.match(overlay.getSnapshot().toast!.message, /done_on: only allowed when status is watched/);
  assert.equal(rowOf(a, rowId).status, "want");
  assert.equal(rowOf(a, rowId).done_on, null);
  overlay.dismissToast();
});

test("the detail labels the date input, caps it to the day window, and saves through moveWatched only while the status is Watched", () => {
  const view = read("views/screen.tsx");
  assert.match(view, /<label htmlFor=\{id\}>\{text\.screen\.watchedDate\.label\}<\/label>/);
  assert.equal(text.screen.watchedDate.label, "Watched on");
  assert.match(view, /type="date"/);
  assert.match(view, /min=\{DONE_MIN\}/);
  assert.match(view, /max=\{stamp\(\)\}/);
  assert.match(view, /moveWatched\(actions, row, shown, stamp\(\)\)/);
  assert.match(view, /\{watchedOn !== null && <WatchedOn row=\{row\} day=\{watchedOn\} \/>\}/);
  assert.match(view, /onSubmit=\{save\}/);
  assert.match(view, /disabled=\{busy \|\| shown === day\}/);
  assert.match(view, /role="alert"/);
});

test("a partner's live change never moves a focused or edited date: the draft holds its own base until it is released on blur", () => {
  const view = read("views/screen.tsx");
  assert.match(view, /const shown = draft\?\.value \?\? day;/);
  assert.match(view, /onFocus=\{\(\) => setDraft\(\(now\) => now \?\? \{ base: day, value: day \}\)\}/);
  assert.match(view, /now\.value === now\.base \? null : now/);
  assert.match(view, /if \(result\.ok\) setDraft\(null\);/);
});

test("the date form stays at 44 px and wraps on a narrow screen", () => {
  const css = read("views/books.css");
  assert.match(css, /\.watched-on \{[^}]*flex-wrap: wrap;/);
  assert.match(read("ui/ui.css"), /input,\s*select,\s*textarea,\s*button,\s*\.button \{\s*min-height: 3rem;/);
});
