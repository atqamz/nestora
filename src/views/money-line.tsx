import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { budgetOf } from "../domain/budget.ts";
import { parseField } from "../domain/field.ts";
import { useBusy } from "../hooks/use-busy.ts";
import { useOpenRow } from "../hooks/use-open-row.ts";
import { actions, useTable } from "../hooks/use-store.ts";
import { useWriteLock } from "../hooks/use-write-lock.ts";
import { failureOf } from "../ui/failure.ts";
import { ItemDetail } from "../ui/item-detail.tsx";
import { Money } from "../ui/money.tsx";
import { PaymentLine } from "../ui/payment-line.tsx";
import { text } from "../ui/text.ts";
import { Gone } from "./generic-item.tsx";

export function MoneyLine({ id, wide }: { id: string; wide: boolean }) {
  const entries = useTable("budget_entries");
  const budget = useMemo(() => budgetOf(entries), [entries]);
  const [errors, setErrors] = useState<string[]>([]);
  const { busy, once } = useBusy();
  const { locked, hold } = useWriteLock();
  const { row: line, gone } = useOpenRow(budget.groups.flatMap((group) => group.lines).find((candidate) => candidate.row.id === id));
  if (!line) return <Gone name="planned" id={id} back="#/money" wide={wide} />;
  const { row, payments } = line;
  const Heading = wide ? "h3" : "h2";
  const Sub = wide ? "h4" : "h3";

  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locked) return hold();
    const form = event.currentTarget;
    const data = new FormData(form);
    const amount = parseField("int", String(data.get("amount") ?? ""));
    if (!amount.ok || amount.value === null) return setErrors([text.invalid.int]);
    return once(async () => {
      const result = await actions.create("budget_entries", {
        entry_type: "payment",
        title: String(data.get("title") ?? "").trim() || row.title,
        budget_id: row.id,
        status: "due",
        amount: amount.value as number,
        currency: row.currency,
        due_on: String(data.get("due_on") ?? "") || null,
        sort: payments.length,
      });
      if (result.ok) form.reset();
      setErrors(failureOf(result));
    });
  };

  return (
    <ItemDetail
      name="planned"
      row={row}
      gone={gone}
      wide={wide}
      back={{ href: "#/money", word: text.nav.money }}
      head={
        <p className="kicker">
          {text.money.lineKind} · {text.event[row.group_key as keyof typeof text.event] ?? row.group_key}
        </p>
      }
      details={false}
    >
      <dl className="nums">
        <div>
          <dt>{text.budget.planned}</dt>
          <dd>{line.planned === null ? text.notSet : <Money rupiah={line.planned} />}</dd>
        </div>
        <div>
          <dt>{text.budget.paid}</dt>
          <dd>
            <Money rupiah={line.paid} />
          </dd>
        </div>
        <div>
          <dt>{text.budget.remaining}</dt>
          <dd>{line.remaining === null ? text.notSet : <Money rupiah={line.remaining} />}</dd>
        </div>
        {line.over > 0 && (
          <div>
            <dt>{text.budget.over}</dt>
            <dd>
              <Money rupiah={line.over} />
            </dd>
          </div>
        )}
      </dl>
      <section aria-labelledby="payments">
        <Heading id="payments">{text.budget.payments}</Heading>
        {payments.length === 0 ? (
          <p className="empty">{text.empty.payments}</p>
        ) : (
          <ul className="rows">
            {payments.map((payment) => (
              <PaymentLine key={payment.id} payment={payment} />
            ))}
          </ul>
        )}
        <form className="form" noValidate={locked} onSubmit={add}>
          <Sub>{text.budget.addPayment}</Sub>
          <div className="field">
            <label htmlFor="payment-title">{text.budget.paymentLabel}</label>
            <input id="payment-title" name="title" maxLength={500} autoComplete="off" placeholder={row.title} />
          </div>
          <div className="field">
            <label htmlFor="payment-amount">{text.budget.amountLabel}</label>
            <input id="payment-amount" name="amount" required inputMode="numeric" autoComplete="off" />
          </div>
          <div className="field">
            <label htmlFor="payment-due">{text.field.common.due_on}</label>
            <input id="payment-due" name="due_on" type="date" />
          </div>
          {errors.length > 0 && (
            <p className="error" role="alert">
              {errors.join(" ")}
            </p>
          )}
          <div className="form-actions">
            <button type="submit" disabled={busy} aria-disabled={locked || undefined} aria-label={text.budget.addPayment}>
              {text.add}
            </button>
          </div>
        </form>
      </section>
    </ItemDetail>
  );
}
