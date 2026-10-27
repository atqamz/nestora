import { useState } from "react";
import { isCover } from "../../shared/validate.ts";
import { coverOf } from "../domain/cover.ts";
import { Icon } from "./icons.tsx";
import { text } from "./text.ts";

export function Cover({ book, alt }: { book: { title: string; who?: string | null; data?: Record<string, unknown> | null }; alt?: string }) {
  const { initials, tone } = coverOf(book);
  const [failed, setFailed] = useState<string | null>(null);
  const url = book.data?.cover;
  const src = isCover(url) && url !== failed ? url : null;
  return (
    <span className="cover" data-tone={tone ?? undefined} aria-hidden={alt === undefined || src === null ? "true" : undefined}>
      {initials}
      {src !== null && <img src={src} alt={alt ?? ""} width="200" height="300" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(src)} />}
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
