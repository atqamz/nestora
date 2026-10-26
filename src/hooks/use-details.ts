import { useEffect, useRef, useState } from "react";
import type { ItemRow } from "../../shared/tables.ts";
import { bookAttempt, detailsLookup, findDetails, needsDetails } from "../store/details.ts";
import type { Attempt, Finish, Tally } from "../store/details.ts";
import { actions, readItems } from "./use-store.ts";

export type Details = { phase: "idle" | "running" | "stopping" | Finish; done: number; total: number; tally: Tally };

const tried = new Map<string, Set<string>>();

export type How = { needs: (row: ItemRow) => boolean; attempt: Attempt<Record<string, unknown>> };

const BOOKS: How = { needs: needsDetails, attempt: bookAttempt };

const NONE: Tally = { filled: 0, empty: 0, failed: 0, unsure: 0 };

export const useDetails = (batch: string, books: readonly ItemRow[], how: How = BOOKS) => {
  const [state, setState] = useState<Details>({ phase: "idle", done: 0, total: 0, tally: NONE });
  const control = useRef<AbortController | null>(null);
  useEffect(() => () => control.current?.abort(), []);

  const seen = tried.get(batch) ?? new Set<string>();
  const remaining = books.filter((book) => how.needs(book) && !seen.has(book.id)).length;

  const start = async () => {
    tried.set(batch, seen);
    const ids = books.filter((book) => how.needs(book) && !seen.has(book.id)).map((book) => book.id);
    const controller = new AbortController();
    control.current = controller;
    setState({ phase: "running", done: seen.size, total: seen.size + ids.length, tally: NONE });
    const finish = await findDetails({
      ids,
      lookup: detailsLookup,
      attempt: how.attempt,
      read: (id) => readItems().find((book) => book.id === id),
      save: (id, patch) => actions.update("items", id, { data: patch }),
      signal: controller.signal,
      onStep: (id, tally) => {
        seen.add(id);
        setState((now) => ({ ...now, done: seen.size, tally }));
      },
    });
    setState((now) => ({ ...now, phase: finish }));
  };

  const stop = () => {
    control.current?.abort();
    setState((now) => ({ ...now, phase: "stopping" }));
  };

  return { state, remaining, tried: seen.size, start, stop };
};
