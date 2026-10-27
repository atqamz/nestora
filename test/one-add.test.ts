import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { overlay } from "../src/ui/overlay.ts";
import { addStartsAs } from "../src/ui/nav.ts";
import { text } from "../src/ui/text.ts";
import { cascade, sheet } from "./css.ts";
import { find, mount } from "./mount.ts";
import { load } from "./render.ts";
import { actions, stage, useSnapshot } from "./render-store.ts";

const read = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");

const { AddSheet } = await load("ui/add-sheet.tsx");
const { Compose } = await load("ui/compose.tsx");
const { ScreenSheet } = await load("ui/screen-sheet.tsx");
const shell = await load("ui/shell.tsx");

const snapshot = useSnapshot() as { paused: boolean };
const stub = actions as Record<string, unknown>;
const ok = { ok: true as const, id: "x" };

const settle = async () => {
  for (let turn = 0; turn < 8; turn++) await new Promise((resolve) => setImmediate(resolve));
};

let created: unknown[] = [];

const around = (t: { after: (fn: () => void) => void }, paused = false) => {
  const globals = globalThis as Record<string, unknown>;
  Object.assign(globals, {
    location: { hash: "" },
    HTMLElement: class {},
    window: { visualViewport: null },
    innerWidth: 390,
    innerHeight: 800,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    document: { querySelector: () => null, addEventListener: () => undefined, removeEventListener: () => undefined, documentElement: { clientWidth: 390, style: { getPropertyValue: () => "x", setProperty: () => undefined, removeProperty: () => undefined } } },
  });
  created = [];
  snapshot.paused = paused;
  for (const key of ["create", "update", "remove", "restore", "many"]) stub[key] = async (...args: unknown[]) => (created.push(args), ok);
  mock.timers.enable({ apis: ["Date", "setInterval"], now: Date.parse("2026-10-27T05:00:00Z") });
  t.after(() => {
    mock.timers.reset();
    snapshot.paused = false;
    for (const key of ["location", "document", "HTMLElement", "window", "innerWidth", "innerHeight", "addEventListener", "removeEventListener"]) delete globals[key];
    for (const key of ["create", "update", "remove", "restore", "many"]) delete stub[key];
    overlay.closeAdd();
    overlay.closeCompose();
    overlay.keepDraft(null);
    overlay.dismissToast();
    stage([]);
  });
};

const form = (preset: Parameters<typeof overlay.openAdd>[0] = null) => {
  overlay.openAdd(preset);
  const sheetView = mount<Record<string, any>>(AddSheet, {});
  const element = find(sheetView.tree as never, (_, type) => (type as { name?: string }).name === "AddForm")[0];
  return mount<Record<string, any>>(element.type as never, element.props);
};

const chips = (view: { tree: unknown }) => find(view.tree as never, (props) => props.type === "button" && props["aria-pressed"] !== undefined);

const chip = (view: { tree: unknown }, label: string) => {
  const found = chips(view).find((candidate) => candidate.props.children[1] === label);
  assert.ok(found, label);
  return found.props;
};

const data = (view: { tree: unknown }) => find(view.tree as never, (props) => props.className === "sheet-form add-form")[0].props["data-pristine"];

const titleInput = (view: { tree: unknown }) => find(view.tree as never, (props) => props.name === "title")[0].props;

const type = (view: { tree: unknown }, value: string) => titleInput(view).onChange({ target: { value } });

const submit = (view: { tree: unknown }) => find(view.tree as never, (props) => typeof props.onSubmit === "function")[0].props.onSubmit({ preventDefault: () => undefined, currentTarget: {} });

test("the centre + starts from the section: Routines is Routine, Movies Movie, Series Series, the Library tabs Book, the rest nothing", () => {
  assert.deepEqual(
    ["routines", "movies", "series", "books", "wishlist", "places", "", "marriage", "tasks", "money", "people", "settings", "sync", "nope"].map(addStartsAs),
    ["routine", "movie", "series", "book", "book", "book", null, null, null, null, null, null, null, null],
  );
});

test("a hand-off closes the Add sheet and opens its target only after the sheet has closed; a new Add drops a pending one", (t) => {
  around(t);
  overlay.openAdd("movie");
  assert.deepEqual([overlay.getSnapshot().adding, overlay.getSnapshot().preset, overlay.getSnapshot().compose], [true, "movie", null]);
  overlay.handOff({ kind: "movie", title: "Dune" });
  assert.deepEqual([overlay.getSnapshot().adding, overlay.getSnapshot().compose], [false, null]);
  overlay.landOnward();
  assert.deepEqual(overlay.getSnapshot().compose, { kind: "movie", title: "Dune" });
  overlay.landOnward();
  assert.deepEqual(overlay.getSnapshot().compose, { kind: "movie", title: "Dune" });
  overlay.closeCompose();
  overlay.landOnward();
  assert.equal(overlay.getSnapshot().compose, null);
  overlay.handOff({ kind: "series", title: "Harbour" });
  overlay.openAdd();
  overlay.closeAdd();
  overlay.landOnward();
  assert.equal(overlay.getSnapshot().compose, null);
  overlay.landOnward();
});

test("a hand-off is dropped when the page changed before the sheet closed", (t) => {
  around(t);
  const globals = globalThis as unknown as { location: { hash: string } };
  overlay.openAdd();
  overlay.handOff({ kind: "movie", title: "Dune" });
  globals.location.hash = "#/tasks";
  overlay.landOnward();
  assert.equal(overlay.getSnapshot().compose, null);
  overlay.handOff({ kind: "movie", title: "Dune" });
  overlay.landOnward();
  assert.deepEqual(overlay.getSnapshot().compose, { kind: "movie", title: "Dune" });
});

test("the Add sheet closing hands off, then returns focus first: the sheet it opens remembers the + as its opener", () => {
  const source = read("ui/add-sheet.tsx");
  assert.match(source, /overlay\.closeAdd\(\);\s*overlay\.returnFocus\(\);\s*overlay\.landOnward\(\);/);
});

test("on Movies the sheet opens with Movie pressed and nothing else, and the first field is named for it", (t) => {
  around(t);
  const view = form("movie");
  assert.deepEqual(
    chips(view).map((entry) => [entry.props.children[1], entry.props["aria-pressed"]]),
    [...["Task", "Budget line", "Payment", "Guest", "Vendor", "Book"].map((name) => [name, false]), ["Routine", false], ["Movie", true], ["Series", false]],
  );
  assert.equal(titleInput(view).placeholder, text.sheet.onward.movie.placeholder);
  const words = (className: string) => find(view.tree as never, (props) => props.className === className)[0].props.children;
  assert.deepEqual(
    [find(view.tree as never, (props) => props.htmlFor !== undefined)[0].props.children, find(view.tree as never, (props) => props.type === "submit")[0].props.children, words("hint sheet-hint")],
    [text.sheet.onward.movie.first, text.sheet.onward.next, text.sheet.onward.movie.hint],
  );
  assert.deepEqual([text.sheet.onward.movie.first, text.sheet.onward.next], ["Movie title", "Continue"]);
  assert.equal(find(view.tree as never, (props) => props.role === "status" && props.className === "visually-hidden")[0].props.children, text.sheet.onward.movie.kind);
  assert.equal(find(view.tree as never, (props) => props.className === "chips").length, 0);
  assert.equal(find(view.tree as never, (props) => props.className === "choice-field" || props.control?.name === "owner").length, 0);
});

test("what the sheet reads from a task line is not shown for a hand-off kind: the whole text goes across", (t) => {
  around(t);
  const view = form("movie");
  type(view, "Pay Dune 5 jt Friday");
  assert.deepEqual(find(view.tree as never, (props) => props.className === "saved-as").length, 0);
  assert.equal(find(view.tree as never, (props) => props.className === "chips").length, 0);
  chip(view, "Task").onClick();
  assert.equal(find(view.tree as never, (props) => props.className === "saved-as").length, 1);
});

test("the centre + hands its section to the sheet, and the sheets are not offered on a mismatched tab", (t) => {
  around(t);
  const { Shell } = shell;
  const tab = (section: string) => {
    const nav = find(mount<Record<string, any>>(Shell, { section, children: "page" }).tree as never, (props, kind) => (kind as { name?: string }).name === "Nav" && props.className === "tabs")[0];
    return find(mount<Record<string, any>>(nav.type as never, nav.props).tree as never, (props) => props.className === "tab-add")[0].props;
  };
  for (const [section, preset] of [["movies", "movie"], ["routines", "routine"], ["", null]] as const) {
    overlay.closeAdd();
    tab(section).onClick();
    assert.deepEqual([overlay.getSnapshot().adding, overlay.getSnapshot().preset], [true, preset]);
  }
  const names = (link: string) => {
    (snapshot as unknown as { link: string }).link = link;
    return find(mount<Record<string, any>>(Shell, { section: "", children: "page" }).tree as never, (_, kind) => ["AddSheet", "Compose"].includes((kind as { name?: string }).name ?? "")).map((entry) => (entry.type as { name: string }).name);
  };
  t.after(() => void ((snapshot as unknown as { link: string }).link = "online"));
  assert.deepEqual([names("online"), names("mismatch")], [["AddSheet", "Compose"], []]);
});

test("on Routines Routine is pressed, and with nothing typed the sheet is pristine so the backdrop closes it", (t) => {
  around(t);
  const view = form("routine");
  assert.equal(chip(view, "Routine")["aria-pressed"], true);
  assert.equal(find(view.tree as never, (props) => props.className === "sheet-form add-form")[0].props["data-pristine"], true);
});

test("Dune typed, Movie picked: the movie form gets Dune and the draft stays until the movie is added", async (t) => {
  around(t);
  const view = form();
  type(view, "Dune");
  chip(view, "Movie").onClick();
  assert.deepEqual([overlay.getSnapshot().adding, overlay.keptDraft()?.input], [false, "Dune"]);
  overlay.landOnward();
  const compose = mount<Record<string, any>>(Compose, {});
  const sheetView = find(compose.tree as never, (_, kind) => (kind as { name?: string }).name === "ScreenSheet")[0];
  assert.deepEqual([sheetView.props.kind, sheetView.props.title], ["movie", "Dune"]);
  const screen = mount<Record<string, any>>(ScreenSheet, sheetView.props);
  assert.equal(find(screen.tree as never, (props) => props.control?.name === "title")[0].props.control.value, "Dune");
  await find(screen.tree as never, (props) => typeof props.onSubmit === "function")[0].props.onSubmit({ preventDefault: () => undefined });
  await settle();
  assert.deepEqual([created.length > 0, overlay.keptDraft()], [true, null]);
});

test("closing the hand-off sheet without adding keeps what was typed for the next +", async (t) => {
  around(t);
  const view = form();
  type(view, "Dune");
  chip(view, "Series").onClick();
  overlay.landOnward();
  const compose = mount<Record<string, any>>(Compose, {});
  const sheetView = find(compose.tree as never, (_, kind) => (kind as { name?: string }).name === "ScreenSheet")[0];
  sheetView.props.onClose();
  assert.deepEqual([overlay.getSnapshot().compose, overlay.keptDraft()?.input], [null, "Dune"]);
  assert.deepEqual([created.length], [0]);
  assert.equal(titleInput(form("series")).value, "Dune");
});

test("a routine is handed the typed name, for the person adding it, and clears the draft once it is saved", async (t) => {
  around(t);
  stage([]);
  const view = form("routine");
  type(view, "Evening wind-down");
  await submit(view);
  assert.equal(overlay.getSnapshot().adding, false);
  overlay.landOnward();
  const compose = mount<Record<string, any>>(Compose, {});
  const entry = find(compose.tree as never, (_, kind) => (kind as { name?: string }).name === "NewRoutine")[0];
  const sheetView = find(mount<Record<string, any>>(entry.type as never, entry.props).tree as never, (_, kind) => (kind as { name?: string }).name === "RoutineSheet")[0];
  assert.deepEqual([sheetView.props.start.title, sheetView.props.start.who, sheetView.props.me], ["Evening wind-down", "a", "a"]);
  assert.equal(overlay.keptDraft()?.input, "Evening wind-down");
  const routine = mount<Record<string, any>>(sheetView.type as never, sheetView.props);
  await find(routine.tree as never, (props) => typeof props.onSubmit === "function")[0].props.onSubmit({ preventDefault: () => undefined });
  await settle();
  assert.deepEqual([created.length > 0, overlay.keptDraft()], [true, null]);
});

test("Compose renders nothing while nothing is handed off", (t) => {
  around(t);
  overlay.closeCompose();
  assert.equal(mount<Record<string, any>>(Compose, {}).tree, null);
});

test("a routine that fails to save stays open with its error and keeps the draft; the line is trimmed when handed across", async (t) => {
  around(t);
  stage([]);
  const view = form("routine");
  type(view, "  Evening wind-down  ");
  await submit(view);
  overlay.landOnward();
  assert.deepEqual(overlay.getSnapshot().compose, { kind: "routine", title: "Evening wind-down" });
  const compose = mount<Record<string, any>>(Compose, {});
  const entry = find(compose.tree as never, (_, kind) => (kind as { name?: string }).name === "NewRoutine")[0];
  const sheetView = find(mount<Record<string, any>>(entry.type as never, entry.props).tree as never, (_, kind) => (kind as { name?: string }).name === "RoutineSheet")[0];
  stub.many = async (...args: unknown[]) => (created.push(args), { ok: false as const, storage: false, paused: false, errors: ["nope"] });
  const routine = mount<Record<string, any>>(sheetView.type as never, sheetView.props);
  await find(routine.tree as never, (props) => typeof props.onSubmit === "function")[0].props.onSubmit({ preventDefault: () => undefined });
  await settle();
  assert.equal(created.length > 0, true);
  assert.deepEqual([overlay.getSnapshot().compose !== null, overlay.keptDraft()?.input], [true, "  Evening wind-down  "]);
});

test("the typed text survives switching kinds, to a hand-off kind and back", (t) => {
  around(t);
  const view = form("movie");
  type(view, "Dune");
  chip(view, "Task").onClick();
  assert.deepEqual([titleInput(view).value, chip(view, "Task")["aria-pressed"], chip(view, "Movie")["aria-pressed"]], ["Dune", true, false]);
  chip(view, "Book").onClick();
  assert.equal(titleInput(view).value, "Dune");
  assert.equal(overlay.keptDraft()?.kindPick, "book");
});

test("an explicit pick kept in the draft beats the section's start, and an automatic one does not", (t) => {
  around(t);
  overlay.keepDraft({ input: "Florist 5 jt", kindPick: "vendor", ignore: [], edits: {}, ownerPick: null });
  assert.equal(chip(form("movie"), "Vendor")["aria-pressed"], true);
  overlay.keepDraft({ input: "Florist 5 jt", kindPick: null, ignore: [], edits: {}, ownerPick: null });
  const view = form("movie");
  assert.deepEqual([chip(view, "Movie")["aria-pressed"], titleInput(view).value], [true, "Florist 5 jt"]);
});

const SECTIONS = ["", "tasks", "marriage", "money", "people", "settings", "payments", "guests", "vendors", "budget", "sync", "routines", "movies", "series", "books", "wishlist", "places"];

const submitLabel = (view: { tree: unknown }) => find(view.tree as never, (props) => props.type === "submit")[0].props.children;

const backdropCloses = (pristine: boolean) => {
  const dialog = find(mount<Record<string, any>>(AddSheet, {}).tree as never, (props) => props.className === "add-sheet")[0].props;
  const target = { querySelector: () => (pristine ? {} : null) };
  overlay.openAdd();
  dialog.onClick({ target, currentTarget: target });
  return !overlay.getSnapshot().adding;
};

test("a section's start is a preselect, not a pick: Books opened and closed empty leaves Task for the next +, and the label is Add task", (t) => {
  around(t);
  const books = form("book");
  const wishlist = submitLabel(books);
  assert.deepEqual([chip(books, "Book")["aria-pressed"], wishlist === text.sheet.save.task], [true, false]);
  assert.equal(overlay.keptDraft(), null);
  overlay.closeAdd();
  const tasks = form(addStartsAs("tasks"));
  assert.deepEqual([chip(tasks, "Task")["aria-pressed"], chip(tasks, "Book")["aria-pressed"], submitLabel(tasks)], [true, false, text.sheet.save.task]);
  type(tasks, "Call the florist tomorrow");
  assert.equal(overlay.keptDraft()?.kindPick, null);
  assert.equal(created.length, 0);
});

test("every section opens with its own preselect each time, whatever the last section was", (t) => {
  around(t);
  const pressed = (section: string) => {
    const view = form(addStartsAs(section));
    const on = chips(view).filter((entry) => entry.props["aria-pressed"]).map((entry) => entry.props.children[1]);
    overlay.closeAdd();
    return on;
  };
  const expected: Record<string, string> = { routines: "Routine", movies: "Movie", series: "Series", books: "Book", wishlist: "Book", places: "Book" };
  for (const order of [SECTIONS, [...SECTIONS].reverse()]) for (const section of order) assert.deepEqual(pressed(section), [expected[section] ?? "Task"], section);
});

test("a real tap on a chip is kept for the next +, over the section's own start", (t) => {
  around(t);
  const view = form("book");
  chip(view, "Vendor").onClick();
  assert.deepEqual([overlay.keptDraft()?.kindPick, data(view)], ["vendor", undefined]);
  overlay.closeAdd();
  assert.equal(chip(form(addStartsAs("tasks")), "Vendor")["aria-pressed"], true);
  const again = form("book");
  chip(again, "Book").onClick();
  assert.equal(overlay.keptDraft()?.kindPick, "book");
});

test("a typed draft is kept for the next +, on any section", (t) => {
  around(t);
  type(form("book"), "Dune");
  overlay.closeAdd();
  const view = form(addStartsAs("tasks"));
  assert.deepEqual([titleInput(view).value, chip(view, "Book")["aria-pressed"]], ["Dune", false]);
});

test("with nothing typed and nothing tapped the sheet is pristine on every section, and a backdrop tap closes it; with a tap or a line it is not", (t) => {
  around(t);
  for (const section of SECTIONS) {
    const view = form(addStartsAs(section));
    assert.equal(data(view), true, section);
    assert.equal(backdropCloses(data(view) === true), true, section);
    assert.equal(overlay.keptDraft(), null, section);
  }
  const tapped = form();
  chip(tapped, "Guest").onClick();
  assert.equal(data(tapped), undefined);
  overlay.keepDraft(null);
  const typed = form("book");
  type(typed, "Dune");
  assert.equal(data(typed), undefined);
  assert.equal(backdropCloses(false), false);
});

test("a hand-off kind picked for a kept draft never lands in the draft as a kind", (t) => {
  around(t);
  const view = form("movie");
  type(view, "Dune");
  assert.equal(overlay.keptDraft()?.kindPick, null);
});

test("while paused the hand-off chips are aria-disabled with no handler, Continue hands nothing off, and the typed text stays", async (t) => {
  around(t, true);
  const view = form("movie");
  type(view, "Dune");
  for (const label of ["Routine", "Movie", "Series"]) assert.deepEqual([chip(view, label)["aria-disabled"], chip(view, label).onClick], [true, undefined]);
  await submit(view);
  assert.deepEqual([overlay.getSnapshot().adding, overlay.getSnapshot().compose, titleInput(view).value], [true, null, "Dune"]);
});

test("Continue on a hand-off kind opens the form and writes nothing, and its hint says so", async (t) => {
  around(t);
  const view = form("series");
  type(view, "Harbour Lights");
  await submit(view);
  overlay.landOnward();
  assert.deepEqual([overlay.getSnapshot().compose, created.length], [{ kind: "series", title: "Harbour Lights" }, 0]);
  assert.match(text.sheet.onward.series.hint, /What you type is kept until you add it\./);
});

test("the Add sheet never reaches the movie or routine stores itself, and the lookup stays in the movie sheet", () => {
  assert.doesNotMatch(read("ui/add-sheet.tsx"), /ScreenSheet|RoutineSheet|saveScreen|useScreenSearch|flows\./);
  assert.match(read("ui/compose.tsx"), /<ScreenSheet kind=\{compose\.kind\} title=\{compose\.title\}/);
});

test("Home no longer carries a capture row, and the Late line is its first block", () => {
  assert.doesNotMatch(read("views/home.tsx"), /Capture/);
  assert.throws(() => readFileSync(new URL("../src/ui/capture.tsx", import.meta.url)));
});

test("a quick-add field is a plain solid input", () => {
  const rules = sheet("ui/ui.css");
  const own = cascade(rules, '.quick-add input[name="title"]', 20);
  for (const property of ["border-style", "border-width", "border-radius", "background"]) assert.equal(own.get(property), undefined, property);
  assert.equal(own.get("flex"), "1 1 8rem");
});

test("the nine kind chips sit three to a row from 356 px up (360, 390, 412), two on 320 px, one per row at 200 % text, so the common Task sheet keeps its owner row", () => {
  const rules = sheet("ui/sheet.css");
  const grid = cascade(rules, ".kinds", 24.375).get("grid-template-columns") ?? "";
  const [, min] = /^repeat\(auto-fit, minmax\(([\d.]+)rem, 1fr\)\)$/.exec(grid) ?? [];
  const gap = 0.5;
  const sheetPadding = 2 * 1.25;
  const columns = (rem: number) => Math.floor((rem - sheetPadding + gap) / (Number(min) + gap));
  assert.deepEqual([412 / 16, 390 / 16, 360 / 16, 356 / 16, 355 / 16, 320 / 16, 412 / 32, 390 / 32, 360 / 32, 320 / 32].map(columns), [3, 3, 3, 3, 2, 2, 1, 1, 1, 1]);
  assert.equal(cascade(rules, ".kinds", 24.375).get("gap"), "var(--s2)");
});

test("the Add sheet keeps one height whichever kind is picked, so the chips do not jump when Routine gives way to Task, and never outgrows the screen", () => {
  const rules = sheet("ui/sheet.css");
  assert.equal(cascade(rules, ".add-sheet:has(.add-form)", 24.375).get("min-height"), "min(42.5rem, calc(var(--vv-h, 100dvh) - var(--safe-t) - var(--s5)))");
  assert.equal(cascade(rules, ".add-sheet:has(.add-form)", 70).get("min-height"), "min(42.5rem, calc(var(--vv-h, 100dvh) - var(--s9)))");
  assert.equal(cascade(rules, ".add-sheet", 70).get("max-height"), "min(46rem, calc(var(--vv-h, 100dvh) - var(--s9)))");
  assert.match(read("ui/add-sheet.tsx"), /<form ref=\{form\} className="sheet-form add-form"/);
});

test("a routine cannot be handed over before the person adding it is known: nothing opens rather than a sheet for the wrong side", (t) => {
  around(t);
  const rows = snapshot as unknown as { me: string | null };
  t.after(() => void (rows.me = "a"));
  rows.me = null;
  overlay.handOff({ kind: "routine", title: "Evening yoga" });
  overlay.landOnward();
  const compose = mount<Record<string, any>>(Compose, {});
  const entry = find(compose.tree as never, (_, kind) => (kind as { name?: string }).name === "NewRoutine")[0];
  assert.equal(mount<Record<string, any>>(entry.type as never, entry.props).tree, null);
});
