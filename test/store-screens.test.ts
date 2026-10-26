import { test } from "node:test";
import assert from "node:assert/strict";
import type { ItemRow } from "../shared/tables.ts";
import { ratingOf, ratingPatch, screenSections, statusPatch } from "../src/domain/screen.ts";
import { overlay } from "../src/ui/overlay.ts";
import { text } from "../src/ui/text.ts";
import { moveScreen, removeScreen, saveScreen, screenProblems } from "../src/ui/screen-save.ts";
import type { ScreenInput } from "../src/ui/screen-save.ts";
import type { Written } from "../src/store/store.ts";
import { createServer } from "./store-server.ts";
import { client, idOf } from "./store-client.ts";

const rowOf = (store: ReturnType<typeof client>["store"], id: string) => store.getSnapshot().rows.items.find((row) => row.id === id) as ItemRow | undefined;

const items = (store: ReturnType<typeof client>["store"]) => store.getSnapshot().rows.items;

const input = { kind: "movie", title: "Inception", year: "2010", status: "want", who: "both" } as const;

const pair = async () => {
  const server = createServer();
  const a = client(server, "a");
  const b = client(server, "b");
  await a.store.open();
  await b.store.open();
  return { server, a: a.store, b: b.store };
};

test("saveScreen creates a movie or series with the title trimmed, the year as a number and a new row on top", async () => {
  const { server, a } = await pair();
  const first = idOf(await saveScreen(items(a), a.create, input, "2026-10-17"));
  const second = idOf(await saveScreen(items(a), a.create, { ...input, title: "  Spirited Away ", year: "" }, "2026-10-17"));
  const series = idOf(await saveScreen(items(a), a.create, { ...input, kind: "series", title: "Breaking Bad" }, "2026-10-17"));
  await a.sync();
  assert.deepEqual(
    screenSections(items(a), "movie").want.map((row) => row.title),
    ["Spirited Away", "Inception"],
  );
  assert.deepEqual(server.row("items", first)!.data, { year: 2010 });
  assert.deepEqual(server.row("items", second)!.data, {});
  assert.equal(server.row("items", series)!.kind, "series");
  assert.equal(server.row("items", first)!.who, "both");
  assert.equal(server.row("items", first)!.done_on, null);
});

test("saveScreen on Watched stamps done_on, and refuses an empty title or a bad year before any write", async () => {
  const { server, a } = await pair();
  const done = idOf(await saveScreen(items(a), a.create, { ...input, status: "watched" }, "2026-10-17"));
  await a.sync();
  assert.equal(server.row("items", done)!.done_on, "2026-10-17");
  const before = items(a).length;
  for (const bad of [{ title: "  " }, { year: "99999" }, { year: "abcd" }]) {
    const result = await saveScreen(items(a), a.create, { ...input, ...bad }, "2026-10-17");
    assert.equal(result.ok, false);
  }
  assert.equal(items(a).length, before);
});

test("partner B pulls partner A's movie and sees both of A's choices", async () => {
  const { a, b } = await pair();
  const id = idOf(await saveScreen(items(a), a.create, { ...input, status: "watched", who: "a" }, "2026-10-17"));
  idOf(await a.update("items", id, ratingPatch(rowOf(a, id)!, "a", 4)));
  await a.sync();
  await b.sync();
  const seen = rowOf(b, id)!;
  assert.deepEqual([seen.title, seen.who, seen.status, seen.done_on, ratingOf(seen, "a"), ratingOf(seen, "b")], ["Inception", "a", "watched", "2026-10-17", 4, null]);
});

test("each partner's rating lives under their own key, so two phones that rate offline merge without losing either", async () => {
  const { server, a, b } = await pair();
  const id = idOf(await saveScreen(items(a), a.create, { ...input, status: "watched" }, "2026-10-17"));
  await a.sync();
  await b.sync();
  server.control.down = true;
  idOf(await a.update("items", id, ratingPatch(rowOf(a, id)!, "a", 5)));
  idOf(await b.update("items", id, ratingPatch(rowOf(b, id)!, "b", 2)));
  server.control.down = false;
  await a.sync();
  await b.sync();
  await a.sync();
  assert.deepEqual(server.row("items", id)!.data, { year: 2010, rating_a: "5", rating_b: "2" });
  assert.deepEqual([ratingOf(rowOf(a, id)!, "a"), ratingOf(rowOf(a, id)!, "b")], [5, 2]);
  assert.deepEqual([ratingOf(rowOf(b, id)!, "a"), ratingOf(rowOf(b, id)!, "b")], [5, 2]);
});

test("B's rating patch never carries rating_a, and tapping the same star clears only B's", async () => {
  const { server, a, b } = await pair();
  const id = idOf(await saveScreen(items(a), a.create, { ...input, status: "watched" }, "2026-10-17"));
  idOf(await a.update("items", id, ratingPatch(rowOf(a, id)!, "a", 3)));
  await a.sync();
  await b.sync();
  const patch = ratingPatch(rowOf(b, id)!, "b", 4);
  assert.deepEqual(Object.keys(patch.data as object), ["rating_b"]);
  idOf(await b.update("items", id, patch));
  idOf(await b.update("items", id, ratingPatch(rowOf(b, id)!, "b", 4)));
  await b.sync();
  assert.deepEqual(server.row("items", id)!.data, { year: 2010, rating_a: "3" });
});

test("status moves reach the server with done_on set on watched and cleared after, and the row stays valid", async () => {
  const { server, a } = await pair();
  const id = idOf(await saveScreen(items(a), a.create, input, "2026-10-17"));
  for (const [pick, day, done] of [["watching", "2026-10-18", null], ["watched", "2026-10-19", "2026-10-19"], ["want", "2026-10-20", null]] as const) {
    idOf(await a.update("items", id, statusPatch(rowOf(a, id)!, pick, day)!));
    await a.sync();
    assert.deepEqual([server.row("items", id)!.status, server.row("items", id)!.done_on], [pick, done], pick);
  }
});

test("a movie added offline reaches the server on the next sync, and B sees it", async () => {
  const { server, a, b } = await pair();
  server.control.down = true;
  const id = idOf(await saveScreen(items(a), a.create, { ...input, title: "Parasite" }, "2026-10-17"));
  assert.equal(a.getSnapshot().pending, 1);
  assert.equal(rowOf(a, id)!.title, "Parasite");
  assert.equal(server.row("items", id), undefined);
  server.control.down = false;
  await a.sync();
  assert.equal(a.getSnapshot().pending, 0);
  await b.sync();
  assert.equal(rowOf(b, id)!.title, "Parasite");
});

test("removeScreen deletes, goes back to the list and offers an Undo that brings the row back", async () => {
  const { server, a } = await pair();
  const id = idOf(await saveScreen(items(a), a.create, input, "2026-10-17"));
  await a.sync();
  const went: string[] = [];
  const row = rowOf(a, id)!;
  idOf(await removeScreen({ actions: a, go: (hash) => went.push(hash) }, row, "movie"));
  assert.deepEqual(went, ["/movies"]);
  assert.equal(rowOf(a, id), undefined);
  const toast = overlay.getSnapshot().toast!;
  assert.equal(toast.message, "Deleted: Inception");
  assert.equal(toast.action?.label, "Undo");
  toast.action!.run();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(rowOf(a, id)?.title, "Inception");
  await a.sync();
  assert.equal(server.row("items", id)!.deleted_at, null);
  overlay.dismissToast();
});

test("a deleted series goes back to the series list, and a deleted row on another phone disappears from B", async () => {
  const { a, b } = await pair();
  const id = idOf(await saveScreen(items(a), a.create, { ...input, kind: "series", title: "Breaking Bad" }, "2026-10-17"));
  await a.sync();
  await b.sync();
  const went: string[] = [];
  idOf(await removeScreen({ actions: a, go: (hash) => went.push(hash) }, rowOf(a, id)!, "series"));
  await a.sync();
  await b.sync();
  assert.deepEqual(went, ["/series"]);
  assert.equal(rowOf(b, id), undefined);
  overlay.dismissToast();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("a status move offers an Undo that brings back the earlier status and the watched date, on both phones", async () => {
  const { server, a, b } = await pair();
  const id = idOf(await saveScreen(items(a), a.create, { ...input, status: "watched" }, "2026-10-17"));
  await a.sync();
  idOf(await moveScreen(a, rowOf(a, id)!, "watching", "2026-10-25"));
  assert.deepEqual([rowOf(a, id)!.status, rowOf(a, id)!.done_on], ["watching", null]);
  const toast = overlay.getSnapshot().toast!;
  assert.equal(toast.message, "Moved to Watching: Inception");
  assert.equal(toast.action?.label, "Undo");
  toast.action!.run();
  await settle();
  assert.deepEqual([rowOf(a, id)!.status, rowOf(a, id)!.done_on], ["watched", "2026-10-17"]);
  await a.sync();
  await b.sync();
  assert.deepEqual([server.row("items", id)!.status, server.row("items", id)!.done_on], ["watched", "2026-10-17"]);
  assert.deepEqual([rowOf(b, id)!.status, rowOf(b, id)!.done_on], ["watched", "2026-10-17"]);
  overlay.dismissToast();
});

test("the mis-tap that lost the watched date: watched, Watching, Watched, then Undo on the last move", async () => {
  const { a } = await pair();
  const id = idOf(await saveScreen(items(a), a.create, { ...input, status: "watched" }, "2026-10-17"));
  idOf(await moveScreen(a, rowOf(a, id)!, "watching", "2026-10-25"));
  idOf(await moveScreen(a, rowOf(a, id)!, "watched", "2026-10-25"));
  assert.equal(rowOf(a, id)!.done_on, "2026-10-25");
  assert.equal(overlay.getSnapshot().toast!.message, "Moved to Watched: Inception");
  overlay.getSnapshot().toast!.action!.run();
  await settle();
  assert.deepEqual([rowOf(a, id)!.status, rowOf(a, id)!.done_on], ["watching", null]);
  overlay.dismissToast();
});

test("a move from To watch to Watched and back by Undo leaves no date", async () => {
  const { a } = await pair();
  const id = idOf(await saveScreen(items(a), a.create, input, "2026-10-17"));
  idOf(await moveScreen(a, rowOf(a, id)!, "watched", "2026-10-25"));
  assert.equal(rowOf(a, id)!.done_on, "2026-10-25");
  overlay.getSnapshot().toast!.action!.run();
  await settle();
  assert.deepEqual([rowOf(a, id)!.status, rowOf(a, id)!.done_on], ["want", null]);
  overlay.dismissToast();
});

test("moving to the status the row already has writes nothing and shows no toast", async () => {
  const { a } = await pair();
  const id = idOf(await saveScreen(items(a), a.create, input, "2026-10-17"));
  await a.sync();
  overlay.dismissToast();
  const result = await moveScreen(a, rowOf(a, id)!, "want", "2026-10-25");
  assert.deepEqual(result, { ok: true, id });
  assert.equal(a.getSnapshot().pending, 0);
  assert.equal(overlay.getSnapshot().toast, null);
});

test("a refused move shows no toast and returns the failure, and a refused Undo says why in a new toast", async () => {
  const { a } = await pair();
  const id = idOf(await saveScreen(items(a), a.create, input, "2026-10-17"));
  overlay.dismissToast();
  const refuse = { update: async (): Promise<Written> => ({ ok: false, errors: ["nope"] }) };
  const refused = await moveScreen(refuse, rowOf(a, id)!, "watching", "2026-10-25");
  assert.deepEqual(refused, { ok: false, errors: ["nope"] });
  assert.equal(overlay.getSnapshot().toast, null);
  let calls = 0;
  const flaky = { update: async (): Promise<Written> => (++calls === 1 ? { ok: true, id } : { ok: false, errors: ["gone elsewhere"] }) };
  await moveScreen(flaky, rowOf(a, id)!, "watching", "2026-10-25");
  const first = overlay.getSnapshot().toast!;
  first.action!.run();
  await settle();
  const second = overlay.getSnapshot().toast!;
  assert.equal(second.message, "gone elsewhere");
  assert.equal(second.action, undefined);
  assert.notEqual(second.id, first.id);
  overlay.dismissToast();
});

test("a successful Undo does not announce again", async () => {
  const { a } = await pair();
  const id = idOf(await saveScreen(items(a), a.create, input, "2026-10-17"));
  idOf(await moveScreen(a, rowOf(a, id)!, "watching", "2026-10-25"));
  const first = overlay.getSnapshot().toast!;
  first.action!.run();
  await settle();
  assert.equal(overlay.getSnapshot().toast!.id, first.id);
  overlay.dismissToast();
});

test("the add sheet's problems name the title and the year separately, and saveScreen refuses with them before any write", async () => {
  assert.deepEqual(screenProblems("Heat", "1995"), { title: undefined, year: undefined });
  assert.deepEqual(screenProblems("Heat", ""), { title: undefined, year: undefined });
  assert.deepEqual(screenProblems("  ", "1995"), { title: "Add a title.", year: undefined });
  for (const year of ["5", "1700", "0", "2201", "abc"]) assert.deepEqual(screenProblems("Heat", year), { title: undefined, year: text.invalid.year }, year);
  assert.deepEqual(screenProblems("", "5"), { title: "Add a title.", year: text.invalid.year });
  const { a } = await pair();
  const before = items(a).length;
  assert.deepEqual(await saveScreen(items(a), a.create, { ...input, title: " ", year: "5" }, "2026-10-17"), { ok: false, errors: ["Add a title.", text.invalid.year] });
  assert.deepEqual(await saveScreen(items(a), a.create, { ...input, year: "1700" }, "2026-10-17"), { ok: false, errors: [text.invalid.year] });
  assert.deepEqual(await saveScreen(items(a), a.create, { ...input, title: " ", year: "" }, "2026-10-17"), { ok: false, errors: ["Add a title."] });
  assert.equal(items(a).length, before);
});

test("a refused Undo of a delete says why, and a good one stays quiet", async () => {
  const { a } = await pair();
  const id = idOf(await saveScreen(items(a), a.create, input, "2026-10-17"));
  const row = rowOf(a, id)!;
  const failing = { remove: a.remove, update: async (): Promise<Written> => ({ ok: false, errors: ["too late"] }) };
  await removeScreen({ actions: failing, go: () => undefined }, row, "movie");
  const first = overlay.getSnapshot().toast!;
  first.action!.run();
  await settle();
  assert.equal(overlay.getSnapshot().toast!.message, "too late");
  overlay.dismissToast();
});

test("a new row goes on top of its own kind and status only, whatever sits in the other lists", async () => {
  const { a } = await pair();
  const sortOf = async (fields: Partial<ScreenInput>) => rowOf(a, idOf(await saveScreen(items(a), a.create, { ...input, ...fields }, "2026-10-17")))!.sort;
  assert.equal(await sortOf({ kind: "series", title: "Other kind" }), 0);
  assert.equal(await sortOf({ kind: "series", title: "Other kind again" }), -1);
  assert.equal(await sortOf({ status: "watched", title: "Other status" }), 0);
  assert.equal(await sortOf({ title: "First" }), 0);
  assert.equal(await sortOf({ title: "Second" }), -1);
  assert.equal(await sortOf({ title: "Third" }), -2);
});
