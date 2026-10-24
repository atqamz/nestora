import { useState } from "react";
import type { Side } from "../../shared/api.ts";
import { count, isDone, keyFor } from "../../shared/routines.ts";
import type { ItemRow } from "../../shared/tables.ts";
import { useBusy } from "../hooks/use-busy.ts";
import { usePartner } from "../hooks/use-plan.ts";
import { Avatar } from "./avatar.tsx";
import { failureOf } from "./failure.ts";
import { Icon } from "./icons.tsx";
import type { Flows } from "./routine-flows.ts";
import { daysLine } from "./routine-label.ts";
import { Times } from "./timetable.tsx";
import { text } from "./text.ts";

const copy = text.routines;

type Props = { routine: ItemRow; action: ItemRow; flows: Flows; me: Side; today: string; active: boolean; full?: true };

const word = (row: ItemRow, key: string) => (typeof row.data?.[key] === "string" ? (row.data[key] as string) : null);

export function RoutineAction({ routine, action, flows, me, today, active, full }: Props) {
  const { label } = usePartner();
  const { once } = useBusy();
  const [failure, setFailure] = useState<string[]>([]);
  const side = keyFor(routine.who, me);
  const other = routine.who === "both" ? (me === "a" ? "b" : "a") : null;
  const unit = word(action, "unit");
  const link = word(action, "url");
  const only = daysLine(action.data?.days);
  const run = (work: () => Promise<Parameters<typeof failureOf>[0]>) => once(async () => setFailure(failureOf(await work())));

  if (action.kind === "text") {
    return (
      <li>
        <p className="rt-line">{action.title}</p>
      </li>
    );
  }

  if (action.kind === "block" || action.kind === "day_type") {
    return (
      <li>
        <div className="row">
          <span className="row-b">
            <span className="title">{action.title}</span>
            <span className="meta">
              {action.kind === "block" && (
                <span>
                  <Times start={word(action, "start_time") ?? ""} end={word(action, "end_time")} />
                </span>
              )}
              {word(action, "where") && <span>{word(action, "where")}</span>}
              {action.kind === "day_type" && <span>{copy.form.kind.day_type}</span>}
              {only && <span>{copy.daysOnly(only)}</span>}
            </span>
          </span>
        </div>
      </li>
    );
  }

  const done = isDone(action, side, today);
  const theirs = other !== null && isDone(action, other, today);
  const meta = (
    <span className="meta rt-nums" aria-live={action.kind === "counter" ? "polite" : undefined}>
      {action.kind === "timer" && typeof action.data?.minutes === "number" && (
        <span className="rt-timer">
          <Icon name="clock" />
          {copy.minutes(action.data.minutes)}
        </span>
      )}
      {action.kind === "counter" && <span>{copy.count(count(action, side, today), action.qty, unit)}</span>}
      {only && <span>{copy.daysOnly(only)}</span>}
      {!active && <span>{copy.notToday}</span>}
      {other !== null && (theirs || (action.kind === "counter" && count(action, other, today) > 0)) && (
        <span className="rt-other">
          <Avatar side={other} size={16} />
          {action.kind === "counter" ? copy.theirCount(label(other), copy.count(count(action, other, today), action.qty, unit)) : copy.tickedBy(label(other))}
        </span>
      )}
    </span>
  );

  return (
    <li data-done={done || undefined}>
      <div className="row">
        {action.kind === "counter" ? (
          <span className="lead rt-count" aria-hidden="true">
            {count(action, side, today)}
          </span>
        ) : (
          <label className="check">
            <input type="checkbox" checked={done} disabled={!active} onChange={() => run(() => flows.toggle(routine, action))} />
            <Icon name="check" />
            <span className="visually-hidden">{done ? text.reopen(action.title) : text.complete(action.title)}</span>
          </label>
        )}
        <span className="row-b">
          <span className="title">{action.title}</span>
          {meta}
          {full && action.note && <span className="hint rt-note">{action.note}</span>}
        </span>
        {(link !== null || action.kind === "counter") && (
          <span className="row-r rt-side">
            {link !== null && (
              <a className="pill" href={link} target="_blank" rel="noopener noreferrer" aria-label={copy.openNamed(action.title)}>
                {copy.open}
              </a>
            )}
            {action.kind === "counter" && (
              <span className="rt-btns">
                <button type="button" className="rt-plus" disabled={!active} aria-label={copy.plus(action.title)} onKeyDown={(event) => event.repeat && event.preventDefault()} onClick={() => run(() => flows.plus(routine, action))}>
                  {copy.plusLabel}
                </button>
                <button type="button" className="ib" aria-disabled={count(action, side, today) === 0 || undefined} aria-label={copy.reset(action.title)} onClick={() => count(action, side, today) > 0 && run(() => flows.reset(routine, action))}>
                  <Icon name="reset" />
                </button>
              </span>
            )}
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
