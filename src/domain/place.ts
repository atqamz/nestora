export type Place = { y: number; open: boolean[] };
export type Entry = Place & { route: string; from: string | null };
export type Memory = { entries: Record<string, Entry>; routes: Record<string, Place> };
export type Here = { key: string; route: string };

const KEPT = 80;

export const empty = (): Memory => ({ entries: {}, routes: {} });

const put = <T>(map: Record<string, T>, key: string, value: T): Record<string, T> => {
  const { [key]: _, ...rest } = map;
  return Object.fromEntries(Object.entries({ ...rest, [key]: value }).slice(-KEPT));
};

export const leave = (memory: Memory, here: Here, place: Place): Memory => ({
  entries: put(memory.entries, here.key, { ...place, route: here.route, from: memory.entries[here.key]?.from ?? null }),
  routes: put(memory.routes, here.route, place),
});

export const enter = (memory: Memory, here: Here, from: string | null): Memory => ({
  ...memory,
  entries: put(memory.entries, here.key, { y: 0, open: [], route: here.route, from }),
});

export const replay = (memory: Memory, key: string | null, route: string): Place | null => {
  const entry = key === null ? undefined : memory.entries[key];
  return entry?.route === route ? entry : null;
};

export const returning = (memory: Memory, from: Here, route: string, tab: boolean): Place | null =>
  tab || memory.entries[from.key]?.from === route ? (memory.routes[route] ?? null) : null;

const isPlace = (value: unknown): value is Place =>
  typeof value === "object" &&
  value !== null &&
  "y" in value &&
  typeof value.y === "number" &&
  value.y >= 0 &&
  "open" in value &&
  Array.isArray(value.open) &&
  value.open.every((flag) => typeof flag === "boolean");

const isEntry = (value: unknown): value is Entry =>
  isPlace(value) && "route" in value && typeof value.route === "string" && "from" in value && (value.from === null || typeof value.from === "string");

const only = <T>(value: unknown, valid: (item: unknown) => item is T): Record<string, T> =>
  typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value).filter((pair): pair is [string, T] => valid(pair[1])).slice(-KEPT)) : {};

export const parse = (raw: string | null): Memory => {
  try {
    const found: unknown = raw === null ? null : JSON.parse(raw);
    return typeof found === "object" && found !== null && "entries" in found && "routes" in found ? { entries: only(found.entries, isEntry), routes: only(found.routes, isPlace) } : empty();
  } catch {
    return empty();
  }
};
