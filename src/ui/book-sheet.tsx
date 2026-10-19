import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { ItemRow } from "../../shared/tables.ts";
import { parseField } from "../domain/field.ts";
import { sortBefore } from "../domain/order.ts";
import { lastPlace, placesOf } from "../domain/places.ts";
import { useBusy } from "../hooks/use-busy.ts";
import { usePartner } from "../hooks/use-plan.ts";
import { actions, useTable } from "../hooks/use-store.ts";
import { Avatar, Pair } from "./avatar.tsx";
import { failureOf } from "./failure.ts";
import { Field } from "./field.tsx";
import { Icon } from "./icons.tsx";
import { Modal } from "./modal.tsx";
import { overlay } from "./overlay.ts";
import { text } from "./text.ts";

type Kind = "shelf" | "wish";

type Owner = "a" | "b" | "both";

const MIN_DIGITS = 10;

export const ownerOptions = (label: (side: string | null) => string) => [
  { value: "a", label: label("a"), icon: <Avatar side="a" /> },
  { value: "b", label: label("b"), icon: <Avatar side="b" /> },
  { value: "both", label: text.both, icon: <Pair /> },
];

export const placeOptions = (places: readonly ItemRow[]) => places.map((place) => ({ value: place.id, label: place.title }));

export function BookSheet({ kind: start, onClose }: { kind: Kind; onClose: () => void }) {
  const items = useTable("items");
  const { me, label } = usePartner();
  const { busy, once } = useBusy();
  const places = useMemo(() => placesOf(items), [items]);
  const [kind, setKind] = useState<Kind>(start);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [original, setOriginal] = useState("");
  const [isbn, setIsbn] = useState("");
  const [ownerPick, setOwnerPick] = useState<Owner | null>(null);
  const [placePick, setPlacePick] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(false);
  const [failure, setFailure] = useState<string[]>([]);

  const owner: Owner = ownerPick ?? (kind === "shelf" ? "both" : (me ?? "both"));
  const placeId = placePick ?? lastPlace(items) ?? "";
  const checked = parseField("isbn", isbn);
  const digits = isbn.replace(/[\s-]/g, "").length;
  const isbnError = !checked.ok && (digits >= MIN_DIGITS || (attempt && isbn.trim() !== "")) ? text.invalid.isbn : undefined;
  const titleError = attempt && title.trim() === "" ? text.books.sheet.needTitle : undefined;

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAttempt(true);
    if (title.trim() === "" || !checked.ok) return;
    return once(async () => {
      const code = checked.value === null ? {} : { isbn: String(checked.value) };
      const data = Object.fromEntries(
        Object.entries({ author: author.trim(), original_title: original.trim() }).filter(([, value]) => value !== ""),
      );
      const book = await actions.create("items", {
        kind: "book",
        title: title.trim(),
        status: kind,
        who: kind === "wish" ? owner : null,
        sort: sortBefore(items.filter((row) => row.kind === "book" && row.status === kind)),
        data: { ...data, ...code },
      });
      const copy =
        book.ok && kind === "shelf"
          ? await actions.create("items", {
              kind: "copy",
              parent_id: book.id,
              title: title.trim(),
              status: "here",
              who: owner,
              group_key: placeId === "" ? null : placeId,
              data: { format: "print", ...code },
            })
          : book;
      setFailure(failureOf(copy));
      if (!copy.ok) return;
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
          {kind === "shelf" ? text.books.sheet.saveShelf : text.books.sheet.saveWish}
        </button>
      }
    >
      <div role="group" aria-label={text.books.sheet.kind} className="kinds">
        {(["shelf", "wish"] as const).map((name) => (
          <button key={name} type="button" aria-pressed={kind === name} onClick={() => setKind(name)}>
            <Icon name={name === "shelf" ? "book" : "star"} />
            {text.books.sheet[name]}
          </button>
        ))}
      </div>
      <div className="form bk-form">
        <Field control={{ name: "title", label: text.books.sheet.title_, type: "text", required: true, words: true, value: title, onChange: setTitle }} error={titleError} />
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
      {failure.length > 0 && (
        <p className="error" role="alert">
          {failure.join(" ")}
        </p>
      )}
    </Modal>
  );
}
