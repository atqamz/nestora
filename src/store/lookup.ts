import { toIsbn13 } from "../domain/isbn.ts";
import { fresh } from "../domain/scan.ts";
import { lookupUrl, parseLookup } from "../domain/lookup.ts";
import { fillPatch, isbnUrl, lacksBlurb, parseBlurb, parseIsbn, parseSearch, phraseOf, pickIsbn, queriesOf, sameAuthor, sameBook, searchUrl, workKey, workUrl } from "../domain/openlibrary.ts";
import type { Hit } from "../domain/openlibrary.ts";
import type { ScreenKind } from "../domain/screen.ts";
import { parseScreenHits, screenLookupUrl, screenQueryOf, validId } from "../domain/tmdb.ts";
import type { ScreenHit } from "../domain/tmdb.ts";

export type Outcome<T> = { kind: "ok"; value: T } | { kind: "offline" | "failed" | "slow" | "stale"; retry?: number };

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export type Lookup = {
  search(input: { title: string; author: string; original: string }): Promise<Outcome<Hit[]>>;
  byIsbn(isbn: string): Promise<Outcome<Hit | null>>;
  blurb(work: string): Promise<Outcome<string | null>>;
  screen(input: { kind: ScreenKind; title: string; year: number | null }): Promise<Outcome<ScreenHit[]>>;
  screenById(kind: ScreenKind, id: number): Promise<Outcome<ScreenHit | null>>;
  cancel(): void;
  stop(): void;
};

const delayOf = (header: string | null) => {
  const seconds = header === null || header.trim() === "" ? NaN : Number(header);
  const ms = Number.isNaN(seconds) ? Date.parse(header ?? "") - Date.now() : seconds * 1000;
  return Number.isFinite(ms) ? Math.max(0, ms) : 0;
};

type Options = { fetcher?: Fetcher; online?: () => boolean; wait?: number; timeout?: number; remember?: number; worker?: boolean };

const CACHE_MS = 3_600_000;

const ours = (res: Response) => [429, 502, 503].includes(res.status) && res.headers.get("content-type")?.includes("application/json") === true;

export const createLookup = ({
  fetcher = (url, init) => fetch(url, init),
  online = () => navigator.onLine !== false,
  wait = 400,
  timeout = 8000,
  remember = 50,
  worker = true,
}: Options = {}): Lookup => {
  let current: AbortController | null = null;
  let searching = false;
  const cache = new Map<string, { value: unknown; at: number }>();

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

  const get = async <T>(signal: AbortSignal, url: string, parse: (body: unknown) => T, own = false, keeps: (value: T) => boolean = () => true): Promise<Outcome<T>> => {
    const kept = cache.get(url);
    if (kept !== undefined) {
      const age = Date.now() - kept.at;
      if (age >= 0 && age < CACHE_MS) return { kind: "ok", value: kept.value as T };
      cache.delete(url);
    }
    if (!online()) return { kind: "offline" };
    const limit = new AbortController();
    let late = false;
    const timer = setTimeout(() => ((late = true), limit.abort()), timeout);
    signal.addEventListener("abort", () => limit.abort(), { once: true });
    const lost = (kind: "offline" | "failed", retry?: number): Outcome<T> =>
      signal.aborted ? { kind: "stale" } : late ? { kind: "slow" } : retry === undefined ? { kind } : { kind, retry };
    let value: T;
    try {
      let res: Response;
      try {
        res = await fetcher(url, { signal: limit.signal, credentials: own ? "same-origin" : "omit", referrerPolicy: "no-referrer", ...(own && { redirect: "manual" as const }) });
      } catch {
        return lost("offline");
      }
      try {
        if (res.status !== 200) {
          if (own && !ours(res)) return lost("offline");
          return lost("failed", res.status === 429 || res.status >= 500 ? delayOf(res.headers.get("retry-after")) : undefined);
        }
        value = parse(await res.json());
      } catch {
        return lost(own ? "offline" : "failed");
      }
    } finally {
      clearTimeout(timer);
    }
    if (keeps(value)) {
      if (cache.size >= remember) cache.delete(cache.keys().next().value as string);
      cache.set(url, { value, at: Date.now() });
    }
    return signal.aborted ? { kind: "stale" } : { kind: "ok", value };
  };

  const find = async <T>(signal: AbortSignal, own: string, direct: string, parseOwn: (body: unknown) => T, parseDirect: (body: unknown) => T): Promise<Outcome<T>> => {
    if (worker) {
      const out = await get(signal, own, parseOwn, true);
      if (out.kind !== "offline" || !online()) return out;
    }
    return get(signal, direct, parseDirect);
  };

  return {
    search: async (input) => {
      const signal = begin(true);
      await pause(signal);
      let last: Outcome<Hit[]> = { kind: "ok", value: [] };
      for (const query of queriesOf(input)) {
        if (signal.aborted) return { kind: "stale" };
        last = await find(signal, lookupUrl(query), searchUrl(phraseOf(query)), parseLookup, parseSearch);
        if (last.kind !== "ok" || last.value.length > 0) return last;
      }
      return last;
    },
    byIsbn: (isbn) => find(begin(), lookupUrl({ kind: "isbn", isbn }), isbnUrl(isbn), (body) => pickIsbn(parseLookup(body), isbn), (body) => parseIsbn(body, isbn)),
    blurb: (work) => get(begin(), workUrl(work), parseBlurb),
    screen: async ({ kind, title, year }) => {
      const signal = begin(true);
      await pause(signal);
      if (signal.aborted) return { kind: "stale" };
      const query = screenQueryOf(new URLSearchParams({ kind, title, ...(year === null ? {} : { year: String(year) }) }));
      return query === null ? { kind: "ok", value: [] } : get(signal, screenLookupUrl(query), (body) => parseScreenHits(body, kind), true);
    },
    screenById: async (kind, id) => {
      const signal = begin();
      if (validId(id) === null) return { kind: "ok", value: null };
      const out = await get(signal, screenLookupUrl({ kind, by: "id", id }), (body) => parseScreenHits(body, kind), true, (hits) => hits.length > 0);
      if (out.kind !== "ok") return out;
      const hit = out.value.find((entry) => entry.tmdb === id);
      return hit === undefined && out.value.length > 0 ? { kind: "failed" } : { kind: "ok", value: hit ?? null };
    },
    cancel: () => searching && current?.abort(),
    stop: () => current?.abort(),
  };
};

export type Search<T = Hit> = { state: "idle" | "busy" | "offline" | "failed" | "slow" | "empty" | "found"; hits: T[] };

export const IDLE: Search<never> = { state: "idle", hits: [] };

export const searchOf = <T>(out: Outcome<T[]>): Search<T> =>
  out.kind === "stale" ? IDLE : out.kind !== "ok" ? { state: out.kind, hits: [] } : out.value.length === 0 ? { state: "empty", hits: [] } : { state: "found", hits: out.value };

const trail = <T>(lookup: Lookup, ready: boolean, run: () => Promise<Outcome<T[]>>, set: (search: Search<T>) => void): (() => void) => {
  if (!ready) {
    set(IDLE);
    return () => {};
  }
  let current = true;
  set({ state: "busy", hits: [] });
  void run().then((out) => {
    if (current) set(searchOf(out));
  });
  return () => {
    current = false;
    lookup.cancel();
  };
};

export const follow = (lookup: Lookup, ready: boolean, input: { title: string; author: string; original: string }, set: (search: Search) => void) =>
  trail(lookup, ready, () => lookup.search(input), set);

export const followScreen = (lookup: Lookup, ready: boolean, input: { kind: ScreenKind; title: string; year: number | null }, set: (search: Search<ScreenHit>) => void) =>
  trail(lookup, ready, () => lookup.screen(input), set);

export type Filled<P = Record<string, string>> = { kind: "patch"; patch: P; counts?: "empty" } | { kind: "empty" | "mismatch" | "nothing" | "offline" | "failed" | "slow" | "stale"; retry?: number };

type Typed = () => { title: string; data: Record<string, unknown> | null };

const complete = async (lookup: Lookup, hit: Hit, read: Typed): Promise<Filled> => {
  if (fillPatch(read(), hit, null) === null) return { kind: "mismatch" };
  const wanted = read().data?.blurb === undefined && lacksBlurb(hit) ? await lookup.blurb(hit.work) : null;
  if (wanted !== null && wanted.kind !== "ok" && (wanted.kind !== "failed" || wanted.retry !== undefined)) return wanted;
  const patch = fillPatch(read(), hit, wanted?.kind === "ok" ? wanted.value : null);
  if (patch === null) return { kind: "mismatch" };
  return Object.keys(patch).length === 0 ? { kind: "nothing" } : { kind: "patch", patch };
};

export const fillBook = async (lookup: Lookup, code: string, read: Typed): Promise<Filled> => {
  const found = await lookup.byIsbn(code);
  if (found.kind !== "ok") return found;
  return found.value === null ? { kind: "empty" } : complete(lookup, found.value, read);
};

const word = (value: unknown) => (typeof value === "string" ? value : "");

export const fillTitle = async (lookup: Lookup, read: Typed): Promise<Filled | { kind: "unsure" }> => {
  const { title, data } = read();
  const found = await lookup.search({ title, author: word(data?.author), original: word(data?.original_title) });
  if (found.kind !== "ok") return found;
  const titled = found.value.filter((candidate) => fillPatch(read(), candidate, null) !== null);
  const confirmed = titled.filter((candidate) => sameAuthor(data?.author, candidate.author));
  if (new Set(confirmed.map(workKey)).size > 1) return { kind: "unsure" };
  if (confirmed.length === 0) return titled.length > 0 ? { kind: "unsure" } : { kind: "empty" };
  return complete(lookup, confirmed[0], read);
};

export type Fill = "idle" | "busy" | "empty" | "mismatch" | "offline" | "failed" | "slow" | "done";

export const turns = () => {
  let last = 0;
  return { begin: () => ++last, latest: (turn: number) => turn === last };
};

export const fillOutcome = (out: Outcome<Hit | null>, typed: { title: string; original: string; isbn: string }, code: string, latest: boolean): { hit: Hit | null; state: Fill | null } => {
  if (out.kind === "stale" || toIsbn13(typed.isbn) !== code) return { hit: null, state: latest ? "idle" : null };
  if (out.kind !== "ok") return { hit: null, state: out.kind };
  if (out.value === null) return { hit: null, state: "empty" };
  return sameBook(typed, out.value.title) ? { hit: out.value, state: "done" } : { hit: null, state: "mismatch" };
};

export type Scan = { kind: "same" | "mismatch" | "stale" | "write" } | { kind: "confirm"; old: string };

const text = (value: unknown) => (typeof value === "string" ? value : "");

export const scanBook = async (lookup: Lookup, code: string, read: () => { title: string; data: Record<string, unknown> | null }): Promise<Scan> => {
  if (!fresh(text(read().data?.isbn), code)) return { kind: "same" };
  const out = await lookup.byIsbn(code);
  const book = read();
  const { state } = fillOutcome(out, { title: book.title, original: text(book.data?.original_title), isbn: code }, code, true);
  if (state === "idle") return { kind: "stale" };
  if (state === "mismatch") return { kind: "mismatch" };
  const old = text(book.data?.isbn);
  return old === "" ? { kind: "write" } : { kind: "confirm", old };
};

type Book = { title: string; data: Record<string, unknown> | null };

export type Pending = { old: string; code: string; title: string; original: string };

export type Landing = { kind: "drop" } | { kind: "write" } | { kind: "show"; state: "idle" | "mismatch"; pending: Pending | null };

export const landing = (latest: boolean, step: Scan, code: string, book: Book): Landing => {
  if (!latest) return { kind: "drop" };
  if (step.kind === "write") return { kind: "write" };
  if (step.kind === "confirm") return { kind: "show", state: "idle", pending: { old: step.old, code, title: book.title, original: text(book.data?.original_title) } };
  return { kind: "show", state: step.kind === "mismatch" ? "mismatch" : "idle", pending: null };
};

export type Choice = "keep" | "replace";

export const decide = (pending: Pending, choice: Choice, book: Book): { write: string | null; changed: boolean } => {
  if (choice === "keep") return { write: null, changed: false };
  const same = text(book.data?.isbn) === pending.old && book.title === pending.title && text(book.data?.original_title) === pending.original;
  return same ? { write: pending.code, changed: false } : { write: null, changed: true };
};

export const dismisses = (key: string, open: boolean, inDialog: boolean) => open && key === "Escape" && !inDialog;
