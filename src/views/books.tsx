import { useMemo, useState } from "react";
import type { ItemRow } from "../../shared/tables.ts";
import { bySort } from "../domain/order.ts";
import { readingNow } from "../domain/reading.ts";
import { searchBooks } from "../domain/search.ts";
import { shelfSections } from "../domain/shelf.ts";
import type { Where } from "../domain/shelf.ts";
import { wishSections } from "../domain/wish.ts";
import { useBusy } from "../hooks/use-busy.ts";
import { useLibrary } from "../hooks/use-books.ts";
import { Who } from "../ui/avatar.tsx";
import { useBookActions } from "../ui/book-actions.ts";
import { Cover } from "../ui/book-bits.tsx";
import { BookRow } from "../ui/book-row.tsx";
import { BookSheet } from "../ui/book-sheet.tsx";
import { failureOf } from "../ui/failure.ts";
import { Icon } from "../ui/icons.tsx";
import { Money } from "../ui/money.tsx";
import { text } from "../ui/text.ts";
import { Title } from "../ui/title.tsx";
import { BookDetail } from "./book.tsx";
import { Places } from "./places.tsx";

type Mode = "shelf" | "wish";

const remembered: Record<Mode, string> = { shelf: "", wish: "" };

const sectionName = (where: Where) => {
  switch (where.kind) {
    case "place":
      return where.place.title;
    case "ebook":
      return text.books.ebooks;
    case "unplaced":
      return text.books.noPlace;
    case "lent":
      return text.books.lentOut;
    case "away":
      return text.books.notWith;
  }
};

const OPEN_ALL = 30;

function Head({ mode, shelf, wishes, onAdd }: { mode: Mode; shelf: number; wishes: number; onAdd: () => void }) {
  return (
    <>
      <Title>{text.books.title}</Title>
      <div role="group" aria-label={text.books.switch} className="seg">
        <a href="#/books" aria-current={mode === "shelf" ? "page" : undefined}>
          {text.books.shelf} <b>{shelf}</b>
        </a>
        <a href="#/wishlist" aria-current={mode === "wish" ? "page" : undefined}>
          {text.books.wishlist} <b>{wishes}</b>
        </a>
      </div>
      <div className="bk-tools">
        <button type="button" onClick={onAdd}>
          <Icon name="plus" />
          {mode === "shelf" ? text.books.add : text.books.addWish}
        </button>
        <a className="button secondary" href="#/places">
          <Icon name="place" />
          {text.books.places}
        </a>
      </div>
    </>
  );
}

function Find({ mode, onChange, value }: { mode: Mode; value: string; onChange: (value: string) => void }) {
  return (
    <form role="search" className="capture" onSubmit={(event) => event.preventDefault()}>
      <label className="visually-hidden" htmlFor={`find-${mode}`}>
        {mode === "shelf" ? text.books.search : text.books.searchWish}
      </label>
      <Icon name="search" />
      <input
        id={`find-${mode}`}
        type="search"
        value={value}
        maxLength={500}
        autoComplete="off"
        enterKeyHint="search"
        placeholder={mode === "shelf" ? text.books.searchPlaceholder : text.books.searchWish}
        onChange={(event) => onChange(event.target.value)}
      />
    </form>
  );
}

function Wish({ book }: { book: ItemRow }) {
  const { gotIt } = useBookActions();
  const { busy, once } = useBusy();
  const [failure, setFailure] = useState<string[]>([]);
  const by = typeof book.data?.author === "string" ? book.data.author : null;
  const shop = typeof book.data?.shop === "string" ? book.data.shop : null;
  return (
    <li className="bk wish">
      <a className="bk-link" href={`#/books/${book.id}`}>
        <Cover book={book} />
        <span className="bk-text">
          <span className="title">{book.title}</span>
          {by && <span className="bk-by">{by}</span>}
          <span className="meta">
            {book.who !== null && <Who side={book.who} />}
            {book.data?.gift === true && <span>{text.books.giftIdea}</span>}
            {book.amount !== null && <Money rupiah={book.amount} />}
          </span>
        </span>
      </a>
      {(book.note || shop) && (
        <p className="bk-note">
          {book.note && <span>{book.note}</span>}
          {shop && <span>{shop}</span>}
        </p>
      )}
      <div className="bk-where">
        <button
          type="button"
          className="got"
          disabled={busy}
          aria-label={text.books.gotItNamed(book.title)}
          onClick={(event) => {
            const row = event.currentTarget.closest("li");
            const next = (row?.nextElementSibling ?? row?.previousElementSibling)?.querySelector<HTMLElement>(".got") ?? document.querySelector<HTMLElement>("h1");
            return once(async () => {
              const result = await gotIt(book);
              setFailure(failureOf(result));
              if (result.ok) next?.focus({ preventScroll: true });
            });
          }}
        >
          <Icon name="check" />
          {text.books.gotIt}
        </button>
      </div>
      {failure.length > 0 && (
        <p className="error" role="alert">
          {failure.join(" ")}
        </p>
      )}
    </li>
  );
}

function Shelf() {
  const { items, places, copies } = useLibrary();
  const [query, setQuery] = useState(remembered.shelf);
  const [adding, setAdding] = useState(false);
  const sections = useMemo(() => shelfSections(items), [items]);
  const reading = useMemo(() => readingNow(items), [items]);
  const wishes = useMemo(() => items.filter((row) => row.kind === "book" && row.status === "wish").length, [items]);
  const shelf = useMemo(() => items.filter((row) => row.kind === "book" && row.status === "shelf").length, [items]);
  const found = useMemo(
    () => (query.trim() === "" || shelf + wishes === 0 ? null : searchBooks(query, items).sort((a, b) => Number(a.status !== "shelf") - Number(b.status !== "shelf") || bySort(a, b))),
    [query, items, shelf, wishes],
  );
  const change = (value: string) => {
    remembered.shelf = value;
    setQuery(value);
  };
  const list = (rows: readonly ItemRow[], where?: true) => (
    <ul className="rows">
      {rows.map((book) => (
        <BookRow key={book.id} book={book} copies={copies.get(book.id) ?? []} places={places} where={where} />
      ))}
    </ul>
  );

  return (
    <>
      <Head mode="shelf" shelf={shelf} wishes={wishes} onAdd={() => setAdding(true)} />
      {shelf + wishes > 0 && <Find mode="shelf" value={query} onChange={change} />}
      {found !== null ? (
        found.length === 0 ? (
          <p className="empty">{text.books.noMatch}</p>
        ) : (
          <section aria-label={text.books.search}>
            <p className="hint" role="status">
              {text.books.found(found.length)}
            </p>
            {list(found, true)}
          </section>
        )
      ) : shelf === 0 ? (
        <p className="empty">{text.books.emptyShelf}</p>
      ) : (
        <>
          {reading.length > 0 && (
            <section aria-labelledby="bk-reading">
              <h2 id="bk-reading">{text.books.readingNow}</h2>
              {list(reading, true)}
            </section>
          )}
          {sections.map((section, index) => (
            <details key={section.where.kind === "place" ? section.where.place.id : section.where.kind} className="shelf-sec" open={index === 0 || shelf <= OPEN_ALL}>
              <summary>
                <span className="shelf-name">{sectionName(section.where)}</span>
                <span className="tally">{section.books.length}</span>
              </summary>
              {list(section.books)}
            </details>
          ))}
        </>
      )}
      {adding && <BookSheet kind="shelf" onClose={() => setAdding(false)} />}
    </>
  );
}

function Wishlist() {
  const { items, places, copies } = useLibrary();
  const [query, setQuery] = useState(remembered.wish);
  const [adding, setAdding] = useState(false);
  const { next, someday } = useMemo(() => wishSections(items), [items]);
  const shelf = useMemo(() => items.filter((row) => row.kind === "book" && row.status === "shelf").length, [items]);
  const found = useMemo(
    () => (query.trim() === "" || next.length + someday.length === 0 ? null : searchBooks(query, items).filter((row) => row.status === "wish").sort(bySort)),
    [query, items, next, someday],
  );
  const change = (value: string) => {
    remembered.wish = value;
    setQuery(value);
  };
  const total = next.length + someday.length;
  const list = (rows: readonly ItemRow[]) => (
    <ul className="rows">
      {rows.map((book) => (
        <Wish key={book.id} book={book} />
      ))}
    </ul>
  );

  return (
    <>
      <Head mode="wish" shelf={shelf} wishes={total} onAdd={() => setAdding(true)} />
      {total > 0 && <Find mode="wish" value={query} onChange={change} />}
      {found !== null ? (
        found.length === 0 ? (
          <p className="empty">{text.books.noMatch}</p>
        ) : (
          <section aria-label={text.books.searchWish}>
            <p className="hint" role="status">
              {text.books.found(found.length)}
            </p>
            {list(found)}
          </section>
        )
      ) : total === 0 ? (
        <p className="empty">{text.books.emptyWish}</p>
      ) : (
        <>
          {next.length > 0 && (
            <section aria-labelledby="bk-next">
              <h2 id="bk-next">
                {text.books.nextUp} <span className="tally">{next.length}</span>
              </h2>
              {list(next)}
            </section>
          )}
          {someday.length > 0 && (
            <section aria-labelledby="bk-someday">
              <h2 id="bk-someday">
                {text.books.someday} <span className="tally">{someday.length}</span>
              </h2>
              {list(someday)}
            </section>
          )}
        </>
      )}
      {adding && <BookSheet kind="wish" onClose={() => setAdding(false)} />}
    </>
  );
}

export function Books({ route, id }: { route: string; id?: string }) {
  if (route === "places") return <Places />;
  if (id !== undefined) return <BookDetail key={id} id={id} />;
  return route === "wishlist" ? <Wishlist /> : <Shelf />;
}
