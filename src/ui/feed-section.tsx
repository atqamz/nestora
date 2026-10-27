import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { Side } from "../../shared/api.ts";
import { useBusy } from "../hooks/use-busy.ts";
import { feedFor } from "../hooks/use-store.ts";
import { copyFailed, created, linkAfterCreate, linkAfterRevoke, loaded, LOADING, revoked, statusLine, sureText } from "./feed-flow.ts";
import type { Ask, View } from "./feed-flow.ts";
import { Icon } from "./icons.tsx";
import { overlay } from "./overlay.ts";
import { text } from "./text.ts";

const copy = text.settings.feed;

export function FeedSection({ side, zone }: { side: Side; zone: string }) {
  const feed = useMemo(() => feedFor(side), [side]);
  const [view, setView] = useState<View>(LOADING);
  const [link, setLink] = useState<string | null>(null);
  const [asking, setAsking] = useState<Ask | null>(null);
  const { busy, once } = useBusy();
  const acts = useRef<HTMLDivElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const last = useRef<Ask | null>(null);
  const noted = useId();
  const { state, note } = view;

  useEffect(() => {
    let current = true;
    void feed.status().then((result) => current && setView((was) => loaded(was, result)));
    return () => {
      current = false;
      setLink(null);
      setAsking(null);
    };
  }, [feed]);

  useEffect(() => {
    if (asking !== null) {
      last.current = asking;
      keep.current?.focus();
    } else if (last.current !== null && !busy) {
      const ask = last.current;
      last.current = null;
      (acts.current?.querySelector<HTMLButtonElement>(`[data-ask="${ask}"]`) ?? acts.current?.querySelector("button"))?.focus();
    }
  }, [asking, busy]);

  const create = () =>
    once(async () => {
      const result = await feed.create();
      setLink((was) => linkAfterCreate(was, result, location.origin));
      setView((was) => created(was, result));
      setAsking(null);
    });

  const revoke = () =>
    once(async () => {
      const result = await feed.revoke();
      setLink((was) => linkAfterRevoke(was, result));
      setView((was) => revoked(was, result));
      setAsking(null);
    });

  const cancel = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !busy) {
      event.stopPropagation();
      setAsking(null);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link ?? "");
      overlay.announce(copy.copied);
    } catch {
      setView(copyFailed);
    }
  };

  const status = state.phase === "ready" ? state.status : null;
  const sure = sureText(asking);
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
          {statusLine(status, zone)}
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
      {status !== null && asking === null && (
        <div className="feed-acts" ref={acts}>
          <button type="button" data-ask={status.active ? "rotate" : "create"} className={status.active ? "secondary" : undefined} disabled={busy} onClick={status.active ? () => setAsking("rotate") : create}>
            {status.active ? copy.rotate : copy.create}
          </button>
          {status.active && (
            <button type="button" data-ask="revoke" className="danger" disabled={busy} onClick={() => setAsking("revoke")}>
              {copy.revoke}
            </button>
          )}
        </div>
      )}
      {status !== null && sure !== null && (
        <div className="feed-confirm" role="group" aria-labelledby={noted} onKeyDown={cancel}>
          <p id={noted} className="feed-sure">
            {sure}
          </p>
          <div className="feed-acts">
            <button ref={keep} type="button" disabled={busy} onClick={() => setAsking(null)}>
              {copy.keep}
            </button>
            <button type="button" className="danger" disabled={busy} onClick={asking === "rotate" ? create : revoke}>
              {asking === "rotate" ? copy.rotate : copy.revoke}
            </button>
          </div>
        </div>
      )}
      {status?.active === true && <p className="hint">{copy.rotateHint}</p>}
      <p className="hint feed-secret">{copy.secret}</p>
      <details className="stages">
        <summary>{copy.how}</summary>
        <ol className="feed-steps">
          {copy.google.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="hint">{copy.googleNote}</p>
        <p className="hint">{copy.apple}</p>
        <p className="hint">{copy.delay}</p>
      </details>
    </section>
  );
}
