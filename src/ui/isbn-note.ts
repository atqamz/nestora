import { isbnCheck } from "../domain/isbn.ts";
import { text } from "./text.ts";

const WORDS = text.books.sheet;

export const isbnNote = (input: string): string => {
  const { state, digits, isbn } = isbnCheck(input);
  return isbn !== null
    ? WORDS.isbnOk(isbn)
    : state === "typing"
      ? digits === 10
        ? WORDS.isbnTen
        : WORDS.isbnTyping(digits)
      : state === "sum"
        ? WORDS.isbnSum
        : state === "shape"
          ? WORDS.isbnShape
          : WORDS.isbnHint;
};
