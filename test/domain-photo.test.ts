import { test } from "node:test";
import assert from "node:assert/strict";
import { photoSource } from "../src/domain/photo.ts";

const HOST = "https://lh3.googleusercontent.com";

test("photo source: an empty, missing or unsafe value gives no image", () => {
  for (const value of [null, "", " ", "javascript:alert(1)", "data:image/png;base64,AAAA", "http://lh3.googleusercontent.com/a", "https://example.test/a.png", "https://user@lh3.googleusercontent.com/a"]) {
    assert.equal(photoSource(value, 20), null, String(value));
  }
});

test("photo source: the usual size suffix becomes twice the disc, capped at 256", () => {
  const photo = `${HOST}/a/example`;
  assert.equal(photoSource(`${photo}=s96-c`, 20), `${photo}=s40-c`);
  assert.equal(photoSource(`${photo}=s96-c`, 28), `${photo}=s56-c`);
  assert.equal(photoSource(`${photo}=s96-c`, 44), `${photo}=s88-c`);
  assert.equal(photoSource(`${photo}=s64-c`, 32), `${photo}=s64-c`);
  assert.equal(photoSource(`${photo}=s96-c`, 128), `${photo}=s256-c`);
  assert.equal(photoSource(`${photo}=s96-c`, 400), `${photo}=s256-c`);
});

test("photo source: any other url is returned as it is", () => {
  for (const url of [`${HOST}/a/example`, `${HOST}/a/example=s96`, `${HOST}/a/example=w96-h96`, `${HOST}/a/example=s96-c?x=1`, `${HOST}/a/example=s96-c-rj`, `${HOST}/a=s96-c/example`, `${HOST}/a/example=s12345-c`, `${HOST}/a/example=S96-C`]) {
    assert.equal(photoSource(url, 20), url);
  }
});
