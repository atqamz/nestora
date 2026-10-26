import { test } from "node:test";
import assert from "node:assert/strict";
import type { ItemRow } from "../shared/tables.ts";
import { collections } from "../src/domain/collection.ts";
import { screenSections } from "../src/domain/screen.ts";
import { moveMember, renameCollection, setCollection } from "../src/ui/collection-flows.ts";
import { overlay } from "../src/ui/overlay.ts";
import { saveScreen } from "../src/ui/screen-save.ts";
import type { ScreenInput } from "../src/ui/screen-save.ts";
import { createServer } from "./store-server.ts";
import { client, idOf } from "./store-client.ts";

type Store = ReturnType<typeof client>["store"];

const items = (store: Store) => store.getSnapshot().rows.items;

const rowOf = (store: Store, id: string) => items(store).find((row) => row.id === id) as ItemRow;

const deps = (store: Store) => ({ items: () => items(store), actions: store });

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const FILMS = ["Hannibal Rising", "Red Dragon", "The Silence of the Lambs", "Hannibal"];

const group = (store: Store, kind: "movie" | "series" = "movie") => collections(items(store), kind);

const order = (store: Store) => group(store)[0].rows.map((row) => row.title);

const pair = async () => {
  const server = createServer();
  const a = client(server, "a").store;
  const b = client(server, "b").store;
  await a.open();
  await b.open();
  const input: ScreenInput = { kind: "movie", title: "", year: "", status: "want", who: "both", collection: "Hannibal" };
  const ids: string[] = [];
  for (const title of FILMS) ids.push(idOf(await saveScreen(items(a), a.create, { ...input, title }, "2026-10-26")));
  await a.sync();
  await b.sync();
  overlay.dismissToast();
  return { server, a, b, ids };
};

test("typing a collection name in the add sheet creates the collection, and each new film joins at the end in the order it was added", async () => {
  const { server, a, ids } = await pair();
  assert.deepEqual(order(a), FILMS);
  assert.deepEqual(ids.map((id) => server.row("items", id)!.data), [0, 1, 2, 3].map((n) => ({ collection: "Hannibal", order: n })));
  assert.deepEqual(screenSections(items(a), "movie").want, []);
});

test("a second spelling of the name joins the same collection under the first spelling, and a bad name writes nothing", async () => {
  const { a } = await pair();
  const before = items(a).length;
  idOf(await saveScreen(items(a), a.create, { kind: "movie", title: "Manhunter", year: "", status: "want", who: "both", collection: " hannibal " }, "2026-10-26"));
  assert.equal(group(a).length, 1);
  assert.equal(group(a)[0].name, "Hannibal");
  assert.equal(group(a)[0].rows.at(-1)!.title, "Manhunter");
  for (const collection of ["???", "x".repeat(61)]) {
    assert.equal((await saveScreen(items(a), a.create, { kind: "movie", title: "Nope", year: "", status: "want", who: "both", collection }, "2026-10-26")).ok, false);
  }
  assert.equal(items(a).length, before + 1);
});

test("Move up and Move down patch one row's order key, reach the partner, and the rest of the row is untouched", async () => {
  const { server, a, b, ids } = await pair();
  idOf(await moveMember(deps(a), "movie", rowOf(a, ids[2]), -1));
  assert.deepEqual(order(a), ["Hannibal Rising", "The Silence of the Lambs", "Red Dragon", "Hannibal"]);
  assert.equal(a.getSnapshot().pending, 1);
  await a.sync();
  assert.deepEqual(server.row("items", ids[2])!.data, { collection: "Hannibal", order: 0.5 });
  assert.deepEqual(server.row("items", ids[1])!.data, { collection: "Hannibal", order: 1 });
  await b.sync();
  assert.deepEqual(order(b), order(a));
  assert.equal(overlay.getSnapshot().toast!.message, "Moved: The Silence of the Lambs, now 2 of 4");
});

test("Undo of a move puts the key back on both phones", async () => {
  const { server, a, b, ids } = await pair();
  idOf(await moveMember(deps(a), "movie", rowOf(a, ids[3]), -1));
  await a.sync();
  overlay.getSnapshot().toast!.action!.run();
  await settle();
  await a.sync();
  await b.sync();
  assert.deepEqual(order(a), FILMS);
  assert.deepEqual(order(b), FILMS);
  assert.deepEqual(server.row("items", ids[3])!.data, { collection: "Hannibal", order: 3 });
  overlay.dismissToast();
});

test("a move at either end writes nothing and shows no toast", async () => {
  const { a, ids } = await pair();
  assert.deepEqual(await moveMember(deps(a), "movie", rowOf(a, ids[0]), -1), { ok: true, id: ids[0] });
  assert.deepEqual(await moveMember(deps(a), "movie", rowOf(a, ids[3]), 1), { ok: true, id: ids[3] });
  assert.equal(a.getSnapshot().pending, 0);
  assert.equal(overlay.getSnapshot().toast, null);
});

test("both partners reorder different rows at once while offline, and after syncing both phones agree on one order that keeps both moves", async () => {
  const { server, a, b, ids } = await pair();
  server.control.down = true;
  idOf(await moveMember(deps(a), "movie", rowOf(a, ids[1]), 1));
  idOf(await moveMember(deps(b), "movie", rowOf(b, ids[3]), -1));
  server.control.down = false;
  await a.sync();
  await b.sync();
  await a.sync();
  assert.deepEqual(order(a), order(b));
  assert.deepEqual(order(a), ["Hannibal Rising", "Hannibal", "The Silence of the Lambs", "Red Dragon"]);
  const keys = ids.map((id) => (server.row("items", id)!.data as { order: number }).order);
  assert.equal(new Set(keys).size, 4);
  overlay.dismissToast();
});

test("both partners move the same row at once: the last write wins and both phones converge without a duplicate key", async () => {
  const { server, a, b, ids } = await pair();
  server.control.down = true;
  idOf(await moveMember(deps(a), "movie", rowOf(a, ids[1]), 1));
  idOf(await moveMember(deps(b), "movie", rowOf(b, ids[1]), -1));
  server.control.down = false;
  await a.sync();
  await b.sync();
  await a.sync();
  assert.deepEqual(order(a), order(b));
  assert.equal(order(a).length, 4);
  overlay.dismissToast();
});

test("one partner renames while the other reorders: the rename lands on every member, the new key survives, nothing else is touched", async () => {
  const { server, a, b, ids } = await pair();
  server.control.down = true;
  idOf(await renameCollection(deps(a), "movie", "Hannibal", "Hannibal Lecter"));
  idOf(await moveMember(deps(b), "movie", rowOf(b, ids[3]), -1));
  server.control.down = false;
  await a.sync();
  await b.sync();
  await a.sync();
  for (const store of [a, b]) {
    assert.equal(group(store).length, 1);
    assert.equal(group(store)[0].name, "Hannibal Lecter");
    assert.deepEqual(order(store), ["Hannibal Rising", "Red Dragon", "Hannibal", "The Silence of the Lambs"]);
  }
  assert.deepEqual(ids.map((id) => (server.row("items", id)!.data as { collection: string }).collection), Array(4).fill("Hannibal Lecter"));
  overlay.dismissToast();
});

test("renaming is one batch of field patches, and Undo restores each member's old spelling and nothing else", async () => {
  const { server, a, b, ids } = await pair();
  idOf(await renameCollection(deps(a), "movie", "Hannibal", "Hannibal Lecter"));
  assert.equal(a.getSnapshot().pending, 4);
  const renamed = overlay.getSnapshot().toast!;
  assert.equal(renamed.message, "Renamed Hannibal to Hannibal Lecter");
  await a.sync();
  idOf(await moveMember(deps(b), "movie", rowOf(b, ids[0]), 1));
  await b.sync();
  await a.sync();
  renamed.action!.run();
  await settle();
  await a.sync();
  await b.sync();
  assert.deepEqual(ids.map((id) => (server.row("items", id)!.data as { collection: string }).collection), Array(4).fill("Hannibal"));
  assert.deepEqual(order(b), ["Red Dragon", "Hannibal Rising", "The Silence of the Lambs", "Hannibal"]);
  assert.deepEqual(order(a), order(b));
  overlay.dismissToast();
});

test("a rename into another collection's name, an empty name or a bad one is refused before any write", async () => {
  const { a } = await pair();
  idOf(await saveScreen(items(a), a.create, { kind: "movie", title: "Alien", year: "", status: "want", who: "both", collection: "Alien" }, "2026-10-26"));
  await a.sync();
  const pending = a.getSnapshot().pending;
  assert.deepEqual(await renameCollection(deps(a), "movie", "Hannibal", "alien "), { ok: false, errors: ["Another collection already has that name."] });
  for (const bad of ["", "   ", "???", "x".repeat(61)]) assert.equal((await renameCollection(deps(a), "movie", "Hannibal", bad)).ok, false, bad);
  assert.equal(a.getSnapshot().pending, pending);
  assert.equal(group(a).length, 2);
  idOf(await renameCollection(deps(a), "movie", "Hannibal", "HANNIBAL"));
  assert.deepEqual(await renameCollection(deps(a), "movie", "HANNIBAL", "HANNIBAL"), { ok: true, id: "" });
  overlay.dismissToast();
});

test("a case-only rename rewrites every member's spelling", async () => {
  const { a } = await pair();
  idOf(await renameCollection(deps(a), "movie", "Hannibal", "HANNIBAL"));
  assert.equal(group(a)[0].name, "HANNIBAL");
  overlay.dismissToast();
});

test("assigning a loose film puts it last, removing it puts it back in To watch where it was, and Undo returns each state", async () => {
  const { server, a, b } = await pair();
  const loose = idOf(await saveScreen(items(a), a.create, { kind: "movie", title: "Manhunter", year: "", status: "want", who: "both" }, "2026-10-26"));
  const other = idOf(await saveScreen(items(a), a.create, { kind: "movie", title: "Heat", year: "", status: "want", who: "both" }, "2026-10-26"));
  await a.sync();
  const wants = () => screenSections(items(a), "movie").want.map((row) => row.title);
  assert.deepEqual(wants(), ["Heat", "Manhunter"]);
  idOf(await setCollection(deps(a), "movie", rowOf(a, loose), "hannibal"));
  assert.deepEqual(order(a).at(-1), "Manhunter");
  assert.deepEqual(wants(), ["Heat"]);
  assert.equal(overlay.getSnapshot().toast!.message, "Added to Hannibal: Manhunter");
  overlay.getSnapshot().toast!.action!.run();
  await settle();
  assert.deepEqual(wants(), ["Heat", "Manhunter"]);
  idOf(await setCollection(deps(a), "movie", rowOf(a, loose), "Hannibal"));
  idOf(await setCollection(deps(a), "movie", rowOf(a, loose), ""));
  assert.equal(overlay.getSnapshot().toast!.message, "Removed from Hannibal: Manhunter");
  assert.deepEqual(wants(), ["Heat", "Manhunter"]);
  await a.sync();
  assert.deepEqual(server.row("items", loose)!.data, {});
  assert.deepEqual(server.row("items", other)!.data, {});
  overlay.getSnapshot().toast!.action!.run();
  await settle();
  assert.deepEqual(order(a).at(-1), "Manhunter");
  await a.sync();
  await b.sync();
  assert.deepEqual(order(b), [...FILMS, "Manhunter"]);
  overlay.dismissToast();
});

test("changing a row's collection moves it to the end of the other one, and the same name or a blank on a loose row writes nothing", async () => {
  const { a, ids } = await pair();
  const [first] = group(a);
  assert.equal(first.rows.length, 4);
  idOf(await setCollection(deps(a), "movie", rowOf(a, ids[0]), "Alien"));
  assert.deepEqual(group(a).map(({ name, rows }) => [name, rows.length]), [["Alien", 1], ["Hannibal", 3]]);
  assert.deepEqual(await setCollection(deps(a), "movie", rowOf(a, ids[0]), "ALIEN"), { ok: true, id: ids[0] });
  const loose = idOf(await saveScreen(items(a), a.create, { kind: "movie", title: "Heat", year: "", status: "want", who: "both" }, "2026-10-26"));
  const after = a.getSnapshot().pending;
  assert.deepEqual(await setCollection(deps(a), "movie", rowOf(a, loose), "   "), { ok: true, id: loose });
  assert.equal(a.getSnapshot().pending, after);
  assert.equal((await setCollection(deps(a), "movie", rowOf(a, loose), "???")).ok, false);
  overlay.dismissToast();
});

test("watching a member moves the next-up mark and never the member's place in the order", async () => {
  const { a, b, ids } = await pair();
  assert.equal(group(a)[0].next, ids[0]);
  idOf(await a.update("items", ids[0], { status: "watched", done_on: "2026-10-26" }));
  idOf(await a.update("items", ids[1], { status: "watching" }));
  await a.sync();
  await b.sync();
  assert.equal(group(b)[0].next, ids[1]);
  assert.deepEqual(order(b), FILMS);
  idOf(await b.update("items", ids[1], { status: "watched", done_on: "2026-10-27" }));
  assert.equal(group(b)[0].next, ids[2]);
});

test("a movie collection and a series collection with the same name stay apart", async () => {
  const { a } = await pair();
  idOf(await saveScreen(items(a), a.create, { kind: "series", title: "Hannibal (TV)", year: "", status: "want", who: "both", collection: "Hannibal" }, "2026-10-26"));
  assert.equal(group(a, "movie")[0].rows.length, 4);
  assert.equal(group(a, "series")[0].rows.length, 1);
});
