import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const check: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts.check;

const guards = check.match(/!? ?grep -q '[^']*' dist\/client\/index\.html/g) ?? [];

const passes = (html: string) => {
  const file = join(mkdtempSync(join(tmpdir(), "nestora-check-")), "index.html");
  writeFileSync(file, html);
  return guards.every((guard) => spawnSync("sh", ["-c", guard.replace("dist/client/index.html", file)]).status === 0);
};

const bundleGuard = check.match(/! grep -rEq '[^']*' dist\/client/)?.[0] ?? "";

const bundlePasses = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), "nestora-bundle-"));
  mkdirSync(join(dir, "assets"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return spawnSync("sh", ["-c", bundleGuard.replace("dist/client", dir)]).status === 0;
};

test("the check script guards the built manifest link", () => {
  assert.equal(guards.length, 2);
});

test("the guard accepts a public manifest link", () => {
  assert.equal(passes('<link rel="manifest" href="/manifest.webmanifest">'), true);
});

test("the guard rejects a manifest link that asks for credentials", () => {
  assert.equal(passes('<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials">'), false);
});

test("the guard rejects a build without a manifest link", () => {
  assert.equal(passes('<link rel="icon" href="/icon-192.png">'), false);
});

test("the source page has a public manifest link", () => {
  assert.match(readFileSync(new URL("../index.html", import.meta.url), "utf8"), /rel="manifest" href="\/manifest\.webmanifest" \/>/);
});

test("the check script keeps the TMDB token name and the TMDB API host out of the client bundle, in any file under it", () => {
  assert.notEqual(bundleGuard, "");
  assert.equal(bundlePasses({ "index.html": "<html>", "assets/app.js": "fetch('/api/lookup/screen')" }), true);
  assert.equal(bundlePasses({ "index.html": "<html>", "assets/app.js": "const t = env.TMDB_TOKEN" }), false);
  assert.equal(bundlePasses({ "index.html": "<html>", "assets/app.js": "fetch('https://api.themoviedb.org/3/search/movie')" }), false);
  assert.equal(bundlePasses({ "index.html": "https://api.themoviedb.org/3/" }), false);
  assert.equal(bundlePasses({ "index.html": "<a href='https://www.themoviedb.org/movie/1'>TMDB</a>" }), true);
});
