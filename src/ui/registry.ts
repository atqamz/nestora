import { tables } from "../../shared/tables.ts";
import type { Column, Type, Variant } from "../../shared/tables.ts";

export type View = {
  table: "items" | "budget_entries";
  variant: string;
  route: string;
  fields: readonly string[];
  summary: readonly string[];
  done?: string;
  assignable?: true;
};

export const views = {
  task: {
    table: "items",
    variant: "task",
    route: "tasks",
    fields: ["status", "due_on", "who", "group_key", "amount", "note", "data.decision"],
    summary: ["due_on", "who"],
    done: "done",
    assignable: true,
  },
  vendor: {
    table: "items",
    variant: "vendor",
    route: "vendors",
    fields: ["status", "group_key", "amount", "data.phone", "data.pic", "data.contract_url", "data.facts"],
    summary: [],
  },
  guest: {
    table: "items",
    variant: "guest",
    route: "guests",
    fields: ["who", "status", "qty", "group_key", "data.phone"],
    summary: [],
  },
  book: {
    table: "items",
    variant: "book",
    route: "books",
    fields: [
      "data.author",
      "data.original_title",
      "data.series",
      "data.series_no",
      "data.isbn",
      "data.language",
      "group_key",
      "who",
      "data.priority",
      "data.gift",
      "amount",
      "data.shop",
      "data.shop_url",
      "data.rated_elsewhere",
      "note",
    ],
    summary: [],
  },
  copy: {
    table: "items",
    variant: "copy",
    route: "books",
    fields: ["who", "data.format", "data.isbn", "data.language"],
    summary: [],
  },
  place: {
    table: "items",
    variant: "place",
    route: "places",
    fields: ["note"],
    summary: [],
  },
  planned: {
    table: "budget_entries",
    variant: "planned",
    route: "money",
    fields: ["group_key", "amount", "note"],
    summary: [],
  },
  payment: {
    table: "budget_entries",
    variant: "payment",
    route: "payments",
    fields: ["amount", "due_on", "status", "who", "data.proof_url"],
    summary: ["due_on", "status"],
    done: "paid",
  },
} as const satisfies Record<string, View>;

export type ViewName = keyof typeof views;

export const listViews = ["task", "vendor", "guest"] as const satisfies readonly ViewName[];

export type ListName = (typeof listViews)[number];

const variantOf = (name: ViewName): Variant => (tables[views[name].table].variants as Record<string, Variant>)[views[name].variant];

export const fieldType = (name: ViewName, field: string): Type =>
  field.startsWith("data.")
    ? variantOf(name).data[field.slice(5)]
    : (tables[views[name].table].columns as Record<string, Column>)[field].type;

export const fieldOptions = (name: ViewName, field: string): readonly string[] | null => {
  const variant = variantOf(name);
  if (field === "status" && variant.status) return variant.status;
  if (field === "who" && variant.who) return variant.who;
  const type = fieldType(name, field);
  return typeof type === "string" ? null : type;
};

export const isRequired = (name: ViewName, field: string) => variantOf(name).required.includes(field);

export const exportQuery = (name: ViewName) =>
  `format=csv&table=${views[name].table}&${tables[views[name].table].by}=${views[name].variant}`;

export const firstStatus = (name: ViewName) => variantOf(name).status?.[0] ?? null;

export const statusRank = (name: ViewName, status: string | null) => variantOf(name).status?.indexOf(status ?? "") ?? 0;
