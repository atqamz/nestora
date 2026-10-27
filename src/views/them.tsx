import { useMemo } from "react";
import { glances, themToday } from "../domain/timetable.ts";
import { usePartner } from "../hooks/use-plan.ts";
import { useRoutineClock, useRoutines } from "../hooks/use-routines.ts";
import { SlotItem } from "../ui/timetable.tsx";
import { text } from "../ui/text.ts";

const copy = text.routines;

export function Them() {
  const { items, me } = useRoutines();
  const { label } = usePartner();
  const { day, elapsed } = useRoutineClock();
  const them = useMemo(() => themToday(items, me, day), [items, me, day]);
  const windows = useMemo(() => glances(them.slots), [them.slots]);
  if (them.routines.length === 0) return null;
  const name = label(me === "a" ? "b" : "a");
  const live = windows.findLast((window) => window.from <= elapsed);
  const single = them.routines.length === 1;
  return (
    <section className="group rt-them" aria-labelledby="rt-them">
      <h2 id="rt-them">{copy.them.title(name)}</h2>
      <div className="rt-glance">
        {windows.map((window) =>
          window.near.length === 0 ? (
            <p key={window.from} className="empty" data-idle={window === live ? undefined : ""}>
              {them.slots.length === 0 ? copy.them.empty(name) : copy.them.over(name)}
            </p>
          ) : (
            <ul key={window.from} className="rt-slots" data-idle={window === live ? undefined : ""}>
              {window.near.map((mark) => (
                <SlotItem key={mark.slot.row.id} slot={mark.slot} mark={mark} />
              ))}
            </ul>
          ),
        )}
      </div>
      <p className="trail">
        <a href={single ? `#/routines/${them.routines[0].id}` : "#/routines"}>{single ? copy.them.week(name) : copy.all}</a>
      </p>
    </section>
  );
}
