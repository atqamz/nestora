import { useState } from "react";
import type { BudgetEntryRow } from "../../shared/tables.ts";
import { useStamp } from "../hooks/use-plan.ts";
import { actions } from "../hooks/use-store.ts";
import { useWriteLock } from "../hooks/use-write-lock.ts";
import { Who } from "./avatar.tsx";
import { Due } from "./due.tsx";
import { failureOf } from "./failure.ts";
import { formatDate } from "./format.ts";
import { Icon } from "./icons.tsx";
import { Money } from "./money.tsx";
import { text } from "./text.ts";

export function PaymentLine({ payment, line }: { payment: BudgetEntryRow; line?: string }) {
  const stamp = useStamp();
  const { locked, guard } = useWriteLock();
  const [failure, setFailure] = useState<string[]>([]);
  const paid = payment.status === "paid";

  const toggle = async () => {
    const result = await actions.update(
      "budget_entries",
      payment.id,
      paid ? { status: "due", done_on: null } : { status: "paid", done_on: stamp() },
    );
    setFailure(failureOf(result));
  };

  return (
    <li data-done={paid || undefined}>
      <div className="row">
        <span className="lead" aria-hidden="true">
          <Icon name="receipt" />
        </span>
        <a className="row-b" href={`#/payments/${payment.id}`}>
          <span className="title">{payment.title}</span>
          <span className="meta">
            {paid ? (
              <span className="done-m">
                <Icon name="check" />
                {payment.done_on ? `${text.paidOn} ${formatDate(payment.done_on)}` : text.option.status.paid}
              </span>
            ) : payment.due_on ? (
              <Due on={payment.due_on} />
            ) : (
              <span>{text.noDueDate}</span>
            )}
            {payment.who && <Who side={payment.who} />}
            {line !== undefined && line !== payment.title && <span>{line}</span>}
          </span>
        </a>
        <span className="row-r">
          {payment.amount === null ? <span className="amt">{text.notSet}</span> : <Money rupiah={payment.amount} />}
          <button
            type="button"
            className="pill"
            aria-label={paid ? text.markUnpaidNamed(payment.title) : text.markPaidNamed(payment.title)}
            aria-disabled={locked || undefined}
            onClick={guard(toggle)}
          >
            {paid ? text.markUnpaid : text.markPaid}
          </button>
        </span>
      </div>
      {failure.length > 0 && (
        <p className="error" role="alert">
          {failure.join(" ")}
        </p>
      )}
    </li>
  );
}
