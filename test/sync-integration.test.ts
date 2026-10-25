import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 54871;
const base = `http://127.0.0.1:${PORT}`;
const root = new URL("..", import.meta.url).pathname;
const persist = mkdtempSync(join(tmpdir(), "nestora-integration-"));
const env = { ...process.env, CLOUDFLARE_ENV: "dev", WRANGLER_SEND_METRICS: "false", NESTORA_PERSIST_TO: persist };

const now = "2026-10-01T00:00:00Z";

const call = async (input: string, init?: RequestInit) => {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(input, init).catch((error: Error) => error);
    if (attempt === 3 || (res instanceof Response && res.status !== 500)) {
      if (res instanceof Error) throw res;
      return res;
    }
  }
};

test("the dev Worker serves health and an authenticated sync round trip", { timeout: 120_000 }, async () => {
  const migrate = spawnSync("node_modules/.bin/wrangler", ["d1", "migrations", "apply", "wp", "--local", "--env", "dev", "--persist-to", persist], { cwd: root, env, encoding: "utf8" });
  assert.equal(migrate.status, 0, migrate.stderr);
  const server = spawn("node_modules/.bin/vite", ["--port", String(PORT), "--strictPort", "--host", "127.0.0.1"], { cwd: root, env, stdio: "ignore" });
  let exited = false;
  server.on("exit", () => (exited = true));
  try {
    let ready = false;
    for (let i = 0; i < 100 && !ready && !exited; i++) {
      ready = await fetch(`${base}/api/health`).then((r) => r.ok, () => false);
      if (!ready) await sleep(300);
    }
    assert.ok(ready, "dev server did not start");
    assert.deepEqual(await (await call(`${base}/api/health`)).json(), { ok: true });
    const taskId = crypto.randomUUID();
    const create = (table: string, row: Record<string, unknown>) => ({ id: crypto.randomUUID(), table, op: "create", row_id: row.id, patch: row });
    const mutations = [
      create("items", { id: taskId, kind: "task", title: "Task", status: "todo", created_at: now, updated_at: now }),
    ];
    const post = (body: unknown) => call(`${base}/api/sync`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
    const first = await post({ mutations });
    assert.equal(first.status, 200);
    const result = (await first.json()) as { rev: number; rows: { items: { id: string; updated_by: string }[] } };
    assert.deepEqual(result.rows.items.map((row) => row.id), [taskId]);
    assert.equal(result.rows.items[0].updated_by, "a");
    const replay = (await (await post({ mutations })).json()) as { rev: number };
    assert.equal(replay.rev, result.rev);
    const pulled = (await (await call(`${base}/api/sync?since=${result.rev - 1}`)).json()) as { rev: number; me: string; changes: { items: { id: string }[] } };
    assert.equal(pulled.me, "a");
    assert.ok(pulled.changes.items.some((row) => row.id === taskId));
    const routineId = crypto.randomUUID();
    const stepId = crypto.randomUUID();
    const private_ = await post({
      mutations: [
        create("items", { id: routineId, kind: "routine", title: "Morning routine", who: "a", data: { private: true }, created_at: now, updated_at: now }),
        create("items", { id: stepId, kind: "step", parent_id: routineId, title: "item 1", created_at: now, updated_at: now }),
      ],
    });
    assert.equal(private_.status, 200);
    const own = (await (await call(`${base}/api/sync?since=0`)).json()) as { changes: { items: { id: string }[] } };
    const made = new Set<string>([routineId, stepId]);
    assert.deepEqual(own.changes.items.map((row) => row.id).filter((rowId) => made.has(rowId)).sort(), [routineId, stepId].sort());
    const rejected = await post({ mutations: [{ id: crypto.randomUUID(), table: "items", op: "delete", row_id: crypto.randomUUID(), patch: {} }] });
    assert.equal(rejected.status, 404);
    assert.equal((await call(`${base}/api/sync`, { method: "PUT" })).status, 405);
    assert.equal((await call(`${base}/api/sync`, { method: "POST", body: JSON.stringify({ mutations }) })).status, 415);
    const foreign = await call(`${base}/api/sync`, { method: "POST", body: "{}", headers: { "content-type": "application/json", origin: "https://evil.example.test" } });
    assert.equal(foreign.status, 403);
  } finally {
    server.kill();
    if (!exited) await new Promise((resolve) => server.once("exit", resolve));
    rmSync(persist, { recursive: true, force: true });
  }
});
