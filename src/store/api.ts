import type { Mutation, Rejection, SyncResponse, SyncResult } from "../../shared/api.ts";

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export type Failure = { kind: "offline" } | { kind: "expired" };

export type PullResult = { kind: "ok"; body: SyncResponse } | Failure;

export type PushResult = { kind: "ok"; body: SyncResult } | { kind: "rejected"; rejection: Rejection } | Failure;

export type Api = {
  pull(since: number): Promise<PullResult>;
  push(mutations: Mutation[]): Promise<PushResult>;
  me(): Promise<string | null>;
};

export const SYNC_URL = "/api/sync";

export const ME_URL = "/api/me";

export const LOGIN_URL = "/api/login";

const TIMEOUT_MS = 15_000;

type Dict = Record<string, unknown>;

const isDict = (value: unknown): value is Dict => typeof value === "object" && value !== null && !Array.isArray(value);

const call = async (
  fetcher: Fetch,
  url: string,
  init: RequestInit,
): Promise<Failure | { kind: "response"; status: number; body: unknown }> => {
  let res: Response;
  try {
    res = await fetcher(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return { kind: "offline" };
  }
  if ((res.status >= 300 && res.status < 400) || res.status === 401 || res.status === 403) return { kind: "expired" };
  if (res.status >= 500) return { kind: "offline" };
  if (!res.headers.get("content-type")?.includes("application/json")) return { kind: res.status < 300 ? "expired" : "offline" };
  try {
    return { kind: "response", status: res.status, body: await res.json() };
  } catch {
    return { kind: "offline" };
  }
};

export const createApi = (fetcher: Fetch): Api => ({
  pull: async (since) => {
    const res = await call(fetcher, `${SYNC_URL}?since=${since}`, { method: "GET" });
    if (res.kind !== "response") return res;
    const { body } = res;
    return res.status === 200 && isDict(body) && Number.isInteger(body.rev) && typeof body.epoch === "string" && isDict(body.changes)
      ? { kind: "ok", body: body as unknown as SyncResponse }
      : { kind: "offline" };
  },
  push: async (mutations) => {
    const res = await call(fetcher, SYNC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mutations }),
    });
    if (res.kind !== "response") return res;
    const { body } = res;
    if (res.status === 200 && isDict(body) && Number.isInteger(body.rev) && typeof body.epoch === "string" && isDict(body.rows)) {
      return { kind: "ok", body: body as unknown as SyncResult };
    }
    if (res.status >= 400 && isDict(body) && Array.isArray(body.errors)) {
      return { kind: "rejected", rejection: body as unknown as Rejection };
    }
    return { kind: "offline" };
  },
  me: async () => {
    const res = await call(fetcher, ME_URL, { method: "GET" });
    return res.kind === "response" && res.status === 200 && isDict(res.body) && typeof res.body.photo === "string" && res.body.photo !== "" ? res.body.photo : null;
  },
});
