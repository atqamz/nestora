import type { ItemRow } from "../../shared/tables.ts";
import { createLookup, fillBook, fillTitle } from "./lookup.ts";
import type { Fetcher, Lookup } from "./lookup.ts";
import type { Written } from "./store.ts";

export const GAP_MS = 1000;

export type Tally = { filled: number; empty: number; failed: number };

export type Finish = "finished" | "stopped" | "offline";

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
}: {
  ids: readonly string[];
  lookup: Lookup;
  read: (id: string) => ItemRow | undefined;
  save: (id: string, patch: Record<string, string>) => Promise<Written>;
  signal: AbortSignal;
  onStep: (id: string, tally: Tally) => void;
}): Promise<Finish> => {
  const tally: Tally = { filled: 0, empty: 0, failed: 0 };
  const stop = () => lookup.stop();
  signal.addEventListener("abort", stop, { once: true });
  try {
    for (const id of ids) {
      const book = read(id);
      if (signal.aborted) return "stopped";
      if (book === undefined) continue;
      const code = typeof book.data?.isbn === "string" ? book.data.isbn : null;
      const current = () => read(id) ?? book;
      const out = await (code === null ? fillTitle(lookup, current) : fillBook(lookup, code, current));
      if (signal.aborted || out.kind === "stale") return "stopped";
      if (out.kind === "offline") return "offline";
      if (out.kind === "patch") tally[(await save(id, out.patch)).ok ? "filled" : "failed"]++;
      else tally[out.kind === "failed" || out.kind === "slow" ? "failed" : "empty"]++;
      onStep(id, { ...tally });
    }
    return "finished";
  } finally {
    signal.removeEventListener("abort", stop);
  }
};
