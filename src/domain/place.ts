import { flagged } from "../../shared/routines.ts";

export type Place = { y: number; open: boolean[] };
export type Stamped = Place & { at: number };
export type Entry = Stamped & { route: string; from: string | null };
export type Memory = { entries: Record<string, Entry>; routes: Record<string, Stamped> };
export type Here = { key: string; route: string };

const KEPT = 80;

export const STALE_MS = 86_400_000;

export const empty = (): Memory => ({ entries: {}, routes: {} });

const put = <T>(map: Record<string, T>, key: string, value: T): Record<string, T> => {
  const { [key]: _, ...rest } = map;
  return Object.fromEntries(Object.entries({ ...rest, [key]: value }).slice(-KEPT));
};

export const leave = (memory: Memory, here: Here, place: Place, now: number): Memory => ({
  entries: put(memory.entries, here.key, { ...place, at: now, route: here.route, from: memory.entries[here.key]?.from ?? null }),
  routes: put(memory.routes, here.route, { ...place, at: now }),
});

export const enter = (memory: Memory, here: Here, from: string | null, now: number): Memory => ({
  ...memory,
  entries: put(memory.entries, here.key, { y: 0, open: [], at: now, route: here.route, from }),
});

const decoded = (route: string) => {
  try {
    let text = route;
    for (let pass = 0; pass < 4; pass++) {
      const next = decodeURIComponent(text);
      if (next === text) return text;
      text = next;
    }
  } catch {
    return null;
  }
  return null;
};

export const hiddenRoute = (route: string, ready: boolean, items: readonly (Record<string, unknown> & { id: string })[]) => {
  const text = decoded(route);
  if (text === null) return true;
  const [section, id] = text.split(/[?#]/)[0].toLowerCase().split("/").filter(Boolean);
  if (section !== "routines" || id === undefined) return false;
  const rows = items.filter((row) => row.id.toLowerCase() === id);
  return !(ready && rows.length > 0 && rows.every((row) => row.kind === "routine" && !flagged(row)));
};

export const depth = (route: string) => route.split("/").filter(Boolean).length;

export const scrub = (memory: Memory, hidden: (route: string) => boolean): Memory => ({
  entries: Object.fromEntries(
    Object.entries(memory.entries)
      .filter(([, entry]) => !hidden(entry.route))
      .map(([key, entry]) => [key, entry.from !== null && hidden(entry.from) ? { ...entry, from: null } : entry]),
  ),
  routes: Object.fromEntries(Object.entries(memory.routes).filter(([route]) => !hidden(route))),
});

export const replay = (memory: Memory, key: string | null, route: string): Place | null => {
  const entry = key === null ? undefined : memory.entries[key];
  return entry?.route === route ? entry : null;
};

export const returning = (memory: Memory, from: Here, route: string, tab: boolean): Place | null =>
  tab || memory.entries[from.key]?.from === route ? (memory.routes[route] ?? null) : null;

const isPlace = (value: unknown): value is Stamped =>
  typeof value === "object" &&
  value !== null &&
  "y" in value &&
  typeof value.y === "number" &&
  value.y >= 0 &&
  "open" in value &&
  Array.isArray(value.open) &&
  value.open.every((flag) => typeof flag === "boolean") &&
  "at" in value &&
  typeof value.at === "number";

const isEntry = (value: unknown): value is Entry =>
  isPlace(value) && "route" in value && typeof value.route === "string" && "from" in value && (value.from === null || typeof value.from === "string");

const only = <T extends Stamped>(value: unknown, valid: (item: unknown) => item is T, now: number): Record<string, T> =>
  typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value).filter((pair): pair is [string, T] => valid(pair[1]) && now - pair[1].at <= STALE_MS).slice(-KEPT)) : {};

export const parse = (raw: string | null, now: number): Memory => {
  try {
    const found: unknown = raw === null ? null : JSON.parse(raw);
    return typeof found === "object" && found !== null && "entries" in found && "routes" in found ? { entries: only(found.entries, isEntry, now), routes: only(found.routes, isPlace, now) } : empty();
  } catch {
    return empty();
  }
};
