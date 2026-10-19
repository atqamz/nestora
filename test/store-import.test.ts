import { after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { MAX_BODY_BYTES, MAX_MUTATIONS } from "../shared/api.ts";
import { LONGTEXT_MAX, TEXT_MAX } from "../shared/validate.ts";
import { batchRows, previewOf, readInput, stepsOf } from "../src/domain/import-plan.ts";
import { parseBookCsv } from "../src/domain/import-csv.ts";
import type { Choices } from "../src/domain/import-plan.ts";
import type { Row } from "../src/domain/import-csv.ts";
import { createApi } from "../src/store/api.ts";
import { memoryPersistence } from "../src/store/memory.ts";
import type { Persistence, Write } from "../src/store/persistence.ts";
import { createStore } from "../src/store/store.ts";
import { BATCH_BYTES } from "../src/store/outbox.ts";
import { announceImport, createAll, restoreImport, sweepUndone, undoImport, undoneImports } from "../src/ui/book-import.ts";
import { overlay } from "../src/ui/overlay.ts";
import { createServer } from "./store-server.ts";
import type { Server } from "./store-server.ts";

after(() => overlay.dismissToast());

afterEach(async () => {
  for (const entry of undoneImports.get()) await restoreImport(entry.batch, async () => ({ ok: true, id: "" }));
});

const read = (store: ReturnType<typeof createStore>) => () => store.getSnapshot().rows.items;

const labels = { a: "Partner A", b: "Partner B" };

const row = (title: string, extra: Partial<Row> = {}): Row => ({
  title,
  original_title: "",
  author: "Placeholder Author",
  rated_elsewhere: "",
  blurb: "",
  isbn: "",
  language: "",
  status: "",
  place: "",
  owner: "",
  note: "",
  genre: "",
  warnings: [],
  ...extra,
});

const shelf: Choices = { kind: "shelf", owner: "both", placeId: null };

const stepsFor = (store: ReturnType<typeof createStore>, rows: Row[], choices: Choices = shelf, batch = "batch-1") =>
  stepsOf(
    previewOf(rows, store.getSnapshot().rows.items),
    choices,
    { items: store.getSnapshot().rows.items, labels, batch, id: () => crypto.randomUUID() },
  );

const counted = (real: Persistence) => {
  const control = { failing: false, writes: [] as Write[] };
  const persistence: Persistence = {
    load: () => real.load(),
    reset: (expected, meta) => real.reset(expected, meta),
    write: async (write) => {
      if (control.failing) throw new Error("QuotaExceededError");
      control.writes.push(write);
      return real.write(write);
    },
  };
  return { control, persistence };
};

const started = async (server: Server, side: "a" | "b" = "a") => {
  const { control, persistence } = counted(memoryPersistence());
  const store = createStore({ persistence, api: createApi(server.as(side)) });
  await store.open();
  await store.sync();
  return { store, control };
};

const posts = (server: Server) => server.seen.filter((request) => request.method === "POST");

const rowsOf = (store: ReturnType<typeof createStore>) => store.getSnapshot().rows.items;

test("one many call is one persisted write and one outbox append, in the order given", async () => {
  const server = createServer();
  const { store, control } = await started(server);
  server.control.down = true;
  const before = control.writes.length;
  const result = await createAll(stepsFor(store, [row("Laskar Pelangi"), row("Bumi Manusia")]), store.many);
  assert.equal(result.ok, true);
  assert.equal(control.writes.length - before, 1);
  assert.equal(control.writes.at(-1)!.outbox!.put!.length, 4);
  assert.deepEqual(control.writes.at(-1)!.outbox!.put!.map((entry) => entry.patch.kind), ["book", "copy", "book", "copy"]);
  assert.equal(store.getSnapshot().pending, 4);
});

test("an import made offline shows at once under the author's side, survives the wait, and reaches the server in requests of at most 20", async () => {
  for (const side of ["a", "b"] as const) {
    const server = createServer();
    const { store } = await started(server, side);
    server.control.down = true;
    const rows = Array.from({ length: 45 }, (_, at) => row(`Placeholder ${at}`, { blurb: "A synopsis — with dashes." }));
    assert.equal((await createAll(stepsFor(store, rows), store.many)).ok, true);
    const snap = store.getSnapshot();
    assert.equal(snap.pending, 90);
    assert.equal(snap.rows.items.length, 90);
    assert.ok(snap.rows.items.every((item) => item.updated_by === side && item.data?.import_batch === "batch-1"));
    await store.sync();
    assert.equal(posts(server).length, 0);
    server.control.down = false;
    await store.sync();
    assert.deepEqual(posts(server).map((request) => request.mutations), [20, 20, 20, 20, 10]);
    assert.equal(store.getSnapshot().pending, 0);
    for (const item of rowsOf(store)) {
      const stored = server.row("items", item.id)!;
      assert.equal(stored.updated_by, side);
      if (item.kind === "copy") assert.equal(server.row("items", item.parent_id!)?.kind, "book");
    }
  }
});

test("the largest import allowed, every field at its cap, goes out as 50 requests inside the count and byte limits", async () => {
  const server = createServer();
  const { store } = await started(server);
  const long = (size: number) => `${"w".repeat(9)} `.repeat(Math.ceil(size / 10)).slice(0, size - 1) + "x";
  const rows = Array.from({ length: 500 }, (_, at) =>
    row(`${at} ${long(TEXT_MAX - 4)}`, { original_title: long(TEXT_MAX), author: long(TEXT_MAX), rated_elsewhere: long(TEXT_MAX), blurb: long(LONGTEXT_MAX), note: long(10000), genre: long(TEXT_MAX) }),
  );
  const steps = stepsFor(store, rows);
  const result = await createAll(steps, store.many);
  assert.deepEqual(result, { ok: true, id: steps[0][0].id });
  assert.equal(store.getSnapshot().pending, 1000);
  await store.sync();
  const sent = posts(server);
  assert.equal(sent.length, 50);
  assert.ok(sent.every((request) => request.mutations <= MAX_MUTATIONS && request.bytes <= MAX_BODY_BYTES));
  assert.ok(sent.every((request) => request.bytes <= BATCH_BYTES + 4096));
  assert.equal(store.getSnapshot().pending, 0);
  assert.equal(rowsOf(store).length, 1000);
});

test("one bad draft refuses the whole import and leaves the outbox and the rows as they were", async () => {
  const server = createServer();
  const { store, control } = await started(server);
  const steps = stepsFor(store, [row("Fine"), row("Also fine")]);
  steps[1][0].draft.who = "somebody";
  const before = control.writes.length;
  const result = await createAll(steps, store.many);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.errors.join(), /who/);
  assert.deepEqual([store.getSnapshot().pending, rowsOf(store).length, control.writes.length - before], [0, 0, 0]);
  assert.equal(posts(server).length, 0);
});

test("a write the phone cannot keep rolls the import back and says so", async () => {
  const server = createServer();
  const { store, control } = await started(server);
  control.failing = true;
  const result = await createAll(stepsFor(store, [row("A"), row("B")]), store.many);
  assert.deepEqual(result, { ok: false, errors: [], storage: true });
  assert.deepEqual([store.getSnapshot().pending, rowsOf(store).length, store.getSnapshot().storage], [0, 0, "failed"]);
});

test("undoing an import hides every book and copy of the batch and nothing else, and the toast's Undo brings them all back", async () => {
  const server = createServer();
  const { store } = await started(server);
  await store.create("items", { kind: "book", title: "Typed by hand", status: "wish", who: "a" });
  await createAll(stepsFor(store, [row("A"), row("B"), row("C")]), store.many);
  await createAll(stepsFor(store, [row("D")], shelf, "batch-2"), store.many);
  await store.sync();
  assert.equal(rowsOf(store).length, 1 + 6 + 2);
  const ids = batchRows(rowsOf(store), "batch-1").map((item) => item.id);
  assert.equal(ids.length, 6);

  const undone = await undoImport("batch-1", read(store), store.many);
  assert.equal(undone.ok, true);
  assert.deepEqual(rowsOf(store).map((item) => item.title).sort(), ["D", "D", "Typed by hand"]);
  const toast = overlay.getSnapshot().toast!;
  assert.equal(toast.message, "Undid the import of 3 books");
  assert.equal(toast.action!.label, "Undo");
  await store.sync();
  for (const id of ids) assert.notEqual(server.row("items", id)!.deleted_at, null);
  assert.equal(server.row("items", rowsOf(store).find((item) => item.title === "D" && item.kind === "book")!.id)!.deleted_at, null);

  toast.action!.run();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(rowsOf(store).length, 9);
  await store.sync();
  for (const id of ids) assert.equal(server.row("items", id)!.deleted_at, null);
});

test("an import and its undo made while offline sync later in order, and the server ends with nothing visible", async () => {
  const server = createServer();
  const { store } = await started(server);
  server.control.down = true;
  const steps = stepsFor(store, [row("A"), row("B")]);
  await createAll(steps, store.many);
  const ids = steps.flat().map((created) => created.id);
  await undoImport("batch-1", read(store), store.many);
  assert.equal(rowsOf(store).length, 0);
  assert.equal(store.getSnapshot().pending, 8);
  server.control.down = false;
  await store.sync();
  assert.equal(store.getSnapshot().pending, 0);
  for (const id of ids) assert.notEqual(server.row("items", id)!.deleted_at, null);
});

test("the import toast offers Undo for the whole batch", async () => {
  const server = createServer();
  const { store } = await started(server);
  const steps = stepsFor(store, [row("A"), row("B")]);
  await createAll(steps, store.many);
  const ids = steps.flat().map((created) => created.id);
  announceImport("batch-1", 2, read(store), store.many);
  const toast = overlay.getSnapshot().toast!;
  assert.equal(toast.message, "Imported 2 books");
  toast.action!.run();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(rowsOf(store).length, 0);
});

test("pasting the same list again flags every row as already there and unticks it, so the shelf is not doubled", async () => {
  const server = createServer();
  const { store } = await started(server);
  const paste = "1. Laskar Pelangi  Penulis: Andrea Hirata  Sinopsis: A story.2. Bumi Manusia  Penulis: Pramoedya Ananta Toer  Sinopsis: Another.";
  const first = readInput(paste, "list").rows;
  await createAll(stepsFor(store, first, { kind: "wish", owner: "a", placeId: null }), store.many);
  assert.equal(rowsOf(store).length, 2);
  const again = previewOf(readInput(paste, "list").rows, rowsOf(store));
  assert.deepEqual(again.map((entry) => [entry.checked, entry.warnings]), [[false, ["exists"]], [false, ["exists"]]]);
});

test("steps that change nothing are skipped, and a row that does not exist fails the call before anything is written", async () => {
  const server = createServer();
  const { store, control } = await started(server);
  const kept = idOf(await store.create("items", { kind: "book", title: "Kept", status: "wish", who: "a" }));
  const before = control.writes.length;
  assert.deepEqual(await store.many([]), { ok: true, id: "" });
  assert.deepEqual(await store.many([{ op: "update", table: "items", id: kept, change: { title: "Kept" } }]), { ok: true, id: "" });
  assert.equal(control.writes.length, before);
  const missing = await store.many([{ op: "delete", table: "items", id: kept }, { op: "delete", table: "items", id: crypto.randomUUID() }]);
  assert.deepEqual(missing, { ok: false, errors: ["row: not found"], step: 1 });
  assert.equal(rowsOf(store).length, 1);
});

const idOf = (written: Awaited<ReturnType<ReturnType<typeof createStore>["create"]>>) => {
  if (!written.ok) throw new Error(written.errors.join());
  return written.id;
};

const orphansOf = (items: readonly { id: string; kind?: unknown; parent_id?: unknown; deleted_at?: unknown }[]) => {
  const live = new Set(items.filter((item) => item.deleted_at === null || item.deleted_at === undefined).map((item) => item.id));
  return items.filter((item) => item.kind === "copy" && (item.deleted_at ?? null) === null && !live.has(String(item.parent_id)));
};

const serverOrphans = (server: Server) => orphansOf(server.rows("items") as never);

const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

const lentCopy = (parent: string, title: string) => ({ kind: "copy", parent_id: parent, title, status: "lent", who: "a" as const, data: { format: "print", lent_to: "Partner B" } });

const titled = (store: ReturnType<typeof createStore>, title: string, kind: "book" | "copy" = "book") => rowsOf(store).find((item) => item.title === title && item.kind === kind)!;

test("undoing an import also hides copies added after it, by either partner, and Undo brings back exactly the same rows", async () => {
  const server = createServer();
  const a = await started(server, "a");
  const b = await started(server, "b");
  const hand = idOf(await a.store.create("items", { kind: "book", title: "Typed by hand", status: "shelf", who: "both" }));
  await a.store.create("items", { kind: "copy", parent_id: hand, title: "Typed by hand", status: "here", who: "both", data: { format: "print" } });
  await createAll(stepsFor(a.store, [row("Laskar Pelangi"), row("Bumi Manusia"), row("The Little Prince", { status: "wish" })]), a.store.many);
  await createAll(stepsFor(a.store, [row("Other")], shelf, "batch-2"), a.store.many);
  await a.store.sync();
  await b.store.sync();
  assert.equal(rowsOf(b.store).length, 2 + 5 + 2);

  idOf(await b.store.create("items", lentCopy(titled(b.store, "Laskar Pelangi").id, "Laskar Pelangi")));
  await b.store.update("items", titled(b.store, "Bumi Manusia").id, { data: { reading_a: "read", rating_a: "5" } });
  const wish = titled(b.store, "The Little Prince");
  await b.store.update("items", wish.id, { status: "shelf", who: null });
  idOf(await b.store.create("items", { kind: "copy", parent_id: wish.id, title: wish.title, status: "here", who: "a", data: { format: "print" } }));
  await b.store.sync();
  await a.store.sync();
  assert.equal(rowsOf(a.store).length, 2 + 5 + 2 + 2);
  const before = rowsOf(a.store).filter((item) => item.data?.import_batch !== "batch-2" && item.title !== "Typed by hand" && item.title !== "Other").map((item) => item.id);
  assert.equal(before.length, 5 + 2);
  assert.equal(batchRows(rowsOf(a.store), "batch-1").length, before.length);

  assert.equal((await undoImport("batch-1", read(a.store), a.store.many)).ok, true);
  assert.deepEqual(rowsOf(a.store).map((item) => item.title).sort(), ["Other", "Other", "Typed by hand", "Typed by hand"]);
  await a.store.sync();
  await b.store.sync();
  assert.deepEqual(rowsOf(b.store).map((item) => item.title).sort(), ["Other", "Other", "Typed by hand", "Typed by hand"]);
  for (const id of before) assert.notEqual(server.row("items", id)!.deleted_at, null);
  assert.deepEqual(serverOrphans(server), []);

  overlay.getSnapshot().toast!.action!.run();
  await settled();
  await a.store.sync();
  await b.store.sync();
  const live = server.rows("items").filter((item) => item.deleted_at === null).map((item) => String(item.id)).sort();
  assert.equal(live.length, 11);
  for (const store of [a.store, b.store]) {
    assert.deepEqual(rowsOf(store).map((item) => item.id).sort(), live);
    assert.equal(rowsOf(store).filter((item) => item.status === "lent").length, 1);
    assert.deepEqual([titled(store, "Bumi Manusia").data?.reading_a, titled(store, "Bumi Manusia").data?.rating_a], ["read", "5"]);
    assert.equal(titled(store, "The Little Prince").status, "shelf");
  }
  assert.deepEqual(serverOrphans(server), []);
  assert.deepEqual(undoneImports.get(), []);
});

test("a copy a partner added before seeing the undo is hidden as soon as it arrives, and Undo brings it back with the rest", async () => {
  const server = createServer();
  const a = await started(server, "a");
  const b = await started(server, "b");
  await createAll(stepsFor(a.store, [row("Laskar Pelangi"), row("Bumi Manusia")]), a.store.many);
  await a.store.sync();
  await b.store.sync();
  const copy = idOf(await b.store.create("items", lentCopy(titled(b.store, "Laskar Pelangi").id, "Laskar Pelangi")));
  await b.store.sync();
  assert.equal(rowsOf(a.store).length, 4);

  await undoImport("batch-1", read(a.store), a.store.many);
  await a.store.sync();
  assert.equal(orphansOf(rowsOf(a.store)).length, 1);
  assert.equal(serverOrphans(server).length, 1);
  sweepUndone(rowsOf(a.store), a.store.many);
  await settled();
  await a.store.sync();
  assert.deepEqual([rowsOf(a.store).length, serverOrphans(server).length], [0, 0]);
  assert.notEqual(server.row("items", copy)!.deleted_at, null);
  sweepUndone(rowsOf(a.store), a.store.many);
  await b.store.sync();
  assert.equal(rowsOf(b.store).length, 0);

  overlay.getSnapshot().toast!.action!.run();
  await settled();
  await a.store.sync();
  await b.store.sync();
  assert.deepEqual([rowsOf(a.store).length, rowsOf(b.store).length, server.row("items", copy)!.deleted_at], [5, 5, null]);
  assert.deepEqual(serverOrphans(server), []);
});

test("an undo made while only part of the import has synced, with a partner adding a copy in between, leaves nothing live under a hidden book", async () => {
  const server = createServer();
  const flaky = { posts: 0, limit: Infinity };
  const side = server.as("a");
  const persistence = memoryPersistence();
  const a = createStore({
    persistence,
    api: createApi(async (url, init) => {
      if (init.method === "POST" && ++flaky.posts > flaky.limit) throw new TypeError("down");
      return side(url, init);
    }),
  });
  await a.open();
  await a.sync();
  const b = (await started(server, "b")).store;
  const titles = Array.from({ length: 30 }, (_, at) => `Placeholder ${at}`);
  await createAll(stepsFor(a, titles.map((title) => row(title))), a.many);
  flaky.limit = flaky.posts + 1;
  await a.sync();
  assert.equal(a.getSnapshot().pending > 0, true);
  const reached = server.rows("items").length;
  assert.ok(reached > 0 && reached < 60, String(reached));

  await b.sync();
  assert.equal(rowsOf(b).length, reached);
  const first = rowsOf(b).find((item) => item.kind === "book")!;
  const lent = idOf(await b.create("items", lentCopy(first.id, first.title)));
  await b.sync();

  assert.equal((await undoImport("batch-1", read(a), a.many)).ok, true);
  flaky.limit = Infinity;
  await a.sync();
  assert.equal(a.getSnapshot().pending, 0);
  sweepUndone(rowsOf(a), a.many);
  await settled();
  await a.sync();
  await b.sync();
  assert.deepEqual([rowsOf(a).length, rowsOf(b).length], [0, 0]);
  assert.deepEqual(serverOrphans(server), []);
  assert.equal(server.rows("items").filter((item) => item.deleted_at === null).length, 0);
  assert.notEqual(server.row("items", lent)!.deleted_at, null);
});

test("a failed hide says nothing about success and remembers nothing, and an unknown batch restores nothing", async () => {
  overlay.dismissToast();
  const server = createServer();
  const { store } = await started(server);
  await createAll(stepsFor(store, [row("A")]), store.many);
  const result = await undoImport("batch-1", read(store), async () => ({ ok: false, errors: ["nope"] }));
  assert.deepEqual([result.ok, overlay.getSnapshot().toast, undoneImports.get()], [false, null, []]);
  assert.equal((await undoImport("nothing", read(store), store.many)).ok, true);
  assert.equal(overlay.getSnapshot().toast, null);
  assert.deepEqual(await restoreImport("nothing", store.many), { ok: true, id: "" });
  assert.equal(rowsOf(store).length, 2);
});

test("a hidden import stays on offer for the session, and restoring it clears the offer", async () => {
  const server = createServer();
  const { store } = await started(server);
  await createAll(stepsFor(store, [row("A"), row("B")]), store.many);
  await undoImport("batch-1", read(store), store.many);
  const [entry] = undoneImports.get();
  assert.deepEqual([entry.batch, entry.books.length, entry.ids.length], ["batch-1", 2, 4]);
  assert.match(entry.at, /^\d{4}-\d\d-\d\dT/);
  assert.equal((await restoreImport("batch-1", store.many)).ok, true);
  assert.deepEqual([undoneImports.get(), rowsOf(store).length], [[], 4]);
});

test("a row that fails validation is named in the error, wherever it sits in the list", async () => {
  const server = createServer();
  const { store } = await started(server);
  const steps = stepsFor(store, [row("Fine"), row("Placeholder Third"), row("Placeholder Fourth")]);
  steps[2][0].draft.who = "somebody";
  const result = await createAll(steps, store.many);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.errors[0], /^Placeholder Fourth: .*who/);
  assert.equal(rowsOf(store).length, 0);
  const steps2 = stepsFor(store, [row("Fine")]);
  steps2[0][1].draft.group_key = 5;
  const second = await createAll(steps2, store.many);
  assert.match(second.ok ? "" : second.errors[0], /^Fine: /);
});

test("a list row whose author holds only invisible characters imports with a warning, and the rest of the batch goes in", async () => {
  const server = createServer();
  const { store } = await started(server);
  const read = readInput("1. Placeholder One  Penulis: Writer One\n2. Placeholder Blank  Penulis: \u2800\n3. Placeholder Three  Penulis: Writer Three", "list");
  const entries = previewOf(read.rows, []);
  assert.deepEqual(entries.map((entry) => entry.warnings), [[], ["hidden", "missing_author"], []]);
  assert.equal((await createAll(stepsFor(store, read.rows), store.many)).ok, true);
  assert.equal(titled(store, "Placeholder Blank").data?.author, undefined);
  assert.equal(rowsOf(store).length, 6);
  const csv = parseBookCsv("Title,Author,Blurb\nPlaceholder Blank,\u3164,\u200b\u2800");
  assert.deepEqual(csv.rows[0].warnings, ["hidden", "missing_author"]);
  assert.equal((await createAll(stepsFor(store, csv.rows, shelf, "batch-9"), store.many)).ok, true);
});

test("when Undo cannot bring the import back, or the import cannot be undone, the toast says why and the offer stays", async () => {
  const server = createServer();
  const { store } = await started(server);
  await createAll(stepsFor(store, [row("A")]), store.many);
  const refusing: typeof store.many = async (steps) => (steps[0]?.op === "update" ? { ok: false, errors: ["restore refused"] } : store.many(steps));
  await undoImport("batch-1", read(store), refusing);
  overlay.getSnapshot().toast!.action!.run();
  await settled();
  assert.equal(overlay.getSnapshot().toast!.message, "restore refused");
  assert.equal(undoneImports.get().length, 1);
  assert.equal(rowsOf(store).length, 0);
  assert.equal((await restoreImport("batch-1", refusing)).ok, false);
  assert.equal((await restoreImport("batch-1", store.many)).ok, true);
  assert.equal(rowsOf(store).length, 2);

  overlay.dismissToast();
  announceImport("batch-1", 1, read(store), async () => ({ ok: false, errors: ["undo refused"] }));
  overlay.getSnapshot().toast!.action!.run();
  await settled();
  assert.equal(overlay.getSnapshot().toast!.message, "undo refused");
  assert.equal(rowsOf(store).length, 2);
});

test("a failure with no row to blame passes through untouched, and the first step failing is reported too", async () => {
  const server = createServer();
  const { store } = await started(server);
  assert.deepEqual(await createAll(stepsFor(store, [row("A")]), async () => ({ ok: false, errors: ["x"] })), { ok: false, errors: ["x"] });
  assert.deepEqual(await store.many([{ op: "delete", table: "items", id: crypto.randomUUID() }]), { ok: false, errors: ["row: not found"], step: 0 });
  assert.equal(store.getSnapshot().pending, 0);
});

test("two hidden imports are both remembered, and the sweep touches only copies of hidden books that are not already hidden", async () => {
  const server = createServer();
  const { store } = await started(server);
  const hand = idOf(await store.create("items", { kind: "book", title: "Typed by hand", status: "shelf", who: "both" }));
  const handCopy = idOf(await store.create("items", { kind: "copy", parent_id: hand, title: "Typed by hand", status: "here", who: "both", data: { format: "print" } }));
  await createAll(stepsFor(store, [row("A")], shelf, "batch-1"), store.many);
  await createAll(stepsFor(store, [row("B")], shelf, "batch-2"), store.many);
  await undoImport("batch-1", read(store), store.many);
  await undoImport("batch-2", read(store), store.many);
  assert.deepEqual(undoneImports.get().map((entry) => entry.batch).sort(), ["batch-1", "batch-2"]);
  assert.deepEqual(undoneImports.get().map((entry) => entry.ids.length), [2, 2]);
  const hidden = server.rows("items").length;
  const calls: string[][] = [];
  const spy: typeof store.many = async (steps) => (calls.push(steps.map((step) => step.id)), store.many(steps));
  sweepUndone(rowsOf(store), spy);
  assert.deepEqual(calls, []);
  const book = [...undoneImports.get()][0].books[0];
  const late = idOf(await store.create("items", { kind: "copy", parent_id: hand, title: "x", status: "here", who: "both", data: { format: "print" } }));
  const lateOnHidden = idOf(await store.create("items", { kind: "copy", parent_id: book, title: "late", status: "lent", who: "a" as const, data: { format: "print" } }));
  sweepUndone(rowsOf(store), spy);
  await settled();
  assert.deepEqual(calls, [[lateOnHidden]]);
  assert.deepEqual(rowsOf(store).map((item) => item.id).sort(), [hand, handCopy, late].sort());
  sweepUndone(rowsOf(store), spy);
  assert.equal(calls.length, 1);
  assert.equal(hidden, 6);
});
