import type { Day, Mark, Slot } from "../domain/timetable.ts";
import { formatDay } from "./format.ts";
import { text } from "./text.ts";

const copy = text.routines;

export function Times({ start, end }: { start: string; end: string | null }) {
  return (
    <>
      <span aria-hidden="true">{start === "" ? copy.timetable.noTime : copy.timeRange(start, end)}</span>
      <span className="visually-hidden">{copy.timeSpoken(start, end)}</span>
    </>
  );
}

export function SlotItem({ slot, mark }: { slot: Slot; mark?: Mark }) {
  return (
    <li className="rt-slot" data-state={mark?.state} data-tag={mark?.tag ?? undefined}>
      <span className="rt-slot-t">
        <Times start={slot.start} end={slot.end} />
      </span>
      <span className="rt-slot-b">
        <span className="title rt-slot-title">{slot.row.title}</span>
        {slot.where !== null && <span className="meta">{slot.where}</span>}
      </span>
      {mark?.tag && <span className="rt-tag">{copy.them[mark.tag]}</span>}
      {mark?.state === "done" && <span className="visually-hidden">{copy.them.done}</span>}
    </li>
  );
}

export function Timetable({ days, today }: { days: readonly Day[]; today: string }) {
  return (
    <div className="rt-tt" role="group" aria-label={copy.timetable.week}>
      {days.map(({ date, day, slots, today: here }) => (
        <section key={date} className="rt-tt-day" aria-labelledby={`tt-${date}`} aria-current={here ? "date" : undefined} data-today={here || undefined}>
          <h2 id={`tt-${date}`}>
            {copy.dayNames[day]}
            <span>{formatDay(date, today)}</span>
            {here && <span className="rt-tag">{copy.timetable.today}</span>}
          </h2>
          {slots.length === 0 ? (
            <p className="empty rt-tt-none">{copy.timetable.free}</p>
          ) : (
            <ul className="rt-slots">
              {slots.map((slot) => (
                <SlotItem key={slot.row.id} slot={slot} />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}
