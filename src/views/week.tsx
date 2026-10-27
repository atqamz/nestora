import { useMemo } from "react";
import { thisWeek } from "../domain/week.ts";
import type { WeekEntry } from "../domain/week.ts";
import { useToday } from "../hooks/use-plan.ts";
import { useTable } from "../hooks/use-store.ts";
import { Icon } from "../ui/icons.tsx";
import { ItemLine } from "../ui/item-line.tsx";
import { PaymentLine } from "../ui/payment-line.tsx";
import { text } from "../ui/text.ts";

function Entries({ id, heading, late, entries }: { id: string; heading: string; late?: true; entries: WeekEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <section className="group" aria-labelledby={id}>
      <h3 id={id} data-late={late} tabIndex={-1}>
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

const useWeek = () => {
  const items = useTable("items");
  const entries = useTable("budget_entries");
  const today = useToday();
  return useMemo(() => thisWeek(items, entries, today), [items, entries, today]);
};

export function LateLine() {
  const { length } = useWeek().overdue;
  if (length === 0) return null;
  return (
    <button
      type="button"
      className="rt-late"
      aria-label={text.week.lateNamed(length)}
      onClick={() => {
        const group = document.getElementById("week-overdue");
        group?.scrollIntoView({ block: "start", behavior: "instant" });
        group?.focus({ preventScroll: true });
      }}
    >
      <Icon name="late" />
      <span>{text.week.lateLine(length)}</span>
      <Icon name="down" />
    </button>
  );
}

export function Week() {
  const week = useWeek();
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
