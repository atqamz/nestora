export type MenuItem = { label: string; danger?: boolean; run: () => void };

export const menuTarget = (key: string, at: number, count: number): number | null => {
  if (count === 0) return null;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return (at + 1) % count;
  if (key === "ArrowUp") return at <= 0 ? count - 1 : at - 1;
  return null;
};
