import { useMemo } from "react";
import { placesOf } from "../domain/places.ts";
import { copiesByBook } from "../domain/shelf.ts";
import { useTable } from "./use-store.ts";

export const useLibrary = () => {
  const items = useTable("items");
  return useMemo(() => ({ items, places: new Map(placesOf(items).map((place) => [place.id, place])), copies: copiesByBook(items) }), [items]);
};
