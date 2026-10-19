import { useState } from "react";
import type { ItemRow, Patch } from "../../shared/tables.ts";
import { bySort } from "../domain/order.ts";
import { moverOf } from "../domain/places.ts";
import { READING, ratingPatch, readingOf, readingPatch } from "../domain/reading.ts";
import type { Reading } from "../domain/reading.ts";
import { useBusy } from "../hooks/use-busy.ts";
import { useLibrary } from "../hooks/use-books.ts";
import { usePartner, useStamp } from "../hooks/use-plan.ts";
import { actions } from "../hooks/use-store.ts";
import { Avatar, Who } from "../ui/avatar.tsx";
import { useBookActions } from "../ui/book-actions.ts";
import { Cover, Stars } from "../ui/book-bits.tsx";
import { FillBook } from "../ui/book-lookup.tsx";
import { CopySheet } from "../ui/copy-sheet.tsx";
import { failureOf } from "../ui/failure.ts";
import { formatDate } from "../ui/format.ts";
import { Icon } from "../ui/icons.tsx";
import { ItemForm } from "../ui/item-form.tsx";
import { optionLabel } from "../ui/labels.ts";
import { Money } from "../ui/money.tsx";
import { views } from "../ui/registry.ts";
import { text } from "../ui/text.ts";
import { Title } from "../ui/title.tsx";
import { CopyChip } from "../ui/where.tsx";
import { Gone } from "./generic-item.tsx";

const WISH_ONLY = ["who", "data.priority", "data.gift", "amount", "data.shop", "data.shop_url"];

const SHELF_FIELDS = views.book.fields.filter((field) => !WISH_ONLY.includes(field));

const word = (row: ItemRow, key: string) => (typeof row.data?.[key] === "string" ? (row.data[key] as string) : null);

function Reader({ book }: { book: ItemRow }) {
  const { me, label } = usePartner();
  const stamp = useStamp();
  const { busy, once } = useBusy();
  const [failure, setFailure] = useState<string[]>([]);
  if (me === null) return null;
  const them = me === "a" ? "b" : "a";
  const mine = readingOf(book, me);
  const theirs = readingOf(book, them);
  const run = (patch: Patch<"items">) =>
    once(async () => setFailure(failureOf(await actions.update("items", book.id, patch))));
  return (
    <section aria-labelledby="bk-reading">
      <h2 id="bk-reading">{text.books.reading}</h2>
      <div className="reader">
        <p className="reader-n">
          <Avatar side={me} />
          {label(me)}
        </p>
        <div role="group" aria-label={`${label(me)}: ${text.books.reading}`} className="seg reader-seg">
          {READING.map((pick) => (
            <button key={pick} type="button" disabled={busy} aria-pressed={mine.state === pick} onClick={() => run(readingPatch(book, me, pick, stamp()))}>
              {text.books.readingPick[pick]}
            </button>
          ))}
        </div>
        {mine.state === "read" && (
          <div className="rate" role="group" aria-label={text.books.rate}>
            {[1, 2, 3, 4, 5].map((stars) => (
              <button key={stars} type="button" className="star" disabled={busy} aria-pressed={mine.rating === stars} aria-label={text.books.rateStar(stars)} data-on={(mine.rating ?? 0) >= stars || undefined} onClick={() => run(ratingPatch(book, me, stars))}>
                <Icon name="star" />
              </button>
            ))}
            {mine.finished && <span className="hint">{text.books.readOn(formatDate(mine.finished))}</span>}
          </div>
        )}
      </div>
      <div className="reader">
        <p className="reader-n">
          <Avatar side={them} />
          {label(them)}
        </p>
        <p className="reader-s">
          {theirs.state === null ? text.books.readingNone : text.books.readingLine[theirs.state as Reading]}
          {theirs.state === "read" && theirs.finished && ` · ${formatDate(theirs.finished)}`}
          {theirs.rating !== null && <Stars value={theirs.rating} />}
        </p>
      </div>
      {failure.length > 0 && (
        <p className="error" role="alert">
          {failure.join(" ")}
        </p>
      )}
    </section>
  );
}

function Copy({ copy, book, places, onEdit }: { copy: ItemRow; book: ItemRow; places: ReadonlyMap<string, ItemRow>; onEdit: () => void }) {
  const { label } = usePartner();
  const format = optionLabel("book", "data.format", word(copy, "format") ?? "print", label);
  const language = word(copy, "language");
  const moved = word(copy, "moved_on");
  const place = places.get(copy.group_key ?? "");
  const mover = moverOf(copy);
  const by = mover === null ? null : label(mover);
  const owner = copy.who === "both" ? text.books.shared : copy.who === null ? null : text.books.ownedBy(label(copy.who));
  return (
    <li className="copy">
      <div className="copy-top">
        <CopyChip copy={copy} bookTitle={book.title} places={places} />
        <button type="button" className="ib" aria-label={text.books.editCopy(book.title)} onClick={onEdit}>
          <Icon name="edit" />
        </button>
      </div>
      <p className="hint">
        {[format, language === null ? null : optionLabel("book", "data.language", language, label), owner].filter(Boolean).join(" · ")}
      </p>
      {moved !== null && place && <p className="hint">{text.books.movedLine(place.title, by, formatDate(moved))}</p>}
    </li>
  );
}

export function BookDetail({ id }: { id: string }) {
  const { items, places, copies } = useLibrary();
  const { label } = usePartner();
  const { gotIt, removeBook } = useBookActions();
  const { busy, once } = useBusy();
  const [sheet, setSheet] = useState<"add" | ItemRow | null>(null);
  const [failure, setFailure] = useState<string[]>([]);
  const book = items.find((row) => row.id === id && row.kind === "book");
  if (!book) return <Gone name="book" id={id} back="#/books" />;
  const wish = book.status === "wish";
  const mine = (copies.get(book.id) ?? []).filter((copy) => copy.status !== "gone").sort(bySort);
  const author = word(book, "author");
  const original = word(book, "original_title");
  const series = word(book, "series");
  const seriesNo = typeof book.data?.series_no === "number" ? book.data.series_no : null;
  const isbn = word(book, "isbn");
  const rated = word(book, "rated_elsewhere");
  const blurb = word(book, "blurb");
  const facts = [series === null ? null : text.books.series(series, seriesNo), book.group_key, isbn === null ? null : text.books.isbnLabel(isbn)].filter(Boolean);

  return (
    <>
      <p className="trail">
        <a href={wish ? "#/wishlist" : "#/books"}>
          <Icon name="back" />
          {wish ? text.books.wishlist : text.books.shelf}
        </a>
      </p>
      <div className="bk-head">
        <Cover book={book} alt={text.books.lookup.coverOf(book.title)} />
        <div className="bk-id">
          <Title>{book.title}</Title>
          {original && <p className="bk-sub">{text.books.original(original)}</p>}
          {author && <p className="bk-sub">{author}</p>}
          {facts.length > 0 && <p className="hint">{facts.join(" · ")}</p>}
          {rated !== null && <p className="hint">{text.books.ratedElsewhere(rated)}</p>}
        </div>
      </div>
      <FillBook key={book.id} book={book} />
      {wish ? (
        <section aria-labelledby="bk-wish">
          <h2 id="bk-wish">{text.books.wishBook}</h2>
          <p className="facts">
            {book.who !== null && <Who side={book.who} />}
            {book.data?.gift === true && <span>{text.books.giftIdea}</span>}
            {book.amount !== null && <Money rupiah={book.amount} />}
            {word(book, "shop") && <span>{word(book, "shop")}</span>}
          </p>
          <button
            type="button"
            className="got"
            disabled={busy}
            onClick={() =>
              once(async () => {
                const result = await gotIt(book);
                setFailure(failureOf(result));
                if (result.ok) document.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
              })
            }
          >
            <Icon name="check" />
            {text.books.gotIt}
          </button>
        </section>
      ) : (
        <>
          <section aria-labelledby="bk-where">
            <h2 id="bk-where">{text.books.where}</h2>
            {mine.length === 0 ? (
              <p className="empty">{text.books.noCopy}</p>
            ) : (
              <ul className="copies">
                {mine.map((copy) => (
                  <Copy key={copy.id} copy={copy} book={book} places={places} onEdit={() => setSheet(copy)} />
                ))}
              </ul>
            )}
            <button type="button" className="secondary bk-add" onClick={() => setSheet("add")}>
              <Icon name="plus" />
              {mine.length === 0 ? text.books.addFirstCopy : text.books.addCopy}
            </button>
          </section>
          <Reader book={book} />
        </>
      )}
      {blurb && (
        <section aria-labelledby="bk-about">
          <h2 id="bk-about">{text.books.about}</h2>
          <p className="bk-text-block">{blurb}</p>
        </section>
      )}
      {book.note && (
        <section aria-labelledby="bk-notes">
          <h2 id="bk-notes">{text.books.notes}</h2>
          <p className="bk-text-block">{book.note}</p>
        </section>
      )}
      {failure.length > 0 && (
        <p className="error" role="alert">
          {failure.join(" ")}
        </p>
      )}
      <section aria-labelledby="bk-edit">
        <h2 id="bk-edit">{text.books.edit}</h2>
        <ItemForm key={book.id} name="book" row={book} only={wish ? views.book.fields : SHELF_FIELDS} onRemove={() => removeBook(book, copies.get(book.id) ?? [])} />
      </section>
      {sheet !== null && <CopySheet book={book} copy={sheet === "add" ? undefined : sheet} onClose={() => setSheet(null)} />}
    </>
  );
}
