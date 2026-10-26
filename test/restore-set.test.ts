import { test } from "node:test";
import assert from "node:assert/strict";
import type { ItemRow } from "../shared/tables.ts";
import { bookFlows } from "../src/ui/book-flows.ts";
import { routineFlows } from "../src/ui/routine-flows.ts";
import { overlay } from "../src/ui/overlay.ts";
import { createServer } from "./store-server.ts";
import { client, idOf } from "./store-client.ts";

type Device = ReturnType<typeof client>;

const pair = async () => {
  const server = createServer();
  const a = client(server, "a");
  const b = client(server, "b");
  await a.store.open();
  await b.store.open();
  return { server, a, b };
};

const items = (device: Device) => device.store.getSnapshot().rows.items;

const alive = (server: ReturnType<typeof createServer>, ids: string[]) => ids.filter((id) => (server.rows("items").find((row) => row.id === id) as ItemRow).deleted_at === null);

const routineOf = (device: Device, side: "a" | "b") => routineFlows({ items: items(device), actions: device.store, me: side, day: "2026-10-26", go: () => undefined });

const booksOf = (device: Device, side: "a" | "b") => bookFlows({ items: items(device), actions: device.store, stamp: () => "2026-10-26", me: side, go: () => undefined });

const row = (device: Device, id: string) => items(device).find((candidate) => candidate.id === id)!;

type Kind = { name: string; parent: Record<string, unknown>; child: (parent: string, title: string, at: number) => Record<string, unknown> };

const KINDS: Kind[] = [
  { name: "routine steps", parent: { kind: "routine", title: "Evening", who: "both" }, child: (parent, title, at) => ({ kind: "step", title, parent_id: parent, sort: at }) },
  {
    name: "timetable blocks",
    parent: { kind: "routine", title: "Weekdays", who: "a", group_key: "timetable" },
    child: (parent, title, at) => ({ kind: "block", title, parent_id: parent, sort: at, data: { days: "MO", start_time: "08:00", end_time: "09:00" } }),
  },
  { name: "book copies", parent: { kind: "book", title: "Atlas", status: "shelf" }, child: (parent, title, at) => ({ kind: "copy", title, parent_id: parent, sort: at, status: "here", who: "both" }) },
];

const removeParent = async (kind: Kind, device: Device, side: "a" | "b", id: string) => {
  const parent = row(device, id);
  const children = items(device).filter((candidate) => candidate.parent_id === id);
  idOf(kind.parent.kind === "book" ? await booksOf(device, side).removeBook(parent, children) : await routineOf(device, side).remove(parent));
};

const restoreParent = async (kind: Kind, device: Device, side: "a" | "b", parent: ItemRow) =>
  kind.parent.kind === "book" ? booksOf(device, side).restoreBook(parent) : routineOf(device, side).restore(parent);

const removeChild = async (kind: Kind, device: Device, side: "a" | "b", id: string) =>
  idOf(kind.parent.kind === "book" ? await booksOf(device, side).removeCopy(row(device, id)) : await device.store.remove("items", id));

for (const kind of KINDS) {
  const setup = async () => {
    const world = await pair();
    const parent = idOf(await world.a.store.create("items", kind.parent));
    const children: string[] = [];
    for (const [at, title] of ["One", "Two"].entries()) children.push(idOf(await world.a.store.create("items", kind.child(parent, title, at + 1))));
    await world.a.store.sync();
    await world.b.store.sync();
    return { ...world, parent, children };
  };

  test(`${kind.name}: a child the partner removed before the delete stays removed, in one pull and in two`, async (t) => {
    t.after(() => overlay.dismissToast());
    for (const pulls of ["one", "two"]) {
      const { server, a, b, parent, children } = await setup();
      const third = idOf(await a.store.create("items", kind.child(parent, "Three", 3)));
      await a.store.sync();
      await b.store.sync();
      await removeChild(kind, a, "a", children[1]);
      await a.store.sync();
      if (pulls === "two") await b.store.sync();
      await removeParent(kind, a, "a", parent);
      await a.store.sync();
      await b.store.sync();
      assert.equal(items(b).some((candidate) => candidate.id === parent), false, pulls);
      const stale = server.rows("items").find((candidate) => candidate.id === parent) as ItemRow;
      idOf(await restoreParent(kind, b, "b", stale));
      await b.store.sync();
      assert.deepEqual(alive(server, [parent, ...children, third]), [parent, children[0], third], pulls);
      await a.store.sync();
      assert.deepEqual(items(a).map((candidate) => candidate.id).sort(), [parent, children[0], third].sort(), pulls);
    }
  });

  test(`${kind.name}: a child the partner added before the delete comes back with it, in one pull and in two`, async (t) => {
    t.after(() => overlay.dismissToast());
    for (const pulls of ["one", "two"]) {
      const { server, a, b, parent, children } = await setup();
      const third = idOf(await a.store.create("items", kind.child(parent, "Three", 3)));
      await a.store.sync();
      if (pulls === "two") await b.store.sync();
      await removeParent(kind, a, "a", parent);
      await a.store.sync();
      await b.store.sync();
      const stale = server.rows("items").find((candidate) => candidate.id === parent) as ItemRow;
      idOf(await restoreParent(kind, b, "b", stale));
      await b.store.sync();
      assert.deepEqual(alive(server, [parent, ...children, third]), [parent, ...children, third], pulls);
    }
  });

  test(`${kind.name}: the toast Undo and a restore after a sync revive the same exact set`, async (t) => {
    t.after(() => overlay.dismissToast());
    overlay.dismissToast();
    const { server, a, parent, children } = await setup();
    await removeChild(kind, a, "a", children[0]);
    await removeParent(kind, a, "a", parent);
    overlay.getSnapshot().toast!.action!.run();
    await a.store.sync();
    assert.deepEqual(alive(server, [parent, ...children]), [parent, children[1]]);
  });

  test(`${kind.name}: Undo while the delete is still unsent revives the same exact set`, async (t) => {
    t.after(() => overlay.dismissToast());
    overlay.dismissToast();
    const { server, a, parent, children } = await setup();
    server.control.down = true;
    await removeChild(kind, a, "a", children[0]);
    await removeParent(kind, a, "a", parent);
    idOf(await restoreParent(kind, a, "a", server.rows("items").find((candidate) => candidate.id === parent) as ItemRow));
    server.control.down = false;
    await a.store.sync();
    assert.deepEqual(alive(server, [parent, ...children]), [parent, children[1]]);
  });
}

test("restoring a row that is already live changes nothing and revives no child removed since", async () => {
  const { server, a, b } = await pair();
  const routine = idOf(await a.store.create("items", { kind: "routine", title: "Evening", who: "both" }));
  const step = idOf(await a.store.create("items", { kind: "step", title: "One", parent_id: routine, sort: 1 }));
  await a.store.sync();
  await b.store.sync();
  await a.store.remove("items", step);
  await a.store.sync();
  const before = b.store.getSnapshot().pending;
  assert.deepEqual(await b.store.restore(routine), { ok: true, id: routine });
  assert.equal(b.store.getSnapshot().pending, before);
  assert.deepEqual(alive(server, [routine, step]), [routine]);
});

test("restore queues the parent before its children", async () => {
  const { server, a } = await pair();
  const routine = idOf(await a.store.create("items", { kind: "routine", title: "Evening", who: "both" }));
  const steps = [];
  for (const [at, title] of ["One", "Two"].entries()) steps.push(idOf(await a.store.create("items", { kind: "step", title, parent_id: routine, sort: at + 1 })));
  await a.store.sync();
  idOf(await a.store.many([routine, ...steps].map((id) => ({ op: "delete" as const, table: "items" as const, id }))));
  await a.store.sync();
  server.control.down = true;
  idOf(await a.store.restore(routine));
  assert.deepEqual((await a.persistence.load()).outbox.map((entry) => entry.row_id), [routine, ...steps]);
});

test("restore refuses while the store is not open", async () => {
  const { store } = client(createServer(), "a");
  assert.deepEqual(await store.restore("any"), { ok: false, errors: [], paused: true });
});
