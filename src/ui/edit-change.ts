import type { BudgetEntryRow, ItemRow, Type } from "../../shared/tables.ts";
import { parseField } from "../domain/field.ts";
import { text } from "./text.ts";

type Row = ItemRow | BudgetEntryRow;

type Value = string | number | boolean | null;

export const valueOf = (row: Row, field: string) =>
  (field.startsWith("data.") ? (row.data?.[field.slice(5)] ?? null) : (row[field as keyof Row] ?? null)) as Value;

export const changeOf = (controls: readonly { name: string; type: Type }[], form: FormData, initial: Row) => {
  const change: Record<string, unknown> = {};
  const data: Record<string, unknown> = {};
  const invalid: Record<string, string> = {};
  for (const control of controls) {
    const raw = control.type === "bool" ? form.get(control.name) !== null : String(form.get(control.name) ?? "");
    const parsed = parseField(control.type, raw);
    if (!parsed.ok || (control.name === "title" && parsed.value === null)) {
      invalid[control.name] = control.name === "title" ? text.invalid.required : text.invalid[control.type as "phone" | "int" | "year"];
      continue;
    }
    if (parsed.value === valueOf(initial, control.name)) continue;
    if (control.name.startsWith("data.")) data[control.name.slice(5)] = parsed.value;
    else change[control.name] = parsed.value;
  }
  if (Object.keys(data).length > 0) change.data = data;
  return { change, invalid };
};
