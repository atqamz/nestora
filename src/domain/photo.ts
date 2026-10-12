import { isPhoto } from "../../shared/validate.ts";

const SIZED = /=s\d{1,4}-c$/;
const SIZE_MAX = 256;

export const photoSource = (value: string | null, size: number): string | null =>
  value !== null && isPhoto(value) ? value.replace(SIZED, `=s${Math.min(size * 2, SIZE_MAX)}-c`) : null;
