export const DAY = 86_400_000;

export const BOUND = 400 * DAY;

export type Clock = { skew: number | null; last: number | null; held: number | null };

export const unknown: Clock = { skew: null, last: null, held: null };

export const newestStamp = (rows: Iterable<Record<string, unknown>>): number | null => {
  let newest: number | null = null;
  for (const { data } of rows) {
    const day = typeof data === "object" && data !== null ? (data as { tmdb_at?: unknown }).tmdb_at : undefined;
    const stamp = typeof day === "string" ? Date.parse(day) : NaN;
    if (!Number.isNaN(stamp) && (newest === null || stamp > newest)) newest = stamp;
  }
  return newest;
};

export const learned = (clock: Clock, served: number | null, device: number, newest: () => number | null): Clock => {
  if (served === null) return clock;
  const skew = served - device;
  if (Math.abs(skew) >= BOUND) return clock;
  if (clock.last !== null && served < clock.last - DAY) return clock;
  const agrees = Math.abs(skew) <= DAY;
  const confirmed = clock.held !== null && Math.abs(skew - clock.held) <= DAY && (newest() ?? -Infinity) <= served + DAY;
  return agrees || confirmed ? { skew, last: served, held: null } : { ...clock, held: skew };
};
