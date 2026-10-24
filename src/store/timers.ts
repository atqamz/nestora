import type { Side } from "../../shared/api.ts";
import { PREFIX, keyOf, parse, phase, timerKey } from "../domain/routine-timer.ts";
import type { Timer } from "../domain/routine-timer.ts";

export type Held = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

type Found = NonNullable<ReturnType<typeof keyOf>>;

export const timerStore = (storage: Held | null, now: () => number = Date.now) => {
  const guard = <T>(fallback: T, run: (held: Held) => T): T => {
    try {
      return storage === null ? fallback : run(storage);
    } catch {
      return fallback;
    }
  };

  const idle = (held: Held, key: string) => phase(parse(held.getItem(key)), now()).name === "idle";

  const sweep = (drop: (found: Found) => boolean) =>
    guard(undefined, (held) => {
      const keys = Array.from({ length: held.length }, (_, at) => held.key(at)).filter((key): key is string => key?.startsWith(PREFIX) === true);
      for (const key of keys) {
        const found = keyOf(key);
        if (found === null || drop(found) || idle(held, key)) held.removeItem(key);
      }
    });

  const read = (side: Side, routine: string, action: string) =>
    guard<Timer | null>(null, (held) => {
      const key = timerKey(side, routine, action);
      const timer = parse(held.getItem(key));
      if (phase(timer, now()).name !== "idle") return timer;
      held.removeItem(key);
      return null;
    });

  const write = (side: Side, routine: string, action: string, timer: Timer | null) =>
    guard(undefined, (held) => {
      const key = timerKey(side, routine, action);
      if (timer === null) held.removeItem(key);
      else held.setItem(key, JSON.stringify(timer));
    });

  const running = (side: Side, routine: string) => {
    sweep(() => false);
    return guard<string[]>([], (held) =>
      Array.from({ length: held.length }, (_, at) => keyOf(held.key(at) ?? ""))
        .filter((found): found is Found => found !== null && found.side === side && found.routine === routine)
        .map((found) => found.action),
    );
  };

  const keep = (side: Side, routine: string, action: string | null) => sweep((found) => found.side === side && found.routine === routine && found.action !== action);

  const purge = (side: Side) => sweep((found) => found.side !== side);

  return { read, write, running, keep, purge };
};
