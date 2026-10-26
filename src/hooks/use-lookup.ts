import { useEffect, useState } from "react";
import type { ScreenKind } from "../domain/screen.ts";
import type { ScreenHit } from "../domain/tmdb.ts";
import { IDLE, createLookup, follow, followScreen } from "../store/lookup.ts";
import type { Search } from "../store/lookup.ts";

export const lookup = createLookup();

const MIN_LETTERS = 3;

const MIN_SCREEN_LETTERS = 2;

export const useSearch = (input: { title: string; author: string; original: string }, enabled: boolean): Search => {
  const [search, setSearch] = useState<Search>(IDLE);
  const { title, author, original } = input;
  const ready = enabled && title.trim().length >= MIN_LETTERS;

  useEffect(() => follow(lookup, ready, { title, author, original }, setSearch), [ready, title, author, original]);

  return search;
};

export const useScreenSearch = (input: { kind: ScreenKind; title: string; year: number | null }, enabled: boolean): Search<ScreenHit> => {
  const [search, setSearch] = useState<Search<ScreenHit>>(IDLE);
  const { kind, title, year } = input;
  const ready = enabled && title.trim().length >= MIN_SCREEN_LETTERS;

  useEffect(() => followScreen(lookup, ready, { kind, title, year }, setSearch), [ready, kind, title, year]);

  return search;
};
