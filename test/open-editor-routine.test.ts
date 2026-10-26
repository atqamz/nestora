import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ItemRow } from "../shared/tables.ts";
import { openRow } from "../src/domain/open-row.ts";
import { actionsOf } from "../src/domain/routines.ts";
import { routineFlows } from "../src/ui/routine-flows.ts";
import { overlay } from "../src/ui/overlay.ts";
import { createServer } from "./store-server.ts";
import { client, idOf } from "./store-client.ts";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const pair = async () => {
  const server = createServer();
  const a = client(server, "a");
  const b = client(server, "b");
  await a.store.open();
  await b.store.open();
  return { server, a, b };
};

const items = (store: ReturnType<typeof client>["store"]) => store.getSnapshot().rows.items;

const stored = (server: ReturnType<typeof createServer>, id: string) => server.rows("items").find((row) => row.id === id) as ItemRow;

const routineWith = async (a: ReturnType<typeof client>) => {
  const routine = idOf(await a.store.create("items", { kind: "routine", title: "Evening", who: "both" }));
  const steps = [];
  for (const [at, title] of ["Wash up", "Lights off"].entries()) steps.push(idOf(await a.store.create("items", { kind: "step", title, parent_id: routine, sort: at + 1 })));
  return { routine, steps };
};

test("a routine the partner deleted leaves its last rows to the open sheet, and Undo brings routine and steps back", async (t) => {
  t.after(() => overlay.dismissToast());
  overlay.dismissToast();
  const { server, a, b } = await pair();
  const { routine, steps } = await routineWith(a);
  await a.store.sync();
  await b.store.sync();
  const found = () => {
    const row = items(b.store).find((candidate) => candidate.id === routine);
    return row && { routine: row, actions: actionsOf(items(b.store), row) };
  };
  const seen = found()!;
  assert.deepEqual(seen.actions.map((action) => action.id), steps);
  const mine = routineFlows({ items: items(a.store), actions: a.store, me: "a", day: "2026-10-26", go: () => undefined });
  assert.equal((await mine.remove(items(a.store).find((row) => row.id === routine)!)).ok, true);
  await a.store.sync();
  await b.store.sync();
  assert.equal(found(), undefined);
  const open = openRow(seen, found());
  assert.equal(open.gone, true);
  assert.equal(open.row, seen);
  const theirs = routineFlows({ items: items(b.store), actions: b.store, me: "b", day: "2026-10-26", go: () => undefined });
  assert.equal((await theirs.restore(open.row!.routine)).ok, true);
  await b.store.sync();
  await a.store.sync();
  assert.deepEqual([routine, ...steps].map((id) => stored(server, id).deleted_at), [null, null, null]);
  assert.equal(found()?.actions.length, 2);
});

test("the routine page keeps its edit sheet mounted through a partner's delete and hands it the gone flag", () => {
  const page = read("views/routine.tsx");
  assert.match(page, /const \{ row: open, gone \} = useOpenRow\(found\);\s*const kept = open !== undefined && me !== null;/);
  assert.match(page, /\{kept && !gone \? <RoutinePage \{\.\.\.open\} [^>]*\/> : <Missing \/>\}/);
  assert.match(page, /\{kept && sheet === "edit" && <RoutineSheet start=\{draftOf\(open\.routine, open\.actions\)\} current=\{open\} [^>]*gone=\{gone\}/);
  assert.match(page, /\{kept && !gone && sheet === "pause" && /);
});

test("Undo in the sheet asks the store to restore the routine and then, once the row is back, puts focus in the first field", () => {
  const sheet = read("ui/routine-sheet.tsx");
  assert.match(sheet, /revived\.current = true;\s*const result = await flows\.restore\(current!\.routine\);\s*if \(!result\.ok\) revived\.current = false;\s*setFailure\(failureOf\(result\)\);/);
  assert.match(sheet, /if \(gone \|\| busy \|\| !revived\.current\) return;\s*revived\.current = false;\s*body\.current\?\.querySelector<HTMLElement>\("input"\)\?\.focus\(\);\s*\}, \[gone, busy\]\);/);
});
