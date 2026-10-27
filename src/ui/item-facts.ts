import { optionLabel, fieldLabel } from "./labels.ts";
import { fieldOptions, fieldType, views } from "./registry.ts";
import type { ViewName } from "./registry.ts";
import { formatDate } from "./format.ts";
import type { Row } from "./item-flows.ts";
import { text } from "./text.ts";

export type Fact = { field: string; label: string; value: string | number; kind: "text" | "money" | "link" | "long" };

const web = (value: string) => /^https?:\/\//i.test(value);

const valueOf = (row: Row, field: string): unknown => (field.startsWith("data.") ? (row.data?.[field.slice(5)] ?? null) : (row[field as keyof Row] ?? null));

export const factsOf = (name: ViewName, row: Row, skip: readonly string[], side: (who: string) => string): Fact[] =>
  views[name].fields.flatMap((field): Fact[] => {
    const value = valueOf(row, field);
    if (skip.includes(field) || value === null || value === "" || value === false) return [];
    const label = fieldLabel(name, field);
    const type = fieldType(name, field);
    if (type === "bool") return [{ field, label, value: text.yes, kind: "text" }];
    if (type === "date") return [{ field, label, value: formatDate(String(value)), kind: "text" }];
    if (field === "amount") return [{ field, label, value: Number(value), kind: "money" }];
    if (type === "url") return [{ field, label, value: String(value), kind: web(String(value)) ? "link" : "text" }];
    if (type === "longtext" || type === "note") return [{ field, label, value: String(value), kind: "long" }];
    if (fieldOptions(name, field)) return [{ field, label, value: optionLabel(name, field, String(value), side), kind: "text" }];
    return [{ field, label, value: String(value), kind: "text" }];
  });
