import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

const avatar = read("ui/avatar.tsx");
const css = read("ui/ui.css");

const block = (source: string, selector: string) => {
  const start = source.indexOf(`${selector} {`);
  assert.notEqual(start, -1, selector);
  return source.slice(start, source.indexOf("}", start));
};

const image = /<img[\s\S]*?\/>/.exec(avatar)?.[0] ?? "";

test("the photo is decorative: empty alt, no referrer, async decoding, the disc size, fallback wiring", () => {
  assert.notEqual(image, "");
  for (const attribute of ['alt=""', 'referrerPolicy="no-referrer"', 'decoding="async"', "width={size}", "height={size}", "src={src}", "onLoad={", "onError={"]) {
    assert.ok(image.includes(attribute), attribute);
  }
  assert.doesNotMatch(avatar, /crossOrigin/i);
  assert.doesNotMatch(image, /aria-label|title=/);
});

test("the disc stays aria-hidden and the image is dropped only after an error", () => {
  assert.match(avatar, /<span className="av"[^>]*aria-hidden="true"/);
  assert.match(avatar, /src !== null && state !== false && \(/);
  assert.match(avatar, /photoSource\(photo\(side\), size\)/);
  assert.match(avatar, /loaded\.add\(src\)/);
  assert.match(avatar, /loaded\.delete\(src\)/);
  assert.match(avatar, /loaded\.has\(src\)/);
});

test("the image box is the disc box and the fade only runs without a reduced motion preference", () => {
  assert.match(block(css, ".av"), /position: relative;/);
  const box = block(css, ".av img");
  for (const declaration of ["position: absolute;", "inset: 0;", "width: 100%;", "height: 100%;", "border-radius: 50%;", "opacity: 0;"]) assert.ok(box.includes(declaration), declaration);
  assert.doesNotMatch(box, /transition/);
  assert.match(css, /@media \(prefers-reduced-motion: no-preference\) \{\s*\.av img \{\s*transition: opacity var\(--dur-state\);/);
});

const rem = (source: string, selector: string) => Number(new RegExp(`${selector.replace(/[.]/g, "\\.")} \\{[^}]*--av: ([\\d.]+)rem`).exec(source)?.[1]) * 16;

test("the size each place asks for matches the disc the style gives it", () => {
  assert.match(avatar, /size = 20/);
  assert.match(css, /width: var\(--av, 1\.25rem\)/);
  assert.equal(rem(read("style.css"), ".pair"), 32);
  assert.match(read("ui/shell.tsx"), /<Pair size=\{32\} \/>/);
  assert.equal(rem(read("views/home.css"), ".side"), 28);
  assert.match(read("views/home.tsx"), /<Avatar side=\{activity\.by\} size=\{28\} \/>/);
  assert.equal(rem(read("views/settings.css"), ".setl-two"), 44);
  assert.match(read("views/settings.tsx"), /<Avatar side=\{side\} size=\{44\} \/>/);
});
