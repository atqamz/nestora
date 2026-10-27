import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { ItemRow } from "../shared/tables.ts";
import { collectionName } from "../src/domain/collection.ts";
import { settleDraft } from "../src/domain/screen.ts";
import { moveMember, renameCollection, setCollection } from "../src/ui/collection-flows.ts";
import { overlay } from "../src/ui/overlay.ts";
import { saveScreen } from "../src/ui/screen-save.ts";
import { client, idOf } from "./store-client.ts";
import { createServer } from "./store-server.ts";

type Store = ReturnType<typeof client>["store"];

const view = readFileSync(new URL("../src/views/screen.tsx", import.meta.url), "utf8");

const form = view.slice(view.indexOf("function Collection("), view.indexOf("export function ScreenDetail"));

const rowOf = (store: Store, id: string) => store.getSnapshot().rows.items.find((row) => row.id === id) as ItemRow;

const deps = (store: Store) => ({
  items: () => store.getSnapshot().rows.items,
  actions: store,
});

const shown = (typed: string | null, row: ItemRow) => settleDraft(typed, collectionName(row) ?? "") ?? collectionName(row) ?? "";

const pair = async () => {
  const server = createServer();
  const a = client(server, "a").store;
  const b = client(server, "b").store;
  await a.open();
  await b.open();
  const ids: string[] = [];
  for (const title of ["Hannibal Rising", "Red Dragon", "Hannibal"]) {
    ids.push(
      idOf(
        await saveScreen(
          a.getSnapshot().rows.items,
          a.create,
          {
            kind: "movie",
            title,
            year: "",
            status: "want",
            who: "both",
            collection: "Hannibal",
          },
          "2026-10-26",
        ),
      ),
    );
  }
  await a.sync();
  await b.sync();
  overlay.dismissToast();
  return { server, a, b, ids };
};

const stored = (server: ReturnType<typeof createServer>, id: string) => (server.row("items", id)!.data as { collection?: string }).collection ?? null;

const sync = async (...stores: Store[]) => {
  for (const store of stores) await store.sync();
  for (const store of stores) await store.sync();
};

const draftSaves = async (a: Store, id: string, draft: string | null) => (draft === null ? null : setCollection(deps(a), "movie", rowOf(a, id), draft));

test("the collection draft follows the live name until the user types, and a typed draft is dropped once the row shows it", () => {
  assert.equal(settleDraft(null, "Hannibal"), null);
  assert.equal(settleDraft("Lecter", "Hannibal"), "Lecter");
  assert.equal(settleDraft("Hannibal", "Hannibal"), null);
  assert.equal(settleDraft("", "Hannibal"), "");
  assert.equal(settleDraft("", ""), null);
});

test("the form saves only a draft: Save is aria-disabled and Enter does nothing while the field is untouched", () => {
  assert.match(
    form,
    /const draft = settleDraft\(typed, current \?\? ""\);\s*if \(draft !== typed\) setTyped\(draft\);\s*const shown = draft \?\? current \?\? "";/,
  );
  assert.match(form, /if \(locked\) return hold\(\);\s*return draft === null \? undefined : run\(draft\);/);
  assert.match(form, /<button type="submit" aria-disabled=\{busy \|\| draft === null \|\| locked \|\| undefined\}>/);
  assert.match(form, /value: shown, onChange: setTyped/);
  assert.match(form, /if \(result\.ok\) setTyped\(null\);/);
  assert.match(form, /className="secondary"\s+disabled=\{busy\}\s+aria-disabled=\{locked \|\| undefined\}\s+onClick=\{guard\(\(\) => void run\(""\)\)\}/);
});

test("an untouched field follows a partner's rename and saves nothing", async () => {
  const { server, a, b, ids } = await pair();
  idOf(await renameCollection(deps(b), "movie", "Hannibal", "Lecter Films"));
  await sync(b, a);
  assert.equal(shown(null, rowOf(a, ids[1])), "Lecter Films");
  assert.equal(await draftSaves(a, ids[1], settleDraft(null, "Lecter Films")), null);
  assert.equal(a.getSnapshot().pending, 0);
  assert.equal(stored(server, ids[1]), "Lecter Films");
  overlay.dismissToast();
});

test("an untouched field follows a partner removing the row, and a partner moving it elsewhere", async () => {
  const { server, a, b, ids } = await pair();
  idOf(await setCollection(deps(b), "movie", rowOf(b, ids[1]), ""));
  idOf(await setCollection(deps(b), "movie", rowOf(b, ids[2]), "Alien"));
  await sync(b, a);
  assert.equal(shown(null, rowOf(a, ids[1])), "");
  assert.equal(shown(null, rowOf(a, ids[2])), "Alien");
  assert.equal(await draftSaves(a, ids[1], null), null);
  assert.equal(await draftSaves(a, ids[2], null), null);
  assert.equal(a.getSnapshot().pending, 0);
  assert.equal(stored(server, ids[1]), null);
  assert.equal(stored(server, ids[2]), "Alien");
  overlay.dismissToast();
});

test("a typed draft survives the partner's rename and saves only when the user chose to", async () => {
  const { server, a, b, ids } = await pair();
  const typed = "Lecter Saga";
  idOf(await renameCollection(deps(b), "movie", "Hannibal", "Lecter Films"));
  await sync(b, a);
  assert.equal(settleDraft(typed, collectionName(rowOf(a, ids[1]))!), typed);
  assert.equal(stored(server, ids[1]), "Lecter Films");
  assert.ok((await draftSaves(a, ids[1], typed))?.ok);
  await sync(a);
  assert.equal(stored(server, ids[1]), "Lecter Saga");
  overlay.dismissToast();
});

test("a draft the partner makes true is dropped, and a draft cleared to empty removes the row on Save", async () => {
  const { server, a, b, ids } = await pair();
  idOf(await renameCollection(deps(b), "movie", "Hannibal", "Lecter Films"));
  await sync(b, a);
  assert.equal(settleDraft("Lecter Films", collectionName(rowOf(a, ids[1]))!), null);
  const cleared = settleDraft("", collectionName(rowOf(a, ids[1]))!);
  assert.equal(cleared, "");
  assert.ok((await draftSaves(a, ids[1], cleared))?.ok);
  await sync(a);
  assert.equal(stored(server, ids[1]), null);
  idOf(await moveMember(deps(a), "movie", rowOf(a, ids[0]), 1));
  overlay.dismissToast();
});
