import type { MenuItem } from "../domain/menu.ts";
import { text } from "./text.ts";

const copy = text.routines;

type Handlers = { away: boolean; open: (sheet: "copy" | "pause") => void; resume: () => void; remove: () => void };

export const routineMenu = ({ away, open, resume, remove }: Handlers): MenuItem[] => [
  { label: copy.duplicate, run: () => open("copy") },
  away ? { label: copy.resume, run: resume } : { label: copy.pause, run: () => open("pause") },
  { label: text.delete, danger: true, run: remove },
];
