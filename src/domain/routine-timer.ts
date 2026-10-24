export type Timer = { end: number; ms: number };

export type Phase = { name: "idle" } | { name: "running"; left: number; ms: number } | { name: "ended"; ago: number };

export const ADD_MS = 60_000;

export const STALE_MS = 3_600_000;

export const FRESH_MS = 120_000;

const MINUTE = 60_000;

export const timerKey = (routine: string, action: string) => `wp.timer.${routine}.${action}`;

export const begin = (minutes: number, now: number): Timer => ({ end: now + minutes * MINUTE, ms: minutes * MINUTE });

export const extend = (timer: Timer, now: number): Timer => {
  const end = Math.max(timer.end, now) + ADD_MS;
  return { end, ms: timer.ms + (end - timer.end) };
};

export const phase = (timer: Timer | null, now: number): Phase => {
  if (timer === null || now - timer.end > STALE_MS) return { name: "idle" };
  return now < timer.end ? { name: "running", left: Math.min(timer.end - now, timer.ms), ms: timer.ms } : { name: "ended", ago: now - timer.end };
};

export const parse = (raw: string | null): Timer | null => {
  try {
    const value = raw === null ? null : JSON.parse(raw);
    return typeof value?.end === "number" && typeof value.ms === "number" && Number.isFinite(value.end) && value.ms > 0 && Number.isFinite(value.ms) ? { end: value.end, ms: value.ms } : null;
  } catch {
    return null;
  }
};

export const clock = (left: number) => {
  const seconds = Math.ceil(left / 1000);
  const hours = Math.floor(seconds / 3600);
  const rest = String(Math.floor(seconds / 60) % 60).padStart(2, "0");
  const second = String(seconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${rest}:${second}` : `${Math.floor(seconds / 60)}:${second}`;
};

export const share = (running: Extract<Phase, { name: "running" }>) => 1 - running.left / running.ms;
