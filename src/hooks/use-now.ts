import { useEffect, useState } from "react";

const TICK_MS = 1000;

export const useNow = (active: boolean) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const refresh = () => setNow(Date.now());
    refresh();
    const timer = setInterval(refresh, TICK_MS);
    document.addEventListener("visibilitychange", refresh);
    addEventListener("pageshow", refresh);
    addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      removeEventListener("pageshow", refresh);
      removeEventListener("focus", refresh);
    };
  }, [active]);
  return now;
};
