export const coverOf = (book: { title: string; who?: string | null }): { initials: string; tone: "a" | "b" | null } => {
  const words = book.title.match(/[\p{L}\p{N}]+/gu) ?? [];
  const letters = words.length > 1 ? words.slice(0, 2).map((word) => Array.from(word)[0]) : Array.from(words[0] ?? "?").slice(0, 2);
  return { initials: letters.join("").toUpperCase(), tone: book.who === "a" || book.who === "b" ? book.who : null };
};
