import type { ItemRow } from "../../shared/tables.ts";
import { readingOf, readersNow } from "../domain/reading.ts";
import type { Reading } from "../domain/reading.ts";
import { usePartner } from "../hooks/use-plan.ts";
import { Cover, Stars } from "./book-bits.tsx";
import { text } from "./text.ts";
import { BookWhere } from "./where.tsx";

const author = (book: ItemRow) => (typeof book.data?.author === "string" ? book.data.author : null);

export function ReadingLine({ book }: { book: ItemRow }) {
  const { me, label } = usePartner();
  const sides = me === "b" ? (["b", "a"] as const) : (["a", "b"] as const);
  const lines = sides.flatMap((side) => {
    const { state, rating } = readingOf(book, side);
    return state === null ? [] : [{ side, state, rating }];
  });
  if (lines.length === 0) return null;
  return (
    <span className="meta">
      {lines.map(({ side, state, rating }) => (
        <span key={side} className="reads" data-reading={state === "reading" || undefined}>
          {label(side)} · {text.books.readingLine[state as Reading]}
          {rating !== null && <Stars value={rating} />}
        </span>
      ))}
    </span>
  );
}

export function BookRow({ book, copies, places, where }: { book: ItemRow; copies: readonly ItemRow[]; places: ReadonlyMap<string, ItemRow>; where?: true }) {
  const by = author(book);
  return (
    <li className="bk" data-reading={readersNow(book).length > 0 || undefined}>
      <a className="bk-link" href={`#/books/${book.id}`}>
        <Cover book={book} />
        <span className="bk-text">
          <span className="title">{book.title}</span>
          {by && <span className="bk-by">{by}</span>}
          {book.status === "shelf" && <ReadingLine book={book} />}
        </span>
      </a>
      {where && (
        <div className="bk-where">
          <BookWhere book={book} copies={copies} places={places} />
        </div>
      )}
    </li>
  );
}
