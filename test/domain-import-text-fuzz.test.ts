import { test } from "node:test";
import assert from "node:assert/strict";
import { parseList } from "../src/domain/import-text.ts";

type Entry = { title: string; number: number; author?: string; synopsis?: string; bare: boolean };

const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const withoutDangling = ({ synopsis = "", number }: Entry) => synopsis.replace(new RegExp(`\\s*${number + 1}\\.$`), "");

const generate = (next: () => number) => {
  const pick = <T>(options: T[]) => options[Math.floor(next() * options.length)];
  const labelled = next() < 0.6;
  const entries: Entry[] = [];
  let text = "";
  for (let list = 0; list < (next() < 0.25 ? 2 : 1); list++) {
    const size = 1 + Math.floor(next() * 6);
    const lead = list > 0 && !entries.at(-1)?.bare && next() < 0.4 ? 1 : 0;
    const labels = Array.from({ length: size }, (_, at) => labelled && ((at === 0 && list > 0) || next() < 0.75));
    for (let at = 0; at < size; at++) {
      const number = at + 1 + lead;
      const entry: Entry = { title: `Placeholder T${entries.length}`, number, bare: false };
      let part = `${number}. ${entry.title}`;
      if (labels[at]) {
        entry.author = `Writer W${entries.length}`;
        part += `${pick([" ", "\n"])}Penulis: ${entry.author}`;
        if (next() < 0.3) part += `${pick([" ", "\n"])}Rating Goodreads: ~4.1 / 5`;
        if (next() < 0.7) {
          entry.bare = next() < 0.5;
          const numbers = [1, 9, number, number + 1, number + 2];
          const end = entry.bare ? pick([`Part of a series, book ${pick(numbers)}.`, `Seri ke-${pick(numbers)}.`, `Jilid ${pick(numbers)}.`, `${pick(numbers)}.`]) : pick(["Done.", "Year 1099."]);
          entry.synopsis = [pick(["A tale of ten friends.", "Set in the year 1099.", "Bab 9. Then more.", ""]), end].filter(Boolean).join(" ");
          part += `${pick([" ", "  ", "\n"])}Sinopsis: ${entry.synopsis}`;
        }
      }
      const previous = entries.at(-1);
      if (at > 0) {
        const alone = labelled && !labels[at] && (at === size - 1 || !labels[at + 1]);
        const glue = previous?.synopsis !== undefined && !previous.bare && labels[at];
        text += alone ? "\n" : pick(glue ? ["\n", " ", "   ", ""] : ["\n", " ", "   "]);
      } else if (list > 0) text += pick(["\n", "\n\n"]) + (lead ? "1.\n" : "");
      text += part;
      entries.push(entry);
    }
  }
  return { text, entries };
};

test("random lists of labelled and title-only entries, bare numbers in synopses, years, restarted numbering and an empty restart line lose no entry and no text", () => {
  const next = random(20260101);
  let total = 0;
  for (let round = 0; round < 3000; round++) {
    const { text, entries } = generate(next);
    const found = parseList(text);
    total += entries.length;
    assert.deepEqual(
      found.map((entry) => [entry.title, entry.author, entry.blurb]),
      entries.map((entry, at) => [entry.title, entry.author ?? "", at === entries.length - 1 ? withoutDangling(entry) : (entry.synopsis ?? "")]),
      JSON.stringify(text),
    );
  }
  assert.ok(total > 10_000);
});
