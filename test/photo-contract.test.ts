import { test } from "node:test";
import assert from "node:assert/strict";
import { PHOTO_MAX, isPhoto, validateChange, validateCreate, validatePatch } from "../shared/validate.ts";
import { createServer } from "./store-server.ts";
import { client } from "./store-client.ts";
import { apply, createDb, mutation, setting, stored } from "./sync-db.ts";

const HOST = "https://lh3.googleusercontent.com";

const padded = (total: number) => `${HOST}/${"a".repeat(total - HOST.length - 1)}`;

const KEYS = ["partner_a_photo", "partner_b_photo"];

const valid: [string, string][] = [
  ["a usual profile photo", `${HOST}/a/ACg8ocLexample123=s96-c`],
  ["the bare host", "https://googleusercontent.com/a/example"],
  ["a deeper subdomain", "https://lh3.photos.googleusercontent.com/x"],
  ["a query string", `${HOST}/a/example?sz=96`],
  ["the longest length", padded(PHOTO_MAX)],
  ["an empty string, to clear it", ""],
];

const invalid: [string, string][] = [
  ["a javascript URL", "javascript:alert(1)"],
  ["a data URL", "data:image/png;base64,AAAA"],
  ["a blob URL", "blob:https://lh3.googleusercontent.com/1"],
  ["plain http", "http://lh3.googleusercontent.com/a"],
  ["a protocol-relative URL", "//lh3.googleusercontent.com/a"],
  ["a bare host without a scheme", "lh3.googleusercontent.com/a"],
  ["another host", "https://example.test/a.png"],
  ["a look-alike path", "https://evil.example.test/.googleusercontent.com"],
  ["a look-alike prefix", "https://googleusercontent.com.evil.example.test/a"],
  ["a look-alike joined to the name", "https://evilgoogleusercontent.com/a"],
  ["a look-alike with a backslash", "https://evil.example.test\\.googleusercontent.com/a"],
  ["a trailing dot on the host", "https://lh3.googleusercontent.com./a"],
  ["an empty host label", "https://..googleusercontent.com/a"],
  ["a dot in the host name replaced by a letter", "https://lh3.googleusercontentXcom/a"],
  ["a delete character", `${HOST}/a\u007fb`],
  ["a password without a user name", "https://:pass@lh3.googleusercontent.com/a"],
  ["a user name", "https://user@lh3.googleusercontent.com/a"],
  ["a user name and password", "https://user:pass@lh3.googleusercontent.com/a"],
  ["credentials that make the real host the user name", "https://lh3.googleusercontent.com@evil.example.test/a"],
  ["a port", "https://lh3.googleusercontent.com:8443/a"],
  ["one more than the length limit", padded(PHOTO_MAX + 1)],
  ["a newline", `${HOST}/a\nb`],
  ["a tab", `${HOST}/a\tb`],
  ["a space", `${HOST}/a b`],
  ["a null character", `${HOST}/a\u0000b`],
  ["a zero-width space", `${HOST}/a​b`],
  ["a bidirectional override", `${HOST}/a‮b`],
  ["a leading space", ` ${HOST}/a`],
  ["a trailing space", `${HOST}/a `],
  ["a Cyrillic look-alike letter in the host", "https://lh3.googleusercontеnt.com/a"],
  ["a full-width look-alike host", "https://ｌｈ3.ｇｏｏｇｌｅusercontent.com/a"],
  ["a non-ASCII path", `${HOST}/é`],
  ["only a scheme", "https://"],
  ["text", "not a url"],
];

const set = (key: string, value: string) => ({ key, value, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" });

const verdicts = async (key: string, value: string) => {
  const created = validateCreate("settings", set(key, value)).length === 0;
  const patched = validatePatch("settings", key, { value }).length === 0;
  const changed = validateChange("settings", { ...set(key, `${HOST}/x`), rev: 1, updated_by: null, deleted_at: null }, { value }).length === 0;

  const { db, sqlite } = createDb();
  const worker = !("errors" in (await apply(db, [setting(key, value)])));
  const workerFirst = worker && stored(sqlite, "settings", key)?.value === value;
  const seeded = createDb();
  await apply(seeded.db, [setting(key, `${HOST}/x`)]);
  const replaced = !("errors" in (await apply(seeded.db, [mutation("update", "settings", key, { value })])));

  const server = createServer();
  const phone = client(server, "a");
  await phone.store.open();
  const store = (await phone.store.setSetting(key, value)).ok;
  const again = (await phone.store.setSetting(key, `${HOST}/y`)).ok;
  const second = (await phone.store.setSetting(key, value)).ok;
  return { created, patched, changed, worker, workerFirst, replaced, store, again, second };
};

for (const key of KEYS) {
  for (const [name, value] of valid) {
    test(`${key}: ${name} is accepted by the contract, the Worker and the store`, async () => {
      assert.equal(isPhoto(value) || value === "", true);
      assert.deepEqual(await verdicts(key, value), { created: true, patched: true, changed: true, worker: true, workerFirst: true, replaced: true, store: true, again: true, second: true });
    });
  }

  for (const [name, value] of invalid) {
    test(`${key}: ${name} is refused by the contract, the Worker and the store`, async () => {
      assert.equal(isPhoto(value), false);
      assert.deepEqual(await verdicts(key, value), { created: false, patched: false, changed: false, worker: false, workerFirst: false, replaced: false, store: false, again: true, second: false });
    });
  }
}

test("photo: an empty string stays refused for every other setting", () => {
  for (const key of ["partner_a_label", "timezone", "ceremony_date", "stages", "holidays"]) {
    assert.notDeepEqual(validateCreate("settings", set(key, "")), [], key);
    assert.notDeepEqual(validatePatch("settings", key, { value: "" }), [], key);
  }
});

test("photo: a value that is not a string is refused", () => {
  for (const value of [null, 5, true, {}, []]) {
    assert.equal(isPhoto(value), false);
    assert.notDeepEqual(validatePatch("settings", "partner_a_photo", { value }), []);
  }
});

test("photo: the refusal names the key and what is allowed", () => {
  assert.deepEqual(validatePatch("settings", "partner_b_photo", { value: "http://lh3.googleusercontent.com/a" }), [
    "value: must be an https URL of up to 512 characters on googleusercontent.com without credentials or a port, or an empty string for key partner_b_photo",
  ]);
});

test("photo: the Worker keeps a cleared value as an empty string", async () => {
  const { db, sqlite } = createDb();
  await apply(db, [setting("partner_a_photo", `${HOST}/x`)]);
  const result = await apply(db, [mutation("update", "settings", "partner_a_photo", { value: "" })]);
  assert.equal("errors" in result, false);
  assert.equal(stored(sqlite, "settings", "partner_a_photo")?.value, "");
});
