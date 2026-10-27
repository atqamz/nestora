import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { ItemRow } from "../../shared/tables.ts";
import { parseField } from "../domain/field.ts";
import { lastPlace, moveCopy, placesOf } from "../domain/places.ts";
import { useBusy } from "../hooks/use-busy.ts";
import { usePartner, useStamp } from "../hooks/use-plan.ts";
import { actions, useTable } from "../hooks/use-store.ts";
import { useWriteLock } from "../hooks/use-write-lock.ts";
import { useBookActions } from "./book-actions.ts";
import { ownerOptions, placeOptions } from "./book-sheet.tsx";
import { failureOf } from "./failure.ts";
import { Field } from "./field.tsx";
import { Modal } from "./modal.tsx";
import { lockedProps } from "./paused-note.tsx";
import { text } from "./text.ts";

type Format = "print" | "ebook" | "audio";

type Owner = "a" | "b" | "both";

const FORMATS = ["print", "ebook", "audio"] as const;

export function CopySheet({ book, copy, onClose }: { book: ItemRow; copy?: ItemRow; onClose: () => void }) {
  const items = useTable("items");
  const { me, label } = usePartner();
  const { busy, once } = useBusy();
  const { locked } = useWriteLock();
  const { removeCopy } = useBookActions();
  const stamp = useStamp();
  const places = useMemo(() => placesOf(items), [items]);
  const [format, setFormat] = useState<Format>((FORMATS.find((known) => known === copy?.data?.format) ?? "print") as Format);
  const [owner, setOwner] = useState<Owner>((copy?.who as Owner | null) ?? "both");
  const [placeId, setPlaceId] = useState(copy ? (copy.group_key ?? "") : (lastPlace(items) ?? ""));
  const [isbn, setIsbn] = useState(typeof copy?.data?.isbn === "string" ? copy.data.isbn : "");
  const [attempt, setAttempt] = useState(false);
  const [failure, setFailure] = useState<string[]>([]);
  const checked = parseField("isbn", isbn);

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locked) return;
    setAttempt(true);
    if (!checked.ok) return;
    return once(async () => {
      const place = format === "ebook" || placeId === "" ? null : placeId;
      const code = checked.value === null ? null : String(checked.value);
      const result = copy
        ? await actions.update("items", copy.id, { who: owner, data: { format, isbn: code } })
        : await actions.create("items", {
            kind: "copy",
            parent_id: book.id,
            title: book.title,
            status: "here",
            who: owner,
            group_key: place,
            data: { format, ...(code === null ? {} : { isbn: code }) },
          });
      const patch = result.ok && copy ? moveCopy(copy, place, stamp(), me) : null;
      const moved = patch === null ? result : await actions.update("items", copy!.id, patch);
      setFailure(failureOf(moved));
      if (moved.ok) onClose();
    });
  };

  const remove = () =>
    once(async () => {
      const result = await removeCopy(copy!);
      setFailure(failureOf(result));
      if (result.ok) onClose();
    });

  return (
    <Modal
      title={copy ? text.books.copySheet.edit : text.books.copySheet.add}
      onClose={onClose}
      onSubmit={save}
      foot={
        <>
          <button type="submit" disabled={busy} {...lockedProps(locked)}>
            {copy ? text.books.copySheet.save : text.books.copySheet.saveAdd}
          </button>
          {copy && (
            <button type="button" className="danger bk-drop" disabled={busy} {...lockedProps(locked)} onClick={locked ? undefined : remove}>
              {text.books.removeCopy}
            </button>
          )}
        </>
      }
    >
      <p className="hint bk-of">{book.title}</p>
      <div className="form bk-form">
        <Field
          control={{
            name: "format",
            label: text.books.format,
            type: "text",
            required: true,
            choice: true,
            value: format,
            onChange: (value) => setFormat(value as Format),
            options: FORMATS.map((value) => ({ value, label: text.books.formats[value] })),
          }}
        />
        <Field
          control={{ name: "owner", label: text.books.owner, type: "text", required: true, choice: true, value: owner, onChange: (value) => setOwner(value as Owner), options: ownerOptions(label) }}
        />
        {format !== "ebook" && (
          <Field control={{ name: "place", label: text.books.place, type: "text", value: placeId, blank: text.books.noPlace, options: placeOptions(places), onChange: setPlaceId }} />
        )}
        <Field
          control={{ name: "isbn", label: text.books.sheet.isbn, type: "isbn", value: isbn, onChange: setIsbn }}
          error={attempt && !checked.ok ? text.invalid.isbn : undefined}
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
