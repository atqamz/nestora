import { googleUrl, parseGoogle } from "../src/domain/googlebooks.ts";
import { cacheKey, queryOf } from "../src/domain/lookup.ts";
import { dict, isbnUrl, parseSearch, phraseOf, searchUrl } from "../src/domain/openlibrary.ts";
import type { Hit, Query } from "../src/domain/openlibrary.ts";
import { json } from "./sync.ts";

export type LookupEnv = { GOOGLE_BOOKS_KEY?: string };

export type Store = Pick<Cache, "match" | "put">;

export type Io = { fetcher: typeof fetch; store: () => Store };

export const CACHE_SECONDS = 3600;

export const RETRY_SECONDS = 30;

const GOOGLE_MS = 3500;

const OPEN_LIBRARY_MS = 4000;

const MAX_BYTES = 1_000_000;

export const AGENT = "Nestora/1.0 (+https://nestora.atqamz.com)";

type Limit = { status: 429 | 503; retry: number };

type Answer = { kind: "ok"; hits: Hit[] } | { kind: "bad"; limit: Limit | null };

export const body = async (res: Response, max = MAX_BYTES, signal?: AbortSignal) => {
  const reader = res.body?.getReader();
  if (reader === undefined) return null;
  const stop = () => void reader.cancel().catch(() => {});
  signal?.throwIfAborted();
  signal?.addEventListener("abort", stop, { once: true });
  try {
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return (signal?.throwIfAborted(), await new Blob(chunks).text());
      size += value.length;
      if (size > max) return void (await reader.cancel());
      chunks.push(value as Uint8Array<ArrayBuffer>);
    }
  } finally {
    signal?.removeEventListener("abort", stop);
  }
};

export const waitOf = (header: string | null) => {
  const seconds = Number(header);
  return header !== null && header.trim() !== "" && Number.isFinite(seconds) ? Math.min(Math.max(Math.ceil(seconds), 1), 3600) : RETRY_SECONDS;
};

const ask = async (fetcher: typeof fetch, url: string, headers: Record<string, string>, parse: (body: unknown) => Hit[], ms: number): Promise<Answer> => {
  try {
    const res = await fetcher(url, { headers: { accept: "application/json", ...headers }, redirect: "manual", signal: AbortSignal.timeout(ms) });
    if (res.status === 429 || res.status >= 500) return { kind: "bad", limit: { status: res.status === 429 ? 429 : 503, retry: waitOf(res.headers.get("retry-after")) } };
    const text = res.status === 200 ? await body(res) : null;
    return typeof text === "string" ? { kind: "ok", hits: parse(JSON.parse(text)) } : { kind: "bad", limit: null };
  } catch {
    return { kind: "bad", limit: null };
  }
};

const googleHits = (body: unknown) => {
  const hits = parseGoogle(body);
  if (hits.length === 0 && Number(dict(body).totalItems) > 0) throw new Error("volumes missing");
  return hits;
};

const openLibrary = (query: Query) => (query.kind === "isbn" ? isbnUrl(query.isbn) : searchUrl(phraseOf(query)));

export const refuse = (status: number, error: string, retry: number | null = null) =>
  json(retry === null ? { error } : { error, retry }, status, retry === null ? {} : { "retry-after": String(retry) });

export const recall = async <T>(store: Store | null, key: Request, seconds: number): Promise<T[] | null> => {
  try {
    const hit = await store?.match(key);
    if (hit === undefined) return null;
    const { hits, at } = (await hit.json()) as { hits: T[] | null; at: unknown };
    const age = typeof at === "number" ? Date.now() - at : NaN;
    return Array.isArray(hits) && age >= 0 && age < seconds * 1000 ? hits : null;
  } catch {
    return null;
  }
};

export const remember = async <T>(store: Store | null, key: Request, hits: T[], seconds: number) => {
  try {
    await store?.put(key, Response.json({ hits, at: Date.now() }, { headers: { "cache-control": `public, max-age=${seconds}` } }));
  } catch {}
};

export const lookupBooks = async (url: URL, env: LookupEnv, { fetcher, store }: Io): Promise<Response> => {
  const query = queryOf(url.searchParams);
  if (query === null) return refuse(400, "bad_query");
  let cache: Store | null = null;
  try {
    cache = store();
  } catch {}
  const key = new Request(cacheKey(query));
  const cached = await recall<Hit>(cache, key, CACHE_SECONDS);
  if (cached !== null) return json({ hits: cached });
  const secret = env.GOOGLE_BOOKS_KEY?.trim() ?? "";
  const google = secret === "" ? null : await ask(fetcher, googleUrl(query), { "x-goog-api-key": secret }, googleHits, GOOGLE_MS);
  if (google?.kind === "ok" && google.hits.length > 0) return (await remember(cache, key, google.hits, CACHE_SECONDS), json({ hits: google.hits }));
  const open = await ask(fetcher, openLibrary(query), { "user-agent": AGENT }, parseSearch, OPEN_LIBRARY_MS);
  const definite = google === null || google.kind === "ok";
  if (open.kind === "ok" && (definite || open.hits.length > 0)) {
    if (google?.kind === "ok") await remember(cache, key, open.hits, CACHE_SECONDS);
    return json({ hits: open.hits });
  }
  const limit = [google, open].flatMap((answer) => (answer?.kind === "bad" && answer.limit !== null ? [answer.limit] : []))[0];
  return limit === undefined ? refuse(502, "failed") : refuse(limit.status, "busy", limit.retry);
};
