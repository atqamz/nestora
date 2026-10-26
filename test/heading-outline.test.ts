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
  movies: ["views/screens.tsx", "views/screen.tsx", "ui/collection-section.tsx", "ui/screen-lookup.tsx", "ui/tmdb-credit.tsx"],
  series: ["views/screens.tsx", "views/screen.tsx", "ui/collection-section.tsx", "ui/screen-row.tsx", "ui/screen-sheet.tsx", "ui/screen-lookup.tsx", "ui/tmdb-credit.tsx"],
  settings: ["views/settings.tsx", "ui/feed-section.tsx", "ui/tmdb-credit.tsx"],
};

for (const [screen, files] of Object.entries(screens)) {
  test(`${screen} skips no heading level`, () => {
    const found = [...levels([title, ...files])].sort();
    assert.deepEqual(found, found.map((_, index) => index + 1));
  });
}

test("the Credits section in Settings is an h2 and holds the TMDB credit, so the logo never sits under another section's heading", () => {
  const settings = readFileSync(new URL("../src/views/settings.tsx", import.meta.url), "utf8");
  assert.match(settings, /<h2>\{text\.tmdb\.credits\}<\/h2>\s*<TmdbCredit \/>/);
});
