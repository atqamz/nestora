import { isIsbn13 } from "../../shared/validate.ts";

const isIsbn10 = (v: string) =>
  /^\d{9}[\dX]$/.test(v) && [...v].reduce((sum, c, i) => sum + (c === "X" ? 10 : Number(c)) * (10 - i), 0) % 11 === 0;

const SEPARATORS = String.raw`[\s:.\p{Pd}]`;

const LABEL = new RegExp(String.raw`^\s*isbn(?:\p{Pd}?(?:10|13)(?=${SEPARATORS}))?(?=${SEPARATORS}*\d)${SEPARATORS}*`, "iu");

export const withoutLabel = (input: string) => input.replace(LABEL, "");

export const toIsbn13 = (input: string): string | null => {
  const text = withoutLabel(input).replace(/[\s\p{Pd}]/gu, "").toUpperCase();
  if (isIsbn13(text)) return text;
  if (!isIsbn10(text)) return null;
  const body = `978${text.slice(0, 9)}`;
  return `${body}${[...Array(10).keys()].find((digit) => isIsbn13(`${body}${digit}`))}`;
};
