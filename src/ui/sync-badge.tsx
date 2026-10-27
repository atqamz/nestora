import { badgeFor } from "../domain/status.ts";
import { actions, useSnapshot } from "../hooks/use-store.ts";
import { Icon } from "./icons.tsx";
import { text } from "./text.ts";

export function SyncBadge() {
  const { link, pending, rejected, storage, paused } = useSnapshot();
  const state = badgeFor({ storage, link, pending, rejected: rejected.length, paused });
  const labels = {
    storage: text.sync.storage,
    login: text.sync.login,
    mismatch: text.notice.reload,
    paused: text.sync.paused,
    rejected: text.sync.rejected(rejected.length),
    offline: text.sync.offline(pending),
    pending: text.sync.pending,
    synced: text.sync.synced,
  };
  return (
    <div role="status" className="sync" data-state={state}>
      {state === "synced" ? (
        <span className="visually-hidden">{labels.synced}</span>
      ) : state === "login" || state === "mismatch" ? (
        <button type="button" onClick={state === "login" ? actions.logIn : actions.reload}>
          <Icon name="late" />
          {labels[state]}
        </button>
      ) : (
        <a href="#/sync">
          {state === "storage" || state === "rejected" ? <Icon name="late" /> : null}
          {labels[state]}
        </a>
      )}
    </div>
  );
}
