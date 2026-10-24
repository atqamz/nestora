import type { JWTPayload } from "jose";
import { SIDE_HEADER } from "../shared/api.ts";
import type { ErrorBody, SideMismatch } from "../shared/api.ts";
import { createAuthenticator } from "./auth.ts";
import type { AuthEnv } from "./auth.ts";
import { exportData } from "./export.ts";
import { feedStatus, revokeFeed, rotateFeed, serveFeed } from "./feed.ts";
import { photoOf } from "./me.ts";
import { getSync, json, postSync } from "./sync.ts";
import type { Db } from "./sync.ts";

export type Bindings = AuthEnv & { DB: Db; DESIGN: { get(key: string, type: "text"): Promise<string | null> } };

const SIDED = new Set(["/api/sync", "/api/export", "/api/feed"]);

const DESIGN_NAME = /^\/design\/([a-z0-9][a-z0-9-]{0,39})\/?$/;

const JSON_TYPE = /^application\/json\s*(;|$)/i;

const fail = (error: string, status: number, headers: Record<string, string> = {}) =>
  json({ error } satisfies ErrorBody, status, headers);

const notAllowed = (allow: string) => fail("method_not_allowed", 405, { allow });

const refuseUnsafe = (request: Request, origin: string) => {
  if (!JSON_TYPE.test(request.headers.get("content-type") ?? "")) return fail("unsupported_media_type", 415);
  const sameOrigin = [null, origin].includes(request.headers.get("origin"));
  const sameSite = [null, "same-origin", "none"].includes(request.headers.get("sec-fetch-site"));
  return sameOrigin && sameSite ? null : fail("forbidden", 403);
};

const DESIGN_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "private, no-store",
  "x-robots-tag": "noindex, nofollow",
  "x-content-type-options": "nosniff",
};

const designPage = async (request: Request, env: Bindings, pathname: string) => {
  const name = DESIGN_NAME.exec(pathname)?.[1];
  if (name === undefined) return fail("not_found", 404);
  const { method } = request;
  if (method !== "GET" && method !== "HEAD") return notAllowed("GET, HEAD");
  const page = await env.DESIGN.get(name, "text");
  if (page === null) return fail("not_found", 404);
  return new Response(method === "HEAD" ? null : page, { headers: DESIGN_HEADERS });
};

export const createWorker = (authenticate = createAuthenticator(), fetcher: typeof fetch = (input, init) => fetch(input, init)) => ({
  async fetch(request: Request, env: Bindings): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/feed/")) return await serveFeed(request, env.DB, url.pathname);
      const design = url.pathname.startsWith("/design/");
      if (!design && !url.pathname.startsWith("/api/")) return fail("not_found", 404);
      const verified: { payload: JWTPayload | null } = { payload: null };
      const who = await authenticate(request, env, (payload) => void (verified.payload = payload));
      if (who === null) return fail("unauthorized", 401);
      if (design) return await designPage(request, env, url.pathname);
      const claimed = request.headers.get(SIDE_HEADER) ?? url.searchParams.get("side");
      if (SIDED.has(url.pathname) && claimed !== null && claimed !== who) {
        return json({ error: "side_mismatch", me: who } satisfies SideMismatch, 409);
      }
      const { method } = request;
      switch (url.pathname) {
        case "/api/health":
          return method === "GET" ? json({ ok: true }) : notAllowed("GET");
        case "/api/login":
          return method === "GET" ? new Response(null, { status: 302, headers: { location: "/", "cache-control": "no-store" } }) : notAllowed("GET");
        case "/api/export":
          return method === "GET" ? await exportData(url, env.DB, who) : notAllowed("GET");
        case "/api/me":
          return method === "GET" ? json({ photo: await photoOf(request, env, verified.payload, fetcher) }, 200, { "cache-control": "private, no-store" }) : notAllowed("GET");
        case "/api/feed":
          if (method === "GET") return json(await feedStatus(env.DB, who));
          if (method !== "POST" && method !== "DELETE") return notAllowed("GET, POST, DELETE");
          return refuseUnsafe(request, url.origin) ?? (method === "POST" ? json(await rotateFeed(env.DB, who)) : (await revokeFeed(env.DB, who), json({ active: false })));
        case "/api/sync":
          if (method === "GET") return await getSync(url, env.DB, who);
          if (method !== "POST") return notAllowed("GET, POST");
          return refuseUnsafe(request, url.origin) ?? (await postSync(request, env.DB, who));
        default:
          return fail("not_found", 404);
      }
    } catch (error) {
      console.error("unhandled", error instanceof Error ? error.name : typeof error);
      return fail("internal", 500);
    }
  },
});

export default createWorker();
