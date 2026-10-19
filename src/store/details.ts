import type { ItemRow } from "../../shared/tables.ts";
import { createLookup, fillBook, fillTitle } from "./lookup.ts";
import type { Fetcher, Lookup } from "./lookup.ts";
import type { Written } from "./store.ts";

export const GAP_MS = 1000;

export const BACKOFF_MS = 2000;

export const BACKOFF_CAP_MS = 60_000;

export const MAX_BUSY = 3;

export type Tally = { filled: number; empty: number; failed: number; unsure: number };

export type Finish = "finished" | "stopped" | "offline" | "busy";

const sleep = (ms: number, signal?: AbortSignal | null) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

export const paced = (fetcher: Fetcher, gap = GAP_MS, now = () => Date.now(), wait = sleep): Fetcher => {
  let last = -Infinity;
  return async (url, init) => {
    const remaining = last + gap - now();
    if (remaining > 0) await wait(remaining, init.signal);
    try {
      return await fetcher(url, init);
    } finally {
      last = now();
    }
  };
};

export const detailsLookup = createLookup({ fetcher: paced((url, init) => fetch(url, init)), wait: 0 });

export const needsDetails = (book: ItemRow) => book.data?.ol == null;

export const findDetails = async ({
  ids,
  lookup,
  read,
  save,
  signal,
  onStep,
  wait = sleep,
}: {
  ids: readonly string[];
  lookup: Lookup;
  read: (id: string) => ItemRow | undefined;
  save: (id: string, patch: Record<string, string>) => Promise<Written>;
  signal: AbortSignal;
  onStep: (id: string, tally: Tally) => void;
  wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}): Promise<Finish> => {
  const tally: Tally = { filled: 0, empty: 0, failed: 0, unsure: 0 };
  let busy = 0;
  const stop = () => lookup.stop();
  signal.addEventListener("abort", stop, { once: true });
  try {
    for (const id of ids) {
      const book = read(id);
      if (signal.aborted) return "stopped";
      if (book === undefined) continue;
      const code = typeof book.data?.isbn === "string" ? book.data.isbn : null;
      const current = () => read(id) ?? book;
      const attempt = () => (code === null ? fillTitle(lookup, current) : fillBook(lookup, code, current));
      let out = await attempt();
      while (!signal.aborted && (out.kind === "slow" || (out.kind === "failed" && out.retry !== undefined))) {
        const pause = Math.max(Math.min(BACKOFF_MS * 2 ** busy, BACKOFF_CAP_MS), out.retry ?? 0);
        if (++busy >= MAX_BUSY || pause > BACKOFF_CAP_MS) return "busy";
        await wait(pause, signal);
        if (signal.aborted) return "stopped";
        out = await attempt();
      }
      busy = 0;
      if (signal.aborted || out.kind === "stale") return "stopped";
      if (out.kind === "offline") return "offline";
      if (out.kind === "patch") tally[(await save(id, out.patch)).ok ? "filled" : "failed"]++;
      else tally[out.kind === "unsure" ? "unsure" : out.kind === "failed" ? "failed" : "empty"]++;
      onStep(id, { ...tally });
    }
    return "finished";
  } finally {
    signal.removeEventListener("abort", stop);
  }
};
