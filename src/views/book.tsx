import { useEffect, useId, useRef, useState } from "react";
import type { ItemRow, Patch } from "../../shared/tables.ts";
import { bySort } from "../domain/order.ts";
import { moverOf } from "../domain/places.ts";
import { READING, ratingPatch, readingOf, readingPatch } from "../domain/reading.ts";
import type { Reading } from "../domain/reading.ts";
import { useBusy } from "../hooks/use-busy.ts";
import { useOpenRow } from "../hooks/use-open-row.ts";
import { useLibrary } from "../hooks/use-books.ts";
import { usePartner, useStamp } from "../hooks/use-plan.ts";
import { actions } from "../hooks/use-store.ts";
import { useWriteLock } from "../hooks/use-write-lock.ts";
import { Avatar } from "../ui/avatar.tsx";
import { useBookActions } from "../ui/book-actions.ts";
import { Cover, Stars } from "../ui/book-bits.tsx";
import { FillBook } from "../ui/book-lookup.tsx";
import { CopySheet } from "../ui/copy-sheet.tsx";
import { failureOf } from "../ui/failure.ts";
import { formatDate } from "../ui/format.ts";
import { Icon } from "../ui/icons.tsx";
import { ItemDetail } from "../ui/item-detail.tsx";
import { backHref } from "../ui/item-flows.ts";
import { optionLabel } from "../ui/labels.ts";
import { views } from "../ui/registry.ts";
import { text } from "../ui/text.ts";
import { CopyChip } from "../ui/where.tsx";
import { Gone } from "./generic-item.tsx";

const WISH_ONLY = ["who", "data.priority", "data.gift", "amount", "data.shop", "data.shop_url"];

const SHELF_FIELDS = views.book.fields.filter((field) => !WISH_ONLY.includes(field));

const HEADED = ["data.author", "data.original_title", "data.series", "data.series_no", "data.isbn", "group_key", "data.rated_elsewhere"];

const SHELF_SKIP = [...HEADED, ...WISH_ONLY];

const word = (row: ItemRow, key: string) => (typeof row.data?.[key] === "string" ? (row.data[key] as string) : null);

function Reader({ book }: { book: ItemRow }) {
  const { me, label } = usePartner();
  const stamp = useStamp();
  const { busy, once } = useBusy();
  const { locked, guard } = useWriteLock();
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
            <button key={pick} type="button" disabled={busy} aria-disabled={locked || undefined} aria-pressed={mine.state === pick} onClick={guard(() => run(readingPatch(book, me, pick, stamp())))}>
              {text.books.readingPick[pick]}
            </button>
          ))}
        </div>
        {mine.state === "read" && (
          <div className="rate" role="group" aria-label={text.books.rate}>
            {[1, 2, 3, 4, 5].map((stars) => (
              <button key={stars} type="button" className="star" disabled={busy} aria-disabled={locked || undefined} aria-pressed={mine.rating === stars} aria-label={text.books.rateStar(stars)} data-on={(mine.rating ?? 0) >= stars || undefined} onClick={guard(() => run(ratingPatch(book, me, stars)))}>
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

function LostIt({ book }: { book: ItemRow }) {
  const { lostIt } = useBookActions();
  const { busy, once } = useBusy();
  const { locked, guard } = useWriteLock();
  const [asking, setAsking] = useState(false);
  const [failure, setFailure] = useState<string[]>([]);
  const ask = useRef<HTMLButtonElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const asked = useRef(false);
  const noted = useId();
  useEffect(() => {
    if (asking) {
      asked.current = true;
      keep.current?.focus();
    } else if (asked.current) {
      asked.current = false;
      ask.current?.focus();
    }
  }, [asking]);
  const move = () =>
    once(async () => {
      const result = await lostIt(book);
      setFailure(failureOf(result));
      if (result.ok) document.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
    });
  return (
    <section aria-labelledby="bk-lost">
      <h2 id="bk-lost">{text.books.lostTitle}</h2>
      <p className="hint">{text.books.lostHint}</p>
      {asking ? (
        <div className="lost-sure" role="group" aria-labelledby={noted} onKeyDown={(event) => event.key === "Escape" && !busy && setAsking(false)}>
          <p id={noted} className="lost-q">
            {text.books.lostSure(book.title)}
          </p>
          <div className="lost-acts">
            <button ref={keep} type="button" disabled={busy} onClick={() => setAsking(false)}>
              {text.books.lostKeep}
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={move}>
              {text.books.lostConfirm}
            </button>
          </div>
        </div>
      ) : (
        <button ref={ask} type="button" className="secondary lost" disabled={busy} aria-disabled={locked || undefined} onClick={guard(() => setAsking(true))}>
          <Icon name="back" />
          {text.books.lostIt}
        </button>
      )}
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
  const { gotIt, removeBook, restoreBook } = useBookActions();
  const { busy, once } = useBusy();
  const { locked, guard } = useWriteLock();
  const [sheet, setSheet] = useState<"add" | ItemRow | null>(null);
  const [failure, setFailure] = useState<string[]>([]);
  const found = items.find((row) => row.id === id && row.kind === "book");
  const { row: open, gone } = useOpenRow(found && { book: found, copies: copies.get(found.id) ?? [] });
  if (!open) return <Gone name="book" id={id} back="#/books" />;
  const { book } = open;
  const wish = book.status === "wish";
  const mine = open.copies.filter((copy) => copy.status !== "gone").sort(bySort);
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
      <ItemDetail
        name="book"
        row={book}
        gone={gone}
        back={{ href: backHref("book", book), word: wish ? text.books.wishlist : text.books.shelf }}
        cover={<Cover book={book} alt={text.books.lookup.coverOf(book.title)} />}
        head={
          <>
            {original && <p className="bk-sub">{text.books.original(original)}</p>}
            {author && <p className="bk-sub">{author}</p>}
            {facts.length > 0 && <p className="hint">{facts.join(" · ")}</p>}
            {rated !== null && <p className="hint">{text.books.ratedElsewhere(rated)}</p>}
          </>
        }
        sheet={wish ? views.book.fields : SHELF_FIELDS}
        skip={wish ? HEADED : SHELF_SKIP}
        flows={{ remove: () => removeBook(book, open.copies), restore: () => restoreBook(book) }}
      >
        {!gone && <FillBook key={book.id} book={book} />}
        {gone ? null : wish ? (
          <section aria-labelledby="bk-wish">
            <h2 id="bk-wish">{text.books.wishBook}</h2>
            <button
              type="button"
              className="got"
              disabled={busy}
              aria-disabled={locked || undefined}
              onClick={guard(() =>
                once(async () => {
                  const result = await gotIt(book);
                  setFailure(failureOf(result));
                  if (result.ok) document.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
                }),
              )}
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
            <LostIt key={book.id} book={book} />
          </>
        )}
        {blurb && (
          <section aria-labelledby="bk-about">
            <h2 id="bk-about">{text.books.about}</h2>
            <p className="bk-text-block">{blurb}</p>
          </section>
        )}
        {failure.length > 0 && (
          <p className="error" role="alert">
            {failure.join(" ")}
          </p>
        )}
      </ItemDetail>
      {sheet !== null && !gone && <CopySheet book={book} copy={sheet === "add" ? undefined : sheet} onClose={() => setSheet(null)} />}
    </>
  );
}
