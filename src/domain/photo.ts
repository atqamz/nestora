import type { Side } from "../../shared/api.ts";
import { isPhoto } from "../../shared/validate.ts";

const SIZED = /=s\d{1,4}-c$/;
const SIZE_MAX = 256;

export const photoSource = (value: string | null, size: number): string | null =>
  value !== null && isPhoto(value) ? value.replace(SIZED, `=s${Math.min(size * 2, SIZE_MAX)}-c`) : null;

export const photoFor = (side: Side | null, photos: { a: string | null; b: string | null }, link: string): string | null =>
  link === "offline" || side === null ? null : photos[side];
