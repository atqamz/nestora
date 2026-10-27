import { overlay } from "../ui/overlay.ts";
import { text } from "../ui/text.ts";
import { useSnapshot } from "./use-store.ts";

const lowOnScreen = () => {
  const at = document.activeElement;
  if (!at || at === document.body) return undefined;
  const box = at.getBoundingClientRect();
  return box.top + box.height / 2 > innerHeight * 0.4 || undefined;
};

export const useWriteLock = () => {
  const locked = useSnapshot().paused;
  const hold = () => {
    const top = lowOnScreen();
    const shown = overlay.getSnapshot().toast;
    if (shown?.message !== text.pausedTap || shown.top !== top) overlay.announce(text.pausedTap, undefined, top);
  };
  return { locked, hold, guard: (run: () => void) => (locked ? hold : run) };
};
