import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hiddenRoute, hiddenText } from "../src/domain/place.ts";
import { placeStore } from "../src/store/places.ts";
import type { Places } from "../src/store/places.ts";
import type { Held } from "../src/store/timers.ts";

class FakeElement {
  focused = 0;
  options: unknown;
  href: string | null;
  tab: boolean;
  top = 100;
  height = 20;
  closedIn: FakeElement | null = null;
  summary: FakeElement | null = null;
  parentElement: FakeElement | null = null;
  constructor(href: string | null = null, tab = false) {
    this.href = href;
    this.tab = tab;
  }
  getAttribute(name: string) {
    return name === "href" ? this.href : null;
  }
  getBoundingClientRect() {
    return { top: this.top, bottom: this.top + this.height, height: this.height };
  }
  closest(selector: string) {
    return selector === "a" ? this : selector === "details:not([open])" ? this.closedIn : null;
  }
  querySelector(selector: string) {
    return selector === "summary" ? this.summary : null;
  }
  matches(selector: string) {
    return this.tab && selector === ".tabs a, .rail a, .brand, .pair";
  }
  focus(options?: unknown) {
    this.options = options;
    this.focused++;
    if (this.height > 0) world.focus = this;
  }
}

type Entry = { hash: string; state: unknown };
type Event = { target?: unknown; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; button?: number };
type Listener = (event?: Event) => void;

const world = {
  entries: [{ hash: "", state: null }] as Entry[],
  at: 0,
  y: 0,
  max: 3000,
  open: [] as { open: boolean }[],
  links: [] as FakeElement[],
  heading: null as FakeElement | null,
  focus: null as FakeElement | null,
  listeners: new Map<string, Listener[]>(),
  frames: [] as (() => void)[],
  scrolls: 0,
  behaviors: new Set<string>(),
  drift: 0,
  across: 0,
  options: new Map<string, unknown>(),
  store: new Map<string, string>(),
  side: "a" as "a" | "b" | null,
  tabbable: [] as FakeElement[],
  sealed: false,
};

const on = (type: string, listener: Listener) => world.listeners.set(type, [...(world.listeners.get(type) ?? []), listener]);
const fire = (type: string, event?: Event) => world.listeners.get(type)?.forEach((listener) => listener(event));
const clamp = (y: number) => Math.max(0, Math.min(world.max, y));

Object.assign(globalThis, {
  Element: FakeElement,
  addEventListener: (type: string, listener: Listener, options?: { signal?: AbortSignal }) => {
    on(type, listener);
    world.options.set(type, options);
    options?.signal?.addEventListener("abort", () => world.listeners.set(type, (world.listeners.get(type) ?? []).filter((one) => one !== listener)));
  },
  scrollTo: (first: number | { top: number; behavior?: string }, second?: number) => {
    world.scrolls++;
    world.behaviors.add(typeof first === "number" ? "instant" : (first.behavior ?? "auto"));
    if (typeof first === "number") world.across = first;
    world.y = clamp(typeof first === "number" ? (second ?? 0) : first.top) - world.drift;
  },
  requestAnimationFrame: (run: () => void) => world.frames.push(run),
  document: {
    addEventListener: (type: string, listener: Listener) => on(`document:${type}`, listener),
    get activeElement() {
      return world.focus;
    },
    querySelectorAll: (selector: string) => (selector === "main details" ? world.open : selector === "main a" ? world.links : selector.includes("summary") ? world.tabbable : []),
    querySelector: (selector: string) => (selector === "h1" ? world.heading : null),
  },
  history: {
    scrollRestoration: "auto",
    get state() {
      return world.entries[world.at].state;
    },
    replaceState: (state: unknown) => {
      if (world.sealed) throw new Error("SecurityError");
      world.entries[world.at].state = state;
    },
  },
  location: {
    get hash() {
      return world.entries[world.at].hash;
    },
  },
});
Object.assign(globalThis, { innerHeight: 800 });
Object.defineProperty(globalThis, "scrollY", { configurable: true, get: () => world.y });

const held = (): Held => ({
  get length() {
    return world.store.size;
  },
  key: (at) => [...world.store.keys()][at] ?? null,
  getItem: (key) => world.store.get(key) ?? null,
  setItem: (key, value) => void world.store.set(key, value),
  removeItem: (key) => void world.store.delete(key),
});

const places = (side: "a" | "b" | null = world.side) => placeStore(held(), () => side);

let loads = 0;
const load = async () => {
  world.listeners.clear();
  const module = (await import(new URL(`../src/ui/place.ts?${loads++}`, import.meta.url).href)) as { startPlace: (kept: Places, hidden: (route: string) => boolean, ready: () => boolean) => void; landPlace: (how: "first" | "move" | "beside") => void };
  return { landPlace: module.landPlace, startPlace: (kept: Places, hidden: (route: string) => boolean = () => false, ready: () => boolean = () => true) => module.startPlace(kept, hidden, ready) };
};

const reset = (hash: string) => {
  Object.assign(world, { entries: [{ hash, state: null }], at: 0, y: 0, max: 3000, open: [], links: [], heading: new FakeElement(), focus: null, frames: [], scrolls: 0, behaviors: new Set<string>(), drift: 0, across: 0, options: new Map<string, unknown>(), tabbable: [], side: "a", sealed: false });
  world.store.clear();
};

const page = (links: string[], open: boolean[] = [], max = 3000) => {
  world.links = links.map((href) => new FakeElement(href));
  world.open = open.map((flag) => ({ open: flag }));
  world.heading = new FakeElement();
  world.max = max;
};

const settle = (limit = 100) => {
  while (world.frames.length > 0 && limit-- > 0) world.frames.shift()!();
};

const push = (hash: string) => {
  world.entries = [...world.entries.slice(0, world.at + 1), { hash, state: null }];
  world.at++;
  fire("hashchange");
};
const replace = (hash: string) => {
  world.entries[world.at] = { hash, state: null };
  fire("hashchange");
};
const back = () => {
  world.at--;
  fire("hashchange");
};
const forward = () => {
  world.at++;
  fire("hashchange");
};
const focused = () => world.focus;
const click = (link: FakeElement, event: Event = {}) => fire("document:click", { target: link, ...event });

const ROUTINE = "#/routines/r1";

test("startPlace takes over scroll restoration from the browser", async () => {
  reset("#/");
  const place = await load();
  place.startPlace(places());
  assert.equal(history.scrollRestoration, "manual");
});

test("Back restores the scroll position and the open state, and focuses the link that was opened", async () => {
  reset("#/");
  const place = await load();
  place.startPlace(places());
  place.landPlace("first");
  page([ROUTINE, "#/books"], [false, true]);
  world.y = 1500;
  push("#/routines/r1");
  page(["#/"]);
  place.landPlace("move");
  assert.equal(world.y, 0);
  assert.equal(world.focus, world.heading);
  back();
  page([ROUTINE, "#/books"], [true, true]);
  place.landPlace("move");
  assert.equal(world.y, 1500);
  assert.deepEqual(
    world.open.map((one) => one.open),
    [false, true],
  );
  assert.equal(world.focus?.href, ROUTINE);
  assert.deepEqual(world.focus?.options, { preventScroll: true });
  assert.deepEqual([...world.behaviors], ["instant"]);
  assert.equal(world.frames.length, 0);
  assert.equal(world.listeners.get("wheel")?.length ?? 0, 0);
  assert.deepEqual(world.options.get("touchstart"), { once: true, passive: true, signal: (world.options.get("touchstart") as { signal: AbortSignal }).signal });
});

test("forward navigation lands at the top with focus on the heading", async () => {
  reset("#/");
  const place = await load();
  place.startPlace(places());
  place.landPlace("first");
  page([ROUTINE]);
  world.y = 1500;
  push("#/books");
  page(["#/"]);
  world.y = 900;
  place.landPlace("move");
  assert.equal(world.y, 0);
  assert.equal(world.across, 0);
  assert.equal(world.focus, world.heading);
});

test("Forward after Back restores the later screen too", async () => {
  reset("#/");
  const place = await load();
  place.startPlace(places());
  page([ROUTINE]);
  world.y = 100;
  push("#/routines/r1");
  page(["#/"]);
  world.y = 640;
  back();
  page([ROUTINE]);
  place.landPlace("move");
  forward();
  page(["#/"]);
  place.landPlace("move");
  assert.equal(world.y, 640);
});

test("a link back to the screen this one was opened from returns to where that screen was left", async () => {
  reset("#/");
  const place = await load();
  place.startPlace(places());
  page([ROUTINE]);
  world.y = 1500;
  push("#/routines/r1");
  page(["#/"]);
  place.landPlace("move");
  push("#/");
  page([ROUTINE, "#/books"]);
  place.landPlace("move");
  assert.equal(world.y, 1500);
  assert.equal(world.focus?.href, ROUTINE);
  assert.equal(world.frames.length, 0);
});

test("a link to a screen that was not the one it was opened from lands at the top", async () => {
  reset("#/");
  const place = await load();
  place.startPlace(places());
  page(["#/routines"]);
  world.y = 700;
  push("#/routines");
  page(["#/routines/r1"]);
  world.y = 300;
  push("#/routines/r1");
  page(["#/"]);
  place.landPlace("move");
  world.y = 50;
  push("#/");
  page(["#/routines"]);
  world.y = 20;
  place.landPlace("move");
  assert.equal(world.y, 0);
  assert.equal(world.focus, world.heading);
});

test("a tab link returns to the tab's own position, and a plain link to the same screen does not", async () => {
  reset("#/");
  const place = await load();
  place.startPlace(places());
  page(["#/routines"]);
  world.y = 1200;
  click(new FakeElement("#/routines", true));
  push("#/routines");
  page(["#/routines/r1"]);
  place.landPlace("move");
  assert.equal(world.y, 0);
  world.y = 400;
  click(new FakeElement("#/books", true));
  push("#/books");
  page(["#/books/b1"]);
  place.landPlace("move");
  world.y = 80;
  click(new FakeElement("#/", true));
  push("#/");
  page(["#/routines"]);
  place.landPlace("move");
  assert.equal(world.y, 1200);
  assert.equal(world.focus, world.heading);
  world.y = 1200;
  click(new FakeElement("#/books", true));
  push("#/books");
  page(["#/books/b1"]);
  place.landPlace("move");
  assert.equal(world.y, 80);
  world.y = 90;
  push("#/routines");
  page(["#/routines/r1"]);
  place.landPlace("move");
  assert.equal(world.y, 0);
  push("#/routines/r1");
  page(["#/books"]);
  place.landPlace("move");
  push("#/books");
  page(["#/books/b1"]);
  place.landPlace("move");
  assert.equal(world.y, 0);
});

test("a click on a link that is not a tab does not turn the next navigation into a tab change", async () => {
  reset("#/");
  const place = await load();
  place.startPlace(places());
  page(["#/routines"]);
  world.y = 900;
  push("#/routines");
  page(["#/books"]);
  world.y = 250;
  push("#/books");
  page(["#/routines"]);
  place.landPlace("move");
  click(new FakeElement("#/", false));
  push("#/");
  page(["#/routines"]);
  place.landPlace("move");
  assert.equal(world.y, 0);
});

test("a tab click that goes nowhere is not remembered for a later plain link", async () => {
  reset("#/");
  const place = await load();
  place.startPlace(places());
  page(["#/routines"]);
  world.y = 900;
  push("#/routines");
  page([]);
  world.y = 250;
  click(new FakeElement("#/books", true));
  push("#/routines/r1");
  page(["#/"]);
  place.landPlace("move");
  assert.equal(world.y, 0);
});

test("a screen replaced by another returns to the position of the screen it was opened from", async () => {
  reset("#/routines/r1");
  const place = await load();
  place.startPlace(places());
  page(["#/routines/r1/start"]);
  world.y = 400;
  push("#/routines/r1/start");
  page([]);
  place.landPlace("move");
  replace("#/routines/r1");
  page(["#/routines/r1/start"]);
  place.landPlace("move");
  assert.equal(world.y, 400);
  assert.equal(world.focus?.href, "#/routines/r1/start");
});

test("a reload restores the position without moving focus", async () => {
  reset("#/");
  const kept = places();
  const first = await load();
  first.startPlace(kept);
  page([ROUTINE], [true]);
  world.y = 1700;
  fire("pagehide");
  world.y = 0;
  world.focus = null;
  const second = await load();
  second.startPlace(kept);
  page([ROUTINE], [false]);
  second.landPlace("first");
  assert.equal(world.y, 1700);
  assert.equal(world.focus, null);
  assert.deepEqual(world.open[0], { open: true });
});

test("a first visit leaves the scroll and the focus alone", async () => {
  reset("#/");
  const place = await load();
  place.startPlace(places());
  page([ROUTINE]);
  world.y = 300;
  place.landPlace("first");
  assert.equal(world.y, 300);
  assert.equal(world.scrolls, 0);
  assert.equal(world.focus, null);
});

test("content that arrives late is waited for, and the position is applied once it is tall enough", async () => {
  reset("#/");
  const place = await load();
  place.startPlace(places());
  page([ROUTINE]);
  world.y = 1500;
  push("#/routines/r1");
  page([]);
  place.landPlace("move");
  back();
  world.heading = null;
  world.links = [];
  world.max = 0;
  world.focus = null;
  place.landPlace("move");
  settle(3);
  assert.equal(world.y, 0);
  assert.equal(world.focus, null);
  page([ROUTINE], [], 3000);
  settle();
  assert.equal(world.y, 1500);
  assert.equal(focused()?.href, ROUTINE);
  assert.equal(world.frames.length, 0);
});

test("a touch, wheel, key or pointer press stops the restoring", async () => {
  for (const type of ["wheel", "touchstart", "keydown", "pointerdown"]) {
    reset("#/");
    const place = await load();
    place.startPlace(places());
    page([ROUTINE]);
    world.y = 1500;
    push("#/routines/r1");
    page([]);
    place.landPlace("move");
    back();
    page([ROUTINE], [], 0);
    place.landPlace("move");
    assert.ok(world.frames.length > 0, type);
    fire(type);
    world.max = 3000;
    settle();
    assert.equal(world.y, 0, type);
  }
});

test("a restore that has not finished is dropped when the route changes again", async () => {
  reset("#/");
  const place = await load();
  place.startPlace(places());
  page([ROUTINE]);
  world.y = 1500;
  push("#/routines/r1");
  page([]);
  place.landPlace("move");
  back();
  page([ROUTINE], [], 0);
  place.landPlace("move");
  push("#/books");
  page(["#/"], [], 3000);
  place.landPlace("move");
  settle();
  assert.equal(world.y, 0);
});

test("saved open states that no longer match the page are left alone", async () => {
  reset("#/");
  const place = await load();
  place.startPlace(places());
  page([ROUTINE], [false, true]);
  world.y = 100;
  push("#/routines/r1");
  page([]);
  place.landPlace("move");
  back();
  page([ROUTINE], [true, true, true]);
  place.landPlace("move");
  assert.deepEqual(
    world.open.map((one) => one.open),
    [true, true, true],
  );
});

test("a broken session storage never throws", async () => {
  reset("#/");
  const place = await load();
  const blocked = () => {
    throw new Error("blocked");
  };
  place.startPlace(placeStore({ length: 1, key: blocked, getItem: blocked, setItem: blocked, removeItem: blocked }, () => "a"));
  page([ROUTINE]);
  push("#/routines/r1");
  fire("pagehide");
  place.startPlace(placeStore(null, () => "a"));
});

test("main hands every route change to the place module and keeps the split-view branches", () => {
  const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  assert.match(main, /startPlace\(\s*places,\s*\(text\) => \{\s*const \{ ready, rows \} = store\.getSnapshot\(\);\s*return hiddenText\(text, ready, rows\.items\);\s*\},\s*\(\) => store\.getSnapshot\(\)\.ready,\s*\);/);
  assert.match(main, /useLayoutEffect\(\(\) => \{\s*const now = document\.querySelector\("\.split"\);/);
  assert.match(main, /const how = first\.current \? "first" : selecting \|\| closing \? "beside" : "move";/);
  assert.match(main, /first\.current = false;\s*landPlace\(how\);\s*if \(closing\) \(row \?\? document\.querySelector<HTMLElement>\("h1"\)\)\?\.focus\(\{ preventScroll: !row \}\)/);
  assert.doesNotMatch(main, /scrollTo\(/);
  assert.match(readFileSync(new URL("../src/store/browser.ts", import.meta.url), "utf8"), /export const places = placeStore\(tabStorage/);
});

test("an entry on the same screen under another spelling of the address gets its own place", async () => {
  reset("");
  const place = await load();
  place.startPlace(places());
  page([ROUTINE]);
  world.y = 800;
  push("#/");
  page([ROUTINE]);
  world.y = 300;
  push("#/routines/r1");
  page(["#/"]);
  place.landPlace("move");
  back();
  page([ROUTINE]);
  place.landPlace("move");
  assert.equal(world.y, 300);
  back();
  assert.equal(world.entries[world.at].hash, "");
  page([ROUTINE]);
  place.landPlace("move");
  assert.equal(world.y, 800);
});

test("beside a split pane the position comes back but focus stays with the pane code, and a plain selection leaves the page alone", async () => {
  reset("#/guests");
  const place = await load();
  place.startPlace(places());
  page(["#/guests/g1"]);
  world.y = 150;
  push("#/guests/g1");
  page([]);
  world.y = 150;
  place.landPlace("beside");
  assert.equal(world.scrolls, 0);
  assert.equal(world.focus, null);
  world.y = 196;
  back();
  page(["#/guests/g1"]);
  place.landPlace("beside");
  assert.equal(world.y, 150);
  assert.equal(world.focus, null);
});

test("a screen visited again is remembered where it was left the second time", async () => {
  reset("#/");
  const place = await load();
  place.startPlace(places());
  page([ROUTINE]);
  world.y = 500;
  push("#/routines/r1");
  page(["#/"]);
  place.landPlace("move");
  back();
  page([ROUTINE]);
  place.landPlace("move");
  assert.equal(world.y, 500);
  world.y = 900;
  push("#/books");
  page(["#/"]);
  place.landPlace("move");
  back();
  page([ROUTINE]);
  place.landPlace("move");
  assert.equal(world.y, 900);
});

test("the same arrival handled twice leaves the page where the first one put it", async () => {
  reset("#/");
  const place = await load();
  place.startPlace(places());
  page([ROUTINE]);
  world.y = 500;
  push("#/routines/r1");
  page(["#/"]);
  place.landPlace("move");
  back();
  page([ROUTINE]);
  place.landPlace("move");
  const scrolls = world.scrolls;
  world.focus = null;
  place.landPlace("move");
  assert.equal(world.scrolls, scrolls);
  assert.equal(world.focus, null);
  assert.equal(world.y, 500);
});

test("the places are written to the session storage on every navigation, not only when the page is hidden", async () => {
  reset("#/");
  const place = await load();
  place.startPlace(places());
  assert.equal(world.store.size, 1);
  page([ROUTINE]);
  world.y = 640;
  push("#/routines/r1");
  assert.match(world.store.get("wp.place.a") ?? "", /"y":640/);
});

test("a position that lands one pixel short counts as reached, so the restore does not keep fighting the browser", async () => {
  reset("#/");
  const place = await load();
  place.startPlace(places());
  page([ROUTINE]);
  world.y = 1500;
  push("#/routines/r1");
  page([]);
  place.landPlace("move");
  back();
  page([ROUTINE]);
  world.drift = 1;
  place.landPlace("move");
  assert.equal(world.y, 1499);
  assert.equal(world.frames.length, 0);
});

const withClock = async (run: (tick: (ms: number) => void) => Promise<void> | void) => {
  const real = Date.now;
  let now = 1_700_000_000_000;
  Date.now = () => now;
  try {
    await run((ms) => void (now += ms));
  } finally {
    Date.now = real;
  }
};

const hiddenLink = (href: string, summary = new FakeElement()) => {
  const link = new FakeElement(href);
  link.height = 0;
  link.closedIn = new FakeElement();
  link.closedIn.summary = summary;
  return { link, summary };
};

const openThenBack = async (hash: string, link: string, left: string) => {
  reset(hash);
  const place = await load();
  place.startPlace(places());
  page([link]);
  world.y = 1500;
  push(left);
  page(["#/"]);
  place.landPlace("move");
  return place;
};

test("Back to a link inside a closed details focuses the summary of that details, and never leaves focus on the body", async () => {
  const place = await openThenBack("#/", "#/routines", "#/routines");
  back();
  const { link, summary } = hiddenLink("#/routines");
  page([]);
  world.links = [link];
  world.open = [{ open: false }];
  world.focus = null;
  place.landPlace("move");
  assert.equal(world.y, 1500);
  assert.equal(world.focus, summary);
  assert.deepEqual(summary.options, { preventScroll: true });
  assert.equal(link.focused, 0);
});

test("a summary that is off screen gives way to the heading, and a heading off screen to the first control in view", async () => {
  const place = await openThenBack("#/", "#/routines", "#/routines");
  back();
  const { link, summary } = hiddenLink("#/routines");
  summary.top = 5000;
  page([]);
  world.links = [link];
  world.focus = null;
  place.landPlace("move");
  assert.equal(world.focus, world.heading);
  push("#/books");
  page([]);
  place.landPlace("move");
  back();
  const next = hiddenLink("#/books");
  next.summary.top = 5000;
  page([]);
  world.links = [next.link];
  world.heading!.top = -1400;
  const reachable = new FakeElement("#/tasks");
  reachable.top = 300;
  world.tabbable = [new FakeElement("#/off"), reachable];
  world.tabbable[0].top = -900;
  world.focus = null;
  place.landPlace("move");
  assert.equal(world.focus, reachable);
});

test("a link in a details nested in a closed details falls back to the outer summary", async () => {
  const place = await openThenBack("#/", "#/routines", "#/routines");
  back();
  const { link, summary } = hiddenLink("#/routines");
  const outer = new FakeElement();
  outer.summary = new FakeElement();
  const holder = new FakeElement();
  holder.closedIn = outer;
  link.closedIn!.parentElement = holder;
  page([]);
  world.links = [link];
  world.focus = null;
  place.landPlace("move");
  assert.equal(world.focus, outer.summary);
  assert.equal(summary.focused, 0);
});

test("a tab link restore keeps the place and leaves focus on the pressed link when the heading is off screen", async () => {
  reset("#/");
  const place = await load();
  place.startPlace(places());
  page(["#/books"]);
  world.y = 1500;
  click(new FakeElement("#/books", true));
  push("#/books");
  page(["#/books/b1"]);
  place.landPlace("move");
  world.y = 40;
  click(new FakeElement("#/", true));
  push("#/");
  page(["#/books"]);
  world.heading!.top = -1400;
  world.tabbable = [new FakeElement("#/books")];
  const pressed = new FakeElement("#/");
  world.focus = pressed;
  place.landPlace("move");
  assert.equal(world.y, 1500);
  assert.equal(world.heading!.focused, 0);
  assert.equal(world.focus, pressed);
  assert.equal(world.tabbable[0].focused, 0);
});

test("a tab link restore at the top still focuses the heading", async () => {
  reset("#/");
  const place = await load();
  place.startPlace(places());
  page(["#/books"]);
  world.y = 0;
  click(new FakeElement("#/books", true));
  push("#/books");
  page([]);
  place.landPlace("move");
  click(new FakeElement("#/", true));
  push("#/");
  page([]);
  place.landPlace("move");
  assert.equal(world.focus, world.heading);
});

test("browser Forward lands on the heading, not on the link back to the screen it left", async () => {
  reset("#/");
  const place = await load();
  place.startPlace(places());
  page([ROUTINE]);
  world.y = 1500;
  push("#/routines/r1");
  page(["#/"]);
  place.landPlace("move");
  back();
  page([ROUTINE]);
  place.landPlace("move");
  assert.equal(world.focus?.href, ROUTINE);
  forward();
  page(["#/"]);
  world.focus = null;
  place.landPlace("move");
  assert.equal(world.focus, world.heading);
});

test("opening a screen from a list that was itself opened from it lands on the heading, not on the link back", async () => {
  reset("#/routines/r1");
  const place = await load();
  place.startPlace(places());
  page(["#/routines"]);
  world.y = 600;
  push("#/routines");
  page(["#/routines/r1"]);
  world.y = 900;
  place.landPlace("move");
  push("#/routines/r1");
  page(["#/routines"]);
  world.focus = null;
  place.landPlace("move");
  assert.equal(world.y, 600);
  assert.equal(world.focus, world.heading);
});

test("Back to Home after a tab press does not focus a body link the user never pressed", async () => {
  reset("#/");
  const place = await load();
  place.startPlace(places());
  page(["#/routines"]);
  world.y = 0;
  click(new FakeElement("#/routines", true));
  push("#/routines");
  page(["#/routines/r1"]);
  place.landPlace("move");
  back();
  page(["#/routines"]);
  world.focus = null;
  place.landPlace("move");
  assert.equal(world.focus, world.heading);
});

test("a click with a modifier or another button on a tab link does not make the next plain link to that route a tab change", async () => {
  for (const event of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
    reset("#/");
    const place = await load();
    place.startPlace(places());
    page(["#/routines"]);
    world.y = 900;
    push("#/routines");
    page(["#/books"]);
    world.y = 250;
    push("#/books");
    page(["#/"]);
    place.landPlace("move");
    click(new FakeElement("#/", true), event);
    push("#/");
    page(["#/routines"]);
    place.landPlace("move");
    assert.equal(world.y, 0, JSON.stringify(event));
  }
});

test("a replaceState that throws leaves navigation working", async () => {
  reset("#/");
  const place = await load();
  place.startPlace(places());
  world.sealed = true;
  page([ROUTINE]);
  world.y = 700;
  push("#/routines/r1");
  page(["#/"]);
  place.landPlace("move");
  assert.equal(world.y, 0);
  world.sealed = false;
  push("#/books");
  page([]);
  place.landPlace("move");
  back();
  page([]);
  place.landPlace("move");
  fire("pagehide");
});

test("a route left while its restore was still waiting keeps the place it was waiting for", async () => {
  reset("#/");
  const place = await load();
  place.startPlace(places());
  page([ROUTINE]);
  world.y = 1500;
  push("#/routines/r1");
  page([]);
  place.landPlace("move");
  back();
  page([ROUTINE], [], 0);
  place.landPlace("move");
  assert.ok(world.frames.length > 0);
  push("#/books");
  page([]);
  place.landPlace("move");
  back();
  page([ROUTINE]);
  place.landPlace("move");
  assert.equal(world.y, 1500);
});

test("details that appear after the first frame are waited for and opened as they were", async () => {
  reset("#/");
  const place = await load();
  place.startPlace(places());
  page([ROUTINE], [false, true]);
  world.y = 1500;
  push("#/routines/r1");
  page([]);
  place.landPlace("move");
  back();
  page([ROUTINE], []);
  place.landPlace("move");
  settle(3);
  assert.ok(world.frames.length > 0);
  assert.deepEqual(world.open, []);
  world.open = [{ open: true }, { open: false }];
  settle();
  assert.deepEqual(
    world.open.map((one) => one.open),
    [false, true],
  );
  assert.equal(world.y, 1500);
  assert.equal(world.frames.length, 0);
});

test("details that never appear are given up on after one second, not after a number of frames", async () => {
  await withClock(async (tick) => {
    reset("#/");
    const place = await load();
    place.startPlace(places());
    page([ROUTINE], [true]);
    world.y = 1500;
    push("#/routines/r1");
    page([]);
    place.landPlace("move");
    back();
    page([ROUTINE], []);
    place.landPlace("move");
    for (let frame = 0; frame < 300; frame++) world.frames.shift()?.();
    assert.ok(world.frames.length > 0);
    tick(999);
    world.frames.shift()!();
    assert.ok(world.frames.length > 0);
    tick(1);
    world.frames.shift()!();
    assert.equal(world.frames.length, 0);
    assert.equal(world.y, 1500);
  });
});

test("a place the page is too short to reach stops being chased after one second and listeners are dropped", async () => {
  await withClock(async (tick) => {
    reset("#/");
    const place = await load();
    place.startPlace(places());
    page([ROUTINE]);
    world.y = 1500;
    push("#/routines/r1");
    page([]);
    place.landPlace("move");
    back();
    page([ROUTINE], [], 200);
    place.landPlace("move");
    for (let frame = 0; frame < 300; frame++) world.frames.shift()?.();
    assert.ok(world.frames.length > 0);
    const scrolls = world.scrolls;
    tick(1000);
    world.frames.shift()!();
    assert.equal(world.frames.length, 0);
    assert.equal(world.scrolls, scrolls + 1);
    assert.equal(world.listeners.get("wheel")?.length ?? 0, 0);
  });
});

test("the second is counted from the first heading, so a slow probe behind a splash screen still restores", async () => {
  await withClock(async (tick) => {
    reset("#/");
    const place = await load();
    place.startPlace(places());
    page([ROUTINE]);
    world.y = 1500;
    push("#/routines/r1");
    page([]);
    place.landPlace("move");
    back();
    page([], [], 0);
    world.heading = null;
    place.landPlace("move");
    tick(2500);
    settle(5);
    assert.ok(world.frames.length > 0);
    page([ROUTINE]);
    tick(500);
    settle();
    assert.equal(world.y, 1500);
    assert.equal(world.focus?.href, ROUTINE);
  });
});

test("a screen that never shows a heading is given up on after ten seconds", async () => {
  await withClock(async (tick) => {
    reset("#/");
    const place = await load();
    place.startPlace(places());
    page([ROUTINE]);
    world.y = 1500;
    push("#/routines/r1");
    page([]);
    place.landPlace("move");
    back();
    page([], [], 0);
    world.heading = null;
    place.landPlace("move");
    tick(9999);
    world.frames.shift()!();
    assert.ok(world.frames.length > 0);
    tick(1);
    world.frames.shift()!();
    assert.equal(world.frames.length, 0);
  });
});

test("the places of a private routine are never written, and still serve Back while the page is open", async () => {
  reset("#/routines");
  const place = await load();
  place.startPlace(places(), (route) => route.startsWith("/routines/r_6"));
  page(["#/routines/r_6"]);
  world.y = 800;
  push("#/routines/r_6");
  page(["#/routines/r_6/start"]);
  place.landPlace("move");
  world.y = 300;
  push("#/routines/r_6/start");
  page([]);
  place.landPlace("move");
  push("#/routines");
  fire("pagehide");
  const kept = world.store.get("wp.place.a") ?? "";
  assert.doesNotMatch(kept, /r_6/);
  assert.match(kept, /"\/routines"/);
  back();
  page(["#/routines/r_6/start"]);
  place.landPlace("move");
  back();
  page(["#/routines/r_6"]);
  place.landPlace("move");
  assert.equal(world.y, 300);
});

test("one tab used by two partners: what the first one visited is gone once the second one is confirmed", async () => {
  reset("#/routines");
  const kept = places("a");
  const place = await load();
  place.startPlace(kept);
  page(["#/routines/r_6"]);
  world.y = 800;
  push("#/routines/r_6");
  page([]);
  place.landPlace("move");
  push("#/routines/r_6/start");
  fire("pagehide");
  assert.deepEqual([...world.store.keys()], ["wp.place.a"]);
  assert.match(world.store.get("wp.place.a")!, /r_6/);
  kept.purge("b");
  push("#/tasks");
  fire("pagehide");
  assert.deepEqual([...world.store.keys()], ["wp.place.b"]);
  assert.doesNotMatch(world.store.get("wp.place.b")!, /r_6/);
  const second = await load();
  second.startPlace(places("b"));
  assert.doesNotMatch(JSON.stringify([...world.store]), /r_6/);
});

test("a memory read for a side the probe then contradicts is dropped, not carried over", async () => {
  reset("#/");
  const first = await load();
  const mine = places("a");
  first.startPlace(mine);
  page([ROUTINE]);
  world.y = 640;
  push("#/routines/r1");
  fire("pagehide");
  const second = await load();
  const hinted = places("a");
  second.startPlace(hinted);
  hinted.purge("b");
  push("#/books");
  assert.deepEqual([...world.store.keys()], ["wp.place.b"]);
  assert.doesNotMatch(world.store.get("wp.place.b")!, /routines\/r1|"y":640/);
});

test("with no side known nothing is written, and the memory is kept in the page until a side is confirmed", async () => {
  reset("#/");
  const none = places(null);
  const place = await load();
  place.startPlace(none);
  page([ROUTINE]);
  world.y = 640;
  push("#/routines/r1");
  fire("pagehide");
  assert.equal(world.store.size, 0);
  none.purge("a");
  push("#/books");
  assert.match(world.store.get("wp.place.a")!, /"y":640/);
});

test("a target counts as in view only when it has height and overlaps the viewport by at least a pixel", async () => {
  const place = await openThenBack("#/", "#/routines", "#/routines");
  back();
  page([]);
  const flat = new FakeElement("#/flat");
  flat.height = 0;
  const above = new FakeElement("#/above");
  above.top = -20;
  const below = new FakeElement("#/below");
  below.top = 800;
  const reachable = new FakeElement("#/tasks");
  reachable.top = -19;
  world.heading!.top = -20;
  world.tabbable = [flat, above, below, reachable];
  world.focus = null;
  place.landPlace("move");
  assert.equal(world.focus, reachable);
  assert.deepEqual(reachable.options, { preventScroll: true });
  assert.equal(world.heading!.focused, 0);
  assert.equal(above.focused + below.focused, 0);
});

test("a one pixel tall target in view counts as in view", async () => {
  const place = await openThenBack("#/", "#/routines", "#/routines");
  back();
  page([]);
  const thin = new FakeElement("#/thin");
  thin.height = 1;
  world.heading!.top = -900;
  world.tabbable = [thin];
  world.focus = null;
  place.landPlace("move");
  assert.equal(world.focus, thin);
});

test("opening a screen beside its sibling from the sibling that was opened from it lands on the heading", async () => {
  reset("#/books/b1");
  const place = await load();
  place.startPlace(places());
  page(["#/books/b2"]);
  world.y = 400;
  push("#/books/b2");
  page(["#/books/b1"]);
  place.landPlace("move");
  world.y = 200;
  push("#/books/b1");
  page(["#/books/b2"]);
  world.focus = null;
  place.landPlace("move");
  assert.equal(world.focus, world.heading);
});

test("a position two pixels short is still chased", async () => {
  reset("#/");
  const place = await load();
  place.startPlace(places());
  page([ROUTINE]);
  world.y = 1500;
  push("#/routines/r1");
  page([]);
  place.landPlace("move");
  back();
  page([ROUTINE]);
  world.drift = 2;
  place.landPlace("move");
  assert.equal(world.y, 1498);
  assert.ok(world.frames.length > 0);
});

test("a reload waits for details that arrive late even though there is no focus to place", async () => {
  reset("#/");
  const kept = places();
  const first = await load();
  first.startPlace(kept);
  page([ROUTINE], [true, false]);
  world.y = 1700;
  fire("pagehide");
  const second = await load();
  second.startPlace(kept);
  page([ROUTINE], []);
  second.landPlace("first");
  settle(3);
  assert.ok(world.frames.length > 0);
  world.open = [{ open: false }, { open: true }];
  settle();
  assert.deepEqual(
    world.open.map((one) => one.open),
    [true, false],
  );
  assert.equal(world.y, 1700);
});

test("an entry that came from nowhere, or from a tab link, is stored with a null origin so it survives a reload", async () => {
  reset("#/");
  const place = await load();
  place.startPlace(places());
  page(["#/books"]);
  click(new FakeElement("#/books", true));
  push("#/books");
  fire("pagehide");
  const stored = JSON.parse(world.store.get("wp.place.a")!) as { entries: Record<string, { from: unknown; route: string }> };
  assert.deepEqual(
    Object.values(stored.entries).map((entry) => [entry.route, entry.from]),
    [
      ["/", null],
      ["/books", null],
    ],
  );
});

const PRIVATE = "aaaaaaaa-0000-4000-8000-000000000001";
const SHARED = "bbbbbbbb-0000-4000-8000-000000000002";
type Row = { id: string; kind: string; who: string; data: Record<string, unknown> | null };
const mine: Row = { id: PRIVATE, kind: "routine", who: "a", data: { private: true } };
const shared: Row = { id: SHARED, kind: "routine", who: "both", data: null };
const snap = { ready: true, items: [mine, shared] as Row[] };
const rule = (route: string) => hiddenRoute(route, snap.ready, snap.items);
const dump = () => JSON.stringify([...world.store]);
const gone = /aaaaaaaa-/i;

const rig = async (hash: string, ready = true, items: Row[] = [mine, shared], side: "a" | "b" | null = "a") => {
  reset(hash);
  Object.assign(snap, { ready, items });
  const kept = places(side);
  const place = await load();
  place.startPlace(kept, rule, () => snap.ready);
  return { kept, place };
};

const visit = (place: Awaited<ReturnType<typeof load>>, hash: string, y = 0) => {
  page([]);
  world.y = y;
  push(hash);
  place.landPlace("move");
};

test("Partner B on Partner A's private address never writes the id, and Back still works inside the page", async () => {
  const { kept, place } = await rig("#/routines");
  visit(place, `#/routines/${PRIVATE}`, 100);
  visit(place, `#/routines/${PRIVATE}/start`, 200);
  fire("pagehide");
  assert.doesNotMatch(dump(), gone);
  snap.items = [];
  kept.purge("b");
  back();
  back();
  forward();
  visit(place, `#/routines/${PRIVATE}`, 0);
  world.y = 420;
  push("#/tasks");
  fire("pagehide");
  assert.deepEqual([...world.store.keys()], ["wp.place.b"]);
  assert.doesNotMatch(dump(), gone);
  back();
  page([]);
  place.landPlace("move");
  assert.equal(world.y, 420);
});

test("a mismatch tab with empty rows writes no routine id and scrubs one an older build stored", async () => {
  const old = JSON.stringify({
    entries: { k1: { y: 5, open: [], at: Date.now(), route: `/routines/${PRIVATE}`, from: null }, k2: { y: 6, open: [], at: Date.now(), route: "/routines", from: `/routines/${PRIVATE}` } },
    routes: { [`/routines/${PRIVATE}`]: { y: 5, open: [], at: Date.now() } },
  });
  reset("#/routines");
  world.store.set("wp.place.a", old);
  Object.assign(snap, { ready: true, items: [] });
  const place = await load();
  place.startPlace(places("a"), rule, () => snap.ready);
  visit(place, `#/routines/${PRIVATE}`, 50);
  visit(place, `#/routines/${PRIVATE}/start`, 60);
  visit(place, "#/routines", 70);
  fire("pagehide");
  assert.doesNotMatch(dump(), gone);
  assert.match(dump(), /\\"route\\":\\"\/routines\\"/);
});

test("deleting an own private routine does not write its id on the next navigation", async () => {
  const { place } = await rig("#/routines");
  visit(place, `#/routines/${PRIVATE}`, 100);
  assert.doesNotMatch(dump(), gone);
  snap.items = [shared];
  visit(place, "#/routines", 10);
  assert.doesNotMatch(dump(), gone);
  fire("pagehide");
  assert.doesNotMatch(dump(), gone);
});

test("a suffix, query, fragment, upper-case or percent-encoded spelling of a private id is not written for the owner", async () => {
  const { place } = await rig("#/routines");
  for (const tail of [`/routines/${PRIVATE}?x=1`, `/routines/${PRIVATE.toUpperCase()}`, `/routines/${PRIVATE}/start/`, `/routines/${PRIVATE}#top`, `/Routines/${PRIVATE}`, `/routines/${PRIVATE.replace("-", "%2D")}`]) {
    visit(place, `#${tail}`, 30);
    assert.doesNotMatch(dump(), gone, tail);
  }
  fire("pagehide");
  assert.doesNotMatch(dump(), gone);
});

test("while the rows have not loaded a save keeps what was stored and writes nothing, then writes when they are ready", async () => {
  const first = await rig("#/routines");
  visit(first.place, `#/routines/${SHARED}`, 0);
  visit(first.place, `#/routines/${SHARED}/start`, 400);
  visit(first.place, "#/routines", 90);
  fire("pagehide");
  const before = world.store.get("wp.place.a")!;
  assert.match(before, new RegExp(SHARED));
  const second = await load();
  Object.assign(snap, { ready: false, items: [] });
  second.startPlace(places("a"), rule, () => snap.ready);
  assert.equal(world.store.get("wp.place.a"), before);
  visit(second, "#/books", 5);
  fire("pagehide");
  assert.equal(world.store.get("wp.place.a"), before);
  Object.assign(snap, { ready: true, items: [mine, shared] });
  visit(second, "#/tasks", 6);
  const after = JSON.parse(world.store.get("wp.place.a")!) as { entries: Record<string, { route: string }>; routes: Record<string, { y: number }> };
  assert.equal(after.routes[`/routines/${SHARED}`].y, 400);
  assert.ok(Object.values(after.entries).some((entry) => entry.route === `/routines/${SHARED}/start`));
  assert.ok(Object.values(after.entries).some((entry) => entry.route === "/tasks"));
});

test("a routine that becomes private after it was visited is scrubbed from the storage at the next write and still serves Back in the page", async () => {
  const { place } = await rig("#/routines");
  visit(place, `#/routines/${SHARED}`, 0);
  visit(place, "#/routines", 300);
  assert.match(dump(), new RegExp(SHARED));
  snap.items = [mine, { ...shared, who: "a", data: { private: true } }];
  visit(place, "#/books", 20);
  assert.doesNotMatch(dump(), new RegExp(SHARED));
  back();
  back();
  page([]);
  place.landPlace("move");
  assert.equal(world.y, 300);
});

test("a shared routine is stored and restored after a reload", async () => {
  const first = await rig("#/routines");
  visit(first.place, `#/routines/${SHARED}`, 0);
  world.y = 640;
  fire("pagehide");
  assert.match(dump(), new RegExp(SHARED));
  const second = await load();
  second.startPlace(places("a"), rule, () => snap.ready);
  world.y = 0;
  page([]);
  second.landPlace("first");
  assert.equal(world.y, 640);
});

test("an entry whose origin was private is stored with a null origin and one whose origin is shared keeps it", async () => {
  const { place } = await rig("#/routines");
  page([`#/routines/${PRIVATE}`, `#/routines/${SHARED}`]);
  visit(place, `#/routines/${PRIVATE}`, 10);
  visit(place, "#/routines", 0);
  visit(place, `#/routines/${SHARED}`, 10);
  visit(place, "#/routines", 0);
  fire("pagehide");
  const stored = JSON.parse(world.store.get("wp.place.a")!) as { entries: Record<string, { from: string | null; route: string }> };
  const lists = Object.values(stored.entries).filter((entry) => entry.route === "/routines");
  assert.deepEqual(lists.map((entry) => entry.from), [null, null, `/routines/${SHARED}`]);
});

test("after a sign-in switch the tab keeps remembering places on every later navigation", async () => {
  const { kept, place } = await rig("#/books");
  kept.purge("b");
  visit(place, "#/tasks", 120);
  visit(place, "#/money", 50);
  visit(place, "#/people", 70);
  back();
  page([]);
  place.landPlace("move");
  assert.equal(world.y, 70);
  back();
  page([]);
  place.landPlace("move");
  assert.equal(world.y, 50);
});

test("an empty hash is stored as the home route", async () => {
  const { place } = await rig("");
  visit(place, "#/books", 0);
  const stored = JSON.parse(world.store.get("wp.place.a")!) as { entries: Record<string, { route: string }> };
  assert.equal(Object.values(stored.entries)[0].route, "/");
});

const hits = (text: string, id: string) => {
  let plain = text;
  for (let pass = 0; pass < 6; pass++) {
    try {
      plain = decodeURIComponent(plain);
    } catch {
      break;
    }
  }
  return plain.toLowerCase().split(id.toLowerCase()).length - 1;
};

const stored = () => JSON.parse(world.store.get("wp.place.a")!) as { entries: Record<string, Record<string, unknown>>; routes: Record<string, Record<string, unknown>> };

test("a list restore still waiting when the next navigation comes never writes the private routine it was opened from", async () => {
  const { place } = await rig("#/routines");
  visit(place, `#/routines/${PRIVATE}`, 0);
  visit(place, "#/routines", 0);
  visit(place, `#/routines/${SHARED}`, 400);
  page([], [], 0);
  back();
  place.landPlace("move");
  assert.ok(world.frames.length > 0);
  push("#/books");
  assert.equal(hits(dump(), PRIVATE), 0);
  fire("pagehide");
  assert.equal(hits(dump(), PRIVATE), 0);
  assert.doesNotMatch(dump(), gone);
  assert.deepEqual(Object.keys(stored().routes["/routines"]).sort(), ["at", "open", "y"]);
  assert.equal(stored().routes["/routines"].y, 400);
});

test("the same wait in a tab whose partner changed, with no heading to wait for, never writes the private routine", async () => {
  const { place } = await rig("#/routines");
  visit(place, `#/routines/${PRIVATE}`, 0);
  visit(place, "#/routines", 0);
  snap.items = [];
  world.heading = null;
  push("#/tasks");
  place.landPlace("move");
  back();
  place.landPlace("move");
  back();
  place.landPlace("move");
  push("#/books");
  fire("pagehide");
  assert.equal(hits(dump(), PRIVATE), 0);
  assert.deepEqual(Object.keys(stored().routes["/routines"]).sort(), ["at", "open", "y"]);
});

test("a stored memory with extra fields on its routes is rewritten without them at the next write", async () => {
  const old = JSON.stringify({ entries: {}, routes: { "/people": { y: 4, open: [], at: Date.now(), route: "/people", from: `/routines/${PRIVATE}`, note: PRIVATE } } });
  reset("#/routines");
  world.store.set("wp.place.a", old);
  Object.assign(snap, { ready: true, items: [mine, shared] });
  const place = await load();
  place.startPlace(places("a"), rule, () => snap.ready);
  visit(place, "#/books", 5);
  assert.equal(hits(dump(), PRIVATE), 0);
  assert.deepEqual(stored().routes["/people"], { y: 4, open: [], at: stored().routes["/people"].at });
});

const mulberry = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

test("no persisted write ever holds a hidden routine id, over random navigation with unfinished restores and identity flips", async () => {
  const states = { private: [mine, shared], open: [{ ...mine, data: null }, shared], deleted: [shared], empty: [] as Row[] };
  const hashes = ["#/", "#/routines", "#/books", "#/tasks", "#/books/x", `#/routines/${SHARED}`, `#/routines/${SHARED}/start`, `#/routines/${PRIVATE}`, `#/routines/${PRIVATE}/start`, `#/routines/${PRIVATE.toUpperCase()}`, `#/routines/${PRIVATE}?x=1`];
  for (let seed = 1; seed <= 2000; seed++) {
    const random = mulberry(seed);
    const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)];
    reset("#/routines");
    let state: keyof typeof states = "private";
    let me: "a" | "b" = "a";
    const log: string[] = [];
    const leaks: string[] = [];
    const check = (key: string, value: string) => {
      const forbidden = [...(state === "open" ? [] : [PRIVATE]), ...(state === "empty" ? [SHARED] : [])];
      for (const id of forbidden) if (hits(value, id) > 0) leaks.push(`seed ${seed} ${key} ${state}: ${log.join(" ")}`);
    };
    const checked: Held = { ...held(), setItem: (key, value) => (world.store.set(key, value), check(key, value)) };
    Object.assign(snap, { ready: true, items: states[state] });
    const kept = placeStore(checked, () => me);
    const place = await load();
    place.startPlace(kept, rule, () => snap.ready);
    for (let step = 0; step < 40; step++) {
      const move = pick(["push", "push", "push", "back", "back", "forward", "replace", "settle", "short", "late", "rows", "rows", "flip", "pagehide"]);
      log.push(move);
      if (move === "push") {
        const hash = pick(hashes);
        log.push(hash);
        page([], [], random() < 0.4 ? 0 : 3000);
        world.y = Math.floor(random() * 900);
        push(hash);
        place.landPlace("move");
      } else if (move === "back" && world.at > 0) {
        back();
        place.landPlace("move");
      } else if (move === "forward" && world.at < world.entries.length - 1) {
        forward();
        place.landPlace("move");
      } else if (move === "replace") {
        replace(pick(hashes));
        place.landPlace("move");
      } else if (move === "settle") settle(Math.floor(random() * 5));
      else if (move === "short") Object.assign(world, { max: 0 });
      else if (move === "late") world.heading = random() < 0.5 ? null : new FakeElement();
      else if (move === "rows") {
        state = pick(me === "a" ? (["private", "open", "deleted", "empty"] as const) : (["empty", "deleted"] as const));
        snap.items = states[state];
        log.push(state);
      } else if (move === "flip") {
        me = me === "a" ? "b" : "a";
        state = me === "a" ? "private" : "empty";
        snap.items = states[state];
        log.push(me);
        kept.purge(me);
      } else if (move === "pagehide") fire("pagehide");
    }
    fire("pagehide");
    assert.deepEqual(leaks, []);
  }
});
