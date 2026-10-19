import type { ItemRow, Patch } from "../../shared/tables.ts";
import { bySort, compare } from "./order.ts";

export const placesOf = (rows: readonly ItemRow[]) => rows.filter((row) => row.kind === "place").sort(bySort);

export const copiesAt = (rows: readonly ItemRow[], placeId: string) => rows.filter((row) => row.kind === "copy" && row.group_key === placeId);

export const moveCopy = (copy: ItemRow, placeId: string | null, today: string): Patch<"items"> | null =>
  copy.group_key === placeId ? null : { group_key: placeId, data: { was_at: copy.group_key, moved_on: today } };

export const restoreMove = (before: ItemRow): Patch<"items"> => ({
  group_key: before.group_key,
  data: { was_at: before.data?.was_at ?? null, moved_on: before.data?.moved_on ?? null },
});

export const lastPlace = (rows: readonly ItemRow[]): string | null => {
  const places = placesOf(rows);
  const touched = rows
    .filter((row) => row.kind === "copy" && row.status !== "gone" && places.some((place) => place.id === row.group_key))
    .sort((a, b) => compare(b.updated_at, a.updated_at) || compare(a.id, b.id));
  return touched[0]?.group_key ?? places[0]?.id ?? null;
};
