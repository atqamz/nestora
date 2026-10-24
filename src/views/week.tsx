import { useMemo } from "react";
import { thisWeek } from "../domain/week.ts";
import type { WeekEntry } from "../domain/week.ts";
import { useToday } from "../hooks/use-plan.ts";
import { useTable } from "../hooks/use-store.ts";
import { ItemLine } from "../ui/item-line.tsx";
import { PaymentLine } from "../ui/payment-line.tsx";
import { text } from "../ui/text.ts";

function Entries({ id, heading, late, entries }: { id: string; heading: string; late?: true; entries: WeekEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section className="group" aria-labelledby={id}>
      <h3 id={id} data-late={late}>
        {heading} <span>{entries.length}</span>
      </h3>
      <ul className="rows">
        {entries.map((entry) =>
          entry.type === "task" ? (
            <ItemLine key={entry.row.id} name="task" row={entry.row} />
          ) : (
            <PaymentLine key={entry.row.id} payment={entry.row} />
          ),
        )}
      </ul>
    </section>
  );
}

export function Week() {
  const items = useTable("items");
  const entries = useTable("budget_entries");
  const today = useToday();
  const week = useMemo(() => thisWeek(items, entries, today), [items, entries, today]);
  const empty = week.overdue.length + week.soon.length + week.undated.length === 0;
  return (
    <>
      {empty && <p className="empty">{text.week.empty}</p>}
      <Entries id="week-overdue" heading={text.week.overdue} late entries={week.overdue} />
      <Entries id="week-soon" heading={text.week.soon} entries={week.soon} />
      {week.undated.length > 0 && (
        <section className="group" aria-labelledby="week-undated">
          <h3 id="week-undated">
            {text.week.undated} <span>{week.undated.length}</span>
          </h3>
          <ul className="rows">
            {week.undated.map((row) => (
              <ItemLine key={row.id} name="task" row={row} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
