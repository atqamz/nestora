import type { Type } from "../../shared/tables.ts";
import { toIsbn13 } from "./isbn.ts";
import { parseRupiah } from "./money.ts";
import { normalizePhone } from "./phone.ts";
import { parseYear } from "./screen.ts";

export type Parsed = { ok: true; value: string | number | boolean | null } | { ok: false };

export const parseField = (type: Type, raw: string | boolean): Parsed => {
  if (typeof raw === "boolean") return { ok: true, value: raw || null };
  const text = raw.trim();
  if (text === "") return { ok: true, value: null };
  if (type === "phone") {
    const phone = normalizePhone(text);
    return phone === null ? { ok: false } : { ok: true, value: phone };
  }
  if (type === "isbn") {
    const isbn = toIsbn13(text);
    return isbn === null ? { ok: false } : { ok: true, value: isbn };
  }
  if (type === "int") {
    const number = parseRupiah(text);
    return number === null ? { ok: false } : { ok: true, value: number };
  }
  if (type === "year") return parseYear(text);
  return { ok: true, value: text };
};
