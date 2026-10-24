import { test } from "node:test";
import assert from "node:assert/strict";
import type { Rejection, Side, SyncResult } from "../shared/api.ts";
import { tableNames } from "../shared/tables.ts";
import { exportData } from "../worker/export.ts";
import worker from "../worker/index.ts";
import type { Bindings } from "../worker/index.ts";
import { hides } from "../worker/private.ts";
import { getSync, pull } from "../worker/sync.ts";
import { CLIENT_STAMP, apply, count, createDb, currentRev, id, mutation, stored, task } from "./sync-db.ts";

type Obj = Record<string, unknown>;
type Env = ReturnType<typeof createDb>;

const stamps = { created_at: CLIENT_STAMP, updated_at: CLIENT_STAMP };
const other = (side: Side): Side => (side === "a" ? "b" : "a");
const MARK = (side: Side) => `Partner ${side.toUpperCase()} private`;

const routine = (n: number, extra: Obj = {}) =>
  mutation("create", "items", id(n), { id: id(n), kind: "routine", title: "Morning routine", who: "a", ...stamps, ...extra });
const secret = (n: number, side: Side, extra: Obj = {}) =>
  routine(n, { title: `${MARK(side)} routine`, who: side, data: { private: true }, ...extra });
const action = (n: number, parent: number, kind = "step", extra: Obj = {}) =>
  mutation("create", "items", id(n), { id: id(n), kind, parent_id: id(parent), title: "item 1", ...stamps, ...extra });
const secretAction = (n: number, parent: number, side: Side, kind = "step") => action(n, parent, kind, { title: `${MARK(side)} item ${n}` });
const patch = (n: number, fields: Obj) => mutation("update", "items", id(n), fields);

const ok = async (env: Env, mutations: unknown[], who: Side) => {
  const result = await apply(env.db, mutations, who);
  assert.equal("errors" in result, false, JSON.stringify(result));
  return result as SyncResult;
};

const refused = async (env: Env, mutations: unknown[], who: Side, status: number, pattern: RegExp) => {
  const before = JSON.stringify(env.sqlite.prepare("SELECT * FROM items ORDER BY id").all());
  const rev = currentRev(env.sqlite);
  const result = (await apply(env.db, mutations, who)) as Rejection;
  assert.equal(result.status, status, JSON.stringify(result));
  assert.match(result.errors.join("\n"), pattern);
  assert.equal(JSON.stringify(env.sqlite.prepare("SELECT * FROM items ORDER BY id").all()), before);
  assert.equal(currentRev(env.sqlite), rev);
  return result;
};

const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort();

const call = (who: Side, db: Env["db"], path: string, init?: RequestInit) =>
  worker.fetch(new Request(`https://wp.example.test${path}`, init), { DB: db, DESIGN: { get: async () => null }, AUTH_MODE: "dev", DEV_WHO: who } as Bindings);

const world = async () => {
  const env = createDb();
  await ok(env, [secret(1, "a"), secretAction(2, 1, "a"), secretAction(3, 1, "a", "counter"), secret(9, "a")], "a");
  await ok(env, [secret(4, "b"), secretAction(5, 4, "b")], "b");
  await ok(env, [routine(6), action(7, 6), routine(8, { who: "both" })], "a");
  await ok(env, [task(20), action(21, 8)], "b");
  return env;
};

const SECRET_A = [1, 2, 3, 9].map(id);
const SECRET_B = [4, 5].map(id);
const SHARED = [6, 7, 8, 20, 21].map(id);
const hiddenFrom = (side: Side) => (side === "a" ? SECRET_B : SECRET_A);
const ownRows = (side: Side) => (side === "a" ? SECRET_A : SECRET_B);

test("a full pull returns shared rows and the caller's own private rows, never the other side's", async () => {
  const env = await world();
  for (const side of ["a", "b"] as const) {
    const { changes, rev } = await pull(env.db, 0, side);
    assert.deepEqual(ids(changes.items), [...SHARED, ...ownRows(side)].sort());
    assert.equal(rev, currentRev(env.sqlite));
    assert.equal(JSON.stringify(changes).includes(MARK(other(side))), false);
  }
});

test("a pull since any revision never returns the other side's private rows, and the pulls together equal a full pull", async () => {
  const env = await world();
  const top = currentRev(env.sqlite);
  for (const side of ["a", "b"] as const) {
    const seen = new Set<string>();
    for (let since = 0; since <= top; since++) {
      const { changes } = await pull(env.db, since, side);
      for (const row of changes.items) {
        assert.equal(hiddenFrom(side).includes(row.id), false, `${side} since ${since}`);
        seen.add(row.id);
      }
      for (const name of tableNames) for (const row of changes[name]) assert.ok((row as { rev: number }).rev > since);
    }
    assert.deepEqual([...seen].sort(), ids((await pull(env.db, 0, side)).changes.items));
  }
});

test("the same holds through GET /api/sync for each identity, and a forged who is ignored", async () => {
  const env = await world();
  for (const side of ["a", "b"] as const) {
    for (const path of ["/api/sync", "/api/sync?since=0", `/api/sync?since=0&who=${other(side)}`]) {
      const res = await call(side, env.db, path, { headers: { "x-who": other(side), "x-wp-who": other(side) } });
      const body = (await res.json()) as { me: Side; changes: { items: { id: string }[] } };
      assert.equal(body.me, side);
      assert.deepEqual(ids(body.changes.items), [...SHARED, ...ownRows(side)].sort());
      assert.equal(JSON.stringify(body).includes(MARK(other(side))), false);
    }
  }
  const res = await getSync(new URL("https://wp.example.test/api/sync?since=0"), env.db, "b");
  assert.equal(JSON.stringify(await res.json()).includes(MARK("a")), false);
});

test("the json export holds the caller's own private rows and shared rows, tombstones included, and nothing of the other side", async () => {
  const env = await world();
  await ok(env, [mutation("delete", "items", id(1)), mutation("delete", "items", id(2))], "a");
  await ok(env, [mutation("delete", "items", id(4))], "b");
  for (const side of ["a", "b"] as const) {
    const res = await exportData(new URL("https://wp.example.test/api/export?format=json"), env.db, side);
    const body = (await res.json()) as { tables: { items: { id: string; deleted_at: string | null }[] } };
    const mine = ownRows(side);
    assert.deepEqual(ids(body.tables.items), [...SHARED, ...mine].sort());
    assert.equal(JSON.stringify(body).includes(MARK(other(side))), false);
    assert.ok(body.tables.items.some((row) => row.id === mine[0] && row.deleted_at !== null));
    const viaWorker = await call(side, env.db, "/api/export?format=json");
    assert.equal(JSON.stringify(await viaWorker.json()).includes(MARK(other(side))), false);
  }
});

test("the csv export of every routine kind skips the other side's private rows", async () => {
  const env = await world();
  await ok(env, [secretAction(30, 1, "a", "text"), secretAction(31, 1, "a", "pack"), secretAction(32, 1, "a", "block"), secretAction(33, 1, "a", "timer"), secretAction(34, 1, "a", "day_type")], "a");
  await ok(env, [secretAction(35, 4, "b", "text")], "b");
  for (const side of ["a", "b"] as const) {
    for (const kind of ["routine", "step", "timer", "pack", "block", "day_type", "counter", "text"]) {
      for (const via of ["direct", "worker"]) {
        const query = `format=csv&table=items&kind=${kind}`;
        const res =
          via === "direct"
            ? await exportData(new URL(`https://wp.example.test/api/export?${query}`), env.db, side)
            : await call(side, env.db, `/api/export?${query}`);
        const text = await res.text();
        assert.equal(text.includes(MARK(other(side))), false, `${side} ${kind} ${via}`);
      }
    }
    const own = await (await exportData(new URL("https://wp.example.test/api/export?format=csv&table=items&kind=routine"), env.db, side)).text();
    assert.equal(own.includes(`${MARK(side)} routine`), true);
    assert.equal(own.includes("Morning routine"), true);
  }
});

test("a private row can be created or edited only by its owner, and the other side sees it as a missing row", async () => {
  const env = await world();
  const absent = (await apply(env.db, [patch(99, { title: "x" })], "b")) as Rejection;
  const ghost = (await apply(env.db, [mutation("delete", "items", id(99))], "b")) as Rejection;
  for (const target of [1, 2, 3]) {
    const edit = await refused(env, [patch(target, { title: "changed" })], "b", 404, /row_id: no such row/);
    assert.deepEqual({ status: edit.status, errors: edit.errors }, { status: absent.status, errors: absent.errors });
    const remove = await refused(env, [mutation("delete", "items", id(target))], "b", 404, /row_id: no such row/);
    assert.deepEqual({ status: remove.status, errors: remove.errors }, { status: ghost.status, errors: ghost.errors });
    await refused(env, [patch(target, { deleted_at: null })], "b", 404, /no such row/);
    await refused(env, [patch(target, { data: { done_b: "2026-10-24" } })], "b", 404, /no such row/);
  }
  assert.equal(stored(env.sqlite, "items", id(1))?.title, `${MARK("a")} routine`);
  assert.equal(stored(env.sqlite, "items", id(1))?.updated_by, "a");
  for (const target of [4, 5]) await refused(env, [patch(target, { title: "changed" })], "a", 404, /no such row/);
  await ok(env, [patch(1, { note: "mine" })], "a");
  await ok(env, [patch(4, { note: "mine" })], "b");
});

test("accepted limit: the other partner's private write moves the served rev in a pull, a push response and the json export, and no row appears", async () => {
  const env = await world();
  const before = currentRev(env.sqlite);
  await ok(env, [patch(1, { note: "private edit" })], "a");
  assert.equal(currentRev(env.sqlite), before + 1);
  const quiet = await pull(env.db, before, "b");
  assert.deepEqual([quiet.rev, quiet.changes.items], [before + 1, []]);
  const viaHttp = (await (await call("b", env.db, `/api/sync?since=${before}`)).json()) as { rev: number; changes: { items: unknown[] } };
  assert.deepEqual([viaHttp.rev, viaHttp.changes.items], [before + 1, []]);
  const exported = (await (await call("b", env.db, "/api/export?format=json")).json()) as { rev: number };
  assert.equal(exported.rev, before + 1);
  const pushed = await ok(env, [task(50)], "b");
  assert.equal(pushed.rev, before + 2);
  assert.deepEqual(ids(pushed.rows.items), [id(50)]);
  assert.deepEqual(ids((await pull(env.db, before, "b")).changes.items), [id(50)]);
});

test("accepted limit: a create on a hidden id answers 404 while a create on an absent id succeeds", async () => {
  const env = await world();
  const absent = await ok(env, [task(60)], "b");
  assert.deepEqual(ids(absent.rows.items), [id(60)]);
  const hidden = await refused(env, [task(1)], "b", 404, /row_id: no such row/);
  assert.deepEqual(hidden.errors, ["row_id: no such row"]);
});

test("a create that reuses the id of a hidden row is refused and changes nothing", async () => {
  const env = await world();
  await refused(env, [routine(1, { title: "overwrite" })], "b", 404, /row_id: no such row/);
  await refused(env, [action(2, 6, "step", { title: "overwrite" })], "b", 404, /row_id: no such row/);
  await refused(env, [task(1)], "b", 404, /row_id: no such row/);
  assert.equal(stored(env.sqlite, "items", id(1))?.kind, "routine");
  assert.equal(count(env.sqlite, "items"), 11);
});

test("an action cannot be added to the other side's private routine, and the answer matches a missing parent", async () => {
  const env = await world();
  const missing = (await apply(env.db, [action(40, 99)], "b")) as Rejection;
  assert.equal(missing.status, 409);
  const hidden = await refused(env, [action(40, 1)], "b", 409, /parent_id: must point at a live items row/);
  assert.deepEqual(hidden.errors, missing.errors);
  for (const kind of ["step", "timer", "pack", "block", "day_type", "counter", "text"]) {
    await refused(env, [action(40, 1, kind)], "b", 409, /parent_id: must point at a live items row/);
    await refused(env, [action(40, 4, kind)], "a", 409, /parent_id: must point at a live items row/);
  }
  await refused(env, [action(40, 1, "step", { data: { private: false } })], "b", 400, /data\.private: unknown key/);
});

test("an action cannot be pointed at a hidden action, and the answer matches a missing row", async () => {
  const env = await world();
  const missing = (await apply(env.db, [patch(7, { parent_id: id(99) })], "b")) as Rejection;
  const hidden = await refused(env, [patch(7, { parent_id: id(2) })], "b", 409, /parent_id: must point at a live items row/);
  assert.deepEqual(hidden.errors, missing.errors);
  await refused(env, [patch(7, { parent_id: id(5) })], "a", 409, /parent_id: must point at a live items row/);
  await refused(env, [action(40, 2)], "b", 409, /parent_id: must point at a live items row/);
});

test("an action added later under a private routine is private too, and a tombstoned routine keeps its actions hidden", async () => {
  const env = await world();
  await ok(env, [secretAction(41, 1, "a", "timer")], "a");
  assert.equal(ids((await pull(env.db, 0, "b")).changes.items).includes(id(41)), false);
  await ok(env, [mutation("delete", "items", id(1))], "a");
  const { changes } = await pull(env.db, 0, "b");
  for (const hiddenId of [id(1), id(2), id(3), id(41)]) assert.equal(ids(changes.items).includes(hiddenId), false);
  const mine = await pull(env.db, 0, "a");
  assert.equal(ids(mine.changes.items).includes(id(41)), true);
  await ok(env, [patch(1, { deleted_at: null })], "a");
  await refused(env, [patch(1, { deleted_at: null })], "b", 404, /no such row/);
});

test("the private flag and the owner of a private routine cannot change after creation", async () => {
  const env = await world();
  await refused(env, [patch(1, { data: { private: false } })], "a", 409, /data\.private: cannot be changed after creation/);
  await refused(env, [patch(1, { data: { private: null } })], "a", 409, /data\.private: cannot be changed after creation/);
  await refused(env, [patch(6, { data: { private: true } })], "a", 409, /data\.private: cannot be changed after creation/);
  await refused(env, [patch(6, { data: { private: true } })], "b", 409, /data\.private: cannot be changed after creation/);
  await refused(env, [patch(8, { data: { private: true } })], "b", 409, /data\.private: cannot be changed after creation/);
  await refused(env, [patch(1, { who: "b" })], "a", 409, /who: cannot be changed on a private routine/);
  await refused(env, [patch(1, { who: "both" })], "a", 409, /who: cannot be changed on a private routine/);
  await refused(env, [patch(4, { who: "a" })], "b", 409, /who: cannot be changed on a private routine/);
  await refused(env, [patch(4, { who: "both" })], "b", 409, /who: cannot be changed on a private routine/);
  await refused(env, [patch(6, { who: "b", data: { private: true } })], "a", 409, /cannot be changed after creation/);
  await ok(env, [patch(1, { data: { private: true }, note: "same value" }), patch(6, { data: { private: false }, who: "b" })], "a");
  await ok(env, [patch(8, { who: "a" })], "b");
  assert.equal(JSON.parse(stored(env.sqlite, "items", id(6))?.data as string).private, false);
  assert.equal(ids((await pull(env.db, 0, "b")).changes.items).includes(id(6)), true);
});

test("a private routine must belong to the signed-in side, and never to both", async () => {
  const env = createDb();
  await refused(env, [secret(1, "b")], "a", 409, /who: a private routine must belong to you/);
  await refused(env, [secret(1, "a")], "b", 409, /who: a private routine must belong to you/);
  await refused(env, [routine(1, { who: "both", data: { private: true } })], "a", 409, /who: a private routine must belong to you/);
  await refused(env, [routine(1, { who: "b", data: { private: true } })], "a", 409, /who: a private routine must belong to you/);
  await ok(env, [routine(1, { who: "b", data: { private: false } }), secret(2, "a")], "a");
  assert.deepEqual(ids((await pull(env.db, 0, "b")).changes.items), [id(1)]);
  await ok(env, [secret(3, "b"), routine(4, { data: { private: false } })], "b");
});

test("an action cannot move between routines of different visibility, in either direction or by either side", async () => {
  const env = await world();
  await refused(env, [patch(2, { parent_id: id(6) })], "a", 409, /parent_id: must keep the routine's visibility/);
  await refused(env, [patch(7, { parent_id: id(1) })], "a", 409, /parent_id: must keep the routine's visibility/);
  await refused(env, [patch(2, { parent_id: id(4) })], "a", 409, /parent_id: must point at a live items row/);
  await refused(env, [patch(2, { parent_id: id(6) })], "b", 404, /no such row/);
  await refused(env, [patch(7, { parent_id: id(1) })], "b", 409, /parent_id: must point at a live items row/);
  await refused(env, [patch(7, { parent_id: id(4) })], "b", 409, /parent_id: must keep the routine's visibility/);
  await refused(env, [patch(5, { parent_id: id(6) })], "b", 409, /parent_id: must keep the routine's visibility/);
  await ok(env, [patch(2, { parent_id: id(9) })], "a");
  await ok(env, [patch(7, { parent_id: id(8) })], "b");
  await ok(env, [patch(7, { parent_id: id(6) }), patch(7, { parent_id: id(8) })], "a");
  assert.equal(stored(env.sqlite, "items", id(2))?.parent_id, id(9));
});

test("moving an action to a tombstoned private routine or from one is still refused across visibility", async () => {
  const env = await world();
  await ok(env, [mutation("delete", "items", id(9))], "a");
  await refused(env, [patch(2, { parent_id: id(9) })], "a", 409, /live items row/);
  await ok(env, [mutation("delete", "items", id(6))], "a");
  await refused(env, [patch(2, { parent_id: id(6) })], "a", 409, /live items row/);
  await ok(env, [mutation("delete", "items", id(1))], "a");
  await refused(env, [patch(2, { parent_id: id(8) })], "a", 409, /visibility/);
});

test("the client cannot claim updated_by, rev or a visibility column, and the stored author is the signed-in side", async () => {
  const env = await world();
  await refused(env, [routine(50, { updated_by: "a" })], "b", 400, /updated_by: set by the server/);
  await refused(env, [patch(6, { updated_by: "a" })], "b", 400, /updated_by: set by the server/);
  await refused(env, [patch(6, { rev: 1 })], "b", 400, /rev: set by the server/);
  await refused(env, [routine(50, { private: true })], "b", 400, /private: unknown column/);
  await refused(env, [routine(50, { visible_to: "a" })], "b", 400, /visible_to: unknown column/);
  await ok(env, [patch(6, { note: "by b" })], "b");
  assert.equal(stored(env.sqlite, "items", id(6))?.updated_by, "b");
  const forged = await call("b", env.db, "/api/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ who: "a", mutations: [] }),
  });
  assert.equal(forged.status, 400);
  const spoof = await call("b", env.db, "/api/sync", {
    method: "POST",
    headers: { "content-type": "application/json", "x-who": "a" },
    body: JSON.stringify({ mutations: [patch(1, { title: "spoofed" })] }),
  });
  assert.equal(spoof.status, 404);
  assert.equal(stored(env.sqlite, "items", id(1))?.title, `${MARK("a")} routine`);
});

test("a private action takes no private key of its own, so a forged flag on an action changes nothing", async () => {
  const env = await world();
  await refused(env, [patch(2, { data: { private: false } })], "a", 400, /data\.private: unknown key/);
  await refused(env, [patch(7, { data: { private: true } })], "a", 400, /data\.private: unknown key/);
  await refused(env, [action(40, 1, "step", { data: { private: false } })], "a", 400, /data\.private: unknown key/);
  await refused(env, [action(40, 6, "step", { data: { private: true } })], "a", 400, /data\.private: unknown key/);
  assert.equal(ids((await pull(env.db, 0, "b")).changes.items).includes(id(2)), false);
});

test("a push response carries only rows the caller may see", async () => {
  const env = await world();
  const result = await ok(env, [patch(1, { note: "n" }), patch(2, { note: "n" })], "a");
  assert.deepEqual(ids(result.rows.items), [id(1), id(2)]);
  const shared = await ok(env, [patch(6, { note: "n" }), action(60, 6)], "b");
  assert.deepEqual(ids(shared.rows.items), [id(6), id(60)]);
  const racing = {
    ...env.db,
    batch: async (statements: Parameters<Env["db"]["batch"]>[0]) => {
      if (statements.length > tableNames.length + 1) env.sqlite.exec(`UPDATE items SET data = '{"private":true}' WHERE id = '${id(6)}'`);
      return env.db.batch(statements);
    },
  };
  const result2 = (await apply(racing, [patch(7, { note: "raced" })], "b")) as SyncResult;
  assert.deepEqual(ids(result2.rows.items), []);
  assert.equal(ids((await pull(env.db, 0, "b")).changes.items).includes(id(7)), false);
});

test("revision gaps: private writes advance rev without showing rows, and a cursor never loses a shared row", async () => {
  const env = await world();
  const before = currentRev(env.sqlite);
  await ok(env, [patch(1, { note: "private edit 1" })], "a");
  await ok(env, [patch(2, { note: "private edit 2" })], "a");
  const quiet = await pull(env.db, before, "b");
  assert.equal(quiet.rev, before + 2);
  assert.deepEqual(quiet.changes.items, []);
  await ok(env, [patch(6, { note: "shared edit" })], "a");
  await ok(env, [patch(3, { note: "private edit 3" })], "a");
  const next = await pull(env.db, quiet.rev, "b");
  assert.deepEqual(ids(next.changes.items), [id(6)]);
  assert.equal(next.rev, quiet.rev + 2);
  assert.deepEqual((await pull(env.db, next.rev, "b")).changes.items, []);
  const ownerSide = await pull(env.db, before, "a");
  assert.deepEqual(ids(ownerSide.changes.items), [id(1), id(2), id(3), id(6)]);
});

test("a request mixing own private rows and shared rows works in order, and a rejection later in it writes nothing", async () => {
  const env = createDb();
  await ok(env, [secret(1, "a"), secretAction(2, 1, "a"), patch(2, { note: "x" }), routine(3), action(4, 3)], "a");
  assert.deepEqual(ids((await pull(env.db, 0, "b")).changes.items), [id(3), id(4)]);
  await refused(env, [routine(5), patch(1, { title: "nope" })], "b", 404, /no such row/);
  assert.equal(stored(env.sqlite, "items", id(5)), undefined);
  await refused(env, [secret(5, "a"), patch(1, { data: { private: false } })], "a", 409, /cannot be changed after creation/);
});

test("other tables are never filtered, and non-routine rows are untouched", async () => {
  const env = await world();
  const { changes } = await pull(env.db, 0, "b");
  assert.equal(changes.items.some((row) => row.id === id(20)), true);
  assert.equal(changes.items.some((row) => row.kind === "routine" && row.id === id(8)), true);
});

test("the sql filter and the push-side predicate agree on every kind of row", async () => {
  const kinds = ["routine", "step", "task", "copy"];
  const flags: (boolean | undefined)[] = [true, false, undefined];
  for (const side of ["a", "b"] as const) {
    const env = createDb();
    const rows: Obj[] = [];
    let n = 0;
    const insert = (row: Obj) => {
      const full: Obj = { id: id(++n), title: "x", ...row };
      const data = full.data === undefined ? null : JSON.stringify(full.data);
      env.sqlite
        .prepare("INSERT INTO items (id, kind, parent_id, title, who, data, rev, created_at, updated_at, currency, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(full.id as string, full.kind as string, (full.parent_id ?? null) as string | null, "x", (full.who ?? null) as string | null, data, n, CLIENT_STAMP, CLIENT_STAMP, "IDR", 0);
      rows.push({ ...full, data: full.data ?? null });
      return full.id as string;
    };
    const parents = new Map<string, Obj>();
    for (const who of ["a", "b", "both", null]) {
      for (const flag of flags) {
        const pid = insert({ kind: "routine", who, data: flag === undefined ? {} : { private: flag } });
        parents.set(pid, rows.at(-1)!);
      }
    }
    for (const [pid] of parents) for (const kind of kinds) insert({ kind, parent_id: pid });
    for (const kind of kinds) for (const who of ["a", "b", "both", null]) for (const flag of flags) insert({ kind, who, data: flag === undefined ? {} : { private: flag } });
    insert({ kind: "task" });
    const shown = new Set(ids((await pull(env.db, 0, side)).changes.items));
    for (const row of rows) {
      const parent = row.parent_id === null ? undefined : parents.get(row.parent_id as string);
      assert.equal(shown.has(row.id as string), !hides(row, parent, side), `${side} ${JSON.stringify(row)}`);
    }
    assert.ok(shown.size > 0 && shown.size < rows.length);
  }
});
