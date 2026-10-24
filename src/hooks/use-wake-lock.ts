import { useEffect, useRef, useState } from "react";
import { keepAwake } from "../domain/wake-lock.ts";
import type { WakeApi, WakeState } from "../domain/wake-lock.ts";

export const useWakeLock = () => {
  const [state, setState] = useState<WakeState>("idle");
  const lock = useRef<ReturnType<typeof keepAwake> | null>(null);
  useEffect(() => {
    const held = keepAwake((navigator as { wakeLock?: WakeApi }).wakeLock, setState);
    const visible = () => document.visibilityState === "visible" && void held.acquire();
    const leave = () => void held.release();
    lock.current = held;
    void held.acquire();
    document.addEventListener("visibilitychange", visible);
    addEventListener("pagehide", leave);
    return () => {
      document.removeEventListener("visibilitychange", visible);
      removeEventListener("pagehide", leave);
      lock.current = null;
      leave();
    };
  }, []);
  return { state, again: () => void lock.current?.acquire() };
};
