import { toInstant } from "../shared/api.ts";
import type { FeedStatus, Side } from "../shared/api.ts";
import { calendarOf } from "../shared/ics.ts";
import type { ItemRow } from "../shared/tables.ts";
import { isDates } from "../shared/validate.ts";
import { json } from "./sync.ts";
import type { Db } from "./sync.ts";

const TOKEN_BYTES = 32;

const encoder = new TextEncoder();

const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const hashOf = async (token: string) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(token))));

const QUIET = { "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };

const FEED_HEADERS = { "content-type": "text/calendar; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...QUIET };

export const same = (a: Uint8Array, b: Uint8Array) => {
  let diff = a.length ^ b.length;
  for (let at = 0; at < a.length; at++) diff |= a[at] ^ b[at];
  return diff === 0;
};

const sideOf = async (db: Db, token: string): Promise<Side | null> => {
  const digest = encoder.encode(await hashOf(token));
  const { results } = await db.prepare("SELECT who, hash FROM feed_tokens").all();
  let found: Side | null = null;
  for (const row of results) if (same(digest, encoder.encode(String(row.hash)))) found = row.who as Side;
  return found;
};

const holidaysOf = (value: unknown): string[] => (isDates(value) ? JSON.parse(value as string) : []);

export const feedStatus = async (db: Db, who: Side): Promise<FeedStatus> => {
  const { results } = await db.prepare("SELECT created_at, fetched_at FROM feed_tokens WHERE who = ?").bind(who).all();
  const [row] = results;
  return row === undefined ? { active: false } : { active: true, created_at: row.created_at as string, fetched_at: (row.fetched_at as string | null) ?? null };
};

export const rotateFeed = async (db: Db, who: Side, now = new Date()) => {
  const token = hex(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
  const created = toInstant(now);
  await db
    .prepare(
      "INSERT INTO feed_tokens (who, hash, created_at, fetched_at) VALUES (?, ?, ?, NULL) ON CONFLICT (who) DO UPDATE SET hash = excluded.hash, created_at = excluded.created_at, fetched_at = NULL",
    )
    .bind(who, await hashOf(token), created)
    .all();
  return { token, created_at: created };
};

export const revokeFeed = async (db: Db, who: Side) => {
  await db.prepare("DELETE FROM feed_tokens WHERE who = ?").bind(who).all();
};

export const serveFeed = async (request: Request, db: Db, pathname: string, now = new Date()) => {
  const { method } = request;
  if (method !== "GET" && method !== "HEAD") return json({ error: "method_not_allowed" }, 405, { allow: "GET, HEAD", ...QUIET });
  const token = pathname.endsWith(".ics") ? pathname.slice("/feed/".length, -".ics".length) : "";
  const who = await sideOf(db, token);
  if (who === null) return json({ error: "not_found" }, 404, QUIET);
  const [items, settings] = await db.batch([
    db.prepare("SELECT * FROM items WHERE deleted_at IS NULL AND kind IN ('routine', 'block')"),
    db.prepare("SELECT value FROM settings WHERE key = 'holidays' AND deleted_at IS NULL"),
    db.prepare("UPDATE feed_tokens SET fetched_at = ? WHERE who = ?").bind(toInstant(now), who),
  ]);
  const rows = items.results.map((row) => ({ ...row, data: typeof row.data === "string" ? JSON.parse(row.data) : null }) as unknown as ItemRow);
  const body = calendarOf(rows, who, now, holidaysOf(settings.results[0]?.value));
  return new Response(method === "HEAD" ? null : body, { headers: FEED_HEADERS });
};
