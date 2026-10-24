import { MAX_BODY_BYTES, MAX_MUTATIONS, applyPatch, toInstant } from "../shared/api.ts";
import type { Changes, Mutation, Side } from "../shared/api.ts";
import { tableNames, tables } from "../shared/tables.ts";
import type { Column, TableName } from "../shared/tables.ts";
import { validateChange, validateMutation } from "../shared/validate.ts";
import type { Fetch } from "../src/store/api.ts";
import { hides } from "../worker/private.ts";

type Dict = Record<string, unknown>;
type State = Record<TableName, Map<string, Dict>>;

export type Session = "ok" | "redirect" | "html" | "unauthorized" | "forbidden";

export type Seen = {
  method: string;
  mutations: number;
  bytes: number;
  since?: number;
  contentType: string | null;
  origin: string | null;
  redirect: string | null;
  signal: boolean;
};

const references = [
  ["vendor_id", "items", "kind", "vendor"],
  ["budget_id", "budget_entries", "entry_type", "planned"],
] as const;

type Refusal = { status: number; errors: string[] };

const json = (status: number, body: unknown) => Response.json(body, { status });

const refuse = (status: number, errors: string[], index?: number) =>
  json(status, index === undefined ? { status, errors } : { status, errors, index });

const copy = (state: State): State =>
  Object.fromEntries(tableNames.map((table) => [table, new Map(state[table])])) as State;

const blank = (table: TableName, patch: Dict): Dict =>
  Object.fromEntries(
    Object.entries(tables[table].columns as Record<string, Column>).map(([name, column]) => [
      name,
      patch[name] ?? column.default ?? null,
    ]),
  );

let epochs = 0;

const newEpoch = () => String(++epochs).padStart(32, "0");

export const createServer = () => {
  let rev = 0;
  let epoch = newEpoch();
  let state: State = Object.fromEntries(tableNames.map((table) => [table, new Map()])) as State;
  const seen: Seen[] = [];
  const control = { down: false, session: "ok" as Session, fail: [] as number[], photo: null as string | null, onMe: null as (() => Promise<void>) | null };
  const asked: Seen[] = [];

  const pointers = (draft: State, table: TableName, row: Dict, columns: readonly string[]): Refusal | null => {
    const errors: string[] = [];
    if (table === "settings") return null;
    for (const [column, targetTable, kindColumn, kind] of references) {
      if (!columns.includes(column) || row[column] == null) continue;
      const target = draft[targetTable].get(row[column] as string);
      if (!target || target.deleted_at !== null || target[kindColumn] !== kind) {
        errors.push(`${column}: must point at a live ${kind}`);
      } else if (column === "budget_id" && target.currency !== row.currency) {
        errors.push("currency: must equal the planned row's currency");
      }
    }
    return errors.length > 0 ? { status: 409, errors } : null;
  };

  const apply = (
    draft: State,
    mutation: Mutation,
    side: Side,
    at: string,
    next: number,
    wrote: Set<string>,
  ): Refusal | null => {
    const { table, row_id: id, patch } = mutation;
    const row = draft[table].get(id);
    const write = (value: Dict) => {
      draft[table].set(id, { ...value, rev: next, updated_by: side, updated_at: at });
      wrote.add(`${table}/${id}`);
    };
    if (mutation.op === "create") {
      if (row && table === "settings") write(applyPatch(row, { value: patch.value }));
      else if (!row) {
        const created = { ...blank(table, patch), ...patch, created_at: at, deleted_at: null };
        const refused = pointers(draft, table, created, Object.keys(patch));
        if (refused) return refused;
        write(created);
      }
      return null;
    }
    if (!row) return { status: 404, errors: ["row_id: no such row"] };
    if (mutation.op === "delete") {
      if (row.deleted_at === null) write({ ...row, deleted_at: at });
      return null;
    }
    const undo = Object.keys(patch).filter((key) => key !== "updated_at").join() === "deleted_at" && patch.deleted_at === null;
    if (row.deleted_at !== null && !undo) return null;
    const errors = validateChange(table, row, patch);
    if (errors.length > 0) return { status: 400, errors };
    const merged = applyPatch(row, patch);
    const refused = pointers(draft, table, merged, Object.keys(patch));
    if (refused) return refused;
    write(merged);
    return null;
  };

  const hidden = (table: TableName, row: Dict, side: Side) =>
    table === "items" && hides(row, state.items.get(row.parent_id as string), side);

  const changesSince = (since: number, side: Side): Changes => {
    const out = Object.fromEntries(tableNames.map((table) => [table, [] as Dict[]]));
    for (const table of tableNames) {
      for (const row of state[table].values()) if ((row.rev as number) > since && !hidden(table, row, side)) out[table].push(structuredClone(row));
    }
    return out as unknown as Changes;
  };

  const rowsOf = (mutations: readonly Mutation[], side: Side): Changes => {
    const out = Object.fromEntries(tableNames.map((table) => [table, new Map<string, Dict>()]));
    for (const { table, row_id } of mutations) {
      const row = state[table].get(row_id)!;
      if (!hidden(table, row, side)) out[table].set(row_id, structuredClone(row));
    }
    return Object.fromEntries(tableNames.map((table) => [table, [...out[table].values()]])) as unknown as Changes;
  };

  const post = (side: Side, text: string, headers: Headers, init: RequestInit) => {
    const bytes = Buffer.byteLength(text);
    if (bytes > MAX_BODY_BYTES) return refuse(413, ["body: too large"]);
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return refuse(400, ["body: must be JSON"]);
    }
    const dict = body as Dict;
    if (typeof body !== "object" || body === null || Object.keys(dict).join() !== "mutations" || !Array.isArray(dict.mutations)) {
      return refuse(400, ["body: must be an object with only a mutations array"]);
    }
    const mutations = dict.mutations as Mutation[];
    seen.push({ method: "POST", mutations: mutations.length, bytes, ...meta(headers, init) });
    if (mutations.length > MAX_MUTATIONS) return refuse(400, [`mutations: at most ${MAX_MUTATIONS}`]);
    for (const [index, mutation] of mutations.entries()) {
      const errors = validateMutation(mutation);
      if (errors.length > 0) return refuse(400, errors, index);
    }
    const draft = copy(state);
    const wrote = new Set<string>();
    const at = toInstant(new Date());
    for (const [index, mutation] of mutations.entries()) {
      const refused = apply(draft, mutation, side, at, rev + 1, wrote);
      if (refused) return refuse(refused.status, refused.errors, index);
    }
    state = draft;
    if (wrote.size > 0) rev += 1;
    return json(200, { rev, epoch, rows: rowsOf(mutations, side) });
  };

  const get = (side: Side, url: URL, headers: Headers, init: RequestInit) => {
    const since = url.searchParams.get("since") ?? "0";
    if (!/^\d+$/.test(since) || !Number.isSafeInteger(Number(since))) return refuse(400, ["since: must be a non-negative integer"]);
    seen.push({ method: "GET", mutations: 0, bytes: 0, since: Number(since), ...meta(headers, init) });
    return json(200, { rev, epoch, me: side, changes: changesSince(Number(since), side) });
  };

  const meta = (headers: Headers, init: RequestInit) => ({
    contentType: headers.get("content-type"),
    origin: headers.get("origin"),
    redirect: init.redirect ?? null,
    signal: init.signal instanceof AbortSignal,
  });

  const as =
    (side: Side): Fetch =>
    async (input, init) => {
      if (control.down) throw new TypeError("fetch failed");
      const url = new URL(input, "https://wp.example.test");
      if (control.session === "redirect") {
        if (init.redirect !== "manual") throw new TypeError("fetch failed: the login redirect was followed across origins");
        return new Response(null, { status: 302, headers: { location: "https://team.example.test/login" } });
      }
      if (control.session === "html") return new Response("<!doctype html><title>Sign in</title>", { headers: { "content-type": "text/html" } });
      if (control.session === "unauthorized") return json(401, { error: "unauthorized" });
      if (control.session === "forbidden") return json(403, { error: "forbidden" });
      if (url.pathname === "/api/me") {
        asked.push({ method: "GET", mutations: 0, bytes: 0, ...meta(new Headers(init.headers), init) });
        await control.onMe?.();
        return json(200, { photo: control.photo });
      }
      const failure = control.fail.shift();
      if (failure !== undefined) return new Response("upstream error", { status: failure });
      if (url.pathname !== "/api/sync") return json(404, { error: "not_found" });
      const headers = new Headers(init.headers);
      const origin = headers.get("origin");
      if ((origin !== null && origin !== url.origin) || ["cross-site", "same-site"].includes(headers.get("sec-fetch-site") ?? "")) {
        return refuse(403, ["origin: cross-origin requests are refused"]);
      }
      if (init.method === "POST" && !headers.get("content-type")?.startsWith("application/json")) {
        return refuse(415, ["content-type: must be application/json"]);
      }
      return init.method === "POST" ? post(side, String(init.body), headers, init) : get(side, url, headers, init);
    };

  return {
    as,
    control,
    seen,
    asked,
    row: (table: TableName, id: string) => state[table].get(id),
    rows: (table: TableName) => [...state[table].values()],
    wipe: () => {
      state = Object.fromEntries(tableNames.map((table) => [table, new Map()])) as State;
      rev = 0;
      epoch = newEpoch();
    },
    rewind: (to: number) => {
      for (const table of tableNames) for (const [key, row] of state[table]) if ((row.rev as number) > to) state[table].delete(key);
      rev = to;
    },
    get epoch() {
      return epoch;
    },
    set epoch(value: string) {
      epoch = value;
    },
    get rev() {
      return rev;
    },
  };
};

export type Server = ReturnType<typeof createServer>;
