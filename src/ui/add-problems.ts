import { parseAmount } from "../domain/draft.ts";
import type { Kind } from "../domain/draft.ts";
import { normalizePhone } from "../domain/phone.ts";
import { text } from "./text.ts";

export type Detail = "amount" | "due" | "line" | "group" | "phone" | "qty";

export const DETAILS: Record<Kind, readonly Detail[]> = {
  task: ["due", "amount", "group"],
  planned: ["amount", "group"],
  payment: ["line", "amount", "due"],
  guest: ["group", "qty", "phone"],
  vendor: ["group", "amount", "phone"],
  book: [],
};

export const problemsOf = (kind: Kind, title: string, values: Record<Detail, string>, lines: readonly { id: string }[]) => {
  const own = DETAILS[kind];
  const problems: Partial<Record<Detail | "title", string>> = {};
  const amount = values.amount.trim() === "" ? null : parseAmount(values.amount);
  const quantity = /^\d+$/.test(values.qty.trim()) ? Number(values.qty.trim()) : Number.NaN;
  if (kind !== "payment" && title === "") problems.title = text.sheet.need.name;
  if (own.includes("amount") && values.amount.trim() !== "" && amount === null) problems.amount = text.invalid.int;
  else if (kind === "payment" && amount === null) problems.amount = text.sheet.need.amount;
  if (kind === "payment" && !lines.some((line) => line.id === values.line)) problems.line = lines.length === 0 ? text.sheet.need.noLines : text.sheet.need.line;
  if (own.includes("phone") && values.phone.trim() !== "" && normalizePhone(values.phone) === null) problems.phone = text.invalid.phone;
  if (kind === "guest" && !(Number.isInteger(quantity) && quantity >= 1)) problems.qty = text.sheet.need.qty;
  return problems;
};
