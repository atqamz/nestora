import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { ItemRow } from "../../shared/tables.ts";
import { parseField } from "../domain/field.ts";
import { placesOf } from "../domain/places.ts";
import { useBusy } from "../hooks/use-busy.ts";
import { usePartner } from "../hooks/use-plan.ts";
import { actions, useTable } from "../hooks/use-store.ts";
import type { Written } from "../store/store.ts";
import { Avatar, Pair } from "./avatar.tsx";
import { bookDefaults, saveBook } from "./book-save.ts";
import type { BookKind as Kind, BookOwner as Owner } from "./book-save.ts";
import { failureOf } from "./failure.ts";
import { Field } from "./field.tsx";
import { Icon } from "./icons.tsx";
import { Modal } from "./modal.tsx";
import { overlay } from "./overlay.ts";
import { text } from "./text.ts";

const MIN_DIGITS = 10;

export const ownerOptions = (label: (side: string | null) => string) => [
  { value: "a", label: label("a"), icon: <Avatar side="a" /> },
  { value: "b", label: label("b"), icon: <Avatar side="b" /> },
  { value: "both", label: text.both, icon: <Pair /> },
];

export const placeOptions = (places: readonly ItemRow[]) => places.map((place) => ({ value: place.id, label: place.title }));

export function useBookForm(start: Kind, title: string, live = true) {
  const items = useTable("items");
  const { me, label } = usePartner();
  const places = useMemo(() => placesOf(items), [items]);
  const [kept] = useState(overlay.keptBook);
  const [kind, setKind] = useState<Kind>(kept?.kind ?? start);
  const [author, setAuthor] = useState(kept?.author ?? "");
  const [original, setOriginal] = useState(kept?.original ?? "");
  const [isbn, setIsbn] = useState(kept?.isbn ?? "");
  const [ownerPick, setOwnerPick] = useState<Owner | null>((kept?.ownerPick ?? null) as Owner | null);
  const [placePick, setPlacePick] = useState<string | null>(kept?.placePick ?? null);
  const [attempt, setAttempt] = useState(false);

  const { owner, placeId } = bookDefaults({ kind, ownerPick, placePick }, items, me);
  const checked = parseField("isbn", isbn);
  const digits = isbn.replace(/[\s\p{Pd}]/gu, "").length;
  const isbnError = !checked.ok && (digits >= MIN_DIGITS || (attempt && isbn.trim() !== "")) ? text.invalid.isbn : undefined;
  const pristine = [title, author, original, isbn].every((value) => value === "") && ownerPick === null && placePick === null;

  useEffect(() => {
    if (live) overlay.keepBook(pristine ? null : { kind, title, author, original, isbn, ownerPick, placePick });
  }, [live, pristine, kind, title, author, original, isbn, ownerPick, placePick]);

  const save = (): Promise<Written> => saveBook(items, actions.create, { kind, title, author, original, isbn, ownerPick, placePick }, me);

  return {
    kind,
    setKind,
    attempt,
    reveal: () => setAttempt(true),
    valid: checked.ok,
    saveLabel: kind === "shelf" ? text.books.sheet.saveShelf : text.books.sheet.saveWish,
    save,
    fields: { author, setAuthor, original, setOriginal, isbn, setIsbn, isbnError, checked, owner, setOwnerPick, placeId, setPlacePick, places, label },
  };
}

export type BookForm = ReturnType<typeof useBookForm>;

export function BookFields({ form, children }: { form: BookForm; children?: ReactNode }) {
  const { kind, setKind } = form;
  const { author, setAuthor, original, setOriginal, isbn, setIsbn, isbnError, checked, owner, setOwnerPick, placeId, setPlacePick, places, label } = form.fields;
  return (
    <>
      <div role="group" aria-label={text.books.sheet.kind} className="kinds">
        {(["shelf", "wish"] as const).map((name) => (
          <button key={name} type="button" aria-pressed={kind === name} onClick={() => setKind(name)}>
            <Icon name={name === "shelf" ? "book" : "star"} />
            {text.books.sheet[name]}
          </button>
        ))}
      </div>
      <div className="form bk-form">
        {children}
        <Field control={{ name: "author", label: text.books.sheet.author, type: "text", words: true, value: author, onChange: setAuthor }} />
        <Field control={{ name: "original", label: text.books.sheet.original, type: "text", words: true, hint: text.books.sheet.originalHint, value: original, onChange: setOriginal }} />
        <Field
          control={{
            name: "isbn",
            label: text.books.sheet.isbn,
            type: "isbn",
            hint: checked.ok && checked.value !== null ? text.books.sheet.isbnOk(String(checked.value)) : text.books.sheet.isbnHint,
            value: isbn,
            onChange: setIsbn,
          }}
          error={isbnError}
        />
        <Field
          control={{
            name: "owner",
            label: text.books.sheet.owner[kind],
            type: "text",
            required: true,
            choice: true,
            value: owner,
            onChange: (value) => setOwnerPick(value as Owner),
            options: ownerOptions(label),
          }}
        />
        {kind === "shelf" && (
          <Field
            control={{
              name: "place",
              label: text.books.sheet.place,
              type: "text",
              value: placeId,
              blank: text.books.noPlace,
              options: placeOptions(places),
              onChange: setPlacePick,
            }}
          />
        )}
      </div>
    </>
  );
}

export function BookSheet({ kind: start, onClose }: { kind: Kind; onClose: () => void }) {
  const { busy, once } = useBusy();
  const [title, setTitle] = useState(() => overlay.keptBook()?.title ?? "");
  const form = useBookForm(start, title);
  const [failure, setFailure] = useState<string[]>([]);
  const titleError = form.attempt && title.trim() === "" ? text.books.sheet.needTitle : undefined;

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    form.reveal();
    if (title.trim() === "" || !form.valid) return;
    return once(async () => {
      const result = await form.save();
      setFailure(failureOf(result));
      if (!result.ok) return;
      overlay.announce(text.books.addedBook(title.trim()));
      onClose();
    });
  };

  return (
    <Modal
      title={start === "wish" ? text.books.sheet.wishTitle : text.books.sheet.title}
      onClose={onClose}
      onSubmit={save}
      foot={
        <button type="submit" disabled={busy}>
          {form.saveLabel}
        </button>
      }
    >
      <BookFields form={form}>
        <Field control={{ name: "title", label: text.books.sheet.title_, type: "text", required: true, words: true, value: title, onChange: setTitle }} error={titleError} />
      </BookFields>
      {failure.length > 0 && (
        <p className="error" role="alert">
          {failure.join(" ")}
        </p>
      )}
    </Modal>
  );
}
