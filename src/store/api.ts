import { SIDE_HEADER } from "../../shared/api.ts";
import type { Mutation, Rejection, Side, SyncResponse, SyncResult } from "../../shared/api.ts";

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export type Failure = { kind: "offline" } | { kind: "expired" } | { kind: "mismatch"; me: Side };

export type Served = number | null;

export type PullResult = { kind: "ok"; body: SyncResponse; served: Served } | Failure;

export type PushResult = { kind: "ok"; body: SyncResult; served: Served } | { kind: "rejected"; rejection: Rejection } | Failure;

export type Api = {
  pull(since: number, timeout?: number): Promise<PullResult>;
  push(mutations: Mutation[]): Promise<PushResult>;
  me(): Promise<string | null>;
};

export const SYNC_URL = "/api/sync";

export const ME_URL = "/api/me";

export const LOGIN_URL = "/api/login";

const TIMEOUT_MS = 15_000;

export const PROBE_TIMEOUT_MS = 4_000;

type Dict = Record<string, unknown>;

export const isDict = (value: unknown): value is Dict => typeof value === "object" && value !== null && !Array.isArray(value);

const isSide = (value: unknown): value is Side => value === "a" || value === "b";

export const call = async (
  fetcher: Fetch,
  url: string,
  init: RequestInit,
  timeout = TIMEOUT_MS,
): Promise<Failure | { kind: "response"; status: number; body: unknown; served: Served }> => {
  let res: Response;
  try {
    res = await fetcher(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(timeout) });
  } catch {
    return { kind: "offline" };
  }
  if ((res.status >= 300 && res.status < 400) || res.status === 401 || res.status === 403) return { kind: "expired" };
  if (res.status >= 500) return { kind: "offline" };
  if (!res.headers.get("content-type")?.includes("application/json")) return { kind: res.status < 300 ? "expired" : "offline" };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { kind: "offline" };
  }
  if (res.status === 409 && isDict(body) && body.error === "side_mismatch" && isSide(body.me)) return { kind: "mismatch", me: body.me };
  const served = Date.parse(res.headers.get("date") ?? "");
  return { kind: "response", status: res.status, body, served: Number.isNaN(served) ? null : served };
};

export const sided = (side?: Side): Record<string, string> => (side === undefined ? {} : { [SIDE_HEADER]: side });

export const createApi = (fetcher: Fetch, side?: Side): Api => ({
  pull: async (since, timeout) => {
    const res = await call(fetcher, `${SYNC_URL}?since=${since}`, { method: "GET", headers: sided(side) }, timeout);
    if (res.kind !== "response") return res;
    const { body } = res;
    if (!(res.status === 200 && isDict(body) && Number.isInteger(body.rev) && typeof body.epoch === "string" && isSide(body.me) && isDict(body.changes))) {
      return { kind: "offline" };
    }
    return side !== undefined && body.me !== side ? { kind: "mismatch", me: body.me } : { kind: "ok", body: body as unknown as SyncResponse, served: res.served };
  },
  push: async (mutations) => {
    const res = await call(fetcher, SYNC_URL, {
      method: "POST",
      headers: { "content-type": "application/json", ...sided(side) },
      body: JSON.stringify({ mutations }),
    });
    if (res.kind !== "response") return res;
    const { body } = res;
    if (res.status === 200 && isDict(body) && Number.isInteger(body.rev) && typeof body.epoch === "string" && isDict(body.rows)) {
      return { kind: "ok", body: body as unknown as SyncResult, served: res.served };
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
