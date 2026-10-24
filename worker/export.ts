import { toInstant } from "../shared/api.ts";
import { tables } from "../shared/tables.ts";
import type { Variant } from "../shared/tables.ts";
import type { Side } from "../shared/api.ts";
import { gate } from "./private.ts";
import { json, pull, reject } from "./sync.ts";
import type { Db } from "./sync.ts";

const FORMULA = /^[=+\-@\t\r]/;

const cell = (value: unknown) => {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && FORMULA.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const attachment = (filename: string) => ({ "content-disposition": `attachment; filename="${filename}"` });

const exportCsv = async (url: URL, db: Db, who: Side) => {
  const name = url.searchParams.get("table") ?? "";
  if (name !== "items" && name !== "budget_entries") return reject(400, ["table: must be items or budget_entries"]);
  const table = tables[name];
  const kind = url.searchParams.get(table.by) ?? "";
  const variants: Record<string, Variant> = table.variants;
  if (!Object.hasOwn(variants, kind)) return reject(400, [`${table.by}: must be one of ${Object.keys(variants).join(", ")}`]);
  const variant = variants[kind];
  const columns = Object.keys(table.columns).filter(
    (column) => column !== "data" && (table.common.includes(column) || variant.columns.includes(column)),
  );
  const dataKeys = Object.keys(variant.data);
  const [filter, params] = gate(name, who);
  const { results } = await db
    .prepare(`SELECT * FROM ${name} WHERE ${table.by} = ? AND deleted_at IS NULL ${filter} ORDER BY sort, created_at, ${table.key}`)
    .bind(kind, ...params)
    .all();
  const lines = [[...columns, ...dataKeys.map((key) => `data.${key}`)]];
  for (const row of results) {
    const data = typeof row.data === "string" ? (JSON.parse(row.data) as Record<string, unknown>) : {};
    lines.push([...columns.map((column) => row[column]), ...dataKeys.map((key) => data[key])] as string[]);
  }
  const body = lines.map((line) => line.map(cell).join(",") + "\r\n").join("");
  return new Response(body, {
    headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store", ...attachment(`${name}-${kind}.csv`) },
  });
};

export const exportData = async (url: URL, db: Db, who: Side) => {
  const format = url.searchParams.get("format");
  if (format === "csv") return exportCsv(url, db, who);
  if (format !== "json") return reject(400, ["format: must be json or csv"]);
  const { rev, changes } = await pull(db, 0, who);
  const exportedAt = toInstant(new Date());
  return json(
    { format_version: 1, exported_at: exportedAt, rev, tables: changes },
    200,
    attachment(`export-${exportedAt.slice(0, 10)}.json`),
  );
};
