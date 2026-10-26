import { test } from "node:test";
import assert from "node:assert/strict";
import { SIDE_HEADER } from "../shared/api.ts";
import { createApi } from "../src/store/api.ts";
import type { Fetch } from "../src/store/api.ts";

const changes = { items: [], budget_entries: [], settings: [] };

const answering = (status: number, body: unknown) => {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetcher: Fetch = async (url, init) => {
    requests.push({ url, init });
    return Response.json(body, { status });
  };
  return { fetcher, requests };
};

const header = (init: RequestInit) => new Headers(init.headers).get(SIDE_HEADER);

test("every sync request carries the side it was made for, and a probe carries none", async () => {
  const { fetcher, requests } = answering(200, { rev: 1, epoch: "e", me: "a", changes, rows: changes });
  await createApi(fetcher, "a").pull(0);
  await createApi(fetcher, "a").push([]);
  await createApi(fetcher).pull(0);
  await createApi(fetcher).push([]);
  assert.deepEqual(requests.map((request) => header(request.init)), ["a", "a", null, null]);
  assert.equal(new Headers(requests[1].init.headers).get("content-type"), "application/json");
});

test("a 409 side_mismatch is its own outcome on a pull and on a push, and names the signed-in side", async () => {
  const { fetcher } = answering(409, { error: "side_mismatch", me: "b" });
  const api = createApi(fetcher, "a");
  assert.deepEqual(await api.pull(0), { kind: "mismatch", me: "b" });
  assert.deepEqual(await api.push([]), { kind: "mismatch", me: "b" });
});

test("a 409 with errors is still a rejection, and a 409 that names no side is not a mismatch", async () => {
  const rejection = { status: 409, errors: ["parent_id: must point at a live items row"], index: 0 };
  assert.deepEqual(await createApi(answering(409, rejection).fetcher, "a").push([]), { kind: "rejected", rejection });
  for (const me of [undefined, "c", null]) assert.deepEqual(await createApi(answering(409, { error: "side_mismatch", me }).fetcher, "a").push([]), { kind: "offline" });
  assert.deepEqual(await createApi(answering(409, { error: "other", me: "b" }).fetcher, "a").pull(0), { kind: "offline" });
});

test("a pull answer without a valid side is refused, so a malformed answer cannot open a partition", async () => {
  for (const me of [undefined, null, "", "c", "A", 1]) {
    for (const side of [undefined, "a" as const]) assert.deepEqual(await createApi(answering(200, { rev: 1, epoch: "e", me, changes }).fetcher, side).pull(0), { kind: "offline" }, String(me));
  }
});

test("a pull answer for another side than the api's is a mismatch with no rows, and the same side is served", async () => {
  const body = { rev: 4, epoch: "e", me: "b", changes: { ...changes, items: [{ id: "1" }] } };
  assert.deepEqual(await createApi(answering(200, body).fetcher, "a").pull(0), { kind: "mismatch", me: "b" });
  assert.deepEqual(await createApi(answering(200, body).fetcher, "b").pull(0), { kind: "ok", body, served: null });
  assert.deepEqual(await createApi(answering(200, body).fetcher).pull(0), { kind: "ok", body, served: null });
});
