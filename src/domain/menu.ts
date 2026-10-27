export type MenuItem = { id: string; label: string; icon: "copy" | "pause" | "resume" | "reset" | "trash"; danger?: boolean; locked?: boolean; run: () => void };

export const menuTarget = (key: string, at: number, count: number): number | null => {
  if (count === 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return (at + 1) % count;
  if (key === "ArrowUp") return at <= 0 ? count - 1 : at - 1;
  return null;
};

const ITEM_REM = 3.25;
const FRAME_REM = 2.5;

export const menuHeight = (count: number, rem: number) => (count * ITEM_REM + FRAME_REM) * rem;

export const menuAnchor = (button: { top: number; bottom: number; right: number }, viewport: { width: number; height: number }, need: number) => {
  const below = viewport.height - button.bottom;
  const right = `${viewport.width - button.right}px`;
  return below < need && button.top > below
    ? { "--menu-bottom": `${viewport.height - button.top}px`, "--menu-room": `${button.top}px`, "--menu-right": right }
    : { "--menu-top": `${button.bottom}px`, "--menu-room": `${below}px`, "--menu-right": right };
};
