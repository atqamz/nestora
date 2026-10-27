import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createElement } from "react";
import type { ReactElement } from "react";
import type { ItemRow } from "../shared/tables.ts";
import { overlay } from "../src/ui/overlay.ts";
import { text } from "../src/ui/text.ts";
import { entry, item, payment } from "./domain-rows.ts";
import { cascade, sheet } from "./css.ts";
import { find, mount } from "./mount.ts";
import { markupOf } from "./render.ts";
import { actions, stage, useSnapshot } from "./render-store.ts";

const load = async (module: string) => {
  let loaded!: Record<string, any>;
  await markupOf(module, (found) => ((loaded = found), createElement("i")));
  return loaded;
};

const { ItemLine } = await load("ui/item-line.tsx");
const { PaymentLine } = await load("ui/payment-line.tsx");
const { QuickAdd } = await load("ui/quick-add.tsx");
const { Gone } = await load("views/generic-item.tsx");
const { ItemDetail } = await load("ui/item-detail.tsx");
const { ScreenDetail } = await load("views/screen.tsx");
const { BookDetail } = await load("views/book.tsx");
const { MoneyView } = await load("views/money.tsx");
const { MoneyLine } = await load("views/money-line.tsx");
const { Places } = await load("views/places.tsx");
const { Books } = await load("views/books.tsx");
const { SettingRow } = await load("ui/setting-row.tsx");
const { StageEditor } = await load("ui/stage-editor.tsx");
const { CollectionSection } = await load("ui/collection-section.tsx");
const { FillBook } = await load("ui/book-lookup.tsx");
const { ScreenPosters } = await load("ui/screen-posters.tsx");
const { Field } = await load("ui/field.tsx");
const { Shell } = await load("ui/shell.tsx");
(globalThis as Record<string, unknown>).BarcodeDetector = class {
  static getSupportedFormats = async () => ["ean_13"];
};

const { ItemForm } = await load("ui/item-form.tsx");
const { CopySheet } = await load("ui/copy-sheet.tsx");
const { CopyChip } = await load("ui/where.tsx");
const { Modal } = await load("ui/modal.tsx");
const { PauseSheet, RoutineSheet } = await load("ui/routine-sheet.tsx");
const { BookSheet } = await load("ui/book-sheet.tsx");
const { ScreenSheet } = await load("ui/screen-sheet.tsx");
const { AddSheet } = await load("ui/add-sheet.tsx");
const { ScanIsbn } = await load("ui/scan.tsx");
const { blankDraft } = await load("domain/routine-draft.ts");
const { lockedProps } = await load("ui/paused-note.tsx");
const { undoImport } = await load("ui/book-import.ts");
const { ImportBooks } = await load("views/import.tsx");
const { Settings } = await load("views/settings.tsx");
const { STAGES } = await load("domain/stages.ts");
const { RoutineDetail } = await load("views/routine.tsx");
const { Routines } = await load("views/routines.tsx");

const stub = actions as Record<string, unknown>;
const snapshot = useSnapshot() as { paused: boolean };

const ok = { ok: true as const, id: "x" };

const settle = async () => {
  for (let turn = 0; turn < 8; turn++) await new Promise((resolve) => setImmediate(resolve));
};

type View = { tree: unknown };
type Test = { after: (fn: () => void) => void };

let writes: string[] = [];
let announced!: { mock: { callCount: () => number; restore: () => void } };

const around = (t: Test, paused: boolean) => {
  const globals = globalThis as Record<string, unknown>;
  const form = class {
    source: { values?: Record<string, string> };
    constructor(source: { values?: Record<string, string> }) {
      this.source = source;
    }
    get(key: string) {
      return this.source.values?.[key] ?? null;
    }
  };
  Object.assign(globals, {
    FormData: form,
    location: { hash: "" },
    HTMLElement: class {},
    window: { visualViewport: null },
    innerWidth: 390,
    innerHeight: 800,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    document: { querySelector: () => null, addEventListener: () => undefined, removeEventListener: () => undefined, documentElement: { clientWidth: 390, style: { getPropertyValue: () => "x", setProperty: () => undefined, removeProperty: () => undefined } } },
  });
  writes = [];
  announced = mock.method(overlay, "announce");
  snapshot.paused = paused;
  for (const key of ["create", "update", "remove", "restore", "many", "setSetting"]) stub[key] = async () => (writes.push(key), ok);
  mock.timers.enable({ apis: ["Date", "setInterval"], now: Date.parse("2026-10-27T05:00:00Z") });
  t.after(() => {
    mock.timers.reset();
    announced.mock.restore();
    snapshot.paused = false;
    for (const key of ["FormData", "location", "document", "HTMLElement", "window", "innerWidth", "innerHeight", "addEventListener", "removeEventListener"]) delete globals[key];
    overlay.dismissToast();
    for (const key of ["create", "update", "remove", "restore", "many", "setSetting"]) delete stub[key];
    stage([]);
  });
};

const part = (view: View, name: string, nth = 0) => {
  const element = find(view.tree as never, (_, type) => (type as { name?: string }).name === name)[nth];
  assert.ok(element, name);
  return mount<Record<string, any>>(element.type as never, element.props);
};

const frame = (view: View) => part(view, "ItemDetail");

const tag = (view: View, pick: (props: any) => boolean, nth = 0) => {
  const element = find(view.tree as never, (props) => pick(props))[nth];
  assert.ok(element, "control not found");
  return element as ReactElement<any>;
};

const errors = (view: View) => find(view.tree as never, (props) => props.role === "alert" && props.className === "error").length;

const event = (values: Record<string, string> = {}) => ({ preventDefault: () => undefined, currentTarget: { values, reset: () => undefined, closest: () => null }, target: { value: "x" } });

type Control = { view: View; pick: (props: any) => boolean; fire: "onClick" | "onChange" | "onSubmit"; mark?: (props: any) => boolean; before?: (view: View) => void; values?: Record<string, string>; foot?: true; silent?: true; follow?: (props: any) => boolean; lookup?: true };

const controls: { name: string; file: string; make: () => Control; page?: false }[] = [];

const add = (name: string, file: string, make: () => Control, page?: false) => controls.push({ name, file, make, page });

const submitter = (props: any) => props.type === "submit";

const typed = (name: string, value: string) => (view: View) => tag(view, (props) => props.control?.name === name).props.control.onChange(value);

const labelled = (label: string) => (props: any) => props["aria-label"] === label;

const pressed = (label: string) => (props: any) => props.type === "button" && props["aria-pressed"] !== undefined && props.children !== undefined && String(props.children) === label;

const task = () => item({ title: "Pick the music", status: "todo", who: null });

add("task check", "ui/item-line.tsx", () => ({ view: mount(ItemLine, { name: "task", row: task() }), pick: (props) => props.type === "checkbox", fire: "onChange" }));

add("Take it", "ui/item-line.tsx", () => {
  const row = task();
  return { view: mount(ItemLine, { name: "task", row }), pick: labelled(text.takeNamed(row.title)), fire: "onClick" };
});

add("Mark paid", "ui/payment-line.tsx", () => {
  const line = entry({ title: "Venue" });
  const row = payment(line, { title: "Deposit", amount: 500 });
  return { view: mount(PaymentLine, { payment: row }), pick: labelled(text.markPaidNamed("Deposit")), fire: "onClick" };
});

const form = (props: any) => typeof props.onSubmit === "function";

add("quick add", "ui/quick-add.tsx", () => ({ view: mount(QuickAdd, { name: "guest" }), pick: form, mark: submitter, fire: "onSubmit", values: { title: "Aunt Rina" } }));

add("Undo on a gone page", "views/generic-item.tsx", () => ({ view: mount(Gone, { name: "task", id: "gone-1", back: "#/tasks" }), pick: (props) => props.type === "button" && props.children === text.undo, fire: "onClick" }));

add("Undo after a delete", "ui/item-detail.tsx", () => {
  const row = task();
  stage([row]);
  return { view: mount(ItemDetail, { name: "task", row, gone: true, back: { href: "#/tasks", word: "Tasks" } }), pick: (props) => props.type === "button" && props.children === text.undo, fire: "onClick" };
});

const movie = (fields: Partial<ItemRow> = {}) => item({ kind: "movie", status: "watched", done_on: "2026-09-12", title: "Midnight Ferry", ...fields });

const book = (fields: Partial<ItemRow> = {}) => item({ kind: "book", status: "shelf", title: "Slow Bread", ...fields });

const screenView = (row: ItemRow, kind = "movie") => (stage([row]), frame(mount<Record<string, any>>(ScreenDetail, { kind, id: row.id })));

const bookView = (row: ItemRow) => (stage([row]), frame(mount<Record<string, any>>(BookDetail, { id: row.id })));

add("movie Status", "views/screen.tsx", () => ({ view: part(screenView(movie()), "Status"), pick: pressed(text.screen.pick.watching), fire: "onClick" }));

add("movie rating star", "views/screen.tsx", () => ({ view: part(screenView(movie()), "Ratings"), pick: labelled(text.screen.rateStar(4)), fire: "onClick" }));

add("movie Collection Save", "views/screen.tsx", () => ({ view: part(screenView(movie()), "Collection"), pick: form, mark: submitter, fire: "onSubmit", before: typed("collection", "Noir") }));

add("movie Collection Remove", "views/screen.tsx", () => ({ view: part(screenView(movie({ data: { collection: "Noir" } })), "Collection"), pick: (props) => props.type === "button" && props.children === text.screen.collection.remove, fire: "onClick" }));

add("movie watched date Save", "views/screen.tsx", () => ({ view: part(part(screenView(movie()), "Status"), "WatchedOn"), pick: form, mark: submitter, fire: "onSubmit", before: (view) => tag(view, (props) => props.type === "date").props.onChange({ target: { value: "2026-09-10" } }) }));

add("movie Remove poster", "views/screen.tsx", () => ({ view: part(screenView(movie({ data: { poster: "/p.jpg", tmdb: 12 } })), "PosterRemoval"), pick: (props) => props.type === "button" && props.children === text.screen.removePoster, fire: "onClick" }));

add("book reading pick", "views/book.tsx", () => ({ view: part(bookView(book()), "Reader"), pick: pressed(text.books.readingPick.reading), fire: "onClick" }));

add("book rating star", "views/book.tsx", () => ({ view: part(bookView(book({ data: { reading_a: "read" } })), "Reader"), pick: labelled(text.books.rateStar(3)), fire: "onClick" }));

add("book reading pick tapped again to clear", "views/book.tsx", () => ({ view: part(bookView(book({ data: { reading_a: "reading" } })), "Reader"), pick: pressed(text.books.readingPick.reading), fire: "onClick" }));

add("Lost it", "views/book.tsx", () => ({ view: part(bookView(book()), "LostIt"), pick: (props) => props.className === "secondary lost", fire: "onClick", follow: (props) => props.children === text.books.lostConfirm }));

add("Got it on a wishlist book", "views/book.tsx", () => ({ view: bookView(book({ status: "wish" })), pick: (props) => props.className === "got", fire: "onClick" }));

const place = (title: string, sort: number) => item({ kind: "place", title, status: null, sort });

const placeRow = (index: number) => {
  stage([place("Living room", 0), place("Study", 1)]);
  return part(mount<Record<string, any>>(Places, {}), "PlaceRow", index);
};

add("Got it on the wishlist", "views/books.tsx", () => {
  stage([book({ status: "wish" })]);
  return { view: part(part(mount<Record<string, any>>(Books, { route: "wishlist" }), "Wishlist"), "Wish"), pick: (props) => props.className === "got", fire: "onClick" };
});

add("place add", "views/places.tsx", () => ({ view: mount<Record<string, any>>(Places, {}), pick: form, mark: submitter, fire: "onSubmit", values: { title: "Hall" } }));

add("place move up", "views/places.tsx", () => ({ view: placeRow(1), pick: labelled(text.books.placesPage.up("Study")), fire: "onClick" }));

add("place move down", "views/places.tsx", () => ({ view: placeRow(0), pick: labelled(text.books.placesPage.down("Living room")), fire: "onClick" }));

add("place remove", "views/places.tsx", () => ({ view: placeRow(0), pick: labelled(text.books.placesPage.remove("Living room")), fire: "onClick" }));

add("place rename Save", "views/places.tsx", () => ({
  view: placeRow(0),
  pick: form,
  mark: submitter,
  fire: "onSubmit",
  before: (view) => tag(view, labelled(text.books.placesPage.rename("Living room"))).props.onClick(),
}));

const budgetLine = entry({ title: "Venue", amount: 1000 });

add("money line add payment", "views/money-line.tsx", () => {
  stage([], [], [budgetLine]);
  return { view: mount<Record<string, any>>(MoneyLine, { id: budgetLine.id, wide: false }), pick: form, mark: submitter, fire: "onSubmit", values: { title: "Deposit", amount: "500" } };
});

add("money add planned line", "views/money.tsx", () => {
  stage([], [], [budgetLine]);
  return { view: { tree: (mount<Record<string, any>>(MoneyView, {}).tree as ReactElement<any>).props.list }, pick: (props) => form(props) && props.className === "quick-add budget-add", mark: submitter, fire: "onSubmit", values: { title: "Photos", amount: "700" } };
});

const away = () => item({ kind: "routine", status: null, who: "a", title: "Morning care", group_key: "morning", data: { paused_until: "2026-11-05" } });

add("Resume pill on a paused routine", "views/routines.tsx", () => {
  stage([away()]);
  return { view: part(part(mount<Record<string, any>>(Routines, {}), "RoutineList"), "Row"), pick: (props) => props.className === "pill rt-resume", fire: "onClick" };
});

add("setting Save", "ui/setting-row.tsx", () => ({
  view: mount<Record<string, any>>(SettingRow, {
    field: { name: "timezone", label: "Zone", type: "text", value: "Asia/Jakarta" },
    kicker: "Zone",
    shown: "Asia/Jakarta",
    what: "zone",
    save: async () => (writes.push("setSetting"), null),
  }),
  pick: form,
  mark: submitter,
  fire: "onSubmit",
  before: (view) => tag(view, labelled(text.settings.change("zone"))).props.onClick(),
}));

add("stage plan Save", "ui/stage-editor.tsx", () => ({
  view: mount<Record<string, any>>(StageEditor, { saved: STAGES, ceremony: null }),
  pick: form,
  mark: submitter,
  fire: "onSubmit",
  before: (view) => tag(view, labelled(text.stages.nameOf(1))).props.onChange({ target: { value: "Before the engagement" } }),
}));

add("Fill in details on a book", "ui/book-lookup.tsx", () => ({ view: mount<Record<string, any>>(FillBook, { book: book({ data: { isbn: "9780141036144" } }) }), pick: (props) => props.className === "secondary" && props.children === text.books.lookup.fill, fire: "onClick", lookup: true }));

const imported = (title: string) => book({ title, status: "wish", data: { import_batch: "batch-1" } });

await undoImport("batch-gone", () => [book({ title: "Dune", data: { import_batch: "batch-gone" } })], async () => ok);

add("Restore a hidden import batch", "views/import.tsx", () => {
  stage([]);
  return { view: part(mount<Record<string, any>>(ImportBooks, {}), "Hidden"), pick: (props) => props.className === "secondary" && props.children === text.books.import.restore, fire: "onClick" };
});

add("Find details for an import batch", "views/import.tsx", () => {
  stage([imported("Dune")]);
  return { view: part(mount<Record<string, any>>(ImportBooks, {}), "Earlier"), pick: (props) => props.className === "secondary" && props.children === text.books.import.find, fire: "onClick", lookup: true };
});

add("Undo an import batch", "views/import.tsx", () => {
  stage([imported("Dune")]);
  return { view: part(mount<Record<string, any>>(ImportBooks, {}), "Earlier"), pick: (props) => props.children === text.books.import.undo, fire: "onClick" };
});

add("Import the ticked books", "views/import.tsx", () => {
  const view = mount<Record<string, any>>(ImportBooks, {});
  tag(view, (props) => typeof props.onInput === "function").props.onInput("title,author\nDune,Frank Herbert");
  return { view, pick: (props) => props.type === "button" && Array.isArray(props.children) && String(props.children[1]).startsWith("Import"), fire: "onClick" };
});

const flows = {
  pause: async () => (writes.push("update"), ok),
  save: async () => (writes.push("many"), ok),
  restore: async () => (writes.push("restore"), ok),
} as never;

const sheetOf = (view: View) => ({ view, pick: (props: any) => typeof props.onSubmit === "function", mark: submitter, fire: "onSubmit" as const, foot: true as const });

add("edit sheet Save", "ui/item-form.tsx", () => {
  const row = task();
  stage([row]);
  return { ...sheetOf(mount<Record<string, any>>(ItemForm, { name: "task", row, gone: false, sheet: () => undefined })), values: { title: "Pick another song" } };
});

add("copy sheet Save", "ui/copy-sheet.tsx", () => {
  const parent = book();
  stage([parent]);
  return sheetOf(mount<Record<string, any>>(CopySheet, { book: parent, onClose: () => undefined }));
});

add("copy sheet Remove copy", "ui/copy-sheet.tsx", () => {
  const parent = book();
  const copy = item({ kind: "copy", parent_id: parent.id, title: parent.title, status: "here", who: "both", data: { format: "print" } });
  stage([parent, copy]);
  const view = mount<Record<string, any>>(CopySheet, { book: parent, copy, onClose: () => undefined });
  return { view, pick: (props: any) => typeof props.onSubmit === "function", mark: (props: any) => props.className === "danger bk-drop", fire: "onSubmit" as const, foot: true as const, values: {}, follow: undefined };
});

add("copy sheet Remove copy tapped", "ui/copy-sheet.tsx", () => {
  const parent = book();
  const copy = item({ kind: "copy", parent_id: parent.id, title: parent.title, status: "here", who: "both", data: { format: "print" } });
  stage([parent, copy]);
  const view = mount<Record<string, any>>(CopySheet, { book: parent, copy, onClose: () => undefined });
  return { view: { tree: tag(view, (props: any) => typeof props.onSubmit === "function").props.foot }, pick: (props: any) => props.className === "danger bk-drop", fire: "onClick" as const, silent: true as const };
});

add("pause sheet Pause", "ui/routine-sheet.tsx", () => ({ ...sheetOf(mount<Record<string, any>>(PauseSheet, { routine: away(), flows, onClose: () => undefined })), before: typed("pause-until", "2026-11-10") }));

add("routine sheet Create", "ui/routine-sheet.tsx", () => ({
  ...sheetOf(mount<Record<string, any>>(RoutineSheet, { start: blankDraft("a"), current: null, me: "a", today: "2026-10-27", flows, onClose: () => undefined })),
  before: typed("routine-title", "Evening wind-down"),
}));

add("add book sheet Save", "ui/book-sheet.tsx", () => ({ ...sheetOf(mount<Record<string, any>>(BookSheet, { kind: "shelf", onClose: () => undefined })), before: typed("title", "Slow Bread") }));

add("add movie sheet Save", "ui/screen-sheet.tsx", () => ({ ...sheetOf(mount<Record<string, any>>(ScreenSheet, { kind: "movie", onClose: () => undefined })), before: typed("title", "Midnight Ferry") }));

add("Add sheet Save", "ui/add-sheet.tsx", () => {
  overlay.openAdd("Pick the music");
  const view = part(mount<Record<string, any>>(AddSheet, {}), "AddForm");
  return { view, pick: form, mark: submitter, fire: "onSubmit" as const, silent: true as const };
});

const picker = () => {
  const row = book();
  const copy = item({ kind: "copy", parent_id: row.id, title: row.title, status: "here", who: "both", group_key: "p1", data: { format: "print" } });
  stage([row, copy, item({ id: "p1", kind: "place", title: "Living room", status: null, sort: 0 }), item({ id: "p2", kind: "place", title: "Study", status: null, sort: 1 })]);
  const chip = mount<Record<string, any>>(CopyChip, { copy, bookTitle: row.title, places: new Map([["p1", item({ id: "p1", kind: "place", title: "Living room", status: null })]]) });
  tag(chip, (props) => typeof props.onPick === "function").props.onPick();
  return part(chip, "PlacePicker");
};

add("move picker place", "ui/where.tsx", () => ({ view: picker(), pick: (props) => props.className === "pick" && props["data-first"] === undefined, fire: "onClick", silent: true }));

add("move picker new place", "ui/where.tsx", () => ({ view: picker(), pick: (props) => props.className === "quick-add bk-new", mark: submitter, fire: "onSubmit", values: { title: "Hall" }, silent: true }));

const group = (rows: ItemRow[]) => ({ name: "Noir", rows, next: rows[0].id });

const members = () => [movie({ title: "Heat", data: { collection: "Noir" } }), movie({ title: "Ronin", data: { collection: "Noir" } })];

add("collection move down", "ui/collection-section.tsx", () => {
  const rows = members();
  stage(rows);
  const view = mount<Record<string, any>>(CollectionSection, { kind: "movie", group: group(rows) });
  return { view: part(view, "ScreenRow", 0), pick: (props) => props["data-move"] === `down:${rows[0].id}`, fire: "onClick" };
});

add("collection move up", "ui/collection-section.tsx", () => {
  const rows = members();
  stage(rows);
  const view = mount<Record<string, any>>(CollectionSection, { kind: "movie", group: group(rows) });
  return { view: part(view, "ScreenRow", 1), pick: (props) => props["data-move"] === `up:${rows[1].id}`, fire: "onClick" };
});

add("Find posters on a list of movies", "ui/screen-posters.tsx", () => ({ view: part(mount<Record<string, any>>(ScreenPosters, { kind: "movie", rows: [movie({ status: "wish" })] }), "PostersBar"), pick: (props) => props.type === "button" && props.className === "secondary", fire: "onClick", lookup: true }));

add("collection rename Save", "ui/collection-section.tsx", () => {
  const rows = members();
  stage(rows);
  const view = mount<Record<string, any>>(CollectionSection, { kind: "movie", group: group(rows) });
  tag(view, labelled(text.screen.collection.rename("Noir"))).props.onClick();
  return { ...sheetOf(part(view, "Rename")), silent: true, before: typed("collection", "Noir Classics") };
});

for (const paused of [true, false]) {
  for (const { name, file, make } of controls) {
    test(`${file}: ${name} ${paused ? "writes nothing, prints no error and announces the pause while paused" : "still writes when live"}`, async (t) => {
      around(t, paused);
      const { view, pick, fire, mark, before, values, follow, lookup, foot, silent } = make();
      before?.(view);
      const marked = tag(foot ? { tree: tag(view, pick).props.foot } : view, mark ?? pick);
      assert.equal(marked.props["aria-disabled"], paused ? true : undefined, "aria-disabled");
      assert.equal(marked.props.disabled === true, false, "stays focusable");
      const handler = tag(view, pick).props[fire];
      assert.equal(typeof handler, paused && silent && fire === "onClick" ? "undefined" : "function");
      await handler?.(event(values));
      await settle();
      if (!paused && follow) await tag(view, follow).props.onClick(event());
      if (!paused && follow) await settle();
      if (paused) {
        assert.deepEqual([writes, errors(view), announced.mock.callCount(), overlay.getSnapshot().toast?.message], silent || foot ? [[], 0, 0, undefined] : [[], 0, 1, text.pausedTap]);
      } else {
        assert.deepEqual([writes.length > 0 || lookup === true, errors(view), overlay.getSnapshot().toast?.message === text.pausedTap], [true, 0, false]);
      }
    });
  }
}

for (const [id, label, live] of [["pause", "Resume", "update"], ["delete", "Delete", "many"]] as const) {
  for (const paused of [true, false]) {
    test(`views/routine.tsx: ${label} in the routine More menu ${paused ? "writes nothing, prints no error and announces the pause while paused" : "still writes when live"}`, async (t) => {
      around(t, paused);
      const routine = away();
      stage([routine]);
      const view = part(mount<Record<string, any>>(RoutineDetail, { id: routine.id }), "RoutinePage");
      const entry = tag(view, (props) => Array.isArray(props.items)).props.items.find((candidate: { id: string }) => candidate.id === id);
      assert.deepEqual([entry.label, entry.locked], [label, paused]);
      entry.run();
      await settle();
      if (paused) assert.deepEqual([writes, errors(view), announced.mock.callCount(), overlay.getSnapshot().toast?.message], [[], 0, 1, text.pausedTap]);
      else assert.deepEqual([writes.includes(live), errors(view), overlay.getSnapshot().toast?.message === text.pausedTap], [true, 0, false]);
    });
  }
}

for (const paused of [true, false]) {
  test(`views/settings.tsx: the Hijri adjustment ${paused ? "writes nothing, prints no error and announces the pause while paused" : "still writes when live"}`, async (t) => {
    around(t, paused);
    stage([], [{ key: "ceremony_date", value: "2027-01-10" }]);
    const view = mount<Record<string, any>>(Settings, {});
    const { control } = tag(view, (props) => props.control?.name === "hijri").props;
    assert.equal(control.locked, paused);
    await control.onChange("1");
    await settle();
    if (paused) assert.deepEqual([writes, errors(view), announced.mock.callCount(), overlay.getSnapshot().toast?.message], [[], 0, 1, text.pausedTap]);
    else assert.deepEqual([writes, errors(view), overlay.getSnapshot().toast?.message === text.pausedTap], [["setSetting"], 0, false]);
  });

  test(`ui/scan.tsx: Scan on a detail that writes ${paused ? "only announces the pause while paused" : "opens the camera when live"}`, async (t) => {
    around(t, paused);
    const view = mount<Record<string, any>>(ScanIsbn, { onIsbn: () => undefined, writes: true });
    await settle();
    const button = tag(view, (props) => props.type === "button" && props.className === "secondary");
    assert.equal(button.props["aria-disabled"], paused ? true : undefined);
    button.props.onClick();
    const camera = find(view.tree as never, (_, type) => (type as { name?: string }).name === "Camera").length;
    assert.deepEqual([camera, announced.mock.callCount(), writes], paused ? [0, 1, []] : [1, 0, []]);
  });
}

test("ui/scan.tsx: Scan in a form that only fills fields is not a write and stays live while paused", async (t) => {
  around(t, true);
  const view = mount<Record<string, any>>(ScanIsbn, { onIsbn: () => undefined });
  await settle();
  const button = tag(view, (props) => props.type === "button" && props.className === "secondary");
  button.props.onClick();
  assert.deepEqual([button.props["aria-disabled"], find(view.tree as never, (_, type) => (type as { name?: string }).name === "Camera").length, announced.mock.callCount()], [undefined, 1, 0]);
});

test("a sheet that submits carries one quiet paused note at the top of its scrolling body and its submit points at it, only while paused", async (t) => {
  const sheet = (paused: boolean) => {
    snapshot.paused = paused;
    return markupOf("ui/modal.tsx", ({ Modal }) => createElement(Modal, { title: "Edit", onClose: () => undefined, onSubmit: () => undefined, foot: createElement("button", { type: "submit", ...lockedProps(paused) }, "Save") }, "body"));
  };
  t.after(() => void (snapshot.paused = false));
  const held = await sheet(true);
  assert.match(held, /<div class="sheet-body"><p class="hint paused-note" id="paused-note" role="status">Sign-in not confirmed yet\./);
  assert.match(held, /<div class="sheet-foot"><button type="submit" aria-disabled="true" aria-describedby="paused-note">Save<\/button><\/div>/);
  const live = await sheet(false);
  assert.equal(live.includes("paused-note"), false);
  assert.match(live, /<button type="submit">Save<\/button>/);
  snapshot.paused = true;
  const menu = await markupOf("ui/modal.tsx", ({ Modal }) => createElement(Modal, { title: "More", onClose: () => undefined }, "items"));
  assert.equal(menu.includes("paused-note"), false);
  const camera = await markupOf("ui/modal.tsx", ({ Modal }) => createElement(Modal, { title: "Scan", onClose: () => undefined, foot: createElement("button", { type: "button" }, "Cancel") }, "view"));
  assert.equal(camera.includes("paused-note"), false);
});

test("the Add sheet keeps its footer note and its typed work while paused: nothing in its state is reset by the tap", async (t) => {
  around(t, true);
  overlay.openAdd("Pick the music");
  const view = part(mount<Record<string, any>>(AddSheet, {}), "AddForm");
  const noteIn = (className: string) => find(find(view.tree as never, (props) => props.className === className)[0], (_, type) => (type as { name?: string }).name === "PausedNote").length;
  assert.deepEqual([noteIn("sheet-body"), noteIn("sheet-foot")], [1, 0]);
  const input = tag(view, (props) => props.name === "title");
  assert.equal(input.props.value, "Pick the music");
  await tag(view, form).props.onSubmit(event());
  assert.deepEqual([writes, tag(view, (props) => props.name === "title").props.value, errors(view)], [[], "Pick the music", 0]);
});

test("ui/field.tsx: a choice marked locked announces aria-disabled on each radio, an unmarked one carries none", async () => {
  const radios = (locked: boolean) =>
    markupOf("ui/field.tsx", ({ Field: Loaded }) => createElement(Loaded, { control: { name: "hijri", label: "Hijri", type: "text", required: true, choice: true, locked, value: "0", options: [{ value: "0", label: "None" }, { value: "1", label: "One" }], onChange: () => undefined } })).then(
      (html) => html.match(/<input type="radio"[^>]*>/g) ?? [],
    );
  const held = await radios(true);
  assert.deepEqual([held.length, held.every((tag) => tag.includes('aria-disabled="true"'))], [2, true]);
  assert.equal((await radios(false)).some((tag) => tag.includes("aria-disabled")), false);
});

test("ui/where.tsx: the move picker carries the paused note", async (t) => {
  around(t, true);
  const row = book();
  const copy = item({ kind: "copy", parent_id: row.id, title: row.title, status: "here", who: "both", group_key: "p1", data: { format: "print" } });
  stage([row, copy, item({ id: "p1", kind: "place", title: "Living room", status: null, sort: 0 })]);
  const chip = mount<Record<string, any>>(CopyChip, { copy, bookTitle: row.title, places: new Map([["p1", item({ id: "p1", kind: "place", title: "Living room", status: null })]]) });
  tag(chip, (props) => typeof props.onPick === "function").props.onPick();
  assert.equal(find(part(chip, "PlacePicker").tree as never, (_, type) => (type as { name?: string }).name === "PausedNote").length, 1);
});

const focusAt = (y: number) => {
  const globals = globalThis as unknown as { document: { activeElement?: unknown } };
  globals.document.activeElement = { getBoundingClientRect: () => ({ top: y, height: 40 }) };
};

test("a held key on a paused control announces once, and a tap lower on the screen moves the toast to the top and announces again", async (t) => {
  around(t, true);
  const view = mount<Record<string, any>>(QuickAdd, { name: "guest" });
  const submit = () => tag(view, form).props.onSubmit(event({ title: "Aunt Rina" }));
  focusAt(100);
  for (let repeat = 0; repeat < 11; repeat++) await submit();
  const first = overlay.getSnapshot().toast;
  assert.deepEqual([announced.mock.callCount(), first?.message, first?.top, writes], [1, text.pausedTap, undefined, []]);
  focusAt(280);
  await submit();
  assert.deepEqual([announced.mock.callCount(), overlay.getSnapshot().toast?.id === first?.id], [1, true]);
  focusAt(310);
  await submit();
  await submit();
  const second = overlay.getSnapshot().toast;
  assert.deepEqual([announced.mock.callCount(), second?.top, second?.id !== first?.id], [2, true, true]);
  overlay.dismissToast();
  await submit();
  assert.equal(announced.mock.callCount(), 3);
});

test("the toast keeps the first two sentences of the banner", () => {
  assert.equal(text.paused.startsWith(`${text.pausedTap} `), true);
});

test("the toast region marks a toast that sits at the top so the stylesheet can move it off the tapped control", async (t) => {
  around(t, true);
  const shell = () => find(mount<Record<string, any>>(Shell, { section: "home", children: "page" }).tree as never, (props) => props.className === "toast")[0].props["data-top"];
  overlay.announce("Held", undefined, true);
  const top = shell();
  overlay.announce("Held");
  const bottom = shell();
  assert.deepEqual([top, bottom], [true, undefined]);
  const rules = sheet("ui/sheet.css");
  const moved = cascade(rules, ".toast[data-top]", 20);
  assert.deepEqual([moved.get("top"), moved.get("bottom")], ["calc(var(--safe-t) + var(--s3))", "auto"]);
});

test("ui/field.tsx: a tap on the already selected radio of a locked choice answers the pause, an unselected one leaves it to its change event", async (t) => {
  around(t, true);
  const picks: string[] = [];
  const radios = (locked: boolean) => {
    const view = mount<Record<string, any>>(Field, { control: { name: "hijri", label: "Hijri", type: "text", required: true, choice: true, locked, value: "0", options: [{ value: "0", label: "None" }, { value: "1", label: "One" }], onChange: (value: string) => picks.push(value) } });
    return find(view.tree as never, (props) => props.type === "radio");
  };
  const [held, other] = radios(true);
  held.props.onClick();
  assert.deepEqual([picks, typeof other.props.onClick, radios(false).map((radio) => radio.props.onClick)], [["0"], "undefined", [undefined, undefined]]);
});

for (const name of ["quick add", "place add", "money add planned line", "money line add payment"]) {
  for (const paused of [true, false]) {
    test(`${name}: an empty field ${paused ? "answers the pause instead of the browser's own bubble" : "keeps the browser's own required bubble"}`, async (t) => {
      around(t, paused);
      const { view, pick, fire } = controls.find((control) => control.name === name)!.make();
      assert.equal(tag(view, pick).props.noValidate, paused);
      await tag(view, pick).props[fire](event({ title: "" }));
      await settle();
      assert.deepEqual([writes, announced.mock.callCount()], [[], paused ? 1 : 0]);
    });
  }
}

test("every control family that goes aria-disabled while paused has the shared muted rule in the stylesheet", () => {
  const tags = new Set<string>();
  const walkDir = (dir: URL) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walkDir(new URL(`${entry.name}/`, dir));
      else if (entry.name.endsWith(".tsx")) {
        const source = readFileSync(new URL(entry.name, dir), "utf8");
        for (const use of source.matchAll(/aria-disabled=|lockedProps\(/g)) tags.add([...source.slice(0, use.index).matchAll(/<([A-Za-z]\w*)/g)].at(-1)![1]);
      }
    }
  };
  walkDir(new URL("../src/", import.meta.url));
  assert.deepEqual([...tags].sort(), ["button", "input"]);
  const rules = [...sheet("ui/ui.css"), ...sheet("ui/sheet.css")];
  for (const selector of ['button[aria-disabled="true"]', '.check input[aria-disabled="true"]', '.choices label:has(input[aria-disabled="true"])'])
    assert.equal(cascade(rules, selector, 20).get("opacity"), "0.6", selector);
});
