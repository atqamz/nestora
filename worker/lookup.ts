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

export const OPEN_LIBRARY_AGENT = "Nestora/1.0 (+https://nestora.atqamz.com)";

type Limit = { status: 429 | 503; retry: number };

type Answer = { kind: "ok"; hits: Hit[] } | { kind: "bad"; limit: Limit | null };

const body = async (res: Response) => {
  const reader = res.body?.getReader();
  if (reader === undefined) return null;
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return new Blob(chunks).text();
    size += value.length;
    if (size > MAX_BYTES) return void (await reader.cancel());
    chunks.push(value as Uint8Array<ArrayBuffer>);
  }
};

const waitOf = (header: string | null) => {
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

const refuse = (status: number, error: string, retry: number | null = null) =>
  json(retry === null ? { error } : { error, retry }, status, retry === null ? {} : { "retry-after": String(retry) });

const recall = async (store: Store | null, key: Request): Promise<Hit[] | null> => {
  try {
    const hit = await store?.match(key);
    if (hit === undefined) return null;
    const { hits, at } = (await hit.json()) as { hits: Hit[] | null; at: number };
    const age = Date.now() - at;
    return Array.isArray(hits) && age >= 0 && age < CACHE_SECONDS * 1000 ? hits : null;
  } catch {
    return null;
  }
};

const remember = async (store: Store | null, key: Request, hits: Hit[]) => {
  try {
    await store?.put(key, Response.json({ hits, at: Date.now() }, { headers: { "cache-control": `public, max-age=${CACHE_SECONDS}` } }));
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
  const cached = await recall(cache, key);
  if (cached !== null) return json({ hits: cached });
  const secret = env.GOOGLE_BOOKS_KEY?.trim() ?? "";
  const google = secret === "" ? null : await ask(fetcher, googleUrl(query), { "x-goog-api-key": secret }, googleHits, GOOGLE_MS);
  if (google?.kind === "ok" && google.hits.length > 0) return (await remember(cache, key, google.hits), json({ hits: google.hits }));
  const open = await ask(fetcher, openLibrary(query), { "user-agent": OPEN_LIBRARY_AGENT }, parseSearch, OPEN_LIBRARY_MS);
  const definite = google === null || google.kind === "ok";
  if (open.kind === "ok" && (definite || open.hits.length > 0)) {
    if (google?.kind === "ok") await remember(cache, key, open.hits);
    return json({ hits: open.hits });
  }
  const limit = [google, open].flatMap((answer) => (answer?.kind === "bad" && answer.limit !== null ? [answer.limit] : []))[0];
  return limit === undefined ? refuse(502, "failed") : refuse(limit.status, "busy", limit.retry);
};
