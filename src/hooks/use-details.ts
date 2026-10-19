import { useEffect, useRef, useState } from "react";
import type { ItemRow } from "../../shared/tables.ts";
import { detailsLookup, findDetails, needsDetails } from "../store/details.ts";
import type { Finish, Tally } from "../store/details.ts";
import { actions } from "./use-store.ts";

export type Details = { phase: "idle" | "running" | "stopping" | Finish; done: number; total: number; tally: Tally };

const tried = new Map<string, Set<string>>();

const NONE: Tally = { filled: 0, empty: 0, failed: 0 };

export const useDetails = (batch: string, books: readonly ItemRow[]) => {
  const [state, setState] = useState<Details>({ phase: "idle", done: 0, total: 0, tally: NONE });
  const control = useRef<AbortController | null>(null);
  const latest = useRef(books);
  latest.current = books;
  useEffect(() => () => control.current?.abort(), []);

  const seen = tried.get(batch) ?? new Set<string>();
  const remaining = books.filter((book) => needsDetails(book) && !seen.has(book.id)).length;

  const start = async () => {
    tried.set(batch, seen);
    const ids = books.filter((book) => needsDetails(book) && !seen.has(book.id)).map((book) => book.id);
    const controller = new AbortController();
    control.current = controller;
    setState({ phase: "running", done: seen.size, total: seen.size + ids.length, tally: NONE });
    const finish = await findDetails({
      ids,
      lookup: detailsLookup,
      read: (id) => latest.current.find((book) => book.id === id),
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
