export const coverOf = (book: { id: string; title: string }): { initials: string; tone: "a" | "b" } => {
  const words = book.title.match(/[\p{L}\p{N}]+/gu) ?? [];
  const letters = words.length > 1 ? words.slice(0, 2).map((word) => Array.from(word)[0]) : Array.from(words[0] ?? "?").slice(0, 2);
  const hash = [...book.id].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7);
  return { initials: letters.join("").toUpperCase(), tone: hash % 2 === 0 ? "a" : "b" };
};
