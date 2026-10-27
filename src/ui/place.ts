import { depth, empty, enter, leave, replay, returning } from "../domain/place.ts";
import type { Here, Memory, Place } from "../domain/place.ts";
import type { Side } from "../../shared/api.ts";
import type { Places } from "../store/places.ts";

const TABS = ".tabs a, .rail a, .brand, .pair";
const SHUT = "details:not([open])";
const TABBABLE = "main a[href], main button, main summary";
const GIVE_UP_MS = 1000;
const WAIT_MS = 10_000;
const STOPS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

type Landing = { place: Place; from: string | null; row: boolean; tab: boolean };

let memory: Memory = empty();
let here: Here = { key: "", route: "" };
let tab: string | null = null;
let landing: Landing | null = null;
let settling: AbortController | null = null;
let landed = "";
let places: Places | null = null;
let owner: Side | null = null;
let hidden: (text: string) => boolean;
let ready: () => boolean;

const route = () => location.hash.slice(1) || "/";
const stamp = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const keyOf = (): string | null => (typeof history.state?.place === "string" ? history.state.place : null);
const details = () => Array.from(document.querySelectorAll<HTMLDetailsElement>("main details"));
const read = (): Place => ({ y: scrollY, open: details().map((one) => one.open) });
const seen = (one: Element) => {
  const box = one.getBoundingClientRect();
  return box.height > 0 && box.bottom > 0 && box.top < innerHeight;
};

const mark = (id: string) => {
  try {
    history.replaceState({ ...history.state, place: id }, "");
  } catch {
    return;
  }
};

const own = () => {
  const side = places?.side() ?? null;
  if (side === owner) return false;
  const switched = owner !== null;
  if (switched) memory = empty();
  owner = side;
  return switched;
};

const save = () => {
  own();
  if (ready()) places?.save(memory, hidden);
};

const arrive = (to: string, from: Here | null) => {
  own();
  const key = keyOf();
  const back = replay(memory, key, to);
  const id = back === null ? stamp() : key!;
  const byTab = tab === `#${to}`;
  const place = back ?? (from === null ? null : returning(memory, from, to, byTab));
  const row = from !== null && !byTab && memory.entries[from.key]?.from === to && depth(from.route) > depth(to);
  if (back === null) {
    mark(id);
    memory = enter(memory, { key: id, route: to }, byTab ? null : (from?.route ?? null), Date.now());
  }
  landing = place === null ? null : { place, from: from?.route ?? null, row, tab: byTab };
  here = { key: id, route: to };
  tab = null;
  save();
};

const leaving = () => {
  const pending = settling !== null && !settling.signal.aborted && landing !== null;
  memory = leave(memory, here, pending ? landing!.place : read(), Date.now());
};

export const startPlace = (kept: Places, hide: (text: string) => boolean, rowsReady: () => boolean) => {
  history.scrollRestoration = "manual";
  places = kept;
  hidden = hide;
  ready = rowsReady;
  owner = kept.side();
  memory = kept.load();
  arrive(route(), null);
  addEventListener("hashchange", () => {
    const switched = own();
    if (!switched) leaving();
    settling?.abort();
    arrive(route(), switched ? null : here);
  });
  addEventListener("pagehide", () => {
    if (!own()) leaving();
    save();
  });
  document.addEventListener(
    "click",
    (event) => {
      if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest("a") : null;
      if (link?.matches(TABS)) tab = link.getAttribute("href");
    },
    true,
  );
};

const aim = ({ from, row, tab: byTab }: Landing, heading: HTMLElement | null) => {
  const marked = row ? Array.from(document.querySelectorAll<HTMLElement>("main a, main [data-opens], main [data-replaces]")) : [];
  const link = marked.find((one) => (one.getAttribute("href") ?? one.getAttribute("data-opens")) === `#${from}`) ?? marked.find((one) => one.getAttribute("data-replaces") === `#${from}`);
  let shut: Element | null = link?.closest(SHUT) ?? null;
  for (let outer = shut; outer !== null; outer = outer.parentElement?.closest(SHUT) ?? null) shut = outer;
  for (const target of [link, shut?.querySelector<HTMLElement>("summary"), heading]) {
    if (!target) continue;
    const shown = seen(target);
    if (!shown && !(target === link && (link.hasAttribute("data-opens") || link.hasAttribute("data-replaces")))) continue;
    target.focus({ preventScroll: shown || (target === link && link.hasAttribute("data-replaces")) });
    if (document.activeElement === target) return;
  }
  if (!byTab) Array.from(document.querySelectorAll<HTMLElement>(TABBABLE)).find(seen)?.focus({ preventScroll: true });
};

const restore = (there: Landing, focus: boolean) => {
  const { place } = there;
  const stop = new AbortController();
  settling = stop;
  for (const type of STOPS) addEventListener(type, () => stop.abort(), { once: true, passive: true, signal: stop.signal });
  const began = Date.now();
  let shown: number | null = null;
  let reopened = place.open.length === 0 && details().length === 0;
  let focused = !focus;
  const step = () => {
    if (stop.signal.aborted) return;
    const heading = document.querySelector<HTMLElement>("h1");
    const now = Date.now();
    if (shown === null && heading) shown = now;
    const late = shown === null ? now - began >= WAIT_MS : now - shown >= GIVE_UP_MS;
    const open = details();
    if (!reopened && (open.length > 0 || late)) {
      if (open.length === place.open.length) open.forEach((one, index) => (one.open = place.open[index]));
      reopened = true;
    }
    scrollTo({ top: place.y, behavior: "instant" });
    const reached = Math.abs(scrollY - place.y) <= 1;
    if (!focused && reopened && (reached || late) && (heading || late)) {
      aim(there, heading);
      focused = true;
    }
    if ((reached && reopened && focused) || late) stop.abort();
    else requestAnimationFrame(step);
  };
  step();
};

export const cameFrom = () => memory.entries[here.key]?.from ?? null;

export const landPlace = (how: "first" | "move" | "beside") => {
  if (landed === here.key) return;
  landed = here.key;
  const there = landing;
  if (there !== null) restore(there, how === "move");
  else if (how === "move") {
    document.querySelector<HTMLElement>("h1")?.focus();
    scrollTo(0, 0);
  }
};
