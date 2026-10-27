import { overlay } from "../ui/overlay.ts";
import { text } from "../ui/text.ts";
import { useSnapshot } from "./use-store.ts";

export const useWriteLock = () => {
  const locked = useSnapshot().paused;
  const hold = () => overlay.announce(text.paused);
  return { locked, hold, guard: (run: () => void) => (locked ? hold : run) };
};
