import { fillPatch, isbnUrl, parseBlurb, parseIsbn, parseSearch, queriesOf, sameBook, searchUrl, workUrl } from "../domain/openlibrary.ts";
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
  let searching = false;
  const cache = new Map<string, unknown>();

  const begin = (search = false) => {
    current?.abort();
    searching = search;
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
      const signal = begin(true);
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
    cancel: () => searching && current?.abort(),
  };
};

export type Search = { state: "idle" | "busy" | "offline" | "failed" | "slow" | "empty" | "found"; hits: Hit[] };

export const IDLE: Search = { state: "idle", hits: [] };

export const searchOf = (out: Outcome<Hit[]>): Search =>
  out.kind === "stale" ? IDLE : out.kind !== "ok" ? { state: out.kind, hits: [] } : out.value.length === 0 ? { state: "empty", hits: [] } : { state: "found", hits: out.value };

export const follow = (lookup: Lookup, ready: boolean, input: { title: string; author: string; original: string }, set: (search: Search) => void): (() => void) => {
  if (!ready) {
    set(IDLE);
    return () => {};
  }
  let current = true;
  set({ state: "busy", hits: [] });
  void lookup.search(input).then((out) => {
    if (current) set(searchOf(out));
  });
  return () => {
    current = false;
    lookup.cancel();
  };
};

export type Filled = { kind: "patch"; patch: Record<string, string> } | { kind: "empty" | "mismatch" | "nothing" | "offline" | "failed" | "slow" | "stale" };

export const fillBook = async (lookup: Lookup, code: string, read: () => { title: string; data: Record<string, unknown> | null }): Promise<Filled> => {
  const found = await lookup.byIsbn(code);
  if (found.kind !== "ok") return found;
  const hit = found.value;
  if (hit === null) return { kind: "empty" };
  if (fillPatch(read(), hit, null) === null) return { kind: "mismatch" };
  const wanted = read().data?.blurb === undefined ? await lookup.blurb(hit.work) : null;
  if (wanted?.kind === "stale") return wanted;
  const patch = fillPatch(read(), hit, wanted?.kind === "ok" ? wanted.value : null);
  if (patch === null) return { kind: "mismatch" };
  return Object.keys(patch).length === 0 ? { kind: "nothing" } : { kind: "patch", patch };
};

export type Fill = "idle" | "busy" | "empty" | "mismatch" | "offline" | "failed" | "slow" | "done";

export const turns = () => {
  let last = 0;
  return { begin: () => ++last, latest: (turn: number) => turn === last };
};

export const fillOutcome = (out: Outcome<Hit | null>, typed: { title: string; original: string }, latest: boolean): { hit: Hit | null; state: Fill | null } => {
  if (out.kind === "stale") return { hit: null, state: latest ? "idle" : null };
  if (out.kind !== "ok") return { hit: null, state: out.kind };
  if (out.value === null) return { hit: null, state: "empty" };
  return sameBook(typed, out.value.title) ? { hit: out.value, state: "done" } : { hit: null, state: "mismatch" };
};
