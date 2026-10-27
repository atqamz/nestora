import type { MenuItem } from "../domain/menu.ts";
import { text } from "./text.ts";

const copy = text.routines;

type Handlers = { away: boolean; open: (sheet: "copy" | "pause") => void; resume: () => void; remove: () => void; resetCounts?: () => void; locked?: boolean };

export const routineMenu = ({ away, open, resume, remove, resetCounts, locked }: Handlers): MenuItem[] => [
  { id: "duplicate", icon: "copy", label: copy.duplicate, run: () => open("copy") },
  away ? { id: "pause", icon: "resume", label: copy.resume, run: resume } : { id: "pause", icon: "pause", label: copy.pause, run: () => open("pause") },
  ...(resetCounts === undefined ? [] : [{ id: "reset", icon: "reset" as const, label: copy.resetCounts, locked, run: resetCounts }]),
  { id: "delete", icon: "trash", label: text.delete, danger: true, run: remove },
];
