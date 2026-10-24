import type { FeedStatus } from "../../shared/api.ts";
import { feedUrl } from "../store/feed.ts";
import type { FeedResult } from "../store/feed.ts";
import { formatStamp } from "./format.ts";
import { text } from "./text.ts";

const copy = text.settings.feed;

export type Reason = keyof typeof copy.failed;

export type State = { phase: "loading" } | { phase: "failed"; reason: Reason } | { phase: "ready"; status: FeedStatus };

export type View = { state: State; note: string | null };

export type Ask = "rotate" | "revoke";

export const LOADING: View = { state: { phase: "loading" }, note: null };

const settle = <T>(view: View, result: FeedResult<T>, then: (value: T) => FeedStatus): View =>
  result.kind === "ok"
    ? { state: { phase: "ready", status: then(result.value) }, note: null }
    : view.state.phase === "ready"
      ? { ...view, note: copy.failed[result.kind] }
      : { state: { phase: "failed", reason: result.kind }, note: null };

export const loaded = (view: View, result: FeedResult<FeedStatus>) => settle(view, result, (status) => status);

export const created = (view: View, result: FeedResult<{ token: string; created_at: string }>) =>
  settle(view, result, ({ created_at }) => ({ active: true, created_at, fetched_at: null }));

export const revoked = (view: View, result: FeedResult<FeedStatus>) => settle(view, result, (status) => status);

export const linkAfterCreate = (previous: string | null, result: FeedResult<{ token: string }>, origin: string) => (result.kind === "ok" ? feedUrl(origin, result.value.token) : previous);

export const linkAfterRevoke = (previous: string | null, result: FeedResult<unknown>) => (result.kind === "ok" ? null : previous);

export const copyFailed = (view: View): View => ({ ...view, note: copy.copyFailed });

export const statusLine = (status: FeedStatus, zone: string) =>
  status.active ? `${copy.since(formatStamp(status.created_at, zone))} ${status.fetched_at === null ? copy.neverFetched : copy.fetched(formatStamp(status.fetched_at, zone))}` : copy.none;

export const sureText = (asking: Ask | null) => (asking === null ? null : asking === "rotate" ? copy.sureRotate : copy.sureRevoke);
