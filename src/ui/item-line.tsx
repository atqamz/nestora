import { useState } from "react";
import type { ItemRow } from "../../shared/tables.ts";
import { usePartner, useStamp } from "../hooks/use-plan.ts";
import { actions } from "../hooks/use-store.ts";
import { useWriteLock } from "../hooks/use-write-lock.ts";
import type { Written } from "../hooks/use-store.ts";
import { Who } from "./avatar.tsx";
import { Due } from "./due.tsx";
import { failureOf } from "./failure.ts";
import { formatDate } from "./format.ts";
import { Icon } from "./icons.tsx";
import { firstStatus, views } from "./registry.ts";
import type { View, ViewName } from "./registry.ts";
import { text } from "./text.ts";

export function ItemLine({ name, row }: { name: ViewName; row: ItemRow }) {
  const view: View = views[name];
  const { me } = usePartner();
  const stamp = useStamp();
  const { locked, guard } = useWriteLock();
  const done = view.done !== undefined && row.status === view.done;
  const takeable = view.assignable && row.who === null && me !== null && !done;

  const [failure, setFailure] = useState<string[]>([]);
  const run = async (result: Promise<Written>) => setFailure(failureOf(await result));

  const toggle = () =>
    run(actions.update("items", row.id, done ? { status: firstStatus(name), done_on: null } : { status: view.done, done_on: stamp() }));

  const piece = (field: string) => {
    if (field === "due_on") return done ? null : row.due_on === null ? text.when.none : <Due on={row.due_on} />;
    return row.who === null ? null : <Who side={row.who} />;
  };

  return (
    <li data-done={done || undefined}>
      <div className="row">
        {view.done !== undefined && (
          <label className="check">
            <input type="checkbox" checked={done} aria-disabled={locked || undefined} onChange={guard(toggle)} />
            <Icon name="check" />
            <span className="visually-hidden">{done ? text.reopen(row.title) : text.complete(row.title)}</span>
          </label>
        )}
        <a className="row-b" href={`#/${view.route}/${row.id}`}>
          <span className="title">{row.title}</span>
          <span className="meta">
            {done && (
              <span className="done-m">
                <Icon name="check" />
                {row.done_on ? `${text.doneOn} ${formatDate(row.done_on)}` : text.option.status.done}
              </span>
            )}
            {view.summary.map((field) => {
              const shown = piece(field);
              return shown === null ? null : <span key={field}>{shown}</span>;
            })}
          </span>
        </a>
        {takeable && (
          <span className="row-r">
            <button type="button" className="pill" aria-label={text.takeNamed(row.title)} aria-disabled={locked || undefined} onClick={guard(() => run(actions.update("items", row.id, { who: me })))}>
              {text.takeIt}
            </button>
          </span>
        )}
      </div>
      {failure.length > 0 && (
        <p className="error" role="alert">
          {failure.join(" ")}
        </p>
      )}
    </li>
  );
}
