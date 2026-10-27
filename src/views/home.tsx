import { useMemo } from "react";
import { readingNow } from "../domain/reading.ts";
import { wishSections } from "../domain/wish.ts";
import { useLibrary } from "../hooks/use-books.ts";
import { useRoutineDay } from "../hooks/use-routines.ts";
import { BookRow } from "../ui/book-row.tsx";
import { formatDay } from "../ui/format.ts";
import { text } from "../ui/text.ts";
import { Title } from "../ui/title.tsx";
import { Them } from "./them.tsx";
import { Today } from "./today.tsx";
import { LateLine, Week } from "./week.tsx";

function NextUp() {
  const { items, places, copies } = useLibrary();
  const rows = useMemo(() => [...readingNow(items), ...wishSections(items).next].slice(0, 3), [items]);
  if (rows.length === 0) return null;
  return (
    <section className="group" aria-labelledby="home-next">
      <h2 id="home-next">{text.books.nextUp}</h2>
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
  const day = useRoutineDay();
  return (
    <>
      <Title name={text.nav.home}>{text.routines.today(formatDay(day, day))}</Title>
      <LateLine />
      <Today />
      <Them />
      <h2 className="visually-hidden">{text.week.heading}</h2>
      <Week />
      <NextUp />
    </>
  );
}
