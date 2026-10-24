import type { FeedStatus, Side } from "../../shared/api.ts";
import { call, isDict, sided } from "./api.ts";
import type { Failure, Fetch } from "./api.ts";

export type FeedResult<T> = { kind: "ok"; value: T } | Failure;

export type Feed = {
  status(): Promise<FeedResult<FeedStatus>>;
  create(): Promise<FeedResult<{ token: string; created_at: string }>>;
  revoke(): Promise<FeedResult<FeedStatus>>;
};

export const FEED_URL = "/api/feed";

const TOKEN = /^[0-9a-f]{64}$/;

const isStatus = (body: unknown): body is FeedStatus =>
  isDict(body) && (body.active === false || (body.active === true && typeof body.created_at === "string" && (body.fetched_at === null || typeof body.fetched_at === "string")));

export const feedUrl = (origin: string, token: string) => `${origin}/feed/${token}.ics`;

export const createFeed = (fetcher: Fetch, side: Side): Feed => {
  const headers = { "content-type": "application/json", ...sided(side) };
  const status = async (method: "GET" | "DELETE"): Promise<FeedResult<FeedStatus>> => {
    const res = await call(fetcher, FEED_URL, method === "GET" ? { method, headers: sided(side) } : { method, headers, body: "{}" });
    if (res.kind !== "response") return res;
    return res.status === 200 && isStatus(res.body) ? { kind: "ok", value: res.body } : { kind: "offline" };
  };
  return {
    status: () => status("GET"),
    revoke: () => status("DELETE"),
    create: async () => {
      const res = await call(fetcher, FEED_URL, { method: "POST", headers, body: "{}" });
      if (res.kind !== "response") return res;
      const { body } = res;
      return res.status === 200 && isDict(body) && typeof body.token === "string" && TOKEN.test(body.token) && typeof body.created_at === "string"
        ? { kind: "ok", value: { token: body.token, created_at: body.created_at } }
        : { kind: "offline" };
    },
  };
};
