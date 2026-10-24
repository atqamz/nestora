import { tables } from "./tables.ts";
import { applyPatch } from "./api.ts";
import { DAY_CODES } from "./routines.ts";
import type { Column, Table, Type, Variant } from "./tables.ts";

type Plain = Record<string, unknown>;
type Mode = "create" | "stored" | "patch";

export const TEXT_MAX = 500;
export const LONGTEXT_MAX = 2000;
export const NOTE_MAX = 10000;
const URL_MAX = 2048;
const DATA_MAX = 20000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEY = /^[a-z][a-z0-9_]{0,63}$/;
const STAGE_KEY = /^[a-z][a-z0-9_]{0,31}$/;
const CURRENCY = /^[A-Z]{3}$/;
const PHONE = /^\+[1-9]\d{6,14}$/;
const DATE = /^(\d{4})-(\d\d)-(\d\d)$/;
const INSTANT = /^(\d{4}-\d\d-\d\d)T(\d\d):(\d\d):(\d\d)Z$/;
const ZONE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;
const DECIMAL = /^(0|[1-9]\d{0,5})(\.\d{1,4})?$/;
const URL_SHAPE = /^https?:\/\/[^\s\p{Cc}\p{Cf}\p{Cs}/?#][^\s\p{Cc}\p{Cf}\p{Cs}]*$/iu;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const PHOTO_SHAPE = /^[\x21-\x7e]+$/;
const COVER_SHAPE = /^https:\/\/covers\.openlibrary\.org\/[\x21-\x7e]{1,200}$/;
const PHOTO_HOST = /^([a-z0-9-]+\.)*googleusercontent\.com$/;
const UNWANTED = /(?!\u200d)[\p{Cc}\p{Cf}\p{Cs}]/u;
export const VISIBLE = /[^\p{Z}\p{C}\p{Default_Ignorable_Code_Point}\s⠀]/u;

export type Stage = { key: string; name: string; from: number; to: number };

export type StageProblem = {
  index: number | null;
  field: "key" | "name" | "from" | "to";
  code: "shape" | "count" | "key" | "key_twice" | "name" | "name_twice" | "range" | "bounds" | "overlap";
};

export const PHOTO_MAX = 512;
export const STAGES_MAX = 12;
export const STAGE_NAME_MAX = 40;
export const MONTH_MIN = -36;
export const MONTH_MAX = 12;

const show = (v: unknown) => (typeof v === "string" ? JSON.stringify(v) : typeof v);

const isPlain = (v: unknown): v is Plain => typeof v === "object" && v !== null && !Array.isArray(v);

const isDate = (v: string) => {
  const m = DATE.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
};

const isInstant = (v: string) => {
  const m = INSTANT.exec(v);
  return m !== null && isDate(m[1]) && Number(m[2]) < 24 && Number(m[3]) < 60 && Number(m[4]) < 60;
};

const isText = (v: unknown, max: number, multiline: boolean) =>
  typeof v === "string" &&
  v.length <= max &&
  !UNWANTED.test(multiline ? v.replace(/[\n\t]/g, "") : v) &&
  VISIBLE.test(v);

export const isTime = (v: unknown) => typeof v === "string" && TIME.test(v);

export const isUrl = (v: unknown) => {
  if (typeof v !== "string" || v.length > URL_MAX || !URL_SHAPE.test(v)) return false;
  try {
    return new URL(v).hostname !== "";
  } catch {
    return false;
  }
};

export const isPhoto = (v: unknown): v is string => {
  if (typeof v !== "string" || v.length > PHOTO_MAX || !PHOTO_SHAPE.test(v)) return false;
  try {
    const url = new URL(v);
    return url.protocol === "https:" && url.username === "" && url.password === "" && url.port === "" && PHOTO_HOST.test(url.hostname);
  } catch {
    return false;
  }
};

export const isCover = (v: unknown): v is string => typeof v === "string" && COVER_SHAPE.test(v);

export const isIsbn13 = (v: unknown) =>
  typeof v === "string" && /^\d{13}$/.test(v) && [...v].reduce((sum, digit, i) => sum + Number(digit) * (i % 2 === 0 ? 1 : 3), 0) % 10 === 0;

const isZone = (v: unknown) => {
  if (typeof v !== "string" || !ZONE.test(v)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: v });
    return true;
  } catch {
    return false;
  }
};

export const isDates = (v: unknown) => {
  if (typeof v !== "string") return false;
  try {
    const list: unknown = JSON.parse(v);
    return Array.isArray(list) && list.every((d) => typeof d === "string" && isDate(d));
  } catch {
    return false;
  }
};

const isDays = (v: unknown) => {
  if (typeof v !== "string") return false;
  const codes = v.split(",").map((code) => (DAY_CODES as readonly string[]).indexOf(code));
  return codes.every((at, i) => at >= 0 && (i === 0 || at > codes[i - 1]));
};

const STAGE_FIELDS = ["key", "name", "from", "to"];

const monthOk = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= MONTH_MIN && (v as number) <= MONTH_MAX;

export const stageProblems = (list: unknown): StageProblem[] => {
  if (!Array.isArray(list) || list.length < 1 || list.length > STAGES_MAX) return [{ index: null, field: "name", code: "count" }];
  const problems: StageProblem[] = [];
  const keys = new Set<string>();
  const names = new Set<string>();
  let previous: number | null = null;
  for (const [index, stage] of list.entries()) {
    if (!isPlain(stage) || Object.keys(stage).length !== STAGE_FIELDS.length || !STAGE_FIELDS.every((field) => Object.hasOwn(stage, field))) {
      problems.push({ index, field: "name", code: "shape" });
      continue;
    }
    const { key, name, from, to } = stage;
    if (typeof key !== "string" || !STAGE_KEY.test(key)) problems.push({ index, field: "key", code: "key" });
    else if (keys.has(key)) problems.push({ index, field: "key", code: "key_twice" });
    else keys.add(key);
    if (typeof name !== "string" || name !== name.trim() || !isText(name, STAGE_NAME_MAX, false)) problems.push({ index, field: "name", code: "name" });
    else if (names.has(name.toLowerCase())) problems.push({ index, field: "name", code: "name_twice" });
    else names.add(name.toLowerCase());
    if (!monthOk(from)) problems.push({ index, field: "from", code: "bounds" });
    if (!monthOk(to)) problems.push({ index, field: "to", code: "bounds" });
    if (!monthOk(from) || !monthOk(to)) continue;
    if (from > to) problems.push({ index, field: "to", code: "range" });
    else if (previous !== null && from <= previous) problems.push({ index, field: "from", code: "overlap" });
    previous = to;
  }
  return problems;
};

const isStages = (v: unknown) => {
  if (typeof v !== "string") return false;
  try {
    return stageProblems(JSON.parse(v)).length === 0;
  } catch {
    return false;
  }
};

const expected: Record<string, string> = {
  id: "a lowercase UUID",
  key: "a lowercase key such as ceremony_date",
  text: `a single-line string of up to ${TEXT_MAX} characters with a visible character and no control characters`,
  longtext: `a single-line string of up to ${LONGTEXT_MAX} characters with a visible character and no control characters`,
  note: `a string of up to ${NOTE_MAX} characters with a visible character and no control characters except newline and tab`,
  int: "a non-negative integer",
  real: "a finite number",
  bool: "true or false",
  instant: "an RFC 3339 UTC instant such as 2026-10-06T05:00:00Z, without a fraction",
  date: "a date as YYYY-MM-DD",
  currency: "a 3-letter uppercase currency code",
  phone: "an E.164 phone number of 7 to 15 digits such as +628123456789",
  url: `an http or https URL of up to ${URL_MAX} characters with a host and no whitespace`,
  json: "an object",
  zone: "an IANA time zone such as Asia/Jakarta",
  decimal: "a positive decimal number such as 1.5",
  dates: "a JSON array of YYYY-MM-DD dates",
  time: "a time as HH:MM from 00:00 to 23:59",
  days: "weekday codes in order, separated by commas, from MO,TU,WE,TH,FR,SA,SU, such as MO,TH",
  isbn: "an ISBN-13 as 13 digits with no hyphens and a valid check digit",
  cover: "an https URL on covers.openlibrary.org",
  photo: `an https URL of up to ${PHOTO_MAX} characters on googleusercontent.com without credentials or a port, or an empty string`,
  stages: `a JSON array of 1 to ${STAGES_MAX} stages, each with a unique key, a unique name of up to ${STAGE_NAME_MAX} characters and a month range from ${MONTH_MIN} to ${MONTH_MAX} that starts after the stage before`,
};

const problem = (type: Type, v: unknown): string | null => {
  if (Array.isArray(type)) return type.includes(v as string) ? null : `must be one of ${type.join(", ")}`;
  const ok =
    type === "id" ? typeof v === "string" && UUID.test(v)
    : type === "key" ? typeof v === "string" && KEY.test(v)
    : type === "text" ? isText(v, TEXT_MAX, false)
    : type === "longtext" ? isText(v, LONGTEXT_MAX, false)
    : type === "note" ? isText(v, NOTE_MAX, true)
    : type === "int" ? typeof v === "number" && Number.isSafeInteger(v) && v >= 0
    : type === "real" ? typeof v === "number" && Number.isFinite(v)
    : type === "bool" ? typeof v === "boolean"
    : type === "instant" ? typeof v === "string" && isInstant(v)
    : type === "date" ? typeof v === "string" && isDate(v)
    : type === "currency" ? typeof v === "string" && CURRENCY.test(v)
    : type === "phone" ? typeof v === "string" && PHONE.test(v)
    : type === "url" ? isUrl(v)
    : type === "zone" ? isZone(v)
    : type === "decimal" ? typeof v === "string" && DECIMAL.test(v) && Number(v) > 0
    : type === "dates" ? isDates(v)
    : type === "stages" ? isStages(v)
    : type === "photo" ? isPhoto(v)
    : type === "time" ? isTime(v)
    : type === "days" ? isDays(v)
    : type === "isbn" ? isIsbn13(v)
    : type === "cover" ? isCover(v)
    : isPlain(v);
  return ok ? null : `must be ${expected[type as string]}`;
};

const lookup = <T>(map: Readonly<Record<string, T>> | undefined, name: unknown): T | undefined =>
  typeof name === "string" && map !== undefined && Object.hasOwn(map, name) ? map[name] : undefined;

const checkData = (variant: Variant, data: unknown, mode: Mode, errors: string[]) => {
  if (!isPlain(data)) {
    errors.push("data: must be an object");
    return;
  }
  try {
    if (JSON.stringify(data).length > DATA_MAX) errors.push(`data: must serialize to at most ${DATA_MAX} characters`);
  } catch {
    errors.push("data: must be JSON");
    return;
  }
  for (const [name, value] of Object.entries(data)) {
    const type = lookup(variant.data, name);
    if (type === undefined) errors.push(`data.${name}: unknown key`);
    else if (value === null) {
      if (mode !== "patch") errors.push(`data.${name}: must not be null`);
    } else {
      const bad = problem(type, value);
      if (bad) errors.push(`data.${name}: ${bad}`);
    }
  }
};

const checkSchedule = (data: unknown, errors: string[]) => {
  if (!isPlain(data)) return;
  const { every_weeks, from, until } = data;
  if (every_weeks != null && from == null) errors.push("data.from: required with data.every_weeks");
  if (typeof from === "string" && typeof until === "string" && until < from) errors.push("data.until: must not be before data.from");
};

const checkVariant = (
  table: Table,
  variantName: string,
  variant: Variant,
  input: Plain,
  mode: Mode,
  errors: string[],
) => {
  const known = new Set([...table.common, ...variant.columns]);
  for (const [name, value] of Object.entries(input)) {
    if (Object.hasOwn(table.columns, name) && value !== null && value !== undefined && !known.has(name)) {
      errors.push(`${name}: not used by ${table.by} ${variantName}`);
    }
  }
  if (typeof input.status === "string" && variant.status && !variant.status.includes(input.status)) {
    errors.push(`status: must be one of ${variant.status.join(", ")} for ${table.by} ${variantName}`);
  }
  if (typeof input.who === "string" && variant.who && !variant.who.includes(input.who)) {
    errors.push(`who: must be one of ${variant.who.join(", ")} for ${table.by} ${variantName}`);
  }
  if (mode === "patch" && input.data === null) errors.push("data: must be an object, set a key to null to remove it");
  if (input.data !== undefined && input.data !== null) checkData(variant, input.data, mode, errors);
  if (mode === "create" && table.by === "kind" && variantName === "routine") checkSchedule(input.data, errors);
  if (variant.doneOnStatus && input.done_on != null && input.status !== undefined && input.status !== variant.doneOnStatus) {
    errors.push(`done_on: only allowed when status is ${variant.doneOnStatus}`);
  }
  for (const [name, max] of Object.entries(variant.caps ?? {})) {
    const value = name.startsWith("data.") && isPlain(input.data) ? input.data[name.slice(5)] : input[name];
    if (typeof value === "string" && value.length > max) errors.push(`${name}: must be at most ${max} characters`);
  }
  for (const name of variant.required) {
    if (input[name] === null || (mode !== "patch" && input[name] === undefined)) {
      errors.push(`${name}: required for ${table.by} ${variantName}`);
    }
  }
};

const checkColumns = (table: Table, keyName: unknown, input: Plain, mode: Mode, errors: string[]) => {
  for (const [name, value] of Object.entries(input)) {
    const column: Column | undefined = lookup(table.columns, name);
    if (column === undefined) errors.push(`${name}: unknown column`);
    else if (column.server && mode !== "stored") errors.push(`${name}: set by the server, never by the client`);
    else if (mode === "patch" && (column.immutable || name === table.key || name === table.by)) {
      errors.push(`${name}: cannot be changed`);
    } else if (mode === "patch" && column.clearOnly && value !== null && value !== undefined) {
      errors.push(`${name}: can only be cleared with null in a patch`);
    } else if (mode === "create" && column.clearOnly && value !== null && value !== undefined) {
      errors.push(`${name}: cannot be set when creating a row`);
    } else if (value === null) {
      if (column.notNull) errors.push(`${name}: must not be null`);
    } else if (value !== undefined) {
      const bad = name === "value" && value === "" && lookup(table.values, keyName) === "photo" ? null : problem(column.type, value);
      if (bad) errors.push(`${name}: ${bad}`);
    }
  }
};

const checkValue = (table: Table, keyName: unknown, input: Plain, errors: string[]) => {
  const type = lookup(table.values, keyName);
  if (type !== undefined && typeof input.value === "string" && problem("longtext", input.value) === null) {
    const bad = problem(type, input.value);
    if (bad) errors.push(`value: ${bad} for key ${keyName as string}`);
  }
};

const validateFull = (tableName: unknown, row: unknown, mode: "create" | "stored"): string[] => {
  const table = lookup<Table>(tables, tableName);
  if (table === undefined) return [`unknown table ${show(tableName)}`];
  if (!isPlain(row)) return ["row: must be an object"];
  const errors: string[] = [];
  checkColumns(table, row[table.key], row, mode, errors);
  for (const [name, column] of Object.entries(table.columns)) {
    if (column.notNull && (mode === "stored" || !column.server) && column.default === undefined && row[name] === undefined) {
      errors.push(`${name}: required`);
    }
  }
  if (table.by) {
    const variantName = row[table.by];
    const variant = lookup(table.variants, variantName);
    if (variant) checkVariant(table, variantName as string, variant, row, mode, errors);
    else if (variantName !== undefined) errors.push(`${table.by}: unknown ${table.by} ${show(variantName)}`);
  }
  checkValue(table, row[table.key], row, errors);
  return errors;
};

export const validateCreate = (tableName: unknown, row: unknown): string[] => validateFull(tableName, row, "create");

export const validateRow = (tableName: unknown, row: unknown): string[] => validateFull(tableName, row, "stored");

export const validatePatch = (tableName: unknown, variantName: unknown, patch: unknown): string[] => {
  const table = lookup<Table>(tables, tableName);
  if (table === undefined) return [`unknown table ${show(tableName)}`];
  if (!isPlain(patch)) return ["patch: must be an object"];
  const errors: string[] = [];
  checkColumns(table, variantName, patch, "patch", errors);
  if (!table.by && problem(table.columns[table.key].type, variantName)) errors.push(`${table.key}: the stored row key is invalid`);
  if (table.by) {
    const variant = lookup(table.variants, variantName);
    if (variant) checkVariant(table, variantName as string, variant, patch, "patch", errors);
    else errors.push(`${table.by}: unknown ${table.by} ${show(variantName)}`);
  }
  checkValue(table, variantName, patch, errors);
  return errors;
};

export const validateChange = (tableName: unknown, stored: unknown, patch: unknown): string[] => {
  const table = lookup<Table>(tables, tableName);
  if (table === undefined) return [`unknown table ${show(tableName)}`];
  if (!isPlain(stored)) return ["row: must be an object"];
  const errors = validatePatch(tableName, stored[table.by ?? table.key], patch);
  if (errors.length > 0) return errors;
  const merged = applyPatch(stored, patch as Plain);
  const rows = validateRow(tableName, merged);
  const sent = isPlain(patch) ? patch.data : undefined;
  const schedule = isPlain(sent) && ["every_weeks", "from", "until"].some((key) => Object.hasOwn(sent, key));
  if (rows.length === 0 && schedule && merged.kind === "routine") checkSchedule(merged.data, rows);
  return rows;
};

const mutationFields = ["id", "table", "op", "row_id", "patch"];
const ops = ["create", "update", "delete"];

export const validateMutation = (mutation: unknown): string[] => {
  if (!isPlain(mutation)) return ["mutation: must be an object"];
  const errors: string[] = [];
  for (const name of Object.keys(mutation)) if (!mutationFields.includes(name)) errors.push(`${name}: unknown field`);
  const badId = problem("id", mutation.id);
  if (badId) errors.push(`id: ${badId}`);
  const table = lookup<Table>(tables, mutation.table);
  if (table === undefined) errors.push(`table: unknown table ${show(mutation.table)}`);
  if (!ops.includes(mutation.op as string)) errors.push(`op: must be one of ${ops.join(", ")}`);
  else if (mutation.op === "delete" && mutation.table === "settings") errors.push("op: settings are never deleted");
  if (table !== undefined) {
    const badRow = problem(table.columns[table.key].type, mutation.row_id);
    if (badRow) errors.push(`row_id: ${badRow}`);
  }
  if (!isPlain(mutation.patch)) errors.push("patch: must be an object");
  else if (mutation.op === "delete" && Object.keys(mutation.patch).length > 0) errors.push("patch: must be empty for delete");
  else if (mutation.op === "create" && table !== undefined) {
    if (mutation.patch[table.key] !== mutation.row_id) errors.push(`patch.${table.key}: must equal row_id`);
    for (const e of validateCreate(mutation.table, mutation.patch)) errors.push(`patch.${e}`);
  }
  return errors;
};
