import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { ItemRow } from "../../shared/tables.ts";
import { copiesAt, placesOf } from "../domain/places.ts";
import { useBusy } from "../hooks/use-busy.ts";
import { useTable } from "../hooks/use-store.ts";
import { useWriteLock } from "../hooks/use-write-lock.ts";
import { useBookActions } from "../ui/book-actions.ts";
import { failureOf } from "../ui/failure.ts";
import { Field } from "../ui/field.tsx";
import { Icon } from "../ui/icons.tsx";
import { Modal } from "../ui/modal.tsx";
import { text } from "../ui/text.ts";
import { Title } from "../ui/title.tsx";

const copy = text.books.placesPage;

function Reassign({ place, others, count, onClose }: { place: ItemRow; others: readonly ItemRow[]; count: number; onClose: () => void }) {
  const { deletePlace } = useBookActions();
  const { busy, once } = useBusy();
  const [target, setTarget] = useState(others[0]?.id ?? "");
  const [failure, setFailure] = useState<string[]>([]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    return once(async () => {
      const result = await deletePlace(place, others.find((other) => other.id === target) ?? null);
      setFailure(failureOf(result));
      if (result.ok) onClose();
    });
  };
  return (
    <Modal
      title={copy.reassignTitle(place.title)}
      onClose={onClose}
      onSubmit={submit}
      foot={
        <button type="submit" className="danger bk-drop" disabled={busy}>
          {copy.confirm}
        </button>
      }
    >
      <p>{copy.reassign(count)}</p>
      <div className="form bk-form">
        <Field
          control={{
            name: "target",
            label: copy.reassignTo,
            type: "text",
            value: target,
            blank: text.books.noPlace,
            options: others.map((other) => ({ value: other.id, label: other.title })),
            onChange: setTarget,
          }}
        />
      </div>
      {failure.length > 0 && (
        <p className="error" role="alert">
          {failure.join(" ")}
        </p>
      )}
    </Modal>
  );
}

function PlaceRow({ place, index, last, count, others }: { place: ItemRow; index: number; last: boolean; count: number; others: readonly ItemRow[] }) {
  const { swapPlace, deletePlace, renamePlace } = useBookActions();
  const { busy, once } = useBusy();
  const { locked, hold, guard } = useWriteLock();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [asking, setAsking] = useState(false);
  const [failure, setFailure] = useState<string[]>([]);

  const rename = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locked) return hold();
    if (draft.trim() === "") return setFailure([copy.needName]);
    return once(async () => {
      const result = await renamePlace(place, draft.trim());
      setFailure(failureOf(result));
      if (result.ok) setEditing(false);
    });
  };

  if (editing) {
    return (
      <li className="place-edit">
        <form className="form place-form" noValidate onSubmit={rename} onKeyDown={(event) => event.key === "Escape" && setEditing(false)}>
          <Field control={{ name: "place", label: copy.name, type: "text", words: true, required: true, value: draft, onChange: setDraft }} error={failure[0]} />
          <div className="form-actions">
            <button type="submit" disabled={busy} aria-disabled={locked || undefined} aria-label={copy.save}>
              {text.save}
            </button>
            <button type="button" className="secondary" aria-label={copy.cancel} onClick={() => setEditing(false)}>
              {text.cancel}
            </button>
          </div>
        </form>
      </li>
    );
  }

  const remove = () => (count > 0 ? setAsking(true) : once(async () => setFailure(failureOf(await deletePlace(place, null)))));

  return (
    <li>
      <div className="row place">
        <span className="place-b">
          <span className="title">{place.title}</span>
          <span className="meta">{text.books.copyCount(count)}</span>
        </span>
        <span className="acts">
          <button type="button" className="ib" disabled={busy || index === 0} aria-disabled={locked || undefined} aria-label={copy.up(place.title)} onClick={guard(() => void once(async () => setFailure(failureOf(await swapPlace(place, -1)))))}>
            <Icon name="up" />
          </button>
          <button type="button" className="ib" disabled={busy || last} aria-disabled={locked || undefined} aria-label={copy.down(place.title)} onClick={guard(() => void once(async () => setFailure(failureOf(await swapPlace(place, 1)))))}>
            <Icon name="down" />
          </button>
          <button
            type="button"
            className="ib"
            aria-label={copy.rename(place.title)}
            onClick={() => {
              setDraft(place.title);
              setFailure([]);
              setEditing(true);
            }}
          >
            <Icon name="edit" />
          </button>
          <button type="button" className="ib" disabled={busy} aria-disabled={locked || undefined} aria-label={copy.remove(place.title)} onClick={guard(remove)}>
            <Icon name="trash" />
          </button>
        </span>
      </div>
      {failure.length > 0 && (
        <p className="error" role="alert">
          {failure.join(" ")}
        </p>
      )}
      {asking && <Reassign place={place} others={others} count={count} onClose={() => setAsking(false)} />}
    </li>
  );
}

export function Places() {
  const items = useTable("items");
  const places = useMemo(() => placesOf(items), [items]);
  const { addPlace } = useBookActions();
  const { busy, once } = useBusy();
  const { locked, hold } = useWriteLock();
  const [failure, setFailure] = useState<string[]>([]);

  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locked) return hold();
    const form = event.currentTarget;
    const title = String(new FormData(form).get("title") ?? "").trim();
    if (title === "") return;
    return once(async () => {
      const result = await addPlace(title);
      if (result.ok) form.reset();
      setFailure(failureOf(result));
    });
  };

  return (
    <>
      <p className="trail">
        <a href="#/books">
          <Icon name="back" />
          {copy.back}
        </a>
      </p>
      <Title>{text.books.places}</Title>
      <p className="hint bk-of">{copy.hint}</p>
      <form className="quick-add" noValidate={locked} onSubmit={add}>
        <label className="visually-hidden" htmlFor="place-add">
          {copy.addLabel}
        </label>
        <input id="place-add" name="title" required maxLength={500} autoComplete="off" autoCapitalize="words" enterKeyHint="done" placeholder={copy.addPlaceholder} />
        <button type="submit" disabled={busy} aria-disabled={locked || undefined}>
          {text.add}
        </button>
        {failure.length > 0 && (
          <p className="error" role="alert">
            {failure.join(" ")}
          </p>
        )}
      </form>
      {places.length === 0 ? (
        <p className="empty">{copy.empty}</p>
      ) : (
        <ul className="rows">
          {places.map((place, index) => (
            <PlaceRow
              key={place.id}
              place={place}
              index={index}
              last={index === places.length - 1}
              count={copiesAt(items, place.id).filter((row) => row.status !== "gone").length}
              others={places.filter((other) => other.id !== place.id)}
            />
          ))}
        </ul>
      )}
    </>
  );
}
