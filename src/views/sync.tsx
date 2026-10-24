import { tables } from "../../shared/tables.ts";
import { changedValues } from "../domain/changes.ts";
import { usePartner } from "../hooks/use-plan.ts";
import { actions, useSnapshot } from "../hooks/use-store.ts";
import type { Pending } from "../hooks/use-store.ts";
import { reasonText, settingName } from "../ui/labels.ts";
import { formatDate, formatMoney } from "../ui/format.ts";
import { text } from "../ui/text.ts";
import { Title } from "../ui/title.tsx";

export function Sync() {
  const { link, pending, rejected, storage, paused, rows } = useSnapshot();
  const { me, label } = usePartner();

  const nameOf = (entry: Pending) => {
    if (typeof entry.patch.title === "string") return entry.patch.title;
    const known = (rows[entry.table] as Record<string, unknown>[]).find((row) => row[tables[entry.table].key] === entry.row_id);
    return typeof known?.title === "string" ? known.title : entry.table === "settings" ? settingName(entry.row_id, me) : text.sync.unknownRow;
  };

  const shown = (field: string, value: unknown) =>
    value === null
      ? text.sync.cleared
      : field === "amount" && typeof value === "number"
        ? formatMoney(value)
        : /_on$/.test(field) && typeof value === "string"
          ? formatDate(value)
          : field === "who"
            ? label(String(value))
            : value === true
              ? text.sync.yes
              : String(value);

  const changesOf = (entry: Pending) =>
    changedValues(entry.patch).map(([field, value]) => `${(text.field.common as Record<string, string>)[field] ?? field}: ${shown(field, value)}`);

  return (
    <>
      <Title>{text.sync.title}</Title>
      <p role="status">
        {storage === "failed"
          ? text.sync.storageBody
          : link === "mismatch"
            ? text.notice.mismatch
            : link === "expired"
              ? paused
                ? text.sync.pausedExpiredBody
                : text.sync.expiredBody
              : link === "offline"
                ? paused
                  ? text.paused
                  : text.sync.offlineBody
                : text.sync.onlineBody}
      </p>
      <p>{text.sync.waiting(pending)}</p>
      <div className="form-actions">
        {link === "expired" && (
          <button type="button" onClick={actions.logIn}>
            {text.sync.login}
          </button>
        )}
        <button type="button" className={link === "expired" ? "secondary" : undefined} onClick={() => actions.sync()}>
          {text.sync.now}
        </button>
      </div>
      {rejected.length > 0 && (
        <section aria-labelledby="rejected">
          <h2 id="rejected">{text.sync.attention}</h2>
          <p className="hint">{text.sync.attentionBody}</p>
          <ul className="rows">
            {rejected.map((entry) => (
              <li key={entry.seq}>
                <div className="row">
                  <div className="row-b">
                    <span className="title">
                      {text.sync.op[entry.op]} {text.sync.table[entry.table]}: {nameOf(entry)}
                    </span>
                    <span className="meta">
                      {changesOf(entry).map((change) => (
                        <span key={change}>{change}</span>
                      ))}
                    </span>
                    <span className="meta reason">
                      {entry.rejected?.map((reason) => (
                        <span key={reason}>{reasonText(reason, me)}</span>
                      ))}
                    </span>
                  </div>
                  <button type="button" className="pill" onClick={() => actions.discard(entry.seq)}>
                    {text.sync.discard}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
