import { isbnUrl, parseBlurb, parseIsbn, parseSearch, queriesOf, searchUrl, workUrl } from "../domain/openlibrary.ts";
import type { Hit } from "../domain/openlibrary.ts";

export type Outcome<T> = { kind: "ok"; value: T } | { kind: "offline" | "failed" | "slow" | "stale" };

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export type Lookup = {
  search(input: { title: string; author: string; original: string }): Promise<Outcome<Hit[]>>;
  byIsbn(isbn: string): Promise<Outcome<Hit | null>>;
  blurb(work: string): Promise<Outcome<string | null>>;
  cancel(): void;
};

type Options = { fetcher?: Fetcher; online?: () => boolean; wait?: number; timeout?: number; remember?: number };

export const createLookup = ({
  fetcher = (url, init) => fetch(url, init),
  online = () => navigator.onLine !== false,
  wait = 400,
  timeout = 8000,
  remember = 50,
}: Options = {}): Lookup => {
  let current: AbortController | null = null;
  const cache = new Map<string, unknown>();

  const begin = () => {
    current?.abort();
    current = new AbortController();
    return current.signal;
  };

  const pause = (signal: AbortSignal) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, wait);
      signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
    });

  const get = async <T>(signal: AbortSignal, url: string, parse: (body: unknown) => T): Promise<Outcome<T>> => {
    if (cache.has(url)) return { kind: "ok", value: cache.get(url) as T };
    if (!online()) return { kind: "offline" };
    const limit = new AbortController();
    let late = false;
    const timer = setTimeout(() => ((late = true), limit.abort()), timeout);
    signal.addEventListener("abort", () => limit.abort(), { once: true });
    const lost = (kind: "offline" | "failed"): Outcome<T> => ({ kind: signal.aborted ? "stale" : late ? "slow" : kind });
    let value: T;
    try {
      let res: Response;
      try {
        res = await fetcher(url, { signal: limit.signal, credentials: "omit", referrerPolicy: "no-referrer" });
      } catch {
        return lost("offline");
      }
      try {
        if (res.status !== 200) return lost("failed");
        value = parse(await res.json());
      } catch {
        return lost("failed");
      }
    } finally {
      clearTimeout(timer);
    }
    if (cache.size >= remember) cache.delete(cache.keys().next().value as string);
    cache.set(url, value);
    return signal.aborted ? { kind: "stale" } : { kind: "ok", value };
  };

  return {
    search: async (input) => {
      const signal = begin();
      await pause(signal);
      let last: Outcome<Hit[]> = { kind: "ok", value: [] };
      for (const query of queriesOf(input)) {
        if (signal.aborted) return { kind: "stale" };
        last = await get(signal, searchUrl(query), parseSearch);
        if (last.kind !== "ok" || last.value.length > 0) return last;
      }
      return last;
    },
    byIsbn: (isbn) => get(begin(), isbnUrl(isbn), (body) => parseIsbn(body, isbn)),
    blurb: (work) => get(begin(), workUrl(work), parseBlurb),
    cancel: () => current?.abort(),
  };
};
