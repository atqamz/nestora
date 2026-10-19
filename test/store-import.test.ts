import { after, test } from "node:test";
import assert from "node:assert/strict";
import { MAX_BODY_BYTES, MAX_MUTATIONS } from "../shared/api.ts";
import { LONGTEXT_MAX, TEXT_MAX } from "../shared/validate.ts";
import { batchRows, previewOf, readInput, stepsOf } from "../src/domain/import-plan.ts";
import type { Choices } from "../src/domain/import-plan.ts";
import type { Row } from "../src/domain/import-csv.ts";
import { createApi } from "../src/store/api.ts";
import { memoryPersistence } from "../src/store/memory.ts";
import type { Persistence, Write } from "../src/store/persistence.ts";
import { createStore } from "../src/store/store.ts";
import { BATCH_BYTES } from "../src/store/outbox.ts";
import { createAll, announceImport, undoImport } from "../src/ui/book-import.ts";
import { overlay } from "../src/ui/overlay.ts";
import { createServer } from "./store-server.ts";
import type { Server } from "./store-server.ts";

after(() => overlay.dismissToast());

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

  const undone = await undoImport(ids, 3, store.many);
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
  await undoImport(ids, 2, store.many);
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
  announceImport(ids, 2, store.many);
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
  assert.deepEqual(missing, { ok: false, errors: ["row: not found"] });
  assert.equal(rowsOf(store).length, 1);
});

const idOf = (written: Awaited<ReturnType<ReturnType<typeof createStore>["create"]>>) => {
  if (!written.ok) throw new Error(written.errors.join());
  return written.id;
};
