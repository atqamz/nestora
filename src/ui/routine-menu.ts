import type { MenuItem } from "../domain/menu.ts";
import { text } from "./text.ts";

const copy = text.routines;

type Handlers = { away: boolean; open: (sheet: "copy" | "pause") => void; resume: () => void; remove: () => void; resetCounts?: () => void };

export const routineMenu = ({ away, open, resume, remove, resetCounts }: Handlers): MenuItem[] => [
  { id: "duplicate", label: copy.duplicate, run: () => open("copy") },
  away ? { id: "pause", label: copy.resume, run: resume } : { id: "pause", label: copy.pause, run: () => open("pause") },
  ...(resetCounts === undefined ? [] : [{ id: "reset", label: copy.resetCounts, run: resetCounts }]),
  { id: "delete", label: text.delete, danger: true, run: remove },
];
