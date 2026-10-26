import type { Side } from "../../shared/api.ts";
import { empty, parse } from "../domain/place.ts";
import type { Memory } from "../domain/place.ts";
import type { Held } from "./timers.ts";

const PREFIX = "wp.place";

const keyOf = (side: Side) => `${PREFIX}.${side}`;

export const placeStore = (storage: Held | null, first: () => Side | null, now: () => number = Date.now) => {
  let side = first();

  const guard = <T>(fallback: T, run: (held: Held) => T): T => {
    try {
      return storage === null ? fallback : run(storage);
    } catch {
      return fallback;
    }
  };

  const load = () => guard(empty(), (held) => (side === null ? empty() : parse(held.getItem(keyOf(side)), now())));

  const save = (memory: Memory) =>
    guard(undefined, (held) => {
      if (side !== null) held.setItem(keyOf(side), JSON.stringify(memory));
    });

  const purge = (me: Side) => {
    side = me;
    guard(undefined, (held) => {
      const keys = Array.from({ length: held.length }, (_, at) => held.key(at)).filter((key): key is string => key === PREFIX || key?.startsWith(`${PREFIX}.`) === true);
      for (const key of keys) {
        const memory = key === keyOf(me) ? parse(held.getItem(key), now()) : null;
        if (memory !== null && (Object.keys(memory.entries).length > 0 || Object.keys(memory.routes).length > 0)) held.setItem(key, JSON.stringify(memory));
        else held.removeItem(key);
      }
    });
  };

  return { load, save, purge, side: () => side };
};

export type Places = ReturnType<typeof placeStore>;
