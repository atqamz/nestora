import { test } from "node:test";
import assert from "node:assert/strict";
import { isCurrent, libraryTabs, marriageTabs, navEntries, navItems } from "../src/ui/nav.ts";
import { screenOf, screens } from "../src/ui/routes.ts";
import type { Screen } from "../src/ui/routes.ts";
import { text } from "../src/ui/text.ts";

test("the phone tab bar holds Home, Marriage, Routines and Library and no Settings", () => {
  assert.deepEqual(
    navItems("tabs").map((item) => item.label),
    ["Home", "Marriage", "Routines", "Library"],
  );
  assert.deepEqual(
    navItems("tabs").map((item) => item.section),
    ["", "marriage", "routines", "books"],
  );
});

test("the sidebar holds the same destinations and ends on Settings", () => {
  assert.deepEqual(
    navItems("rail").map((item) => item.section),
    ["", "marriage", "routines", "books", "settings"],
  );
  assert.equal(navItems("rail").at(-1)?.label, text.nav.settings);
});

test("every item is labelled and has an icon", () => {
  for (const item of navItems("rail")) assert.ok(item.label.trim() !== "" && item.icon !== undefined, item.section);
});

const current = (section: string) => navItems("rail").filter((item) => isCurrent(item, section)).map((item) => item.section);

const destinations: Record<string, [Screen, string]> = {
  "": ["home", ""],
  marriage: ["marriage", "marriage"],
  tasks: ["tasks", "marriage"],
  "tasks/t1": ["tasks", "marriage"],
  money: ["money", "marriage"],
  "money/m1": ["money", "marriage"],
  budget: ["money", "marriage"],
  payments: ["payments", "marriage"],
  "payments/p1": ["payments", "marriage"],
  people: ["people", "marriage"],
  guests: ["people", "marriage"],
  vendors: ["people", "marriage"],
  "guests/g1": ["people", "marriage"],
  routines: ["routines", "routines"],
  "routines/r1": ["routines", "routines"],
  "routines/r1/start": ["routines", "routines"],
  books: ["books", "books"],
  "books/b1": ["books", "books"],
  "books/import": ["books", "books"],
  wishlist: ["books", "books"],
  places: ["books", "books"],
  movies: ["movies", "books"],
  "movies/m1": ["movies", "books"],
  series: ["series", "books"],
  "series/s1": ["series", "books"],
  settings: ["settings", "settings"],
};

test("every route, old and new, opens one screen and highlights exactly one destination", () => {
  for (const [route, [screen, destination]] of Object.entries(destinations)) {
    const [section = ""] = route.split("/");
    assert.equal(screenOf(section), screen, `#/${route}`);
    assert.deepEqual(current(section), [destination], `#/${route}`);
  }
});

test("the Marriage tabs cover Journey, Tasks, Money and People, and each opens a Marriage screen", () => {
  assert.deepEqual(
    marriageTabs.map((tab) => tab.label),
    ["Journey", "Tasks", "Money", "People"],
  );
  const marriage = navItems("rail").find((item) => item.section === "marriage")!;
  for (const tab of marriageTabs) {
    assert.ok(tab.screens.includes(screenOf(tab.section)!), tab.section);
    assert.ok(isCurrent(marriage, tab.section), tab.section);
  }
  for (const screen of marriage.screens) assert.equal(marriageTabs.filter((tab) => tab.screens.includes(screen)).length, 1, screen);
});

test("the Library tabs cover Books, Movies and Series, each opens its own screen and keeps Library current", () => {
  assert.deepEqual(
    libraryTabs.map((tab) => tab.label),
    ["Books", "Movies", "Series"],
  );
  const library = navItems("rail").find((item) => item.section === "books")!;
  for (const tab of libraryTabs) {
    assert.ok(tab.screens.includes(screenOf(tab.section)!), tab.section);
    assert.ok(isCurrent(library, tab.section), tab.section);
  }
  for (const screen of library.screens) assert.equal(libraryTabs.filter((tab) => tab.screens.includes(screen)).length, 1, screen);
});

test("every destination links to a route that opens one of its own screens", () => {
  for (const item of navItems("rail")) assert.ok(item.screens.includes(screenOf(item.section)!), item.section);
});

test("every screen but Sync belongs to one destination, so the bar and the page switch cannot drift apart", () => {
  const owners = (screen: Screen) => navItems("rail").filter((item) => item.screens.includes(screen)).length;
  for (const screen of new Set(Object.values(screens))) assert.equal(owners(screen), screen === "sync" ? 0 : 1, screen);
});

test("Sync and routes that do not exist highlight nothing and open nothing", () => {
  assert.equal(screenOf("sync"), "sync");
  assert.deepEqual(current("sync"), []);
  for (const section of ["nowhere", "constructor", "__proto__", "toString", "Money", "money/x", "routine", "Routines"]) {
    assert.equal(screenOf(section), null, section);
    assert.deepEqual(current(section), [], section);
  }
});

const order = (kind: "tabs" | "rail") => navEntries(kind).map((entry) => (entry === "add" ? "add" : entry.section));

test("the Add button sits in the middle of the phone tab bar and first in the sidebar, in tab order", () => {
  assert.deepEqual(order("tabs"), ["", "marriage", "add", "routines", "books"]);
  assert.deepEqual(order("rail"), ["add", "", "marriage", "routines", "books", "settings"]);
});

test("Add is a button that is reachable on every main screen, and no destination is lost", () => {
  for (const kind of ["tabs", "rail"] as const) {
    assert.equal(navEntries(kind).filter((entry) => entry === "add").length, 1);
    assert.deepEqual(navEntries(kind).filter((entry) => entry !== "add"), navItems(kind));
  }
});
