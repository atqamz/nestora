import { useMemo } from "react";
import { readingNow } from "../domain/reading.ts";
import { wishSections } from "../domain/wish.ts";
import { useLibrary } from "../hooks/use-books.ts";
import { BookRow } from "../ui/book-row.tsx";
import { Capture } from "../ui/capture.tsx";
import { text } from "../ui/text.ts";
import { Title } from "../ui/title.tsx";
import { Them } from "./them.tsx";
import { Today } from "./today.tsx";
import { Week } from "./week.tsx";

function NextUp() {
  const { items, places, copies } = useLibrary();
  const rows = useMemo(() => [...readingNow(items), ...wishSections(items).next].slice(0, 3), [items]);
  if (rows.length === 0) return null;
  return (
    <section className="group" aria-labelledby="home-next">
      <h3 id="home-next">{text.books.nextUp}</h3>
      <ul className="rows">
        {rows.map((book) => (
          <BookRow key={book.id} book={book} copies={copies.get(book.id) ?? []} places={places} />
        ))}
      </ul>
      <p className="trail">
        <a href="#/books">{text.home.allBooks}</a>
      </p>
    </section>
  );
}

export function Home() {
  return (
    <>
      <Title>{text.nav.home}</Title>
      <Capture />
      <Today />
      <Them />
      <Week />
      <NextUp />
    </>
  );
}
