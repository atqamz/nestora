import { empty, enter, leave, parse, replay, returning } from "../domain/place.ts";
import type { Here, Memory, Place } from "../domain/place.ts";

const STORE = "nestora.place";
const TABS = ".tabs a, .rail a, .brand, .pair";
const GIVE_UP = 60;
const STOPS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

type Landing = { place: Place; from: string | null };

let memory: Memory = empty();
let here: Here = { key: "", route: "" };
let tab: string | null = null;
let landing: Landing | null = null;
let settling: AbortController | null = null;
let landed = "";
let storage: Pick<Storage, "getItem" | "setItem"> | null = null;

const route = () => location.hash.slice(1) || "/";
const stamp = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const keyOf = (): string | null => (typeof history.state?.place === "string" ? history.state.place : null);
const details = () => Array.from(document.querySelectorAll<HTMLDetailsElement>("main details"));
const read = (): Place => ({ y: scrollY, open: details().map((one) => one.open) });

const save = () => {
  try {
    storage?.setItem(STORE, JSON.stringify(memory));
  } catch {
    return;
  }
};

const arrive = (to: string, from: Here | null) => {
  const key = keyOf();
  const back = replay(memory, key, to);
  const id = back === null ? stamp() : key!;
  const place = back ?? (from === null ? null : returning(memory, from, to, tab === `#${to}`));
  if (back === null) {
    history.replaceState({ ...history.state, place: id }, "");
    memory = enter(memory, { key: id, route: to }, from?.route ?? null);
  }
  landing = place === null ? null : { place, from: from?.route ?? null };
  here = { key: id, route: to };
  tab = null;
  save();
};

export const startPlace = (kept: typeof storage) => {
  history.scrollRestoration = "manual";
  storage = kept;
  try {
    memory = parse(storage?.getItem(STORE) ?? null);
  } catch {
    memory = empty();
  }
  arrive(route(), null);
  addEventListener("hashchange", () => {
    settling?.abort();
    memory = leave(memory, here, read());
    arrive(route(), here);
  });
  addEventListener("pagehide", () => {
    memory = leave(memory, here, read());
    save();
  });
  document.addEventListener(
    "click",
    (event) => {
      const link = event.target instanceof Element ? event.target.closest("a") : null;
      if (link?.matches(TABS)) tab = link.getAttribute("href");
    },
    true,
  );
};

const restore = ({ place, from }: Landing, focus: boolean) => {
  const stop = new AbortController();
  settling = stop;
  for (const type of STOPS) addEventListener(type, () => stop.abort(), { once: true, passive: true, signal: stop.signal });
  let reopened = place.open.length === 0 && details().length === 0;
  let focused = !focus;
  let frames = 0;
  const step = () => {
    if (stop.signal.aborted) return;
    const open = details();
    if (!reopened && (open.length > 0 || frames === GIVE_UP)) {
      if (open.length === place.open.length) open.forEach((one, index) => (one.open = place.open[index]));
      reopened = true;
    }
    const heading = document.querySelector<HTMLElement>("h1");
    if (!focused && heading) {
      const row = Array.from(document.querySelectorAll<HTMLAnchorElement>("main a")).find((link) => link.getAttribute("href") === `#${from}`);
      (row ?? heading).focus({ preventScroll: true });
      focused = true;
    }
    scrollTo({ top: place.y, behavior: "instant" });
    if ((Math.abs(scrollY - place.y) <= 1 && reopened && focused) || ++frames > GIVE_UP) stop.abort();
    else requestAnimationFrame(step);
  };
  step();
};

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
