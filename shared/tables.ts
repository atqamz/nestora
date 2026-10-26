export type Sql = "TEXT" | "INTEGER" | "REAL";

export type Type =
  | "id"
  | "key"
  | "text"
  | "longtext"
  | "note"
  | "int"
  | "year"
  | "real"
  | "bool"
  | "instant"
  | "date"
  | "currency"
  | "phone"
  | "url"
  | "json"
  | "zone"
  | "decimal"
  | "dates"
  | "stages"
  | "photo"
  | "isbn"
  | "cover"
  | "tmdb"
  | "order"
  | "time"
  | "days"
  | readonly string[];

export type Column = {
  sql: Sql;
  type: Type;
  notNull: boolean;
  default?: string | number;
  server?: true;
  immutable?: true;
  clearOnly?: true;
};

export type Variant = {
  columns: readonly string[];
  required: readonly string[];
  status?: readonly string[];
  who?: readonly string[];
  doneOnStatus?: string;
  pastDone?: true;
  caps?: Readonly<Record<string, number>>;
  data: Readonly<Record<string, Type>>;
};

export type Table = {
  key: string;
  columns: Readonly<Record<string, Column>>;
  common: readonly string[];
  by?: string;
  variants?: Readonly<Record<string, Variant>>;
  values?: Readonly<Record<string, Type>>;
};

const optional = <const T extends Type>(sql: Sql, type: T) => ({ sql, type, notNull: false as const });
const required = <const T extends Type>(sql: Sql, type: T) => ({ sql, type, notNull: true as const });
const withDefault = <const C extends Column>(column: C, value: string | number) => ({ ...column, default: value });
const server = <const C extends Column>(column: C) => ({ ...column, server: true as const });
const immutable = <const C extends Column>(column: C) => ({ ...column, immutable: true as const });
const clearOnly = <const C extends Column>(column: C) => ({ ...column, clearOnly: true as const });

export const COLLECTION_MAX = 60;
export const ORDER_MAX = 1_000_000_000;

const who = ["a", "b", "both"] as const;

const days = { days: "days" } as const;
const marks = { done_a: "date", done_b: "date" } as const;
const screen = {
  original_title: "text",
  year: "year",
  rating_a: ["1", "2", "3", "4", "5"],
  rating_b: ["1", "2", "3", "4", "5"],
  cover: "cover",
  tmdb: "tmdb",
  tmdb_at: "date",
  collection: "text",
  order: "order",
} as const;
const watchable = {
  columns: ["status", "who", "done_on", "note"],
  required: ["status"],
  status: ["want", "watching", "watched"],
  doneOnStatus: "watched",
  caps: { "data.collection": COLLECTION_MAX },
  pastDone: true,
  data: screen,
} as const;
const action = ["parent_id", "group_key", "note"] as const;
const caps = { title: 120, group_key: 60, note: 2000 } as const;

export const DURATION_MAX = 1440;

const syncColumns = {
  rev: server(required("INTEGER", "int")),
  created_at: immutable(required("TEXT", "instant")),
  updated_at: required("TEXT", "instant"),
  updated_by: server(optional("TEXT", ["a", "b", "import"] as const)),
  deleted_at: clearOnly(optional("TEXT", "instant")),
};

const syncNames = Object.keys(syncColumns);

export const tables = {
  settings: {
    key: "key",
    columns: {
      key: required("TEXT", "key"),
      value: required("TEXT", "longtext"),
      ...syncColumns,
    },
    common: ["key", "value", ...syncNames],
    values: {
      ceremony_date: "date",
      timezone: "zone",
      partner_a_label: "text",
      partner_b_label: "text",
      partner_a_photo: "photo",
      partner_b_photo: "photo",
      hijri_calendar: ["islamic", "islamic-umalqura", "islamic-civil", "islamic-tbla", "islamic-rgsa"],
      hijri_offset_days: ["-2", "-1", "0", "1", "2"],
      holidays: "dates",
      portion_multiplier: "decimal",
      stages: "stages",
    },
  },
  items: {
    key: "id",
    columns: {
      id: required("TEXT", "id"),
      kind: required("TEXT", "text"),
      parent_id: optional("TEXT", "id"),
      title: required("TEXT", "text"),
      status: optional("TEXT", "text"),
      group_key: optional("TEXT", "text"),
      due_on: optional("TEXT", "date"),
      done_on: optional("TEXT", "date"),
      amount: optional("INTEGER", "int"),
      currency: withDefault(required("TEXT", "currency"), "IDR"),
      qty: optional("INTEGER", "int"),
      who: optional("TEXT", who),
      note: optional("TEXT", "note"),
      data: optional("TEXT", "json"),
      sort: withDefault(required("REAL", "real"), 0),
      ...syncColumns,
    },
    common: ["id", "kind", "title", "currency", "data", "sort", ...syncNames],
    by: "kind",
    variants: {
      task: {
        columns: ["status", "due_on", "done_on", "who", "group_key", "amount", "qty", "note"],
        required: ["status"],
        status: ["todo", "done"],
        data: { start_on: "date", decision: "bool", rules: "longtext" },
      },
      vendor: {
        columns: ["status", "group_key", "amount"],
        required: ["status"],
        status: ["option", "confirmed", "cancelled"],
        data: { phone: "phone", pic: "text", contract_url: "url", facts: "longtext" },
      },
      guest: {
        columns: ["status", "who", "group_key", "qty"],
        required: ["status"],
        status: ["todo", "sent", "confirmed", "declined"],
        who: ["a", "b"],
        data: {
          phone: "phone",
          channel: ["digital", "print", "both"],
          rsvp_qty: "int",
          import_batch: "text",
        },
      },
      book: {
        columns: ["status", "group_key", "who", "amount", "note"],
        required: ["status"],
        status: ["wish", "shelf"],
        data: {
          author: "text",
          original_title: "text",
          series: "text",
          series_no: "int",
          isbn: "isbn",
          language: ["id", "en", "other"],
          cover: "cover",
          blurb: "longtext",
          ol: "text",
          gb: "text",
          public_rating: "decimal",
          rated_elsewhere: "text",
          priority: ["high", "low"],
          gift: "bool",
          shop: "text",
          shop_url: "url",
          reading_a: ["want", "reading", "read", "dnf"],
          rating_a: ["1", "2", "3", "4", "5"],
          finished_a: "date",
          reading_b: ["want", "reading", "read", "dnf"],
          rating_b: ["1", "2", "3", "4", "5"],
          finished_b: "date",
          import_batch: "text",
        },
      },
      copy: {
        columns: ["parent_id", "status", "group_key", "who", "due_on", "done_on", "note"],
        required: ["parent_id", "status"],
        status: ["here", "lent", "borrowed", "gone"],
        doneOnStatus: "gone",
        data: {
          isbn: "isbn",
          language: ["id", "en", "other"],
          format: ["print", "ebook", "audio"],
          publisher: "text",
          year: "int",
          lent_to: "text",
          lent_on: "date",
          from: "text",
          moved_on: "date",
          moved_by: ["a", "b"],
          was_at: "id",
          import_batch: "text",
        },
      },
      place: {
        columns: ["note"],
        required: [],
        data: {},
      },
      routine: {
        columns: ["who", "group_key", "note"],
        required: ["who"],
        caps: { ...caps, "data.duration": DURATION_MAX },
        data: {
          ...days,
          every_weeks: ["1", "2", "3", "4"],
          from: "date",
          until: "date",
          paused_until: "date",
          start_time: "time",
          duration: "int",
          holidays: "bool",
          private: "bool",
          remind: "bool",
          calendar: "bool",
        },
      },
      step: { columns: action, required: ["parent_id"], caps, data: { ...days, ...marks, url: "url" } },
      timer: { columns: action, required: ["parent_id"], caps, data: { ...days, ...marks, minutes: "int" } },
      pack: { columns: action, required: ["parent_id"], caps, data: { ...days, ...marks } },
      block: {
        columns: action,
        required: ["parent_id"],
        caps: { ...caps, "data.where": 120 },
        data: { ...days, start_time: "time", end_time: "time", where: "text" },
      },
      day_type: { columns: action, required: ["parent_id"], caps, data: { ...days } },
      counter: {
        columns: [...action, "qty"],
        required: ["parent_id"],
        caps: { ...caps, "data.unit": 24 },
        data: { ...days, ...marks, unit: "text", value_a: "int", value_b: "int" },
      },
      text: { columns: action, required: ["parent_id"], caps, data: { ...days } },
      movie: watchable,
      series: watchable,
    },
  },
  budget_entries: {
    key: "id",
    columns: {
      id: required("TEXT", "id"),
      entry_type: required("TEXT", "text"),
      budget_id: optional("TEXT", "id"),
      vendor_id: optional("TEXT", "id"),
      title: required("TEXT", "text"),
      group_key: optional("TEXT", "text"),
      status: optional("TEXT", ["due", "paid"] as const),
      amount: optional("INTEGER", "int"),
      currency: withDefault(required("TEXT", "currency"), "IDR"),
      due_on: optional("TEXT", "date"),
      done_on: optional("TEXT", "date"),
      who: optional("TEXT", who),
      note: optional("TEXT", "note"),
      data: optional("TEXT", "json"),
      sort: withDefault(required("REAL", "real"), 0),
      ...syncColumns,
    },
    common: ["id", "entry_type", "title", "currency", "data", "sort", ...syncNames],
    by: "entry_type",
    variants: {
      planned: {
        columns: ["group_key", "amount", "vendor_id"],
        required: ["group_key"],
        data: {},
      },
      payment: {
        columns: ["budget_id", "status", "amount", "due_on", "done_on", "who"],
        required: ["budget_id", "status", "amount"],
        status: ["due", "paid"],
        doneOnStatus: "paid",
        data: { proof_url: "url" },
      },
    },
  },
} as const satisfies Record<string, Table>;

export type TableName = keyof typeof tables;

export const tableNames = Object.keys(tables) as TableName[];

type Columns<T extends TableName> = (typeof tables)[T]["columns"];

type Value<C> = C extends { type: infer V }
  ? V extends readonly (infer E)[]
    ? E
    : V extends "int" | "real"
      ? number
      : V extends "bool"
        ? boolean
        : V extends "json"
          ? Record<string, unknown>
          : string
  : never;

export type Row<T extends TableName> = {
  [C in keyof Columns<T>]: Columns<T>[C] extends { notNull: true } ? Value<Columns<T>[C]> : Value<Columns<T>[C]> | null;
};

type Discriminator<T extends TableName> = (typeof tables)[T] extends { by: infer B extends string } ? B : never;

type Flagged<T extends TableName, F extends "immutable" | "clearOnly"> = {
  [C in keyof Columns<T>]: Columns<T>[C] extends { [K in F]: true } ? C : never;
}[keyof Columns<T>];

export type Patch<T extends TableName> = Partial<
  Omit<
    Row<T>,
    "rev" | "updated_by" | Flagged<T, "immutable"> | Flagged<T, "clearOnly"> | (typeof tables)[T]["key"] | Discriminator<T>
  >
> & { [C in Flagged<T, "clearOnly">]?: null };

export type ItemRow = Row<"items">;
export type BudgetEntryRow = Row<"budget_entries">;
export type SettingRow = Row<"settings">;

export type Kind = keyof (typeof tables)["items"]["variants"];
export type EntryType = keyof (typeof tables)["budget_entries"]["variants"];
