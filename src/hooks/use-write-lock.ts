import { useSnapshot } from "./use-store.ts";

export const PAUSED_NOTICE = "paused-notice";

const focusNotice = () => document.getElementById(PAUSED_NOTICE)?.focus();

export const useWriteLock = () => {
  const locked = useSnapshot().paused;
  return { locked, guard: (run: () => void) => (locked ? focusNotice : run) };
};
