import { routineDay, routineMinutes } from "../../shared/routines.ts";

export const MINUTE_MS = 60_000;

export const REFRESH_MS = MINUTE_MS;

export const minuteOf = (now: Date) => Math.floor(now.getTime() / MINUTE_MS);

export const clockAt = (minute: number) => {
  const now = new Date(minute * MINUTE_MS);
  return { day: routineDay(now), elapsed: routineMinutes(now) };
};

export const watch = (refresh: () => void) => {
  document.addEventListener("visibilitychange", refresh);
  const timer = setInterval(refresh, REFRESH_MS);
  return () => {
    document.removeEventListener("visibilitychange", refresh);
    clearInterval(timer);
  };
};
