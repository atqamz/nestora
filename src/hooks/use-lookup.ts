import { useEffect, useState } from "react";
import { IDLE, createLookup, follow } from "../store/lookup.ts";
import type { Search } from "../store/lookup.ts";

export const lookup = createLookup();

const MIN_LETTERS = 3;

export const useSearch = (input: { title: string; author: string; original: string }, enabled: boolean): Search => {
  const [search, setSearch] = useState<Search>(IDLE);
  const { title, author, original } = input;
  const ready = enabled && title.trim().length >= MIN_LETTERS;

  useEffect(() => follow(lookup, ready, { title, author, original }, setSearch), [ready, title, author, original]);

  return search;
};
