import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { ItemRow } from "../../shared/tables.ts";
import { parseField } from "../domain/field.ts";
import { adopt, arrive, release } from "../domain/openlibrary.ts";
import type { Found, Hit, Patch } from "../domain/openlibrary.ts";
import { placesOf } from "../domain/places.ts";
import { useBusy } from "../hooks/use-busy.ts";
import { usePartner } from "../hooks/use-plan.ts";
import { lookup, useSearch } from "../hooks/use-lookup.ts";
import { actions, useTable } from "../hooks/use-store.ts";
import { fillOutcome, turns } from "../store/lookup.ts";
import type { Fill } from "../store/lookup.ts";
import type { Written } from "../store/store.ts";
import { Avatar, Pair } from "./avatar.tsx";
import { BookLookup, FillDetails } from "./book-lookup.tsx";
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

const LANGUAGES = [
  { value: "id", label: text.option["book.data.language"].id },
  { value: "en", label: text.option["book.data.language"].en },
  { value: "other", label: text.option["book.data.language"].other },
];

export function useBookForm(start: Kind, title: string, setTitle: (title: string) => void, live = true) {
  const items = useTable("items");
  const { me, label } = usePartner();
  const places = useMemo(() => placesOf(items), [items]);
  const [kept] = useState(overlay.keptBook);
  const [kind, setKind] = useState<Kind>(kept?.kind ?? start);
  const [author, setAuthor] = useState(kept?.author ?? "");
  const [original, setOriginal] = useState(kept?.original ?? "");
  const [isbn, setIsbn] = useState(kept?.isbn ?? "");
  const [language, setLanguage] = useState(kept?.language ?? "");
  const [blurb, setBlurb] = useState(kept?.blurb ?? "");
  const [found, setFound] = useState<Found | null>(kept?.found ?? null);
  const [fill, setFill] = useState<{ isbn: string; state: Fill } | null>(null);
  const [ownerPick, setOwnerPick] = useState<Owner | null>((kept?.ownerPick ?? null) as Owner | null);
  const [placePick, setPlacePick] = useState<string | null>(kept?.placePick ?? null);
  const [attempt, setAttempt] = useState(false);
  const [turn] = useState(turns);
  const typed = useRef({ title, author, original, isbn, language, blurb, found });
  typed.current = { title, author, original, isbn, language, blurb, found };

  const { owner, placeId } = bookDefaults({ kind, ownerPick, placePick }, items, me);
  const checked = parseField("isbn", isbn);
  const digits = isbn.replace(/[\s\p{Pd}]/gu, "").length;
  const isbnError = !checked.ok && (digits >= MIN_DIGITS || (attempt && isbn.trim() !== "")) ? text.invalid.isbn : undefined;
  const settled = found !== null && found.title === title.trim() ? found : null;
  const search = useSearch({ title, author, original }, live && settled === null);
  const pristine = [title, author, original, isbn, language, blurb].every((value) => value === "") && found === null && ownerPick === null && placePick === null;

  useEffect(() => {
    if (live) overlay.keepBook(pristine ? null : { kind, title, author, original, isbn, language, blurb, found: settled, ownerPick, placePick });
  }, [live, pristine, kind, title, author, original, isbn, language, blurb, settled, ownerPick, placePick]);

  const put = (patch: Patch) => {
    if (patch.author !== null) setAuthor(patch.author);
    if (patch.original !== null) setOriginal(patch.original);
    if (patch.isbn !== null) setIsbn(patch.isbn);
    if (patch.language !== null) setLanguage(patch.language);
    if (patch.blurb !== null) setBlurb(patch.blurb);
  };

  useEffect(() => {
    if (!live || found === null || found.title === title.trim()) return;
    put(release(typed.current));
    setFound(null);
  }, [live, found, title]);

  const accept = (hit: Hit) => {
    const next = adopt(typed.current, hit);
    setTitle(next.title);
    put(next.patch);
    setFound(next.found);
    if (!next.wantsBlurb) return;
    void lookup.blurb(hit.work).then((out) => {
      const got = arrive(typed.current, hit.work, out.kind === "ok" ? (out.value ?? "") : "");
      if (got === null) return;
      setBlurb(got.blurb);
      setFound(got.found);
    });
  };

  const fillIn = async () => {
    if (!checked.ok || checked.value === null) return;
    const mine = turn.begin();
    setFill({ isbn, state: "busy" });
    const { hit, state } = fillOutcome(await lookup.byIsbn(String(checked.value)), typed.current, turn.latest(mine));
    if (hit !== null) accept(hit);
    if (state !== null) setFill({ isbn, state });
  };

  const save = (): Promise<Written> =>
    saveBook(items, actions.create, { kind, title, author, original, isbn, language, blurb, cover: settled?.cover ?? "", ol: settled?.ol ?? "", ownerPick, placePick }, me);

  return {
    kind,
    setKind,
    attempt,
    reveal: () => setAttempt(true),
    valid: checked.ok,
    saveLabel: kind === "shelf" ? text.books.sheet.saveShelf : text.books.sheet.saveWish,
    save,
    fields: {
      author,
      setAuthor,
      original,
      setOriginal,
      isbn,
      setIsbn,
      isbnError,
      checked,
      language,
      setLanguage,
      blurb,
      setBlurb,
      search: settled === null ? search : { state: "idle" as const, hits: [] },
      accept,
      fill: fill?.isbn === isbn ? fill.state : ("idle" as const),
      fillIn,
      owner,
      setOwnerPick,
      placeId,
      setPlacePick,
      places,
      label,
    },
  };
}

export type BookForm = ReturnType<typeof useBookForm>;

export function BookFields({ form, children }: { form: BookForm; children?: ReactNode }) {
  const { kind, setKind } = form;
  const { author, setAuthor, original, setOriginal, isbn, setIsbn, isbnError, checked, language, setLanguage, blurb, setBlurb, owner, setOwnerPick, placeId, setPlacePick, places, label } = form.fields;
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
        <BookLookup form={form} />
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
        <FillDetails form={form} />
        <Field control={{ name: "language", label: text.books.sheet.language, type: "text", value: language, blank: text.books.sheet.languageNone, options: LANGUAGES, onChange: setLanguage }} />
        <Field control={{ name: "blurb", label: text.books.sheet.blurb, type: "note", value: blurb, onChange: setBlurb }} />
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
  const form = useBookForm(start, title, setTitle);
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
