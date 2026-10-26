import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

class FakeElement {
  focused = 0;
  options: unknown;
  href: string | null;
  tab: boolean;
  constructor(href: string | null = null, tab = false) {
    this.href = href;
    this.tab = tab;
  }
  getAttribute(name: string) {
    return name === "href" ? this.href : null;
  }
  closest() {
    return this;
  }
  matches() {
    return this.tab;
  }
  focus(options?: unknown) {
    this.options = options;
    this.focused++;
    world.focus = this;
  }
}

type Entry = { hash: string; state: unknown };
type Listener = (event?: { target?: unknown }) => void;

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
};

const on = (type: string, listener: Listener) => world.listeners.set(type, [...(world.listeners.get(type) ?? []), listener]);
const fire = (type: string, event?: { target?: unknown }) => world.listeners.get(type)?.forEach((listener) => listener(event));
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
    querySelectorAll: (selector: string) => (selector === "main details" ? world.open : selector === "main a" ? world.links : []),
    querySelector: (selector: string) => (selector === "h1" ? world.heading : null),
  },
  history: {
    scrollRestoration: "auto",
    get state() {
      return world.entries[world.at].state;
    },
    replaceState: (state: unknown) => {
      world.entries[world.at].state = state;
    },
  },
  location: {
    get hash() {
      return world.entries[world.at].hash;
    },
  },
});
Object.defineProperty(globalThis, "scrollY", { configurable: true, get: () => world.y });

const storage = () => ({
  getItem: (key: string) => world.store.get(key) ?? null,
  setItem: (key: string, value: string) => void world.store.set(key, value),
});

let loads = 0;
const load = async () => {
  world.listeners.clear();
  return (await import(new URL(`../src/ui/place.ts?${loads++}`, import.meta.url).href)) as { startPlace: (kept: ReturnType<typeof storage> | null) => void; landPlace: (how: "first" | "move" | "beside") => void };
};

const reset = (hash: string) => {
  Object.assign(world, { entries: [{ hash, state: null }], at: 0, y: 0, max: 3000, open: [], links: [], heading: new FakeElement(), focus: null, frames: [], scrolls: 0, behaviors: new Set<string>(), drift: 0, across: 0, options: new Map<string, unknown>() });
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
const click = (link: FakeElement) => fire("document:click", { target: link });

const ROUTINE = "#/routines/r1";

test("startPlace takes over scroll restoration from the browser", async () => {
  reset("#/");
  const place = await load();
  place.startPlace(storage());
  assert.equal(history.scrollRestoration, "manual");
});

test("Back restores the scroll position and the open state, and focuses the link that was opened", async () => {
  reset("#/");
  const place = await load();
  place.startPlace(storage());
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
  place.startPlace(storage());
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
  place.startPlace(storage());
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
  place.startPlace(storage());
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
  place.startPlace(storage());
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
  place.startPlace(storage());
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
  place.startPlace(storage());
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
  place.startPlace(storage());
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
  place.startPlace(storage());
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
  const kept = storage();
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
  place.startPlace(storage());
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
  place.startPlace(storage());
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
    place.startPlace(storage());
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
  place.startPlace(storage());
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
  place.startPlace(storage());
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
  place.startPlace({
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  });
  page([ROUTINE]);
  push("#/routines/r1");
  fire("pagehide");
  place.startPlace(null);
});

test("main hands every route change to the place module and keeps the split-view branches", () => {
  const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  assert.match(main, /startPlace\(tabStorage\);/);
  assert.match(main, /useLayoutEffect\(\(\) => \{\s*const now = document\.querySelector\("\.split"\);/);
  assert.match(main, /const how = first\.current \? "first" : selecting \|\| closing \? "beside" : "move";/);
  assert.match(main, /first\.current = false;\s*landPlace\(how\);\s*if \(closing\) \(row \?\? document\.querySelector<HTMLElement>\("h1"\)\)\?\.focus\(\{ preventScroll: !row \}\)/);
  assert.doesNotMatch(main, /scrollTo\(/);
  assert.match(readFileSync(new URL("../src/store/browser.ts", import.meta.url), "utf8"), /export const tabStorage = /);
});

test("an entry on the same screen under another spelling of the address gets its own place", async () => {
  reset("");
  const place = await load();
  place.startPlace(storage());
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
  place.startPlace(storage());
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
  place.startPlace(storage());
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
  place.startPlace(storage());
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
  place.startPlace(storage());
  assert.equal(world.store.size, 1);
  page([ROUTINE]);
  world.y = 640;
  push("#/routines/r1");
  assert.match(world.store.get("nestora.place") ?? "", /"y":640/);
});

test("a position that lands one pixel short counts as reached, so the restore does not keep fighting the browser", async () => {
  reset("#/");
  const place = await load();
  place.startPlace(storage());
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
