import { useState } from "react";
import type { FormEvent } from "react";
import type { ItemRow } from "../../shared/tables.ts";
import { placesOf } from "../domain/places.ts";
import { whereOf } from "../domain/shelf.ts";
import { useBusy } from "../hooks/use-busy.ts";
import { useTable } from "../hooks/use-store.ts";
import { useBookActions } from "./book-actions.ts";
import { failureOf } from "./failure.ts";
import { Icon } from "./icons.tsx";
import { Modal } from "./modal.tsx";
import { text } from "./text.ts";

type Places = ReadonlyMap<string, ItemRow>;

export const whereLabel = (copy: ItemRow, places: Places): string | null => {
  const where = whereOf(copy, places);
  if (where === null) return null;
  switch (where.kind) {
    case "place":
      return where.place.title;
    case "ebook":
      return text.books.ebook;
    case "unplaced":
      return text.books.noPlace;
    case "lent":
      return typeof copy.data?.lent_to === "string" ? text.books.lentTo(copy.data.lent_to) : text.books.lentOut;
    case "away":
      return text.books.notWith;
  }
};

export const movable = (copy: ItemRow) => copy.status !== "gone" && copy.status !== "lent" && copy.data?.format !== "ebook";

function Chip({ label, name, onPick }: { label: string; name?: string; onPick?: () => void }) {
  const inside = (
    <>
      <Icon name="place" />
      <span>{label}</span>
      {onPick && <Icon name="down" />}
    </>
  );
  return onPick ? (
    <button type="button" className="where" aria-label={name} onClick={onPick}>
      {inside}
    </button>
  ) : (
    <span className="where">{inside}</span>
  );
}

function PlacePicker({ copy, title, onClose }: { copy: ItemRow; title: string; onClose: () => void }) {
  const items = useTable("items");
  const places = placesOf(items);
  const first = places.find((place) => place.id === copy.group_key)?.id ?? places[0]?.id;
  const { move, addPlace } = useBookActions();
  const { busy, once } = useBusy();
  const [failure, setFailure] = useState<string[]>([]);

  const pick = (id: string | null, name: string) =>
    once(async () => {
      const result = await move(copy, id, name);
      if (result.ok) onClose();
      else setFailure(failureOf(result));
    });

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get("title") ?? "").trim();
    if (name === "") return;
    return once(async () => {
      const made = await addPlace(name);
      if (!made.ok) return setFailure(failureOf(made));
      const result = await move(copy, made.id, name);
      if (result.ok) onClose();
      else setFailure(failureOf(result));
    });
  };

  return (
    <Modal title={text.books.moveTo} onClose={onClose} dismissible>
      <p className="hint bk-of">{title}</p>
      {places.length === 0 ? (
        <p className="empty">{text.books.noPlacesYet}</p>
      ) : (
        <ul className="picks" aria-label={text.books.moveTo}>
          {places.map((place) => (
            <li key={place.id}>
              <button
                type="button"
                className="pick"
                data-first={place.id === first || undefined}
                aria-current={place.id === copy.group_key ? "true" : undefined}
                disabled={busy}
                onClick={() => pick(place.id, place.title)}
              >
                <span>{place.title}</span>
                {place.id === copy.group_key && <Icon name="check" />}
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="quick-add bk-new" onSubmit={create}>
        <label className="visually-hidden" htmlFor="new-place">
          {text.books.newPlaceLabel}
        </label>
        <input id="new-place" name="title" maxLength={500} autoComplete="off" autoCapitalize="words" placeholder={text.books.newPlacePlaceholder} />
        <button type="submit" disabled={busy}>
          <Icon name="plus" />
          {text.books.newPlace}
        </button>
      </form>
      {failure.length > 0 && (
        <p className="error" role="alert">
          {failure.join(" ")}
        </p>
      )}
      <p className="trail">
        <a href="#/places">{text.books.editPlaces}</a>
      </p>
    </Modal>
  );
}

export function CopyChip({ copy, bookTitle, places }: { copy: ItemRow; bookTitle: string; places: Places }) {
  const [open, setOpen] = useState(false);
  const label = whereLabel(copy, places);
  if (label === null) return null;
  if (!movable(copy)) return <Chip label={label} />;
  return (
    <>
      <Chip label={label} name={text.books.moveNamed(bookTitle, label)} onPick={() => setOpen(true)} />
      {open && <PlacePicker copy={copy} title={bookTitle} onClose={() => setOpen(false)} />}
    </>
  );
}

export function BookWhere({ book, copies, places }: { book: ItemRow; copies: readonly ItemRow[]; places: Places }) {
  const kept = copies.filter((copy) => copy.status !== "gone");
  if (book.status === "wish") return <span className="where" data-wish="">{text.books.wishlistTag}</span>;
  if (kept.length === 0) return <Chip label={text.books.notWith} />;
  if (kept.length === 1) return <CopyChip copy={kept[0]} bookTitle={book.title} places={places} />;
  return (
    <>
      {[...new Set(kept.map((copy) => whereLabel(copy, places)))].map((label) => (
        <Chip key={label} label={label ?? ""} />
      ))}
    </>
  );
}
