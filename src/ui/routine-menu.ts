import type { MenuItem } from "../domain/menu.ts";
import { text } from "./text.ts";

const copy = text.routines;

type Handlers = { away: boolean; open: (sheet: "copy" | "pause") => void; resume: () => void; remove: () => void };

export const routineMenu = ({ away, open, resume, remove }: Handlers): MenuItem[] => [
  { id: "duplicate", icon: "copy", label: copy.duplicate, run: () => open("copy") },
  away ? { id: "pause", icon: "play", label: copy.resume, run: resume } : { id: "pause", icon: "pause", label: copy.pause, run: () => open("pause") },
  { id: "delete", icon: "trash", label: text.delete, danger: true, run: remove },
];
