import { useEffect, useMemo, useState } from "react";
import type { FeedStatus, Side } from "../../shared/api.ts";
import { feedUrl } from "../store/feed.ts";
import type { FeedResult } from "../store/feed.ts";
import { useBusy } from "../hooks/use-busy.ts";
import { feedFor } from "../hooks/use-store.ts";
import { formatStamp } from "./format.ts";
import { Icon } from "./icons.tsx";
import { overlay } from "./overlay.ts";
import { text } from "./text.ts";

const copy = text.settings.feed;

type State = { phase: "loading" } | { phase: "failed"; reason: keyof typeof copy.failed } | { phase: "ready"; status: FeedStatus };

export function FeedSection({ side, zone }: { side: Side; zone: string }) {
  const feed = useMemo(() => feedFor(side), [side]);
  const [state, setState] = useState<State>({ phase: "loading" });
  const [link, setLink] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { busy, once } = useBusy();

  const show = <T,>(result: FeedResult<T>, then: (value: T) => FeedStatus) => {
    if (result.kind === "ok") {
      setNote(null);
      setState({ phase: "ready", status: then(result.value) });
    } else if (state.phase === "ready") setNote(copy.failed[result.kind]);
    else setState({ phase: "failed", reason: result.kind });
  };

  useEffect(() => {
    let current = true;
    void feed.status().then((result) => current && show(result, (status) => status));
    return () => {
      current = false;
      setLink(null);
    };
  }, [feed]);

  const create = () =>
    once(async () => {
      const result = await feed.create();
      if (result.kind === "ok") setLink(feedUrl(location.origin, result.value.token));
      show(result, ({ created_at }) => ({ active: true, created_at, fetched_at: null }));
    });

  const revoke = () =>
    once(async () => {
      const result = await feed.revoke();
      if (result.kind === "ok") setLink(null);
      show(result, (status) => status);
    });

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link ?? "");
      overlay.announce(copy.copied);
    } catch {
      setNote(copy.copyFailed);
    }
  };

  const status = state.phase === "ready" ? state.status : null;
  return (
    <section className="feed" aria-labelledby="feed-title">
      <h2 id="feed-title">{copy.title}</h2>
      <p className="hint">{copy.intro}</p>
      {state.phase === "loading" && <p className="hint" role="status">{copy.loading}</p>}
      {state.phase === "failed" && (
        <p className="error" role="alert">
          {copy.failed[state.reason]}
        </p>
      )}
      {status !== null && (
        <p className="feed-status" role="status">
          {status.active ? `${copy.since(formatStamp(status.created_at, zone))} ${status.fetched_at === null ? copy.neverFetched : copy.fetched(formatStamp(status.fetched_at, zone))}` : copy.none}
        </p>
      )}
      {link !== null && (
        <div className="feed-link">
          <label htmlFor="feed-link">{copy.linkLabel}</label>
          <input id="feed-link" type="text" readOnly value={link} autoComplete="off" spellCheck={false} onFocus={(event) => event.currentTarget.select()} />
          <button type="button" onClick={copyLink}>
            <Icon name="check" />
            {copy.copy}
          </button>
          <p className="hint" role="status">
            {copy.once}
          </p>
        </div>
      )}
      {note !== null && (
        <p className="error" role="alert">
          {note}
        </p>
      )}
      {status !== null && (
        <div className="feed-acts">
          <button type="button" className={status.active ? "secondary" : undefined} disabled={busy} onClick={create}>
            {status.active ? copy.rotate : copy.create}
          </button>
          {status.active && (
            <button type="button" className="danger" disabled={busy} onClick={revoke}>
              {copy.revoke}
            </button>
          )}
        </div>
      )}
      {status?.active === true && <p className="hint">{copy.rotateHint}</p>}
      <p className="hint feed-secret">{copy.secret}</p>
      <h3>{copy.how}</h3>
      <ol className="feed-steps">
        {copy.google.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <p className="hint">{copy.googleNote}</p>
      <p className="hint">{copy.apple}</p>
      <p className="hint">{copy.delay}</p>
    </section>
  );
}
