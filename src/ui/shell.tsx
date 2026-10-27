import { useEffect } from "react";
import type { ReactNode } from "react";
import { useSettings } from "../hooks/use-plan.ts";
import { actions, useSnapshot } from "../hooks/use-store.ts";
import { AddSheet } from "./add-sheet.tsx";
import { Pair } from "./avatar.tsx";
import { sweepUndone } from "./book-import.ts";
import { Compose } from "./compose.tsx";
import { Icon } from "./icons.tsx";
import { addStartsAs, isCurrent, navEntries } from "./nav.ts";
import { overlay, useOverlay } from "./overlay.ts";
import { sweepDay, sweepDeps, sweepExpired } from "./screen-save.ts";
import { SyncBadge } from "./sync-badge.tsx";
import { text } from "./text.ts";

function Nav({ className, section, locked }: { className: "tabs" | "rail"; section: string; locked: boolean }) {
  return (
    <nav className={className} aria-label={text.nav.label}>
      {navEntries(className).map((entry) =>
        entry === "add" ? (
          <button key="add" type="button" className={className === "tabs" ? "tab-add" : "rail-add"} aria-label={className === "tabs" ? text.add : undefined} disabled={locked} onClick={() => overlay.openAdd(addStartsAs(section))}>
            <Icon name="plus" />
            {className === "rail" && <span>{text.add}</span>}
          </button>
        ) : (
          <a key={entry.section} href={`#/${entry.section}`} aria-current={isCurrent(entry, section) ? "page" : undefined}>
            <Icon name={entry.icon} />
            <span>{entry.label}</span>
          </a>
        ),
      )}
    </nav>
  );
}

export function Shell({ section, children }: { section: string; children: ReactNode }) {
  const snapshot = useSnapshot();
  const { link, notice, paused, rows } = snapshot;
  const { toast } = useOverlay();
  const { timezone } = useSettings();
  useEffect(() => sweepUndone(rows.items, actions.many), [rows.items]);
  useEffect(() => sweepExpired(rows.items, sweepDay(snapshot, actions.serverNow(), timezone), actions.many), [...sweepDeps(snapshot), timezone]);
  const journey = section === "marriage";
  return (
    <div className="shell">
      <div className="chrome">
        <header className="bar" data-hero={journey || undefined}>
          <a className="brand" href="#/">
            {text.appName}
          </a>
          <SyncBadge />
          <a className="pair" href="#/settings" aria-label={text.nav.settings} aria-current={section === "settings" ? "page" : undefined}>
            <Pair size={32} />
          </a>
        </header>
        <Nav className="rail" section={section} locked={link === "mismatch"} />
      </div>
      <div className="content">
        {link === "mismatch" && (
          <div className="notice" role="alert">
            <p>{text.notice.mismatch}</p>
            <button type="button" onClick={actions.reload}>
              {text.notice.reload}
            </button>
          </div>
        )}
        {paused && link !== "mismatch" && (
          <div className="notice" role="status">
            <p>{text.paused}</p>
          </div>
        )}
        {notice && (
          <div className="notice" role="status">
            <p>
              {text.notice.reset}
              {notice.discarded > 0 && ` ${text.notice.discarded(notice.discarded)}`}
            </p>
            <button type="button" className="secondary" onClick={actions.dismissNotice}>
              {text.notice.dismiss}
            </button>
          </div>
        )}
        <main data-page={journey ? "journey" : undefined}>{link === "mismatch" ? null : children}</main>
      </div>
      <Nav className="tabs" section={section} locked={link === "mismatch"} />
      <div className="toast" role="status" data-top={toast?.top}>
        {toast && (
          <p key={toast.id}>
            <span>{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                onClick={() => {
                  toast.action!.run();
                  overlay.dismissToast();
                }}
              >
                {toast.action.label}
              </button>
            )}
          </p>
        )}
      </div>
      {link !== "mismatch" && <AddSheet />}
      {link !== "mismatch" && <Compose />}
    </div>
  );
}
