import { useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { EVENT_ORDER, budgetOf, fillOf, toPay } from "../domain/budget.ts";
import type { Budget, Group, Line } from "../domain/budget.ts";
import { parseField } from "../domain/field.ts";
import { owns } from "../domain/owner.ts";
import type { Owner } from "../domain/owner.ts";
import { sortBefore } from "../domain/order.ts";
import { useBusy } from "../hooks/use-busy.ts";
import { usePartner } from "../hooks/use-plan.ts";
import { actions, useTable } from "../hooks/use-store.ts";
import { useWriteLock } from "../hooks/use-write-lock.ts";
import { failureOf } from "../ui/failure.ts";
import { formatMoney } from "../ui/format.ts";
import { Icon } from "../ui/icons.tsx";
import { MarriageTabs } from "../ui/marriage-tabs.tsx";
import { Money } from "../ui/money.tsx";
import { OwnerFilter } from "../ui/owner-filter.tsx";
import { PaymentLine } from "../ui/payment-line.tsx";
import { Split } from "../ui/split.tsx";
import { text } from "../ui/text.ts";
import { Title } from "../ui/title.tsx";
import { MoneyLine } from "./money-line.tsx";

const eventName = (key: string) => text.event[key as keyof typeof text.event] ?? key;

function Summary({ budget }: { budget: Budget }) {
  if (budget.count === 0) return null;
  const estimated = budget.count - budget.unestimated;
  return (
    <div className="summary">
      <p className="sum">
        {estimated === 0 ? (
          text.money.noEstimates
        ) : (
          <>
            <Money rupiah={budget.planned} /> {text.money.estimatedOn(estimated, budget.count)} <Money rupiah={budget.paid} />{" "}
            {text.money.paidSoFar} <Money rupiah={budget.remaining} /> {text.money.leftToPay}
          </>
        )}
      </p>
      {budget.paidUnestimated > 0 && (
        <p className="note">
          <span>
            <Money rupiah={budget.paidUnestimated} /> {text.budget.paidOnUnestimated}
          </span>
        </p>
      )}
      {budget.over > 0 && (
        <p className="note">
          <span>{text.budget.overBy(formatMoney(budget.over))}</span>
        </p>
      )}
      {budget.unestimated > 0 && (
        <p className="note">
          <Icon name="late" />
          <span>{text.budget.unestimated(budget.unestimated)}</span>
        </p>
      )}
    </div>
  );
}

function LineRow({ line, selected }: { line: Line; selected: boolean }) {
  const { row, planned, paid, remaining, over, payments } = line;
  return (
    <li data-selected={selected || undefined}>
      <a className="line" href={`#/money/${row.id}`} aria-current={selected ? "true" : undefined}>
        <span className="title">{row.title}</span>
        <span className="plan" data-none={planned === null || undefined}>
          {planned === null ? (
            text.budget.notEstimatedLine
          ) : (
            <>
              <span className="visually-hidden">{text.budget.planned} </span>
              <Money rupiah={planned} />
            </>
          )}
        </span>
        <span className="line-s">
          {planned !== null && <span>{paid === 0 ? text.budget.nothingPaid : text.budget.paidAmount(formatMoney(paid))}</span>}
          {remaining !== null && <span>{over > 0 ? text.budget.overBy(formatMoney(over)) : text.budget.left(formatMoney(remaining))}</span>}
          {payments.length > 0 && <span className="count-p">{text.budget.paymentCount(payments.length)}</span>}
        </span>
      </a>
    </li>
  );
}

function EventGroup({ group, selected }: { group: Group; selected: string | undefined }) {
  const name = eventName(group.key);
  const estimated = group.count - group.unestimated;
  const fill = fillOf(group.planned, group.paid);
  return (
    <li className="event">
      <div className="event-h">
        <h3>{name}</h3>
        <span className="event-t">{estimated === 0 ? text.notSet : <Money rupiah={group.planned} />}</span>
      </div>
      {fill && <progress max={fill.max} value={fill.value} aria-label={text.budget.progressNamed(name)} />}
      <p className="event-m">
        {estimated > 0 && <span>{group.paid === 0 ? text.budget.nothingPaid : text.budget.paidAmount(formatMoney(group.paid))}</span>}
        {estimated > 0 && <span>{group.over > 0 ? text.budget.overBy(formatMoney(group.over)) : text.budget.left(formatMoney(group.remaining))}</span>}
        {group.unestimated > 0 && <span>{text.budget.notEstimated(group.unestimated)}</span>}
      </p>
      <div className="sheet">
        <div className="sheet-h" aria-hidden="true">
          <span />
          <span>{text.budget.planned}</span>
          <span>{text.budget.paid}</span>
          <span>{text.budget.remaining}</span>
        </div>
        <ul className="rows">
          {group.lines.map((line) => (
            <LineRow key={line.row.id} line={line} selected={line.row.id === selected} />
          ))}
        </ul>
      </div>
    </li>
  );
}

export function MoneyView({ id }: { id?: string }) {
  const entries = useTable("budget_entries");
  const budget = useMemo(() => budgetOf(entries), [entries]);
  const { me } = usePartner();
  const [owner, setOwner] = useState<Owner>("everyone");
  const [errors, setErrors] = useState<string[]>([]);
  const { busy, once } = useBusy();
  const { locked, hold } = useWriteLock();
  const kept = useRef(new Set<string>());
  const queue = toPay(budget, kept.current);
  for (const { payment } of queue) if (payment.status === "due") kept.current.add(payment.id);
  const open = queue.filter(({ payment }) => payment.status === "due");
  const shown = queue.filter(({ payment }) => owns(payment.who, owner, me));

  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locked) return hold();
    const form = event.currentTarget;
    const data = new FormData(form);
    const title = String(data.get("title") ?? "").trim();
    const amount = parseField("int", String(data.get("amount") ?? ""));
    if (title === "") return;
    if (!amount.ok) return setErrors([text.invalid.int]);
    return once(async () => {
      const result = await actions.create("budget_entries", {
        entry_type: "planned",
        title,
        group_key: String(data.get("group_key")),
        amount: amount.value as number | null,
        sort: sortBefore(entries.filter((entry) => entry.entry_type === "planned")),
      });
      if (result.ok) form.reset();
      setErrors(failureOf(result));
    });
  };

  const list = (
    <>
      <Title>{text.nav.money}</Title>
      <MarriageTabs screen="money" />
      <Summary budget={budget} />
      <section aria-labelledby="to-pay">
        <div className="sec-h">
          <h2 id="to-pay">
            {text.money.toPay} <span className="tally">{open.length}</span>
          </h2>
          {queue.length > 0 && <OwnerFilter value={owner} onChange={setOwner} owners={open.map(({ payment }) => payment.who)} />}
        </div>
        {queue.length === 0 ? (
          <p className="empty">{text.money.nothingToPay}</p>
        ) : shown.length === 0 ? (
          <p className="empty">{text.owner.empty}</p>
        ) : (
          <ul className="rows">
            {shown.map(({ payment, line }) => (
              <PaymentLine key={payment.id} payment={payment} line={line.title} />
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="by-event">
        <h2 id="by-event">{text.money.byEvent}</h2>
        <form className="quick-add budget-add" onSubmit={add}>
          <label className="visually-hidden" htmlFor="budget-title">
            {text.budget.addLabel}
          </label>
          <input id="budget-title" name="title" required maxLength={500} autoComplete="off" placeholder={text.budget.addPlaceholder} />
          <select name="group_key" aria-label={text.budget.event} defaultValue={EVENT_ORDER[2]}>
            {EVENT_ORDER.map((key) => (
              <option key={key} value={key}>
                {eventName(key)}
              </option>
            ))}
          </select>
          <input name="amount" inputMode="numeric" autoComplete="off" aria-label={text.budget.amountLabel} placeholder={text.budget.amountPlaceholder} />
          <button type="submit" disabled={busy} aria-disabled={locked || undefined} aria-label={text.budget.addPlaceholder}>
            {text.add}
          </button>
          {errors.length > 0 && (
            <p className="error" role="alert">
              {errors.join(" ")}
            </p>
          )}
        </form>
        {budget.count === 0 ? (
          <p className="empty">{text.empty.budget}</p>
        ) : (
          <ol className="events">
            {budget.groups.map((group) => (
              <EventGroup key={group.key} group={group} selected={id} />
            ))}
          </ol>
        )}
      </section>
    </>
  );

  return <Split open={id !== undefined} hint={text.money.pick} list={list} detail={(wide) => <MoneyLine key={id} id={id!} wide={wide} />} />;
}
