import { isCover } from "../shared/validate.ts";
import { clean } from "../src/domain/googlebooks.ts";
import { TITLE_MAX } from "../src/domain/lookup.ts";
import { dict } from "../src/domain/openlibrary.ts";
import { fold } from "../src/domain/search.ts";
import type { ScreenKind } from "../src/domain/screen.ts";
import { SCREEN_HITS_MAX, parseScreenHits, screenCacheKey, screenQueryOf, validId, validYear } from "../src/domain/tmdb.ts";
import type { ScreenHit, ScreenQuery } from "../src/domain/tmdb.ts";
import { AGENT, RETRY_SECONDS, body, recall, refuse, remember, waitOf } from "./lookup.ts";
import type { Io, Store } from "./lookup.ts";
import { json } from "./sync.ts";

export type ScreenEnv = { TMDB_TOKEN?: string };

export const SCREEN_CACHE_SECONDS = 86_400;

export const CALL_MS = 3000;

export const MAX_BYTES = 256 * 1024;

export const RESULTS_READ = 20;

const API = "https://api.themoviedb.org/3";

const POSTER = /^\/([A-Za-z0-9_-]{1,64})\.jpg$/;

const DATE = /^(\d{4})(?:-\d{2}-\d{2})?$/;

type Limit = { status: 429 | 503; retry: number };

type Answer = { kind: "ok"; hits: ScreenHit[]; keep: boolean } | { kind: "bad"; limit: Limit | null };

const upstreamUrl = (query: ScreenQuery, language: string) => {
  const path = query.kind === "movie" ? "movie" : "tv";
  if (query.by === "id") return `${API}/${path}/${query.id}?${new URLSearchParams({ language })}`;
  const params = new URLSearchParams({ query: query.title, language, include_adult: "false", page: "1" });
  if (query.year !== null) params.set(query.kind === "movie" ? "primary_release_year" : "first_air_date_year", String(query.year));
  return `${API}/search/${path}?${params}`;
};

const hitOf = (kind: ScreenKind, raw: unknown): ScreenHit | null => {
  const item = dict(raw);
  const movie = kind === "movie";
  const tmdb = validId(item.id);
  const shown = clean(movie ? item.title : item.name, TITLE_MAX);
  const first = clean(movie ? item.original_title : item.original_name, TITLE_MAX);
  const title = shown === "" ? first : shown;
  if (tmdb === null || title === "" || item.adult === true) return null;
  const file = typeof item.poster_path === "string" ? POSTER.exec(item.poster_path)?.[1] : undefined;
  const cover = file === undefined ? null : `https://image.tmdb.org/t/p/w342/${file}.jpg`;
  const date = movie ? item.release_date : item.first_air_date;
  return {
    kind,
    tmdb,
    title,
    original: first === "" || fold(first) === fold(title) ? null : first,
    year: typeof date === "string" ? validYear(Number(DATE.exec(date)?.[1])) : null,
    cover: isCover(cover) ? cover : null,
  };
};

const searched = (kind: ScreenKind) => (data: unknown) => {
  const { results } = dict(data);
  if (!Array.isArray(results)) throw new Error("results missing");
  const hits = results.slice(0, RESULTS_READ).flatMap((result) => hitOf(kind, result) ?? []);
  return hits.filter((hit, at) => hits.findIndex((other) => other.tmdb === hit.tmdb) === at).slice(0, SCREEN_HITS_MAX);
};

const detailed = (kind: ScreenKind, id: number) => (data: unknown) => {
  if (dict(data).adult === true) return [];
  const hit = hitOf(kind, data);
  if (hit === null || hit.tmdb !== id) throw new Error("unusable");
  return [hit];
};

const ask = async (fetcher: typeof fetch, url: string, token: string, parse: (data: unknown) => ScreenHit[], byId: boolean): Promise<Answer> => {
  try {
    const signal = AbortSignal.timeout(CALL_MS);
    const headers = { accept: "application/json", "user-agent": AGENT, authorization: `Bearer ${token}` };
    const res = await fetcher(url, { headers, redirect: "manual", signal });
    if (res.status === 429) return { kind: "bad", limit: { status: 429, retry: waitOf(res.headers.get("retry-after")) } };
    if (res.status >= 500) return { kind: "bad", limit: { status: 503, retry: RETRY_SECONDS } };
    if (res.status === 404 && byId) return { kind: "ok", hits: [], keep: false };
    const text = res.status === 200 ? await body(res, MAX_BYTES, signal) : null;
    return typeof text === "string" ? { kind: "ok", hits: parse(JSON.parse(text)), keep: true } : { kind: "bad", limit: null };
  } catch {
    return { kind: "bad", limit: null };
  }
};

export const lookupScreen = async (url: URL, env: ScreenEnv, { fetcher, store }: Io): Promise<Response> => {
  const query = screenQueryOf(url.searchParams);
  if (query === null) return refuse(400, "bad_query");
  const token = env.TMDB_TOKEN?.trim() ?? "";
  if (token === "") return refuse(502, "failed");
  let cache: Store | null = null;
  try {
    cache = store();
  } catch {}
  const key = new Request(screenCacheKey(query));
  const cached = await recall<ScreenHit>(cache, key, SCREEN_CACHE_SECONDS);
  if (cached !== null) return json({ hits: parseScreenHits({ hits: cached }, query.kind) });
  const parse = query.by === "id" ? detailed(query.kind, query.id) : searched(query.kind);
  const pass = (language: string) => ask(fetcher, upstreamUrl(query, language), token, parse, query.by === "id");
  let answer = await pass("id-ID");
  if (answer.kind === "ok" && answer.hits.length === 0 && query.by === "title") answer = await pass("en-US");
  if (answer.kind === "bad") return answer.limit === null ? refuse(502, "failed") : refuse(answer.limit.status, "busy", answer.limit.retry);
  if (answer.keep) await remember(cache, key, answer.hits, SCREEN_CACHE_SECONDS);
  return json({ hits: answer.hits });
};
