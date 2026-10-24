import type { Strip } from "../domain/routines.ts";
import { Icon } from "./icons.tsx";
import { text } from "./text.ts";

const copy = text.routines;

export function RoutineWeek({ strip, compact }: { strip: Strip; compact?: true }) {
  return (
    <ol className="rt-week" data-compact={compact} aria-label={copy.week.label}>
      {strip.map(({ date, day, label, today, done }) => (
        <li key={date} aria-current={today ? "date" : undefined} aria-label={copy.week.day(copy.dayNames[day], label, done)}>
          <span className="rt-week-d" aria-hidden="true">
            {copy.days[day]}
            {done && <Icon name="check" />}
          </span>
          <span className="rt-week-l" aria-hidden="true">
            {label ?? "–"}
          </span>
        </li>
      ))}
    </ol>
  );
}
