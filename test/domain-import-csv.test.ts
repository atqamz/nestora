import { test } from "node:test";
import assert from "node:assert/strict";
import { delimiterOf, looksLikeCsv, parseBookCsv, readCsv } from "../src/domain/import-csv.ts";
import { exportData } from "../worker/export.ts";
import { apply, createDb, id, mutation } from "./sync-db.ts";

test("quoted fields keep commas, escaped quotes, line breaks and leading spaces", () => {
  assert.deepEqual(readCsv('a,"b, c","say ""hi""","line\nbreak",  d\r\n'), [["a", "b, c", 'say "hi"', "line\nbreak", "  d"]]);
});

test("a byte order mark, every line ending and blank lines are tolerated, and a missing final newline is fine", () => {
  assert.deepEqual(readCsv("\ufeffa,b\r\n\r\nc,d\re,f\n\n,\ng,h"), [["a", "b"], ["c", "d"], ["e", "f"], ["g", "h"]]);
});

test("empty cells, a lone quoted empty string and a trailing delimiter keep their columns", () => {
  assert.deepEqual(readCsv('a,,"",d,'), [["a", "", "", "d", ""]]);
});

test("a quote that never closes takes the rest of the file instead of failing", () => {
  assert.deepEqual(readCsv('a,"b,c\nd'), [["a", "b,c\nd"]]);
});

test("a quote in the middle of an unquoted cell is just a character", () => {
  assert.deepEqual(readCsv('5" nails,x'), [['5" nails', "x"]]);
});

test("the delimiter is the most common of comma, semicolon and tab in the header outside quotes", () => {
  assert.equal(delimiterOf("title,author"), ",");
  assert.equal(delimiterOf("title;author;isbn"), ";");
  assert.equal(delimiterOf("title\tauthor"), "\t");
  assert.equal(delimiterOf('"a,b,c";d'), ";");
  assert.equal(delimiterOf("title"), ",");
  assert.equal(delimiterOf("title,author\nA;B;C;D;E;F"), ",");
  assert.equal(delimiterOf("\ufefftitle;author,x;y"), ";");
  assert.deepEqual(readCsv("title;author\nA;B"), [["title", "author"], ["A", "B"]]);
});

test("a header row is recognised from the title column and nothing else", () => {
  assert.equal(looksLikeCsv("Title,Author\nA,B"), true);
  assert.equal(looksLikeCsv("\ufefftitle;author\nA;B"), true);
  assert.equal(looksLikeCsv("data.title\nA"), true);
  assert.equal(looksLikeCsv("1. Laskar Pelangi  Penulis: Andrea Hirata"), false);
  assert.equal(looksLikeCsv("Author,Isbn\nA,B"), false);
  assert.equal(looksLikeCsv(""), false);
});

test("headers map to the book fields whatever their case, spacing or prefix", () => {
  const { rows, skipped, problem } = parseBookCsv(
    [
      "Title,AUTHOR,Original Title,ISBN,Status,Place,Owner,Rating,Notes,Language,Synopsis,Genre,Ignored",
      "Laskar Pelangi,Andrea Hirata,,978-979-3062-79-2,Shelf,Home A,Partner A,~4.2 / 5,A note,Indonesian,A story.,Novel,x",
      "Bumi Manusia,Pramoedya Ananta Toer,,,wishlist,,both,4.4,,English,,,",
    ].join("\n"),
  );
  assert.equal(problem, null);
  assert.equal(skipped, 0);
  assert.deepEqual(rows[0], {
    title: "Laskar Pelangi",
    original_title: "",
    author: "Andrea Hirata",
    rated_elsewhere: "~4.2 / 5",
    blurb: "A story.",
    isbn: "9789793062792",
    language: "id",
    status: "shelf",
    place: "Home A",
    owner: "Partner A",
    note: "A note",
    genre: "Novel",
    warnings: [],
  });
  assert.deepEqual([rows[1].status, rows[1].owner, rows[1].language, rows[1].rated_elsewhere, rows[1].isbn], ["wish", "both", "en", "4.4", ""]);
});

test("a semicolon file with quoted newlines parses the same as the comma one", () => {
  const comma = parseBookCsv('title,author,notes\n"A, B","C ""D""","x\ny"');
  const semicolon = parseBookCsv('title;author;notes\n"A, B";"C ""D""";"x\ny"');
  assert.deepEqual(semicolon, comma);
  assert.deepEqual([comma.rows[0].title, comma.rows[0].author, comma.rows[0].note], ["A, B", 'C "D"', "x\ny"]);
});

test("rows without a title are counted and skipped, missing authors and bad ISBNs warn", () => {
  const { rows, skipped } = parseBookCsv("title,author,isbn\n,Someone,\nHas Title,,123\nOther,Writer,9789793062792\n  ,  ,  ");
  assert.equal(skipped, 1);
  assert.deepEqual(rows.map((row) => [row.title, row.isbn, row.warnings]), [["Has Title", "", ["bad_isbn", "missing_author"]], ["Other", "9789793062792", []]]);
});

test("a row shorter than the header leaves its missing cells empty", () => {
  const { rows } = parseBookCsv("title,author,language\nA");
  assert.deepEqual([rows[0].title, rows[0].author, rows[0].language], ["A", "", ""]);
});

test("no title column and an empty file are reported as problems", () => {
  assert.deepEqual(parseBookCsv("author,isbn\nA,B"), { rows: [], skipped: 0, problem: "no_title" });
  assert.deepEqual(parseBookCsv(""), { rows: [], skipped: 0, problem: "empty" });
  assert.deepEqual(parseBookCsv("\ufeff\n\n"), { rows: [], skipped: 0, problem: "empty" });
});

test("a cell that a spreadsheet would run as a formula loses only the apostrophe the export added", () => {
  const { rows } = parseBookCsv("title,notes\n'=1+1,'@x\n'quoted,'-5");
  assert.deepEqual(rows.map((row) => [row.title, row.note]), [["=1+1", "@x"], ["'quoted", "-5"]]);
});

test("text fields are tidied and cut at the registry caps", () => {
  const { rows } = parseBookCsv(`title,notes,synopsis\n"A\u00a0 B\u200b","${"word ".repeat(3000)}","${"x ".repeat(2000)}"`);
  assert.equal(rows[0].title, "A B");
  assert.ok(rows[0].note.length <= 10000 && rows[0].note.endsWith("…"));
  assert.ok(rows[0].blurb.length <= 2000 && rows[0].blurb.endsWith("…"));
  assert.deepEqual(rows[0].warnings, ["missing_author", "cut"]);
});

test("200 KB of CSV is read in well under a second", () => {
  const body = Array.from({ length: 500 }, (_, at) => `Placeholder ${at},Writer ${at},"${"synopsis words, with commas. ".repeat(14)}"`).join("\n");
  const text = `title,author,synopsis\n${body}`;
  assert.ok(text.length > 200_000);
  const start = performance.now();
  const { rows } = parseBookCsv(text);
  const took = performance.now() - start;
  assert.equal(rows.length, 500);
  assert.ok(took < 1000, `${took} ms`);
});

test("the CSV the app exports from Settings reads back, including the awkward cells", async () => {
  const { db } = createDb();
  const stamps = { created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
  const book = (n: number, patch: Record<string, unknown>) => mutation("create", "items", id(n), { id: id(n), kind: "book", ...stamps, ...patch });
  const result = await apply(db, [
    book(1, {
      title: 'Laskar "Pelangi", Part 1',
      status: "shelf",
      group_key: "Novel",
      note: "line one\nline two",
      data: { author: "Andrea Hirata", original_title: "Rainbow Troops", isbn: "9789793062792", language: "id", blurb: "A story; with semicolons, and commas.", rated_elsewhere: "~4.2 / 5 (Goodreads)", reading_a: "read", rating_a: "5", import_batch: "b-1" },
    }),
    book(2, { title: "=Bumi Manusia", status: "wish", who: "b", data: { author: "Pramoedya Ananta Toer", public_rating: "4.4", priority: "high", gift: true } }),
    book(3, { title: "The Little Prince", status: "wish", who: "both" }),
    mutation("create", "items", id(4), { id: id(4), kind: "copy", parent_id: id(1), title: "Copy", status: "here", ...stamps }),
  ]);
  assert.equal("errors" in result, false);
  const csv = await (await exportData(new URL("https://wp.example.test/api/export?format=csv&table=items&kind=book"), db)).text();
  const { rows, skipped, problem } = parseBookCsv(csv);
  assert.deepEqual([problem, skipped, rows.length], [null, 0, 3]);
  const by = Object.fromEntries(rows.map((row) => [row.title, row]));
  assert.deepEqual(by['Laskar "Pelangi", Part 1'], {
    title: 'Laskar "Pelangi", Part 1',
    original_title: "Rainbow Troops",
    author: "Andrea Hirata",
    rated_elsewhere: "~4.2 / 5 (Goodreads)",
    blurb: "A story; with semicolons, and commas.",
    isbn: "9789793062792",
    language: "id",
    status: "shelf",
    place: "",
    owner: "",
    note: "line one\nline two",
    genre: "Novel",
    warnings: [],
  });
  assert.deepEqual([by["=Bumi Manusia"].status, by["=Bumi Manusia"].owner, by["=Bumi Manusia"].rated_elsewhere, by["=Bumi Manusia"].author], ["wish", "b", "4.4", "Pramoedya Ananta Toer"]);
  assert.equal(by["The Little Prince"].language, "");
  assert.deepEqual([by["The Little Prince"].status, by["The Little Prince"].owner, by["The Little Prince"].warnings], ["wish", "both", ["missing_author"]]);
  const semicolons = parseBookCsv(readCsv(csv).map((cells) => cells.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(";")).join("\r\n"));
  assert.deepEqual(semicolons.rows, rows);
});

test("every capped CSV field is cut at its cap with an ellipsis and one warning", () => {
  const long = (cap: number) => `${"word ".repeat(Math.ceil(cap / 5) + 3)}`.trim();
  const caps: Record<string, [string, number]> = { title: ["title", 500], original_title: ["original title", 500], author: ["author", 500], rated_elsewhere: ["rating", 500], genre: ["genre", 500], blurb: ["synopsis", 2000], note: ["notes", 10000] };
  for (const [field, [header, cap]] of Object.entries(caps)) {
    const { rows } = parseBookCsv(`title,${header === "title" ? "author" : header}\n${header === "title" ? `${long(cap)},A` : `T,${long(cap)}`}`);
    const value = rows[0][field as keyof (typeof rows)[0]] as string;
    assert.ok(value.length <= cap && value.endsWith("…") && value.length > cap - 10, `${field} ${value.length}`);
    assert.deepEqual(rows[0].warnings.filter((warning) => warning === "cut"), ["cut"], field);
  }
});

test("padded language and status words are read, and the short and long forms of each are accepted", () => {
  const read = (language: string, status: string) => {
    const [row] = parseBookCsv(`title,language,status\nT,"${language}","${status}"`).rows;
    return [row.language, row.status];
  };
  assert.deepEqual(read(" English ", " Wishlist "), ["en", "wish"]);
  assert.deepEqual(read("ind", "owned"), ["id", "shelf"]);
  assert.deepEqual(read("INDONESIAN", "OWN"), ["id", "shelf"]);
  assert.deepEqual(read("eng", "wish"), ["en", "wish"]);
  assert.deepEqual(read("id", "shelf"), ["id", "shelf"]);
  assert.deepEqual(read("French", "lent"), ["other", ""]);
  assert.deepEqual(read("  ", "  "), ["", ""]);
});

test("when two columns hold the same field, a blank or space-only first one gives way to the next", () => {
  const { rows } = parseBookCsv("title,author,authors\nA,   ,Real Name\nB,,\nC,First,Second");
  assert.deepEqual(rows.map((row) => row.author), ["Real Name", "", "First"]);
});

test("only the first 4000 characters are looked at for the title column", () => {
  assert.equal(looksLikeCsv(`${",".repeat(3995)}Title`), true);
  assert.equal(looksLikeCsv(`${",".repeat(3996)}Title`), false);
});
