import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const levels = (files: string[]) =>
  new Set(files.flatMap((file) => [...readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8").matchAll(/<h([1-6])[\s>]/g)].map((match) => Number(match[1]))));

const title = "ui/title.tsx";

const screens: Record<string, string[]> = {
  home: ["views/home.tsx", "views/today.tsx", "views/them.tsx", "views/week.tsx"],
  marriage: ["views/journey.tsx", "views/week.tsx"],
  money: ["views/money.tsx", "views/money-line.tsx"],
  people: ["views/people.tsx", "views/person.tsx"],
  routines: ["views/routines.tsx", "views/routine.tsx", "ui/timetable.tsx"],
  books: ["views/books.tsx", "views/book.tsx"],
  movies: ["views/screens.tsx", "views/screen.tsx"],
  series: ["views/screens.tsx", "views/screen.tsx", "ui/screen-row.tsx", "ui/screen-sheet.tsx"],
  settings: ["views/settings.tsx", "ui/feed-section.tsx"],
};

for (const [screen, files] of Object.entries(screens)) {
  test(`${screen} skips no heading level`, () => {
    const found = [...levels([title, ...files])].sort();
    assert.deepEqual(found, found.map((_, index) => index + 1));
  });
}
