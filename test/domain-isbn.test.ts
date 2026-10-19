import { test } from "node:test";
import assert from "node:assert/strict";
import { toIsbn13 } from "../src/domain/isbn.ts";
import { validateCreate } from "../shared/validate.ts";

test("an ISBN-13 with a valid check digit is kept, with hyphens and spaces removed", () => {
  assert.equal(toIsbn13("9789793062792"), "9789793062792");
  assert.equal(toIsbn13("978-979-3062-79-2"), "9789793062792");
  assert.equal(toIsbn13(" 978 979 3062 79 2 "), "9789793062792");
});

test("an ISBN-10 becomes the ISBN-13 with the 978 prefix and a new check digit", () => {
  assert.equal(toIsbn13("0156012197"), "9780156012195");
  assert.equal(toIsbn13("0-15-601219-7"), "9780156012195");
  assert.equal(toIsbn13("080442957X"), "9780804429573");
  assert.equal(toIsbn13("080442957x"), "9780804429573");
});

test("a wrong check digit, a wrong length or a stray character gives null", () => {
  for (const bad of ["9789793062793", "0156012198", "080442957", "97897930627", "978979306279X", "X156012197", "isbn 9789793062792", "", "-"])
    assert.equal(toIsbn13(bad), null, bad);
});

test("every converted ISBN-10 passes the stored isbn type", () => {
  const book = { id: "00000000-0000-4000-8000-000000000001", kind: "book", title: "The Little Prince", status: "shelf", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
  assert.deepEqual(validateCreate("items", { ...book, data: { isbn: toIsbn13("0156012197") } }), []);
});

test("an ISBN field reads hyphenated and ISBN-10 input as the stored ISBN-13, and an empty one as unset", async () => {
  const { parseField } = await import("../src/domain/field.ts");
  assert.deepEqual(parseField("isbn", " 978-979-3062-79-2 "), { ok: true, value: "9789793062792" });
  assert.deepEqual(parseField("isbn", "0-15-601219-7"), { ok: true, value: "9780156012195" });
  assert.deepEqual(parseField("isbn", "  "), { ok: true, value: null });
  assert.deepEqual(parseField("isbn", "9789793062793"), { ok: false });
  assert.deepEqual(parseField("isbn", "12345"), { ok: false });
});
