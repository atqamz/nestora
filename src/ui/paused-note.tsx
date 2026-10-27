import { useWriteLock } from "../hooks/use-write-lock.ts";
import { text } from "./text.ts";

export const PAUSED_NOTE = "paused-note";

export const lockedProps = (locked: boolean) => (locked ? { "aria-disabled": true, "aria-describedby": PAUSED_NOTE } : {});

export function PausedNote() {
  const { locked } = useWriteLock();
  return locked ? (
    <p className="hint paused-note" id={PAUSED_NOTE} role="status">
      {text.paused}
    </p>
  ) : null;
}
