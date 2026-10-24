import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { text } from "../src/ui/text.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the shell shows the mismatch notice with a reload button, and the badge offers the same reload", () => {
  assert.equal(text.notice.mismatch, "Signed in as someone else. Reload this page.");
  const shell = read("../src/ui/shell.tsx");
  assert.match(shell, /link === "mismatch" && \(\s*<div className="notice" role="alert">\s*<p>\{text\.notice\.mismatch\}<\/p>\s*<button type="button" onClick=\{actions\.reload\}>/);
  assert.match(read("../src/ui/sync-badge.tsx"), /state === "login" \? actions\.logIn : actions\.reload/);
  assert.match(read("../src/hooks/use-store.ts"), /reload: \(\) => location\.reload\(\)/);
});

test("a mismatched tab disables the Add button and drops the Add sheet", () => {
  const shell = read("../src/ui/shell.tsx");
  assert.match(shell, /disabled=\{locked\}/);
  assert.equal((shell.match(/locked=\{link === "mismatch"\}/g) ?? []).length, 2);
  assert.match(shell, /\{link !== "mismatch" && <AddSheet \/>\}/);
});

test("every export link carries the side, since a link cannot set a header", () => {
  assert.match(read("../src/views/settings.tsx"), /href=\{`\/api\/export\?\$\{link\.query\}&side=\$\{me\}`\}/);
});

test("the browser store is a session over one database per side, with the side hint in localStorage", () => {
  const browser = read("../src/store/browser.ts");
  assert.match(browser, /createSession\(\{/);
  assert.match(browser, /disk: indexedDbDisk\(\)/);
  assert.match(browser, /hint: sideHint\(localStorage\)/);
  assert.match(browser, /createApi\(\(url, init\) => fetch\(url, init\), side\)/);
  assert.doesNotMatch(browser, /indexedDbPersistence/);
  assert.match(read("../src/store/db.ts"), /open: \(side\) => indexedDbPersistence\(`wp-\$\{side\}`\)/);
});

test("the shell and the sync page say that changes are paused while the side is unconfirmed", () => {
  assert.match(read("../src/ui/shell.tsx"), /paused && link !== "mismatch" && \(\s*<div className="notice" role="status">\s*<p>\{text\.paused\}<\/p>/);
  assert.match(read("../src/ui/shell.tsx"), /<main data-page=\{journey \? "journey" : undefined\}>\{link === "mismatch" \? null : children\}<\/main>/);
  assert.match(read("../src/views/sync.tsx"), /paused\s*\? text\.sync\.pausedExpiredBody\s*: text\.sync\.expiredBody/);
  assert.match(read("../src/views/sync.tsx"), /link === "offline"\s*\? paused\s*\? text\.paused\s*: text\.sync\.offlineBody\s*: text\.sync\.onlineBody/);
  assert.match(read("../src/ui/failure.ts"), /result\.paused \? \[text\.paused\]/);
});
