import { useEffect, useState } from "react";
import type { Hit } from "../domain/openlibrary.ts";
import { createLookup } from "../store/lookup.ts";

export const lookup = createLookup();

export type Search = { state: "idle" | "busy" | "offline" | "failed" | "slow" | "empty" | "found"; hits: Hit[] };

const IDLE: Search = { state: "idle", hits: [] };

const MIN_LETTERS = 3;

export const useSearch = (input: { title: string; author: string; original: string }, enabled: boolean): Search => {
  const [search, setSearch] = useState<Search>(IDLE);
  const { title, author, original } = input;
  const ready = enabled && title.trim().length >= MIN_LETTERS;

  useEffect(() => {
    if (!ready) {
      setSearch(IDLE);
      return;
    }
    let current = true;
    setSearch({ state: "busy", hits: [] });
    void lookup.search({ title, author, original }).then((out) => {
      if (!current || out.kind === "stale") return;
      setSearch(out.kind !== "ok" ? { state: out.kind, hits: [] } : out.value.length === 0 ? { state: "empty", hits: [] } : { state: "found", hits: out.value });
    });
    return () => {
      current = false;
    };
  }, [ready, title, author, original]);

  useEffect(() => () => lookup.cancel(), []);

  return search;
};
