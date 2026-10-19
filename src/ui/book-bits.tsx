import { coverOf } from "../domain/cover.ts";
import { Icon } from "./icons.tsx";
import { text } from "./text.ts";

export function Cover({ book }: { book: { id: string; title: string } }) {
  const { initials, tone } = coverOf(book);
  return (
    <span className="cover" data-tone={tone} aria-hidden="true">
      {initials}
    </span>
  );
}

export function Stars({ value }: { value: number }) {
  return (
    <span className="stars" role="img" aria-label={text.books.stars(value)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} data-on={n <= value || undefined}>
          <Icon name="star" />
        </span>
      ))}
    </span>
  );
}
