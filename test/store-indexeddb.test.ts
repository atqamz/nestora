import { test } from "node:test";
import assert from "node:assert/strict";
import { tableNames } from "../shared/tables.ts";
import { indexedDbDisk, indexedDbPersistence } from "../src/store/db.ts";
import type { Persisted } from "../src/store/persistence.ts";

type Call = { transaction: number; store: string; op: string; args: unknown[] };

type Seed = Partial<Record<"items" | "budget_entries" | "settings" | "outbox", Record<string, unknown>[]>>;

const keyPaths: Record<string, string> = { items: "id", budget_entries: "id", settings: "key", outbox: "seq" };

const fakeIndexedDb = (meta: Record<string, unknown>, seed: Seed = {}, present: string[] = [], broken: string[] = []) => {
  const calls: Call[] = [];
  const created: string[] = [];
  const transactions: string[][] = [];
  const data = new Map<string, Map<unknown, unknown>>(
    ["items", "budget_entries", "settings", "outbox", "meta"].map((name) => [name, new Map()]),
  );
  for (const [key, value] of Object.entries(meta)) data.get("meta")!.set(key, value);
  for (const [store, rows] of Object.entries(seed)) for (const row of rows) data.get(store)!.set(row[keyPaths[store]], row);
  const answer = <T>(result: T) => {
    const request: { result: T; onsuccess?: () => void; onerror?: () => void } = { result };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  };
  const db = {
    createObjectStore: () => undefined,
    close: () => undefined,
    transaction: (names: string[], mode: string) => {
      const id = transactions.push(names);
      assert.equal(mode === "readwrite" || mode === "readonly", true);
      const before = new Map([...data].map(([name, held]) => [name, new Map(held)]));
      let aborted = false;
      const tx: { oncomplete?: () => void; onabort?: () => void; abort: () => void; objectStore: (name: string) => unknown } = {
        abort: () => {
          aborted = true;
          for (const [name, held] of before) data.set(name, held);
        },
        objectStore: (store) => {
          const held = data.get(store)!;
          const log = (op: string, args: unknown[]) => calls.push({ transaction: id, store, op, args });
          return {
            clear: () => {
              log("clear", []);
              held.clear();
            },
            put: (value: unknown, key?: unknown) => {
              log("put", key === undefined ? [value] : [value, key]);
              held.set(key ?? (value as Record<string, unknown>)[keyPaths[store]], value);
            },
            delete: (key: unknown) => {
              log("delete", [key]);
              held.delete(key);
            },
            getAll: () => answer([...held.values()]),
            get: (key: string) => answer(held.get(key)),
            count: () => answer(held.size),
          };
        },
      };
      setTimeout(() => (aborted ? tx.onabort?.() : tx.oncomplete?.()), 0);
      return tx;
    },
  };
  const indexedDB = {
    open: (name: string) => {
      let aborted = false;
      const request: { result: typeof db; error?: Error; transaction: { abort: () => void }; onupgradeneeded?: () => void; onsuccess?: () => void; onerror?: () => void } = {
        result: db,
        transaction: { abort: () => void (aborted = true) },
      };
      queueMicrotask(() => {
        if (broken.includes(name)) {
          request.error = new Error("the disk is gone");
          return request.onerror?.();
        }
        if (!present.includes(name)) request.onupgradeneeded?.();
        if (aborted) request.onerror?.();
        else {
          if (!present.includes(name)) created.push(name);
          request.onsuccess?.();
        }
      });
      return request;
    },
  };
  return { indexedDB, calls, transactions, created };
};

const withFake = async (meta: Record<string, unknown>, run: (fake: ReturnType<typeof fakeIndexedDb>) => Promise<void>, seed: Seed = {}, present: string[] = [], broken: string[] = []) => {
  const fake = fakeIndexedDb(meta, seed, present, broken);
  Object.assign(globalThis, { indexedDB: fake.indexedDB });
  try {
    await run(fake);
  } finally {
    Reflect.deleteProperty(globalThis, "indexedDB");
  }
};

const next = { epoch: "new", rev: 0, me: "a" } as const;

test("a reset clears the three row stores, the outbox and meta in one transaction, then writes the new meta with a fresh generation", async () => {
  await withFake({ generation: "g1" }, async ({ calls, transactions }) => {
    const generation = await indexedDbPersistence("fake").reset("g1", next);
    assert.match(generation ?? "", /^[0-9a-f-]{36}$/);
    assert.notEqual(generation, "g1");
    assert.equal(transactions.length, 1);
    assert.deepEqual(transactions[0].sort(), [...tableNames, "meta", "outbox"].sort());
    const clears = calls.filter((call) => call.op === "clear").map((call) => call.store);
    assert.deepEqual(clears.sort(), [...tableNames, "meta", "outbox"].sort());
    const puts = calls.filter((call) => call.op === "put");
    assert.deepEqual(puts.map((call) => [call.store, call.args[1], call.args[0]]), [
      ["meta", "epoch", "new"],
      ["meta", "rev", 0],
      ["meta", "me", "a"],
      ["meta", "generation", generation],
    ]);
    const lastClear = calls.map((call) => call.op).lastIndexOf("clear");
    const firstPut = calls.map((call) => call.op).indexOf("put");
    assert.ok(lastClear < firstPut);
    assert.equal(new Set(calls.map((call) => call.transaction)).size, 1);
  });
});

test("a reset does nothing when another tab has reset since the caller read its generation", async () => {
  await withFake({ generation: "written by the other tab", epoch: "same epoch" }, async ({ calls }) => {
    assert.equal(await indexedDbPersistence("fake").reset("g1", next), null);
    assert.equal(await indexedDbPersistence("fake").reset(null, next), null);
    assert.equal(calls.length, 0);
  });
});

test("a database that never reset has no generation, which matches only a caller that saw none", async () => {
  await withFake({ epoch: "same epoch" }, async ({ calls }) => {
    assert.equal(await indexedDbPersistence("fake").reset("g1", next), null);
    assert.equal(calls.length, 0);
    assert.notEqual(await indexedDbPersistence("fake").reset(null, next), null);
    assert.equal(calls.filter((call) => call.op === "clear").length, 5);
  });
});

test("a reset caused by a lower revision keeps the epoch and still changes the generation", async () => {
  await withFake({ epoch: "same epoch", generation: "g1" }, async ({ calls }) => {
    const generation = await indexedDbPersistence("fake").reset("g1", { epoch: "same epoch", rev: 0, me: "a" });
    assert.notEqual(generation, null);
    assert.notEqual(generation, "g1");
    assert.deepEqual(calls.filter((call) => call.op === "put").map((call) => call.args[1]), ["epoch", "rev", "me", "generation"]);
  });
});

const task = { id: "i1", kind: "task", title: "a task", rev: 3 };
const vendor = { id: "i2", kind: "vendor", title: "a vendor", rev: 4 };
const line = { id: "b1", entry_type: "planned", title: "a line", rev: 5 };
const setting = { key: "timezone", value: "UTC", rev: 6 };
const queued = [
  { seq: 1, id: "m1", table: "items", op: "create", row_id: "i1", patch: { title: "a task" }, at: "2026-10-06T00:00:00Z" },
  { seq: 2, id: "m2", table: "items", op: "update", row_id: "i2", patch: { title: "b" }, at: "2026-10-06T00:00:01Z", rejected: ["no"] },
];
const full: Seed = { items: [task, vendor], budget_entries: [line], settings: [setting], outbox: queued };

test("load returns every row by table, the outbox and all five meta values exactly as stored", async () => {
  await withFake({ rev: 7, me: "b", epoch: "e1", generation: "g1" }, async () => {
    assert.deepEqual(await indexedDbPersistence("fake").load(), {
      rows: { items: [task, vendor], budget_entries: [line], settings: [setting] },
      outbox: queued,
      meta: { rev: 7, me: "b", epoch: "e1", generation: "g1", adopted: null },
    });
  }, full);
});

test("load reads each meta key on its own: a missing key is null, a present one is never taken from another", async () => {
  const cases: [Record<string, unknown>, { rev: number; me: string | null; epoch: string | null; generation: string | null; adopted: null }][] = [
    [{ rev: 6, me: "a" }, { rev: 6, me: "a", epoch: null, generation: null, adopted: null }],
    [{ rev: 6, me: "a", epoch: "e1" }, { rev: 6, me: "a", epoch: "e1", generation: null, adopted: null }],
    [{ generation: "g1" }, { rev: 0, me: null, epoch: null, generation: "g1", adopted: null }],
    [{ epoch: "e1" }, { rev: 0, me: null, epoch: "e1", generation: null, adopted: null }],
    [{ rev: 9 }, { rev: 9, me: null, epoch: null, generation: null, adopted: null }],
    [{ me: "b" }, { rev: 0, me: "b", epoch: null, generation: null, adopted: null }],
    [{}, { rev: 0, me: null, epoch: null, generation: null, adopted: null }],
  ];
  for (const [meta, expected] of cases) {
    await withFake(meta, async () => {
      assert.deepEqual((await indexedDbPersistence("fake").load()).meta, expected, JSON.stringify(meta));
    });
  }
});

test("load of an old database with rows and an outbox but no epoch and no generation", async () => {
  await withFake({ rev: 7, me: "a" }, async () => {
    const loaded = await indexedDbPersistence("fake").load();
    assert.deepEqual(loaded.meta, { rev: 7, me: "a", epoch: null, generation: null, adopted: null });
    assert.deepEqual(loaded.rows.items, [task, vendor]);
    assert.deepEqual(loaded.outbox, queued);
  }, full);
});

test("a reset then a load returns empty stores, the new epoch, the new generation, and only that generation can reset again", async () => {
  await withFake({ rev: 7, me: "b", epoch: "e1" }, async () => {
    const persistence = indexedDbPersistence("fake");
    const first = await persistence.reset(null, { epoch: "e2", rev: 0, me: "a" });
    assert.notEqual(first, null);
    assert.deepEqual(await persistence.load(), {
      rows: { items: [], budget_entries: [], settings: [] },
      outbox: [],
      meta: { rev: 0, me: "a", epoch: "e2", generation: first, adopted: null },
    });
    assert.equal(await persistence.reset(null, { epoch: "e3", rev: 0, me: "a" }), null);
    assert.equal((await persistence.load()).meta.epoch, "e2");
    const second = await persistence.reset(first, { epoch: "e2", rev: 0, me: "a" });
    assert.notEqual(second, first);
    assert.deepEqual((await persistence.load()).meta, { rev: 0, me: "a", epoch: "e2", generation: second, adopted: null });
  }, full);
});

test("writes made after a reset are what the next load returns", async () => {
  await withFake({ rev: 7, me: "b", epoch: "e1", generation: "g1" }, async () => {
    const persistence = indexedDbPersistence("fake");
    const generation = await persistence.reset("g1", { epoch: "e2", rev: 0, me: "b" });
    await persistence.write({ outbox: { put: [queued[0] as never] }, rows: { items: [task as never] }, meta: { rev: 2 } });
    const loaded = await persistence.load();
    assert.deepEqual([loaded.rows.items, loaded.outbox, loaded.meta], [[task], [queued[0]], { rev: 2, me: "b", epoch: "e2", generation, adopted: null }]);
  }, full);
});

const snapshot = (over: Partial<Persisted> = {}): Persisted => ({
  rows: { items: [task, vendor] as never, budget_entries: [line] as never, settings: [setting] as never },
  outbox: queued as never,
  meta: { rev: 7, me: "a", epoch: "e1", generation: "g1", adopted: null },
  ...over,
});

test("adopt copies rows, outbox and meta into an empty partition in one transaction, and checks the counts in that transaction", async () => {
  await withFake({}, async ({ calls, transactions }) => {
    const persistence = indexedDbPersistence("fake");
    await persistence.adopt(snapshot());
    assert.equal(transactions.length, 1);
    assert.deepEqual(transactions[0].sort(), [...tableNames, "meta", "outbox"].sort());
    assert.deepEqual(await persistence.load(), snapshot());
    assert.equal(calls.filter((call) => call.op === "clear" || call.op === "delete").length, 0);
    assert.equal(calls.filter((call) => call.op === "put" && call.store === "meta").length, 4);
    assert.equal(new Set(calls.map((call) => call.transaction)).size, 1);
  });
});

test("adopt leaves a partition that already holds anything exactly as it is", async () => {
  for (const [meta, seed] of [[{}, { items: [vendor] }], [{}, { outbox: [queued[0]] }], [{ rev: 1 }, {}], [{ generation: "g9" }, {}], [{ epoch: "e9" }, {}], [{ me: "b" }, {}]] as [Record<string, unknown>, Seed][]) {
    await withFake(meta, async ({ calls }) => {
      await indexedDbPersistence("fake").adopt(snapshot());
      assert.deepEqual(calls.filter((call) => call.op !== "get" && call.op !== "getAll" && call.op !== "count"), [], JSON.stringify([meta, seed]));
    }, seed);
  }
});

test("adopt aborts and changes nothing when what was copied does not match what was read", async () => {
  await withFake({}, async () => {
    const persistence = indexedDbPersistence("fake");
    const twice = snapshot({ rows: { items: [task, task] as never, budget_entries: [], settings: [] } });
    await assert.rejects(persistence.adopt(twice));
    assert.deepEqual(await persistence.load(), { rows: { items: [], budget_entries: [], settings: [] }, outbox: [], meta: { rev: 0, me: null, epoch: null, generation: null, adopted: null } });
  });
});

test("the old database is found only when it exists, and looking never creates it", async () => {
  await withFake({}, async ({ created, transactions }) => {
    assert.equal(await indexedDbDisk().legacy(), null);
    assert.deepEqual([created, transactions], [[], []]);
  });
  await withFake({ rev: 3, me: "b", adopted: "b" }, async ({ created }) => {
    const old = await indexedDbDisk().legacy();
    assert.notEqual(old, null);
    assert.deepEqual([(await old!.load()).meta, created], [{ rev: 3, me: "b", epoch: null, generation: null, adopted: "b" }, []]);
  }, {}, ["wp"]);
});

test("a partition is a database of its own, named by the side", async () => {
  const names: string[] = [];
  const fake = fakeIndexedDb({});
  Object.assign(globalThis, { indexedDB: { open: (name: string) => (names.push(name), fake.indexedDB.open(name)) } });
  try {
    await indexedDbDisk().open("a").load();
    await indexedDbDisk().open("b").load();
  } finally {
    Reflect.deleteProperty(globalThis, "indexedDB");
  }
  assert.deepEqual(names, ["wp-a", "wp-b"]);
});

test("an error while looking for the old database is reported, not taken for a missing database", async () => {
  await withFake({}, async () => {
    await assert.rejects(indexedDbDisk().legacy(), /the disk is gone/);
  }, {}, [], ["wp"]);
});
