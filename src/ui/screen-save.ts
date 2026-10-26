import type { ItemRow } from "../../shared/tables.ts";
import { joinPatch, parseCollection } from "../domain/collection.ts";
import { todayIn } from "../domain/dates.ts";
import { sortBefore } from "../domain/order.ts";
import { datePatch, parseYear, restoreDate, restoreStatus, statusPatch, watchedDate } from "../domain/screen.ts";
import type { ScreenKind, Watch } from "../domain/screen.ts";
import { expiredSteps, purgePatch, restorePosterPatch, revivePatch, tmdbData } from "../domain/tmdb.ts";
import type { Picked } from "../domain/tmdb.ts";
import type { Snapshot, Store, Written } from "../store/store.ts";
import { failureOf } from "./failure.ts";
import { formatDate } from "./format.ts";
import { overlay } from "./overlay.ts";
import { views } from "./registry.ts";
import { text } from "./text.ts";

export type ScreenInput = { kind: ScreenKind; title: string; year: string; status: "want" | "watched"; who: "a" | "b" | "both"; collection?: string; picked?: Picked | null };

export const screenProblems = (title: string, year: string) => ({
  title: title.trim() === "" ? text.screen.sheet.needTitle : undefined,
  year: parseYear(year).ok ? undefined : text.invalid.year,
});

export const collectionProblem = (collection: string) => (parseCollection(collection).ok ? undefined : text.screen.collection.invalid);

export const saveScreen = async (items: readonly ItemRow[], create: Store["create"], input: ScreenInput, today: string, tmdbDay = today): Promise<Written> => {
  const errors = [...Object.values(screenProblems(input.title, input.year)), collectionProblem(input.collection ?? "")].filter((message) => message !== undefined);
  const year = parseYear(input.year);
  const named = parseCollection(input.collection ?? "");
  if (errors.length > 0 || !year.ok || !named.ok) return { ok: false, errors };
  return create("items", {
    kind: input.kind,
    title: input.title.trim(),
    status: input.status,
    who: input.who,
    ...(input.status === "watched" ? { done_on: today } : {}),
    sort: sortBefore(items.filter((row) => row.kind === input.kind && row.status === input.status)),
    data: {
      ...(year.value === null ? {} : { year: year.value }),
      ...tmdbData(input.picked ?? null, tmdbDay),
      ...(named.value === null ? {} : joinPatch(items, input.kind, named.value).data),
    },
  });
};

export const sweepDay = ({ paused, me }: Pick<Snapshot, "paused" | "me">, now: Date | null, timezone: string) =>
  paused || me === null || now === null ? null : todayIn(now, timezone);

export const sweepDeps = ({ rows, paused, me, dated }: Snapshot) => [rows.items, paused, me, dated] as const;

export const sweepExpired = (items: readonly ItemRow[], today: string | null, many: Store["many"]) => {
  const steps = today === null ? [] : expiredSteps(items, today);
  if (steps.length > 0) void many(steps);
};

export const undoing = (work: () => Promise<Written>, refused?: string) => ({
  label: text.undo,
  run: () =>
    void work().then((undone) => {
      const message = failureOf(undone, refused);
      if (message.length > 0) overlay.announce(message.join(" "));
    }),
});

export const moveScreen = async (actions: Pick<Store, "update">, row: ItemRow, pick: Watch, today: string): Promise<Written> => {
  const patch = statusPatch(row, pick, today);
  if (patch === null) return { ok: true, id: row.id };
  const result = await actions.update("items", row.id, patch);
  if (result.ok) overlay.announce(text.screen.moved(row.title, text.screen.pick[pick]), undoing(() => actions.update("items", row.id, restoreStatus(row))));
  return result;
};

export const moveWatched = async (actions: Pick<Store, "update">, row: ItemRow, raw: string, today: string): Promise<Written> => {
  const date = watchedDate(raw, today);
  if (!date.ok) return { ok: false, errors: [text.screen.watchedDate[date.reason]] };
  const patch = datePatch(row, date.value);
  if (patch === null) return { ok: true, id: row.id };
  const result = await actions.update("items", row.id, patch);
  if (result.ok) overlay.announce(text.screen.watchedDate.changed(row.title, formatDate(date.value)), undoing(() => actions.update("items", row.id, restoreDate(row)), text.screen.watchedDate.undoRefused));
  return result;
};

type Deps = { actions: Pick<Store, "update" | "remove">; go: (hash: string) => void };

export const removeScreen = async ({ actions, go }: Deps, row: ItemRow, kind: ScreenKind): Promise<Written> => {
  const result = await actions.remove("items", row.id);
  if (result.ok) {
    go(`/${views[kind].route}`);
    overlay.announce(text.screen.deleted(row.title), undoing(() => actions.update("items", row.id, revivePatch(row))));
  }
  return result;
};

export const removePoster = async (actions: Pick<Store, "update">, row: ItemRow): Promise<Written> => {
  const result = await actions.update("items", row.id, purgePatch());
  if (result.ok) overlay.announce(text.screen.posterRemoved(row.title), undoing(() => actions.update("items", row.id, restorePosterPatch(row))));
  return result;
};
