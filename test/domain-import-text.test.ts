import { test } from "node:test";
import assert from "node:assert/strict";
import { fit, parseList, splitTitle, tidy } from "../src/domain/import-text.ts";
import type { Candidate } from "../src/domain/import-text.ts";
import { LONGTEXT_MAX, TEXT_MAX } from "../shared/validate.ts";

type Entry = { title: string; author?: string; rating?: string; source?: string; synopsis?: string };

const ENTRIES: Entry[] = [
  { title: "Laskar Pelangi", author: "Andrea Hirata", rating: "~4.2 / 5", source: "Goodreads", synopsis: "A story of ten children in a poor village school." },
  { title: "Bumi Manusia", author: "Pramoedya Ananta Toer", rating: "~4.4 / 5", source: "Goodreads", synopsis: "A young man grows up under colonial rule." },
  {
    title: "Judul Satu (The Three Parts)",
    author: "Author Placeholder",
    rating: "~4.1 / 5",
    source: "Goodreads",
    synopsis: "The city fell in the year 1099. Warga desa left. Bab 2. Dunia berubah, and 1. is not an entry.",
  },
  { title: "Seri 2: Judul, Dengan Koma (2024)", author: "Writer Placeholder", rating: "~3.9 / 5", source: "Goodreads", synopsis: "Nothing here." },
  {
    title: "The Little Prince",
    author: "Antoine de Saint-Exupéry",
    rating: "~4.3 / 5",
    source: "Goodreads",
    synopsis: "A pilot — stranded in the desert — meets “a small prince”. Café déjà vu.",
  },
];

const EXPECTED: Candidate[] = [
  { title: "Laskar Pelangi", original_title: "", author: "Andrea Hirata", rated_elsewhere: "~4.2 / 5 (Goodreads)", blurb: ENTRIES[0].synopsis!, warnings: [] },
  { title: "Bumi Manusia", original_title: "", author: "Pramoedya Ananta Toer", rated_elsewhere: "~4.4 / 5 (Goodreads)", blurb: ENTRIES[1].synopsis!, warnings: [] },
  { title: "Judul Satu", original_title: "The Three Parts", author: "Author Placeholder", rated_elsewhere: "~4.1 / 5 (Goodreads)", blurb: ENTRIES[2].synopsis!, warnings: ["joined"] },
  { title: "Seri 2: Judul, Dengan Koma (2024)", original_title: "", author: "Writer Placeholder", rated_elsewhere: "~3.9 / 5 (Goodreads)", blurb: "Nothing here.", warnings: [] },
  { title: "The Little Prince", original_title: "", author: "Antoine de Saint-Exupéry", rated_elsewhere: "~4.3 / 5 (Goodreads)", blurb: ENTRIES[4].synopsis!, warnings: [] },
];

const fields = (entry: Entry, number: number, glue: string, gap: string) => {
  const parts = [
    `${number}. ${entry.title}`,
    entry.author === undefined ? null : `Penulis: ${entry.author}`,
    entry.rating === undefined ? null : `Rating ${entry.source}: ${entry.rating}`,
    entry.synopsis === undefined ? null : `Sinopsis: ${entry.synopsis}`,
  ].filter((part) => part !== null);
  return parts.map((part, at) => (at === 0 ? part : (part.startsWith("Sinopsis") && parts[at - 1].startsWith("Rating") ? glue : gap) + part)).join("");
};

const expanded = (entries: Entry[], first = 1) => entries.map((entry, at) => fields(entry, first + at, "\n", "\n")).join("\n");

const collapsed = (entries: Entry[], first = 1) => entries.map((entry, at) => fields(entry, first + at, " ", "   ")).join(" ");

const glued = (entries: Entry[], first = 1) => entries.map((entry, at) => fields(entry, first + at, "", "   ")).join("");

const shapes: [string, (entries: Entry[], first?: number) => string][] = [
  ["newline separated", expanded],
  ["one line with spaces", collapsed],
  ["one line with the next number glued to the full stop", glued],
];

for (const [name, render] of shapes) {
  test(`${name}: every field of every entry is read and the numbers inside synopses start nothing`, () => {
    assert.deepEqual(parseList(render(ENTRIES)), EXPECTED);
  });
}

test("collapsing and expanding the same entries gives identical candidates, with Windows newlines and non-breaking spaces too", () => {
  const reference = parseList(expanded(ENTRIES));
  assert.deepEqual(parseList(collapsed(ENTRIES)), reference);
  assert.deepEqual(parseList(glued(ENTRIES)), reference);
  assert.deepEqual(parseList(expanded(ENTRIES).replace(/\n/g, "\r\n")), reference);
  assert.deepEqual(parseList(collapsed(ENTRIES).replace(/ /g, "\u00a0")), reference);
  assert.deepEqual(parseList(glued(ENTRIES).replace(/ {3}/g, "\u00a0 \t")), reference);
  assert.deepEqual(parseList(expanded(ENTRIES).replace(/\n/g, "\r")), reference);
});

test("lists pasted one after another restart at 1, stay separate, and a repeated title is kept for the preview to flag", () => {
  const second = [ENTRIES[1], { title: "Another Placeholder", author: "Someone", rating: "~4.0 / 5", source: "Goodreads", synopsis: "Short." }];
  for (const [, render] of shapes) {
    const found = parseList(render(ENTRIES.slice(0, 2)) + (render === glued ? "" : render === collapsed ? " " : "\n") + render(second));
    assert.deepEqual(found.map((entry) => entry.title), ["Laskar Pelangi", "Bumi Manusia", "Bumi Manusia", "Another Placeholder"]);
  }
});

test("a list can start at any number when it starts a line, and the preamble before the first entry is ignored", () => {
  assert.deepEqual(parseList("5. Laskar Pelangi  Penulis: Andrea Hirata\n6. Bumi Manusia  Penulis: Pramoedya Ananta Toer").map((entry) => entry.title), ["Laskar Pelangi", "Bumi Manusia"]);
  assert.deepEqual(parseList("My wishlist\nMore words 3.\n1. Laskar Pelangi  Penulis: Andrea Hirata").map((entry) => entry.title), ["Laskar Pelangi"]);
});

test("a first entry can follow a heading on its own line at any number, and a first entry numbered 1 can follow words on the same line", () => {
  assert.deepEqual(parseList("Heading\n5. Laskar Pelangi  Penulis: Andrea Hirata").map((entry) => entry.title), ["Laskar Pelangi"]);
  assert.deepEqual(parseList("My list: 1. Laskar Pelangi  Penulis: Andrea Hirata").map((entry) => entry.title), ["Laskar Pelangi"]);
});

test("a gap in the numbering of a labelled list loses nothing, but a lone year or page number in a synopsis starts nothing", () => {
  const found = parseList("1. A  Penulis: X  Sinopsis: See page 12. Words. 5. B  Penulis: Y  Sinopsis: Done.");
  assert.deepEqual(found.map((entry) => [entry.title, entry.blurb]), [["A", "See page 12. Words."], ["B", "Done."]]);
  assert.deepEqual(parseList("1. A\n2. B\n12. C").map((entry) => entry.title), ["A", "B 12. C"]);
});

test("without labels a first number counts at the start of a line or as 1, and nowhere else", () => {
  assert.deepEqual(parseList("Heading\n5. A\n6. B").map((entry) => entry.title), ["A", "B"]);
  assert.deepEqual(parseList("5. A\n6. B").map((entry) => entry.title), ["A", "B"]);
  assert.deepEqual(parseList("words 1. A\n2. B").map((entry) => entry.title), ["A", "B"]);
  assert.deepEqual(parseList("Heading\nsee 7. not an entry\n8. also an entry").map((entry) => entry.title), ["also an entry"]);
  assert.deepEqual(parseList("Heading text 3. A  Penulis: X").map((entry) => entry.title), ["A"]);
});

test("English labels work and the source word is optional", () => {
  const [entry] = parseList("1. The Little Prince  Author: Antoine de Saint-Exupéry  Rating: 4.3 / 5  Synopsis: A pilot meets a prince.");
  assert.deepEqual(entry, {
    title: "The Little Prince",
    original_title: "",
    author: "Antoine de Saint-Exupéry",
    rated_elsewhere: "4.3 / 5",
    blurb: "A pilot meets a prince.",
    warnings: [],
  });
});

test("labels are case-insensitive, may come in any order, and only the first of each counts", () => {
  const [entry] = parseList("1. Title  SINOPSIS: First part. penulis: Writer One  rating goodreads: 4 / 5  Penulis: Writer Two");
  assert.deepEqual([entry.author, entry.rated_elsewhere, entry.blurb], ["Writer One", "4 / 5 (goodreads)", "First part."]);
  assert.equal(entry.warnings.length, 0);
});

test("missing fields leave empty strings and the missing author is flagged, also when the entry is glued to the next", () => {
  const found = parseList("1. Only A Title 2. Has Author  Penulis: Someone 3. Has Rating  Rating Goodreads: ~4.0 / 5 4. Has Synopsis  Sinopsis: Words.");
  assert.deepEqual(
    found.map((entry) => [entry.title, entry.author, entry.rated_elsewhere, entry.blurb, entry.warnings]),
    [
      ["Only A Title", "", "", "", ["missing_author"]],
      ["Has Author", "Someone", "", "", []],
      ["Has Rating", "", "~4.0 / 5 (Goodreads)", "", ["missing_author"]],
      ["Has Synopsis", "", "", "Words.", ["missing_author"]],
    ],
  );
});

test("a title-only entry between labelled ones is kept, and one at the very end joins the synopsis before it with a warning", () => {
  const middle = parseList("1. A  Penulis: X  Sinopsis: One. 2. Only Title 3. C  Penulis: Z  Sinopsis: Three.");
  assert.deepEqual(middle.map((entry) => [entry.title, entry.warnings]), [["A", []], ["Only Title", ["missing_author"]], ["C", []]]);
  const end = parseList("1. A  Penulis: X  Sinopsis: One. 2. Only Title");
  assert.deepEqual(end.map((entry) => [entry.title, entry.blurb, entry.warnings]), [["A", "One. 2. Only Title", ["joined"]]]);
});

test("a rating that holds no number is dropped, and one with extra words keeps just the number as typed", () => {
  const found = parseList("1. A  Penulis: X  Rating Goodreads: none yet  Sinopsis: s. 2. B  Penulis: Y  Rating Goodreads: ~4.25/5 stars  Sinopsis: t.");
  assert.deepEqual(found.map((entry) => entry.rated_elsewhere), ["", "~4.25/5 (Goodreads)"]);
});

test("a decimal in a rating is not an entry number, even when it equals the next number", () => {
  const found = parseList("1. A  Penulis: X  Rating Goodreads: ~2.5 / 5Sinopsis: s.2. B  Penulis: Y  Rating Goodreads: ~3.5 / 5Sinopsis: t.3. C  Penulis: Z  Rating Goodreads: ~4.0 / 5");
  assert.deepEqual(found.map((entry) => entry.title), ["A", "B", "C"]);
  assert.deepEqual(found.map((entry) => entry.rated_elsewhere), ["~2.5 / 5 (Goodreads)", "~3.5 / 5 (Goodreads)", "~4.0 / 5 (Goodreads)"]);
});

test("a number that looks like the next entry inside a synopsis stays in the synopsis and warns", () => {
  const found = parseList("1. A  Penulis: X  Sinopsis: It began. 2. Then it ended. 2. B  Penulis: Y  Sinopsis: Done.");
  assert.deepEqual(
    found.map((entry) => [entry.title, entry.blurb, entry.warnings]),
    [
      ["A", "It began. 2. Then it ended.", ["joined"]],
      ["B", "Done.", []],
    ],
  );
});

test("a list without numbers reads one entry per line, with or without labels", () => {
  assert.deepEqual(parseList("Laskar Pelangi  Penulis: Andrea Hirata\nBumi Manusia").map((entry) => entry.warnings), [[], ["missing_author"]]);
  assert.deepEqual(
    parseList("Laskar Pelangi  Penulis: Andrea Hirata\nBumi Manusia\n\n\nThe Little Prince").map((entry) => [entry.title, entry.author]),
    [
      ["Laskar Pelangi", "Andrea Hirata"],
      ["Bumi Manusia", ""],
      ["The Little Prince", ""],
    ],
  );
});

test("a numbered list without any label keeps each title and does not split on years", () => {
  const found = parseList("1. Laskar Pelangi\n2. Bumi Manusia\n2005. Not an entry\n3. The Little Prince");
  assert.deepEqual(found.map((entry) => entry.title), ["Laskar Pelangi", "Bumi Manusia 2005. Not an entry", "The Little Prince"]);
});

test("empty input, whitespace and bare numbers give no candidates", () => {
  for (const input of ["", "   \n\u00a0\n", "1.", "1. 2. 3.", "\ufeff", "1.  Penulis: Nobody"]) assert.deepEqual(parseList(input), [], JSON.stringify(input));
});

test("trailing whitespace, zero-width characters and a dangling number are ignored", () => {
  const reference = parseList(collapsed(ENTRIES));
  for (const tail of ["\n\n   ", "\u00a0\u200b\ufeff", "\n6.", " 6. ", "\r\n\r\n"]) assert.deepEqual(parseList(collapsed(ENTRIES) + tail), reference, JSON.stringify(tail));
});

test("text after the last entry that cannot be told apart from its synopsis stays in the synopsis", () => {
  const [entry] = parseList("1. A  Penulis: X  Sinopsis: Words. -- end of list --");
  assert.equal(entry.blurb, "Words. -- end of list --");
});

test("control and format characters are removed, but a joiner and non-ASCII letters stay", () => {
  const [entry] = parseList("1. Café\u200b ❤\u200d\ufe0f\u0007  Penulis: Émile\u00a0Zöe  Sinopsis: “Quoted” — and – dashes.");
  assert.deepEqual([entry.title, entry.author, entry.blurb], ["Café ❤\u200d\ufe0f", "Émile Zöe", "“Quoted” — and – dashes."]);
});

test("fields over the registry caps are cut at a word, end with an ellipsis, and warn", () => {
  const long = (word: string, size: number) => Array.from({ length: Math.ceil(size / (word.length + 1)) + 5 }, () => word).join(" ");
  const [entry] = parseList(`1. ${long("title", TEXT_MAX)}  Penulis: ${long("name", TEXT_MAX)}  Sinopsis: ${long("words", LONGTEXT_MAX)}`);
  assert.ok(entry.title.length <= TEXT_MAX && entry.title.endsWith("…"));
  assert.ok(entry.author.length <= TEXT_MAX && entry.author.endsWith("…"));
  assert.ok(entry.blurb.length <= LONGTEXT_MAX && entry.blurb.endsWith("…"));
  assert.match(entry.blurb, /words…$/);
  assert.ok(entry.blurb.length > LONGTEXT_MAX - 12);
  assert.deepEqual(entry.warnings, ["cut"]);
});

test("text of exactly the cap is kept whole", () => {
  const warnings: never[] = [];
  assert.equal(fit("abc def", 7, warnings), "abc def");
  assert.equal(fit("abc defg", 7, warnings), "abc de…");
  assert.equal(fit("abcd efgh", 8, warnings), "abcd…");
});

test("a cut never splits a surrogate pair", () => {
  const warnings: never[] = [];
  const out = fit("a".repeat(8) + "\u{1f4da}".repeat(10), 10, warnings);
  assert.doesNotMatch(out, /[\ud800-\udbff](?![\udc00-\udfff])/);
  assert.ok(out.length <= 10);
  const early = fit("a".repeat(8) + "\u{1f4da}" + "b".repeat(5), 10, warnings);
  assert.equal(early, "a".repeat(8) + "…");
});

test("original titles come from a trailing parenthesis that reads like a title, and not from years, volumes or editions", () => {
  const split = (heading: string) => Object.values(splitTitle(heading));
  assert.deepEqual(split("Judul Dua (The Two Parts)"), ["Judul Dua", "The Two Parts"]);
  assert.deepEqual(split("Pangeran Kecil (Le Petit Prince)"), ["Pangeran Kecil", "Le Petit Prince"]);
  assert.deepEqual(split("A (B) (Original Name)"), ["A (B)", "Original Name"]);
  assert.deepEqual(split("Judul (Ab)"), ["Judul", "Ab"]);
  assert.deepEqual(split("A(Bc)"), ["A", "Bc"]);
  for (const heading of ["Laskar Pelangi (2005)", "Judul (Vol. 2)", "Judul (Book 3)", "Judul (Edisi Revisi)", "(Novel)", "Judul (A", "Judul (Original) tail", "Judul (X)", "Judul ()", "Judul"]) {
    assert.deepEqual(split(heading), [heading, ""], heading);
  }
  assert.deepEqual(split("Judul (Book Of Keys)"), ["Judul", "Book Of Keys"]);
});

test("tidy turns every newline style into one and drops the byte order mark", () => {
  assert.equal(tidy("\ufeffa\r\nb\rc\u2028d\u00a0\u00a0e"), "a\nb\nc\nd e");
});

test("500 entries of 400 characters, 200 KB in one line, are read in well under a second", () => {
  const entries = Array.from({ length: 500 }, (_, at) => ({
    title: `Placeholder ${at} (Original ${at})`,
    author: `Writer ${at}`,
    rating: "~4.0 / 5",
    source: "Goodreads",
    synopsis: `${"Words in a sentence 1. and in 2024. again ".repeat(10)}End.`,
  }));
  const text = glued(entries);
  assert.ok(text.length > 200_000);
  const start = performance.now();
  const found = parseList(text);
  const took = performance.now() - start;
  assert.equal(found.length, 500);
  assert.ok(took < 1000, `${took} ms`);
});

test("hostile input does not make the parser slow", () => {
  const start = performance.now();
  parseList("1. " + "(".repeat(50_000) + ")".repeat(50_000));
  parseList(":".repeat(100_000));
  parseList("Rating ".repeat(30_000));
  parseList("1. ".repeat(60_000));
  parseList("Penulis:".repeat(30_000));
  assert.ok(performance.now() - start < 2000);
});

test("a title-only entry on its own line at the end of a list is an entry, not the tail of the one before", () => {
  const blurb = parseList("1. Laskar Pelangi  Penulis: Andrea Hirata  Sinopsis: Y\n2. Bumi Manusia");
  assert.deepEqual(blurb.map((entry) => [entry.title, entry.author, entry.blurb, entry.warnings]), [
    ["Laskar Pelangi", "Andrea Hirata", "Y", []],
    ["Bumi Manusia", "", "", ["missing_author"]],
  ]);
  const author = parseList("1. Laskar Pelangi  Penulis: Andrea Hirata\n2. Bumi Manusia  Penulis: Pramoedya\n3. The Little Prince");
  assert.deepEqual(author.map((entry) => [entry.title, entry.author]), [["Laskar Pelangi", "Andrea Hirata"], ["Bumi Manusia", "Pramoedya"], ["The Little Prince", ""]]);
  const several = parseList("1. A  Penulis: X\n2. Placeholder B\n3. Placeholder C\n4. Placeholder D");
  assert.deepEqual(several.map((entry) => [entry.title, entry.author]), [["A", "X"], ["Placeholder B", ""], ["Placeholder C", ""], ["Placeholder D", ""]]);
  const crlf = parseList("1. A  Penulis: X\r\n2. Placeholder B\r\n");
  assert.deepEqual(crlf.map((entry) => entry.title), ["A", "Placeholder B"]);
});

test("a number that does not continue the sequence, or has nothing after it, still starts no entry at the end of a list", () => {
  assert.deepEqual(parseList("1. A  Penulis: X  Sinopsis: One.\n5. Not next").map((entry) => [entry.title, entry.blurb]), [["A", "One. 5. Not next"]]);
  assert.deepEqual(parseList("1. A  Penulis: X  Sinopsis: One.\n2.").map((entry) => [entry.title, entry.blurb]), [["A", "One."]]);
  assert.deepEqual(parseList("1. A  Penulis: X  Sinopsis: One. 2. Same line").map((entry) => entry.title), ["A"]);
});

test("a field of only invisible characters is empty and warns on its row, and the other rows are untouched", () => {
  const found = parseList("1. Placeholder One  Penulis: Writer One\n2. Placeholder Blank  Penulis: \u2800\n3. Placeholder Three  Penulis: Writer Three  Sinopsis: \u3164 \u200b \ufe0f");
  assert.deepEqual(found.map((entry) => [entry.title, entry.author, entry.blurb, entry.warnings]), [
    ["Placeholder One", "Writer One", "", []],
    ["Placeholder Blank", "", "", ["hidden", "missing_author"]],
    ["Placeholder Three", "Writer Three", "", ["hidden"]],
  ]);
  for (const invisible of ["\u2800", "\u3164", "\ufe0f", "\ue000", "\u034f", "\u115f", "\u2800\u2800 \u3164"]) {
    const [entry] = parseList(`1. Placeholder  Penulis: ${invisible}  Sinopsis: ${invisible}`);
    assert.deepEqual([entry.author, entry.blurb, entry.warnings], ["", "", ["hidden", "missing_author"]], JSON.stringify(invisible));
  }
  for (const stripped of ["\u200b", "\u2060", "\u00ad"]) assert.deepEqual(parseList(`1. Placeholder  Penulis: ${stripped}`).map((entry) => [entry.author, entry.warnings]), [["", ["missing_author"]]]);
  assert.deepEqual(parseList("1. \u2800  Penulis: X\n2. Placeholder Two  Penulis: Y").map((entry) => entry.title), ["Placeholder Two"]);
  assert.deepEqual(parseList("\u2800\u3164\u200b"), []);
  assert.deepEqual(parseList("1. Placeholder  Rating: \u2800").map((entry) => [entry.rated_elsewhere, entry.warnings]), [["", ["missing_author", "hidden"]]]);
});

test("a visible value keeps the hidden marks inside it, and a bare space does not warn", () => {
  const [entry] = parseList("1. Placeholder  Penulis: Writer\u2800One  Sinopsis: ");
  assert.deepEqual([entry.author, entry.blurb, entry.warnings], ["Writer\u2800One", "", []]);
  assert.equal(tidy("\u2800"), "");
  assert.equal(tidy("a\u2800"), "a\u2800");
  assert.equal(tidy("\u{2764}\ufe0f"), "\u{2764}\ufe0f");
  assert.deepEqual(parseList("1. Placeholder  Penulis:  ").map((entry) => entry.warnings), [["missing_author"]]);
});

test("a label right after a number starts a title-less entry that is dropped, and the entry before keeps its own fields", () => {
  const found = parseList("1. A  Penulis: X\n2.Penulis: Y");
  assert.deepEqual(found.map((entry) => [entry.title, entry.author, entry.warnings]), [["A", "X", []]]);
});

test("an unlabelled list restarting at 1 is two lists, and a bare number between entries ends the one before it quietly", () => {
  assert.deepEqual(parseList("1. A\n2. B\n1. C\n2. D").map((entry) => entry.title), ["A", "B", "C", "D"]);
  const found = parseList("1. A  Penulis: X  Sinopsis: One. 2. 3. C  Penulis: Z");
  assert.deepEqual(found.map((entry) => [entry.title, entry.blurb, entry.warnings]), [["A", "One.", []], ["C", "", []]]);
});

test("spaces inside the parenthesis, around a rating's words and at a cut are trimmed away", () => {
  assert.deepEqual(splitTitle("Judul ( Le Petit Prince )"), { title: "Judul", original: "Le Petit Prince" });
  assert.equal(parseList("1. A  Penulis: X  Rating: about 4 / 5")[0].rated_elsewhere, "4 / 5");
  const warnings: string[] = [];
  assert.equal(fit("ab  cdefgh", 5, warnings as never), "ab…");
  assert.deepEqual(warnings, ["cut"]);
});

test("an original title over the cap is cut and warns like the title does", () => {
  const [entry] = parseList(`1. Judul (${"word ".repeat(120)})  Penulis: X`);
  assert.ok(entry.original_title.length <= TEXT_MAX && entry.original_title.endsWith("…"));
  assert.deepEqual(entry.warnings, ["cut"]);
});

test("a number glued to a letter or a digit, a year, or the end of a fraction is never the next entry", () => {
  const entries = (text: string) => parseList(text).map((entry) => [entry.title, entry.blurb, entry.rated_elsewhere, entry.warnings]);
  assert.deepEqual(entries("1. A  Penulis: X  Sinopsis: See page2. Done. 3. B  Penulis: Y  Sinopsis: Z."), [["A", "See page2. Done.", "", []], ["B", "Z.", "", []]]);
  assert.deepEqual(entries("1. A  Penulis: X  Sinopsis: Set in 1002. Then. 3. B  Penulis: Y  Sinopsis: Z."), [["A", "Set in 1002. Then.", "", []], ["B", "Z.", "", []]]);
  assert.deepEqual(entries("1. A  Penulis: X  Rating: ~4 / 2. 3. B  Penulis: Y"), [["A", "", "~4 / 2", []], ["B", "", "", []]]);
  assert.deepEqual(entries("1. A  Penulis: X  Rating: ~4/2. 3. B  Penulis: Y"), [["A", "", "~4/2", []], ["B", "", "", []]]);
});

test("a first entry with only a title is kept when a labelled entry follows, and a label glued to a number starts a title-less piece", () => {
  assert.deepEqual(parseList("1. Only Title\n2. B  Penulis: Y").map((entry) => [entry.title, entry.author]), [["Only Title", ""], ["B", "Y"]]);
  assert.deepEqual(parseList("1. A  Penulis: X 2.Penulis: Y").map((entry) => [entry.title, entry.author, entry.warnings]), [["A", "X", []]]);
  const found = parseList("1. A  Penulis: X  Sinopsis: One. 2. 7. C  Penulis: Z");
  assert.deepEqual(found.map((entry) => [entry.title, entry.blurb, entry.warnings]), [["A", "One.", []], ["C", "", []]]);
});

test("a label with only spaces after it is just empty, with no hidden-characters warning", () => {
  assert.deepEqual(parseList("1. A  Penulis:  Sinopsis: Words").map((entry) => [entry.author, entry.blurb, entry.warnings]), [["", "Words", ["missing_author"]]]);
});

test("a first entry that follows words on its line and has only a title is kept when a labelled entry comes next", () => {
  assert.deepEqual(parseList("Words 1. Only Title\n2. B  Penulis: Y").map((entry) => [entry.title, entry.author]), [["Only Title", ""], ["B", "Y"]]);
});

test("an entry whose title is invisible once the original title is split off is left out, and the rest of the list is read", () => {
  const titles = (text: string) => parseList(text).map((entry) => [entry.title, entry.original_title]);
  assert.deepEqual(titles("1. ⠀ (Bumi)\n2. B"), [["B", ""]]);
  assert.deepEqual(titles("1. ㅤ (Bumi)  Penulis: X\n2. B  Penulis: Y"), [["B", ""]]);
  assert.deepEqual(titles("1. ️ (Bumi)"), []);
  assert.deepEqual(titles("1. Laskar (Bumi)"), [["Laskar", "Bumi"]]);
});

test("an empty numbered line is skipped, and the entry after it is still read", () => {
  const read = (text: string) => parseList(text).map((entry) => [entry.title, entry.author, entry.blurb]);
  assert.deepEqual(read("1. A  Penulis: X\n2.\n3. C"), [["A", "X", ""], ["C", "", ""]]);
  assert.deepEqual(read("1. A  Penulis: X\n2.\n3.\n4. D\n5. E"), [["A", "X", ""], ["D", "", ""], ["E", "", ""]]);
  assert.deepEqual(read("1. A  Penulis: X  Sinopsis: One.\n2.\n3. C  Sinopsis: Two.\n4. D"), [["A", "X", "One."], ["C", "", "Two."], ["D", "", ""]]);
  assert.deepEqual(read("1. A  Sinopsis: One.\n2."), [["A", "", "One."]]);
});

test("numbers that follow text on the first line, with no author label near them, do not start entries", () => {
  assert.deepEqual(parseList("x 1. A 2. B 3. C  Penulis: X").map((entry) => [entry.title, entry.author]), [["C", "X"]]);
  assert.deepEqual(parseList("x 1. A 5. B  Penulis: X").map((entry) => [entry.title, entry.author]), [["B", "X"]]);
});

test("a label that repeats inside an entry stays in the text of the first one", () => {
  assert.deepEqual(parseList("1. T  Penulis: A  Penulis: B").map((entry) => [entry.title, entry.author]), [["T", "A Penulis: B"]]);
  assert.deepEqual(parseList("1. T  Sinopsis: A  Sinopsis: B  Penulis: C").map((entry) => [entry.blurb, entry.author]), [["A Sinopsis: B", "C"]]);
  assert.deepEqual(parseList("1. T  Penulis: A  Rating: 4  Rating: 5").map((entry) => [entry.author, entry.rated_elsewhere]), [["A", "4"]]);
});
